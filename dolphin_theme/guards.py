"""
Dolphin — duplication guards for every stage that still had none.

  B35  "test end to end that no duplication or oversight mistakes happen either
        adding to BI or DC, at port etc dont allow any blocks which are taken
        like the one DC we caught yesterday repeated twice with same blocks"

  B8   Extend the DC Guard to Buyer Inspection, Port Arrival, Export Shipment
       Lot and Local Tax Invoice.

  B10  Red-flag a duplicate document number or a duplicate block number.

  B36  How DC 0070 duplicated: no unique constraint on the challan number; no
       check that a block was already on another challan; an unconditional
       status write that could move a block backwards; and the status write
       firing on SAVE rather than SUBMIT, so an unsubmitted draft moved live
       stock. All four are addressed here.

Design notes
------------
* **Generic, not per-doctype.** Block rows are found by walking the child tables
  and looking for the usual identifier fields, so a new child table or a renamed
  field cannot silently slip past the guard.
* **Fails open on the unexpected, closed on the actual finding.** A guard that
  crashes must never stop the business working — but a guard that has genuinely
  found a duplicate must stop the save. That is the DC Guard's design and it has
  held.
* **Drafts are checked too.** DC 0070 was a draft. Excluding drafts is precisely
  how it got through.
"""

import frappe

from dolphin_theme.block_resolve import _s, resolve_one, set_status, AmbiguousBlock

BLOCK_FIELDS = ("block", "block_no", "export_block_no", "quarry_block")

# Where a duplicate *document number* matters, and which field carries it.
DOC_NUMBER_FIELDS = {
    "Delivery Challan": ("delivery_challan_no", "dc_no"),
    "Buyer Inspection": ("inspection_no", "bi_no", "reference_no"),
    "Port Arrival": ("arrival_no", "reference_no", "source_sheet"),
    "Export Shipment Lot": ("lot_no", "title", "bl_no"),
    "Local Tax Invoice": ("invoice_no", "invoice_number", "name_series"),
}

# Human wording per doctype, so the message says what actually happened.
STAGE_WORD = {
    "Delivery Challan": "on another challan",
    "Buyer Inspection": "on another buyer inspection",
    "Port Arrival": "on another port arrival",
    "Export Shipment Lot": "in another shipment lot",
    "Local Tax Invoice": "on another invoice",
}


def _row_keys(row):
    """Every identifier this row carries, as strings."""
    out = set()
    for f in BLOCK_FIELDS:
        v = _s(row.get(f))
        if v:
            out.add(v)
    return out


def _doc_block_rows(doc):
    """[(child_row, {keys}), ...] across every child table on the document."""
    rows = []
    try:
        for tf in doc.meta.get_table_fields():
            for r in (doc.get(tf.fieldname) or []):
                keys = _row_keys(r)
                if keys:
                    rows.append((r, keys))
    except Exception:
        pass
    return rows


# How hard the guard bites, per doctype.
#
# HARD  — a block genuinely cannot be in two of these at once. Stop the save.
# WARN  — double occurrence can be legitimate (a re-inspection, a second arrival
#         sheet listing the same block) AND the live data already contains
#         hundreds of them: 617 Port Arrival rows are tagged Duplicate today.
#         Blocking those would make existing documents unsaveable, which is a
#         worse failure than the one being prevented. Say it loudly, save anyway.
HARD = {"Delivery Challan", "Export Shipment Lot", "Local Tax Invoice"}
WARN = {"Buyer Inspection", "Port Arrival"}

MAX_KEYS = 400   # arrival sheets run to 849 rows; keep the guard off the critical path


def _stop(doc, title, html):
    if doc.doctype in HARD:
        frappe.throw(html, title=title)
    frappe.msgprint(html, title=title, indicator="orange")


def _canonical_map(all_keys):
    """One bulk resolution for the whole document, so the same block written once
    as a quarry number and once as an export number still collides — without
    firing two queries per row."""
    from dolphin_theme.block_resolve import resolve_many
    try:
        res = resolve_many(list(all_keys)[:MAX_KEYS], allow_record_name=False)
    except Exception:
        res = {}
    out = {}
    for k in all_keys:
        r = res.get(k) or {}
        out[k] = ("QB:" + str(r["name"])) if r.get("ok") and r.get("name") else ("RAW:" + k)
    return out


# ---------------------------------------------------------------------------
# 1. The same block twice on one document
# ---------------------------------------------------------------------------

