app_name = "dolphin_theme"
app_title = "Dolphin Theme"
app_publisher = "Dolphin International"
app_description = "Navy/gold desk theme for Dolphin International ERP"
app_email = "manjukandkur@gmail.com"
app_license = "MIT"

# Bundle file built by Frappe's esbuild and included on every desk page.
app_include_css = "dolphin_theme.bundle.css"
# dolphin_patch.js loads AFTER the bundle to enforce a single Trace-a-block box
# and the menu changes. Remove the patch entry (and the file) to revert.
app_include_js = ["dolphin_theme.bundle.js", "dolphin_patch.bundle.js"]


# Normalize Export Shipment Lot block rows on save so block_no always shows the
# EXPORT block number (see dolphin_theme/shipment_hub.py).
#
# Duplication guards (B8/B10/B35, 17 Aug 2026). The Delivery Challan had a guard;
# nothing else did. `guards.guard` checks three things on every save: the same
# block twice on one document, the same block already on another document of the
# same type (drafts included — challan 0070 was a draft), and a duplicate
# document number.
#
# `dc_block_status_on_submit` moves block status on SUBMIT rather than on save.
# A draft moving live stock is the root cause behind the 0070 incident (B36).
doc_events = {
    "Export Shipment Lot": {
        "validate": [
            "dolphin_theme.shipment_hub.normalize_lot_rows",
            "dolphin_theme.guards.guard",
            "dolphin_theme.sizing.carry_sizes",
        ],
    },
    # The export invoice / packing list. carry_sizes runs first (and honours the
    # size-override tick, B45), then the rate table is rebuilt from whatever
    # sizes and grades the document is actually carrying (B46).
    "Shipping Document": {
        "validate": [
            "dolphin_theme.sizing.carry_sizes",
            "dolphin_theme.sizing.compute_size_rates",
        ],
    },
    # 17 Aug, evening: guards.guard REMOVED from Local Tax Invoice.
    #
    # Adding it here broke "Mark as Sold" — the button vanished and the form showed
    # a false "Not Saved" beside a green Saved toast (the C4 symptom). Two ways it
    # could do that: Local Tax Invoice is in the guard's HARD set so a finding calls
    # frappe.throw, and the guard runs resolve_many, which fires a resolution query
    # per block and is far heavier than anything this validate carried before.
    #
    # Selling an invoice is business-critical and duplicate protection on it is not
    # worth breaking it for. If it is wanted here later it must be warn-only, cheap,
    # and tested against a real invoice first.
    "Local Tax Invoice": {
        "validate": "dolphin_theme.local_tax_invoice.compute_totals",
    },
    "Buyer Inspection": {
        "validate": "dolphin_theme.guards.guard",
    },
    "Port Arrival": {
        "validate": [
            "dolphin_theme.guards.guard",
            # B44: 0 of 849 arrival rows carried a measurement, which is why
            # nothing at the port could be reconciled. Carry them from the BI.
            "dolphin_theme.sizing.carry_sizes",
        ],
    },
    "Delivery Challan": {
        "validate": "dolphin_theme.guards.guard",
        "on_submit": "dolphin_theme.guards.dc_block_status_on_submit",
    },
}

# Make the new lifecycle stages selectable after every deploy. Idempotent: it
# writes a Property Setter only when an option is genuinely missing.
after_migrate = [
    "dolphin_theme.lifecycle.ensure_stages",
    "dolphin_theme.lifecycle.ensure_resolution_types",
    "dolphin_theme.sizing.ensure_fields",
]

# Auto-import arrival emails: every 15 min, parse any arrival that came in via
# email but has no blocks yet (belt-and-braces alongside sync_arrivals_email).
scheduler_events = {
    "cron": {
        "*/15 * * * *": [
            "dolphin_theme.api_arrivals.parse_email_arrivals",
        ],
    },
}
