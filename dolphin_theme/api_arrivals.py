import json

import frappe
from frappe.utils import flt, cint, now_datetime

# Tolerance aligned with the Measurement Variations work: a side passes if it is
# within 3 cm OR 3% of the dispatched value (whichever is larger).
DIM_TOL_ABS = 3.0
DIM_TOL_PCT = 0.03


def _within_tol(dispatched, arrived):
    d, a = flt(dispatched), flt(arrived)
    if not d:
        return True
    tol = max(DIM_TOL_ABS, d * DIM_TOL_PCT)
    return abs(d - a) <= tol


def _weights(b):
    """Per-block (CBM, M.Tonnes, Kgs) per the shipping-document convention:
    M.T = CBM x specific gravity; Kgs = M.T x 1000."""
    cbm = flt(b.cbm) or round(flt(b.length) * flt(b.width) * flt(b.height) / 1e6, 3)
    factor = flt(b.get("avg_factor")) or 2.6
    mt = round(cbm * factor, 3)
    return round(cbm, 3), mt, cint(round(mt * 1000))


def _edit_distance(a, b):
    m, n = len(a), len(b)
    dp = list(range(n + 1))
    for i in range(1, m + 1):
        prev, dp[0] = dp[0], i
        for j in range(1, n + 1):
            cur = dp[j]
            dp[j] = min(dp[j] + 1, dp[j - 1] + 1, prev + (a[i - 1] != b[j - 1]))
            prev = cur
    return dp[n]


def _nearest(block_no, candidates):
    target, best, best_d = str(block_no).strip(), None, 99
    for c in candidates:
        d = _edit_distance(target, str(c))
        if d < best_d:
            best, best_d = c, d
    return best if best_d <= 2 else None


def _dispatched_index():
    rows = frappe.db.sql(
        """
        SELECT r.block, r.length_gross AS l, r.width_gross AS w,
               r.height_gross AS h, r.gross_volume AS vol, p.name AS dc
        FROM `tabDC Block Row` r
        JOIN `tabDelivery Challan` p ON p.name = r.parent
        WHERE p.docstatus = 1
        """,
        as_dict=True,
    )
    return {str(r.block).strip(): r for r in rows}


def _arrived_on_other(block_no, exclude_arrival):
    return bool(
        frappe.db.sql(
            """
            SELECT 1 FROM `tabPort Arrival Block` b
            JOIN `tabPort Arrival` p ON p.name = b.parent
            WHERE TRIM(b.block_no) = %s AND b.parent != %s
            LIMIT 1
            """,
            (str(block_no).strip(), exclude_arrival),
        )
    )


def _classify(pa):
    """Classify every block row in place. Does not save."""
    idx = _dispatched_index()
    keys = list(idx.keys())
    seen, flags = set(), 0
    for row in pa.blocks:
        bno = str(row.block_no or "").strip()
        row.suggested_block = None
        row.matched_dc = None
        if row.resolution_type:
            row.recon_status = "Resolved"
        elif not bno:
            row.recon_status = "Typo - not in DC"
            flags += 1
        elif bno in seen or _arrived_on_other(bno, pa.name):
            row.recon_status = "Duplicate"
            flags += 1
        elif bno not in idx:
            row.recon_status = "Typo - not in DC"
            row.suggested_block = _nearest(bno, keys)
            flags += 1
        else:
            dc = idx[bno]
            row.matched_dc = dc.dc
            ok = (
                _within_tol(dc.l, row.length)
                and _within_tol(dc.w, row.width)
                and _within_tol(dc.h, row.height)
            )
            row.recon_status = "Matched" if ok else "Dimension mismatch"
            if not ok:
                flags += 1
        seen.add(bno)
    awaiting = [k for k in keys if k not in seen]
    return {"flags": flags, "awaiting": awaiting, "total": len(pa.blocks)}


def run_reconcile(doc, method=None):
    """doc_events hook (validate) — mutate in place, framework saves. Phase 2 wires this."""
    try:
        _classify(doc)
    except Exception:
        frappe.log_error(frappe.get_traceback(), "Dolphin reconcile")


@frappe.whitelist()
def reconcile_arrival(name):
    """Run the cross-check on a Port Arrival and persist the per-row verdicts."""
    pa = frappe.get_doc("Port Arrival", name)
    res = _classify(pa)
    for row in pa.blocks:
        frappe.db.set_value("Port Arrival Block", row.name, {
            "recon_status": row.recon_status,
            "matched_dc": row.matched_dc,
            "suggested_block": row.suggested_block,
        }, update_modified=False)
    _mark_at_port(pa)
    return res


def _mark_at_port(pa):
    """A block confirmed arrived (Matched, or a non-duplicate resolution) is physically
    AT THE PORT -> flip its Quarry Block status to 'At Port' so it shows in the
    Blocks-At-Port report and the Shipping Document picker. Gated: only flips a block
    number that is a real Quarry Block, and never downgrades Shipped/Sold."""
    for row in pa.blocks:
        bno = str(row.block_no or "").strip()
        arrived = (row.recon_status == "Matched") or (
            row.resolution_type and row.resolution_type != "Removed (duplicate)"
        )
        if not (arrived and bno) or not frappe.db.exists("Quarry Block", bno):
            continue
        cur = frappe.db.get_value("Quarry Block", bno, "status")
        if cur not in ("At Port", "Shipped", "Sold"):
            frappe.db.set_value("Quarry Block", bno, "status", "At Port", update_modified=False)


@frappe.whitelist()
def resolve_flag(arrival, row_name, resolution_type, updates=None, note=None, machine=None):
    """Clear one flag. `updates` (JSON fieldname->value) optionally corrects data.
    Accept-as-is requires a reason. Every resolution stamps who + which PC + when."""
    if resolution_type == "Accepted as-is" and not (note or "").strip():
        frappe.throw("A reason is required to accept a discrepancy as-is.")
    pa = frappe.get_doc("Port Arrival", arrival)
    row = next((r for r in pa.blocks if r.name == row_name), None)
    if not row:
        frappe.throw("Row not found.")
    if updates:
        data = json.loads(updates) if isinstance(updates, str) else updates
        for k, v in data.items():
            row.set(k, v)
    row.resolution_type = resolution_type
    row.resolution_note = note
    row.resolved_by = frappe.session.user
    row.resolved_machine = machine or "un-named device"
    row.resolved_on = now_datetime()
    row.recon_status = "Resolved"
    pa.save(ignore_permissions=True)
    _mark_at_port(pa)
    return {"ok": True}


@frappe.whitelist()
def get_token():
    """Return the current session's CSRF token via a GET call (no CSRF needed),
    so the www page can authorise its POSTs even when served from page cache."""
    return frappe.sessions.get_csrf_token()


@frappe.whitelist()
def count_open_flags():
    """Count unresolved reconciliation flags across all arrivals (desk banner)."""
    r = frappe.db.sql(
        """
        SELECT COUNT(*) FROM `tabPort Arrival Block`
        WHERE recon_status IN ('Typo - not in DC', 'Dimension mismatch', 'Duplicate')
          AND IFNULL(resolution_type, '') = ''
        """
    )
    return int(r[0][0]) if r and r[0] else 0


