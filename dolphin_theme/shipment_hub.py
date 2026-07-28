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
