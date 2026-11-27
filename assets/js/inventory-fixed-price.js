/* «سعر بيع ثابت» in the item window (owner «طبّق سعر البيع الثابت» 2026-11-27, mockup docs/ui-references/mockups/fixed-sale-price.html).
   Adds «طريقة التسعير: نسبة ربح % | سعر بيع ثابت» to «تعديل صنف» (render-inventory.js itemModal, via SSMPDInventoryCatalog.augmentEditor).
   Fixed: the price is typed and stays the same through receipts and «هامش الربح الموحّد ← طبّق على كل الأصناف»; the effective
   margin is shown for information, with a warning below cost. Server: inventory_set_fixed_price / inventory_set_pricing_kind
   (20261127280000). Existing items only (a new item is saved first). */
(function(w,d){'use strict';
function n(v){var x=Number(v);return isFinite(x)?x:0;}
function money(v){return n(v).toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:2});}
function call(name,args){var c=w.SSMPDDb&&w.SSMPDDb.client;if(!c)return Promise.reject(new Error('تعذر الاتصال'));return Promise.resolve(c.rpc(name,args||{})).then(function(r){if(r&&r.error)throw r.error;return r.data;});}
function toast(m,k){if(w.SSMPDToast&&w.SSMPDToast.show)w.SSMPDToast.show(m,k||'success');}
function augment(b,x){var f=b&&b.querySelector('.inv-form');if(!f||!x||!x.id||f.querySelector('[data-ifp]'))return;
 var markup=f.querySelector('[name="markup"]'),price=f.querySelector('[name="price"]'),std=f.querySelector('[name="use_standard"]');if(!markup||!price)return;
 var was=x.pricing_kind==='fixed',cost=x.highest_purchase_cost,box=d.createElement('div');box.className='ifp';box.setAttribute('data-ifp','');
 box.innerHTML='<fieldset class="ifp-seg"><legend>طريقة التسعير</legend><label><input type="radio" name="ifp_mode" value="markup"'+(was?'':' checked')+'> نسبة ربح %</label><label><input type="radio" name="ifp_mode" value="fixed"'+(was?' checked':'')+'> سعر بيع ثابت</label></fieldset>'+
  '<p class="ifp-info" data-ifp-info></p><p class="ifp-warn" data-ifp-warn hidden></p>';
 markup.closest('label').insertAdjacentElement('beforebegin',box);
 var priceLabel=price.closest('label'),labelText=priceLabel.firstChild,orig=labelText&&labelText.nodeType===3?labelText.nodeValue:'',ro=price.readOnly;
 function mode(){return (box.querySelector('[name=ifp_mode]:checked')||{}).value;}
 function sync(){var fx=mode()==='fixed';[markup.closest('label'),std&&std.closest('label')].forEach(function(l){if(l)l.hidden=fx;});
  price.readOnly=fx?false:ro;if(labelText&&labelText.nodeType===3)labelText.nodeValue=fx?'سعر البيع (ثابت) — بتكتبه بإيدك، ومبيتغيرش مع الاستلام أو الهامش الموحّد':orig;
  if(fx&&was&&!price.value)price.value=x.current_sale_price;info();}
 function info(){var fx=mode()==='fixed',p=n(price.value),i=box.querySelector('[data-ifp-info]'),wn=box.querySelector('[data-ifp-warn]');
  if(!fx||cost==null||!(n(cost)>0)){i.textContent=fx&&cost==null?'لسه مفيش تكلفة شراء — الهامش الفعلي هيبان بعد أول استلام.':'';wn.hidden=true;return;}
  i.textContent='هامش الربح الفعلي: '+(Math.round((p-n(cost))/n(cost)*10000)/100)+'% (الربح '+money(p-n(cost))+' في الوحدة)';
  wn.hidden=!(p<n(cost));wn.textContent='⚠ سعر البيع '+money(p)+' أقل من التكلفة '+money(cost)+' — هتخسر '+money(n(cost)-p)+' في كل وحدة';}
 box.querySelectorAll('[name=ifp_mode]').forEach(function(r){r.addEventListener('change',sync);});price.addEventListener('input',info);sync();
 var save=b.querySelector('[data-save]');if(!save)return;
 b.addEventListener('click',function(e){if(!e.target.closest||e.target.closest('[data-save]')!==save||save._ifpGo)return;var fx=mode()==='fixed';if(!fx&&!was)return;
  e.stopPropagation();e.preventDefault();var p=n(price.value);if(fx&&!(price.value!==''&&p>=0)){toast('اكتب سعر البيع','error');return;}
  save.disabled=true;(fx?call('inventory_set_fixed_price',{p_item:x.id,p_price:Math.round(p*100)/100}):call('inventory_set_pricing_kind',{p_item:x.id,p_kind:'supply',p_markup:n(markup.value)}))
   .then(function(res){if(res&&res.below_cost)toast('تنبيه: السعر الثابت أقل من التكلفة','error');save.disabled=false;save._ifpGo=true;try{save.click();}finally{save._ifpGo=false;}})
   .catch(function(err){save.disabled=false;toast((err&&err.message)||'تعذر الحفظ','error');});},true);}
var cat=w.SSMPDInventoryCatalog;
if(cat&&cat.augmentEditor&&!cat._ifp){var orig=cat.augmentEditor;cat.augmentEditor=function(b,x){orig(b,x);augment(b,x);};cat._ifp=true;}
w.SSMPDInventoryFixedPrice={augment:augment};
})(window,document);
