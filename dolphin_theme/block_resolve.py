"""
Dolphin — the block resolution rule.
=====================================

This module exists because of one incident.

On 27 Jul 2026 an agency sheet listed 56 numbers. Every one of them was matched
against the Quarry Block **record id** (`name`), because `name` is an
autoincrementing integer and a typed number will always look like a valid
record id. Twenty-five of those 56 landed on the wrong physical block: the
agency typed `1357`, which is block 1584's *export* number, and the system
happily resolved it to record 1357 — quarry block 3851, export 809. Fifty-six
blocks were moved to "At Port" that had never been at any port.

The rule this module enforces:

    A number typed by a human, or read out of an imported sheet, is NEVER
    resolved against the Quarry Block record id.

    It is resolved against `export_block_no` first, then `block_number`.
    If it matches more than one physical block, NOTHING IS WRITTEN — the
    caller is told it is ambiguous and the row is left for a person.

Record-id resolution still exists, but only where the caller can prove the
value came from a Link field the framework itself wrote (`allow_record_name=True`).
Nothing that originates in a sheet or a text box may pass that flag.

Public API
----------
    resolve_one(key)                -> Hit | None            (raises Ambiguous)
    try_resolve(key)                -> (Hit|None, reason)    (never raises)
    resolve_many(keys)              -> {key: {...}}
    describe(key)                   -> dict for the UI, always safe
"""

import frappe
from frappe.utils import cint


class AmbiguousBlock(Exception):
    """More than one physical block answers to this number. Refuse to write."""

    def __init__(self, key, candidates):
        self.key = key
        self.candidates = candidates
        Exception.__init__(
            self,
            "Block number {0} matches {1} different blocks ({2}). "
            "Refusing to guess — this row needs a person.".format(
                key,
                len(candidates),
                ", ".join(str(c.get("name")) for c in candidates[:6]),
            ),
        )


def _s(v):
    return "" if v in (None, "") else str(v).strip()


_FIELDS = ["name", "block_number", "export_block_no", "status"]

# Resolution order. Export number first: after the DC stage the standing
# decision is that only export numbers travel, so an export hit is the most
# likely intent as well as the most specific.
_SPACES = ("export_block_no", "block_number")


def _lookup(field, key):
    try:
        return frappe.get_all(
            "Quarry Block",
            filters={field: key},
            fields=_FIELDS,
            limit_page_length=0,
        ) or []
    except Exception:
        return []


def candidates(key, allow_record_name=False):
    """Every distinct Quarry Block this number could mean, with how it was reached.

    Both number spaces are searched, always — not first-hit-wins. That is the
    whole point: if `1357` is one block's quarry number and another block's
    export number, the caller must find out, not be handed the first row."""
    key = _s(key)
    if not key:
        return []

    found, order = {}, []
    for field in _SPACES:
        for row in _lookup(field, key):
            nm = str(row.get("name"))
            if nm not in found:
                row = dict(row)
                row["via"] = "export" if field == "export_block_no" else "quarry"
                found[nm] = row
                order.append(nm)
            else:
                # same block reachable by both numbers — not a collision
                found[nm]["via"] = "export+quarry"

    if not found and allow_record_name:
        try:
            if frappe.db.exists("Quarry Block", key):
                d = frappe.db.get_value("Quarry Block", key, _FIELDS, as_dict=True)
                if d:
                    d = dict(d)
                    d["via"] = "record-id"
                    found[str(d.get("name"))] = d
                    order.append(str(d.get("name")))
        except Exception:
            pass

    return [found[n] for n in order]


def resolve_one(key, allow_record_name=False):
    """Exactly one block, or None. Raises AmbiguousBlock when the number is shared."""
    c = candidates(key, allow_record_name=allow_record_name)
    if not c:
        return None
    if len(c) > 1:
        raise AmbiguousBlock(_s(key), c)
    return c[0]


