/* Supplies at service — PR2 (owner approved 2026-11-25 «طبق المستلزمات», docs/ui-references/mockups/supplies-at-service.html).
   1) «تنفيذ وتسجيل المستلزمات» (panel 1): the person who performs the service sees today's ordered services of HIS department,
      picks the store («بصرف من»), adjusts each material (− / +), adds another one (search), sees what goes on the patient invoice,
      then «نفّذت ✓» or «بدون مستلزمات (سبب)». RPC clinic_reception_performer (today / execute) — live workspace only.
   2) «طقم الفيتلة — بتظبطه رئيسة التمريض» (panel 7): kit per vital, RPC clinic_reception_vitals_kit (list / save).
   Entry: section «تنفيذ وتسجيل المستلزمات» in «الاستقبال والخدمات» for nursing / head nursing / doctor assistant / doctor / managers,
   and buttons in «تشغيل اليوم — التمريض» (nursing-day-ops.js) through SSMPDPerformerSupplies.mount / mountKit. */
(function(w,d){'use strict';
if(w.__SWNWPerformerSuppliesV1)return;w.__SWNWPerformerSuppliesV1=true;
var ROLES=['nursing','head_nursing','doctor_assistant','sono_doctor','super_admin','general_manager'];
var VITALS=[['bp','ضغط الدم'],['pulse','النبض'],['temp','الحرارة'],['spo2','الأكسجين'],['weight','الوزن'],['sugar','سكر الدم']];
function esc(v){return String(v==null?'':v).replace(/[&<>"']/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c];});}
function money(n){return Number(n||0).toLocaleString('en-US',{maximumFractionDigits:2});}
function qn(n){return Number(n||0).toLocaleString('en-US',{maximumFractionDigits:3});}
function tm(v){try{return v?new Date(v).toLocaleTimeString('ar-EG-u-nu-latn',{timeZone:'Africa/Cairo',hour:'2-digit',minute:'2-digit'}):'';}catch(e){return '';}}
function dayLabel(v){try{return new Date((v||'')+'T12:00:00Z').toLocaleDateString('ar-EG-u-nu-latn',{weekday:'long',day:'2-digit',month:'2-digit',timeZone:'Africa/Cairo'});}catch(e){return v||'';}}
function uuid(){return w.crypto&&w.crypto.randomUUID?w.crypto.randomUUID():'xxxxxxxx-xxxx-4xxx-8xxx-xxxxxxxxxxxx'.replace(/x/g,function(){return (Math.random()*16|0).toString(16);});}
function toast(m,k){if(w.SSMPDToast&&w.SSMPDToast.show)w.SSMPDToast.show(m,k||'success');}
function rpc(name,args){var c=w.SSMPDDb&&w.SSMPDDb.client;if(!c)return Promise.reject(new Error('تعذر الاتصال'));return Promise.resolve(c.rpc(name,args||{})).then(function(r){if(r&&r.error)throw r.error;return r.data;});}
function msg(e){return (e&&(e.message||e.hint))||'تعذر تنفيذ الإجراء';}
function store(k,v){try{if(v===undefined)return w.localStorage.getItem(k);w.localStorage.setItem(k,v);}catch(e){return null;}}
function css(){if(d.getElementById('pf-style'))return;var s=d.createElement('style');s.id='pf-style';s.textContent=
'.ps{display:grid;gap:12px;max-width:720px;margin:0 auto;color:#16212E;font-family:"Hiragino Kaku","BigVesta Arabic",system-ui,Tahoma,sans-serif;min-width:0}.ps *{box-sizing:border-box}'+
'.ps-bar{background:#0F369D;color:#fff;border-radius:16px;padding:14px 16px;display:flex;gap:10px;align-items:center;justify-content:space-between}.ps-bar b{font-size:16px;display:block}.ps-bar small{opacity:.85;font-size:12px}'+
'.ps-bar button{border:1px solid rgba(255,255,255,.6);background:transparent;color:#fff;border-radius:10px;padding:6px 12px;font:inherit;cursor:pointer;min-height:40px}'+
'.ps-store{display:flex;justify-content:space-between;align-items:center;gap:10px;background:#fff;border-radius:12px;padding:10px 12px;border:1px solid #D5DEEE;font-size:13px}'+
'.ps-store select{border:1px solid #BFCBE3;border-radius:10px;padding:6px 8px;font:inherit;font-weight:700;color:#0F369D;background:#fff;min-height:40px;max-width:65%}'+
'.ps-pt{background:#fff;border-radius:14px;border:1px solid #D5DEEE;padding:12px;display:grid;gap:10px;min-width:0}.ps-h{display:flex;justify-content:space-between;gap:8px;flex-wrap:wrap}.ps-h b{font-size:15px;overflow-wrap:anywhere}.ps-h span{font-size:12px;color:#5b6577}'+
'.ps-pt.done{opacity:.6}.ps-pt.done .ps-h b::after{content:" ✓";color:#2F7D5C}'+
'.ps-ln{display:grid;grid-template-columns:1fr auto auto;gap:8px;align-items:center;font-size:13px;padding:8px 10px;border-radius:10px;background:#F5F7FB}.ps-ln>span:first-child{overflow-wrap:anywhere}'+
'.ps-q{display:flex;align-items:center;gap:6px}.ps-q button{width:32px;height:32px;border-radius:8px;border:1px solid #D5DEEE;background:#fff;font-size:16px;cursor:pointer;color:#16212E}.ps-q b{min-width:22px;text-align:center;font-variant-numeric:tabular-nums}'+
'.ps-chip{display:inline-block;padding:2px 8px;border-radius:99px;font-size:11px;white-space:nowrap}.ps-inc{background:#E6F2EC;color:#2F7D5C}.ps-bil{background:#FFF1E9;color:#C2410C}'+
'.ps-add{border:1px dashed #9DB0D9;background:#fff;color:#0F369D;border-radius:10px;padding:9px;font:inherit;font-size:13px;text-align:center;cursor:pointer;width:100%;min-height:40px}'+
'.ps-search{display:grid;gap:6px}.ps-search input,.ps-in{width:100%;border:1px solid #BFCBE3;border-radius:10px;padding:8px 10px;font:inherit;min-height:40px}.ps-res{display:grid;gap:4px;max-height:220px;overflow:auto}'+
'.ps-res button{display:flex;justify-content:space-between;gap:8px;border:1px solid #E6E8EE;border-radius:10px;padding:8px 10px;background:#fff;font:inherit;font-size:13px;cursor:pointer;text-align:right}'+
'.ps-tot{display:flex;justify-content:space-between;font-size:13px;border-top:1px dashed #D5DEEE;padding-top:8px}.ps-tot b{color:#C2410C}'+
'.ps-ok{display:flex;gap:8px;align-items:center;font-size:13px;background:#FFF8EC;border:1px solid #F5D9A8;border-radius:10px;padding:8px 10px}.ps-ok input{width:20px;height:20px}'+
'.ps-btns{display:grid;grid-template-columns:1fr 1fr;gap:8px}.ps-b{border-radius:12px;padding:12px;font:inherit;font-size:14px;font-weight:700;text-align:center;border:1px solid #D5DEEE;background:#fff;color:#16212E;cursor:pointer;min-height:44px}'+
'.ps-b.pri{background:#0F369D;color:#fff;border-color:#0F369D}.ps-b:disabled{opacity:.5;cursor:default}.ps-note{font-size:12px;color:#5b6577}.ps-empty{text-align:center;color:#5b6577;padding:18px;background:#fff;border-radius:14px;border:1px solid #D5DEEE}'+
'.ps-kit{display:grid;gap:10px}.ps-kv{background:#fff;border:1px solid #D5DEEE;border-radius:14px;padding:12px;display:grid;gap:8px}.ps-kv h4{margin:0;color:#0F369D;font-size:15px}'+
'.ps-kl{display:grid;grid-template-columns:1fr 84px 40px;gap:8px;align-items:center}.ps-kl select{border:1px solid #BFCBE3;border-radius:10px;padding:6px 8px;font:inherit;min-height:40px;min-width:0;background:#fff}.ps-kl input{width:100%;border:1px solid #BFCBE3;border-radius:10px;padding:6px 8px;font:inherit;min-height:40px;direction:ltr;text-align:center}'+
'.ps-kl button{border:1px solid #F3C2B8;background:#FDEEEB;color:#D0402A;border-radius:10px;min-height:40px;cursor:pointer;font:inherit}';
d.head.appendChild(s);}

/* ---------------------------------------------------------------- performer screen */
function mount(el,o){o=o||{};css();var st={data:null,lines:{},busy:false,open:{},none:{},search:{},agree:{},note:{},tok:{}},ws=o.workspace;
 function scope(){return el;}
 function loc(){var v=store('pf-store');var L=(st.data&&st.data.locations)||[];if(v&&L.some(function(l){return l.id===v;}))return v;return L[0]?L[0].id:'';}
 function itemOf(id){return ((st.data&&st.data.items)||[]).filter(function(i){return i.id===id;})[0];}
 function linesOf(o2){if(!st.lines[o2.id])st.lines[o2.id]=(o2.bom||[]).map(function(b){return {item_id:b.item_id,item:b.item,base:Number(b.quantity),qty:Number(b.quantity),billable:!!b.billable,price:Number(b.sale_price||0),bom:true};});return st.lines[o2.id];}
 function charge(l){if(l.billable)return l.qty*l.price;var over=Math.max(0,l.qty-(l.bom?l.base:0));return over*l.price;}
 function needsAgree(ls){return ls.some(function(l){return !l.billable&&l.qty>(l.bom?l.base:0);});}
 function needsNote(ls){return ls.some(function(l){return l.bom&&l.qty<=0;});}
 function lineHtml(o2,l,i){var c=charge(l),over=!l.billable&&l.qty>(l.bom?l.base:0);
  var chip=l.billable?'<span class="ps-chip ps-bil">بيتحاسب '+money(l.price)+' ج.م</span>':over?'<span class="ps-chip ps-bil">زيادة بيتحاسب '+money(c)+' ج.م</span>':'<span class="ps-chip ps-inc">في سعر الخدمة</span>';
  return '<div class="ps-ln" data-pf-line="'+esc(o2.id)+'|'+esc(l.item_id)+'"><span>'+esc(l.item)+'</span>'+chip+'<span class="ps-q"><button type="button" data-pf="dec" data-o="'+esc(o2.id)+'" data-i="'+i+'" aria-label="أقل — '+esc(l.item)+'">−</button><b>'+qn(l.qty)+'</b><button type="button" data-pf="inc" data-o="'+esc(o2.id)+'" data-i="'+i+'" aria-label="أكتر — '+esc(l.item)+'">+</button></span></div>';}
 function card(o2){var head='<div class="ps-h"><b>'+esc(o2.name)+'</b><span><bdi dir="ltr">'+esc(o2.file_no||'')+'</bdi> · '+esc(tm(o2.starts_at))+(o2.doctor?' · '+esc(o2.doctor):'')+'</span></div>';
  var who='<div class="ps-note">'+esc(o2.patient_name||'')+'</div>';
  if(o2.status==='completed')return '<article class="ps-pt done" data-pf-order="'+esc(o2.id)+'" data-done="1">'+head+'</article>';
  if(!o2.can_execute)return '<article class="ps-pt" data-pf-order="'+esc(o2.id)+'">'+head+who+'<div class="ps-note">الزيارة اتقفلت — كلّم الاستقبال</div></article>';
  var ls=linesOf(o2),tot=ls.reduce(function(a,l){return a+charge(l);},0),id=esc(o2.id);
  var h='<article class="ps-pt" data-pf-order="'+id+'">'+head+who+ls.map(function(l,i){return lineHtml(o2,l,i);}).join('');
  if(st.search[o2.id]!=null){var t=String(st.search[o2.id]||'').trim(),res=((st.data&&st.data.items)||[]).filter(function(i){return !ls.some(function(l){return l.item_id===i.id;})&&(!t||String(i.name).indexOf(t)>=0);}).slice(0,12);
   h+='<div class="ps-search"><input type="search" data-pf-search="'+id+'" value="'+esc(st.search[o2.id]||'')+'" placeholder="اكتب اسم المستلزم" aria-label="بحث عن مستلزم"><div class="ps-res">'+(res.length?res.map(function(i){return '<button type="button" data-pf="pick" data-o="'+id+'" data-item="'+esc(i.id)+'"><span>'+esc(i.name)+'</span>'+(i.billable?'<span class="ps-chip ps-bil">بيتحاسب '+money(i.sale_price)+' ج.م</span>':'<span class="ps-chip ps-inc">مش بيتحاسب</span>')+'</button>';}).join(''):'<p class="ps-note">مفيش نتيجة</p>')+'</div></div>';}
  else h+='<button type="button" class="ps-add" data-pf="add" data-o="'+id+'">+ مستلزم تاني (بحث)</button>';
  h+='<div class="ps-tot"><span>هيتضاف على فاتورة المريض</span><b data-pf-total="'+id+'">'+money(tot)+' ج.م</b></div>';
  if(needsAgree(ls))h+='<label class="ps-ok"><input type="checkbox" data-pf-agree="'+id+'"'+(st.agree[o2.id]?' checked':'')+'> المريض وافق على الزيادة وسعرها</label>';
  if(needsNote(ls)&&!st.none[o2.id])h+='<input class="ps-in" data-pf-note="'+id+'" value="'+esc(st.note[o2.id]||'')+'" placeholder="سبب إن مستلزم متصرفش" aria-label="سبب إن مستلزم متصرفش">';
  if(st.none[o2.id])h+='<input class="ps-in" data-pf-reason="'+id+'" value="'+esc(st.note[o2.id]||'')+'" placeholder="ليه مفيش مستلزمات؟ (مثلاً المريض رفض)" aria-label="سبب بدون مستلزمات"><div class="ps-btns"><button type="button" class="ps-b pri" data-pf="none_go" data-o="'+id+'">تأكيد بدون مستلزمات</button><button type="button" class="ps-b" data-pf="none_back" data-o="'+id+'">رجوع</button></div>';
  else h+='<div class="ps-btns"><button type="button" class="ps-b pri" data-pf="exec" data-o="'+id+'">نفّذت ✓</button><button type="button" class="ps-b" data-pf="none" data-o="'+id+'">بدون مستلزمات (سبب)</button></div>';
  return h+'</article>';}
 function paint(){var D=st.data;if(!D){el.innerHTML='<div class="ps"><p class="ps-empty">جاري التحميل…</p></div>';return;}
  var L=D.locations||[],cur=loc(),orders=D.orders||[];
  var h='<div class="ps" data-pf-root-in><div class="ps-bar"><div><b>تنفيذ وتسجيل المستلزمات</b><small>'+esc(D.me||'')+' · النهارده '+esc(dayLabel(D.date))+'</small></div>'+(o.back?'<button type="button" data-pf="back">رجوع</button>':'')+'</div>'+
   '<div class="ps-store"><span>بصرف من</span>'+(L.length?'<select data-pf-store aria-label="المخزن اللي بتصرف منه">'+L.map(function(l){return '<option value="'+esc(l.id)+'"'+(l.id===cur?' selected':'')+'>'+esc(l.name)+'</option>';}).join('')+'</select>':'<b>مفيش مخزن متاح لقسمك</b>')+'</div>';
  h+=orders.length?orders.map(card).join(''):'<p class="ps-empty">مفيش خدمات مطلوبة لقسمك النهارده</p>';
  h+='<p class="ps-note">اللي «في سعر الخدمة» بيتخصم من المخزن تكلفة بس. اللي «بيتحاسب» بيظهر على فاتورة المريض فوراً قبل التحصيل.</p></div>';
  el.innerHTML=h;}
 function load(){return rpc('clinic_reception_performer',{p_workspace:ws,p_action:'today',p_payload:{}}).then(function(r){st.data=r;Object.keys(st.lines).forEach(function(k){if(!(r.orders||[]).some(function(x){return x.id===k&&x.status==='ordered';}))delete st.lines[k];});paint();}).catch(function(e){el.innerHTML='<div class="ps"><p class="ps-empty">'+esc(msg(e))+'</p></div>';});}
 function order(id){return ((st.data&&st.data.orders)||[]).filter(function(x){return x.id===id;})[0];}
 function keepInputs(){var a=el.querySelectorAll('[data-pf-note],[data-pf-reason]');a.forEach(function(x){st.note[x.dataset.pfNote||x.dataset.pfReason]=x.value;});}
 function run(o2,payload){if(st.busy)return;st.busy=true;el.querySelectorAll('button').forEach(function(b){b.disabled=true;});
  if(!st.tok[o2.id])st.tok[o2.id]=uuid();payload.token=st.tok[o2.id];payload.order_id=o2.id;
  return rpc('clinic_reception_performer',{p_workspace:ws,p_action:'execute',p_payload:payload}).then(function(r){st.busy=false;delete st.tok[o2.id];delete st.lines[o2.id];delete st.none[o2.id];
   var add=Number(r&&r.invoice_amount||0);toast('اتنفذت «'+o2.name+'»'+(add?' — الفاتورة '+money(add)+' ج.م':''));return load();})
  .catch(function(e){st.busy=false;delete st.tok[o2.id];paint();toast(msg(e),'error');});}
 el.addEventListener('click',function(e){var b=e.target.closest('[data-pf]');if(!b||!el.contains(b))return;var k=b.dataset.pf,o2=b.dataset.o?order(b.dataset.o):null;keepInputs();
  if(k==='back'){if(o.back)o.back();return;}
  if(!o2||st.busy)return;var ls=linesOf(o2);
  if(k==='inc'||k==='dec'){var l=ls[+b.dataset.i];if(!l)return;l.qty=Math.max(0,Math.round((l.qty+(k==='inc'?1:-1))*1000)/1000);if(!l.bom&&l.qty===0)ls.splice(+b.dataset.i,1);paint();}
  else if(k==='add'){st.search[o2.id]='';paint();var s=el.querySelector('[data-pf-search="'+o2.id+'"]');if(s)s.focus();}
  else if(k==='pick'){var it=itemOf(b.dataset.item);if(it)ls.push({item_id:it.id,item:it.name,base:0,qty:1,billable:!!it.billable,price:Number(it.sale_price||0),bom:false});delete st.search[o2.id];paint();}
  else if(k==='none'){st.none[o2.id]=true;paint();var r=el.querySelector('[data-pf-reason="'+o2.id+'"]');if(r)r.focus();}
  else if(k==='none_back'){delete st.none[o2.id];paint();}
  else if(k==='none_go'){var why=String(st.note[o2.id]||'').trim();if(why.length<3){toast('اكتب سبب «بدون مستلزمات»','error');return;}run(o2,{no_materials:true,material_note:why});}
  else if(k==='exec'){var L=loc(),mats=ls.map(function(l){return {item_id:l.item_id,quantity:l.qty};});
   if(mats.some(function(m){return m.quantity>0;})&&!L){toast('اختار المخزن اللي بتصرف منه','error');return;}
   if(needsAgree(ls)&&!st.agree[o2.id]){toast('أكد إن المريض وافق على الزيادة وسعرها','error');return;}
   var note=String(st.note[o2.id]||'').trim();if(needsNote(ls)&&note.length<3){toast('اكتب سبب إن مستلزم متصرفش','error');return;}
   run(o2,{location_id:L,materials:mats,material_note:note||null,patient_agreed:!!st.agree[o2.id]});}});
 el.addEventListener('input',function(e){var t=e.target;if(t.matches('[data-pf-search]')){st.search[t.dataset.pfSearch]=t.value;var pos=t.selectionStart;paint();var n=el.querySelector('[data-pf-search="'+t.dataset.pfSearch+'"]');if(n){n.focus();try{n.setSelectionRange(pos,pos);}catch(_){}}}
  else if(t.matches('[data-pf-note]'))st.note[t.dataset.pfNote]=t.value;else if(t.matches('[data-pf-reason]'))st.note[t.dataset.pfReason]=t.value;});
 el.addEventListener('change',function(e){var t=e.target;if(t.matches('[data-pf-store]')){store('pf-store',t.value);}else if(t.matches('[data-pf-agree]')){st.agree[t.dataset.pfAgree]=t.checked;}});
 paint();return load();}

/* ---------------------------------------------------------------- kit editor (head nursing) */
function mountKit(el,o){o=o||{};css();var st={data:null,lines:[],busy:false};
 function paint(){if(!st.data){el.innerHTML='<div class="ps"><p class="ps-empty">جاري التحميل…</p></div>';return;}
  var items=st.data.items||[],opt=function(sel){return '<option value="">اختار المستلزم</option>'+items.map(function(i){return '<option value="'+esc(i.id)+'"'+(i.id===sel?' selected':'')+'>'+esc(i.name)+'</option>';}).join('');};
  el.innerHTML='<div class="ps" data-pf-kit-root><div class="ps-bar"><div><b>طقم الفيتلة — بتظبطه رئيسة التمريض</b><small>بيتخصم لوحده مع «حفظ الفحص» تكلفة بس — مش على فاتورة المريض</small></div>'+(o.back?'<button type="button" data-kit="back">رجوع</button>':'')+'</div><div class="ps-kit">'+
   VITALS.map(function(v){var ls=st.lines.map(function(l,i){return [l,i];}).filter(function(x){return x[0].vital===v[0];});
    return '<section class="ps-kv" data-kit-vital="'+v[0]+'"><h4>'+v[1]+'</h4>'+(ls.length?ls.map(function(x){return '<div class="ps-kl"><select data-kit-item="'+x[1]+'" aria-label="مستلزم '+v[1]+'">'+opt(x[0].item_id)+'</select><input type="number" min="0.001" step="1" inputmode="decimal" data-kit-qty="'+x[1]+'" value="'+esc(x[0].quantity)+'" aria-label="الكمية"><button type="button" data-kit="del" data-i="'+x[1]+'" aria-label="شيل">✕</button></div>';}).join(''):'<p class="ps-note">مفيش مستهلكات</p>')+
    '<button type="button" class="ps-add" data-kit="add" data-vital="'+v[0]+'">+ مستلزم للقياس</button></section>';}).join('')+
   '</div><p class="ps-note">القطن وشريحة السكر والشكاكة والكحول والجلافز مش بتتحاسب على المريض (الجلافز زوج = 2). اللي متقاسش (رفض أو متعملش) مفيش له خصم.</p><div class="ps-btns"><button type="button" class="ps-b pri" data-kit="save">حفظ الطقم</button>'+(o.back?'<button type="button" class="ps-b" data-kit="back">رجوع</button>':'<span></span>')+'</div></div>';}
 function sync(){el.querySelectorAll('[data-kit-item]').forEach(function(s){st.lines[+s.dataset.kitItem].item_id=s.value;});el.querySelectorAll('[data-kit-qty]').forEach(function(s){st.lines[+s.dataset.kitQty].quantity=s.value;});}
 function load(){return rpc('clinic_reception_vitals_kit',{p_workspace:o.workspace,p_action:'list',p_payload:{}}).then(function(r){st.data=r;st.lines=(r.kit||[]).map(function(k){return {vital:k.vital,item_id:k.item_id,quantity:Number(k.quantity)};});paint();}).catch(function(e){el.innerHTML='<div class="ps"><p class="ps-empty">'+esc(msg(e))+'</p></div>';});}
 el.addEventListener('click',function(e){var b=e.target.closest('[data-kit]');if(!b||!el.contains(b)||st.busy)return;var k=b.dataset.kit;sync();
  if(k==='back'){if(o.back)o.back();return;}
  if(k==='add'){st.lines.push({vital:b.dataset.vital,item_id:'',quantity:1});paint();}
  else if(k==='del'){st.lines.splice(+b.dataset.i,1);paint();}
  else if(k==='save'){var bad=st.lines.filter(function(l){return !l.item_id||!(Number(l.quantity)>0);});if(bad.length){toast('اختار المستلزم وكميته في كل سطر','error');return;}
   st.busy=true;rpc('clinic_reception_vitals_kit',{p_workspace:o.workspace,p_action:'save',p_payload:{lines:st.lines.map(function(l){return {vital:l.vital,item_id:l.item_id,quantity:Number(l.quantity)};})}})
    .then(function(r){st.busy=false;st.data=r;st.lines=(r.kit||[]).map(function(x){return {vital:x.vital,item_id:x.item_id,quantity:Number(x.quantity)};});paint();toast('اتحفظ طقم الفيتلة');}).catch(function(e2){st.busy=false;toast(msg(e2),'error');});}});
 paint();return load();}

/* ---------------------------------------------------------------- section in «الاستقبال والخدمات» */
function allowed(){var R=w.SSMPDRoles,A=w.SSMPDAuth;return !!(R&&A&&A.currentAdmin&&R.hasAnyRole&&R.hasAnyRole(A.currentAdmin,ROLES));}
function install(){var base=w.SSMPDReceptionModules;if(!base){setTimeout(install,120);return;}if(base.__swnwPerformerWrapped)return;
 var wrapped={};Object.keys(base).forEach(function(k){wrapped[k]=base[k];});
 wrapped.sections=function(c){var rows=base.sections?base.sections(c):[];var live=c&&c.data&&c.data.workspace&&c.data.workspace.mode==='live';
  if(live&&allowed()&&!rows.some(function(x){return x[0]==='performer';}))rows=rows.concat([['performer','تنفيذ وتسجيل المستلزمات','الخدمات المطلوبة لقسمك النهارده ومستلزماتها وقت التنفيذ']]);return rows;};
 wrapped.panel=function(section,c){if(section==='performer'){if(!(c&&c.data&&c.data.workspace&&c.data.workspace.mode==='live'))return '';setTimeout(function(){var el=d.querySelector('[data-pf-root]');if(el&&!el.__pf){el.__pf=true;mount(el,{workspace:c.workspace});}},0);return '<div data-pf-root></div>';}return base.panel?base.panel(section,c):'';};
 wrapped.__swnwPerformerWrapped=true;w.SSMPDReceptionModules=wrapped;}
w.SSMPDPerformerSupplies={mount:mount,mountKit:mountKit,VITALS:VITALS};
install();
})(window,document);
