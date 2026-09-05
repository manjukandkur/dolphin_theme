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
      '.dsz .rm{color:#a3352b;cursor:pointer;font-size:11.5px}',
      '.dsz .stopbox{background:#fbeeec;border-left:3px solid #a3352b;padding:10px 12px;',
      '  border-radius:0 6px 6px 0;margin:8px 0}',
      '.dsz tr.pick{cursor:pointer}',
      '.dsz tr.pick:hover td{background:#f7f9fb}',
      '.dsz tr.on td{background:#e6efe9}',
      '.dsz .cnt{font-size:13px;font-weight:700}',
      '.dsz .b.pri[disabled]{background:#c9d2dc;border-color:#c9d2dc;cursor:default}',
      '.dsz label.axis{display:flex;align-items:center;gap:8px;margin:0;cursor:pointer}',
      '.dsz label.axis .ax{width:52px;font-weight:700}',
      '.dsz label.axis select[disabled]{background:#f4f6f8;color:#a8b2be}'
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
      /* 5 Sep 2026: the row we send is the row on the document the write
         lands on, which for a shipping document is its lot. */
      var rid = b.owner_row || b.row;
      if (hit && !seen[rid]) { seen[rid] = 1; rows.push(rid); }
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
    /* 5 Sep 2026: editable wherever it is not shut. The old gate made the
       whole panel read-only on a shipping document that follows its lot, so
       there was nothing on the screen to press - the DI user's report. */
    var edit = !!(d.owner && d.owner.editable) && !d.frozen;

    /* 1 Sep 2026, his rule: "if exported edit option should not be visible or
       else these edits must reflect on shipping docs". So when it is shut, the
       screen says why and shows nothing to press. */
    if (d.frozen) {
      h.push('<div class="note"><b>Closed for editing</b> — ' +
             esc(d.frozen_by || 'this document is final') + '. The thresholds and grades ' +
             'below are what it went out with, and they stay that way.</div>');
    }

    if (d.doctype === 'Shipping Document') {
      /* 5 Sep 2026, his words: "I did not understand on the lot and on this
         document only" and then "remove the question". Gone - both tick boxes and
         the dialog behind them. One document per lot, every time, in his data, so
         the two were the same 56 blocks under two names. Edit here; it is saved on
         the lot and comes straight back, and they can never disagree. */
      if (d.override) {
        h.push('<div class="note"><b>Set on this document.</b> An older document that was ' +
               'deliberately held apart from ' + esc(d.lot || 'its lot') +
               '. Changes here stay here.</div>');
      } else if (d.lot) {
        h.push('<div class="ok"><b>Sizes for ' + esc(d.lot) + '.</b> Edit them here \u2014 ' +
               'they are saved on the lot, so the lot and this document always agree.</div>');
      } else {
        h.push('<div class="quiet">This document has no lot behind it, so it is sorted by the ' +
               'standard set and edited here.</div>');
      }
    }

    /* 1 Sep 2026, his check: "size and grade should appear on exisiting lots and
       new one to be created also". They do - a lot with no thresholds of its own
       falls back to the standard set and the panel draws normally. But every lot
       made before today has none, so it would sit on the house figures forever
       while a NEW lot gets pre-filled from the last shipment to that consignee.
       This offers an existing lot the same start, on demand, without anyone
       retyping it. */
    /* 1 Sep 2026, his words: "Rewriting Not a problem since now shipping documents
       will be finalised so give same options to existing also." So the offer is not
       limited to lots: a shipping document working from its own copy, and any
       document that has no thresholds of its own yet, gets the same start rather
       than being stuck on the house figures because it happens to predate this. */
    if (edit && !d.own_bands) {
      h.push('<div class="quiet"><b>' + (d.is_lot ? 'This lot' : 'This document') +
             ' has no thresholds of its own</b>, so it is being sorted by the standard set. ' +
             'Anything created from now on is pre-filled from the last shipment to this ' +
             'consignee &mdash; this one can have the same start.' +
             '<div style="margin-top:7px"><span class="b gold" data-dsz="seed">' +
             'Pre-fill from the last shipment&hellip;</span></div></div>');
    } else if (d.seeded_from) {
      h.push('<div class="sm">Started from ' + esc(d.seeded_from) + '.</div>');
    }

    h.push(bandsTable(d, edit && d.is_lot === false ? true : edit));

    if (edit) {
      h.push('<div class="bar"><b>Marginal</b> <input class="in" data-dsz="tol" value="' +
             (d.tolerance_cm || 3) + '" style="width:44px"> cm' +
             '<span class="sm">— a block that misses a higher threshold by this much or less is ' +
             'marked below. It moves nothing on its own.</span></div>');
      h.push('<div class="sm" style="margin-top:2px">To stop using a size, set its three ' +
             'numbers to <b>0</b> &mdash; it is skipped and stays on the list, and typing the ' +
             'numbers back switches it on again. Nothing is written until <b>Save &amp; ' +
             're-sort</b>.</div>');
      h.push('<div><span class="b gold" data-dsz="addband">+ Add a threshold</span>' +
             '<span class="b pri" data-dsz="savebands">Save &amp; re-sort&hellip;</span>' +
             '<span class="b off" data-dsz="resetbands">Reset to the standard</span></div>');
      /* 1 Sep 2026: one-step Undo, offered only when there is something to undo. */
      if (d.undo && d.undo.can_undo) {
        h.push('<div class="quiet" style="margin-top:6px">Last change: <b>' +
               esc(d.undo.label || 'a size/grade change') + '</b> on ' +
               (d.undo.blocks || 0) + ' block(s)' +
               (d.undo.who ? ' by ' + esc(d.undo.who) : '') +
               '<span class="b off" data-dsz="undo" style="margin-left:8px">' +
               'Undo it</span></div>');
      }
      h.push('<div style="margin-top:4px"><span class="b off" data-dsz="useset">' +
             'Use a saved set&hellip;</span>' +
             '<span class="b off" data-dsz="saveset">Save these as a set&hellip;</span>' +
             '<span class="sm">— sets are shared by every consignee, local and export</span></div>');
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

  /* REMOVED 5 Sep 2026 - "remove the question". Kept only as this note so the
     next reader does not reinvent it: two tick boxes bound to one value, where
     ticking one opened a mandatory-reason prompt BEFORE anything was saved. Cancel
     the prompt and the tick stayed on while nothing had happened, so the panel read
     "Set on this document" and "Following the lot" at the same time.
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
  */

  /* 1 Sep 2026, his ask: "add more like if you remove this Size all blocks will
     move to C size or b size etc". So the screen works it out as you type, using
     exactly the rule the server uses - top to bottom, first met on all three
     sides, zeros switch a row off except on the last row where they catch the
     rest. Nothing is written; this only says what Save would do. */
  function usableBands(bands) {
    var out = [], n = bands.length;
    bands.forEach(function (b, i) {
      var zero = !(b.min_length || b.min_width || b.min_height);
      if (zero && i < n - 1) return;
      out.push(b);
    });
    return out;
  }

  function sizeFor(bl, bands) {
    var u = usableBands(bands);
    for (var i = 0; i < u.length; i++) {
      var b = u[i];
      if (bl.size[0] >= (b.min_length || 0) && bl.size[1] >= (b.min_width || 0) &&
          bl.size[2] >= (b.min_height || 0)) { return b.size; }
    }
    return null;
  }

  /* where every block would land, and where the ones in a switched-off band go */
  function forecast(d, bands) {
    var to = {}, from = {}, none = 0;
    (d.blocks || []).forEach(function (bl) {
      if (!(bl.size[0] && bl.size[1] && bl.size[2])) return;
      var now = bl.category || '(none)';
      var next = sizeFor(bl, bands);
      if (!next) { none++; next = '(none)'; }
      to[next] = (to[next] || 0) + 1;
      if (next !== now) {
        from[now] = from[now] || {};
        from[now][next] = (from[now][next] || 0) + 1;
      }
    });
    return { to: to, from: from, none: none };
  }

  function movesText(f, size) {
    var m = f.from[size];
    if (!m) return '';
    return Object.keys(m).map(function (k) {
      return m[k] + ' block' + (m[k] === 1 ? '' : 's') + ' \u2192 ' +
             (k === '(none)' ? 'no size' : k);
    }).join(', ');
  }

  function bandsTable(d, edit) {
    var h = ['<div class="scr"><table><tr><th style="width:30px"></th><th>Size</th><th>Min L</th>' +
             '<th>Min W</th><th>Min H</th><th>Blocks</th><th></th></tr>'];
    var ord = ['1st', '2nd', '3rd', '4th', '5th', '6th', '7th', '8th'];
    (d.bands || []).forEach(function (b, i) {
      var zero = !b.min_length && !b.min_width && !b.min_height;
      /* 1 Sep 2026, his idea: "rather if the field reads zeros l=0 w=0 h=0 will
         that work?" - only on the BOTTOM row. A zero is no minimum, so 0 x 0 x 0
         is met by every block: at the bottom that is the catch-all and correct,
         anywhere else it swallows the whole shipment into that size and every
         row beneath it becomes unreachable. Flagged here and refused on save. */
      var off = zero && i < (d.bands || []).length - 1;   /* switched off */
      function box(f, v, cls) {
        return '<input class="in ' + (cls || '') + '" data-band="' + i + '" data-f="' + f +
               '" value="' + esc(v) + '"' + (edit ? '' : ' readonly') + '>';
      }
      h.push('<tr><td class="sm">' + (ord[i] || (i + 1)) + '</td>' +
             '<td>' + box('size', b.size, 'nm') + '</td>' +
             '<td>' + box('min_length', b.min_length) + '</td>' +
             '<td>' + box('min_width', b.min_width) + '</td>' +
             '<td>' + box('min_height', b.min_height) + '</td>' +
             '<td>' + (off ? '&mdash;' : b.blocks) +
             (zero && !off ? ' <span class="sm">&middot; the rest</span>' : '') +
             (off ? ' <span class="sm">&middot; not in use</span>' : '') + '</td>' +
             /* 1 Sep 2026, his question: "I feel remove button can be avoided to
                avoid the confusion or is it good ?" Keeping it, because without it
                you cannot go from three thresholds back to two. But the confusion
                was fair and it was the WORD: "remove" reads as though it deletes
                the size from blocks or from the master, and it does neither. It
                says what it means now - this shipment stops sorting into that
                band - and it is not offered on the catch-all row at all, because
                taking that away is what leaves blocks with no size. */
             '<td class="sm" data-fx="' + i + '">' + (off ? 'type numbers to switch it back on'
                                  : (zero ? 'catches the rest' : '')) + '</td></tr>');
    });
    h.push('</table></div>');
    h.push('<div class="quiet" data-dsz="fx" style="margin:6px 0"></div>');
    h.push('<div class="sm">Tried top to bottom; the first one a block meets on all three ' +
           'sides wins. <b>Zeros switch a size off</b> &mdash; set a row to 0 × 0 × 0 and it is ' +
           'skipped, and typing the numbers back switches it on again. The <b>last</b> row is ' +
           'the exception: zeros there mean it catches everything else, which is what stops a ' +
           'block ending up with no size.</div>');
    return h.join('');
  }

  /* ONE LIST, ONE TICK, BOTH JUDGEMENTS.  1 Sep 2026
     [stated] "simplify and make grade and size change simultaneous or individual?"
     Both, from the same control: tick blocks once, then set the size, or the
     grade, or both. Either dropdown left on "no change" leaves that side alone.

     This does NOT make grade depend on size. Nothing is derived either way, a
     re-sort of the thresholds still moves no grade, and setting a grade still
     moves no size. They sit on one row because a person works block by block,
     not axis by axis. */
  function blockTable(d, edit) {
    var g = d.grade || {};
    var gmap = {};
    (g.blocks || []).forEach(function (b) { gmap[b.row] = b.grade || ''; });
    var h = [];

    if (edit) {
      h.push('<div class="bar">' +
             '<span class="sm" style="margin-right:2px">Select:</span>' +
             '<span class="b off" data-pick="all">every block (' + (d.blocks || []).length + ')</span>' +
             '<span class="b off" data-pick="none">clear</span>' +
             '<span class="b off" data-pick="marginal">only marginal (' + (d.marginal_count || 0) + ')</span>' +
             (g.on ? '<span class="b off" data-pick="ungraded">only ungraded (' +
                     ((g.total || 0) - (g.filled || 0)) + ')</span>' : '') +
             '<span class="b gold" data-dsz="range">by block numbers&hellip;</span></div>');
      h.push('<div class="sm" style="margin:2px 0 4px">Click a row to select it. ' +
             'Shift-click a second row to take everything in between.</div>');
      /* 2 Sep 2026, his words: "give check marks both next to each other may be
         2 rows rather than down it is confusing". The "— no change" convention
         was the confusing part: you had to know that leaving a dropdown alone
         meant leaving that side alone. Now you TICK what you are changing, the
         two sit one under the other with their boxes lined up, and Apply says
         plainly what it is about to do. */
      h.push('<div class="bar" style="flex-direction:column;align-items:stretch;gap:6px">' +
             '<div class="cnt" data-dsz="count">Nothing selected</div>' +

             '<label class="axis"><input type="checkbox" data-dsz="szon">' +
             '<span class="ax">Size</span>' +
             '<select data-dsz="szval" disabled>' +
             (d.bands || []).map(function (x) {
               return '<option value="' + esc(x.size) + '">' + esc(x.size) + '</option>';
             }).join('') + '</select></label>' +

             (g.on
               ? '<label class="axis"><input type="checkbox" data-dsz="gron">' +
                 '<span class="ax">Grade</span>' +
                 '<select data-dsz="grval" disabled><option value="">— clear it</option>' +
                 (g.options || []).map(function (o) {
                   return '<option value="' + esc(o) + '">' + esc(o) + '</option>';
                 }).join('') + '</select></label>'
               : '<div class="sm">Tick <b>Record grade</b> below to set grades here too.</div>') +

             '<div><span class="b pri" data-dsz="apply" disabled>Apply&hellip;</span>' +
             '<span class="sm" data-dsz="what">Tick Size, Grade, or both</span></div>' +
             '</div>');
    }

    h.push('<div class="scr"><table><tr>' + (edit ? '<th style="width:24px"></th>' : '') +
           '<th>Block</th><th>L &times; W &times; H</th><th>Size</th>' +
           (g.on ? '<th>Grade</th>' : '') + '<th>Marginal</th></tr>');
    (d.blocks || []).forEach(function (bl) {
      h.push('<tr' + (edit ? ' class="pick"' : '') + '>' +
             (edit ? '<td><input type="checkbox" class="bck" data-row="' + esc(bl.row) + '"' +
                     ' data-owner-row="' + esc(bl.owner_row || bl.row) + '"' +
                     ' data-block="' + esc(bl.block) + '"' +
                     (bl.marginal ? ' data-marginal="1"' : '') +
                     (gmap[bl.row] ? '' : ' data-ungraded="1"') + '></td>' : '') +
             '<td><b>' + esc(bl.block) + '</b></td>' +
             '<td>' + bl.size.join(' &times; ') + '</td>' +
             '<td>' + esc(bl.category || '—') + '</td>' +
             (g.on ? '<td>' + esc(gmap[bl.row] || '—') + '</td>' : '') +
             '<td class="sm' + (bl.marginal ? ' mg' : '') + '">' +
             (bl.marginal ? 'misses ' + esc(bl.marginal.could_be) + ' by ' +
              esc(bl.marginal.short_by) : '—') + '</td></tr>');
    });
    h.push('</table></div>');

    if (g.on) {
      var tally = g.tally || {};
      h.push('<div class="quiet"><b>Grade: ' + (g.filled || 0) + ' of ' + (g.total || 0) +
             ' recorded.</b> ' + (g.options || []).map(function (o) {
               return o + ' ' + (tally[o] || 0);
             }).join(' &middot; ') + ' &middot; not graded ' +
             ((g.total || 0) - (g.filled || 0)) +
             '. Internal only &mdash; never printed.</div>');
    }
    return h.join('');
  }

  /* ================================================================ GRADE */
  function gradeHtml(d) {
    var g = d.grade || {};
    var where = (d.owner && d.owner.name) ? esc(d.owner.name)
              : (d.is_lot ? 'this lot' : 'this document');
    var edit = !d.frozen && !!(d.owner && d.owner.editable);
    var h = ['<div class="dsz">'];

    h.push('<div class="bar"><input type="checkbox" id="dsz-grade-on"' +
           (g.on ? ' checked' : '') + (edit ? '' : ' disabled') + '>' +
           '<label for="dsz-grade-on" style="margin:0"><b>Record grade</b> on ' + where + '</label>' +
           '<span class="sm">— internal record only, never printed</span></div>');

    if (!g.on) {
      h.push('<div class="quiet"><b>No grade is being recorded.</b> Tick the box above and a ' +
             '<b>Grade</b> column and a Grade dropdown appear on the block list, beside the size. ' +
             'Then it is: tick blocks &rarr; choose a grade &rarr; <b>Apply</b>.' +
             '<div class="sm" style="margin-top:6px">A · B · B1 · B2 · C, blank allowed. It shows ' +
             'what will change before writing, and reaches no printout.</div></div>');
    } else {
      h.push('<div class="sm">The <b>Grade</b> column and dropdown are on the block list above. ' +
             'Setting a grade moves no size, and re-sorting the thresholds moves no grade.</div>');
    }
    h.push('</div>');
    return h.join('');
  }

  /* =============================================================== render */
  function render(frm) {
    if (frm.is_new()) return;
    call('panel', { doctype: frm.doc.doctype, name: frm.doc.name }).then(function (d) {
      if (!d) return;
      css();
      var title = (d.doctype === 'Quarry Inspection') ? 'Sizes &amp; grade — at the quarry'
                : (d.doctype === 'Buyer Inspection') ? 'Sizes &amp; grade — at the inspection'
                : d.is_lot ? 'Sizes for this lot'
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

    /* live forecast: as the numbers change, say where every block would land */
    function refresh() {
      var bands = readBands($sec, d).map(function (b) {
        return { size: b.size_category_name, min_length: b.min_length,
                 min_width: b.min_width, min_height: b.min_height };
      });
      var f = forecast(d, bands);
      bands.forEach(function (b, i) {
        var zero = !(b.min_length || b.min_width || b.min_height);
        var off = zero && i < bands.length - 1;
        var t = movesText(f, b.size);
        var cell = $sec.find('[data-fx="' + i + '"]');
        if (!cell.length) return;
        if (off) {
          cell.html(t ? '<b>' + esc(b.size) + ' is off</b> \u2014 ' + esc(t)
                      : 'not in use \u2014 type numbers to switch it back on');
        } else if (zero) {
          cell.text('catches the rest');
        } else {
          cell.html(t ? esc(t) : '');
        }
      });
      var line = Object.keys(f.to).sort().map(function (k) {
        return '<b>' + esc(k === '(none)' ? 'no size' : k) + '</b> ' + f.to[k];
      }).join(' &middot; ');
      $sec.find('[data-dsz="fx"]').html(
        'If you save this: ' + line +
        (f.none ? ' &mdash; <span style="color:#a3352b"><b>' + f.none +
                  ' would have no size at all</b></span>' : ''));
    }
    $sec.on('input change', 'input.in[data-band]', refresh);
    try { refresh(); } catch (e) {}

    /* --- the threshold actions.
       These were lost TWICE to bulk region replacements in this file, and the
       second time they reached the live site: the buttons drew and did nothing.
       The check that catches it is mechanical, so it is written down here -
       every data-dsz emitted in the markup must have a [data-dsz] handler bound,
       and that is verified before every commit now. --- */

    $sec.find('[data-dsz="addband"]').on('click', function () {
      d.bands.push({ size: '', min_length: 0, min_width: 0, min_height: 0, blocks: 0 });
      $sec.html(sizesHtml(d));
      wireSizes(frm, $sec, d);
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
          var orphan = (plan.unsized || []).length;
          if (orphan) {
            body += '<div class="stopbox"><b>' + orphan +
                    ' block(s) would be left with NO SIZE at all</b> — they meet none of ' +
                    'the thresholds: ' + esc(plan.unsized.slice(0, 15).join(', ')) +
                    '<div style="margin-top:5px">That usually means a size was switched off by ' +
                    'mistake. Type its numbers back, or leave the last row at 0 × 0 × 0.' +
                    '</div></div>';
          }
          var fields = [{ fieldtype: 'HTML', options: '<div class="dsz">' + body +
            '<div class="sm" style="margin-top:8px">Saved on ' + esc(target.name) +
            '. No grade moves.</div></div>' }];
          if (orphan) {
            fields.push({ fieldname: 'ack', fieldtype: 'Check',
                          label: 'I know ' + orphan + ' block(s) will have no size' });
          }
          fields.push({ fieldname: 'reason', fieldtype: 'Small Text', label: 'Why', reqd: 1 });
          var dlg = new frappe.ui.Dialog({
            title: 'Size thresholds · ' + target.name,
            fields: fields,
            primary_action_label: 'Save & re-sort',
            primary_action: function (v) {
              if (orphan && !v.ack) {
                frappe.msgprint('Tick the box to confirm you mean to leave ' + orphan +
                                ' block(s) without a size — or cancel and put it back.');
                return;
              }
              call('set_bands', { doctype: target.doctype, name: target.name,
                                  bands: JSON.stringify(bands), tolerance_cm: tol,
                                  reason: v.reason, person: frappe.session.user, dry_run: 0,
                                  allow_unsized: orphan ? 1 : 0 })
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

    $sec.find('[data-dsz="undo"]').on('click', function () {
      var target = d.owner;
      frappe.confirm('Put back exactly what <b>' +
        esc((d.undo && d.undo.label) || 'that change') + '</b> altered — the sizes, the ' +
        'grades and the thresholds together?', function () {
        call('undo_last', { doctype: target.doctype, name: target.name,
                            person: frappe.session.user })
          .then(function (r) {
            frappe.show_alert({ message: ((r && r.restored) || 0) + ' put back',
                                indicator: 'green' });
            frm.reload_doc();
          });
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
              { fieldtype: 'HTML', options: '<div class="dsz"><b>From ' + esc(plan.source) +
                '.</b><table style="margin-top:6px">' +
                (plan.bands || []).map(function (b) {
                  return '<tr><td style="padding-right:14px"><b>' + esc(b.size_category_name) +
                         '</b></td><td>' + b.min_length + ' &times; ' + b.min_width +
                         ' &times; ' + b.min_height + '</td></tr>';
                }).join('') + '</table>' +
                (moved.length ? '<div class="note">' + moved.length +
                                ' block(s) would change size.</div>'
                              : '<div class="sm">No block changes size.</div>') + '</div>' },
              { fieldname: 'reason', fieldtype: 'Small Text', label: 'Why', reqd: 1 }
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

    $sec.find('[data-dsz="useset"]').on('click', function () {
      call('size_sets').then(function (sets) {
        if (!sets || !sets.length) {
          frappe.msgprint('No sets saved yet. Type the thresholds you want, then ' +
                          '<b>Save these as a set…</b> and it will be here next time.');
          return;
        }
        var dlg = new frappe.ui.Dialog({ title: 'Use a saved set',
                                         fields: [{ fieldname: 'body', fieldtype: 'HTML' }] });
        var html = ['<div class="dsz">'];
        sets.forEach(function (st, i) {
          html.push('<div class="bar" style="justify-content:space-between">' +
                    '<span><b>' + esc(st.set) + '</b> <span class="sm">' +
                    st.bands.map(function (b) {
                      return esc(b.size) + ' ' + b.min_length + '×' + b.min_width +
                             '×' + b.min_height;
                    }).join(' &middot; ') + '</span></span>' +
                    '<span class="b pri" data-use="' + i + '">Use this</span></div>');
        });
        html.push('<div class="sm">Picking a set only fills the boxes. Nothing changes until ' +
                  'you press <b>Save &amp; re-sort</b>.</div></div>');
        dlg.fields_dict.body.$wrapper.html(html.join(''));
        dlg.fields_dict.body.$wrapper.find('[data-use]').on('click', function () {
          var st = sets[parseInt(this.dataset.use, 10)];
          d.bands = st.bands.map(function (b) {
            return { size: b.size, min_length: b.min_length, min_width: b.min_width,
                     min_height: b.min_height, blocks: 0 };
          });
          dlg.hide();
          $sec.html(sizesHtml(d));
          wireSizes(frm, $sec, d);
          frappe.show_alert({ message: 'Filled from “' + st.set +
                                       '” — press Save & re-sort', indicator: 'blue' });
        });
        dlg.show();
      });
    });

    $sec.find('[data-dsz="saveset"]').on('click', function () {
      var bands = readBands($sec, d);
      frappe.prompt([
        { fieldname: 'set_name', fieldtype: 'Data', label: 'Name this set', reqd: 1,
          description: 'Something you will recognise — “Bless 207”, “Local 150”.' },
        { fieldname: 'reason', fieldtype: 'Small Text', label: 'Note' }
      ], function (v) {
        call('save_size_set', { set_name: v.set_name, bands: JSON.stringify(bands),
                                reason: v.reason, person: frappe.session.user })
          .then(function (r) {
            frappe.show_alert({ message: 'Saved as “' + (r && r.set) + '”',
                                indicator: 'green' });
          });
      }, 'Save these as a set', 'Save');
    });

    var lastIdx = null;
    function boxes() { return $sec.find('input.bck'); }
    function count() {
      var n = $sec.find('input.bck:checked').length;
      var szOn = $sec.find('[data-dsz="szon"]').prop('checked');
      var grOn = $sec.find('[data-dsz="gron"]').prop('checked');
      $sec.find('[data-dsz="szval"]').prop('disabled', !szOn);
      $sec.find('[data-dsz="grval"]').prop('disabled', !grOn);
      $sec.find('[data-dsz="count"]').text(
        n === 0 ? 'Nothing selected' : n + (n === 1 ? ' block selected' : ' blocks selected'));
      var what = !(szOn || grOn) ? 'Tick Size, Grade, or both'
        : (szOn && grOn) ? 'sets the size AND the grade on the selected blocks'
        : (szOn ? 'sets the size only \u2014 grades are left alone'
                : 'sets the grade only \u2014 sizes are left alone');
      $sec.find('[data-dsz="what"]').text(what);
      $sec.find('[data-dsz="apply"]').attr('disabled', (n && (szOn || grOn)) ? null : 'disabled')
          .text(n ? 'Apply to ' + n + '\u2026' : 'Apply\u2026');
      boxes().each(function () {
        var $tr = $(this).closest('tr');
        if (this.checked) { $tr.addClass('on'); } else { $tr.removeClass('on'); }
      });
      return n;
    }

    /* Clicking anywhere on the row selects it, and shift-click takes the run in
       between. 1 Sep 2026, his words: "the method of selecting multiple blocks
       for both sizes and grades is little complex ... it should be easy to
       understand and use." Tiny check boxes were the complexity. */
    $sec.on('click', 'tr.pick', function (e) {
      var $box = $(this).find('input.bck');
      if (!$box.length) return;
      var all = boxes(), i = all.index($box);
      if (e.target && e.target.tagName === 'INPUT') {
        /* the box itself already toggled */
      } else {
        $box.prop('checked', !$box.prop('checked'));
      }
      if (e.shiftKey && lastIdx !== null) {
        var a = Math.min(lastIdx, i), b = Math.max(lastIdx, i), on = $box.prop('checked');
        for (var k = a; k <= b; k++) { all.eq(k).prop('checked', on); }
      }
      lastIdx = i;
      count();
    });

    $sec.find('[data-pick]').on('click', function () {
      var what = this.dataset.pick;
      $sec.find('input.bck').each(function () {
        this.checked = (what === 'all') ? true
                     : (what === 'none') ? false
                     : (what === 'marginal') ? !!this.dataset.marginal
                     : !!this.dataset.ungraded;
      });
      count();
    });

    /* ONE Apply for both axes. Either dropdown on "no change" leaves that side alone. */
    $sec.find('[data-dsz="apply"]').on('click', function () {
      if (this.hasAttribute('disabled')) return;
      var rows = [], lost = [];
      $sec.find('input.bck:checked').each(function () {
        if (this.dataset.ownerRow) { rows.push(this.dataset.ownerRow); }
        else { lost.push(this.dataset.block || '?'); }
      });
      if (lost.length) {
        frappe.msgprint('These blocks are on this document but not on ' +
                        esc(d.owner.name) + ', so they cannot be set from here: ' +
                        esc(lost.join(', ')) + '.');
        return;
      }
      if (!rows.length) { return; }
      var to = $sec.find('[data-dsz="szon"]').prop('checked')
             ? $sec.find('[data-dsz="szval"]').val() : '__keep__';
      var gr = $sec.find('[data-dsz="gron"]').prop('checked')
             ? $sec.find('[data-dsz="grval"]').val() : '__keep__';
      applyBoth(frm, d, rows, to, gr);
    });

    $sec.find('[data-dsz="range"]').on('click', function () {
      rangeDialog({
        title: 'Set by block-number range',
        what: 'size or grade', blocks: d.blocks,
        apply: function (groups) {
          /* a range line names one value; decide per line whether it is a size
             this document knows, otherwise treat it as a grade. */
          var sizes = (d.bands || []).map(function (x) { return String(x.size).toUpperCase(); });
          var chain = Promise.resolve(), nS = 0, nG = 0;
          groups.forEach(function (grp) {
            var isSize = sizes.indexOf(String(grp.value).toUpperCase()) >= 0;
            chain = chain.then(function () {
              return call('set_block_values', {
                doctype: d.doctype, name: d.name, rows: JSON.stringify(grp.rows),
                to_size: isSize ? grp.value : '__keep__',
                grade: isSize ? '__keep__' : grp.value,
                reason: 'Set by block-number range.', person: frappe.session.user, dry_run: 0
              }).then(function (r) { nS += (r && r.n_size) || 0; nG += (r && r.n_grade) || 0; });
            });
          });
          chain.then(function () {
            frappe.show_alert({ message: nS + ' size(s), ' + nG + ' grade(s) set by range',
                                indicator: 'green' });
            frm.reload_doc();
          }).catch(function () { frm.reload_doc(); });
        }
      });
    });

    $sec.find('[data-dsz="editlot"]').on('click', function () {
      openLotDialog(frm, d.lot);
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
    /* 5 Sep 2026: one place, worked out server-side. */
    var target = (d.owner && d.owner.name)
      ? { doctype: d.owner.doctype, name: d.owner.name }
      : { doctype: d.doctype, name: d.name };

    $sec.find('#dsz-grade-on').on('change', function () {
      call('set_grade_recording', { doctype: target.doctype, name: target.name,
                                    on: this.checked ? 1 : 0, person: frappe.session.user })
        .then(function () { frm.reload_doc(); });
    });
  }

  /* The one confirmation, for whichever of the two you actually changed. */
  function applyBoth(frm, d, rows, to, gr) {
    call('set_block_values', { doctype: d.doctype, name: d.name, rows: JSON.stringify(rows),
                               to_size: to, grade: gr, dry_run: 1 })
      .then(function (plan) {
        if (!plan) return;
        var up = (plan.promotions || []).length;
        var body = '<div class="dsz">';
        if (plan.n_size) {
          body += '<b>' + plan.n_size + ' block(s) change size to ' + esc(to) + '.</b>' +
                  '<div class="sm" style="margin-top:4px">' +
                  (plan.sized || []).slice(0, 12).map(function (c) {
                    return esc(c.block) + ' ' + esc(c.from) + ' &rarr; ' + esc(c.to) +
                           (c.up ? ' <b>&uarr;</b>' : '');
                  }).join(' &middot; ') + '</div>';
        }
        if (plan.n_grade) {
          body += '<div style="margin-top:8px"><b>' + plan.n_grade + ' block(s) change grade to ' +
                  esc(gr || '(cleared)') + '.</b> <span class="sm">Internal only — never printed.</span></div>';
        }
        if (!plan.n_size && !plan.n_grade) { body += 'Nothing changes on the ticked blocks.'; }
        body += (up
          ? '<div class="note" style="margin-top:8px"><b>' + up + ' move UP a band.</b> ' +
            'The thresholds did not put them there, so this records that the buyer agreed.</div>'
          : '<div class="sm" style="margin-top:8px">Nothing moves up a band, so no buyer consent ' +
            'is involved.</div>') + '</div>';

        var fields = [{ fieldtype: 'HTML', options: body }];
        if (up) {
          fields.push({ fieldname: 'agreed_by', fieldtype: 'Data',
                        label: 'Who at the buyer agreed', reqd: 1 });
        }
        fields.push({ fieldname: 'reason', fieldtype: 'Small Text', label: 'Note', reqd: 1 });

        var dlg = new frappe.ui.Dialog({
          title: rows.length + ' block(s)',
          fields: fields,
          primary_action_label: 'Apply',
          primary_action: function (v) {
            call('set_block_values', {
              doctype: d.doctype, name: d.name, rows: JSON.stringify(rows),
              to_size: to, grade: gr, agreed_by: v.agreed_by, reason: v.reason,
              person: frappe.session.user, dry_run: 0
            }).then(function (r) {
              dlg.hide();
              frappe.show_alert({ message: ((r && r.n_size) || 0) + ' size(s), ' +
                ((r && r.n_grade) || 0) + ' grade(s) set', indicator: 'green' });
              frm.reload_doc();
            });
          }
        });
        dlg.show();
      });
  }


  /* ====================================================== THE GRADE MASTER
     2 Sep 2026. Looking at the Size thresholds popup on Buyer Inspection:
     [stated] "Grade also can be added in this?" / "it is missing".

     It was missing because that popup edits the SIZE master. Grade does not
     belong in that table - a grade column beside Min L / Min W / Min H would
     make grade a function of the measurements, and his rule is the opposite:
     "grade is independednt of size so grade is independednt".

     So the popup gets a SECOND list underneath, over the Granite Grade master.
     No dimensions on it, no link to the rows above it. The two lists share a
     popup because that is where his hand already is, and for no other reason.

     This is additive on purpose. The Size thresholds popup is an older client
     script held as site data; nothing in it is edited, moved or removed. This
     watches for it to open and appends a section of its own.
  */
  var GRADE_MARK = 'dolphin-grade-options';

  function gradeRowsHtml(rows) {
    var h = ['<table><tr><th style="width:44%">Grade</th><th>Active</th>' +
             '<th>Order</th></tr>'];
    (rows || []).forEach(function (r) {
      h.push('<tr data-dgo="row" data-name="' + esc(r.name) + '">' +
             '<td style="font-weight:700">' + esc(r.grade_name || r.name) + '</td>' +
             '<td><input type="checkbox" data-dgo="act"' +
                 (r.is_active ? ' checked' : '') + '></td>' +
             '<td><input class="in" type="number" data-dgo="ord" min="0" step="1" value="' +
                 (parseInt(r.sort_order, 10) || 0) + '"></td></tr>');
    });
    h.push('</table>');
    return h.join('');
  }

  function gradeSection(rows, editable) {
    var w = document.createElement('div');
    w.className = 'dsz';
    w.setAttribute('data-' + GRADE_MARK, '1');
    w.style.cssText = 'border-top:1px solid #e3e8ee;margin-top:14px;padding-top:12px';
    w.innerHTML =
      '<div style="font-size:10px;letter-spacing:.04em;text-transform:uppercase;' +
      'color:#8a929c;font-weight:700;margin-bottom:2px">Grades</div>' +
      '<div class="sm" style="margin-bottom:6px">Decided by eye, not by measurement — ' +
      'nothing here reads the sizes above. Internal only; grade never reaches an ' +
      'invoice or a packing list.</div>' +
      gradeRowsHtml(rows) +
      (editable
        ? '<div class="bar"><span class="b pri" data-dgo="save">Save grades</span>' +
          '<span class="sm" data-dgo="msg">Unticking hides a grade from the pickers. ' +
          'Blocks already graded keep what they have.</span></div>'
        : '<div class="quiet">The grade master has no Active column yet. Open any ' +
          'Export Shipment Lot once to finish the setup, then come back.</div>');
    return w;
  }

  function wireGradeSection(w) {
    var saveBtn = w.querySelector('[data-dgo="save"]');
    if (!saveBtn) return;                       /* nothing to wire when read-only */
    saveBtn.addEventListener('click', function () {
      if (saveBtn.hasAttribute('disabled')) return;
      var out = [];
      Array.prototype.forEach.call(w.querySelectorAll('[data-dgo="row"]'), function (tr) {
        out.push({
          name: tr.getAttribute('data-name'),
          is_active: tr.querySelector('[data-dgo="act"]').checked ? 1 : 0,
          sort_order: parseInt(tr.querySelector('[data-dgo="ord"]').value, 10) || 0
        });
      });
      var msg = w.querySelector('[data-dgo="msg"]');
      saveBtn.setAttribute('disabled', 'disabled');
      call('save_grade_options', { rows: JSON.stringify(out) })
        .then(function (r) {
          saveBtn.removeAttribute('disabled');
          var n = (r && r.changed && r.changed.length) || 0;
          if (msg) {
            msg.textContent = n
              ? n + ' change(s) saved · now offered: ' + ((r && r.active) || []).join(', ')
              : 'Nothing had changed.';
          }
          frappe.show_alert({ message: 'Grades saved', indicator: 'green' });
        })
        .catch(function () { saveBtn.removeAttribute('disabled'); });
    });
  }

  /* The popup is somebody else's. Find it when it opens, append, never edit. */
  function offerGrades(modal) {
    if (!modal || modal.querySelector('[data-' + GRADE_MARK + ']')) return;
    var t = modal.querySelector('.modal-title');
    if (!t || !/^\s*Size thresholds/i.test(t.textContent || '')) return;
    var body = modal.querySelector('.modal-body');
    if (!body) return;
    modal.setAttribute('data-' + GRADE_MARK + '-seen', '1');
    css();
    call('grade_options').then(function (r) {
      if (!r || !r.ok || modal.querySelector('[data-' + GRADE_MARK + ']')) return;
      var w = gradeSection(r.rows || [], !!r.editable);
      body.appendChild(w);
      wireGradeSection(w);
    });
  }

  function watchForThresholdPopup() {
    if (window.__dolphinGradeWatch) return;
    window.__dolphinGradeWatch = true;
    try {
      new MutationObserver(function (muts) {
        for (var i = 0; i < muts.length; i++) {
          var added = muts[i].addedNodes || [];
          for (var j = 0; j < added.length; j++) {
            var n = added[j];
            if (!n || n.nodeType !== 1) continue;
            if (n.classList && n.classList.contains('modal')) { offerGrades(n); }
            else if (n.querySelectorAll) {
              Array.prototype.forEach.call(n.querySelectorAll('.modal'), offerGrades);
            }
          }
        }
      }).observe(document.body, { childList: true, subtree: true });
      /* one sweep for a popup that is already open when this loads */
      Array.prototype.forEach.call(document.querySelectorAll('.modal'), offerGrades);
    } catch (e) { /* a master editor must never block a form */ }
  }

  /* 1 Sep 2026: the same panel on the two inspections as well, because that is
     where the stone is actually in front of somebody. Nothing on QI or BI is
     disturbed - both child tables already carried granite_size_category and
     granite_quality_grade; this only gives them the tick-and-apply screen. */
  /* 5 Sep 2026: the Quarry Inspection is OFF this list on his instruction -
     "Whatever you have given now in QI remove it and add it in BI" and "Qi will
     be just whatever was earlier to the present". The sheet keeps its plain
     Size and Grade columns, filled by the house rule and typed over when wrong;
     every deliberate size or grade decision is made at the inspection. */
  ['Export Shipment Lot', 'Shipping Document',
   'Buyer Inspection'].forEach(function (dt) {
    frappe.ui.form.on(dt, {
      refresh: function (frm) {
        try { render(frm); } catch (e) { /* a panel must never block the form */ }
        try { watchForThresholdPopup(); } catch (e) { /* nor must the grade list */ }
      }
    });
  });
})();
