"""
Dolphin - WHERE IS THIS BLOCK NOW?
==================================

His spec, 24 Aug 2026, and it was the top of his list:

    "is it on an arrivals xls · is it fresh QI stock with no BI and no DC · is
     it on a draft DC · has it moved to an export lot. One function, number type
     attached, used by every Port & Stock page *and* every self-test."

WHY THIS EXISTS
---------------
A block answers to THREE numbers and a challan to TWO, and nothing on a screen
says which kind you are holding:

    Quarry Block   name = 7-digit record id (1001595)
                   block_number = the quarry number (1016)
                   export_block_no = the export number (430)

    Delivery Challan   name = record id (DC-DCDG-070)
                       delivery_challan_no = hand-typed (0033)

DC-DCDG-070 is challan **0033**, not 070. That trap has cost a day twice.

And on 25 Aug 2026 it cost more than time: every block the app called "ready to
settle" was refused as "ambiguous - No block answers to 1150", because 1150 is
one block's EXPORT number and, at the same moment, a different block's QUARRY
number. All sixteen collided that way. 1364 is one block's export number and
another's quarry number - and THAT block's export number is 1160, which is a
third block's quarry number. A chain of them.

THE TWO RULES THIS MODULE ENFORCES
----------------------------------
1. **Never report a number without naming its type.** Every place a block turns
   up says which number matched it there. A caller can then compare like with
   like instead of comparing 430 against 1016 and concluding the stone has
   vanished.

2. **The RECORD is the identity; a number only confirms it.** Where a document
   LINKS to the Quarry Block - a challan row, a lot row - that link is the
   answer and no resolution is needed. The number is used only to check the
   record answers to it. Resolving a bare number is the last resort, and when
   the number is shared this module says so with BOTH candidates named, rather
   than the useless "ambiguous".

WHAT IT IS NOT
--------------
It is not a search box and it does not guess. If a number means two blocks, it
returns both and refuses to choose - because on this site that is not a rare
edge case, it is Tuesday.

Public API
----------
    where_is(key)              -> the full answer for one number   (whitelisted)
    where_are(keys)            -> the same, for many               (whitelisted)
    resolve_strict(key, ...)   -> (record, why) for server callers - never guesses
"""

import frappe

from dolphin_theme.block_resolve import candidates, _s


# --------------------------------------------------------------------------
# The stages, in the order the stone actually moves. The verdict is the
# FURTHEST stage the block has genuinely reached - "genuinely" meaning a person
# moved it there, per his standing rule that identity follows movement.
# --------------------------------------------------------------------------
STAGES = [
    ("quarried", "Fresh quarry stock"),
    ("inspected", "Inspected, not sold"),
    ("on_draft_dc", "On a draft challan - not dispatched"),
    ("transported", "On the road"),
    ("arrived", "On an agency arrival sheet"),
    ("at_port", "At port"),
    ("in_lot", "In an export shipment lot"),
    ("on_shipping_doc", "On a shipping document"),
    ("shipped", "Shipped"),
]
STAGE_ORDER = {k: i for i, (k, _t) in enumerate(STAGES)}
STAGE_WORDS = dict(STAGES)


def _num_types(rec):
    """Which of this block's numbers is which. Said out loud, every time."""
    return {
        "record_id": _s(rec.get("name")),
        "quarry_no": _s(rec.get("block_number")),
        "export_no": _s(rec.get("export_block_no")),
    }


def _matched_by(rec, value):
    """Name the number type that `value` is FOR THIS BLOCK. Never guess."""
    v = _s(value)
    if not v:
        return ""
    hits = []
    if v == _s(rec.get("export_block_no")):
        hits.append("export number")
    if v == _s(rec.get("block_number")):
        hits.append("quarry number")
    if v == _s(rec.get("name")):
        hits.append("record id")
    return " and ".join(hits) if hits else "a number this block does not answer to"


def _rows(doctype, filters, fields, parent=None):
    try:
        return frappe.get_all(doctype, filters=filters, fields=fields,
                              limit_page_length=0) or []
    except Exception:
        return []


