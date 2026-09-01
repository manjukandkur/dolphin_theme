"""
Dolphin — size and grade: two axes, never one.

STANDING INSTRUCTION (17 Aug 2026), in his words:

    "when there is mention of A size, B size etc it is size and when it says A
     grade B grade etc it is quality grade ... I have ansewered at tleast 20 times"
    "both co exist always"
    "price varies for each size and grade category sometimes price only on grade
     in the sense across the sizes in that grade"

Both axes use the letters A, B, C, D. They are NOT the same thing:

    granite_size_category   -> "A size"  — a dimension band (A = >=190x80x50)
    granite_quality_grade   -> "A grade" — the quality judgement

Every block carries both. Nothing in this module may collapse one into the other,
and nothing may print a bare letter without saying which axis it belongs to.

What this module does
---------------------
  B44  carry sizes forward:  BI -> DC -> Port Arrival -> Lot -> Export invoice.

       B54: the port agency NEVER measures — weight and tonnage are their only
       concern, and the measurements are ours. **The Buyer Inspection measurement
       is FINAL.** So carrying BI sizes forward is not a workaround for missing
       port data; it is the correct and only source. An arrival row with no
       measurement of its own is normal, not a gap.

  B45  a size override on the export invoice and packing list — carried sizes
       are the default, a person may correct them, and the correction is kept
       with the original beside it.

  B46  USD/ton keyed on (size x grade), falling back to grade-only when a grade
       is priced flat across its sizes, then to size-only. Today grade is
       recorded on 3 rows system-wide, so the fallback chain resolves to exactly
       today's behaviour until grades start being entered — no figure moves.
"""

import json

import frappe
from frappe.utils import flt, cint

from dolphin_theme.block_resolve import _s, try_resolve, machine_of, log_event

# Which fieldname carries each axis, per doctype. Kept explicit rather than
# guessed, because the two axes are one letter apart and a wrong guess here is
# the exact confusion this module exists to end.
SIZE_FIELD = "granite_size_category"

# His figure, 2-3 cm. The default when a document carries none of its own.
MARGINAL_CM = 3
GRADE_FIELDS = ("granite_quality_grade", "grade")

DIMS = {
    # doctype -> (length, width, height, volume, tonnage)
    "Quarry Block": ("length_gross", "width_gross", "height_gross", "gross_volume", "gross_tonnage"),
    "Buyer Inspection Block": ("length_gross", "width_gross", "height_gross", "gross_volume", "gross_tonnage"),
    "DC Block Row": ("length_gross", "width_gross", "height_gross", "gross_volume", "gross_tonnage"),
    "Port Arrival Block": ("length", "width", "height", "cbm", "net_wt"),
    "Shipment Lot Block": ("length", "width", "height", "cbm", "net_tonnage"),
    "Shipping Block": ("length", "width", "height", "net_volume", "net_tonnage"),
}


# ---------------------------------------------------------------------------
# Custom fields — site data, so a deploy cannot revert them (the C2 technique)
# ---------------------------------------------------------------------------

CUSTOM_FIELDS = [
    # size category was being dropped at the challan: the field did not exist
    ("DC Block Row", {
        "fieldname": SIZE_FIELD, "label": "Size Category", "fieldtype": "Link",
        "options": "Granite Size Category", "insert_after": "grade", "read_only": 1,
        "description": "A size / B size — the dimension band. Not the quality grade."}),
    # the rate table could only be keyed on size; grade had nowhere to live
    ("Shipping Document Size Rate", {
        "fieldname": "grade", "label": "Quality Grade", "fieldtype": "Data",
        "insert_after": "size_category",
        "description": "A grade / B grade — the quality judgement. Blank means this "
                       "rate applies across every grade in that size."}),
    ("Shipping Document Size Rate", {
        "fieldname": "applies_across_sizes", "label": "Priced on grade alone", "fieldtype": "Check",
        "insert_after": "grade",
        "description": "Tick when this grade is priced flat across all of its sizes."}),
    # B45 — the override, mirroring allow_override on the Local Tax Invoice
    ("Shipping Document", {
        "fieldname": "allow_size_override", "label": "Allow size override", "fieldtype": "Check",
        "insert_after": "block_count",
        "description": "Off: sizes are carried from the Buyer Inspection and refreshed on "
                       "every save. On: the L/W/H columns become editable and are left alone."}),
    ("Shipping Block", {
        "fieldname": "size_overridden", "label": "Size overridden", "fieldtype": "Check",
        "insert_after": "height", "read_only": 1}),
    ("Shipping Block", {
        "fieldname": "carried_size", "label": "Carried size (before override)", "fieldtype": "Data",
        "insert_after": "size_overridden", "read_only": 1}),
    # 31 Aug 2026. [stated] "let the buyer name appear not Ec 12" and
    # [stated] "whatever is decided on the invoice will be the correct for the
    # respective buyer" and [stated] "rather than grade wise we can create
    # another size master saying Best cheer B grade size master etc".
    #
    # So a size rule is identified by the BUYER on the document plus an optional
    # VARIATION name — never by a grade column. "XIAMEN BLESS" is one rule,
    # "XIAMEN BLESS · B grade" is another, and both are ordinary rows in the
    # Granite Size Category master, which already carries buyer and
    # variation_label for exactly this.
    ("Shipping Document", {
        "fieldname": "size_variation", "label": "Size rule variation", "fieldtype": "Data",
        "insert_after": "allow_size_override",
        "description": "Blank uses this buyer's own size rule. Type a variation name "
                       "(for example B grade) to use their second rule instead. "
                       "Where a buyer has no rule at all, the house A/B/C is used."}),
    ("Shipping Document", {
        "fieldname": "size_rule_display", "label": "Sizes by", "fieldtype": "Small Text",
        "insert_after": "size_variation", "read_only": 1,
        "description": "Which bands this document was sorted by, in words. Written on every save."}),
    # A block promoted to a higher band because the buyer agreed. Three fields,
    # because a promotion without a name on it is just an edit.
    ("Shipping Block", {
        "fieldname": "size_promoted_from", "label": "Promoted from", "fieldtype": "Data",
        "insert_after": "carried_size", "read_only": 1,
        "description": "The size the bands gave this block before a person promoted it."}),
    ("Shipping Block", {
        "fieldname": "size_consent_by", "label": "Buyer consent from", "fieldtype": "Data",
        "insert_after": "size_promoted_from", "read_only": 1,
        "description": "Who at the buyer agreed. A note inside the shipping document "
                       "only - 31 Aug 2026, his instruction: \"nothing should reflect "
                       "in the printout you can take note in the shipping documents\". "
                       "The invoice and the packing list are unchanged."}),
    ("Shipping Block", {
        "fieldname": "size_consent_on", "label": "Consent recorded", "fieldtype": "Datetime",
        "insert_after": "size_consent_by", "read_only": 1}),

    # =====================================================================
    # 1 Sep 2026.  HE OVERRULED THE BUYER-LINKED MASTER, IN HIS OWN WORDS:
    #
    #   "can you restrict the defined sizes only for shipping documents? or
    #    dont link sizes to any consignee in the invoices at all let it be
    #    standard one set editable for every shipment? everything wil be on
    #    record everything in shipping documents"
    #
    # So sizes belong to a SHIPMENT, not to a buyer. Every Shipping Document
    # carries its own bands; editing one changes that one and nothing else.
    # The Granite Size Category master keeps ONE standard set as the starting
    # point and decides nothing on a document that already exists.
    #
    # Seeding is his option B: a new document is pre-filled from the last
    # shipment to the same consignee, labelled with the document it came from,
    # and freely overwritten. That reads the previous DOCUMENT - it does not
    # consult, and does not write, any rule owned by a buyer.
    # =====================================================================
    # =====================================================================
    # 1 Sep 2026, LATER.  ONE PLACE, AND THE PLACE IS THE LOT.
    #
    # [stated] "let us try out with any changes with the lot or the grades size
    #  measurement etc let it be on export shipment lot one place" and
    # [stated] "so no contradictions".
    #
    # A threshold on the shipping document AS WELL would be the same rule
    # defined twice - the fault behind every failure this week. So the
    # EXPORT SHIPMENT LOT owns the thresholds, the marginal figure and the
    # grades. The shipping document reads them, and carries only a per-block
    # final change, off by default.
    #
    # One line held on purpose: MEASUREMENTS are not decided here. The Buyer
    # Inspection is final and the newest reading flows everywhere - his own
    # standing rule of 23-08. The lot sorts ON measurements; it is not a place
    # to type one.
    # =====================================================================
    ("Export Shipment Lot", {
        "fieldname": "size_bands", "label": "Size thresholds", "fieldtype": "Table",
        "options": "Shipping Size Band", "insert_after": "blocks",
        "description": "Tried top to bottom; the first one a block meets on all three "
                       "sides wins. A zero is no minimum on that side, so a row of "
                       "0 x 0 x 0 is met by everything and becomes the catch-all."}),
    ("Export Shipment Lot", {
        "fieldname": "size_tolerance_cm", "label": "Marginal threshold (cm)",
        "fieldtype": "Int", "default": "3", "insert_after": "size_bands",
        "description": "A block that misses a higher threshold by this much or less is "
                       "marked as marginal. Nothing moves on its own."}),
    ("Export Shipment Lot", {
        "fieldname": "record_grade", "label": "Record grade on this lot",
        "fieldtype": "Check", "default": "0", "insert_after": "size_tolerance_cm",
        "description": "Internal record only. Off by default. Never printed."}),
    # The shipping document's OWN copy - written only when the override is on.
    ("Shipping Document", {
        "fieldname": "size_override", "label": "Final change on this document",
        "fieldtype": "Check", "default": "0", "insert_after": "size_rule_display",
        "description": "Off: this document shows what the lot decided and stays in step "
                       "with it. On: it takes its own copy and the lot no longer reaches "
                       "it. Untick to go back to the lot."}),
    ("Shipping Document", {
        "fieldname": "size_bands", "label": "Sizes for this shipment", "fieldtype": "Table",
        "options": "Shipping Size Band", "insert_after": "size_override",
        "description": "This document's own copy of the lot's thresholds, written only "
                       "when the final-change tick is on."}),
    ("Shipping Document", {
        "fieldname": "size_seeded_from", "label": "Sizes pre-filled from", "fieldtype": "Data",
        "insert_after": "size_bands", "read_only": 1,
        "description": "The document these bands were copied from when this one was "
                       "created. A note about where they started, not a link that "
                       "keeps them in step."}),
    # -------------------------------------------------------------- grade
    # 1 Sep 2026, his words: "grade is independednt of size so grade is
    # independednt", and "give an option to select Grade for internal purpose
    # only it shouldnt be reflecting on shipping documents.. give grade options
    # as A,B,B1,B2,C with option of checkmark decision box if needed enabled
    # else off default."
    #
    # Grade is a JUDGEMENT about the stone. No measurement produces it and no
    # measurement can contradict it. Nothing here reads or writes a size, the
    # size sort never reads or writes a grade, and no pairing is ever flagged
    # as odd - A size / C grade raises nothing. Off by default, and never on a
    # printout: the DI Commercial Invoice and the DI Packing List are untouched.
    # 1 Sep 2026, his words: "threshold is missing". It was - I dropped the
    # marginal check when I rewrote the panel. It lives on the document now, so
    # the figure a shipment was judged by is on record with the bands it was
    # judged against, instead of being a constant buried in the code.
    ("Shipping Document", {
        "fieldname": "size_tolerance_cm", "label": "Marginal threshold (cm)",
        "fieldtype": "Int", "default": "3", "insert_after": "size_seeded_from",
        "description": "A block that misses a higher band by this much or less is "
                       "marked as marginal. His figure is 2-3 cm. Nothing moves on its "
                       "own - a person moves it, after the buyer agrees."}),
    ("Shipping Document", {
        "fieldname": "record_grade", "label": "Record grade on this shipment",
        "fieldtype": "Check", "default": "0", "insert_after": "size_tolerance_cm",
        "description": "Internal record only. Off by default. Never printed - neither "
                       "the invoice nor the packing list shows grade, whatever this says."}),
]

