"""THE BLOCK NUMBER IDENTITY GUARD — 22 Aug 2026.

His words:

    "why does it keep switching to internal IDs? find the root cause also one or
     2 more validations you must add when it comes to making sure the block
     number? this has been the major issue from the inception"

THE ROOT CAUSE, measured rather than guessed
--------------------------------------------
`Quarry Block` is named with **autoincrement**. Its record ids are therefore bare
integers - 1, 2, 3 ... 1585 - and so are the quarry number and the export number.
All three are "a number", and nothing about a number tells you which of the three
it is.

On this site, today:

    570 blocks
     37 quarry numbers are ALSO some other block's record id
     25 export numbers are ALSO some other block's record id

So `1387` genuinely names two different blocks depending on which field you read.
This is not a coding slip that can be patched once - it is the naming design, and
every path that mixes the three is doomed until either the ids stop looking like
block numbers, or every number is checked before it is used.

THE REAL CURE is to rename Quarry Block records to a prefixed series (QB-00001).
Frappe's rename updates every link, and after it a bare number can only ever mean
a block number. That is a bulk change to 570 live records and it is his call, so
`plan_prefixed_rename()` below reports exactly what it would do and changes
nothing.

UNTIL THEN, these validations run on every number that enters the system.
"""

import frappe

from dolphin_theme.block_resolve import _s, try_resolve


def _index():
    """Every block, with all three identities."""
    rows = frappe.get_all(
        "Quarry Block",
        fields=["name", "block_number", "export_block_no", "status"],
        limit_page_length=0,
    )
    by_name = {}
    for r in rows:
        by_name[_s(r.name)] = r
    return rows, by_name


@frappe.whitelist()
def block_number_health():
    """How bad is the collision, exactly? Read-only.

    A collision is a real block number that happens to equal some OTHER block's
    record id. Those are the numbers that produce a confident, silent, wrong
    match."""
    rows, by_name = _index()
    quarry_hits, export_hits = [], []
    for r in rows:
        bn, ex, nm = _s(r.block_number), _s(r.export_block_no), _s(r.name)
        if bn and bn in by_name and bn != nm:
            quarry_hits.append({"block": nm, "quarry_no": bn,
                                "also_the_record_id_of": by_name[bn].name,
                                "that_block_is": _s(by_name[bn].block_number)})
        if ex and ex in by_name and ex != nm:
            export_hits.append({"block": nm, "export_no": ex,
                                "also_the_record_id_of": by_name[ex].name,
                                "that_block_is": _s(by_name[ex].export_block_no)})
    return {
        "blocks": len(rows),
        "naming_rule": _s(frappe.db.get_value("DocType", "Quarry Block", "autoname")),
        "quarry_numbers_that_are_also_a_record_id": len(quarry_hits),
        "export_numbers_that_are_also_a_record_id": len(export_hits),
        "quarry_examples": quarry_hits[:40],
        "export_examples": export_hits[:40],
        "cure": ("Rename Quarry Block to a prefixed series (QB-00001). "
                 "Then a bare number can only ever be a block number."),
    }


# ---------------------------------------------------------------------------
# VALIDATION 1 — a number that is somebody else's record id is refused
# ---------------------------------------------------------------------------

