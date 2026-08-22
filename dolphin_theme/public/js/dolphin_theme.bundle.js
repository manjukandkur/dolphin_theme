/* ============================================================
   DOLPHIN HANDLER GUARD — added 22 Aug 2026.

   WHY THIS EXISTS (his words): "after deploy nothing previously
   implemented should change but it keeps happening why?"

   Because every Client Script for a doctype is concatenated into ONE
   blob and every 'refresh' handler runs in ONE chain. Frappe's wrapper
   RE-THROWS on the first handler that errors, so every handler AFTER it
   silently never runs. No dialog, no banner — the screen just quietly
   loses a button.

   Measured on 22 Aug 2026: 'Local Tax Invoice - Number & Confirm' called
   frm.dashboard.set_headline_safe(...), which does not exist in this
   Frappe build. It threw on every submitted invoice, and everything
   registered after it died — including the Return to Draft button.

   This guard wraps every handler registered through frappe.ui.form.on
   BEFORE Frappe wraps it, so a failure is contained instead of
   re-thrown: the rest of the chain keeps running. The failure is NOT
   hidden — it is logged to the console and shown as a red pill on the
   page, because a silent failure is the thing we are trying to kill.
   ============================================================ */
(function () {
  if (window.__dolphinHandlerGuard) { return; }

  function install() {
    if (!(window.frappe && frappe.ui && frappe.ui.form && frappe.ui.form.on)) { return false; }
    if (window.__dolphinHandlerGuard) { return true; }
    window.__dolphinHandlerGuard = true;
    window.dolphinScriptFailures = window.dolphinScriptFailures || [];

    function showBadge() {
      var n = window.dolphinScriptFailures.length;
      if (!n || !document.body) { return; }
      var el = document.getElementById("dolphin-script-guard-pill");
      if (!el) {
        el = document.createElement("div");
        el.id = "dolphin-script-guard-pill";
        el.style.cssText =
          "position:fixed;left:14px;bottom:14px;z-index:1060;background:#b3242b;color:#fff;" +
          "border-radius:16px;padding:6px 12px;font-size:12px;font-weight:700;cursor:pointer;" +
          "box-shadow:0 2px 8px rgba(0,0,0,.3);font-family:inherit";
        el.title = "A script on this page failed. Other scripts were kept running. Click for detail.";
        el.onclick = function () {
          var rows = window.dolphinScriptFailures.map(function (f) {
            return "<tr><td style='padding:4px 8px;border-bottom:1px solid #eee'>" + f.doctype +
              "</td><td style='padding:4px 8px;border-bottom:1px solid #eee'>" + f.event +
              "</td><td style='padding:4px 8px;border-bottom:1px solid #eee'>" + f.message + "</td></tr>";
          }).join("");
          var d = new frappe.ui.Dialog({
            title: "Scripts that failed on this page",
            fields: [{ fieldtype: "HTML", fieldname: "body" }]
          });
          d.fields_dict.body.$wrapper.html(
            "<div style='font-size:12px;margin-bottom:8px'>These were contained so the rest of the page kept working. " +
            "Report them — a contained failure is still a fault.</div>" +
            "<table style='width:100%;border-collapse:collapse;font-size:12px'>" +
            "<tr><th style='text-align:left;padding:4px 8px'>Doctype</th>" +
            "<th style='text-align:left;padding:4px 8px'>Event</th>" +
            "<th style='text-align:left;padding:4px 8px'>Error</th></tr>" + rows + "</table>");
          d.show();
        };
        document.body.appendChild(el);
      }
      el.textContent = n === 1 ? "1 script failed on this page" : n + " scripts failed on this page";
    }
    window.dolphinShowScriptFailures = showBadge;

    function wrap(doctype, event, fn) {
      if (typeof fn !== "function") { return fn; }
      return function () {
        try {
          return fn.apply(this, arguments);
        } catch (e) {
          var msg = String((e && e.message) || e);
          var seen = window.dolphinScriptFailures.some(function (f) {
            return f.doctype === doctype && f.event === event && f.message === msg;
          });
          if (!seen) { window.dolphinScriptFailures.push({ doctype: doctype, event: event, message: msg }); }
          try {
            console.error("[Dolphin guard] " + doctype + " / " + event +
              " threw and was contained so later scripts still run:", e);
          } catch (x) { /* ignore */ }
          try { showBadge(); } catch (x) { /* ignore */ }
          return undefined;
        }
      };
    }

    var origOn = frappe.ui.form.on;
    frappe.ui.form.on = function (doctype, a, b) {
      try {
        if (typeof a === "string" && typeof b === "function") {
          return origOn.call(this, doctype, a, wrap(doctype, a, b));
        }
        if (a && typeof a === "object") {
          var safe = {};
          Object.keys(a).forEach(function (k) { safe[k] = wrap(doctype, k, a[k]); });
          return origOn.call(this, doctype, safe);
        }
      } catch (e) {
        try { console.error("[Dolphin guard] could not wrap handlers for " + doctype, e); } catch (x) { /* ignore */ }
      }
      return origOn.apply(this, arguments);
    };
    return true;
  }

  if (!install()) {
    var tries = 0;
    var t = setInterval(function () {
      tries += 1;
      if (install() || tries > 200) { clearInterval(t); }
    }, 25);
  }
})();

/* ============================================================
   Dolphin International - desk theme: branding + navigation
   Loaded via app_include_js on every desk page.
   Provides, on EVERY page (current and future doctypes):
     - Sidebar DI logo brand
     - Home-icon / empty-route redirect to the Dolphin workspace
     - Floating "Workspace" button
     - A consistent navy/gold button bar:
         forms   -> Back · Home · Edit · Print · Refresh
         lists   -> Home · Back · Import · Refresh
         reports -> Home · Back · Print · Refresh
     - Custom HTML Block render shim (paints workspace banner +
       section bars + import panel, which Frappe skips in view mode)
   ============================================================ */
