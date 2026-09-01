/* ===========================================================================
   SIZES AND GRADES — ONE PLACE, AND THE PLACE IS THE LOT.  1 Sep 2026

   [stated] "let us try out with any changes with the lot or the grades size
    measurement etc let it be on export shipment lot one place" / "so no
    contradictions".

   So the EXPORT SHIPMENT LOT owns the thresholds, the marginal figure and the
   grades. The SHIPPING DOCUMENT reads them. Putting an editable threshold on
   both would be the same rule defined twice — the fault behind every failure
   this week — so the document has no threshold of its own until a person
   deliberately ticks the final change.

   [stated] "I am not sure if it will be cumbersome to return to lot from
    shipping documents every now and then?" — so you never walk there. The
   document's panel opens the LOT's panel in a dialog, writes to the lot, and
   refreshes underneath you.

   THE THRESHOLD, in his words: "180*90*50 >= A size rest is C size", and
   "give an option to add couple of more user defined thresholds accordingly
   app will calculate and categorise the sizes". Tried top to bottom, first one
   met on all three sides wins. A zero is no minimum on that side, so 0 × 0 × 0
   is met by everything and is the catch-all — his own question, answered in
   the panel.

   GRADE is independent and stays that way: its own section, its own switch,
   its own list of block numbers with no size column and no way to pick blocks
   by size. [stated] "rather than selecting 100 times I will multi select the
   blocks and select Grade A etc" — so bulk IS the way to grade here.

   Nothing on either panel reaches a printout.
   =========================================================================== */

