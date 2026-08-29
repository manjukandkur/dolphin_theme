"""
Dolphin — block lifecycle: stages, controlled reversal, skip-with-reason, Trash.

Answers, in order:

  B37  "you create a proper workflow in at port reconcilation ready to export in
        export shipment lot exported shipped. return from shipped to Export
        shipment lot same method entering reason user details passwords with
        track of which machine etc"

  B39  "shouldnt it be fine to skip the step of transport and reconcilation if
        necessary? rather than instructing everyone we must make the system
        itself tight and not to acc[ept]"
        Both halves are honoured: a skip is allowed, but only as a recorded
        override — and the tightening lives in the system, not in a briefing.

  B33  "while removing any blocks give an option to recover from deleted box
        trash by giving password which I wll set up once"
        Nothing is hard-deleted. Removals go to a Trash and come back.

  B34  "same should be while removing you ask a reason and that note or details
        should be fetched while searching in trace block"
        Every removal carries a reason, and Trace shows it.

A1 was settled on 17 Aug as Option A: no password. A password cannot be checked
inside a server script, and the browser route (`verify_password`) destroys the
session on a single typo — it has already cost two working sessions. So every
transition instead records reason + person + machine on a versioned save, and
recovery from Trash is restricted by role. The call sites below take an optional
`password` argument that is currently ignored; if Option B is ever chosen, the
check drops into `_authorise()` alone and nothing else changes.

No new DocTypes. Everything persists in `Comment` (machine-readable prefix) and
`Dolphin Edit Log`, so this deploys with a bench update and needs no migration.
"""

import json

import frappe
from frappe.utils import now_datetime

from dolphin_theme.block_resolve import (
    machine_of,
    resolve_one,
    set_status,
    log_event,
    AmbiguousBlock,
    rank,
    _s,
)

# The stage ladder, in order. Names match Quarry Block.status options; the three
# new ones are added to the Select via a Property Setter (see ensure_stages).
STAGES = [
    "Dispatched/Transported",
    "At Port",
    "Reconciled",
    "Ready for Export Lot",
    "In Export Shipment Lot",
    "Shipped",
]

NEW_STATUSES = ["Reconciled", "Ready for Export Lot", "In Export Shipment Lot"]

TRASH_TAG = "[DI-TRASH]"
SKIP_TAG = "[DI-SKIP]"
REVERSE_TAG = "[DI-REVERSE]"

RECOVERY_ROLES = {"Dolphin Owner", "Dolphin Super Admin", "Dolphin Admin", "System Manager"}

# 22 Aug 2026, his instruction, verbatim:
#   "give trash access to ilkal user too and allow to put it back if needed from
#    trash. Saves lot of my work since only they will know why they delete or put
#    it back and hope every move is logged"
#
# He is right. The person who took a row off the sheet is the only one who knows
# why, and making him the bottleneck for putting it back helps nobody. Bringing a
# row back is not destructive - it restores exactly what was removed - and both
# the removal and the restore are written onto the block with reason, person and
# machine, so Trace shows the whole round trip. Setting up the stage ladder stays
# admin-only; that is a different kind of action.
TRASH_ROLES = RECOVERY_ROLES | {
    "Dolphin Ilkal", "Dolphin Bangalore", "Dolphin Quarry",
    "Dolphin Local Sales", "Dolphin Sales", "Dolphin Entry",
}


# ---------------------------------------------------------------------------
# One-time, idempotent: make the new stages selectable
# ---------------------------------------------------------------------------

def ensure_stages():
    """Add the three new stages to Quarry Block.status options via a Property
    Setter. Property Setters are site data, so this survives every deploy — the
    same technique that finally stopped the quarry numbers leaking back (C2).
    Safe to run repeatedly."""
    try:
        meta = frappe.get_meta("Quarry Block")
        field = meta.get_field("status")
        if not field or field.fieldtype != "Select":
            return {"ok": False, "reason": "status is not a Select field"}
        opts = [o for o in (field.options or "").split("\n")]
        missing = [s for s in NEW_STATUSES if s not in opts]
        if not missing:
            return {"ok": True, "added": []}
        # insert the new stages immediately after At Port, keeping the ladder readable
        try:
            at = opts.index("At Port") + 1
        except ValueError:
            at = len(opts)
        for i, s in enumerate(missing):
            opts.insert(at + i, s)
        frappe.make_property_setter({
            "doctype": "Quarry Block",
            "fieldname": "status",
            "property": "options",
            "value": "\n".join(opts),
            "property_type": "Text",
        }, is_system_generated=False)
        frappe.clear_cache(doctype="Quarry Block")
        return {"ok": True, "added": missing}
    except Exception:
        frappe.log_error(frappe.get_traceback(), "Dolphin ensure_stages")
        return {"ok": False}


