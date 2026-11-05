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
function boardTable(rows){
  if(!rows.length)return '<p>لا توجد حالات خارجية.</p>';
  return '<div class="rx-table"><table><thead><tr><th>المريض</th><th>التليفون</th><th>الخدمة</th><th>المزوّد</th><th>الحالة</th><th>إجراء</th></tr></thead><tbody>'+rows.map(function(r){
    var acts=nextStatuses(r.status).map(function(s){return '<button type="button" class="btn" data-so-status="'+esc(s)+'" data-order="'+esc(r.order_id)+'">'+esc(STATUS[s]||s)+'</button>';}).join('');
    if(r.status==='done')acts+='<input data-so-file="'+esc(r.order_id)+'" placeholder="مرجع ملف التقرير" maxlength="300"><button type="button" class="btn" data-so-report="'+esc(r.order_id)+'">رفع التقرير</button>';
    return '<tr><td>'+esc(r.patient_name)+'</td><td dir="ltr">'+esc(r.phone)+'</td><td>'+esc(r.service)+'</td><td>'+esc(r.provider)+'</td><td>'+esc(STATUS[r.status]||r.status)+'</td><td>'+acts+'</td></tr>';
  }).join('')+'</tbody></table></div>';
}
function decorate(c,section){
  if(section!=='operations'||!c.host)return;
  var shell=c.host.querySelector('.rx-shell');if(!shell)return;
  var node=document.createElement('section');
  node.innerHTML='<div class="rx-actions">'+c.btn('so-order','','تفاصيل طلب الخدمة (إحالة / تنفيذ / مزوّد)')+c.btn('so-board','','لوحة المزوّدين الخارجيين')+'</div>';
  shell.appendChild(node);
}
function act(a,id,c){
  if(a==='so-order'){orderForm(c);return true;}
  if(a==='so-board'){board(c);return true;}
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
function board(c){
  var db=w.SSMPDDb;
  function paint(root,rows){var holder=root.querySelector('[data-so-rows]');holder.innerHTML=boardTable(rows);}
  function reload(root){return db.serviceOrdersBoard(c.workspace,null).then(function(rows){paint(root,rows||[]);});}
  var root=c.modal('لوحة المزوّدين الخارجيين','<p>بيانات المريض المعروضة: الاسم والتليفون فقط.</p><div data-so-rows>جاري التحميل…</div>',function(){return Promise.resolve();});
  if(!root)return;root.querySelector('[type="submit"]').hidden=true;
  root.addEventListener('click',function(e){
    var t=e.target.closest('[data-so-status],[data-so-report]');if(!t)return;
    var p;
    if(t.dataset.soStatus)p=db.serviceOrderStatus(c.workspace,t.dataset.order,t.dataset.soStatus);
    else{var input=root.querySelector('[data-so-file="'+t.dataset.soReport+'"]');p=db.serviceOrderReport(c.workspace,t.dataset.soReport,(input&&input.value||'').trim());}
    t.disabled=true;p.then(function(){return reload(root);}).catch(function(err){t.disabled=false;alert(err&&err.message||err);});
  });
  reload(root).catch(function(err){root.querySelector('[data-so-rows]').textContent=(err&&err.message)||'تعذر التحميل';});
}
w.SSMPDReceptionServiceOrders={decorate:decorate,act:act,_pure:{externalAllowed:externalAllowed,needsBillingParty:needsBillingParty,providersFor:providersFor,performersFor:performersFor,referrers:referrers,nextStatuses:nextStatuses,buildExt:buildExt,boardTable:boardTable}};
})(typeof window!=='undefined'?window:globalThis);