# The five he named. The Granite Grade master already holds all five (plus
# D (Rejected) and Unshaped, deliberately left out of a shipment's picker).
GRADES = ["A", "B", "B1", "B2", "C"]

# The child table the bands live in. Site data, like every other doctype on
# this system, so a deploy cannot revert it.
BAND_DOCTYPE = "Shipping Size Band"
BAND_FIELDS = [
    {"fieldname": "size_category_name", "label": "Size", "fieldtype": "Data",
     "in_list_view": 1, "columns": 2, "reqd": 1},
    {"fieldname": "min_length", "label": "Min L (cm)", "fieldtype": "Int",
     "in_list_view": 1, "columns": 2},
    {"fieldname": "min_width", "label": "Min W (cm)", "fieldtype": "Int",
     "in_list_view": 1, "columns": 2},
    {"fieldname": "min_height", "label": "Min H (cm)", "fieldtype": "Int",
     "in_list_view": 1, "columns": 2},
    {"fieldname": "sort_order", "label": "Order", "fieldtype": "Int",
     "in_list_view": 1, "columns": 1},
]


def ensure_band_doctype():
    """Create the child table if it is not there. Idempotent."""
    try:
        if frappe.db.exists("DocType", BAND_DOCTYPE):
            return False
        d = frappe.get_doc({
            "doctype": "DocType", "name": BAND_DOCTYPE, "module": "Custom",
            "custom": 1, "istable": 1, "editable_grid": 1,
            "fields": [dict(f) for f in BAND_FIELDS],
        })
        d.flags.ignore_mandatory = True
        d.insert(ignore_permissions=True)
        return True
    except Exception:
        frappe.log_error(frappe.get_traceback(), "ensure_band_doctype")
        return False


def ensure_fields():
    """Idempotent. Runs from after_migrate."""
    ensure_band_doctype()
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
            frappe.log_error(frappe.get_traceback(), "Dolphin ensure_fields")
    if added:
        frappe.clear_cache()
    return {"ok": True, "added": added}


@frappe.whitelist()
def setup_sizing():
    r = ensure_fields()
    frappe.db.commit()
    return r


# ---------------------------------------------------------------------------
# The size axis
# ---------------------------------------------------------------------------

def _standard_bands():
    """The ONE standard set. Rows in the master that belong to nobody.

    1 Sep 2026. This used to take a consignee and a variation and hand back that
    buyer's own rule. He removed that: sizes are not owned by a buyer any more.
    What is left is a single house set, and its only job is to SEED a new
    shipment. It decides nothing on a document that already carries bands."""
    try:
        rows = frappe.get_all(
            "Granite Size Category",
            filters={"is_active": 1},
            fields=["name", "size_category_name", "min_length", "min_width",
                    "min_height", "min_volume", "max_volume", "sort_order",
                    "buyer", "export_consignee", "variation_label"],
            limit_page_length=0)
    except Exception:
        return []
    rows = [r for r in rows
            if not _s(r.get("export_consignee")) and not _s(r.get("buyer"))
            and not _s(r.get("variation_label"))]
    rows.sort(key=lambda r: (cint(r.get("sort_order")) or 99))
    return rows


def _categories(consignee=None, variation=None):
    """Kept so nothing that still calls it breaks. The arguments are ignored on
    purpose - there is no per-buyer rule any more."""
    return _standard_bands()


def _band_rows(doc):
    """This document's own bands, as plain dicts, or [] when it has none."""
    out = []
    try:
        if not doc or not doc.meta.has_field("size_bands"):
            return []
        for b in (doc.get("size_bands") or []):
            name = _s(b.get("size_category_name"))
            if not name:
                continue
            out.append({"name": name, "size_category_name": name,
                        "min_length": cint(b.get("min_length")),
                        "min_width": cint(b.get("min_width")),
                        "min_height": cint(b.get("min_height")),
                        "min_volume": 0.0, "max_volume": 0.0,
                        "sort_order": cint(b.get("sort_order")) or 99})
    except Exception:
        return []
    out.sort(key=lambda r: (cint(r.get("sort_order")) or 99))
    return out


def _lot_of(doc):
    """The Export Shipment Lot a shipping document was built from."""
    try:
        if doc.doctype == "Shipping Document" and _s(doc.get("source_lot")):
            return frappe.get_doc("Export Shipment Lot", _s(doc.get("source_lot")))
    except Exception:
        pass
    return None


def bands_for(doc):
    """The thresholds a document is sorted by.

    1 Sep 2026, his decision: THE LOT OWNS THEM. A shipping document reads its
    lot's thresholds and stays in step with it, unless a person has ticked the
    final-change box - and then it is working from its own copy and says so.
    Anything with no lot behind it falls to the one standard set.

    Three layers, in this order, and never two definitions of the same rule."""
    if doc is None:
        return _standard_bands()
    if doc.doctype == "Shipping Document" and not cint(doc.get("size_override")):
        lot = _lot_of(doc)
        own = _band_rows(lot) if lot is not None else []
        if own:
            return own
        return _standard_bands()
    own = _band_rows(doc)
    return own if own else _standard_bands()


