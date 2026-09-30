"""Ask Dolphin - the help assistant inside Dolphin ERP.

30 Sep 2026. His words: "is it possible to create a Q&A field where in user can ask you
anything regarding the dolphin erp or can state his problems with picture and you can sort
it? if there is anything major then you can ask to contact me Manjunath kandkur", then
"minor changes you must do else no use", "Mahantesh and Naveen if they feel they need a
change better to do it", "only whatever is sensitive let it come to me", and "even I
follow whatever all request but I give my own thought".

How it works
- `ask` stores the question as a Dolphin Help Question and queues `run_question` in the
  background (a model call with photos and look-ups can take longer than a web request).
- The screen polls `status` until the answer is in.
- The model can LOOK UP live records (read-only, with the asking user's own permissions,
  so nobody sees a price they cannot already see) and can make a MINOR, reversible screen
  change (a Property Setter from a short allow-list). Every change keeps its previous value
  and has a Revert button. It can never change data.
- Sensitive items are flagged "Needs Admin": he gets an email and a bell notification.
"""

import base64
import io
import json
import os

import frappe
import requests
from frappe.utils import cint, get_url, getdate, nowdate

API_URL = "https://api.anthropic.com/v1/messages"
DEFAULT_MODEL = "claude-sonnet-5-5"
ADMIN_NAME = "Mr Manjunath Kandkur"
ADMIN_EMAIL = "manjukandkur@gmail.com"
DEFAULT_TRUSTED = ("ilkal@dolphingranite.com", "di@dolphingranite.com", "manjukandkur@gmail.com")
MAX_TURNS = 8
MAX_IMAGE_BYTES = 3_500_000

# Minor, reversible screen settings the assistant may change. Nothing else.
ALLOWED_PROPS = {
    "label": "Data",
    "description": "Small Text",
    "placeholder": "Data",
    "in_list_view": "Check",
    "in_standard_filter": "Check",
    "bold": "Check",
    "hidden": "Check",
    "columns": "Int",
}
BLOCKED_MODULES = {"Core", "Custom", "Desk", "Email", "Integrations", "Automation",
                   "Workflow", "Website", "Printing", "Social", "Geo"}
BLOCKED_WORDS = ("Permission", "Role", "User", "Script", "Property Setter", "Settings")


# --------------------------------------------------------------------------- settings
def _settings():
    s = frappe.get_cached_doc("Dolphin Help Settings")
    key = None
    try:
        key = s.get_password("anthropic_api_key", raise_exception=False)
    except Exception:
        key = None
    trusted = [x.strip().lower() for x in (s.get("trusted_users") or "").replace(",", "\n").splitlines() if x.strip()]
    return frappe._dict(
        enabled=cint(s.get("enabled")) if s.get("enabled") is not None else 1,
        key=key,
        model=(s.get("model") or DEFAULT_MODEL).strip(),
        admin_name=s.get("admin_name") or ADMIN_NAME,
        admin_phone=s.get("admin_phone") or "",
        admin_email=s.get("admin_email") or ADMIN_EMAIL,
        daily_limit=cint(s.get("daily_limit")) or 30,
        trusted=trusted or list(DEFAULT_TRUSTED),
        extra=s.get("extra_knowledge") or "",
        email_mode=s.get("email_mode") or "One summary a day",
    )


def _is_trusted(user, st=None):
    st = st or _settings()
    if user == "Administrator" or "System Manager" in frappe.get_roles(user):
        return True
    return (user or "").lower() in st.trusted


def _knowledge(st):
    path = os.path.join(os.path.dirname(__file__), "help_knowledge.md")
    try:
        with open(path, encoding="utf-8") as f:
            text = f.read()
    except Exception:
        text = ""
    if st.extra:
        text += "\n\n## EXTRA KNOWLEDGE FROM MR MANJUNATH (overrides the guide above)\n" + st.extra
    return text


