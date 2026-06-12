/* Dolphin International - desk navigation and branding */
frappe.provide("dolphin");
(function () {
  var WS = "dolphin";

  function addStyles() {
    if (document.getElementById("dolphin-theme-js-css")) return;
    var css =
      "#dolphin-ws-fab{position:fixed;right:18px;bottom:18px;z-index:1050;" +
      "background:#D4A24A;color:#0F2540;border:none;border-radius:24px;" +
      "padding:10px 16px;font-weight:700;font-size:13px;" +
      "box-shadow:0 4px 12px rgba(0,0,0,.25);cursor:pointer;}" +
      "#dolphin-ws-fab:hover{background:#0F2540;color:#fff;}" +
      ".dolphin-brand{display:flex;align-items:center;gap:8px;" +
      "padding:8px 10px;margin:8px;border-radius:8px;background:#fff;" +
      "text-decoration:none;}" +
      ".dolphin-brand img{height:26px;width:auto;}" +
      ".dolphin-brand span{color:#0F2540;font-weight:700;font-size:12px;" +
      "line-height:1.05;font-family:Georgia,serif;}";
    var s = document.createElement("style");
    s.id = "dolphin-theme-js-css";
    s.textContent = css;
    document.head.appendChild(s);
  }

  function maybeRedirect() {
    try {
      var r = frappe.get_route() || [];
      var first = (r[0] || "").toLowerCase();
      if (first === "" || first === "desktop" || first === "workspaces") {
        if ((frappe.get_route_str() || "") !== WS) frappe.set_route(WS);
      }
    } catch (e) {}
  }

  function addFab() {
    if (document.getElementById("dolphin-ws-fab")) return;
    if (!document.body) return;
    var b = document.createElement("button");
    b.id = "dolphin-ws-fab";
    b.type = "button";
    b.title = "Go to Dolphin Workspace";
    b.innerHTML = "&#8962; Workspace";
    b.onclick = function () { try { frappe.set_route(WS); } catch (e) {} };
    document.body.appendChild(b);
  }

  function brandIt() {
    try {
      var sb = document.querySelector(".body-sidebar") ||
               document.querySelector(".standard-sidebar");
      if (sb && !sb.querySelector(".dolphin-brand")) {
        var a = document.createElement("a");
        a.className = "dolphin-brand";
        a.setAttribute("href", "/app/" + WS);
        a.innerHTML =
          '<img src="/files/dolphin_logo_mono.png" alt="DI"/>' +
          "<span>Dolphin International</span>";
        a.onclick = function (ev) {
          ev.preventDefault();
          try { frappe.set_route(WS); } catch (e) {}
        };
        sb.insertBefore(a, sb.firstChild);
      }
    } catch (e) {}
  }

  function boot() { addStyles(); addFab(); brandIt(); maybeRedirect(); }

  $(document).on("app_ready", boot);
  if (frappe.router && frappe.router.on) {
    frappe.router.on("change", function () { addFab(); brandIt(); maybeRedirect(); });
  }
  setTimeout(boot, 900);
  setTimeout(boot, 1800);
})();

