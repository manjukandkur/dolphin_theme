"""RETIRING A BLOCK, SO ITS NUMBER CAN BE USED AGAIN — 2 Sep 2026.

His words:

    "what I was thinking after block is exported you can dim the respective block
     numbers and show as sold and show the respective invoice in journey trace
     block etc will that help to solve this problem?"

    "ok go ahead and build deploy and commit without disturbing any workflows and
     block numbers"

WHY THIS EXISTS
---------------
Measured on the live site before a line was written:

    606 quarry blocks, 606 distinct quarry numbers, 0 repeats
    211 blocks stuck reading "In Delivery Challan"
     11 blocks have EVER reached "Sold"
    134 delivery challans, 33 tax invoices

The ladder in api_arrivals.STAGE_RANK runs In Stock -> ... -> Sold, but nothing
carries a locally sold block to the end of it. So a number is never released, and
the duplicate check on Quarry Inspection - which matches on the number and reads
no status at all - refuses a number that left the yard in July.

The gap is not the numbering. It is that a block never finishes.

WHAT THIS FILE DOES, AND WHAT IT REFUSES TO DO
----------------------------------------------
It adds an END to a block's life, as a stamp beside the block rather than a
rewrite of it. Retiring a block writes three read-only fields and NOTHING else.

    It never touches block_number.
    It never touches export_block_no.
    It never touches status.
    It never merges, renames or deletes a block.

That is deliberate and it is his instruction: "without disturbing any workflows
and block numbers". Every existing screen reads `status`, so status is left
exactly as every one of them expects to find it. Retirement is a fact added
alongside, and a screen learns about it only when it asks.

THE THREE PLACES A BLOCK CAN BE
-------------------------------
    here    - the stone is ours and standing somewhere. Its number is in use.
              In Stock, Buyer Marked, At Port, Reconciled, Ready for Export Lot.
    leaving - committed but not yet gone. A person must decide.
              In Delivery Challan on a draft, Dispatched, In Export Shipment Lot,
              Loaded.
    gone    - it has left. Sold, Shipped, or sitting on a SUBMITTED challan.

Only `gone` releases a number, and even then only once a person or the scan has
stamped the retirement, so that what the screen shows and what the check allows
can never drift apart.

NOTE ON THE EXPORT NUMBER
-------------------------
Nothing here guards it, on purpose. 2 Sep 2026, his correction: "buyer can repeat
numbers for consecutive lots which can ship together at times". The export number
is a label the buyer paints on, and labels repeat. Identity travels on the block
link that every Shipping Block row already carries; the number is only ink. The
one guard it needs is on the printed document, and that is a later step.
"""

import json

import frappe
from frappe.utils import cint

from dolphin_theme.block_resolve import _s

# ---------------------------------------------------------------------------
# Where a block stands. Read from what is already on the record - no new status.
# ---------------------------------------------------------------------------

HERE = {"In Stock", "Buyer Marked", "At Port", "Reconciled", "Ready for Export Lot"}
LEAVING = {"Dispatched/Transported", "In Export Shipment Lot", "Loaded",
           "In Delivery Challan"}
GONE = {"Sold", "Shipped"}

# The stamp. Three read-only fields beside the block, never on top of it.
CUSTOM_FIELDS = [
    ("Quarry Block", {
        "fieldname": "retired_on", "label": "Retired on", "fieldtype": "Date",
        "insert_after": "status", "read_only": 1,
        "description": "The day this block finished its life here. Set only when the "
                       "stone has gone. Its number becomes free to use again; nothing "
                       "about this block changes."}),
    ("Quarry Block", {
        "fieldname": "retired_because", "label": "Retired because", "fieldtype": "Data",
        "insert_after": "retired_on", "read_only": 1,
        "description": "In words: sold, shipped, or delivered - and on what."}),
    ("Quarry Block", {
        "fieldname": "retired_ref", "label": "Retired against", "fieldtype": "Data",
        "insert_after": "retired_because", "read_only": 1,
        "description": "The document that took the stone away, so the trace can open it."}),
]


