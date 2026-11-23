/* «فاتورة مورد مباشرة» (owner 2026-11-22, mockup docs/ui-references/mockups/inventory-supplies-flow.html): a supplier
   invoice without a prior purchase request, into a main store («رئيسي أسنان / مستلزمات / أدوية»). Saving adds the stock
   and records the amount on the supplier's account in one step (same receiving path as an approved request).
   Server: public.inventory_direct_invoice('context'|'save', payload) — 20261122270000.
   Opened from the «طلبات التوريد والصرف» card (render-inventory.js, [data-inv-direct-invoice]). After saving, the finance
   chat's tax box (SSMPDTaxStatus.box, doc kind 'purchase_invoice') is shown when that module is loaded. */
(function(w,d){'use strict';
function esc(v){return String(v==null?'':v).replace(/[&<>"']/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c];});}
function money(n){return Number(n||0).toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:2});}
function client(){return w.SSMPDDb&&w.SSMPDDb.client;}
function uuid(){return w.crypto&&w.crypto.randomUUID?w.crypto.randomUUID():'xxxxxxxx-xxxx-4xxx-8xxx-xxxxxxxxxxxx'.replace(/x/g,function(){return (Math.random()*16|0).toString(16);});}
function rpc(a,p){var c=client();if(!c)return Promise.reject(new Error('تعذر الاتصال'));return Promise.resolve(c.rpc('inventory_direct_invoice',{p_action:a,p_payload:p||{}})).then(function(r){if(r&&r.error)throw r.error;return r.data;});}
function toast(m,k){if(w.SSMPDToast&&w.SSMPDToast.show)w.SSMPDToast.show(m,k||'success');}
function today(){return new Date().toLocaleDateString('en-CA',{timeZone:'Africa/Cairo'});}
function open(onDone){var M=w.SSMPDMiniCards;if(!M){toast('تعذر فتح الفاتورة','error');return;}
 var st={ctx:null,lines:[],token:uuid(),busy:false};
 function item(id){return ((st.ctx&&st.ctx.items)||[]).filter(function(i){return i.id===id;})[0];}
 function total(){return st.lines.reduce(function(a,l){return a+Number(l.packs)*Number(l.package_cost);},0);}
 function html(){var c=st.ctx||{suppliers:[],locations:[],items:[]};
  return '<div class="idi" data-idi><div class="idi-form">'+
   '<label>المورد<select name="supplier"><option value="">اختار المورد</option>'+c.suppliers.map(function(s){return '<option value="'+esc(s.id)+'">'+esc(s.name)+'</option>';}).join('')+'</select></label>'+
   '<label>رقم فاتورة المورد<input name="reference" maxlength="120"></label>'+
   '<label>تاريخ الفاتورة<input name="invoice_date" type="date" value="'+today()+'" max="'+today()+'"></label>'+
   '<label>يدخل على مخزن<select name="location">'+c.locations.map(function(l){return '<option value="'+esc(l.id)+'">'+esc(l.name)+'</option>';}).join('')+'</select></label>'+
   '<label style="grid-column:1/-1">رابط صورة الفاتورة (اختياري)<input name="document_url" type="url" maxlength="2000" dir="ltr"></label></div>'+
   '<div class="idi-add"><select data-idi-item aria-label="الصنف"><option value="">اختار الصنف</option>'+c.items.map(function(i){return '<option value="'+esc(i.id)+'">'+esc(i.name)+'</option>';}).join('')+'</select>'+
   '<input data-idi-packs inputmode="decimal" placeholder="عدد العبوات" aria-label="عدد العبوات"><input data-idi-cost inputmode="decimal" placeholder="سعر العبوة" aria-label="سعر العبوة">'+
   '<input data-idi-lot placeholder="رقم التشغيلة" aria-label="رقم التشغيلة"><input data-idi-exp type="date" aria-label="الصلاحية"><button type="button" class="btn" data-idi-addline>+ صنف</button></div>'+
   '<p class="idi-note" data-idi-hint></p>'+
   '<table class="idi-t"><thead><tr><th>الصنف</th><th>عدد العبوات</th><th>قطع في العبوة</th><th>سعر العبوة</th><th>التشغيلة</th><th>الصلاحية</th><th>الإجمالي</th><th></th></tr></thead><tbody data-idi-lines></tbody></table>'+
   '<div class="idi-total"><span>إجمالي الفاتورة <b dir="ltr" data-idi-total>0.00 ج</b> ← على حساب المورد</span><button type="button" class="btn btn-primary" data-idi-save>حفظ الفاتورة</button></div>'+
   '<p class="idi-note">الحفظ بيزوّد المخزن المختار ويسجل المبلغ على حساب المورد. السداد بيتم بعدين من الحسابات بعد المراجعة.</p><div data-idi-tax></div></div>';}
 function drawLines(card){card.querySelector('[data-idi-lines]').innerHTML=st.lines.map(function(l,ix){var i=item(l.item_id)||{};
   return '<tr><td>'+esc(i.name)+'</td><td dir="ltr">'+esc(l.packs)+'</td><td dir="ltr">'+esc(i.units_per_pack)+' '+esc(i.unit)+'</td><td dir="ltr">'+money(l.package_cost)+'</td><td>'+esc(l.lot_number)+'</td><td dir="ltr">'+esc(l.expiry_date||'')+'</td><td dir="ltr">'+money(l.packs*l.package_cost)+'</td><td><button type="button" class="rvu-x" data-idi-del="'+ix+'" aria-label="شيل">✕</button></td></tr>';}).join('');
  card.querySelector('[data-idi-total]').textContent=money(total())+' ج';}
 function show(){var box=d.createElement('div');box.innerHTML=html();var card=box.firstChild;M.sheet('idi','فاتورة مورد مباشرة',card,function(){});drawLines(card);wire(card);}
 function wire(card){var v=function(n){return card.querySelector('[name="'+n+'"]').value;};
  card.querySelector('[data-idi-item]').onchange=function(){var i=item(this.value);card.querySelector('[data-idi-hint]').textContent=i?'العبوة فيها '+i.units_per_pack+' '+i.unit+(i.track_lots?' — الصنف ده لازم رقم تشغيلة وصلاحية':''):'';};
  card.addEventListener('click',function(e){var t=e.target.closest&&e.target.closest('[data-idi-addline],[data-idi-del],[data-idi-save]');if(!t)return;
   if(t.hasAttribute('data-idi-del')){st.lines.splice(+t.getAttribute('data-idi-del'),1);return drawLines(card);}
   if(t.hasAttribute('data-idi-addline')){var id=card.querySelector('[data-idi-item]').value,p=Number(card.querySelector('[data-idi-packs]').value),c=Number(card.querySelector('[data-idi-cost]').value),i=item(id);
    if(!i)return toast('اختار الصنف','error');if(!(p>0))return toast('اكتب عدد العبوات','error');if(!(c>=0)||card.querySelector('[data-idi-cost]').value==='')return toast('اكتب سعر العبوة','error');
    if(st.lines.some(function(l){return l.item_id===id;}))return toast('الصنف موجود في الفاتورة — شيله وضيفه بالكمية الكاملة','error');
    st.lines.push({item_id:id,packs:p,package_cost:c,lot_number:card.querySelector('[data-idi-lot]').value.trim(),expiry_date:card.querySelector('[data-idi-exp]').value||null});
    ['[data-idi-packs]','[data-idi-cost]','[data-idi-lot]','[data-idi-exp]'].forEach(function(s){card.querySelector(s).value='';});return drawLines(card);}
   if(st.busy)return;if(!v('supplier'))return toast('اختار المورد','error');if(v('reference').trim().length<2)return toast('اكتب رقم فاتورة المورد','error');if(!st.lines.length)return toast('ضيف صنف واحد على الأقل','error');
   st.busy=true;t.disabled=true;
   rpc('save',{supplier_id:v('supplier'),location_id:v('location'),reference:v('reference').trim(),invoice_date:v('invoice_date'),document_url:v('document_url').trim(),token:st.token,
    lines:st.lines.map(function(l){var i=item(l.item_id);return {item_id:l.item_id,quantity:Math.round(l.packs*Number(i.units_per_pack)*1000)/1000,package_cost:l.package_cost,lot_number:l.lot_number,expiry_date:l.expiry_date};})})
   .then(function(r){toast('اتسجلت الفاتورة — '+money(r&&r.total)+' ج على حساب '+((r&&r.supplier)||'المورد')+' ودخلت «'+((r&&r.location)||'')+'»');
     card.querySelectorAll('input,select,[data-idi-addline],[data-idi-del]').forEach(function(el){el.disabled=true;});t.textContent='اتحفظت ✓';
     var tax=card.querySelector('[data-idi-tax]');if(w.SSMPDTaxStatus&&w.SSMPDTaxStatus.box&&r&&r.id)w.SSMPDTaxStatus.box(tax,'purchase_invoice',r.id,{});if(onDone)onDone(r);})
   .catch(function(x){st.busy=false;t.disabled=false;toast((x&&x.message)||'تعذر حفظ الفاتورة','error');});});}
 rpc('context',{}).then(function(c){st.ctx=c;if(!c.locations||!c.locations.length)return toast('مفيش مخزن رئيسي متاح','error');show();}).catch(function(x){toast((x&&x.message)||'تعذر فتح الفاتورة','error');});}
w.SSMPDInventoryDirectInvoice={open:open};
})(window,document);
