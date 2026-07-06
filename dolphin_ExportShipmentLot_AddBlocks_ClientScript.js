/* Client Script: "Export Shipment Lot - Add Blocks"  (DocType: Export Shipment Lot, Apply To: Form)
 * Full 3-method Add Blocks dialog matching AddBlocks_mockup.jpg:
 *   1) By numbers  2) By range  3) From at-port ready
 * + live Preview table (BLOCK / SIZE / CBM / NET TON / SOURCE DC / STATUS) + "N blocks - X MT will be added" footer.
 * Enriches the at_port_available list client-side from Quarry Block (delivery_challan, port_net_wt / gross_tonnage / tonnage_factor).
 * This lives in the site DB (not git). Source kept here in the Dolphins folder for version control.
 */
frappe.ui.form.on('Export Shipment Lot', {
  refresh: function (frm) {
    if (frm.is_new()) return;
    frm.add_custom_button('Add Blocks', function () { dolphin_add_blocks(frm); });
  }
});

function dolphin_add_blocks(frm) {
  frappe.call({
    method: 'dolphin_theme.api_arrivals.at_port_available',
    args: { lot: frm.doc.name }, freeze: true,
    callback: function (r) {
      var avail = r.message || [];
      var nos = avail.map(function (b) { return String(b.block_no); });
      if (!nos.length) { dolphin_add_blocks_dialog(frm, avail); return; }
      frappe.db.get_list('Quarry Block', {
        filters: [['block_number', 'in', nos]],
        fields: ['block_number', 'delivery_challan', 'port_net_wt', 'gross_tonnage', 'tonnage_factor'],
        limit: 0
      }).then(function (extra) {
        var em = {};
        (extra || []).forEach(function (x) { em[String(x.block_number)] = x; });
        avail.forEach(function (b) {
          var x = em[String(b.block_no)] || {};
          var f = flt(x.tonnage_factor) || 2.7;
          b.net_ton = flt(x.port_net_wt) || flt(x.gross_tonnage) || (flt(b.cbm) * f);
          b.source_dc = x.delivery_challan || '';
        });
        dolphin_add_blocks_dialog(frm, avail);
      }, function () { dolphin_add_blocks_dialog(frm, avail); });
    }
  });
}

