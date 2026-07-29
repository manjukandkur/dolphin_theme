# Copyright (c) 2026, Dolphin International
# Shipment hub helpers: export-block-number normalization + access guard.
#
# normalize_lot_rows runs on Export Shipment Lot `validate` (wired in hooks.py
# doc_events). It guarantees each block row's `block_no` (Data) shows the EXPORT
# block number, per the definitive display rule: after the Delivery Challan every
# surface shows the export block number only. `block` (Link -> Quarry Block) is
# already set at lot creation, so we read the export number straight off it --
# we never try to resolve a Quarry Block *from* block_no, because export numbers
# and Quarry Block docnames are both integers in overlapping ranges and could
# collide. The guard only fills a value it can resolve with certainty and never
# clears anything, so it is safe and idempotent on every save.

import frappe
from frappe import _

# Roles allowed to see commercial-sensitive surfaces (invoice, rate/amount,
# Commercial Invoice). Everyone else -- notably Dolphin Ilkal -- is blocked.
_BANGALORE_ROLES = {
    "Dolphin Bangalore",
    "Dolphin Owner",
    "Dolphin Super Admin",
    "Dolphin Admin",
    "System Manager",
}


def normalize_lot_rows(doc, method=None):
    """Export Shipment Lot validate guard.

    For every block row that links a Quarry Block, set `block_no` to that block's
    export_block_no. Rows without a `block` link are left untouched (legacy data
    was migrated separately, and resolving from block_no is unsafe). Idempotent.
    """
    for r in (doc.get("blocks") or []):
        qb = r.get("block")
        if not qb:
            continue
        exp = frappe.db.get_value("Quarry Block", qb, "export_block_no")
        if exp:
            r.set("block_no", exp)


def require_bangalore():
    """Server-side guard for invoice / commercial-sensitive endpoints.

    Allows Administrator and any Bangalore/admin role; blocks Dolphin Ilkal (and
    anyone without a listed role) with a consistent 'Not enough permission'
    message so the UI and server agree.
    """
    user = frappe.session.user
    if user == "Administrator":
        return
    if set(frappe.get_roles(user)) & _BANGALORE_ROLES:
        return
    frappe.throw(_("Not enough permission"), frappe.PermissionError)


@frappe.whitelist()
def get_export_pdf(shipping_document, kind):
    """Gated PDF access for export shipment documents.

    Packing List is available to any signed-in user. Commercial Invoice is
    served only to users with print permission on Shipping Document (Owner /
    System Manager / Bangalore); everyone else gets a hard PermissionError, so
    the invoice cannot be reached even by crafting the URL directly.
    """
    if frappe.session.user == "Guest":
        raise frappe.PermissionError(_("Please sign in to view this document."))

    kind = (kind or "").strip().lower()
    formats = {
        "packing_list": "DI Packing List",
        "invoice": "DI Commercial Invoice",
    }
    print_format = formats.get(kind)
    if not print_format:
        frappe.throw(_("Unknown document type."))

    if kind == "invoice" and not frappe.has_permission(
        "Shipping Document", ptype="print", doc=shipping_document
    ):
        raise frappe.PermissionError(
            _("You are not authorized to view the commercial invoice.")
        )

    doc = frappe.get_doc("Shipping Document", shipping_document)
    doc.flags.ignore_permissions = True

    frappe.local.response.filename = "{0}-{1}.pdf".format(shipping_document, kind)
    frappe.local.response.filecontent = frappe.get_print(
        "Shipping Document",
        shipping_document,
        print_format,
        doc=doc,
        as_pdf=True,
        no_letterhead=0,
    )
    frappe.local.response.type = "pdf"
