"""ANCHOR EVERY ROW TO A BLOCK, WHILE THE NUMBERS STILL RESOLVE — 3 Sep 2026.

His words:

    "even afte the block is retired there should not be ambiguity"
    "link them rightaway also no harm in creating this method you mentioned even
     for quarry numbers. I will tell them not to repeat though"

WHY THIS IS URGENT RATHER THAN TIDY
-----------------------------------
A number is a label. A link is an identity. Two rows measured on the live site
name a block by NUMBER ALONE and carry no link:

    Quarry Inspection Block   629 rows   no link field existed at all
    Port Arrival Block        905 rows   139 with an empty link

Today every one of those still resolves to exactly one block, because no number
has ever been reused. The first repeated number closes that window PERMANENTLY:
an arrival row saying "1182" would sit between two stones with nothing to decide
it, and no amount of later work could recover the answer. So the links are built
first and the repeats come after - that order is the whole point.

Once a row carries the link, the number beside it is free to repeat forever. The
row still means one specific stone, before retirement and long after it.

WHICH NUMBER SPACE, AND WHY IT MATTERS
--------------------------------------
The system's own rule, printed on the trace page: "Quarry block number up to
Delivery Challan; export number from Transport onward." So the two tables are
read in DIFFERENT number spaces, and reading them the same way is what makes 83
of those arrival rows look ambiguous when they are not:

    Port Arrival Block      the number is an EXPORT number   -> export first
    Quarry Inspection Block the number is a QUARRY number    -> quarry first

Measured before writing a line, with that rule applied:

    Port Arrival    139 of 139 resolve to exactly one block. None ambiguous.
    Quarry Insp.    606 of 629 resolve to exactly one block.
                     23 match no block at all - a 300xx series (30046, 30049,
                     30050, 30051, 30059, 30061, 30169, 30176 ...) with no
                     Quarry Block behind it. Those are REPORTED, never guessed.

WHAT THIS FILE WILL NOT DO
--------------------------
    It never writes a block number, quarry or export.
    It never overwrites a link that is already there.
    It never links a row whose number matches more than one block.
    It never invents a block for a row that matches none.
    It writes one field, on rows that have it empty, and nothing else.
"""

import frappe
from frappe.utils import cint

from dolphin_theme.block_resolve import _s

# The link column on each child table, and which number space to read it in.
#   field   - the column holding the number a person typed
#   link    - the column that should hold the block
#   prefer  - "export" or "quarry": which space that number belongs to
TABLES = {
    "Port Arrival Block": {
        "parent": "Port Arrival", "field": "block_no",
        "link": "quarry_block", "prefer": "export",
    },
    "Quarry Inspection Block": {
        "parent": "Quarry Inspection", "field": "quarry_block_no",
        "link": "block", "prefer": "quarry",
    },
}