def tolerance_for(doc):
    """The marginal figure, from wherever the thresholds came from."""
    if doc is not None and doc.doctype == "Shipping Document" and not cint(doc.get("size_override")):
        lot = _lot_of(doc)
        if lot is not None and cint(lot.get("size_tolerance_cm")):
            return cint(lot.get("size_tolerance_cm"))
    return (cint(doc.get("size_tolerance_cm")) if doc is not None else 0) or MARGINAL_CM


def _bands_from_blocks(doc):
    """Bands read off a document's own blocks - the smallest block it accepted
    in each size. This is how his option B seeds a shipment from the previous
    one when that previous one predates the size_bands field.

    It reads ONE document. It is not a buyer rule and nothing is stored against
    a buyer by it."""
    acc = {}
    try:
        for b in (doc.get("blocks") or []):
            l, w, h = flt(b.get("length")), flt(b.get("width")), flt(b.get("height"))
            cat = _s(b.get(SIZE_FIELD))
            if not (l and w and h and cat):
                continue
            k = acc.setdefault(cat, {"l": l, "w": w, "h": h})
            k["l"] = min(k["l"], l); k["w"] = min(k["w"], w); k["h"] = min(k["h"], h)
    except Exception:
        return []
    order = {"A": 1, "B": 2, "B1": 3, "B2": 4, "C": 5}
    out = [{"size_category_name": c, "min_length": int(v["l"]),
            "min_width": int(v["w"]), "min_height": int(v["h"]),
            "sort_order": order.get(c, 9)} for c, v in acc.items()]
    out.sort(key=lambda r: r["sort_order"])
    return out


def _standard_as_bands():
    return [{"size_category_name": _s(c.get("size_category_name")) or _s(c["name"]),
             "min_length": cint(c.get("min_length")),
             "min_width": cint(c.get("min_width")),
             "min_height": cint(c.get("min_height")),
             "sort_order": cint(c.get("sort_order")) or 99}
            for c in _standard_bands()]


def seed_bands(doc, method=None):
    """before_insert on Shipping Document. HIS OPTION B, chosen 1 Sep 2026:

        "2nd option looks good"

    A new shipment opens pre-filled from the LAST shipment to the same
    consignee, labelled with the document it came from, and freely overwritten.
    Where that document has no bands of its own the figures are read off its
    blocks; where there is no previous document at all, the standard is used.

    Nothing is stored against the buyer by any of this. It reads one previous
    document once, at creation, and then the two never speak again."""
    try:
        # 1 Sep 2026: the LOT is seeded, not the shipping document. A document
        # reads its lot and only ever takes a copy when a person ticks the
        # final change - so seeding one would be a second definition again.
        if doc.doctype != "Export Shipment Lot" or not doc.meta.has_field("size_bands"):
            return
        if doc.get("size_bands"):
            return
        consignee = _doc_consignee(doc)
        seeded, src = [], ""
        if consignee:
            prev = frappe.get_all(
                "Export Shipment Lot",
                filters={"export_consignee": consignee, "name": ("!=", _s(doc.name) or "x")},
                fields=["name"], order_by="creation desc",
                limit_page_length=5)
            for row in prev:
                try:
                    pd = frappe.get_doc("Export Shipment Lot", row["name"])
                except Exception:
                    continue
                got = [{"size_category_name": b["size_category_name"],
                        "min_length": b["min_length"], "min_width": b["min_width"],
                        "min_height": b["min_height"], "sort_order": b["sort_order"]}
                       for b in _band_rows(pd)] or _bands_from_blocks(pd)
                if got:
                    seeded, src = got, row["name"]
                    break
        if not seeded:
            seeded, src = _standard_as_bands(), "the standard set"
        for b in seeded:
            doc.append("size_bands", b)
        if doc.meta.has_field("size_seeded_from"):
            doc.size_seeded_from = src
    except Exception:
        frappe.log_error(frappe.get_traceback(), "Dolphin seed_bands")


def rule_in_force(doc=None):
    """One line of plain English naming the bands a document was sorted by.

    1 Sep 2026: it used to name a buyer. It names a document now, because that
    is what owns the bands."""
    own = _band_rows(doc) if doc is not None else []
    if own:
        src = ""
        try:
            if doc.meta.has_field("size_seeded_from") and _s(doc.get("size_seeded_from")):
                src = " (started from {0})".format(_s(doc.get("size_seeded_from")))
        except Exception:
            src = ""
        return "set on this shipment" + src
    if _standard_bands():
        return "the standard set"
    return "no size bands defined"


def _profile(name=None):
    """A Size Profile overrides the A/B thresholds for a particular buyer or
    negotiation (Standard, Height Strict, Negotiated Smaller, ZEN)."""
    try:
        if name:
            return frappe.db.get_value("Size Profile", name, "*", as_dict=True)
        d = frappe.db.get_value("Size Profile", {"is_default": 1}, "*", as_dict=True)
        return d
    except Exception:
        return None


def size_category_for(length, width, height, volume=None, profile=None,
                      consignee=None, variation=None, bands=None):
    """The SIZE category (A size / B size), from the measurements.

    Never returns a quality grade. Returns None when there is nothing to judge —
    an absent measurement is not a small block."""
    l, w, h = flt(length), flt(width), flt(height)
    if not (l and w and h):
        return None

    prof = _profile(profile) if profile else None
    if prof:
        bands = []
        for letter in ("a", "b"):
            ml, mw, mh = (flt(prof.get(letter + "_min_length")),
                          flt(prof.get(letter + "_min_width")),
                          flt(prof.get(letter + "_min_height")))
            if ml or mw or mh:
                bands.append((letter.upper(), ml, mw, mh, 0, 0))
    else:
        src = bands if bands else _standard_bands()
        bands = [(c.get("size_category_name") or c.get("name"),
                  flt(c.get("min_length")), flt(c.get("min_width")),
                  flt(c.get("min_height")), flt(c.get("min_volume")),
                  flt(c.get("max_volume"))) for c in src]

    vol = flt(volume) or round(l * w * h / 1e6, 3)
    for name, ml, mw, mh, mnv, mxv in bands:
        if l >= ml and w >= mw and h >= mh:
            if mnv and vol < mnv:
                continue
            if mxv and vol > mxv:
                continue
            return name
    return None


@frappe.whitelist()
def classify(length=None, width=None, height=None, volume=None, profile=None):
    """UI-facing: what size is this, and by which thresholds."""
    cat = size_category_for(length, width, height, volume, profile)
    return {"size_category": cat, "profile": profile or "(default)",
            "note": "Size category only. The quality grade is a separate field and "
                    "is never inferred from measurements."}


# ---------------------------------------------------------------------------
# B44 — carrying sizes forward
# ---------------------------------------------------------------------------

def _source_measurements(key):
    """The authoritative measurements for a block: the Buyer Inspection is the
    measured record, the Quarry Block is the fallback."""
    hit, why = try_resolve(key, allow_record_name=True)
    if not hit:
        return None
    name = hit["name"]
    row = None
    try:
        rows = frappe.get_all(
            "Buyer Inspection Block", filters={"block": name},
            fields=["length_gross", "width_gross", "height_gross", "gross_volume",
                    "gross_tonnage", SIZE_FIELD, "parent"],
            order_by="modified desc", limit_page_length=1)
        row = rows[0] if rows else None
    except Exception:
        row = None
    if not row or not (flt(row.get("length_gross")) and flt(row.get("width_gross"))):
        try:
            row = frappe.db.get_value(
                "Quarry Block", name,
                ["length_gross", "width_gross", "height_gross", "gross_volume",
                 "gross_tonnage", SIZE_FIELD], as_dict=True)
        except Exception:
            return None
    if not row:
        return None
    l, w, h = flt(row.get("length_gross")), flt(row.get("width_gross")), flt(row.get("height_gross"))
    if not (l and w and h):
        return None
    vol = flt(row.get("gross_volume")) or round(l * w * h / 1e6, 3)
    return {
        "block": name,
        "l": l, "w": w, "h": h, "vol": vol,
        "ton": flt(row.get("gross_tonnage")) or round(vol * 2.6, 3),
        "size_category": _s(row.get(SIZE_FIELD)) or size_category_for(l, w, h, vol),
        "source": "Buyer Inspection" if row.get("parent") else "Quarry Block",
    }


def _doc_consignee(doc):
    """The buyer this document belongs to, whatever the doctype calls the field.

    31 Aug 2026. [stated] "size segregation at BI level should happen based on
    the size defined for that buyer on the previous invoice unless selected
    manually otherwise" - so the Buyer Inspection is included, and it names its
    buyer `export_buyer`."""
    for f in ("export_consignee", "export_buyer", "consignee", "local_buyer", "buyer"):
        try:
            if doc.meta.has_field(f) and _s(doc.get(f)):
                return _s(doc.get(f))
        except Exception:
            continue
    return None