# --------------------------------------------------------------------------- public API
@frappe.whitelist()
def ask(question, person_name=None, attachment=None, attachment_2=None, route=None,
        ref_doctype=None, ref_name=None, follow_up_of=None):
    user = frappe.session.user
    if user == "Guest":
        frappe.throw("Please sign in to use Ask Dolphin.")
    question = (question or "").strip()
    if len(question) < 3 and not attachment:
        frappe.throw("Please type your question.")
    st = _settings()
    today = frappe.db.count("Dolphin Help Question",
                            {"owner": user, "creation": [">=", nowdate()]})
    if today >= st.daily_limit and not _is_trusted(user, st):
        frappe.throw(f"Today's limit of {st.daily_limit} questions is reached. Please contact {st.admin_name}.")

    doc = frappe.get_doc({
        "doctype": "Dolphin Help Question",
        "question": question[:5000],
        "person_name": (person_name or "")[:140],
        "attachment": attachment or None,
        "attachment_2": attachment_2 or None,
        "screen": (route or "")[:240],
        "ref_doctype": ref_doctype if ref_doctype and frappe.db.exists("DocType", ref_doctype) else None,
        "ref_name": (ref_name or "")[:140] or None,
        "follow_up_of": follow_up_of if follow_up_of and frappe.db.exists("Dolphin Help Question", follow_up_of) else None,
        "asked_by": user,
        "status": "Thinking",
    })
    doc.insert(ignore_permissions=True)
    for url in (attachment, attachment_2):
        _attach_file(url, doc.name)
    frappe.db.commit()

    if not st.enabled or not st.key:
        doc.db_set({
            "status": "Needs Admin",
            "answer": ("Ask Dolphin is not switched on yet (no assistant key set). Your question is saved "
                       f"and has been sent to {st.admin_name}."),
            "escalation_reason": "Assistant not switched on - no API key in Dolphin Help Settings.",
        })
        _notify_admin(doc.name)
        frappe.db.commit()
        return {"name": doc.name}

    frappe.enqueue("dolphin_theme.help_desk.run_question", queue="default", timeout=600,
                   name=doc.name, enqueue_after_commit=True)
    return {"name": doc.name}


@frappe.whitelist()
def status(name):
    doc = frappe.get_doc("Dolphin Help Question", name)
    if doc.owner != frappe.session.user and not _is_trusted(frappe.session.user):
        doc.check_permission("read")
    st = _settings()
    return {
        "name": doc.name,
        "status": doc.status,
        "answer": doc.answer,
        "reason": doc.escalation_reason,
        "change": json.loads(doc.change_json) if doc.change_json else None,
        "change_applied": cint(doc.change_applied),
        "admin_reply": doc.admin_reply,
        "can_revert": bool(cint(doc.change_applied) and _is_trusted(frappe.session.user, st)),
        "admin_name": st.admin_name,
        "admin_phone": st.admin_phone,
    }


@frappe.whitelist()
def still_stuck(name, note=None):
    doc = frappe.get_doc("Dolphin Help Question", name)
    if doc.owner != frappe.session.user:
        doc.check_permission("read")
    reason = "User says still stuck." + (f" Note: {note}" if note else "")
    doc.db_set({"status": "Needs Admin", "escalation_reason": reason})
    _notify_admin(doc.name)
    return status(name)


@frappe.whitelist()
def revert_change(name):
    user = frappe.session.user
    if not _is_trusted(user):
        frappe.throw("Only Mr Manjunath, Mahantesh (ilkal@) or the Bangalore office (di@) can revert a change.")
    doc = frappe.get_doc("Dolphin Help Question", name)
    if not cint(doc.change_applied) or not doc.change_json:
        frappe.throw("There is no applied change on this question.")
    ch = json.loads(doc.change_json)
    prev = json.loads(doc.change_previous or "{}")
    ptype = ALLOWED_PROPS.get(ch["property"], "Data")
    from frappe.custom.doctype.property_setter.property_setter import make_property_setter
    if prev.get("had_setter"):
        make_property_setter(ch["doctype"], ch["fieldname"], ch["property"], prev.get("value"), ptype,
                             is_system_generated=False)
    else:
        for ps in frappe.get_all("Property Setter", filters={
                "doc_type": ch["doctype"], "field_name": ch["fieldname"], "property": ch["property"]}, pluck="name"):
            frappe.delete_doc("Property Setter", ps, ignore_permissions=True)
    frappe.clear_cache(doctype=ch["doctype"])
    doc.db_set({"change_applied": 0, "status": "Reverted"})
    doc.add_comment("Comment", f"Change reverted by {user}.")
    return status(name)