# Quarry Inspection Block had no link column at all. Adding one is site data, so
# a deploy cannot take it away again.
CUSTOM_FIELDS = [
    ("Quarry Inspection Block", {
        "fieldname": "block", "label": "Block", "fieldtype": "Link",
        "options": "Quarry Block", "insert_after": "quarry_block_no",
        "read_only": 1, "no_copy": 1,
        "description": "The stone this row is about. Set once, from the number, "
                       "while that number still means one block. The number "
                       "beside it may repeat later; this will not."}),
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
            frappe.log_error(frappe.get_traceback(), "Dolphin block_links.ensure_fields")
    if added:
        frappe.clear_cache()
    return {"ok": True, "added": added}


def _number_index():
    """Every block, indexed by each of its two numbers."""
    rows = frappe.get_all(
        "Quarry Block",
        fields=["name", "block_number", "export_block_no", "source_quarry_inspection"],
        limit_page_length=0)
    by_q, by_e = {}, {}
    for r in rows:
        q, e = _s(r.get("block_number")), _s(r.get("export_block_no"))
        if q:
            by_q.setdefault(q, []).append(r)
        if e:
            by_e.setdefault(e, []).append(r)
    return by_q, by_e


def _pick(num, parent, prefer, by_q, by_e):
    """The one block this number means here, or a reason it cannot be decided.

    Reads the PREFERRED space first, because the same digits mean different
    stones in the two spaces - 114 numbers on this site are one block's quarry
    number and another block's export number, permanently.
    """
    num = _s(num)
    if not num:
        return None, "blank"
    first, second = (by_e, by_q) if prefer == "export" else (by_q, by_e)
    hit = first.get(num) or []
    if len(hit) == 1:
        return hit[0]["name"], "matched on " + prefer
    if len(hit) > 1:
        # Several blocks in the preferred space. The parent inspection can still
        # settle it for a quarry row, because a block names the QI it came in on.
        if prefer == "quarry" and parent:
            narrowed = [b for b in hit
                        if _s(b.get("source_quarry_inspection")) == _s(parent)]
            if len(narrowed) == 1:
                return narrowed[0]["name"], "matched on quarry + its inspection"
        return None, "{0} blocks share this {1} number".format(len(hit), prefer)
    other = second.get(num) or []
    if len(other) == 1:
        return other[0]["name"], "matched on the other number space"
    if len(other) > 1:
        return None, "{0} blocks share this number".format(len(other))
    return None, "no block carries this number"


@frappe.whitelist()
def link_scan(table=None, commit=0, limit=0):
    """Anchor every unlinked row to its block. DRY RUN BY DEFAULT.

    Reports exactly what it would do and changes nothing until a person passes
    commit=1, because this writes across hundreds of rows at once and should
    never be a surprise.
    """
    wanted = [table] if table else list(TABLES.keys())
    by_q, by_e = _number_index()
    out = {"ok": True, "dry_run": not cint(commit), "tables": {}}

    for dt in wanted:
        spec = TABLES.get(dt)
        if not spec:
            out["tables"][dt] = {"error": "unknown table"}
            continue
        meta = frappe.get_meta(dt)
        if not meta.has_field(spec["link"]):
            out["tables"][dt] = {"error": "no '{0}' field yet - run setup_links "
                                          "once".format(spec["link"])}
            continue

        # NOTE: frappe.get_all takes no `parent` argument server-side - that is
        # REST-API only, and passing it raises
        # "DatabaseQuery.execute() got an unexpected keyword argument 'parent'".
        # A child table is queried directly and scoped by parenttype instead.
        rows = frappe.get_all(
            dt, filters={"parenttype": spec["parent"]},
            fields=["name", "parent", spec["field"], spec["link"]],
            limit_page_length=0, ignore_permissions=True)
        todo, cannot, already = [], [], 0
        for r in rows:
            if _s(r.get(spec["link"])):
                already += 1
                continue
            block, why = _pick(r.get(spec["field"]), r.get("parent"),
                               spec["prefer"], by_q, by_e)
            if block:
                todo.append((r["name"], block, _s(r.get(spec["field"])), why))
            else:
                cannot.append({"row": r["name"], "number": _s(r.get(spec["field"])),
                               "parent": _s(r.get("parent")), "reason": why})
        if cint(limit):
            todo = todo[:cint(limit)]

        done = 0
        if cint(commit):
            for row_name, block, _num, _why in todo:
                try:
                    frappe.db.set_value(dt, row_name, spec["link"], block,
                                        update_modified=False)
                    done += 1
                except Exception:
                    frappe.log_error(frappe.get_traceback(), "Dolphin link_scan")

        out["tables"][dt] = {
            "rows": len(rows), "already_linked": already,
            "would_link" if not cint(commit) else "linked":
                len(todo) if not cint(commit) else done,
            "cannot_decide": len(cannot),
            "reasons": sorted({c["reason"] for c in cannot}),
            "unmatched_sample": cannot[:15],
            "sample": [{"row": t[0], "number": t[2], "block": t[1], "how": t[3]}
                       for t in todo[:5]],
        }
    if cint(commit):
        frappe.db.commit()
    return out


@frappe.whitelist()
def link_health():
    """How much of the system still names a block by number alone. Read-only."""
    out = {"ok": True, "tables": {}}
    for dt, spec in TABLES.items():
        meta = frappe.get_meta(dt)
        has = meta.has_field(spec["link"])
        rows = frappe.get_all(dt, filters={"parenttype": spec["parent"]},
                              fields=["name"] + ([spec["link"]] if has else []),
                              limit_page_length=0, ignore_permissions=True)
        linked = len([r for r in rows if has and _s(r.get(spec["link"]))])
        out["tables"][dt] = {"rows": len(rows), "linked": linked,
                             "by_number_only": len(rows) - linked,
                             "link_field": spec["link"] if has else "MISSING"}
    # The tables that were already sound, for contrast.
    for dt, parent, link in (("DC Block Row", "Delivery Challan", "block"),
                             ("Shipment Lot Block", "Export Shipment Lot", "block"),
                             ("Shipping Block", "Shipping Document", "block")):
        try:
            rows = frappe.get_all(dt, filters={"parenttype": parent},
                                  fields=["name", link],
                                  limit_page_length=0, ignore_permissions=True)
            out["tables"][dt] = {"rows": len(rows),
                                 "linked": len([r for r in rows if _s(r.get(link))]),
                                 "by_number_only": len([r for r in rows
                                                        if not _s(r.get(link))]),
                                 "link_field": link}
        except Exception:
            pass
    return out


@frappe.whitelist()
def setup_links():
    """One call to install the link column. Safe to run again."""
    return ensure_fields()