def _letters_are_in_use():
    """Is there ANY block whose number carries a letter? One query per request.

    5 Sep 2026. This is what keeps the sibling check below free: today not one
    of the 617 blocks has a letter, so the check costs nothing and changes
    nothing. The day the quarry starts writing M1182, it switches itself on."""
    flag = getattr(frappe.local, "_dolphin_letters_in_use", None)
    if flag is None:
        try:
            flag = bool(frappe.db.sql("""
                select 1 from `tabQuarry Block`
                where block_number regexp '[A-Za-z]'
                   or export_block_no regexp '[A-Za-z]'
                limit 1"""))
        except Exception:
            flag = False
        frappe.local._dolphin_letters_in_use = flag
    return flag


def try_resolve(key, allow_record_name=False):
    """Non-throwing form. Returns (hit_or_None, reason).

    reason is one of: "ok", "empty", "not-found", "ambiguous".
    Use this on any path that processes many rows — one bad number must not
    abort the whole sheet.

    5 Sep 2026, and this is the plug that was missing. `who_is_this` knew about
    letter siblings; NOTHING CALLED IT. Every arrival row, every import, every
    lookup came through here, and here matched the string exactly - so an agency
    row saying "1189" would match the old plain 1189 with full confidence while
    M1189 sat beside it. His words: "so arrivals doesnt assume it as older block
    number". This is the one chokepoint that had to know, so it knows here, and
    all forty-odd callers get it at once rather than one at a time."""
    key = _s(key)
    if not key:
        return None, "empty"
    try:
        hit = resolve_one(key, allow_record_name=allow_record_name)
    except AmbiguousBlock:
        return None, "ambiguous"
    if hit and _letters_are_in_use():
        try:
            if letter_siblings(key):
                # the number alone cannot tell these apart - say so rather than
                # hand back the first one and let it look certain
                return None, "ambiguous"
        except Exception:
            pass
    return (hit, "ok") if hit else (None, "not-found")


def resolve_many(keys, allow_record_name=False):
    """{key: {"ok":bool, "reason":str, "name":..., "block_number":..., "export_block_no":...}}"""
    out = {}
    for k in keys or []:
        k = _s(k)
        if not k or k in out:
            continue
        hit, reason = try_resolve(k, allow_record_name=allow_record_name)
        out[k] = {
            "ok": reason == "ok",
            "reason": reason,
            "name": (hit or {}).get("name"),
            "block_number": (hit or {}).get("block_number"),
            "export_block_no": (hit or {}).get("export_block_no"),
            "status": (hit or {}).get("status"),
            "via": (hit or {}).get("via"),
        }
    return out


@frappe.whitelist()
def describe(key=None):
    """UI-facing: what does this number mean, and is it safe to act on?
    Always returns a dict — never throws — so a screen can show the ambiguity
    instead of a red error toast."""
    key = _s(key)
    cands = candidates(key, allow_record_name=False)
    id_only = []
    if not cands:
        # Explain the record-id case rather than silently resolving it: this is
        # exactly the situation that produced the 56 wrong At Port blocks.
        try:
            if key and frappe.db.exists("Quarry Block", key):
                d = frappe.db.get_value("Quarry Block", key, _FIELDS, as_dict=True)
                if d:
                    id_only = [dict(d)]
        except Exception:
            pass
    return {
        "key": key,
        "count": len(cands),
        "ok": len(cands) == 1,
        "ambiguous": len(cands) > 1,
        "candidates": cands,
        "record_id_only": id_only,
        "message": (
            "" if len(cands) == 1 else
            ("{0} matches no block's quarry number and no block's export number."
             .format(key) + (
                 " It IS record id {0} (quarry {1}, export {2}) — but a typed number is "
                 "never resolved against a record id, so nothing will act on it."
                 .format(id_only[0].get("name"), id_only[0].get("block_number") or "-",
                         id_only[0].get("export_block_no") or "-")
                 if id_only else ""))
            if not cands else
            "{0} is shared by {1} blocks. Nothing will be written until a person picks one."
            .format(key, len(cands))
        ),
    }


# ---------------------------------------------------------------------------
# Writing safely
# ---------------------------------------------------------------------------

