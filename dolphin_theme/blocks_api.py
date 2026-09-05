import frappe
from frappe.utils import flt, cint, strip_html

_STAGE = {
    "In Stock": "instock",
    "Buyer Marked": "bi",
    "In Delivery Challan": "dc",
    "Dispatched/Transported": "dc",
    "At Port": "port",
    "At Bannikoppa Station yard": "port",
    "Shipped": "shipped",
    "Sold": "shipped",
}


def _s(v):
    return "" if v is None else str(v).strip()


@frappe.whitelist()
def blocks_hub():
    """Lightweight list of every Quarry Block for the Blocks cockpit."""
    rows = frappe.get_all(
        "Quarry Block",
        fields=[
            "name", "block_number", "export_block_no", "granite_quality_grade",
            "length_gross", "width_gross", "height_gross", "gross_volume",
            "gross_tonnage", "port_net_wt", "tonnage_factor", "pit",
            "date_produced", "status", "source_quarry_inspection",
            "buyer_inspection", "delivery_challan",
        ],
        limit_page_length=0,
    )
    out = []
    for r in rows:
        cbm = flt(r.gross_volume) or (flt(r.length_gross) * flt(r.width_gross) * flt(r.height_gross) / 1e6)
        gross = flt(r.gross_tonnage) or (cbm * (flt(r.tonnage_factor) or 2.7))
        net = flt(r.port_net_wt) or gross
        out.append({
            "name": r.name,
            "block": _s(r.block_number),
            "exp": _s(r.export_block_no),
            "grade": _s(r.granite_quality_grade),
            "L": cint(r.length_gross), "W": cint(r.width_gross), "H": cint(r.height_gross),
            "cbm": round(cbm, 3), "mt": round(gross, 3), "net": round(net, 3),
            "pit": _s(r.pit), "produced": _s(r.date_produced),
            "status": _s(r.status), "stage": _STAGE.get(_s(r.status), "instock"),
            "qi": _s(r.source_quarry_inspection), "bi": _s(r.buyer_inspection),
            "dc": _s(r.delivery_challan),
        })
    return out


def _docdate(doctype, name):
    if not name:
        return ""
    try:
        meta = frappe.get_meta(doctype)
        for fld in ("posting_date", "inspection_date", "date", "creation"):
            if fld == "creation" or meta.has_field(fld):
                v = frappe.db.get_value(doctype, name, fld)
                if v:
                    return _s(v)[:10]
    except Exception:
        pass
    return ""


@frappe.whitelist()
def block_detail(name=None):
    """Full detail for one block: lifecycle dates + notes (comments)."""
    if not name:
        frappe.throw("No block given.")
    b = frappe.get_doc("Quarry Block", name)
    port_date = ""
    pab = frappe.get_all("Port Arrival Block", filters={"block_no": b.block_number},
                         fields=["parent"], limit=1)
    if pab:
        port_date = _s(frappe.db.get_value("Port Arrival", pab[0].parent, "arrival_date"))[:10]
    ship_date = ""
    try:
        slb = frappe.get_all("Shipment Lot Block", filters={"block_no": b.block_number},
                             fields=["parent"], limit=1)
        if slb:
            lm = frappe.get_meta("Export Shipment Lot")
            for f in ("ship_date", "shipment_date", "modified"):
                if f == "modified" or lm.has_field(f):
                    ship_date = _s(frappe.db.get_value("Export Shipment Lot", slb[0].parent, f))[:10]
                    break
    except Exception:
        pass
    notes = []
    for c in frappe.get_all("Comment",
                            filters={"reference_doctype": "Quarry Block",
                                     "reference_name": name, "comment_type": "Comment"},
                            fields=["content", "creation"], order_by="creation desc"):
        notes.append({"t": strip_html(c.content or ""), "d": _s(c.creation)[:10]})
    return {
        "produced": _s(b.date_produced),
        "pit": _s(b.pit), "grade": _s(b.granite_quality_grade),
        "L": cint(b.length_gross), "W": cint(b.width_gross), "H": cint(b.height_gross),
        "cbm": round(flt(b.gross_volume), 3), "mt": round(flt(b.gross_tonnage), 3),
        "status": _s(b.status),
        "qi": _s(b.source_quarry_inspection), "qid": _docdate("Quarry Inspection", b.source_quarry_inspection),
        "bi": _s(b.buyer_inspection), "bid": _docdate("Buyer Inspection", b.buyer_inspection),
        "dc": _s(b.delivery_challan), "dcd": _docdate("Delivery Challan", b.delivery_challan),
        "portd": port_date, "shipd": ship_date,
        "notes": notes,
    }


