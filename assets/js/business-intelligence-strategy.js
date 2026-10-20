/* SSMPD — Strategic Owner Views
   Adds Needs My Decision, Opportunities, Marketing & Ads and Knowledge Graph
   without replacing the existing summary or Business Intelligence workspace.
*/
(function(root){
  'use strict';
  var mountedShell=null, active='decisions', strategy=null, graph=null, loadId=0;
  var LABELS={
    knowledge:'معرفة',recommendation:'توصية',decision:'قرار',measurement:'قياس',task:'مهمة',project:'مشروع',employee:'موظف',content:'محتوى',campaign:'حملة',service:'خدمة',audience:'جمهور',
    derived_from:'مستخلصة من',belongs_to:'تابعة لـ',contributed:'ساهم في',about:'عن',targets:'تستهدف',supported_by:'مدعومة بـ',implemented_as:'نُفذت كمهمة',based_on:'مبنية على',approved_from:'اعتمدت من',executed_by:'نُفذت عبر',validates:'تتحقق من',measures:'تقيس'
  };
  function esc(v){return String(v==null?'':v).replace(/[&<>"']/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c];});}
  function num(v){return Number(v||0).toLocaleString('en-US',{maximumFractionDigits:2});}
  function dt(v){if(!v)return '—';try{return new Date(v).toLocaleDateString('ar-EG');}catch(e){return String(v);}}
  function client(){return root.SSMPDDb&&root.SSMPDDb.client;}
  function manager(){var a=root.SSMPDAuth&&root.SSMPDAuth.currentAdmin;return !!(a&&root.SSMPDRoles&&root.SSMPDRoles.hasAnyRole(a,['general_manager','super_admin']));}
  function rpc(name,args){return client().rpc(name,args||{}).then(function(r){if(r.error)throw r.error;return r.data;});}
  function period(shell){var b=shell.querySelector('[data-bi-period].primary');return b&&b.dataset.biPeriod||'week';}
  function badge(v){return '<span class="bi-badge">'+esc(v)+'</span>';}
  function empty(v){return '<div class="bi-empty">'+esc(v)+'</div>';}
  function kpi(k,v,s){return '<div class="bi-kpi"><small>'+esc(k)+'</small><b>'+esc(v)+'</b>'+(s?'<span>'+esc(s)+'</span>':'')+'</div>';}
  function mount(shell){
    if(!shell||!shell.isConnected||!manager()||shell.querySelector('[data-bi-strategy]'))return;
    mountedShell=shell;
    var host=document.createElement('section');host.className='bi-strategy';host.dataset.biStrategy='1';
    host.innerHTML='<div class="bi-strategy-head"><div><p class="bi-eyebrow">Strategic Owner Views</p><h3>القرار والفرص والتسويق والروابط</h3><p>من نفس بيانات المهام والتقارير والمحتوى والإعلانات. لا يوجد مصدر بيانات موازٍ.</p></div><button class="btn" data-bis-refresh>تحديث</button></div>'+
      '<nav class="bi-strategy-tabs">'+[
        ['decisions','يحتاج قراري'],['opportunities','الفرص'],['marketing','التسويق والإعلانات'],['tasks','خلاصة المهام'],['graph','Knowledge Graph']
      ].map(function(x){return '<button data-bis-view="'+x[0]+'" class="'+(active===x[0]?'active':'')+'">'+x[1]+'</button>';}).join('')+'</nav>'+
      '<div class="bi-strategy-body" data-bis-body><div class="loading">جاري قراءة المؤشرات الاستراتيجية…</div></div>';
    shell.appendChild(host);
    host.querySelector('[data-bis-refresh]').onclick=function(){load(shell,true);};
    host.querySelectorAll('[data-bis-view]').forEach(function(b){b.onclick=function(){active=b.dataset.bisView;host.querySelectorAll('[data-bis-view]').forEach(function(x){x.classList.toggle('active',x===b);});draw(shell);};});
    load(shell);
  }
  function load(shell){
    var id=++loadId,p=period(shell),body=shell.querySelector('[data-bis-body]');
    if(body)body.innerHTML='<div class="loading">جاري قراءة المؤشرات الاستراتيجية…</div>';
    Promise.all([rpc('business_strategy_snapshot',{p_period:p}),rpc('business_graph_snapshot',{p_limit:80})]).then(function(x){
      if(id!==loadId||!shell.isConnected)return;strategy=x[0]||{};graph=x[1]||{};draw(shell);
    }).catch(function(e){if(body)body.innerHTML='<div class="err-msg">'+esc(e.message)+'</div>';});
  }
  function draw(shell){var body=shell.querySelector('[data-bis-body]');if(!body||!strategy)return;
    if(active==='opportunities')body.innerHTML=opportunities();
    else if(active==='marketing')body.innerHTML=marketing();
    else if(active==='tasks')body.innerHTML=tasks();
    else if(active==='graph')body.innerHTML=graphHtml();
    else body.innerHTML=decisions();
  }
  function decisions(){var n=strategy.needs_decision||{},r=n.recommendations||[],d=n.decisions_due||[],k=n.knowledge_review_due||[];
    return '<div class="bi-grid bi-kpis">'+kpi('توصيات تنتظر قرارك',num(r.length))+kpi('قرارات حان قياسها',num(d.length))+kpi('معرفة تحتاج إعادة تحقق',num(k.length))+'</div><div class="bi-two">'+
      '<section class="bi-panel"><h3>التوصيات التي تحتاج قرارًا</h3>'+(r.length?r.map(function(x){return '<article class="bi-rec"><div><b>'+esc(x.title)+'</b>'+badge(x.priority)+badge(x.recommendation_type)+'</div><p>'+esc(x.rationale)+'</p><small>'+esc(x.expected_metric||'لم يحدد مؤشر بعد')+'</small></article>';}).join(''):empty('لا توجد توصيات تنتظر قرار الإدارة.'))+'</section>'+
      '<section class="bi-panel"><h3>ما حان موعد مراجعته</h3>'+(d.length?d.map(function(x){return '<article class="bi-decision"><b>'+esc(x.title)+'</b><p>'+esc(x.decision)+'</p><small>تاريخ القياس '+dt(x.review_on)+' · '+esc(x.expected_metric||'بدون مؤشر محدد')+'</small></article>';}).join(''):empty('لا توجد قرارات وصل موعد قياسها.'))+(k.length?'<h4>معرفة تحتاج تحديثًا</h4>'+k.map(function(x){return '<article class="bi-knowledge"><b>'+esc(x.title)+'</b><p>'+esc(x.statement)+'</p><small>الثقة '+Math.round(Number(x.confidence||0)*100)+'% · مراجعة '+dt(x.review_after)+'</small></article>';}).join(''):'')+'</section></div>';
  }
  function opportunities(){var rows=strategy.opportunities||[];return '<section class="bi-panel"><div class="bi-panel-head"><div><h3>Opportunities</h3><p>تعرض فقط معرفة اعتمدتها الإدارة أو تحققت بالبيانات ولم تنته صلاحيتها.</p></div></div>'+(rows.length?'<div class="bi-opportunity-grid">'+rows.map(function(x){return '<article class="bi-opportunity"><div><b>'+esc(x.title)+'</b>'+badge(x.knowledge_type)+(x.status==='validated_by_data'?badge('تحققت بالبيانات'):badge('معتمدة'))+'</div><p>'+esc(x.statement)+'</p><div class="bi-opportunity-meta"><span>الثقة '+Math.round(Number(x.confidence||0)*100)+'%</span>'+(x.service?'<span>الخدمة '+esc(x.service)+'</span>':'')+(x.audience?'<span>الجمهور '+esc(x.audience)+'</span>':'')+'</div></article>';}).join('')+'</div>':empty('لسه مفيش Opportunities معتمدة. هتبدأ تظهر بعد مراجعة المعرفة المستخرجة من التقارير.'))+'</section>';}
  function table(title,rows){rows=rows||[];return '<section class="bi-panel"><h3>'+esc(title)+'</h3>'+(rows.length?'<div class="bi-table-wrap"><table class="simple"><thead><tr><th>العنصر</th><th>الإنفاق</th><th>النتائج</th><th>Leads</th><th>CPR</th></tr></thead><tbody>'+rows.map(function(x){return '<tr><td>'+esc(x.label)+'</td><td>'+num(x.spend)+'</td><td>'+num(x.results)+'</td><td>'+num(x.leads)+'</td><td>'+num(x.cpr)+'</td></tr>';}).join('')+'</tbody></table></div>':empty('لا توجد بيانات مصنفة كفاية.'))+'</section>';}
  function marketing(){var campaigns=strategy.top_campaigns||[],sig=strategy.creative_signals||{},att=strategy.attribution||{};
    return '<div class="bi-grid bi-kpis">'+kpi('حملات قابلة للمقارنة',num(campaigns.length))+kpi('حجوزات من Leads مرتبطة بـMeta',num(att.booked_meta_attributed))+kpi('Revenue Attribution',att.revenue_ready?'جاهز':'غير جاهز','لا يتم حساب ROAS قبل الربط المالي')+'</div>'+
      '<section class="bi-panel"><div class="bi-panel-head"><div><h3>أداء الحملات</h3><p>الأرقام من Meta Lifetime Performance. استخدمها للاتجاه والمقارنة وليس كتقرير فترة.</p></div></div>'+(campaigns.length?'<div class="bi-table-wrap"><table class="simple"><thead><tr><th>الحملة</th><th>Spend</th><th>Results</th><th>Leads</th><th>CPR</th><th>CPL</th><th>CTR</th></tr></thead><tbody>'+campaigns.map(function(x){return '<tr><td>'+esc(x.campaign_name)+'</td><td>'+num(x.spend)+'</td><td>'+num(x.results)+'</td><td>'+num(x.leads)+'</td><td>'+num(x.cost_per_result)+'</td><td>'+num(x.cost_per_lead)+'</td><td>'+num(x.weighted_ctr)+'%</td></tr>';}).join('')+'</tbody></table></div>':empty('لا توجد حملات بأداء مسجل.'))+'<p class="bi-muted">'+esc(att.explanation||'')+'</p></section>'+
      '<div class="bi-two">'+table('التخصصات',sig.specialties)+table('زوايا المحتوى',sig.angles)+'</div><div class="bi-two">'+table('أنواع الـHook',sig.hooks)+table('أنواع الـCreative',sig.creative_types)+'</div>'+table('CTA',sig.ctas);
  }
  function tasks(){var rows=strategy.recent_task_digest||[];return '<section class="bi-panel"><div class="bi-panel-head"><div><h3>خلاصة المهام المنجزة</h3><p>يعرض آخر تسليم معتمد لكل مهمة في الفترة حتى لا يضطر المالك لفتح كل Task. التحليل الآلي الكامل للتقرير يظل متوقفًا حتى تفعيل External Business AI.</p></div></div>'+(rows.length?'<div class="bi-task-digest">'+rows.map(function(x){return '<article><div><b>'+esc(x.title)+'</b>'+(x.project_title?badge(x.project_title):'')+'</div><p>'+esc(x.result_preview||'لا يوجد نص تسليم محفوظ للمهمة.')+'</p><small>'+(x.author_name?'بواسطة '+esc(x.author_name)+' · ':'')+dt(x.completed_at)+'</small></article>';}).join('')+'</div>':empty('لا توجد مهام مكتملة في الفترة المختارة.'))+'</section>';}
  function shortKey(type,key){if(!key)return '—';if(['service','audience'].includes(type))return key;return String(key).length>14?String(key).slice(0,8)+'…':String(key);}
  function graphHtml(){var counts=graph&&graph.counts||{},edges=graph&&graph.edges||[];var cards=Object.keys(counts).map(function(k){return kpi(LABELS[k]||k,num(counts[k]));}).join('');
    return '<div class="bi-grid bi-kpis">'+(cards||kpi('العلاقات','0'))+'</div><section class="bi-panel"><div class="bi-panel-head"><div><h3>Knowledge Graph</h3><p>العلاقات لا تنسخ البيانات. كل عنصر يشير لمصدر الحقيقة الأصلي.</p></div></div>'+(edges.length?'<div class="bi-graph-list">'+edges.map(function(e){return '<article><span>'+esc(LABELS[e.from_type]||e.from_type)+' · '+esc(shortKey(e.from_type,e.from_key))+'</span><b>'+esc(LABELS[e.relation_type]||e.relation_type)+'</b><span>'+esc(LABELS[e.to_type]||e.to_type)+' · '+esc(shortKey(e.to_type,e.to_key))+'</span></article>';}).join('')+'</div>':empty('الـGraph جاهز. العلاقات ستبدأ في الظهور مع اعتماد المعرفة والتوصيات والقياسات.'))+'</section>';}

  function scan(){if(!manager())return;document.querySelectorAll('[data-business-intelligence]').forEach(mount);}
  var obs=new MutationObserver(function(){scan();});
  if(document.body)obs.observe(document.body,{childList:true,subtree:true});
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',scan);else setTimeout(scan,0);
  root.SSMPDBusinessStrategy={refresh:function(){if(mountedShell&&mountedShell.isConnected)load(mountedShell,true);}};
})(window);
