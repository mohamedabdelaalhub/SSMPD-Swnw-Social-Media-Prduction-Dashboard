/* Clear, non-technical overview of independently scanned task attachments. */
(function(w){
'use strict';
if(w.SSMPDTaskScanSummary)return;
var client=null,state='needs_action',busy=false;
var esc=function(v){return String(v==null?'':v).replace(/[&<>"']/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c];});};
function db(){if(client)return client;var c=w.SSMPD_CONFIG?.supabase;return client=w.supabase.createClient(c.url,c.anonKey,{auth:{persistSession:true,autoRefreshToken:true}});}
function root(){return document.querySelector('.digital-team');}
function shell(){
 var r=root();if(!r||!w.SSMPDDigitalTeam?.isOwner?.()||r.querySelector('[data-scan-summary]'))return;
 var pane=document.createElement('section');pane.className='swnw-scan-summary';pane.setAttribute('data-scan-summary','');pane.dir='rtl';
 pane.innerHTML='<header class="ss-head"><div><h2>فحص ملفات المهام تلقائيًا</h2><p>سيا يفحص الملفات المتاحة بعد تسليمها. مش محتاج تضغط زر لكل ملف.</p></div><button type="button" data-scan-refresh>تحديث النتائج</button></header>'+
 '<div data-scan-counters class="ss-counters"></div>'+
 '<div class="ss-filters"><button type="button" data-scan-filter="needs_action">تحتاج متابعة</button><button type="button" data-scan-filter="scanned">تم تحليلها</button><button type="button" data-scan-filter="all">كل الملفات</button></div>'+
 '<div class="ss-items" data-scan-items>جارٍ تحميل حالة الملفات…</div>'+
 '<p class="ss-footer">المراجعة هنا توضح محتوى الملفات والنواقص فقط. لا تعتمد المهمة أو ترجعها للموظف تلقائيًا.</p>';
 r.appendChild(pane);
 pane.querySelector('[data-scan-refresh]').onclick=load;
 pane.querySelectorAll('[data-scan-filter]').forEach(function(x){x.onclick=function(){state=x.dataset.scanFilter;load();};});
 load();
}
function readable(raw){
 var s=String(raw||'ملف');
 try{
  if(/^D[89]%[0-9A-F]{2}/i.test(s))s='%'+s;
  for(var i=0;i<2&&/%[0-9a-f]{2}/i.test(s);i++)s=decodeURIComponent(s);
 }catch(_){}
 return s.replace(/[_-]{3,}/g,' ').slice(0,230);
}
var descriptions={
 scanned:'تم استخراج المحتوى وتحليله، وتقدر تراجع الملخص والملاحظات أدناه.',
 restricted:'محتوى يحتمل وجود بيانات مرضى أو بيانات خاصة، ويحتاج شخصًا مخولًا يراجعه.',
 needs_access:'ملف Google Drive غير متاح لحساب الفحص. يلزم منحه صلاحية قراءة فقط.',
 unsupported:'نوع الملف أو حجمه يحتاج طريقة فحص أخرى.',
 retry:'الفحص تعطل مؤقتًا وهيعيد المحاولة تلقائيًا.',
 failed:'لم ينجح الفحص بعد المحاولات المسموح بها. يحتاج متابعة تقنية.',
 pending:'الملف في قائمة الانتظار للفحص.',
 processing:'الفحص جارٍ الآن.'
};
var labels={scanned:'تم التحليل',restricted:'مراجعة بشرية',needs_access:'يحتاج صلاحية',unsupported:'يحتاج طريقة أخرى',retry:'إعادة المحاولة',failed:'تعذر الفحص',pending:'في الانتظار',processing:'جارٍ الفحص'};
function fileCard(x){
 var a=x.analysis||{},findings=Array.isArray(a.findings)?a.findings:[],missing=Array.isArray(a.missing_information)?a.missing_information:[];
 var heading=readable(x.file_name),status=labels[x.state]||x.state;
 return '<details class="ss-file '+esc(x.state)+'"><summary><span class="ss-icon" aria-hidden="true">▤</span><span class="ss-file-main"><b>'+esc(heading)+'</b><small>'+esc(descriptions[x.state]||'')+'</small></span><span class="ss-state">'+esc(status)+'</span><span class="ss-chevron">⌄</span></summary>'+
 '<div class="ss-file-detail">'+(x.summary?'<p class="ss-synopsis">'+esc(x.summary)+'</p>':'<p class="ss-synopsis">'+esc(descriptions[x.state]||'المعلومات غير متاحة بعد.')+'</p>')+
 (findings.length?'<div><b>الملاحظات</b><ul>'+findings.slice(0,5).map(function(t){return '<li>'+esc(t)+'</li>';}).join('')+'</ul></div>':'')+
 (missing.length?'<div><b>معلومات تحتاج استكمال</b><ul>'+missing.slice(0,4).map(function(t){return '<li>'+esc(t)+'</li>';}).join('')+'</ul></div>':'')+
 '<div class="ss-actions"><button type="button" data-scan-open-task="'+esc(x.task_id)+'">افتح المهمة</button><span>'+esc(descriptions[x.state]||'')+'</span></div></div></details>';
}
function openTask(id){
 if(!id)return;
 var nav=document.querySelector('[data-goto="tasks"]');if(nav)nav.click();
 var tries=0,timer=setInterval(function(){if(w.SSMPDRenderTasks?.focus?.(id)||++tries>28)clearInterval(timer);},250);
}
async function load(){
 var pane=root()?.querySelector('[data-scan-summary]');if(!pane||busy)return;busy=true;
 var area=pane.querySelector('[data-scan-items]');area.textContent='جارٍ تحديث نتائج الملفات…';
 try{
  var r=await db().rpc('task_file_scan_overview',{p_limit:75});if(r.error)throw r.error;
  if(!pane.isConnected)return;
  var d=r.data||{},c=d.counts||{},all=Array.isArray(d.recent)?d.recent:[],
    done=Number(c.scanned||0),manual=Number(c.restricted||0)+Number(c.needs_access||0)+Number(c.unsupported||0)+Number(c.failed||0),
    waiting=Number(c.retry||0)+Number(c.pending||0)+Number(c.processing||0);
  pane.querySelector('[data-scan-counters]').innerHTML=
  '<div><b>'+done+'</b><span>ملف اتفحص</span></div>'+
  '<div><b>'+manual+'</b><span>محتاج متابعة</span></div>'+
  '<div><b>'+waiting+'</b><span>في الانتظار أو إعادة المحاولة</span></div>';
  pane.querySelectorAll('[data-scan-filter]').forEach(function(x){x.classList.toggle('active',x.dataset.scanFilter===state);});
  var shown=all.filter(function(x){
    if(state==='scanned')return x.state==='scanned';
    if(state==='needs_action')return ['restricted','needs_access','unsupported','failed','retry','pending','processing'].includes(x.state);
    return true;
  });
  area.innerHTML=shown.length?shown.map(fileCard).join(''):'<div class="ss-empty">مفيش ملفات في التصنيف ده حاليًا.</div>';
  pane.querySelectorAll('[data-scan-open-task]').forEach(function(x){x.onclick=function(){openTask(x.dataset.scanOpenTask);};});
 }catch(e){area.textContent='تعذر قراءة ملخص الملفات: '+(e.message||e);}
 finally{busy=false;}
}
w.addEventListener('ssmpd-digital-team-rendered',shell);
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',shell);else shell();
w.SSMPDTaskScanSummary={refresh:load};
})(window);