# --------------------------------------------------------------------------
# Each finder answers one of his four questions and returns PLACES.
# A place always carries: what kind of document, which document, whether it is
# a draft, and WHICH NUMBER matched it there.
# --------------------------------------------------------------------------
def _places_on_challans(rec):
    """On a challan - draft or submitted. The row LINKS to the block, so this is
    identity, not matching. The number is reported for the reader, not used."""
    out = []
    rows = _rows("DC Block Row",
                 {"block": rec.get("name")},
                 ["name", "parent", "block_no", "export_block_no", "gross_tonnage"])
    # A row may carry the number without the link (older data), so look that up
    # too - but say plainly that it was found by number rather than by link.
    seen = {r.get("parent") for r in rows}
    by_number = []
    for field, num in (("export_block_no", _s(rec.get("export_block_no"))),
                       ("block_no", _s(rec.get("block_number")))):
        if not num:
            continue
        for r in _rows("DC Block Row", {field: num},
                       ["name", "parent", "block_no", "export_block_no", "block"]):
            if _s(r.get("block")) == _s(rec.get("name")):
                continue                      # already have it, by link
            if r.get("parent") in seen:
                continue
            by_number.append((r, field))

    names = [r.get("parent") for r in rows] + [r[0].get("parent") for r in by_number]
    heads = {}
    if names:
        for h in _rows("Delivery Challan", {"name": ["in", list(set(names))]},
                       ["name", "delivery_challan_no", "docstatus", "dc_date",
                        "vehicle", "port_of_loading"]):
            heads[_s(h.get("name"))] = h

    def _one(parent, how, num_used):
        h = heads.get(_s(parent)) or {}
        ds = int(h.get("docstatus") or 0)
        return {
            "kind": "delivery_challan",
            "doctype": "Delivery Challan",
            "doc": _s(parent),
            # THE TRAP, said on every row: the record id is not the challan number
            "challan_no": _s(h.get("delivery_challan_no")),
            "doc_number_note": (
                "record id {0}; the hand-typed challan number is {1}".format(
                    _s(parent), _s(h.get("delivery_challan_no")) or "not typed in")),
            "draft": 1 if ds == 0 else 0,
            "submitted": 1 if ds == 1 else 0,
            "cancelled": 1 if ds == 2 else 0,
            "date": _s(h.get("dc_date")),
            "truck": _s(h.get("vehicle")),
            "found_by": how,
            "number_used": _s(num_used),
            "number_type": _matched_by(rec, num_used) if num_used else "the block link",
        }

    for r in rows:
        out.append(_one(r.get("parent"), "the challan's own link to the block", ""))
    for r, field in by_number:
        num = _s(r.get(field))
        out.append(_one(r.get("parent"), "its number on the challan row", num))
    return out


def _places_on_arrivals(rec):
    """On an agency arrival sheet. The agency writes NUMBERS, never links -
    quarry_block is empty on all 849 rows - so this is matching, and the number
    type has to be named or the comparison is meaningless."""
    out = []
    wanted = []
    if _s(rec.get("export_block_no")):
        wanted.append(_s(rec.get("export_block_no")))
    if _s(rec.get("block_number")):
        wanted.append(_s(rec.get("block_number")))
    if not wanted:
        return out
    rows = _rows("Port Arrival Block", {"block_no": ["in", wanted]},
                 ["name", "parent", "block_no", "length", "width", "height",
                  "cbm", "net_wt", "vehicle_no"])
    parents = list({r.get("parent") for r in rows if r.get("parent")})
    heads = {}
    if parents:
        for h in _rows("Port Arrival", {"name": ["in", parents]},
                       ["name", "arrival_date", "docstatus", "mark", "creation"]):
            heads[_s(h.get("name"))] = h
    for r in rows:
        h = heads.get(_s(r.get("parent"))) or {}
        num = _s(r.get("block_no"))
        out.append({
            "kind": "arrival_sheet",
            "doctype": "Port Arrival",
            "doc": _s(r.get("parent")),
            "row": _s(r.get("name")),
            "confirmed": 1 if int(h.get("docstatus") or 0) == 1 else 0,
            "date": _s(h.get("arrival_date") or h.get("creation")),
            "mark": _s(h.get("mark")),
            "found_by": "the number written on the agency's sheet",
            "number_used": num,
            "number_type": _matched_by(rec, num),
            "their_size": [r.get("length"), r.get("width"), r.get("height")],
            "their_cbm": r.get("cbm"),
            "their_net_wt": r.get("net_wt"),
            "truck": _s(r.get("vehicle_no")),
        })
    return out


