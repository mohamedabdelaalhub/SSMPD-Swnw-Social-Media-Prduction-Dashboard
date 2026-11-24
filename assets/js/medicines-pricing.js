/* Medicines store (owner 2026-11-22 «طبقه», mockup docs/ui-references/mockups/medicines-store.html).
   1) «تسعير الأصناف» (inventory → الأصناف والأسعار): each item is a supply (cost + 35% or its own %), a regular medicine
      (public price, no markup) or a shortage medicine (cost + margin, default 35%). RPCs: inventory_pricing_list,
      inventory_set_pricing_kind.
   2) «خصم آخر الشهر» + «تقرير الأدوية» (accounting → الموردون): the accountant records a supplier's month-end discount
      on that month's invoices (shortage medicines excluded); the financial manager reviews it. RPC:
      clinic_finance_supplier_discount (20261122300000). Finance layer: wraps SSMPDFinanceControls for tab 'suppliers'. */
(function(w,d){'use strict';
var KINDS=[['supply','مستلزمات — سعر الشراء + نسبة'],['medicine','دواء عادي — بسعر الجمهور'],['shortage','دواء ناقص — سعر الشراء + نسبة']];
var STATUS={pending:'مستني مراجعة المدير المالي',approved:'اتراجع واتسجل',rejected:'مرفوض',missing:'لسه مستني الخصم'};
function esc(v){return String(v==null?'':v).replace(/[&<>"']/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c];});}
function money(n){return Number(n||0).toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:2});}
function client(){return w.SSMPDDb&&w.SSMPDDb.client;}
function call(name,args){var c=client();if(!c)return Promise.reject(new Error('تعذر الاتصال'));return Promise.resolve(c.rpc(name,args||{})).then(function(r){if(r&&r.error)throw r.error;return r.data;});}
function toast(m,k){if(w.SSMPDToast&&w.SSMPDToast.show)w.SSMPDToast.show(m,k||'success');}
function uuid(){return w.crypto&&w.crypto.randomUUID?w.crypto.randomUUID():'xxxxxxxx-xxxx-4xxx-8xxx-xxxxxxxxxxxx'.replace(/x/g,function(){return (Math.random()*16|0).toString(16);});}
function thisMonth(){return new Date().toLocaleDateString('en-CA',{timeZone:'Africa/Cairo'}).slice(0,7);}
function sheet(key,title,html,wire){var M=w.SSMPDMiniCards;if(!M){toast('تعذر فتح الشاشة','error');return null;}var box=d.createElement('div');box.innerHTML=html;var el=box.firstChild;M.sheet(key,title,el,function(){});if(wire)wire(el);return el;}

/* ---------- 1) item pricing ---------- */
function pricing(onDone){var st={rows:[],q:'',kind:''};
 function preview(r,kind,m){var base=Number(r.purchase_price||0);if(!base)return '—';return money(kind==='medicine'?base:base*(1+Number(m||0)/100));}
 function html(){var rows=st.rows.filter(function(r){return (!st.kind||r.pricing_kind===st.kind)&&(!st.q||String(r.name).indexOf(st.q)>=0);});
  return '<div class="mdp" data-mdp><div class="mdp-top"><input data-mdp-q placeholder="دوّر باسم الصنف" value="'+esc(st.q)+'" aria-label="بحث"><select data-mdp-kind aria-label="النوع"><option value="">كل الأنواع</option>'+KINDS.map(function(k){return '<option value="'+k[0]+'"'+(st.kind===k[0]?' selected':'')+'>'+esc(k[1])+'</option>';}).join('')+'</select></div>'+
   '<p class="mdp-note">الدواء العادي بيتباع بسعر الجمهور اللي اتشرى بيه، ومفيش عليه نسبة. المستلزمات والدواء الناقص: سعر الشراء + النسبة (الافتراضي 35%). الدواء الناقص مش بيدخل في خصم آخر الشهر.</p>'+
   '<div class="mdp-tw"><table class="mdp-t"><thead><tr><th>الصنف</th><th>نوع التسعير</th><th>النسبة %</th><th>سعر الشراء</th><th>سعر البيع الجديد</th><th></th></tr></thead><tbody>'+
   (rows.length?rows.map(function(r){return '<tr data-mdp-row="'+esc(r.id)+'"><td>'+esc(r.name)+'<small> — '+esc(r.unit)+'</small></td><td><select data-mdp-k aria-label="نوع التسعير">'+KINDS.map(function(k){return '<option value="'+k[0]+'"'+(r.pricing_kind===k[0]?' selected':'')+'>'+esc(k[1])+'</option>';}).join('')+'</select></td>'+
    '<td><input data-mdp-m inputmode="decimal" value="'+(r.pricing_kind==='medicine'?0:Number(r.markup_percent))+'"'+(r.pricing_kind==='medicine'?' disabled':'')+' aria-label="النسبة"></td><td dir="ltr">'+(r.purchase_price==null?'لسه متشرّاش':money(r.purchase_price))+'</td><td dir="ltr" data-mdp-p>'+preview(r,r.pricing_kind,r.markup_percent)+'</td><td><button type="button" class="btn" data-mdp-save>حفظ</button></td></tr>';}).join(''):'<tr><td colspan="6">مفيش أصناف هنا.</td></tr>')+'</tbody></table></div></div>';}
 function draw(){var el=sheet('mdp','تسعير الأصناف',html(),wire);if(el){var q=el.querySelector('[data-mdp-q]');if(st.focus){q.focus();q.setSelectionRange(q.value.length,q.value.length);st.focus=false;}}}
 function row(id){return st.rows.filter(function(r){return r.id===id;})[0];}
 function wire(el){
  el.querySelector('[data-mdp-q]').oninput=function(){st.q=this.value.trim();st.focus=true;draw();};
  el.querySelector('[data-mdp-kind]').onchange=function(){st.kind=this.value;draw();};
  el.addEventListener('change',function(e){var tr=e.target.closest('[data-mdp-row]');if(!tr)return;var r=row(tr.getAttribute('data-mdp-row')),k=tr.querySelector('[data-mdp-k]').value,mi=tr.querySelector('[data-mdp-m]');
   if(e.target.hasAttribute('data-mdp-k')){if(k==='medicine'){mi.value=0;mi.disabled=true;}else{mi.disabled=false;if(Number(mi.value)===0)mi.value=35;}}
   tr.querySelector('[data-mdp-p]').textContent=preview(r,k,mi.value);});
  el.addEventListener('click',function(e){var b=e.target.closest('[data-mdp-save]');if(!b)return;var tr=b.closest('[data-mdp-row]'),id=tr.getAttribute('data-mdp-row'),k=tr.querySelector('[data-mdp-k]').value,m=Number(tr.querySelector('[data-mdp-m]').value);
   if(k!=='medicine'&&!(m>=0))return toast('اكتب النسبة','error');b.disabled=true;
   call('inventory_set_pricing_kind',{p_item:id,p_kind:k,p_markup:k==='medicine'?null:m}).then(function(res){var r=row(id);r.pricing_kind=res.pricing_kind;r.markup_percent=res.markup_percent;toast('اتحفظ — سعر البيع '+money(res.sale_price)+' ج');draw();if(onDone)onDone();})
    .catch(function(x){b.disabled=false;toast((x&&x.message)||'تعذر الحفظ','error');});});}
 call('inventory_pricing_list').then(function(rows){st.rows=rows||[];draw();}).catch(function(x){toast((x&&x.message)||'تعذر فتح التسعير','error');});}

/* ---------- 2) month-end supplier discount + medicines report ---------- */
function discount(suppliers,rights){rights=rights||{};var st={supplier:'',month:thisMonth(),pv:null,list:[],token:uuid(),busy:false};
 function html(){var pv=st.pv;
  return '<div class="mdd" data-mdd><div class="mdd-form"><label>المورد<select name="supplier"><option value="">اختار المورد</option>'+(suppliers||[]).map(function(s){return '<option value="'+esc(s.id)+'"'+(st.supplier===s.id?' selected':'')+'>'+esc(s.name)+'</option>';}).join('')+'</select></label>'+
   '<label>الشهر<input name="month" type="month" value="'+esc(st.month)+'" max="'+thisMonth()+'"></label>'+
   '<label>نسبة الخصم %<input name="percent" inputmode="decimal" placeholder="مثلاً 12"></label><label>أو المبلغ (من إشعار المورد)<input name="amount" inputmode="decimal"></label>'+
   '<label class="mdd-wide">رابط صورة إشعار الخصم (اختياري)<input name="document_url" type="url" dir="ltr"></label><label class="mdd-wide">ملاحظة<input name="note" maxlength="500"></label></div>'+
   (pv?'<div class="mdp-tw"><table class="mdp-t"><thead><tr><th>فاتورة المورد</th><th>التاريخ</th><th>إجمالي الفاتورة</th><th>منها أدوية ناقصة (مستبعدة)</th><th>عليها الخصم</th></tr></thead><tbody>'+
     (pv.invoices.length?pv.invoices.map(function(i){return '<tr><td>'+esc(i.reference)+'</td><td dir="ltr">'+esc(i.invoice_date)+'</td><td dir="ltr">'+money(i.total)+'</td><td dir="ltr">'+money(i.excluded)+'</td><td dir="ltr">'+money(i.basis)+'</td></tr>';}).join(''):'<tr><td colspan="5">مفيش فواتير للمورد ده في الشهر ده.</td></tr>')+'</tbody></table></div>'+
     '<div class="mdd-foot"><span>إجمالي عليه الخصم <b dir="ltr">'+money(pv.basis)+' ج</b> — الخصم <b dir="ltr" data-mdd-amt>—</b></span>'+(pv.existing?'<span class="mdd-chip">'+esc(STATUS[pv.existing.status])+' — '+money(pv.existing.amount)+' ج</span>':(rights.can_create?'<button type="button" class="btn btn-primary" data-mdd-create>إرسال للمراجعة</button>':'<span class="mdd-chip">التسجيل للمحاسب</span>'))+'</div>'
    :'<p class="mdp-note">اختار المورد والشهر عشان تظهر فواتيره.</p>')+
   '<h4>خصومات الشهر</h4><div class="mdp-tw"><table class="mdp-t"><thead><tr><th>المورد</th><th>عليها الخصم</th><th>الخصم</th><th>سجّله</th><th>الحالة</th><th></th></tr></thead><tbody>'+
   (st.list.length?st.list.map(function(x){return '<tr><td>'+esc(x.supplier)+'</td><td dir="ltr">'+money(x.basis)+'</td><td dir="ltr">'+money(x.amount)+(x.percent?' ('+Number(x.percent)+'%)':'')+'</td><td>'+esc(x.created_by_name)+'</td><td>'+esc(STATUS[x.status])+(x.review_note?' — '+esc(x.review_note):'')+'</td><td>'+(x.status==='pending'&&rights.can_review&&x.created_by!==rights.me?'<button type="button" class="btn" data-mdd-ok="'+esc(x.id)+'">اعتماد</button> <button type="button" class="btn" data-mdd-no="'+esc(x.id)+'">رفض</button>':'')+'</td></tr>';}).join(''):'<tr><td colspan="6">مفيش خصومات متسجلة للشهر ده.</td></tr>')+'</tbody></table></div>'+
   '<p class="mdp-note">بعد الاعتماد: حساب المورد بيقل بقيمة الخصم، والخصم بيتسجل «خصم مشتريات مكتسب» كإيراد للشهر. أسعار شراء الأدوية مش بتتغير. الاعتماد للمدير المالي، ومن شخص غير اللي سجّل.</p></div>';}
 function amt(el){var b=st.pv&&Number(st.pv.basis),p=Number(el.querySelector('[name="percent"]').value),a=Number(el.querySelector('[name="amount"]').value),out=el.querySelector('[data-mdd-amt]');if(!out)return;out.textContent=p>0?money(b*p/100)+' ج':a>0?money(a)+' ج':'—';}
 function load(){var jobs=[call('clinic_finance_supplier_discount',{p_action:'list',p_payload:{month:st.month+'-01'}}).then(function(l){st.list=l||[];})];
  if(st.supplier)jobs.push(call('clinic_finance_supplier_discount',{p_action:'preview',p_payload:{supplier_id:st.supplier,month:st.month+'-01'}}).then(function(p){st.pv=p;}));else st.pv=null;
  return Promise.all(jobs).then(draw).catch(function(x){toast((x&&x.message)||'تعذر التحميل','error');draw();});}
 function draw(){sheet('mdd','خصم آخر الشهر',html(),wire);}
 function review(id,ok,why){var note=ok?'':(why||'');if(!ok&&!note)return;
  call('clinic_finance_supplier_discount',{p_action:'review',p_payload:{id:id,approve:ok,note:note||''}}).then(function(){toast(ok?'الخصم اتعتمد واتسجل على حساب المورد':'الخصم اترفض');return load();}).catch(function(x){toast((x&&x.message)||'تعذر المراجعة','error');});}
 function wire(el){
  el.querySelector('[name="supplier"]').onchange=function(){st.supplier=this.value;st.token=uuid();load();};
  el.querySelector('[name="month"]').onchange=function(){st.month=this.value||thisMonth();st.token=uuid();load();};
  ['percent','amount'].forEach(function(n){el.querySelector('[name="'+n+'"]').oninput=function(){amt(el);};});
  el.addEventListener('click',function(e){var t=e.target.closest('[data-mdd-create],[data-mdd-ok],[data-mdd-no],[data-mdd-noyes],[data-mdd-nocancel]');if(!t)return;
   if(t.hasAttribute('data-mdd-ok'))return review(t.getAttribute('data-mdd-ok'),true);
   /* owner (via inventory chat) 2026-11-23: inline rejection reason instead of window.prompt; payload unchanged {id, approve, note} */
   if(t.hasAttribute('data-mdd-no')){var cell=t.parentNode,rid=t.getAttribute('data-mdd-no');cell.setAttribute('data-mdd-was',cell.innerHTML);cell.innerHTML='<div class="mdd-reject"><input type="text" data-mdd-reason maxlength="300" placeholder="سبب الرفض" aria-label="سبب الرفض"><button type="button" class="btn btn-danger" data-mdd-noyes="'+esc(rid)+'">تأكيد الرفض</button><button type="button" class="btn" data-mdd-nocancel>رجوع</button></div>';cell.querySelector('[data-mdd-reason]').focus();return;}
   if(t.hasAttribute('data-mdd-nocancel')){var c2=t.closest('td');if(c2&&c2.hasAttribute('data-mdd-was')){c2.innerHTML=c2.getAttribute('data-mdd-was');c2.removeAttribute('data-mdd-was');}return;}
   if(t.hasAttribute('data-mdd-noyes')){var c3=t.closest('td'),why=(c3.querySelector('[data-mdd-reason]').value||'').trim();if(!why){toast('اكتب سبب الرفض','error');c3.querySelector('[data-mdd-reason]').focus();return;}return review(t.getAttribute('data-mdd-noyes'),false,why);}
   if(st.busy)return;var v=function(n){return el.querySelector('[name="'+n+'"]').value.trim();},p=v('percent'),a=v('amount');
   if(!!p===!!a)return toast('اكتب نسبة الخصم أو المبلغ (واحد بس)','error');st.busy=true;t.disabled=true;
   call('clinic_finance_supplier_discount',{p_action:'create',p_payload:{supplier_id:st.supplier,month:st.month+'-01',percent:p?Number(p):null,amount:a?Number(a):null,document_url:v('document_url'),note:v('note'),token:st.token}})
    .then(function(r){st.token=uuid();toast('اتسجل الخصم '+money(r&&r.amount)+' ج — مستني مراجعة المدير المالي');return load();})
    .catch(function(x){toast((x&&x.message)||'تعذر الحفظ','error');}).then(function(){st.busy=false;});});}
 load();}
function report(){var st={month:thisMonth(),r:null};
 function html(){var r=st.r||{sales:{},suppliers:[]},m=(r.sales||{}).medicine||{},s=(r.sales||{}).shortage||{},disc=Number(r.discounts||0),sp=Number(s.revenue||0)-Number(s.cost||0);
  return '<div class="mdd" data-mdr><div class="mdd-form"><label>الشهر<input name="month" type="month" value="'+esc(st.month)+'" max="'+thisMonth()+'"></label></div>'+
   '<div class="mdr-kpis"><div class="mdr-kpi"><small>مبيعات الأدوية بسعر الجمهور</small><b dir="ltr">'+money(m.revenue)+'</b></div><div class="mdr-kpi"><small>تكلفتها</small><b dir="ltr">'+money(m.cost)+'</b></div><div class="mdr-kpi"><small>خصم آخر الشهر (معتمد)</small><b class="ok" dir="ltr">'+money(disc)+'</b></div><div class="mdr-kpi"><small>ربح الأدوية الناقصة</small><b class="ok" dir="ltr">'+money(sp)+'</b></div><div class="mdr-kpi hero"><small>صافي ربح الأدوية</small><b dir="ltr">'+money(Number(m.revenue||0)-Number(m.cost||0)+disc+sp)+' ج</b></div></div>'+
   '<div class="mdp-tw"><table class="mdp-t"><thead><tr><th>المورد</th><th>مشتريات الشهر</th><th>عليها الخصم</th><th>الخصم</th><th>النسبة</th><th>الحالة</th></tr></thead><tbody>'+
   ((r.suppliers||[]).length?r.suppliers.map(function(x){return '<tr><td>'+esc(x.supplier)+'</td><td dir="ltr">'+money(x.purchases)+'</td><td dir="ltr">'+money(x.basis)+'</td><td dir="ltr">'+(x.discount==null?'—':money(x.discount))+'</td><td dir="ltr">'+(x.percent?Number(x.percent)+'%':'—')+'</td><td>'+esc(STATUS[x.status]||x.status)+'</td></tr>';}).join(''):'<tr><td colspan="6">مفيش مشتريات أدوية في الشهر ده.</td></tr>')+'</tbody></table></div>'+
   '<p class="mdp-note">الدواء العادي ربحه صفر وقت البيع لأنه بيتباع بسعر الجمهور اللي اتشرى بيه، والمكسب الحقيقي هو خصم آخر الشهر.</p></div>';}
 function load(){call('clinic_finance_supplier_discount',{p_action:'report',p_payload:{month:st.month+'-01'}}).then(function(r){st.r=r;draw();}).catch(function(x){toast((x&&x.message)||'تعذر التحميل','error');});}
 function draw(){sheet('mdr','تقرير الأدوية',html(),function(el){el.querySelector('[name="month"]').onchange=function(){st.month=this.value||thisMonth();load();};});}
 load();}
w.SSMPDMedicines={pricing:pricing,discount:discount,report:report};

/* finance layer: «الموردون» tab gets the two buttons */
var prior=w.SSMPDFinanceControls;
if(prior){w.SSMPDFinanceControls={panel:function(tab,dd,h){var out=prior.panel(tab,dd,h);if(tab!=='suppliers')return out;
  return '<div class="fc-actions">'+h.btn('month-discount','','خصم آخر الشهر')+h.btn('medicines-report','','تقرير الأدوية')+'</div>'+out;},
 act:function(action,id,dd,h){if(action==='month-discount'){discount(dd.suppliers||[],{can_create:!!dd.can_create,can_review:!!dd.can_review,me:dd.me});return true;}if(action==='medicines-report'){report();return true;}return prior.act(action,id,dd,h);},due:prior.due};}
})(window,document);
