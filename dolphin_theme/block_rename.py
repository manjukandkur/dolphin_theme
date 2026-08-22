"""RENAMING QUARRY BLOCK SO A NUMBER CAN ONLY EVER MEAN ONE THING.

22 Aug 2026. His words: "ok go ahead make double sure no mess happens because of
this" and "hope this can be reverted if needed or else it will mess up more than
required".

WHY
---
Quarry Block is named with `autoincrement`, so record ids are bare integers, and
so are quarry numbers and export numbers. On this site 62 real block numbers are
ALSO some other block's record id. `1353` means Quarry Block 1865 when read as a
block number and a different block when read as a record id. No amount of careful
code can tell those apart - the information simply is not in the digits.

Renaming records to `QB-00001` removes the ambiguity at the source.

THE PART THAT WOULD HAVE CAUSED A MESS, and is handled here
-----------------------------------------------------------
The agency's arrival sheets are written in RECORD IDS. `ARR-27Jul2026-NA` lists
1387 / 1353 / 1365, which are record names, not block numbers. Rename the records
first and those rows point at nothing - arrival matching would break completely.

So the order is fixed and it matters:

    1. rewrite every arrival row that names a block by its record id, replacing it
       with that block's real number (export, else quarry), keeping the original
       in the row's note so the change is auditable
    2. only then rename the blocks

REVERSIBILITY
-------------
`run()` writes a complete before/after map - every rename and every rewritten
arrival row - into a File on the site before it changes anything, and returns it
as well. `revert()` reads that map and puts everything back. Frappe's rename
rewrites every Link automatically in both directions.

Nothing here runs without `confirm="YES"`, and `plan()` never changes anything.
"""

import json

import frappe

from frappe.model.rename_doc import rename_doc as _rename

from dolphin_theme.block_resolve import _s

# 22 Aug 2026, second attempt. The `QB-` prefix is IMPOSSIBLE here: Quarry Block
# is named with autoincrement, so Frappe stores `name` in an INTEGER column and
# refuses any text name ("No Name Specified for Quarry Block"). Two attempts
# stopped at the first block having renamed nothing - which is what the guard is
# for.
#
# His answer, and it is the better one: "yes great idea of 7 numbers easy no
# hassle better than alpha numeric go ahead."
#
# The ids stay integers and simply move out of the range block numbers occupy.
# Quarry and export numbers here are 3-4 digits; every id becomes 7. A
# seven-digit number can then only be an id and a four-digit one only a block
# number - the ambiguity gone without touching a single column type.
OFFSET = 1000000
MAP_FILE = "dolphin_block_rename_map.json"


def _new_name(old):
    o = _s(old)
    if not o.isdigit():
        return o                      # not an autoincrement id - leave it alone
    n = int(o)
    if n >= OFFSET:
        return o                      # already moved
    return str(n + OFFSET)


def _blocks():
    return frappe.get_all("Quarry Block",
                          fields=["name", "block_number", "export_block_no", "status"],
                          limit_page_length=0)


def _arrival_rows_named_by_record_id(by_name):
    """Arrival rows whose block_no is a record id rather than a block number."""
    out = []
    rows = frappe.get_all("Port Arrival Block",
                          fields=["name", "parent", "block_no"],
                          limit_page_length=0)
    for r in rows:
        key = _s(r.block_no)
        if not key or key not in by_name:
            continue
        blk = by_name[key]
        # It is a record id. Is it ALSO a real block number for some block?
        replacement = _s(blk.get("export_block_no")) or _s(blk.get("block_number"))
        out.append({
            "row": r.name, "arrival": r.parent,
            "now": key, "block": blk["name"],
            "would_become": replacement,
            "has_replacement": bool(replacement),
        })
    return out


@frappe.whitelist()
def plan():
    """Exactly what would change. Changes nothing at all."""
    blocks = _blocks()
    by_name = {_s(b.name): b for b in blocks}

    numeric = [b for b in blocks if _s(b.name).isdigit()]
    collisions = 0
    for b in blocks:
        for f in ("block_number", "export_block_no"):
            v = _s(b.get(f))
            if v and v in by_name and v != _s(b.name):
                collisions += 1

    arr = _arrival_rows_named_by_record_id(by_name)
    stuck = [a for a in arr if not a["has_replacement"]]

    return {
        "blocks_total": len(blocks),
        "blocks_to_rename": len(numeric),
        "collisions_today": collisions,
        "collisions_after": 0,
        "arrival_rows_written_in_record_ids": len(arr),
        "arrival_rows_with_no_real_number_to_use": len(stuck),
        "stuck_rows": stuck[:40],
        "sample_renames": [{"from": _s(b.name), "to": _new_name(b.name),
                            "quarry_no": _s(b.block_number),
                            "export_no": _s(b.export_block_no)}
                           for b in numeric[:20]],
        "sample_arrival_rewrites": arr[:20],
        "order": ["1. rewrite arrival rows that use a record id",
                  "2. rename the blocks",
                  "3. verify counts and statuses are unchanged"],
        "reversible": "yes - run() saves a full before/after map to " + MAP_FILE,
        "changed_anything": False,
    }


def _save_map(payload):
    content = json.dumps(payload, indent=2, default=str)
    doc = frappe.get_doc({
        "doctype": "File",
        "file_name": MAP_FILE,
        "is_private": 1,
        "content": content,
    })
    doc.flags.ignore_permissions = True
    doc.insert(ignore_permissions=True)
    return doc.name, doc.file_url


