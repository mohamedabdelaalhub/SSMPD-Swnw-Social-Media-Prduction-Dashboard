/* SSMPD — Business Intelligence Automation
   Adds automatic queued-report processing on manager sessions, a since-last-visit brief,
   hierarchy blocker context, and a first-class manager navigation tab.
*/
(function(root){
  'use strict';
  var started=false, rendered=false;
  function db(){return root.SSMPDDb&&root.SSMPDDb.client;}
  function admin(){return root.SSMPDAuth&&root.SSMPDAuth.currentAdmin;}
  function manager(){var a=admin();return !!(a&&root.SSMPDRoles&&root.SSMPDRoles.hasAnyRole(a,['general_manager','super_admin']));}
  function esc(v){return String(v==null?'':v).replace(/[&<>"']/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c];});}
  function n(v){return Number(v||0).toLocaleString('en-US');}
  function toast(msg,type){if(root.SSMPDToast)root.SSMPDToast.show(msg,type||'success');}
  function count(table,column,since,extra){var q=db().from(table).select('id',{count:'exact',head:true}).gte(column,since);return extra?extra(q):q;}

  async function sinceLastVisit(shell){
    var a=admin(); if(!a||!a.id||!shell||shell.querySelector('[data-bi-return-brief]'))return;
    var key='ssmpd.bi.lastVisit.'+a.id;
    var previous=localStorage.getItem(key);
    var since=previous&&Date.parse(previous)?previous:new Date(Date.now()-24*60*60*1000).toISOString();
    try{
      var res=await Promise.all([
        count('tasks','completed_at',since,function(q){return q.not('completed_at','is',null);}),
        count('business_knowledge_items','created_at',since),
        count('business_recommendations','created_at',since),
        count('business_measurements','measured_at',since),
        db().from('tasks').select('id,title,status,due_at,parent_task_id,project_id').lt('due_at',new Date().toISOString()).not('parent_task_id','is',null).not('status','in','(done,review)').limit(80)
      ]);
      var overdue=res[4]&&res[4].data||[];
      var parentIds=[...new Set(overdue.map(function(x){return x.parent_task_id;}).filter(Boolean))];
      var projectIds=[...new Set(overdue.map(function(x){return x.project_id;}).filter(Boolean))];
      var parents=parentIds.length?(await db().from('tasks').select('id,title,status,project_id').in('id',parentIds)).data||[]:[];
      var projects=projectIds.length?(await db().from('task_projects').select('id,title').in('id',projectIds)).data||[]:[];
      var pm={};parents.forEach(function(x){pm[x.id]=x;});var jm={};projects.forEach(function(x){jm[x.id]=x;});
      var groups={}; overdue.forEach(function(x){var k=x.parent_task_id||x.project_id||'other';if(!groups[k])groups[k]={parent:pm[x.parent_task_id],project:jm[x.project_id],items:[]};groups[k].items.push(x);});
      var blockers=Object.keys(groups).map(function(k){return groups[k];}).sort(function(a,b){return b.items.length-a.items.length;}).slice(0,4);
      var box=document.createElement('section');box.className='bi-panel';box.dataset.biReturnBrief='1';
      box.innerHTML='<div class="bi-panel-head"><div><p class="bi-eyebrow">Since your last visit</p><h3>منذ آخر زيارة لك</h3><p>'+esc(previous?'من '+new Date(since).toLocaleString('ar-EG'):'أول تشغيل يعرض آخر 24 ساعة')+'</p></div></div>'+
        '<div class="bi-grid bi-kpis"><div class="bi-kpi"><small>مهام اكتملت</small><b>'+n(res[0].count)+'</b></div><div class="bi-kpi"><small>معرفة جديدة</small><b>'+n(res[1].count)+'</b></div><div class="bi-kpi"><small>توصيات جديدة</small><b>'+n(res[2].count)+'</b></div><div class="bi-kpi"><small>نتائج تم قياسها</small><b>'+n(res[3].count)+'</b></div></div>'+
        (blockers.length?'<div class="bi-alert high"><b>تعطيل هرمي يحتاج انتباه</b><p>'+blockers.map(function(g){var label=g.parent&&g.parent.title||g.project&&g.project.title||'مجموعة مهام';return esc(label)+' فيها '+n(g.items.length)+' مهمة فرعية متأخرة';}).join(' · ')+'</p></div>':'');
      var head=shell.querySelector('.bi-head'); if(head&&head.parentNode)head.parentNode.insertBefore(box,head.nextSibling); else shell.insertBefore(box,shell.firstChild);
      localStorage.setItem(key,new Date().toISOString());
    }catch(e){console.warn('BI return brief skipped',e);}
  }

  async function autoProcess(){
    if(sessionStorage.getItem('ssmpd.bi.autoProcessed')==='1')return;
    sessionStorage.setItem('ssmpd.bi.autoProcessed','1');
    try{
      var enabled=await db().rpc('business_ai_enabled'); if(enabled.error||enabled.data!==true)return;
      var processed=0,knowledge=0,recs=0;
      for(var i=0;i<3;i++){
        var r=await db().functions.invoke('business-intelligence',{body:{mode:'extract_queue'}});
        if(r.error||r.data&&r.data.error)break;
        if(!r.data||!r.data.processed)break;
        processed+=Number(r.data.processed||0); knowledge+=Number(r.data.knowledge_items||0); recs+=Number(r.data.recommendations||0);
      }
      if(processed){toast('تم تحليل '+processed+' تقرير وإضافة '+knowledge+' عناصر معرفة و'+recs+' توصيات للمراجعة.');setTimeout(function(){var b=document.querySelector('[data-bi-refresh]');if(b)b.click();},600);}
    }catch(e){console.warn('BI automatic extraction skipped',e);}
  }

  function openBusinessIntelligence(){
    if(!manager()||!root.SSMPDBusinessIntelligence)return;
    var container=document.getElementById('view-container')||document.querySelector('.view-container');
    if(!container)return;
    document.querySelectorAll('#tabs-bar .tab-btn').forEach(function(x){x.classList.remove('active');});
    var tab=document.querySelector('#tabs-bar [data-tab="business_intelligence"]');if(tab)tab.classList.add('active');
    if(root.SSMPDNavigationUI&&root.SSMPDNavigationUI.setCurrent)root.SSMPDNavigationUI.setCurrent('business_intelligence');
    container.innerHTML='';
    root.SSMPDBusinessIntelligence.mount(container);
    var brand=document.getElementById('brand-section-name');if(brand)brand.textContent='ذكاء الإدارة';
    var menu=document.getElementById('user-dropdown');if(menu)menu.classList.remove('open');
  }
  function ensureNavigation(){
    if(!manager())return;
    var bar=document.getElementById('tabs-bar');
    if(bar&&!bar.querySelector('[data-tab="business_intelligence"]')){
      var b=document.createElement('button');b.className='tab-btn';b.dataset.tab='business_intelligence';b.textContent='ذكاء الإدارة';b.onclick=openBusinessIntelligence;bar.appendChild(b);
    }
    var items=document.querySelector('#user-dropdown .ud-items');
    if(items&&!items.querySelector('[data-goto="business_intelligence"]')){
      var m=document.createElement('button');m.className='ud-item';m.dataset.goto='business_intelligence';m.textContent='ذكاء الإدارة';m.onclick=function(e){e.preventDefault();openBusinessIntelligence();};
      var empty=items.querySelector('.nav-menu-empty');items.insertBefore(m,empty||null);
    }
  }
  function attach(){
    ensureNavigation();
    if(!manager()||!db())return;
    var shell=document.querySelector('[data-business-intelligence]');
    if(shell&&!rendered){rendered=true;sinceLastVisit(shell);autoProcess();}
  }
  function boot(){if(started)return;started=true;attach();var mo=new MutationObserver(function(){attach();});mo.observe(document.documentElement,{childList:true,subtree:true});setTimeout(attach,1200);setTimeout(attach,3500);}
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',boot);else boot();
  root.SSMPDOpenBusinessIntelligence=openBusinessIntelligence;
})(window);