frappe.provide("dolphin");
(function () {
  var WS = "dolphin";
  var NAVY = "#16304F", GOLD = "#D4A24A";
  /* Day31: lighter slate-blue for large background surfaces (sidebar/bars/dropdowns) — better
     visibility than the very dark navy. NAVY stays as the dark ink for text on gold/white. */
  var BARBG = "#24507E", BARBG2 = "#2E5E92";
  var BLUE = "#2490ef", BLUE_D = "#1579d0"; // action-button colour (user preference: all blue)

  /* ---------- styles ---------- */
  function addStyles() {
    if (document.getElementById("dolphin-theme-js-css")) return;
    var css =
      "#dolphin-ws-fab{position:fixed;right:18px;bottom:18px;z-index:1050;" +
      "background:" + GOLD + ";color:" + NAVY + ";border:none;border-radius:24px;" +
      "padding:10px 16px;font-weight:700;font-size:13px;" +
      "box-shadow:0 4px 12px rgba(0,0,0,.25);cursor:pointer;}" +
      "#dolphin-ws-fab:hover{background:" + NAVY + ";color:#fff;}" +
      ".dolphin-brand{display:flex;align-items:center;gap:8px;" +
      "padding:8px 10px;margin:8px;border-radius:8px;background:#fff;text-decoration:none;}" +
      ".dolphin-brand img{height:26px;width:auto;}" +
      ".dolphin-brand span{color:" + NAVY + ";font-weight:700;font-size:12px;" +
      "line-height:1.05;font-family:Georgia,serif;}" +
      ".di-navbar{display:inline-flex;gap:6px;align-items:center;margin-right:8px;vertical-align:middle;}" +
      ".di-navbar button{font-size:12px;font-weight:600;padding:6px 12px;border-radius:7px;" +
      "border:none;cursor:pointer;line-height:1;white-space:nowrap;}" +
      ".di-navbar button.di-g{background:" + BLUE + ";color:#fff;}" +
      ".di-navbar button.di-g:hover{background:" + BLUE_D + ";color:#fff;}" +
      ".di-navbar button.di-x{background:#fff;color:" + BLUE + ";border:1px solid " + BLUE + ";}" +
      ".di-navbar button.di-x:hover{background:" + BLUE + ";color:#fff;}" +
      /* all custom action buttons (Refresh & Download Template, Selected Totals, Print Images, etc.) -> blue */
      ".page-head .custom-actions .btn-default,.page-head .custom-actions .btn-secondary," +
      ".page-head .inner-group-button > .btn,.page-head .menu-btn-group > .btn{" +
      "background:" + BLUE + "!important;color:#fff!important;border-color:" + BLUE + "!important;}" +
      ".page-head .custom-actions .btn-default:hover,.page-head .inner-group-button > .btn:hover{" +
      "background:" + BLUE_D + "!important;border-color:" + BLUE_D + "!important;}" +
      /* ---- native sidebar selected-item contrast fix (no more white-on-white) ---- */
      ".body-sidebar .sidebar-item-container.selected>.standard-sidebar-item," +
      ".body-sidebar .standard-sidebar-item.selected," +
      ".standard-sidebar .standard-sidebar-item.selected{background:" + NAVY + "!important;border-radius:6px;}" +
      ".body-sidebar .sidebar-item-container.selected>.standard-sidebar-item *," +
      ".body-sidebar .standard-sidebar-item.selected *," +
      ".standard-sidebar .standard-sidebar-item.selected *{color:#fff!important;fill:#fff!important;}" +
      /* ---- floating left-panel menu ---- */
      "#dolphin-sidemenu{margin:2px 6px 10px;display:flex;flex-direction:column;min-height:0;" +
      "overflow:hidden;background:" + NAVY + ";font-family:Georgia,serif;}" +
      "#dolphin-sidemenu .di-sm-top{display:flex;align-items:center;justify-content:space-between;" +
      "background:linear-gradient(135deg," + NAVY + " 0%,#16365c 100%);color:#fff;padding:9px 12px;" +
      "cursor:pointer;font-weight:700;font-size:13.5px;letter-spacing:.4px;}" +
      "#dolphin-sidemenu .di-sm-top .di-sm-chev{transition:transform .25s;color:" + GOLD + ";}" +
      "#dolphin-sidemenu.di-collapsed .di-sm-body{display:none;}" +
      "#dolphin-sidemenu.di-collapsed .di-sm-top .di-sm-chev{transform:none;}" +
      "#dolphin-sidemenu .di-sm-search{width:calc(100% - 16px);margin:8px;padding:6px 9px;font-size:12px;" +
      "border:1px solid rgba(255,255,255,.18);background:#16365c;color:#fff;border-radius:7px;font-family:inherit;outline:none;}" +
      "#dolphin-sidemenu .di-sm-search:focus{border-color:" + GOLD + ";box-shadow:0 0 0 2px rgba(212,162,74,.2);}" +
      "#dolphin-sidemenu .di-sm-sec{user-select:none;}" +
      "#dolphin-sidemenu .di-sm-shaded{background:rgba(212,162,74,.12);border-left:2px solid " + GOLD + ";border-radius:6px;margin:4px 4px;}" +
      "#dolphin-sidemenu .di-sm-shaded>.di-sm-h>span:first-child{color:" + GOLD + ";}" +
      "#dolphin-sidemenu .di-sm-sec>.di-sm-h{display:flex;align-items:center;justify-content:space-between;" +
      "cursor:pointer;padding:8px 12px;font-size:11.5px;font-weight:700;text-transform:uppercase;letter-spacing:.5px;" +
      "color:" + GOLD + ";background:transparent;border-bottom:1px solid rgba(212,162,74,.30);}" +
      "#dolphin-sidemenu .di-sm-h:hover{background:rgba(255,255,255,.1);}" +
      "#dolphin-sidemenu .di-sm-h .di-sm-count{font-size:9px;background:" + GOLD + ";color:" + NAVY + ";" +
      "border-radius:9px;padding:1px 7px;margin-left:auto;margin-right:7px;font-weight:700;}" +
      "#dolphin-sidemenu .di-sm-h .di-sm-chev{font-size:13px;color:" + GOLD + ";transition:transform .25s;}" +
      "#dolphin-sidemenu .di-sm-chev{width:14px;text-align:center;display:inline-block;line-height:1;}" +
      "#dolphin-sidemenu .di-sm-chev::before{content:'\u2212';}" +
      "#dolphin-sidemenu.di-collapsed .di-sm-top .di-sm-chev::before{content:'+';}" +
      "#dolphin-sidemenu .di-sm-sec.di-closed>.di-sm-h .di-sm-chev::before{content:'+';}" +
      "#dolphin-sidemenu .di-sm-sub.di-closed>.di-sm-subh .di-sm-chev::before{content:'+';}" +
      "#dolphin-sidemenu .di-sm-sec.di-closed>.di-sm-items{display:none;}" +
      "#dolphin-sidemenu .di-sm-sec.di-closed>.di-sm-h .di-sm-chev{transform:none;}" +
      "#dolphin-sidemenu .di-sm-row{display:flex;align-items:stretch;border-top:1px solid rgba(255,255,255,.06);}" +
      "#dolphin-sidemenu .di-sm-link{flex:1;display:block;padding:8px 6px 8px 20px;font-size:13.5px;color:#dfe6ef;" +
      "text-decoration:none;cursor:pointer;line-height:1.25;}" +
      "#dolphin-sidemenu .di-sm-row:hover{background:rgba(255,255,255,.08);}" +
      "#dolphin-sidemenu .di-sm-new{flex:0 0 auto;width:0;overflow:hidden;border:none;background:transparent;" +
      "color:" + GOLD + ";font-size:14px;font-weight:700;cursor:pointer;transition:width .15s;}" +
      "#dolphin-sidemenu .di-sm-row:hover .di-sm-new{width:26px;}" +
      "#dolphin-sidemenu .di-sm-new:hover{background:" + GOLD + ";color:" + NAVY + ";}" +
      "#dolphin-sidemenu .di-sm-row.di-active{background:rgba(212,162,74,.22);border-left:3px solid " + GOLD + ";}" +
      "#dolphin-sidemenu .di-sm-row.di-active .di-sm-link{color:#fff;font-weight:700;padding-left:17px;}" +
      "#dolphin-sidemenu .di-sm-row.di-active .di-sm-new{color:" + GOLD + ";}" +
      "#dolphin-sidemenu .di-sm-empty{padding:10px 12px;font-size:11px;color:#9fb0c4;font-style:italic;}" +
      /* ---- Day31: scrollable menu body (fixes no-scroll bug) ---- */
      "#dolphin-sidemenu .di-sm-body{flex:1 1 auto;min-height:0;overflow-y:auto;overflow-x:hidden;}" +
      "#dolphin-sidemenu .di-sm-body::-webkit-scrollbar{width:8px;}" +
      "#dolphin-sidemenu .di-sm-body::-webkit-scrollbar-track{background:transparent;}" +
      "#dolphin-sidemenu .di-sm-body::-webkit-scrollbar-thumb{background:rgba(212,162,74,.45);border-radius:4px;}" +
      "#dolphin-sidemenu .di-sm-body::-webkit-scrollbar-thumb:hover{background:" + GOLD + ";}" +
      /* ---- Day31: nested sub-groups ---- */
      "#dolphin-sidemenu .di-sm-sub{border-top:1px solid rgba(255,255,255,.05);}" +
      "#dolphin-sidemenu .di-sm-sub>.di-sm-subh{display:flex;align-items:center;cursor:pointer;" +
      "padding:6px 12px 6px 22px;font-size:10.5px;font-weight:700;text-transform:uppercase;letter-spacing:.4px;color:#b9a06a;}" +
      "#dolphin-sidemenu .di-sm-sub>.di-sm-subh:hover{color:" + GOLD + ";background:rgba(255,255,255,.05);}" +
      "#dolphin-sidemenu .di-sm-sub>.di-sm-subh .di-sm-count{font-size:8.5px;background:rgba(212,162,74,.5);color:" + NAVY + ";" +
      "border-radius:9px;padding:1px 6px;margin-left:auto;margin-right:7px;font-weight:700;}" +
      "#dolphin-sidemenu .di-sm-sub>.di-sm-subh .di-sm-chev{font-size:9px;color:#b9a06a;transition:transform .25s;}" +
      "#dolphin-sidemenu .di-sm-sub.di-closed>.di-sm-items{display:none;}" +
      "#dolphin-sidemenu .di-sm-sub.di-closed>.di-sm-subh .di-sm-chev{transform:none;}" +
      "#dolphin-sidemenu .di-sm-sub .di-sm-link{padding-left:34px;font-size:12.5px;}" +
      "#dolphin-sidemenu .di-sm-sub .di-sm-row.di-active .di-sm-link{padding-left:31px;}" +
      /* ============================================================
         Day31: persistent navy/gold ACTION BAR (form pages)
         Theme-drawn bar that harvests Client-Script custom buttons into
         styled dropdowns so they appear immediately + never vanish.
         ============================================================ */
      ".di-actionbar{display:flex;align-items:center;gap:7px;flex-wrap:wrap;background:" + NAVY + ";" +
      "border:1px solid " + GOLD + ";border-radius:9px;padding:5px 9px;margin-right:8px;vertical-align:middle;" +
      "font-family:Georgia,serif;box-shadow:0 2px 8px rgba(0,0,0,.2);}" +
      ".di-actionbar .di-ab-chip{display:inline-flex;align-items:center;gap:6px;height:32px;padding:0 13px;" +
      "border-radius:7px;border:1.5px solid " + GOLD + ";background:transparent;color:" + GOLD + ";" +
      "font-size:13px;font-weight:500;cursor:pointer;line-height:1;font-family:inherit;}" +
      ".di-actionbar .di-ab-chip .di-gl{font-size:16px;line-height:1;}" +
      ".di-actionbar .di-ab-chip .di-gl-home{font-size:20px;}" +
      ".di-actionbar .di-ab-chip:hover{background:" + GOLD + ";color:" + NAVY + ";}" +
      ".di-actionbar .di-ab-title{color:#fff;font-weight:700;font-size:12.5px;margin:0 4px;white-space:nowrap;" +
      "overflow:hidden;text-overflow:ellipsis;max-width:240px;}" +
      ".di-ab-dd{position:relative;display:inline-block;}" +
      ".di-ab-btn{display:inline-flex;align-items:center;gap:5px;height:30px;padding:0 12px;border-radius:7px;" +
      "font-size:12px;font-weight:700;cursor:pointer;border:none;white-space:nowrap;line-height:1;font-family:inherit;}" +
      ".di-ab-btn.di-ab-white{background:#fff;color:" + NAVY + ";border:1px solid " + GOLD + ";}" +
      ".di-ab-btn.di-ab-white:hover{background:#f4ecd9;}" +
      ".di-ab-btn.di-ab-gold{background:" + GOLD + ";color:" + NAVY + ";}" +
      ".di-ab-btn.di-ab-gold:hover{background:#B9933E;}" +
      ".di-ab-btn[disabled]{opacity:.4;cursor:default;}" +
      ".di-ab-menu{position:absolute;right:0;top:calc(100% + 4px);min-width:210px;background:" + NAVY + ";" +
      "border:1px solid " + GOLD + ";border-radius:9px;box-shadow:0 8px 22px rgba(0,0,0,.35);padding:5px;z-index:1060;display:none;}" +
      ".di-ab-dd.di-open .di-ab-menu{display:block;}" +
      ".di-ab-menu .di-ab-item{display:block;width:100%;text-align:left;background:transparent;border:none;color:#dfe6ef;" +
      "font-size:12.5px;padding:8px 12px;border-radius:6px;cursor:pointer;font-family:inherit;white-space:nowrap;}" +
      ".di-ab-menu .di-ab-item:hover{background:rgba(212,162,74,.22);color:#fff;}" +
      ".di-ab-menu .di-ab-empty{color:#9fb0c4;font-style:italic;font-size:11.5px;padding:7px 12px;white-space:nowrap;}" +
      /* Day31: sidebar horizontal resize grip (right edge) */
      ".body-sidebar .di-sb-resizer{position:absolute;top:0;right:0;width:7px;height:100%;cursor:ew-resize;z-index:6;}" +
      ".body-sidebar .di-sb-resizer:hover,.body-sidebar .di-sb-resizer.di-drag{background:rgba(212,162,74,.55);}" +
      /* hide native custom-action buttons we have re-presented in the bar */
      ".di-ab-harvested{display:none !important;}";
    var s = document.createElement("style");
    s.id = "dolphin-theme-js-css";
    s.textContent = css;
    document.head.appendChild(s);
  }

  /* ---------- redirect empty/home route to workspace ---------- */
  function userExited() { try { return sessionStorage.getItem("dolphin_exited") === "1"; } catch (e) { return false; } }
  function maybeRedirect() {
    try {
      var r = frappe.get_route() || [];
      var first = (r[0] || "").toLowerCase();
      // branch users hitting the hidden ERPNext "home" workspace get "Page home not found" -> rescue to Dolphin
      var isSysMgr = (frappe.user_roles || []).indexOf("System Manager") > -1;
      if (first === "home" && !isSysMgr) { if ((frappe.get_route_str() || "") !== WS) frappe.set_route(WS); return; }
      if (userExited()) return; // user chose to exit — don't trap them back in the workspace
      if (first === "" || first === "desktop" || first === "workspaces") {
        if ((frappe.get_route_str() || "") !== WS) frappe.set_route(WS);
      }
    } catch (e) {}
  }

  /* ---------- Home behaviour (confirm-to-exit when already in the workspace) ---------- */
  function onDolphinWorkspaceNow() {
    try {
      var r = frappe.get_route() || [];
      if ((r[0] || "").toLowerCase() === "workspaces") return (r[1] || "").toLowerCase() === WS;
      return (frappe.get_route_str() || "").toLowerCase() === WS;
    } catch (e) { return false; }
  }
  function exitConfirm() {
    var d = new frappe.ui.Dialog({
      title: "Exit Dolphin",
      indicator: "orange",
      primary_action_label: "⌂ ERPNext Home",
      primary_action: function () {
        try { sessionStorage.setItem("dolphin_exited", "1"); } catch (e) {}
        d.hide();
        window.location.href = "/app/home";
      },
      secondary_action_label: "Log out",
      secondary_action: function () {
        d.hide();
        try { frappe.app.logout(); } catch (e) { window.location.href = "/api/method/logout"; }
      }
    });
    d.$body.html('<p style="font-size:14px;margin:6px 2px">Do you want to exit the app and workspace?</p>' +
      '<p style="font-size:12px;color:#888;margin:0 2px">Choose <b>ERPNext Home</b> to leave the Dolphin workspace, or <b>Log out</b> to exit the app. Close this box to stay.</p>');
    d.show();
  }
  function goHome() {
    if (onDolphinWorkspaceNow()) { exitConfirm(); return; }
    try { sessionStorage.removeItem("dolphin_exited"); } catch (e) {}
    try { frappe.set_route(WS); } catch (e) {}
  }

  /* ---------- floating workspace button ---------- */
  function addFab() {
    if (document.getElementById("dolphin-ws-fab") || !document.body) return;
    var b = document.createElement("button");
    b.id = "dolphin-ws-fab"; b.type = "button"; b.title = "Go to Dolphin Workspace";
    b.innerHTML = "&#8962; Workspace";
    b.onclick = function () { goHome(); };
    document.body.appendChild(b);
  }

  /* ---------- sidebar brand ---------- */
  function brandIt() {
    try {
      var sb = document.querySelector(".body-sidebar") || document.querySelector(".standard-sidebar");
      if (sb && !sb.querySelector(".dolphin-brand")) {
        var a = document.createElement("a");
        a.className = "dolphin-brand";
        a.setAttribute("href", "/app/" + WS);
        a.innerHTML = '<img src="/files/dolphin_logo_mono.png" alt="DI"/><span>Dolphin International</span>';
        a.onclick = function (ev) { ev.preventDefault(); goHome(); };
        sb.insertBefore(a, sb.firstChild);
      }
    } catch (e) {}
  }

  /* ---------- floating left-panel menu (mirrors workspace sections) ---------- */
  /* Day30 role gating:
     - Sale Lot = owner's working section -> management only. Operators (ilkal/quarry)
       carry Dolphin Admin/Sales/Super Admin/Entry but NOT System Manager, so System
       Manager is the clean distinguisher between owner/day-user and operators.
     - Local Sale + Shipping = Bangalore tier (di@ has only Dolphin Bangalore). */
  var ROLE_OWNER = ["System Manager", "Administrator", "Dolphin Owner"];
  var ROLE_BANGALORE = ["System Manager", "Administrator", "Dolphin Bangalore", "Dolphin Owner"];
  var ROLE_SHIPPING = ["System Manager", "Administrator", "Dolphin Bangalore"];
  /* Arrivals tier: Bangalore/Admin PLUS Ilkal — Ilkal sees Port Arrival + Blocks At Port
     (so they can view/resolve arrivals) but NOT Shipping Document (gated below). */
  var ROLE_ARRIVALS = ["System Manager", "Administrator", "Dolphin Bangalore", "Dolphin Ilkal"];
  function hasAnyRole(list) {
    try {
      if (!list || !list.length) return true;
      var ur = frappe.user_roles || [];
      return list.some(function (r) { return ur.indexOf(r) > -1; });
    } catch (e) { return true; }
  }

  function diIcon(n) {
    var P = {
      anchor: '<circle cx="12" cy="5" r="2"/><path d="M12 7v14"/><path d="M5 12H3a9 9 0 0 0 18 0h-2"/>',
      ship: '<path d="M2 20a6 6 0 0 0 3 -2 4 4 0 0 0 6 0 4 4 0 0 0 6 0 6 6 0 0 0 3 2"/><path d="M4 18l-1 -7h18l-1 7"/><path d="M12 3v8"/><path d="M8 6h8"/>',
      stack: '<path d="M12 3l9 5 -9 5 -9 -5z"/><path d="M3 13l9 5 9 -5"/>',
      file: '<path d="M14 3v4a1 1 0 0 0 1 1h4"/><path d="M5 3h9l5 5v11a2 2 0 0 1 -2 2H5a2 2 0 0 1 -2 -2V5a2 2 0 0 1 2 -2z"/>'
    };
    return '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:-2px;margin-right:7px">' + (P[n] || P.file) + '</svg>';
  }
  var SECTIONS = [
    { title: "Quarry & Inspection", items: [
      ["Blocks", "/app/dolphin-blocks", null, "url", "stack"],
      ["Quarry Block", "Quarry Block"], ["Quarry Inspection", "Quarry Inspection"],
      ["Buyer Inspection", "Buyer Inspection"] ] },
    { title: "Dispatch & Port", items: [
      ["Delivery Challan", "Delivery Challan"],
      ["Port Arrival", "Port Arrival", ROLE_ARRIVALS, null, "anchor"],
      ["Port & Stock", "/app/dolphin-port", ROLE_ARRIVALS, "url", "stack"],
      ["Export Shipment Lot", "Export Shipment Lot", ROLE_ARRIVALS, null, "ship"] ] },
    { title: "Shipping", roles: ROLE_SHIPPING, shaded: true, items: [
      ["Shipping Document", "Shipping Document", ROLE_SHIPPING, null, "ship"] ] },
    { title: "Sales", items: [
      ["Sale Lot", "Sale Lot", ROLE_OWNER],
      ["Sales & Calculations", "/sales-calc", ROLE_OWNER, "url", "file"],
      ["Local Tax Invoice", "Local Tax Invoice", ROLE_BANGALORE],
      ["Local Blocks Inspector", "Local Blocks Inspector", ROLE_BANGALORE] ] },
    { title: "Reports & Views", items: [
      ["Block Summary", "/block-summary", null, "url", "file"],
      ["Overview & Journey", "/overview", null, "url", "stack"],
      ["DC Consolidated", "/app/dc-consolidated", null, "url", "stack"],
      ["Measurement Variations", "/measurement-variations", null, "url"],
      ["Backups", "/app/backups", ROLE_OWNER, "url"] ] },
    { title: "Masters", subgroups: [
      { title: "Quarry", items: [
        ["Pit", "Pit"], ["Gangman", "Gangman"], ["Granite Grade", "Granite Grade"],
        ["Granite Size Category", "Granite Size Category"], ["Grade Size Rule", "Grade Size Rule"],
        ["Allowance", "Allowance"], ["Specific Gravity", "DMG Tonnage Factor Master"] ] },
      { title: "People & Parties", items: [
        ["Local Consignee", "Local Consignee"], ["Export Consignee", "Export Consignee"],
        ["Inspector", "Inspector"] ] },
      { title: "Logistics", items: [
        ["Indian Port", "Indian Port"], ["Vehicle", "Vehicle"], ["Driver", "Driver"],
        ["Indian State", "Indian State"], ["Foreign Port", "Foreign Port"],
        ["Vessel", "Vessel"], ["Shipping Agent", "Shipping Agent"] ] }
    ] }
  ];
  function currentMenuDoctype() {
    try {
      var r = frappe.get_route() || [];
      var v = (r[0] || "").toLowerCase();
      if ((v === "list" || v === "form") && r[1]) return r[1];
    } catch (e) {}
    return "";
  }
  function lsGet(k, d) { try { var v = localStorage.getItem(k); return v === null ? d : v; } catch (e) { return d; } }
  function lsSet(k, v) { try { localStorage.setItem(k, v); } catch (e) {} }
  function highlightSideMenu() {
    try {
      var root = document.getElementById("dolphin-sidemenu"); if (!root) return;
      var dt = currentMenuDoctype();
      root.querySelectorAll(".di-sm-row").forEach(function (row) {
        row.classList.toggle("di-active", !!dt && row.getAttribute("data-dt") === dt);
      });
    } catch (e) {}
  }
  function filterSideMenu(q) {
    try {
      var root = document.getElementById("dolphin-sidemenu"); if (!root) return;
      q = (q || "").trim().toLowerCase();
      root.querySelectorAll(".di-sm-sec").forEach(function (s) {
        var any = false;
        s.querySelectorAll(".di-sm-row").forEach(function (row) {
          var show = !q || (row.getAttribute("data-label") || "").toLowerCase().indexOf(q) > -1;
          row.style.display = show ? "" : "none";
          if (show) any = true;
        });
        // nested sub-groups: open + show those with matches, hide empty ones while searching
        s.querySelectorAll(".di-sm-sub").forEach(function (sub) {
          var subAny = false;
          sub.querySelectorAll(".di-sm-row").forEach(function (row) {
            if (row.style.display !== "none") subAny = true;
          });
          if (q) { sub.style.display = subAny ? "" : "none"; sub.classList.remove("di-closed"); }
          else { sub.style.display = ""; }
        });
        // when searching, force-open sections that have matches; hide empty ones
        if (q) { s.style.display = any ? "" : "none"; s.classList.remove("di-closed"); }
        else { s.style.display = ""; }
      });
    } catch (e) {}
  }
  function addSideMenu() {
    try {
      var sb = document.querySelector(".body-sidebar") || document.querySelector(".standard-sidebar");
      if (!sb || document.getElementById("dolphin-sidemenu")) { highlightSideMenu(); return; }
      var root = document.createElement("div");
      root.id = "dolphin-sidemenu";
      if (lsGet("di_sm_collapsed", "0") === "1") root.classList.add("di-collapsed");

      var top = document.createElement("div");
      top.className = "di-sm-top";
      top.innerHTML = "<span>☰ Dolphin Menu</span><span class='di-sm-chev'></span>";
      top.onclick = function () {
        root.classList.toggle("di-collapsed");
        lsSet("di_sm_collapsed", root.classList.contains("di-collapsed") ? "1" : "0");
      };
      root.appendChild(top);

      var body = document.createElement("div");
      body.className = "di-sm-body";

      var search = document.createElement("input");
      search.className = "di-sm-search";
      search.type = "text";
      search.placeholder = "🔍  Filter menu…";
      search.oninput = function () { filterSideMenu(search.value); };
      body.appendChild(search);

      // build one navigable row (link + quick "new") for a [label, doctype, roles?] item
      function makeRow(it) {
        var label = it[0], dt = it[1], kind = it[3];
        var row = document.createElement("div");
        row.className = "di-sm-row";
        row.setAttribute("data-dt", dt);
        row.setAttribute("data-label", label);

        var a = document.createElement("a");
        a.className = "di-sm-link";
        a.textContent = label;
        if (it[4] && kind !== "url") { a.innerHTML = diIcon(it[4]) + label; }
        if (kind === "report") { a.setAttribute("href", "/app/query-report/" + encodeURIComponent(dt)); a.onclick = function (ev) { ev.preventDefault(); try { frappe.set_route("query-report", dt); } catch (e) { window.location = "/app/query-report/" + encodeURIComponent(dt); } }; row.appendChild(a); return row; }
        if (kind === "url") { a.setAttribute("href", dt); a.onclick = function (ev) { ev.preventDefault(); window.location.href = dt; }; var ic = { anchor: "<circle cx=\"12\" cy=\"5\" r=\"2\"/><path d=\"M12 7v14\"/><path d=\"M5 12H3a9 9 0 0 0 18 0h-2\"/>", pencil: "<path d=\"M17 3l4 4l-14 14l-4 -4z\"/><path d=\"M16 7l-1.5 -1.5\"/><path d=\"M13 10l-1.5 -1.5\"/><path d=\"M10 13l-1.5 -1.5\"/><path d=\"M7 16l-1.5 -1.5\"/>" }; var pp = ic[it[4]] || ic.pencil; a.innerHTML = "<svg width=\"14\" height=\"14\" viewBox=\"0 0 24 24\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"2\" stroke-linecap=\"round\" stroke-linejoin=\"round\" style=\"vertical-align:-2px;margin-right:7px\">" + pp + "</svg> " + label; row.appendChild(a); return row; }
        a.setAttribute("href", "/app/" + frappe.router.slug(dt));
        a.onclick = function (ev) {
          ev.preventDefault();
          try { frappe.set_route("List", dt); } catch (e) { window.location = "/app/" + frappe.router.slug(dt); }
        };
        row.appendChild(a);

        var nw = document.createElement("button");
        nw.className = "di-sm-new";
        nw.type = "button";
        nw.textContent = "+";
        nw.title = "New " + label;
        nw.onclick = function (ev) {
          ev.preventDefault(); ev.stopPropagation();
          try { frappe.new_doc(dt); } catch (e) { window.location = "/app/" + frappe.router.slug(dt) + "/new"; }
        };
        row.appendChild(nw);
        return row;
      }
      function visibleItems(items) { return (items || []).filter(function (it) { return hasAnyRole(it[2]); }); }

      SECTIONS.forEach(function (sec, si) {
        if (!hasAnyRole(sec.roles)) return; // Day30: section-level role gate
        var secKey = "di_sm_sec_" + si;

        // normalise: a section either has flat .items or nested .subgroups
        var subgroups = sec.subgroups
          ? sec.subgroups.map(function (g) { return { title: g.title, items: visibleItems(g.items), roles: g.roles }; })
                         .filter(function (g) { return hasAnyRole(g.roles) && g.items.length; })
          : null;
        var flatItems = sec.subgroups ? null : visibleItems(sec.items);
        var total = subgroups
          ? subgroups.reduce(function (n, g) { return n + g.items.length; }, 0)
          : flatItems.length;
        if (!total) return; // nothing visible for this user

        var s = document.createElement("div");
        s.className = "di-sm-sec";
        if (sec.shaded) s.classList.add("di-sm-shaded");
        if (lsGet(secKey, "open") === "closed") s.classList.add("di-closed");
        var h = document.createElement("div");
        h.className = "di-sm-h";
        h.innerHTML = "<span>" + sec.title + (sec.shaded ? " \ud83d\udd12" : "") + "</span><span class='di-sm-count'>" + total +
          "</span><span class='di-sm-chev'></span>";
        h.onclick = function () {
          s.classList.toggle("di-closed");
          lsSet(secKey, s.classList.contains("di-closed") ? "closed" : "open");
        };
        s.appendChild(h);

        var box = document.createElement("div");
        box.className = "di-sm-items";

        if (subgroups) {
          subgroups.forEach(function (g, gi) {
            var sub = document.createElement("div");
            sub.className = "di-sm-sub";
            var subKey = secKey + "_sub_" + gi;
            if (lsGet(subKey, "open") === "closed") sub.classList.add("di-closed");
            var sh = document.createElement("div");
            sh.className = "di-sm-subh";
            sh.innerHTML = "<span>" + g.title + "</span><span class='di-sm-count'>" + g.items.length +
              "</span><span class='di-sm-chev'></span>";
            sh.onclick = function () {
              sub.classList.toggle("di-closed");
              lsSet(subKey, sub.classList.contains("di-closed") ? "closed" : "open");
            };
            sub.appendChild(sh);
            var sbox = document.createElement("div");
            sbox.className = "di-sm-items";
            g.items.forEach(function (it) { sbox.appendChild(makeRow(it)); });
            sub.appendChild(sbox);
            box.appendChild(sub);
          });
        } else {
          flatItems.forEach(function (it) { box.appendChild(makeRow(it)); });
        }

        s.appendChild(box);
        body.appendChild(s);
      });

      root.appendChild(body);
      var brand = sb.querySelector(".dolphin-brand");
      if (brand && brand.nextSibling) sb.insertBefore(root, brand.nextSibling);
      else if (brand) sb.appendChild(root);
      else sb.insertBefore(root, sb.firstChild);
      highlightSideMenu();
    } catch (e) {}
  }

  /* ---------- consistent page button bar ---------- */
  function pageType() {
    try {
      var r = frappe.get_route() || [];
      var v = (r[0] || "").toLowerCase();
      if (v === "form") return "form";
      if (v === "print") return "print";
      if (v === "query-report") return "report";
      if (v === "list") return ((r[2] || "").toLowerCase() === "report") ? "report" : "list";
      return "other";
    } catch (e) { return "other"; }
  }
  function mkBtn(label, kind, fn) {
    var b = document.createElement("button");
    b.type = "button"; b.textContent = label; b.className = "di-navbar " + (kind === "g" ? "di-g" : "di-x");
    b.classList.add(kind === "g" ? "di-g" : "di-x");
    b.onclick = fn;
    return b;
  }
  function curDoctype() {
    try {
      var r = frappe.get_route() || [];
      var v = r[0];
      if (v === "List" || v === "Tree" || v === "Report" || v === "Dashboard") {
        return (window.cur_list && cur_list.doctype) || r[1] || "";
      }
      if (v === "Form") {
        return (window.cur_frm && cur_frm.doctype) || r[1] || "";
      }
      if (window.cur_frm && cur_frm.doctype) return cur_frm.doctype;
      if (window.cur_list && cur_list.doctype) return cur_list.doctype;
      return r[1] || "";
    } catch (e) { return ""; }
  }
  /* ---------- import + native template helpers (reused by list bar) ---------- */
  var DI_SKIP = ["Section Break", "Column Break", "HTML", "Tab Break", "Button", "Image", "Fold", "Heading", "Table MultiSelect"];
  function diImportable(f) {
    if (DI_SKIP.indexOf(f.fieldtype) > -1) return false;
    if (f.read_only && !f.allow_on_submit) return false;
    if (["amended_from", "naming_series"].indexOf(f.fieldname) > -1) return false;
    if (f.is_virtual) return false;
    return true;
  }
  function diBuildExportFields(dt) {
    return new Promise(function (resolve) {
      frappe.model.with_doctype(dt, function () {
        var m = frappe.get_meta(dt), ef = {};
        ef[dt] = m.fields.filter(function (f) { return diImportable(f) && f.fieldtype !== "Table"; }).map(function (f) { return f.fieldname; });
        var tables = m.fields.filter(function (x) { return x.fieldtype === "Table"; });
        var i = 0;
        (function next() {
          if (i >= tables.length) return resolve(ef);
          var tbl = tables[i++];
          frappe.model.with_doctype(tbl.options, function () {
            var cm = frappe.get_meta(tbl.options);
            // Frappe's exporter keys child columns by the TABLE FIELDNAME (e.g. "block_rows"),
            // NOT the child doctype name. Keying by doctype name is silently ignored -> parent-only template.
            ef[tbl.fieldname] = cm.fields.filter(diImportable).map(function (x) { return x.fieldname; });
            next();
          });
        })();
      });
    });
  }
  // Doctypes with a LIVE template generator endpoint in the theme app. These build the
  // .xlsx on download from the current masters (real data-validation dropdowns sourced
  // from live data + auto-filled PitMap + volume/tonnage formulas), which Frappe's native
  // download_template cannot do. See dolphin_theme/template_generator.py.
  var DI_GENERATOR_TEMPLATES = {
    "Quarry Inspection": "dolphin_theme.template_generator.quarry_inspection_template",
    "Buyer Inspection": "dolphin_theme.template_generator.buyer_inspection_template",
    "Quarry Block": "dolphin_theme.template_generator.quarry_block_template",
    "Export Shipment Lot": "dolphin_theme.template_generator.export_shipment_lot_template"
  };
  function diDownloadGenerated(dt) {
    var method = DI_GENERATOR_TEMPLATES[dt];
    if (!method) return false;
    var a = document.createElement("a");
    a.href = "/api/method/" + method;
    a.download = dt.replace(/ /g, "_") + "_Import_Template.xlsx";
    document.body.appendChild(a); a.click(); a.remove();
    try { frappe.show_alert({ message: dt + " template (live dropdowns) downloading…", indicator: "green" }); } catch (e) {}
    return true;
  }
  function diDownloadTemplate(dt) {
    if (!dt) return;
    // 1) prefer the live generator endpoint (real dropdowns from current masters) if we ship one
    if (diDownloadGenerated(dt)) return;
    // 2) otherwise fall back to Frappe's native generator (parent + child columns, no dropdowns)
    diBuildExportFields(dt).then(function (ef) {
      var url = "/api/method/frappe.core.doctype.data_import.data_import.download_template?doctype=" +
        encodeURIComponent(dt) + "&export_fields=" + encodeURIComponent(JSON.stringify(ef)) + "&file_type=Excel";
      var a = document.createElement("a"); a.href = url; a.download = dt.replace(/ /g, "_") + "_Import_Template.xlsx";
      document.body.appendChild(a); a.click(); a.remove();
      try { frappe.show_alert({ message: "Import template downloading…", indicator: "green" }); } catch (e) {}
    });
  }
  // expose so any Client Script's Download/Refresh-Template button can route through the same logic
  window.diDownloadTemplate = diDownloadTemplate;
  function diOpenImport(dt) {
    if (!dt) return;
    frappe.model.with_doctype("Data Import", function () {
      var d = frappe.model.get_new_doc("Data Import");
      d.reference_doctype = dt;
      frappe.set_route("Form", "Data Import", d.name);
    });
  }
  // expose a clean single-flow import opener for the workspace Data Import buttons
  window.dolphinImport = diOpenImport;

  /* ============================================================
     Day31: persistent navy/gold ACTION BAR (form pages)
     Drawn by the theme layer (always-on) and re-populated every tick
     by HARVESTING the Client-Script custom buttons already in the
     page header into styled dropdowns. This fixes "buttons only on
     hard refresh" + vanishing, and declutters the per-form button row.
     Native buttons are only hidden AFTER they are re-presented, so a
     harvest failure can never lose access to an action.
     ============================================================ */
  function abForward(el) { try { el.click(); } catch (e) {} }
  function abCloseMenus() {
    document.querySelectorAll(".di-ab-dd.di-open").forEach(function (d) { d.classList.remove("di-open"); });
  }
  function abMakeDropdown(label, kind, key) {
    var dd = document.createElement("span"); dd.className = "di-ab-dd"; dd.setAttribute("data-di-dd", key);
    var btn = document.createElement("button"); btn.type = "button";
    btn.className = "di-ab-btn " + (kind === "white" ? "di-ab-white" : "di-ab-gold");
    btn.innerHTML = label + " <span style='font-size:10px'>▾</span>";
    btn.onclick = function (ev) {
      ev.stopPropagation();
      var open = dd.classList.contains("di-open");
      abCloseMenus();
      if (!open) dd.classList.add("di-open");
    };
    var menu = document.createElement("div"); menu.className = "di-ab-menu";
    dd.appendChild(btn); dd.appendChild(menu);
    return dd;
  }
  function abItem(label, fn) {
    var b = document.createElement("button"); b.type = "button"; b.className = "di-ab-item"; b.textContent = label;
    b.onclick = function (ev) { ev.stopPropagation(); abCloseMenus(); try { fn(); } catch (e) {} };
    return b;
  }
  function abHarvest(head) {
    var items = [];
    head.querySelectorAll(".custom-actions .btn").forEach(function (b) {
      if (b.closest(".di-actionbar")) return;
      if (b.closest(".inner-group-button")) return;       // group toggles handled below
      if (b.classList.contains("dropdown-toggle")) return;
      var lbl = (b.textContent || "").trim();
      if (!lbl) return;
      items.push({ label: lbl, group: "", el: b });
    });
    head.querySelectorAll(".inner-group-button").forEach(function (g) {
      if (g.closest(".di-actionbar")) return;
      var tg = g.querySelector(":scope > button, :scope > .btn");
      var gl = ((tg && tg.textContent) || "").trim();
      g.querySelectorAll(".dropdown-item").forEach(function (it) {
        var lbl = (it.textContent || "").trim();
        if (!lbl) return;
        items.push({ label: lbl, group: gl, el: it, groupEl: g });
      });
    });
    return items;
  }
  /* B58 (20 Aug 2026). His report of 17 Aug: "mark as sold again vanishing :(
     since yesterday ... it appears on refresh for a split second and vanishes".
     Confirmed on 20 Aug by direct observation on a different doctype: he could
     not find "Mark as Exported" on the Shipping Document either. Nothing was
     lost and it was never a permission problem - buildActionBar() harvests EVERY
     Client-Script button into the Actions dropdown and hides the original with
     .di-ab-harvested. That is the paint-then-vanish, exactly.

     A button that changes the state of the business should not be two clicks
     deep inside a menu. These stay on the bar as their own chip AND remain in
     the dropdown, so nothing is taken away from anyone used to finding them there. */
  function abIsLifecycle(it) {
    var s = ((it.group || "") + " " + (it.label || "")).toLowerCase();
    /* 21 Aug 2026, his model and it is the right one: "mark as exported should be under
       shipping documents only right? under export shipment lot there should be button to
       move it to shipping documents?" - that button exists but was buried two clicks deep
       in Actions. Moving a lot on to its Shipping Document is a lifecycle step, so it gets
       a chip on the bar like the rest. */
    return /mark as sold|mark as exported|mark shipped|confirm sale|return to draft|return from exported|return to export shipment lot|create shipping document|open shipping document|fix lot & blocks/.test(s);
  }
  function abIsAddBlocks(it) {
    var s = ((it.group || "") + " " + (it.label || "")).toLowerCase();
    return /add/.test(s) && /(block|marked|from qi|by number)/.test(s);
  }
  function buildActionBar(head) {
    var frm = window.cur_frm; if (!frm) return;
    var host = head.parentElement || head;
    var bar = host.querySelector(".di-actionbar");
    if (!bar) {
      bar = document.createElement("span");
      bar.className = "di-navbar-group di-actionbar";
      /* B16 (17 Aug 2026): this used to be flexWrap:"nowrap", which is why the
         bar ran off the edge and half the buttons were unreachable on a narrow
         window. Let it wrap, keep the rows tight, and never let it overflow. */
      bar.style.flexWrap = "wrap";
      bar.style.rowGap = "4px";
      bar.style.maxWidth = "100%";
      bar.style.overflow = "visible";
      var back = abChip("‹", "Back", function () { window.history.back(); });
      var home = abChip("⌂", "Home", function () { goHome(); });
      var title = document.createElement("span"); title.className = "di-ab-title"; title.setAttribute("data-di-abtitle", "1");
      var addDD = abMakeDropdown("Add Blocks", "white", "add");
      var actDD = abMakeDropdown("Actions", "gold", "act");
      var save = document.createElement("button"); save.type = "button"; save.className = "di-ab-btn di-ab-gold"; save.textContent = "Save";
      save.onclick = function () { try { frm.save(); } catch (e) {} };
      bar.appendChild(back); bar.appendChild(home); bar.appendChild(title);
      bar.appendChild(addDD); bar.appendChild(actDD); bar.appendChild(save);
      host.insertBefore(bar, head);
    }
    var t = bar.querySelector("[data-di-abtitle]");
    if (t) { try { t.textContent = (frm.doc && frm.doc.__islocal) ? ("New " + frm.doctype) : ((frm.doc && frm.doc.name) || frm.doctype); } catch (e) { t.textContent = frm.doctype; } }

    var addMenu = bar.querySelector("[data-di-dd='add'] .di-ab-menu");
    var actMenu = bar.querySelector("[data-di-dd='act'] .di-ab-menu");
    if (!addMenu || !actMenu) return;
    addMenu.innerHTML = ""; actMenu.innerHTML = "";

    // B58: drop any chips promoted on the previous refresh before rebuilding
    Array.prototype.forEach.call(bar.querySelectorAll("[data-di-lifecycle]"), function (n) { n.remove(); });
    // ...and never promote the same label twice. abHarvest can return the same
    // action more than once (the button and its group wrapper both match), which
    // put two "Mark as Exported" chips on the bar the first time this shipped.
    var abPromoted = {};
    var abSaveBtn = null;
    Array.prototype.forEach.call(bar.querySelectorAll("button.di-ab-btn"), function (b) {
      if ((b.textContent || "").trim() === "Save") abSaveBtn = b;
    });

    /* 21 Aug 2026: the dropdown listed "Mark as Exported" TWICE. abHarvest can return
       the same action more than once - the button and its group wrapper both match -
       and only the chip was deduped. Dedupe the menu items too, keyed on group+label
       so two genuinely different actions sharing a label both survive. */
    var abSeenItem = {};
    abHarvest(head).forEach(function (it) {
      var abKey = ((it.group || "") + "|" + (it.label || "")).trim();
      if (abSeenItem[abKey]) { return; }
      abSeenItem[abKey] = 1;
      var mi = abItem(it.label, (function (el) { return function () { abForward(el); }; })(it.el));
      if (abIsAddBlocks(it)) addMenu.appendChild(mi); else actMenu.appendChild(mi);

      // B58: a state-changing action also gets its own chip, in front of Save
      if (abIsLifecycle(it) && !abPromoted[(it.label || "").trim()]) {
        abPromoted[(it.label || "").trim()] = 1;
        var chip = document.createElement("button");
        chip.type = "button";
        chip.className = "di-ab-btn di-ab-gold";
        chip.setAttribute("data-di-lifecycle", "1");
        chip.textContent = it.label;
        chip.onclick = (function (el) { return function () { abForward(el); }; })(it.el);
        if (abSaveBtn && abSaveBtn.parentElement === bar) { bar.insertBefore(chip, abSaveBtn); }
        else { bar.appendChild(chip); }
      }

      (it.groupEl || it.el).classList.add("di-ab-harvested"); // hide native only after re-presenting
    });
    // always-available actions
    actMenu.appendChild(abItem("⎙ Print", function () { try { frm.print_doc(); } catch (e) {} }));
    actMenu.appendChild(abItem("⟳ Refresh", function () { try { frm.reload_doc(); } catch (e) {} }));
    actMenu.appendChild(abItem("➕ New " + frm.doctype, function () { try { frappe.new_doc(frm.doctype); } catch (e) {} }));

    // hide the whole "Add Blocks" dropdown on forms that have no block actions (e.g. Quarry Block)
    var addDD = bar.querySelector("[data-di-dd='add']");
    if (addDD) addDD.style.display = addMenu.querySelector(".di-ab-item") ? "" : "none";
  }

  function abChip(glyph, label, fn) {
    var b = document.createElement("button"); b.type = "button"; b.className = "di-ab-chip";
    b.title = label;
    var glcls = (label === "Home") ? "di-gl di-gl-home" : "di-gl";
    b.innerHTML = "<span class='" + glcls + "'>" + glyph + "</span> " + label;
    b.onclick = fn; return b;
  }
  /* Day31: list-view action bar — keeps Add (native primary) / Import / Refresh visible,
     harvests the rest of the Client-Script list buttons into a navy Actions dropdown. */
  /* ---------------------------------------------------------------------------
     STICKY FILTERS - 21 Aug 2026. His report: "filter is confusing if I click on
     somewhere and filter never resets after refresh etc either make it obvious
     that filter is on or off on refresh".

     He is right, and it is worse than confusing. His Shipping Document list read
     "1 of 1" with a filter he did not set on purpose, while five documents existed.
     A list that silently hides rows is a list you cannot trust, and on a shipment
     that is a real hazard - "where did that document go".

     Two changes, which together cover both halves of what he asked for:
       1. A sticky filter is CLEARED on a fresh page load. Filters set while working
          survive moving around the app; they do not survive a refresh. A filter that
          came from the URL (?status=Dispatched) is NEVER cleared - that one was asked
          for on purpose, and it is how the bird's-eye stage links work.
       2. Whenever a filter is on, a gold banner says so, says how many rows are being
          hidden, and clears it in one click.
     --------------------------------------------------------------------------- */
  var diFreshLoad = true;
  var diTotalCache = {};

  function diFilterCss() {
    if (document.getElementById("di-filter-css")) { return; }
    var st = document.createElement("style");
    st.id = "di-filter-css";
    st.textContent =
      ".di-filterbanner{display:flex;align-items:center;gap:9px;margin:0 0 8px;padding:8px 13px;" +
      "background:#fdf6e8;border:1px solid #D4A24A;border-left:5px solid #D4A24A;border-radius:9px;" +
      "font-size:12.8px;color:#6b4a0e}" +
      ".di-filterbanner b{color:#8a5a12}" +
      ".di-fb-dot{width:8px;height:8px;border-radius:50%;background:#D4A24A;flex:none}" +
      ".di-fb-clear{margin-left:auto;border:1px solid #b8892f;background:#fff;color:#6b4a0e;" +
      "border-radius:7px;padding:3px 12px;font-size:12px;cursor:pointer;white-space:nowrap}" +
      ".di-fb-clear:hover{background:#D4A24A;color:#3a2a05}";
    document.head.appendChild(st);
  }

  function diFilterCount() {
    try {
      var f = window.cur_list && cur_list.filter_area && cur_list.filter_area.get();
      if (f && f.length != null) { return f.length; }
    } catch (e) {}
    return 0;
  }
  function diUrlHasFilter() {
    var q = location.search || "";
    return q.length > 1 && q.indexOf("=") > -1;
  }
  function diClearFilters() {
    try { cur_list.filter_area.clear(); }
    catch (e) { try { location.href = location.pathname; } catch (e2) {} }
  }

  function diPaintFilterBanner(head) {
    var lv = window.cur_list;
    if (!lv || !head) { return; }
    var host = head.parentElement || head;
    var n = diFilterCount();
    var b = host.querySelector(".di-filterbanner");
    if (!n) { if (b) { b.remove(); } return; }
    diFilterCss();
    if (!b) {
      b = document.createElement("div");
      b.className = "di-filterbanner";
      host.insertBefore(b, head.nextSibling);
    }
    var shown = 0;
    try { shown = (lv.data || []).length; } catch (e) {}
    var dt = lv.doctype;
    var tot = diTotalCache[dt];
    if (tot == null) {
      diTotalCache[dt] = -1;
      try {
        frappe.db.count(dt).then(function (c) {
          diTotalCache[dt] = c;
          try { diPaintFilterBanner(head); } catch (e) {}
        });
      } catch (e) {}
    }
    var hid = (tot != null && tot >= 0 && tot > shown) ? (tot - shown) : 0;
    var of = (tot != null && tot >= 0) ? (" of " + tot) : "";
    b.innerHTML = '<span class="di-fb-dot"></span><b>Filter on</b>&nbsp;&mdash; showing ' +
      shown + of + (hid ? (", <b>" + hid + " hidden</b>") : "") +
      '. <button type="button" class="di-fb-clear">Clear filter &amp; show all</button>';
    var cb = b.querySelector(".di-fb-clear");
    if (cb) { cb.onclick = function (e) { e.stopPropagation(); diClearFilters(); }; }
  }

  function diFilterGuard(head) {
    if (!window.cur_list) { return; }
    if (diFreshLoad) {
      diFreshLoad = false;
      if (!diUrlHasFilter() && diFilterCount() > 0) {
        diClearFilters();
        return;
      }
    }
    diPaintFilterBanner(head);
  }

  function buildListBar(head) {
    var bar = head.querySelector(".di-actionbar");
    if (!bar) {
      bar = document.createElement("span");
      bar.className = "di-navbar-group di-actionbar";
      var back = abChip("‹", "Back", function () { window.history.back(); });
      var home = abChip("⌂", "Dolphin Home", function () { goHome(); });
      var title = document.createElement("span"); title.className = "di-ab-title"; title.setAttribute("data-di-abtitle", "1");
      var imp = document.createElement("button"); imp.type = "button"; imp.className = "di-ab-btn di-ab-white"; imp.textContent = "⤓ Import";
      imp.onclick = function () { try { diOpenImport(curDoctype()); } catch (e) {} };
      var actDD = abMakeDropdown("Actions", "gold", "act");
      var refresh = document.createElement("button"); refresh.type = "button"; refresh.className = "di-ab-btn di-ab-white"; refresh.textContent = "⟳ Refresh";
      refresh.onclick = function () { try { if (window.cur_list) cur_list.refresh(); else location.reload(); } catch (e) { location.reload(); } };
      bar.appendChild(back); bar.appendChild(home); bar.appendChild(title);
      bar.appendChild(imp); bar.appendChild(actDD); bar.appendChild(refresh);
      head.insertBefore(bar, head.firstChild);
    }
    var t = bar.querySelector("[data-di-abtitle]");
    if (t) { try { t.textContent = (window.cur_list && cur_list.doctype) || curDoctype() || "List"; } catch (e) {} }
    var actMenu = bar.querySelector("[data-di-dd='act'] .di-ab-menu");
    if (!actMenu) return;
    actMenu.innerHTML = "";
    var abSeenList = {};
    abHarvest(head).forEach(function (it) {
      var abKeyL = ((it.group || "") + "|" + (it.label || "")).trim();
      if (abSeenList[abKeyL]) { return; }
      abSeenList[abKeyL] = 1;
      var mi = abItem(it.label, (function (el) { return function () { abForward(el); }; })(it.el));
      actMenu.appendChild(mi);
      (it.groupEl || it.el).classList.add("di-ab-harvested");
    });
    if (!actMenu.querySelector(".di-ab-item")) {
      var e = document.createElement("div"); e.className = "di-ab-empty"; e.textContent = "No extra actions"; actMenu.appendChild(e);
    }
    diFilterGuard(head);
  }

  /* Day31 persistence fix: insert into the ACTIVE page's action area, not a stale/hidden
     cached page. Frappe keeps previous route pages in the DOM (display:none); a global
     querySelector(".page-actions") often matched a hidden one, so the bar "only appeared
     on hard refresh". Prefer cur_frm/cur_list's own page wrapper. */
  function activePageActions() {
    try {
      var cands = [];
      if (window.cur_frm && cur_frm.page) cands.push(cur_frm.page);
      if (window.cur_list && cur_list.page) cands.push(cur_list.page);
      if (window.cur_page && cur_page.page) cands.push(cur_page.page);
      for (var i = 0; i < cands.length; i++) {
        var pg = cands[i];
        var pa = (pg.page_actions && pg.page_actions.length) ? pg.page_actions[0]
               : (pg.wrapper ? $(pg.wrapper).find(".page-actions")[0] : null);
        if (pa && pa.offsetParent !== null) return pa; // only if actually visible (not a stale hidden page)
      }
    } catch (e) {}
    var all = document.querySelectorAll(".page-actions");
    for (var j = 0; j < all.length; j++) { if (all[j].offsetParent !== null) return all[j]; } // first visible
    return all[0] || null;
  }

  /* Day31: minimal Back/Home bar for custom desk pages (e.g. Stock Dashboard) which are
     neither form/list/report — previously these had no bar at all. */
  function buildPageBar(head) {
    var bar = head.querySelector(".di-actionbar");
    if (!bar) {
      bar = document.createElement("span");
      bar.className = "di-navbar-group di-actionbar";
      var back = abChip("‹", "Back", function () { window.history.back(); });
      var home = abChip("⌂", "Home", function () { goHome(); });
      var title = document.createElement("span"); title.className = "di-ab-title"; title.setAttribute("data-di-abtitle", "1");
      bar.appendChild(back); bar.appendChild(home); bar.appendChild(title);
      head.insertBefore(bar, head.firstChild);
    }
    var t = bar.querySelector("[data-di-abtitle]");
    if (t) {
      var ttlEl = document.querySelector(".page-head .title-area .title-text, .page-head .title-text");
      t.textContent = ttlEl ? ttlEl.textContent.trim().slice(0, 40) : (((frappe.get_route() || [])[0]) || "").replace(/-/g, " ");
    }
  }

  function addButtonBar() {
    try {
      var t = pageType();
      var head = activePageActions();
      if (!head) return;
      if (t === "form") { buildActionBar(head); return; } // Day31: forms use the persistent action bar
      if (t === "list") { buildListBar(head); return; }   // Day31: lists use the navy Actions-dropdown bar
      if (t === "other") {
        // custom desk pages (Stock Dashboard, etc.) get a minimal Back/Home bar; skip the workspace (home)
        try { if (onDolphinWorkspace()) return; } catch (e) {}
        var r0 = (((frappe.get_route() || [])[0]) || "").toLowerCase();
        if (r0 === "" || r0 === "workspaces") return;
        buildPageBar(head); return;
      }
      // report / print: keep the existing simple navy bar
      if (head.querySelector(".di-navbar-group")) return;
      var bar = document.createElement("span");
      bar.className = "di-navbar di-navbar-group";

      var back = mkBtn("‹ Back", "x", function () { window.history.back(); });
      var home = mkBtn("⌂ Home", "g", function () { goHome(); });
      var refresh = mkBtn("⟳ Refresh", "x", function () {
        try {
          if (t === "form" && window.cur_frm) cur_frm.reload_doc();
          else if (t === "list" && window.cur_list) cur_list.refresh();
          else if (t === "report" && frappe.query_report) frappe.query_report.refresh();
          else location.reload();
        } catch (e) { location.reload(); }
      });

      if (t === "form") {
        var edit = mkBtn("✎ Edit", "g", function () {
          try {
            window.scrollTo(0, 0);
            if (window.cur_frm) {
              var f = cur_frm.fields.find(function (x) {
                return x.df && !x.df.read_only && x.df.fieldtype &&
                  ["Data", "Int", "Float", "Select", "Link", "Text", "Small Text", "Date"].indexOf(x.df.fieldtype) > -1;
              });
              if (f && f.$input) f.$input.focus();
            }
          } catch (e) {}
        });
        var print = mkBtn("⎙ Print", "g", function () { try { cur_frm.print_doc(); } catch (e) {} });
        var nw = mkBtn("➕ New", "g", function () { try { frappe.new_doc(curDoctype()); } catch (e) {} });
        [back, home, edit, nw, print, refresh].forEach(function (b) { bar.appendChild(b); });
      } else if (t === "list") {
        var dt = curDoctype();
        var imp = mkBtn("⤓ Import", "g", function () { diOpenImport(dt); });
        [home, back, imp, refresh].forEach(function (b) { bar.appendChild(b); });
      } else if (t === "print") {
        [home, back].forEach(function (b) { bar.appendChild(b); });
      } else { // report
        var rprint = mkBtn("⎙ Print", "g", function () { try { (frappe.query_report && frappe.query_report.print_report) ? frappe.query_report.print_report() : window.print(); } catch (e) { window.print(); } });
        [home, back, rprint, refresh].forEach(function (b) { bar.appendChild(b); });
      }
      head.insertBefore(bar, head.firstChild);
    } catch (e) {}
  }

  /* ---------- Custom HTML Block render shim (Dolphin workspace) ---------- */
  dolphin._chb = dolphin._chb || {};
  dolphin._wsContent = dolphin._wsContent || null;
  function onDolphinWorkspace() {
    try {
      var r = frappe.get_route() || [];
      if ((r[0] || "").toLowerCase() === "workspaces") return (r[1] || "").toLowerCase() === WS;
      return (frappe.get_route_str() || "").toLowerCase() === WS;
    } catch (e) { return false; }
  }
  function injectBlock(host, d) {
    if (!host || host.getAttribute("data-di-painted") === "1") return;
    var w = document.createElement("div");
    if (d && d.style) { var s = document.createElement("style"); s.textContent = d.style; w.appendChild(s); }
    w.insertAdjacentHTML("beforeend", (d && d.html) || "");
    host.innerHTML = ""; host.appendChild(w);
    host.setAttribute("data-di-painted", "1");
  }
  function doPaint(content) {
    var blocks = document.querySelectorAll(".ce-block");
    if (!blocks.length || blocks.length !== content.length) return; // guard: only the Dolphin workspace
    content.forEach(function (b, i) {
      if (!b || b.type !== "custom_block") return;
      var nm = b.data && b.data.custom_block_name; if (!nm) return;
      var blk = blocks[i]; if (!blk) return;
      var host = blk.querySelector(".ce-block__content > div") || blk.querySelector(".ce-block__content");
      if (!host || host.getAttribute("data-di-painted") === "1") return;
      if (dolphin._chb[nm]) { injectBlock(host, dolphin._chb[nm]); return; }
      frappe.db.get_value("Custom HTML Block", nm, ["html", "style"]).then(function (r) {
        var d = (r && r.message) || {}; dolphin._chb[nm] = d; injectBlock(host, d);
      });
    });
  }
  function paintCustomBlocks() {
    if (!onDolphinWorkspace()) return;
    if (dolphin._wsContent) { doPaint(dolphin._wsContent); return; }
    frappe.db.get_value("Workspace", WS, "content").then(function (r) {
      try { dolphin._wsContent = JSON.parse(((r && r.message) || {}).content || "[]"); doPaint(dolphin._wsContent); } catch (e) {}
    });
  }

  /* ---------- Day30: stale-boot mitigation for newly-added doctypes ----------
     The themed SPA caches a stale boot, so doctypes added after that boot
     (Local Tax Invoice / Shipping Document / Local Blocks Inspector) don't
     render until a hard refresh. Proactively pull their meta on the route so
     the list/form view can paint without forcing a reload. Best-effort. */
  var NEW_DOCTYPES = ["Local Tax Invoice", "Shipping Document", "Local Blocks Inspector"];
  function prefetchNewMeta() {
    try {
      var r = frappe.get_route() || [];
      var v = (r[0] || "").toLowerCase();
      if ((v === "list" || v === "form") && r[1] && NEW_DOCTYPES.indexOf(r[1]) > -1) {
        var have = false;
        try { have = !!(frappe.get_meta && frappe.get_meta(r[1])); } catch (e) {}
        if (!have) { try { frappe.model.with_doctype(r[1], function () {}, true); } catch (e) {} }
      }
    } catch (e) {}
  }

  /* ---------- tick with retries (pages render async after route change) ---------- */
  /* Day31: horizontal drag-to-resize for the left sidebar (right-edge grip, width persisted). */
  var __diSbDrag = false;
  function diApplySidebarW(w) {
    try {
      var cont = document.querySelector(".body-sidebar-container");
      var sb = document.querySelector(".body-sidebar");
      if (cont) { cont.style.width = w + "px"; cont.style.minWidth = w + "px"; cont.style.maxWidth = w + "px"; }
      if (sb) { sb.style.width = w + "px"; }
    } catch (e) {}
  }
  function addSidebarResizer() {
    try {
      var sb = document.querySelector(".body-sidebar");
      var cont = document.querySelector(".body-sidebar-container");
      if (!sb || !cont) return;
      var saved = parseInt(lsGet("di_sidebar_w", "") || "0", 10);
      // keep the chosen width across SPA navigations (Frappe re-renders can reset it); skip while dragging or collapsed
      if (saved && !__diSbDrag && sb.classList.contains("expanded")) diApplySidebarW(saved);
      if (sb.querySelector(".di-sb-resizer")) return; // grip already added
      var h = document.createElement("div");
      h.className = "di-sb-resizer";
      h.title = "Drag to widen the menu";
      sb.appendChild(h);
      h.addEventListener("mousedown", function (e) {
        __diSbDrag = true; h.classList.add("di-drag");
        document.body.style.userSelect = "none"; document.body.style.cursor = "ew-resize";
        e.preventDefault();
      });
      document.addEventListener("mousemove", function (e) {
        if (!__diSbDrag) return;
        var left = cont.getBoundingClientRect().left;
        var w = Math.max(180, Math.min(520, Math.round(e.clientX - left)));
        diApplySidebarW(w);
      });
      document.addEventListener("mouseup", function () {
        if (!__diSbDrag) return;
        __diSbDrag = false; h.classList.remove("di-drag");
        document.body.style.userSelect = ""; document.body.style.cursor = "";
        try { lsSet("di_sidebar_w", String(Math.round(cont.getBoundingClientRect().width))); } catch (e) {}
      });
    } catch (e) {}
  }

  /* Day38 banner DISABLED on the desk (user request 27 Jun 2026): it injected itself at
     the very top of every desk page and read like an error popup. The open-flag count now
     lives ONLY on the /dolphin-arrivals page (per-arrival "flags open" badges + the
     full-view "X to resolve" total). To re-enable on the desk, delete the early return. */
  function arrivalsBanner() {
    return; // desk-wide banner removed; counts are shown on the Arrivals page itself
    try {
      if (!hasAnyRole(ROLE_BANGALORE)) return; // arrivals = Bangalore/export tier only (not Quarry/Ilkal)
      if (document.getElementById("di-arr-banner")) return;
      var last = parseInt(lsGet("di_arr_banner_ts", "0"), 10) || 0;
      if (Date.now() - last < 4 * 3600 * 1000) return;
      if (!window.frappe || !frappe.call) return;
      frappe.call({ method: "dolphin_theme.api_arrivals.count_open_flags", callback: function (r) {
        var n = (r && r.message) || 0;
        lsSet("di_arr_banner_ts", String(Date.now()));
        if (!n || document.getElementById("di-arr-banner")) return;
        var bar = document.createElement("div");
        bar.id = "di-arr-banner";
        bar.style.cssText = "position:relative;background:#0F2540;color:#e8d3a6;padding:9px 16px;font-size:13px;display:flex;align-items:center;gap:10px;border-bottom:2px solid #D4A24A;z-index:1000";
        bar.innerHTML = "<span>⚓ " + n + " arrival block" + (n > 1 ? "s have" : " has") + " an open reconciliation flag.</span>" +
          "<a href=\"/dolphin-arrivals\" style=\"color:#fff;font-weight:600;text-decoration:underline\">Review now →</a>" +
          "<button aria-label=\"Dismiss\" style=\"margin-left:auto;background:transparent;border:none;color:#aebfd0;cursor:pointer;font-size:16px\">×</button>";
        bar.querySelector("a").onclick = function (e) { e.preventDefault(); window.location.href = "/dolphin-arrivals"; };
        bar.querySelector("button").onclick = function () { bar.remove(); };
        document.body.insertBefore(bar, document.body.firstChild);
      } });
    } catch (e) {}
  }
  function tick() {
    prefetchNewMeta(); addStyles(); addFab(); brandIt(); addSideMenu(); addSidebarResizer(); maybeRedirect(); addButtonBar(); paintCustomBlocks(); arrivalsBanner();
  }
  function tickRetries() { [0, 350, 800, 1500, 2500].forEach(function (t) { setTimeout(tick, t); }); }

  $(document).on("app_ready", function () { tickRetries(); });
  if (frappe.router && frappe.router.on) {
    frappe.router.on("change", function () { tickRetries(); });
  }
  setTimeout(tick, 900);
  setTimeout(tick, 1800);
  /* re-apply on browser back/forward and bfcache restores (fixes theme "vanishing" when navigating back) */
  window.addEventListener("popstate", function () { tickRetries(); });
  window.addEventListener("pageshow", function () { tickRetries(); });
  /* close action-bar dropdowns on outside click / Escape */
  document.addEventListener("click", function (ev) {
    try { if (!ev.target.closest || !ev.target.closest(".di-ab-dd")) abCloseMenus(); } catch (e) {}
  }, true);
  document.addEventListener("keydown", function (ev) { if (ev.key === "Escape") { try { abCloseMenus(); } catch (e) {} } });
  /* safety net: always keep the page bar (Back/Home/Edit/New/Print) and side menu present */
  function dolphinWsIcon(label){var t=(label||"").toLowerCase();
    if(t.indexOf("dashboard")>=0)return"dashboard";
    if(t.indexOf("inspection")>=0||t.indexOf("inspector")>=0)return"quality";
    if(t.indexOf("challan")>=0)return"small-file";
    if(t.indexOf("loading")>=0)return"stock";
    if(t.indexOf("tax")>=0||t.indexOf("invoice")>=0||t.indexOf("calculation")>=0||t.indexOf("allowance")>=0)return"accounting";
    if(t.indexOf("sale")>=0)return"sell";
    if(t.indexOf("shipment")>=0||t.indexOf("shipping")>=0||t.indexOf("export hub")>=0||t.indexOf("arrival")>=0||t.indexOf("port")>=0||t.indexOf("vessel")>=0)return"stock";
    if(t.indexOf("consignee")>=0||t.indexOf("buyer")>=0||t.indexOf("customer")>=0)return"customer";
    if(t.indexOf("gangman")>=0||t.indexOf("driver")>=0||t.indexOf("agent")>=0)return"hr";
    if(t.indexOf("vehicle")>=0)return"tool";
    if(t.indexOf("state")>=0)return"branch";
    if(t.indexOf("pit")>=0)return"agriculture";
    if(t.indexOf("grade")>=0||t.indexOf("size")>=0||t.indexOf("gravity")>=0||t.indexOf("rule")>=0)return"setting-gear";
    if(t.indexOf("block")>=0)return"grid";
    return"card";}
  function decorateWsShortcuts(){
    try{
      if(!(window.frappe&&frappe.utils&&frappe.utils.icon))return;
      document.querySelectorAll(".shortcut-widget-box .widget-title").forEach(function(ti){
        if(ti.querySelector("svg"))return;
        var sp=ti.querySelector(".ellipsis");var label=sp?(sp.getAttribute("title")||sp.textContent):ti.textContent;
        if(!label)return;
        var html=frappe.utils.icon(dolphinWsIcon(label),"sm");if(!html)return;
        var w=document.createElement("span");w.className="di-ws-ic";
        w.style.cssText="margin-right:7px;display:inline-flex;align-items:center;vertical-align:middle;color:#0F2540";
        w.innerHTML=html;ti.insertBefore(w,ti.firstChild);
      });
    }catch(e){}
  }
  setInterval(function () { try { addButtonBar(); addSideMenu(); decorateWsShortcuts(); } catch (e) {} }, 1000);
  /* robust attach: re-add the bar the instant the page toolbar (re)renders — fixes the
     missing Back/Home bar on fast-loading minimal master forms (New Gangman, New Pit, etc.) */
  try {
    var __diMoT;
    var __diMo = new MutationObserver(function () {
      clearTimeout(__diMoT);
      __diMoT = setTimeout(function () {
        try { __diMo.disconnect(); addButtonBar(); } catch (e) {}
        try { __diMo.observe(document.body, { childList: true, subtree: true }); } catch (e) {}
      }, 200);
    });
    __diMo.observe(document.body, { childList: true, subtree: true });
  } catch (e) {}
  /* ---------- B17: give Ctrl/Cmd+K somewhere to go (17 Aug 2026) ----------
     The theme removes Frappe's navbar, so the framework's Ctrl+K had nothing to
     focus and the shortcut silently did nothing. Bind it ourselves, in priority
     order: the theme's own Trace-a-block box, then the side-menu filter, then
     Frappe's awesomebar if it happens to exist on this page. */
  document.addEventListener("keydown", function (ev) {
    try {
      if (!(ev.metaKey || ev.ctrlKey) || (ev.key !== "k" && ev.key !== "K")) return;
      var target = document.querySelector(".dtq")
        || document.querySelector("#di-trace")
        || document.querySelector("#dolphin-sidemenu .di-sm-search")
        || document.querySelector("#navbar-search, .navbar .awesomplete input");
      if (!target) {
        // last resort: open the side menu, which carries the filter box
        var toggle = document.querySelector(".di-menu-toggle, #dolphin-menu-toggle");
        if (toggle) { toggle.click(); target = document.querySelector("#dolphin-sidemenu .di-sm-search"); }
      }
      if (!target) return;
      ev.preventDefault(); ev.stopPropagation();
      try { target.focus(); target.select && target.select(); } catch (e) {}
    } catch (e) {}
  }, true);

  /* stop Frappe's Ctrl/Cmd+P doc-print (and its "unsaved changes" warning) on non-form pages like the workspace */
  document.addEventListener("keydown", function (ev) {
    try {
      if ((ev.metaKey || ev.ctrlKey) && (ev.key === "p" || ev.key === "P")) {
        var r = frappe.get_route() || [];
        if ((r[0] || "").toLowerCase() !== "form") { ev.stopPropagation(); }
      }
    } catch (e) {}
  }, true);

  /* ---------- make EVERY home affordance behave the same (go to Dolphin / confirm-exit) ----------
     Intercepts the breadcrumb home icon + navbar home so they no longer jump to the raw Frappe home. */
  document.addEventListener("click", function (ev) {
    try {
      var a = ev.target.closest && ev.target.closest('.navbar-breadcrumbs a, #navbar-breadcrumbs a, .page-head .title-area a, .navbar-home, .page-head .breadcrumb a, a.navbar-brand');
      if (!a) return;
      var href = (a.getAttribute("href") || "").split("?")[0];
      // detect the breadcrumb home by its icon (this build's home link has no href, just a #icon-home glyph)
      var iconHome = !!(a.querySelector && a.querySelector('use[href="#icon-home"]'));
      var isHome = href === "/app" || href === "/app/home" || href === "/app/" ||
        a.classList.contains("navbar-home") || (a.closest && a.closest(".navbar-home")) || iconHome;
      if (isHome) { ev.preventDefault(); ev.stopPropagation(); goHome(); }
    } catch (e) {}
  }, true);

  /* ---------- robustness: re-run when the page content swaps in ----------
     Covers hard-loads landing directly on any list/master/report where
     page-actions render after our first ticks (fixes missing bar on masters). */
  try {
    var moT = null;
    var mo = new MutationObserver(function () {
      if (moT) return;
      moT = setTimeout(function () {
        moT = null;
        try { mo.disconnect(); tick(); } catch (e) {}
        try { if (document.body) mo.observe(document.body, { childList: true, subtree: true }); } catch (e) {}
      }, 400);
    });
    if (document.body) mo.observe(document.body, { childList: true, subtree: true });
  } catch (e) {}
})();