@frappe.whitelist()
def full_view():
    """One flat, colour-codeable sheet: every block across every arrival with its
    measurement, CBM/MT/Kgs, matched challan, live reconciliation status and resolver,
    plus the reverse-check list of blocks dispatched but not yet arrived."""
    idx = _dispatched_index()
    awaiting_keys = set(idx.keys())
    rows = []
    arrivals = frappe.get_all(
        "Port Arrival",
        fields=["name", "mark", "shipper", "arrival_date"],
        order_by="arrival_date desc",
    )
    for a in arrivals:
        pa = frappe.get_doc("Port Arrival", a.name)
        _classify(pa)
        for b in pa.blocks:
            bno = str(b.block_no or "").strip()
            awaiting_keys.discard(bno)
            cbm, mt, kgs = _weights(b)
            status = "Resolved" if b.resolution_type else (b.recon_status or "")
            dcrow = idx.get(bno)
            rows.append({
                "arrival": a.name,
                "mark": a.mark or "",
                "block_no": b.block_no or "",
                "quarry_block": (dcrow.block if dcrow else ""),
                "length": cint(b.length),
                "width": cint(b.width),
                "height": cint(b.height),
                "cbm": cbm,
                "mt": mt,
                "kgs": kgs,
                "dc_l": (cint(dcrow.l) if dcrow else 0),
                "dc_w": (cint(dcrow.w) if dcrow else 0),
                "dc_h": (cint(dcrow.h) if dcrow else 0),
                "dc_cbm": (round(flt(dcrow.vol), 3) if dcrow else 0),
                "matched_dc": b.matched_dc or "",
                "status": status,
                "raw_status": b.recon_status or "",
                "suggested_block": b.suggested_block or "",
                "resolution_type": b.resolution_type or "",
                "resolved_by": b.resolved_by or "",
                "resolved_machine": b.resolved_machine or "",
            })
    awaiting = [{"block_no": k, "matched_dc": idx[k].dc} for k in sorted(awaiting_keys)]
    return {"rows": rows, "awaiting": awaiting}


@frappe.whitelist()
def generate_shipping_from_arrival(arrival):
    """Create a draft Shipping Document from a VERIFIED Port Arrival.
    Gated: refuses while any reconciliation flag is still open. Excludes
    blocks removed as duplicates. User completes consignee + rate after."""
    pa = frappe.get_doc("Port Arrival", arrival)
    _classify(pa)
    flagged = [
        b for b in pa.blocks
        if b.recon_status in ("Typo - not in DC", "Dimension mismatch", "Duplicate")
        and not b.resolution_type
    ]
    if flagged:
        frappe.throw(
            "Resolve all {0} open flag(s) before generating the shipping document.".format(len(flagged))
        )

    sd = frappe.new_doc("Shipping Document")
    sd.shipment_date = frappe.utils.today()
    if sd.meta.has_field("source_arrival"):
        sd.source_arrival = pa.name
    sd.shipping_mark = pa.get("mark")
    sd.marks_nos = pa.get("mark")
    sd.voyage_no = pa.get("vessel")           # Port Arrival.vessel is free text
    sd.bl_no = pa.get("booking_no")
    sd.goods_description = "Granite - Roughly Trimmed Blocks"
    sd.currency = "USD"
    sd.tax_treatment = "Export under LUT (No GST)"
    sd.rate_basis = "Per Kg"
    sd.country_of_origin = "INDIA"
    sd.pre_carriage_by = "ROAD"
    sd.terms_of_delivery = "F.O.B."

    total_cbm = 0.0
    total_mt = 0.0
    for b in pa.blocks:
        if b.resolution_type == "Removed (duplicate)":
            continue
        cbm, mt, kgs = _weights(b)
        vol = cbm
        row = sd.append("blocks", {})
        row.block = b.quarry_block
        row.block_no = b.block_no
        row.length = cint(b.length)
        row.width = cint(b.width)
        row.height = cint(b.height)
        row.net_volume = vol
        row.net_tonnage = mt
        row.net_kgs = kgs
        total_cbm += vol
        total_mt += mt

    sd.block_count = len(sd.blocks)
    sd.total_cbm = round(total_cbm, 2)
    sd.total_net_tonnage = round(total_mt, 3)
    sd.total_net_kgs = cint(round(total_mt * 1000))
    sd.flags.ignore_mandatory = True
    sd.insert(ignore_permissions=True)
    return sd.name


@frappe.whitelist()
def parse_check(arrival):
    """Did the consolidated xls parse cleanly? Compares row count + summed totals
    (file vs imported). file_rows/file_cbm/file_net are stored on the parent at parse."""
    pa = frappe.get_doc("Port Arrival", arrival)
    imported = len(pa.blocks)
    cbm = round(sum(flt(b.cbm) for b in pa.blocks), 2)
    net = round(sum(flt(b.net_wt) for b in pa.blocks), 2)
    file_rows = cint(pa.get("file_rows"))
    return {
        "imported_rows": imported,
        "imported_cbm": cbm,
        "imported_net": net,
        "file_rows": file_rows,
        "matches": file_rows in (0, imported),
    }


@frappe.whitelist()
def upsert_arrival(rows, source_file=None, current=None, meta=None):
    """Dedupe arrivals at parse time (P1, the real point-2 fix).

    `rows` is the JSON block list the form parsed from the xls (same fieldnames the
    Blocks child table uses). If these block numbers already live on ANOTHER Port
    Arrival, fold them into that record instead of letting a duplicate arrival be
    created -- upsert = update-or-insert, so the same arrival coming in again updates
    the one record rather than spawning PORT-ARR-0004, 0005, ... with the same blocks.

    Returns one of:
      {"action": "none"}                         -> no overlap; caller fills `current`
                                                    record as before (today's flow).
      {"action": "updated", "name": <arrival>,   -> exactly one existing arrival held
       "overlap": n, "total": m}                    these blocks; it was updated in
                                                    place. Caller routes to it and
                                                    drops the just-created draft.
      {"action": "ambiguous", "parents": [...],  -> blocks span >1 existing arrival;
       "overlap": {parent: n, ...}}                  no automatic merge -- caller warns
                                                    and lets the user resolve.
      {"action": "partial", "name": <arrival>,   -> the parse shares blocks with one
       "would_drop": [...]}                          arrival but is missing some of its
                                                    blocks; replacing would lose data,
                                                    so caller warns instead of writing.
    """
    data = json.loads(rows) if isinstance(rows, str) else (rows or [])
    nums = [str(r.get("block_no") or "").strip() for r in data]
    nums = [n for n in nums if n]
    if not nums:
        return {"action": "none"}

    cur = current or ""
    if cur.startswith("new-"):
        cur = ""

    # which OTHER Port Arrivals already hold any of these block numbers?
    existing = frappe.get_all(
        "Port Arrival Block",
        filters={"block_no": ["in", nums], "parenttype": "Port Arrival"},
        fields=["parent", "block_no"],
    )
    overlap = {}
    for e in existing:
        if e.parent == cur:
            continue
        overlap.setdefault(e.parent, set()).add(str(e.block_no).strip())

    if not overlap:
        return {"action": "none"}

    if len(overlap) > 1:
        return {
            "action": "ambiguous",
            "parents": list(overlap.keys()),
            "overlap": {p: len(s) for p, s in overlap.items()},
        }

    # exactly one existing arrival -> candidate for UPSERT
    target = next(iter(overlap))
    pa = frappe.get_doc("Port Arrival", target)

    # Safety: only rebuild the target's blocks when this parse would NOT drop any
    # block already on it -- i.e. the parse is the same arrival or a superset. If the
    # incoming file is missing blocks the target already has, replacing would lose
    # data (a different shipment that merely shares a block number), so warn instead.
    target_blocks = {
        str(b.block_no or "").strip() for b in pa.blocks if str(b.block_no or "").strip()
    }
    parsed_set = set(nums)
    if not target_blocks.issubset(parsed_set):
        return {
            "action": "partial",
            "name": target,
            "would_drop": sorted(target_blocks - parsed_set),
            "overlap": len(overlap[target]),
        }

    # safe to upsert: rebuild its blocks from this parse
    child_fields = {df.fieldname for df in frappe.get_meta("Port Arrival Block").fields}
    pa.set("blocks", [])
    for r in data:
        if not str(r.get("block_no") or "").strip():
            continue
        child = pa.append("blocks", {})
        for k, v in r.items():
            if k in child_fields:
                child.set(k, v)

    # refresh parent header from this parse where supplied
    m = json.loads(meta) if isinstance(meta, str) else (meta or {})
    for f in ("shipper", "mark", "arrival_date", "port", "vessel",
              "booking_no", "email_subject"):
        if m.get(f) not in (None, ""):
            pa.set(f, m.get(f))
    if source_file:
        pa.set("source_file", source_file)

    # keep the parent summary fields in sync (normally client-computed on the form)
    if pa.meta.has_field("total_blocks"):
        pa.total_blocks = len(pa.blocks)
    if pa.meta.has_field("total_cbm"):
        pa.total_cbm = round(sum(flt(b.cbm) for b in pa.blocks), 2)
    if pa.meta.has_field("total_net_wt"):
        pa.total_net_wt = round(sum(flt(b.net_wt) for b in pa.blocks), 2)

    # recompute the per-row reconciliation verdicts on the merged set
    try:
        _classify(pa)
    except Exception:
        frappe.log_error(frappe.get_traceback(), "Dolphin upsert reclassify")

    pa.flags.ignore_mandatory = True
    pa.save(ignore_permissions=True)
    return {
        "action": "updated",
        "name": target,
        "overlap": len(overlap[target]),
        "total": len(nums),
    }