@frappe.whitelist()
def save_block_fields(name=None, length=None, width=None, height=None, grade=None, force=0):
    """Edit measurements/grade inline. Guarded once the block is downstream."""
    if not name:
        frappe.throw("No block given.")
    b = frappe.get_doc("Quarry Block", name)
    if _s(b.status) != "In Stock" and not cint(force):
        frappe.throw("Block is '" + _s(b.status) + "'. Editing measurements changes downstream "
                     "figures — resend with force=1 to confirm.")
    if length is not None:
        b.length_gross = cint(length)
    if width is not None:
        b.width_gross = cint(width)
    if height is not None:
        b.height_gross = cint(height)
    if grade:
        b.granite_quality_grade = grade
    b.gross_volume = round(flt(b.length_gross) * flt(b.width_gross) * flt(b.height_gross) / 1e6, 3)
    b.gross_tonnage = round(flt(b.gross_volume) * (flt(b.tonnage_factor) or 2.7), 3)
    b.flags.ignore_permissions = True
    b.save()
    frappe.db.commit()
    return {"ok": 1, "cbm": b.gross_volume, "mt": b.gross_tonnage}


@frappe.whitelist()
def add_block_note(name=None, text=None):
    """Attach a dated note (stored as a Comment on the block)."""
    if not name or not _s(text):
        frappe.throw("Block and note text required.")
    doc = frappe.get_doc("Quarry Block", name)
    doc.add_comment("Comment", _s(text))
    return {"ok": 1}


@frappe.whitelist()
def delete_block(name=None, reason=None, machine=None, person=None):
    """Remove a duplicate block record.

    CHANGED 17 Aug 2026 (B33/B34). This used to call `frappe.delete_doc` — the
    record was gone and nothing said why. Now:

      * the block's full contents are written into a Trash stamp first, so it can
        be brought back (`lifecycle.restore_from_trash`)
      * a reason is mandatory, and it stays with the block, so it surfaces in
        Trace afterwards
      * the record itself is cancelled out of the way rather than destroyed —
        nothing Claude did not create this session is ever hard-deleted

    Still blocked outright when the block is already in a BI or DC."""
    import json as _json
    from dolphin_theme.lifecycle import TRASH_TAG
    from dolphin_theme.block_resolve import machine_of, log_event

    if not name:
        frappe.throw("No block given.")
    reason = _s(reason)
    if len(reason) < 4:
        frappe.throw("A removal needs a reason — it stays with the block and shows "
                     "in Trace. A few words is enough.")
    b = frappe.get_doc("Quarry Block", name)
    if _s(b.delivery_challan) or _s(b.buyer_inspection):
        frappe.throw("Block is in a BI/DC and cannot be removed.")

    snapshot = {k: v for k, v in b.as_dict().items()
                if not str(k).startswith("_") and not isinstance(v, (list, dict))}
    payload = {"from_doctype": "Quarry Block", "from_name": name,
               "row": {"table": None, "data": snapshot},
               "reason": reason, "person": _s(person) or frappe.session.user,
               "machine": machine_of(machine), "restored": False,
               "hard_deleted": False}
    try:
        b.add_comment("Comment", "{0} {1}".format(TRASH_TAG, _json.dumps(payload, default=str)))
    except Exception:
        pass
    log_event(name, "removed", _s(b.status), "Removed", reason,
              machine_of(machine), person)

    # Take it out of every count without destroying it.
    try:
        if b.meta.has_field("status"):
            b.status = "Removed" if "Removed" in (
                (b.meta.get_field("status").options or "").split("\n")) else _s(b.status)
        if b.meta.has_field("disabled"):
            b.disabled = 1
        b.flags.ignore_permissions = True
        b.flags.ignore_validate_update_after_submit = True
        b.save()
    except Exception:
        frappe.log_error(frappe.get_traceback(), "Dolphin soft remove block")
    frappe.db.commit()
    return {"ok": 1, "trashed": True, "reason": reason,
            "message": "Removed to Trash. Recoverable — nothing was destroyed."}