def fill_row(row, doctype, force=False, consignee=None, variation=None, bands=None):
    """Put measurements and the size category onto one child row. Returns True
    when something was written. Never overwrites a value unless force."""
    fields = DIMS.get(doctype)
    if not fields:
        return False
    fl, fw, fh, fv, ft = fields
    meta = frappe.get_meta(doctype)

    have = flt(row.get(fl)) and flt(row.get(fw)) and flt(row.get(fh))
    if have and not force:
        # dimensions are there; the size category may still be missing
        if meta.has_field(SIZE_FIELD) and not _s(row.get(SIZE_FIELD)):
            cat = size_category_for(row.get(fl), row.get(fw), row.get(fh), row.get(fv),
                                    bands=bands)
            if cat:
                row.set(SIZE_FIELD, cat)
                return True
        return False

    key = (_s(row.get("export_block_no")) or _s(row.get("block_no"))
           or _s(row.get("block")) or _s(row.get("quarry_block")))
    src = _source_measurements(key)
    if not src:
        return False

    row.set(fl, src["l"])
    row.set(fw, src["w"])
    row.set(fh, src["h"])
    if meta.has_field(fv) and not flt(row.get(fv)):
        row.set(fv, src["vol"])
    if meta.has_field(ft) and not flt(row.get(ft)):
        row.set(ft, src["ton"])
    if meta.has_field(SIZE_FIELD) and not _s(row.get(SIZE_FIELD)) and src["size_category"]:
        row.set(SIZE_FIELD, src["size_category"])
    return True


def carry_sizes(doc, method=None):
    """validate hook for Port Arrival, Export Shipment Lot and Shipping Document.

    On Shipping Document this respects `allow_size_override` (B45): with the tick
    on, typed sizes are left exactly as typed and only recorded as overridden."""
    try:
        override = bool(doc.meta.has_field("allow_size_override") and cint(doc.get("allow_size_override")))
        # 1 Sep 2026: the bands come from the document itself now, never from
        # the buyer. A document with no bands of its own falls back to the
        # standard set - the only two layers there are.
        doc_bands = bands_for(doc)
        filled = 0
        for tf in doc.meta.get_table_fields():
            child_dt = tf.options
            if child_dt not in DIMS:
                continue
            for row in (doc.get(tf.fieldname) or []):
                if override:
                    _note_override(row, child_dt)
                    continue
                if fill_row(row, child_dt, bands=doc_bands):
                    filled += 1
        try:
            if doc.meta.has_field("size_rule_display"):
                doc.size_rule_display = rule_in_force(doc)
        except Exception:
            pass
        if filled and doc.doctype == "Port Arrival":
            frappe.msgprint(
                "Measurements carried onto {0} block row(s) from the Buyer Inspection, "
                "which is the final and authoritative measurement. The agency supplies "
                "weight, not size.".format(filled),
                alert=True, indicator="blue")
    except Exception:
        frappe.log_error(frappe.get_traceback(), "Dolphin carry_sizes ({0})".format(doc.doctype))


def _note_override(row, child_dt):
    """B45: remember what the carried size was, so the correction is legible and
    the original is never simply lost."""
    try:
        if not frappe.get_meta(child_dt).has_field("size_overridden"):
            return
        fl, fw, fh, fv, ft = DIMS[child_dt]
        key = (_s(row.get("export_block_no")) or _s(row.get("block_no"))
               or _s(row.get("block")) or _s(row.get("quarry_block")))
        src = _source_measurements(key)
        if not src:
            return
        typed = (flt(row.get(fl)), flt(row.get(fw)), flt(row.get(fh)))
        carried = (src["l"], src["w"], src["h"])
        if typed != carried and all(typed):
            row.set("size_overridden", 1)
            if frappe.get_meta(child_dt).has_field("carried_size"):
                row.set("carried_size", "{0}x{1}x{2}".format(*[int(x) for x in carried]))
            # keep volume and tonnage honest to the typed size
            l, w, h = typed
            row.set(fv, round(l * w * h / 1e6, 3))
        else:
            row.set("size_overridden", 0)
    except Exception:
        pass


@frappe.whitelist()
def backfill_sizes(doctype=None, limit=500, dry_run=1):
    """One-off: put measurements onto rows that never had any.

    Written for Port Arrival, where 0 of 849 rows carried a measurement. Dry run
    by default — it reports what it would do and writes nothing."""
    doctype = _s(doctype) or "Port Arrival"
    dry = cint(dry_run)
    names = [d.name for d in frappe.get_all(doctype, fields=["name"],
                                            limit_page_length=cint(limit) or 500)]
    touched, rows_filled, refused = [], 0, 0
    for nm in names:
        doc = frappe.get_doc(doctype, nm)
        n = 0
        for tf in doc.meta.get_table_fields():
            if tf.options not in DIMS:
                continue
            for row in (doc.get(tf.fieldname) or []):
                if fill_row(row, tf.options):
                    n += 1
                else:
                    refused += 1
        if not n:
            continue
        rows_filled += n
        touched.append({"doc": nm, "rows": n})
        if not dry:
            doc.flags.ignore_permissions = True
            doc.flags.ignore_validate_update_after_submit = True
            doc.flags.dolphin_skip_guard = True
            doc.save()
    if not dry:
        frappe.db.commit()
    return {"doctype": doctype, "dry_run": bool(dry), "documents": len(touched),
            "rows_filled": rows_filled, "rows_unresolvable": refused,
            "detail": touched[:40]}


# ---------------------------------------------------------------------------
# B46 — USD per tonne, keyed on size x grade
# ---------------------------------------------------------------------------

def _grade_of(row):
    for f in GRADE_FIELDS:
        v = _s(row.get(f))
        if v:
            return v
    return ""


def resolve_rate(rules, size_category, grade, header_rate=0.0):
    """The rate for one block, in his order of precedence:

        1. an exact (size x grade) rule            — "price varies for each size and grade"
        2. a grade rule marked as priced across sizes — "sometimes price only on grade"
        3. a size rule with no grade                — the flat size rate
        4. the header unit_rate                     — what the invoice used before any of this

    Returns (rate, how) so the invoice can say which rule paid."""
    size_category, grade = _s(size_category), _s(grade)

    for r in rules:
        if _s(r.get("size_category")) == size_category and _s(r.get("grade")) == grade \
                and size_category and grade:
            return flt(r.get("rate_per_mt")), "size+grade"
    for r in rules:
        if grade and _s(r.get("grade")) == grade and cint(r.get("applies_across_sizes")):
            return flt(r.get("rate_per_mt")), "grade across sizes"
    for r in rules:
        if size_category and _s(r.get("size_category")) == size_category and not _s(r.get("grade")):
            return flt(r.get("rate_per_mt")), "size"
    return flt(header_rate), "header rate"


def compute_size_rates(doc, method=None):
    """Rebuild `size_rates` on a Shipping Document: one row per (size, grade)
    combination actually present, with its own tonnage, rate and amount, and a
    grand total that is the sum of them.

    Runs on validate, after carry_sizes, so it always rates the sizes the
    document is actually carrying — overridden or not."""
    try:
        if not doc.meta.has_field("size_rates"):
            return
        blocks = doc.get("blocks") or []
        if not blocks:
            return

        existing = [r.as_dict() for r in (doc.get("size_rates") or [])]
        header_rate = flt(doc.get("unit_rate"))

        groups = {}
        for b in blocks:
            size = _s(b.get(SIZE_FIELD)) or size_category_for(
                b.get("length"), b.get("width"), b.get("height"), b.get("net_volume"))
            grade = _grade_of(b)
            ton = flt(b.get("net_tonnage"))
            if not ton:
                vol = flt(b.get("net_volume")) or round(
                    flt(b.get("length")) * flt(b.get("width")) * flt(b.get("height")) / 1e6, 3)
                ton = round(vol * 2.6, 3)
            k = (size or "(no size)", grade or "")
            g = groups.setdefault(k, {"blocks": 0, "mt": 0.0, "cbm": 0.0})
            g["blocks"] += 1
            g["mt"] += ton
            g["cbm"] += flt(b.get("net_volume"))

        doc.set("size_rates", [])
        total = 0.0
        for (size, grade), g in sorted(groups.items()):
            rate, how = resolve_rate(existing, size, grade, header_rate)
            mt = round(g["mt"], 3)
            amount = round(mt * flt(rate), 2)
            total += amount
            r = doc.append("size_rates", {})
            r.size_category = None if size == "(no size)" else size
            if r.meta.has_field("grade"):
                r.grade = grade
            r.block_count = g["blocks"]
            r.net_mt = mt
            r.rate_per_mt = flt(rate)
            r.amount_usd = amount
            if r.meta.has_field("applies_across_sizes") and how == "grade across sizes":
                r.applies_across_sizes = 1

        total = round(total, 2)
        if doc.meta.has_field("invoice_value"):
            doc.invoice_value = total
        if doc.meta.has_field("total_net_tonnage"):
            doc.total_net_tonnage = round(sum(flt(b.get("net_tonnage")) for b in blocks), 3)
        if doc.meta.has_field("total_cbm"):
            doc.total_cbm = round(sum(flt(b.get("net_volume")) for b in blocks), 3)
        if doc.meta.has_field("total_net_kgs"):
            doc.total_net_kgs = cint(round(flt(doc.get("total_net_tonnage")) * 1000))
        if doc.meta.has_field("block_count"):
            doc.block_count = len(blocks)

        tax = round(total * flt(doc.get("tax_rate")) / 100.0, 2) if doc.meta.has_field("tax_rate") else 0.0
        if doc.meta.has_field("tax_amount"):
            doc.tax_amount = tax
        if doc.meta.has_field("invoice_total"):
            doc.invoice_total = round(total + tax, 2)
        if doc.meta.has_field("invoice_value_inr") and flt(doc.get("exchange_rate")):
            doc.invoice_value_inr = round(total * flt(doc.get("exchange_rate")), 2)

        missing = [k for k in groups if k[0] == "(no size)"]
        if missing:
            frappe.msgprint(
                "{0} block(s) have no size category, so they are rated at the header rate. "
                "Their measurements are present — the category can be filled from them."
                .format(sum(groups[k]["blocks"] for k in missing)),
                alert=True, indicator="orange")
    except Exception:
        frappe.log_error(frappe.get_traceback(), "Dolphin compute_size_rates")