@frappe.whitelist()
def apply_pending_change(name):
    """A trusted person approves a change that a non-trusted login asked for."""
    user = frappe.session.user
    if not _is_trusted(user):
        frappe.throw("Only Mr Manjunath, Mahantesh (ilkal@) or the Bangalore office (di@) can approve a change.")
    doc = frappe.get_doc("Dolphin Help Question", name)
    if cint(doc.change_applied) or not doc.change_json:
        frappe.throw("Nothing waiting to be applied.")
    ch = json.loads(doc.change_json)
    ok, msg, prev = _apply_property(ch)
    if not ok:
        frappe.throw(msg)
    doc.db_set({"change_applied": 1, "change_previous": json.dumps(prev), "status": "Changed"})
    doc.add_comment("Comment", f"Change approved and applied by {user}: {msg}")
    return status(name)


# --------------------------------------------------------------------------- the worker
def run_question(name):
    doc = frappe.get_doc("Dolphin Help Question", name)
    asker = doc.asked_by or doc.owner
    st = _settings()
    frappe.set_user(asker)  # every look-up runs with the asker's own permissions
    ctx = frappe._dict(doc=doc, st=st, trusted=_is_trusted(asker, st), change=None, prev=None,
                       applied=False)
    try:
        result = _conversation(doc, st, ctx)
    except Exception as e:
        frappe.set_user("Administrator")
        frappe.log_error(frappe.get_traceback(), f"Ask Dolphin failed: {name}")
        doc.db_set({
            "status": "Needs Admin",
            "answer": f"Sorry, I could not work this out just now. Your question has been sent to {st.admin_name}.",
            "escalation_reason": f"Assistant error: {str(e)[:300]}",
        })
        _notify_admin(name)
        frappe.db.commit()
        return

    frappe.set_user("Administrator")
    outcome = result.get("outcome") or "solved"
    status_value = {"solved": "Answered", "needs_admin": "Needs Admin", "change": "Changed"}.get(outcome, "Answered")
    if outcome == "change" and not ctx.applied:
        status_value = "Change Requested" if ctx.change else "Answered"
    values = {
        "status": status_value,
        "answer": result.get("answer") or "",
        "escalation_reason": result.get("reason") or "",
        "tokens": ctx.get("tokens") or 0,
    }
    if ctx.change:
        values["change_json"] = json.dumps(ctx.change)
        values["change_applied"] = 1 if ctx.applied else 0
        if ctx.prev:
            values["change_previous"] = json.dumps(ctx.prev)
    doc.db_set(values)
    if status_value in ("Needs Admin", "Change Requested"):
        _notify_admin(name)
    frappe.db.commit()


def _system_prompt(st, trusted):
    who = ("This user's login IS trusted to have minor screen changes carried out."
           if trusted else
           "This user's login is NOT trusted to change screens: a minor change they ask for is RECORDED for "
           "Mahantesh / Bangalore office / Mr Manjunath to approve (call apply_minor_change anyway - it will be queued).")
    return f"""You are **Ask Dolphin**, the help assistant inside Dolphin International's ERP (ERPNext).
Staff at the Ilkal quarry, the port and the Bangalore office ask you questions, often with a phone photo or screenshot.
Your job: understand the problem and SORT IT OUT, so they do not have to call {st.admin_name}.

How to answer
- Simple English, short numbered steps, name the exact screen and button. Staff often read on a phone.
- Look things up before answering when a block, document or figure is mentioned: use the tools. Never guess a
  block's status, a document's state or a number. If a number matches several blocks, list them - never pick one.
- Read the photo carefully: error messages, the screen name, "Not Saved", which button is visible.
- Give your own view as well: if what they ask for is risky or there is a better way, say so kindly and briefly.
- You cannot press buttons or change data for them. Tell them exactly what to press.

Minor changes
- You MAY make a minor, reversible screen change with apply_minor_change (label, help text, list column, list filter,
  bold, hide a non-mandatory field, grid column width, placeholder). {who}
- Before calling it, use doctype_fields to get the exact fieldname. One change per call; at most 3 per question.
- Never change data, numbers, rates, permissions or print formats.

Sensitive - send to {st.admin_name} (outcome needs_admin)
- Anything listed as SENSITIVE in the guide: stock/tonnage/weights/measurements/block numbers/rates/prices/invoice
  values/tax; cancelling, deleting or un-submitting submitted documents; permissions and logins; a change to the
  process; a design change (new field, new screen, report, print layout); figures that look wrong; errors you cannot
  explain. In that case explain in one or two lines WHY (e.g. "This is a design change" / "This will change the
  process" / "This affects invoice values") and tell them to contact {st.admin_name} or their admin. Still give any
  safe steps they can do meanwhile.

Finish EVERY question by calling the `reply` tool exactly once.

=== DOLPHIN GUIDE ===
{_knowledge(st)}
"""


