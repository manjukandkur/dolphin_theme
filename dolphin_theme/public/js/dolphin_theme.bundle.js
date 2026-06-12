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
      ".di-navbar button.di-g{background:" + GOLD + ";color:" + NAVY + ";}" +
      ".di-navbar button.di-g:hover{background:" + NAVY + ";color:#fff;}" +
      ".di-navbar button.di-x{background:#fff;color:" + NAVY + ";border:1px solid rgba(15,37,64,.2);}" +
      ".di-navbar button.di-x:hover{background:" + NAVY + ";color:#fff;}";
    var s = document.createElement("style");
    s.id = "dolphin-theme-js-css";
    s.textContent = css;
    document.head.appendChild(s);
  }

  /* ---------- redirect empty/home route to workspace ---------- */
  function maybeRedirect() {
    try {
      var r = frappe.get_route() || [];
      var first = (r[0] || "").toLowerCase();
      if (first === "" || first === "desktop" || first === "workspaces") {
        if ((frappe.get_route_str() || "") !== WS) frappe.set_route(WS);
      }
    } catch (e) {}
  }

  /* ---------- floating workspace button ---------- */
  function addFab() {
    if (document.getElementById("dolphin-ws-fab") || !document.body) return;
    var b = document.createElement("button");
    b.id = "dolphin-ws-fab"; b.type = "button"; b.title = "Go to Dolphin Workspace";
    b.innerHTML = "&#8962; Workspace";
    b.onclick = function () { try { frappe.set_route(WS); } catch (e) {} };
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
        a.onclick = function (ev) { ev.preventDefault(); try { frappe.set_route(WS); } catch (e) {} };
        sb.insertBefore(a, sb.firstChild);
      }
    } catch (e) {}
  }

  /* ---------- consistent page button bar ---------- */
  function pageType() {
    try {
      var r = frappe.get_route() || [];
      var v = (r[0] || "").toLowerCase();
      if (v === "form") return "form";
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
      var home = mkBtn("⌂ Home", "g", function () { frappe.set_route(WS); });
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
        var imp = mkBtn("⤓ Import", "g", function () {
          var dt = curDoctype(); if (dt) frappe.set_route("data-import", "new", { doctype: dt }) || (window.location = "/app/data-import/new?doctype=" + encodeURIComponent(dt));
        });
        [home, back, imp, refresh].forEach(function (b) { bar.appendChild(b); });
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
    try { return (frappe.get_route_str() || "").toLowerCase() === WS; } catch (e) { return false; }
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
    addStyles(); addFab(); brandIt(); maybeRedirect(); addButtonBar(); paintCustomBlocks();
  }
  function tickRetries() { [0, 350, 800, 1500, 2500].forEach(function (t) { setTimeout(tick, t); }); }

  $(document).on("app_ready", function () { tickRetries(); });
  if (frappe.router && frappe.router.on) {
    frappe.router.on("change", function () { tickRetries(); });
  }
  setTimeout(tick, 900);
  setTimeout(tick, 1800);
})();