@frappe.whitelist()
def create_shipment_lot(consignee=None, rows=None, mark=None, vessel=None):
    """Build a Export Shipment Lot (the final lot) from at-port blocks selected on the
    reconciliation sheet. `rows` is the JSON list of selected full_view rows."""
    data = json.loads(rows) if isinstance(rows, str) else (rows or [])
    if not data:
        frappe.throw("Select at least one at-port block to build a Export Shipment Lot.")
    lot = frappe.new_doc("Export Shipment Lot")
    lot.shipment_date = frappe.utils.today()
    if consignee:
        lot.export_consignee = consignee
    if mark:
        lot.shipping_mark = mark
    if vessel:
        lot.vessel = vessel
    lot.status = "Ready"
    arrivals, tc, tt = set(), 0.0, 0.0
    for r in data:
        ch = lot.append("blocks", {})
        ch.block = r.get("quarry_block") or None
        ch.block_no = r.get("block_no")
        ch.length = cint(r.get("length"))
        ch.width = cint(r.get("width"))
        ch.height = cint(r.get("height"))
        ch.cbm = flt(r.get("cbm"))
        ch.net_tonnage = flt(r.get("mt"))
        ch.net_kgs = cint(r.get("kgs"))
        ch.grade = r.get("grade") or ""
        ch.source_dc = r.get("matched_dc") or ""
        ch.source_arrival = r.get("arrival") or ""
        if r.get("arrival"):
            arrivals.add(r.get("arrival"))
        tc += flt(r.get("cbm"))
        tt += flt(r.get("mt"))
    lot.block_count = len(lot.blocks)
    lot.total_cbm = round(tc, 2)
    lot.total_net_tonnage = round(tt, 3)
    lot.total_net_kgs = cint(round(tt * 1000))
    lot.source_arrivals = ", ".join(sorted(arrivals))
    lot.flags.ignore_mandatory = True
    lot.insert(ignore_permissions=True)
    return lot.name

# ===========================================================================
# Arrival .xls importer  (append to dolphin_theme/api_arrivals.py)
# Block number is the PRIMARY key. Only Dolphin's own sheet is ingested, so a
# workbook that also carries another company's tab (e.g. VARDHINI XG) cannot
# pollute the report. Idempotent: re-importing upserts blocks by block_no.
# ===========================================================================
import re as _re


def _xls_s(v):
    if isinstance(v, float):
        return str(int(v)) if v == int(v) else str(v)
    return str(v).strip()


def _xls_num(v):
    try:
        return float(str(v).replace(",", "").strip())
    except Exception:
        return None


def _xls_is_dolphin_sheet(sheet, single):
    """Keep the Dolphin sheet: the only sheet, or a tab whose name / top title
    rows mention 'dolphin'. Drop tabs whose title names another firm (M/S. ...)."""
    if single:
        return True
    if "dolphin" in sheet.name.lower():
        return True
    for r in range(min(sheet.nrows, 3)):
        line = " ".join(_xls_s(sheet.cell_value(r, c)).lower() for c in range(sheet.ncols))
        if "dolphin" in line:
            return True
        if _re.search(r"m/?s\.", line):
            return False
    return False


def _xls_header(sheet):
    for r in range(min(sheet.nrows, 12)):
        cells = [_xls_s(sheet.cell_value(r, c)).lower() for c in range(sheet.ncols)]
        if _re.search(r"block\s*no", " ".join(cells)):
            cm = {}
            for c, t in enumerate(cells):
                t = t.strip()
                if _re.fullmatch(r"block\s*no\.?", t):
                    cm["block_no"] = c
                elif t == "cbm":
                    cm.setdefault("cbm", c)
                elif t in ("mark", "marking"):
                    cm["mark"] = c
                elif t in ("vehicle no.", "vehicle no", "way o transport", "way of transport"):
                    cm["vehicle"] = c
                elif t == "location":
                    cm["location"] = c
                elif t in ("line no", "line no.", "line no. "):
                    cm["line"] = c
                elif t in ("ado no", "ado no."):
                    cm["ado"] = c
                elif t in ("permit no", "permit no."):
                    cm["permit"] = c
                elif "weight" in t or t == "a/wt":
                    cm.setdefault("weight", c)
                elif t == "measurement":
                    cm["meas"] = c
            return r, cm
    return None, {}


def _xls_dims(sheet, r, start):
    vals, c = [], start
    while c < sheet.ncols and len(vals) < 3:
        v = _xls_num(sheet.cell_value(r, c))
        if v is not None:
            vals.append(v)
        c += 1
    return (vals + [None, None, None])[:3]


def _parse_arrival_xls(content):
    """content: bytes of a .xls. Returns (rows, sheet_name) for the Dolphin sheet."""
    try:
        import xlrd
    except Exception:
        frappe.throw(
            "The .xls reader (xlrd) is not installed on this bench. "
            "Add xlrd to the app's requirements and redeploy."
        )
    wb = xlrd.open_workbook(file_contents=content)
    single = wb.nsheets == 1
    rows, used_sheet = [], None
    for sh in wb.sheets():
        if not _xls_is_dolphin_sheet(sh, single):
            continue
        hr, cm = _xls_header(sh)
        if hr is None or "block_no" not in cm:
            continue
        used_sheet = sh.name
        for r in range(hr + 1, sh.nrows):
            bno = _xls_s(sh.cell_value(r, cm["block_no"]))
            if not bno or not _re.search(r"\d", bno):
                continue
            joined = " ".join(_xls_s(sh.cell_value(r, c)).lower() for c in range(sh.ncols))
            if "total" in joined and not _re.search(r"\bblock", joined):
                continue
            length = width = height = None
            if "meas" in cm:
                length, width, height = _xls_dims(sh, r, cm["meas"])

            def cell(k):
                return _xls_s(sh.cell_value(r, cm[k])) if k in cm else None

            rows.append({
                "block_no": bno,
                "mark": (cell("mark") or None),
                "cbm": _xls_num(sh.cell_value(r, cm["cbm"])) if "cbm" in cm else None,
                "weight": _xls_num(sh.cell_value(r, cm["weight"])) if "weight" in cm else None,
                "length": length, "width": width, "height": height,
                "vehicle_no": cell("vehicle"),
                "yard_location": cell("location"),
                "line_no": cell("line"),
                "ado_no": cell("ado"),
                "permit_no": cell("permit"),
            })
    return rows, used_sheet