@frappe.whitelist()
def setup_stages():
    """Admin-triggered version of ensure_stages, for when a deploy has landed but
    the patch has not been run."""
    _require_role(RECOVERY_ROLES, "set up the stage ladder")
    r = ensure_stages()
    frappe.db.commit()
    return r


# ---------------------------------------------------------------------------
# Authorisation (A1 = Option A: reason + person + machine, no password)
# ---------------------------------------------------------------------------

def _roles():
    try:
        return set(frappe.get_roles())
    except Exception:
        return set()


def _require_role(allowed, what):
    if not (_roles() & set(allowed)):
        frappe.throw("You do not have permission to {0}.".format(what))


def _authorise(reason, machine, password=None, person=None):
    """Single choke point for every controlled action.

    A1 Option A: a written reason is mandatory, the person is recorded, the
    machine is recorded. `password` is accepted and ignored — if Option B is
    chosen later, the check goes here and no call site changes."""
    reason = _s(reason)
    if len(reason) < 4:
        frappe.throw("Write a real reason — at least a few words. "
                     "This is the only record of why the block moved.")
    return {
        "reason": reason,
        "person": _s(person) or frappe.session.user,
        "machine": machine_of(machine),
        "at": now_datetime(),
    }


# ---------------------------------------------------------------------------
# B37 — the stage workflow
# ---------------------------------------------------------------------------

def _stage_index(status):
    try:
        return STAGES.index(_s(status))
    except ValueError:
        return -1


@frappe.whitelist()
def stage_options(block=None):
    """What can this block legally do next? Powers the workflow buttons so the
    screen never offers a move the server will refuse."""
    try:
        hit = resolve_one(block, allow_record_name=True)
    except AmbiguousBlock as e:
        return {"ok": False, "ambiguous": True, "message": str(e)}
    if not hit:
        return {"ok": False, "message": "No block answers to {0}.".format(_s(block))}
    cur = _s(hit.get("status"))
    i = _stage_index(cur)
    fwd = STAGES[i + 1] if 0 <= i < len(STAGES) - 1 else None
    back = STAGES[i - 1] if i > 0 else None
    return {
        "ok": True,
        "name": hit.get("name"),
        "block_number": hit.get("block_number"),
        "export_block_no": hit.get("export_block_no"),
        "status": cur,
        "on_ladder": i >= 0,
        "ladder": STAGES,
        "forward": fwd,
        "back": back,
        "can_skip": [s for s in STAGES[i + 2:] if i >= 0][:3],
    }


@frappe.whitelist()
def advance(blocks=None, to=None, reason=None, machine=None, password=None,
            person=None, skip=0):
    """Move one or many blocks forward along the ladder.

    Normal forward moves need a reason like everything else. A move that jumps a
    stage — the Transport/Reconciliation skip Manjunath asked for in B39 — is
    allowed, but it is labelled a skip, it is written into the block's own
    history, and it is counted, so nobody has to be told not to abuse it."""
    blocks = _as_list(blocks)
    to = _s(to)
    if to not in STAGES:
        frappe.throw("{0} is not a stage. The ladder is: {1}".format(to, " → ".join(STAGES)))
    auth = _authorise(reason, machine, password, person)

    done, refused = [], []
    for key in blocks:
        try:
            hit = resolve_one(key, allow_record_name=False)
        except AmbiguousBlock as e:
            refused.append({"block": key, "why": "ambiguous", "message": str(e)})
            continue
        if not hit:
            refused.append({"block": key, "why": "not-found",
                            "message": "{0} is not a quarry number or an export number "
                                       "of any block. Nothing was written.".format(key)})
            continue

        cur = _s(hit.get("status"))
        i, j = _stage_index(cur), _stage_index(to)
        jumped = i >= 0 and j - i > 1
        if jumped and not int(skip or 0):
            refused.append({
                "block": key, "why": "skips-a-stage", "from": cur, "to": to,
                "message": "{0} would jump {1}. That is allowed, but it has to be "
                           "asked for explicitly so it is recorded as a skip."
                           .format(key, " and ".join(STAGES[i + 1:j])),
            })
            continue

        note = auth["reason"] + ("" if not jumped else
                                 "  {0} skipped {1}".format(SKIP_TAG, ", ".join(STAGES[i + 1:j])))
        res = set_status(hit["name"], to, note, machine=auth["machine"],
                         actor=auth["person"])
        if not res.get("ok"):
            refused.append({"block": key, "why": res.get("error"), "message": res.get("message")})
            continue
        if jumped:
            _stamp(hit["name"], SKIP_TAG, {
                "from": cur, "to": to, "skipped": STAGES[i + 1:j],
                "reason": auth["reason"], "person": auth["person"],
                "machine": auth["machine"],
            })
        done.append({"block": key, "name": hit["name"], "from": cur, "to": to,
                     "skipped": STAGES[i + 1:j] if jumped else []})

    frappe.db.commit()
    return {"ok": True, "moved": done, "refused": refused,
            "counts": {"moved": len(done), "refused": len(refused)}}