/* ===== Dolphin: in-page doc preview + global block trace (added) ===== */
(function(){
  if(window.__dolphinTrace) return; window.__dolphinTrace=1;
  function esc(s){return (s==null?'':(''+s)).replace(/[&<>"]/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c];});}
  var SC={'In Stock':['#eaf3de','#3b6d11'],'Buyer Marked':['#faeeda','#854f0b'],'In Delivery Challan':['#e6f1fb','#0c447c'],'Dispatched/Transported':['#e6f1fb','#0c447c'],'At Port':['#eeedfe','#3c3489'],'At Bannikoppa Station yard':['#eeedfe','#3c3489'],'Shipped':['#e1f5ee','#0f6e56'],'Sold':['#f1efe8','#444441']};
  window.dolphinPreview=function(dt,name,fmt){
    if(!name){return false;}
    var base='/printview?doctype='+encodeURIComponent(dt)+'&name='+encodeURIComponent(name)+'&format='+encodeURIComponent(fmt||'Standard')+'&trigger_print=0&no_letterhead=0';
    var dl='/api/method/frappe.utils.print_format.download_pdf?doctype='+encodeURIComponent(dt)+'&name='+encodeURIComponent(name)+'&format='+encodeURIComponent(fmt||'Standard')+'&no_letterhead=0';
    var xls='/api/method/dolphin_theme.api_arrivals.export_doc_blocks_xls?doctype='+encodeURIComponent(dt)+'&name='+encodeURIComponent(name);
    if(window.frappe&&frappe.ui&&frappe.ui.Dialog){
      var d=new frappe.ui.Dialog({title:dt+' \u00b7 '+name,size:'large'});
      d.$body.html('<iframe src="'+base+'" style="width:100%;height:66vh;border:0;background:#fff;border-radius:6px"></iframe><div style="margin-top:8px;text-align:right"><a class="btn btn-default btn-sm" href="'+dl+'" target="_blank">Download PDF</a> <a class="btn btn-default btn-sm" href="'+xls+'" target="_blank">Download XLS</a> <a class="btn btn-default btn-sm" href="'+base+'" target="_blank">Open in new tab</a></div>');
      d.show();
    } else { window.open(base,'_blank'); }
    return false;
  };
  document.addEventListener('click',function(e){try{var a=e.target.closest&&e.target.closest('a[href*="print_format.download_pdf"]');if(!a)return;var u=new URL(a.getAttribute('href'),location.origin);var dt=u.searchParams.get('doctype'),nm=u.searchParams.get('name'),fmt=u.searchParams.get('format');if(dt&&nm){e.preventDefault();e.stopPropagation();window.dolphinPreview(dt,nm,fmt);}}catch(err){}},true);
  function traceRow(kind,label,dt,name,fmt,color){
    var eye=name?'<button class="btn btn-xs" style="border:1px solid '+color+';color:'+color+';background:#fff;border-radius:10px;padding:1px 9px;font-size:12px" onclick="return window.dolphinPreview(\''+dt+'\',\''+esc(name)+'\',\''+fmt+'\')">\uD83D\uDC41 view</button>':'';
    var nm=name?'<b>'+esc(name)+'</b>':'<span style="color:#8a929c">\u2014 not yet</span>';
    return '<div style="display:flex;align-items:center;gap:10px;padding:8px 10px;border:1px solid #e5e7eb;border-left:3px solid '+color+';border-radius:8px;margin-bottom:6px"><div style="flex:1"><div style="font-size:10px;text-transform:uppercase;letter-spacing:.03em;color:#8a929c">'+label+'</div><div style="font-size:13px">'+nm+'</div></div>'+eye+'</div>';
  }
  window.dolphinTrace=function(q){
    q=(q||'').trim(); if(!q) return;
    var FL=['name','block_number','export_block_no','granite_quality_grade','length_gross','width_gross','height_gross','gross_volume','status','source_quarry_inspection','buyer_inspection','delivery_challan'];
    function fb(field){return fetch('/api/method/frappe.client.get_list?doctype=Quarry Block&filters='+encodeURIComponent(JSON.stringify([[field,'=',q]]))+'&fields='+encodeURIComponent(JSON.stringify(FL))+'&limit_page_length=5',{credentials:'include'}).then(function(r){return r.json();}).then(function(j){return j.message||[];});}
    var d=new frappe.ui.Dialog({title:'Trace block '+esc(q),size:'large'}); d.show(); d.$body.html('<div style="padding:16px;color:#888">Searching\u2026</div>');
    fb('block_number').then(function(bl){ if(bl.length) return bl; return fb('export_block_no'); }).then(function(bl){
      if(!bl.length){ d.$body.html('<div style="padding:16px;color:#888">No block <b>'+esc(q)+'</b> found.</div>'); return; }
      d.$body.html(bl.map(function(b){
        var sc=SC[b.status]||['#f1efe8','#444441'];
        var dim=(b.length_gross||'')+'\u00d7'+(b.width_gross||'')+'\u00d7'+(b.height_gross||'');
        return '<div style="margin-bottom:10px"><div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap;margin-bottom:10px"><span style="font-size:18px;font-weight:600">Block '+esc(b.block_number||b.name)+'</span><span style="font-size:12px;color:#6b7280">'+esc(b.granite_quality_grade||'')+' \u00b7 '+dim+(b.gross_volume?(' \u00b7 '+(+b.gross_volume).toFixed(2)+' cbm'):'')+(b.export_block_no?(' \u00b7 exp '+esc(b.export_block_no)):'')+'</span><span style="margin-left:auto;font-size:12px;padding:2px 10px;border-radius:12px;background:'+sc[0]+';color:'+sc[1]+';font-weight:600">\uD83D\uDCCD '+esc(b.status||'')+'</span></div>'
          +traceRow('QI','Quarry inspection','Quarry Inspection',b.source_quarry_inspection,'Quarry Inspection - Report','#1d9e75')
          +traceRow('BI','Buyer inspection','Buyer Inspection',b.buyer_inspection,'Buyer Inspection - Report','#185fa5')
          +traceRow('DC','Delivery challan','Delivery Challan',b.delivery_challan,'Dolphin Delivery Challan','#7f77dd')+'</div>';
      }).join(''));
    });
  };
  function fmtOf(dt){return {'Quarry Inspection':'Quarry Inspection - Report','Buyer Inspection':'Buyer Inspection - Report','Delivery Challan':'Dolphin Delivery Challan','Port Arrival':'Port Arrival Advice','Shipping Document':'DI Commercial Invoice','Export Shipment Lot':'Standard'}[dt]||'Standard';}
  function dtCanRead(dt){try{return !!(window.frappe&&frappe.model&&frappe.model.can_read(dt));}catch(e){return true;}}
  function dtIcon(g){return {'Block':'🧊','Appears in':'🔗','Transport':'🚚','Truck':'🚚','Quarry inspection':'📋','Buyer inspection':'📋','Delivery challan':'🚚','Arrival':'⚓','Export shipment lot':'📦','Shipping document':'🚢','Sale lot':'🧾','Local tax invoice':'🧾','Buyer':'👤','Consignee':'👤','Vessel':'🚢','Shipping agent':'👤','Port':'📍','Shipping mark':'🏷','Pit':'⛏'}[g]||'🔍';}
  function dolphinFind(q,cb){q=(q||'').trim();if(!q){cb([]);return;}var out=[],p=0;function d(){p--;if(p<=0)cb(out);}
    function gl(dt,fl,fld,mp){p++;fetch('/api/method/frappe.client.get_list?doctype='+encodeURIComponent(dt)+'&filters='+encodeURIComponent(JSON.stringify(fl))+'&fields='+encodeURIComponent(JSON.stringify(fld))+'&limit_page_length=6',{credentials:'include'}).then(function(r){return r.json();}).then(function(j){(j.message||[]).forEach(function(x){var m=mp(x);if(m)out.push(m);});d();}).catch(d);}
    function child(cdt,kf,val,pdt,grp,mk){p++;fetch('/api/method/frappe.client.get_list?doctype='+encodeURIComponent(pdt)+'&filters='+encodeURIComponent(JSON.stringify([[cdt,kf,'=',val]]))+'&fields='+encodeURIComponent(JSON.stringify(['name']))+'&limit_page_length=8',{credentials:'include'}).then(function(r){return r.json();}).then(function(j){var seen={};(j.message||[]).forEach(function(x){if(!x.name||seen[x.name])return;seen[x.name]=1;out.push({t:grp,l:pdt+' · '+x.name,s:'',actions:mk(x.name)});});d();}).catch(d);}
    function prev(dt,n){return {lb:'Preview',on:'doc',dt:dt,name:n,fmt:fmtOf(dt)};}
    function adv(n){return {lb:'Advice',on:'doc',dt:'Port Arrival',name:n,fmt:'Port Arrival Advice'};}
    function shipA(n){var a=[];if(dtCanRead('Shipping Document')){a.push({lb:'Invoice',on:'doc',dt:'Shipping Document',name:n,fmt:'DI Commercial Invoice'});a.push({lb:'Packing',on:'doc',dt:'Shipping Document',name:n,fmt:'DI Packing List'});}return a;}
    function opn(dt,n){return {lb:'Open',on:'nav',route:'/app/'+dt.toLowerCase().replace(/ /g,'-')+'/',name:n};}
    var pm=/^([a-z]{2,4})-/i.exec(q),pfx=pm?pm[1].toUpperCase():null,bare=/^[0-9]+$/.test(q);
    if(bare||!pfx){
      gl('Quarry Block',[['name','like','%'+q+'%']],['name','status'],function(x){return{t:'Block',l:'Block '+x.name,s:x.status||'',actions:[{lb:'Journey',on:'trace',key:x.name},opn('Quarry Block',x.name)]};});
      gl('Quarry Block',[['export_block_no','like','%'+q+'%']],['name','export_block_no','status'],function(x){return{t:'Block',l:'Block '+x.name,s:'export '+x.export_block_no+(x.status?' · '+x.status:''),actions:[{lb:'Journey',on:'trace',key:x.name},opn('Quarry Block',x.name)]};});
    }
    if(bare){
      child('Buyer Inspection Block','block',q,'Buyer Inspection','Appears in',function(n){return[prev('Buyer Inspection',n)];});
      child('DC Block Row','block',q,'Delivery Challan','Appears in',function(n){return[prev('Delivery Challan',n)];});
      child('Port Arrival Block','block_no',q,'Port Arrival','Appears in',function(n){return[adv(n)];});
      child('Shipment Lot Block','block',q,'Export Shipment Lot','Appears in',function(n){return[prev('Export Shipment Lot',n),opn('Export Shipment Lot',n)];});
      if(dtCanRead('Shipping Document'))child('Shipping Block','block',q,'Shipping Document','Appears in',function(n){return shipA(n);});
    }
    if(!bare){gl('Delivery Challan',[['vehicle','like','%'+q+'%']],['name','vehicle'],function(x){return x.vehicle?{t:'Transport',l:'DC '+x.name,s:'truck '+x.vehicle,actions:[prev('Delivery Challan',x.name)]}:null;});}
    var docs=[['Quarry Inspection','Quarry inspection','QI',function(n){return[prev('Quarry Inspection',n)];}],['Buyer Inspection','Buyer inspection','BI',function(n){return[prev('Buyer Inspection',n)];}],['Delivery Challan','Delivery challan','DC',function(n){return[prev('Delivery Challan',n)];}],['Port Arrival','Arrival','ARR',function(n){return[adv(n)];}],['Export Shipment Lot','Export shipment lot','SL',function(n){return[prev('Export Shipment Lot',n),opn('Export Shipment Lot',n)];}],['Shipping Document','Shipping document','SHP',function(n){var a=shipA(n);return a.length?a:[opn('Shipping Document',n)];}],['Sale Lot','Sale lot','SALE',function(n){return[opn('Sale Lot',n)];}],['Local Tax Invoice','Local tax invoice','LTI',function(n){return[prev('Local Tax Invoice',n)];}]];
    docs.forEach(function(c){if(pfx&&c[2]!==pfx)return;gl(c[0],[['name','like','%'+q+'%']],['name'],function(x){var a=c[3](x.name);return a&&a.length?{t:c[1],l:x.name,s:'',actions:a}:null;});});
    if(!bare&&!pfx){
      gl('Export Shipment Lot',[['lot_title','like','%'+q+'%']],['name','lot_title'],function(x){return{t:'Export shipment lot',l:x.name,s:x.lot_title||'',actions:[prev('Export Shipment Lot',x.name),opn('Export Shipment Lot',x.name)]};});
      [['Buyer','Buyer'],['Export Consignee','Consignee'],['Local Consignee','Consignee'],['Vessel','Vessel'],['Shipping Agent','Shipping agent'],['Shipping Mark','Shipping mark'],['Foreign Port','Port'],['Indian Port','Port'],['Pit','Pit']].forEach(function(m){gl(m[0],[['name','like','%'+q+'%']],['name'],function(x){return{t:m[1],l:x.name,s:m[0],actions:[opn(m[0],x.name)]};});});
    }
  }
  function inject(){var __ah=document.querySelectorAll('.page-head'),__ph=null;for(var __i=0;__i<__ah.length;__i++){if(__ah[__i].offsetParent!==null){__ph=__ah[__i];break;}}if(!__ph)__ph=__ah[0];if(!__ph)return;var sb=__ph.querySelector('.row')||__ph.querySelector('.container')||__ph;if(sb.querySelector('.dolphin-trace-box'))return;
    var box=document.createElement('div');box.className='dolphin-trace-box';box.style.cssText='display:inline-flex;align-items:center;position:relative;margin:2px 14px 2px 0;max-width:330px;flex:0 1 330px;z-index:1030';
    box.innerHTML='<div style="display:flex;align-items:center;gap:6px;background:#0f2540;border:1px solid #D4A24A;border-radius:8px;padding:6px 9px"><span style="color:#D4A24A;font-size:13px">&#128269;</span><input class="dtq" placeholder="Trace block no\u2026" style="border:none;background:transparent;color:#fff;font-size:13px;width:100%;outline:none;padding:0;height:auto"></div><div class="dtdd" style="display:none;position:absolute;left:10px;right:10px;top:44px;z-index:1000;background:#fff;border:1px solid #cfd4dc;border-radius:8px;box-shadow:0 6px 20px rgba(0,0,0,.18);max-height:320px;overflow:auto"></div>';
    sb.insertBefore(box,sb.firstChild);var inp=box.querySelector('.dtq'),dd=box.querySelector('.dtdd'),t=null;
    function render(items,q){if(!q){dd.style.display='none';return;}if(!items.length){dd.innerHTML='<div style="padding:12px;color:#888;font-size:12px;text-align:center">No match</div>';dd.style.display='block';return;}var order=['Block','Appears in','Transport','Truck','Quarry inspection','Buyer inspection','Delivery challan','Arrival','Export shipment lot','Shipping document','Sale lot','Local tax invoice','Buyer','Consignee','Vessel','Shipping agent','Port','Shipping mark','Pit'];var groups={};items.forEach(function(r){(groups[r.t]=groups[r.t]||[]).push(r);});var keys=Object.keys(groups).sort(function(a,b){var ia=order.indexOf(a),ib=order.indexOf(b);return (ia<0?99:ia)-(ib<0?99:ib);});dd.innerHTML=keys.map(function(g){var gi=groups[g];return '<div style="font-size:10px;text-transform:uppercase;color:#8a929c;padding:6px 11px 2px;background:#f6f7f9">'+dtIcon(g)+' '+g+(gi.length>1?' · '+gi.length:'')+'</div>'+gi.map(function(r,idx){var btns=(r.actions||[]).map(function(a,ai){return '<button class="dtb" data-g="'+g+'" data-idx="'+idx+'" data-ai="'+ai+'" style="border:0.5px solid #c9ced6;background:#fff;border-radius:8px;padding:2px 9px;font-size:12px;margin-left:6px;cursor:pointer;color:#1f2a3a">'+a.lb+'</button>';}).join('');return '<div class="dti" style="display:flex;align-items:center;gap:8px;padding:8px 11px;border-top:0.5px solid #eee"><div style="flex:1;min-width:0"><div style="font-size:13px;font-weight:500;color:#1f2a3a;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">'+r.l+'</div>'+(r.s?'<div style="font-size:11px;color:#6b7280">'+r.s+'</div>':'')+'</div>'+btns+'</div>';}).join('');}).join('');dd.style.display='block';dd.querySelectorAll('.dtb').forEach(function(el){el.addEventListener('mousedown',function(ev){ev.preventDefault();ev.stopPropagation();var a=groups[el.dataset.g][+el.dataset.idx].actions[+el.dataset.ai];dd.style.display='none';inp.blur();if(a.on==='trace')window.dolphinTrace(a.key);else if(a.on==='doc')window.dolphinPreview(a.dt,a.name,a.fmt);else if(a.on==='nav')window.location.href=a.route+encodeURIComponent(a.name);});});}
    inp.addEventListener('input',function(){clearTimeout(t);var q=inp.value;if(!q.trim()){dd.style.display='none';return;}t=setTimeout(function(){dolphinFind(q,function(items){render(items,q);});},280);});
    inp.addEventListener('focus',function(){if(inp.value.trim()&&dd.children.length)dd.style.display='block';});
    inp.addEventListener('blur',function(){setTimeout(function(){dd.style.display='none';},180);});
    inp.addEventListener('keydown',function(e){if(e.key==='Enter'){e.preventDefault();var f=dd.querySelector('.dtb');if(f){f.dispatchEvent(new MouseEvent('mousedown'));}else if(inp.value.trim()){window.dolphinTrace(inp.value.trim());}}});
  }
  setInterval(inject, 1500); setTimeout(inject, 500);

/* trace box on top bar: re-mount per page */
function diTraceTopbarBoot(){try{if(typeof inject==='function'){inject();}}catch(e){}}
try{if(window.frappe&&frappe.router&&frappe.router.on){frappe.router.on('change',function(){setTimeout(diTraceTopbarBoot,250);setTimeout(diTraceTopbarBoot,850);});}}catch(e){}
setTimeout(diTraceTopbarBoot,1200);setTimeout(diTraceTopbarBoot,2600);
})();

/* ===== Dolphin: Import XLS into an Export Shipment Lot (adds matching At-Port blocks) ===== */
frappe.ui.form.on('Export Shipment Lot', {
  refresh: function (frm) {
    frm.add_custom_button('Import XLS', function () { dolphinImportLotXls(frm); });
    frm.add_custom_button('Download Template', function () { if (window.diDownloadTemplate) window.diDownloadTemplate('Export Shipment Lot'); });
  }
});
function dolphinImportLotXls(frm) {
  if (frm.is_new() || frm.is_dirty()) {
    frm.save().then(function () { dolphinLotUpload(frm); }, function () {
      frappe.msgprint('Fill Shipment Date, then click Import XLS again â the lot saves automatically.');
    });
    return;
  }
  dolphinLotUpload(frm);
}
function dolphinLotUpload(frm) {
  new frappe.ui.FileUploader({
    dialog_title: 'Import blocks from XLS â ' + frm.doc.name,
    allow_multiple: false,
    doctype: frm.doc.doctype,
    docname: frm.doc.name,
    restrictions: { allowed_file_types: ['.xls', '.xlsx'] },
    on_success: function (file) {
      var url = file && (file.file_url || (file.doc && file.doc.file_url));
      if (!url) { frappe.msgprint('Upload failed â no file URL.'); return; }
      frappe.call({
        method: 'dolphin_theme.api_arrivals.import_lot_blocks_xls',
        args: { lot: frm.doc.name, file_url: url },
        freeze: true, freeze_message: 'Matching blocks from sheetâ¦',
        callback: function (r) {
          var m = (r && r.message) || {};
          var msg = '<b>' + (m.added || 0) + '</b> block(s) added to the lot.';
          if (m.not_found && m.not_found.length) {
            msg += '<br><span style="color:#a1451f">' + m.not_found.length +
              ' number(s) not added (not At-Port or unknown): ' +
              frappe.utils.escape_html(m.not_found.join(', ')) + '</span>';
          }
          if (m.message) { msg += '<br>' + frappe.utils.escape_html(m.message); }
          frappe.msgprint({ title: 'Import XLS', message: msg, indicator: (m.added ? 'green' : 'orange') });
          frm.reload_doc();
        }
      });
    }
  });
}

/* ===== Dolphin: Export Shipment Lot list -> "Refresh & Download Template" (live export-number template) ===== */
frappe.listview_settings = frappe.listview_settings || {};
(function () {
  var s = frappe.listview_settings['Export Shipment Lot'] = frappe.listview_settings['Export Shipment Lot'] || {};
  var prev = s.onload;
  s.onload = function (lv) {
    if (prev) { try { prev(lv); } catch (e) {} }
    try {
      lv.page.add_inner_button('Refresh & Download Template', function () {
        if (window.diDownloadTemplate) window.diDownloadTemplate('Export Shipment Lot');
      });
    } catch (e) {}
  };
})();

/* ===========================================================================
   20 Aug 2026 - "is it not possible to search range in this trace block field
   which is everywhere on the menu?"

   The range search shipped earlier today only covered the two portal pages,
   /trace-block and /overview. This is the OTHER search box - the navy one the
   theme injects into every desk page head. Appended deliberately: it captures
   the existing window.dolphinTrace and delegates a plain single number straight
   back to it, so nothing about today's behaviour changes. Only a range or a
   list takes the new path.

     1332              unchanged - the original dialog
     1332-1356         range
     1332 to 1356      range
     1332,1340,1350    list
   =========================================================================== */
(function () {
  if (!window.dolphinTrace || window.__diTraceRange) { return; }
  window.__diTraceRange = 1;
  var MAX = 500;
  var single = window.dolphinTrace;

  function esc3(v) { return (v == null ? "" : ("" + v)).replace(/[&<>"]/g, function (c) {
    return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]; }); }

  function parseQ(raw) {
    var s = String(raw || "").trim();
    if (!s) { return null; }
    var m = s.match(/^(\d+)\s*(?:-|to|\.\.)\s*(\d+)$/i);
    if (m) {
      var a = parseInt(m[1], 10), b = parseInt(m[2], 10);
      if (a > b) { var t = a; a = b; b = t; }
      if (b - a + 1 > MAX) { return { error: "That range is " + (b - a + 1) + " blocks. Please keep it to " + MAX + " or fewer." }; }
      var out = [];
      for (var i = a; i <= b; i++) { out.push(String(i)); }
      return { list: out, label: a + "-" + b };
    }
    if (s.indexOf(",") !== -1) {
      var many = s.split(",").map(function (x) { return x.trim(); }).filter(Boolean);
      if (many.length > MAX) { return { error: "That is " + many.length + " numbers. Please keep it to " + MAX + " or fewer." }; }
      return { list: many, label: many.length + " numbers" };
    }
    return null;                      // a plain single number - not ours
  }

  var FL = ["name", "block_number", "export_block_no", "granite_quality_grade",
            "length_gross", "width_gross", "height_gross", "gross_volume", "status"];

  function find(field, list) {
    var u = "/api/method/frappe.client.get_list?doctype=Quarry Block"
      + "&filters=" + encodeURIComponent(JSON.stringify([[field, "in", list]]))
      + "&fields=" + encodeURIComponent(JSON.stringify(FL))
      + "&limit_page_length=0";
    return fetch(u, { credentials: "include" })
      .then(function (r) { return r.json(); })
      .then(function (j) { return j.message || []; });
  }

  window.dolphinTrace = function (q) {
    var parsed = parseQ(q);
    if (!parsed) { return single(q); }          // unchanged behaviour

    var d = new frappe.ui.Dialog({ title: "Trace blocks " + (parsed.label || ""), size: "extra-large" });
    d.show();
    if (parsed.error) { d.$body.html('<div style="padding:16px;color:#a32d2d">' + esc3(parsed.error) + "</div>"); return; }
    d.$body.html('<div style="padding:16px;color:#888">Searching&hellip;</div>');

    find("block_number", parsed.list)
      .then(function (bl) { return bl.length ? bl : find("export_block_no", parsed.list); })
      .then(function (bl) { return bl.length ? bl : find("name", parsed.list); })
      .then(function (bl) {
        bl = (bl || []).sort(function (x, y) {
          var a = parseInt(x.block_number, 10), b = parseInt(y.block_number, 10);
          if (isNaN(a) || isNaN(b)) { return String(x.block_number).localeCompare(String(y.block_number)); }
          return a - b;
        });
        var found = {};
        bl.forEach(function (b) {
          found[String(b.block_number)] = 1;
          if (b.export_block_no) { found[String(b.export_block_no)] = 1; }
          found[String(b.name)] = 1;
        });
        var missing = parsed.list.filter(function (n) { return !found[n]; });

        var h = '<div style="padding:4px 2px 10px;font-size:13px;color:#4b5563">Showing <b>' + bl.length +
          "</b> of " + parsed.list.length + " asked for." +
          (missing.length ? ' <span style="color:#a32d2d">Not found: <b>' + esc3(missing.join(", ")) + "</b></span>" : "") +
          "</div>";
        if (!bl.length) { d.$body.html(h); return; }

        h += '<div style="max-height:60vh;overflow:auto"><table class="table table-sm" style="width:100%;font-size:13px">' +
          '<thead><tr style="font-size:10.5px;text-transform:uppercase;letter-spacing:.04em;color:#8a929c">' +
          "<th>Block</th><th>Export</th><th>Grade</th><th>Size</th><th style='text-align:right'>CBM</th><th>Status</th><th></th></tr></thead><tbody>";
        bl.forEach(function (b) {
          var dim = (b.length_gross || "") + "×" + (b.width_gross || "") + "×" + (b.height_gross || "");
          h += "<tr><td><b>" + esc3(b.block_number || b.name) + "</b></td>" +
            "<td>" + (b.export_block_no ? esc3(b.export_block_no) : '<span style="color:#9aa3ad">&mdash;</span>') + "</td>" +
            "<td>" + esc3(b.granite_quality_grade || "") + "</td>" +
            "<td>" + (dim === "××" ? "" : esc3(dim)) + "</td>" +
            '<td style="text-align:right">' + (b.gross_volume ? (+b.gross_volume).toFixed(2) : "") + "</td>" +
            "<td>" + esc3(b.status || "") + "</td>" +
            '<td style="text-align:right"><button class="btn btn-xs di-one" data-b="' + esc3(b.block_number || b.name) +
            '" style="border:1px solid #185fa5;color:#185fa5;background:#fff;border-radius:10px;padding:1px 9px;font-size:12px">journey</button></td></tr>';
        });
        h += "</tbody></table></div>";
        d.$body.html(h);
        d.$body.find(".di-one").on("click", function () {
          var b = this.getAttribute("data-b");
          d.hide();
          setTimeout(function () { single(b); }, 120);
        });
      })
      .catch(function (e) {
        d.$body.html('<div style="padding:16px;color:#a32d2d">Error: ' + esc3((e && e.message) || e) + "</div>");
      });
  };
})();

/* ---------------------------------------------------------------------------
   20 Aug 2026, same day follow-up. The range search above only ran when the
   trace box's Enter key fell through to window.dolphinTrace. Typing 1332-1356
   still showed "No block matches" in the dropdown first, because the dropdown
   does LIKE searches on the raw text - so it looked broken and nobody would
   ever press Enter. The dropdown now offers the range itself.
   --------------------------------------------------------------------------- */
(function () {
  if (window.__diTraceRangeDD) { return; }
  window.__diTraceRangeDD = 1;
  var MAX = 500;

  function esc4(v) { return (v == null ? "" : ("" + v)).replace(/[&<>"]/g, function (c) {
    return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]; }); }

  function parseQ(raw) {
    var s = String(raw || "").trim();
    if (!s) { return null; }
    var m = s.match(/^(\d+)\s*(?:-|to|\.\.)\s*(\d+)$/i);
    if (m) {
      var a = parseInt(m[1], 10), b = parseInt(m[2], 10);
      if (a > b) { var t = a; a = b; b = t; }
      var n = b - a + 1;
      if (n > MAX) { return { error: "That range is " + n + " blocks. Please keep it to " + MAX + " or fewer." }; }
      return { count: n, label: a + " to " + b };
    }
    if (s.indexOf(",") !== -1) {
      var many = s.split(",").map(function (x) { return x.trim(); }).filter(Boolean);
      if (!many.length) { return null; }
      if (many.length > MAX) { return { error: "That is " + many.length + " numbers. Please keep it to " + MAX + " or fewer." }; }
      return { count: many.length, label: many.length + " numbers" };
    }
    return null;
  }

  function hook(box) {
    if (box.__diRangeHooked) { return; }
    var inp = box.querySelector(".dtq");
    var dd = box.querySelector(".dtdd");
    if (!inp || !dd) { return; }
    box.__diRangeHooked = 1;

    function show() {
      var raw = inp.value;
      var p = parseQ(raw);
      if (!p) { return; }                       // a plain number - leave the normal dropdown alone
      if (p.error) {
        dd.innerHTML = '<div style="padding:11px 13px;font-size:12.5px;color:#a32d2d">' + esc4(p.error) + "</div>";
        dd.style.display = "block";
        return;
      }
      dd.innerHTML = '<div class="di-rangego" style="padding:11px 13px;display:flex;align-items:center;gap:9px;cursor:pointer">' +
        '<span style="font-size:14px">&#128269;</span>' +
        '<span style="font-size:13px;font-weight:600;color:#1f2a3a">Show all ' + p.count + " blocks</span>" +
        '<span style="font-size:12px;color:#6b7280">' + esc4(p.label) + "</span>" +
        '<span style="margin-left:auto;font-size:11px;color:#8a929c">press Enter</span></div>';
      dd.style.display = "block";
      var go = dd.querySelector(".di-rangego");
      go.addEventListener("mouseenter", function () { go.style.background = "#f6f7f9"; });
      go.addEventListener("mouseleave", function () { go.style.background = ""; });
      go.addEventListener("mousedown", function (ev) {
        ev.preventDefault(); ev.stopPropagation();
        dd.style.display = "none"; inp.blur();
        if (window.dolphinTrace) { window.dolphinTrace(raw); }
      });
    }

    // the built-in handler renders at 280ms; run just after so ours wins
    inp.addEventListener("input", function () {
      clearTimeout(box.__diRangeT);
      box.__diRangeT = setTimeout(show, 330);
    });
    inp.addEventListener("focus", function () {
      clearTimeout(box.__diRangeT);
      box.__diRangeT = setTimeout(show, 330);
    });
  }

  function sweep() {
    var boxes = document.querySelectorAll(".dolphin-trace-box");
    for (var i = 0; i < boxes.length; i++) { hook(boxes[i]); }
  }
  setInterval(sweep, 1200);
  setTimeout(sweep, 700);
})();

/* ===========================================================================
   20 Aug 2026 - the dashboard ticker. His words, in order:
     "give stock overview in the dashboard of stock buyer marked dispatched at
      port and export lot exported in one graphical count representation"
     "in one glance a small graph not full page a paragraph size overview"
     "which can be like a live ticker"
     "it must have all the details like pit, sizes grades, dispatched count etc
      in nut shell everything"

   One strip on the Dolphin workspace, paragraph height, three compact rows:
   the pipeline, then in-stock by grade and size, then by pit. Refreshes every
   60s and whenever the tab comes back to the front. One read-only call. A
   stage sitting at zero is drawn in red rather than as nothing, so a hole in
   the pipeline is visible instead of invisible. Each stage clicks through.
   =========================================================================== */
(function () {
  if (window.__diTicker) { return; }
  window.__diTicker = 1;
  var EVERY = 60000, last = 0;

  function onWorkspace() {
    var p = location.pathname || "";
    return /\/(app|desk)\/dolphin\/?$/.test(p) || /\/(app|desk)\/?$/.test(p);
  }
  function host() {
    var c = document.querySelector(".layout-main-section");
    return (c && c.offsetParent !== null) ? c : null;
  }
  function e5(v) { return (v == null ? "" : ("" + v)).replace(/[&<>"]/g, function (c) {
    return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]; }); }

  function chips(title, arr, tone) {
    if (!arr || !arr.length) { return ""; }
    var body = arr.map(function (x) {
      var faded = (x.k === "Unassigned");
      return '<span style="display:inline-flex;align-items:baseline;gap:5px;padding:2px 8px;border-radius:999px;' +
        'background:' + (faded ? "#f4f6f8" : tone) + ';margin:0 5px 4px 0">' +
        '<b style="font-size:12px;color:' + (faded ? "#95a0ad" : "#0F2540") + '">' + e5(x.k) + "</b>" +
        '<span style="font-size:11.5px;color:#5c6a7a">' + x.n + "</span>" +
        (x.cbm ? '<span style="font-size:10px;color:#95a0ad">' + x.cbm.toLocaleString() + "</span>" : "") +
        "</span>";
    }).join("");
    return '<div style="margin-top:9px"><span style="font-size:9.5px;letter-spacing:.07em;text-transform:uppercase;' +
      'color:#95a0ad;font-weight:700;margin-right:7px">' + e5(title) + "</span>" + body + "</div>";
  }

  function draw(box, d) {
    var stages = d.stages || [], max = 1;
    stages.forEach(function (s) { if (s.n > max) { max = s.n; } });
    var cells = stages.map(function (s, i) {
      var zero = !s.n;
      var h = zero ? 4 : Math.max(6, Math.round((s.n / max) * 32));
      var bar = zero
        ? '<i style="display:block;width:100%;height:4px;background:#f0d2ce;border-top:2px solid #c0392b"></i>'
        : '<i style="display:block;width:100%;height:' + h + 'px;background:#1F4E79;border-radius:3px 3px 0 0"></i>';
      return (i ? '<span style="color:#c8d1da;font-size:12px;padding:0 2px 24px">&rsaquo;</span>' : "") +
        '<span class="di-tk-st" data-status="' + e5(s.status || "") + '" style="flex:1;min-width:0;' +
        (s.status ? "cursor:pointer" : "") + '"><span style="display:flex;align-items:flex-end;height:34px">' + bar +
        '</span><span style="display:block;font-family:Georgia,serif;font-size:16px;line-height:1;margin-top:5px;color:' +
        (zero ? "#c0392b" : "#0F2540") + '">' + s.n + '</span><span style="display:block;font-size:10px;color:#5c6a7a;' +
        'margin-top:2px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">' + e5(s.label) +
        '</span><span style="display:block;font-size:9.5px;color:#95a0ad">' +
        (s.cbm ? (s.cbm.toLocaleString() + " CBM") : "&mdash;") + "</span></span>";
    }).join("");

    box.innerHTML =
      '<div style="font-size:10px;letter-spacing:.07em;text-transform:uppercase;color:#7c8896;font-weight:700;margin-bottom:7px">' +
      'Stock across the pipeline &middot; <span style="color:#0F2540">' + (d.total_blocks || 0) + " blocks</span>" +
      '<span style="float:right;font-weight:400;letter-spacing:0;text-transform:none;color:#95a0ad" class="di-tk-t"></span></div>' +
      '<div style="display:flex;align-items:flex-end;gap:5px">' + cells + "</div>" +
      '<div style="border-top:1px solid #eef2f6;margin-top:10px;padding-top:8px">' +
      '<div style="font-size:10.5px;color:#5c6a7a;margin-bottom:2px">In stock &amp; buyer marked &mdash; <b style="color:#0F2540">' +
      (d.in_stock_blocks || 0) + "</b> blocks, <b style=\"color:#0F2540\">" + (d.in_stock_cbm || 0).toLocaleString() + "</b> CBM</div>" +
      chips("Grade", d.by_grade, "#eef4fb") + chips("Size", d.by_size, "#f3f0fa") + chips("Pit", d.by_pit, "#f0f7f3") +
      "</div>";

    var t = box.querySelector(".di-tk-t");
    if (t) { t.textContent = "updated " + String(d.as_of || "").slice(11, 16); }
    Array.prototype.forEach.call(box.querySelectorAll(".di-tk-st"), function (el) {
      var st = el.getAttribute("data-status");
      if (!st) { return; }
      el.addEventListener("click", function () {
        window.location.href = "/app/quarry-block?status=" + encodeURIComponent(st);
      });
    });
  }

  function refresh(force) {
    if (!onWorkspace()) { return; }
    var h = host();
    if (!h) { return; }
    var box = h.querySelector("#di-ticker");
    if (!box) {
      box = document.createElement("div");
      box.id = "di-ticker";
      box.style.cssText = "background:#fff;border:1px solid #e3e8ee;border-radius:10px;padding:12px 15px;" +
        "margin:0 0 14px;box-shadow:0 1px 2px rgba(16,37,64,.05)";
      h.insertBefore(box, h.firstChild);
      box.innerHTML = '<div style="font-size:12px;color:#95a0ad">Loading stock overview&hellip;</div>';
    }
    var now = Date.now();
    if (!force && now - last < EVERY) { return; }
    last = now;
    fetch("/api/method/stock_pipeline", { credentials: "include" })
      .then(function (r) { return r.json(); })
      .then(function (j) { if (j && j.message) { draw(box, j.message); } })
      .catch(function () {});
  }

  setInterval(function () { refresh(false); }, 5000);
  setTimeout(function () { refresh(true); }, 900);
  window.addEventListener("focus", function () { refresh(true); });
  try {
    if (window.frappe && frappe.router && frappe.router.on) {
      frappe.router.on("change", function () { setTimeout(function () { refresh(true); }, 350); });
    }
  } catch (e) {}
})();

