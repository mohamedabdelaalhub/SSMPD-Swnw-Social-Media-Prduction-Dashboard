(function(w){
  'use strict';
  var mounted=false, client=null, panel=null, launch=null, refreshTimer=null;
  function esc(v){return String(v==null?'':v).replace(/[&<>"']/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c];});}
  function roles(a){return Array.isArray(a&&a.roles)&&a.roles.length?a.roles:(a&&a.role?[a.role]:[]);}
  function isManager(a){var r=roles(a);return r.indexOf('super_admin')!==-1||r.indexOf('general_manager')!==-1;}
  function isOwner(a){return !!a&&a.id==='bd5a528f-af8d-4ada-afe9-ce64e68b1d92';}
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
    panel.addEventListener('click',function(e){if(e.target.closest('[data-aa-close]'))panel.hidden=true;if(e.target.closest('[data-aa-refresh]'))refresh();});
  }
  function errorHtml(msg){return '<div class="ssmpd-aa-head"><h2>المساعد الإداري</h2><button class="ssmpd-aa-close" data-aa-close type="button">×</button></div><p class="ssmpd-aa-empty">'+esc(msg)+'</p>';}
  function render(data){
    var c=data&&data.config||{}, counts=data&&data.counts||{}, reqs=Array.isArray(data&&data.requests)?data.requests:[], rules=Array.isArray(data&&data.rules)?data.rules:[];
    var open=reqs.slice(0,8).map(function(r){return '<div class="ssmpd-aa-item"><b>'+esc(r.priority==='critical'?'حرج':r.priority==='urgent'?'عاجل':'طلب')+'</b><div>'+esc(r.body)+'</div><small>'+esc(r.source)+' · '+relative(r.created_at)+'</small></div>';}).join('');
    var ruleRows=rules.slice(0,6).map(function(r){return '<div class="ssmpd-aa-item"><b>'+esc(r.title)+'</b><div>'+esc(r.instruction)+'</div><small>'+esc(r.scope)+' · '+esc(r.approval_mode)+'</small></div>';}).join('');
    panel.innerHTML='<div class="ssmpd-aa-head"><h2>المساعد الإداري</h2><div><button class="btn ghost sm" data-aa-refresh type="button">تحديث</button> <button class="ssmpd-aa-close" data-aa-close type="button">×</button></div></div>'+
      '<div class="ssmpd-aa-mode">'+esc(modeLabel(c.mode))+(c.auto_execute_enabled?' · تنفيذ تلقائي مفعل':' · التنفيذ التلقائي متوقف')+'</div>'+
      '<div class="ssmpd-aa-grid"><div class="ssmpd-aa-kpi"><b>'+Number(counts.pending||0)+'</b><span>قيد المراجعة</span></div><div class="ssmpd-aa-kpi"><b>'+Number(counts.waiting_owner||0)+'</b><span>مطلوب منك</span></div><div class="ssmpd-aa-kpi"><b>'+Number(counts.urgent||0)+'</b><span>عاجل</span></div></div>'+
      '<div class="ssmpd-aa-grid"><div class="ssmpd-aa-kpi"><b>'+Number(data.task_overdue||0)+'</b><span>مهام متأخرة</span></div><div class="ssmpd-aa-kpi"><b>'+Number(data.claude_pending||0)+'</b><span>Claude جاري</span></div><div class="ssmpd-aa-kpi"><b>'+rules.length+'</b><span>قواعد نشطة</span></div></div>'+
      '<div class="ssmpd-aa-grid"><div class="ssmpd-aa-kpi"><b>'+Number(data.payroll_pending||0)+'</b><span>رواتب معلقة</span></div><div class="ssmpd-aa-kpi"><b>'+Number(data.payroll_attention||0)+'</b><span>رواتب تحتاجك</span></div><div class="ssmpd-aa-kpi"><b>'+Number((data.payroll_pending||0)-(data.payroll_attention||0)>0?(data.payroll_pending||0)-(data.payroll_attention||0):0)+'</b><span>رواتب طبيعية</span></div></div>'+
      '<section class="ssmpd-aa-section"><h3>طلبات الموظفين والمطلوب منك</h3>'+(open||'<div class="ssmpd-aa-empty">لا توجد طلبات مفتوحة الآن.</div>')+'</section>'+
      '<section class="ssmpd-aa-section"><h3>قواعدي الحالية</h3>'+(ruleRows||'<div class="ssmpd-aa-empty">لا توجد قواعد بعد.</div>')+'</section>'+
      (isOwner(currentAdmin())?'<section class="ssmpd-aa-section ssmpd-aa-form"><h3>علّمني قاعدة</h3><textarea data-aa-instruction placeholder="مثال: لو كشف المرتبات طبيعي ومطابق للحضور اعتمده، ولو فيه فرق استناني."></textarea><button class="btn" data-aa-teach type="button">حفظ التعليمة</button><div class="ssmpd-aa-status" data-aa-status></div></section>':'');
    var teach=panel.querySelector('[data-aa-teach]');if(teach)teach.onclick=saveInstruction;
  }
  async function refresh(){
    var a=currentAdmin(), db=initClient();if(!a||!isManager(a)||!db)return;
    try{var res=await db.rpc('administrative_assistant_dashboard');if(res.error)throw res.error;if(res.data&&res.data.error)throw new Error('غير مصرح');render(res.data||{});}catch(err){panel.innerHTML=errorHtml('تعذر تحميل المساعد: '+(err&&err.message?err.message:err));}
  }
  async function saveInstruction(){
    var a=currentAdmin(), box=panel.querySelector('[data-aa-instruction]'), status=panel.querySelector('[data-aa-status]'), text=String(box&&box.value||'').trim();
    if(!text){status.textContent='اكتب التعليمة أولًا.';return;}
    status.textContent='جارٍ الحفظ…';
    try{
      var title=text.length>70?text.slice(0,67)+'…':text;
      var row={title:title,instruction:text,scope:'general',action_type:'owner_instruction',conditions:{source:'assistant_panel'},approval_mode:'owner_each_time',active:true,created_by:a.id,approved_by:a.id,approved_at:new Date().toISOString()};
      var res=await initClient().from('administrative_assistant_rules').insert(row);if(res.error)throw res.error;
      box.value='';status.textContent='تم حفظ التعليمة كقاعدة معتمدة.';setTimeout(refresh,350);
    }catch(err){status.textContent='تعذر الحفظ: '+(err&&err.message?err.message:err);}
  }
  function mount(){if(mounted)return;var a=currentAdmin();if(!a||!document.body)return;if(!isManager(a)){return;}mounted=true;shell();launch.hidden=false;refresh();refreshTimer=setInterval(function(){if(panel&&!panel.hidden)refresh();},60000);w.addEventListener('ssmpd-tasks-changed',function(){if(panel&&!panel.hidden)refresh();});}
  function wait(){var a=currentAdmin();if(a&&document.getElementById('app-root')){mount();if(!mounted)setTimeout(wait,1000);}else setTimeout(wait,700);}
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',wait);else wait();
})(window);