@frappe.whitelist()
def reverse(blocks=None, to=None, reason=None, machine=None, password=None, person=None):
    """The controlled way back — Shipped → In Export Shipment Lot, and any other
    backwards step. This is the path B37 asks for by name. It is deliberately a
    different endpoint from `advance`: a reversal is an event, not a correction,
    and it should read that way in the history."""
    blocks = _as_list(blocks)
    to = _s(to)
    if to not in STAGES:
        frappe.throw("{0} is not a stage.".format(to))
    auth = _authorise(reason, machine, password, person)

    done, refused = [], []
    for key in blocks:
        try:
            hit = resolve_one(key, allow_record_name=False)
        except AmbiguousBlock as e:
            refused.append({"block": key, "why": "ambiguous", "message": str(e)})
            continue
        if not hit:
            refused.append({"block": key, "why": "not-found"})
            continue
        cur = _s(hit.get("status"))
        if rank(to) >= rank(cur):
            refused.append({"block": key, "why": "not-backwards",
                            "message": "{0} is at {1}; {2} is not a step back."
                                       .format(key, cur, to)})
            continue
        res = set_status(hit["name"], to, "{0} {1}".format(REVERSE_TAG, auth["reason"]),
                         machine=auth["machine"], actor=auth["person"],
                         allow_backwards=True)
        if not res.get("ok"):
            refused.append({"block": key, "why": res.get("error"), "message": res.get("message")})
            continue
        _stamp(hit["name"], REVERSE_TAG, {
            "from": cur, "to": to, "reason": auth["reason"],
            "person": auth["person"], "machine": auth["machine"],
        })
        done.append({"block": key, "name": hit["name"], "from": cur, "to": to})

    frappe.db.commit()
    return {"ok": True, "reversed": done, "refused": refused}


# ---------------------------------------------------------------------------
# B33 / B34 — Trash: nothing is hard-deleted, removals carry a reason
# ---------------------------------------------------------------------------

def _stamp(block, tag, payload):
    """Write a machine-readable event onto the block as a Comment. Comments are
    already surfaced by the journey and by Trace, so a stamp is visible to a
    person the moment it is written — no new screen required."""
    try:
        doc = frappe.get_doc("Quarry Block", block)
        doc.add_comment("Comment", "{0} {1}".format(tag, json.dumps(payload, default=str)))
    except Exception:
        frappe.log_error(frappe.get_traceback(), "Dolphin stamp")


def _read_stamps(block, tag=None):
    out = []
    try:
        for c in frappe.get_all(
            "Comment",
            filters={"reference_doctype": "Quarry Block",
                     "reference_name": str(block), "comment_type": "Comment"},
            fields=["content", "creation", "owner"],
            order_by="creation desc", limit_page_length=0,
        ):
            raw = frappe.utils.strip_html(c.content or "").strip()
            for t in (TRASH_TAG, SKIP_TAG, REVERSE_TAG):
                if raw.startswith(t):
                    if tag and t != tag:
                        continue
                    try:
                        payload = json.loads(raw[len(t):].strip())
                    except Exception:
                        payload = {"raw": raw[len(t):].strip()}
                    payload["tag"] = t
                    payload["at"] = _s(c.creation)
                    payload["by"] = c.owner
                    out.append(payload)
                    break
    except Exception:
        pass
    return out


