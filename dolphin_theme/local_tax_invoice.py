import math

import frappe
from frappe.utils import flt

GST_RATE = 0.05


def compute_totals(doc, method=None):
    """Authoritative Local Tax Invoice totals (source of truth, git-versioned).

    Total (taxable) = rate x tons + DMG + freight. GST 5% is charged on the
    whole Total (CGST 2.5% + SGST 2.5% intra-state, or IGST 5% inter-state).
    Grand total = Total + GST, rounded. Runs on validate so the saved invoice
    is always correct regardless of client-side scripts. Respects allow_override.
    """
    if getattr(doc, "allow_override", 0):
        return

    qty = _qty(doc)
    rate = flt(doc.rate_per_mt)
    goods = qty * rate
    dmg = flt(doc.dmg_charges_per_ton) * qty
    freight = flt(doc.get("freight_charges"))
    taxable = goods + dmg + freight

    if doc.is_interstate:
        cgst = sgst = 0.0
        igst = taxable * GST_RATE
    else:
        igst = 0.0
        cgst = taxable * (GST_RATE / 2)
        sgst = taxable * (GST_RATE / 2)

    raw = taxable + cgst + sgst + igst
    grand = math.floor(raw + 0.5)

    doc.total_quantity_mt = qty
    doc.dmg_charges = dmg
    doc.taxable_value = taxable
    doc.cgst_amount = cgst
    doc.sgst_amount = sgst
    doc.igst_amount = igst
    doc.rounded_off = grand - raw
    doc.grand_total = grand


def _is_crude(doc):
    d = doc.get("description")
    if not d:
        return False
    return bool(frappe.db.get_value("Goods Description", d, "is_crude"))


def _qty(doc):
    if _is_crude(doc):
        return flt(doc.get("crude_qty_mt"))
    return sum(flt(b.quantity_mt) for b in (doc.get("blocks") or []))
