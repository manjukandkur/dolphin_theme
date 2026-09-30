import frappe

# Ask Dolphin phone page - 30 Sep 2026. Any signed-in Dolphin user.
no_cache = 1


def get_context(context):
    context.no_cache = 1
    if frappe.session.user == "Guest":
        frappe.local.flags.redirect_location = "/login?redirect-to=/ask"
        raise frappe.Redirect
    context.csrf = frappe.sessions.get_csrf_token()
    context.user = frappe.session.user
    context.full_name = frappe.utils.get_fullname(frappe.session.user)
    return context
