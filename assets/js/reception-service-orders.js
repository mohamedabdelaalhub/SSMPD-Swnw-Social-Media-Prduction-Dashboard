/* Service orders: referral/performer/provider details per order + external provider board. Calls reviewed RPCs only. */
(function(w){'use strict';
var KINDS=[['service','خدمة / كشف'],['radiology','أشعة'],['lab','معمل'],['medicine','أدوية'],['supply','مستلزمات']];
var CATS=[['consult','كشف'],['followup','متابعة'],['consultation','استشارة'],['procedure','إجراء']];
var MODES=[['internal','داخل المركز'],['external','مزوّد خارجي']];
var BILL=[['center','المركز يحاسب المريض'],['provider','المزوّد يحاسب المريض']];
var STATUS={referred:'محوّل',scheduled:'محجوز',attended:'حضر',cancelled:'ألغى',no_show:'لم يحضر',done:'تمت الخدمة',report_uploaded:'التقرير مرفوع',patient_notified:'تم إشعار المريض'};
var NEXT={referred:['scheduled','cancelled'],scheduled:['attended','cancelled','no_show'],attended:['done'],done:[],report_uploaded:[],cancelled:[],no_show:[],patient_notified:[]};
function esc(v){return String(v==null?'':v).replace(/[&<>"']/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c];});}
function externalAllowed(kind){return kind==='lab'||kind==='radiology';}
function needsBillingParty(kind,mode){return kind==='radiology'&&mode==='external';}
function needsCategory(kind){return kind==='service';}
function providersFor(catalog,kind){return ((catalog&&catalog.providers)||[]).filter(function(p){return p.kind===kind;});}
function performersFor(catalog,serviceId,doctors){
  var rows=((catalog&&catalog.performers)||[]).filter(function(p){return p.service_id===serviceId;});
  if(!rows.length)return doctors;
  var keys=rows.map(function(r){return r.doctor_key;}).filter(Boolean);
  return doctors.filter(function(d){return keys.indexOf(d.doctor_key)>=0;});
}
function referrers(catalog,doctors){
  var withRate={};((catalog&&catalog.referral_rates)||[]).forEach(function(r){withRate[r.doctor_key]=true;});
  return doctors.filter(function(d){return withRate[d.doctor_key];});
}
function nextStatuses(status){return (NEXT[status]||[]).slice();}
function buildExt(v){
  var kind=v.kind||'service',mode=v.mode||'internal';
  if(mode==='external'&&!externalAllowed(kind))throw Error('التنفيذ الخارجي للمعمل والأشعة فقط');
  if(mode==='external'&&!v.provider_id)throw Error('اختر المزوّد');
  var ext={kind:kind,mode:mode,billing_party:needsBillingParty(kind,mode)?(v.billing_party||'center'):'center',
    referring_doctor_key:v.referring_doctor_key||'',performing_doctor_key:v.performing_doctor_key||''};
  if(needsCategory(kind))ext.category=v.category||'consult';
  if(mode==='external')ext.provider_id=v.provider_id;
  return ext;
}
function opt(name,title,rows,chosen,extra){return '<label>'+esc(title)+'<select name="'+name+'" '+(extra||'')+'><option value="">—</option>'+rows.map(function(r){return '<option value="'+esc(r[0])+'" '+(r[0]===chosen?'selected':'')+'>'+esc(r[1])+'</option>';}).join('')+'</select></label>';}
function doctorRows(list){return list.map(function(d){return [d.doctor_key,d.name];});}

var REPORT_TYPES={'application/pdf':'pdf','image/jpeg':'jpg','image/png':'png'},REPORT_MAX=20971520;
function validateReportFile(f){
  if(!f||!REPORT_TYPES[f.type])throw Error('الملف لازم يكون PDF أو صورة JPG/PNG');
  if(!(f.size>0)||f.size>REPORT_MAX)throw Error('حجم الملف لازم يكون أقل من 20 ميجا');
  return true;
}
function safeFileName(name,type){
  var n=String(name||'').replace(/[^A-Za-z0-9._-]+/g,'-').replace(/\.{2,}/g,'.').replace(/^[-.]+/,'').slice(-80);
  if(!n||n.indexOf('.')<0)n=(n||'report')+'.'+(REPORT_TYPES[type]||'bin');
  return n;
}
function reportPath(workspace,order,name,type,rand){return workspace+'/'+order+'/'+rand+'-'+safeFileName(name,type);}
function sha256Hex(file){
  if(!(w.crypto&&w.crypto.subtle&&file.arrayBuffer))return Promise.resolve(null);
  return file.arrayBuffer().then(function(b){return w.crypto.subtle.digest('SHA-256',b);}).then(function(d){return Array.from(new Uint8Array(d)).map(function(x){return ('0'+x.toString(16)).slice(-2);}).join('');});
}
function notifyMessage(r){
  if(!r)return 'تعذر إرسال الإشعار';
  if(r.status==='sent')return 'تم إرسال إيميل للمريض';
  if(r.status==='already_sent')return 'تم إشعار المريض من قبل';
  if(r.status==='in_progress')return 'الإشعار قيد الإرسال، انتظر دقيقة';
  if(r.status==='skipped')return 'المريض ماعندوش بريد مفعّل في البوابة — بلّغه بالتليفون';
  if(r.status==='failed_final')return 'فشل الإرسال 3 مرات — بلّغ المريض بالتليفون';
  if(r.status==='failed')return (r.code==='EMAIL_NOT_CONFIGURED'||r.code==='EMAIL_FROM_NOT_CONFIGURED')?'خدمة البريد غير مهيأة بعد — بلّغ المريض بالتليفون':'تعذر إرسال الإيميل، جرّب مرة تانية';
  return 'تعذر إرسال الإشعار';
}
function boardTable(rows){
  if(!rows.length)return '<p>لا توجد طلبات.</p>';
  return '<div class="rx-table"><table><thead><tr><th>المريض</th><th>التليفون</th><th>الخدمة</th><th>المزوّد</th><th>الحالة</th><th>إجراء</th></tr></thead><tbody>'+rows.map(function(r){
    var acts=nextStatuses(r.status).map(function(s){return '<button type="button" class="btn" data-so-status="'+esc(s)+'" data-order="'+esc(r.order_id)+'">'+esc(STATUS[s]||s)+'</button>';}).join('');
    if(r.status==='done')acts+='<input type="file" data-so-file="'+esc(r.order_id)+'" accept="application/pdf,image/jpeg,image/png"><button type="button" class="btn" data-so-upload="'+esc(r.order_id)+'">رفع التقرير</button>';
    if(r.status==='report_uploaded'||r.status==='patient_notified')acts+='<button type="button" class="btn" data-so-open="'+esc(r.order_id)+'">فتح التقرير</button>'+(r.status==='report_uploaded'?'<button type="button" class="btn" data-so-notify="'+esc(r.order_id)+'">إشعار المريض بالإيميل</button>':'');
    return '<tr><td>'+esc(r.patient_name)+'</td><td dir="ltr">'+esc(r.phone)+'</td><td>'+esc(r.service)+'</td><td>'+esc(r.provider)+'</td><td>'+esc(STATUS[r.status]||r.status)+'</td><td>'+acts+'</td></tr>';
  }).join('')+'</tbody></table></div>';
}
function decorate(c,section){
  if(section!=='operations'||!c.host)return;
  var shell=c.host.querySelector('.rx-shell');if(!shell)return;
  var node=document.createElement('section');
  node.innerHTML='<div class="rx-actions">'+c.btn('so-order','','تفاصيل طلب الخدمة (إحالة / تنفيذ / مزوّد)')+c.btn('so-board','','لوحة المزوّدين الخارجيين')+c.btn('so-list','','حالة كل طلبات الخدمة')+c.btn('so-print','','طباعة مطالبة تأمينية')+(c.data.can_manage?c.btn('so-setup','','إعداد طلبات الخدمة'):'')+'</div>';
  shell.appendChild(node);
}
function act(a,id,c){
  if(a==='so-order'){orderForm(c);return true;}
  if(a==='so-board'){board(c);return true;}
  if(a==='so-list'){board(c,true);return true;}
  if(a==='so-print'){printClaim(c);return true;}
  if(a==='so-setup'){setup(c);return true;}
  return false;
}
function orderForm(c){
  var db=w.SSMPDDb,d=c.data,orders=(d.orders||[]).filter(function(o){return o.status==='ordered';});
  var doctors=(d.providers||[]).filter(function(p){return p.doctor_key&&p.active!==false;});
  db.serviceOrdersCatalog(c.workspace).then(function(cat){
    var rows=orders.map(function(o){return [o.id,((o.snapshot&&o.snapshot.name)||'خدمة')+' — '+c.lookup('patients',(d.visits.find(function(v){return v.id===o.visit_id;})||{}).patient_id)];});
    var body=c.select('order_id','الطلب',rows,'')+opt('kind','نوع الطلب',KINDS,'service','required')+opt('mode','مكان التنفيذ',MODES,'internal','required')+
      '<div data-so-provider hidden>'+opt('provider_id','المزوّد',[],'')+'</div><div data-so-bill hidden>'+opt('billing_party','مَن يحاسب المريض؟',BILL,'center')+'</div>'+
      '<div data-so-cat>'+opt('category','نوع الكشف',CATS,'consult')+'</div>'+opt('referring_doctor_key','الطبيب المُحيل (اختياري)',doctorRows(referrers(cat,doctors)),'')+opt('performing_doctor_key','الطبيب المنفّذ',[],'');
    var root=c.modal('تفاصيل طلب الخدمة',body,function(v){
      var ext=buildExt(v);return db.serviceOrderAttach(c.workspace,v.order_id,ext);});
    if(!root)return;
    function fill(sel,list,keep){var el=root.querySelector('[name="'+sel+'"]');el.innerHTML='<option value="">—</option>'+list.map(function(r){return '<option value="'+esc(r[0])+'">'+esc(r[1])+'</option>';}).join('');if(keep)el.value=keep;}
    function sync(){
      var kind=root.querySelector('[name="kind"]').value,mode=root.querySelector('[name="mode"]').value,ext=mode==='external';
      if(ext&&!externalAllowed(kind)){root.querySelector('[name="mode"]').value='internal';ext=false;}
      root.querySelector('[data-so-provider]').hidden=!ext;root.querySelector('[data-so-bill]').hidden=!needsBillingParty(kind,ext?'external':'internal');
      root.querySelector('[data-so-cat]').hidden=!needsCategory(kind);
      fill('provider_id',providersFor(cat,kind).map(function(p){return [p.id,p.name];}));
      var order=orders.find(function(o){return o.id===root.querySelector('[name="order_id"]').value;});
      fill('performing_doctor_key',doctorRows(performersFor(cat,order&&order.service_id,doctors)));
    }
    ['order_id','kind','mode'].forEach(function(n){root.querySelector('[name="'+n+'"]').addEventListener('change',sync);});sync();
  }).catch(function(e){c.modal('تعذر تحميل البيانات','<p>'+esc(e&&e.message||e)+'</p>',function(){return Promise.resolve();});});
}
function claimOrders(orders,services,visitId,pct){
  return (orders||[]).filter(function(o){return o.visit_id===visitId&&o.status!=='cancelled';}).map(function(o){
    var sv=(services||[]).find(function(x){return x.id===o.service_id;})||{};
    var price=Number(sv.price!=null?sv.price:(o.snapshot&&o.snapshot.price));
    return {id:o.id,kind:'service',service:{id:String(o.service_id||o.id),name:(o.snapshot&&o.snapshot.name)||sv.name||'خدمة',price:Number.isFinite(price)?price:0},
      quantity:Number(o.quantity)>0?Math.floor(Number(o.quantity)):1,contract:{discountPercent:pct.discount,copayPercent:pct.copay}};
  });
}
function printClaim(c){
  var d=c.data,R=w.SWNWServiceOrderRules,PR=w.SSMPDServiceInvoicePrint;
  var visits=(d.visits||[]).map(function(v){return [v.id,c.lookup('patients',v.patient_id)+' — زيارة '+(v.visit_no||'')];});
  var body='<p>تُحسب المطالبة من الخدمات المسجلة في الزيارة. أدخل شروط جهة التأمين.</p>'+c.select('visit_id','الزيارة',visits,'')+
    '<label>جهة التأمين<input name="insurer" type="text" required></label><label>رقم العضوية<input name="member" type="text"></label>'+
    '<label>نسبة الخصم %<input name="discount" type="number" min="0" max="100" step="0.01" value="0" required></label>'+
    '<label>نسبة تحمّل المريض %<input name="copay" type="number" min="0" max="100" step="0.01" value="0" required></label>';
  var root=c.modal('طباعة مطالبة تأمينية',body,function(v){
    if(!R||!PR)return Promise.reject(Error('وحدة الطباعة غير محمّلة'));
    if(!v.visit_id)return Promise.reject(Error('اختر الزيارة'));
    var list=claimOrders(d.orders,d.services,v.visit_id,{discount:Number(v.discount),copay:Number(v.copay)});
    if(!list.length)return Promise.reject(Error('لا توجد خدمات في هذه الزيارة'));
    var visit=(d.visits||[]).find(function(x){return x.id===v.visit_id;})||{};
    var inv=R.buildInvoices(list).invoices;
    if(!inv.length)return Promise.reject(Error('لا توجد بنود قابلة للفوترة'));
    try{PR.openPrint(inv,{patientName:c.lookup('patients',visit.patient_id),insurerName:v.insurer,memberNo:v.member,invoiceNo:'',date:new Date().toISOString().slice(0,10)});}catch(e){return Promise.reject(e);}
    return Promise.resolve();});
  if(root){var sb=root.querySelector('[type="submit"]');if(sb)sb.textContent='طباعة';}
  return root;
}
function board(c,all){
  var db=w.SSMPDDb;
  function paint(root,rows){var holder=root.querySelector('[data-so-rows]');holder.innerHTML=boardTable(rows);}
  function reload(root){return (all?db.serviceOrdersList(c.workspace,200):db.serviceOrdersBoard(c.workspace,null)).then(function(rows){paint(root,rows||[]);});}
  var root=c.modal(all?'حالة كل طلبات الخدمة':'لوحة المزوّدين الخارجيين','<p>بيانات المريض المعروضة: الاسم والتليفون فقط.</p><p data-so-note role="status"></p><div data-so-rows>جاري التحميل…</div>',function(){return Promise.resolve();});
  if(!root)return;root.querySelector('[type="submit"]').hidden=true;
  function note(t){var m=root.querySelector('[data-so-note]');if(m)m.textContent=t||'';}
  root.addEventListener('click',function(e){
    var t=e.target.closest('[data-so-status],[data-so-upload],[data-so-open],[data-so-notify]');if(!t)return;
    var p;
    if(t.dataset.soStatus)p=db.serviceOrderStatus(c.workspace,t.dataset.order,t.dataset.soStatus);
    else if(t.dataset.soUpload){
      var order=t.dataset.soUpload,input=root.querySelector('[data-so-file="'+order+'"]'),file=input&&input.files&&input.files[0];
      try{validateReportFile(file);}catch(err){note(err.message);return;}
      var rand=(w.crypto&&w.crypto.randomUUID?w.crypto.randomUUID():String(Date.now())).slice(0,8);
      var path=reportPath(c.workspace,order,file.name,file.type,rand);
      note('جاري رفع التقرير…');
      p=sha256Hex(file).then(function(sum){return db.serviceOrderReportUpload(c.workspace,order,path,file,sum);}).then(function(){note('تم رفع التقرير وظهر للمريض في ملفه. جاري إشعار المريض…');
        return db.serviceOrderNotify(c.workspace,order).then(function(r){note('تم رفع التقرير. '+notifyMessage(r));},function(){note('تم رفع التقرير. تعذر إشعار المريض — جرّب زر الإشعار');});});
    }else if(t.dataset.soNotify){
      note('جاري إرسال الإشعار…');
      p=db.serviceOrderNotify(c.workspace,t.dataset.soNotify).then(function(r){note(notifyMessage(r));});
    }else{
      note('جاري فتح التقرير…');
      p=db.serviceOrderReports(c.workspace,t.dataset.soOpen).then(function(list){
        if(!list||!list.length)throw Error('لا يوجد تقرير');return db.serviceOrderReportUrl(list[0].path);
      }).then(function(url){w.open(url,'_blank','noopener');note('');});
    }
    t.disabled=true;p.then(function(){t.disabled=false;return reload(root);}).catch(function(err){t.disabled=false;note((err&&err.message)||'تعذر التنفيذ');});
  });
  reload(root).catch(function(err){root.querySelector('[data-so-rows]').textContent=(err&&err.message)||'تعذر التحميل';});
}

var RATE_CATS=[['consult','كشف'],['followup','متابعة'],['consultation','استشارة'],['procedure','إجراء'],['radiology','أشعة'],['lab','معمل']];
function num(v,name,min,max){var n=Number(v);if(v===''||v==null||!Number.isFinite(n)||n<min||(max!=null&&n>max))throw Error(name);return n;}
function buildSetup(kind,v){
  if(kind==='service_specialty'){if(!v.service_id||!String(v.specialty_id||'').trim())throw Error('اختر الخدمة واكتب التخصص');return {op:'add',service_id:v.service_id,specialty_id:String(v.specialty_id).trim()};}
  if(kind==='performer'){var dk=v.doctor_key||'',sp=String(v.specialty_id||'').trim();if(!v.service_id||(!!dk===!!sp))throw Error('اختر الخدمة، ثم طبيبًا أو تخصصًا (واحد فقط)');
    var o={op:'add',service_id:v.service_id};if(dk)o.doctor_key=dk;else o.specialty_id=sp;return o;}
  if(kind==='referral_rate'){if(!v.doctor_key||!v.category)throw Error('اختر الطبيب والتصنيف');var r={op:'set',doctor_key:v.doctor_key,category:v.category,percent:num(v.percent,'النسبة بين 0 و100',0,100)};if(v.valid_from)r.valid_from=v.valid_from;return r;}
  if(kind==='provider'){var name=String(v.name||'').trim();if(!name||!v.kind)throw Error('اكتب اسم المزوّد واختر نوعه');var pr={name:name,kind:v.kind,phone:String(v.phone||'').trim(),active:v.active!=='0',terms:{}};
    if(v.kind==='radiology'){if(v.providerSharePercent!==''&&v.providerSharePercent!=null)pr.terms.providerSharePercent=num(v.providerSharePercent,'نسبة المزوّد بين 0 و100',0,100);
      if(v.centerSharePercent!==''&&v.centerSharePercent!=null)pr.terms.centerSharePercent=num(v.centerSharePercent,'نسبة المركز بين 0 و100',0,100);}
    if(v.id)pr.id=v.id;return pr;}
  if(kind==='cost'){if(!v.provider_id||!v.service_id)throw Error('اختر المعمل والخدمة');return {op:'set',provider_id:v.provider_id,service_id:v.service_id,year:num(v.year,'السنة غير صحيحة',2020,2100),cost:num(v.cost,'التكلفة غير صحيحة',0,null)};}
  throw Error('نوع الإعداد غير معروف');
}
function nameOf(list,id,key,label){var r=(list||[]).find(function(x){return x[key||'id']===id;});return r?r[label||'name']:'—';}
function setupTab(tab,S){
  var sv=S.services.map(function(x){return [x.id,x.name];}),dr=S.doctors.map(function(x){return [x.doctor_key,x.name];}),labs=S.providers.filter(function(p){return p.kind==='lab';}).map(function(x){return [x.id,x.name];});
  function rm(kind,payload){return '<button type="button" class="btn" data-so-rm="'+esc(JSON.stringify({kind:kind,payload:payload}))+'">حذف</button>';}
  function form(kind,fields,label){return '<div data-so-form="'+kind+'" class="rx-actions">'+fields+'<button class="btn btn-primary" type="button" data-so-submit>'+esc(label||'إضافة')+'</button></div>';}
  var h='';
  if(tab==='spec'){
    h+=form('service_specialty',opt('service_id','الخدمة',sv,'','required')+'<label>التخصص<input name="specialty_id" list="so-specs" required maxlength="80"></label><datalist id="so-specs">'+Array.from(new Set(S.service_specialties.map(function(x){return x.specialty_id;}))).map(function(x){return '<option value="'+esc(x)+'">';}).join('')+'</datalist>');
    h+='<div class="rx-table"><table><thead><tr><th>الخدمة</th><th>التخصص</th><th></th></tr></thead><tbody>'+S.service_specialties.map(function(x){return '<tr><td>'+esc(nameOf(S.services,x.service_id))+'</td><td>'+esc(x.specialty_id)+'</td><td>'+rm('service_specialty',{op:'remove',service_id:x.service_id,specialty_id:x.specialty_id})+'</td></tr>';}).join('')+'</tbody></table></div>';
  }else if(tab==='perf'){
    h+='<p>لو الخدمة ليها قائمة منفّذين، لا ينفذها غيرهم. الخدمات بدون قائمة مفتوحة للجميع.</p>'+form('performer',opt('service_id','الخدمة',sv,'','required')+opt('doctor_key','طبيب',dr,'')+'<label>أو تخصص<input name="specialty_id" maxlength="80"></label>');
    h+='<div class="rx-table"><table><thead><tr><th>الخدمة</th><th>المنفّذ</th><th></th></tr></thead><tbody>'+S.performers.map(function(x){return '<tr><td>'+esc(nameOf(S.services,x.service_id))+'</td><td>'+esc(x.doctor_key?nameOf(S.doctors,x.doctor_key,'doctor_key'):'تخصص: '+x.specialty_id)+'</td><td>'+rm('performer',{op:'remove',service_id:x.service_id,doctor_key:x.doctor_key||'',specialty_id:x.specialty_id||''})+'</td></tr>';}).join('')+'</tbody></table></div>';
  }else if(tab==='rate'){
    h+='<p>النسبة تُحسب من الصافي بعد الخصم، للخدمات فقط وليس الأدوية. تسجيل نسبة جديدة يُنهي القديمة تلقائيًا.</p>'+form('referral_rate',opt('doctor_key','الطبيب',dr,'','required')+opt('category','التصنيف',RATE_CATS,'consult','required')+'<label>النسبة %<input name="percent" type="number" min="0" max="100" step="0.01" required></label><label>تسري من<input name="valid_from" type="date"></label>','حفظ');
    h+='<div class="rx-table"><table><thead><tr><th>الطبيب</th><th>التصنيف</th><th>النسبة</th><th>من</th><th>إلى</th><th></th></tr></thead><tbody>'+S.referral_rates.map(function(x){return '<tr><td>'+esc(nameOf(S.doctors,x.doctor_key,'doctor_key'))+'</td><td>'+esc(nameOf(RATE_CATS.map(function(r){return {id:r[0],name:r[1]};}),x.category))+'</td><td>'+esc(x.percent)+'%</td><td>'+esc(x.valid_from)+'</td><td>'+esc(x.valid_to||'مستمرة')+'</td><td>'+rm('referral_rate',{op:'remove',id:x.id})+'</td></tr>';}).join('')+'</tbody></table></div>';
  }else if(tab==='prov'){
    h+=form('provider','<label>الاسم<input name="name" required maxlength="120"></label>'+opt('kind','النوع',[['lab','معمل'],['radiology','أشعة']],'lab','required')+'<label>التليفون<input name="phone" maxlength="40"></label><label>نسبة المزوّد % (أشعة خارجية يحاسبها المركز)<input name="providerSharePercent" type="number" min="0" max="100" step="0.01"></label><label>نسبة المركز % (أشعة يحاسبها المزوّد)<input name="centerSharePercent" type="number" min="0" max="100" step="0.01"></label>','إضافة مزوّد');
    h+='<div class="rx-table"><table><thead><tr><th>الاسم</th><th>النوع</th><th>التليفون</th><th>نسب</th><th>الحالة</th><th></th></tr></thead><tbody>'+S.providers.map(function(p){var t=p.terms||{};return '<tr><td>'+esc(p.name)+'</td><td>'+(p.kind==='lab'?'معمل':'أشعة')+'</td><td dir="ltr">'+esc(p.phone||'')+'</td><td>'+esc(p.kind==='radiology'?('مزوّد '+(t.providerSharePercent==null?'—':t.providerSharePercent)+'% / مركز '+(t.centerSharePercent==null?'—':t.centerSharePercent)+'%'):'سعر تكلفة')+'</td><td>'+(p.active?'نشط':'موقوف')+'</td><td><button type="button" class="btn" data-so-toggle="'+esc(p.id)+'">'+(p.active?'إيقاف':'تفعيل')+'</button></td></tr>';}).join('')+'</tbody></table></div>';
  }else{
    h+='<p>المعمل الخارجي: المركز يدفع للمعمل سعر التكلفة، والمريض يدفع حسب قائمة أسعار المركز.</p>'+form('cost',opt('provider_id','المعمل',labs,'','required')+opt('service_id','الخدمة',sv,'','required')+'<label>السنة<input name="year" type="number" min="2020" max="2100" value="'+new Date().getFullYear()+'" required></label><label>سعر التكلفة<input name="cost" type="number" min="0" step="0.01" required></label>','حفظ');
    h+='<div class="rx-table"><table><thead><tr><th>المعمل</th><th>الخدمة</th><th>السنة</th><th>التكلفة</th><th></th></tr></thead><tbody>'+S.costs.map(function(x){return '<tr><td>'+esc(nameOf(S.providers,x.provider_id))+'</td><td>'+esc(nameOf(S.services,x.service_id))+'</td><td>'+esc(x.year)+'</td><td>'+esc(x.cost)+'</td><td>'+rm('cost',{op:'remove',provider_id:x.provider_id,service_id:x.service_id,year:x.year})+'</td></tr>';}).join('')+'</tbody></table></div>';
  }
  return h;
}
var TABS=[['spec','الخدمات والتخصصات'],['perf','المنفّذون'],['rate','نسب الإحالة'],['prov','المزوّدون'],['cost','أسعار تكلفة المعامل']];
function setup(c){
  var db=w.SSMPDDb,S=null,tab='spec';
  var root=c.modal('إعداد طلبات الخدمة','<div class="rx-actions" data-so-tabs>'+TABS.map(function(t){return '<button type="button" class="btn" data-so-tab="'+t[0]+'">'+esc(t[1])+'</button>';}).join('')+'</div><p data-so-msg role="status"></p><div data-so-body>جاري التحميل…</div>',function(){return Promise.resolve();});
  if(!root)return;root.querySelector('[type="submit"]').hidden=true;
  function paint(){root.querySelector('[data-so-body]').innerHTML=S?setupTab(tab,S):'';root.querySelectorAll('[data-so-tab]').forEach(function(b){b.setAttribute('aria-pressed',b.dataset.soTab===tab?'true':'false');});}
  function msg(t){root.querySelector('[data-so-msg]').textContent=t||'';}
  function reload(){return db.serviceOrdersSetupLoad(c.workspace).then(function(d){S=d;paint();});}
  function run(p){msg('جاري الحفظ…');return p.then(function(){msg('تم الحفظ');return reload();}).catch(function(e){msg((e&&e.message)||'تعذر الحفظ');});}
  root.addEventListener('click',function(e){
    var t=e.target.closest('[data-so-tab],[data-so-rm],[data-so-toggle],[data-so-submit]');if(!t)return;
    if(t.hasAttribute('data-so-submit'))return submitForm(t.closest('[data-so-form]'));
    if(t.dataset.soTab){tab=t.dataset.soTab;msg('');paint();return;}
    if(t.dataset.soRm){var x=JSON.parse(t.dataset.soRm);run(db.serviceOrdersSetupSave(c.workspace,x.kind,x.payload));return;}
    if(t.dataset.soToggle){var p=S.providers.find(function(q){return q.id===t.dataset.soToggle;});if(!p)return;
      var v={id:p.id,name:p.name,kind:p.kind,phone:p.phone||'',active:p.active?'0':'1',providerSharePercent:(p.terms||{}).providerSharePercent,centerSharePercent:(p.terms||{}).centerSharePercent};
      run(db.serviceOrdersSetupSave(c.workspace,'provider',buildSetup('provider',v)));}
  });
  function submitForm(f){
    if(!f)return;
    var v={},bad=false;
    Array.prototype.forEach.call(f.querySelectorAll('input,select,textarea'),function(el){if(!el.name)return;if(el.required&&!String(el.value).trim())bad=true;v[el.name]=el.value;});
    if(bad){msg('اكمل الحقول المطلوبة');return;}
    try{run(db.serviceOrdersSetupSave(c.workspace,f.dataset.soForm,buildSetup(f.dataset.soForm,v)));}catch(err){msg(err.message);}
  }
  root.addEventListener('keydown',function(e){
    var f=e.key==='Enter'&&e.target.closest&&e.target.closest('[data-so-form]');
    if(f&&e.target.tagName!=='BUTTON'){e.preventDefault();submitForm(f);}
  },true);
  reload().catch(function(e){root.querySelector('[data-so-body]').textContent=(e&&e.message)||'تعذر التحميل';});
}
w.SSMPDReceptionServiceOrders={decorate:decorate,act:act,_pure:{claimOrders:claimOrders,externalAllowed:externalAllowed,needsBillingParty:needsBillingParty,providersFor:providersFor,performersFor:performersFor,referrers:referrers,nextStatuses:nextStatuses,buildExt:buildExt,boardTable:boardTable,validateReportFile:validateReportFile,notifyMessage:notifyMessage,safeFileName:safeFileName,reportPath:reportPath,buildSetup:buildSetup,setupTab:setupTab}};
})(typeof window!=='undefined'?window:globalThis);
