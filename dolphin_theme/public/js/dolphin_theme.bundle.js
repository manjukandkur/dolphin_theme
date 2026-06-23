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
  var NAVY = "#0F2540", GOLD = "#D4A24A";
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
      "#dolphin-sidemenu{margin:6px 8px 16px;border:1px solid rgba(212,162,74,.35);border-radius:12px;" +
      "overflow:hidden;background:" + NAVY + ";font-family:Georgia,serif;box-shadow:0 4px 14px rgba(0,0,0,.25);}" +
      "#dolphin-sidemenu .di-sm-top{display:flex;align-items:center;justify-content:space-between;" +
      "background:linear-gradient(135deg," + NAVY + " 0%,#16365c 100%);color:#fff;padding:9px 12px;" +
      "cursor:pointer;font-weight:700;font-size:13.5px;letter-spacing:.4px;}" +
      "#dolphin-sidemenu .di-sm-top .di-sm-chev{transition:transform .25s;color:" + GOLD + ";}" +
      "#dolphin-sidemenu.di-collapsed .di-sm-body{display:none;}" +
      "#dolphin-sidemenu.di-collapsed .di-sm-top .di-sm-chev{transform:rotate(-90deg);}" +
      "#dolphin-sidemenu .di-sm-search{width:calc(100% - 16px);margin:8px;padding:6px 9px;font-size:12px;" +
      "border:1px solid rgba(255,255,255,.18);background:#16365c;color:#fff;border-radius:7px;font-family:inherit;outline:none;}" +
      "#dolphin-sidemenu .di-sm-search:focus{border-color:" + GOLD + ";box-shadow:0 0 0 2px rgba(212,162,74,.2);}" +
      "#dolphin-sidemenu .di-sm-sec{user-select:none;}" +
      "#dolphin-sidemenu .di-sm-sec>.di-sm-h{display:flex;align-items:center;justify-content:space-between;" +
      "cursor:pointer;padding:8px 12px;font-size:11.5px;font-weight:700;text-transform:uppercase;letter-spacing:.5px;" +
      "color:" + GOLD + ";background:rgba(255,255,255,.05);border-top:1px solid rgba(255,255,255,.08);}" +
      "#dolphin-sidemenu .di-sm-h:hover{background:rgba(255,255,255,.1);}" +
      "#dolphin-sidemenu .di-sm-h .di-sm-count{font-size:9px;background:" + GOLD + ";color:" + NAVY + ";" +
      "border-radius:9px;padding:1px 7px;margin-left:auto;margin-right:7px;font-weight:700;}" +
      "#dolphin-sidemenu .di-sm-h .di-sm-chev{font-size:10px;color:" + GOLD + ";transition:transform .25s;}" +
      "#dolphin-sidemenu .di-sm-sec.di-closed>.di-sm-items{display:none;}" +
      "#dolphin-sidemenu .di-sm-sec.di-closed>.di-sm-h .di-sm-chev{transform:rotate(-90deg);}" +
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
      "#dolphin-sidemenu .di-sm-body{max-height:calc(100vh - 230px);overflow-y:auto;overflow-x:hidden;}" +
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
      "#dolphin-sidemenu .di-sm-sub.di-closed>.di-sm-subh .di-sm-chev{transform:rotate(-90deg);}" +
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
      if (userExited()) return; // user chose to exit — don't trap them back in the workspace
      var r = frappe.get_route() || [];
      var first = (r[0] || "").toLowerCase();
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
     - Sales Lot = owner's working section -> management only. Operators (ilkal/quarry)
       carry Dolphin Admin/Sales/Super Admin/Entry but NOT System Manager, so System
       Manager is the clean distinguisher between owner/day-user and operators.
     - Local Sale + Shipping = Bangalore tier (di@ has only Dolphin Bangalore). */
  var ROLE_OWNER = ["System Manager", "Administrator", "Dolphin Owner"];
  var ROLE_BANGALORE = ["System Manager", "Administrator", "Dolphin Bangalore", "Dolphin Owner"];
  function hasAnyRole(list) {
    try {
      if (!list || !list.length) return true;
      var ur = frappe.user_roles || [];
      return list.some(function (r) { return ur.indexOf(r) > -1; });
    } catch (e) { return true; }
  }

  var SECTIONS = [
    { title: "Operations", items: [
      ["Quarry Block", "Quarry Block"], ["Quarry Inspection", "Quarry Inspection"],
      ["Buyer Inspection", "Buyer Inspection"], ["Delivery Challan", "Delivery Challan"],
      ["Sales Lot", "Sales Lot", ROLE_OWNER] ] },
    { title: "Local Sale", roles: ROLE_BANGALORE, items: [
      ["Local Tax Invoice", "Local Tax Invoice"],
      ["Local Blocks Inspector", "Local Blocks Inspector"] ] },
    { title: "Shipping Documents", roles: ROLE_BANGALORE, items: [
      ["Shipping Document", "Shipping Document"] ] },
    { title: "Sales & Exports", roles: ROLE_BANGALORE, items: [ ["Port Arrival", "Port Arrival"], ["Blocks At Port", "Blocks At Port", null, "report"] ] }, { title: "Masters", subgroups: [
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
      top.innerHTML = "<span>☰ Dolphin Menu</span><span class='di-sm-chev'>▾</span>";
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
        if (kind === "report") { a.setAttribute("href", "/app/query-report/" + encodeURIComponent(dt)); a.onclick = function (ev) { ev.preventDefault(); try { frappe.set_route("query-report", dt); } catch (e) { window.location = "/app/query-report/" + encodeURIComponent(dt); } }; row.appendChild(a); return row; } a.setAttribute("href", "/app/" + frappe.router.slug(dt));
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
        if (lsGet(secKey, "open") === "closed") s.classList.add("di-closed");
        var h = document.createElement("div");
        h.className = "di-sm-h";
        h.innerHTML = "<span>" + sec.title + "</span><span class='di-sm-count'>" + total +
          "</span><span class='di-sm-chev'>▾</span>";
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
              "</span><span class='di-sm-chev'>▾</span>";
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
      if (window.cur_frm && cur_frm.doctype) return cur_frm.doctype;
      if (window.cur_list && cur_list.doctype) return cur_list.doctype;
      var r = frappe.get_route() || []; return r[1] || "";
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
    "Quarry Block": "dolphin_theme.template_generator.quarry_block_template"
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
  function abIsAddBlocks(it) {
    var s = ((it.group || "") + " " + (it.label || "")).toLowerCase();
    return /add/.test(s) && /(block|marked|from qi|by number)/.test(s);
  }
  function buildActionBar(head) {
    var frm = window.cur_frm; if (!frm) return;
    var bar = head.querySelector(".di-actionbar");
    if (!bar) {
      bar = document.createElement("span");
      bar.className = "di-navbar-group di-actionbar";
      var back = abChip("‹", "Back", function () { window.history.back(); });
      var home = abChip("⌂", "Home", function () { goHome(); });
      var title = document.createElement("span"); title.className = "di-ab-title"; title.setAttribute("data-di-abtitle", "1");
      var addDD = abMakeDropdown("Add Blocks", "white", "add");
      var actDD = abMakeDropdown("Actions", "gold", "act");
      var save = document.createElement("button"); save.type = "button"; save.className = "di-ab-btn di-ab-gold"; save.textContent = "Save";
      save.onclick = function () { try { frm.save(); } catch (e) {} };
      bar.appendChild(back); bar.appendChild(home); bar.appendChild(title);
      bar.appendChild(addDD); bar.appendChild(actDD); bar.appendChild(save);
      head.insertBefore(bar, head.firstChild);
    }
    var t = bar.querySelector("[data-di-abtitle]");
    if (t) { try { t.textContent = (frm.doc && frm.doc.__islocal) ? ("New " + frm.doctype) : ((frm.doc && frm.doc.name) || frm.doctype); } catch (e) { t.textContent = frm.doctype; } }

    var addMenu = bar.querySelector("[data-di-dd='add'] .di-ab-menu");
    var actMenu = bar.querySelector("[data-di-dd='act'] .di-ab-menu");
    if (!addMenu || !actMenu) return;
    addMenu.innerHTML = ""; actMenu.innerHTML = "";

    abHarvest(head).forEach(function (it) {
      var mi = abItem(it.label, (function (el) { return function () { abForward(el); }; })(it.el));
      if (abIsAddBlocks(it)) addMenu.appendChild(mi); else actMenu.appendChild(mi);
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
    abHarvest(head).forEach(function (it) {
      var mi = abItem(it.label, (function (el) { return function () { abForward(el); }; })(it.el));
      actMenu.appendChild(mi);
      (it.groupEl || it.el).classList.add("di-ab-harvested");
    });
    if (!actMenu.querySelector(".di-ab-item")) {
      var e = document.createElement("div"); e.className = "di-ab-empty"; e.textContent = "No extra actions"; actMenu.appendChild(e);
    }
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

  function tick() {
    prefetchNewMeta(); addStyles(); addFab(); brandIt(); addSideMenu(); addSidebarResizer(); maybeRedirect(); addButtonBar(); paintCustomBlocks();
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
  setInterval(function () { try { addButtonBar(); addSideMenu(); } catch (e) {} }, 1000);
  /* robust attach: re-add the bar the instant the page toolbar (re)renders — fixes the
     missing Back/Home bar on fast-loading minimal master forms (New Gangman, New Pit, etc.) */
  try {
    var __diMoT;
    var __diMo = new MutationObserver(function () {
      clearTimeout(__diMoT);
      __diMoT = setTimeout(function () { try { addButtonBar(); } catch (e) {} }, 50);
    });
    __diMo.observe(document.body, { childList: true, subtree: true });
  } catch (e) {}
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
      moT = setTimeout(function () { moT = null; tick(); }, 250);
    });
    if (document.body) mo.observe(document.body, { childList: true, subtree: true });
  } catch (e) {}
})();