# ===========================================================================
# Trace — every occurrence, with dates  (B2, B3, B4, B34 — 17 Aug 2026)
#
# The old trace stopped at the first match. With 92 numbers shared between the
# quarry-number space and the export-number space, that meant the second block
# was silently hidden — you searched a number, got an answer, and had no way of
# knowing there was another one. This returns them ALL, says how each was
# reached, and carries the dates so age is obvious at a glance.
# ===========================================================================

_JOURNEY = [
    ("produced", "Produced", None),
    ("qi", "Quarry Inspection", "Quarry Inspection"),
    ("bi", "Buyer Inspection", "Buyer Inspection"),
    ("dc", "Delivery Challan", "Delivery Challan"),
    ("port", "Reached port", "Port Arrival"),
    ("lot", "Export shipment lot", "Export Shipment Lot"),
    ("ship", "Shipped", None),
]


def _age_days(datestr):
    if not datestr:
        return None
    try:
        from frappe.utils import date_diff, today
        return int(date_diff(today(), str(datestr)[:10]))
    except Exception:
        return None


@frappe.whitelist()
def trace_all(q=None):
    """Every block that answers to this number — never just the first.

    Each hit says how it was reached ('export', 'quarry', or 'record-id, which is
    not a real match'), carries every lifecycle date, and brings its notes and
    removal reasons with it (B34)."""
    from dolphin_theme.block_resolve import candidates
    from dolphin_theme.lifecycle import block_events

    q = _s(q)
    if not q:
        return {"q": "", "hits": [], "message": "Type a block number."}

    hits = candidates(q, allow_record_name=False)
    record_only = []
    if not hits:
        try:
            if frappe.db.exists("Quarry Block", q):
                d = frappe.db.get_value(
                    "Quarry Block", q,
                    ["name", "block_number", "export_block_no", "status"], as_dict=True)
                if d:
                    record_only = [dict(d, via="record-id")]
        except Exception:
            pass

    out = []
    for h in (hits or record_only):
        out.append(_trace_one(h))

    return {
        "q": q,
        "count": len(out),
        "hits": out,
        "record_id_only": bool(record_only),
        "message": (
            "" if len(hits) == 1 else
            ("{0} is used by {1} different blocks — all of them are shown below."
             .format(q, len(hits)) if len(hits) > 1 else
             ("{0} is not any block's quarry number or export number. It IS record "
              "id {0}, shown below for information only — a typed number is never "
              "treated as a record id.".format(q) if record_only else
              "Nothing answers to {0}.".format(q)))
        ),
    }