@frappe.whitelist()
def import_xls(arrival=None, mark=None, agency=None):
    """Import a Dolphin arrivals .xls (uploaded as multipart 'file').

    Block number is the primary key; only Dolphin's sheet is ingested.
    Idempotent - upserts blocks by block_no into the target Port Arrival:
    the one named in `arrival`, else an existing arrival with the same
    mark + source sheet, else a new Port Arrival. Runs reconciliation after."""
    f = frappe.request.files.get("file") if frappe.request else None
    if not f:
        frappe.throw("No file received. Attach an .xls file.")
    content = f.stream.read() if hasattr(f, "stream") else f.read()
    fname = getattr(f, "filename", "arrival.xls")

    rows, sheet = _parse_arrival_xls(content)
    if not rows:
        frappe.throw("No Dolphin block rows found (only the Dolphin sheet is read).")

    marks = [r["mark"] for r in rows if r.get("mark")]
    doc_mark = mark or (marks[0] if marks else None)

    pa = None
    if arrival and frappe.db.exists("Port Arrival", arrival):
        pa = frappe.get_doc("Port Arrival", arrival)
    else:
        existing = frappe.db.get_value(
            "Port Arrival", {"mark": doc_mark, "source_sheet": sheet, "docstatus": 0}, "name"
        ) if doc_mark else None
        if existing:
            pa = frappe.get_doc("Port Arrival", existing)
        else:
            pa = frappe.new_doc("Port Arrival")
            pa.arrival_date = frappe.utils.today()

    if doc_mark and pa.meta.has_field("mark"):
        pa.mark = doc_mark
    if agency and pa.meta.has_field("shipper"):
        pa.shipper = agency
    if pa.meta.has_field("source_sheet"):
        pa.source_sheet = sheet
    subj = frappe.form_dict.get("subject") if frappe.form_dict else None
    sender = frappe.form_dict.get("sender") if frappe.form_dict else None
    if subj and pa.meta.has_field("email_subject"):
        pa.email_subject = subj
    if sender and pa.meta.has_field("email_sender"):
        pa.email_sender = sender

    existing_by_block = {str(b.block_no).strip(): b for b in pa.blocks}
    created = updated = 0
    for r in rows:
        b = existing_by_block.get(r["block_no"])
        if not b:
            b = pa.append("blocks", {})
            b.block_no = r["block_no"]
            created += 1
        else:
            updated += 1
        if r.get("mark"):
            b.mark = r["mark"]
        for k in ("length", "width", "height", "cbm",
                  "vehicle_no", "yard_location", "line_no", "ado_no", "permit_no"):
            if r.get(k) is not None and b.meta.has_field(k):
                b.set(k, r[k])
        if r.get("weight") is not None:
            if b.meta.has_field("net_wt"):
                b.net_wt = r["weight"]
            if b.meta.has_field("a_wt") and not b.get("a_wt"):
                b.a_wt = r["weight"]

    pa.total_blocks = len(pa.blocks)
    pa.total_cbm = round(sum(flt(b.cbm) for b in pa.blocks), 3)
    pa.total_net_wt = round(sum(flt(b.net_wt) for b in pa.blocks), 3)
    pa.flags.ignore_mandatory = True
    pa.save(ignore_permissions=True)

    try:
        _classify(pa)
        for row in pa.blocks:
            frappe.db.set_value("Port Arrival Block", row.name, {
                "recon_status": row.recon_status,
                "matched_dc": row.matched_dc,
                "suggested_block": row.suggested_block,
            }, update_modified=False)
    except Exception:
        frappe.log_error(frappe.get_traceback(), "import_xls reconcile")

    frappe.db.commit()
    return {
        "arrival": pa.name,
        "sheet": sheet,
        "file": fname,
        "created": created,
        "updated": updated,
        "duplicates": 0,
        "total_blocks": pa.total_blocks,
    }


# ===========================================================================
# Workspace additions (append to dolphin_theme/api_arrivals.py)
#   lots_view()        -> read-only feed for the Shipment Lots tab + lets the
#                         Stock page compute in-lot / loaded / left-out.
#   move_to_at_port()  -> bulk "skip arrivals": take DC-submitted blocks that are
#                         awaiting arrival and place them At Port (draft, reversible).
# Both are defensive: field names are probed with meta.has_field so a schema
# difference degrades gracefully instead of writing bad data.
# ===========================================================================
import json as _json


@frappe.whitelist()
def lots_view():
    """Every Export Shipment Lot with its consignee/vessel/doc numbers and the
    list of block numbers it holds. Read-only."""
    out = []
    emap = _export_map()
    for name in frappe.get_all("Export Shipment Lot", pluck="name"):
        try:
            d = frappe.get_doc("Export Shipment Lot", name)
        except Exception:
            continue

        block_nos = []
        for tf in d.meta.get_table_fields():
            rows = d.get(tf.fieldname) or []
            picked = []
            for r in rows:
                bn = r.get("block_no") or r.get("block") or r.get("quarry_block")
                if bn:
                    _k = str(bn).strip()
                    picked.append(emap.get(_k, _k))
            if picked:
                block_nos = picked
                break

        def gv(*keys):
            for k in keys:
                if d.meta.has_field(k):
                    v = d.get(k)
                    if v not in (None, ""):
                        return v
            return None

        shipped = bool(gv("shipped")) or d.docstatus == 1
        stf = gv("status")
        if stf and str(stf).lower() in ("shipped", "dispatched", "sailed", "closed"):
            shipped = True

        out.append({
            "name": d.name,
            "title": gv("title", "lot_name", "lot_title") or d.name,
            "consignee": gv("consignee", "consignee_name", "customer", "shipper", "mark") or "",
            "vessel": gv("vessel", "vessel_name", "vessel_voyage", "voyage") or "",
            "packing_list": gv("packing_list", "packing_list_no", "pl_no"),
            "bl_no": gv("bl_no", "bill_of_lading", "bl_number", "bl"),
            "ship_date": (str(gv("ship_date", "shipment_date", "sailed_on") or "") or None),
            "total_blocks": gv("total_blocks") or len(block_nos),
            "total_cbm": gv("total_cbm"),
            "status": "ship" if shipped else "build",
            "shipped": shipped,
            "block_nos": block_nos,
        })
    return out


@frappe.whitelist()
def move_to_at_port(blocks=None):
    """Place DC-submitted 'awaiting arrival' blocks At Port without an arrival file.
    Writes into a single reusable DRAFT Port Arrival. Idempotent by block number."""
    if isinstance(blocks, str):
        blocks = _json.loads(blocks)
    blocks = blocks or []
    if not blocks:
        frappe.throw("No blocks supplied to move.")

    label = "AT-PORT (skipped arrivals)"
    meta = frappe.get_meta("Port Arrival")
    tag = next((f for f in ("source_sheet", "email_subject", "source_file")
                if meta.has_field(f)), None)

    pa = None
    if tag:
        tname = frappe.db.get_value("Port Arrival", {tag: label, "docstatus": 0}, "name")
        if tname:
            pa = frappe.get_doc("Port Arrival", tname)
    if pa is None:
        pa = frappe.new_doc("Port Arrival")
        if tag:
            pa.set(tag, label)
        if meta.has_field("arrival_date"):
            pa.arrival_date = frappe.utils.today()

    existing = {str(b.block_no).strip() for b in pa.blocks}
    moved = 0
    for it in blocks:
        bn = str((it or {}).get("block_no") or "").strip()
        if not bn or bn in existing:
            continue
        row = pa.append("blocks", {})
        row.block_no = bn
        existing.add(bn)
        if row.meta.has_field("matched_dc") and it.get("dc"):
            row.matched_dc = it.get("dc")
        if row.meta.has_field("recon_status"):
            row.recon_status = "Resolved"
        moved += 1

    if meta.has_field("total_blocks"):
        pa.total_blocks = len(pa.blocks)
    pa.flags.ignore_mandatory = True
    pa.save(ignore_permissions=True)
    frappe.db.commit()
    return {"arrival": pa.name, "moved": moved}