# A block never moves backwards through these without an explicit reason.
_RANK = {
    "In Stock": 0,
    "Buyer Marked": 1,
    "In Delivery Challan": 2,
    "Dispatched/Transported": 3,
    "At Port": 4,
    "At Bannikoppa Station yard": 4,
    "Reconciled": 5,
    "Ready for Export Lot": 6,
    "In Export Shipment Lot": 7,
    "Shipped": 8,
    "Sold": 9,
}


def rank(status):
    return _RANK.get(_s(status), -1)


def is_backwards(old, new):
    a, b = rank(old), rank(new)
    return a >= 0 and b >= 0 and b < a


def set_status(block_name, status, reason, machine=None, allow_backwards=False,
               actor=None):
    """The ONLY sanctioned way to change Quarry Block.status from Dolphin code.

    * writes through the document, so it is versioned and shows in the journey
    * refuses a backwards move unless the caller says so explicitly
    * always leaves a comment saying who, which machine and why

    Returns a dict; never silently no-ops."""
    reason = _s(reason)
    if not reason:
        frappe.throw("A status change needs a reason. This is deliberate — "
                     "an unexplained status change is how 56 blocks ended up at a "
                     "port they never reached.")
    doc = frappe.get_doc("Quarry Block", block_name)
    old = _s(doc.status)
    if old == _s(status):
        return {"ok": True, "changed": False, "status": old}
    if is_backwards(old, status) and not allow_backwards:
        return {"ok": False, "changed": False, "status": old,
                "error": "backwards",
                "message": "{0} would move backwards from {1} to {2}. "
                           "Use the reverse action, which records who authorised it."
                           .format(block_name, old, status)}
    doc.status = status
    doc.flags.ignore_permissions = True
    doc.flags.ignore_validate_update_after_submit = True
    doc.save()
    stamp = "{0} → {1} · {2} · {3} · {4}".format(
        old or "(blank)", status, actor or frappe.session.user,
        machine or "un-named device", reason)
    try:
        doc.add_comment("Comment", stamp)
    except Exception:
        pass
    log_event(block_name, "status", old, status, reason, machine, actor)
    return {"ok": True, "changed": True, "from": old, "status": status}


def log_event(block, action, old=None, new=None, reason=None, machine=None, actor=None):
    """Append to Dolphin Edit Log when that doctype exists; never fail the caller."""
    try:
        if not frappe.db.exists("DocType", "Dolphin Edit Log"):
            return
        d = frappe.new_doc("Dolphin Edit Log")
        meta = d.meta

        def put(field, value):
            if meta.has_field(field) and value not in (None, ""):
                d.set(field, value)

        put("reference_doctype", "Quarry Block")
        put("reference_name", str(block))
        put("block", str(block))
        put("action", action)
        put("old_value", _s(old))
        put("new_value", _s(new))
        put("reason", _s(reason))
        put("detail", _s(reason))
        put("person", actor or frappe.session.user)
        put("user", actor or frappe.session.user)
        put("machine", machine or "un-named device")
        d.flags.ignore_permissions = True
        d.flags.ignore_mandatory = True
        d.insert(ignore_permissions=True)
    except Exception:
        frappe.log_error(frappe.get_traceback(), "Dolphin edit log")


def machine_of(machine=None):
    """Normalise the machine label the browser sends. B11/B12: 401 of 420 log
    rows were un-named because every caller passed nothing and no default was
    ever applied. Now there is always a value, and it says so when unknown."""
    m = _s(machine)
    return m or "un-named device"