@frappe.whitelist()
def rate_breakdown(shipping_document=None):
    """The per-size, per-grade breakdown with its grand total — for the screen
    and for checking the arithmetic without opening the form."""
    d = frappe.get_doc("Shipping Document", shipping_document)
    rows = []
    for r in (d.get("size_rates") or []):
        rows.append({
            "size_category": _s(r.get("size_category")),
            "grade": _s(r.get("grade")),
            "across_sizes": cint(r.get("applies_across_sizes")),
            "blocks": cint(r.get("block_count")),
            "net_mt": flt(r.get("net_mt")),
            "rate_per_mt": flt(r.get("rate_per_mt")),
            "amount_usd": flt(r.get("amount_usd")),
            "check": round(flt(r.get("net_mt")) * flt(r.get("rate_per_mt")), 2),
        })
    grand = round(sum(x["amount_usd"] for x in rows), 2)
    return {
        "rows": rows,
        "grand_total": grand,
        "invoice_value": flt(d.get("invoice_value")),
        "agrees": abs(grand - flt(d.get("invoice_value"))) < 0.05,
        "total_net_tonnage": flt(d.get("total_net_tonnage")),
        "sum_of_rows_mt": round(sum(x["net_mt"] for x in rows), 3),
        "note": "size_category is the A size / B size band. grade is the A grade / "
                "B grade quality. They are separate axes and both are shown.",
    }


# ===========================================================================
# THE INVOICE IS THE SIZE MASTER.  31 Aug 2026
#
# [stated] "I was struggling to find a right way to ascertain how to make or
#  decide a size master? the answer I realised is whatever is decided on the
#  invoice will be the correct for the respective buyer. Whatever is there in
#  stock and sizes defined there is a fair indicator of sizes"
#
# So nobody dictates the bands in advance. Every block a buyer accepted at a
# size on an invoice IS their rule; the smallest one they took is the floor they
# agreed to. This reads that back and offers to save it — with the count it was
# learned from, so a single odd block that slipped through once is visible
# rather than silently dragging the floor down.
#
# Measured on his own data the day this was written: the house rule says A is
# 190 x 80 x 50, and XIAMEN BLESS TRADING CO.,LTD have never accepted an A
# smaller than 207 x 92 x 59 across 58 blocks on two invoices. The generic band
# would pass them stone they have never once taken.
# ===========================================================================

def _buyer_name(consignee):
    try:
        n = _s(frappe.db.get_value("Export Consignee", consignee, "company_name"))
        if n:
            return n
    except Exception:
        pass
    return _s(consignee)


@frappe.whitelist()
def size_rules():
    """Every size rule that exists: the house one, and one per buyer/variation."""
    try:
        rows = frappe.get_all(
            "Granite Size Category", filters={"is_active": 1},
            fields=["name", "size_category_name", "size_group", "min_length",
                    "min_width", "min_height", "min_volume", "buyer",
                    "export_consignee", "variation_label", "sort_order"],
            limit_page_length=0)
    except Exception:
        return []
    groups = {}
    for r in rows:
        owner = _s(r.get("export_consignee")) or _s(r.get("buyer"))
        key = (owner, _s(r.get("variation_label")))
        groups.setdefault(key, []).append(r)
    out = []
    for (owner, var), rs in groups.items():
        rs.sort(key=lambda x: (cint(x.get("sort_order")) or 99))
        out.append({
            "consignee": owner,
            "buyer_name": _buyer_name(owner) if owner else "",
            "variation": var,
            "label": (("house rule (A / B / C)") if not owner
                      else _buyer_name(owner) + (" · " + var if var else "")),
            "sizes": [{"size": _s(x.get("size_category_name")) or _s(x.get("name")),
                       "min_length": cint(x.get("min_length")),
                       "min_width": cint(x.get("min_width")),
                       "min_height": cint(x.get("min_height")),
                       "min_volume": flt(x.get("min_volume")),
                       "row": _s(x.get("name"))} for x in rs],
        })
    out.sort(key=lambda g: (0 if not g["consignee"] else 1, g["label"]))
    return out


@frappe.whitelist()
def learned_size_rule(consignee=None):
    """What this buyer has actually accepted, read off their own invoices."""
    consignee = _s(consignee)
    if not consignee:
        frappe.throw("Which buyer?")
    # 31 Aug 2026. [stated] "it doesnt matter till the shipping docs whatever may
    # be the size category.. but thumbrule in general is size as per previous
    # shipping docs for that consignee".
    #
    # So the newest document first: its bands ARE the thumb rule. The figures
    # across every document they have taken are reported beside it, because the
    # two can differ and the difference is worth seeing before either is saved.
    docs = frappe.get_all("Shipping Document",
                          filters={"export_consignee": consignee},
                          fields=["name", "docstatus", "shipment_date", "creation"],
                          # Frappe validates the order_by field format, so no
                          # ifnull() here - it refuses the whole query. Newest
                          # shipment date first, and creation breaks the tie for
                          # a document that has no date yet.
                          order_by="shipment_date desc, creation desc",
                          limit_page_length=0)
    seen, sizes, latest = [], {}, {}
    for d in docs:
        try:
            sd = frappe.get_doc("Shipping Document", d.name)
        except Exception:
            continue
        n = 0
        for b in (sd.get("blocks") or []):
            l, w, h = flt(b.get("length")), flt(b.get("width")), flt(b.get("height"))
            if not (l and w and h):
                continue
            cat = _s(b.get(SIZE_FIELD))
            if not cat:
                continue
            v = flt(b.get("net_volume")) or round(l * w * h / 1e6, 3)
            k = sizes.setdefault(cat, {"n": 0, "min_l": l, "min_w": w, "min_h": h,
                                       "min_v": v, "max_l": l, "max_w": w, "max_h": h})
            k["n"] += 1
            k["min_l"] = min(k["min_l"], l); k["max_l"] = max(k["max_l"], l)
            k["min_w"] = min(k["min_w"], w); k["max_w"] = max(k["max_w"], w)
            k["min_h"] = min(k["min_h"], h); k["max_h"] = max(k["max_h"], h)
            k["min_v"] = min(k["min_v"], v)
            n += 1
        if n:
            seen.append({"document": d.name, "blocks": n,
                         "date": _s(d.get("shipment_date"))[:10],
                         "submitted": cint(d.docstatus) == 1})
            if not latest:
                # the newest document that actually carries sized blocks
                latest = {"document": d.name, "date": _s(d.get("shipment_date"))[:10],
                          "sizes": {}}
                for b in (sd.get("blocks") or []):
                    l2, w2, h2 = (flt(b.get("length")), flt(b.get("width")),
                                  flt(b.get("height")))
                    c2 = _s(b.get(SIZE_FIELD))
                    if not (l2 and w2 and h2 and c2):
                        continue
                    k2 = latest["sizes"].setdefault(
                        c2, {"n": 0, "l": l2, "w": w2, "h": h2})
                    k2["n"] += 1
                    k2["l"] = min(k2["l"], l2); k2["w"] = min(k2["w"], w2)
                    k2["h"] = min(k2["h"], h2)
    house = {c.get("size_category_name") or c["name"]:
             (cint(c.get("min_length")), cint(c.get("min_width")), cint(c.get("min_height")))
             for c in _categories()}
    out = []
    for cat, k in sorted(sizes.items()):
        h_l, h_w, h_h = house.get(cat, (0, 0, 0))
        out.append({
            "size": cat, "blocks": k["n"],
            "smallest_accepted": [int(k["min_l"]), int(k["min_w"]), int(k["min_h"])],
            "largest": [int(k["max_l"]), int(k["max_w"]), int(k["max_h"])],
            "smallest_cbm": round(k["min_v"], 3),
            "house_rule": [h_l, h_w, h_h],
            "stricter_than_house": [int(k["min_l"]) - h_l, int(k["min_w"]) - h_w,
                                    int(k["min_h"]) - h_h],
        })
    thumb = []
    for cat, k in sorted((latest.get("sizes") or {}).items()):
        thumb.append({"size": cat, "blocks": k["n"],
                      "smallest_accepted": [int(k["l"]), int(k["w"]), int(k["h"])]})
    return {"consignee": consignee, "buyer_name": _buyer_name(consignee),
            "from_documents": seen,
            "blocks_read": sum(s["blocks"] for s in out),
            "thumb_rule": {"document": latest.get("document"),
                           "date": latest.get("date"), "sizes": thumb},
            "sizes": out,
            "note": "The thumb rule is their PREVIOUS shipping document. The figures "
                    "under 'sizes' are the floor across every document they have "
                    "taken - shown beside it because the two can differ, and the "
                    "smallest ever accepted is a floor, not a promise."}


