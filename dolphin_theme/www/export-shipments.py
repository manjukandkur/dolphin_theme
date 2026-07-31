import frappe
from frappe import _

# Export Hub is restricted: only Ilkal, Bangalore, Owner and admins may open it,
# whether via the /app/export-hub desk page (iframe) or the /export-shipments URL.
_ALLOWED = {
    "System Manager",
    "Administrator",
    "Dolphin Owner",
    "Dolphin Bangalore",
    "Dolphin Ilkal",
}


def get_context(context):
    context.no_cache = 1
    user = frappe.session.user
    if user == "Administrator":
        return context
    if user == "Guest":
        raise frappe.PermissionError(_("Please sign in to view the Export Hub."))
    if not (set(frappe.get_roles(user)) & _ALLOWED):
        raise frappe.PermissionError(_("You are not permitted to view the Export Hub."))
    return context
