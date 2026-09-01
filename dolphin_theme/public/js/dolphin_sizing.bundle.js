/* ===========================================================================
   SIZES AND GRADE, ON THE SHIPPING DOCUMENT.  1 Sep 2026

   Two sections that share nothing. That is the whole design, and it is his.

   SIZES — [stated] "can you restrict the defined sizes only for shipping
   documents? or dont link sizes to any consignee in the invoices at all let it
   be standard one set editable for every shipment? everything wil be on record
   everything in shipping documents". So no buyer owns a size. Every shipment
   carries its own bands, pre-filled at creation from the last shipment to the
   same consignee (his option B, "2nd option looks good"), then edited here.
   Editing one shipment changes that shipment and nothing else.

   GRADE — [stated] "no grade is independednt of size so grade is independednt".
   My first draft put grade as a column beside size in the same table, which
   reads as though one follows from the other. It does not. Grade is its own
   section, its own switch, its own list: block number and grade, no size
   column, no size figure, no ordering by size. Re-sorting the bands never
   touches a grade; setting a grade never touches a size; no pairing is ever
   flagged as odd. Off by default, and [stated] "for internal purpose only it
   shouldnt be reflecting on shipping documents" — it reaches no print format.

   Every write is dry-run first, shows what it would move, and demands a reason.
   =========================================================================== */

