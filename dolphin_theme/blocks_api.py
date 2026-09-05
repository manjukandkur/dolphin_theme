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


# ---------------------------------------------------------------------------
# WHAT IS ALREADY TAKEN.  5 Sep 2026
#
# His screenshot of "Add Blocks from Quarry Inspection": 110 blocks, every one
# pre-ticked, no status anywhere - so pressing Add Selected pulls in stone that
# has already gone to a challan, a lot, or another inspection, and nothing on
# the screen warns anybody. He asked for status shown, the taken ones dimmed,
# and none of them pre-ticked.
#
# Read-only. It answers one question per number: can this block still be taken,
# and if not, where has it gone.
# ---------------------------------------------------------------------------

@frappe.whitelist()
def taken_status(numbers=None, exclude=None):
    """For each block number: its status, where it sits, and whether it is free.

    `exclude` is the Buyer Inspection being added to, so its own rows do not
    count as "already on an inspection"."""
    if isinstance(numbers, str):
        try:
            numbers = frappe.parse_json(numbers)
        except Exception:
            numbers = [n.strip() for n in numbers.split(",") if n.strip()]
    keys = [str(n).strip() for n in (numbers or []) if str(n).strip()]
    if not keys:
        return {"ok": True, "blocks": {}}

    out = {}
    rows = []
    try:
        rows = frappe.get_all(
            "Quarry Block",
            filters={"block_number": ["in", keys]},
            fields=["name", "block_number", "export_block_no", "status",
                    "delivery_challan", "retired_on"],
            limit_page_length=0) or []
    except Exception:
        frappe.log_error(frappe.get_traceback(), "Dolphin taken_status")

    by_name = {}
    for r in rows:
        by_name[str(r["name"])] = r

    # where each one already appears
    def _members(child, parent_dt, field="block"):
        seen = {}
        try:
            for r in frappe.get_all(child,
                                    filters={"parenttype": parent_dt,
                                             field: ["in", list(by_name.keys())]},
                                    fields=[field, "parent"],
                                    limit_page_length=0) or []:
                seen.setdefault(str(r.get(field)), []).append(r["parent"])
        except Exception:
            pass
        return seen

    on_bi = _members("Buyer Inspection Block", "Buyer Inspection")
    on_lot = _members("Shipment Lot Block", "Export Shipment Lot")
    on_ship = _members("Shipping Block", "Shipping Document")
    skip = str(exclude or "")

    for r in rows:
        nm, no = str(r["name"]), _s(r.get("block_number"))
        status = _s(r.get("status")) or "(none)"
        where, taken = [], False

        if _s(r.get("retired_on")):
            where.append("retired")
            taken = True
        if status and status != "In Stock":
            taken = True
        if _s(r.get("delivery_challan")):
            where.append("challan " + _s(r.get("delivery_challan")))
            taken = True
        for p in on_lot.get(nm, []):
            where.append("lot " + str(p))
            taken = True
        for p in on_ship.get(nm, []):
            where.append("shipping " + str(p))
            taken = True
        for p in on_bi.get(nm, []):
            if str(p) == skip:
                continue
            where.append("inspection " + str(p))
            taken = True

        out[no] = {"record": nm, "quarry_no": no,
                   "export_no": _s(r.get("export_block_no")),
                   "status": status, "taken": bool(taken),
                   "where": ", ".join(where[:3])}

    for k in keys:
        if k not in out:
            out[k] = {"record": None, "quarry_no": k, "export_no": "",
                      "status": "not found", "taken": False, "where": ""}
    return {"ok": True, "blocks": out,
            "free": sum(1 for v in out.values() if not v["taken"]),
            "taken": sum(1 for v in out.values() if v["taken"])}


# ---------------------------------------------------------------------------
# ONLY THE INSPECTIONS THAT STILL HAVE SOMETHING.  5 Sep 2026
#
# [stated] "only the active ones either with all the blocks or partly available
#  in QI should be displayed under BI.. what is the point in showging QI wherein
#  all blocks are taken?"
#
# None at all. The picker listed every quarry inspection ever made, including
# the ones whose stone has already gone, so a person scrolls past sheets that
# can give them nothing. This lists an inspection only while it still has a free
# block, and says how many - "14 of 40 free" - so the choice is made before the
# dialog is even opened.
# ---------------------------------------------------------------------------

def _free_counts(names=None):
    """Per quarry inspection: how many of its blocks are still free.

    Free means the block exists, is In Stock, is not retired, is on no challan,
    no lot, no shipping document and no other buyer inspection."""
    out = {}
    try:
        rows = frappe.get_all(
            "Quarry Inspection Block",
            filters=({"parenttype": "Quarry Inspection", "parent": ["in", names]}
                     if names else {"parenttype": "Quarry Inspection"}),
            fields=["parent", "quarry_block_no", "block"], limit_page_length=0) or []
    except Exception:
        frappe.log_error(frappe.get_traceback(), "Dolphin _free_counts rows")
        return out
    if not rows:
        return out

    numbers = sorted({_s(r.get("quarry_block_no")) for r in rows if _s(r.get("quarry_block_no"))})
    status = taken_status(numbers=numbers).get("blocks", {}) if numbers else {}

    for r in rows:
        p = _s(r.get("parent"))
        if not p:
            continue
        d = out.setdefault(p, {"total": 0, "free": 0})
        d["total"] += 1
        info = status.get(_s(r.get("quarry_block_no")))
        # a row whose block was never created is still something to inspect
        if not info or not info.get("taken"):
            d["free"] += 1
    return out


@frappe.whitelist()
def inspections_with_free_blocks(doctype=None, txt=None, searchfield=None,
                                 start=0, page_len=50, filters=None):
    """Link-field query: quarry inspections that still have a free block.

    Returns [name, "<report no> · N of M free"] so the count is visible in the
    dropdown itself. An inspection with nothing left is not listed at all."""
    txt = _s(txt)
    try:
        qis = frappe.get_all("Quarry Inspection",
                             fields=["name", "report_no", "report_date"],
                             order_by="report_date desc, creation desc",
                             limit_page_length=0) or []
    except Exception:
        frappe.log_error(frappe.get_traceback(), "Dolphin inspections_with_free_blocks")
        return []

    if txt:
        low = txt.lower()
        qis = [q for q in qis
               if low in _s(q.get("name")).lower() or low in _s(q.get("report_no")).lower()]

    counts = _free_counts([q["name"] for q in qis])
    out = []
    for q in qis:
        c = counts.get(_s(q["name"]))
        if not c or c["free"] <= 0:
            continue            # everything on this sheet has already gone
        out.append([q["name"], "{0} of {1} free".format(c["free"], c["total"])])
    try:
        start, page_len = int(start or 0), int(page_len or 50)
    except Exception:
        start, page_len = 0, 50
    return out[start:start + page_len]


@frappe.whitelist()
def inspection_free_summary():
    """Plain numbers, for a check or a screen: which sheets are still worth opening."""
    counts = _free_counts()
    live = {k: v for k, v in counts.items() if v["free"] > 0}
    return {"ok": True, "inspections": len(counts), "with_free": len(live),
            "fully_taken": len(counts) - len(live),
            "detail": sorted([{"inspection": k, "free": v["free"], "total": v["total"]}
                              for k, v in counts.items()],
                             key=lambda r: -r["free"])}
