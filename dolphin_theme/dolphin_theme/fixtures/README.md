# Fixtures - Client Script snapshot

`client_script.json` is a **read-only snapshot** of every Client Script in the
dolphin.m.frappe.cloud site database - all 227 records (name, dt, view, module,
enabled, script) captured 2026-07-29.

## Purpose
Version-control and disaster recovery. Client Scripts live in the site DB, not in
the app code, so they are not otherwise tracked in git. This file gives a diffable
history and a restore source. Note ~half the scripts have module=null (unattached
to any app) - they are the main reason this snapshot exists.

## IMPORTANT: this file is inert
It is **NOT** referenced in `hooks.py` `fixtures`, so Frappe does **not** import it
on migrate/deploy. Deploys never touch live Client Scripts, and committing an
updated snapshot here has zero effect on the running site.

## Refreshing the snapshot
From the desk (browser console, logged in), fetch all Client Scripts with fields
name, dt, view, enabled, module, script; map each to
`{doctype:"Client Script", name, dt, view, module, enabled, script}`;
`JSON.stringify(..., null, 1)`; replace this file.

## Restoring (only if scripts are lost)
A deliberate, manual operation - do NOT automate it into deploys. With bench/SSH,
load the JSON and for each entry get-or-create the Client Script by name, `.update(d)`,
then `.save()` and `frappe.db.commit()`.

## Do NOT enable auto-sync lightly
Adding a Client Script entry to `fixtures` in `hooks.py` makes every deploy overwrite
live scripts from this JSON. Any live edit not re-committed here is silently
reverted on the next deploy. Keep it inert unless you fully adopt a git-first
workflow for Client Scripts.

---

# Permission & master snapshots (added 2026-07-30) — INERT

Captured live from `dolphin.m.frappe.cloud` and committed as **read-only snapshots**,
same policy as `client_script.json`: NOT referenced in `hooks.py` `fixtures`, so a deploy
never re-imports or overwrites them. Changing a permission in the live UI does **not**
require re-committing here, and deploys will never revert your live changes.

Files:
- `custom_docperm_export_shipment_lot.json` — the role permissions on **Export Shipment Lot**,
  including the critical `Dolphin Ilkal` row (read+write+create) that lets the Ilkal branch
  create export lots. This is the specific item flagged as drift-prone.
- `shipping_mark.json` — the Shipping Mark masters (`BL/XMN`, `YL-XMN`).
- `dolphin_roles.json` — the 10 custom Dolphin roles (names/desk access), so the roles
  themselves are documented in git.

## Scope note
The Dolphin roles hold ~299 Custom DocPerm rows spread across many (mostly ERPNext-stock)
doctypes. Those, and the entire database, are already captured by Frappe Cloud's automatic
daily backups (Site → Backups). This git snapshot deliberately covers only the custom,
at-risk items above, not the full 299 rows.

## Restoring (manual, only if something is lost)
With bench/console, for each record: get-or-create by name, `.update(d)`, `.save(ignore_permissions=True)`, `frappe.db.commit()`.

## Refreshing
Re-fetch via `/api/method/frappe.client.get_list?doctype=<DT>&fields=["*"]` (logged in as Administrator)
and overwrite the file. To capture ALL permissions as a full git fixture instead, run on the
server: `bench --site dolphin.m.frappe.cloud export-fixtures` after adding a `fixtures` block to
`hooks.py` — but note that makes deploys enforce git (overwriting live edits), which is the
opposite of the inert policy above.
