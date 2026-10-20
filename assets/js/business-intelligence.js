/* SSMPD — Business Intelligence Brain
   Owner workspace on top of the existing summary screen.
   It reuses tasks, operations, content learning, leads, Meta and staff data.
*/
(function(root){
  'use strict';
  var baseSummary=root.SSMPDRenderSummary;
  var activePeriod='week',activeView='overview',lastSnapshot=null,mountToken=0;
  var STATUS={draft:'مسودة',ai_extracted:'مستخرج آليًا',employee_confirmed:'أكده الموظف',manager_approved:'اعتمدته الإدارة',validated_by_data:'تحقق بالبيانات',outdated:'قديم',superseded:'تم استبداله'};
  var TYPES={audience_insight:'الجمهور',customer_pain:'احتياج العميل',content_insight:'المحتوى',marketing_opportunity:'فرصة تسويق',competitor_insight:'المنافسون',operational_issue:'تشغيل',recommendation:'توصية',kpi:'مؤشر',risk:'مخاطرة',hypothesis:'فرضية',decision:'قرار',result:'نتيجة',brand_rule:'قاعدة البراند',service_insight:'الخدمة',sales_insight:'المبيعات'};
  var VIEWS={overview:'الخلاصة',knowledge:'ذاكرة المشروع',recommendations:'التوصيات',decisions:'القرارات والتعلّم',team:'أثر الفريق',scenario:'السيناريوهات',copilot:'مساعد المالك'};
  function esc(v){return String(v==null?'':v).replace(/[&<>"']/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c];});}
  function n(v){return Number(v||0).toLocaleString('en-US',{maximumFractionDigits:1});}
  function pct(v){return n(v)+'%';}
  function date(v){if(!v)return '—';try{return new Date(v).toLocaleDateString('ar-EG');}catch(e){return v;}}
  function manager(){var a=root.SSMPDAuth&&root.SSMPDAuth.currentAdmin;return !!(a&&root.SSMPDRoles&&root.SSMPDRoles.hasAnyRole(a,['general_manager','super_admin']));}
  function client(){return root.SSMPDDb&&root.SSMPDDb.client;}
  function rpc(name,args){return client().rpc(name,args||{}).then(function(r){if(r.error)throw r.error;return r.data;});}
  function edge(body){return client().functions.invoke('business-intelligence',{body:body}).then(function(r){if(r.error||r.data&&r.data.error)throw Error(r.data&&r.data.error||r.error.message);return r.data;});}
  function toast(msg,type){if(root.SSMPDToast)root.SSMPDToast.show(msg,type||'success');else alert(msg);}
  function kpi(label,value,sub){return '<div class="bi-kpi"><small>'+esc(label)+'</small><b>'+esc(value)+'</b>'+(sub?'<span>'+esc(sub)+'</span>':'')+'</div>';}
  function badge(text,kind){return '<span class="bi-badge '+esc(kind||'')+'">'+esc(text)+'</span>';}
  function empty(text){return '<div class="bi-empty">'+esc(text)+'</div>';}

  function shell(){
    return '<section class="bi-shell" data-business-intelligence dir="rtl">'+
      '<header class="bi-head"><div><p class="bi-eyebrow">Business Intelligence Brain</p><h2>ذكاء الإدارة وذاكرة المشروع</h2><p>التقارير والمهام والأداء تتحول إلى معرفة ثم قرار ثم تنفيذ ثم قياس.</p></div><div class="bi-periods">'+
      [['today','اليوم'],['week','هذا الأسبوع'],['month','هذا الشهر']].map(function(x){return '<button class="btn '+(activePeriod===x[0]?'primary':'')+'" data-bi-period="'+x[0]+'">'+x[1]+'</button>';}).join('')+
      '<button class="btn" data-bi-refresh>تحديث</button></div></header>'+
      '<nav class="bi-tabs">'+Object.keys(VIEWS).map(function(k){return '<button data-bi-view="'+k+'" class="'+(activeView===k?'active':'')+'">'+VIEWS[k]+'</button>';}).join('')+'</nav>'+
      '<div data-bi-body class="bi-body"><div class="loading">جاري تجهيز خلاصة الإدارة…</div></div></section>';
  }

  function mount(container){
    if(!manager()||!container||!container.isConnected)return;
    var old=container.querySelector('[data-business-intelligence]');if(old)return;
    var holder=document.createElement('div');holder.innerHTML=shell();var node=holder.firstElementChild;
    container.insertBefore(node,container.firstChild);
    bindShell(node);load(node);
  }
  function bindShell(node){
    node.querySelectorAll('[data-bi-period]').forEach(function(b){b.onclick=function(){activePeriod=b.dataset.biPeriod;node.outerHTML=shell();var fresh=document.querySelector('[data-business-intelligence]');bindShell(fresh);load(fresh);};});
    node.querySelector('[data-bi-refresh]').onclick=function(){load(node,true);};
    node.querySelectorAll('[data-bi-view]').forEach(function(b){b.onclick=function(){activeView=b.dataset.biView;node.querySelectorAll('[data-bi-view]').forEach(function(x){x.classList.toggle('active',x===b);});draw(node);};});
  }
  function load(node){
    var token=++mountToken;node.querySelector('[data-bi-body]').innerHTML='<div class="loading">جاري تجهيز خلاصة الإدارة…</div>';
    Promise.all([rpc('business_owner_snapshot',{p_period:activePeriod}),rpc('business_ai_enabled').catch(function(){return false;})]).then(function(x){if(token!==mountToken||!node.isConnected)return;lastSnapshot=x[0]||{};lastSnapshot.ai_enabled=x[1]===true;draw(node);}).catch(function(e){if(node.isConnected)node.querySelector('[data-bi-body]').innerHTML='<div class="err-msg">'+esc(e.message)+'</div>';});
  }
  function draw(node){if(!lastSnapshot)return;var body=node.querySelector('[data-bi-body]');if(!body)return;
    if(activeView==='knowledge')body.innerHTML=knowledgeHtml();
    else if(activeView==='recommendations')body.innerHTML=recommendationsHtml();
    else if(activeView==='decisions')body.innerHTML=decisionsHtml();
    else if(activeView==='team')body.innerHTML=teamHtml();
    else if(activeView==='scenario')body.innerHTML=scenarioHtml();
    else if(activeView==='copilot')body.innerHTML=copilotHtml();
    else body.innerHTML=overviewHtml();
    bindBody(node);
  }

  function overviewHtml(){var s=lastSnapshot,t=s.tasks||{},k=s.knowledge||{},l=s.leads||{},a=s.ads||{},op=s.operations||{},alerts=s.alerts||[],projects=s.projects||[];
    return '<div class="bi-grid bi-kpis">'+kpi('مهام اكتملت',n(t.completed))+kpi('مهام متأخرة',n(t.overdue))+kpi('بانتظار المراجعة',n(t.review))+kpi('معرفة جديدة',n(k.new))+kpi('معرفة تنتظر اعتمادك',n(k.waiting_review))+kpi('Leads',n(l.total))+kpi('تحول إلى حجز',pct(l.conversion))+kpi('مشكلات تشغيل مفتوحة',n(op.open_issues))+'</div>'+
      '<div class="bi-two"><section class="bi-panel"><h3>ما يحتاج انتباهك</h3>'+(alerts.length?alerts.map(function(x){return '<article class="bi-alert '+esc(x.severity)+'"><b>'+esc(x.title)+'</b><p>'+esc(x.detail)+'</p></article>';}).join(''):empty('لا توجد إشارات إدارية عاجلة في البيانات الحالية.'))+'</section>'+
      '<section class="bi-panel"><h3>فرص وذاكرة جديدة</h3>'+((k.recent||[]).slice(0,6).map(knowledgeCard).join('')||empty('لا توجد معرفة جديدة معتمدة أو مستخرجة في الفترة.'))+'</section></div>'+
      '<section class="bi-panel"><div class="bi-panel-head"><h3>المشروعات</h3><span>التقدم مبني على المهام المعتمدة</span></div><div class="bi-projects">'+(projects.length?projects.map(function(p){return '<article><div><b>'+esc(p.title)+'</b><span>'+n(p.done)+' / '+n(p.total)+' مهام</span></div><div class="bi-progress"><i style="width:'+Math.max(0,Math.min(100,Number(p.progress)||0))+'%"></i></div><small>'+pct(p.progress)+(p.overdue?' · '+n(p.overdue)+' متأخرة':'')+'</small></article>';}).join(''):empty('لا توجد مشروعات نشطة.'))+'</div></section>'+
      '<div class="bi-two"><section class="bi-panel"><h3>التسويق والتحويل</h3><div class="bi-grid">'+kpi('Leads',n(l.total))+kpi('حجوزات من Leads',n(l.booked))+kpi('Conversion',pct(l.conversion))+kpi('إنفاق Meta المسجل',n(a.spend))+'</div><p class="bi-muted">قياس Meta الحالي Lifetime. ربط الإيراد بالحملة غير مكتمل بعد لذلك النظام لا يدّعي ROAS غير موجود.</p></section>'+
      '<section class="bi-panel"><h3>دورة التعلّم</h3><div class="bi-loop"><span>تقرير</span><b>→</b><span>معرفة</span><b>→</b><span>توصية</span><b>→</b><span>مهمة</span><b>→</b><span>نتيجة</span><b>→</b><span>تعلّم</span></div></section></div>';
  }
  function knowledgeCard(x){return '<article class="bi-knowledge"><div><b>'+esc(x.title)+'</b>'+badge(TYPES[x.knowledge_type]||x.knowledge_type,'type')+badge(STATUS[x.status]||x.status,x.status)+'</div><p>'+esc(x.statement)+'</p><small>الثقة '+Math.round(Number(x.confidence||0)*100)+'% · '+date(x.created_at)+(x.review_after?' · مراجعة '+date(x.review_after):'')+'</small></article>';}
  function knowledgeHtml(){var k=lastSnapshot.knowledge||{},items=k.recent||[];
    return '<div class="bi-grid bi-kpis">'+kpi('تنتظر مراجعة',n(k.waiting_review))+kpi('تحققت بالبيانات',n(k.validated))+kpi('حان تحديثها',n(k.review_due))+'</div><section class="bi-panel"><div class="bi-panel-head"><div><h3>Corporate Memory</h3><p>ثابتة نسبيًا · متغيرة · قرارات · نتائج</p></div><button class="btn" data-bi-process>تحليل تقرير معتمد من قائمة الانتظار</button></div>'+(items.length?items.map(function(x){return knowledgeCard(x)+(x.status==='ai_extracted'||x.status==='employee_confirmed'?'<div class="bi-actions"><button class="btn" data-bi-knowledge="'+x.id+'" data-status="manager_approved">اعتماد إداري</button><button class="btn" data-bi-knowledge="'+x.id+'" data-status="validated_by_data">تحقق بالبيانات</button><button class="btn" data-bi-knowledge="'+x.id+'" data-status="outdated">اعتبارها قديمة</button></div>':'');}).join(''):empty('لم تدخل معرفة جديدة بعد. عند اعتماد تقارير المهام ستدخل تلقائيًا إلى قائمة التحليل.'))+'</section>';
  }
  function recommendationsHtml(){var box=lastSnapshot.recommendations||{},items=box.items||[];
    return '<div class="bi-grid bi-kpis">'+kpi('تنتظر قرارك',n(box.pending))+kpi('قيد التنفيذ أو القياس',n(box.measuring))+'</div><section class="bi-panel"><h3>من المعرفة إلى التنفيذ</h3>'+(items.length?items.map(function(r){return '<article class="bi-rec"><div><b>'+esc(r.title)+'</b>'+badge(r.priority,r.priority)+badge(r.recommendation_type,'type')+'</div><p>'+esc(r.rationale)+'</p><small>'+esc(r.expected_metric||'حدد مؤشر القياس عند تحويلها لمهمة')+'</small><div class="bi-actions">'+(r.task_id?'<button class="btn" data-bi-open-task="'+r.task_id+'">فتح المهمة</button>':'<button class="btn primary" data-bi-rec-task="'+r.id+'">تحويل لمهمة</button>')+'</div></article>';}).join(''):empty('لا توجد توصيات نشطة بعد.'))+'</section>';
  }
  function decisionsHtml(){var rows=lastSnapshot.decisions||[];
    return '<div class="bi-two"><section class="bi-panel"><h3>تسجيل قرار</h3><form data-bi-decision><label>العنوان<input name="title" required maxlength="240"></label><label>القرار<textarea name="decision" required maxlength="8000"></textarea></label><label>لماذا اتخذناه<textarea name="reason" maxlength="4000"></textarea></label><label>المجال<select name="scope"><option value="business">عام</option><option value="marketing">تسويق</option><option value="content">محتوى</option><option value="ads">إعلانات</option><option value="operations">تشغيل</option><option value="finance">مالي</option><option value="staff">فريق</option></select></label><label>مؤشر القياس<input name="metric"></label><label>تاريخ المراجعة<input type="date" name="review"></label><button class="btn primary">حفظ القرار</button></form></section><section class="bi-panel"><h3>Decisions & Learnings</h3>'+(rows.length?rows.map(function(d){return '<article class="bi-decision"><div><b>'+esc(d.title)+'</b>'+badge(d.scope,'type')+badge(d.status,d.status)+'</div><p>'+esc(d.decision)+'</p>'+(d.reason?'<small>السبب · '+esc(d.reason)+'</small>':'')+(d.result_summary?'<p><b>النتيجة</b> '+esc(d.result_summary)+'</p>':'')+(d.learning?'<p><b>التعلّم</b> '+esc(d.learning)+'</p>':'')+'<small>'+date(d.decided_at)+(d.review_on?' · القياس '+date(d.review_on):'')+'</small></article>';}).join(''):empty('لم تسجل قرارات استراتيجية بعد.'))+'</section></div>';
  }
  function teamHtml(){var rows=lastSnapshot.team_impact||[];
    return '<section class="bi-panel"><div class="bi-panel-head"><div><h3>Contribution Impact</h3><p>يقيس مساهمة العمل في معرفة أو نتيجة. لا يصدر قرارًا وظيفيًا تلقائيًا.</p></div></div><div class="bi-table-wrap"><table class="simple"><thead><tr><th>الموظف</th><th>مهام مكتملة</th><th>معرفة معتمدة</th><th>تحققت بالبيانات</th><th>توصيات تحولت لتنفيذ</th><th>نتائج إيجابية مقاسة</th></tr></thead><tbody>'+rows.map(function(r){return '<tr><td>'+esc(r.name)+'</td><td>'+n(r.completed_tasks)+'</td><td>'+n(r.approved_knowledge)+'</td><td>'+n(r.validated_knowledge)+'</td><td>'+n(r.adopted_recommendations)+'</td><td>'+n(r.positive_measured_outcomes)+'</td></tr>';}).join('')+'</tbody></table></div>'+(rows.length?'':empty('لا توجد بيانات مساهمة كافية في الفترة.'))+'</section>';
  }
  function scenarioHtml(){return '<div class="bi-two"><section class="bi-panel"><h3>Scenario Planning</h3><p>اكتب ميزانية إضافية للإعلانات. النظام يوزعها ميكانيكيًا على أفضل 3 حملات حسب Cost per Result التاريخي ثم يعرض حساسية 80% و120%.</p><form data-bi-scenario><label>الميزانية الإضافية<input name="budget" type="number" min="1" step="100" required></label><button class="btn primary">احسب السيناريو</button></form></section><section class="bi-panel" data-bi-scenario-result>'+empty('لم يتم تشغيل سيناريو بعد.')+'</section></div>';
  }
  function quickAnswer(q){var s=lastSnapshot,t=s.tasks||{},k=s.knowledge||{},r=s.recommendations||{},l=s.leads||{},op=s.operations||{};q=String(q||'');
    if(/مهام|تأخير|متأخر/.test(q))return 'عندك '+n(t.overdue)+' مهمة متأخرة و'+n(t.review)+' بانتظار المراجعة و'+n(t.blocked)+' متوقفة بعائق.';
    if(/ليد|حجز|تحويل/.test(q))return 'الفترة فيها '+n(l.total)+' Lead و'+n(l.booked)+' تحولوا إلى حجز. معدل التحويل المسجل '+pct(l.conversion)+'.';
    if(/مشك|تشغيل/.test(q))return 'هناك '+n(op.open_issues)+' مشكلة تشغيل مفتوحة، منها '+n(op.repeated)+' متكررة في 3 فترات أو أكثر.';
    if(/معرفة|تقارير|تعلم/.test(q))return 'تم تسجيل '+n(k.new)+' عناصر معرفة في الفترة. '+n(k.waiting_review)+' تنتظر المراجعة و'+n(k.validated)+' تحققت بالبيانات.';
    if(/توص|فرص|اعمل/.test(q))return 'هناك '+n(r.pending)+' توصية تنتظر قرار الإدارة و'+n(r.measuring)+' توصية دخلت التنفيذ أو القياس.';
    var alerts=s.alerts||[];return alerts.length?'أهم ما يحتاج انتباهك الآن هو '+alerts.slice(0,3).map(function(x){return x.title+' — '+x.detail;}).join(' | '):'لا تظهر إشارة واحدة حرجة في الخلاصة الحالية. افتح التوصيات أو ذاكرة المشروع للتفاصيل.';
  }
  function copilotHtml(){var enabled=lastSnapshot.ai_enabled===true;return '<div class="bi-two"><section class="bi-panel"><h3>Owner Copilot</h3><p>اسأل عن المهام أو التسويق أو التحويل أو المشكلات أو المعرفة أو التوصيات.</p><form data-bi-copilot><textarea name="question" required placeholder="مثال: إيه أهم حاجة محتاجة تدخلي؟ أو ليه الحجوزات محتاجة متابعة؟"></textarea><button class="btn primary">اسأل</button></form><div class="bi-quick">'+['إيه أهم حاجة محتاجة انتباهي؟','إيه وضع المهام المتأخرة؟','إيه وضع الليدز والحجوزات؟','إيه أهم المعرفة الجديدة؟','إيه التوصيات اللي لسه ما اتنفذتش؟'].map(function(q){return '<button data-bi-quick="'+esc(q)+'">'+esc(q)+'</button>';}).join('')+'</div><p class="bi-muted">'+(enabled?'التحليل الحر مفعّل ويستخدم خلاصة مجمعة بلا أسماء مرضى أو أرقام هواتف.':'الأسئلة الجاهزة تعمل من البيانات مباشرة. التحليل الحر الخارجي موجود في البنية لكنه غير مفعّل حاليًا.')+'</p></section><section class="bi-panel" data-bi-answer>'+empty('الإجابة ستظهر هنا مع الأدلة وفجوات البيانات.')+'</section></div>';
  }

  function bindBody(node){
    node.querySelectorAll('[data-bi-knowledge]').forEach(function(b){b.onclick=function(){var status=b.dataset.status;b.disabled=true;rpc('business_knowledge_review',{p_id:b.dataset.biKnowledge,p_status:status,p_confidence:null,p_reason:null,p_review_after:null,p_expires_at:null}).then(function(){toast('تم تحديث حالة المعرفة');return load(node);}).catch(function(e){toast(e.message,'error');b.disabled=false;});};});
    var process=node.querySelector('[data-bi-process]');if(process)process.onclick=function(){if(!lastSnapshot.ai_enabled){toast('قائمة التقارير جاهزة، لكن التحليل الخارجي غير مفعّل بعد.','error');return;}process.disabled=true;edge({mode:'extract_queue'}).then(function(x){toast(x.skipped?'تم فحص التقرير ولم يحتوِ معرفة قابلة لإعادة الاستخدام':'تم تحليل تقرير وإضافته للمراجعة');load(node);}).catch(function(e){toast(e.message,'error');process.disabled=false;});};
    node.querySelectorAll('[data-bi-open-task]').forEach(function(b){b.onclick=function(){if(root.SSMPDOpenTask)root.SSMPDOpenTask(b.dataset.biOpenTask);};});
    node.querySelectorAll('[data-bi-rec-task]').forEach(function(b){b.onclick=function(){openTaskModal(b.dataset.biRecTask,node);};});
    var df=node.querySelector('[data-bi-decision]');if(df)df.onsubmit=function(e){e.preventDefault();var f=new FormData(df);rpc('business_decision_save',{p_title:f.get('title'),p_decision:f.get('decision'),p_reason:f.get('reason')||'',p_scope:f.get('scope'),p_recommendation:null,p_task:null,p_expected_metric:f.get('metric')||null,p_review_on:f.get('review')||null,p_source_knowledge_ids:[]}).then(function(){toast('تم حفظ القرار في الذاكرة الاستراتيجية');load(node);}).catch(function(x){toast(x.message,'error');});};
    var sf=node.querySelector('[data-bi-scenario]');if(sf)sf.onsubmit=function(e){e.preventDefault();var budget=Number(new FormData(sf).get('budget'));var slot=node.querySelector('[data-bi-scenario-result]');slot.innerHTML='<div class="loading">جاري الحساب…</div>';rpc('business_ads_scenario',{p_extra_budget:budget}).then(function(x){slot.innerHTML=scenarioResult(x);}).catch(function(err){slot.innerHTML='<div class="err-msg">'+esc(err.message)+'</div>';});};
    var cf=node.querySelector('[data-bi-copilot]');if(cf)cf.onsubmit=function(e){e.preventDefault();var q=String(new FormData(cf).get('question')||'').trim();answer(node,q);};
    node.querySelectorAll('[data-bi-quick]').forEach(function(b){b.onclick=function(){answer(node,b.dataset.biQuick,true);};});
  }
  function scenarioResult(x){var rows=x.allocations||[];return '<h3>السيناريو</h3><div class="bi-grid">'+kpi('ميزانية إضافية',n(x.extra_budget))+kpi('نتائج ميكانيكية',n(x.mechanical_projection))+kpi('حساسية 80%',n(x.sensitivity_80pct))+kpi('حساسية 120%',n(x.sensitivity_120pct))+'</div>'+(rows.length?'<div class="bi-table-wrap"><table class="simple"><thead><tr><th>الحملة</th><th>CPR تاريخي</th><th>تخصيص</th><th>نتائج محسوبة</th></tr></thead><tbody>'+rows.map(function(r){return '<tr><td>'+esc(r.campaign_name)+'</td><td>'+n(r.cpr)+'</td><td>'+n(r.allocation)+'</td><td>'+n(r.projected_extra_results)+'</td></tr>';}).join('')+'</tbody></table></div>':empty('لا توجد حملات بنتائج وإنفاق كافيين للحساب.'))+'<p class="bi-muted">هذا Stress Band وليس Confidence Interval أو ضمان نتيجة. القرار النهائي يرجع لجودة الـLead والحجز والإيراد.</p>';}
  function answer(node,q,forceLocal){var slot=node.querySelector('[data-bi-answer]');if(!slot)return;slot.innerHTML='<div class="loading">جاري التحليل…</div>';
    if(forceLocal||!lastSnapshot.ai_enabled){slot.innerHTML='<h3>الخلاصة</h3><p class="bi-answer">'+esc(quickAnswer(q))+'</p>';return;}
    edge({mode:'owner_ask',period:activePeriod,question:q}).then(function(x){slot.innerHTML='<h3>الخلاصة</h3><p class="bi-answer">'+esc(x.answer)+'</p><h4>الأدلة المستخدمة</h4>'+((x.evidence||[]).map(function(v){return '<p>• '+esc(v)+'</p>';}).join('')||empty('لا توجد أدلة إضافية'))+'<h4>إجراءات مقترحة</h4>'+((x.actions||[]).map(function(a){return '<article class="bi-rec"><b>'+esc(a.title)+'</b><p>'+esc(a.why)+'</p><small>'+esc(a.metric)+'</small></article>';}).join('')||empty('لا توجد إجراءات مقترحة'))+(x.data_gaps&&x.data_gaps.length?'<h4>بيانات ناقصة</h4>'+x.data_gaps.map(function(v){return '<p>• '+esc(v)+'</p>';}).join(''):'');}).catch(function(e){slot.innerHTML='<div class="err-msg">'+esc(e.message)+'</div>';});
  }
  function openTaskModal(recId,node){Promise.all([root.SSMPDDb.taskListProjects(),root.SSMPDDb.taskPeople()]).then(function(x){var projects=x[0]||[],people=x[1]||[];var wrap=document.createElement('div');wrap.className='modal-backdrop';wrap.innerHTML='<div class="modal"><div class="modal-head"><h3>تحويل التوصية إلى مهمة</h3><button class="modal-close">×</button></div><form data-bi-task-form><label>المشروع<select name="project" required>'+projects.map(function(p){return '<option value="'+esc(p.id)+'">'+esc(p.title)+'</option>';}).join('')+'</select></label><label>المسؤول<select name="assignee" required>'+people.map(function(p){return '<option value="'+esc(p.id)+'">'+esc(p.name)+'</option>';}).join('')+'</select></label><label>الموعد<input type="datetime-local" name="due" required></label><label>المخرج المتوقع<textarea name="output" placeholder="مثال: خطة حملة واختبار وقياس"></textarea></label><button class="btn primary">إنشاء المهمة</button></form></div>';document.body.appendChild(wrap);wrap.querySelector('.modal-close').onclick=function(){wrap.remove();};wrap.onclick=function(e){if(e.target===wrap)wrap.remove();};wrap.querySelector('form').onsubmit=function(e){e.preventDefault();var f=new FormData(e.target),due=new Date(String(f.get('due')));if(isNaN(due.getTime()))return;rpc('business_recommendation_to_task',{p_id:recId,p_project_id:f.get('project'),p_assignee:f.get('assignee'),p_due:due.toISOString(),p_expected_output:f.get('output')||'',p_priority:'medium'}).then(function(){wrap.remove();toast('تم إنشاء المهمة وربطها بالتوصية');load(node);}).catch(function(er){toast(er.message,'error');});};}).catch(function(e){toast(e.message,'error');});}

  // Feed only approved/validated summaries into the existing content AI. Raw employee reports never leave the task module.
  function installContentContext(){if(!root.SSMPDDb||!root.SSMPDDb.generateContentIdeas||root.SSMPDDb.__businessContextInstalled)return;var original=root.SSMPDDb.generateContentIdeas;root.SSMPDDb.generateContentIdeas=function(payload){payload=Object.assign({},payload||{});return rpc('business_content_brief',{p_brand:String(payload.brand||''),p_specialty:String(payload.specialty||'')}).catch(function(){return '';}).then(function(memory){if(memory)payload.performance_brief=String(payload.performance_brief||'')+'\n=== APPROVED BUSINESS MEMORY ===\n'+memory+'\nBUSINESS MEMORY RULE: validated_by_data أعلى من manager_approved، والفرضيات تظل فرضيات. لا تخترع نتيجة أو رقمًا غير موجود.';return original.call(root.SSMPDDb,payload);});};root.SSMPDDb.__businessContextInstalled=true;}

  if(baseSummary&&typeof baseSummary.render==='function'){
    root.SSMPDRenderSummary={render:function(container){var ret=baseSummary.render.apply(baseSummary,arguments);var tries=0,t=setInterval(function(){tries++;if(!container.isConnected){clearInterval(t);return;}if(!container.querySelector('.loading')){mount(container);clearInterval(t);}else if(tries>40){mount(container);clearInterval(t);}},100);return ret;}};
  }
  installContentContext();
  root.SSMPDBusinessIntelligence={mount:mount,refresh:function(){var n=document.querySelector('[data-business-intelligence]');if(n)load(n,true);}};
})(window);