def _places_on_lots(rec):
    out = []
    rows = _rows("Shipment Lot Block", {"block": rec.get("name")},
                 ["name", "parent", "block_no", "export_block_no", "net_tonnage"])
    if not rows:
        wanted = [n for n in (_s(rec.get("export_block_no")),
                              _s(rec.get("block_number"))) if n]
        if wanted:
            rows = _rows("Shipment Lot Block", {"export_block_no": ["in", wanted]},
                         ["name", "parent", "block_no", "export_block_no",
                          "net_tonnage", "block"])
            rows = [r for r in rows
                    if not _s(r.get("block")) or _s(r.get("block")) == _s(rec.get("name"))]
    parents = list({r.get("parent") for r in rows if r.get("parent")})
    heads = {}
    if parents:
        for h in _rows("Export Shipment Lot", {"name": ["in", parents]},
                       ["name", "docstatus", "status", "vessel", "lot_title"]):
            heads[_s(h.get("name"))] = h
    for r in rows:
        h = heads.get(_s(r.get("parent"))) or {}
        num = _s(r.get("export_block_no")) or _s(r.get("block_no"))
        out.append({
            "kind": "export_lot",
            "doctype": "Export Shipment Lot",
            "doc": _s(r.get("parent")),
            "status": _s(h.get("status")),
            "vessel": _s(h.get("vessel")),
            "draft": 1 if int(h.get("docstatus") or 0) == 0 else 0,
            "found_by": ("the lot's own link to the block" if r.get("block")
                         else "its export number on the lot row"),
            "number_used": num,
            "number_type": _matched_by(rec, num),
        })
    return out


def _places_on_shipping(rec):
    out = []
    wanted = [n for n in (_s(rec.get("export_block_no")),
                          _s(rec.get("block_number"))) if n]
    rows = _rows("Shipping Block", {"block": rec.get("name")},
                 ["name", "parent", "block_no", "export_block_no"])
    if not rows and wanted:
        rows = _rows("Shipping Block", {"export_block_no": ["in", wanted]},
                     ["name", "parent", "block_no", "export_block_no", "block"])
        rows = [r for r in rows
                if not _s(r.get("block")) or _s(r.get("block")) == _s(rec.get("name"))]
    parents = list({r.get("parent") for r in rows if r.get("parent")})
    heads = {}
    if parents:
        for h in _rows("Shipping Document", {"name": ["in", parents]},
                       ["name", "docstatus", "export_status", "bl_no", "vessel",
                        "shipment_date"]):
            heads[_s(h.get("name"))] = h
    for r in rows:
        h = heads.get(_s(r.get("parent"))) or {}
        num = _s(r.get("export_block_no")) or _s(r.get("block_no"))
        out.append({
            "kind": "shipping_document",
            "doctype": "Shipping Document",
            "doc": _s(r.get("parent")),
            "export_status": _s(h.get("export_status")),
            "bl_no": _s(h.get("bl_no")),
            "vessel": _s(h.get("vessel")),
            "draft": 1 if int(h.get("docstatus") or 0) == 0 else 0,
            "found_by": ("the document's own link to the block" if r.get("block")
                         else "its export number on the shipping row"),
            "number_used": num,
            "number_type": _matched_by(rec, num),
        })
    return out