# ===========================================================================
# SIZES BELONG TO THE SHIPMENT.  1 Sep 2026
#
# [stated] "dont link sizes to any consignee in the invoices at all let it be
#  standard one set editable for every shipment? everything wil be on record
#  everything in shipping documents"
#
# `save_size_rule` used to write a rule OWNED BY A BUYER into the master. He
# removed that idea, so it is gone: what replaces it writes bands onto ONE
# document, re-sorts that document's blocks, and records what moved, who moved
# it and why - inside the shipping document, where he asked for it.
# ===========================================================================


@frappe.whitelist()
def save_size_rule(**kwargs):
    frappe.throw("Sizes are not saved against a buyer any more - his instruction of "
                 "1 Sep 2026. Set the bands on the shipping document itself "
                 "(sizing.set_bands) - and the lot owns them, his decision of 1 Sep 2026.")


def _parse_bands(bands):
    """Accept a list of dicts or the JSON the panel posts."""
    if isinstance(bands, str):
        try:
            bands = json.loads(bands)
        except Exception:
            frappe.throw("Could not read the bands that were sent.")
    out = []
    order = {"A": 1, "B": 2, "B1": 3, "B2": 4, "C": 5}
    for b in (bands or []):
        name = _s(b.get("size_category_name") or b.get("size"))
        if not name:
            continue
        out.append({"size_category_name": name,
                    "min_length": cint(b.get("min_length")),
                    "min_width": cint(b.get("min_width")),
                    "min_height": cint(b.get("min_height")),
                    "sort_order": cint(b.get("sort_order")) or order.get(name, 9)})
    out.sort(key=lambda r: r["sort_order"])
    return out


def _resort(doc, bands):
    """Put every block in the band its measurements earn. Returns what moved.

    Touches the SIZE field only. It does not read a grade and it does not write
    one - 1 Sep 2026, [stated] "grade is independednt of size"."""
    moved = []
    for b in (doc.get("blocks") or []):
        l, w, h = flt(b.get("length")), flt(b.get("width")), flt(b.get("height"))
        if not (l and w and h):
            continue
        was = _s(b.get(SIZE_FIELD))
        now = size_category_for(l, w, h, b.get("net_volume"), bands=bands)
        if now and now != was:
            moved.append({"block": _s(b.get("export_block_no")) or _s(b.get("block_no")),
                          "row": _s(b.name), "from": was or "(none)", "to": now})
            b.set(SIZE_FIELD, now)
    return moved


def _marginal_map(doc, bands, tol):
    """Which blocks missed a higher band, and by how much. One definition, used
    by the panel and by marginal_blocks alike."""
    order = {"A": 1, "B": 2, "B1": 3, "B2": 4, "C": 5}

    def rank(c):
        return order.get(_s(c), 9)

    out = {}
    for b in (doc.get("blocks") or []):
        l, w, h = flt(b.get("length")), flt(b.get("width")), flt(b.get("height"))
        if not (l and w and h):
            continue
        now = _s(b.get(SIZE_FIELD))
        for c in bands:
            cat = _s(c.get("size_category_name")) or _s(c.get("name"))
            if rank(cat) >= rank(now):
                continue
            ml, mw, mh = (cint(c.get("min_length")), cint(c.get("min_width")),
                          cint(c.get("min_height")))
            short = []
            if l < ml:
                short.append(("L", ml - l))
            if w < mw:
                short.append(("W", mw - w))
            if h < mh:
                short.append(("H", mh - h))
            if not short or max(d for _, d in short) > tol:
                continue
            out[_s(b.name)] = {
                "could_be": cat,
                "worst_cm": int(round(max(d for _, d in short))),
                "short_by": ", ".join("{0} {1} cm".format(k, int(round(d))) for k, d in short),
            }
            break
    return out


# ---------------------------------------------------------------------------
# ONE PANEL, TWO DOCTYPES.  1 Sep 2026
#
# The Export Shipment Lot owns the thresholds and the grades. The Shipping
# Document reads them. Both draw the same panel, so there is one screen to
# understand and one set of rules behind it.
# ---------------------------------------------------------------------------

PANEL_DOCTYPES = ("Export Shipment Lot", "Shipping Document")


def _doc_for_panel(doctype, name):
    doctype, name = _s(doctype), _s(name)
    if doctype not in PANEL_DOCTYPES:
        frappe.throw("Sizes are set on the Export Shipment Lot, and read on the "
                     "Shipping Document. Nothing else.")
    if not name:
        frappe.throw("Which document?")
    return frappe.get_doc(doctype, name)


def _blocks_of(doc):
    return doc.get("blocks") or []


@frappe.whitelist()
def panel(doctype=None, name=None):
    """Everything both screens draw, in one read. Changes nothing."""
    doc = _doc_for_panel(doctype, name)
    is_lot = doc.doctype == "Export Shipment Lot"
    lot = None if is_lot else _lot_of(doc)
    override = (not is_lot) and bool(cint(doc.get("size_override")))

    bands = bands_for(doc)
    tol = tolerance_for(doc)
    marg = _marginal_map(doc, bands, tol)

    # where the thresholds are being edited, in plain words
    if is_lot:
        owner = {"doctype": "Export Shipment Lot", "name": doc.name, "editable": True}
    elif override:
        owner = {"doctype": "Shipping Document", "name": doc.name, "editable": True}
    elif lot is not None:
        owner = {"doctype": "Export Shipment Lot", "name": lot.name, "editable": False}
    else:
        owner = {"doctype": None, "name": None, "editable": False}

    std = {}
    for c in _standard_bands():
        std[_s(c.get("size_category_name")) or _s(c.get("name"))] = [
            cint(c.get("min_length")), cint(c.get("min_width")), cint(c.get("min_height"))]

    counts, blocks, graded, filled, unsized = {}, [], [], 0, []
    grade_doc = lot if (lot is not None and not override) else doc
    for b in _blocks_of(doc):
        cat = _s(b.get(SIZE_FIELD))
        if cat:
            counts[cat] = counts.get(cat, 0) + 1
        no = _s(b.get("export_block_no")) or _s(b.get("block_no"))
        l, w, h = flt(b.get("length")), flt(b.get("width")), flt(b.get("height"))
        if l and w and h and not size_category_for(l, w, h, bands=bands):
            unsized.append(no)
        blocks.append({
            "row": _s(b.name), "block": no,
            "size": [int(l), int(w), int(h)],
            "category": cat,
            "marginal": marg.get(_s(b.name)),
        })
        # grade, gathered on the same pass and on nothing else. It is not read
        # from a measurement and never written from one.
        g = _s(b.get("grade"))
        if g:
            filled += 1
        graded.append({"row": _s(b.name), "block": no, "grade": g})

    tally = {}
    for r in graded:
        if r["grade"]:
            tally[r["grade"]] = tally.get(r["grade"], 0) + 1

    return {
        "doctype": doc.doctype, "name": doc.name,
        "is_lot": is_lot,
        "lot": (lot.name if lot is not None else None),
        "override": override,
        "owner": owner,
        "frozen": _s(doc.get("export_status")) == "Exported" or cint(doc.docstatus) == 1,
        "bands": [{"size": _s(b.get("size_category_name")) or _s(b.get("name")),
                   "min_length": cint(b.get("min_length")),
                   "min_width": cint(b.get("min_width")),
                   "min_height": cint(b.get("min_height")),
                   "blocks": counts.get(_s(b.get("size_category_name")) or _s(b.get("name")), 0)}
                  for b in bands],
        "standard": std,
        "tolerance_cm": tol,
        "blocks": blocks,
        "marginal_count": len(marg),
        "unsized": unsized,
        "grade": {
            "on": bool(cint((grade_doc or doc).get("record_grade"))),
            "options": list(GRADES),
            "blocks": graded, "filled": filled, "total": len(graded), "tally": tally,
        },
        "note": "The thresholds belong to the lot. This document reads them unless a "
                "person has ticked the final change.",
    }