def ensure_fields():
    """Idempotent. Runs from after_migrate."""
    try:
        from frappe.custom.doctype.custom_field.custom_field import create_custom_field
    except Exception:
        return {"ok": False, "reason": "create_custom_field unavailable"}
    added = []
    for doctype, spec in CUSTOM_FIELDS:
        try:
            if not frappe.db.exists("DocType", doctype):
                continue
            if frappe.get_meta(doctype).has_field(spec["fieldname"]):
                continue
            create_custom_field(doctype, dict(spec), ignore_validate=True)
            added.append(doctype + "." + spec["fieldname"])
        except Exception:
            frappe.log_error(frappe.get_traceback(), "Dolphin retirement.ensure_fields")
    if added:
        frappe.clear_cache()
    return {"ok": True, "added": added}


def _challan_submitted(dc):
    """A challan that has been submitted means the stone physically went."""
    dc = _s(dc)
    if not dc:
        return False
    try:
        return cint(frappe.db.get_value("Delivery Challan", dc, "docstatus")) == 1
    except Exception:
        return False


def state_of_row(row):
    """here | leaving | gone, from a dict that carries status and delivery_challan."""
    st = _s(row.get("status"))
    if st in GONE:
        return "gone"
    if st == "In Delivery Challan" and _challan_submitted(row.get("delivery_challan")):
        return "gone"
    if st in LEAVING:
        return "leaving"
    if st in HERE:
        return "here"
    # An unknown status is treated as still here. Never release a number on a guess.
    return "here"


@frappe.whitelist()
def state_of(block=None):
    """Read-only. Where one block stands, and whether it has been retired."""
    name = _s(block)
    if not name or not frappe.db.exists("Quarry Block", name):
        return {"ok": False, "reason": "no such block"}
    meta = frappe.get_meta("Quarry Block")
    fields = ["name", "block_number", "export_block_no", "status", "delivery_challan"]
    for f in ("retired_on", "retired_because", "retired_ref"):
        if meta.has_field(f):
            fields.append(f)
    r = frappe.db.get_value("Quarry Block", name, fields, as_dict=True) or {}
    return {"ok": True, "block": name, "state": state_of_row(r),
            "retired_on": _s(r.get("retired_on")),
            "retired_because": _s(r.get("retired_because")),
            "retired_ref": _s(r.get("retired_ref")),
            "status": _s(r.get("status")),
            "block_number": _s(r.get("block_number")),
            "export_block_no": _s(r.get("export_block_no"))}


def _why(row):
    """The sentence that goes on the stamp, in the words of the document."""
    st = _s(row.get("status"))
    dc = _s(row.get("delivery_challan"))
    if st == "Sold":
        return ("Sold" + (" on " + dc if dc else ""), dc
                or "")
    if st == "Shipped":
        return "Shipped", ""
    if dc:
        return "Delivered on " + dc, dc
    return "Left the yard", ""


# ---------------------------------------------------------------------------
# Retiring. One block, or a scan across everything that has already gone.
# ---------------------------------------------------------------------------

@frappe.whitelist()
def retire(block=None, note=None, force=0):
    """Stamp a block as finished. Writes three fields and nothing else.

    Refuses a block that has not gone, unless a person passes force with a
    reason - because releasing a number under a stone that is still standing in
    the yard is the one mistake this whole design exists to prevent.
    """
    name = _s(block)
    if not name or not frappe.db.exists("Quarry Block", name):
        frappe.throw("No such block: {0}".format(name or "(blank)"))
    meta = frappe.get_meta("Quarry Block")
    if not meta.has_field("retired_on"):
        frappe.throw("The retirement fields are not on this site yet. Run setup once.")

    r = frappe.db.get_value(
        "Quarry Block", name,
        ["name", "block_number", "status", "delivery_challan", "retired_on"],
        as_dict=True) or {}
    if _s(r.get("retired_on")):
        return {"ok": True, "already": True, "block": name,
                "retired_on": _s(r.get("retired_on"))}

    st = state_of_row(r)
    if st != "gone" and not cint(force):
        frappe.throw(
            "Block {0} reads <b>{1}</b> — it has not left yet. Retiring it would free "
            "its number while the stone is still here.".format(
                _s(r.get("block_number")) or name, _s(r.get("status")) or "unknown"))

    because, ref = _why(r)
    if _s(note):
        because = _s(note)

    doc = frappe.get_doc("Quarry Block", name)
    doc.set("retired_on", frappe.utils.today())
    doc.set("retired_because", because)
    doc.set("retired_ref", ref)
    doc.flags.ignore_mandatory = True
    doc.flags.ignore_validate_update_after_submit = True
    doc.save(ignore_permissions=True)
    try:
        doc.add_comment("Comment", "Retired. {0}. Number {1} is free to use again. "
                                   "Nothing about this block was changed.".format(
                                       because, _s(r.get("block_number"))))
    except Exception:
        pass
    frappe.db.commit()
    return {"ok": True, "block": name, "number": _s(r.get("block_number")),
            "because": because, "ref": ref, "forced": bool(cint(force))}