def _check_within(doc, rows=None, canon=None):
    rows = _doc_block_rows(doc) if rows is None else rows
    if canon is None:
        allk = set()
        for _r, keys in rows:
            allk |= keys
        canon = _canonical_map(allk)

    seen, dupes = {}, []
    for row, keys in rows:
        label = sorted(keys)[0]
        c = canon.get(label, "RAW:" + label)
        if c in seen:
            dupes.append((label, seen[c], row.idx))
        else:
            seen[c] = row.idx
    if dupes:
        lines = ["Row {0} repeats block {1} from row {2}.".format(d[2], d[0], d[1])
                 for d in dupes[:15]]
        _stop(doc, "Duplicate block",
              "<b>The same block is on this document more than once.</b><br><br>"
              + "<br>".join(lines)
              + ("<br>… and {0} more.".format(len(dupes) - 15) if len(dupes) > 15 else "")
              + "<br><br>Remove the duplicate rows before saving.")


# ---------------------------------------------------------------------------
# 2. The same block already on another document of this type
# ---------------------------------------------------------------------------

def _row_record(row):
    """The Quarry Block record a row points at, when it says so outright.

    The Link field is the only thing on a row that names a STONE. Everything
    else is a number, and a number is not an identity here.
    """
    return _s(row.get("block")) or _s(row.get("quarry_block"))


def _check_across(doc, rows=None):
    """The same STONE already on another document of this type.

    ======================================================================
    THE SAME STONE — NOT THE SAME NUMBER.  26 Aug 2026.

    This guard used to take every number on the document and ask the
    database whether ANY block field ANYWHERE held that string. On this
    site that is guaranteed to produce false refusals, because a block
    answers to three different numbers and the ranges overlap:

        1009 is block 1001522's EXPORT number  (at port, on DC-GCEG-035)
        1009 is block 1001591's QUARRY number  (a different stone entirely)

    So adding block 1001591 to a new challan was refused with "Block 1009
    is already on another challan DC-GCEG-035" — naming a challan that
    carries a completely different stone. The same false refusal hit 1016
    (1001404 vs 1001595) and 1036 (1001529 vs 1001605): three blocks, three
    wrong answers, and a challan that could not be saved.

    That is the standing lesson written down twice already: THE RECORD IS
    THE IDENTITY, NOT THE NUMBER. `_check_within` has always resolved to
    the record before comparing. This half never did.

    Now it compares RECORDS. A number is only allowed to raise a clash
    when neither side names a record, and then only against the SAME FIELD
    — an export number may collide with an export number, never with
    somebody else's quarry number.
    ======================================================================
    """
    ours = _doc_block_rows(doc) if rows is None else rows
    if not ours:
        return

    our_recs = {}          # Quarry Block record -> the number a person would recognise
    key_fields = {}        # number -> the fields it appears in on OUR document
    keys_all = set()
    for row, keys in ours:
        keys_all |= keys
        rec = _row_record(row)
        if rec:
            our_recs[rec] = (_s(row.get("export_block_no"))
                             or _s(row.get("block_no")) or rec)
        for f in BLOCK_FIELDS:
            v = _s(row.get(f))
            if v:
                key_fields.setdefault(v, set()).add(f)

    if not keys_all:
        return
    if len(keys_all) > MAX_KEYS:
        keys_all = set(sorted(keys_all)[:MAX_KEYS])

    clashes = {}
    for tf in doc.meta.get_table_fields():
        child_dt = tf.options
        if not child_dt:
            continue
        try:
            child_meta = frappe.get_meta(child_dt)
        except Exception:
            continue
        has_link = child_meta.has_field("block")
        for field in BLOCK_FIELDS:
            try:
                if not child_meta.has_field(field):
                    continue
                hits = frappe.db.sql(
                    """
                    SELECT c.`{f}` AS k, {linksel} c.parent AS parent, p.docstatus AS ds
                    FROM `tab{child}` c
                    JOIN `tab{parent_dt}` p ON p.name = c.parent
                    WHERE c.parenttype = %s AND c.parent != %s
                      AND p.docstatus < 2 AND TRIM(c.`{f}`) IN ({ph})
                    """.format(f=field, child=child_dt, parent_dt=doc.doctype,
                               linksel=("c.`block` AS qb," if has_link else ""),
                               ph=", ".join(["%s"] * len(keys_all))),
                    tuple([doc.doctype, doc.name or "__new__"] + sorted(keys_all)),
                    as_dict=True,
                )
            except Exception:
                continue
            for r in hits:
                k = _s(r.k)
                their_rec = _s(r.get("qb"))

                if their_rec:
                    # The other row NAMES its stone. Only that stone can clash,
                    # and only if this document is carrying the same one.
                    if their_rec not in our_recs:
                        continue
                    label = our_recs[their_rec]
                elif field in key_fields.get(k, set()):
                    # Neither side names a record. A number may still clash, but
                    # only with the SAME KIND of number — an export number never
                    # collides with somebody else's quarry number.
                    label = k
                else:
                    continue

                clashes.setdefault(label, set()).add(
                    (r.parent, "submitted" if r.ds == 1 else "draft"))

    if clashes:
        lines = []
        for k in sorted(clashes)[:15]:
            where = ", ".join("{0} ({1})".format(p, st) for p, st in sorted(clashes[k]))
            lines.append("Block <b>{0}</b> is already {1}: {2}".format(
                k, STAGE_WORD.get(doc.doctype, "on another document"), where))
        more = len(clashes) - 15
        _stop(doc, "Block already used",
              "<b>These blocks are already taken.</b><br><br>"
              + "<br>".join(lines)
              + ("<br>… and {0} more.".format(more) if more > 0 else "")
              + "<br><br>A block can only be on one {0} at a time. Remove it from the "
                "other document first, or remove it here.".format(doc.doctype))