/* ===========================================================================
   20 Aug 2026 - THE FLOATING TICKER. His words across the afternoon:
     "compact floating invisible visible with colours denoting the grades sizes
      and quantity stage in one glance and like iphone photos gallery style
      zoom in zoom out", then "add it above the workspace and try to make it
      more versatile and worth it".

   Sits above the existing #dolphin-ws-fab (right:18px, bottom:18px) so neither
   moves and nothing lands over a Save button. Hidden on the Dolphin workspace,
   where the full strip is already on screen - two of the same thing is worse
   than one.

   COLOUR CARRIES ONE MEANING: grade. Quantity is the size of the mark, stage is
   the position, size category is the next zoom level. Four meanings on one
   channel cannot be read. The six grade hues below were re-stepped because the
   theme's originals failed a colourblind check - B #2F80ED and B1 #7F77DD were
   dE 8.6 apart in normal vision (floor is 15) and dE 2.5 under protanopia, i.e.
   the same colour. These pass every check in light and dark.
   =========================================================================== */
(function () {
  if (window.__diFab) { return; }
  window.__diFab = 1;

  var GRADE = { A: "#0E9F6E", B: "#2563EB", B1: "#EA580C", B2: "#9333EA",
                C: "#DC2626", D: "#0891B2" };
  var NOGRADE = "#c7ced6", NAVY = "#0F2540", RED = "#c0392b";
  var EVERY = 60000, data = null, open = false, last = 0;

  function e6(v) { return (v == null ? "" : ("" + v)).replace(/[&<>"]/g, function (c) {
    return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]; }); }
  function gcol(g) { return GRADE[String(g || "").trim()] || NOGRADE; }
  function onWorkspace() {
    var p = location.pathname || "";
    return /\/(app|desk)\/dolphin\/?$/.test(p) || /\/(app|desk)\/?$/.test(p);
  }

  function css() {
    if (document.getElementById("di-fab-css")) { return; }
    var s = document.createElement("style");
    s.id = "di-fab-css";
    s.textContent =
      "#di-fab{position:fixed;right:18px;bottom:66px;z-index:1049;display:inline-flex;align-items:center;" +
      "gap:7px;background:" + NAVY + ";color:#fff;border:none;border-radius:999px;padding:7px 13px;" +
      "font-size:12px;line-height:1;font-weight:600;cursor:pointer;box-shadow:0 3px 12px rgba(15,37,64,.3);" +
      "transition:opacity .18s}" +
      "#di-fab.quiet{opacity:.55}#di-fab:hover{opacity:1}" +
      "#di-fab .dot{width:7px;height:7px;border-radius:50%;background:" + RED + ";flex:none}" +
      "#di-fab.quiet .dot{background:#6b7d8f}" +
      "#di-fab .mini{display:flex;gap:2px;margin-left:2px}" +
      "#di-fab .mini i{display:block;width:3px;height:12px;border-radius:1px}" +
      "#di-panel{position:fixed;right:18px;bottom:104px;z-index:1049;width:440px;max-width:calc(100vw - 36px);" +
      "max-height:72vh;overflow:auto;background:#fff;border:1px solid #e3e8ee;border-radius:12px;" +
      "box-shadow:0 12px 40px rgba(15,37,64,.28);padding:14px 16px 16px;display:none}" +
      "#di-panel.on{display:block}" +
      "#di-panel h4{font-size:10.5px;letter-spacing:.07em;text-transform:uppercase;color:#7c8896;font-weight:700;margin:0 0 8px}" +
      "#di-panel .row{display:flex;align-items:center;gap:9px;padding:7px 0;border-bottom:1px solid #f1f4f8;font-size:12.8px;cursor:pointer}" +
      "#di-panel .row:hover{background:#f8fafc}" +
      "#di-panel .row b{color:" + NAVY + ";min-width:22px;text-align:right}" +
      "#di-panel .row .d{font-size:11px;color:#95a0ad;margin-left:auto;font-family:ui-monospace,Menlo,monospace}" +
      "#di-panel .strip{display:flex;align-items:flex-end;gap:4px;margin-top:4px}" +
      "#di-panel .st{flex:1;min-width:0;cursor:pointer}" +
      "#di-panel .st.dim{opacity:.25}#di-panel .st.hit{outline:2px solid #D4A24A;outline-offset:2px;border-radius:4px}" +
      "#di-panel .stack{display:flex;flex-direction:column-reverse;height:34px;border-radius:3px 3px 0 0;overflow:hidden;gap:2px}" +
      "#di-panel .stack i{display:block;width:100%}" +
      "#di-panel .sn{font-family:Georgia,serif;font-size:14px;margin-top:4px;line-height:1;color:" + NAVY + "}" +
      "#di-panel .sn.r{color:" + RED + "}" +
      "#di-panel .sl{font-size:9.5px;color:#5c6a7a;margin-top:2px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}" +
      "#di-panel .sbox{display:flex;align-items:center;gap:7px;background:#f6f8fa;border:1px solid #d6dde5;" +
      "border-radius:8px;padding:6px 10px;margin:10px 0 4px}" +
      "#di-panel .sbox input{border:0;background:transparent;font-size:12.5px;flex:1;outline:none;" +
      "font-family:ui-monospace,Menlo,monospace;color:" + NAVY + "}" +
      "#di-panel .chip{display:inline-flex;align-items:baseline;gap:5px;padding:2px 8px;border-radius:999px;" +
      "background:#f4f6f8;margin:0 4px 4px 0;font-size:11.5px}" +
      "#di-panel .chip i{width:8px;height:8px;border-radius:2px;display:block;align-self:center}" +
      "#di-panel .x{float:right;cursor:pointer;color:#95a0ad;font-size:14px;line-height:1}" +
      /* 20 Aug 2026 - the stage strip was rendering "96In Stock" because .sn and .sl are
         plain spans, so number and label sat on one line. Column layout fixes it. */
      "#di-panel .strip{align-items:stretch}" +
      "#di-panel .st{display:flex;flex-direction:column;text-align:center}" +
      "#di-panel .sn{display:block}" +
      "#di-panel .sl{display:block;white-space:normal;font-size:9px;line-height:1.12;overflow:hidden}" +
      "#di-panel .strip > span:not(.st){align-self:center;padding:0 1px !important}" +
      /* his words: "this ticker is of no use since we already have a trace a block" - the
         search box was a straight duplicate of Trace a Block, so it goes. */
      "#di-panel .sbox{display:none}" +
      /* 21 Aug 2026: "user wont understand shortcut to bird eye make it look like a
         small button". A glyph with a label is not a button - give it a border, a fill
         and padding so it reads as something you press. */
      "#di-zoom{float:right;cursor:pointer;font-size:11px;margin-right:9px;line-height:1;" +
      "border:1px solid #c9d2dc;background:#f6f8fb;color:#3d4855;border-radius:6px;" +
      "padding:4px 9px;font-weight:600;letter-spacing:.01em}" +
      "#di-zoom:hover{background:" + NAVY + ";color:#fff;border-color:" + NAVY + "}" +
      /* the bird's eye - iPhone-Photos style: the card scales up into a full sheet */
      "#di-sheet{position:fixed;inset:0;z-index:1060;background:rgba(15,37,64,.55);display:none;" +
      "align-items:center;justify-content:center;padding:20px}" +
      "#di-sheet.on{display:flex}" +
      "#di-sheet .card{background:#fff;border-radius:16px;width:min(1120px,96vw);max-height:93vh;overflow:auto;" +
      "padding:18px 22px 22px;box-shadow:0 24px 70px rgba(15,37,64,.42);transform:scale(.94);opacity:0;" +
      "transition:transform .17s ease,opacity .17s ease}" +
      "#di-sheet.on .card{transform:scale(1);opacity:1}" +
      "#di-sheet h3{margin:0;font-size:15px;color:" + NAVY + ";font-family:Georgia,serif;font-weight:400}" +
      "#di-sheet h5{font-size:10px;letter-spacing:.08em;text-transform:uppercase;color:#7c8896;font-weight:700;margin:0 0 9px}" +
      "#di-sheet .bx{border:1px solid #e6eaf0;border-radius:12px;padding:13px 15px}" +
      "#di-sheet .grid{display:grid;gap:12px;margin-top:14px}" +
      "#di-sheet .g3{grid-template-columns:repeat(3,minmax(0,1fr))}" +
      "#di-sheet .flow{display:flex;align-items:stretch;gap:5px}" +
      "#di-sheet .fs{flex:1;min-width:0;display:flex;flex-direction:column;text-align:center;cursor:pointer;border-radius:8px;padding:4px 2px}" +
      "#di-sheet .fs:hover{background:#f6f8fb}" +
      "#di-sheet .fbar{display:flex;flex-direction:column-reverse;height:78px;border-radius:4px 4px 0 0;overflow:hidden;gap:2px;justify-content:flex-start}" +
      "#di-sheet .fbar i{display:block;width:100%}" +
      "#di-sheet .fn{font-family:Georgia,serif;font-size:21px;line-height:1.1;margin-top:6px;color:" + NAVY + "}" +
      "#di-sheet .fn.z{color:" + RED + "}" +
      "#di-sheet .fl{font-size:10px;color:#5c6a7a;line-height:1.15;margin-top:2px}" +
      "#di-sheet .fc{font-size:9.5px;color:#95a0ad;margin-top:1px}" +
      "#di-sheet .arw{align-self:center;color:#c8d1da;font-size:12px}" +
      "#di-sheet .hbar{display:flex;height:15px;border-radius:4px;overflow:hidden;gap:2px;margin-bottom:9px}" +
      "#di-sheet .hbar i{display:block}" +
      "#di-sheet .lg{display:flex;flex-wrap:wrap;gap:4px 9px}" +
      "#di-sheet .lg span{display:inline-flex;align-items:center;gap:5px;font-size:11.5px;color:#3d4855}" +
      "#di-sheet .lg i{width:9px;height:9px;border-radius:2px;display:block;flex:none}" +
      "#di-sheet .lg b{color:" + NAVY + "}" +
      "#di-sheet .kv{display:flex;justify-content:space-between;align-items:baseline;font-size:12.5px;padding:5px 0;border-bottom:1px solid #f1f4f8}" +
      "#di-sheet .kv:last-child{border-bottom:0}" +
      "#di-sheet .kv b{font-family:Georgia,serif;font-size:15px;color:" + NAVY + "}" +
      "#di-sheet .kv b.z{color:" + RED + "}" +
      "#di-sheet .warn{background:#fdf3f2;border:1px solid #f0c9c4;border-radius:9px;padding:9px 11px;font-size:12px;color:#8c2f22;margin-top:11px}" +
      "#di-sheet .rowx{display:flex;align-items:center;gap:9px;padding:6px 0;border-bottom:1px solid #f1f4f8;font-size:12.8px;cursor:pointer}" +
      "#di-sheet .rowx b{color:" + NAVY + ";min-width:22px;text-align:right}" +
      "#di-sheet .rowx .d{font-size:11px;color:#95a0ad;margin-left:auto;font-family:ui-monospace,Menlo,monospace}" +
      "#di-sheet .hdr{display:flex;align-items:flex-start;gap:8px;margin-bottom:2px}" +
      "#di-sheet .hdr .sp{flex:1;min-width:0}" +
      "#di-sheet .cls{cursor:pointer;border:1px solid #c9d2dc;background:#f6f8fb;color:#3d4855;" +
      "border-radius:7px;height:28px;min-width:28px;padding:0 9px;display:inline-flex;align-items:center;" +
      "justify-content:center;gap:5px;font-size:12px;font-weight:600;line-height:1;flex:none}" +
      "#di-sheet .cls:hover{background:" + NAVY + ";color:#fff;border-color:" + NAVY + "}";
    document.head.appendChild(s);
  }

  function stackFor(s) {
    var by = s.by_grade || null;
    if (!by || !by.length) {
      return '<i style="height:' + (s.n ? 22 : 4) + "px;background:" +
        (s.n ? NOGRADE : "#f5d9d5") + (s.n ? "" : ";border-top:2px solid " + RED) + '"></i>';
    }
    var tot = 0;
    by.forEach(function (g) { tot += g.n; });
    return by.map(function (g) {
      var h = Math.max(3, Math.round((g.n / (tot || 1)) * 30));
      return '<i style="height:' + h + "px;background:" + gcol(g.k) + '"></i>';
    }).join("");
  }

  function drawPanel(p, q) {
    var d = data || {}, stages = d.stages || [], att = d.attention || { items: [], total: 0 };
    var max = 1;
    stages.forEach(function (s) { if (s.n > max) { max = s.n; } });

    var h = '<span class="x" id="di-x">&#10005;</span>' +
      '<button type="button" id="di-zoom" title="Bird&rsquo;s eye \u2014 the whole pipeline, stock and paperwork on one screen">&#9974; Bird&rsquo;s eye</button>' +
      '<h4>Needs a person &mdash; ' + (att.total || 0) + "</h4>";
    if (!att.total) {
      h += '<div style="font-size:12.5px;color:#0f6e56;padding:2px 0 6px">&#10003; Nothing is stuck.</div>';
    } else {
      (att.items || []).forEach(function (it) {
        if (!it.n) { return; }
        h += '<div class="row" data-go="' + e6(it.go) + '"><b>' + it.n + "</b><span>" + e6(it.label) +
          '</span><span class="d">' + e6(it.detail || "") + "</span></div>";
      });
    }

    h += '<h4 style="margin-top:14px">Where everything is</h4><div class="strip">';
    stages.forEach(function (s, i) {
      var hitq = q && q.stages && q.stages[s.label] != null;
      var cls = q ? (hitq ? "st hit" : "st dim") : "st";
      var shown = hitq ? q.stages[s.label] : s.n;
      h += (i ? '<span style="color:#c8d1da;font-size:11px;padding:0 1px 22px">&rsaquo;</span>' : "") +
        '<span class="' + cls + '" data-stage="' + e6(s.status || "") + '">' +
        '<span style="display:flex;align-items:flex-end;height:34px">' + stackFor(s) + "</span>" +
        '<span class="sn' + (shown ? "" : " r") + '">' + shown + "</span>" +
        '<span class="sl">' + e6(s.label) + "</span></span>";
    });
    h += "</div>";

    h += '<div class="sbox"><span style="color:#D4A24A">&#128269;</span>' +
      '<input id="di-q" placeholder="block &middot; 1332-1356 &middot; 1332,1340" value="' +
      e6((q && q.raw) || "") + '"></div>';
    if (q) {
      h += '<div style="font-size:12px;padding:4px 0 2px"><b>' + q.found + "</b> of " + q.asked + " found" +
        (q.missing.length ? ' &middot; <span style="color:' + RED + '">not found ' + e6(q.missing.slice(0, 10).join(", ")) + "</span>" : "") +
        "</div>";
    }

    var chips = function (title, arr) {
      if (!arr || !arr.length) { return ""; }
      return '<h4 style="margin-top:12px">' + title + "</h4>" + arr.map(function (x) {
        return '<span class="chip"><i style="background:' + (title === "Grade" ? gcol(x.k) : "#aab4c0") +
          '"></i><b style="color:' + NAVY + '">' + e6(x.k) + "</b><span style='color:#5c6a7a'>" + x.n + "</span></span>";
      }).join("");
    };
    h += chips("Grade", d.by_grade) + chips("Size", d.by_size) + chips("Pit", d.by_pit);
    p.innerHTML = h;

    var x = document.getElementById("di-x");
    if (x) { x.onclick = function (e) { e.stopPropagation(); hide(); }; }
    var z = document.getElementById("di-zoom");
    if (z) { z.onclick = function (e) { e.stopPropagation(); showSheet(); }; }
    p.querySelectorAll("[data-go]").forEach(function (el) {
      el.onclick = function () { window.location.href = el.getAttribute("data-go"); };
    });
    p.querySelectorAll("[data-stage]").forEach(function (el) {
      el.onclick = function () {
        var st = el.getAttribute("data-stage");
        if (st) { window.location.href = "/app/quarry-block?status=" + encodeURIComponent(st); }
      };
    });
    var inp = document.getElementById("di-q");
    if (inp) {
      var t = null;
      inp.oninput = function () { clearTimeout(t); t = setTimeout(function () { search(inp.value); }, 350); };
      if (q && q.raw) { inp.focus(); inp.setSelectionRange(inp.value.length, inp.value.length); }
    }
  }

  function parseList(raw) {
    var s = String(raw || "").trim();
    if (!s) { return null; }
    var m = s.match(/^(\d+)\s*(?:-|to|\.\.)\s*(\d+)$/i);
    if (m) {
      var a = parseInt(m[1], 10), b = parseInt(m[2], 10);
      if (a > b) { var t = a; a = b; b = t; }
      if (b - a + 1 > 500) { return null; }
      var o = [];
      for (var i = a; i <= b; i++) { o.push(String(i)); }
      return o;
    }
    return s.split(",").map(function (x) { return x.trim(); }).filter(Boolean);
  }

  var STAGE_OF = { "In Stock": "In Stock", "Buyer Marked": "Buyer Marked",
    "In Delivery Challan": "In Challan", "Dispatched/Transported": "Dispatched",
    "At Port": "At Port", "At Bannikoppa Station yard": "At Port" };

  function search(raw) {
    var list = parseList(raw);
    var p = document.getElementById("di-panel");
    if (!p) { return; }
    if (!list || !list.length) { drawPanel(p, null); return; }
    var u = "/api/method/frappe.client.get_list?doctype=Quarry Block&limit_page_length=0&fields=" +
      encodeURIComponent(JSON.stringify(["name", "block_number", "export_block_no", "status"]));
    function go(field) {
      return fetch(u + "&filters=" + encodeURIComponent(JSON.stringify([[field, "in", list]])),
        { credentials: "include" }).then(function (r) { return r.json(); })
        .then(function (j) { return j.message || []; });
    }
    go("block_number")
      .then(function (b) { return b.length ? b : go("export_block_no"); })
      .then(function (b) { return b.length ? b : go("name"); })
      .then(function (b) {
        var st = {}, seen = {};
        b.forEach(function (x) {
          var lab = STAGE_OF[String(x.status || "").trim()] || "Dispatched";
          st[lab] = (st[lab] || 0) + 1;
          seen[String(x.block_number)] = 1;
          if (x.export_block_no) { seen[String(x.export_block_no)] = 1; }
          seen[String(x.name)] = 1;
        });
        drawPanel(p, { raw: raw, found: b.length, asked: list.length,
          missing: list.filter(function (n) { return !seen[n]; }), stages: st });
      })
      .catch(function () { drawPanel(p, null); });
  }

  function show() {
    var p = document.getElementById("di-panel");
    if (!p) { return; }
    open = true; p.classList.add("on"); drawPanel(p, null);
  }
  function hide() {
    var p = document.getElementById("di-panel");
    if (p) { p.classList.remove("on"); }
    open = false;
  }

  /* ---------------------------------------------------------------------------
     BIRD'S EYE - 20 Aug 2026. His words: "graph with all the stock details etc
     ... like photos zoomable on iphone and a bird eye view of stock DC etc",
     "rather than leaving the page quick look kind".

     Three zoom levels, same object:
       pill   ->  "5 need you"                        (always parked above Workspace)
       card   ->  needs-a-person + the stage strip    (click the pill)
       sheet  ->  everything, full screen             (click "Bird's eye")
     Escape or the backdrop steps back down one level. Nothing navigates away.

     Palette: slots 1-6 of the validated categorical set, checked with the
     dataviz validator - lightness band, chroma floor, adjacent CVD separation
     and normal-vision floor all PASS on a light surface. Contrast warns on
     three slots, so every segment carries a visible number beside its swatch
     rather than relying on colour alone. "Unassigned" is deliberately grey:
     it is an absence, not a category.
     --------------------------------------------------------------------------- */
  var PAL = ["#2a78d6", "#eb6834", "#1baf7a", "#eda100", "#e87ba4", "#008300"];
  function keyCol(k, i) {
    var t = String(k == null ? "" : k).trim();
    if (!t || /^unassigned$/i.test(t) || /^none$/i.test(t)) { return NOGRADE; }
    return PAL[i % PAL.length];
  }
  function sumN(arr) { var t = 0; (arr || []).forEach(function (x) { t += (x.n || 0); }); return t; }

  function hbar(arr) {
    var tot = sumN(arr);
    if (!tot) { return '<div class="hbar"><i style="flex:1;background:#eef1f5"></i></div>'; }
    return '<div class="hbar">' + (arr || []).map(function (x, i) {
      return '<i style="flex:' + Math.max(1, x.n || 0) + ';background:' + keyCol(x.k, i) + '"></i>';
    }).join("") + "</div>";
  }
  function legend(arr) {
    return '<div class="lg">' + (arr || []).map(function (x, i) {
      return '<span><i style="background:' + keyCol(x.k, i) + '"></i>' + e6(x.k) +
        " <b>" + (x.n || 0) + "</b></span>";
    }).join("") + "</div>";
  }
  function box(title, arr) {
    return '<div class="bx"><h5>' + e6(title) + "</h5>" + hbar(arr) + legend(arr) + "</div>";
  }

  function flowStage(st, max) {
    var n = st.n || 0;
    var h = n ? Math.max(6, Math.round((n / (max || 1)) * 78)) : 3;
    var by = st.by_grade || null, bars;
    if (by && by.length) {
      var tot = sumN(by) || 1;
      bars = by.map(function (g, i) {
        return '<i style="height:' + Math.max(2, Math.round((g.n / tot) * h)) +
          "px;background:" + keyCol(g.k, i) + '"></i>';
      }).join("");
    } else {
      bars = '<i style="height:' + h + "px;background:" + (n ? "#8fa6bd" : "#f3d6d2") +
        (n ? "" : ";border-top:2px solid " + RED) + '"></i>';
    }
    return '<span class="fs" data-jump="' + e6(st.status || "") + '">' +
      '<span class="fbar">' + bars + "</span>" +
      '<span class="fn' + (n ? "" : " z") + '">' + n + "</span>" +
      '<span class="fl">' + e6(st.label) + "</span>" +
      '<span class="fc">' + (st.cbm ? (Number(st.cbm).toLocaleString() + " CBM") : "&mdash;") + "</span></span>";
  }

  function drawSheet() {
    var sh = document.getElementById("di-sheet");
    if (!sh) { return; }
    var d = data || {}, stages = d.stages || [], att = d.attention || { items: [], total: 0 };
    var paper = d.paper || {}, dc = paper.dc || {}, arr = paper.arrivals || {}, lots = paper.lots || {};
    var max = 1;
    stages.forEach(function (x) { if ((x.n || 0) > max) { max = x.n; } });

    var h = '<div class="card">';
    h += '<div class="hdr"><div class="sp">' +
      "<h3>Dolphin International &mdash; bird&rsquo;s eye</h3>" +
      '<div style="font-size:11px;color:#95a0ad;margin-top:2px">' +
      (d.total_blocks || 0) + " blocks tracked &middot; as of " +
      e6(String(d.as_of || "").slice(11, 16)) + "</div></div>" +
      '<button type="button" class="cls" id="di-sheet-min" title="Back to the small view">&#8722; Smaller</button>' +
      '<button type="button" class="cls" id="di-sheet-x" title="Close">&#10005;</button>' +
      "</div>";

    h += '<div class="grid" style="grid-template-columns:1fr"><div class="bx"><h5>Where every block is</h5><div class="flow">';
    stages.forEach(function (st, i) {
      h += (i ? '<span class="arw">&rsaquo;</span>' : "") + flowStage(st, max);
    });
    h += "</div></div></div>";

    h += '<div class="grid g3">' + box("Grade", d.by_grade) + box("Size", d.by_size) + box("Pit", d.by_pit) + "</div>";
    h += '<div style="font-size:10.5px;color:#95a0ad;margin-top:5px">Grade, size and pit describe the ' +
      (d.in_stock_blocks || 0) + " blocks still in stock and buyer marked &mdash; " +
      (d.in_stock_cbm || 0) + " CBM.</div>";

    h += '<div class="grid g3">';
    h += '<div class="bx"><h5>Delivery Challans</h5>' +
      '<div class="kv"><span>Submitted</span><b>' + (dc.submitted || 0) + "</b></div>" +
      '<div class="kv"><span>Still draft</span><b class="' + ((dc.draft || 0) ? "z" : "") + '">' + (dc.draft || 0) + "</b></div>" +
      '<div class="kv"><span>Total</span><b>' + (dc.total || 0) + "</b></div></div>";
    h += '<div class="bx"><h5>Port Arrivals</h5>' +
      '<div class="kv"><span>Submitted</span><b class="' + ((arr.submitted || 0) ? "" : "z") + '">' + (arr.submitted || 0) + "</b></div>" +
      '<div class="kv"><span>Still draft</span><b class="' + ((arr.draft || 0) ? "z" : "") + '">' + (arr.draft || 0) + "</b></div>" +
      '<div class="kv"><span>Total</span><b>' + (arr.total || 0) + "</b></div></div>";
    var lb = (lots.by_status || []).map(function (x) {
      return '<div class="kv"><span>' + e6(x.k) + "</span><b>" + (x.n || 0) + "</b></div>";
    }).join("");
    h += '<div class="bx"><h5>Export Lots</h5>' + (lb || '<div class="kv"><span>None</span><b>0</b></div>') +
      '<div class="kv"><span>Total</span><b>' + (lots.total || 0) + "</b></div></div>";
    h += "</div>";

    var atPort = 0, exported = 0;
    stages.forEach(function (x) {
      if (x.label === "At Port") { atPort = x.n || 0; }
      if (x.label === "Exported") { exported = x.n || 0; }
    });
    if ((arr.draft || 0) > 0 && !atPort) {
      h += '<div class="warn"><b>Nothing has reached At Port.</b> All ' + (arr.draft || 0) +
        " Port Arrival document(s) are still drafts, so no block has been counted as arrived. " +
        "Until they are submitted, the second half of the process cannot run.</div>";
    }

    h += '<div class="bx" style="margin-top:12px"><h5>Needs a person &mdash; ' + (att.total || 0) + "</h5>";
    if (!att.total) {
      h += '<div style="font-size:12.5px;color:#0f6e56">&#10003; Nothing is stuck.</div>';
    } else {
      (att.items || []).forEach(function (it) {
        if (!it.n) { return; }
        h += '<div class="rowx" data-go="' + e6(it.go) + '"><b>' + it.n + "</b><span>" +
          e6(it.label) + '</span><span class="d">' + e6(it.detail || "") + "</span></div>";
      });
    }
    h += "</div></div>";

    sh.innerHTML = h;
    var x1 = document.getElementById("di-sheet-x");
    if (x1) { x1.onclick = function (e) { e.stopPropagation(); hideSheet(true); }; }
    var m1 = document.getElementById("di-sheet-min");
    if (m1) { m1.onclick = function (e) { e.stopPropagation(); hideSheet(false); }; }
    sh.querySelectorAll("[data-go]").forEach(function (el) {
      el.onclick = function () { window.location.href = el.getAttribute("data-go"); };
    });
    sh.querySelectorAll("[data-jump]").forEach(function (el) {
      el.onclick = function () {
        var st = el.getAttribute("data-jump");
        if (st) { window.location.href = "/app/quarry-block?status=" + encodeURIComponent(st); }
      };
    });
  }

  function showSheet() {
    var sh = document.getElementById("di-sheet");
    if (!sh) {
      sh = document.createElement("div");
      sh.id = "di-sheet";
      document.body.appendChild(sh);
      sh.addEventListener("click", function (e) { if (e.target === sh) { hideSheet(false); } });
    }
    drawSheet();
    sh.classList.add("on");
    hide();
  }
  function hideSheet(allTheWay) {
    var sh = document.getElementById("di-sheet");
    if (sh) { sh.classList.remove("on"); }
    if (!allTheWay) { show(); }
  }
  function sheetOpen() {
    var sh = document.getElementById("di-sheet");
    return !!(sh && sh.classList.contains("on"));
  }

  function paint() {
    var f = document.getElementById("di-fab");
    if (!f || !data) { return; }
    var n = (data.attention || {}).total || 0;
    var mini = (data.by_grade || []).slice(0, 4).map(function (g) {
      return '<i style="background:' + gcol(g.k) + '"></i>';
    }).join("");
    f.className = n ? "" : "quiet";
    f.innerHTML = '<span class="dot"></span>' + (n ? ("<b>" + n + "</b> need you") : "All clear") +
      '<span class="mini">' + mini + "</span>";
    f.title = n ? (n + " thing(s) waiting on a person") : "Nothing is stuck";
  }

  function mount() {
    if (onWorkspace()) {
      var g = document.getElementById("di-fab"), gp = document.getElementById("di-panel");
      if (g) { g.style.display = "none"; }
      if (gp) { gp.classList.remove("on"); }
      return;
    }
    css();
    var f = document.getElementById("di-fab");
    if (!f) {
      f = document.createElement("button");
      f.id = "di-fab"; f.type = "button"; f.className = "quiet";
      f.innerHTML = '<span class="dot"></span>&hellip;';
      document.body.appendChild(f);
      f.onclick = function (e) { e.stopPropagation(); if (open) { hide(); } else { show(); } };
      var p = document.createElement("div");
      p.id = "di-panel";
      document.body.appendChild(p);
      p.addEventListener("click", function (e) { e.stopPropagation(); });
      document.addEventListener("click", function () { if (open) { hide(); } });
      document.addEventListener("keydown", function (e) {
        if (e.key !== "Escape") { return; }
        if (sheetOpen()) { hideSheet(true); return; }
        if (open) { hide(); }
      });
    }
    f.style.display = "";
    paint();
  }

  function refresh(force) {
    var now = Date.now();
    if (!force && now - last < EVERY) { return; }
    last = now;
    fetch("/api/method/stock_pipeline", { credentials: "include" })
      .then(function (r) { return r.json(); })
      .then(function (j) { if (j && j.message) { data = j.message; paint(); if (open) { drawPanel(document.getElementById("di-panel"), null); } if (sheetOpen()) { drawSheet(); } } })
      .catch(function () {});
  }

  setInterval(function () { mount(); refresh(false); }, 5000);
  setTimeout(function () { mount(); refresh(true); }, 1100);
  window.addEventListener("focus", function () { refresh(true); });
})();