@frappe.whitelist()
def check_number(number=None, expect=None):
    """Is this number safe to act on?

    Returns {ok, reason, block, via}. It refuses rather than guesses when:
      * the number is a record id and nothing else
      * the number resolves, but the block it lands on does not itself answer to
        that number (a resolver bug, or a stale index, would show up here)
      * the number is also some other block's record id, so acting on it could
        mean two different blocks
    """
    key = _s(number)
    if not key:
        return {"ok": False, "reason": "empty", "message": "No number given."}

    rows, by_name = _index()
    hit, why = try_resolve(key, allow_record_name=False)

    if not hit:
        if key in by_name:
            other = by_name[key]
            return {"ok": False, "reason": "record-id",
                    "message": ("{0} is an internal record id, not a block number. "
                                "It belongs to the block whose quarry number is {1}."
                                .format(key, _s(other.block_number) or "unknown"))}
        return {"ok": False, "reason": why,
                "message": "No block answers to {0}.".format(key)}

    answers = {_s(hit.get("export_block_no")), _s(hit.get("block_number"))}
    if key not in answers:
        return {"ok": False, "reason": "does-not-answer",
                "message": ("{0} resolved to block {1}, but that block answers to {2}. "
                            "Refusing rather than guessing."
                            .format(key, hit.get("name"), " / ".join(sorted(a for a in answers if a))))}

    out = {"ok": True, "reason": "ok", "block": hit.get("name"),
           "quarry_no": _s(hit.get("block_number")),
           "export_no": _s(hit.get("export_block_no")),
           "via": _s(hit.get("via"))}

    if key in by_name and _s(by_name[key].name) != _s(hit.get("name")):
        # It resolved, but the same digits are also a different block's record id.
        # Safe here because we never resolve through record ids - but the caller
        # should know the number is not unique across the system.
        out["warning"] = ("{0} is also the internal record id of another block. "
                          "It resolved correctly, but never let this number reach "
                          "anything that accepts record ids.".format(key))

    if expect:
        exp = _s(expect)
        if exp and exp != _s(hit.get("name")):
            return {"ok": False, "reason": "mismatch",
                    "message": ("{0} points at block {1}, not the expected {2}."
                                .format(key, hit.get("name"), exp))}
    return out


# ---------------------------------------------------------------------------
# VALIDATION 2 — a challan row must agree with itself
# ---------------------------------------------------------------------------

@frappe.whitelist()
def check_challan_rows(dc=None):
    """Every DC Block Row carries a LINK to the block plus two written numbers.
    They must all describe the same block. Where they do not, the row is the
    problem - and a row that disagrees with itself is exactly how a wrong block
    ends up on a shipping document.

    Read-only. Pass a challan name for one, or nothing for every submitted one.
    """
    filters = {"parenttype": "Delivery Challan"}
    if dc:
        filters["parent"] = _s(dc)
    rows = frappe.get_all(
        "DC Block Row", filters=filters,
        fields=["name", "parent", "block", "block_no", "export_block_no"],
        limit_page_length=0,
    )
    _, by_name = _index()
    bad, checked = [], 0
    for r in rows:
        checked += 1
        link = _s(r.block)
        qb = by_name.get(link)
        if not qb:
            bad.append({"challan": r.parent, "row": r.name, "link": link,
                        "problem": "the link points at no block at all"})
            continue
        want_q, want_e = _s(qb.block_number), _s(qb.export_block_no)
        got_q, got_e = _s(r.block_no), _s(r.export_block_no)
        if got_q and want_q and got_q != want_q:
            bad.append({"challan": r.parent, "row": r.name, "block": link,
                        "problem": "row says quarry number {0}, the block says {1}"
                                   .format(got_q, want_q)})
        if got_e and want_e and got_e != want_e:
            bad.append({"challan": r.parent, "row": r.name, "block": link,
                        "problem": "row says export number {0}, the block says {1}"
                                   .format(got_e, want_e)})
        if got_q and got_q == link and want_q and got_q != want_q:
            bad.append({"challan": r.parent, "row": r.name, "block": link,
                        "problem": "the row's block number is the record id"})
    return {"rows_checked": checked, "disagreements": len(bad), "detail": bad[:200]}


# ---------------------------------------------------------------------------
# THE CURE — reported, never performed
# ---------------------------------------------------------------------------

@frappe.whitelist()
def plan_prefixed_rename(limit=25):
    """What renaming Quarry Block to QB-00001 would look like. Changes nothing.

    This is the only change that makes the confusion structurally impossible, and
    it is a bulk rename of every live block, so it stays a decision for him.
    """
    rows, by_name = _index()
    sample = []
    for r in rows[: int(limit or 25)]:
        sample.append({"now": _s(r.name),
                       "would_become": "QB-{0:05d}".format(int(r.name)) if _s(r.name).isdigit()
                                       else _s(r.name),
                       "quarry_no": _s(r.block_number),
                       "export_no": _s(r.export_block_no)})
    h = block_number_health()
    return {
        "blocks": len(rows),
        "collisions_today": (h["quarry_numbers_that_are_also_a_record_id"]
                             + h["export_numbers_that_are_also_a_record_id"]),
        "after_rename": "zero - a bare number could only ever be a block number",
        "links_updated_automatically": "yes, Frappe's rename rewrites every Link field",
        "sample": sample,
        "note": "Reported only. Nothing has been renamed.",
    }
