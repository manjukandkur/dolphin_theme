/* ============================================================
   Dolphin theme add-ons (loaded on every desk page via hooks).
   B) Quarry Block list: hide the "+ Add Quarry Block" primary
      action (blocks are created through Quarry Inspection).
   C) Stock Dashboard (dolphin-stock page): inject a "TRACE A
      BLOCK" panel - reverse-search a block to its QI / BI / DC
      with eye-previews + open. Dashboard navy/gold theme; the
      three documents are told apart by their ICONS.
   Purely additive and reversible; does not touch other code.
   NOTE: the block-grid bulk-rows feature (auto 10 rows +
   +10/+25/+50 buttons) was removed - it interfered with new
   forms; rows are added normally via the standard grid.
   ============================================================ */
(function () {
  "use strict";

  /* ---------------- B) hide "+ Add Quarry Block" ---------------- */
  var prevQB = frappe.listview_settings["Quarry Block"] || {};
  var prevOnload = prevQB.onload;
  prevQB.onload = function (lv) {
    if (prevOnload) { try { prevOnload(lv); } catch (e) {} }
    try { if (lv.page && lv.page.clear_primary_action) lv.page.clear_primary_action(); } catch (e) {}
  };
  frappe.listview_settings["Quarry Block"] = prevQB;

  /* ---------------- C) Stock Dashboard "TRACE A BLOCK" ---------------- */
  var NAVY = "#0F2540", GOLD = "#D4A24A", GOLDTX = "#9a7414";
  var SCOL = { "In Stock": "#16a34a", "Buyer Marked": "#D4A24A", "In Delivery Challan": "#2563eb", "Dispatched/Transported": "#64748b", "At Port": "#0891b2", "At Bannikoppa Station yard": "#0891b2", "Shipped": "#7c3aed" };
  function esc(s) { return frappe.utils.escape_html(String(s == null ? "" : s)); }
  function pill(s) { var c = SCOL[s] || "#64748b"; return '<span style="background:' + c + '22;color:' + c + ';border:1px solid ' + c + '66;padding:2px 10px;border-radius:12px;font-size:12.5px;white-space:nowrap;">&#9679; ' + esc(s) + '</span>'; }
  function onStockPage() { try { var r = frappe.get_route() || []; return r[0] === "dolphin-stock"; } catch (e) { return false; } }

  function injectTrace() {
    if (!onStockPage() || document.querySelector("#di-trace")) return;
    var page = document.querySelector('[data-page-route="dolphin-stock"]') || document.querySelector(".page-body");
    if (!page) return;
    var host = page.querySelector(".layout-main-section") || page.querySelector(".page-content") || page;
    var box = document.createElement("div");
    box.id = "di-trace";
    box.style.cssText = "margin:10px 0 16px;background:#fff;border:1px solid #e2e5e9;border-radius:12px;overflow:hidden;";
    box.innerHTML =
      '<div style="border-left:4px solid ' + GOLD + ';padding:11px 16px;display:flex;align-items:center;gap:8px;">' +
        '<i class="ti ti-cube" style="color:' + NAVY + ';font-size:18px;" aria-hidden="true"></i>' +
        '<span style="font-weight:700;letter-spacing:.03em;color:' + NAVY + ';">TRACE A BLOCK</span>' +
        '<span style="font-size:12px;color:#6c7680;">find where any block is and open its QI / BI / DC</span>' +
      '</div>' +
      '<div style="padding:2px 16px 16px;">' +
        '<div style="display:flex;gap:8px;align-items:center;border:1px solid ' + GOLD + ';border-radius:8px;padding:7px 11px;max-width:540px;">' +
          '<i class="ti ti-search" style="color:' + GOLDTX + ';font-size:17px;" aria-hidden="true"></i>' +
          '<input id="di-trace-in" placeholder="Block number or Export number, then Enter" style="flex:1;border:0;outline:none;font-size:15px;color:' + NAVY + ';background:transparent;">' +
          '<button id="di-trace-go" style="background:' + NAVY + ';color:#fff;border:0;border-radius:6px;padding:5px 14px;cursor:pointer;font-size:13px;">Trace</button>' +
        '</div>' +
        '<div id="di-trace-out" style="margin-top:13px;"></div>' +
      '</div>';
    host.insertBefore(box, host.firstChild);
    var inp = box.querySelector("#di-trace-in");
    box.querySelector("#di-trace-go").onclick = function () { runTrace(inp.value); };
    inp.addEventListener("keydown", function (e) { if (e.key === "Enter") runTrace(inp.value); });
  }

  function docRow(label, icon, doctype, name) {
    if (!name) return '<div class="dr"><div class="dic" style="color:#aab1ba;"><i class="ti ' + icon + '" aria-hidden="true"></i></div><div style="flex:1;color:#9aa3ad;font-size:12.5px;"><div class="drl" style="color:#aab1ba;">' + label + '</div>none</div></div>';
    return '<div class="dr"><div class="dic"><i class="ti ' + icon + '" aria-hidden="true"></i></div>' +
      '<div style="flex:1;"><div class="drl">' + label + '</div><span class="drn">' + esc(name) + '</span></div>' +
      '<button class="di-eye" data-dt="' + esc(doctype) + '" data-nm="' + esc(name) + '"><i class="ti ti-eye" style="vertical-align:-2px;" aria-hidden="true"></i> PDF</button>' +
      '<button class="di-open" data-dt="' + esc(doctype) + '" data-nm="' + esc(name) + '">open &#8599;</button>' +
      '</div>';
  }
  function pdfUrls(doctype, name) {
    var qs = "doctype=" + encodeURIComponent(doctype) + "&name=" + encodeURIComponent(name);
    return {
      view: "/printview?" + qs + "&trigger_print=0&no_letterhead=0",
      pdf: "/api/method/frappe.utils.print_format.download_pdf?" + qs + "&no_letterhead=0"
    };
  }
  function openPdf(doctype, name) {
    var u = pdfUrls(doctype, name);
    var d = new frappe.ui.Dialog({
      title: doctype + " - " + name,
      size: "large",
      primary_action_label: "Download PDF",
      primary_action: function () { window.open(u.pdf, "_blank"); }
    });
    d.$body.html('<iframe src="' + u.view + '" style="width:100%;height:72vh;border:0;background:#fff;"></iframe>');
    d.show();
    d.$wrapper.find(".modal-dialog").css("max-width", "920px");
  }
  function glChild(childDt, parentDt, filters) {
    return frappe.call({ method: "frappe.client.get_list", args: { doctype: childDt, parent: parentDt, filters: filters, fields: ["parent"], limit_page_length: 30 } })
      .then(function (r) { return r.message || []; })
      .catch(function () { return []; });
  }
  function uniqParents(rows) {
    var seen = {}, list = [];
    (rows || []).forEach(function (x) { if (x.parent && !seen[x.parent]) { seen[x.parent] = 1; list.push(x.parent); } });
    return list;
  }
  function runTrace(val) {
    val = (val || "").trim();
    var out = document.querySelector("#di-trace-out");
    if (!out) return;
    if (!val) { out.innerHTML = ""; return; }
    out.innerHTML = '<span style="color:#9aa3ad;">searching&hellip;</span>';
    frappe.call({
      method: "frappe.client.get_list",
      args: { doctype: "Quarry Block", or_filters: [["block_number", "=", val], ["export_block_no", "=", val]], fields: ["name", "block_number", "export_block_no", "pit", "granite_quality_grade", "granite_size_category", "length_gross", "width_gross", "height_gross", "gross_volume", "gross_tonnage", "status", "date_produced"], limit_page_length: 1 }
    }).then(function (r) {
      var b = r.message && r.message[0];
      if (!b) { out.innerHTML = '<div style="color:#c0392b;font-size:13px;">No block found for "' + esc(val) + '".</div>'; return; }
      var bn = String(b.block_number || "");
      Promise.all([
        glChild("Quarry Inspection Block", "Quarry Inspection", [["quarry_block_no", "=", bn]]),
        glChild("Buyer Inspection Block", "Buyer Inspection", [["block", "=", b.name]]),
        glChild("DC Block Row", "Delivery Challan", [["block", "=", b.name]])
      ]).then(function (res) {
        renderBlock(out, b, uniqParents(res[0]), uniqParents(res[1]), uniqParents(res[2]));
      });
    });
  }
  function docRows(label, icon, doctype, names) {
    if (!names || !names.length) return docRow(label, icon, doctype, null);
    return names.map(function (nm) { return docRow(label, icon, doctype, nm); }).join("");
  }
  function renderBlock(out, b, qiNames, biNames, dcNames) {
    var dims = (b.length_gross || "?") + "&times;" + (b.width_gross || "?") + "&times;" + (b.height_gross || "?");
    out.innerHTML =
      '<div style="border:1px solid #e2e5e9;border-radius:10px;padding:13px;">' +
        '<div style="display:flex;align-items:center;gap:12px;flex-wrap:wrap;margin-bottom:12px;">' +
          '<span style="font-size:19px;font-weight:600;color:' + NAVY + ';">Block ' + esc(b.block_number) + '</span>' +
          '<span style="font-size:12.5px;color:#6c7680;">Export ' + esc(b.export_block_no || "-") + ' - Pit ' + esc(b.pit || "-") + ' - Grade ' + esc(b.granite_quality_grade || "-") + ' - Size ' + esc(b.granite_size_category || "-") + ' - ' + dims + ' - ' + (b.gross_volume || 0) + ' CBM - ' + (b.gross_tonnage || 0) + ' t</span>' +
          '<span style="margin-left:auto;">' + pill(b.status) + '</span>' +
        '</div>' +
        docRows("Source Quarry Inspection", "ti-clipboard-check", "Quarry Inspection", qiNames) +
        docRows("Source Buyer Inspection", "ti-table", "Buyer Inspection", biNames) +
        docRows("Delivery Challan", "ti-truck-delivery", "Delivery Challan", dcNames) +
      '</div>';
    Array.prototype.forEach.call(out.querySelectorAll(".di-eye"), function (btn) {
      btn.onclick = function () { openPdf(btn.getAttribute("data-dt"), btn.getAttribute("data-nm")); };
    });
    Array.prototype.forEach.call(out.querySelectorAll(".di-open"), function (btn) {
      btn.onclick = function () { frappe.set_route("Form", btn.getAttribute("data-dt"), btn.getAttribute("data-nm")); };
    });
  }

  if (!document.getElementById("di-trace-css")) {
    var st = document.createElement("style"); st.id = "di-trace-css";
    st.textContent = "#di-trace .dr{display:flex;align-items:center;gap:11px;border:1px solid #e8eaee;border-radius:9px;padding:9px 12px;margin-bottom:8px;}" +
      "#di-trace .dic{width:34px;height:34px;border-radius:8px;background:#f1ede2;display:flex;align-items:center;justify-content:center;color:" + NAVY + ";font-size:18px;flex:0 0 auto;}" +
      "#di-trace .drl{font-size:10.5px;color:" + GOLDTX + ";text-transform:uppercase;letter-spacing:.04em;font-weight:600;}" +
      "#di-trace .drn{font-weight:600;color:" + NAVY + ";cursor:pointer;}" +
      "#di-trace .di-eye,#di-trace .di-open{border:1px solid #d7dbe0;background:#fff;border-radius:6px;padding:4px 10px;cursor:pointer;font-size:12px;white-space:nowrap;color:" + NAVY + ";margin-left:6px;}" +
      "#di-trace .di-eye:hover,#di-trace .di-open:hover{background:#f6f3ea;border-color:" + GOLD + ";}" +
      "#di-trace .di-pv{margin:0 0 8px 0;border-left:3px solid " + GOLD + ";border-radius:0 8px 8px 0;background:#f7f8fa;padding:9px 12px;font-size:12.5px;}";
    document.head && document.head.appendChild(st);
  }
  setInterval(injectTrace, 800);
  if (document.body) injectTrace();
})();