TOOLS = [
    {"name": "lookup_block",
     "description": "Find quarry blocks by a number. Searches export block number, quarry block number and record id "
                    "separately and says which field matched. Returns status, pit, grade, measurements, consignee.",
     "input_schema": {"type": "object", "properties": {"number": {"type": "string"}}, "required": ["number"]}},
    {"name": "get_document",
     "description": "Read one document (e.g. Delivery Challan DC-FAEG-140, Shipping Document SHP-EXP-00005) with the "
                    "user's own permissions. Child tables are shortened.",
     "input_schema": {"type": "object", "properties": {"doctype": {"type": "string"}, "name": {"type": "string"}},
                      "required": ["doctype", "name"]}},
    {"name": "search_documents",
     "description": "List documents of a doctype with simple filters, e.g. {\"status\": \"Draft\"} or "
                    "{\"customer\": [\"like\", \"%XIAMEN%\"]}. Returns up to 30 rows.",
     "input_schema": {"type": "object", "properties": {
         "doctype": {"type": "string"}, "filters": {"type": "object"},
         "fields": {"type": "array", "items": {"type": "string"}},
         "order_by": {"type": "string"}}, "required": ["doctype"]}},
    {"name": "doctype_fields",
     "description": "List the fields of a doctype: fieldname, label, type, mandatory, hidden, shown in list view.",
     "input_schema": {"type": "object", "properties": {"doctype": {"type": "string"}}, "required": ["doctype"]}},
    {"name": "apply_minor_change",
     "description": "Make ONE minor, reversible screen change (Property Setter). property must be one of: "
                    + ", ".join(ALLOWED_PROPS) + ". value: text for label/description/placeholder, 0 or 1 for "
                    "in_list_view/in_standard_filter/bold/hidden, 1-10 for columns.",
     "input_schema": {"type": "object", "properties": {
         "doctype": {"type": "string"}, "fieldname": {"type": "string"},
         "property": {"type": "string", "enum": list(ALLOWED_PROPS)},
         "value": {"type": "string"}, "why": {"type": "string"}},
         "required": ["doctype", "fieldname", "property", "value", "why"]}},
    {"name": "reply",
     "description": "Give the final answer to the user. Call exactly once, at the end.",
     "input_schema": {"type": "object", "properties": {
         "answer": {"type": "string", "description": "Markdown answer shown to the user."},
         "outcome": {"type": "string", "enum": ["solved", "needs_admin", "change"],
                     "description": "solved = answered/fixed with steps; change = a minor change was made or "
                                    "requested; needs_admin = sensitive, goes to Mr Manjunath."},
         "reason": {"type": "string", "description": "For needs_admin: one line why (design change / process "
                                                     "change / affects figures / cannot explain)."}},
         "required": ["answer", "outcome"]}},
]


def _conversation(doc, st, ctx):
    content = []
    for url in (doc.attachment, doc.attachment_2):
        img = _image_block(url)
        if img:
            content.append(img)
    where = doc.screen or "not given"
    if doc.ref_doctype:
        where += f" (document: {doc.ref_doctype} {doc.ref_name or ''})"
    text = (f"Asked by: {doc.person_name or ''} (login {doc.asked_by})\n"
            f"Screen: {where}\n\nQuestion:\n{doc.question or '(see photo)'}")
    content.append({"type": "text", "text": text})

    messages = []
    if doc.follow_up_of:
        prev = frappe.db.get_value("Dolphin Help Question", doc.follow_up_of, ["question", "answer"], as_dict=True)
        if prev:
            messages.append({"role": "user", "content": prev.question or "(photo)"})
            messages.append({"role": "assistant", "content": prev.answer or "(no answer)"})
    messages.append({"role": "user", "content": content})

    system = [{"type": "text", "text": _system_prompt(st, ctx.trusted), "cache_control": {"type": "ephemeral"}}]
    tokens = 0
    changes = 0
    for turn in range(MAX_TURNS):
        body = {"model": st.model, "max_tokens": 2000, "system": system, "tools": TOOLS, "messages": messages}
        if turn == MAX_TURNS - 1:
            body["tool_choice"] = {"type": "tool", "name": "reply"}
        r = requests.post(API_URL, json=body, timeout=120, headers={
            "x-api-key": st.key, "anthropic-version": "2023-06-01", "content-type": "application/json"})
        if r.status_code != 200:
            raise Exception(f"Claude API {r.status_code}: {r.text[:300]}")
        data = r.json()
        u = data.get("usage") or {}
        tokens += cint(u.get("input_tokens")) + cint(u.get("output_tokens"))
        ctx.tokens = tokens
        blocks = data.get("content") or []
        messages.append({"role": "assistant", "content": blocks})
        uses = [b for b in blocks if b.get("type") == "tool_use"]
        if not uses:
            txt = "\n".join(b.get("text", "") for b in blocks if b.get("type") == "text").strip()
            return {"answer": txt or "Sorry, I have no answer.", "outcome": "solved"}
        results = []
        for b in uses:
            if b["name"] == "reply":
                return b.get("input") or {}
            if b["name"] == "apply_minor_change":
                changes += 1
                out = _tool_change(b.get("input") or {}, ctx) if changes <= 3 else "Limit of 3 changes reached."
            else:
                out = _run_tool(b["name"], b.get("input") or {})
            results.append({"type": "tool_result", "tool_use_id": b["id"],
                            "content": json.dumps(out, default=str)[:15000]})
        messages.append({"role": "user", "content": results})
    return {"answer": "Sorry, this took too long. It has been sent to the admin.", "outcome": "needs_admin",
            "reason": "Too many steps"}


