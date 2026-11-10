/* «مهامي الوظيفية» — read-only card on the personal home page (الرئيسية الشخصية).
   Duties text lives in job-duties-data.js (edit there). This file only maps the logged-in user to duty sets and renders them.
   Sources: admin.roles (public.admins.role + admin_extra_roles), admin.has_hr_access, and, when readable through the existing
   hr_workspace RPC, the user's own clinic_people row (job_title / department / kind). Conservative: when unsure, show less. */
(function(root){'use strict';
var ORDER=['chairman_ceo_founder','founder_partner','managing_director','ceo','financial_manager','accountant','hr','doctor','nursing','reception','customer_service','legal'];
/* admin role -> duty key (roles that have no entry here, e.g. super_admin / general_manager, show nothing by themselves). */
var ROLE_MAP={financial_manager:'financial_manager',accountant:'accountant',reception:'reception',customer_service:'customer_service',sono_doctor:'doctor',nursing:'nursing',head_nursing:'nursing'};
/* job_title / department keywords (normalized, see norm()) -> duty key. Only management, HR and legal use titles. */
var TITLE_MAP=[['chairman','رئيس مجلس'],['chairman','الرئيس التنفيذي'],['founder','شريك'],['managing_director','العضو المنتدب'],['managing_director','المدير الطبي'],['ceo','مدير تنفيذي'],['hr','موارد بشريه'],['legal','قانوني'],['legal','محامي']];
var cache={},tabState={},openState={};
function esc(v){return String(v==null?'':v).replace(/[&<>"']/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c];});}
function norm(s){return String(s==null?'':s).replace(/[ً-ٟـ]/g,'').replace(/[أإآ]/g,'ا').replace(/ة/g,'ه').replace(/ى/g,'ي').replace(/\s+/g,' ').trim();}
function rolesOf(admin){var R=root.SSMPDRoles;if(R&&R.rolesOf)return R.rolesOf(admin);return Array.isArray(admin.roles)&&admin.roles.length?admin.roles:(admin.role?[admin.role]:[]);}
/* resolve(admin, person) -> ordered list of duty keys. `person` is the optional clinic_people row of this user. */
function resolve(admin,person){
 var set={},roles=rolesOf(admin||{});person=person||{};
 roles.forEach(function(r){if(ROLE_MAP[r])set[ROLE_MAP[r]]=1;});
 if(admin&&admin.has_hr_access===true)set.hr=1;
 if(person.kind==='doctor'||person.kind==='both')set.doctor=1;
 var title=norm(person.job_title),dept=norm(person.department),text=title+' | '+dept;
 TITLE_MAP.forEach(function(m){if(text.indexOf(norm(m[1]))<0)return;
  if(m[0]==='chairman')set.chairman_ceo_founder=1;
  else if(m[0]==='founder')set.founder_partner=1;
  else set[m[0]]=1;});
 /* the owner's combined entry already covers founder + executive duties */
 if(set.chairman_ceo_founder){delete set.founder_partner;delete set.ceo;}
 /* the «المدير التنفيذي» entry describes the executive director role; a combined managing-director title is not it */
 if(set.ceo&&set.managing_director&&title.indexOf("العضو المنتدب")>=0)delete set.ceo;
 return ORDER.filter(function(k){return set[k];});
}
function entries(keys){var data=root.SSMPDJobDutiesData,list=(data&&data.roles)||[];return keys.map(function(k){return list.filter(function(r){return r.key===k;})[0];}).filter(Boolean);}
function field(label,v){var body=Array.isArray(v)?'<ul>'+v.map(function(x){return '<li>'+esc(x)+'</li>';}).join('')+'</ul>':'<p>'+esc(v)+'</p>';return '<section class="ph-duty-field"><h4>'+esc(label)+'</h4>'+body+'</section>';}
function panel(role,id){return field('المهام اليومية',role.daily)+field('المهام الدورية والمراجعات',role.periodic)+field('لا يملك صلاحية',role.notAuthorized)+field('يرفع إلى',role.reportsTo);}
function inner(list,adminId,pending){
 if(!list.length){if(pending)return '<p class="ph-empty" role="status">جاري تحميل مهامك الوظيفية…</p>';return '<p class="ph-empty">لا توجد مهام وظيفية معروضة لحسابك حاليًا. لو محتاج تعرف مهام دورك، <b>تواصل مع الإدارة</b>.</p>';}
 var sel=tabState[adminId];if(!list.some(function(r){return r.key===sel;}))sel=list[0].key;
 if(list.length===1)return '<div class="ph-duty-single"><h3>'+esc(list[0].title)+'</h3>'+panel(list[0])+'</div>';
 return '<div class="ph-duty-tabs" role="tablist" aria-label="أدوارك الوظيفية">'+list.map(function(r){var on=r.key===sel;return '<button type="button" role="tab" class="ph-duty-tab'+(on?' on':'')+'" id="ph-duty-tab-'+r.key+'" data-duty-tab="'+r.key+'" aria-selected="'+on+'" aria-controls="ph-duty-panel-'+r.key+'" tabindex="'+(on?'0':'-1')+'">'+esc(r.title)+'</button>';}).join('')+'</div>'+list.map(function(r){return '<div class="ph-duty-panel" role="tabpanel" id="ph-duty-panel-'+r.key+'" aria-labelledby="ph-duty-tab-'+r.key+'" tabindex="0"'+(r.key===sel?'':' hidden')+'>'+panel(r)+'</div>';}).join('');
}
function wire(box,adminId){
 var tabs=[].slice.call(box.querySelectorAll('[data-duty-tab]'));
 function select(btn,focus){tabs.forEach(function(t){var on=t===btn;t.classList.toggle('on',on);t.setAttribute('aria-selected',String(on));t.tabIndex=on?0:-1;var p=box.querySelector('#ph-duty-panel-'+t.dataset.dutyTab);if(p)p.hidden=!on;});tabState[adminId]=btn.dataset.dutyTab;if(focus)btn.focus();}
 tabs.forEach(function(t,i){t.onclick=function(){select(t,false);};t.onkeydown=function(e){
  /* RTL: the first tab is on the right, so ArrowLeft moves forward and ArrowRight backward */
  var next=e.key==='ArrowLeft'?i+1:e.key==='ArrowRight'?i-1:e.key==='Home'?0:e.key==='End'?tabs.length-1:null;
  if(next===null)return;e.preventDefault();select(tabs[(next+tabs.length)%tabs.length],true);};});
}
function draw(host,admin,person,pending){
 var keys=resolve(admin,person),list=entries(keys),id=String(admin.id),was=host.querySelector('details'),isOpen=was?was.open:!!openState[id];
 host.innerHTML='<details class="ph-card ph-duties"'+(isOpen?' open':'')+'><summary><h2>مهامي الوظيفية</h2><span class="ph-duties-count">'+(list.length?esc(list.length===1?list[0].title:list.length+' أدوار'):'')+'</span></summary><div class="ph-duties-body">'+inner(list,id,pending)+'</div><p class="ph-note">للعرض فقط — تُحدَّث المهام من الإدارة.</p></details>';
 var d=host.querySelector('details');d.addEventListener('toggle',function(){openState[id]=d.open;});wire(host,id);
}
function fetchPerson(admin){
 var id=String(admin.id);if(cache[id])return cache[id];
 var db=root.SSMPDDb,client=db&&db.client;
 if(!client||typeof client.rpc!=='function')return (cache[id]=Promise.resolve(null));
 var month=new Date().toISOString().slice(0,7)+'-01';
 cache[id]=Promise.resolve(client.rpc('hr_workspace',{p_month:month})).then(function(r){var people=r&&r.data&&r.data.people;if(!Array.isArray(people))return null;return people.filter(function(p){return p&&p.admin_id===admin.id;})[0]||null;}).catch(function(){return null;});
 return cache[id];
}
/* Draws immediately from the account roles, then refines once the user's own HR row (job title / kind) arrives. */
function mount(host,admin){
 if(!host||!admin)return;
 draw(host,admin,null,true);
 fetchPerson(admin).then(function(person){if(host.isConnected)draw(host,admin,person,false);});
}
root.SSMPDJobDuties={mount:mount,resolve:resolve,_norm:norm};
})(window);