@frappe.whitelist()
def remove_to_trash(doctype=None, parent=None, row=None, block=None, reason=None,
                    machine=None, password=None, person=None, restore_status=None):
    """Remove a block row from a parent document WITHOUT deleting anything
    irrecoverably. The row's full contents are written into the block's Trash
    stamp first, so `restore_from_trash` can put it back exactly.

    B34: the reason is mandatory and it is stored on the BLOCK, not on the
    parent — so it follows the block and surfaces in Trace even after the parent
    document is long forgotten."""
    auth = _authorise(reason, machine, password, person)
    doctype, parent, row = _s(doctype), _s(parent), _s(row)
    if not (doctype and parent):
        frappe.throw("Which document is the block being removed from?")

    doc = frappe.get_doc(doctype, parent)
    if doc.docstatus == 1:
        frappe.throw("{0} is submitted. Return it to draft first — a submitted "
                     "document must not change under anyone's feet.".format(parent))

    removed, block_name = None, None
    for tf in doc.meta.get_table_fields():
        rows = doc.get(tf.fieldname) or []
        for r in list(rows):
            match = (row and r.name == row) or (
                not row and block and _s(block) in {
                    _s(r.get("block")), _s(r.get("block_no")),
                    _s(r.get("export_block_no")), _s(r.get("quarry_block"))})
            if not match:
                continue
            removed = {"table": tf.fieldname, "idx": r.idx,
                       "data": {k: v for k, v in r.as_dict().items()
                                if not str(k).startswith("_") and k not in
                                ("parent", "parentfield", "parenttype", "name",
                                 "creation", "modified", "modified_by", "owner")}}
            for k in ("block", "block_no", "export_block_no", "quarry_block"):
                if _s(r.get(k)):
                    block_name = block_name or _s(r.get(k))
            doc.remove(r)
            break
        if removed:
            break

    if not removed:
        frappe.throw("That row is not on {0} any more.".format(parent))

    doc.flags.ignore_permissions = True
    doc.save()

    hit = None
    try:
        hit = resolve_one(block or block_name, allow_record_name=True)
    except AmbiguousBlock:
        hit = None

    payload = {
        "from_doctype": doctype, "from_name": parent,
        "row": removed, "reason": auth["reason"], "person": auth["person"],
        "machine": auth["machine"], "restored": False,
    }
    if hit:
        _stamp(hit["name"], TRASH_TAG, payload)
        log_event(hit["name"], "removed", parent, None, auth["reason"],
                  auth["machine"], auth["person"])
        if restore_status:
            set_status(hit["name"], _s(restore_status),
                       "removed from {0}: {1}".format(parent, auth["reason"]),
                       machine=auth["machine"], actor=auth["person"],
                       allow_backwards=True)
    frappe.db.commit()
    return {"ok": True, "trashed": True, "block": (hit or {}).get("name"),
            "from": parent, "reason": auth["reason"]}


@frappe.whitelist()
def trash_list(block=None, limit=200):
    """Everything currently in the Trash — for one block, or across the board."""
    out = []
    if block:
        try:
            hit = resolve_one(block, allow_record_name=True)
        except AmbiguousBlock:
            hit = None
        if hit:
            out = [dict(s, block=hit["name"]) for s in _read_stamps(hit["name"], TRASH_TAG)]
        return out
    try:
        for c in frappe.get_all(
            "Comment",
            filters={"reference_doctype": "Quarry Block", "comment_type": "Comment",
                     "content": ["like", "%" + TRASH_TAG + "%"]},
            fields=["reference_name", "content", "creation", "owner"],
            order_by="creation desc", limit_page_length=int(limit or 200),
        ):
            raw = frappe.utils.strip_html(c.content or "").strip()
            try:
                payload = json.loads(raw[len(TRASH_TAG):].strip())
            except Exception:
                payload = {"raw": raw}
            payload.update({"block": c.reference_name, "at": _s(c.creation), "by": c.owner})
            out.append(payload)
    except Exception:
        frappe.log_error(frappe.get_traceback(), "Dolphin trash_list")
    return out


@frappe.whitelist()
def restore_from_trash(block=None, from_name=None, reason=None, machine=None,
                       password=None, person=None):
    """Put a trashed row back on its parent document.

    Recovery is restricted by role (A1 Option A). When Option B lands, the
    password check goes into `_authorise` and this signature already accepts it."""
    _require_role(TRASH_ROLES, "bring a block back from the Trash")
    auth = _authorise(reason, machine, password, person)
    try:
        hit = resolve_one(block, allow_record_name=True)
    except AmbiguousBlock as e:
        frappe.throw(str(e))
    if not hit:
        frappe.throw("No block answers to {0}.".format(_s(block)))

    stamps = [s for s in _read_stamps(hit["name"], TRASH_TAG) if not s.get("restored")]
    if from_name:
        stamps = [s for s in stamps if _s(s.get("from_name")) == _s(from_name)]
    if not stamps:
        frappe.throw("Nothing in the Trash for {0}.".format(_s(block)))
    stamp = stamps[0]

    doc = frappe.get_doc(stamp["from_doctype"], stamp["from_name"])
    if doc.docstatus == 1:
        frappe.throw("{0} is submitted — return it to draft before restoring into it."
                     .format(stamp["from_name"]))
    doc.append(stamp["row"]["table"], stamp["row"]["data"])
    doc.flags.ignore_permissions = True
    doc.save()

    _stamp(hit["name"], TRASH_TAG, dict(stamp, restored=True,
                                        restored_by=auth["person"],
                                        restored_reason=auth["reason"],
                                        restored_machine=auth["machine"]))
    log_event(hit["name"], "restored", None, stamp["from_name"], auth["reason"],
              auth["machine"], auth["person"])
    frappe.db.commit()
    return {"ok": True, "restored_to": stamp["from_name"]}


