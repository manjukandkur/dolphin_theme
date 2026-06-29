/* =========================================================
   Dolphin - New Buyer Inspection (grid entry), self-contained.
   Appended to dolphin_theme.bundle.js. Isolated IIFE: does NOT
   touch existing code. Adds a "New (grid)" button on the Buyer
   Inspection list; opens a full-screen grid; on submit it
   PRE-FILLS the standard New Buyer Inspection form for review+save
   (never auto-inserts -> cannot write bad data on its own).
   ============================================================ */
(function () {
  "use strict";

  function onBIList() {
    try {
      var r = (frappe.get_route && frappe.get_route()) || [];
      return r[0] === "List" && r[1] === "Buyer Inspection";
    } catch (e) { return false; }
  }

  // ---- master cache (fetched live, once per page session) ----
  var M = {};
  function loadMasters() {
    if (M.__loaded) return Promise.resolve(M);
    function L(dt, fields, filters) {
      return frappe.db.get_list(dt, { fields: fields || ["name"], filters: filters || [], limit: 0, order_by: "name" });
    }
    return Promise.all([
      L("Export Consignee", ["name", "company_name"]),
      L("Buyer Marker", ["name"]),
      L("Indian Port", ["name"]),
      L("Allowance", ["name"]),
      L("DMG Tonnage Factor Master", ["name"]),
      L("Buyer Inspector", ["name"]),
      L("Granite Grade", ["name"]),
      L("Granite Size Category", ["name"])
    ]).then(function (res) {
      M.export_consignee = res[0] || [];
      M.marker = (res[1] || []).map(function (x) { return x.name; });
      M.port = (res[2] || []).map(function (x) { return x.name; });
      M.allow = (res[3] || []).map(function (x) { return x.name; });
      M.dmg = (res[4] || []).map(function (x) { return x.name; });
      M.binsp = (res[5] || []).map(function (x) { return x.name; });
      M.grade = (res[6] || []).map(function (x) { return x.name; });
      M.size = (res[7] || []).map(function (x) { return x.name; });
      M.__loaded = true;
      return M;
    });
  }

  function selOpts(arr, ph) {
    return '<option value="">' + (ph || "") + "</option>" +
      (arr || []).map(function (x) { return "<option>" + frappe.utils.escape_html(String(x)) + "</option>"; }).join("");
  }
  function ecOpts() {
    return '<option value="">Select company...</option>' +
      (M.export_consignee || []).map(function (x) {
        return '<option value="' + frappe.utils.escape_html(x.name) + '">' +
          frappe.utils.escape_html(x.company_name || x.name) + "</option>";
      }).join("");
  }

  function num(v) { var n = parseFloat(String(v == null ? "" : v).replace(/[^0-9.\-]/g, "")); return isNaN(n) ? 0 : n; }

  function openGrid() {
    loadMasters().then(function () {
      var d = new frappe.ui.Dialog({
        title: "New Buyer Inspection . Export (grid)",
        size: "extra-large",
        fields: [{ fieldtype: "HTML", fieldname: "body" }],
        primary_action_label: "Review in form",
        primary_action: function () { submitToForm(d); }
      });

      var html =
        '<div style="font-size:13px;">' +
        '<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:10px;margin-bottom:12px;">' +
          fld("Report date", '<input type="date" class="form-control di-h" data-k="report_date" value="' + frappe.datetime.get_today() + '">') +
          fld("Export Consignee *", '<select class="form-control di-h" data-k="export_buyer">' + ecOpts() + "</select>") +
          fld("Shipping mark", '<select class="form-control di-h" data-k="marking">' + selOpts(M.marker, "Select...") + "</select>") +
          fld("Buyer Inspector *", '<input class="form-control di-h" data-k="buyer_inspector_name" placeholder="type a name">') +
          fld("Port of loading", '<select class="form-control di-h" data-k="port_of_loading">' + selOpts(M.port, "Select...") + "</select>") +
          fld("Specific Gravity (DMG) *", '<select class="form-control di-h" data-k="dmg_tonnage_factor">' + selOpts(M.dmg, "Select...") + "</select>") +
          fld("Calculate net?", '<input type="checkbox" class="di-net" style="margin-top:8px;">') +
          fld("Allowance", '<select class="form-control di-h di-allow" data-k="allowance" disabled>' + selOpts(M.allow, "Select...") + "</select>") +
        "</div>" +
        '<div style="border:1px solid var(--border-color,#d1d8dd);border-radius:6px;padding:8px 10px;margin-bottom:10px;display:flex;gap:8px;align-items:center;">' +
          '<span style="font-weight:600;">Check block:</span>' +
          '<input class="form-control di-lookup" style="max-width:260px;" placeholder="block / export no - status">' +
          '<span class="di-lookup-res" style="color:#6c7680;">type a block number...</span>' +
        "</div>" +
        '<div style="overflow-x:auto;border:1px solid var(--border-color,#d1d8dd);border-radius:6px;">' +
          '<table class="table table-bordered" style="margin:0;font-size:13px;"><thead><tr style="background:#f4f5f6;">' +
            "<th>#</th><th>Block Number</th><th>Export No</th><th>L</th><th>W</th><th>H</th>" +
            "<th>G.Vol</th><th>SG</th><th>Grade</th><th>Size</th><th>Status</th>" +
          "</tr></thead><tbody class='di-rows'></tbody></table>" +
        "</div>" +
        '<div style="margin-top:10px;display:flex;gap:8px;align-items:center;">' +
          '<button class="btn btn-xs btn-default di-add1">+ Add row</button>' +
          '<button class="btn btn-xs btn-default di-add10">+10</button>' +
          '<button class="btn btn-xs btn-default di-add25">+25</button>' +
          '<button class="btn btn-xs btn-default di-add50">+50</button>' +
          '<span class="di-count" style="color:#6c7680;"></span>' +
        "</div>" +
        "</div>";

      d.fields_dict.body.$wrapper.html(html);
      var $w = d.fields_dict.body.$wrapper;
      var tb = $w.find(".di-rows")[0];

      function rowHTML() {
        return "<td class='di-n'></td>" +
          "<td><input class='form-control input-xs di-bn'></td>" +
          "<td><input class='form-control input-xs di-ex'></td>" +
          "<td><input class='form-control input-xs di-L'></td>" +
          "<td><input class='form-control input-xs di-W'></td>" +
          "<td><input class='form-control input-xs di-H'></td>" +
          "<td class='di-vol' style='background:#f4f5f6;'></td>" +
          "<td><input class='form-control input-xs di-sg'></td>" +
          "<td><select class='form-control input-xs di-grade'>" + selOpts(M.grade, "-") + "</select></td>" +
          "<td><select class='form-control input-xs di-size'>" + selOpts(M.size, "-") + "</select></td>" +
          "<td class='di-st' style='background:#f4f5f6;'></td>";
      }
      function addRow() { var tr = document.createElement("tr"); tr.innerHTML = rowHTML(); tb.appendChild(tr); renum(); return tr; }
      function addN(k) { for (var i = 0; i < k; i++) addRow(); }
      function renum() { Array.prototype.forEach.call(tb.children, function (tr, i) { tr.querySelector(".di-n").textContent = i + 1; }); $w.find(".di-count").text(tb.children.length + " blocks"); }

      function recalc(tr) {
        var v = num(tr.querySelector(".di-L").value) * num(tr.querySelector(".di-W").value) * num(tr.querySelector(".di-H").value) / 1e6;
        tr.querySelector(".di-vol").textContent = v ? v.toFixed(3) : "";
      }

      function fillFromStock(tr) {
        var bn = (tr.querySelector(".di-bn").value || "").trim();
        if (!bn) { tr.querySelector(".di-st").textContent = ""; return; }
        frappe.db.get_list("Quarry Block", {
          filters: [["block_number", "=", bn]],
          fields: ["name", "length_gross", "width_gross", "height_gross", "gross_volume", "export_block_no", "status"],
          limit: 1
        }).then(function (rows) {
          if (rows && rows.length) {
            var b = rows[0];
            if (!tr.querySelector(".di-L").value) tr.querySelector(".di-L").value = b.length_gross || "";
            if (!tr.querySelector(".di-W").value) tr.querySelector(".di-W").value = b.width_gross || "";
            if (!tr.querySelector(".di-H").value) tr.querySelector(".di-H").value = b.height_gross || "";
            if (!tr.querySelector(".di-ex").value && b.export_block_no) tr.querySelector(".di-ex").value = b.export_block_no;
            tr.querySelector(".di-st").innerHTML = statusPill(b.status);
            recalc(tr);
          } else {
            tr.querySelector(".di-st").innerHTML = "<span style='color:#c0392b;'>not found</span>";
          }
        });
      }

      function statusPill(s) {
        var bg = (s === "In Stock") ? "#d4edda" : "#fff3cd", fg = (s === "In Stock") ? "#155724" : "#856404";
        return "<span style='background:" + bg + ";color:" + fg + ";padding:1px 7px;border-radius:8px;'>" + frappe.utils.escape_html(s || "") + "</span>";
      }

      $w.on("input", ".di-L,.di-W,.di-H", function () { recalc(this.closest("tr")); });
      $w.on("change", ".di-bn", function () { fillFromStock(this.closest("tr")); });
      $w.on("click", ".di-add1", function (e) { e.preventDefault(); addRow(); });
      $w.on("click", ".di-add10", function (e) { e.preventDefault(); addN(10); });
      $w.on("click", ".di-add25", function (e) { e.preventDefault(); addN(25); });
      $w.on("click", ".di-add50", function (e) { e.preventDefault(); addN(50); });
      $w.on("change", ".di-net", function () { $w.find(".di-allow").prop("disabled", !this.checked); });

      var lkTimer = null;
      $w.on("input", ".di-lookup", function () {
        var val = this.value.trim(), res = $w.find(".di-lookup-res");
        clearTimeout(lkTimer);
        if (!val) { res.text("type a block number...").css("color", "#6c7680"); return; }
        lkTimer = setTimeout(function () {
          frappe.db.get_list("Quarry Block", {
            or_filters: [["block_number", "=", val], ["export_block_no", "=", val]],
            fields: ["block_number", "export_block_no", "status", "gross_volume"], limit: 1
          }).then(function (rows) {
            if (rows && rows.length) {
              var b = rows[0];
              res.html("Block " + frappe.utils.escape_html(b.block_number) + " " + statusPill(b.status) +
                " <span style='color:#6c7680;'>export " + frappe.utils.escape_html(b.export_block_no || "-") + " . vol " + (b.gross_volume || 0) + "</span>");
            } else { res.text("not found in stock").css("color", "#c0392b"); }
          });
        }, 250);
      });

      addN(10);
      d.show();
      d.$wrapper.find(".modal-dialog").css("max-width", "95vw");
    });
  }

  function fld(label, inner) {
    return '<div><label style="font-size:11px;color:#6c7680;display:block;margin-bottom:2px;">' + label + "</label>" + inner + "</div>";
  }

  function submitToForm(d) {
    var $w = d.fields_dict.body.$wrapper;
    var hdr = {};
    $w.find(".di-h").each(function () { hdr[this.getAttribute("data-k")] = this.value; });
    var net = $w.find(".di-net").is(":checked");
    var rows = [];
    $w.find(".di-rows tr").each(function () {
      var tr = this, bn = (tr.querySelector(".di-bn").value || "").trim();
      if (!bn) return;
      rows.push({
        block_number_input: bn,
        export_block_no: (tr.querySelector(".di-ex").value || "").trim(),
        length_gross: num(tr.querySelector(".di-L").value) || undefined,
        width_gross: num(tr.querySelector(".di-W").value) || undefined,
        height_gross: num(tr.querySelector(".di-H").value) || undefined,
        specific_gravity: num(tr.querySelector(".di-sg").value) || undefined,
        granite_quality_grade: tr.querySelector(".di-grade").value || undefined,
        granite_size_category: tr.querySelector(".di-size").value || undefined
      });
    });
    if (!rows.length) { frappe.msgprint("Add at least one block (Block Number)."); return; }

    frappe.new_doc("Buyer Inspection").then(function () {
      var f = cur_frm;
      f.set_value("sale_type", "Export");
      if (hdr.report_date) f.set_value("report_date", hdr.report_date);
      if (hdr.export_buyer) f.set_value("export_buyer", hdr.export_buyer);
      if (hdr.marking) f.set_value("marking", hdr.marking);
      if (hdr.port_of_loading) f.set_value("port_of_loading", hdr.port_of_loading);
      if (hdr.dmg_tonnage_factor) f.set_value("dmg_tonnage_factor", hdr.dmg_tonnage_factor);
      if (net) f.set_value("show_net_calculations", 1);
      rows.forEach(function (r) {
        var ch = f.add_child("block_rows");
        Object.keys(r).forEach(function (k) { if (r[k] !== undefined) ch[k] = r[k]; });
      });
      f.refresh_field("block_rows");
      if (hdr.buyer_inspector_name) {
        frappe.msgprint("Set Buyer Inspector to: " + frappe.utils.escape_html(hdr.buyer_inspector_name) + " (add in the form), then Save.");
      }
      d.hide();
      frappe.show_alert({ message: rows.length + " blocks loaded - review and Save.", indicator: "green" });
    });
  }

  // ---- inject the launcher button on the BI list ----
  function injectButton() {
    if (!onBIList()) return;
    if (document.querySelector(".di-newgrid-btn")) return;
    var bar = document.querySelector(".page-actions");
    if (!bar) return;
    var b = document.createElement("button");
    b.className = "btn btn-primary btn-sm di-newgrid-btn";
    b.style.marginLeft = "6px";
    b.textContent = "New (grid)";
    b.onclick = function (e) { e.preventDefault(); openGrid(); };
    bar.insertBefore(b, bar.firstChild);
  }

  var obs = new MutationObserver(function () {
    clearTimeout(window.__diNewBITimer);
    window.__diNewBITimer = setTimeout(injectButton, 250);
  });
  function start() {
    try { obs.observe(document.body, { childList: true, subtree: true }); } catch (e) {}
    injectButton();
  }
  if (document.body) start(); else document.addEventListener("DOMContentLoaded", start);
})();
