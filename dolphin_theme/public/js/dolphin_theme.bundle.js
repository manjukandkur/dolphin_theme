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
      /* ---- hide native 'Notification' sidebar entry (single-admin: feed stays empty; bell in navbar still available) ---- */
      ".body-sidebar .sidebar-notification{display:none!important;}" +
      /* ---- floating left-panel menu ---- */
      "#dolphin-sidemenu{margin:6px 8px 16px;border:1px solid rgba(15,37,64,.14);border-radius:12px;" +
      "overflow:hidden;background:#fff;font-family:Georgia,serif;box-shadow:0 2px 10px rgba(15,37,64,.08);}" +
      "#dolphin-sidemenu .di-sm-top{display:flex;align-items:center;justify-content:space-between;" +
      "background:linear-gradient(135deg," + NAVY + " 0%,#16365c 100%);color:#fff;padding:9px 12px;" +
      "cursor:pointer;font-weight:700;font-size:12.5px;letter-spacing:.4px;}" +
      "#dolphin-sidemenu .di-sm-top .di-sm-chev{transition:transform .25s;color:" + GOLD + ";}" +
      "#dolphin-sidemenu.di-collapsed .di-sm-body{display:none;}" +
      "#dolphin-sidemenu.di-collapsed .di-sm-top .di-sm-chev{transform:rotate(-90deg);}" +
      "#dolphin-sidemenu .di-sm-search{width:calc(100% - 16px);margin:8px;padding:6px 9px;font-size:12px;" +
      "border:1px solid rgba(15,37,64,.18);border-radius:7px;font-family:inherit;outline:none;}" +
      "#dolphin-sidemenu .di-sm-search:focus{border-color:" + GOLD + ";box-shadow:0 0 0 2px rgba(212,162,74,.2);}" +
      "#dolphin-sidemenu .di-sm-sec{user-select:none;}" +
      "#dolphin-sidemenu .di-sm-sec>.di-sm-h{display:flex;align-items:center;justify-content:space-between;" +
      "cursor:pointer;padding:8px 12px;font-size:10.5px;font-weight:700;text-transform:uppercase;letter-spacing:.5px;" +
      "color:" + NAVY + ";background:rgba(212,162,74,.18);border-top:1px solid rgba(15,37,64,.06);}" +
      "#dolphin-sidemenu .di-sm-h:hover{background:rgba(212,162,74,.3);}" +
      "#dolphin-sidemenu .di-sm-h .di-sm-count{font-size:9px;background:" + GOLD + ";color:" + NAVY + ";" +
      "border-radius:9px;padding:1px 7px;margin-left:auto;margin-right:7px;font-weight:700;}" +
      "#dolphin-sidemenu .di-sm-h .di-sm-chev{font-size:10px;color:" + GOLD + ";transition:transform .25s;}" +
      "#dolphin-sidemenu .di-sm-sec.di-closed>.di-sm-items{display:none;}" +
      "#dolphin-sidemenu .di-sm-sec.di-closed>.di-sm-h .di-sm-chev{transform:rotate(-90deg);}" +
      "#dolphin-sidemenu .di-sm-row{display:flex;align-items:stretch;border-top:1px solid rgba(15,37,64,.05);}" +
      "#dolphin-sidemenu .di-sm-link{flex:1;display:block;padding:7px 6px 7px 20px;font-size:12px;color:#23364d;" +
      "text-decoration:none;cursor:pointer;line-height:1.25;}" +
      "#dolphin-sidemenu .di-sm-row:hover{background:rgba(15,37,64,.05);}" +
      "#dolphin-sidemenu .di-sm-new{flex:0 0 auto;width:0;overflow:hidden;border:none;background:transparent;" +
      "color:" + NAVY + ";font-size:14px;font-weight:700;cursor:pointer;transition:width .15s;}" +
      "#dolphin-sidemenu .di-sm-row:hover .di-sm-new{width:26px;}" +
      "#dolphin-sidemenu .di-sm-new:hover{background:" + GOLD + ";color:" + NAVY + ";}" +
      "#dolphin-sidemenu .di-sm-row.di-active{background:" + NAVY + ";border-left:3px solid " + GOLD + ";}" +
      "#dolphin-sidemenu .di-sm-row.di-active .di-sm-link{color:#fff;font-weight:700;padding-left:17px;}" +
      "#dolphin-sidemenu .di-sm-row.di-active .di-sm-new{color:" + GOLD + ";}" +
      "#dolphin-sidemenu .di-sm-empty{padding:10px 12px;font-size:11px;color:#888;font-style:italic;}";
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
  var SECTIONS = [
    { title: "Operations", items: [
      ["Quarry Block", "Quarry Block"], ["Quarry Inspection", "Quarry Inspection"],
      ["Buyer Inspection", "Buyer Inspection"], ["Delivery Challan", "Delivery Challan"],
      ["Sales Lot", "Sales Lot"] ] },
    { title: "Quarry Masters", items: [
      ["Pit", "Pit"], ["Gangman", "Gangman"], ["Granite Grade", "Granite Grade"],
      ["Granite Size Category", "Granite Size Category"], ["Allowance", "Allowance"],
      ["DMG Tonnage Factor", "DMG Tonnage Factor Master"] ] },
    { title: "People & Parties", items: [
      ["Local Consignee", "Local Consignee"], ["Export Consignee", "Export Consignee"],
      ["Inspector", "Inspector"] ] },
    { title: "Logistics Masters", items: [
      ["Indian Port", "Indian Port"], ["Vehicle", "Vehicle"], ["Driver", "Driver"],
      ["Indian State", "Indian State"], ["Foreign Port", "Foreign Port"],
      ["Vessel", "Vessel"], ["Shipping Agent", "Shipping Agent"] ] }
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

      SECTIONS.forEach(function (sec, si) {
        var s = document.createElement("div");
        s.className = "di-sm-sec";
        var secKey = "di_sm_sec_" + si;
        if (lsGet(secKey, "open") === "closed") s.classList.add("di-closed");
        var h = document.createElement("div");
        h.className = "di-sm-h";
        h.innerHTML = "<span>" + sec.title + "</span><span class='di-sm-count'>" + sec.items.length +
          "</span><span class='di-sm-chev'>▾</span>";
        h.onclick = function () {
          s.classList.toggle("di-closed");
          lsSet(secKey, s.classList.contains("di-closed") ? "closed" : "open");
        };
        s.appendChild(h);
        var box = document.createElement("div");
        box.className = "di-sm-items";
        sec.items.forEach(function (it) {
          var label = it[0], dt = it[1];
          var row = document.createElement("div");
          row.className = "di-sm-row";
          row.setAttribute("data-dt", dt);
          row.setAttribute("data-label", label);

          var a = document.createElement("a");
          a.className = "di-sm-link";
          a.textContent = label;
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

          box.appendChild(row);
        });
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
          var opt = tables[i++].options;
          frappe.model.with_doctype(opt, function () {
            var cm = frappe.get_meta(opt);
            ef[opt] = cm.fields.filter(diImportable).map(function (x) { return x.fieldname; });
            next();
          });
        })();
      });
    });
  }
  function diDownloadTemplate(dt) {
    if (!dt) return;
    diBuildExportFields(dt).then(function (ef) {
      var url = "/api/method/frappe.core.doctype.data_import.data_import.download_template?doctype=" +
        encodeURIComponent(dt) + "&export_fields=" + encodeURIComponent(JSON.stringify(ef)) + "&file_type=Excel";
      var a = document.createElement("a"); a.href = url; a.download = dt.replace(/ /g, "_") + "_Import_Template.xlsx";
      document.body.appendChild(a); a.click(); a.remove();
      try { frappe.show_alert({ message: "Import template downloading…", indicator: "green" }); } catch (e) {}
    });
  }
  function diOpenImport(dt) {
    if (!dt) return;
    frappe.model.with_doctype("Data Import", function () {
      var d = frappe.model.get_new_doc("Data Import");
      d.reference_doctype = dt;
      frappe.set_route("Form", "Data Import", d.name);
    });
  }

  function addButtonBar() {
    try {
      var t = pageType();
      if (t === "other") return;
      var head = document.querySelector(".page-head .page-actions") || document.querySelector(".page-actions");
      if (!head) return;
      // avoid duplicates: one bar per current page-actions
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
        [back, home, edit, print, refresh].forEach(function (b) { bar.appendChild(b); });
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

  /* ---------- tick with retries (pages render async after route change) ---------- */
  function tick() {
    addStyles(); addFab(); brandIt(); addSideMenu(); maybeRedirect(); addButtonBar(); paintCustomBlocks();
  }
  function tickRetries() { [0, 350, 800, 1500, 2500].forEach(function (t) { setTimeout(tick, t); }); }

  $(document).on("app_ready", function () { tickRetries(); });
  if (frappe.router && frappe.router.on) {
    frappe.router.on("change", function () { tickRetries(); });
  }
  setTimeout(tick, 900);
  setTimeout(tick, 1800);

  /* ---------- make EVERY home affordance behave the same (go to Dolphin / confirm-exit) ----------
     Intercepts the breadcrumb home icon + navbar home so they no longer jump to the raw Frappe home. */
  document.addEventListener("click", function (ev) {
    try {
      var a = ev.target.closest && ev.target.closest('#navbar-breadcrumbs a, .navbar-home, .page-head .breadcrumb a, a.navbar-brand');
      if (!a) return;
      var href = a.getAttribute("href") || "";
      var isHome = href === "/app" || href === "/app/home" || href === "/app/" ||
        a.classList.contains("navbar-home") || (a.closest && a.closest(".navbar-home"));
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