function dolphin_add_blocks_dialog(frm, avail) {
  var esc = frappe.utils.escape_html;
  var byNo = {};
  avail.forEach(function (b) { byNo[String(b.block_no)] = b; });
  var lotNos = {};
  (frm.doc.blocks || []).forEach(function (r) { if (r.block_no) lotNos[String(r.block_no)] = 1; });

  function sizeOf(b) { return [b.length, b.width, b.height].filter(Boolean).join('×'); }
  function mt(b) { return (flt(b.net_ton) || 0).toFixed(3); }

  var d = new frappe.ui.Dialog({
    title: 'Add Blocks — ' + frm.doc.name + (frm.doc.export_consignee ? ('  ·  ' + frm.doc.export_consignee) : ''),
    size: 'extra-large',
    fields: [{ fieldtype: 'HTML', fieldname: 'body' }],
    primary_action_label: 'Add to lot',
    primary_action: function () { doSubmit(); }
  });

  // ---- markup ----
  var tabs =
    '<div class="dab-tabs">'
    + '<div class="dab-tab active" data-tab="1"><span class="dab-badge b-on">1</span> By numbers</div>'
    + '<div class="dab-tab" data-tab="2"><span class="dab-badge">2</span> By range</div>'
    + '<div class="dab-tab" data-tab="3"><span class="dab-badge">3</span> From at-port ready</div>'
    + '</div>';

  var sec1 =
    '<div class="dab-card"><div class="dab-h">1 · BY NUMBERS</div>'
    + '<textarea class="dab-nums form-control" rows="2" placeholder="1143, 1144 96871 96872 1150"></textarea>'
    + '<div class="dab-hint">Paste block numbers separated by spaces or commas. Unknown or unavailable numbers are skipped and listed below.</div></div>';

  var sec2 =
    '<div class="dab-card"><div class="dab-h">2 · BY RANGE</div>'
    + '<div class="dab-range">From <input class="dab-from form-control" type="text"> To <input class="dab-to form-control" type="text">'
    + '<span class="dab-hint" style="margin-left:8px">— adds every at-port-ready block in the range</span></div></div>';

  var rows = avail.map(function (b) {
    var no = esc(String(b.block_no));
    return '<label class="dab-row">'
      + '<input type="checkbox" class="dab-cb" data-no="' + no + '">'
      + '<span class="dab-no">' + no + '</span>'
      + '<span class="dab-meta">' + esc(sizeOf(b)) + ' · ' + esc(String(b.cbm || '')) + ' CBM</span>'
      + '<span class="dab-mt">' + mt(b) + ' MT</span>'
      + (b.source_dc ? ('<span class="dab-chip">' + esc(String(b.source_dc)) + '</span>') : '')
      + '</label>';
  }).join('');
  var sec3 =
    '<div class="dab-card"><div class="dab-h">3 · FROM AT-PORT READY (' + avail.length + ')</div>'
    + '<input class="dab-search form-control" type="text" placeholder="Search block / DC / size…">'
    + '<div class="dab-list">' + (rows || '<div class="dab-hint">No at-port-ready blocks available.</div>') + '</div>'
    + '<div class="dab-hint">Lists only Quarry Blocks that are <b>At port</b>, have a DC, and aren\'t already in a lot.</div></div>';

  var preview =
    '<div class="dab-card dab-prevwrap"><div class="dab-h dab-prevh">Preview</div>'
    + '<table class="dab-table"><thead><tr>'
    + '<th>BLOCK</th><th>SIZE</th><th>CBM</th><th>NET TON</th><th>SOURCE DC</th><th>STATUS</th>'
    + '</tr></thead><tbody class="dab-tbody"></tbody></table></div>';

  var foot = '<div class="dab-foot"><span class="dab-total">0 blocks · 0.000 MT will be added</span></div>';

  var css =
    '<style>'
    + '.dab-wrap{font-size:13px}'
    + '.dab-tabs{display:flex;gap:10px;margin-bottom:12px}'
    + '.dab-tab{flex:1;text-align:center;padding:10px;border:1px solid #e5e7eb;border-radius:8px;cursor:pointer;color:#334155;font-weight:600}'
    + '.dab-tab.active{background:#eaf3ff;border-color:#2490ef;color:#0F2540}'
    + '.dab-badge{display:inline-flex;width:20px;height:20px;border-radius:50%;background:#D4A24A;color:#fff;align-items:center;justify-content:center;font-size:12px;margin-right:4px}'
    + '.dab-badge.b-on{background:#2490ef}'
    + '.dab-card{border:1px solid #e5e7eb;border-radius:10px;padding:12px 14px;margin-bottom:12px}'
    + '.dab-h{color:#0F2540;font-weight:700;font-size:12px;letter-spacing:.03em;margin-bottom:8px}'
    + '.dab-hint{color:#8a929c;font-size:11.5px;margin-top:6px}'
    + '.dab-range{display:flex;align-items:center;gap:8px}'
    + '.dab-range input{width:120px}'
    + '.dab-list{max-height:230px;overflow:auto;margin-top:6px}'
    + '.dab-row{display:flex;align-items:center;gap:9px;padding:7px 9px;border:1px solid #eef0f2;border-radius:8px;margin-top:6px;cursor:pointer;margin-bottom:0}'
    + '.dab-row:hover{background:#f8fafc}'
    + '.dab-no{font-weight:700;min-width:64px}'
    + '.dab-meta{color:#6b7280;font-size:12px;flex:1}'
    + '.dab-mt{color:#178a3a;font-weight:700;margin-right:6px}'
    + '.dab-chip{border:1px solid #cfe0f5;background:#f2f8ff;color:#2166a8;border-radius:20px;padding:1px 10px;font-size:11.5px;font-weight:600}'
    + '.dab-table{width:100%;border-collapse:collapse;margin-top:4px}'
    + '.dab-table th{text-align:left;color:#8a929c;font-size:11px;font-weight:600;padding:6px 8px;border-bottom:1px solid #eef0f2}'
    + '.dab-table td{padding:7px 8px;border-bottom:1px solid #f3f4f6;font-size:12.5px}'
    + '.dab-ok{color:#178a3a;font-weight:700}.dab-bad{color:#c0392b;font-weight:700}'
    + '.dab-prevh{background:#f6f8fb;margin:-12px -14px 8px;padding:9px 14px;border-radius:10px 10px 0 0}'
    + '.dab-foot{display:flex;justify-content:flex-start;align-items:center;padding-top:2px}'
    + '.dab-total{color:#178a3a;font-weight:700}'
    + '</style>';

  d.fields_dict.body.$wrapper.html(
    css + '<div class="dab-wrap">' + tabs + sec1 + sec2 + sec3 + preview + foot + '</div>'
  );

  var $w = d.fields_dict.body.$wrapper;

  // tab click = highlight + scroll to the matching card
  $w.find('.dab-tab').on('click', function () {
    $w.find('.dab-tab').removeClass('active');
    $w.find('.dab-badge').removeClass('b-on');
    $(this).addClass('active').find('.dab-badge').addClass('b-on');
    var i = parseInt($(this).data('tab'), 10);
    var card = $w.find('.dab-card').eq(i - 1)[0];
    if (card) card.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  });

  // search filter on section 3
  $w.find('.dab-search').on('input', function () {
    var q = ($(this).val() || '').toLowerCase();
    $w.find('.dab-row').each(function () {
      var t = ($(this).text() || '').toLowerCase();
      this.style.display = (!q || t.indexOf(q) > -1) ? '' : 'none';
    });
  });

  function selection() {
    // returns {ready:[block objs], skipped:[{no,reason}]}
    var chosen = {};    // block_no -> block obj (ready)
    var skipped = {};   // block_no -> reason

    $w.find('.dab-cb:checked').each(function () {
      var no = String($(this).data('no'));
      if (byNo[no]) chosen[no] = byNo[no];
    });

    var nums = ($w.find('.dab-nums').val() || '').split(/[\s,]+/).filter(Boolean);
    nums.forEach(function (raw) {
      var no = String(raw);
      if (byNo[no]) chosen[no] = byNo[no];
      else if (lotNos[no]) skipped[no] = 'already in this lot';
      else skipped[no] = 'not found / not at-port ready';
    });

    var f = parseInt($w.find('.dab-from').val(), 10);
    var t = parseInt($w.find('.dab-to').val(), 10);
    if (!isNaN(f) && !isNaN(t)) {
      var lo = Math.min(f, t), hi = Math.max(f, t);
      avail.forEach(function (b) {
        var n = parseInt(b.block_no, 10);
        if (!isNaN(n) && n >= lo && n <= hi) chosen[String(b.block_no)] = b;
      });
    }

    var ready = Object.keys(chosen).map(function (k) { return chosen[k]; });
    var skips = Object.keys(skipped).filter(function (k) { return !chosen[k]; })
      .map(function (k) { return { no: k, reason: skipped[k] }; });
    return { ready: ready, skipped: skips };
  }

  function recompute() {
    var sel = selection();
    var tb = $w.find('.dab-tbody').empty();
    var totMt = 0;
    sel.ready.forEach(function (b) {
      totMt += flt(b.net_ton) || 0;
      tb.append(
        '<tr><td><b>' + esc(String(b.block_no)) + '</b></td>'
        + '<td>' + esc(sizeOf(b)) + '</td>'
        + '<td>' + esc(String(b.cbm || '')) + '</td>'
        + '<td>' + mt(b) + '</td>'
        + '<td>' + esc(String(b.source_dc || '—')) + '</td>'
        + '<td class="dab-ok">✓ ready</td></tr>'
      );
    });
    sel.skipped.forEach(function (s) {
      tb.append(
        '<tr><td><b>' + esc(String(s.no)) + '</b></td><td>—</td><td>—</td><td>—</td><td>—</td>'
        + '<td class="dab-bad">✗ ' + esc(s.reason) + '</td></tr>'
      );
    });
    if (!sel.ready.length && !sel.skipped.length) {
      tb.append('<tr><td colspan="6" class="dab-hint">Type numbers, set a range, or tick blocks above to preview.</td></tr>');
    }
    $w.find('.dab-total').text(sel.ready.length + ' block(s) · ' + totMt.toFixed(3) + ' MT will be added');
    try { d.get_primary_btn().text(sel.ready.length ? ('Add ' + sel.ready.length + ' block(s) to lot') : 'Add to lot'); } catch (e) {}
    d.__ready = sel.ready;
  }

  $w.on('input change', '.dab-nums,.dab-from,.dab-to,.dab-cb', recompute);
  recompute();

  function doSubmit() {
    var ready = d.__ready || [];
    if (!ready.length) { frappe.msgprint('No matching at-port blocks selected.'); return; }
    var payload = ready.map(function (b) {
      return {
        block_no: b.block_no, length: b.length, width: b.width, height: b.height,
        cbm: b.cbm, grade: b.grade, net_tonnage: b.net_ton, source_dc: b.source_dc
      };
    });
    frappe.call({
      method: 'dolphin_theme.api_arrivals.add_blocks_to_lot',
      args: { lot: frm.doc.name, rows: payload }, freeze: true,
      callback: function (r) {
        var n = (r.message && r.message.added) || ready.length;
        frappe.show_alert({ message: n + ' block(s) added', indicator: 'green' });
        d.hide(); frm.reload_doc();
      }
    });
  }

  d.show();
}
