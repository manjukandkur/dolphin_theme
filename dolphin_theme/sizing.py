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

def _categories(consignee=None, variation=None):
    """The bands in force — this buyer's own rule when they have one, else the house.

    31 Aug 2026. This used to end with

        rows = [r for r in rows if not cint(r.get("is_custom"))]

    which threw away every buyer-specific row before anything read them. The
    master has carried `buyer`, `export_consignee` and `variation_label` all
    along; that one line switched the whole capability off, so every buyer was
    judged by the house A/B/C whether it suited them or not.

    A rule is (buyer, variation). Blank variation is the buyer's main rule;
    "B grade" is their second one. Grade is never a column — it is part of the
    rule's name, which is his decision and the simpler one."""
    try:
        rows = frappe.get_all(
            "Granite Size Category",
            filters={"is_active": 1},
            fields=["name", "size_category_name", "min_length", "min_width",
                    "min_height", "min_volume", "max_volume", "sort_order",
                    "is_custom", "buyer", "export_consignee", "variation_label"],
            limit_page_length=0)
    except Exception:
        return []

    want_var = _s(variation)
    mine = []
    if consignee:
        key = _s(consignee)
        for r in rows:
            if _s(r.get("export_consignee")) != key and _s(r.get("buyer")) != key:
                continue
            if _s(r.get("variation_label")) != want_var:
                continue
            mine.append(r)
    if not mine:
        # the house rule: rows that belong to nobody in particular
        mine = [r for r in rows
                if not _s(r.get("export_consignee")) and not _s(r.get("buyer"))
                and not _s(r.get("variation_label"))]
    mine.sort(key=lambda r: (cint(r.get("sort_order")) or 99))
    return mine


def rule_in_force(consignee=None, variation=None):
    """One line of plain English naming the bands a document was sorted by."""
    rows = _categories(consignee, variation)
    if not rows:
        return "no size rule found"
    owned = any(_s(r.get("export_consignee")) or _s(r.get("buyer")) for r in rows)
    if not owned:
        return "house rule (A / B / C)"
    name = ""
    try:
        name = _s(frappe.db.get_value("Export Consignee", consignee, "company_name"))
    except Exception:
        name = ""
    name = name or _s(consignee)
    var = _s(variation)
    return name + (" · " + var if var else "") + " — own bands"


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
                      consignee=None, variation=None):
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
        bands = [(c.get("size_category_name") or c["name"],
                  flt(c.get("min_length")), flt(c.get("min_width")),
                  flt(c.get("min_height")), flt(c.get("min_volume")),
                  flt(c.get("max_volume"))) for c in _categories(consignee, variation)]

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


def fill_row(row, doctype, force=False, consignee=None, variation=None):
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
                                    consignee=consignee, variation=variation)
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
        filled = 0
        for tf in doc.meta.get_table_fields():
            child_dt = tf.options
            if child_dt not in DIMS:
                continue
            for row in (doc.get(tf.fieldname) or []):
                if override:
                    _note_override(row, child_dt)
                    continue
                if fill_row(row, child_dt, consignee=_doc_consignee(doc),
                            variation=_s(doc.get("size_variation"))):
                    filled += 1
        try:
            if doc.meta.has_field("size_rule_display"):
                doc.size_rule_display = rule_in_force(_doc_consignee(doc),
                                                      _s(doc.get("size_variation")))
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


@frappe.whitelist()
def save_size_rule(consignee=None, variation=None, cushion=0, reason=None,
                   person=None, dry_run=1):
    """Write what the invoices say into the master as this buyer's own rule.

    cushion: centimetres to subtract from every learned minimum, so one unusually
    small block that slipped through once does not become the rule. Nothing is
    written unless dry_run is 0, and every row records where the numbers came
    from."""
    dry = _s(dry_run) not in ("0", "false", "False", "")
    consignee = _s(consignee)
    variation = _s(variation)
    if not consignee:
        frappe.throw("Which buyer?")
    if not dry and len(_s(reason)) < 6:
        frappe.throw("Say why this rule is being saved - it is written onto every row.")
    learned = learned_size_rule(consignee)
    cush = cint(cushion)
    planned, done = [], []
    for s in learned.get("sizes") or []:
        l, w, h = s["smallest_accepted"]
        band = {"size": s["size"], "min_length": max(0, l - cush),
                "min_width": max(0, w - cush), "min_height": max(0, h - cush),
                "learned_from": s["blocks"]}
        planned.append(band)
        if dry:
            continue
        row_name = "{0}-{1}-{2}".format(consignee, variation or "main", s["size"])
        payload = {
            "doctype": "Granite Size Category",
            "size_category_name": s["size"],
            "size_group": s["size"] if s["size"] in ("A", "B", "C") else "Custom",
            "variation_label": variation,
            "export_consignee": consignee,
            "is_custom": 1, "is_active": 1,
            "min_length": band["min_length"], "min_width": band["min_width"],
            "min_height": band["min_height"],
            "sort_order": {"A": 1, "B": 2, "C": 3}.get(s["size"], 5),
            "description": ("Read from {0}'s own invoices - the smallest block they "
                            "accepted as {1}, over {2} block(s){3}. {4}").format(
                                _buyer_name(consignee), s["size"], s["blocks"],
                                (", less a {0} cm cushion".format(cush) if cush else ""),
                                _s(reason)),
        }
        try:
            if frappe.db.exists("Granite Size Category", row_name):
                d = frappe.get_doc("Granite Size Category", row_name)
                d.update({k: v for k, v in payload.items() if k != "doctype"})
                d.save(ignore_permissions=True)
            else:
                d = frappe.get_doc(payload)
                d.flags.ignore_mandatory = True
                d.insert(ignore_permissions=True, set_name=row_name)
            done.append(d.name)
        except Exception:
            frappe.log_error(frappe.get_traceback(), "save_size_rule")
    if not dry:
        frappe.db.commit()
    return {"dry_run": bool(dry), "consignee": consignee,
            "buyer_name": _buyer_name(consignee), "variation": variation,
            "cushion_cm": cush, "bands": planned, "written": done,
            "blocks_read": learned.get("blocks_read")}


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

MARGINAL_CM = 3


@frappe.whitelist()
def marginal_blocks(shipping_document=None, tolerance_cm=None):
    """Blocks that missed a higher size band by no more than the tolerance."""
    name = _s(shipping_document)
    if not name:
        frappe.throw("Which shipping document?")
    tol = cint(tolerance_cm) if tolerance_cm not in (None, "") else MARGINAL_CM
    doc = frappe.get_doc("Shipping Document", name)
    consignee = _doc_consignee(doc)
    variation = _s(doc.get("size_variation"))
    bands = _categories(consignee, variation)
    order = {"A": 1, "B": 2, "C": 3}

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
            "sizes_by": rule_in_force(consignee, variation),
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