# --------------------------------------------------------------------------- tools (read-only)
def _run_tool(name, inp):
    try:
        if name == "lookup_block":
            return _lookup_block(str(inp.get("number") or "").strip())
        if name == "get_document":
            d = frappe.get_doc(inp["doctype"], inp["name"])
            d.check_permission("read")
            return _trim(d.as_dict())
        if name == "search_documents":
            dt = inp["doctype"]
            meta = frappe.get_meta(dt)
            fields = inp.get("fields") or ["name"] + [f.fieldname for f in meta.fields if f.in_list_view][:8]
            fields = [f for f in fields if f == "name" or meta.has_field(f) or f in ("docstatus", "modified", "creation")]
            return frappe.get_list(dt, filters=inp.get("filters") or {}, fields=fields,
                                   order_by=inp.get("order_by") or "modified desc", limit_page_length=30)
        if name == "doctype_fields":
            meta = frappe.get_meta(inp["doctype"])
            return [{"fieldname": f.fieldname, "label": f.label, "type": f.fieldtype, "mandatory": f.reqd,
                     "hidden": f.hidden, "in_list_view": f.in_list_view, "in_filter": f.in_standard_filter}
                    for f in meta.fields if f.fieldtype not in ("Column Break",)]
    except frappe.PermissionError:
        return {"error": "This user does not have permission to see that."}
    except Exception as e:
        return {"error": str(e)[:300]}
    return {"error": "unknown tool"}


def _lookup_block(number):
    if not number:
        return {"error": "no number"}
    meta = frappe.get_meta("Quarry Block")
    want = [f for f in ("block_number", "export_block_no", "status", "pit", "granite_quality_grade",
                        "consignee", "length_gross", "width_gross", "height_gross", "volume", "tonnage",
                        "source_quarry_inspection", "delivery_challan", "sale_type") if meta.has_field(f)]
    found = []
    for field in ("export_block_no", "block_number", "name"):
        if field != "name" and not meta.has_field(field):
            continue
        rows = frappe.get_list("Quarry Block", filters={field: number}, fields=["name"] + want, limit_page_length=10)
        for r in rows:
            r["matched_on"] = {"export_block_no": "export number", "block_number": "quarry block number",
                               "name": "record id (internal - may not be the block they mean)"}[field]
            found.append(r)
    if not found:
        return {"result": f"No block answers to {number}."}
    return {"matches": found, "note": ("MORE THAN ONE block answers to this number - list them, do not pick."
                                       if len({r['name'] for r in found}) > 1 else "")}


def _trim(d):
    out = {}
    for k, v in d.items():
        if k in ("_user_tags", "_comments", "_assign", "_liked_by", "_seen"):
            continue
        if isinstance(v, list):
            out[k] = [_trim(x) if isinstance(x, dict) else x for x in v[:60]]
            if len(v) > 60:
                out[k + "_note"] = f"{len(v)} rows, first 60 shown"
        elif isinstance(v, str) and len(v) > 1500:
            out[k] = v[:1500] + "…"
        else:
            out[k] = v
    return out


