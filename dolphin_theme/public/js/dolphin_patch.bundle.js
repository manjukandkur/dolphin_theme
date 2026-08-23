

/* Export Hub side-menu entry -> the new /export-shipments page (Active/Exported
   tabs, role-gated eye icons). Clears the stray beforeunload guard on click so the
   full-page nav does not prompt. Self-healing + reversible. */
(function(){
  function wire(){
    try{
      if(document.querySelector('a.di-sm-link[href="/app/export-hub"]')) return;
      var src=document.querySelector('a.di-sm-link[href="/app/export-shipment-lot"]');
      var srow=src && src.closest('.di-sm-row'); if(!srow) return;
      var nrow=srow.cloneNode(true); nrow.setAttribute('data-dip-expdocs','1');
      var link=nrow.querySelector('a.di-sm-link'); link.setAttribute('href','/app/export-hub');
      var nb=nrow.querySelector('.di-sm-new'); if(nb) nb.remove();
      var extra=nrow.querySelectorAll('a'); for(var i=1;i<extra.length;i++) extra[i].remove();
      var set=false; link.childNodes.forEach(function(n){ if(n.nodeType===3 && n.textContent.trim()){ n.textContent='Export Hub'; set=true; } });
      if(!set) link.appendChild(document.createTextNode('Export Hub'));
      link.addEventListener('click', function(){ try{ window.onbeforeunload=null; }catch(e){} }, true);
      if(srow.nextSibling) srow.parentNode.insertBefore(nrow, srow.nextSibling); else srow.parentNode.appendChild(nrow);
    }catch(e){}
  }
  $(document).on("app_ready", wire);
  if (frappe.router && frappe.router.on) { frappe.router.on("change", wire); }
  setInterval(wire, 1400); setTimeout(wire, 1000); setTimeout(wire, 2400);
})();


/* 3g: clicking Pending Loading did a full page load to /app/loading-desk, which
   tripped a stray beforeunload "leave this page?" prompt. loading-desk is a real desk
   page, so route to it in-app (no reload, no prompt). Self-healing + reversible. */
(function(){
  function wire(){
    try{
      var a=document.querySelector('a.di-sm-link[href="/app/loading-desk"]');
      if(!a || a.getAttribute('data-dip-nav')) return;
      a.setAttribute('data-dip-nav','1');
      a.addEventListener('click', function(ev){
        if(window.frappe && frappe.set_route){ ev.preventDefault(); ev.stopPropagation(); frappe.set_route('loading-desk'); }
      }, true);
    }catch(e){}
  }
  $(document).on("app_ready", wire);
  if (frappe.router && frappe.router.on) { frappe.router.on("change", wire); }
  setInterval(wire, 1400);
  setTimeout(wire, 1000); setTimeout(wire, 2400);
})();
/* Dolphin Theme — post-bundle patch (self-healing, fully reversible).
   Remove this file + its line in hooks.py app_include_js to revert everything below.
   Purpose:
     1. Exactly ONE "Trace a block" box (top bar) with LIVE partial matching:
        type any part of a block/export number -> dropdown of matches with status ->
        click to open the block journey popup (shows real block number, not internal id).
     2. Journey popup includes an Export Shipment Lot step.
     3. Removes the "Blocks" side-menu item and adds a "Stock Dashboard" item.
   Runs on load + every route change + a light interval (self-healing). */