@frappe.whitelist()
def unretire(block=None):
    """Put a block back in service. Clears the stamp, touches nothing else."""
    name = _s(block)
    if not name or not frappe.db.exists("Quarry Block", name):
        frappe.throw("No such block: {0}".format(name or "(blank)"))
    doc = frappe.get_doc("Quarry Block", name)
    doc.set("retired_on", None)
    doc.set("retired_because", None)
    doc.set("retired_ref", None)
    doc.flags.ignore_mandatory = True
    doc.save(ignore_permissions=True)
    frappe.db.commit()
    return {"ok": True, "block": name}


@frappe.whitelist()
def retire_scan(commit=0, limit=0):
    """Every block that has already gone but carries no stamp yet.

    DRY RUN BY DEFAULT. Reports what it would do and changes nothing until a
    person passes commit=1, because this is the one call that frees numbers in
    bulk and it should never be a surprise.
    """
    meta = frappe.get_meta("Quarry Block")
    if not meta.has_field("retired_on"):
        return {"ok": False, "reason": "retirement fields not installed yet"}
    rows = frappe.get_all(
        "Quarry Block",
        fields=["name", "block_number", "status", "delivery_challan", "retired_on"],
        limit_page_length=0)
    todo = [r for r in rows if not _s(r.get("retired_on")) and state_of_row(r) == "gone"]
    if cint(limit):
        todo = todo[:cint(limit)]
    out = [{"block": r["name"], "number": _s(r.get("block_number")),
            "status": _s(r.get("status")), "because": _why(r)[0]} for r in todo]
    if not cint(commit):
        return {"ok": True, "dry_run": True, "would_retire": len(out), "blocks": out}
    done = 0
    for r in todo:
        try:
            retire(block=r["name"])
            done += 1
        except Exception:
            frappe.log_error(frappe.get_traceback(), "Dolphin retire_scan")
    return {"ok": True, "dry_run": False, "retired": done, "blocks": out}


# ---------------------------------------------------------------------------
# His production date. The field was already on the form and empty on all 606.
# ---------------------------------------------------------------------------

@frappe.whitelist()
def backfill_production_date(commit=0):
    """Fill date_produced from the report date of the inspection each block came in on.

    2 Sep 2026, his words: "what I would recommend adding is production date simple".
    The field existed already and was filled on 0 of 606 blocks, so a rule leaning on
    it would have failed on its first day. This only ever writes into an EMPTY
    date_produced - a date already typed by a person is never overwritten.
    """
    meta = frappe.get_meta("Quarry Block")
    if not meta.has_field("date_produced"):
        return {"ok": False, "reason": "no date_produced field"}
    rows = frappe.get_all(
        "Quarry Block", fields=["name", "block_number", "date_produced",
                                "source_quarry_inspection"],
        limit_page_length=0)
    qi_date = {}
    for q in frappe.get_all("Quarry Inspection", fields=["name", "report_date"],
                            limit_page_length=0):
        qi_date[_s(q.get("name"))] = q.get("report_date")

    todo = []
    for r in rows:
        if r.get("date_produced"):
            continue
        d = qi_date.get(_s(r.get("source_quarry_inspection")))
        if d:
            todo.append((r["name"], d, _s(r.get("block_number"))))
    if not cint(commit):
        return {"ok": True, "dry_run": True, "would_fill": len(todo),
                "no_inspection": len([r for r in rows if not r.get("date_produced")
                                      and not qi_date.get(_s(r.get("source_quarry_inspection")))]),
                "sample": [{"block": t[0], "number": t[2], "date": str(t[1])}
                           for t in todo[:10]]}
    n = 0
    for name, d, _num in todo:
        try:
            frappe.db.set_value("Quarry Block", name, "date_produced", d,
                                update_modified=False)
            n += 1
        except Exception:
            frappe.log_error(frappe.get_traceback(), "Dolphin backfill_production_date")
    frappe.db.commit()
    return {"ok": True, "dry_run": False, "filled": n}


