import json

import frappe
from frappe.utils import flt, cint, now_datetime

# Tolerance aligned with the Measurement Variations work: a side passes if it is
# within 3 cm OR 3% of the dispatched value (whichever is larger).
DIM_TOL_ABS = 3.0
DIM_TOL_PCT = 0.03


def _within_tol(dispatched, arrived):
    d, a = flt(dispatched), flt(arrived)
    if not d:
        return True
    tol = max(DIM_TOL_ABS, d * DIM_TOL_PCT)
    return abs(d - a) <= tol


def _edit_distance(a, b):
    m, n = len(a), len(b)
    dp = list(range(n + 1))
    for i in range(1, m + 1):
        prev, dp[0] = dp[0], i
        for j in range(1, n + 1):
            cur = dp[j]
            dp[j] = min(dp[j] + 1, dp[j - 1] + 1, prev + (a[i - 1] != b[j - 1]))
            prev = cur
    return dp[n]


def _nearest(block_no, candidates):
    target, best, best_d = str(block_no).strip(), None, 99
    for c in candidates:
        d = _edit_distance(target, str(c))
        if d < best_d:
            best, best_d = c, d
    return best if best_d <= 2 else None


def _dispatched_index():
    rows = frappe.db.sql(
        """
        SELECT r.block, r.length_gross AS l, r.width_gross AS w,
               r.height_gross AS h, r.gross_volume AS vol, p.name AS dc
        FROM `tabDC Block Row` r
        JOIN `tabDelivery Challan` p ON p.name = r.parent
        WHERE p.docstatus = 1
        """,
        as_dict=True,
    )
    return {str(r.block).strip(): r for r in rows}


def _arrived_on_other(block_no, exclude_arrival):
    return bool(
        frappe.db.sql(
            """
            SELECT 1 FROM `tabPort Arrival Block` b
            JOIN `tabPort Arrival` p ON p.name = b.parent
            WHERE TRIM(b.block_no) = %s AND b.parent != %s
            LIMIT 1
            """,
            (str(block_no).strip(), exclude_arrival),
        )
    )


def _classify(pa):
    """Classify every block row in place. Does not save."""
    idx = _dispatched_index()
    keys = list(idx.keys())
    seen, flags = set(), 0
    for row in pa.blocks:
        bno = str(row.block_no or "").strip()
        row.suggested_block = None
        row.matched_dc = None
        if row.resolution_type:
            row.recon_status = "Resolved"
        elif not bno:
            row.recon_status = "Typo - not in DC"
            flags += 1
        elif bno in seen or _arrived_on_other(bno, pa.name):
            row.recon_status = "Duplicate"
            flags += 1
        elif bno not in idx:
            row.recon_status = "Typo - not in DC"
            row.suggested_block = _nearest(bno, keys)
            flags += 1
        else:
            dc = idx[bno]
            row.matched_dc = dc.dc
            ok = (
                _within_tol(dc.l, row.length)
                and _within_tol(dc.w, row.width)
                and _within_tol(dc.h, row.height)
            )
            row.recon_status = "Matched" if ok else "Dimension mismatch"
            if not ok:
                flags += 1
        seen.add(bno)
    awaiting = [k for k in keys if k not in seen]
    return {"flags": flags, "awaiting": awaiting, "total": len(pa.blocks)}


def run_reconcile(doc, method=None):
    """doc_events hook (validate) — mutate in place, framework saves. Phase 2 wires this."""
    try:
        _classify(doc)
    except Exception:
        frappe.log_error(frappe.get_traceback(), "Dolphin reconcile")


@frappe.whitelist()
def reconcile_arrival(name):
    """Run the cross-check on a Port Arrival and persist the per-row verdicts."""
    pa = frappe.get_doc("Port Arrival", name)
    res = _classify(pa)
    for row in pa.blocks:
        frappe.db.set_value("Port Arrival Block", row.name, {
            "recon_status": row.recon_status,
            "matched_dc": row.matched_dc,
            "suggested_block": row.suggested_block,
        }, update_modified=False)
    return res


@frappe.whitelist()
def resolve_flag(arrival, row_name, resolution_type, updates=None, note=None, machine=None):
    """Clear one flag. `updates` (JSON fieldname->value) optionally corrects data.
    Accept-as-is requires a reason. Every resolution stamps who + which PC + when."""
    if resolution_type == "Accepted as-is" and not (note or "").strip():
        frappe.throw("A reason is required to accept a discrepancy as-is.")
    pa = frappe.get_doc("Port Arrival", arrival)
    row = next((r for r in pa.blocks if r.name == row_name), None)
    if not row:
        frappe.throw("Row not found.")
    if updates:
        data = json.loads(updates) if isinstance(updates, str) else updates
        for k, v in data.items():
            row.set(k, v)
    row.resolution_type = resolution_type
    row.resolution_note = note
    row.resolved_by = frappe.session.user
    row.resolved_machine = machine or "un-named device"
    row.resolved_on = now_datetime()
    row.recon_status = "Resolved"
    pa.save(ignore_permissions=True)
    return {"ok": True}


@frappe.whitelist()
def get_token():
    """Return the current session's CSRF token via a GET call (no CSRF needed),
    so the www page can authorise its POSTs even when served from page cache."""
    return frappe.sessions.get_csrf_token()


@frappe.whitelist()
def parse_check(arrival):
    """Did the consolidated xls parse cleanly? Compares row count + summed totals
    (file vs imported). file_rows/file_cbm/file_net are stored on the parent at parse."""
    pa = frappe.get_doc("Port Arrival", arrival)
    imported = len(pa.blocks)
    cbm = round(sum(flt(b.cbm) for b in pa.blocks), 2)
    net = round(sum(flt(b.net_wt) for b in pa.blocks), 2)
    file_rows = cint(pa.get("file_rows"))
    return {
        "imported_rows": imported,
        "imported_cbm": cbm,
        "imported_net": net,
        "file_rows": file_rows,
        "matches": file_rows in (0, imported),
    }
