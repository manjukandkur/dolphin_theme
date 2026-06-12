/* ============================================================
   Dolphin International — desk navigation helpers
   Loaded via app_include_js on every desk page.
   - Reroutes the breadcrumb Home icon to the Dolphin workspace
   - Adds a floating "Back to Workspace" button
   Theme colours are handled entirely in dolphin_theme.css.
   ============================================================ */


(function () {
  "use strict";

  // Route of the Dolphin workspace (rebuilt during setup).
  var WORKSPACE_ROUTE = "/app/dolphin-quarry";

  function goToWorkspace(e) {
    if (e) { e.preventDefault(); e.stopPropagation(); }
    try {
      if (window.frappe && frappe.set_route) {
        frappe.set_route(WORKSPACE_ROUTE.replace(/^\/app\//, "").replace(/^\//, ""));
        return;
      }
    } catch (_) {}
    window.location.assign(WORKSPACE_ROUTE);
  }

  function ensureButton() {
    if (document.getElementById("dolphin-ws-btn") || !document.body) return;
    var b = document.createElement("button");
    b.id = "dolphin-ws-btn";
    b.innerHTML = '<span class="dolphin-dot">◀</span> Workspace';
    b.title = "Go to the Dolphin workspace";
    b.addEventListener("click", goToWorkspace);
    document.body.appendChild(b);
  }

  function isHomeTarget(el) {
    var a = el && el.closest && el.closest("a");
    if (!a) return false;
    var href = a.getAttribute("href") || "";
    if (/\/app\/?$/.test(href) || /\/app\/home\/?$/.test(href)) return true;
    if (a.closest("#navbar-breadcrumbs") && a.querySelector("svg")) {
      var li = a.closest("li");
      if (li && !li.previousElementSibling) return true;
    }
    if (a.classList.contains("navbar-home")) return true;
    return false;
  }

  document.addEventListener("click", function (e) {
    if (isHomeTarget(e.target)) goToWorkspace(e);
  }, true);

  function tick() { ensureButton(); }
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", tick);
  } else {
    tick();
  }
  setInterval(tick, 1500);
})();