# ---------------------------------------------------------------------------
# What the trace needs: every block that has ever carried a number.
# ---------------------------------------------------------------------------

@frappe.whitelist()
def generations(number=None):
    """Every block that has carried this quarry number, newest first.

    Read-only. This is what lets the trace show two lives of one number side by
    side and label which is which, instead of quietly picking one.
    """
    num = _s(number)
    if not num:
        return {"ok": False, "reason": "no number"}
    meta = frappe.get_meta("Quarry Block")
    fields = ["name", "block_number", "export_block_no", "status", "creation",
              "delivery_challan", "source_quarry_inspection",
              "length_gross", "width_gross", "height_gross"]
    for f in ("retired_on", "retired_because", "retired_ref", "date_produced"):
        if meta.has_field(f):
            fields.append(f)
    rows = frappe.get_all("Quarry Block", filters={"block_number": num},
                          fields=fields, limit_page_length=0)
    rows.sort(key=lambda r: _s(r.get("creation")))
    out = []
    for i, r in enumerate(rows):
        out.append({
            "block": r["name"],
            "use": i + 1,
            "of": len(rows),
            "latest": i == len(rows) - 1,
            "state": state_of_row(r),
            "status": _s(r.get("status")),
            "export_block_no": _s(r.get("export_block_no")),
            "retired_on": _s(r.get("retired_on")),
            "retired_because": _s(r.get("retired_because")),
            "retired_ref": _s(r.get("retired_ref")),
            "date_produced": _s(r.get("date_produced")),
            "came_in_on": _s(r.get("source_quarry_inspection")),
            "size": "{0}x{1}x{2}".format(cint(r.get("length_gross")),
                                         cint(r.get("width_gross")),
                                         cint(r.get("height_gross"))),
        })
    out.reverse()
    return {"ok": True, "number": num, "uses": len(out), "generations": out}


# ---------------------------------------------------------------------------
# The three-way answer. Nothing calls this yet - the Quarry Inspection dialog is
# a separate client script and swapping it is its own step, done on its own so a
# working screen is never changed blind. This is ready for it.
# ---------------------------------------------------------------------------

@frappe.whitelist()
def number_check(numbers=None):
    """For each quarry number: refuse, ask, or allow. Read-only, decides nothing.

        refuse - a block wearing that number is still standing here
        ask    - it is committed but not gone; a person decides
        allow  - it has gone, or nothing has ever carried the number
    """
    if isinstance(numbers, str):
        try:
            numbers = json.loads(numbers)
        except Exception:
            numbers = [n.strip() for n in numbers.split(",")]
    nums = [_s(n) for n in (numbers or []) if _s(n)]
    if not nums:
        return {"ok": True, "refuse": [], "ask": [], "allow": []}

    meta = frappe.get_meta("Quarry Block")
    fields = ["name", "block_number", "status", "delivery_challan",
              "length_gross", "width_gross", "height_gross"]
    if meta.has_field("retired_on"):
        fields.append("retired_on")
    rows = frappe.get_all("Quarry Block", filters=[["block_number", "in", nums]],
                          fields=fields, limit_page_length=0)
    held = {}
    for r in rows:
        held.setdefault(_s(r.get("block_number")), []).append(r)

    refuse, ask, allow = [], [], []
    for n in nums:
        on_it = held.get(n) or []
        # A retired block does not hold its number any more.
        live = [r for r in on_it if not _s(r.get("retired_on"))]
        if not live:
            allow.append({"number": n,
                          "note": "free" if not on_it else "last block retired"})
            continue
        here = [r for r in live if state_of_row(r) == "here"]
        leaving = [r for r in live if state_of_row(r) == "leaving"]
        gone = [r for r in live if state_of_row(r) == "gone"]
        if here:
            refuse.append({"number": n, "blocks": [
                {"block": r["name"], "status": _s(r.get("status")),
                 "size": "{0}x{1}x{2}".format(cint(r.get("length_gross")),
                                              cint(r.get("width_gross")),
                                              cint(r.get("height_gross")))}
                for r in here]})
        elif leaving:
            ask.append({"number": n, "blocks": [
                {"block": r["name"], "status": _s(r.get("status")),
                 "challan": _s(r.get("delivery_challan"))} for r in leaving]})
        else:
            allow.append({"number": n, "note": "the block that had it has gone",
                          "retire": [r["name"] for r in gone]})
    return {"ok": True, "refuse": refuse, "ask": ask, "allow": allow}


