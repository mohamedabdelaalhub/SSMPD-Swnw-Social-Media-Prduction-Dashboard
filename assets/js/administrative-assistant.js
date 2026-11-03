(function(w){
  'use strict';
  var mounted=false,client=null,panel=null,launch=null,refreshTimer=null,ownerAdminId=null,lastData=null;
  var ACCESS_LABELS={hr_access:'إدارة الموارد البشرية',price_lists_access:'إدارة لوائح الأسعار',archive_access:'أرشيف المرضى',archive_review:'اعتماد ملفات المرضى',verification_management:'إدارة تحقق هوية المرضى',accounting_view:'الحسابات — عرض فقط','role:contract_manager':'جهات التعاقد','role:page_manager':'إنتاج وإدارة المحتوى','role:designer':'التصميم','role:approver':'اعتماد المحتوى','role:reception':'الاستقبال وخزينة الحجز','role:customer_service':'خدمة العملاء وإدارة الليدز','role:nursing':'التمريض','role:super_admin':'لوحة تحكم السوبر أدمن'};
  function esc(v){return String(v==null?'':v).replace(/[&<>"']/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c];});}
  function norm(v){return String(v||'').normalize('NFKD').replace(/[\u064b-\u065f\u0670\u0640]/g,'').replace(/[أإآٱ]/g,'ا').replace(/ى/g,'ي').replace(/ة/g,'ه').toLowerCase().replace(/[^\p{L}\p{N}_]+/gu,' ').trim();}
  function roles(a){return Array.isArray(a&&a.roles)&&a.roles.length?a.roles:(a&&a.role?[a.role]:[]);}
  function isManager(a){var r=roles(a);return r.indexOf('super_admin')!==-1||r.indexOf('general_manager')!==-1;}
  function isOwner(a){return !!a&&!!ownerAdminId&&a.id===ownerAdminId;}
  function accessLabel(action){var key=String(action&&action.access_key||'');return ACCESS_LABELS[key]||'صلاحية غير معروفة';}
  function modeLabel(v){return {read_only:'قراءة فقط',shadow:'وضع الظل',approval:'تنفيذ بعد الموافقة',delegated:'تفويض مسبق'}[v]||v||'غير محدد';}
  function relative(iso){if(!iso)return '';var m=Math.max(0,Math.round((Date.now()-new Date(iso).getTime())/60000));if(m<1)return 'الآن';if(m<60)return 'من '+m+' دقيقة';var h=Math.round(m/60);if(h<24)return 'من '+h+' ساعة';return 'من '+Math.round(h/24)+' يوم';}
  function currentAdmin(){return w.SSMPDAuth&&w.SSMPDAuth.currentAdmin;}
  function cfg(){return w.SSMPD_CONFIG&&w.SSMPD_CONFIG.supabase;}
  function initClient(){if(client)return client;var c=cfg();if(!c||!w.supabase)return null;client=w.supabase.createClient(c.url,c.anonKey,{auth:{persistSession:true,autoRefreshToken:true}});return client;}
  function shell(){
    launch=document.createElement('button');launch.className='ssmpd-aa-launch';launch.type='button';launch.textContent='المساعد الإداري';launch.hidden=true;
    panel=document.createElement('aside');panel.className='ssmpd-aa-panel';panel.hidden=true;panel.setAttribute('aria-label','المساعد الإداري');
    document.body.appendChild(launch);document.body.appendChild(panel);
    launch.onclick=function(){panel.hidden=!panel.hidden;if(!panel.hidden)refresh();};
    panel.addEventListener('click',function(e){
      if(e.target.closest('[data-aa-close]'))panel.hidden=true;
      if(e.target.closest('[data-aa-refresh]'))refresh();
      var approve=e.target.closest('[data-aa-access-approve]');if(approve)approveAccess(approve.getAttribute('data-aa-access-approve'),false);
      var reject=e.target.closest('[data-aa-access-reject]');if(reject)rejectAccess(reject.getAttribute('data-aa-access-reject'));
      if(e.target.closest('[data-aa-command-send]'))runOwnerCommand();
    });
    panel.addEventListener('keydown',function(e){var input=e.target.closest('[data-aa-command]');if(input&&e.key==='Enter'&&!e.shiftKey){e.preventDefault();runOwnerCommand();}});
  }
  function errorHtml(msg){return '<div class="ssmpd-aa-head"><h2>المساعد الإداري</h2><button class="ssmpd-aa-close" data-aa-close type="button">×</button></div><p class="ssmpd-aa-empty">'+esc(msg)+'</p>';}
  function accessRequestHtml(r){var a=r.suggested_action||{},label=accessLabel(a),name=a.requester_name||'الموظف',actionable=['waiting_owner','pending','reviewing'].indexOf(r.status)!==-1,known=!!ACCESS_LABELS[String(a.access_key||'')],buttons='';if(isOwner(currentAdmin())){buttons=actionable&&known?'<div style="display:flex;gap:6px;flex-wrap:wrap;margin-top:8px"><button class="btn sm" data-aa-access-approve="'+esc(r.id)+'" type="button">أوافق وأفتح الصلاحية</button><button class="btn ghost sm" data-aa-access-reject="'+esc(r.id)+'" type="button">أرفض</button></div>':actionable?'<small>نوع الصلاحية غير معروف ولن يتم تنفيذه.</small>':'';}else buttons='<small>الطلب ينتظر قرار المالك.</small>';return '<div class="ssmpd-aa-item"><b>طلب صلاحية · '+esc(label)+'</b><div><strong>'+esc(name)+'</strong> طلب الوصول.</div><div>السبب: '+esc(r.body)+'</div><small>'+relative(r.created_at)+(r.status==='reviewing'?' · جاهز للتنفيذ المباشر':'')+'</small>'+buttons+'</div>';}
  function render(data){
    lastData=data||{};
    var c=data&&data.config||{}, counts=data&&data.counts||{}, reqs=Array.isArray(data&&data.requests)?data.requests:[], rules=Array.isArray(data&&data.rules)?data.rules:[];ownerAdminId=c.owner_admin_id||null;
    var open=reqs.slice(0,12).map(function(r){if(r.source==='access_request')return accessRequestHtml(r);return '<div class="ssmpd-aa-item"><b>'+esc(r.priority==='critical'?'حرج':r.priority==='urgent'?'عاجل':'طلب')+'</b><div>'+esc(r.body)+'</div><small>'+esc(r.source)+' · '+relative(r.created_at)+'</small></div>';}).join('');
    var ruleRows=rules.slice(0,6).map(function(r){return '<div class="ssmpd-aa-item"><b>'+esc(r.title)+'</b><div>'+esc(r.instruction)+'</div><small>'+esc(r.scope)+' · '+esc(r.approval_mode)+'</small></div>';}).join('');
    var command=isOwner(currentAdmin())?'<section class="ssmpd-aa-section ssmpd-aa-form"><h3>قولي قرارك</h3><div style="display:flex;gap:8px;align-items:flex-end"><textarea data-aa-command rows="2" placeholder="مثال: موافق · موافق على صلاحية الحسابات لمحمود"></textarea><button class="btn" data-aa-command-send type="button">تنفيذ</button></div><div class="ssmpd-aa-status" data-aa-command-status></div></section>':'';
    panel.innerHTML='<div class="ssmpd-aa-head"><h2>المساعد الإداري</h2><div><button class="btn ghost sm" data-aa-refresh type="button">تحديث</button> <button class="ssmpd-aa-close" data-aa-close type="button">×</button></div></div>'+
      '<div class="ssmpd-aa-mode">'+esc(modeLabel(c.mode))+(c.auto_execute_enabled?' · تنفيذ تلقائي مفعل':' · التنفيذ التلقائي متوقف')+'</div>'+
      '<div class="ssmpd-aa-grid"><div class="ssmpd-aa-kpi"><b>'+Number(counts.pending||0)+'</b><span>قيد المراجعة</span></div><div class="ssmpd-aa-kpi"><b>'+Number(counts.waiting_owner||0)+'</b><span>مطلوب منك</span></div><div class="ssmpd-aa-kpi"><b>'+Number(counts.urgent||0)+'</b><span>عاجل</span></div></div>'+
      '<div class="ssmpd-aa-grid"><div class="ssmpd-aa-kpi"><b>'+Number(data.task_overdue||0)+'</b><span>مهام متأخرة</span></div><div class="ssmpd-aa-kpi"><b>'+Number(data.claude_pending||0)+'</b><span>Claude جاري</span></div><div class="ssmpd-aa-kpi"><b>'+rules.length+'</b><span>قواعد نشطة</span></div></div>'+
      '<div class="ssmpd-aa-grid"><div class="ssmpd-aa-kpi"><b>'+Number(data.payroll_pending||0)+'</b><span>رواتب معلقة</span></div><div class="ssmpd-aa-kpi"><b>'+Number(data.payroll_attention||0)+'</b><span>رواتب تحتاجك</span></div><div class="ssmpd-aa-kpi"><b>'+Number((data.payroll_pending||0)-(data.payroll_attention||0)>0?(data.payroll_pending||0)-(data.payroll_attention||0):0)+'</b><span>رواتب طبيعية</span></div></div>'+
      '<section class="ssmpd-aa-section"><h3>طلبات الموظفين والمطلوب منك</h3>'+(open||'<div class="ssmpd-aa-empty">لا توجد طلبات مفتوحة الآن.</div>')+'</section>'+command+
      '<section class="ssmpd-aa-section"><h3>قواعدي الحالية</h3>'+(ruleRows||'<div class="ssmpd-aa-empty">لا توجد قواعد بعد.</div>')+'</section>'+
      (isOwner(currentAdmin())?'<section class="ssmpd-aa-section ssmpd-aa-form"><h3>علّمني قاعدة</h3><textarea data-aa-instruction placeholder="مثال: لو كشف المرتبات طبيعي ومطابق للحضور اعتمده، ولو فيه فرق استناني."></textarea><button class="btn" data-aa-teach type="button">حفظ التعليمة</button><div class="ssmpd-aa-status" data-aa-status></div></section>':'');
    var teach=panel.querySelector('[data-aa-teach]');if(teach)teach.onclick=saveInstruction;
  }
  async function refresh(){var a=currentAdmin(),database=initClient();if(!a||!isManager(a)||!database)return;try{var res=await database.rpc('administrative_assistant_dashboard');if(res.error)throw res.error;if(res.data&&res.data.error)throw new Error('غير مصرح');render(res.data||{});}catch(err){panel.innerHTML=errorHtml('تعذر تحميل المساعد: '+(err&&err.message?err.message:err));}}
  async function getRequest(id){var res=await initClient().from('administrative_assistant_requests').select('*').eq('id',id).single();if(res.error)throw res.error;return res.data;}
  async function updateRequest(id,patch){patch.updated_at=new Date().toISOString();var res=await initClient().from('administrative_assistant_requests').update(patch).eq('id',id);if(res.error)throw res.error;}
  async function invokeGrant(id,confirmCritical){
    var res=await initClient().functions.invoke('assistant-grant-access',{body:{request_id:id,confirm_critical:confirmCritical===true}}),payload=res.data||null;
    if(res.error){
      if(!payload&&res.error.context&&typeof res.error.context.json==='function'){try{payload=await res.error.context.json();}catch(_){} }
      if(payload&&payload.error==='critical_confirmation_required'){
        if(!confirm('الطلب يمنح صلاحية Super Admin كاملة. هل تؤكد منحها الآن؟'))return null;
        return invokeGrant(id,true);
      }
      throw new Error(payload&&payload.error?payload.error:(res.error.message||'تعذر منح الصلاحية'));
    }
    if(payload&&payload.error){if(payload.error==='critical_confirmation_required'){if(!confirm('الطلب يمنح صلاحية Super Admin كاملة. هل تؤكد منحها الآن؟'))return null;return invokeGrant(id,true);}throw new Error(payload.error);}
    return payload||{};
  }
  async function approveAccess(id,skipConfirm){if(!isOwner(currentAdmin()))return;try{var r=await getRequest(id),a=r.suggested_action||{},label=accessLabel(a);if(!ACCESS_LABELS[String(a.access_key||'')])throw new Error('نوع الصلاحية غير معروف ولا يمكن منحه');if(!skipConfirm&&!confirm('الموافقة على طلب '+(a.requester_name||'الموظف')+' وفتح «'+label+'» فورًا؟'))return;var result=await invokeGrant(id,false);if(!result)return;if(w.SSMPDToast)w.SSMPDToast.show('تم فتح الصلاحية وإبلاغ الموظف.');await refresh();}catch(e){alert(e.message||'تعذر اعتماد الطلب');}}
  function openAccessRequests(){var reqs=Array.isArray(lastData&&lastData.requests)?lastData.requests:[];return reqs.filter(function(r){var a=r.suggested_action||{};return r.source==='access_request'&&ACCESS_LABELS[String(a.access_key||'')]&&['waiting_owner','pending','reviewing'].indexOf(r.status)!==-1;});}
  function commandMatches(r,q){var a=r.suggested_action||{},hay=norm((a.requester_name||'')+' '+accessLabel(a)+' '+(a.access_key||'')+' '+(r.body||''));var words=norm(q).split(' ').filter(function(x){return x.length>2&&['موافق','وافق','اعتمد','تمام','ادي','اديله','افتح','الصلاحيه','صلاحية','صلاحيات'].indexOf(x)===-1;});if(!words.length)return true;return words.every(function(x){return hay.indexOf(x)!==-1;});}
  async function runOwnerCommand(){if(!isOwner(currentAdmin()))return;var input=panel.querySelector('[data-aa-command]'),status=panel.querySelector('[data-aa-command-status]'),q=String(input&&input.value||'').trim(),n=norm(q);if(!q){status.textContent='اكتب قرارك.';return;}if(!/(موافق|وافق|اعتمد|تمام|اديه|اديله|ادي له|افتح)/.test(n)){status.textContent='حاليًا التنفيذ المباشر هنا لقرارات الموافقة على طلبات الصلاحيات. اكتب «موافق» أو اذكر الموظف والصلاحية.';return;}var reqs=openAccessRequests();if(!reqs.length){status.textContent='لا يوجد طلب صلاحية مفتوح ينتظر قرارك.';return;}var matches=reqs.filter(function(r){return commandMatches(r,q);});if(matches.length===0){status.textContent='مش لاقي طلب مطابق للكلام ده. اذكر اسم الموظف أو اسم الصلاحية كما ظاهر في الطلب.';return;}if(matches.length>1){status.textContent='عندك أكثر من طلب صلاحية مفتوح. اكتب اسم الموظف أو الصلاحية، مثل «موافق على الحسابات لمحمود».';return;}var r=matches[0],a=r.suggested_action||{};status.textContent='جارٍ فتح «'+accessLabel(a)+'» لـ '+(a.requester_name||'الموظف')+'…';input.disabled=true;try{await approveAccess(r.id,true);}finally{if(input&&input.isConnected){input.disabled=false;input.value='';}}}
  async function rejectAccess(id){if(!isOwner(currentAdmin()))return;var reason=prompt('اكتب سبب الرفض ليظهر للموظف:','');if(reason===null)return;reason=String(reason||'').trim();if(reason.length<3){alert('اكتب سبب الرفض بوضوح.');return;}try{await updateRequest(id,{status:'rejected',decision_summary:reason});if(w.SSMPDToast)w.SSMPDToast.show('تم رفض الطلب وسيظهر السبب للموظف.');await refresh();}catch(e){alert(e.message||'تعذر رفض الطلب');}}
  async function saveInstruction(){var a=currentAdmin(),box=panel.querySelector('[data-aa-instruction]'),status=panel.querySelector('[data-aa-status]'),text=String(box&&box.value||'').trim();if(!text){status.textContent='اكتب التعليمة أولًا.';return;}status.textContent='جارٍ الحفظ…';try{var title=text.length>70?text.slice(0,67)+'…':text;var row={title:title,instruction:text,scope:'general',action_type:'owner_instruction',conditions:{source:'assistant_panel'},approval_mode:'owner_each_time',active:true,created_by:a.id,approved_by:a.id,approved_at:new Date().toISOString()};var res=await initClient().from('administrative_assistant_rules').insert(row);if(res.error)throw res.error;box.value='';status.textContent='تم حفظ التعليمة كقاعدة معتمدة.';setTimeout(refresh,350);}catch(err){status.textContent='تعذر الحفظ: '+(err&&err.message?err.message:err);}}
  function mount(){if(mounted)return;var a=currentAdmin();if(!a||!document.body)return;if(!isManager(a))return;mounted=true;shell();launch.hidden=false;refresh();refreshTimer=setInterval(function(){if(panel&&!panel.hidden)refresh();},60000);w.addEventListener('ssmpd-tasks-changed',function(){if(panel&&!panel.hidden)refresh();});}
  function wait(){var a=currentAdmin();if(a&&document.getElementById('app-root')){mount();if(!mounted)setTimeout(wait,1000);}else setTimeout(wait,700);}
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',wait);else wait();
})(window);