# --------------------------------------------------------------------------- minor changes
def _tool_change(inp, ctx):
    ch = {k: str(inp.get(k) or "").strip() for k in ("doctype", "fieldname", "property", "value", "why")}
    ok, msg = _validate_change(ch)
    if not ok:
        return {"done": False, "refused": msg}
    if ctx.change:
        return {"done": False, "refused": "Only one change per question is recorded; ask them to send another question."}
    ctx.change = ch
    if not ctx.trusted:
        return {"done": False, "queued": "Recorded for Mahantesh / Bangalore office / Mr Manjunath to approve. "
                                         "Tell the user it will be done once approved."}
    frappe.set_user("Administrator")
    try:
        ok, msg, prev = _apply_property(ch)
    finally:
        frappe.set_user(ctx.doc.asked_by or ctx.doc.owner)
    if not ok:
        ctx.change = None
        return {"done": False, "refused": msg}
    ctx.applied = True
    ctx.prev = prev
    return {"done": True, "detail": msg + " The user must reload the page (Ctrl+R) to see it. A Revert button is "
                                          "on the answer."}


def _validate_change(ch):
    dt, fn, prop, val = ch["doctype"], ch["fieldname"], ch["property"], ch["value"]
    if prop not in ALLOWED_PROPS:
        return False, f"'{prop}' is not a minor change. Allowed: {', '.join(ALLOWED_PROPS)}."
    if not frappe.db.exists("DocType", dt):
        return False, f"No doctype '{dt}'."
    meta = frappe.get_meta(dt)
    if meta.module in BLOCKED_MODULES or any(w in dt for w in BLOCKED_WORDS):
        return False, f"{dt} is a system doctype - send to admin."
    df = meta.get_field(fn)
    if not df:
        return False, f"{dt} has no field '{fn}'. Use doctype_fields first."
    if prop == "hidden" and cint(val) and cint(df.reqd):
        return False, "A mandatory field cannot be hidden - that would block saving. Send to admin."
    if ALLOWED_PROPS[prop] == "Check" and val not in ("0", "1"):
        return False, "Value must be 0 or 1."
    if prop == "columns" and not (1 <= cint(val) <= 10):
        return False, "columns must be 1-10."
    if ALLOWED_PROPS[prop] in ("Data", "Small Text") and (len(val) > 300 or "<script" in val.lower()):
        return False, "Text too long or not allowed."
    return True, ""


def _apply_property(ch):
    ok, msg = _validate_change(ch)
    if not ok:
        return False, msg, None
    dt, fn, prop, val = ch["doctype"], ch["fieldname"], ch["property"], ch["value"]
    existing = frappe.db.get_value("Property Setter",
                                   {"doc_type": dt, "field_name": fn, "property": prop}, ["name", "value"], as_dict=True)
    df = frappe.get_meta(dt).get_field(fn)
    prev = {"had_setter": bool(existing), "value": existing.value if existing else df.get(prop)}
    from frappe.custom.doctype.property_setter.property_setter import make_property_setter
    make_property_setter(dt, fn, prop, val, ALLOWED_PROPS[prop], is_system_generated=False)
    frappe.clear_cache(doctype=dt)
    return True, f"{dt} → field '{df.label or fn}': {prop} changed from '{prev['value']}' to '{val}'.", prev


# --------------------------------------------------------------------------- helpers
def _attach_file(url, name):
    if not url:
        return
    try:
        f = frappe.db.get_value("File", {"file_url": url, "attached_to_name": ["is", "not set"]}, "name")
        if f:
            frappe.db.set_value("File", f, {"attached_to_doctype": "Dolphin Help Question", "attached_to_name": name})
    except Exception:
        pass


def _image_block(url):
    if not url:
        return None
    try:
        fname = frappe.db.get_value("File", {"file_url": url}, "name")
        if not fname:
            return None
        content = frappe.get_doc("File", fname).get_content()
        if isinstance(content, str):
            return None
        media = None
        low = url.lower()
        for ext, mt in ((".png", "image/png"), (".jpg", "image/jpeg"), (".jpeg", "image/jpeg"),
                        (".webp", "image/webp"), (".gif", "image/gif")):
            if low.endswith(ext):
                media = mt
        if media is None or len(content) > MAX_IMAGE_BYTES:
            from PIL import Image
            im = Image.open(io.BytesIO(content))
            im = im.convert("RGB")
            im.thumbnail((1800, 1800))
            buf = io.BytesIO()
            im.save(buf, "JPEG", quality=82)
            content, media = buf.getvalue(), "image/jpeg"
        return {"type": "image", "source": {"type": "base64", "media_type": media,
                                            "data": base64.b64encode(content).decode()}}
    except Exception:
        frappe.log_error(frappe.get_traceback(), "Ask Dolphin: could not read photo")
        return None