def _places_on_inspections(rec):
    """Buyer Inspection - the reading that makes a block "sold to somebody"."""
    out = []
    rows = _rows("Buyer Inspection Block", {"block": rec.get("name")},
                 ["name", "parent", "block_no", "export_block_no",
                  "length_gross", "width_gross", "height_gross", "modified"])
    parents = list({r.get("parent") for r in rows if r.get("parent")})
    heads = {}
    if parents:
        for h in _rows("Buyer Inspection", {"name": ["in", parents]},
                       ["name", "docstatus", "creation"]):
            heads[_s(h.get("name"))] = h
    for r in rows:
        h = heads.get(_s(r.get("parent"))) or {}
        out.append({
            "kind": "buyer_inspection",
            "doctype": "Buyer Inspection",
            "doc": _s(r.get("parent")),
            "draft": 1 if int(h.get("docstatus") or 0) == 0 else 0,
            "found_by": "the inspection's own link to the block",
            "number_used": "",
            "number_type": "the block link",
            "size": [r.get("length_gross"), r.get("width_gross"), r.get("height_gross")],
            "when": _s(r.get("modified")),
        })
    return out


# --------------------------------------------------------------------------
# THE VERDICT
#
# His standing rules, all three of them, live in this function:
#   * "anything inside dc draft shouldnt be considered yet ... only after submit"
#   * identity follows MOVEMENT, not resemblance
#   * a block with no buyer inspection simply has none - that is not a fault
# --------------------------------------------------------------------------
def _verdict(rec, places):
    status = _s(rec.get("status"))
    kinds = {p["kind"] for p in places}

    submitted_dc = [p for p in places
                    if p["kind"] == "delivery_challan" and p.get("submitted")]
    draft_dc = [p for p in places
                if p["kind"] == "delivery_challan" and p.get("draft")]
    arrivals = [p for p in places if p["kind"] == "arrival_sheet"]
    confirmed_arrivals = [p for p in arrivals if p.get("confirmed")]

    stage = "quarried"
    if "buyer_inspection" in kinds:
        stage = "inspected"
    if draft_dc and not submitted_dc:
        stage = "on_draft_dc"
    if submitted_dc:
        stage = "transported"
    if confirmed_arrivals:
        stage = "arrived"
    if status in ("At Port", "Reconciled", "Ready for Export Lot"):
        stage = "at_port"
    if [p for p in places if p["kind"] == "export_lot"]:
        stage = "in_lot"
    if [p for p in places if p["kind"] == "shipping_document"]:
        stage = "on_shipping_doc"
    if status in ("Shipped", "Sold"):
        stage = "shipped"

    # His four questions, answered as plain booleans a screen or a check can use.
    answers = {
        "on_an_arrival_sheet": 1 if arrivals else 0,
        "on_a_confirmed_arrival_sheet": 1 if confirmed_arrivals else 0,
        "fresh_quarry_stock": 1 if (not kinds & {"buyer_inspection",
                                                 "delivery_challan",
                                                 "arrival_sheet",
                                                 "export_lot",
                                                 "shipping_document"}) else 0,
        "on_a_draft_challan_only": 1 if (draft_dc and not submitted_dc) else 0,
        "moved_to_an_export_lot": 1 if "export_lot" in kinds else 0,
    }
    return stage, answers