/* ============================================================================
   EVERY DROPDOWN MUST LOOK LIKE A DROPDOWN — 22 Aug 2026.

   His words: "this is the case wherever there is dropdown user has to know it
   else he will be stuck."

   A Frappe Link or Select field looks exactly like a plain text box until you
   click it, so a person who does not already know the field is a list simply
   stops. A caret on the right of every one of them, and a placeholder that says
   what to do, costs nothing and removes the guess.

   CSS-only for the caret, so there is nothing to throw and nothing to keep in
   sync. The placeholder is set on a light poll, guarded, and never touches a
   field a person has already filled.
   ============================================================================ */
(function () {
  if (window.__dolphinDropdownHint) { return; }
  window.__dolphinDropdownHint = true;

  function addCss() {
    if (document.getElementById("dolphin-dropdown-hint-css")) { return; }
    var css =
      '.frappe-control[data-fieldtype="Link"] .control-input,' +
      '.frappe-control[data-fieldtype="Select"] .control-input,' +
      '.frappe-control[data-fieldtype="Dynamic Link"] .control-input{position:relative}' +
      '.frappe-control[data-fieldtype="Link"] .control-input::after,' +
      '.frappe-control[data-fieldtype="Dynamic Link"] .control-input::after{' +
      'content:"\\25BE";position:absolute;right:10px;top:50%;transform:translateY(-50%);' +
      'pointer-events:none;color:#8a929c;font-size:11px;line-height:1}' +
      '.frappe-control[data-fieldtype="Link"] .control-input input,' +
      '.frappe-control[data-fieldtype="Dynamic Link"] .control-input input{padding-right:24px}';
    var st = document.createElement("style");
    st.id = "dolphin-dropdown-hint-css";
    st.textContent = css;
    (document.head || document.documentElement).appendChild(st);
  }

  function hintPlaceholders() {
    try {
      var sel = '.frappe-control[data-fieldtype="Link"] input,' +
                '.frappe-control[data-fieldtype="Dynamic Link"] input';
      var list = document.querySelectorAll(sel);
      for (var i = 0; i < list.length; i++) {
        var el = list[i];
        if (el.getAttribute("data-di-hinted")) { continue; }
        if (el.value) { continue; }
        var ph = el.getAttribute("placeholder");
        if (!ph || ph === "") {
          el.setAttribute("placeholder", "Click to choose…");
        }
        el.setAttribute("data-di-hinted", "1");
      }
    } catch (e) { /* a hint must never break a form */ }
  }

  function start() {
    addCss();
    hintPlaceholders();
    setInterval(hintPlaceholders, 1500);
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", start);
  } else {
    start();
  }
})();