@frappe.whitelist()
def set_bands(doctype=None, name=None, bands=None, tolerance_cm=None,
              reason=None, person=None, dry_run=1):
    """Write the thresholds and re-sort. Refuses on a document that is only
    reading the lot - there is one place to change them, and this says so."""
    dry = _s(dry_run) not in ("0", "false", "False", "")
    doc = _doc_for_panel(doctype, name)
    if doc.doctype == "Shipping Document" and not cint(doc.get("size_override")):
        frappe.throw("This document is reading {0}. Change the thresholds on the lot, "
                     "or tick the final change to give this document its own copy.".format(
                         _s(doc.get("source_lot")) or "its lot"))
    want = _parse_bands(bands)
    if not want:
        frappe.throw("No thresholds were given.")
    if not dry and len(_s(reason)) < 6:
        frappe.throw("Say why - it is written onto the document.")

    before = [{"size": b["size_category_name"],
               "was": [b["min_length"], b["min_width"], b["min_height"]]}
              for b in _band_rows(doc)]
    moved = _resort(doc, want)
    nowhere = []
    for b in _blocks_of(doc):
        l, w, h = flt(b.get("length")), flt(b.get("width")), flt(b.get("height"))
        if l and w and h and not size_category_for(l, w, h, bands=want):
            nowhere.append(_s(b.get("export_block_no")) or _s(b.get("block_no")))
    if dry:
        return {"dry_run": True, "document": doc.name, "bands": want, "before": before,
                "would_move": moved, "count": len(moved), "unsized": nowhere}

    doc.set("size_bands", [])
    for b in want:
        doc.append("size_bands", b)
    if tolerance_cm not in (None, "") and doc.meta.has_field("size_tolerance_cm"):
        doc.set("size_tolerance_cm", cint(tolerance_cm))
    doc.flags.ignore_mandatory = True
    doc.save(ignore_permissions=True)
    try:
        line = ", ".join("{0} >= {1} x {2} x {3}".format(
            b["size_category_name"], b["min_length"], b["min_width"], b["min_height"])
            for b in want)
        doc.add_comment("Comment", "Size thresholds set to {0}. {1}{2}. Recorded by {3}. {4}".format(
            line,
            ("; ".join("{0} {1} -> {2}".format(m["block"], m["from"], m["to"])
                       for m in moved[:12]) or "no block changed size"),
            (" (+{0} more)".format(len(moved) - 12) if len(moved) > 12 else ""),
            _s(person) or frappe.session.user, _s(reason)))
    except Exception:
        pass
    frappe.db.commit()
    return {"ok": True, "document": doc.name, "bands": want, "before": before,
            "moved": moved, "count": len(moved), "unsized": nowhere}


@frappe.whitelist()
def reset_bands(doctype=None, name=None, reason=None, person=None, dry_run=1):
    return set_bands(doctype=doctype, name=name, bands=_standard_as_bands(),
                     reason=reason or "Reset to the standard set.",
                     person=person, dry_run=dry_run)


@frappe.whitelist()
def set_override(shipping_document=None, on=None, reason=None, person=None):
    """Tick: the document takes its own copy of the lot's thresholds and stops
    following it. Untick: it goes back to the lot and the copy is dropped."""
    doc = _doc_for_panel("Shipping Document", shipping_document)
    val = 1 if _s(on) not in ("0", "false", "False", "") else 0
    if val:
        lot = _lot_of(doc)
        src = _band_rows(lot) if lot is not None else []
        doc.set("size_bands", [])
        for b in (src or _standard_as_bands()):
            doc.append("size_bands", {
                "size_category_name": b.get("size_category_name") or b.get("name"),
                "min_length": cint(b.get("min_length")),
                "min_width": cint(b.get("min_width")),
                "min_height": cint(b.get("min_height")),
                "sort_order": cint(b.get("sort_order")) or 99})
        if lot is not None and doc.meta.has_field("size_tolerance_cm"):
            doc.set("size_tolerance_cm", cint(lot.get("size_tolerance_cm")) or MARGINAL_CM)
    else:
        doc.set("size_bands", [])
    doc.set("size_override", val)
    doc.flags.ignore_mandatory = True
    doc.save(ignore_permissions=True)
    try:
        doc.add_comment("Comment", ("Final change switched {0} by {1}. {2} {3}").format(
            "on" if val else "off", _s(person) or frappe.session.user,
            ("This document now carries its own copy of the thresholds and no longer "
             "follows the lot." if val else
             "This document is following its lot again."), _s(reason)))
    except Exception:
        pass
    frappe.db.commit()
    return {"ok": True, "document": doc.name, "override": bool(val)}


@frappe.whitelist()
def set_sizes(doctype=None, name=None, rows=None, to_size=None, agreed_by=None,
              reason=None, person=None, dry_run=1):
    """Bulk. Tick blocks, choose one size, apply. A person decides this - the
    app only ever sorts and highlights, his rule of 31 Aug."""
    dry = _s(dry_run) not in ("0", "false", "False", "")
    doc = _doc_for_panel(doctype, name)
    to_size = _s(to_size)
    if isinstance(rows, str):
        try:
            rows = json.loads(rows)
        except Exception:
            frappe.throw("Could not read the blocks that were ticked.")
    rows = [_s(r) for r in (rows or []) if _s(r)]
    if not rows or not to_size:
        frappe.throw("Tick some blocks and choose a size.")
    if not dry and len(_s(agreed_by)) < 2:
        frappe.throw("Name the person at the buyer who agreed - that name is the whole "
                     "point of a change rather than an edit.")
    changed, same = [], 0
    for b in _blocks_of(doc):
        if _s(b.name) not in rows:
            continue
        was = _s(b.get(SIZE_FIELD))
        if was == to_size:
            same += 1
            continue
        changed.append({"row": _s(b.name),
                        "block": _s(b.get("export_block_no")) or _s(b.get("block_no")),
                        "from": was or "(none)", "to": to_size})
        if not dry:
            if b.meta.has_field("size_promoted_from") and not _s(b.get("size_promoted_from")):
                b.set("size_promoted_from", was)
            if b.meta.has_field("size_consent_by"):
                b.set("size_consent_by", _s(agreed_by))
            if b.meta.has_field("size_consent_on"):
                b.set("size_consent_on", frappe.utils.now())
            b.set(SIZE_FIELD, to_size)
    if dry:
        return {"dry_run": True, "changed": changed, "count": len(changed),
                "already": same, "to": to_size}
    doc.flags.ignore_mandatory = True
    doc.save(ignore_permissions=True)
    try:
        doc.add_comment("Comment", "{0} block(s) set to size {1} ({2} already were), "
                                   "agreed by {3}, recorded by {4}. {5} {6}".format(
            len(changed), to_size, same, _s(agreed_by),
            _s(person) or frappe.session.user,
            "; ".join("{0} {1}->{2}".format(c["block"], c["from"], c["to"])
                      for c in changed[:20]),
            ("(+{0} more)".format(len(changed) - 20) if len(changed) > 20 else "")))
    except Exception:
        pass
    frappe.db.commit()
    return {"ok": True, "changed": changed, "count": len(changed), "already": same}


# ===========================================================================
# GRADE.  A SEPARATE THING, ON PURPOSE.  1 Sep 2026
#
# [stated] "no grade is independednt of size so grade is independednt"
#
# Nothing below reads a measurement or a size, and nothing in the size code
# above reads a grade. Re-sorting the thresholds moves no grade; setting a
# grade moves no size. No pairing is checked, warned about or blocked.
#
# [stated] "rather than selecting 100 times I will multi select the blocks and
#  select Grade A etc" - so the bulk action IS the way to grade, not a
# convenience beside a per-row box.
#
# [stated] "for internal purpose only it shouldnt be reflecting on shipping
#  documents" - it reaches no print format, on the lot or on the document.
# ===========================================================================