@frappe.whitelist()
def where_is(key=None):
    """Where is this block now - and how do we know?

    Never guesses. When a number means two blocks it returns BOTH, named, with
    each one's three numbers spelled out, so a person can say which they meant.
    That is the honest answer to a genuinely ambiguous question, and on this
    site the question is ambiguous far more often than anyone expects.
    """
    key = _s(key)
    if not key:
        return {"asked": "", "ok": 0, "error": "No number given."}

    cands = candidates(key, allow_record_name=False)

    # The record-id case is explained, never silently resolved: a typed number
    # resolved against a record id is what put 56 blocks at a port they had
    # never reached.
    record_id_only = None
    if not cands:
        try:
            if frappe.db.exists("Quarry Block", key):
                d = frappe.db.get_value(
                    "Quarry Block", key,
                    ["name", "block_number", "export_block_no", "status"],
                    as_dict=True)
                if d:
                    record_id_only = dict(d)
        except Exception:
            record_id_only = None

    if not cands:
        return {
            "asked": key,
            "ok": 0,
            "ambiguous": 0,
            "found": 0,
            "record_id_only": record_id_only,
            "message": (
                "{0} is no block's quarry number and no block's export number."
                .format(key)
                + ("  It IS record id {0} (quarry {1}, export {2}) - but a typed "
                   "number is never read as a record id, so nothing acts on it."
                   .format(record_id_only.get("name"),
                           record_id_only.get("block_number") or "-",
                           record_id_only.get("export_block_no") or "-")
                   if record_id_only else "")),
        }

    if len(cands) > 1:
        return {
            "asked": key,
            "ok": 0,
            "ambiguous": 1,
            "found": len(cands),
            "candidates": [
                {"numbers": _num_types(c),
                 "status": _s(c.get("status")),
                 "answers_to_it_as": _matched_by(c, key)}
                for c in cands],
            "message": (
                "{0} means {1} different blocks. It is {2}. "
                "Nothing will act on it until you say which one."
                .format(key, len(cands),
                        " and ".join(
                            "block {0}'s {1}".format(
                                _s(c.get("name")), _matched_by(c, key))
                            for c in cands))),
        }

    rec = cands[0]
    places = []
    places += _places_on_inspections(rec)
    places += _places_on_challans(rec)
    places += _places_on_arrivals(rec)
    places += _places_on_lots(rec)
    places += _places_on_shipping(rec)
    stage, answers = _verdict(rec, places)

    return {
        "asked": key,
        "ok": 1,
        "ambiguous": 0,
        "found": 1,
        # THE NUMBER TYPE, ATTACHED. This is the whole point of the module.
        "asked_was": _matched_by(rec, key),
        "numbers": _num_types(rec),
        "status": _s(rec.get("status")),
        "where": stage,
        "where_words": STAGE_WORDS.get(stage, stage),
        "answers": answers,
        "places": places,
        "place_count": len(places),
    }


@frappe.whitelist()
def where_are(keys=None):
    """The same answer for many numbers. One call per screen, not one per row."""
    if isinstance(keys, str):
        try:
            keys = frappe.parse_json(keys)
        except Exception:
            keys = [k.strip() for k in keys.split(",") if k.strip()]
    out = {}
    for k in (keys or []):
        k = _s(k)
        if not k or k in out:
            continue
        out[k] = where_is(k)
    return {"asked": len(out), "results": out}


def resolve_strict(key, linked_record=None):
    """For server callers that already hold a link. Returns (record, why).

    THE RULE LEARNED ON 25 AUG 2026: if the paperwork links to a record, that
    link IS the identity. The number is used only to confirm the record answers
    to it. Resolving a bare number is the fallback, and it refuses when shared.
    """
    key = _s(key)
    if linked_record:
        try:
            rec = frappe.db.get_value(
                "Quarry Block", _s(linked_record),
                ["name", "block_number", "export_block_no", "status"], as_dict=True)
        except Exception:
            rec = None
        if rec:
            rec = dict(rec)
            if not key:
                return rec, "taken from the document's own link"
            if key in {_s(rec.get("export_block_no")), _s(rec.get("block_number"))}:
                return rec, "the document's link, confirmed by its " + _matched_by(rec, key)
            return None, ("the document links to block {0}, which does not answer "
                          "to {1}".format(_s(rec.get("name")), key))
    cands = candidates(key, allow_record_name=False)
    if not cands:
        return None, "no block answers to {0}".format(key)
    if len(cands) > 1:
        return None, ("{0} means {1} blocks - {2}".format(
            key, len(cands),
            " and ".join("block {0}'s {1}".format(_s(c.get("name")),
                                                  _matched_by(c, key))
                         for c in cands)))
    return dict(cands[0]), "resolved from its " + _matched_by(cands[0], key)
