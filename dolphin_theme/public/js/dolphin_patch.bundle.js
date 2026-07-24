/* Dolphin Theme — post-bundle patch (self-healing, fully reversible).
   Remove this file + its line in hooks.py app_include_js to revert everything below.
   Purpose:
     1. Exactly ONE "Trace a block" box (top bar) — hides the big #di-trace box and
        the dashboard's inline trace; makes the top box open the block journey popup
        showing the real block number (not the internal id).
     2. Removes the "Blocks" side-menu item and adds a "Stock Dashboard" item.
   Runs on load + every route change + a light interval, so no future deploy can
   bring the duplicates back. */
frappe.provide("dolphin");
(function () {
  var SC = {'In Stock':['#eaf3de','#3b6d11'],'Buyer Marked':['#faeeda','#854f0b'],'In Delivery Challan':['#e6f1fb','#0c447c'],'Dispatched/Transported':['#e6f1fb','#0c447c'],'At Port':['#eeedfe','#3c3489'],'At Bannikoppa Station yard':['#eeedfe','#3c3489'],'Shipped':['#e1f5ee','#0f6e56'],'Sold':['#f1efe8','#444441']};
  var RANK = {'In Stock':0,'Buyer Marked':1,'In Delivery Challan':2,'Dispatched/Transported':3,'At Port':4,'At Bannikoppa Station yard':4,'Shipped':5,'Sold':6};
  var FL = ['name','block_number','export_block_no','status','delivery_challan','buyer_inspection','source_quarry_inspection','granite_quality_grade','length_gross','width_gross','height_gross','gross_volume'];
  function esc(s){ return frappe.utils.escape_html(s==null?'':(''+s)); }
  function pdf(dt,nm,fmt){ return '/api/method/frappe.utils.print_format.download_pdf?doctype='+encodeURIComponent(dt)+'&name='+encodeURIComponent(nm)+'&format='+encodeURIComponent(fmt)+'&no_letterhead=0'; }
  function eyeLink(dt,nm,fmt){ return nm?' <a href="'+pdf(dt,nm,fmt)+'" target="_blank" style="font-size:11px;border:1px solid #185fa5;color:#185fa5;border-radius:10px;padding:1px 8px;text-decoration:none;margin-left:6px">&#128065; PDF</a>':''; }
  function journeyHTML(b){
    var sc = SC[b.status]||['#f1efe8','#444441']; var rank=(b.status in RANK)?RANK[b.status]:0;
    var steps=[{l:'Quarried',v:b.block_number||b.name,done:true},
      {l:'Quarry Inspection',v:b.source_quarry_inspection||'not yet',done:!!b.source_quarry_inspection,e:eyeLink('Quarry Inspection',b.source_quarry_inspection,'Quarry Inspection - Report')},
      {l:'Buyer Inspection',v:b.buyer_inspection||'not yet',done:!!b.buyer_inspection,e:eyeLink('Buyer Inspection',b.buyer_inspection,'Buyer Inspection - Report')},
      {l:'Delivery Challan',v:b.delivery_challan||'not yet',done:!!b.delivery_challan,e:eyeLink('Delivery Challan',b.delivery_challan,'Dolphin Delivery Challan')},
      {l:'Transported',v:(rank>=3?(b.export_block_no||'yes'):'not yet'),done:rank>=3},
      {l:'At Port',v:(rank>=4?(b.export_block_no||'yes'):'not yet'),done:rank>=4},
      {l:'Shipped',v:(rank>=5?(b.export_block_no||'yes'):'not yet'),done:rank>=5}];
    var head='<div style="margin-bottom:10px">Current status: <b style="background:'+sc[0]+';color:'+sc[1]+';padding:2px 12px;border-radius:12px">'+esc(b.status||'')+'</b></div>';
    var body=steps.map(function(s,i){var cur=(!s.done&&i>0&&steps[i-1].done);var col=s.done?'#0f6e56':(cur?'#b8860b':'#c2c8d0');var dot=s.done?'&#9679;':(cur?'&#9673;':'&#9675;');return '<div style="display:flex;gap:12px;align-items:flex-start;padding:7px 0;border-bottom:1px solid #f2f4f7"><span style="color:'+col+';font-size:17px">'+dot+'</span><div><div style="font-size:10.5px;text-transform:uppercase;color:#8a929c">'+s.l+'</div><div style="font-weight:600;color:'+(s.done?'#1f2a3a':(cur?'#7a5a00':'#aab1ba'))+'">'+esc(''+s.v)+(s.e||'')+'</div></div></div>';}).join('');
    return '<div>'+head+body+'</div>';
  }
  function openJourney(bno){
    if(!bno) return;
    function q(f){ return frappe.call({method:'frappe.client.get_list',args:{doctype:'Quarry Block',filters:f,fields:FL,limit_page_length:5}}).then(function(r){return r.message||[];}); }
    q([['block_number','=',bno]]).then(function(bl){return bl.length?bl:q([['export_block_no','=',bno]]);}).then(function(bl){return bl.length?bl:q([['name','=',bno]]);}).then(function(bl){
      if(!bl.length){ frappe.msgprint('Block '+esc(bno)+' not found in stock records.'); return; }
      var b=bl[0]; var d=new frappe.ui.Dialog({title:'Block '+esc(b.block_number||b.name)+' — journey',fields:[{fieldtype:'HTML',fieldname:'j'}]});
      d.fields_dict.j.$wrapper.html(journeyHTML(b)); d.show();
    });
  }
  window.dolphin_open_journey = openJourney;

  function enforce(){
    try{
      // 1a. hide the big TRACE A BLOCK box (keep only the top-bar trace)
      var big=document.getElementById('di-trace'); if(big) big.style.display='none';
      // 1b. hide any inline "Trace a block" that a page injects (dashboard iframe handled in the page itself)
      // 1c. make the single top-bar trace open the journey popup (strip old handlers once)
      document.querySelectorAll('input.dtq').forEach(function(inp){
        if(inp.getAttribute('data-dip')) return;
        var c=inp.cloneNode(true); c.setAttribute('data-dip','1');
        inp.parentNode.replaceChild(c,inp);
        c.addEventListener('keydown',function(ev){ if(ev.key==='Enter'){ ev.preventDefault(); ev.stopPropagation(); openJourney((c.value||'').trim()); } });
      });
      // 2a. hide the Blocks menu item
      var bl=document.querySelector('a.di-sm-link[href="/app/dolphin-blocks"]'); if(bl){ var r=bl.closest('.di-sm-row'); if(r) r.style.display='none'; }
      // 2b. add a Stock Dashboard menu item (once), cloned from Quarry Block row for styling
      if(!document.querySelector('a.di-sm-link[href="/app/dolphin-stock"]')){
        var qb=document.querySelector('a.di-sm-link[href="/app/quarry-block"]'); var qrow=qb&&qb.closest('.di-sm-row');
        if(qrow){
          var nrow=qrow.cloneNode(true); nrow.setAttribute('data-dip','1');
          var link=nrow.querySelector('a.di-sm-link'); link.setAttribute('href','/app/dolphin-stock');
          var extra=nrow.querySelectorAll('a'); for(var i=1;i<extra.length;i++) extra[i].remove();
          var set=false; link.childNodes.forEach(function(n){ if(n.nodeType===3 && n.textContent.trim()){ n.textContent='Stock Dashboard'; set=true; } });
          if(!set) link.appendChild(document.createTextNode('Stock Dashboard'));
          qrow.parentNode.insertBefore(nrow, qrow);
        }
      }
    }catch(e){}
  }
  function boot(){ enforce(); }
  $(document).on("app_ready", boot);
  if (frappe.router && frappe.router.on) { frappe.router.on("change", boot); }
  setInterval(boot, 1200);
  setTimeout(boot, 800); setTimeout(boot, 2200);
})();