(function () {
  if (!(window.frappe && frappe.ui && frappe.ui.form)) return;

  var DT = 'Shipping Document';
  var CSS_ID = 'dolphin-sizing-css';

  function css() {
    if (document.getElementById(CSS_ID)) return;
    var s = document.createElement('style');
    s.id = CSS_ID;
    s.textContent = [
      '.dsz{font-size:12.5px;color:#0F2540;line-height:1.55}',
      '.dsz table{border-collapse:collapse;margin:4px 0 10px}',
      '.dsz th,.dsz td{padding:5px 14px 5px 0;text-align:left;font-variant-numeric:tabular-nums}',
      '.dsz th{font-size:10.5px;letter-spacing:.04em;text-transform:uppercase;color:#8a929c;font-weight:600}',
      '.dsz td{border-top:1px solid #f0f3f6}',
      '.dsz .in{width:62px;padding:4px 7px;border:1px solid #c9d2dc;border-radius:6px;',
      '  text-align:right;font-variant-numeric:tabular-nums;font-size:12.5px}',
      '.dsz .in.ch{border-color:#b5892f;background:#fdf6e3;font-weight:600}',
      '.dsz select.gr{padding:4px 7px;border:1px solid #c9d2dc;border-radius:6px;font-size:12.5px;min-width:74px}',
      '.dsz .note{background:#fdf6e3;border-left:3px solid #d9a441;padding:9px 11px;border-radius:0 6px 6px 0;margin:8px 0}',
      '.dsz .quiet{background:#f4f6f8;border-left:3px solid #cfd4dc;padding:9px 11px;border-radius:0 6px 6px 0;margin:8px 0;color:#5f6b7a}',
      '.dsz .b{display:inline-block;font-size:12px;padding:5px 11px;border-radius:7px;border:1px solid #0f6e56;',
      '  color:#0f6e56;background:#fff;cursor:pointer;margin:2px 6px 2px 0}',
      '.dsz .b.pri{background:#0f6e56;color:#fff}',
      '.dsz .b.off{border-color:#c9d2dc;color:#5f6b7a}',
      '.dsz .sm{font-size:11.5px;color:#8a929c}',
      '.dsz .hd{font-weight:700;font-size:13px;margin-bottom:6px}',
      '.dsz .sw{display:flex;align-items:center;gap:8px;margin-bottom:6px}',
      '.dsz .scr{overflow-x:auto;max-height:340px}'
    ].join('\n');
    document.head.appendChild(s);
  }

  function esc(v) {
    return String(v == null ? '' : v).replace(/[&<>"]/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c];
    });
  }

  function call(method, args) {
    return frappe.call({ method: 'dolphin_theme.sizing.' + method, args: args || {} })
      .then(function (r) { return r && r.message; });
  }

  function sameAsStandard(b) {
    var s = b.standard;
    if (!s) return false;
    return b.min_length === s[0] && b.min_width === s[1] && b.min_height === s[2];
  }

  /* ---------------------------------------------------------------- SIZES */
  function sizesHtml(d) {
    var h = ['<div class="dsz">'];

    if (d.seeded_from) {
      h.push('<div class="quiet"><b>Pre-filled from ' + esc(d.seeded_from) + '</b>' +
             (d.seeded_from === 'the standard set' ? '' : ', the last shipment to this consignee') +
             '. Overwrite anything. No rule is stored against the buyer &mdash; this read ' +
             'that one document, once.</div>');
    }

    h.push('<div class="scr"><table><tr><th>Size</th><th>Min L</th><th>Min W</th>' +
           '<th>Min H</th><th>Standard</th><th>Blocks here</th></tr>');
    (d.bands || []).forEach(function (b) {
      var ch = sameAsStandard(b) ? '' : ' ch';
      function box(f, v) {
        return '<input class="in' + ch + '" data-band="' + esc(b.size) + '" data-f="' + f +
               '" value="' + (v == null ? 0 : v) + '">';
      }
      h.push('<tr><td><b>' + esc(b.size) + '</b></td>' +
             '<td>' + box('min_length', b.min_length) + '</td>' +
             '<td>' + box('min_width', b.min_width) + '</td>' +
             '<td>' + box('min_height', b.min_height) + '</td>' +
             '<td class="sm">' + (b.standard ? b.standard.join(' &times; ') : '&mdash;') + '</td>' +
             '<td>' + b.blocks + '</td></tr>');
    });
    h.push('</table></div>');

    if (!d.submitted) {
      h.push('<div><span class="b pri" data-dsz="save">Save these sizes &amp; re-sort&hellip;</span>' +
             '<span class="b off" data-dsz="reset">Reset to the standard</span></div>');
    } else {
      h.push('<div class="sm">This document is submitted; its bands are fixed.</div>');
    }
    h.push('<div class="sm" style="margin-top:6px">Set on this document only. The standard set ' +
           'is untouched and no other shipment changes. Re-sorting touches size only &mdash; ' +
           '<b>no block&rsquo;s grade moves, ever</b>.</div>');
    h.push('</div>');
    return h.join('');
  }

  /* ---------------------------------------------------------------- GRADE */
  function gradeHtml(d) {
    var g = d.grade || {};
    var h = ['<div class="dsz">'];
    h.push('<div class="sw"><input type="checkbox" id="dsz-grade-on"' +
           (g.on ? ' checked' : '') + (d.submitted ? ' disabled' : '') + '>' +
           '<label for="dsz-grade-on" style="margin:0"><b>Record grade on this shipment</b></label>' +
           '<span class="sm">&mdash; internal record only, never printed</span></div>');

    if (!g.on) {
      h.push('<div class="sm">Off. Nothing is asked of anyone and no grade is stored. ' +
             'Switching it on shows a list of block numbers and a grade box beside each.</div>');
      h.push('</div>');
      return h.join('');
    }

    var opts = (g.options || []).map(function (o) { return esc(o); });
    h.push('<div class="sm" style="margin:6px 0 2px">Five choices, blank allowed: ' +
           opts.join(' &middot; ') + '</div>');

    h.push('<div class="scr"><table><tr><th>Block</th><th>Grade</th></tr>');
    (g.blocks || []).forEach(function (b) {
      var sel = ['<select class="gr" data-row="' + esc(b.row) + '" data-block="' + esc(b.block) + '"' +
                 (d.submitted ? ' disabled' : '') + '>',
                 '<option value=""' + (b.grade ? '' : ' selected') + '>&mdash;</option>'];
      opts.forEach(function (o) {
        sel.push('<option value="' + o + '"' + (b.grade === o ? ' selected' : '') + '>' + o + '</option>');
      });
      sel.push('</select>');
      h.push('<tr><td><b>' + esc(b.block) + '</b></td><td>' + sel.join('') + '</td></tr>');
    });
    h.push('</table></div>');

    var tally = g.tally || {};
    var line = opts.map(function (o) { return o + ' ' + (tally[o] || 0); }).join(' &middot; ');
    h.push('<div class="quiet"><b>' + (g.filled || 0) + ' of ' + (g.total || 0) + ' graded.</b> ' +
           line + ' &middot; not graded ' + ((g.total || 0) - (g.filled || 0)) +
           '. Blank is a normal state and stays blank.</div>');
    h.push('<div class="sm">No size column, no size figure, no ordering by size. This list knows ' +
           'block numbers and grades and nothing else. Nothing here reaches the invoice or the ' +
           'packing list.</div>');
    h.push('</div>');
    return h.join('');
  }

  /* --------------------------------------------------------------- render */
  function render(frm) {
    if (frm.is_new()) return;
    call('document_sizes', { shipping_document: frm.doc.name }).then(function (d) {
      if (!d) return;
      css();
      var $sz = frm.dashboard.add_section(sizesHtml(d), 'Sizes for this shipment');
      var $gr = frm.dashboard.add_section(gradeHtml(d), 'Grade &mdash; internal only');
      wireSizes(frm, $sz, d);
      wireGrade(frm, $gr, d);
    });
  }

  function readBands($sec, d) {
    var out = {};
    (d.bands || []).forEach(function (b) {
      out[b.size] = { size_category_name: b.size, min_length: b.min_length,
                      min_width: b.min_width, min_height: b.min_height };
    });
    $sec.find('input.in').each(function () {
      var k = this.dataset.band, f = this.dataset.f;
      if (out[k]) out[k][f] = parseInt(this.value, 10) || 0;
    });
    return Object.keys(out).map(function (k) { return out[k]; });
  }

  function wireSizes(frm, $sec, d) {
    if (!$sec || !$sec.find) return;

    $sec.find('[data-dsz="save"]').on('click', function () {
      var bands = readBands($sec, d);
      call('set_document_bands', { shipping_document: frm.doc.name,
                                   bands: JSON.stringify(bands), dry_run: 1 })
        .then(function (plan) {
          if (!plan) return;
          var moved = plan.would_move || [];
          var what = moved.length
            ? '<b>' + moved.length + ' block' + (moved.length === 1 ? '' : 's') +
              ' change size.</b><div class="sm" style="margin-top:5px">' +
              moved.slice(0, 12).map(function (m) {
                return esc(m.block) + ' ' + esc(m.from) + ' &rarr; ' + esc(m.to);
              }).join(' &middot; ') +
              (moved.length > 12 ? ' &middot; +' + (moved.length - 12) + ' more' : '') + '</div>'
            : 'No block changes size on these bands.';
          var d2 = new frappe.ui.Dialog({
            title: 'Sizes for this shipment',
            fields: [
              { fieldtype: 'HTML', options:
                '<div class="dsz" style="line-height:1.55">' + what +
                '<div class="sm" style="margin-top:8px">Applies to ' + esc(frm.doc.name) +
                ' alone. The standard set is untouched, no other shipment changes, ' +
                'and no grade moves.</div></div>' },
              { fieldname: 'reason', fieldtype: 'Small Text', label: 'Why', reqd: 1,
                description: 'Written onto this document.' }
            ],
            primary_action_label: 'Save & re-sort',
            primary_action: function (v) {
              call('set_document_bands', {
                shipping_document: frm.doc.name, bands: JSON.stringify(bands),
                reason: v.reason, person: frappe.session.user, dry_run: 0
              }).then(function (r) {
                d2.hide();
                frappe.show_alert({ message: 'Sizes saved' +
                  (r && r.count ? ' — ' + r.count + ' block(s) re-sorted' : ''),
                  indicator: 'green' });
                frm.reload_doc();
              });
            }
          });
          d2.show();
        });
    });

    $sec.find('[data-dsz="reset"]').on('click', function () {
      frappe.prompt(
        [{ fieldname: 'reason', fieldtype: 'Small Text', label: 'Why', reqd: 1 }],
        function (v) {
          call('reset_document_bands', { shipping_document: frm.doc.name,
                                         reason: v.reason, person: frappe.session.user,
                                         dry_run: 0 })
            .then(function () {
              frappe.show_alert({ message: 'Back on the standard set', indicator: 'green' });
              frm.reload_doc();
            });
        }, 'Reset to the standard', 'Reset');
    });
  }

  function wireGrade(frm, $sec, d) {
    if (!$sec || !$sec.find) return;

    $sec.find('#dsz-grade-on').on('change', function () {
      var on = this.checked ? 1 : 0;
      call('set_grade_recording', { shipping_document: frm.doc.name, on: on,
                                    person: frappe.session.user })
        .then(function () {
          frappe.show_alert({ message: 'Grade recording ' + (on ? 'on' : 'off') +
                                       ' for this shipment', indicator: 'blue' });
          frm.reload_doc();
        });
    });

    $sec.find('select.gr').on('change', function () {
      var el = this;
      call('set_block_grade', { shipping_document: frm.doc.name, row: el.dataset.row,
                                grade: el.value, person: frappe.session.user })
        .then(function () {
          frappe.show_alert({ message: 'Block ' + el.dataset.block + ' grade ' +
                                       (el.value || 'cleared'), indicator: 'blue' });
        })
        .catch(function () { frm.reload_doc(); });
    });
  }

  frappe.ui.form.on(DT, {
    refresh: function (frm) {
      try { render(frm); } catch (e) { /* a panel must never block the form */ }
    }
  });
})();