@frappe.whitelist()
def setup_retirement():
    """One call to install the fields. Safe to run again."""
    return ensure_fields()


# ---------------------------------------------------------------------------
# THE PRODUCTION DATE FOLLOWS THE INSPECTION — 3 Sep 2026.
#
# His instruction, and it is the better design:
#
#     "so on QI rather than entering it must take automatically whatever date is
#      entered.. that way delayed entries get right production dates"
#
# Nobody types a production date on a block. The Quarry Inspection's report date
# IS the production date of every block that came in on it, because every one of
# those stones arrived together on that day. A sheet entered a week late carries
# the real date the moment a person corrects the report date on the inspection -
# one field, and every block on it follows.
#
# That is why this SYNCS rather than seeds. A seeded value would be right only
# until the report date was fixed, and then silently wrong forever after.
# ---------------------------------------------------------------------------

def sync_production_dates(doc, method=None):
    """Every block on this inspection takes its report date. Runs on save.

    Writes only the date, only where it differs, and never touches a block that
    is not on this inspection. Costs one query and one write per changed block.
    """
    try:
        if not frappe.get_meta("Quarry Block").has_field("date_produced"):
            return
        d = doc.get("report_date")
        if not d:
            return
        rows = frappe.get_all(
            "Quarry Block",
            filters={"source_quarry_inspection": doc.name},
            fields=["name", "date_produced"], limit_page_length=0)
        for r in rows:
            if str(r.get("date_produced") or "") == str(d):
                continue
            frappe.db.set_value("Quarry Block", r["name"], "date_produced", d,
                                update_modified=False)
    except Exception:
        # A production date must never be the reason an inspection will not save.
        frappe.log_error(frappe.get_traceback(), "Dolphin sync_production_dates")


@frappe.whitelist()
def resync_production_dates(commit=0):
    """Bring every block back in step with its inspection's report date.

    Use after correcting report dates in bulk. Dry run by default. Unlike the
    first backfill this DOES overwrite, because the inspection is the authority
    on when its own stones were produced.
    """
    if not frappe.get_meta("Quarry Block").has_field("date_produced"):
        return {"ok": False, "reason": "no date_produced field"}
    qi_date = {}
    for q in frappe.get_all("Quarry Inspection", fields=["name", "report_date"],
                            limit_page_length=0):
        qi_date[_s(q.get("name"))] = q.get("report_date")
    rows = frappe.get_all("Quarry Block",
                          fields=["name", "block_number", "date_produced",
                                  "source_quarry_inspection"],
                          limit_page_length=0)
    todo = []
    for r in rows:
        d = qi_date.get(_s(r.get("source_quarry_inspection")))
        if d and str(r.get("date_produced") or "") != str(d):
            todo.append((r["name"], d, _s(r.get("block_number")),
                         str(r.get("date_produced") or "")))
    if not cint(commit):
        return {"ok": True, "dry_run": True, "out_of_step": len(todo),
                "sample": [{"block": t[0], "number": t[2], "was": t[3],
                            "becomes": str(t[1])} for t in todo[:10]]}
    n = 0
    for name, d, _num, _was in todo:
        try:
            frappe.db.set_value("Quarry Block", name, "date_produced", d,
                                update_modified=False)
            n += 1
        except Exception:
            frappe.log_error(frappe.get_traceback(), "Dolphin resync_production_dates")
    frappe.db.commit()
    return {"ok": True, "dry_run": False, "updated": n}
