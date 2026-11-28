/* «استهلاك أمس» (owner 2026-11-22, mockup docs/ui-references/mockups/inventory-supplies-flow.html — «الشكل تمام»).
   Reception records, the next morning, the supplies used INSIDE each service of each visit (the patient doesn't pay for
   them). Every line leaves the store at its real purchase cost (FEFO), posted as service cost. Supplies the patient pays
   for stay on «صرف مستلزم إضافي لمريض» at the sale price.
   Server: public.clinic_reception_visit_usage(workspace, 'list'|'save', payload) — 20261122270000.
   Hook: SSMPDVisitUsage.decorate(context, section) from reception-workspace.js (small card + sheet, like «تذكيرات غداً»). */
(function(w,d){'use strict';
var TABS=[['missing','ناقص'],['done','اتسجل'],['all','الكل']];
function esc(v){return String(v==null?'':v).replace(/[&<>"']/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c];});}
function money(n){return Number(n||0).toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:2});}
function qty(n){return Number(n||0).toLocaleString('en-US',{maximumFractionDigits:3});}
function client(){return w.SSMPDDb&&w.SSMPDDb.client;}
function uuid(){return w.crypto&&w.crypto.randomUUID?w.crypto.randomUUID():'xxxxxxxx-xxxx-4xxx-8xxx-xxxxxxxxxxxx'.replace(/x/g,function(){return (Math.random()*16|0).toString(16);});}
function rpc(ws,a,p){var c=client();if(!c)return Promise.reject(new Error('تعذر الاتصال'));return Promise.resolve(c.rpc('clinic_reception_visit_usage',{p_workspace:ws,p_action:a,p_payload:p||{}})).then(function(r){if(r&&r.error)throw r.error;return r.data;});}
function toast(m,k){if(w.SSMPDToast&&w.SSMPDToast.show)w.SSMPDToast.show(m,k||'success');}
function cairoDay(offset){var t=new Date(Date.now()+(offset||0)*864e5);return t.toLocaleDateString('en-CA',{timeZone:'Africa/Cairo'});}
var state={ws:null,ctx:null,day:null,tab:'missing',rows:[],counts:null,items:[],locations:[],sel:null,drafts:{},tokens:{},busy:false,open:false,err:null};
/* Default store by department: dental → «رئيسي أسنان»; everything else (skin, physio, consultation…) → the nursing sub. */
function defaultLocation(dep){var L=state.locations,dental=/أسنان|اسنان|dental/i.test(dep||'');
 var hit=L.filter(function(l){return dental?/أسنان|اسنان/.test(l.name):(!l.main&&/تمريض/.test(l.name));})[0];return (hit||L.filter(function(l){return !l.main;})[0]||L[0]||{}).id||'';}
function item(id){return state.items.filter(function(i){return i.id===id;})[0];}
function stockAt(i,loc){return i&&i.stock?Number(i.stock[loc]||0):0;}
function draft(o){if(!state.drafts[o.order_id])state.drafts[o.order_id]={loc:defaultLocation(o.department),lines:[]};return state.drafts[o.order_id];}
function rowsShown(){return state.rows.filter(function(r){return state.tab==='all'||(state.tab==='done'?r.done:!r.done);});}
function itemOptions(){return '<option value="">اختار المستلزم</option>'+state.items.map(function(i){return '<option value="'+esc(i.id)+'">'+esc(i.name)+' — '+esc(i.unit)+'</option>';}).join('');}
/* owner 2026-11-28 «سعر التكلفة يظهر فقط للمحاسب والمدير المالي، المالك، السوبر ادمن»: the server (20261128140000) no longer
   sends cost to anyone else and says can_see_cost:false → every cost column / total / KPI is left out of the screen. */
function cc(){return state.canCost!==false;}
function locOptions(sel){return state.locations.map(function(l){return '<option value="'+esc(l.id)+'"'+(l.id===sel?' selected':'')+'>'+esc(l.name)+'</option>';}).join('');}
function orderHtml(o){
 if(o.usage_status==='none')return '<div class="rvu-svc done"><div class="rvu-svc-h"><b>'+esc(o.service)+'</b><span class="rvu-chip ok">مفيش مستلزمات — '+esc(o.usage_by||'')+'</span></div></div>';
 if(o.usage_status==='recorded')return '<div class="rvu-svc done"><div class="rvu-svc-h"><b>'+esc(o.service)+'</b><span class="rvu-chip ok">اتسجل — '+esc(o.usage_by||'')+(o.usage_time?' <bdi dir="ltr">'+esc(o.usage_time)+'</bdi>':'')+'</span></div>'+
  '<table class="rvu-t"><thead><tr><th>المستلزم</th><th>من مخزن</th><th>الكمية</th>'+(cc()?'<th>التكلفة</th>':'')+'</tr></thead><tbody>'+(o.lines||[]).map(function(l){return '<tr><td>'+esc(l.item)+'</td><td>'+esc(l.location)+'</td><td dir="ltr">'+qty(l.quantity)+' '+esc(l.unit)+'</td>'+(cc()?'<td dir="ltr">'+money(l.cost)+'</td>':'')+'</tr>';}).join('')+'</tbody></table>'+
  (cc()?'<p class="rvu-sum">تكلفة الخدمة <b dir="ltr">'+money(o.total_cost)+' ج</b></p>':'')+'</div>';
 if(!state.canSave)return '<div class="rvu-svc"><div class="rvu-svc-h"><b>'+esc(o.service)+'</b><span class="rvu-chip bad">ناقص</span></div><p class="rvu-avail">تسجيل الاستهلاك للاستقبال اللي معاه صلاحية التحصيل. إنت تقدر تشوف بس.</p></div>';
 var dr=draft(o),est=0,lines=dr.lines.map(function(l,ix){var i=item(l.item_id),c=i?Number(i.cost)*Number(l.quantity||0):0;est+=c;
  return '<tr data-rvu-line="'+ix+'"><td>'+esc(i?i.name:'')+'</td><td>'+esc((state.locations.filter(function(x){return x.id===l.location_id;})[0]||{}).name||'')+'</td><td><input class="rvu-q" inputmode="decimal" data-rvu-qty="'+ix+'" value="'+esc(l.quantity)+'" aria-label="الكمية"></td>'+(cc()?'<td dir="ltr">'+(i?money(i.cost):'')+'</td><td dir="ltr">'+money(c)+'</td>':'')+'<td><button type="button" class="rvu-x" data-rvu-del="'+ix+'" aria-label="شيل السطر">✕</button></td></tr>';}).join('');
 return '<div class="rvu-svc" data-rvu-order="'+esc(o.order_id)+'"><div class="rvu-svc-h"><b>'+esc(o.service)+'</b>'+(o.department?'<span class="rvu-chip">'+esc(o.department)+'</span>':'')+(Number(o.bom_cost)>0||o.bom?'<span class="rvu-chip ok">اتخصم مع تنفيذ الخدمة'+(cc()&&Number(o.bom_cost)>0?' '+money(o.bom_cost)+' ج':'')+'</span>':'')+'</div>'+
  (lines?'<table class="rvu-t"><thead><tr><th>المستلزم</th><th>من مخزن</th><th>الكمية</th>'+(cc()?'<th>سعر الشراء</th><th>التكلفة</th>':'')+'<th></th></tr></thead><tbody>'+lines+'</tbody></table>':'')+
  '<div class="rvu-add"><select data-rvu-item aria-label="المستلزم">'+itemOptions()+'</select><select data-rvu-loc aria-label="من مخزن">'+locOptions(dr.loc)+'</select><input class="rvu-q" data-rvu-newq inputmode="decimal" placeholder="الكمية" aria-label="الكمية"><button type="button" class="btn" data-rvu-addline>+ مستلزم</button></div>'+
  '<p class="rvu-avail" data-rvu-avail></p>'+
  '<div class="rvu-foot"><span>'+(cc()?'تكلفة تقريبية <b dir="ltr">'+money(est)+' ج</b>':'')+'</span><span class="rvu-acts"><button type="button" class="btn" data-rvu-none>مفيش مستلزمات</button><button type="button" class="btn btn-primary" data-rvu-save'+(dr.lines.length?'':' disabled')+'>حفظ استهلاك الخدمة</button></span></div></div>';}
function detailHtml(){var r=state.rows.filter(function(x){return x.visit_id===state.sel;})[0];if(!r)return '<p class="rvu-empty">اختار زيارة من القايمة.</p>';
 return '<div class="rvu-pat"><span><b>'+esc(r.patient)+'</b> · ملف <bdi dir="ltr">'+esc(r.file_no)+'</bdi> · زيارة <bdi dir="ltr">'+esc(r.visit_no)+'</bdi> · <bdi dir="ltr">'+esc(r.time||'')+'</bdi></span><span>الخدمات: '+r.orders.length+'</span></div>'+r.orders.map(orderHtml).join('')+
  '<p class="rvu-note">المستلزمات دي داخلة في الخدمة، والمريض مش بيدفعها. بتتخصم من المخزن وتتسجل '+(cc()?'بسعر الشراء كتكلفة ':'')+'على الخدمة. اللي بيدفعه المريض بيتسجل من «صرف مستلزم إضافي لمريض» على فاتورته بسعر البيع.</p>';}
function sheetHtml(){var c=state.counts||{},rows=rowsShown();
 return '<div class="rvu" data-rvu-sheet><div class="rvu-top"><label class="rvu-date">تاريخ الزيارات <input type="date" data-rvu-day value="'+esc(state.day||'')+'" max="'+cairoDay(0)+'" min="'+cairoDay(-14)+'"></label>'+
  '<div class="rvu-tabs" role="tablist">'+TABS.map(function(t){var n=t[0]==='all'?c.all:t[0]==='done'?c.done:c.missing;return '<button type="button" role="tab" class="rvu-tab'+(state.tab===t[0]?' on':'')+'" aria-selected="'+(state.tab===t[0])+'" data-rvu-tab="'+t[0]+'">'+t[1]+' '+(+n||0)+'</button>';}).join('')+'</div></div>'+
  '<div class="rvu-kpis'+(cc()?'':' is-3')+'"><div class="rvu-kpi"><small>زيارات اليوم</small><b>'+(+c.all||0)+'</b></div><div class="rvu-kpi"><small>اتسجل استهلاكها</small><b class="ok">'+(+c.done||0)+'</b></div><div class="rvu-kpi"><small>لسه ناقصة</small><b class="bad">'+(+c.missing||0)+'</b></div>'+(cc()?'<div class="rvu-kpi hero"><small>تكلفة المستلزمات (سعر الشراء)</small><b dir="ltr">'+money(c.cost)+' ج</b></div>':'')+'</div>'+
  (state.err?'<p class="rvu-empty">تعذر التحميل — '+esc(state.err)+' <button type="button" class="btn" data-rvu-retry>حاول تاني</button></p>':
  '<div class="rvu-cols"><div class="rvu-list">'+(rows.length?rows.map(function(r){return '<button type="button" class="rvu-v'+(r.visit_id===state.sel?' sel':'')+'" data-rvu-visit="'+esc(r.visit_id)+'"><span class="rvu-r"><b>'+esc(r.patient)+'</b><span class="rvu-chip '+(r.done?'ok':'bad')+'">'+(r.done?'اتسجل':'ناقص')+'</span></span><span class="rvu-m">ملف <bdi dir="ltr">'+esc(r.file_no)+'</bdi> · <bdi dir="ltr">'+esc(r.time||'')+'</bdi></span><span class="rvu-r rvu-svcs">'+r.orders.map(function(o){return '<span class="rvu-chip">'+esc(o.service)+'</span>';}).join('')+'</span></button>';}).join(''):'<p class="rvu-empty">'+(state.counts&&!c.all?'مفيش زيارات في اليوم ده.':'مفيش زيارات هنا.')+'</p>')+'</div>'+
  '<div class="rvu-detail">'+detailHtml()+'</div></div>')+'</div>';}
function miniTitle(){return 'استهلاك أمس';}
function render(){var host=state.ctx&&state.ctx.host;if(!host||!host.isConnected)return;var M=w.SSMPDMiniCards;if(!M)return;var c=state.counts||{};
 var el=M.slot(host,'rvu',3);el.setAttribute('aria-label',miniTitle()+' — افتح التفاصيل');
 el.innerHTML='<h4>'+esc(miniTitle())+'</h4><span class="go">افتح ‹</span><span class="nums"><span class="n wait"><b>'+(+c.missing||0)+'</b> ناقص</span><span class="n ok"><b>'+(+c.done||0)+'</b> اتسجل</span></span>';
 el.onclick=function(){state.open=true;render();};
 if(!state.open){M.sheet('rvu',null,null);return;}
 var box=d.createElement('div');box.innerHTML=sheetHtml();var card=box.firstChild;M.sheet('rvu',miniTitle()+(state.day?' — '+state.day:''),card,function(){state.open=false;});wire(card);}
function load(){return rpc(state.ws,'list',{day:state.day}).then(function(r){state.err=null;state.rows=(r&&r.rows)||[];state.counts=(r&&r.counts)||{};state.items=(r&&r.items)||[];state.locations=(r&&r.locations)||[];state.canSave=!!(r&&r.can_save);state.canCost=!(r&&r.can_see_cost===false);state.day=(r&&r.day)||state.day;
  if(!state.rows.some(function(x){return x.visit_id===state.sel;})){var first=rowsShown()[0]||state.rows[0];state.sel=first?first.visit_id:null;}render();})
 .catch(function(e){state.err=(e&&e.message)||'خطأ';state.rows=[];render();});}
function save(orderId,none){if(state.busy)return;var r=state.rows.filter(function(x){return x.visit_id===state.sel;})[0];if(!r)return;var dr=state.drafts[orderId]||{lines:[]};
 var lines=none?[]:dr.lines.map(function(l){return {item_id:l.item_id,location_id:l.location_id,quantity:Number(l.quantity)};});
 if(!none&&(!lines.length||lines.some(function(l){return !(l.quantity>0);}))){toast('اكتب كمية صحيحة لكل مستلزم','error');return;}
 var key=orderId+(none?':none':':lines');if(!state.tokens[key])state.tokens[key]=uuid();
 state.busy=true;rpc(state.ws,'save',{visit_id:r.visit_id,order_id:orderId,none:!!none,lines:lines,token:state.tokens[key]})
  .then(function(res){delete state.drafts[orderId];delete state.tokens[key];toast(none?'اتسجل «مفيش مستلزمات»':'اتسجل الاستهلاك واتخصم من المخزن'+(cc()&&res&&res.total_cost!=null?' — '+money(res.total_cost)+' ج':''));return load();})
  .catch(function(x){toast((x&&x.message)||'تعذر الحفظ','error');}).then(function(){state.busy=false;});}
function wire(card){
 card.addEventListener('change',function(e){var t=e.target;
  if(t.hasAttribute('data-rvu-day')){state.day=t.value||cairoDay(-1);state.sel=null;load();return;}
  if(t.hasAttribute('data-rvu-qty')){var o=t.closest('[data-rvu-order]').getAttribute('data-rvu-order');state.drafts[o].lines[+t.getAttribute('data-rvu-qty')].quantity=t.value;render();return;}
  if(t.hasAttribute('data-rvu-loc')){var o2=t.closest('[data-rvu-order]').getAttribute('data-rvu-order');state.drafts[o2].loc=t.value;}
  if(t.hasAttribute('data-rvu-item')||t.hasAttribute('data-rvu-loc')){var box=t.closest('[data-rvu-order]'),i=item(box.querySelector('[data-rvu-item]').value),loc=box.querySelector('[data-rvu-loc]').value;
   box.querySelector('[data-rvu-avail]').textContent=i?'المتاح في المخزن ده: '+qty(stockAt(i,loc))+' '+i.unit+(cc()&&i.cost!=null?' · سعر الشراء '+money(i.cost)+' ج':''):'';}});
 card.addEventListener('click',function(e){var t=e.target.closest&&e.target.closest('[data-rvu-tab],[data-rvu-visit],[data-rvu-addline],[data-rvu-del],[data-rvu-save],[data-rvu-none],[data-rvu-retry]');if(!t)return;
  if(t.hasAttribute('data-rvu-retry'))return load();
  if(t.hasAttribute('data-rvu-tab')){state.tab=t.getAttribute('data-rvu-tab');return render();}
  if(t.hasAttribute('data-rvu-visit')){state.sel=t.getAttribute('data-rvu-visit');return render();}
  var box=t.closest('[data-rvu-order]'),o=box&&box.getAttribute('data-rvu-order');if(!o)return;
  if(t.hasAttribute('data-rvu-addline')){var id=box.querySelector('[data-rvu-item]').value,loc=box.querySelector('[data-rvu-loc]').value,q=Number(box.querySelector('[data-rvu-newq]').value);
   if(!id){toast('اختار المستلزم','error');return;}if(!(q>0)){toast('اكتب الكمية','error');return;}
   var dr=state.drafts[o],same=dr.lines.filter(function(l){return l.item_id===id&&l.location_id===loc;})[0];if(same)same.quantity=Number(same.quantity)+q;else dr.lines.push({item_id:id,location_id:loc,quantity:q});dr.loc=loc;return render();}
  if(t.hasAttribute('data-rvu-del')){state.drafts[o].lines.splice(+t.getAttribute('data-rvu-del'),1);return render();}
  if(t.hasAttribute('data-rvu-save'))return save(o,false);
  if(t.hasAttribute('data-rvu-none'))return save(o,true);});}
function decorate(c,section){if(!c||!c.host||!c.data||!c.data.workspace||c.data.workspace.mode!=='live')return;if(section&&section!=='operations'&&section!=='appointments')return;
 state.ctx=c;state.ws=c.data.workspace.id||c.workspace;if(!state.day)state.day=cairoDay(-1);render();load();}
w.SSMPDVisitUsage={decorate:decorate,load:load,state:state,_t:{defaultLocation:defaultLocation,sheetHtml:sheetHtml,cairoDay:cairoDay}};
})(window,document);