# ===========================================================================
# Holistic transported-block ledger + actions  (append to api_arrivals.py)
#
# KEY FIX: an arrival sheet's block number matches the Delivery Challan's
# `block` field (the quarry block no) — NOT dc_block_rows.block_no (internal
# series) nor export_block_no. Matching now tries block -> block_no -> export.
#
#   ledger_view()          one flat row per transported block, with backward
#                          trace (DC -> source BI -> consignee) + lot + state.
#   move_dc_to_at_port(dc) DC-wise "skip arrivals": whole challan -> At Port.
#   resolve_block(...)     accept / link / fix keyed by (arrival, block_no).
#   block_availability(..) which DC each block is already on (dialog + BI).
# ===========================================================================


def _s(v):
    return str(v).strip() if v not in (None, "") else ""


def _consignee_names():
    m = {}
    try:
        for c in frappe.get_all("Export Consignee", fields=["name", "consignee_name"]):
            m[c.name] = c.get("consignee_name") or c.name
    except Exception:
        pass
    return m


def _lot_membership():
    """block key -> {lot, st(build/ship), title}"""
    m = {}
    for l in frappe.get_all("Export Shipment Lot", fields=["name", "docstatus"]):
        try:
            d = frappe.get_doc("Export Shipment Lot", l.name)
        except Exception:
            continue
        shipped = (d.docstatus == 1) or bool(d.get("shipped"))
        title = d.get("title") or d.get("consignee") or d.name
        for tf in d.meta.get_table_fields():
            for r in (d.get(tf.fieldname) or []):
                for k in (r.get("block_no"), r.get("export_block_no"),
                          r.get("block"), r.get("quarry_block")):
                    if _s(k):
                        m[_s(k)] = {"lot": d.name, "st": "ship" if shipped else "build", "title": title}
    return m


def _arrived_index():
    """block_no -> Port Arrival Block row (physically at port)."""
    idx = {}
    for p in frappe.get_all(
        "Port Arrival Block",
        fields=["parent", "block_no", "mark", "length", "width", "height",
                "cbm", "net_wt", "recon_status", "match_status", "vehicle_no"],
        limit_page_length=0,
    ):
        k = _s(p.block_no)
        if k:
            idx.setdefault(k, p)
    return idx


@frappe.whitelist()
def ledger_view():
    """One flat row per transported block: block -> DC -> BI/consignee, plus
    arrival/port reality, lot membership and a single state."""
    lots = _lot_membership()
    arrived = _arrived_index()
    cons = _consignee_names()
    emap = _export_map()

    dcs = {x.name: x for x in frappe.get_all(
        "Delivery Challan", filters={"docstatus": 1},
        fields=["name", "export_consignee", "shipping_mark", "vehicle", "port_of_loading"])}

    ports = {p.name: p.port_code for p in frappe.get_all("Indian Port", fields=["name", "port_code"])}
    rows, seen = [], set()

    if dcs:
        for r in frappe.get_all(
            "DC Block Row",
            filters={"parenttype": "Delivery Challan", "parent": ["in", list(dcs.keys())]},
            fields=["parent", "block", "block_no", "export_block_no",
                    "source_inspection", "grade", "length_gross", "width_gross",
                    "height_gross", "gross_volume", "gross_tonnage"],
            limit_page_length=0,
        ):
            dc = dcs.get(r.parent)
            if not dc:
                continue
            keys = [_s(k) for k in (r.block, r.block_no, r.export_block_no) if _s(k)]
            primary = _s(r.block) or (keys[0] if keys else "")
            if not primary:
                continue
            pa = next((arrived[k] for k in keys if k in arrived), None)
            lot = next((lots[k] for k in keys if k in lots), None)

            if lot and lot["st"] == "ship":
                state = "load"
            elif lot:
                state = "lot"
            elif pa is not None:
                rs = _s(pa.recon_status).lower()
                state = ("dmg" if "damage" in rs else
                         "held" if ("hold" in rs or "held" in rs) else
                         "mis" if ("mismatch" in rs or "dimension" in rs) else "port")
            else:
                state = "await"

            rows.append({
                "block_no": primary,
                "export_block_no": r.export_block_no or emap.get(_s(r.block_no)) or emap.get(_s(primary)) or "",
                "mark": (pa.mark if pa else None) or dc.shipping_mark,
                "dc": dc.name,
                "consignee": cons.get(dc.export_consignee, dc.export_consignee),
                "source_bi": r.source_inspection,
                "grade": r.grade,
                "dc_l": r.length_gross, "dc_w": r.width_gross, "dc_h": r.height_gross,
                "dc_cbm": r.gross_volume, "ton": r.gross_tonnage,
                "pt_l": (pa.length if pa else None), "pt_w": (pa.width if pa else None),
                "pt_h": (pa.height if pa else None), "pt_cbm": (pa.cbm if pa else None),
                "net_wt": (pa.net_wt if pa else None),
                "arrival": (pa.parent if pa else None),
                "recon_status": (pa.recon_status if pa else None),
                "lot": (lot["lot"] if lot else None),
                "lot_title": (lot["title"] if lot else None),
                "truck": dc.vehicle, "port": dc.port_of_loading, "port_code": ports.get(dc.port_of_loading, dc.port_of_loading), "state": state, "source": "dc",
            })
            for k in keys:
                seen.add(k)

    # arrived but not on any submitted DC -> excess / opening / accepted
    for k, pa in arrived.items():
        if k in seen:
            continue
        lot = lots.get(k)
        rs = _s(pa.recon_status).lower()
        if lot and lot["st"] == "ship":
            state = "load"
        elif lot:
            state = "lot"
        elif "resolved" in rs or "accept" in rs or "opening" in rs:
            state = "port"
        else:
            state = "orphan"
        rows.append({
            "block_no": k, "mark": pa.mark, "dc": None, "consignee": None,
            "source_bi": None, "grade": None,
            "dc_l": None, "dc_w": None, "dc_h": None, "dc_cbm": None, "ton": None,
            "pt_l": pa.length, "pt_w": pa.width, "pt_h": pa.height,
            "pt_cbm": pa.cbm, "net_wt": pa.net_wt,
            "arrival": pa.parent, "recon_status": pa.recon_status,
            "lot": (lot["lot"] if lot else None),
            "lot_title": (lot["title"] if lot else None),
            "truck": pa.vehicle_no, "port": None, "port_code": None, "state": state, "source": "arrival",
        })
    return rows


@frappe.whitelist()
def move_dc_to_at_port(dc=None):
    """DC-wise skip-arrivals: place every block on this challan At Port."""
    if not dc:
        frappe.throw("No challan given.")
    d = frappe.get_doc("Delivery Challan", dc)
    blocks = []
    for r in (d.get("dc_block_rows") or []):
        bn = _s(r.get("block")) or _s(r.get("block_no"))
        if bn:
            blocks.append({"block_no": bn, "dc": dc})
    if not blocks:
        frappe.throw("This challan has no blocks.")
    return move_to_at_port(blocks)


@frappe.whitelist()
def resolve_block(arrival=None, block_no=None, action="accept", dc=None, length=None, width=None, height=None, cbm=None, weight=None):
    """Resolve a flagged block, keyed by (arrival, block_no). Once accepted the
    block reads as Resolved and shows under All at port."""
    block_no = _s(block_no)
    if not block_no:
        frappe.throw("No block number.")

    name = None
    if arrival:
        name = frappe.db.get_value("Port Arrival Block",
                                   {"parent": arrival, "block_no": block_no}, "name")
    if not name:
        name = frappe.db.get_value("Port Arrival Block", {"block_no": block_no}, "name")
    if not name:
        frappe.throw("Block {0} not found at port.".format(block_no))

    updates = {}
    if action in ("accept", "release", "accept_extra"):
        updates["recon_status"] = "Resolved"
    elif action == "use_dc":
        updates["recon_status"] = "Resolved"
    elif action == "hold":
        updates["recon_status"] = "Held"
    elif action == "link_dc" and dc:
        updates["matched_dc"] = dc
        updates["recon_status"] = "Resolved"
    elif action == "unresolve":
        updates["recon_status"] = ""
    else:
        updates["recon_status"] = "Resolved"

    if action in ("modify", "unresolve"):
        for _f, _v in (("length", length), ("width", width), ("height", height), ("cbm", cbm), ("weight", weight)):
            if _v not in (None, ""):
                updates[_f] = flt(_v)
    frappe.db.set_value("Port Arrival Block", name, updates, update_modified=False)
    frappe.db.commit()
    return {"block_no": block_no, "action": action, "ok": True}