# ---------------------------------------------------------------------------
# A LETTER IS NOT A DIFFERENT BLOCK UNTIL SOMETHING PROVES IT IS.  5 Sep 2026
#
# [stated] "I meant only when a alpha numberic number appears and if at all
#  there is any confusion you set 2 or 3 additional parameters to compare so
#  arrivals doesnt assume it as older block number"
#
# The danger he named, exactly: the agency types 1189 having dropped the B, and
# it matches the OLDER plain block 1189 in silence. `candidates()` above matches
# the string, so B1189 is not even a candidate for 1189 - the wrong block is
# found confidently, which is worse than not finding one.
#
# So a bare number now also looks for its LETTER SIBLINGS - blocks whose digits
# are the same and whose string is not - and when one exists the number is
# ambiguous until other evidence settles it.
#
# THE EVIDENCE IS NOT A MEASUREMENT DISPUTE. His rule of 25 Aug still stands and
# is not touched: [stated] "our measurement is the only measurement final so
# ignore measurement", [stated] "dont dispute measurement and weights at all".
# Disputing a figure and telling two stones apart are different jobs. Nothing
# below refuses a row, contradicts a figure, or writes a measurement. It only
# says WHICH of two blocks an agency row is about, and only when the number
# alone cannot.
# ---------------------------------------------------------------------------

def digits_of(v):
    """The number inside a block number. 'B1189' -> '1189', '1189A' -> '1189'.

    Empty string when there is no digit at all, never '0' - the 4 Jun failure was
    "3300A".toLong() quietly returning 0."""
    return "".join(ch for ch in _s(v) if ch.isdigit())


def letter_siblings(key):
    """Blocks whose number has the SAME DIGITS as key but a different string.

    '1189' finds 'B1189'; 'B1189' finds '1189'. Returns [] when key carries no
    digits, and never returns a block that already matches key exactly."""
    d = digits_of(key)
    k = _s(key)
    if not d:
        return []
    out, seen = [], set()
    try:
        for field in _SPACES:
            for row in frappe.get_all("Quarry Block",
                                      filters={field: ["like", "%{0}%".format(d)]},
                                      fields=_FIELDS, limit_page_length=0) or []:
                val = _s(row.get(field))
                if digits_of(val) != d or val == k:
                    continue
                nm = str(row.get("name"))
                if nm in seen:
                    continue
                seen.add(nm)
                row = dict(row)
                row["via"] = "export" if field == "export_block_no" else "quarry"
                row["matched_on"] = val
                out.append(row)
    except Exception:
        return []
    return out


def _cbm_of(l, w, h):
    try:
        l, w, h = float(l or 0), float(w or 0), float(h or 0)
    except Exception:
        return 0.0
    return round(l * w * h / 1e6, 3) if (l and w and h) else 0.0


def _on_challan(block_name, dc):
    """Is this block on that delivery challan? Paperwork, not judgement."""
    if not dc:
        return False
    try:
        return bool(frappe.get_all("DC Block Row",
                                   filters={"parenttype": "Delivery Challan",
                                            "parent": _s(dc), "block": block_name},
                                   fields=["name"], limit_page_length=1))
    except Exception:
        return False


