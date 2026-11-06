(function(w){
  'use strict';
  if(w.__SSMPD_DIGITAL_TEAM_LOADED__)return;
  w.__SSMPD_DIGITAL_TEAM_LOADED__=true;
  var client=null,navObserver=null,cachedData=null,recentReviews={},isOwner=false,metricCode='',agentMessages={},discussionStatus={},openDiscussionCode='';
  function esc(v){return String(v==null?'':v).replace(/[&<>"']/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c];});}
  function roles(a){var r=Array.isArray(a&&a.roles)?a.roles.slice():[];if(a&&a.role&&r.indexOf(a.role)===-1)r.push(a.role);return r;}
  function isManager(a){var r=roles(a);return r.indexOf('super_admin')!==-1||r.indexOf('general_manager')!==-1;}
  function currentAdmin(){return w.SSMPDAuth&&w.SSMPDAuth.currentAdmin;}
  function initClient(){if(client)return client;var c=w.SSMPD_CONFIG&&w.SSMPD_CONFIG.supabase;if(!c||!w.supabase)return null;client=w.supabase.createClient(c.url,c.anonKey,{auth:{persistSession:true,autoRefreshToken:true}});return client;}
  function n(v){return Number(v||0).toLocaleString('en-US');}
  function rel(iso){if(!iso)return 'لا يوجد نشاط مسجل';var m=Math.max(0,Math.round((Date.now()-new Date(iso).getTime())/60000));if(m<1)return 'الآن';if(m<60)return 'من '+m+' دقيقة';var h=Math.round(m/60);if(h<24)return 'من '+h+' ساعة';return 'من '+Math.round(h/24)+' يوم';}
  function roleLabel(r){return {page_manager:'مسؤول المحتوى',designer:'مصمم جرافيك',approver:'مسؤول اعتماد',digital_agent:'موظف رقمي'}[r]||r||'';}
  function icon(code){
    if(code==='sia')return '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="4" y="7" width="16" height="13" rx="4"></rect><path d="M12 7V4m-2 0h4M7 20v2l3-2M9 12h.01M15 12h.01M9.5 16h5"></path></svg>';
    if(code==='hapi')return '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 5.5h16v11H9l-5 3v-14z"></path><path d="M8 10h8M8 13h5"></path></svg>';
    if(code==='hor')return '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 12h4l2-5 4 10 2-5h6"></path><path d="M5 5h14v14H5z" stroke-dasharray="2 4"></path></svg>';
    if(code==='hotep')return '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M20 6.5c-2-3-6-2.5-8 .2-2-2.7-6-3.2-8-.2-3 4 2 8.5 8 13 6-4.5 11-9 8-13z"></path><path d="M7 12h3l1-2 2 4 1-2h3"></path></svg>';
    if(code==='nefer')return '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 19V7m5 12v-5m5 5V9m5 10V4"></path><path d="M4 10l5-3 5 2 5-5"></path></svg>';
    if(code==='maat')return '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3v18M5 7h14M4 19h16M6 7l-3 7h6L6 7zm12 0-3 7h6l-3-7z"></path></svg>';
    return '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3l2.2 4.8L19 10l-4.8 2.2L12 17l-2.2-4.8L5 10l4.8-2.2L12 3z"></path><path d="M18.5 15.5l.8 1.7 1.7.8-1.7.8-.8 1.7-.8-1.7-1.7-.8 1.7-.8.8-1.7z"></path></svg>';
  }
  function stat(label,value){
    var key=Object.keys(metricLabels).find(function(k){return metricLabels[k]===label;})||label;
    return '<button class="dt-stat dt-stat-action" type="button" data-dt-metric-code="'+esc(metricCode)+'" data-dt-metric-key="'+esc(key)+'" data-dt-metric-label="'+esc(label)+'" data-dt-metric-value="'+esc(value)+'" aria-label="تفاصيل '+esc(label)+'"><b>'+esc(value)+'</b><span>'+esc(label)+'</span></button>';
  }
  function chip(text,kind){return '<span class="dt-chip '+(kind||'')+'">'+esc(text)+'</span>';}

  var specialistCodes={hor:true,hotep:true,nefer:true,maat:true};
  var metricLabels={
    visits_last30:'زيارات مسجلة في 30 يوم',
    followup_status_to_review:'متابعات تحتاج مراجعة السجل',
    reception_bookings_last30:'حجوزات في سجل الاستقبال',
    reception_arrivals_recorded:'حالات وصول مسجلة',
    open_patient360_cases:'شكاوى مفتوحة',
    open_complaints:'شكاوى قيد المراجعة',
    urgent_or_clinical_complaints:'شكاوى عاجلة أو طبية',
    feedback_total:'تقييمات تجربة المريض',
    feedback_last30:'تقييمات آخر 30 يوم',
    leads_last30:'استفسارات آخر 30 يوم',
    no_response_last30_not_opted_out:'استفسارات حالتها دون رد',
    leads_with_ad_attribution_total:'استفسارات فيها بيانات حملة',
    registered_partner_entities:'جهات تعاقد مسجلة',
    referrals_in_partner_table:'إحالات بجدول الشراكات',
    journal_entries_checked:'قيود فُحص توازنها',
    journal_entries_unbalanced:'قيود بها فرق بين الطرفين',
    invoices_recorded:'فواتير بنظام الحسابات',
    bank_statements_imported:'كشوف بنكية مستوردة',
    pos_settlements_imported:'تسويات نقاط بيع مستوردة'
  };
  function specialistContent(m){
    var r=recentReviews[m.code],metrics=r&&r.metrics||{},findings=r&&Array.isArray(r.findings)?r.findings:[];
    var last=r?'<span>آخر مراجعة '+esc(rel(r.reviewed_at))+'</span>':'<span>لم يتم تشغيل المراجعة بعد</span>';
    var state=r?'<span>'+(r.status==='pending_owner'?'بانتظار قرار المالك':r.status==='accepted_for_planning'?'اعتمد للمناقشة فقط':'تم استبعاد المقترح')+'</span>':'';
    var pairs=Object.keys(metrics).map(function(key){return stat(metricLabels[key]||key,n(metrics[key]));}).join('');
    var findingsHtml=findings.map(function(item){return '<article class="dt-review-finding"><b>'+esc(item.title)+'</b><p>'+esc(item.reason)+'</p><small>المصدر: '+esc(item.source)+'</small><div class="dt-suggestion">المقترح: '+esc(item.recommendation)+'</div></article>';}).join('');
    var controls=isOwner&&r&&r.status==='pending_owner'?
      '<div class="dt-review-decisions"><button type="button" class="btn sm" data-dt-decision="accepted_for_planning" data-dt-review-id="'+esc(r.id)+'">اعتماد للمناقشة فقط</button><button type="button" class="btn ghost sm" data-dt-decision="dismissed" data-dt-review-id="'+esc(r.id)+'">استبعاد</button></div>':'';
    return '<div class="dt-specialist" data-dt-specialist="'+esc(m.code)+'"><div class="dt-review-intro">'+chip('مراجعة فقط · بدون تنفيذ','safe')+'<span>تحليل عند الطلب، لا تشغيل آلي للوكيل</span></div><button type="button" class="btn ghost sm" data-dt-run="'+esc(m.code)+'">افحص مؤشرات '+esc(m.display_name)+'</button><div class="dt-specialist-status" data-dt-agent-status></div>'+
      (r?'<div class="dt-stats">'+pairs+'</div><div class="dt-review-findings">'+findingsHtml+'</div>':'<p class="dt-placeholder">اضغط فحص المؤشرات للحصول على تحليل مجمع واقتراحات للمراجعة البشرية.</p>')+
      '<div class="dt-foot">'+last+state+'</div>'+controls+'</div>';
  }

  function discussionBlock(m){
    var msgs=Array.isArray(agentMessages[m.code])?agentMessages[m.code]:[];
    var history=msgs.slice(-10).map(function(a){
      var mine=a.kind!=='reply',name=mine?'تعليمات الإدارة':'رد استشاري';
      var kind=mine?(a.kind==='instruction'?'تعليمات':a.kind==='question'?'سؤال':'تعليق'):'اقتراح دون تنفيذ';
      return '<div class="dt-chat-message '+(mine?'owner':'agent')+'"><div class="dt-chat-label">'+esc(name)+' · '+esc(kind)+'</div><p>'+esc(a.body)+'</p><small>'+esc(rel(a.created_at))+'</small></div>';
    }).join('');
    var note=m.code==='claude_creative'?
      'التوجيه هنا استشاري، ولا يصل تلقائيًا لمحرك Claude Creative. للمحادثة الحقيقية مع Claude Code على السيرفر استخدم زر «محادثة Claude Code» أسفل هذا الصندوق.'
      :m.code==='hapi'?
      'التوجيه هنا استشاري، ولا يصل تلقائيًا لمحرك حابي أو أي عميل على واتساب.'
      :'تقدر تسأل عن خطة أو تحفظ تعليمات للمراجعة. لا يبدأ تنفيذ أي إجراء تلقائيًا.';
    return '<details class="dt-discussion" data-dt-discuss="'+esc(m.code)+'"'+(openDiscussionCode===m.code?' open':'')+'>'+
     '<summary>تعليمات وتعليقات '+(msgs.length?'('+msgs.length+')':'')+'</summary><div class="dt-discussion-body">'+
     '<p class="dt-discussion-note">'+esc(note)+'</p>'+
     '<div class="dt-chat-history">'+(history||'<p class="dt-placeholder">لا توجد مناقشات لهذا الوكيل بعد.</p>')+'</div>'+
     (m.code==='claude_creative'&&isOwner?'<button class="btn sm" type="button" data-dt-open-claude-code>محادثة Claude Code</button>':'')+(isOwner?'<form data-dt-message-form="'+esc(m.code)+'"><select name="kind" aria-label="نوع الرسالة"><option value="question">اسأل الوكيل</option><option value="instruction">تعليمات للتخطيط</option><option value="comment">تعليق</option></select><textarea name="body" required minlength="2" maxlength="4000" rows="3" placeholder="اكتب المطلوب أو سؤالك بالتفصيل..."></textarea><button class="btn sm" type="submit">إرسال للنقاش</button></form>':'<p class="dt-placeholder">إرسال التعليمات متاح للمالك.</p>')+
     '<div class="dt-discussion-status" data-dt-discussion-status="'+esc(m.code)+'">'+esc(discussionStatus[m.code]||'')+'</div></div></details>';
  }

  function siaEvidenceBlock(m){
    if(m.code!=='sia'||!isOwner)return '';
    return '<details class="dt-sia-evidence" data-dt-sia-evidence><summary>مراجعة ملفات المهام مع سيا</summary>'+
      '<div class="dt-sia-evidence-body"><p class="dt-discussion-note">مراجعة قراءة فقط. لا تغير حالة المهمة ولا تعيدها للموظف ولا تعتمدها.</p>'+
      '<select data-dt-sia-task aria-label="اختر مهمة بها مرفق"><option value="">افتح القائمة لتحميل المهام...</option></select>'+
      '<button type="button" class="btn sm" data-dt-sia-run>افحص ملف المهمة</button>'+
      '<div class="dt-sia-evidence-status" data-dt-sia-evidence-status></div>'+
      '<div class="dt-sia-evidence-output" data-dt-sia-evidence-output></div></div></details>';
  }
  async function loadSiaEvidenceTasks(root){
    var select=root.querySelector('[data-dt-sia-task]');
    var status=root.querySelector('[data-dt-sia-evidence-status]');
    if(!select||select.dataset.loaded==='1')return;
    status.textContent='جارٍ البحث عن مهام المراجعة ذات المرفقات…';
    try{
      var db=initClient(),a=await db.from('tasks').select('id,title,status').eq('status','review').order('updated_at',{ascending:false}).limit(40);
      if(a.error)throw a.error;
      var tasks=a.data||[],ids=tasks.map(function(x){return x.id;});
      if(!ids.length){select.innerHTML='<option value="">لا توجد مهام بانتظار المراجعة</option>';status.textContent='';return;}
      var b=await db.from('task_work_results').select('task_id,attachments').in('task_id',ids).order('created_at',{ascending:false}).limit(100);
      if(b.error)throw b.error;
      var eligible=new Set((b.data||[]).filter(function(x){return Array.isArray(x.attachments)&&x.attachments.length>0;}).map(function(x){return x.task_id;}));
      var options=tasks.filter(function(t){return eligible.has(t.id);});
      select.innerHTML='<option value="">اختر المهمة...</option>'+options.map(function(t){return '<option value="'+esc(t.id)+'">'+esc(t.title)+'</option>';}).join('');
      select.dataset.loaded='1';status.textContent=options.length+' مهمة لديها مرفقات في التسليم.';
    }catch(e){status.textContent='تعذر قراءة قائمة الملفات: '+(e.message||e);}
  }
  async function runSiaEvidenceReview(root){
    var select=root.querySelector('[data-dt-sia-task]'),button=root.querySelector('[data-dt-sia-run]');
    var status=root.querySelector('[data-dt-sia-evidence-status]'),out=root.querySelector('[data-dt-sia-evidence-output]');
    var taskId=select&&select.value;if(!taskId){status.textContent='اختر المهمة أولًا.';return;}
    button.disabled=true;out.innerHTML='';status.textContent='سيا يراجع المقتطفات المتحقق منها…';
    try{
      var r=await initClient().functions.invoke('assistant-task-evidence-review',{body:{task_id:taskId}});
      if(r.error||!r.data||!r.data.ok)throw Error(r.data?.error||r.error?.message||'المراجعة غير متاحة');
      var data=r.data||{},statusLabel=data.assessment==='inconsistent'?'يوجد تعارض يحتاج مراجعة':data.assessment==='consistent'?'لا يظهر تعارض في المقتطفات المتاحة':'المعلومات غير كافية';
      var differences=Array.isArray(data.differences)?data.differences:[];
      out.innerHTML='<h4>'+esc(data.available?statusLabel:'لا تتوفر أدلة متحقق منها')+'</h4>'+
       '<p>'+esc(data.summary||'')+'</p>'+differences.map(function(x){return '<article class="dt-evidence-difference"><b>'+esc(x.finding)+'</b><small>'+esc(x.file_evidence)+'</small></article>';}).join('')+
       (data.owner_action?'<div class="dt-suggestion">المطلوب من الإدارة: '+esc(data.owner_action)+'</div>':'');
      status.textContent='مراجعة قراءة فقط. حالة المهمة لم تتغير.';
    }catch(e){status.textContent='تعذر فحص المرفق: '+(e.message||e);}
    finally{button.disabled=false;}
  }
  function memberCard(m){
    metricCode=m.code;
    var x=m.metrics||{},special=!!specialistCodes[m.code],head='<div class="dt-member-head"><div class="dt-avatar '+esc(m.code)+'">'+icon(m.code)+'</div><div class="dt-id"><div class="dt-name-row"><h2>'+esc(m.display_name)+'</h2>'+chip(special?'مراجعة عند الطلب':(m.active?'نشط':'متوقف'),special?'safe':(m.active?'ok':'off'))+'</div><p>'+esc(m.title_ar)+'</p><div class="dt-chips">'+chip(special?'محرك تحليل':m.member_kind==='external_agent'?'وكيل خارجي':m.member_kind==='system_identity'?'هوية نظام':'حساب قائم','type')+(m.code==='claude_creative'?chip('الحساب الحالي محفوظ','safe'):'')+'</div></div></div>';
    var body='';
    if(m.code==='sia'){
      body='<div class="dt-stats">'+stat('راجع',n(x.reviewed))+stat('اعتمد',n(x.approved))+stat('رجع',n(x.returned))+stat('رفع لك',n(x.needs_owner))+stat('متابعات تأخير',n(x.overdue_nudges))+stat('مهام مسندة مفتوحة',n(x.assigned_tasks_open))+'</div><div class="dt-foot"><span>آخر نشاط '+esc(rel(x.last_activity))+'</span><span>'+n(x.open_owner_requests)+' قرار ينتظر المالك</span></div>';
    }else if(m.code==='claude_creative'){
      var caps=Array.isArray(x.capabilities)?x.capabilities:[];
      var rs=Array.isArray(x.roles)?x.roles:[];
      body='<div class="dt-role-line">'+rs.map(function(r){return chip(roleLabel(r),'role');}).join('')+'</div><div class="dt-stats">'+stat('إجراءات 30 يوم',n(x.actions_30d))+stat('طلبات مهام معلقة',n(x.task_requests_pending))+stat('طلبات تصميم 30 يوم',n(x.design_requests_30d))+stat('تصميمات معلقة',n(x.design_requests_pending))+stat('مهام مفتوحة',n(x.assigned_tasks_open))+stat('مهام مكتملة 30 يوم',n(x.assigned_tasks_done_30d))+'</div><div class="dt-capabilities"><h3>صلاحيات Claude الحالية</h3>'+caps.map(function(c){return '<div class="dt-cap"><span>'+esc(c.label||c.key)+'</span><b>'+esc(c.enabled?'مفعلة':'متوقفة')+'</b><small>الحد اليومي '+n(c.daily_limit)+'</small></div>';}).join('')+'</div><div class="dt-foot"><span>آخر نشاط '+esc(rel(x.last_activity))+'</span><span>عرض فقط · لا تعديل على الصلاحيات من هنا</span></div>';
    }else if(specialistCodes[m.code]){
      body=specialistContent(m);
    }else{
      var live=x.live_enabled===true,comms=x.communications_enabled===true;
      body='<div class="dt-stats">'+stat('التشغيل',live?'مفعل':'غير مفعل')+stat('التواصل',comms?'مفعل':'غير مفعل')+stat('رسائل معلقة',n(x.pending_messages))+stat('رسائل فشلت',n(x.failed_messages))+stat('طلبات مساعدة',n(x.open_help_requests))+stat('مكالمات غير محلولة',n(x.unresolved_missed_calls))+'</div><div class="dt-foot"><span>وكيل خدمة العملاء والحجز</span><span>بدون حساب دخول للداشبورد</span></div>';
    }
    return '<article class="dt-member" data-dt-agent-code="'+esc(m.code)+'">'+head+'<p class="dt-authority">'+esc(m.authority_note||'')+'</p>'+body+siaEvidenceBlock(m)+(isOwner?'<div class="dt-agent-chat"><button type="button" data-open-digital-chat="'+esc(m.code)+'">محادثة مع '+esc(m.display_name)+'</button></div>':'')+'</article>';
  }
  function render(data){
    var view=document.getElementById('view-container');if(!view)return;
    var members=Array.isArray(data&&data.members)?data.members:[];
    cachedData=data;
    view.innerHTML='<section class="digital-team" dir="rtl"><header class="dt-hero"><div><p class="dt-eyebrow">Swnw Digital Team</p><h1>الفريق الرقمي</h1><p>هويات تشغيلية واضحة، صلاحيات منفصلة، ومؤشرات خاصة بكل وكيل.</p></div><div class="dt-hero-actions">'+(isOwner?'<button class="dt-group-chat-button" type="button" data-dt-open-group>دردشة جماعية</button>':'')+'<button class="btn ghost sm" data-dt-refresh type="button">تحديث</button></div></header><div class="dt-principles"><span>Claude Creative مرتبط بحسابه الحالي بدون تغيير</span><span>الوكلاء الرقميون خارج الحضور والرواتب البشرية</span><span>كل إجراء له مصدر صلاحية واضح</span></div><div class="dt-grid">'+members.map(memberCard).join('')+'</div><div class="dt-global-status" data-dt-global-status></div></section>';
    var b=view.querySelector('[data-dt-refresh]');if(b)b.onclick=load;
    w.dispatchEvent(new Event('ssmpd-digital-team-rendered'));
    view.querySelectorAll('[data-open-digital-chat]').forEach(function(btn){
      btn.onclick=function(){w.SSMPDDigitalChat?.openDirect(btn.getAttribute('data-open-digital-chat'));};
    });
    var groupChat=view.querySelector('[data-dt-open-group]');
    if(groupChat)groupChat.onclick=function(){w.SSMPDDigitalChat?.openGroup();};

    view.querySelectorAll('[data-dt-run]').forEach(function(btn){
      btn.onclick=function(){runReview(btn.getAttribute('data-dt-run'),btn);};
    });
    view.querySelectorAll('[data-dt-decision]').forEach(function(btn){
      btn.onclick=function(){decide(btn.getAttribute('data-dt-review-id'),btn.getAttribute('data-dt-decision'),btn);};
    });
    view.querySelectorAll('[data-dt-metric-code]').forEach(function(btn){
      btn.onclick=function(){showMetric(btn);};
    });
    view.querySelectorAll('[data-dt-message-form]').forEach(function(form){
      form.onsubmit=function(e){e.preventDefault();sendAgentMessage(form);};
    });
    view.querySelectorAll('[data-dt-open-claude-code]').forEach(function(b){b.addEventListener('click',function(){if(w.SSMPDServerTeamChat&&w.SSMPDServerTeamChat.open)w.SSMPDServerTeamChat.open('claude');});});
    view.querySelectorAll('[data-dt-discuss]').forEach(function(el){
      el.addEventListener('toggle',function(){if(el.open)openDiscussionCode=el.getAttribute('data-dt-discuss');});
    });
    var evidence=view.querySelector('[data-dt-sia-evidence]');
    if(evidence){
      evidence.addEventListener('toggle',function(){if(evidence.open)loadSiaEvidenceTasks(evidence);});
      evidence.querySelector('[data-dt-sia-run]').onclick=function(){runSiaEvidenceReview(evidence);};
    }
  }


  async function loadMessages(){
    var db=initClient();if(!db)return;
    var r=await db.from('digital_agent_messages').select('id,agent_code,kind,body,created_at,origin')
      .order('created_at',{ascending:false}).limit(160);
    if(r.error)throw r.error;
    agentMessages={};
    (r.data||[]).reverse().forEach(function(row){
      if(!agentMessages[row.agent_code])agentMessages[row.agent_code]=[];
      agentMessages[row.agent_code].push(row);
    });
    if(document.querySelector('.digital-team')&&cachedData)render(cachedData);
  }
  function discussionFeedback(code,message){
    discussionStatus[code]=message;
    var e=document.querySelector('[data-dt-discussion-status="'+code+'"]');
    if(e)e.textContent=message;
  }
  async function sendAgentMessage(form){
    if(!isOwner)return;
    var code=form.getAttribute('data-dt-message-form');
    var kind=form.elements.kind.value,body=String(form.elements.body.value||'').trim();
    if(body.length<2||body.length>4000)return;
    openDiscussionCode=code;
    var b=form.querySelector('button[type=submit]');b.disabled=true;
    discussionFeedback(code,'جارٍ حفظ التوجيه…');
    try{
      var r=await initClient().rpc('digital_agent_post_message',{p_agent_code:code,p_kind:kind,p_body:body});
      if(r.error)throw r.error;
      await loadMessages();
      discussionFeedback(code,'التوجيه محفوظ. جارٍ إعداد رد استشاري دون تنفيذ أي إجراء…');
      try{
        var answer=await initClient().functions.invoke('digital-agent-advice',{body:{message_id:r.data}});
        if(answer.error||!answer.data||!answer.data.ok)throw Error(answer.data?.error||answer.error?.message||'الرد غير متاح');
        await loadMessages();
        discussionFeedback(code,'تم تسجيل الرد الاستشاري. لم يُنفَّذ أي إجراء.');
      }catch(e){
        discussionFeedback(code,'تم حفظ توجيهك. تعذر الرد الاستشاري: '+(e.message||e)+'. لم يُنفَّذ أي إجراء.');
      }
    }catch(e){discussionFeedback(code,'تعذر حفظ التوجيه: '+(e.message||e));}
    finally{b.disabled=false;}
  }
  async function showMetric(btn){
    var code=btn.getAttribute('data-dt-metric-code')||'';
    var key=btn.getAttribute('data-dt-metric-key')||'';
    var label=btn.getAttribute('data-dt-metric-label')||'';
    var value=btn.getAttribute('data-dt-metric-value')||'';
    var root=document.querySelector('.digital-team');if(!root)return;
    var prev=root.querySelector('.dt-detail-backdrop');if(prev)prev.remove();
    var wrap=document.createElement('div');wrap.className='dt-detail-backdrop';
    wrap.innerHTML='<section class="dt-detail-dialog" role="dialog" aria-modal="true" aria-label="تفاصيل المؤشر">'+
      '<header><div><p class="dt-eyebrow">تفاصيل المؤشر</p><h2>'+esc(label)+'</h2></div><button type="button" data-dt-close aria-label="إغلاق">×</button></header>'+
      '<div class="dt-detail-value">'+esc(value)+'</div><p class="dt-placeholder">جارٍ تحميل مصدر المؤشر وتفاصيله…</p></section>';
    root.appendChild(wrap);
    var close=function(){wrap.remove();};wrap.querySelector('[data-dt-close]').onclick=close;
    wrap.onclick=function(e){if(e.target===wrap)close();};
    try{
      var r=await initClient().rpc('digital_agent_metric_detail',{p_code:code,p_key:key});
      if(r.error)throw r.error;
      if(!wrap.isConnected)return;
      var data=r.data||{},rows=Array.isArray(data.breakdown)?data.breakdown:[];
      wrap.querySelector('.dt-detail-dialog').innerHTML='<header><div><p class="dt-eyebrow">تفاصيل المؤشر</p><h2>'+esc(label)+'</h2></div><button type="button" data-dt-close aria-label="إغلاق">×</button></header>'+
        '<div class="dt-detail-value">'+esc(value)+'</div>'+
        '<p>'+esc(data.explanation||'هذه قراءة لمؤشر مجمع ولا تكفي وحدها للحكم على حالة فردية.')+'</p>'+
        '<p><b>المصدر:</b> '+esc(data.source||'غير متاح')+'</p><p><b>الفترة:</b> '+esc(data.period||'وفق المؤشر')+'</p>'+
        '<div class="dt-detail-breakdown">'+rows.map(function(x){return '<div class="dt-detail-row"><span>'+esc(x.label)+'</span><b>'+esc(x.count)+'</b></div>';}).join('')+'</div>'+
        '<p class="dt-discussion-note">الأرقام هنا مجمعة، ولا تتضمن سجلات مرضى أو بيانات شخصية.</p>';
      wrap.querySelector('[data-dt-close]').onclick=close;
    }catch(e){if(wrap.isConnected){var e1=wrap.querySelector('.dt-placeholder');if(e1)e1.textContent='تعذر تحميل تفاصيل المؤشر: '+(e.message||e);}}
  }
  async function latest(){
    var db=initClient();if(!db)return;
    var r=await db.rpc('digital_agent_recent_reviews');if(r.error)throw r.error;
    var d=r.data||{};isOwner=!!d.is_owner;recentReviews={};
    (Array.isArray(d.reviews)?d.reviews:[]).forEach(function(x){if(specialistCodes[x.agent_code])recentReviews[x.agent_code]=x;});
    if(document.querySelector('.digital-team')&&cachedData)render(cachedData);
  }
  function reportError(code,message){
    var el=document.querySelector('[data-dt-specialist="'+code+'"] [data-dt-agent-status]');
    if(el)el.textContent=message;
  }
  async function runReview(code,button){
    if(!specialistCodes[code])return;
    button.disabled=true;reportError(code,'جارٍ تحليل المؤشرات المتاحة…');
    try{
      var r=await initClient().rpc('digital_agent_run_review',{p_code:code});
      if(r.error)throw r.error;
      await latest();
    }catch(e){reportError(code,'تعذر تنفيذ المراجعة: '+(e.message||e));}
    finally{button.disabled=false;}
  }
  async function decide(id,decision,button){
    if(!isOwner||!id||!['accepted_for_planning','dismissed'].includes(decision))return;
    var msg=decision==='accepted_for_planning'?'اعتماد للمناقشة فقط. لن تُنفذ أي توصية تلقائيًا.':'استبعاد هذه المراجعة دون حذف السجل.';
    if(!w.confirm(msg))return;
    button.disabled=true;
    try{
      var r=await initClient().rpc('digital_agent_decide_review',{p_review_id:id,p_decision:decision,p_note:''});
      if(r.error)throw r.error;
      await latest();
    }catch(e){var el=document.querySelector('[data-dt-global-status]');if(el)el.textContent='تعذر حفظ القرار: '+(e.message||e);}
    finally{button.disabled=false;}
  }
  async function load(){
    var db=initClient(),view=document.getElementById('view-container');if(!db||!view)return;
    view.innerHTML='<div class="dt-loading">جارٍ تحميل الفريق الرقمي…</div>';
    try{
      var r=await db.rpc('digital_team_dashboard');if(r.error)throw r.error;
      cachedData=r.data||{};render(cachedData);
      try{await latest();}catch(e){var el=document.querySelector('[data-dt-global-status]');if(el)el.textContent='مراجعات الوكلاء الأربعة غير متاحة مؤقتًا: '+(e.message||e);}
      // New chat is backed by separate owner-only threads and does not use the old advisory forms.
    }catch(e){view.innerHTML='<div class="dt-loading">تعذر تحميل الفريق الرقمي: '+esc(e.message||e)+'</div>';}
  }
  function open(){
    var a=currentAdmin();if(!a||!isManager(a))return;
    document.querySelectorAll('.tab-btn').forEach(function(b){b.classList.remove('active');});
    document.querySelectorAll('[data-digital-team-tab]').forEach(function(b){b.classList.add('active');});
    var bar=document.getElementById('tabs-bar');if(bar)bar.style.display='';
    var mobileTabs=document.querySelector('#mobile-menu .mm-tabs');if(mobileTabs)mobileTabs.style.display='';
    var brand=document.getElementById('brand-section-name');
    if(brand)brand.innerHTML='<span class="brand-center">مركز عيادات سونو التخصصية</span><span class="brand-section">الفريق الرقمي</span>';
    if(w.SSMPDI18n&&w.SSMPDI18n.setPageTitle)w.SSMPDI18n.setPageTitle('الفريق الرقمي');
    var mobile=document.getElementById('mobile-menu');if(mobile)mobile.classList.remove('open');
    var dropdown=document.getElementById('user-dropdown');if(dropdown)dropdown.classList.remove('open');
    load();
  }
  function addNav(parent,cls,label){
    if(!parent||parent.querySelector('[data-digital-team-tab]'))return;
    var b=document.createElement('button');b.className=cls;b.type='button';
    b.setAttribute('data-digital-team-tab','1');b.textContent=label;b.onclick=open;
    parent.appendChild(b);
  }
  function mount(){return; /* Navigation lives only in SSMPDManagementNavigation. */}
  function start(){
    mount();
    if(navObserver)return;
    var host=document.getElementById('app-root')||document.body;
    navObserver=new MutationObserver(mount);
    navObserver.observe(host,{childList:true});
  }
  w.SSMPDDigitalTeam={open:open,refresh:load,isOwner:function(){return isOwner;}};
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',start);else start();
})(window);