@frappe.whitelist()
def block_availability(blocks=None):
    """Given block numbers, return {block: dc_name or None} — which challan
    (draft or submitted) each block already sits on. Powers the Available /
    on-DC indicator in the add-blocks dialog and the Buyer Inspection screen."""
    import json as _json
    if isinstance(blocks, str):
        blocks = _json.loads(blocks)
    blocks = [_s(b) for b in (blocks or []) if _s(b)]
    if not blocks:
        return {}
    out = {b: None for b in blocks}
    rows = frappe.get_all(
        "DC Block Row",
        filters={"parenttype": "Delivery Challan"},
        fields=["parent", "block", "block_no", "export_block_no"],
        limit_page_length=0,
    )
    # only challans that still count (not cancelled)
    valid = set(frappe.get_all("Delivery Challan",
                               filters={"docstatus": ["<", 2]}, pluck="name"))
    for r in rows:
        if r.parent not in valid:
            continue
        for k in (_s(r.block), _s(r.block_no), _s(r.export_block_no)):
            if k in out and not out[k]:
                out[k] = r.parent
    return out


@frappe.whitelist()
def active_lots():
    """Building/Ready (not shipped) Export Shipment Lots for the push picker."""
    out = []
    for l in lots_view():
        if l.get("status") != "ship" and not l.get("shipped"):
            out.append({
                "name": l["name"],
                "title": l.get("title"),
                "consignee": l.get("consignee"),
                "total_blocks": l.get("total_blocks"),
            })
    return out


@frappe.whitelist()
def add_blocks_to_lot(lot=None, rows=None):
    """Append at-port blocks to an existing (building) Export Shipment Lot."""
    if not lot:
        frappe.throw("No lot given.")
    data = _json.loads(rows) if isinstance(rows, str) else (rows or [])
    if not data:
        frappe.throw("No blocks to add.")
    d = frappe.get_doc("Export Shipment Lot", lot)
    tf = None
    for t in d.meta.get_table_fields():
        tf = t.fieldname
        break
    if not tf:
        frappe.throw("Lot has no block table.")
    existing = set()
    for r in (d.get(tf) or []):
        for k in (r.get("block_no"), r.get("block"), r.get("quarry_block")):
            if _s(k):
                existing.add(_s(k))
    added = 0
    tc = flt(d.get("total_cbm"))
    tt = flt(d.get("total_net_tonnage"))
    for r in data:
        bn = _s(r.get("block_no"))
        if not bn or bn in existing:
            continue
        ch = d.append(tf, {})
        if ch.meta.has_field("block"):
            ch.block = r.get("quarry_block") or None
        if ch.meta.has_field("block_no"):
            ch.block_no = r.get("block_no")
        for fld in ("length", "width", "height"):
            if ch.meta.has_field(fld):
                ch.set(fld, cint(r.get(fld)))
        if ch.meta.has_field("cbm"):
            ch.cbm = flt(r.get("cbm"))
        if ch.meta.has_field("net_tonnage"):
            ch.net_tonnage = flt(r.get("mt"))
        if ch.meta.has_field("net_kgs"):
            ch.net_kgs = cint(r.get("kgs"))
        if ch.meta.has_field("source_dc"):
            ch.source_dc = r.get("matched_dc") or ""
        if ch.meta.has_field("source_arrival"):
            ch.source_arrival = r.get("arrival") or ""
        existing.add(bn)
        added += 1
        tc += flt(r.get("cbm"))
        tt += flt(r.get("mt"))
    if d.meta.has_field("block_count"):
        d.block_count = len(d.get(tf) or [])
    if d.meta.has_field("total_cbm"):
        d.total_cbm = round(tc, 2)
    if d.meta.has_field("total_net_tonnage"):
        d.total_net_tonnage = round(tt, 3)
    if d.meta.has_field("total_net_kgs"):
        d.total_net_kgs = cint(round(tt * 1000))
    d.flags.ignore_mandatory = True
    d.save(ignore_permissions=True)
    frappe.db.commit()
    return {"lot": d.name, "added": added}


@frappe.whitelist()
def mark_lot_shipped(lot=None, vessel=None, ship_date=None, bl_no=None):
    """Mark an Export Shipment Lot as Shipped -> moves it to Exported Shipments.
    Block status cascades to Shipped via the Server Script on save."""
    if not lot:
        frappe.throw("No lot given.")
    d = frappe.get_doc("Export Shipment Lot", lot)
    if d.meta.has_field("status"):
        d.status = "Shipped"
    if d.meta.has_field("shipped"):
        d.shipped = 1
    if vessel and d.meta.has_field("vessel"):
        d.vessel = vessel
    if ship_date:
        if d.meta.has_field("ship_date"):
            d.ship_date = ship_date
        elif d.meta.has_field("shipment_date"):
            d.shipment_date = ship_date
    if bl_no and d.meta.has_field("bl_no"):
        d.bl_no = bl_no
    d.flags.ignore_mandatory = True
    d.save(ignore_permissions=True)
    frappe.db.commit()
    return {"lot": d.name, "status": "Shipped"}


def _xls_tokens(content, file_url=""):
    """Every non-empty cell of an uploaded .xls/.xlsx as a list of string tokens."""
    toks = []
    name = (file_url or "").lower()

    def _num(v):
        try:
            fv = float(v)
            if fv == int(fv):
                return str(int(fv))
            return str(v)
        except Exception:
            return _s(v)

    if not name.endswith(".xlsx"):
        try:
            import xlrd
            wb = xlrd.open_workbook(file_contents=content)
            for sh in wb.sheets():
                for r in range(sh.nrows):
                    for c in range(sh.ncols):
                        v = sh.cell_value(r, c)
                        if v is None or v == "":
                            continue
                        toks.append(_num(v))
            return toks
        except Exception:
            pass
    try:
        import openpyxl, io
        wb = openpyxl.load_workbook(io.BytesIO(content), read_only=True, data_only=True)
        for ws in wb.worksheets:
            for row in ws.iter_rows(values_only=True):
                for v in row:
                    if v is None or v == "":
                        continue
                    toks.append(_num(v))
    except Exception:
        pass
    return toks


