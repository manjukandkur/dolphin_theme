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

  /* =========================================================== BY RANGE
     1 Sep 2026, his words: "if more number of blocks are there give an option
     to give range also like blocks numbers from 800-1000 A 500-550 B etc".

     So you type the ranges and what each one is, and the whole thing goes in
     one action. One line per range; the value at the end of the line:

         800-1000 A
         500-550  B
         1327     C          (a single number is a range of one)
         801-820, 856  A      (a list works too)

     Everything is resolved against the block numbers actually on this document,
     shown to you before anything is written, and applied as one save per value.
     A range that matches nothing is called out rather than passed over. */

  function numOf(b) {
    var m = String(b == null ? '' : b).match(/\d+/);
    return m ? parseInt(m[0], 10) : null;
  }

  function parseRanges(text) {
    var out = [], bad = [];
    String(text || '').split(/[\n;]+/).forEach(function (line) {
      var raw = line.trim();
      if (!raw) return;
      /* the value is the last word; everything before it is the number spec */
      var m = raw.match(/^(.*?)[\s=:>-]*([A-Za-z][A-Za-z0-9]*)\s*$/);
      if (!m) { bad.push(raw); return; }
      var spec = m[1].trim().replace(/[,\s]+$/, ''), value = m[2].trim();
      if (!spec) { bad.push(raw); return; }
      var parts = spec.split(/[,\s]+/).filter(Boolean), ranges = [];
      parts.forEach(function (p) {
        var r = p.match(/^(\d+)\s*(?:-|to|–)\s*(\d+)$/i);
        if (r) { ranges.push([parseInt(r[1], 10), parseInt(r[2], 10)]); return; }
        if (/^\d+$/.test(p)) { ranges.push([parseInt(p, 10), parseInt(p, 10)]); return; }
        bad.push(p);
      });
      if (ranges.length) out.push({ raw: raw, value: value, ranges: ranges });
    });
    return { lines: out, bad: bad };
  }

  function matchRows(blocks, line) {
    var rows = [], seen = {};
    (blocks || []).forEach(function (b) {
      var n = numOf(b.block);
      if (n == null) return;
      var hit = line.ranges.some(function (r) {
        var lo = Math.min(r[0], r[1]), hi = Math.max(r[0], r[1]);
        return n >= lo && n <= hi;
      });
      if (hit && !seen[b.row]) { seen[b.row] = 1; rows.push(b.row); }
    });
    return rows;
  }

  /* One dialog, used for size and for grade. `apply` gets [{value, rows}] back. */
  function rangeDialog(opts) {
    var d = new frappe.ui.Dialog({
      title: opts.title,
      size: 'large',
      fields: [
        { fieldtype: 'HTML', options:
          '<div class="dsz sm" style="line-height:1.6">One line per range, with ' +
          'the ' + opts.what + ' at the end of the line. A single number is a range ' +
          'of one, and a comma list works too.<pre style="margin:6px 0;padding:8px 10px;' +
          'background:#f4f6f8;border-radius:6px;font-size:12px">800-1000 A\n500-550  B\n' +
          '1327     C\n801-820, 856  A</pre></div>' },
        { fieldname: 'spec', fieldtype: 'Small Text', label: 'Ranges', reqd: 1 },
        { fieldtype: 'HTML', fieldname: 'preview' }
      ],
      primary_action_label: 'Check the ranges',
      primary_action: function (v) {
        var parsed = parseRanges(v.spec);
        var html = [], groups = [], total = 0;
        if (parsed.bad.length) {
          html.push('<div class="note">Could not read: <b>' +
                    esc(parsed.bad.join(', ')) + '</b></div>');
        }
        parsed.lines.forEach(function (ln) {
          var rows = matchRows(opts.blocks, ln);
          total += rows.length;
          if (rows.length) groups.push({ value: ln.value, rows: rows });
          html.push('<div class="' + (rows.length ? 'quiet' : 'note') + '"><b>' +
                    esc(ln.raw) + '</b> &rarr; ' + rows.length + ' block' +
                    (rows.length === 1 ? '' : 's') +
                    (rows.length ? '' : ' &mdash; nothing on this document matches') + '</div>');
        });
        d.fields_dict.preview.$wrapper.html('<div class="dsz">' + html.join('') + '</div>');
        if (!total) { return; }
        d.set_primary_action('Apply to ' + total + ' block(s)', function () {
          d.hide();
          opts.apply(groups);
        });
      }
    });
    d.show();
  }

  /* 1 Sep 2026, after his question "what is who at the buyer agreed".
     Only a move UP a band is a promotion - a block being taken as better than it
     measures, which is the buyer conceding something and is the whole reason a
     name is recorded. A move DOWN, or a correction the thresholds already agree
     with, costs the buyer nothing and asks for no name. */
  function sizeFields(plan, to) {
    var moved = plan.changed || [];
    var up = moved.filter(function (c) { return c.up; });
    var f = [{ fieldtype: 'HTML', options:
      '<div class="dsz"><b>' + plan.count + ' change, ' + plan.already + ' already ' +
      esc(to) + '.</b><div class="sm" style="margin-top:5px">' +
      moved.slice(0, 15).map(function (c) {
        return esc(c.block) + ' ' + esc(c.from) + ' &rarr; ' + esc(c.to) +
               (c.up ? ' <b>&uarr;</b>' : '');
      }).join(' &middot; ') +
      (moved.length > 15 ? ' &middot; +' + (moved.length - 15) + ' more' : '') + '</div>' +
      (up.length
        ? '<div class="note" style="margin-top:8px"><b>' + up.length + ' move UP a band.</b> ' +
          'The thresholds did not put ' + (up.length === 1 ? 'that block' : 'those blocks') +
          ' there, so this records that the buyer agreed &mdash; and needs the name of who did.</div>'
        : '<div class="sm" style="margin-top:8px">Nothing moves up a band, so no buyer consent ' +
          'is involved. A reason is enough.</div>') +
      '</div>' }];
    if (up.length) {
      f.push({ fieldname: 'agreed_by', fieldtype: 'Data',
               label: 'Who at the buyer agreed', reqd: 1 });
    }
    f.push({ fieldname: 'reason', fieldtype: 'Small Text', label: 'Note', reqd: 1 });
    return f;
  }

  /* ================================================================ SIZES */
  function sizesHtml(d) {
    var h = ['<div class="dsz">'];
    var edit = d.owner.editable && !d.frozen;

    if (!d.is_lot) {
      /* 1 Sep 2026, his words: "either one should be active so give a check mark
         for both". So the choice is shown as the two things it actually is, and
         exactly one of them is ticked. They are bound to the same single value,
         so a third state cannot exist and the two can never both be off. */
      h.push(sourcePicker(d));
      if (d.override) {
        h.push('<div class="note"><b>This document has left ' + esc(d.lot || 'its lot') +
               '.</b> It is working from its own copy of the thresholds, taken when you ' +
               'ticked it. Correcting the lot no longer reaches this document.</div>');
      } else if (d.lot) {
        h.push('<div class="ok"><b>Following ' + esc(d.lot) + '.</b> The lot decides, and this ' +
               'document stays in step with it. ' +
               '<span class="b gold" data-dsz="editlot">Edit on the lot&hellip;</span></div>');
      } else {
        h.push('<div class="quiet">This document has no lot behind it, so the standard set applies.</div>');
      }
    }

    /* 1 Sep 2026, his check: "size and grade should appear on exisiting lots and
       new one to be created also". They do - a lot with no thresholds of its own
       falls back to the standard set and the panel draws normally. But every lot
       made before today has none, so it would sit on the house figures forever
       while a NEW lot gets pre-filled from the last shipment to that consignee.
       This offers an existing lot the same start, on demand, without anyone
       retyping it. */
    if (d.is_lot && edit && !d.own_bands) {
      h.push('<div class="quiet"><b>This lot has no thresholds of its own</b>, so it is being ' +
             'sorted by the standard set. A lot created from now on is pre-filled from the ' +
             'last shipment to this consignee &mdash; this one can have the same start.' +
             '<div style="margin-top:7px"><span class="b gold" data-dsz="seed">' +
             'Pre-fill from the last lot&hellip;</span></div></div>');
    } else if (d.is_lot && d.seeded_from) {
      h.push('<div class="sm">Started from ' + esc(d.seeded_from) + '.</div>');
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

  /* Two ticks, one value. Whichever you tick, the other clears - there is no way
     to have both on, and no way to have neither. */
  function sourcePicker(d) {
    var uid = (sourcePicker.n = (sourcePicker.n || 0) + 1);
    function one(on, id, label, sub) {
      id = id + '-' + uid;
      return '<label style="display:flex;align-items:flex-start;gap:7px;margin:0 18px 0 0;' +
             'cursor:pointer"><input type="checkbox" class="dsz-src" id="' + id + '" data-on="' +
             (id.indexOf('own') >= 0 ? '1' : '0') + '"' + (on ? ' checked' : '') +
             (d.frozen ? ' disabled' : '') + ' style="margin-top:2px">' +
             '<span><b>' + label + '</b><br><span class="sm">' + sub + '</span></span></label>';
    }
    return '<div class="bar" style="align-items:flex-start">' +
           one(!d.override, 'dsz-src-lot', 'Follow ' + esc(d.lot || 'the standard'),
               'The lot decides. Changes there reach this document by themselves.') +
           one(d.override, 'dsz-src-own', 'Set on this document',
               'This document takes its own copy and stops following the lot.') +
           '</div>';
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
             '<span class="b gold" data-dsz="sizerange">By range&hellip;</span>' +
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

    /* 1 Sep 2026: "either one should be active so give a check mark for both" /
       "whichever is selected will be active". The same pair appears here so you
       can switch from wherever you are - and it is bound to the SAME single
       value as the one on the sizes section, so the two can never disagree.
       One choice, shown twice; not two choices. */
    if (!d.is_lot) h.push(sourcePicker(d));

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
             '<span class="b gold" data-dsz="graderange">By range&hellip;</span>' +
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
            fields: sizeFields(plan, to),
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

    $sec.find('[data-dsz="seed"]').on('click', function () {
      var target = d.owner;
      call('seed_now', { doctype: target.doctype, name: target.name, dry_run: 1 })
        .then(function (plan) {
          if (!plan) return;
          var moved = plan.would_move || [];
          var dlg = new frappe.ui.Dialog({
            title: 'Pre-fill the thresholds',
            fields: [
              { fieldtype: 'HTML', options: '<div class="dsz">' +
                '<b>From ' + esc(plan.source) + '.</b><table style="margin-top:6px">' +
                (plan.bands || []).map(function (b) {
                  return '<tr><td style="padding-right:14px"><b>' + esc(b.size_category_name) +
                         '</b></td><td>' + b.min_length + ' &times; ' + b.min_width +
                         ' &times; ' + b.min_height + '</td></tr>';
                }).join('') + '</table>' +
                (moved.length
                  ? '<div class="note">' + moved.length + ' block(s) would change size.</div>'
                  : '<div class="sm">No block changes size on these figures.</div>') +
                '<div class="sm" style="margin-top:6px">Set on this lot only. Nothing is stored ' +
                'against the buyer &mdash; this read one previous document, once.</div></div>' },
              { fieldname: 'reason', fieldtype: 'Small Text', label: 'Why', reqd: 1,
                default: 'Pre-filled from ' + (plan.source || 'the last lot') + '.' }
            ],
            primary_action_label: 'Pre-fill & re-sort',
            primary_action: function (v) {
              call('seed_now', { doctype: target.doctype, name: target.name,
                                 reason: v.reason, person: frappe.session.user, dry_run: 0 })
                .then(function () { dlg.hide(); frm.reload_doc(); });
            }
          });
          dlg.show();
        });
    });

    $sec.find('[data-dsz="sizerange"]').on('click', function () {
      rangeDialog({
        title: 'Set sizes by block-number range',
        what: 'size', blocks: d.blocks,
        apply: function (groups) {
          /* find out first whether anything moves UP; only then ask for a name */
          var probes = groups.map(function (g) {
            return call('set_sizes', { doctype: d.doctype, name: d.name,
                                       rows: JSON.stringify(g.rows), to_size: g.value,
                                       dry_run: 1 });
          });
          Promise.all(probes).then(function (plans) {
            var ups = 0;
            plans.forEach(function (p) { ups += ((p && p.promotions) || []).length; });
            var fields = [];
            if (ups) {
              fields.push({ fieldtype: 'HTML', options:
                '<div class="dsz note"><b>' + ups + ' block(s) move UP a band.</b> That is the ' +
                'buyer taking stone as better than it measures, so it needs the name of who agreed.</div>' });
              fields.push({ fieldname: 'agreed_by', fieldtype: 'Data',
                            label: 'Who at the buyer agreed', reqd: 1 });
            } else {
              fields.push({ fieldtype: 'HTML', options:
                '<div class="dsz sm">Nothing moves up a band, so no buyer consent is involved.</div>' });
            }
            fields.push({ fieldname: 'reason', fieldtype: 'Small Text', label: 'Note', reqd: 1 });
            frappe.prompt(fields, function (v) {
            var chain = Promise.resolve(), done = 0;
            groups.forEach(function (g) {
              chain = chain.then(function () {
                return call('set_sizes', { doctype: d.doctype, name: d.name,
                                           rows: JSON.stringify(g.rows), to_size: g.value,
                                           agreed_by: v.agreed_by, reason: v.reason,
                                           person: frappe.session.user, dry_run: 0 })
                  .then(function (r) { done += (r && r.count) || 0; });
              });
            });
            chain.then(function () {
              frappe.show_alert({ message: done + ' block(s) re-sized by range', indicator: 'green' });
              frm.reload_doc();
            });
            }, 'Apply the ranges', 'Apply');
          });
        }
      });
    });

    $sec.find('[data-dsz="editlot"]').on('click', function () {
      openLotDialog(frm, d.lot);
    });

    $sec.find('input.dsz-src').on('change', function () {
      var wantOwn = this.dataset.on === '1' ? this.checked : !this.checked;
      if (wantOwn === !!d.override) { render2(frm); return; }   /* nothing to do */
      if (wantOwn) {
        frappe.prompt([{ fieldname: 'reason', fieldtype: 'Small Text',
                         label: 'Why this document needs its own copy', reqd: 1 }],
          function (v) {
            call('set_override', { shipping_document: frm.doc.name, on: 1,
                                   reason: v.reason, person: frappe.session.user })
              .then(function () { frm.reload_doc(); });
          }, 'Set on this document', 'Turn it on');
      } else {
        call('set_override', { shipping_document: frm.doc.name, on: 0,
                               person: frappe.session.user })
          .then(function () { frm.reload_doc(); });
      }
    });
  }

  function render2(frm) { try { frm.reload_doc(); } catch (e) {} }

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

    $sec.find('input.dsz-src').on('change', function () {
      var wantOwn = this.dataset.on === '1' ? this.checked : !this.checked;
      if (wantOwn === !!d.override) { frm.reload_doc(); return; }
      if (wantOwn) {
        frappe.prompt([{ fieldname: 'reason', fieldtype: 'Small Text',
                         label: 'Why this document needs its own copy', reqd: 1 }],
          function (v) {
            call('set_override', { shipping_document: frm.doc.name, on: 1,
                                   reason: v.reason, person: frappe.session.user })
              .then(function () { frm.reload_doc(); });
          }, 'Set on this document', 'Turn it on');
      } else {
        call('set_override', { shipping_document: frm.doc.name, on: 0,
                               person: frappe.session.user })
          .then(function () { frm.reload_doc(); });
      }
    });

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

    $sec.find('[data-dsz="graderange"]').on('click', function () {
      rangeDialog({
        title: 'Set grades by block-number range',
        what: 'grade', blocks: (d.grade && d.grade.blocks) || [],
        apply: function (groups) {
          var chain = Promise.resolve(), done = 0;
          groups.forEach(function (g) {
            chain = chain.then(function () {
              return call('set_grades', { doctype: target.doctype, name: target.name,
                                          rows: JSON.stringify(g.rows), grade: g.value,
                                          person: frappe.session.user, dry_run: 0 })
                .then(function (r) { done += (r && r.count) || 0; });
            });
          });
          chain.then(function () {
            frappe.show_alert({ message: done + ' block(s) graded by range', indicator: 'green' });
            frm.reload_doc();
          });
        }
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