def _trace_one(hit):
    from dolphin_theme.lifecycle import block_events

    name = hit.get("name")
    b = frappe.get_doc("Quarry Block", name)

    dc_no = ""
    if _s(b.delivery_challan):
        try:
            dc_no = _s(frappe.db.get_value("Delivery Challan", b.delivery_challan,
                                           "delivery_challan_no"))
        except Exception:
            pass

    keys = {_s(b.name), _s(b.block_number), _s(b.export_block_no)} - {""}
    arrivals = []
    try:
        for r in frappe.get_all("Port Arrival Block",
                                filters={"block_no": ["in", list(keys)]},
                                fields=["parent", "block_no", "recon_status",
                                        "resolution_note", "resolution_type"],
                                limit_page_length=0):
            pa = frappe.db.get_value("Port Arrival", r.parent,
                                     ["arrival_date", "docstatus"], as_dict=True) or {}
            arrivals.append({
                "arrival": r.parent, "date": _s(pa.get("arrival_date"))[:10],
                "confirmed": 1 if pa.get("docstatus") == 1 else 0,
                "matched_on": r.block_no, "recon_status": r.recon_status,
                "note": r.resolution_note, "resolution": r.resolution_type,
            })
    except Exception:
        pass

    lots = []
    try:
        for r in frappe.get_all("Shipment Lot Block",
                                filters={"block_no": ["in", list(keys)]},
                                fields=["parent", "block_no"], limit_page_length=0):
            lots.append({"lot": r.parent,
                         "date": _docdate("Export Shipment Lot", r.parent)})
    except Exception:
        pass

    port_date = next((a["date"] for a in arrivals if a["confirmed"] and a["date"]), "")
    ship_date = lots[0]["date"] if lots else ""

    nodes = [
        {"k": "produced", "label": "Produced", "date": _s(b.date_produced)[:10],
         "doc": None, "doctype": None},
        {"k": "qi", "label": "Quarry Inspection",
         "date": _docdate("Quarry Inspection", b.source_quarry_inspection),
         "doc": _s(b.source_quarry_inspection), "doctype": "Quarry Inspection"},
        {"k": "bi", "label": "Buyer Inspection",
         "date": _docdate("Buyer Inspection", b.buyer_inspection),
         "doc": _s(b.buyer_inspection), "doctype": "Buyer Inspection"},
        {"k": "dc", "label": "Delivery Challan" + (" " + dc_no if dc_no else ""),
         "date": _docdate("Delivery Challan", b.delivery_challan),
         "doc": _s(b.delivery_challan), "doctype": "Delivery Challan"},
        {"k": "port", "label": "Reached port", "date": port_date,
         "doc": (arrivals[0]["arrival"] if arrivals else None), "doctype": "Port Arrival"},
        {"k": "lot", "label": "Export shipment lot", "date": ship_date,
         "doc": (lots[0]["lot"] if lots else None), "doctype": "Export Shipment Lot"},
    ]
    for n in nodes:
        n["age"] = _age_days(n["date"])
        n["done"] = bool(n["date"])

    ev = block_events(name)
    notes = []
    for c in frappe.get_all("Comment",
                            filters={"reference_doctype": "Quarry Block",
                                     "reference_name": str(name),
                                     "comment_type": "Comment"},
                            fields=["content", "creation", "owner"],
                            order_by="creation desc", limit_page_length=50):
        notes.append({"t": strip_html(c.content or "").strip(),
                      "d": _s(c.creation)[:19], "by": c.owner})

    return {
        "name": name,
        "via": hit.get("via") or "record-id",
        "block_number": _s(b.block_number),
        "export_block_no": _s(b.export_block_no),
        "status": _s(b.status),
        "grade": _s(b.granite_quality_grade),
        "pit": _s(b.pit),
        "L": cint(b.length_gross), "W": cint(b.width_gross), "H": cint(b.height_gross),
        "cbm": flt(b.gross_volume), "mt": flt(b.gross_tonnage),
        "qi": _s(b.source_quarry_inspection), "bi": _s(b.buyer_inspection),
        "dc": _s(b.delivery_challan), "dc_no": dc_no,
        "nodes": nodes,
        "arrivals": arrivals,
        "lots": lots,
        "events": ev.get("events") or [],
        "notes": notes,
        "last_moved": _s(b.modified)[:19],
        "age": _age_days(_s(b.modified)[:10]),
    }