def _notify_admin(name):
    """Bell notification always. Email only when Settings say "Every item".

    30 Sep 2026, his words: "dont flood with emails". Default is ONE summary email a day
    (send_daily_summary, 7 pm), and only on a day something needs him.
    """
    try:
        st = _settings()
        doc = frappe.get_doc("Dolphin Help Question", name)
        link = get_url(f"/app/dolphin-help-question/{name}")
        who = doc.person_name or doc.asked_by
        subject = f"Ask Dolphin — needs you: {name} from {who}"
        body = (f"<p><b>Question:</b> {frappe.utils.escape_html(doc.question or '')}</p>"
                f"<p><b>Screen:</b> {frappe.utils.escape_html(doc.screen or '')} "
                f"{frappe.utils.escape_html((doc.ref_doctype or '') + ' ' + (doc.ref_name or ''))}</p>"
                f"<p><b>Why sent to you:</b> {frappe.utils.escape_html(doc.escalation_reason or '')}</p>"
                f"<p><b>Status:</b> {doc.status}</p>"
                f"<p><a href='{link}'>Open {name}</a></p>")
        if frappe.db.exists("User", st.admin_email):
            # type Alert never emails by itself (Frappe skips email for Alert logs)
            frappe.get_doc({"doctype": "Notification Log", "for_user": st.admin_email, "type": "Alert",
                            "document_type": "Dolphin Help Question", "document_name": name,
                            "subject": subject, "email_content": body}).insert(ignore_permissions=True)
        if st.email_mode == "Every item":
            # QUEUED, not sent inline: a mail-service hiccup must never fail the user's question.
            frappe.sendmail(recipients=[st.admin_email], subject=subject, message=body, delayed=True)
    except Exception:
        frappe.log_error(frappe.get_traceback(), "Ask Dolphin: notify failed")


def send_daily_summary():
    """ONE email a day (7 pm) listing what needs him - and nothing at all on a quiet day."""
    try:
        st = _settings()
        if st.email_mode != "One summary a day":
            return
        since = frappe.utils.add_to_date(frappe.utils.now_datetime(), hours=-24)
        need = frappe.get_all("Dolphin Help Question",
                              filters={"status": ["in", ["Needs Admin", "Change Requested"]], "modified": [">=", since]},
                              fields=["name", "person_name", "asked_by", "question", "status", "escalation_reason"],
                              order_by="creation asc", limit_page_length=200)
        if not need:
            return
        total = frappe.db.count("Dolphin Help Question", {"creation": [">=", since]})
        changed = frappe.db.count("Dolphin Help Question", {"creation": [">=", since], "status": "Changed"})
        esc = frappe.utils.escape_html
        rows = "".join(
            f"<tr><td style='padding:4px 8px'><a href='{get_url('/app/dolphin-help-question/' + r.name)}'>{r.name}</a></td>"
            f"<td style='padding:4px 8px'>{esc(r.person_name or r.asked_by or '')}</td>"
            f"<td style='padding:4px 8px'>{esc((r.question or '')[:140])}</td>"
            f"<td style='padding:4px 8px'>{esc(r.status)}</td>"
            f"<td style='padding:4px 8px'>{esc((r.escalation_reason or '')[:140])}</td></tr>" for r in need)
        body = (f"<p>Last 24 hours: <b>{total}</b> questions asked, <b>{changed}</b> screen changes made, "
                f"<b>{len(need)}</b> need you.</p>"
                "<table border='1' style='border-collapse:collapse;font-size:13px'>"
                "<tr><th>ID</th><th>Who</th><th>Question</th><th>Status</th><th>Why</th></tr>"
                f"{rows}</table>"
                f"<p><a href='{get_url('/app/dolphin-help-question?status=Needs%20Admin')}'>Open all that need you</a></p>")
        frappe.sendmail(recipients=[st.admin_email], subject=f"Ask Dolphin — {len(need)} need you today",
                        message=body, delayed=True)
    except Exception:
        frappe.log_error(frappe.get_traceback(), "Ask Dolphin: daily summary failed")
