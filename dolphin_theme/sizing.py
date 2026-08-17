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

def _categories():
    """Active Granite Size Categories, largest thresholds first so the most
    specific band wins."""
    try:
        rows = frappe.get_all(
            "Granite Size Category",
            filters={"is_active": 1},
            fields=["name", "size_category_name", "min_length", "min_width",
                    "min_height", "min_volume", "max_volume", "sort_order", "is_custom"],
            limit_page_length=0)
    except Exception:
        return []
    rows = [r for r in rows if not cint(r.get("is_custom"))]
    rows.sort(key=lambda r: (cint(r.get("sort_order")) or 99))
    return rows


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


def size_category_for(length, width, height, volume=None, profile=None):
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
                  flt(c.get("max_volume"))) for c in _categories()]

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


def fill_row(row, doctype, force=False):
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
            cat = size_category_for(row.get(fl), row.get(fw), row.get(fh), row.get(fv))
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
                if fill_row(row, child_dt):
                    filled += 1
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