@frappe.whitelist()
def import_lot_blocks_xls(lot=None, file_url=None):
    """Read block numbers (quarry OR export) from an uploaded .xls/.xlsx and add
    every matching At-Port block to the given Export Shipment Lot. Uses the same
    lookup/enrichment as the Add Blocks dialog, so system data stays authoritative."""
    if not lot:
        frappe.throw("No lot given.")
    if not file_url:
        frappe.throw("No file uploaded.")
    content = _arrival_file_bytes(file_url)
    if content is None:
        frappe.throw("Uploaded file could not be read.")
    tokens = _xls_tokens(content, file_url)
    if not tokens:
        return {"added": 0, "matched": 0, "not_found": [],
                "message": "No cells could be read from the file."}
    avail = at_port_available(lot)
    by_key = {}
    for b in avail:
        # EXPORT numbers only -- quarry block numbers are intentionally NOT matched
        ex = _s(b.get("export_block_no"))
        if ex:
            by_key[ex] = b
    used = set()
    rows = []
    not_found = []
    seen_tok = set()
    for tok in tokens:
        t = _s(tok)
        if not t or t in seen_tok:
            continue
        seen_tok.add(t)
        b = by_key.get(t)
        if not b:
            if any(ch.isdigit() for ch in t):
                not_found.append(t)
            continue
        bn = _s(b.get("block_no"))
        if bn in used:
            continue
        used.add(bn)
        qb = frappe.db.get_value("Quarry Block", {"block_number": bn},
            ["name", "delivery_challan", "port_net_wt", "gross_tonnage", "tonnage_factor"],
            as_dict=True) or {}
        fac = flt(qb.get("tonnage_factor")) or 2.7
        mt = flt(qb.get("port_net_wt")) or flt(qb.get("gross_tonnage")) or (flt(b.get("cbm")) * fac)
        rows.append({
            "block_no": bn, "quarry_block": qb.get("name"),
            "length": b.get("length"), "width": b.get("width"), "height": b.get("height"),
            "cbm": b.get("cbm"), "mt": mt, "matched_dc": qb.get("delivery_challan") or "",
        })
    if not rows:
        return {"added": 0, "matched": 0, "not_found": not_found[:60],
                "message": "None of the numbers in the file matched an available At-Port block."}
    res = add_blocks_to_lot(lot, rows)
    return {"added": (res or {}).get("added", len(rows)),
            "matched": len(rows), "not_found": not_found[:60]}


def _lot_table_field(d):
    for t in d.meta.get_table_fields():
        return t.fieldname
    return None


@frappe.whitelist()
def create_empty_lot():
    """Create an empty Export Shipment Lot (status Ready); return its name."""
    lot = frappe.new_doc("Export Shipment Lot")
    if lot.meta.has_field("shipment_date"):
        lot.shipment_date = frappe.utils.today()
    if lot.meta.has_field("status"):
        lot.status = "Ready"
    lot.insert(ignore_permissions=True)
    frappe.db.commit()
    return {"name": lot.name}


@frappe.whitelist()
def lot_detail(lot=None):
    """Header + blocks for the lot-detail view."""
    if not lot:
        frappe.throw("No lot given.")
    d = frappe.get_doc("Export Shipment Lot", lot)
    tf = _lot_table_field(d)
    blocks = []
    for r in (d.get(tf) or []):
        blocks.append({
            "block": r.get("block"),
            "block_no": r.get("block_no") or r.get("block"),
            "length": r.get("length"), "width": r.get("width"), "height": r.get("height"),
            "cbm": r.get("cbm"), "grade": r.get("grade"), "source_dc": r.get("source_dc"),
        })
    shipped = (d.get("status") == "Shipped") or bool(d.get("shipped"))
    return {
        "name": d.name, "status": d.get("status"), "shipped": 1 if shipped else 0,
        "vessel": d.get("vessel") or "", "bl_no": d.get("bl_no") or "",
        "ship_date": _s(d.get("shipment_date") or ""),
        "consignee": d.get("export_consignee") or "",
        "shipping_document": d.get("shipping_document") or "",
        "block_count": len(blocks), "blocks": blocks,
    }


@frappe.whitelist()
def remove_lot_block(lot=None, block_no=None):
    """Remove one block from a lot; if shipped, return that block to At Port."""
    if not lot or not block_no:
        frappe.throw("Lot and block required.")
    d = frappe.get_doc("Export Shipment Lot", lot)
    tf = _lot_table_field(d)
    if not tf:
        frappe.throw("Lot has no block table.")
    target = _s(block_no)
    kept, removed_qb = [], None
    for r in (d.get(tf) or []):
        rn = _s(r.get("block_no")) or _s(r.get("block"))
        if rn == target and removed_qb is None:
            removed_qb = r.get("block") or r.get("block_no")
            continue
        kept.append(r)
    d.set(tf, kept)
    d.save(ignore_permissions=True)
    if removed_qb and ((d.get("status") == "Shipped") or bool(d.get("shipped"))):
        if frappe.db.exists("Quarry Block", removed_qb):
            frappe.db.set_value("Quarry Block", removed_qb, "status", "At Port")
    frappe.db.commit()
    return {"name": d.name, "removed": target}


@frappe.whitelist()
def reopen_lot(lot=None):
    """Reopen a shipped lot: status back to Ready and its blocks back to At Port."""
    if not lot:
        frappe.throw("No lot given.")
    d = frappe.get_doc("Export Shipment Lot", lot)
    tf = _lot_table_field(d)
    if d.meta.has_field("status"):
        d.status = "Ready"
    if d.meta.has_field("shipped"):
        d.shipped = 0
    d.save(ignore_permissions=True)
    for r in (d.get(tf) or []):
        qb = r.get("block") or r.get("block_no")
        if qb and frappe.db.exists("Quarry Block", qb):
            frappe.db.set_value("Quarry Block", qb, "status", "At Port")
    frappe.db.commit()
    return {"name": d.name, "status": "Ready"}


@frappe.whitelist()
def link_shipping_document(lot=None, shipping_document=None):
    """Link an existing Shipping Document to a lot."""
    if not lot:
        frappe.throw("No lot given.")
    d = frappe.get_doc("Export Shipment Lot", lot)
    if not d.meta.has_field("shipping_document"):
        frappe.throw("Lot has no shipping_document field.")
    d.shipping_document = shipping_document or None
    d.save(ignore_permissions=True)
    frappe.db.commit()
    return {"name": d.name, "shipping_document": d.get("shipping_document") or ""}


@frappe.whitelist()
def list_shipping_documents():
    """Recent Shipping Documents for the link picker."""
    rows = frappe.get_all("Shipping Document", fields=["name"], order_by="creation desc", limit_page_length=50)
    out = []
    for r in rows:
        d = frappe.db.get_value("Shipping Document", r.name, ["export_consignee", "shipment_date", "vessel"], as_dict=True) or {}
        out.append({"name": r.name, "consignee": (d.get("export_consignee") or ""), "date": _s(d.get("shipment_date") or ""), "vessel": (d.get("vessel") or "")})
    return out


@frappe.whitelist()
def at_port_available(lot=None):
    """At-Port blocks not already in any lot - for the in-lot Add picker."""
    names = frappe.get_all("Quarry Block", filters={"status": "At Port"},
        fields=["name", "block_number", "export_block_no", "granite_quality_grade",
                "length_gross", "width_gross", "height_gross", "gross_volume"],
        limit_page_length=0)
    in_lot = set()
    for lb in frappe.get_all("Shipment Lot Block", fields=["block_no", "block"], limit_page_length=0):
        for k in (lb.get("block_no"), lb.get("block")):
            if k:
                in_lot.add(_s(k))
    out = []
    for b in names:
        bn = _s(b.get("block_number") or b.get("name") or "")
        if not bn or bn in in_lot:
            continue
        out.append({"block_no": bn, "export_block_no": b.get("export_block_no") or "",
            "grade": b.get("granite_quality_grade") or "", "length": b.get("length_gross"),
            "width": b.get("width_gross"), "height": b.get("height_gross"), "cbm": b.get("gross_volume")})
    return out


@frappe.whitelist()
def xls_source():
    """Imported arrival files as XLS sources with provenance: 'email' when the
    arrival carries an arrivals-inbox sender/subject, else 'direct' import."""
    meta = frappe.get_meta("Port Arrival")
    def has(f):
        return meta.has_field(f)
    fields = ["name", "arrival_date", "creation", "total_blocks"]
    for f in ("source_file", "source_sheet", "email_subject", "email_sender",
              "mark", "shipper", "total_cbm", "total_net_wt"):
        if has(f):
            fields.append(f)
    out = []
    for a in frappe.get_all("Port Arrival", fields=fields,
                            order_by="creation desc", limit_page_length=0):
        sender = a.get("email_sender") or ""
        subject = a.get("email_subject") or ""
        provenance = "email" if (sender or subject) else "direct"
        out.append({
            "arrival": a.name,
            "file": a.get("source_file") or "",
            "sheet": a.get("source_sheet") or "",
            "rows": a.get("total_blocks") or 0,
            "mark": a.get("mark") or "",
            "sender": sender,
            "subject": subject,
            "provenance": provenance,
            "date": str(a.get("arrival_date") or a.get("creation") or "")[:10],
            "cbm": a.get("total_cbm") or 0,
            "net_wt": a.get("total_net_wt") or 0,
        })
    return out