(function () {
  if (!(window.frappe && frappe.ui && frappe.ui.form)) return;

  var CSS_ID = 'dolphin-sizing-css';
  var SEL = {};   /* ticked rows, per section, per document */

  function css() {
    if (document.getElementById(CSS_ID)) return;
    var s = document.createElement('style');
    s.id = CSS_ID;
    s.textContent = [
      '.dsz{font-size:12.5px;color:#0F2540;line-height:1.55}',
      '.dsz table{border-collapse:collapse;margin:4px 0 10px;width:100%}',
      '.dsz th{font-size:10px;letter-spacing:.04em;text-transform:uppercase;color:#8a929c;',
      '  font-weight:700;text-align:left;padding:0 12px 6px 0}',
      '.dsz td{padding:5px 12px 5px 0;border-top:1px solid #f0f3f6;font-variant-numeric:tabular-nums}',
      '.dsz .in{width:58px;padding:4px 6px;border:1px solid #c9d2dc;border-radius:6px;',
      '  text-align:center;font-variant-numeric:tabular-nums;font-size:12.5px;font-weight:600}',
      '.dsz .in.nm{width:66px;text-align:left;font-weight:700}',
      '.dsz .in[readonly]{background:#f4f6f8;color:#5f6b7a;border-style:dashed;font-weight:400}',
      '.dsz select{padding:3px 7px;border:1px solid #c9d2dc;border-radius:6px;font-size:12.5px;min-width:70px}',
      '.dsz .bar{display:flex;flex-wrap:wrap;align-items:center;gap:8px;background:#f7f9fb;',
      '  border:1px solid #e3e8ee;border-radius:8px;padding:8px 11px;margin:8px 0}',
      '.dsz .note{background:#fdf6e3;border-left:3px solid #d9a441;padding:9px 11px;border-radius:0 6px 6px 0;margin:8px 0}',
      '.dsz .quiet{background:#f4f6f8;border-left:3px solid #cfd4dc;padding:9px 11px;border-radius:0 6px 6px 0;margin:8px 0;color:#5f6b7a}',
      '.dsz .ok{background:#e9f3ef;border-left:3px solid #0f6e56;padding:9px 11px;border-radius:0 6px 6px 0;margin:8px 0}',
      '.dsz .b{display:inline-block;font-size:12px;padding:5px 11px;border-radius:7px;border:1px solid #0f6e56;',
      '  color:#0f6e56;background:#fff;cursor:pointer;margin:2px 5px 2px 0}',
      '.dsz .b.pri{background:#0f6e56;color:#fff}',
      '.dsz .b.gold{background:#b5892f;color:#fff;border-color:#b5892f}',
      '.dsz .b.off{border-color:#c9d2dc;color:#5f6b7a}',
      '.dsz .sm{font-size:11.5px;color:#8a929c}',
      '.dsz .mg{color:#b5892f}',
      '.dsz .scr{overflow:auto;max-height:330px}',
      '.dsz .rm{color:#a3352b;cursor:pointer;font-size:11.5px}'
    ].join('\n');
    document.head.appendChild(s);
  }

  function esc(v) {
    return String(v == null ? '' : v).replace(/[&<>"]/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c];
    });
  }
  function call(m, a) {
    return frappe.call({ method: 'dolphin_theme.sizing.' + m, args: a || {} })
      .then(function (r) { return r && r.message; });
  }
  function key(frm, which) { return frm.doc.doctype + '|' + frm.doc.name + '|' + which; }
  function ticked(frm, which) { return SEL[key(frm, which)] || (SEL[key(frm, which)] = {}); }
  function tickedRows(frm, which) {
    var t = ticked(frm, which);
    return Object.keys(t).filter(function (k) { return t[k]; });
  }

  /* ================================================================ SIZES */
  function sizesHtml(d) {
    var h = ['<div class="dsz">'];
    var edit = d.owner.editable && !d.frozen;

    if (!d.is_lot) {
      if (d.override) {
        h.push('<div class="note"><b>Final change is on.</b> This document carries its own ' +
               'copy of the thresholds and no longer follows ' + esc(d.lot || 'its lot') +
               '. Untick to go back to the lot and drop the copy.' +
               '<div style="margin-top:7px"><span class="b off" data-dsz="unoverride">' +
               'Follow the lot again</span></div></div>');
      } else if (d.lot) {
        h.push('<div class="ok"><b>Reading ' + esc(d.lot) + '.</b> The lot decides the thresholds ' +
               'and this document stays in step with it. ' +
               '<div style="margin-top:7px"><span class="b gold" data-dsz="editlot">' +
               'Edit on the lot&hellip;</span>' +
               '<span class="b off" data-dsz="override">Final change on this document&hellip;</span></div></div>');
      } else {
        h.push('<div class="quiet">This document has no lot behind it, so the standard set applies.' +
               '<div style="margin-top:7px"><span class="b off" data-dsz="override">' +
               'Final change on this document&hellip;</span></div></div>');
      }
    }

    h.push(bandsTable(d, edit && d.is_lot === false ? true : edit));

    if (edit) {
      h.push('<div class="bar"><b>Marginal</b> <input class="in" data-dsz="tol" value="' +
             (d.tolerance_cm || 3) + '" style="width:44px"> cm' +
             '<span class="sm">— a block that misses a higher threshold by this much or less is ' +
             'marked below. It moves nothing on its own.</span></div>');
      h.push('<div><span class="b gold" data-dsz="addband">+ Add a threshold</span>' +
             '<span class="b pri" data-dsz="savebands">Save &amp; re-sort&hellip;</span>' +
             '<span class="b off" data-dsz="resetbands">Reset to the standard</span></div>');
    } else {
      h.push('<div class="sm">Marginal threshold ' + (d.tolerance_cm || 3) + ' cm.</div>');
    }

    if (d.unsized && d.unsized.length) {
      h.push('<div class="note"><b>' + d.unsized.length + ' block' +
             (d.unsized.length === 1 ? '' : 's') + ' meet no threshold</b> and are left without a ' +
             'size rather than dropped into the bottom band: ' +
             esc(d.unsized.slice(0, 20).join(', ')) +
             (d.unsized.length > 20 ? ' …' : '') + '</div>');
    }

    h.push(blockTable(d, edit));
    h.push('<div class="sm" style="margin-top:6px">Re-sorting touches size only — ' +
           '<b>no block’s grade moves, ever</b>. Nothing here reaches the invoice or the ' +
           'packing list.</div>');
    h.push('</div>');
    return h.join('');
  }

  function bandsTable(d, edit) {
    var h = ['<div class="scr"><table><tr><th style="width:30px"></th><th>Size</th><th>Min L</th>' +
             '<th>Min W</th><th>Min H</th><th>Blocks</th><th></th></tr>'];
    var ord = ['1st', '2nd', '3rd', '4th', '5th', '6th', '7th', '8th'];
    (d.bands || []).forEach(function (b, i) {
      var zero = !b.min_length && !b.min_width && !b.min_height;
      function box(f, v, cls) {
        return '<input class="in ' + (cls || '') + '" data-band="' + i + '" data-f="' + f +
               '" value="' + esc(v) + '"' + (edit ? '' : ' readonly') + '>';
      }
      h.push('<tr><td class="sm">' + (ord[i] || (i + 1)) + '</td>' +
             '<td>' + box('size', b.size, 'nm') + '</td>' +
             '<td>' + box('min_length', b.min_length) + '</td>' +
             '<td>' + box('min_width', b.min_width) + '</td>' +
             '<td>' + box('min_height', b.min_height) + '</td>' +
             '<td>' + b.blocks + (zero ? ' <span class="sm">· the rest</span>' : '') + '</td>' +
             '<td>' + (edit ? '<span class="rm" data-rm="' + i + '">&times; remove</span>' : '') +
             '</td></tr>');
    });
    h.push('</table></div>');
    h.push('<div class="sm">Tried top to bottom; the first one a block meets on all three sides ' +
           'wins. <b>A zero is no minimum on that side</b>, so a row of 0 × 0 × 0 is met by ' +
           'everything and becomes the catch-all.</div>');
    return h.join('');
  }

  function blockTable(d, edit) {
    var h = [];
    if (edit) {
      h.push('<div class="bar"><span data-dsz="szpick"></span>' +
             '<span class="b off" data-pick="size:all">All</span>' +
             '<span class="b off" data-pick="size:none">None</span>' +
             '<span class="b off" data-pick="size:marginal">Marginal (' + (d.marginal_count || 0) + ')</span>' +
             '<span style="margin-left:6px">Set size to</span> ' +
             '<select data-dsz="szval">' +
             (d.bands || []).map(function (b) {
               return '<option value="' + esc(b.size) + '">' + esc(b.size) + '</option>';
             }).join('') + '</select>' +
             '<span class="b pri" data-dsz="applysize">Apply to ticked&hellip;</span></div>');
    }
    h.push('<div class="scr"><table><tr>' + (edit ? '<th style="width:24px"></th>' : '') +
           '<th>Block</th><th>L × W × H</th><th>Size</th><th>Marginal</th></tr>');
    (d.blocks || []).forEach(function (b) {
      h.push('<tr>' +
             (edit ? '<td><input type="checkbox" class="szck" data-row="' + esc(b.row) + '"' +
                     (b.marginal ? ' data-marginal="1"' : '') + '></td>' : '') +
             '<td><b>' + esc(b.block) + '</b></td>' +
             '<td>' + b.size.join(' &times; ') + '</td>' +
             '<td>' + esc(b.category || '—') + '</td>' +
             '<td class="sm' + (b.marginal ? ' mg' : '') + '">' +
             (b.marginal ? 'misses ' + esc(b.marginal.could_be) + ' by ' + esc(b.marginal.short_by) : '—') +
             '</td></tr>');
    });
    h.push('</table></div>');
    return h.join('');
  }

  /* ================================================================ GRADE */
  function gradeHtml(d) {
    var g = d.grade || {};
    var where = d.is_lot ? 'this lot' : (d.override ? 'this document' : esc(d.lot || 'the lot'));
    var edit = !d.frozen && (d.is_lot || d.override);
    var h = ['<div class="dsz">'];

    h.push('<div class="bar"><input type="checkbox" id="dsz-grade-on"' +
           (g.on ? ' checked' : '') + (edit ? '' : ' disabled') + '>' +
           '<label for="dsz-grade-on" style="margin:0"><b>Record grade on ' + where + '</b></label>' +
           '<span class="sm">— internal record only, never printed</span></div>');

    if (!g.on) {
      h.push('<div class="sm">Off. Nothing is asked of anyone and no grade is stored.</div></div>');
      return h.join('');
    }

    var opts = g.options || [];
    if (edit) {
      h.push('<div class="ok" style="margin-top:2px"><b>Tick blocks, choose one grade, press Apply.</b> ' +
             '40 blocks is three clicks, not 40.</div>');
      h.push('<div class="bar">' +
             '<span class="b off" data-pick="grade:all">All ' + (g.total || 0) + '</span>' +
             '<span class="b off" data-pick="grade:none">None</span>' +
             '<span class="b off" data-pick="grade:ungraded">Only ungraded (' +
             ((g.total || 0) - (g.filled || 0)) + ')</span>' +
             '<span style="margin-left:6px">Set grade to</span> ' +
             '<select data-dsz="grval"><option value="">— (clear)</option>' +
             opts.map(function (o) { return '<option value="' + esc(o) + '">' + esc(o) + '</option>'; }).join('') +
             '</select>' +
             '<span class="b pri" data-dsz="applygrade">Apply to ticked</span></div>');
    }

    h.push('<div class="scr"><table><tr>' + (edit ? '<th style="width:24px"></th>' : '') +
           '<th>Block</th><th>Grade</th></tr>');
    (g.blocks || []).forEach(function (b) {
      h.push('<tr>' +
             (edit ? '<td><input type="checkbox" class="grck" data-row="' + esc(b.row) + '"' +
                     (b.grade ? '' : ' data-ungraded="1"') + '></td>' : '') +
             '<td><b>' + esc(b.block) + '</b></td>' +
             '<td>' + esc(b.grade || '—') + '</td></tr>');
    });
    h.push('</table></div>');

    var tally = g.tally || {};
    h.push('<div class="quiet"><b>' + (g.filled || 0) + ' of ' + (g.total || 0) + ' graded.</b> ' +
           opts.map(function (o) { return o + ' ' + (tally[o] || 0); }).join(' &middot; ') +
           ' &middot; not graded ' + ((g.total || 0) - (g.filled || 0)) + '.</div>');
    h.push('<div class="sm">No size column, no size figure, and no way to pick blocks by their ' +
           'size. The thresholds have nothing to do with this list and never touch it.</div>');
    h.push('</div>');
    return h.join('');
  }

  /* =============================================================== render */
  function render(frm) {
    if (frm.is_new()) return;
    call('panel', { doctype: frm.doc.doctype, name: frm.doc.name }).then(function (d) {
      if (!d) return;
      css();
      var title = d.is_lot ? 'Sizes for this lot'
                           : (d.override ? 'Sizes — final change on this document'
                                         : 'Sizes — from ' + esc(d.lot || 'the standard'));
      var $sz = frm.dashboard.add_section(sizesHtml(d), title);
      var $gr = frm.dashboard.add_section(gradeHtml(d), 'Grade — internal only');
      wireSizes(frm, $sz, d);
      wireGrade(frm, $gr, d);
    });
  }

  function readBands($sec, d) {
    var out = (d.bands || []).map(function (b) {
      return { size_category_name: b.size, min_length: b.min_length,
               min_width: b.min_width, min_height: b.min_height };
    });
    $sec.find('input.in[data-band]').each(function () {
      var i = parseInt(this.dataset.band, 10), f = this.dataset.f;
      if (!out[i]) return;
      if (f === 'size') out[i].size_category_name = (this.value || '').trim();
      else out[i][f] = parseInt(this.value, 10) || 0;
    });
    return out.filter(function (b) { return b.size_category_name; });
  }

  function wireSizes(frm, $sec, d) {
    if (!$sec || !$sec.find) return;

    $sec.find('[data-rm]').on('click', function () {
      var i = parseInt(this.dataset.rm, 10);
      d.bands.splice(i, 1);
      $sec.html(sizesHtml(d));
      wireSizes(frm, $sec, d);
    });

    $sec.find('[data-dsz="addband"]').on('click', function () {
      d.bands.push({ size: '', min_length: 0, min_width: 0, min_height: 0, blocks: 0 });
      $sec.html(sizesHtml(d));
      wireSizes(frm, $sec, d);
    });

    $sec.find('[data-pick]').on('click', function () {
      var what = this.dataset.pick.split(':')[1];
      $sec.find('input.szck').each(function () {
        this.checked = (what === 'all') ? true
                     : (what === 'none') ? false
                     : !!this.dataset.marginal;
      });
    });

    $sec.find('[data-dsz="savebands"]').on('click', function () {
      var bands = readBands($sec, d);
      var tol = parseInt(($sec.find('[data-dsz="tol"]').val() || 3), 10) || 3;
      var target = d.owner;
      call('set_bands', { doctype: target.doctype, name: target.name,
                          bands: JSON.stringify(bands), tolerance_cm: tol, dry_run: 1 })
        .then(function (plan) {
          if (!plan) return;
          var moved = plan.would_move || [];
          var body = (moved.length
              ? '<b>' + moved.length + ' block' + (moved.length === 1 ? '' : 's') +
                ' change size.</b><div class="sm" style="margin-top:5px">' +
                moved.slice(0, 15).map(function (m) {
                  return esc(m.block) + ' ' + esc(m.from) + ' &rarr; ' + esc(m.to);
                }).join(' &middot; ') +
                (moved.length > 15 ? ' &middot; +' + (moved.length - 15) + ' more' : '') + '</div>'
              : 'No block changes size on these thresholds.');
          if (plan.unsized && plan.unsized.length) {
            body += '<div class="note" style="margin-top:8px"><b>' + plan.unsized.length +
                    ' would meet no threshold at all</b> and would be left without a size: ' +
                    esc(plan.unsized.slice(0, 15).join(', ')) + '</div>';
          }
          var dlg = new frappe.ui.Dialog({
            title: 'Size thresholds · ' + target.name,
            fields: [
              { fieldtype: 'HTML', options: '<div class="dsz">' + body +
                '<div class="sm" style="margin-top:8px">Saved on ' + esc(target.name) +
                '. No grade moves.</div></div>' },
              { fieldname: 'reason', fieldtype: 'Small Text', label: 'Why', reqd: 1 }
            ],
            primary_action_label: 'Save & re-sort',
            primary_action: function (v) {
              call('set_bands', { doctype: target.doctype, name: target.name,
                                  bands: JSON.stringify(bands), tolerance_cm: tol,
                                  reason: v.reason, person: frappe.session.user, dry_run: 0 })
                .then(function (r) {
                  dlg.hide();
                  frappe.show_alert({ message: 'Thresholds saved' +
                    (r && r.count ? ' — ' + r.count + ' re-sorted' : ''), indicator: 'green' });
                  frm.reload_doc();
                });
            }
          });
          dlg.show();
        });
    });

    $sec.find('[data-dsz="resetbands"]').on('click', function () {
      var target = d.owner;
      frappe.prompt([{ fieldname: 'reason', fieldtype: 'Small Text', label: 'Why', reqd: 1 }],
        function (v) {
          call('reset_bands', { doctype: target.doctype, name: target.name,
                                reason: v.reason, person: frappe.session.user, dry_run: 0 })
            .then(function () { frm.reload_doc(); });
        }, 'Reset to the standard', 'Reset');
    });

    $sec.find('[data-dsz="applysize"]').on('click', function () {
      var rows = [];
      $sec.find('input.szck:checked').each(function () { rows.push(this.dataset.row); });
      if (!rows.length) { frappe.show_alert({ message: 'Tick some blocks first', indicator: 'orange' }); return; }
      var to = $sec.find('[data-dsz="szval"]').val();
      call('set_sizes', { doctype: d.doctype, name: d.name, rows: JSON.stringify(rows),
                          to_size: to, dry_run: 1 })
        .then(function (plan) {
          if (!plan) return;
          var dlg = new frappe.ui.Dialog({
            title: rows.length + ' block(s) → size ' + to,
            fields: [
              { fieldtype: 'HTML', options: '<div class="dsz"><b>' + plan.count +
                ' change, ' + plan.already + ' already ' + esc(to) + '.</b>' +
                '<div class="sm" style="margin-top:5px">' +
                (plan.changed || []).slice(0, 15).map(function (c) {
                  return esc(c.block) + ' ' + esc(c.from) + ' &rarr; ' + esc(c.to);
                }).join(' &middot; ') + '</div>' +
                '<div class="sm" style="margin-top:8px">The thresholds did not put these blocks ' +
                'here. Moving them is a record that the buyer agreed, so it needs a name.</div></div>' },
              { fieldname: 'agreed_by', fieldtype: 'Data', label: 'Who at the buyer agreed', reqd: 1 },
              { fieldname: 'reason', fieldtype: 'Small Text', label: 'Note', reqd: 1 }
            ],
            primary_action_label: 'Apply',
            primary_action: function (v) {
              call('set_sizes', { doctype: d.doctype, name: d.name, rows: JSON.stringify(rows),
                                  to_size: to, agreed_by: v.agreed_by, reason: v.reason,
                                  person: frappe.session.user, dry_run: 0 })
                .then(function (r) {
                  dlg.hide();
                  frappe.show_alert({ message: (r && r.count) + ' block(s) set to ' + to, indicator: 'green' });
                  frm.reload_doc();
                });
            }
          });
          dlg.show();
        });
    });

    $sec.find('[data-dsz="editlot"]').on('click', function () {
      openLotDialog(frm, d.lot);
    });

    $sec.find('[data-dsz="override"]').on('click', function () {
      frappe.prompt([{ fieldname: 'reason', fieldtype: 'Small Text', label:
        'Why this document needs its own copy', reqd: 1 }],
        function (v) {
          call('set_override', { shipping_document: frm.doc.name, on: 1,
                                 reason: v.reason, person: frappe.session.user })
            .then(function () { frm.reload_doc(); });
        }, 'Final change on this document', 'Turn it on');
    });

    $sec.find('[data-dsz="unoverride"]').on('click', function () {
      call('set_override', { shipping_document: frm.doc.name, on: 0,
                             person: frappe.session.user })
        .then(function () { frm.reload_doc(); });
    });
  }

  /* The lot's own panel, opened from the shipping document. You never walk
     to the lot; the lot comes to you, and the writing still happens there. */
  function openLotDialog(frm, lotName) {
    if (!lotName) return;
    call('panel', { doctype: 'Export Shipment Lot', name: lotName }).then(function (ld) {
      if (!ld) return;
      var dlg = new frappe.ui.Dialog({
        title: 'Sizes on ' + lotName,
        size: 'large',
        fields: [{ fieldname: 'body', fieldtype: 'HTML' }]
      });
      dlg.show();
      var $w = dlg.fields_dict.body.$wrapper;
      $w.html(sizesHtml(ld));
      wireSizes({
        doc: { doctype: 'Export Shipment Lot', name: lotName },
        is_new: function () { return false; },
        reload_doc: function () { dlg.hide(); frm.reload_doc(); },
        dashboard: frm.dashboard
      }, $w, ld);
    });
  }

  function wireGrade(frm, $sec, d) {
    if (!$sec || !$sec.find) return;
    var target = (d.is_lot || d.override)
      ? { doctype: d.doctype, name: d.name }
      : { doctype: 'Export Shipment Lot', name: d.lot };

    $sec.find('#dsz-grade-on').on('change', function () {
      call('set_grade_recording', { doctype: target.doctype, name: target.name,
                                    on: this.checked ? 1 : 0, person: frappe.session.user })
        .then(function () { frm.reload_doc(); });
    });

    $sec.find('[data-pick]').on('click', function () {
      var what = this.dataset.pick.split(':')[1];
      $sec.find('input.grck').each(function () {
        this.checked = (what === 'all') ? true
                     : (what === 'none') ? false
                     : !!this.dataset.ungraded;
      });
    });

    $sec.find('[data-dsz="applygrade"]').on('click', function () {
      var rows = [];
      $sec.find('input.grck:checked').each(function () { rows.push(this.dataset.row); });
      if (!rows.length) { frappe.show_alert({ message: 'Tick some blocks first', indicator: 'orange' }); return; }
      var g = $sec.find('[data-dsz="grval"]').val();
      call('set_grades', { doctype: target.doctype, name: target.name,
                           rows: JSON.stringify(rows), grade: g, dry_run: 1 })
        .then(function (plan) {
          if (!plan) return;
          frappe.confirm(
            '<div style="font-size:13px;line-height:1.55"><b>' + plan.count +
            ' block(s) change, ' + plan.already + ' already ' + (g || 'blank') + '.</b>' +
            '<div style="font-size:11.5px;color:#8a929c;margin-top:5px">' +
            (plan.changed || []).slice(0, 15).map(function (c) {
              return esc(c.block) + ' ' + esc(c.from) + ' &rarr; ' + esc(c.to);
            }).join(' &middot; ') +
            ((plan.changed || []).length > 15 ? ' &middot; +' + (plan.changed.length - 15) + ' more' : '') +
            '</div><div style="font-size:11.5px;color:#8a929c;margin-top:8px">Internal only — ' +
            'not printed.</div></div>',
            function () {
              call('set_grades', { doctype: target.doctype, name: target.name,
                                   rows: JSON.stringify(rows), grade: g,
                                   person: frappe.session.user, dry_run: 0 })
                .then(function (r) {
                  frappe.show_alert({ message: (r && r.count) + ' block(s) graded ' +
                    (g || 'cleared'), indicator: 'green' });
                  frm.reload_doc();
                });
            });
        });
    });
  }

  ['Export Shipment Lot', 'Shipping Document'].forEach(function (dt) {
    frappe.ui.form.on(dt, {
      refresh: function (frm) {
        try { render(frm); } catch (e) { /* a panel must never block the form */ }
      }
    });
  });
})();