@frappe.whitelist()
def set_grade_recording(doctype=None, name=None, on=None, person=None):
    """The tick. Off by default; turning it off keeps whatever was recorded."""
    doc = _doc_for_panel(doctype, name)
    val = 1 if _s(on) not in ("0", "false", "False", "") else 0
    doc.set("record_grade", val)
    doc.flags.ignore_mandatory = True
    doc.save(ignore_permissions=True)
    try:
        doc.add_comment("Comment", "Grade recording switched {0} by {1}. Internal only "
                                   "- not printed.".format(
                                       "on" if val else "off",
                                       _s(person) or frappe.session.user))
    except Exception:
        pass
    frappe.db.commit()
    return {"ok": True, "document": doc.name, "on": bool(val)}


@frappe.whitelist()
def set_grades(doctype=None, name=None, rows=None, grade=None, person=None, dry_run=1):
    """Bulk. Tick blocks, choose one grade, apply. Blank clears."""
    dry = _s(dry_run) not in ("0", "false", "False", "")
    doc = _doc_for_panel(doctype, name)
    grade = _s(grade)
    if grade and grade not in GRADES:
        frappe.throw("Grade must be one of {0}, or blank.".format(", ".join(GRADES)))
    if isinstance(rows, str):
        try:
            rows = json.loads(rows)
        except Exception:
            frappe.throw("Could not read the blocks that were ticked.")
    rows = [_s(r) for r in (rows or []) if _s(r)]
    if not rows:
        frappe.throw("Tick some blocks first.")
    changed, same = [], 0
    for b in _blocks_of(doc):
        if _s(b.name) not in rows:
            continue
        was = _s(b.get("grade"))
        if was == grade:
            same += 1
            continue
        changed.append({"row": _s(b.name),
                        "block": _s(b.get("export_block_no")) or _s(b.get("block_no")),
                        "from": was or "(none)", "to": grade or "(none)"})
        if not dry:
            b.set("grade", grade)
    if dry:
        return {"dry_run": True, "changed": changed, "count": len(changed),
                "already": same, "to": grade}
    doc.flags.ignore_mandatory = True
    doc.save(ignore_permissions=True)
    try:
        doc.add_comment("Comment", "{0} block(s) graded {1} ({2} already were), by {3}. "
                                   "Internal only - not printed. {4}{5}".format(
            len(changed), grade or "(cleared)", same,
            _s(person) or frappe.session.user,
            "; ".join("{0} {1}->{2}".format(c["block"], c["from"], c["to"])
                      for c in changed[:20]),
            ("(+{0} more)".format(len(changed) - 20) if len(changed) > 20 else "")))
    except Exception:
        pass
    frappe.db.commit()
    return {"ok": True, "changed": changed, "count": len(changed), "already": same}


# ===========================================================================
# THE MARGINAL ONES.  31 Aug 2026
#
# [stated] "if the defined size 190*80*50 threshold equals or more is A and rest
#  C. If you come across blocks with 2-3 cms variation eg: 188*200*100,
#  220*77*100 etc you can highlight them so that if buyer consents will be
#  pushed to higer price band like A size etc"
#
# So the sort keeps doing its job, and the only blocks it asks about are the
# ones that missed the higher band by a hair. Three centimetres by default,
# his figure. A block that misses on two dimensions is still marginal if both
# shortfalls are inside the tolerance - it is the size of the miss that matters,
# not how many sides missed.
#
# Nothing is promoted by the app. [stated] "it will be decided by the person who
# is making the shipping documents only after taking buyer's consent.. we cannot
# or app cannot decide it should still go by the defined rules" - so the sort
# always follows the bands, the app only ever HIGHLIGHTS, and a promotion is a
# person recording that the buyer agreed.
#
# [stated] "nothing should reflect in the printout you can take note in the
# shipping documents" - so the consent is a note on the document and NOTHING
# reaches the invoice or the packing list. No footnote, no marker, no change to
# either print format.
# ===========================================================================


@frappe.whitelist()
def marginal_blocks(shipping_document=None, tolerance_cm=None):
    """Blocks that missed a higher size band by no more than the tolerance."""
    name = _s(shipping_document)
    if not name:
        frappe.throw("Which shipping document?")
    doc = frappe.get_doc("Shipping Document", name)
    tol = (cint(tolerance_cm) if tolerance_cm not in (None, "")
           else (cint(doc.get("size_tolerance_cm")) or MARGINAL_CM))
    bands = bands_for(doc)
    order = {"A": 1, "B": 2, "B1": 3, "B2": 4, "C": 5}

    def rank(cat):
        return order.get(_s(cat), 9)

    out = []
    for b in (doc.get("blocks") or []):
        l, w, h = flt(b.get("length")), flt(b.get("width")), flt(b.get("height"))
        if not (l and w and h):
            continue
        now = _s(b.get(SIZE_FIELD))
        for c in bands:
            cat = _s(c.get("size_category_name")) or _s(c.get("name"))
            if rank(cat) >= rank(now):
                continue          # only ever look UPWARDS
            ml, mw, mh = (cint(c.get("min_length")), cint(c.get("min_width")),
                          cint(c.get("min_height")))
            short = []
            if l < ml:
                short.append(("length", ml - l))
            if w < mw:
                short.append(("width", mw - w))
            if h < mh:
                short.append(("height", mh - h))
            if not short:
                continue          # it clears; the sort would have put it here
            if max(d for _, d in short) > tol:
                continue          # not marginal, genuinely smaller
            out.append({
                "row": _s(b.name),
                "block": _s(b.get("export_block_no")) or _s(b.get("block_no")),
                "size": [int(l), int(w), int(h)],
                "now": now, "could_be": cat,
                "short_by": [{"side": k, "cm": int(round(d))} for k, d in short],
                "worst_cm": int(round(max(d for _, d in short))),
                "band": [ml, mw, mh],
                "net_tonnage": flt(b.get("net_tonnage")),
            })
            break
    out.sort(key=lambda x: x["worst_cm"])
    return {"document": name, "tolerance_cm": tol,
            "sizes_by": rule_in_force(doc),
            "count": len(out), "blocks": out,
            "note": "These missed the higher band by {0} cm or less. Nothing moves "
                    "unless a person records that the buyer agreed.".format(tol)}


@frappe.whitelist()
def promote_block_size(shipping_document=None, row=None, to_size=None,
                       agreed_by=None, reason=None, person=None, dry_run=1):
    """Move one block up a band because the buyer said yes. Reversible."""
    dry = _s(dry_run) not in ("0", "false", "False", "")
    name, row, to_size = _s(shipping_document), _s(row), _s(to_size)
    if not (name and row and to_size):
        frappe.throw("Which document, which row, and to which size?")
    if not dry and len(_s(agreed_by)) < 2:
        frappe.throw("Name the person at the buyer who agreed - that name is the "
                     "whole point of a promotion rather than an edit.")
    doc = frappe.get_doc("Shipping Document", name)
    if cint(doc.docstatus) == 1:
        frappe.throw("{0} is submitted. A filed document is not edited behind its "
                     "own back.".format(name))
    target = None
    for b in (doc.get("blocks") or []):
        if _s(b.name) == row:
            target = b
            break
    if target is None:
        frappe.throw("That row is not on {0}.".format(name))
    was = _s(target.get(SIZE_FIELD))
    if dry:
        return {"dry_run": True, "document": name,
                "block": _s(target.get("export_block_no")) or _s(target.get("block_no")),
                "from": was, "to": to_size}
    if target.meta.has_field("size_promoted_from") and not _s(target.get("size_promoted_from")):
        target.set("size_promoted_from", was)
    if target.meta.has_field("size_consent_by"):
        target.set("size_consent_by", _s(agreed_by))
    if target.meta.has_field("size_consent_on"):
        target.set("size_consent_on", frappe.utils.now())
    target.set(SIZE_FIELD, to_size)
    doc.flags.ignore_mandatory = True
    doc.save(ignore_permissions=True)
    try:
        doc.add_comment("Comment",
                        "Block {0} moved from {1} to {2} with the buyer's consent - "
                        "agreed by {3}, recorded by {4}. {5}".format(
                            _s(target.get("export_block_no")) or _s(target.get("block_no")),
                            was or "(none)", to_size, _s(agreed_by),
                            person or frappe.session.user, _s(reason)))
    except Exception:
        pass
    frappe.db.commit()
    return {"ok": True, "document": name,
            "block": _s(target.get("export_block_no")) or _s(target.get("block_no")),
            "from": was, "to": to_size, "agreed_by": _s(agreed_by)}