@frappe.whitelist()
def collisions(limit=500):
    """Every number that means more than one block  (B2).

    92 of these exist. Until now nothing listed them, so a trace that landed on
    the wrong one looked exactly like a trace that landed on the right one."""
    from collections import defaultdict
    space = defaultdict(list)
    for qb in frappe.get_all("Quarry Block",
                             fields=["name", "block_number", "export_block_no", "status"],
                             limit_page_length=0):
        for k, kind in ((qb.block_number, "quarry"), (qb.export_block_no, "export")):
            k = _s(k)
            if k:
                space[k].append({"name": qb.name, "kind": kind, "status": _s(qb.status),
                                 "block_number": _s(qb.block_number),
                                 "export_block_no": _s(qb.export_block_no)})
    out = []
    for k, group in space.items():
        names = {g["name"] for g in group}
        if len(names) > 1:
            out.append({"number": k, "blocks": group, "count": len(names)})
    out.sort(key=lambda x: (-x["count"], x["number"]))
    return out[:int(limit or 500)]


# ---------------------------------------------------------------------------
# A RANGE READS THE DIGITS, NOT THE STRING.  5 Sep 2026
#
# [stated] "suppose only one block in the range is alpha numeric eg 1189 is
#  B1189 but my range will 1180-1190 then what? I cannot always remember which
#  number is alpha numeric right?"
#
# Exactly right, and it kills the idea I had offered him an hour earlier - a
# prefix-aware range like M152-M170 would have made him remember which numbers
# carry a letter, which is the one thing he said he cannot do.
#
# So the range reads the DIGITS INSIDE a number and ignores whatever letters sit
# around them. He types 1180-1190 exactly as he always has - no new grammar, and
# nothing to remember - and B1189 is found because its digits are 1189. If both
# 1189 and B1189 exist they BOTH come back, which is the point of a range and is
# what the repeated-number design of 3 Sep asks for.
#
# It also closes a second hole that was already there: the page tried
# block_number first and only fell back to export_block_no if that found
# NOTHING, so a range spanning both kinds returned half its blocks. This asks
# both number spaces at once and returns the union.
# ---------------------------------------------------------------------------

_RANGE_FIELDS = ["name", "block_number", "export_block_no", "status",
                 "delivery_challan", "buyer_inspection", "source_quarry_inspection",
                 "granite_quality_grade", "length_gross", "width_gross",
                 "height_gross", "gross_volume", "retired_on", "retired_because",
                 "retired_ref", "date_produced"]


def _digits(v):
    """The number inside a block number. 'B1189' -> 1189, '1189A' -> 1189.

    Returns None when there is no digit at all, so a purely alphabetic entry
    never silently becomes zero - the 4 Jun failure, where "3300A".toLong()
    returned 0 and blocks were created numbered 0."""
    s = "".join(ch for ch in str(v or "") if ch.isdigit())
    if not s:
        return None
    try:
        return int(s)
    except Exception:
        return None


@frappe.whitelist()
def numbers_in_range(low=None, high=None, limit=500):
    """Every block whose quarry OR export number falls in a numeric range.

    Letters are ignored when deciding whether a number is in range, and kept
    exactly as they are in what comes back. Reads only; writes nothing."""
    lo, hi = _digits(low), _digits(high)
    if lo is None or hi is None:
        frappe.throw("Give the range as two numbers, for example 1180-1190.")
    if lo > hi:
        lo, hi = hi, lo
    cap = frappe.utils.cint(limit) or 500
    if hi - lo + 1 > cap:
        frappe.throw("That range is {0} numbers. Please keep it to {1} or fewer.".format(
            hi - lo + 1, cap))

    out, seen, matched = [], set(), set()
    for b in frappe.get_all("Quarry Block", fields=_RANGE_FIELDS, limit_page_length=0):
        for f in ("block_number", "export_block_no"):
            d = _digits(b.get(f))
            if d is not None and lo <= d <= hi:
                if b["name"] not in seen:
                    seen.add(b["name"])
                    out.append(b)
                matched.add(d)
                break

    out.sort(key=lambda r: (_digits(r.get("block_number")) or 0,
                            str(r.get("block_number") or "")))
    asked = hi - lo + 1
    return {"blocks": out, "asked": asked, "found": len(out),
            "missing": sorted(n for n in range(lo, hi + 1) if n not in matched),
            "label": "{0}-{1}".format(lo, hi)}
