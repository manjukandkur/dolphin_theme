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