def disambiguate(cands, evidence=None):
    """Which of these blocks is the agency row about? One, or an honest 'cannot tell'.

    Evidence is whatever the arrival row already carries - no new fields:
      dc, mark, length/width/height or cbm, net_wt, vehicle_no.
    Tried strongest first and it STOPS at the first test that separates them, so
    a challan match is never overruled by a measurement.
    """
    ev = evidence or {}
    rows = [dict(c) for c in (cands or [])]
    if len(rows) < 2:
        return {"pick": rows[0] if rows else None,
                "reason": "one candidate" if rows else "no candidate", "by": None}

    # 1. THE CHALLAN. A block is on exactly one submitted challan.
    dc = _s(ev.get("dc"))
    if dc:
        on = [r for r in rows if _on_challan(r.get("name"), dc)]
        if len(on) == 1:
            return {"pick": on[0], "reason": "decided", "by": "challan {0}".format(dc)}

    # 2. THE SHIPPING MARK, as recorded on the block's own lot.
    mark = _s(ev.get("mark"))
    if mark:
        hit = []
        for r in rows:
            try:
                if frappe.get_all("Shipment Lot Block",
                                  filters={"parenttype": "Export Shipment Lot",
                                           "block": r.get("name")},
                                  fields=["parent"], limit_page_length=0):
                    for p in frappe.get_all("Shipment Lot Block",
                                            filters={"parenttype": "Export Shipment Lot",
                                                     "block": r.get("name")},
                                            fields=["parent"], limit_page_length=0):
                        if _s(frappe.db.get_value("Export Shipment Lot",
                                                  p["parent"], "mark")) == mark:
                            hit.append(r)
                            break
            except Exception:
                pass
        if len(hit) == 1:
            return {"pick": hit[0], "reason": "decided", "by": "shipping mark {0}".format(mark)}

    # 3. THE SIZE. Nearest CBM, and only when one is clearly nearest.
    theirs = float(ev.get("cbm") or 0) or _cbm_of(ev.get("length"), ev.get("width"),
                                                  ev.get("height"))
    if theirs:
        scored = []
        for r in rows:
            ours = 0.0
            try:
                d = frappe.db.get_value("Quarry Block", r.get("name"),
                                        ["gross_volume", "length_gross", "width_gross",
                                         "height_gross"], as_dict=True) or {}
                ours = float(d.get("gross_volume") or 0) or _cbm_of(
                    d.get("length_gross"), d.get("width_gross"), d.get("height_gross"))
            except Exception:
                ours = 0.0
            if ours:
                scored.append((abs(ours - theirs) / theirs, r, ours))
        scored.sort(key=lambda x: x[0])
        # clearly nearest: within 10%, and the runner-up at least twice as far
        if len(scored) >= 2 and scored[0][0] <= 0.10 and scored[1][0] >= 2 * max(scored[0][0], 0.02):
            return {"pick": scored[0][1], "reason": "decided",
                    "by": "size {0} cbm against {1}".format(round(scored[0][2], 3), theirs)}
        if len(scored) == 1 and scored[0][0] <= 0.10:
            return {"pick": scored[0][1], "reason": "decided",
                    "by": "size {0} cbm against {1}".format(round(scored[0][2], 3), theirs)}

    return {"pick": None, "reason": "still ambiguous", "by": None,
            "candidates": [{"name": r.get("name"),
                            "quarry_no": r.get("block_number"),
                            "export_no": r.get("export_block_no"),
                            "status": r.get("status")} for r in rows]}


@frappe.whitelist()
def who_is_this(key=None, dc=None, mark=None, length=None, width=None, height=None,
                cbm=None, net_wt=None, vehicle_no=None):
    """Which block does this agency row mean? Reads only; writes nothing.

    Answers the question the arrival import has to ask before it believes a
    number, and is the one place the letter-sibling rule lives."""
    k = _s(key)
    if not k:
        frappe.throw("Give a block number.")
    cands = candidates(k, allow_record_name=False)
    sibs = letter_siblings(k)
    pool = cands + [s for s in sibs
                    if str(s.get("name")) not in {str(c.get("name")) for c in cands}]

    if not pool:
        return {"ok": 0, "verdict": "not_found", "asked": k,
                "message": "Nothing answers to {0}.".format(k)}

    if len(pool) == 1:
        return {"ok": 1, "verdict": "one_block", "asked": k, "block": pool[0],
                "letter_siblings": [], "message": "{0} means exactly one block.".format(k)}

    ev = {"dc": dc, "mark": mark, "length": length, "width": width, "height": height,
          "cbm": cbm, "net_wt": net_wt, "vehicle_no": vehicle_no}
    d = disambiguate(pool, ev)
    if d.get("pick"):
        return {"ok": 1, "verdict": "decided", "asked": k, "block": d["pick"],
                "decided_by": d.get("by"),
                "letter_siblings": [s.get("matched_on") for s in sibs],
                "message": "{0} could mean {1} blocks; settled by {2}.".format(
                    k, len(pool), d.get("by"))}

    return {"ok": 0, "verdict": "ambiguous", "asked": k,
            "candidates": d.get("candidates"),
            "letter_siblings": [s.get("matched_on") for s in sibs],
            "message": ("{0} could mean {1} different blocks and nothing on the row "
                        "separates them. Left for a person.").format(k, len(pool))}
