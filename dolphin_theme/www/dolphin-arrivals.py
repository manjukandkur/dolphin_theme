import frappe

no_cache = 1


def get_context(context):
    # Render fresh per request and expose a session CSRF token to the page,
    # so its POST calls (reconcile / resolve) are accepted.
    context.no_cache = 1
    try:
        context.csrf_token = frappe.sessions.get_csrf_token()
    except Exception:
        context.csrf_token = ""
    return context
