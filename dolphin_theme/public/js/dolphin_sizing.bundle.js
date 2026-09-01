/* ===========================================================================
   THE SIZE MASTER, ON THE DOCUMENT THAT IS THE MASTER.  1 Sep 2026

   His words, opening this session, looking at SHP-EXP-00005:
       "still the size category master is not showing here ??"

   He was right, and it was not a display fault. The sizing work of 31 Aug
   shipped as nine API methods and no screen at all - sizing.size_rules,
   learned_size_rule, save_size_rule, marginal_blocks, promote_block_size all
   existed and nothing on earth called them. The two fields that DID reach the
   form, `size_variation` and `size_rule_display`, sit as a blank box beside
   Allow size override; `size_rule_display` is written on save, so on a document
   nobody has saved since the deploy it is empty. A blank box is not a master.

   So this is that screen, and it lives here because of his own rule:
       "whatever is decided on the invoice will be the correct for the
        respective buyer"
   The shipping document IS the size master. The panel therefore sits on the
   shipping document and nowhere else.

   What it will and will not do, all his rulings, none of them re-litigated here:
     - It shows the BUYER'S NAME, never EC12.
     - Grade is never a column. A grade-specific rule is a second named rule -
       "XIAMEN BLESS - B grade" - reached through the Variation box.
     - The app NEVER promotes. It sorts by the bands and only ever highlights.
       A promotion is a person recording that the buyer agreed, with a name.
     - Marginal tolerance is 2-3 cm; 3 is the default the server holds.
     - NOTHING here reaches a printout. The invoice and the packing list are
       untouched; consent is a note inside the shipping document.
     - Upstream size - quarry, BI, challan, port - does not matter and is not
       shown. It is a convenience, and nothing depends on it.

   Every action is dry-run first and shows what it would write before it writes.
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
      '.dsz .hd{display:flex;flex-wrap:wrap;align-items:baseline;gap:8px;margin-bottom:8px}',
      '.dsz .rule{font-weight:700;font-size:13.5px}',
      '.dsz .who{color:#5f6b7a}',
      '.dsz table{border-collapse:collapse;margin:2px 0 10px}',
      '.dsz th,.dsz td{padding:4px 12px 4px 0;text-align:left;font-variant-numeric:tabular-nums}',
      '.dsz th{font-size:10.5px;letter-spacing:.04em;text-transform:uppercase;color:#8a929c;font-weight:600}',
      '.dsz .note{background:#fdf6e3;border-left:3px solid #d9a441;padding:8px 10px;border-radius:0 6px 6px 0;margin:8px 0}',
      '.dsz .quiet{background:#f4f6f8;border-left:3px solid #cfd4dc;padding:8px 10px;border-radius:0 6px 6px 0;margin:8px 0;color:#5f6b7a}',
      '.dsz .b{display:inline-block;font-size:12px;padding:5px 11px;border-radius:7px;border:1px solid #0f6e56;color:#0f6e56;background:#fff;cursor:pointer;margin:2px 6px 2px 0}',
      '.dsz .b.pri{background:#0f6e56;color:#fff}',
      '.dsz .b.warn{border-color:#a8611b;color:#a8611b}',
      '.dsz .mg td{border-top:1px solid #eef1f4}',
      '.dsz .sm{font-size:11.5px;color:#8a929c}'
    ].join('\n');
    document.head.appendChild(s);
  }

  function esc(v) {
    return String(v == null ? '' : v).replace(/[&<>"]/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c];
    });
  }

  function dim(a) {
    if (!a || !a.length) return '';
    return a[0] + ' &times; ' + a[1] + ' &times; ' + a[2];
  }

  function call(method, args) {
    return frappe.call({ method: 'dolphin_theme.sizing.' + method, args: args || {} })
      .then(function (r) { return r && r.message; });
  }

  /* ---------------------------------------------------------------------
     One panel, built from three reads. They are independent, so they go
     together and the panel is drawn once - a section that redraws itself
     three times reads as a fault even when it is not.
     --------------------------------------------------------------------- */
  function render(frm) {
    var consignee = frm.doc.export_consignee;
    if (!consignee) return;
    var variation = frm.doc.size_variation || '';

    var jobs = [
      call('size_rules'),
      call('learned_size_rule', { consignee: consignee }),
      frm.is_new() ? Promise.resolve(null)
                   : call('marginal_blocks', { shipping_document: frm.doc.name })
    ];

    Promise.all(jobs.map(function (p) {
      return p.then(function (v) { return v; }, function () { return null; });
    })).then(function (res) {
      draw(frm, consignee, variation, res[0] || [], res[1] || {}, res[2]);
    });
  }

  function inForce(rules, consignee, variation) {
    var mine = null, house = null;
    (rules || []).forEach(function (g) {
      if (!g.consignee && !g.variation) house = g;
      if (g.consignee === consignee && (g.variation || '') === (variation || '')) mine = g;
    });
    return { rule: mine || house, own: !!mine, house: house };
  }

  function draw(frm, consignee, variation, rules, learned, marginal) {
    css();
    var f = inForce(rules, consignee, variation);
    var buyer = (learned && learned.buyer_name) || consignee;
    var h = ['<div class="dsz">'];

    /* --- which bands this document is sorted by ------------------------- */
    h.push('<div class="hd"><span class="rule">Sizes by: ' +
           esc(f.rule ? f.rule.label : 'no size rule found') + '</span>');
    if (!f.own) {
      h.push('<span class="who">&middot; ' + esc(buyer) +
             ' has no rule of their own, so the house bands are being used</span>');
    }
    h.push('</div>');

    if (f.rule && f.rule.sizes && f.rule.sizes.length) {
      h.push('<table><tr><th>Size</th><th>Min L</th><th>Min W</th><th>Min H</th></tr>');
      f.rule.sizes.forEach(function (s) {
        h.push('<tr><td><b>' + esc(s.size) + '</b></td><td>' + s.min_length +
               '</td><td>' + s.min_width + '</td><td>' + s.min_height + '</td></tr>');
      });
      h.push('</table>');
    }

    /* --- what their own documents actually say -------------------------- */
    var thumb = (learned && learned.thumb_rule) || {};
    var tsz = thumb.sizes || [];
    var floor = (learned && learned.sizes) || [];

    if (!floor.length) {
      h.push('<div class="quiet">No sized block has been shipped to ' + esc(buyer) +
             ' yet, so there is nothing to learn a rule from. The house bands apply.</div>');
    } else {
      var differs = floor.some(function (s) {
        var hr = s.house_rule || [0, 0, 0];
        return s.smallest_accepted[0] !== hr[0] || s.smallest_accepted[1] !== hr[1] ||
               s.smallest_accepted[2] !== hr[2];
      });
      h.push('<table><tr><th>Size</th><th>Smallest they accepted</th><th>Blocks</th>' +
             '<th>Bands in force</th></tr>');
      floor.forEach(function (s) {
        h.push('<tr class="mg"><td><b>' + esc(s.size) + '</b></td><td>' +
               dim(s.smallest_accepted) + '</td><td>' + s.blocks + '</td><td>' +
               (dim(s.house_rule) || '&mdash;') + '</td></tr>');
      });
      h.push('</table>');

      if (thumb.document) {
        h.push('<div class="sm">Thumb rule &mdash; their previous shipping document, ' +
               esc(thumb.document) + (thumb.date ? ' of ' + esc(thumb.date) : '') + ': ' +
               tsz.map(function (t) {
                 return esc(t.size) + ' at ' + dim(t.smallest_accepted) +
                        ' over ' + t.blocks + ' block' + (t.blocks === 1 ? '' : 's');
               }).join(' &middot; ') + '</div>');
      }

      if (differs && !f.own) {
        h.push('<div class="note"><b>' + esc(buyer) +
               ' is not being sorted by their own figures.</b> Their documents say ' +
               floor.map(function (s) { return esc(s.size) + ' = ' + dim(s.smallest_accepted); })
                    .join(', ') +
               ', read off ' + (learned.blocks_read || 0) +
               ' block' + (learned.blocks_read === 1 ? '' : 's') +
               '. Saving this writes it into the master as their own rule, and every ' +
               'document of theirs picks it up by itself.' +
               '<div style="margin-top:7px"><span class="b pri" data-dsz="save">' +
               'Save this as ' + esc(buyer) + '&rsquo;s rule&hellip;</span></div></div>');
      }
    }

    /* --- the marginal ones ---------------------------------------------- */
    if (marginal && marginal.count) {
      h.push('<div class="note"><b>' + marginal.count + ' block' +
             (marginal.count === 1 ? '' : 's') + ' missed a higher band by ' +
             marginal.tolerance_cm + ' cm or less.</b> Nothing has moved. A block moves ' +
             'up only when you record that the buyer agreed.<table style="margin-top:6px">' +
             '<tr><th>Block</th><th>Size</th><th>Now</th><th>Could be</th><th>Short by</th><th></th></tr>');
      marginal.blocks.forEach(function (b) {
        h.push('<tr class="mg"><td><b>' + esc(b.block) + '</b></td><td>' + dim(b.size) +
               '</td><td>' + esc(b.now || '&mdash;') + '</td><td>' + esc(b.could_be) + '</td><td>' +
               b.short_by.map(function (s) { return s.cm + ' cm ' + esc(s.side); }).join(', ') +
               '</td><td><span class="b warn" data-dsz="promote" data-row="' + esc(b.row) +
               '" data-to="' + esc(b.could_be) + '" data-block="' + esc(b.block) +
               '">Buyer agreed&hellip;</span></td></tr>');
      });
      h.push('</table></div>');
    } else if (marginal) {
      h.push('<div class="sm">No block on this document is within ' +
             marginal.tolerance_cm + ' cm of a higher band.</div>');
    }

    h.push('<div class="sm" style="margin-top:8px">Nothing on this panel reaches the ' +
           'invoice or the packing list. Consent is recorded as a note inside this ' +
           'document only.</div>');
    h.push('</div>');

    var $sec = frm.dashboard.add_section(h.join(''), 'Size master &mdash; ' + esc(buyer));
    wire(frm, $sec, consignee, variation, buyer);
  }

  /* ---------------------------------------------------------------------
     The two actions. Both dry-run first, both show what they would write,
     both demand a reason, both are reversible by an ordinary edit.
     --------------------------------------------------------------------- */
  function wire(frm, $sec, consignee, variation, buyer) {
    if (!$sec || !$sec.find) return;

    $sec.find('[data-dsz="save"]').on('click', function () {
      call('save_size_rule', { consignee: consignee, variation: variation, cushion: 0, dry_run: 1 })
        .then(function (plan) {
          if (!plan) return;
          var lines = (plan.bands || []).map(function (b) {
            return '<tr><td style="padding-right:14px"><b>' + esc(b.size) + '</b></td><td>' +
                   b.min_length + ' &times; ' + b.min_width + ' &times; ' + b.min_height +
                   '</td><td style="padding-left:14px;color:#8a929c">from ' + b.learned_from +
                   ' block' + (b.learned_from === 1 ? '' : 's') + '</td></tr>';
          }).join('');
          var d = new frappe.ui.Dialog({
            title: 'Save ' + buyer + '’s size rule',
            fields: [
              { fieldtype: 'HTML', options:
                '<div style="font-size:12.5px;line-height:1.55">This writes into the ' +
                'Granite Size Category master, as ' + esc(buyer) + '’s own rule' +
                (variation ? ' (' + esc(variation) + ')' : '') + '. It changes no block, ' +
                'no measurement and no printout &mdash; only which bands their documents ' +
                'are sorted by from now on.<table style="margin:8px 0">' + lines + '</table></div>' },
              { fieldname: 'cushion', fieldtype: 'Int', label: 'Cushion (cm)', default: 0,
                description: 'Subtracted from every minimum, so one unusually small block ' +
                             'that slipped through once does not become the rule. 0 saves ' +
                             'exactly what their documents say.' },
              { fieldname: 'reason', fieldtype: 'Small Text', label: 'Why', reqd: 1,
                description: 'Written onto every row that is saved.' }
            ],
            primary_action_label: 'Save the rule',
            primary_action: function (v) {
              call('save_size_rule', {
                consignee: consignee, variation: variation,
                cushion: v.cushion || 0, reason: v.reason,
                person: frappe.session.user, dry_run: 0
              }).then(function (r) {
                d.hide();
                frappe.show_alert({
                  message: (r && r.written ? r.written.length : 0) + ' band(s) saved for ' + buyer,
                  indicator: 'green'
                });
                frm.reload_doc();
              });
            }
          });
          d.show();
        });
    });

    $sec.find('[data-dsz="promote"]').on('click', function () {
      var el = this, row = el.dataset.row, to = el.dataset.to, block = el.dataset.block;
      var d = new frappe.ui.Dialog({
        title: 'Block ' + block + ' → ' + to,
        fields: [
          { fieldtype: 'HTML', options:
            '<div style="font-size:12.5px;line-height:1.55">The bands did not put this ' +
            'block in ' + esc(to) + '; it missed by a few centimetres. Moving it up is ' +
            'a record that the buyer agreed, not a correction &mdash; so it needs the ' +
            'name of the person who agreed. Nothing about this reaches the invoice or ' +
            'the packing list.</div>' },
          { fieldname: 'agreed_by', fieldtype: 'Data', label: 'Who at the buyer agreed', reqd: 1 },
          { fieldname: 'reason', fieldtype: 'Small Text', label: 'Note', reqd: 1 }
        ],
        primary_action_label: 'Record the consent',
        primary_action: function (v) {
          call('promote_block_size', {
            shipping_document: frm.doc.name, row: row, to_size: to,
            agreed_by: v.agreed_by, reason: v.reason,
            person: frappe.session.user, dry_run: 0
          }).then(function () {
            d.hide();
            frappe.show_alert({ message: block + ' recorded as ' + to, indicator: 'green' });
            frm.reload_doc();
          });
        }
      });
      d.show();
    });
  }

  frappe.ui.form.on(DT, {
    refresh: function (frm) {
      try { render(frm); } catch (e) { /* a panel must never block the form */ }
    },
    export_consignee: function (frm) { try { render(frm); } catch (e) {} },
    size_variation: function (frm) { try { render(frm); } catch (e) {} }
  });
})();