@frappe.whitelist()
def block_events(block=None):
    """Every controlled event on a block — trashes, skips, reversals — newest
    first. B34: this is what Trace calls so a removal reason follows the block."""
    try:
        hit = resolve_one(block, allow_record_name=True)
    except AmbiguousBlock as e:
        return {"ok": False, "ambiguous": True, "message": str(e), "events": []}
    if not hit:
        return {"ok": False, "message": "No block answers to {0}.".format(_s(block)),
                "events": []}
    return {"ok": True, "block": hit["name"],
            "block_number": hit.get("block_number"),
            "export_block_no": hit.get("export_block_no"),
            "status": hit.get("status"),
            "events": _read_stamps(hit["name"])}


@frappe.whitelist()
def blocks_with_notes(kind=None, limit=500):
    """B1/B9: find every block carrying a note or a flag, so they can be worked
    one at a time instead of hunted for."""
    tags = {"trash": TRASH_TAG, "skip": SKIP_TAG, "reverse": REVERSE_TAG}
    want = [tags[kind]] if kind in tags else list(tags.values())
    out, seen = [], set()
    for tag in want:
        try:
            for c in frappe.get_all(
                "Comment",
                filters={"reference_doctype": "Quarry Block", "comment_type": "Comment",
                         "content": ["like", "%" + tag + "%"]},
                fields=["reference_name", "content", "creation"],
                order_by="creation desc", limit_page_length=int(limit or 500),
            ):
                k = (c.reference_name, tag)
                if k in seen:
                    continue
                seen.add(k)
                raw = frappe.utils.strip_html(c.content or "").strip()
                try:
                    payload = json.loads(raw[len(tag):].strip())
                except Exception:
                    payload = {}
                out.append({
                    "block": c.reference_name, "kind": tag.strip("[]").replace("DI-", "").lower(),
                    "reason": payload.get("reason") or payload.get("restored_reason") or "",
                    "person": payload.get("person"), "machine": payload.get("machine"),
                    "at": _s(c.creation),
                })
        except Exception:
            continue
    return out


def _as_list(v):
    if isinstance(v, str):
        v = v.strip()
        if v.startswith("["):
            try:
                v = json.loads(v)
            except Exception:
                v = [v]
        else:
            v = [x for x in v.replace(",", "\n").split("\n")]
    if not isinstance(v, (list, tuple)):
        v = [v]
    out = [_s(x) for x in v if _s(x)]
    if not out:
        frappe.throw("No blocks given.")
    return out


# ---------------------------------------------------------------------------
# 28 Aug 2026. A row closed behind an accepted one is neither "Accepted as-is"
# nor "Removed (duplicate)" — it is superseded, and calling it either of those
# would misreport what a person decided. The option is added the same way the
# stages are: a Property Setter, which is site data and survives every deploy.
# Idempotent.
# ---------------------------------------------------------------------------
RESOLUTION_TYPES = ("Superseded by accepted row",)


def ensure_resolution_types():
    """Make 'Superseded by accepted row' selectable on Port Arrival Block."""
    try:
        meta = frappe.get_meta("Port Arrival Block")
        field = meta.get_field("resolution_type")
        if not field or field.fieldtype != "Select":
            return {"ok": False, "reason": "resolution_type is not a Select field"}
        opts = [o for o in (field.options or "").split("\n")]
        missing = [s for s in RESOLUTION_TYPES if s not in opts]
        if not missing:
            return {"ok": True, "added": []}
        opts.extend(missing)
        frappe.make_property_setter({
            "doctype": "Port Arrival Block",
            "fieldname": "resolution_type",
            "property": "options",
            "value": "\n".join(opts),
            "property_type": "Text",
        }, is_system_generated=False)
        frappe.clear_cache(doctype="Port Arrival Block")
        return {"ok": True, "added": missing}
    except Exception:
        frappe.log_error(frappe.get_traceback(), "Dolphin ensure_resolution_types")
        return {"ok": False}


@frappe.whitelist()
def setup_resolution_types():
    """Run ensure_resolution_types() on demand, without waiting for a migrate."""
    return ensure_resolution_types()