def _arrival_file_bytes(url):
    """Bytes of a stored File by its file_url, private or public."""
    if not url:
        return None
    try:
        fdoc = frappe.get_doc("File", {"file_url": url})
        return fdoc.get_content()
    except Exception:
        pass
    try:
        from frappe.utils.file_manager import get_file
        return get_file(url)[1]
    except Exception:
        return None


@frappe.whitelist()
def arrival_xls_grid(arrival=None, max_rows=5000):
    """Raw source sheet as the carrier sent it -- full grid of cell values PLUS
    each cell's original fill colour (when the .xls carries formatting), so the
    inline viewer looks like the shipping-agency file. Per-row parse tags are
    still returned for the parsed/skipped legend."""
    if not arrival:
        return {}
    pa = frappe.get_doc("Port Arrival", arrival)
    src = getattr(pa, "source_file", None) or ""
    if not src:
        return {"error": "No source file stored on this arrival."}
    content = _arrival_file_bytes(src)
    if content is None:
        return {"error": "Source file not found: " + src}
    try:
        import xlrd
    except Exception:
        return {"error": "xlrd not installed on this bench."}
    fmt = True
    try:
        wb = xlrd.open_workbook(file_contents=content, formatting_info=True)
    except Exception:
        fmt = False
        try:
            wb = xlrd.open_workbook(file_contents=content)
        except Exception as e:
            return {"error": "Could not read sheet: " + str(e)}

    def _bg(sh, r, c):
        if not fmt:
            return ""
        try:
            xf = wb.xf_list[sh.cell_xf_index(r, c)]
            if xf.background.fill_pattern != 1:
                return ""
            rgb = wb.colour_map.get(xf.background.pattern_colour_index)
            if not rgb:
                return ""
            return "#%02x%02x%02x" % rgb
        except Exception:
            return ""

    single = wb.nsheets == 1
    grid, tags, colors, used, hr = [], [], [], None, None
    for sh in wb.sheets():
        if not _xls_is_dolphin_sheet(sh, single):
            continue
        hr, cm = _xls_header(sh)
        bcol = cm.get("block_no") if cm else None
        used = sh.name
        n = min(int(max_rows), sh.nrows)
        for r in range(n):
            row = [_xls_s(sh.cell_value(r, c)) for c in range(sh.ncols)]
            grid.append(row)
            colors.append([_bg(sh, r, c) for c in range(sh.ncols)])
            if hr is None or r == hr:
                tag = "head"
            elif r < hr:
                tag = "pre"
            else:
                bno = _xls_s(sh.cell_value(r, bcol)) if bcol is not None else ""
                joined = " ".join(str(x).lower() for x in row)
                if not bno or not _re.search(r"\d", bno):
                    tag = "skip"
                elif "total" in joined:
                    tag = "skip"
                else:
                    tag = "parsed"
            tags.append(tag)
        break
    return {
        "sheet": used,
        "grid": grid,
        "tags": tags,
        "colors": colors,
        "has_colors": fmt,
        "header_row": hr,
        "file": src,
        "counts": {"parsed": tags.count("parsed"), "skipped": tags.count("skip")},
    }



@frappe.whitelist()
def sync_arrivals_email():
    """Manually pull incoming email accounts on demand (Check new mail)."""
    n = 0
    try:
        for ea in frappe.get_all("Email Account", filters={"enable_incoming": 1}, pluck="name"):
            try:
                frappe.get_doc("Email Account", ea).receive()
                n += 1
            except Exception:
                frappe.log_error(frappe.get_traceback(), "sync_arrivals_email")
    except Exception:
        frappe.log_error(frappe.get_traceback(), "sync_arrivals_email")
    return {"accounts": n}


@frappe.whitelist()
def reparse_arrival(arrival=None):
    """Re-run the parser on an arrival's stored .xls and refresh its blocks in place."""
    if not arrival:
        return {"error": "No arrival."}
    pa = frappe.get_doc("Port Arrival", arrival)
    src = getattr(pa, "source_file", None) or ""
    if not src:
        return {"error": "No source file on this arrival."}
    content = _arrival_file_bytes(src)
    if content is None:
        return {"error": "Source file not found."}
    rows, sheet = _parse_arrival_xls(content)
    existing = {}
    for b in pa.blocks:
        existing[str(b.block_no)] = b.name
    updated, new = 0, 0
    fields = ("mark", "cbm", "weight", "length", "width", "height",
              "vehicle_no", "yard_location", "line_no", "ado_no", "permit_no")
    for row in rows:
        bno = str(row.get("block_no") or "").strip()
        if not bno:
            continue
        if bno in existing:
            vals = {}
            for f in fields:
                v = row.get(f)
                if v is not None:
                    vals[f] = v
            if vals:
                frappe.db.set_value("Port Arrival Block", existing[bno], vals, update_modified=False)
            updated += 1
        else:
            new += 1
    frappe.db.commit()
    return {"updated": updated, "new": new, "total": len(rows), "sheet": sheet}


@frappe.whitelist()
def export_arrival_xls(arrival=None):
    """Download a Port Arrival's blocks as an .xlsx."""
    if not arrival:
        frappe.throw("No arrival.")
    import openpyxl, io
    pa = frappe.get_doc("Port Arrival", arrival)
    wb = openpyxl.Workbook(); ws = wb.active; ws.title = "Blocks"
    cols = ["block_no", "length", "width", "height", "cbm", "weight", "mark", "matched_dc", "recon_status"]
    ws.append([c.upper() for c in cols])
    for b in pa.blocks:
        ws.append([b.get(c) for c in cols])
    buf = io.BytesIO(); wb.save(buf)
    frappe.response["filename"] = (arrival or "arrival") + ".xlsx"
    frappe.response["filecontent"] = buf.getvalue()
    frappe.response["type"] = "download"


@frappe.whitelist()
def export_doc_blocks_xls(doctype=None, name=None):
    """Download a document's block/row child table as .xlsx (QI/BI/DC)."""
    if not doctype or not name:
        frappe.throw("doctype and name required.")
    import openpyxl, io
    doc = frappe.get_doc(doctype, name)
    meta = frappe.get_meta(doctype)
    tf = None
    for df in meta.get_table_fields():
        fn = (df.fieldname or "").lower()
        if "block" in fn or "row" in fn:
            tf = df.fieldname
            break
    if not tf and meta.get_table_fields():
        tf = meta.get_table_fields()[0].fieldname
    rows = doc.get(tf) if tf else []
    wb = openpyxl.Workbook(); ws = wb.active; ws.title = doctype[:31]
    if rows:
        cmeta = frappe.get_meta(rows[0].doctype)
        cols = [f.fieldname for f in cmeta.fields
                if f.fieldtype not in ("Section Break", "Column Break", "HTML", "Button")][:20]
        ws.append([c.upper() for c in cols])
        for r in rows:
            ws.append([r.get(c) for c in cols])
    buf = io.BytesIO(); wb.save(buf)
    frappe.response["filename"] = str(name) + ".xlsx"
    frappe.response["filecontent"] = buf.getvalue()
    frappe.response["type"] = "download"



def _export_map():
    """quarry block_number -> export_block_no, for port displays."""
    m = {}
    try:
        for qb in frappe.get_all("Quarry Block",
                                 fields=["block_number", "export_block_no"],
                                 limit_page_length=0):
            k = str(qb.block_number or "").strip()
            v = str(qb.export_block_no or "").strip()
            if k and v:
                m[k] = v
    except Exception:
        pass
    return m
