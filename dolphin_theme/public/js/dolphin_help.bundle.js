/* ===========================================================================
   ASK DOLPHIN - 30 Sep 2026.
   His words: "is it possible to create a Q&A field where in user can ask you
   anything regarding the dolphin erp or can state his problems with picture
   and you can sort it? if there is anything major then you can ask to contact
   me Manjunath kandkur".

   A blue "Ask Dolphin" button on every desk screen, stacked ABOVE the navy
   ticker (#di-fab, bottom 66) and the gold Workspace button (#dolphin-ws-fab,
   bottom 18) so neither moves and nothing covers Save/Submit (top right).
   Hidden on print view. Server side: dolphin_theme/help_desk.py.
   Remove this file and its hooks.py entry to take it away.
   =========================================================================== */
(function () {
  if (window.__askDolphin) { return; }
  window.__askDolphin = 1;
  var M = "dolphin_theme.help_desk.";

  function esc(s) { return (s == null ? "" : String(s)).replace(/[&<>"]/g, function (c) {
    return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]; }); }
  function md(s) { try { return frappe.markdown(s || ""); } catch (e) { return esc(s).replace(/\n/g, "<br>"); } }
  function store(k, v) { try { if (v === undefined) { return localStorage.getItem(k) || ""; } localStorage.setItem(k, v); } catch (e) { return ""; } }

  function css() {
    if (document.getElementById("ask-dolphin-css")) { return; }
    var s = document.createElement("style");
    s.id = "ask-dolphin-css";
    s.textContent =
      "#ask-fab{position:fixed;right:18px;bottom:112px;z-index:1051;display:inline-flex;align-items:center;gap:8px;" +
      "background:#2490ef;color:#fff;border:none;border-radius:999px;padding:9px 15px 9px 9px;font-weight:600;" +
      "font-size:13px;box-shadow:0 4px 14px rgba(36,144,239,.45);cursor:pointer}" +
      "#ask-fab b{background:#fff;color:#2490ef;border-radius:50%;width:22px;height:22px;display:inline-flex;" +
      "align-items:center;justify-content:center;font-size:14px}#ask-fab:hover{background:#1579d0}" +
      "@media print{#ask-fab{display:none!important}}" +
      ".ask-ans{border-left:4px solid #1f9d55;background:#f3fbf6;border-radius:4px 10px 10px 4px;padding:10px 13px;font-size:13.5px;line-height:1.55}" +
      ".ask-esc{border-left:4px solid #c0392b;background:#fdf3f2;border-radius:4px 10px 10px 4px;padding:10px 13px;font-size:13.5px;line-height:1.55}" +
      ".ask-chg{border-left:4px solid #2490ef;background:#eef6fe;border-radius:4px 10px 10px 4px;padding:10px 13px;font-size:13px;margin-top:10px}" +
      ".ask-tag{display:inline-block;font-size:11px;font-weight:700;border-radius:10px;padding:2px 9px;margin-bottom:8px}" +
      ".ask-q{background:#eef3f9;border-radius:10px 10px 10px 2px;padding:8px 11px;font-size:13px;margin-bottom:10px;white-space:pre-wrap}" +
      ".ask-contact{margin-top:10px;background:#fff;border:1px solid #f1c7c2;border-radius:8px;padding:9px 11px}" +
      ".ask-think{padding:18px;text-align:center;color:#6b7a90}";
    document.head.appendChild(s);
  }

  function context() {
    var r = [];
    try { r = frappe.get_route() || []; } catch (e) { r = []; }
    var c = { route: r.join(" / ") || location.pathname, ref_doctype: null, ref_name: null };
    if (r[0] === "Form" && r[1]) { c.ref_doctype = r[1]; c.ref_name = r[2] || null; }
    else if (r[0] === "List" && r[1]) { c.ref_doctype = r[1]; }
    return c;
  }

  function onPrint() { return /printview|\/print\//.test(location.pathname + location.hash); }

  function fab() {
    css();
    var b = document.getElementById("ask-fab");
    if (!b) {
      b = document.createElement("button");
      b.id = "ask-fab";
      b.type = "button";
      b.title = "Ask Dolphin — ask anything about Dolphin ERP";
      b.innerHTML = "<b>?</b>Ask Dolphin";
      b.addEventListener("click", function () { open(); });
      document.body.appendChild(b);
    }
    b.style.display = onPrint() ? "none" : "";
  }

  function open(followUp) {
    var c = context();
    var d = new frappe.ui.Dialog({
      title: followUp ? __("Ask a follow-up") : __("Ask Dolphin"),
      size: "large",
      fields: [
        { fieldtype: "HTML", fieldname: "intro", options:
          "<div style='font-size:12.5px;color:#6b7a90;margin-bottom:4px'>Ask anything about Dolphin ERP. Add a photo or screenshot if it helps. " +
          "Screen: <span style='background:#eef3f9;border-radius:10px;padding:2px 8px'>" + esc(c.route) + "</span></div>" },
        { fieldtype: "HTML", fieldname: "who" },
        // 1 Oct 2026: once a name is saved the box is hidden, so the question is never typed into it
        // (seen on his own screenshot). "change" shows it again.
        { fieldtype: "Data", fieldname: "person_name", label: __("Your name"), reqd: 1, default: store("askDolphinName"),
          hidden: store("askDolphinName") ? 1 : 0 },
        { fieldtype: "Small Text", fieldname: "question", label: __("Your question or problem"), reqd: 1 },
        { fieldtype: "Section Break" },
        { fieldtype: "Attach Image", fieldname: "attachment", label: __("Photo / screenshot") },
        { fieldtype: "Column Break" },
        { fieldtype: "Attach Image", fieldname: "attachment_2", label: __("Photo 2") },
        { fieldtype: "Section Break" },
        { fieldtype: "HTML", fieldname: "result" },
      ],
      primary_action_label: __("Ask"),
      primary_action: function (v) {
        store("askDolphinName", v.person_name || "");
        d.get_primary_btn().prop("disabled", true);
        var box = d.fields_dict.result.$wrapper;
        box.html("<div class='ask-think'>Thinking… this can take up to a minute when photos or records are checked.</div>");
        frappe.call({ method: M + "ask", args: {
          question: v.question, person_name: v.person_name, attachment: v.attachment, attachment_2: v.attachment_2,
          route: c.route, ref_doctype: c.ref_doctype, ref_name: c.ref_name, follow_up_of: followUp || null,
        } }).then(function (r) {
          poll(r.message.name, d, v.question, 0);
        }, function () { d.get_primary_btn().prop("disabled", false); box.html(""); });
      },
    });
    var nm = store("askDolphinName");
    if (nm) {
      d.fields_dict.who.$wrapper.html("<div style='font-size:12.5px;margin-bottom:4px'>Asking as <b>" + esc(nm) +
        "</b> · <a href='#' class='ask-chg-name'>change</a></div>");
      d.fields_dict.who.$wrapper.find(".ask-chg-name").on("click", function (e) {
        e.preventDefault(); d.set_df_property("person_name", "hidden", 0); d.fields_dict.who.$wrapper.empty();
        d.fields_dict.person_name.$input.focus();
      });
    }
    d.show();
    setTimeout(function () { try { d.fields_dict.question.$input.focus(); } catch (e) {} }, 300);
    return d;
  }

  function poll(name, d, question, n) {
    frappe.call({ method: M + "status", args: { name: name } }).then(function (r) {
      var s = r.message;
      if (s.status === "Thinking" && n < 90) {
        setTimeout(function () { poll(name, d, question, n + 1); }, 2000);
        return;
      }
      show(s, d, question);
    });
  }

  function show(s, d, question) {
    var box = d.fields_dict.result.$wrapper;
    var html = "<div class='ask-q'>" + esc(question) + "</div>";
    if (s.status === "Thinking") {
      html += "<div class='ask-esc'>Still working on it. Your question is saved as <b>" + esc(s.name) +
        "</b> — open <a href='/app/dolphin-help-question'>My questions</a> in a minute.</div>";
    } else if (s.status === "Needs Admin") {
      html += "<span class='ask-tag' style='background:#fbe3e0;color:#c0392b'>! NEEDS ADMIN</span>" +
        "<div class='ask-esc'>" + md(s.answer) +
        (s.reason ? "<div style='margin-top:6px'><b>Why:</b> " + esc(s.reason) + "</div>" : "") +
        "<div class='ask-contact'>Please contact <b>" + esc(s.admin_name) + "</b> or your admin. " +
        "Your question and photo have already been sent to him." +
        (s.admin_phone ? "<br><a class='btn btn-sm btn-primary' style='margin-top:6px' href='tel:" + esc(s.admin_phone) +
          "'>📞 Call " + esc(s.admin_name) + "</a>" : "") + "</div></div>";
    } else {
      html += "<span class='ask-tag' style='background:#dcf3e5;color:#1f9d55'>✓ " +
        (s.status === "Changed" ? "CHANGED" : (s.status === "Change Requested" ? "CHANGE RECORDED" : "SOLVED")) + "</span>" +
        "<div class='ask-ans'>" + md(s.answer) + "</div>";
      if (s.change) {
        html += "<div class='ask-chg'><b>" + (s.change_applied ? "Screen change made" : "Change waiting for approval") +
          ":</b> " + esc(s.change.doctype) + " → " + esc(s.change.fieldname) + " · " + esc(s.change.property) +
          " = “" + esc(s.change.value) + "”" + (s.change_applied ? "<br>Reload the page (Ctrl+R) to see it." : "") +
          (s.can_revert ? " <button class='btn btn-xs btn-default ask-revert' style='margin-left:6px'>Revert</button>" : "") + "</div>";
      }
    }
    html += "<div style='margin-top:12px;display:flex;gap:8px;flex-wrap:wrap'>" +
      "<a class='btn btn-sm btn-default' href='/app/dolphin-help-question/" + esc(s.name) + "'>Open " + esc(s.name) + "</a>" +
      "<a class='btn btn-sm btn-default' href='/app/dolphin-help-question'>My questions</a>" +
      (s.status !== "Needs Admin" ? "<button class='btn btn-sm btn-default ask-stuck'>Still stuck</button>" : "") +
      "<button class='btn btn-sm btn-primary ask-follow'>Ask a follow-up</button></div>";
    box.html(html);
    d.get_primary_btn().hide();
    box.find(".ask-follow").on("click", function () { d.hide(); open(s.name); });
    box.find(".ask-stuck").on("click", function () {
      frappe.call({ method: M + "still_stuck", args: { name: s.name } }).then(function (r) { show(r.message, d, question); });
    });
    box.find(".ask-revert").on("click", function () {
      frappe.confirm("Put the screen back exactly as it was before this change?", function () {
        frappe.call({ method: M + "revert_change", args: { name: s.name } }).then(function (r) {
          frappe.show_alert({ message: "Reverted. Reload the page to see it.", indicator: "green" });
          show(r.message, d, question);
        });
      });
    });
  }

  window.askDolphin = open;
  $(document).on("app_ready", fab);
  if (frappe.router && frappe.router.on) { frappe.router.on("change", fab); }
  if (document.readyState !== "loading") { setTimeout(fab, 1500); }
})();