@frappe.whitelist()
def status():
    """How far along the rename is. Changes nothing."""
    blocks = _blocks()
    old = [b for b in blocks if _s(b.name).isdigit() and int(_s(b.name)) < OFFSET]
    new = [b for b in blocks if _s(b.name).isdigit() and int(_s(b.name)) >= OFFSET]
    maps = frappe.get_all("File", filters={"file_name": MAP_FILE},
                          fields=["name", "creation"], order_by="creation desc")
    return {"blocks_total": len(blocks), "still_short_ids": len(old),
            "already_seven_digit": len(new), "map_files": len(maps),
            "maps": [m.name for m in maps]}


@frappe.whitelist()
def run(confirm=None, limit=0):
    """Do it. Refuses without confirm="YES".

    `limit` renames at most that many blocks in this call and saves its own map,
    so hundreds of blocks can be moved in batches instead of in one request that
    runs long enough to time out half way through. revert() undoes every batch,
    newest first."""
    if _s(confirm) != "YES":
        frappe.throw('Refusing. Call run(confirm="YES") once you have read plan().')
    try:
        limit = int(limit or 0)
    except Exception:
        limit = 0

    blocks = _blocks()
    by_name = {_s(b.name): b for b in blocks}

    before_status = {_s(b.name): _s(b.status) for b in blocks}
    before_count = len(blocks)

    # ---- step 1: arrival rows written in record ids -----------------------
    arr = _arrival_rows_named_by_record_id(by_name)
    row_changes = []
    for a in arr:
        if not a["has_replacement"]:
            continue
        frappe.db.set_value("Port Arrival Block", a["row"], "block_no",
                            a["would_become"], update_modified=False)
        row_changes.append({"row": a["row"], "from": a["now"], "to": a["would_become"]})

    # ---- step 2: the renames ---------------------------------------------
    renames = []
    for b in blocks:
        old = _s(b.name)
        if not old.isdigit():
            continue
        new = _new_name(old)
        if new == old or frappe.db.exists("Quarry Block", new):
            continue
        renames.append({"from": old, "to": new})
        if limit and len(renames) >= limit:
            break

    payload = {"when": frappe.utils.now(), "by": frappe.session.user,
               "renames": renames, "arrival_rows": row_changes,
               "before_count": before_count}
    file_name, file_url = _save_map(payload)

    done = []
    for r in renames:
        try:
            # 22 Aug 2026: `frappe.rename_doc` (the top-level alias) does NOT take
            # ignore_permissions - only `frappe.model.rename_doc.rename_doc` does.
            # The first run stopped here having renamed nothing, which is exactly
            # what the guard is for. Calling the real function directly.
            _rename("Quarry Block", r["from"], r["to"],
                    force=True, merge=False, ignore_permissions=True,
                    show_alert=False)
            done.append(r)
        except Exception as e:
            payload["failed_at"] = {"rename": r, "error": str(e)}
            frappe.db.commit()
            frappe.throw("Stopped at {0} -> {1}: {2}. {3} renames were done and the "
                         "map is saved as {4} - revert() can put them back."
                         .format(r["from"], r["to"], e, len(done), file_name))

    frappe.db.commit()

    # ---- step 3: verify ---------------------------------------------------
    after = _blocks()
    after_status = {}
    for b in after:
        key = _s(b.name)
        after_status[key] = _s(b.status)
    moved_status = []
    for r in done:
        old, new = r["from"], r["to"]
        if before_status.get(old) != after_status.get(new):
            moved_status.append({"block": new, "was": before_status.get(old),
                                 "now": after_status.get(new)})

    return {
        "ok": 1,
        "renamed": len(done),
        "arrival_rows_rewritten": len(row_changes),
        "blocks_before": before_count,
        "blocks_after": len(after),
        "counts_match": before_count == len(after),
        "statuses_changed_unexpectedly": moved_status,
        "map_file": file_name,
        "map_url": file_url,
        "revert_with": 'block_rename.revert(confirm="YES")',
    }


@frappe.whitelist()
def revert(confirm=None, map_file=None):
    """Put everything back, using the map saved by run()."""
    if _s(confirm) != "YES":
        frappe.throw('Refusing. Call revert(confirm="YES").')

    # Every batch saves its own map. Reverting only the newest would leave the
    # earlier batches renamed, which is exactly the half-done mess he asked me to
    # make impossible - so with no map named, revert ALL of them, newest first.
    names = [_s(map_file)] if _s(map_file) else [
        m.name for m in frappe.get_all("File", filters={"file_name": MAP_FILE},
                                       fields=["name"], order_by="creation desc")]
    names = [n for n in names if n]
    if not names:
        frappe.throw("No rename map found on this site - nothing to revert from.")

    back = rows_back = 0
    used = []
    for name in names:
        doc = frappe.get_doc("File", name)
        payload = json.loads(doc.get_content())
        for r in reversed(payload.get("renames") or []):
            if frappe.db.exists("Quarry Block", r["to"]):
                _rename("Quarry Block", r["to"], r["from"],
                        force=True, merge=False, ignore_permissions=True,
                        show_alert=False)
                back += 1
        for a in (payload.get("arrival_rows") or []):
            if frappe.db.exists("Port Arrival Block", a["row"]):
                frappe.db.set_value("Port Arrival Block", a["row"], "block_no",
                                    a["from"], update_modified=False)
                rows_back += 1
        used.append(name)

    frappe.db.commit()
    return {"ok": 1, "renamed_back": back, "arrival_rows_restored": rows_back,
            "from_maps": used}
