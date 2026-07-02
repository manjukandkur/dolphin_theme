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
                    picked.append(str(bn).strip())
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
    """Place DC-submitted 'awaiting arrival' blocks At Port without an arrival file
    (the 'skip the double-check' path). Writes into a single reusable DRAFT Port
    Arrival so it is easy to review / undo. Idempotent by block number."""
    if isinstance(blocks, str):
        blocks = _json.loads(blocks)
    blocks = blocks or []
    if not blocks:
        frappe.throw("No blocks supplied to move.")

    label = "AT-PORT (skipped arrivals)"
    tname = frappe.db.get_value(
        "Port Arrival", {"mark": label, "docstatus": 0}, "name"
    )
    if tname:
        pa = frappe.get_doc("Port Arrival", tname)
    else:
        pa = frappe.new_doc("Port Arrival")
        if pa.meta.has_field("mark"):
            pa.mark = label
        if pa.meta.has_field("arrival_date"):
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

    if pa.meta.has_field("total_blocks"):
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
                "cbm", "net_wt", "recon_status", "match_status"],
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

    dcs = {x.name: x for x in frappe.get_all(
        "Delivery Challan", filters={"docstatus": 1},
        fields=["name", "export_consignee", "shipping_mark"])}

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
                "state": state, "source": "dc",
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
            "state": state, "source": "arrival",
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
def resolve_block(arrival=None, block_no=None, action="accept", dc=None):
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
    else:
        updates["recon_status"] = "Resolved"

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