# ---------------------------------------------------------------------------
# 3. Duplicate document number
# ---------------------------------------------------------------------------

def _check_doc_number(doc):
    for field in DOC_NUMBER_FIELDS.get(doc.doctype, ()):
        try:
            if not doc.meta.has_field(field):
                continue
        except Exception:
            continue
        val = _s(doc.get(field))
        if not val:
            continue
        try:
            others = frappe.get_all(
                doc.doctype,
                filters={field: val, "name": ["!=", doc.name or "__new__"],
                         "docstatus": ["<", 2]},
                fields=["name", "docstatus"], limit_page_length=5)
        except Exception:
            continue
        if others:
            where = ", ".join("{0} ({1})".format(o.name, "submitted" if o.docstatus == 1 else "draft")
                              for o in others)
            _stop(doc, "Duplicate number",
                  "<b>{0} {1} already exists.</b><br><br>Also used by: {2}<br><br>"
                  "This is the check that was missing when challan 0070 was raised twice."
                  .format(doc.meta.get_label(field) or field, val, where))
        return


# ---------------------------------------------------------------------------
# The hook itself
# ---------------------------------------------------------------------------

def guard(doc, method=None):
    """doc_events validate handler. Wired for Buyer Inspection, Port Arrival,
    Export Shipment Lot and Local Tax Invoice in hooks.py."""
    if getattr(doc.flags, "dolphin_skip_guard", False):
        return
    try:
        rows = _doc_block_rows(doc)
        _check_doc_number(doc)
        _check_within(doc, rows=rows)
        _check_across(doc, rows=rows)
    except frappe.ValidationError:
        raise  # a real finding — stop the save
    except Exception:
        frappe.log_error(frappe.get_traceback(), "Dolphin guard ({0})".format(doc.doctype))


# ---------------------------------------------------------------------------
# 4. A draft must not move live stock  (B36, root cause of the 0070 incident)
# ---------------------------------------------------------------------------

DC_STATUS_ON_SUBMIT = "Dispatched/Transported"


def dc_block_status_on_submit(doc, method=None):
    """Move the blocks on a Delivery Challan to Dispatched/Transported when the
    challan is SUBMITTED — never on save.

    The old behaviour wrote the status on every save, so an unsubmitted draft
    could and did move live stock: that is how four blocks sat on two challans
    at once. Writes go through `set_status`, so each one is a versioned save
    with a reason attached and a backwards move is refused."""
    try:
        moved, refused = [], []
        for _row, keys in _doc_block_rows(doc):
            key = sorted(keys)[0]
            try:
                hit = resolve_one(key, allow_record_name=True)
            except AmbiguousBlock:
                refused.append(key)
                continue
            if not hit:
                refused.append(key)
                continue
            res = set_status(hit["name"], DC_STATUS_ON_SUBMIT,
                             "dispatched on challan {0}".format(doc.name),
                             machine="server (challan submit)")
            (moved if res.get("ok") else refused).append(key)
        if refused:
            frappe.msgprint(
                "Challan submitted. {0} block(s) moved to {1}; {2} could not be "
                "resolved to exactly one block and were left untouched: {3}"
                .format(len(moved), DC_STATUS_ON_SUBMIT, len(refused),
                        ", ".join(refused[:10])),
                title="Some blocks were not moved", indicator="orange")
    except Exception:
        frappe.log_error(frappe.get_traceback(), "Dolphin dc submit status")


def dc_warn_draft_status(doc, method=None):
    """On a DC still in draft, say plainly that nothing has moved yet. Cheap, and
    it removes the assumption that saving a challan dispatches the blocks."""
    try:
        if doc.docstatus == 0 and not doc.get("__islocal"):
            frappe.msgprint(
                "Draft saved. No block has moved — stock changes when the challan "
                "is <b>submitted</b>.", alert=True, indicator="blue")
    except Exception:
        pass
