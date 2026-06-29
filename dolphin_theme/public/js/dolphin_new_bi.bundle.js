/* ============================================================
   Dolphin - bulk "add rows" buttons for block grids.
   Adds "+10 / +25 / +50 rows" next to the existing Add Row on the
   block table of Quarry Inspection, Buyer Inspection and Delivery
   Challan. Nothing else is changed - same fields, columns, buttons,
   totals, print and import. Purely additive and reversible.
   ============================================================ */
(function () {
  "use strict";

  var MAP = {
    "Buyer Inspection": "block_rows",
    "Quarry Inspection": "block_rows",
    "Delivery Challan": "dc_block_rows"
  };

  function addBulkButtons(frm, fieldname) {
    var f = frm.fields_dict[fieldname];
    if (!f || !f.grid || typeof f.grid.add_custom_button !== "function") { return; }
    // add_custom_button de-dupes by label, so calling on every refresh is safe.
    [10, 25, 50].forEach(function (n) {
      f.grid.add_custom_button("+ " + n + " rows", function () {
        for (var i = 0; i < n; i++) { frm.add_child(fieldname); }
        frm.refresh_field(fieldname);
      });
    });
  }

  Object.keys(MAP).forEach(function (dt) {
    frappe.ui.form.on(dt, {
      refresh: function (frm) { addBulkButtons(frm, MAP[dt]); }
    });
  });
})();