frappe.provide("dolphin");
(function () {
  var SC = {'In Stock':['#eaf3de','#3b6d11'],'Buyer Marked':['#faeeda','#854f0b'],'In Delivery Challan':['#e6f1fb','#0c447c'],'Dispatched/Transported':['#e6f1fb','#0c447c'],'At Port':['#eeedfe','#3c3489'],'At Bannikoppa Station yard':['#eeedfe','#3c3489'],'Shipped':['#e1f5ee','#0f6e56'],'Sold':['#f1efe8','#444441']};
  var RANK = {'In Stock':0,'Buyer Marked':1,'In Delivery Challan':2,'Dispatched/Transported':3,'At Port':4,'At Bannikoppa Station yard':4,'Shipped':5,'Sold':6};
  var FL = ['name','block_number','export_block_no','status','delivery_challan','buyer_inspection','source_quarry_inspection','granite_quality_grade','length_gross','width_gross','height_gross','gross_volume'];
  function esc(s){ return frappe.utils.escape_html(s==null?'':(''+s)); }
  function pdf(dt,nm,fmt){ return '/api/method/frappe.utils.print_format.download_pdf?doctype='+encodeURIComponent(dt)+'&name='+encodeURIComponent(nm)+'&format='+encodeURIComponent(fmt)+'&no_letterhead=0'; }
  function eyeLink(dt,nm,fmt){ return nm?' <a href="'+pdf(dt,nm,fmt)+'" target="_blank" style="font-size:11px;border:1px solid #185fa5;color:#185fa5;border-radius:10px;padding:1px 8px;text-decoration:none;margin-left:6px">&#128065; PDF</a>':''; }
  function openLink(dt,nm){ return nm?' <a href="/app/'+dt+'/'+encodeURIComponent(nm)+'" target="_blank" style="font-size:11px;border:1px solid #185fa5;color:#185fa5;border-radius:10px;padding:1px 8px;text-decoration:none;margin-left:6px">open</a>':''; }
  function journeyHTML(b, esl, shipDoc){
    var sc = SC[b.status]||['#f1efe8','#444441']; var rank=(b.status in RANK)?RANK[b.status]:0;
    var steps=[{l:'Quarried',v:b.block_number||b.name,done:true},
      {l:'Quarry Inspection',v:b.source_quarry_inspection||'not yet',done:!!b.source_quarry_inspection,e:eyeLink('Quarry Inspection',b.source_quarry_inspection,'Quarry Inspection - Report')},
      {l:'Buyer Inspection',v:b.buyer_inspection||'not yet',done:!!b.buyer_inspection,e:eyeLink('Buyer Inspection',b.buyer_inspection,'Buyer Inspection - Report')},
      {l:'Delivery Challan',v:b.delivery_challan||'not yet',done:!!b.delivery_challan,e:eyeLink('Delivery Challan',b.delivery_challan,'Dolphin Delivery Challan')},
      {l:'Transported',v:(rank>=3?(b.export_block_no||'yes'):'not yet'),done:rank>=3},
      {l:'At Port',v:(rank>=4?(b.export_block_no||'yes'):'not yet'),done:rank>=4},
      {l:'Export Shipment Lot',v:(esl||'not yet'),done:!!esl,e:openLink('export-shipment-lot',esl)},
      {l:'Shipped',v:(rank>=5?(b.export_block_no||'yes'):'not yet'),done:rank>=5,e:((rank>=5&&shipDoc)?' <a href="'+pdf('Shipping Document',shipDoc,'DI Packing List')+'" target="_blank" style="font-size:11px;border:1px solid #0f6e56;color:#0f6e56;border-radius:10px;padding:1px 8px;text-decoration:none;margin-left:6px">&#128203; DI Packing List</a>':'')}];
    var head='<div style="margin-bottom:10px">Current status: <b style="background:'+sc[0]+';color:'+sc[1]+';padding:2px 12px;border-radius:12px">'+esc(b.status||'')+'</b></div>';
    var body=steps.map(function(s,i){var cur=(!s.done&&i>0&&steps[i-1].done);var col=s.done?'#0f6e56':(cur?'#b8860b':'#c2c8d0');var dot=s.done?'&#9679;':(cur?'&#9673;':'&#9675;');return '<div style="display:flex;gap:12px;align-items:flex-start;padding:7px 0;border-bottom:1px solid #f2f4f7"><span style="color:'+col+';font-size:17px">'+dot+'</span><div><div style="font-size:10.5px;text-transform:uppercase;color:#8a929c">'+s.l+'</div><div style="font-weight:600;color:'+(s.done?'#1f2a3a':(cur?'#7a5a00':'#aab1ba'))+'">'+esc(''+s.v)+(s.e||'')+'</div></div></div>';}).join('');
    return '<div>'+head+body+'</div>';
  }
  function eslFor(b){
    var p=new URLSearchParams({doctype:'Shipment Lot Block',parent:'Export Shipment Lot',or_filters:JSON.stringify([['block_no','=',b.block_number],['block','=',b.name]]),fields:JSON.stringify(['parent']),limit_page_length:1});
    return fetch('/api/method/frappe.client.get_list?'+p.toString(),{credentials:'same-origin'}).then(function(r){return r.json();}).then(function(j){return (j.message&&j.message[0]&&j.message[0].parent)||null;}).catch(function(){return null;});
  }
  function shipDocFor(esl){
    if(!esl) return Promise.resolve(null);
    return frappe.call({method:'frappe.client.get_value',args:{doctype:'Export Shipment Lot',filters:{name:esl},fieldname:'shipping_document'}}).then(function(r){return (r.message&&r.message.shipping_document)||null;}).catch(function(){return null;});
  }
  function openJourney(bno){
    if(!bno) return;
    function q(f){ return frappe.call({method:'frappe.client.get_list',args:{doctype:'Quarry Block',filters:f,fields:FL,limit_page_length:5}}).then(function(r){return r.message||[];}); }
    q([['block_number','=',bno]]).then(function(bl){return bl.length?bl:q([['export_block_no','=',bno]]);}).then(function(bl){return bl.length?bl:q([['name','=',bno]]);}).then(function(bl){
      if(!bl.length){ frappe.msgprint('Block '+esc(bno)+' not found in stock records.'); return; }
      var b=bl[0];
      eslFor(b).then(function(esl){
        shipDocFor(esl).then(function(shipDoc){
        var d=new frappe.ui.Dialog({title:'Block '+esc(b.block_number||b.name)+' — journey',fields:[{fieldtype:'HTML',fieldname:'j'}]});
        d.fields_dict.j.$wrapper.html(journeyHTML(b, esl, shipDoc)); d.show();
        });
      });
    });
  }
  window.dolphin_open_journey = openJourney;

  /* ---- documents and lists open HERE, in a pop-up ----
     23 Aug 2026, his words: "everything should open in the same page not new page
     open like a pop up ask if clicked only full new page else pop up fine".
     A block already opened in a dialog. A challan, an inspection, an arrival sheet,
     a lot, an invoice, a range or a list used to send the whole window to
     /trace-block?q=, which threw away whatever he was in the middle of. Now they
     render in the same dialog, and the full page is one deliberate click away. */
  var DOC = {
    dc:  {dt:'Delivery Challan',    label:'Delivery Challan', child:'DC Block Row',
          num:'delivery_challan_no',
          f:['name','delivery_challan_no','dc_date','docstatus','vehicle','sale_type','export_consignee'],
          cf:['block','block_no','export_block_no','length_gross','width_gross','height_gross','gross_volume','gross_tonnage']},
    bi:  {dt:'Buyer Inspection',    label:'Buyer Inspection', child:'Buyer Inspection Block',
          f:['name','report_no','report_date','prepared_by','local_buyer','sale_type','marking','docstatus'],
          cf:['block','block_no','export_block_no','length_gross','width_gross','height_gross','gross_volume','gross_tonnage']},
    qi:  {dt:'Quarry Inspection',   label:'Quarry Inspection', child:'Quarry Inspection Block',
          f:['name','docstatus'],
          cf:['quarry_block_no','length_gross','width_gross','height_gross','gross_volume','gross_tonnage']},
    arr: {dt:'Port Arrival',        label:'Arrival sheet', child:'Port Arrival Block',
          f:['name','arrival_date','port','docstatus','email_sender','source_sheet'],
          cf:['block_no','length','width','height','cbm','net_wt']},
    lot: {dt:'Export Shipment Lot', label:'Shipment Lot', child:'Shipment Lot Block',
          f:['name','docstatus'],
          cf:['block','block_no','length','width','height','cbm','net_tonnage']},
    inv: {dt:'Local Tax Invoice',   label:'Local Tax Invoice', child:'Tax Invoice Block',
          f:['name','docstatus','description','block_count'],
          cf:['block','block_no','block_number_input','length_gross','width_gross','height_gross','gross_volume','quantity_mt']}
  };
  var DOCPREFIX = [['DC-','dc'],['LBI-','bi'],['BI-','bi'],['QI-','qi'],['ARR-','arr'],['SL-','lot'],['DI-LTI-','inv']];

  function docParse(raw){
    var s=String(raw||'').trim(); if(!s) return null;
    var up=s.toUpperCase();
    for(var i=0;i<DOCPREFIX.length;i++){ if(up.indexOf(DOCPREFIX[i][0])===0) return {k:DOCPREFIX[i][1], exact:s}; }
    var m=s.match(/^(dc|bi|qi|arr|lot|inv|invoice|challan)\s*[-_: ]?\s*(.+)$/i);
    if(!m) return null;
    var w=m[1].toLowerCase();
    if(w==='challan') w='dc';
    if(w==='invoice') w='inv';
    return {k:w, part:m[2].trim()};
  }
  function dq(dt,filters,fields,parent){
    var u='/api/method/frappe.client.get_list?doctype='+encodeURIComponent(dt)
      +(parent?('&parent='+encodeURIComponent(parent)):'')
      +'&filters='+encodeURIComponent(JSON.stringify(filters))
      +'&fields='+encodeURIComponent(JSON.stringify(fields))+'&limit_page_length=0';
    return fetch(u,{credentials:'same-origin',headers:{Accept:'application/json'}})
      .then(function(r){return r.json();}).then(function(j){return j.message||[];})
      .catch(function(){return [];});
  }
  /* "dc 021" must find challan 0021. Challan numbers are typed by hand and the
     leading zeros are not consistent, so try the number as given, then zero-padded
     to four, then the bare digits, before falling back to the record id. */
  function docFind(p){
    var K=DOC[p.k]; if(!K) return Promise.resolve([]);
    if(p.exact) return dq(K.dt,[['name','=',p.exact]],K.f);
    var raw=p.part, bare=raw.replace(/^0+/,'')||raw, tries=[];
    if(K.num){
      var forms=[raw];
      if(/^\d+$/.test(bare)){
        while(bare.length<4){ bare='0'+bare; }
        if(forms.indexOf(bare)<0) forms.push(bare);
        var nz=raw.replace(/^0+/,''); if(nz && forms.indexOf(nz)<0) forms.push(nz);
      }
      forms.forEach(function(v){ tries.push([[K.num,'=',v]]); });
    }
    tries.push([['name','like','%'+raw]]);
    tries.push([['name','like','%'+raw+'%']]);
    var out=Promise.resolve([]);
    tries.forEach(function(f){ out=out.then(function(r){ return (r&&r.length)?r:dq(K.dt,f,K.f); }); });
    return out;
  }
  function dnum(r){ return r.export_block_no||r.block_number_input||r.block_no||r.quarry_block_no||r.block||''; }
  function dsize(r){ var L=r.length_gross||r.length,W=r.width_gross||r.width,H=r.height_gross||r.height; return L?(L+'&times;'+W+'&times;'+H):''; }
  function dcbm(r){ var v=r.gross_volume||r.cbm; return v?(+v).toFixed(3):''; }
  function dmt(r){ var t=r.gross_tonnage||r.net_tonnage||r.quantity_mt||r.net_wt; return t?(+t).toFixed(3):''; }

  function docTable(rows){
    if(!rows.length) return '<div style="padding:16px;color:#8a929c;font-size:13px">No blocks on this document.</div>';
    var cv=0,ct=0;
    var h='<table style="width:100%;border-collapse:collapse;font-size:13px;font-variant-numeric:tabular-nums">'
      +'<thead><tr>'
      +['Block','Size','CBM','MT',''].map(function(t,i){
        return '<th style="text-align:'+(i===2||i===3?'right':'left')+';font-size:10.5px;letter-spacing:.05em;text-transform:uppercase;color:#8a929c;font-weight:700;padding:8px 14px;border-bottom:1px solid #eef1f5;white-space:nowrap">'+t+'</th>'; }).join('')
      +'</tr></thead><tbody>';
    rows.forEach(function(r){
      cv+=(+(r.gross_volume||r.cbm)||0); ct+=(+(r.gross_tonnage||r.net_tonnage||r.quantity_mt||r.net_wt)||0);
      var n=dnum(r);
      h+='<tr><td style="padding:9px 14px;border-bottom:1px solid #eef1f5;font-weight:700">'+esc(n)
        +(r.block_no&&String(r.block_no)!==String(n)?'<div style="font-weight:400;font-size:12px;color:#8a929c">quarry '+esc(r.block_no)+'</div>':'')+'</td>'
        +'<td style="padding:9px 14px;border-bottom:1px solid #eef1f5">'+dsize(r)+'</td>'
        +'<td style="padding:9px 14px;border-bottom:1px solid #eef1f5;text-align:right">'+dcbm(r)+'</td>'
        +'<td style="padding:9px 14px;border-bottom:1px solid #eef1f5;text-align:right">'+dmt(r)+'</td>'
        +'<td style="padding:9px 14px;border-bottom:1px solid #eef1f5">'
        +(n?'<a href="#" class="dip-dtrace" data-n="'+esc(n)+'" style="color:#185fa5;font-size:12px;white-space:nowrap">trace &rarr;</a>':'')+'</td></tr>';
    });
    h+='<tr style="background:#f6f8fa;font-weight:700"><td style="padding:9px 14px" colspan="2">'+rows.length+' block(s)</td>'
      +'<td style="padding:9px 14px;text-align:right">'+cv.toFixed(3)+'</td>'
      +'<td style="padding:9px 14px;text-align:right">'+ct.toFixed(3)+'</td><td></td></tr>';
    return h+'</tbody></table>';
  }
  function docHead(K,d){
    var bits=[];
    ['dc_date','report_date','arrival_date'].forEach(function(k){ if(d[k]) bits.push(esc(d[k])); });
    if(d.vehicle) bits.push('vehicle <b>'+esc(d.vehicle)+'</b>');
    if(d.prepared_by) bits.push(esc(d.prepared_by));
    if(d.local_buyer) bits.push(esc(d.local_buyer));
    if(d.export_consignee) bits.push('consignee <b>'+esc(d.export_consignee)+'</b>');
    if(d.marking) bits.push('mark <b>'+esc(d.marking)+'</b>');
    if(d.port) bits.push(esc(d.port));
    if(d.source_sheet) bits.push('sheet <b>'+esc(d.source_sheet)+'</b>');
    if(d.description) bits.push(esc(d.description));
    if(d.sale_type) bits.push(esc(d.sale_type));
    var st=(d.docstatus===1)?'Submitted':(d.docstatus===2?'Cancelled':'Draft');
    var stc=(d.docstatus===1)?['#e1f5ee','#0f6e56']:(d.docstatus===2?['#fbeeec','#9a2f28']:['#eef1f5','#5b6672']);
    var title=d.delivery_challan_no?(K.label+' '+esc(d.delivery_challan_no)):(K.label+' '+esc(d.name));
    return '<div style="display:flex;gap:10px;align-items:baseline;flex-wrap:wrap;background:#e6f1fb;padding:12px 14px;margin:-15px -15px 0">'
      +'<span style="font-size:16px;font-weight:800">'+title+'</span>'
      +(d.delivery_challan_no?'<span style="font-size:12.5px;color:#6b7280">'+esc(d.name)+'</span>':'')
      +'<span style="margin-left:auto;font-size:10.5px;font-weight:700;letter-spacing:.05em;text-transform:uppercase;background:'+stc[0]+';color:'+stc[1]+';border-radius:11px;padding:2px 9px">'+st+'</span></div>'
      +(bits.length?'<div style="padding:9px 14px;font-size:12.5px;color:#6b7280;border-bottom:1px solid #eef1f5;margin:0 -15px">'+bits.join(' &middot; ')+'</div>':'');
  }
  /* the one place a full page load is still offered - and only if he clicks it */
  function fullPageFoot(q){
    return '<div style="display:flex;gap:14px;align-items:center;padding:10px 14px 0;margin:0 -15px;font-size:12px;color:#8a929c">'
      +'<span>Click a block to trace it &mdash; this stays open.</span>'
      +'<a href="/trace-block?q='+encodeURIComponent(q)+'" class="dip-full" style="margin-left:auto;color:#185fa5;font-weight:600">Open the full page &rarr;</a></div>';
  }
  function wireDialog(d,q){
    d.$wrapper.find('.dip-dtrace').on('click',function(e){ e.preventDefault(); openJourney(this.getAttribute('data-n')); });
  }
  function openDocument(v){
    var p=docParse(v); if(!p) return false;
    var K=DOC[p.k];
    docFind(p).then(function(ds){
      if(!ds.length){
        var d0=new frappe.ui.Dialog({title:K.label,fields:[{fieldtype:'HTML',fieldname:'j'}]});
        d0.fields_dict.j.$wrapper.html('<div style="padding:8px 0;font-size:14px">No <b>'+esc(K.label)+'</b> found for &ldquo;'+esc(p.exact||p.part)+'&rdquo;.</div>'
          +'<div style="font-size:12.5px;color:#8a929c">Challan numbers are stored with their leading zeros &mdash; 21, 021 and 0021 are all tried.</div>');
        d0.show(); return;
      }
      if(ds.length>1){
        var dp=new frappe.ui.Dialog({title:ds.length+' documents match that',fields:[{fieldtype:'HTML',fieldname:'j'}]});
        dp.fields_dict.j.$wrapper.html(ds.map(function(x){
          return '<div style="padding:9px 0;border-bottom:1px solid #eef1f5;font-size:13.5px"><a href="#" class="dip-pick" data-n="'+esc(x.name)+'" style="color:#185fa5;font-weight:700">'+esc(x.name)+'</a>'
            +(x.delivery_challan_no?(' &middot; no '+esc(x.delivery_challan_no)):'')
            +' &middot; '+((x.docstatus===1)?'submitted':(x.docstatus===2?'cancelled':'draft'))+'</div>'; }).join(''));
        dp.show();
        dp.$wrapper.find('.dip-pick').on('click',function(e){ e.preventDefault(); dp.hide(); openDocument(this.getAttribute('data-n')); });
        return;
      }
      var doc=ds[0];
      dq(K.child,[['parent','=',doc.name]],K.cf,K.dt).then(function(rows){
        var d=new frappe.ui.Dialog({title:K.label,fields:[{fieldtype:'HTML',fieldname:'j'}]});
        d.fields_dict.j.$wrapper.html(docHead(K,doc)+'<div style="margin:0 -15px">'+docTable(rows)+'</div>'+fullPageFoot(v));
        d.show(); wireDialog(d,v);
      });
    });
    return true;
  }
  /* a range or a list of block numbers, also in a pop-up */
  function expandList(v){
    var t=String(v||'').trim();
    var m=t.match(/^(\d+)\s*(?:-|to|\.\.)\s*(\d+)$/i);
    if(m){
      var a=parseInt(m[1],10), b=parseInt(m[2],10), out=[];
      if(b<a){ var s=a; a=b; b=s; }
      if(b-a>600) b=a+600;
      for(var i=a;i<=b;i++) out.push(String(i));
      return out;
    }
    return t.split(/[\s,\-\/;|]+/).map(function(x){return x.trim();}).filter(Boolean);
  }
  function openList(v){
    var nums=expandList(v); if(!nums.length) return false;
    dq('Quarry Block',[['block_number','in',nums]],['name','block_number','export_block_no','status','length_gross','width_gross','height_gross','gross_volume','gross_tonnage'])
      .then(function(a){
        return dq('Quarry Block',[['export_block_no','in',nums]],['name','block_number','export_block_no','status','length_gross','width_gross','height_gross','gross_volume','gross_tonnage'])
          .then(function(b){
            var seen={}, all=[];
            a.concat(b).forEach(function(r){ if(!seen[r.name]){ seen[r.name]=1; all.push(r); } });
            return all;
          });
      })
      .then(function(rows){
        var d=new frappe.ui.Dialog({title:nums.length+' block numbers',fields:[{fieldtype:'HTML',fieldname:'j'}]});
        var missing=nums.filter(function(n){
          return !rows.some(function(r){ return String(r.block_number)===n || String(r.export_block_no)===n; });
        });
        var body='<div style="margin:0 -15px">'+docTable(rows)+'</div>';
        if(missing.length) body+='<div style="padding:10px 14px 0;margin:0 -15px;font-size:12.5px;color:#8a5a12">Not found: '+esc(missing.join(', '))+'</div>';
        d.fields_dict.j.$wrapper.html(body+fullPageFoot(v));
        d.show(); wireDialog(d,v);
      });
    return true;
  }

  // ---- live partial-match dropdown for the single top trace box ----
  function ensureResultsBox(){
    var box=document.getElementById('dip-trace-results');
    if(!box){ box=document.createElement('div'); box.id='dip-trace-results';
      box.style.cssText='position:absolute;z-index:2000;background:#fff;border:1px solid #d0d5dd;border-radius:8px;box-shadow:0 8px 24px rgba(0,0,0,.14);min-width:280px;max-height:340px;overflow:auto;font-size:13px;display:none';
      document.body.appendChild(box);
      document.addEventListener('click',function(e){ if(!e.target.classList||!e.target.classList.contains('dtq')) box.style.display='none'; });
    }
    return box;
  }
  function searchBlocks(q){
    var p=new URLSearchParams({doctype:'Quarry Block',or_filters:JSON.stringify([['block_number','like','%'+q+'%'],['export_block_no','like','%'+q+'%']]),fields:JSON.stringify(['name','block_number','export_block_no','status']),limit_page_length:8});
    return fetch('/api/method/frappe.client.get_list?'+p.toString(),{credentials:'same-origin'}).then(function(r){return r.json();}).then(function(j){return j.message||[];}).catch(function(){return [];});
  }
  function attachTypeahead(inp){
    if(inp.getAttribute('data-diptype')) return;
    inp.setAttribute('data-diptype','1');
    var box=ensureResultsBox(); var timer=null;
    function place(){ var r=inp.getBoundingClientRect(); box.style.left=(r.left+window.scrollX)+'px'; box.style.top=(r.bottom+window.scrollY+4)+'px'; box.style.width=Math.max(r.width,280)+'px'; }
    /* 23 Aug 2026. This box replaces the theme's own one, so the grammar had to
       land here too. It looks up ONE block; a list, a range and a document number
       are all understood by the Trace page. Recognise those and hand them over
       with ?q= rather than telling him the blocks do not exist - which is what
       "No block matches 214 - 265 - 281 - 286 - 292 - 293" and "No block matches
       dc 057" were really saying. */
    function dipKind(v){
      var t=String(v||'').trim(); if(!t) return null;
      if(/^(dc|bi|qi|arr|lot|inv)\s*[-_: ]?\s*\S+/i.test(t)) return 'document';
      if(/^(DC|LBI|BI|QI|ARR|SL|DI)-/i.test(t)) return 'document';
      if(/^\d+\s*(?:-|to|\.\.)\s*\d+$/i.test(t)) return 'range';
      if(t.indexOf(',')!==-1) return 'list';
      var parts=t.split(/[\s\-\/;|]+/).filter(Boolean);
      if(parts.length>2){ for(var i=0;i<parts.length;i++){ if(!/^[A-Za-z0-9]+$/.test(parts[i])) return null; } return 'list'; }
      return null;
    }
    /* 23 Aug 2026: this used to be window.location.href. It now opens the same
       pop-up a block opens in, so the page underneath survives. The full page is
       a link inside the pop-up, taken only if he asks for it. */
    function dipHandOver(v){
      var t=String(v||'').trim(); if(!t) return;
      var k=dipKind(t);
      if(k==='document'){ if(openDocument(t)) return; }
      if(k==='range'||k==='list'){ if(openList(t)) return; }
      openJourney(t);
    }
    inp.addEventListener('keydown',function(e){ if(e.key==='Enter' && dipKind(inp.value)){ e.preventDefault(); var v=inp.value; box.style.display='none'; inp.value=''; dipHandOver(v); } });
    inp.addEventListener('input',function(){ clearTimeout(timer); var q=(inp.value||'').trim(); if(q.length<1){box.style.display='none';return;}
      var kind=dipKind(q);
      if(kind){
        box.innerHTML='<div class="dip-go" style="padding:10px 12px;cursor:pointer;color:#185fa5;font-weight:600">Open this '
          +(kind==='document'?'document':kind)+' &rarr;</div>'
          +'<div style="padding:0 12px 9px;font-size:11.5px;color:#98a2b3">Opens here, over this page.</div>';
        place(); box.style.display='block';
        var g=box.querySelector('.dip-go'); if(g){ g.addEventListener('mousedown',function(ev){ ev.preventDefault(); box.style.display='none'; inp.value=''; dipHandOver(q); }); }
        return;
      }
      timer=setTimeout(function(){ searchBlocks(q).then(function(rows){
      if(!rows.length){ box.innerHTML='<div style="padding:10px 12px;color:#98a2b3">No block matches &ldquo;'+esc(q)+'&rdquo;</div>'; }
      else { box.innerHTML=rows.map(function(b){var c=SC[b.status]||['#eee','#333'];return '<div class="dip-row" data-b="'+esc(b.block_number||b.name)+'" style="padding:8px 12px;border-bottom:1px solid #f2f4f7;cursor:pointer;display:flex;justify-content:space-between;gap:10px;align-items:center"><span><b>'+esc(b.block_number||b.name)+'</b>'+(b.export_block_no?' <span style="color:#185fa5;font-weight:700">exp '+esc(b.export_block_no)+'</span>':'')+'</span><span style="background:'+c[0]+';color:'+c[1]+';border-radius:10px;padding:1px 8px;font-size:11px">'+esc(b.status||'')+'</span></div>';}).join(''); }
      place(); box.style.display='block';
      Array.prototype.forEach.call(box.querySelectorAll('.dip-row'),function(el){ el.addEventListener('mousedown',function(ev){ ev.preventDefault(); box.style.display='none'; inp.value=''; openJourney(el.getAttribute('data-b')); }); });
    }); },220); });
  }

  function enforce(){
    try{
      var big=document.getElementById('di-trace'); if(big) big.style.display='none';
      document.querySelectorAll('input.dtq').forEach(function(inp){
        if(!inp.getAttribute('data-dip')){
          var c=inp.cloneNode(true); c.setAttribute('data-dip','1'); c.className=inp.className;
          inp.parentNode.replaceChild(c,inp);
          c.addEventListener('keydown',function(ev){ if(ev.key==='Enter'){ ev.preventDefault(); ev.stopPropagation();
            var box=document.getElementById('dip-trace-results');
            var v=(c.value||'').trim();
            /* a document or a list answers for itself; only a bare block number
               falls through to the dropdown's first row */
            if(docParse(v)){ if(box) box.style.display='none'; c.value=''; openDocument(v); return; }
            var first=box&&box.querySelector('.dip-row');
            if(first){ box.style.display='none'; c.value=''; openJourney(first.getAttribute('data-b')); }
            else { openJourney(v); } } });
          attachTypeahead(c);
        } else { attachTypeahead(inp); }
      });
      var bl=document.querySelector('a.di-sm-link[href="/app/dolphin-blocks"]'); if(bl){ var r=bl.closest('.di-sm-row'); if(r) r.style.display='none'; }
      if(!document.querySelector('a.di-sm-link[href="/app/dolphin-stock"]')){
        var qb=document.querySelector('a.di-sm-link[href="/app/quarry-block"]'); var qrow=qb&&qb.closest('.di-sm-row');
        if(qrow){ var nrow=qrow.cloneNode(true); nrow.setAttribute('data-dip','1'); var link=nrow.querySelector('a.di-sm-link'); link.setAttribute('href','/app/dolphin-stock'); var extra=nrow.querySelectorAll('a'); for(var i=1;i<extra.length;i++) extra[i].remove(); var set=false; link.childNodes.forEach(function(n){ if(n.nodeType===3 && n.textContent.trim()){ n.textContent='Stock Dashboard'; set=true; } }); if(!set) link.appendChild(document.createTextNode('Stock Dashboard')); qrow.parentNode.insertBefore(nrow, qrow); }
      }
    }catch(e){}
  }
  function boot(){ enforce(); }
  $(document).on("app_ready", boot);
  if (frappe.router && frappe.router.on) { frappe.router.on("change", boot); }

/* Pending Loading side-menu item (added 27 Jul 2026) */
(function(){
  function addPending(){
    try{
      if(document.querySelector('a.di-sm-link[href="/app/loading-desk"]')) return;
      var src = document.querySelector('a.di-sm-link[href="/app/quarry-block"]');
      var srow = src && src.closest('.di-sm-row');
      if(!srow) return;
      var anchor = document.querySelector('a.di-sm-link[href="/app/buyer-inspection"]');
      var arow = (anchor && anchor.closest('.di-sm-row')) || srow;
      var nrow = srow.cloneNode(true);
      nrow.setAttribute('data-dip-pending','1');
      var link = nrow.querySelector('a.di-sm-link');
      link.setAttribute('href','/app/loading-desk');
      var extra = nrow.querySelectorAll('a');
      for(var i=1;i<extra.length;i++) extra[i].remove();
      var set=false;
      link.childNodes.forEach(function(n){ if(n.nodeType===3 && n.textContent.trim()){ n.textContent='Pending Loading'; set=true; } });
      if(!set) link.appendChild(document.createTextNode('Pending Loading'));
      if(arow.nextSibling) arow.parentNode.insertBefore(nrow, arow.nextSibling); else arow.parentNode.appendChild(nrow);
    }catch(e){}
  }
  function boot2(){ addPending(); }
  $(document).on("app_ready", boot2);
  if (frappe.router && frappe.router.on) { frappe.router.on("change", boot2); }
  setInterval(boot2, 1200);
  setTimeout(boot2, 800); setTimeout(boot2, 2200);
})();
/* Highlight traced block row in QI/BI report preview (added 28 Jul 2026) */
(function(){
  function __htTarget(){
    try{
      var hs=document.querySelectorAll('.modal-title, .modal-header h4, .modal-header h3');
      for(var i=0;i<hs.length;i++){ var m=(hs[i].textContent||'').match(/Block\s+([^\s\u2013\u2014\-]+)\s*[\u2013\u2014\-]\s*journey/i); if(m) return m[1]; }
      if(window.cur_frm && cur_frm.doctype==='Quarry Block' && cur_frm.doc && cur_frm.doc.block_number) return String(cur_frm.doc.block_number);
      var q=document.getElementById('di-trace'); if(q && q.value && String(q.value).trim()) return String(q.value).trim();
    }catch(e){}
    return '';
  }
  function __htPaint(){
    var t=__htTarget(); if(!t) return;
    var frames=document.querySelectorAll('.modal iframe, .modal-dialog iframe');
    for(var k=0;k<frames.length;k++){
      var d; try{ d=frames[k].contentDocument; }catch(e){ continue; }
      if(!d) continue;
      var rows=d.querySelectorAll('table tr');
      for(var r=0;r<rows.length;r++){
        var tr=rows[r]; if(tr.getAttribute('data-hltrace')==='1') continue;
        var td=tr.querySelectorAll('td,th');
        for(var i=1;i<=2 && i<td.length;i++){ if(td[i].textContent.trim()===String(t)){ tr.setAttribute('data-hltrace','1'); for(var c=0;c<td.length;c++){ td[c].style.background='#fff28a'; } break; } }
      }
    }
  }
  var __htObs=new MutationObserver(function(){ clearTimeout(window.__htPT); window.__htPT=setTimeout(__htPaint,200); });
  __htObs.observe(document.body,{childList:true,subtree:true});
  setInterval(__htPaint,700);
})();
  setInterval(boot, 1200);
  setTimeout(boot, 800); setTimeout(boot, 2200);
})();
/* 3f: give the Pending Loading side-menu item an icon (its row is cloned from an
   icon-less item, so it renders blank next to the anchor/pencil/ship rows).
   Self-healing + reversible, same pattern as the blocks above. */
(function(){
  function addPendingIcon(){
    try{
      var a=document.querySelector('a.di-sm-link[href="/app/loading-desk"]');
      if(!a || a.querySelector('svg')) return;
      var ns='http://www.w3.org/2000/svg';
      var s=document.createElementNS(ns,'svg');
      [['width','14'],['height','14'],['viewBox','0 0 24 24'],['fill','none'],['stroke','currentColor'],['stroke-width','2'],['stroke-linecap','round'],['stroke-linejoin','round']].forEach(function(x){ s.setAttribute(x[0],x[1]); });
      var c=document.createElementNS(ns,'circle'); c.setAttribute('cx','12'); c.setAttribute('cy','12'); c.setAttribute('r','10');
      var p=document.createElementNS(ns,'polyline'); p.setAttribute('points','12 6 12 12 16 14');
      s.appendChild(c); s.appendChild(p);
      a.insertBefore(s, a.firstChild);
    }catch(e){}
  }
  $(document).on("app_ready", addPendingIcon);
  if (frappe.router && frappe.router.on) { frappe.router.on("change", addPendingIcon); }
  setInterval(addPendingIcon, 1300);
  setTimeout(addPendingIcon, 900); setTimeout(addPendingIcon, 2300);
})();
