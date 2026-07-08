import frappe
from frappe.utils import flt, cint, strip_html

_STAGE = {
    "In Stock": "instock",
    "Buyer Marked": "bi",
    "In Delivery Challan": "dc",
    "Dispatched/Transported": "dc",
    "At Port": "port",
    "At Bannikoppa Station yard": "port",
    "Shipped": "shipped",
    "Sold": "shipped",
}


def _s(v):
    return "" if v is None else str(v).strip()


@frappe.whitelist()
def blocks_hub():
    """Lightweight list of every Quarry Block for the Blocks cockpit."""
    rows = frappe.get_all(
        "Quarry Block",
        fields=[
            "name", "block_number", "export_block_no", "granite_quality_grade",
            "length_gross", "width_gross", "height_gross", "gross_volume",
            "gross_tonnage", "port_net_wt", "tonnage_factor", "pit",
            "date_produced", "status", "source_quarry_inspection",
            "buyer_inspection", "delivery_challan",
        ],
        limit_page_length=0,
    )
    out = []
    for r in rows:
        cbm = flt(r.gross_volume) or (flt(r.length_gross) * flt(r.width_gross) * flt(r.height_gross) / 1e6)
        gross = flt(r.gross_tonnage) or (cbm * (flt(r.tonnage_factor) or 2.7))
        net = flt(r.port_net_wt) or gross
        out.append({
            "name": r.name,
            "block": _s(r.block_number),
            "exp": _s(r.export_block_no),
            "grade": _s(r.granite_quality_grade),
            "L": cint(r.length_gross), "W": cint(r.width_gross), "H": cint(r.height_gross),
            "cbm": round(cbm, 3), "mt": round(gross, 3), "net": round(net, 3),
            "pit": _s(r.pit), "produced": _s(r.date_produced),
            "status": _s(r.status), "stage": _STAGE.get(_s(r.status), "instock"),
            "qi": _s(r.source_quarry_inspection), "bi": _s(r.buyer_inspection),
            "dc": _s(r.delivery_challan),
        })
    return out


def _docdate(doctype, name):
    if not name:
        return ""
    try:
        meta = frappe.get_meta(doctype)
        for fld in ("posting_date", "inspection_date", "date", "creation"):
            if fld == "creation" or meta.has_field(fld):
                v = frappe.db.get_value(doctype, name, fld)
                if v:
                    return _s(v)[:10]
    except Exception:
        pass
    return ""


@frappe.whitelist()
def block_detail(name=None):
    """Full detail for one block: lifecycle dates + notes (comments)."""
    if not name:
        frappe.throw("No block given.")
    b = frappe.get_doc("Quarry Block", name)
    port_date = ""
    pab = frappe.get_all("Port Arrival Block", filters={"block_no": b.block_number},
                         fields=["parent"], limit=1)
    if pab:
        port_date = _s(frappe.db.get_value("Port Arrival", pab[0].parent, "arrival_date"))[:10]
    ship_date = ""
    try:
        slb = frappe.get_all("Shipment Lot Block", filters={"block_no": b.block_number},
                             fields=["parent"], limit=1)
        if slb:
            lm = frappe.get_meta("Export Shipment Lot")
            for f in ("ship_date", "shipment_date", "modified"):
                if f == "modified" or lm.has_field(f):
                    ship_date = _s(frappe.db.get_value("Export Shipment Lot", slb[0].parent, f))[:10]
                    break
    except Exception:
        pass
    notes = []
    for c in frappe.get_all("Comment",
                            filters={"reference_doctype": "Quarry Block",
                                     "reference_name": name, "comment_type": "Comment"},
                            fields=["content", "creation"], order_by="creation desc"):
        notes.append({"t": strip_html(c.content or ""), "d": _s(c.creation)[:10]})
    return {
        "produced": _s(b.date_produced),
        "pit": _s(b.pit), "grade": _s(b.granite_quality_grade),
        "L": cint(b.length_gross), "W": cint(b.width_gross), "H": cint(b.height_gross),
        "cbm": round(flt(b.gross_volume), 3), "mt": round(flt(b.gross_tonnage), 3),
        "status": _s(b.status),
        "qi": _s(b.source_quarry_inspection), "qid": _docdate("Quarry Inspection", b.source_quarry_inspection),
        "bi": _s(b.buyer_inspection), "bid": _docdate("Buyer Inspection", b.buyer_inspection),
        "dc": _s(b.delivery_challan), "dcd": _docdate("Delivery Challan", b.delivery_challan),
        "portd": port_date, "shipd": ship_date,
        "notes": notes,
    }


@frappe.whitelist()
def save_block_fields(name=None, length=None, width=None, height=None, grade=None, force=0):
    """Edit measurements/grade inline. Guarded once the block is downstream."""
    if not name:
        frappe.throw("No block given.")
    b = frappe.get_doc("Quarry Block", name)
    if _s(b.status) != "In Stock" and not cint(force):
        frappe.throw("Block is '" + _s(b.status) + "'. Editing measurements changes downstream "
                     "figures — resend with force=1 to confirm.")
    if length is not None:
        b.length_gross = cint(length)
    if width is not None:
        b.width_gross = cint(width)
    if height is not None:
        b.height_gross = cint(height)
    if grade:
        b.granite_quality_grade = grade
    b.gross_volume = round(flt(b.length_gross) * flt(b.width_gross) * flt(b.height_gross) / 1e6, 3)
    b.gross_tonnage = round(flt(b.gross_volume) * (flt(b.tonnage_factor) or 2.7), 3)
    b.flags.ignore_permissions = True
    b.save()
    frappe.db.commit()
    return {"ok": 1, "cbm": b.gross_volume, "mt": b.gross_tonnage}


@frappe.whitelist()
def add_block_note(name=None, text=None):
    """Attach a dated note (stored as a Comment on the block)."""
    if not name or not _s(text):
        frappe.throw("Block and note text required.")
    doc = frappe.get_doc("Quarry Block", name)
    doc.add_comment("Comment", _s(text))
    return {"ok": 1}


@frappe.whitelist()
def delete_block(name=None):
    """Delete a duplicate block — blocked if it is already in a BI or DC."""
    if not name:
        frappe.throw("No block given.")
    b = frappe.get_doc("Quarry Block", name)
    if _s(b.delivery_challan) or _s(b.buyer_inspection):
        frappe.throw("Block is in a BI/DC and cannot be deleted.")
    frappe.delete_doc("Quarry Block", name, ignore_permissions=True)
    frappe.db.commit()
    return {"ok": 1}
