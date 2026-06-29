/* ============================================================
   Dolphin - block-grid helpers for QI / BI / DC.
   1. New forms open with 10 blank rows.
   2. "+10 / +25 / +50 rows" buttons (in that order) for bulk add.
   3. On save, completely-empty rows are dropped automatically so
      leftover blank rows never trigger the mandatory-field error.
   Nothing else changed - same fields, columns, totals, print, import.
   ============================================================ */
(function () {
  "use strict";

  var MAP = {
    "Buyer Inspection": "block_rows",
    "Quarry Inspection": "block_rows",
    "Delivery Challan": "dc_block_rows"
  };

  // Fields that mark a row as "real". If ALL are blank, the row is empty.
  function keyFields(dt) {
    if (dt === "Quarry Inspection") {
      return ["quarry_block_no", "length_gross", "width_gross", "height_gross"];
    }
    if (dt === "Buyer Inspection") {
      return ["block", "block_number_input", "export_block_no", "length_gross", "width_gross", "height_gross"];
    }
    return ["block", "block_number_input", "export_block_no"]; // Delivery Challan
  }

  function isBlank(v) { return v === undefined || v === null || v === "" || v === 0; }

  function isEmptyRow(row, keys) {
    for (var i = 0; i < keys.length; i++) { if (!isBlank(row[keys[i]])) { return false; } }
    return true;
  }

  function addBulkButtons(frm, fieldname) {
    var f = frm.fields_dict[fieldname];
    if (!f || !f.grid || typeof f.grid.add_custom_button !== "function") { return; }
    // add_custom_button prepends, so add 50,25,10 to display 10,25,50 left-to-right.
    [50, 25, 10].forEach(function (n) {
      f.grid.add_custom_button("+ " + n + " rows", function () {
        for (var i = 0; i < n; i++) { frm.add_child(fieldname); }
        frm.refresh_field(fieldname);
      });
    });
  }

  function defaultRows(frm, fieldname) {
    if (!frm.is_new() || frm.__bulkDefaulted) { return; }
    frm.__bulkDefaulted = true;
    var have = (frm.doc[fieldname] || []).length;
    for (var i = have; i < 10; i++) { frm.add_child(fieldname); }
    frm.refresh_field(fieldname);
  }

  function pruneEmpty(frm, fieldname, dt) {
    var keys = keyFields(dt);
    var rows = frm.doc[fieldname] || [];
    var kept = rows.filter(function (r) { return !isEmptyRow(r, keys); });
    if (kept.length !== rows.length) {
      frm.doc[fieldname] = kept;
      kept.forEach(function (r, i) { r.idx = i + 1; });
      frm.refresh_field(fieldname);
    }
  }

  Object.keys(MAP).forEach(function (dt) {
    var fieldname = MAP[dt];
    frappe.ui.form.on(dt, {
      refresh: function (frm) { addBulkButtons(frm, fieldname); defaultRows(frm, fieldname); },
      before_save: function (frm) { pruneEmpty(frm, fieldname, dt); },
      validate: function (frm) { pruneEmpty(frm, fieldname, dt); }
    });
  });
})();
