/* SSMPD — تاب مهام الموظفين */
(function () {
  "use strict";
  var liveTimer=null,currentFocus=null;
  var STATUS = {todo:"لم تبدأ",in_progress:"جاري العمل",review:"بانتظار المراجعة",revision:"مطلوب تعديل",done:"مكتملة",blocked:"متوقفة"};
  var PRIORITY = {low:"منخفضة",normal:"عادية",high:"عالية",urgent:"عاجلة"};
  function esc(v){return String(v==null?"":v).replace(/[&<>"']/g,function(c){return {"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c];});}
  function date(v){if(!v)return "بدون موعد";var d=new Date(v);return isNaN(d)?"":d.toLocaleDateString("ar-EG-u-nu-latn",{year:"numeric",month:"short",day:"numeric"});}
  function dateValue(v){if(!v)return "";var d=new Date(v);if(isNaN(d))return "";return d.getFullYear()+"-"+String(d.getMonth()+1).padStart(2,"0")+"-"+String(d.getDate()).padStart(2,"0");}
  function repeatFields(t){t=t||{};var active=!!t.recurrence_active;return '<label class="tsk-repeat-toggle"><input type="checkbox" name="repeat_active" '+(active?"checked":"")+'><span>تكرار المهمة تلقائياً</span></label><div class="tsk-repeat-fields" '+(active?"":"hidden")+'><div class="tsk-form-row"><label>كل<input type="number" name="repeat_interval" min="1" max="365" value="'+esc(t.recurrence_interval_value||1)+'"></label><label>الفترة<select name="repeat_unit"><option value="day" '+(t.recurrence_interval_unit==="day"?"selected":"")+'>يوم</option><option value="week" '+(t.recurrence_interval_unit==="week"?"selected":"")+'>أسبوع</option><option value="month" '+(t.recurrence_interval_unit==="month"?"selected":"")+'>شهر</option></select></label></div><label>إيقاف التكرار في (اختياري)<input type="date" name="repeat_until" aria-describedby="tsk-repeat-error tsk-repeat-hint" value="'+dateValue(t.recurrence_ends_at)+'"></label><p id="tsk-repeat-error" class="tsk-field-error" role="alert" hidden></p><small id="tsk-repeat-hint">اترك تاريخ الإيقاف فارغًا للاستمرار بدون تاريخ نهاية. سيتم إنشاء مهمة جديدة تلقائياً بالبيانات نفسها وإسنادها للمسؤول.</small></div>';}
  var REPEAT_DATE_ERROR="تاريخ إيقاف التكرار لا يمكن أن يكون قبل اليوم. اختار اليوم أو تاريخًا بعده، أو امسح التاريخ للاستمرار بدون تاريخ نهاية.";
  function repeatError(form,message){
    var field=form.querySelector('[name="repeat_until"]'),error=form.querySelector('#tsk-repeat-error');
    if(field){field.setCustomValidity(message);field.setAttribute("aria-invalid",message?"true":"false");}
    if(error){error.textContent=message;error.hidden=!message;}
  }
  function syncRepeat(form){
    var field=form.querySelector('[name="repeat_until"]'),toggle=form.querySelector('[name="repeat_active"]');
    if(!field||!toggle)return true;
    // Supabase validates against current_date (UTC). Compare date strings, not local timestamps.
    field.min=new Date().toISOString().slice(0,10);
    field.disabled=!toggle.checked;
    var fields=form.querySelector(".tsk-repeat-fields");if(fields){fields.hidden=!toggle.checked;fields.querySelectorAll("input,select").forEach(function(control){control.disabled=!toggle.checked;});}
    var message=toggle.checked&&field.value&&field.value<field.min?REPEAT_DATE_ERROR:"";
    repeatError(form,message);return !message;
  }
  function taskSaveError(form,error){
    if(/Recurrence end date must be in the future/i.test(error.message||"")){
      repeatError(form,REPEAT_DATE_ERROR);var field=form.querySelector('[name="repeat_until"]');if(field)field.focus();
    }else window.alert(error.message);
  }
  function allManager(a){return window.SSMPDRoles.hasAnyRole(a,["general_manager","super_admin"]);}
  function modal(title,body,cls){return '<div class="tsk-modal-backdrop" data-action="close-modal"><section class="tsk-modal'+(cls?' '+cls:'')+'" role="dialog" aria-modal="true"><header><h3>'+esc(title)+'</h3><button type="button" class="tsk-x" data-action="close-modal" aria-label="إغلاق">×</button></header>'+body+'</section></div>';}
  var PRANK={urgent:0,high:1,normal:2,low:3};
  function prank(t){var r=PRANK[t.priority];return r===undefined?2:r;}
  function dayStart(d){return new Date(d.getFullYear(),d.getMonth(),d.getDate());}
  function isOverdue(t){return t.status!=="done"&&t.status!=="review"&&!!t.due_at&&new Date(t.due_at)<new Date();}
  function daysLeft(t){if(!t.due_at||t.status==="done")return null;var d=new Date(t.due_at);if(isNaN(d))return null;return Math.round((dayStart(d)-dayStart(new Date()))/86400000);}
  function dayWord(n){return n===1?"يوم":(n===2?"يومين":(n<=10?n+" أيام":n+" يوم"));}
  function dueNote(t){if(t.status==="review")return " · بانتظار مراجعة المدير";var n=daysLeft(t);if(n===null)return "";if(n<0)return " · متأخرة "+dayWord(-n);if(n===0)return " · ينتهي النهارده";if(n===1)return " · ينتهي بكرة";return " · باقي "+dayWord(n);}
  function dueTime(t){return t.due_at?new Date(t.due_at).getTime():Infinity;}
  function sortTasks(list,mode){
    return list.slice().sort(function(x,y){
      var dx=dueTime(x),dy=dueTime(y),byDue=dx===dy?0:(dx<dy?-1:1),byPrio=prank(x)-prank(y),byUpd=new Date(y.updated_at||0)-new Date(x.updated_at||0);
      if(mode==="manual")return (Number(x.sort_order)||0)-(Number(y.sort_order)||0)||byDue||byPrio||byUpd;
      if(mode==="due")return byDue||byPrio||byUpd;
      if(mode==="priority")return byPrio||byDue||byUpd;
      if(mode==="updated")return byUpd;
      var gx=x.status==="done"?2:(isOverdue(x)?0:1),gy=y.status==="done"?2:(isOverdue(y)?0:1);
      if(gx!==gy)return gx-gy;
      return gx===2?byUpd:(byDue||byPrio||byUpd);
    });
  }
  function norm(v){return String(v==null?"":v).toLowerCase().replace(/[ً-ٰٟـ]/g,"").replace(/[أإآ]/g,"ا").replace(/ى/g,"ي").replace(/ة/g,"ه").replace(/[٠-٩]/g,function(c){return String(c.charCodeAt(0)-1632);});}
  // روابط قصيرة بدل الروابط الطويلة (واتساب/مستندات Google/Drive) — النص كله بيتعمل له escape الأول
  var URL_RE=/(https?:\/\/[^\s<>"']+)/g,CLAUDE_ID="a0fbdfee-d147-4282-b988-186a9ae3e88c";
  function shortLink(raw,label){var url=raw.replace(/[.,،؛)]+$/,""),tail=raw.slice(url.length);
    if(!label){if(/^https:\/\/wa\.me\//.test(url))label="💬 ابعت واتساب";else if(/docs\.google\.com\/document/.test(url))label="📄 افتح المستند";else if(/docs\.google\.com\/spreadsheets/.test(url))label="📊 افتح الشيت";else if(/docs\.google\.com\/presentation/.test(url))label="🖼️ افتح العرض";else if(/drive\.google\.com/.test(url))label="📎 افتح الملف";else label=url.length>60?url.slice(0,57)+"…":url;}
    return '<a class="tsk-link" href="'+esc(url)+'" target="_blank" rel="noopener noreferrer">'+esc(label)+'</a>'+esc(tail);}
  function linkify(text){var out="",last=0,m;text=String(text==null?"":text);URL_RE.lastIndex=0;while((m=URL_RE.exec(text))){out+=esc(text.slice(last,m.index))+shortLink(m[0]);last=m.index+m[0].length;}return out+esc(text.slice(last));}
  // تقرير Claude: أول سطر «::report العنوان | سطر صغير»، وبعده ## عناوين، [kpi] اسم | رقم | تغيير، 1. بند || ملاحظة، - نقطة، [doc]/[wa] رابط
  function reportHtml(body){
    var lines=String(body).split(/\r?\n/),head=lines.shift().replace(/^::report\s*/,"").split("|"),h="",list="",kpis=[],acts=[],dec=false;
    function flush(){if(kpis.length){h+='<div class="rep-kpis">'+kpis.join("")+'</div>';kpis=[];}if(list){h+=list+(list.indexOf("<ol")===0?"</ol>":"</ul>");list="";}}
    lines.forEach(function(raw){var l=raw.trim(),m;if(!l)return;
      if((m=l.match(/^##\s*(.+)$/))){flush();dec=/قرار/.test(m[1]);h+='<h4>'+esc(m[1])+'</h4>';return;}
      if((m=l.match(/^\[kpi\]\s*(.+)$/i))){if(list){flush();}var k=m[1].split("|").map(function(x){return x.trim();}),ch=k[2]||"",cls=/^[▲+↑]/.test(ch)?"up":(/^[▼\-↓−]/.test(ch)?"dn":"");kpis.push('<div class="rep-kpi"><span>'+esc(k[0]||"")+'</span><b>'+esc(k[1]||"")+'</b>'+(ch?'<em class="'+cls+'">'+esc(ch)+'</em>':"")+'</div>');return;}
      if((m=l.match(/^\[(doc|wa|link)\]\s*(?:(.+?)\s*\|\s*)?(https?:\/\/\S+)$/i))){var t=m[1].toLowerCase();acts.push(shortLink(m[3],m[2]||(t==="doc"?"📄 افتح التقرير الكامل":t==="wa"?"💬 ابعت الملخص واتساب":null)).replace('class="tsk-link"','class="btn rep-act'+(t==="wa"?" wa":"")+'"'));return;}
      if(kpis.length)flush();
      if((m=l.match(/^\d+[.)]\s*(.+)$/))){if(list.indexOf("<ol")!==0){if(list)flush();list='<ol class="'+(dec?"rep-dec":"")+'">';}var parts=m[1].split("||");list+='<li>'+linkify(parts[0].trim())+(parts[1]?'<em>'+linkify(parts[1].trim())+'</em>':"")+'</li>';return;}
      if((m=l.match(/^[-•*]\s*(.+)$/))){if(list.indexOf("<ul")!==0){if(list)flush();list="<ul>";}list+='<li>'+linkify(m[1])+'</li>';return;}
      flush();h+='<p>'+linkify(l)+'</p>';});
    flush();
    return '<div class="tsk-report"><div class="rep-head"><b>'+esc((head[0]||"تقرير").trim())+'</b>'+(head[1]?'<span>'+esc(head[1].trim())+'</span>':"")+'</div><div class="rep-body">'+h+'</div>'+(acts.length?'<div class="rep-acts">'+acts.join("")+'</div>':"")+'</div>';}
  function bodyHtml(body){return /^::report\b/.test(String(body||""))?reportHtml(body):'<p>'+linkify(body)+'</p>';}
  var FILE_EXT=["png","jpg","jpeg","webp","gif","pdf","txt","csv","doc","docx","xls","xlsx","ppt","pptx"],MAX_FILES=10,MAX_BYTES=10485760;
  function fileSize(n){return n>=1048576?(n/1048576).toFixed(1).replace(/\.0$/,"")+" MB":Math.max(1,Math.round(n/1024))+" KB";}
  function store(key,value){try{if(value===undefined)return window.localStorage.getItem("ssmpd.tasks."+key);window.localStorage.setItem("ssmpd.tasks."+key,value);}catch(e){}return null;}
  var NOTE={
    progress:{title:"حفظ تقدمي",start:"ابدأ المهمة",label:"إيه اللي اتعمل أو هتشتغل عليه؟",hint:"مثال: خلّصت جرد الرف الأول وهبدأ الرف التاني",required:true,button:"حفظ تقدمي"},
    submit:{title:"إرسال للمراجعة",label:"ملخص الإنجاز",hint:"مثال: رفعت الشيت كامل على المنصة وراجعت الأرقام",required:true,button:"إرسال للمراجعة"},
    blocked:{title:"محتاج مساعدة",label:"إيه اللي موقفك؟",hint:"مثال: مستني ردّ المورد على الأسعار",required:true,button:"طلب مساعدة"},
    approve:{title:"اعتماد وإكمال المهمة",label:"ملاحظة الاعتماد (اختياري)",hint:"المهمة هتتقفل كمكتملة بعد الاعتماد.",required:false,button:"اعتماد وإكمال",confirm:true},
    return:{title:"طلب تعديل",label:"المطلوب تعديله",hint:"اكتب بوضوح إيه اللي ناقص عشان الموظف يعرف يعدّل",required:true,button:"طلب تعديل"},
    archive:{title:"أرشفة المشروع",label:"",hint:"المشروع ومهامه هيختفوا من الشاشة الأساسية، وتقدر ترجّعهم من زر \"عرض المؤرشفة\".",required:false,button:"أرشفة المشروع",confirm:true,noText:true},
    unarchive:{title:"إلغاء أرشفة المشروع",label:"",hint:"المشروع ومهامه هيرجعوا للشاشة الأساسية.",required:false,button:"إلغاء الأرشفة",confirm:true,noText:true}
  };
  function actionsHtml(t,admin,mayManage){
    var html="",own=t.assignee_id===admin.id,R=window.SSMPDRoles;
    if(R.canModuleAction(admin,"tasks","update")&&own&&t.status!=="done"&&t.status!=="review"){
      html+='<button class="btn btn-primary" data-action="open-task" data-id="'+t.id+'">'+(t.status==="todo"?'ابدأ المهمة':t.status==="revision"?'عدّل المطلوب':'كمّل الشغل')+'</button>';
    }
    if(R.canModuleAction(admin,"tasks","update")&&mayManage&&t.status==="review"){
      html+='<button class="btn btn-primary" data-action="approve" data-id="'+t.id+'">اعتماد وإكمال</button><button class="btn btn-warn" data-action="return" data-id="'+t.id+'">طلب تعديل</button>';
    }
    // تعليق المدير بيرجّع المهمة «للتعديل» — المدير يقدر برضه يعتمدها من غير ما يستنى تسليم جديد
    if(R.canModuleAction(admin,"tasks","update")&&mayManage&&t.status==="revision"&&!own){
      html+='<button class="btn btn-primary" data-action="approve" data-id="'+t.id+'">اعتماد وإكمال</button>';
    }
    return html;
  }
  function moreActionsHtml(t,admin,mayManage){
    var html="",R=window.SSMPDRoles;
    if(mayManage){
      if(R.canModuleAction(admin,"tasks","update"))html+='<button class="btn btn-quiet" data-action="edit-task" data-id="'+t.id+'">تعديل</button>';
      if(R.canModuleAction(admin,"tasks","create"))html+='<button class="btn btn-quiet" data-action="subtask" data-id="'+t.id+'">+ مهمة فرعية</button>';
      html+='<button class="btn btn-quiet" data-action="move-task" data-id="'+t.id+'" data-direction="up" title="تقديم في الترتيب">↑</button><button class="btn btn-quiet" data-action="move-task" data-id="'+t.id+'" data-direction="down" title="تأخير في الترتيب">↓</button>';
      html+='<button class="btn btn-quiet tv-danger" data-action="delete-task" data-id="'+t.id+'">حذف</button>';
    }
    return html;
  }
  function relTime(v){
    var d=new Date(v);if(isNaN(d))return "";var m=Math.max(0,Math.round((Date.now()-d.getTime())/60000));
    if(m<2)return "الآن";if(m<60)return "من "+m+" دقيقة";var h=Math.round(m/60);if(h<24)return "من "+(h===1?"ساعة":(h===2?"ساعتين":h+" ساعات"));
    var dd=Math.round(h/24);return dd===1?"من أمس":(dd===2?"من يومين":"من "+dd+" يوم");
  }
  function initials(name){var w=String(name||"").trim().split(/\s+/);return ((w[0]||"").charAt(0)+(w[1]||"").charAt(0)).toUpperCase()||"؟";}
  // تصنيف المهمة لشريحة واحدة بس (عشان الشريط الملوّن يجمّع على 100%)
  function seg(t){
    if(t.status==="done")return "done";
    if(isOverdue(t))return "late";
    if(t.status==="review")return "review";
    if(t.status==="in_progress"||t.status==="revision")return "active";
    if(t.status==="blocked")return "blocked";
    return "todo";
  }
  var SEG_LABEL={done:"تمت",late:"متأخرة",review:"مراجعة",active:"شغّالة",blocked:"متوقفة",todo:"لم تبدأ"};
  var SEG_ORDER=["done","active","review","late","blocked","todo"];
  function segCounts(list){var c={done:0,late:0,review:0,active:0,blocked:0,todo:0};list.forEach(function(t){c[seg(t)]++;});return c;}
  function segBar(c,total){
    if(!total)return '<div class="tv-bar"><i class="empty" style="width:100%"></i></div>';
    return '<div class="tv-bar" role="img" aria-label="'+SEG_ORDER.filter(function(k){return c[k];}).map(function(k){return SEG_LABEL[k]+" "+c[k];}).join("، ")+'">'+SEG_ORDER.filter(function(k){return c[k];}).map(function(k){return '<i class="g-'+k+'" style="width:'+(c[k]*100/total)+'%"></i>';}).join("")+'</div>';
  }
  function segLegend(c){return SEG_ORDER.filter(function(k){return c[k];}).map(function(k){return '<span class="tv-leg g-'+k+'"><i></i>'+SEG_LABEL[k]+' <b>'+c[k]+'</b></span>';}).join("");}
  function render(el){
    if(!window.SSMPDRoles.canModuleAction(window.SSMPDAuth.currentAdmin,"tasks","view")){el.innerHTML="<p>ليس لديك صلاحية عرض المهام.</p>";return;}
    var admin=window.SSMPDAuth.currentAdmin;
    var isAdmin=allManager(admin);
    var state={projects:[],tasks:[],people:[],notifications:[],archived:{},modal:"",error:"",filter:"all",view:(["board","calendar"].indexOf(store("view"))>=0?store("view"):"list"),checkCounts:{},checklist:[],checkTask:"",calMonth:(function(){var d=new Date();return new Date(d.getFullYear(),d.getMonth(),1);})(),sort:(["smart","manual","due","priority","updated"].indexOf(store("sort"))>=0?store("sort"):(isAdmin?"smart":"manual")),q:"",fProject:"",fAssignee:"",showArchived:false,tab:(isAdmin?(["projects","tasks","done","comments","team"].indexOf(store("tab"))>=0?store("tab"):"projects"):"mine"),openProject:"",pFilter:"all",expanded:{},membersOpen:{},note:null,deleteTarget:null,viewId:"",historyTask:"",history:[],historyAtts:{},pendingFiles:[],notice:""};
    var work=window.SSMPDTaskWork.create({el:el,admin:admin,getTask:function(id){return state.tasks.find(function(t){return t.id===id;});},onRedraw:function(){draw();},onSaved:function(message){state.notice=message;state.modal="";return refresh();}});
    function refresh(){return window.SSMPDDb.taskRefreshOverdue().catch(function(){return 0;}).then(function(){return Promise.all([
      window.SSMPDDb.taskListProjects(),window.SSMPDDb.taskListVisible(),window.SSMPDDb.taskPeople(),
      window.SSMPDDb.taskListNotifications(),
      window.SSMPDDb.taskProjectArchives?window.SSMPDDb.taskProjectArchives().catch(function(){return [];}):Promise.resolve([])
    ]);}).then(function(v){state.projects=v[0]||[];state.tasks=v[1]||[];state.people=v[2]||[];state.notifications=v[3]||[];state.archived={};(v[4]||[]).forEach(function(r){if(r.archived_at)state.archived[r.id]=true;});state.error="";return loadCounts().then(function(){if(!state.modal&&!typing())draw();});}).catch(function(e){var raw=e&&e.message||"تعذر تحميل المهام";
      state.error=/schema cache|could not find function/i.test(raw)
        ?"دوال المهام غير ظاهرة بعد في Supabase. نفّذ في SQL Editor: NOTIFY pgrst, 'reload schema'; ثم حدّث الصفحة."
        :raw;if(!state.modal)draw();});}
    function loadCounts(){var db=window.SSMPDDb;if(!db.taskChecklistCounts||!state.tasks.length)return Promise.resolve();return db.taskChecklistCounts(state.tasks.map(function(t){return t.id;})).then(function(c){state.checkCounts=c||{};window.__tskCounts=state.checkCounts;}).catch(function(){});}
    function typing(){var a=document.activeElement;return !!(a&&el.contains(a)&&a.matches&&a.matches("[data-search]"));}
    function baseTasks(){return state.showArchived?state.tasks:state.tasks.filter(function(t){return !state.archived[t.project_id];});}
    function matches(t){
      if(state.fProject&&t.project_id!==state.fProject)return false;
      if(state.fAssignee&&(t.assignee_id||"")!==state.fAssignee)return false;
      if(state.q){var hay=norm([t.title,t.description,t.assignee_name,t.project_title,t.expected_output].join(" "));if(hay.indexOf(norm(state.q))<0)return false;}
      return true;
    }
    function projectOf(t){return state.projects.find(function(x){return x.id===t.project_id;})||{};}
    function cardFor(t,sub,opts){return taskRow(t,sub,Object.assign({showProject:true},opts||{}));}
    function newComments(taskId){return state.notifications.filter(function(n){return !n.read_at&&n.kind==="comment"&&n.task_id===taskId;}).length;}
    function newCommentsIn(list){return list.reduce(function(a,t){return a+newComments(t.id);},0);}
    function commentsTabHtml(){
      var rows=state.notifications.filter(function(n){return n.kind==="comment";});
      if(!rows.length)return '<section class="tv-body"><div class="tsk-empty tsk-empty-rich"><div class="tsk-empty-icon">💬</div><h3>مفيش تعليقات لسه</h3><p>التعليقات الجديدة على مهامك هتظهر هنا، وتقدر تفتح المهمة من نفس المكان.</p></div></section>';
      return '<section class="tv-body"><div class="tv-comments">'+rows.map(function(n){var t=state.tasks.find(function(x){return x.id===n.task_id;});return '<button type="button" class="tv-comment'+(n.read_at?"":" new")+'" data-action="read-notice" data-id="'+n.id+'"><span class="tv-comment-ic">💬</span><span class="tv-comment-tx"><b>'+esc(t?t.title:String(n.message||"").replace(/^تعليق جديد على المهمة: /,""))+'</b><small>'+esc(t&&t.project_title?t.project_title+" · ":"")+esc(stamp(n.created_at))+'</small></span>'+(n.read_at?"":'<em class="tv-new">جديد</em>')+'</button>';}).join("")+'</div></section>';
    }
    function taskRow(t,sub,opts){
      opts=opts||{};
      var late=isOverdue(t),n=daysLeft(t),note=dueNote(t).replace(/^ · /,""),cc=state.checkCounts[t.id],meta=[],k=seg(t);
      if(opts.showProject)meta.push('<span class="tv-chip proj">'+esc(t.project_title||projectOf(t).title||"مشروع")+'</span>');
      meta.push('<span class="tv-chip">'+esc(t.assignee_name||"بدون مسؤول")+'</span>');
      if(t.assigner_name)meta.push('<span class="tv-chip">أسندها: '+esc(t.assigner_name)+'</span>');
      if(t.due_at&&t.status!=="done")meta.push('<span class="tv-chip due'+(late?" late":(n!==null&&n<=1?" soon":""))+'">'+esc(note||date(t.due_at))+'</span>');
      if(t.status==="done")meta.push('<span class="tv-chip ok">✓ '+esc(relTime(t.completed_at||t.updated_at))+'</span>');
      if(t.priority==="urgent"||t.priority==="high")meta.push('<span class="tv-chip prio p-'+t.priority+'">'+PRIORITY[t.priority]+'</span>');
      if(cc&&cc.total)meta.push('<span class="tv-chip">☑ '+cc.done+'/'+cc.total+'</span>');
      if(newComments(t.id))meta.push('<span class="tv-chip new">💬 تعليق جديد</span>');
      return '<div class="tv-row g-'+k+(t.parent_task_id?" is-sub":"")+'" data-task-id="'+t.id+'"><button type="button" class="tv-row-main" data-action="open-task" data-id="'+t.id+'"><span class="tv-dot"></span><span class="tv-row-title">'+esc(t.title)+'</span><span class="tv-row-meta">'+meta.join("")+'</span><span class="tv-pill g-'+k+'">'+esc(late?"متأخرة":(STATUS[t.status]||t.status))+'</span></button>'+(sub?'<button type="button" class="tv-sub" data-action="toggle-sub" data-id="'+t.id+'" aria-expanded="'+(sub.open?"true":"false")+'">'+(sub.open?"▾":"▸")+' '+sub.done+'/'+sub.total+' فرعية</button>':"")+'</div>';
    }
    function taskDetail(t){
      var late=isOverdue(t),may=isAdmin||t.can_manage,pr=projectOf(t),k=seg(t),cc=state.checkCounts[t.id];
      var parent=t.parent_task_id?state.tasks.find(function(x){return x.id===t.parent_task_id;}):null,kids=state.tasks.filter(function(x){return x.parent_task_id===t.id;});
      var h='<div class="tv-detail g-'+k+'"><div class="tv-d-top"><span class="tv-pill g-'+k+'">'+esc(late?"متأخرة":(STATUS[t.status]||t.status))+'</span><span class="tv-crumb">'+esc(pr.title||t.project_title||"مشروع")+(parent?' › <button type="button" class="tv-link" data-action="open-task" data-id="'+parent.id+'">'+esc(parent.title)+'</button>':"")+'</span></div><h2 class="tv-d-title">'+esc(t.title)+'</h2>';
      h+='<div class="tv-facts"><div><small>المسؤول</small><b>'+esc(t.assignee_name||"—")+'</b></div><div><small>موعد التسليم</small><b class="'+(late?"late":"")+'">'+(t.due_at?date(t.due_at):"بدون موعد")+'</b>'+(dueNote(t)&&t.status!=="done"?'<em>'+esc(dueNote(t).replace(/^ · /,""))+'</em>':"")+'</div><div><small>الأولوية</small><b>'+esc(PRIORITY[t.priority]||"عادية")+'</b></div><div><small>آخر تحديث</small><b>'+esc(relTime(t.updated_at)||"—")+'</b></div></div>';
      h+='<div class="tv-facts"><div><small>أسندها للموظف</small><b>'+esc(t.assigner_name||'غير مسجل')+'</b>'+(t.assigned_at?'<em>'+esc(stamp(t.assigned_at))+'</em>':'<em>بيانات الإسناد القديم غير مسجلة</em>')+'</div><div><small>أنشأها</small><b>'+esc(t.creator_name||'غير مسجل')+'</b></div></div>';
      h+='<section class="tv-sec tw-required"><h3>المطلوب منك</h3><p>'+esc(t.description||'راجع المطلوب مع مدير المهمة قبل التسليم.')+'</p><h4>شكل التسليم</h4><p>'+esc(t.expected_output||'اكتب نتيجة شغلك أو أرفق ملفًا أو رابطًا يوضح التنفيذ.')+'</p></section>';
      if(t.recurrence_active)h+='<p class="tv-note">↻ تتكرر كل '+esc(t.recurrence_interval_value)+' '+esc(({day:"يوم",week:"أسبوع",month:"شهر"})[t.recurrence_interval_unit]||"فترة")+'</p>';
      if(kids.length){var ordered=sortTasks(kids,"manual"),current=ordered.find(function(x){return x.status!=="done";}),finished=ordered.filter(function(x){return x.status==="done";});h+='<section class="tv-sec tw-stages"><h3>مراحل المهمة <small>'+finished.length+' من '+kids.length+' معتمدة</small></h3>'+(current?'<p>المرحلة الحالية حسب ترتيب المدير: '+esc(current.title)+'</p>':'<p>كل المراحل معتمدة.</p>')+ordered.filter(function(x){return x.status!=="done";}).map(function(x,i){return '<div class="tw-stage'+(x===current?' current':'')+'"><span>'+ (ordered.indexOf(x)+1) +'</span>'+taskRow(x,null,{})+'</div>';}).join("")+(finished.length?'<details><summary>المراحل المنتهية ('+finished.length+')</summary>'+finished.map(function(x){return taskRow(x,null,{});}).join("")+'</details>':'')+'</section>';}
      h+=work.html(t,kids);
      h+='<div class="tv-tools"><button type="button" class="tv-tool" data-action="checklist" data-id="'+t.id+'"><span>☑ القائمة الصغيرة</span>'+(cc&&cc.total?'<b>'+cc.done+'/'+cc.total+'</b>':"")+'</button><button type="button" class="tv-tool" data-action="history" data-id="'+t.id+'"><span>💬 التعليقات والسجل</span></button></div>';
      var pa=t.assignee_id===admin.id&&t.status!=="review"?"":actionsHtml(t,admin,may),ma=moreActionsHtml(t,admin,may);
      if(pa||ma)h+='<div class="tv-d-actions">'+(pa?'<div class="tv-primary">'+pa+'</div>':"")+(ma?'<div class="tv-more">'+ma+'</div>':"")+'</div>';
      return h+'</div>';
    }
    function miniCard(t){
      var n=daysLeft(t),note=dueNote(t).replace(/^ · /,"");
      return '<button type="button" class="tsk-mini'+(isOverdue(t)?" is-overdue":"")+'" data-action="open-task" data-id="'+t.id+'" data-task-id="'+t.id+'"><b>'+esc(t.title)+'</b>'+
        '<span class="tsk-mini-meta"><span>'+esc(t.assignee_name||"—")+'</span>'+(note?'<span class="tsk-due'+(n!==null&&n<0?" late":"")+'">'+esc(note)+'</span>':"")+'</span>'+
        '<span class="tsk-mini-foot"><span class="tsk-prio p-'+esc(t.priority||"normal")+'">'+esc(PRIORITY[t.priority]||"عادية")+'</span>'+(t.parent_task_id?'<span class="tsk-sub-badge">فرعية</span>':"")+'</span></button>';
    }
    function emptyHtml(kind,canCreate){
      if(kind==="none")return '<div class="tsk-empty tsk-empty-rich"><div class="tsk-empty-icon">✅</div><h3>مفيش مهام لسه</h3><p>ابدأ بإضافة أول مهمة وحدّد مسؤول وموعد، وهتظهر هنا ويتابعها الفريق.</p>'+(canCreate?'<button class="btn btn-primary" data-action="new-task" data-project="'+(state.projects.find(function(p){return p.can_manage&&!state.archived[p.id];})||{}).id+'">+ إضافة مهمة</button>':"")+'</div>';
      return '<div class="tsk-empty tsk-empty-rich"><div class="tsk-empty-icon">🔎</div><h3>مفيش نتائج مطابقة</h3><p>جرّب تغيّر البحث أو الفلاتر.</p><button class="btn" data-action="clear-filters">مسح الفلاتر</button></div>';
    }
    var FILTER_LABEL={all:"الكل",mine:"مهامي",overdue:"متأخرة",soon:"تنتهي قريباً"};
    function poolFor(pool,f){
      if(f==="all")return pool.filter(function(t){return t.status!=="done";});
      if(f==="done")return pool.filter(function(t){return t.status==="done";});
      if(f==="overdue")return pool.filter(isOverdue);
      if(f==="soon")return pool.filter(function(t){var n=daysLeft(t);return n!==null&&n>=0&&n<=2;});
      if(f==="mine")return pool.filter(function(t){return t.assignee_id===admin.id&&t.status!=="done";});
      return pool.filter(function(t){return t.status===f;});
    }
    function doneListHtml(){
      var base=baseTasks(),pool=base.filter(matches).filter(function(t){return t.status==="done";});
      pool.sort(function(a,b){return new Date(b.completed_at||b.updated_at||0)-new Date(a.completed_at||a.updated_at||0);});
      if(!pool.length)return '<div class="tv-empty"><div>✅</div><h3>'+(base.some(function(t){return t.status==="done";})?"مفيش نتائج مطابقة":"لسه مفيش مهام منجزة")+'</h3><p>أول ما حد يخلّص مهمة وتتعتمد هتظهر هنا مجمّعة بالأسبوع.</p></div>';
      var groups=[],idx={},today=dayStart(new Date());
      pool.forEach(function(t){var d=dayStart(new Date(t.completed_at||t.updated_at)),diff=Math.round((today-d)/86400000),label=diff<=0?"النهارده":(diff===1?"أمس":(diff<7?"آخر 7 أيام":(diff<14?"الأسبوع اللي فات":d.toLocaleDateString("ar-EG-u-nu-latn",{month:"long",year:"numeric"}))));if(idx[label]===undefined){idx[label]=groups.length;groups.push({label:label,items:[]});}groups[idx[label]].items.push(t);});
      return '<div class="tv-groups">'+groups.map(function(g){return '<section class="tv-group"><h3>'+esc(g.label)+' <span>'+g.items.length+'</span></h3>'+g.items.map(function(t){return taskRow(t,null,{showProject:true});}).join("")+'</section>';}).join("")+'</div>';
    }
    function listHtml(){
      if(state.tab==="done")return doneListHtml();
      var base=baseTasks(),pool=base.filter(matches),board=state.view==="board";
      var filtering=!!(state.q||state.fProject||state.fAssignee||(!board&&state.filter!=="all"));
      var canMakeTask=window.SSMPDRoles.canModuleAction(admin,"tasks","create")&&state.projects.some(function(p){return p.can_manage&&!state.archived[p.id];});
      var html="";
      if(!board){
        html+='<div class="tsk-chipbar" role="tablist">'+["all","mine","overdue","soon"].concat(Object.keys(STATUS).filter(function(k){return k!=="done";})).map(function(k){var n=k==="all"?pool.filter(function(t){return t.status!=="done";}).length:poolFor(pool,k).length;return '<button type="button" class="tv-fchip'+(state.filter===k?" on":"")+'" data-action="filter" data-id="'+k+'">'+(FILTER_LABEL[k]||STATUS[k])+' <b>'+n+'</b></button>';}).join("")+'</div>';
      }
      var vis=sortTasks(board?pool:poolFor(pool,state.filter),state.sort);
      if(!base.length)return html+emptyHtml("none",canMakeTask);
      if(!vis.length)return html+emptyHtml("filtered",canMakeTask);
      if(state.view==="calendar")return html+calendarHtml(vis);
      if(board){
        return html+'<div class="tsk-board">'+Object.keys(STATUS).map(function(k){var col=vis.filter(function(t){return t.status===k;});return '<section class="tsk-col s-'+k+'"><header><span>'+STATUS[k]+'</span><b>'+col.length+'</b></header><div class="tsk-col-body">'+(col.map(miniCard).join("")||'<p class="tsk-col-empty">لا توجد مهام</p>')+'</div></section>';}).join("")+'</div>';
      }
      var visIds={},kidsOf={};vis.forEach(function(t){visIds[t.id]=true;});
      vis.forEach(function(t){if(t.parent_task_id&&visIds[t.parent_task_id])(kidsOf[t.parent_task_id]=kidsOf[t.parent_task_id]||[]).push(t);});
      var out="";
      vis.filter(function(t){return !(t.parent_task_id&&visIds[t.parent_task_id]);}).forEach(function(t){
        var kids=kidsOf[t.id],open=filtering||!!state.expanded[t.id],sub=null;
        if(kids){var all=base.filter(function(x){return x.parent_task_id===t.id;});sub={total:all.length,done:all.filter(function(x){return x.status==="done";}).length,open:open};}
        out+=cardFor(t,sub);
        if(kids&&open)out+=kids.map(function(k){return cardFor(k);}).join("");
      });
      return html+'<div class="tsk-list">'+out+'</div>';
    }
    function calendarHtml(list){
      var m=state.calMonth,y=m.getFullYear(),mo=m.getMonth(),first=new Date(y,mo,1).getDay(),days=new Date(y,mo+1,0).getDate(),today=dateValue(new Date());
      var byDay={},none=[];list.forEach(function(t){if(!t.due_at){none.push(t);return;}var d=new Date(t.due_at);if(d.getFullYear()===y&&d.getMonth()===mo)(byDay[d.getDate()]=byDay[d.getDate()]||[]).push(t);});
      var names=["أحد","اثنين","ثلاثاء","أربعاء","خميس","جمعة","سبت"],cells="";
      for(var i=0;i<first;i++)cells+='<div class="tsk-cal-cell off"></div>';
      for(var d=1;d<=days;d++){var key=y+"-"+String(mo+1).padStart(2,"0")+"-"+String(d).padStart(2,"0"),ts=byDay[d]||[];
        cells+='<div class="tsk-cal-cell'+(key===today?" today":"")+'"><b>'+d+'</b>'+ts.slice(0,3).map(function(t){return '<button type="button" class="tsk-cal-chip s-'+t.status+(isOverdue(t)?" late":"")+'" data-action="open-task" data-id="'+t.id+'" title="'+esc(t.title)+'">'+esc(t.title)+'</button>';}).join("")+(ts.length>3?'<small>+'+(ts.length-3)+' أخرى</small>':"")+'</div>';}
      return '<div class="tsk-cal"><div class="tsk-cal-head"><button type="button" class="btn" data-action="cal-prev" aria-label="الشهر السابق">›</button><h3>'+m.toLocaleDateString("en-GB",{month:"long",year:"numeric"})+'</h3><button type="button" class="btn" data-action="cal-next" aria-label="الشهر التالي">‹</button><button type="button" class="btn" data-action="cal-today">اليوم</button></div><div class="tsk-cal-grid">'+names.map(function(n){return '<div class="tsk-cal-dow">'+n+'</div>';}).join("")+cells+'</div>'+(none.length?'<p class="tsk-cal-none"><b>بدون موعد ('+none.length+'):</b> '+none.slice(0,8).map(function(t){return '<button type="button" class="tsk-cal-chip" data-action="open-task" data-id="'+t.id+'">'+esc(t.title)+'</button>';}).join(" ")+'</p>':"")+'</div>';
    }
    function drawList(){var host=el.querySelector("[data-list-host]");if(host)host.innerHTML=listHtml();else draw();}
    function toolbarHtml(){
      var base=baseTasks(),seen={},people=[];
      base.forEach(function(t){if(t.assignee_id&&!seen[t.assignee_id]){seen[t.assignee_id]=true;people.push({id:t.assignee_id,name:t.assignee_name||"—"});}});
      people.sort(function(a,b){return String(a.name).localeCompare(String(b.name),"ar");});
      var projs=state.projects.filter(function(p){return state.showArchived||!state.archived[p.id];});
      var sorts={smart:"الأهم أولاً",manual:"ترتيب مدير المشروع",due:"الأقرب موعداً",priority:"الأعلى أولوية",updated:"آخر تحديث"};
      return '<div class="tsk-toolbar"><input type="search" class="tsk-search" data-search placeholder="ابحث باسم المهمة أو المسؤول أو المشروع…" value="'+esc(state.q)+'" aria-label="بحث في المهام">'+
        '<select data-sel="project" aria-label="المشروع"><option value="">كل المشاريع</option>'+projs.map(function(p){return '<option value="'+p.id+'" '+(state.fProject===p.id?"selected":"")+'>'+esc(p.title)+'</option>';}).join("")+'</select>'+
        (people.length>1?'<select data-sel="assignee" aria-label="المسؤول"><option value="">كل المسؤولين</option>'+people.map(function(p){return '<option value="'+p.id+'" '+(state.fAssignee===p.id?"selected":"")+'>'+esc(p.name)+'</option>';}).join("")+'</select>':"")+
        (state.tab==="done"?"":'<select data-sel="sort" aria-label="الترتيب">'+Object.keys(sorts).map(function(k){return '<option value="'+k+'" '+(state.sort===k?"selected":"")+'>'+sorts[k]+'</option>';}).join("")+'</select>'+
        '<div class="tsk-viewtoggle" role="group" aria-label="طريقة العرض"><button type="button" data-action="view" data-id="list" class="'+(state.view==="list"?"on":"")+'">قائمة</button><button type="button" data-action="view" data-id="board" class="'+(state.view==="board"?"on":"")+'">لوحة</button><button type="button" data-action="view" data-id="calendar" class="'+(state.view==="calendar"?"on":"")+'">تقويم</button></div>')+'</div>';
    }
    function projTasks(p){return state.tasks.filter(function(t){return t.project_id===p.id;});}
    function projectTile(p){
      var m=state.people.find(function(x){return x.id===p.manager_id;}),mine=projTasks(p),c=segCounts(mine),total=mine.length,done=c.done,left=total-done,archived=!!state.archived[p.id];
      var open=mine.filter(function(t){return t.status!=="done"&&t.due_at;}).sort(function(a,b){return dueTime(a)-dueTime(b);})[0];
      var last=mine.reduce(function(mx,t){return Math.max(mx,new Date(t.updated_at||0).getTime());},0);
      var health=!total?["none","بدون مهام"]:(c.late?["late",c.late+" متأخرة"]:(done===total?["done","مكتمل"]:(c.review?["review","بانتظار مراجعة"]:(c.active?["active","شغّال"]:["idle","لم يبدأ"]))));
      var members=(p.members||[]).slice(0,4).map(function(x){return '<span class="tv-av" title="'+esc(x.name)+'">'+esc(initials(x.name))+'</span>';}).join("")+((p.members||[]).length>4?'<span class="tv-av more">+'+((p.members||[]).length-4)+'</span>':"");
      return '<article class="tv-proj'+(archived?" is-archived":"")+'" role="button" tabindex="0" data-action="open-project" data-project="'+p.id+'" data-project-id="'+p.id+'"><div class="tv-proj-top"><span class="tv-logo">'+esc(String(p.title||"م").trim().charAt(0))+'</span><div class="tv-proj-name"><b>'+esc(p.title)+(archived?' <em class="tv-arch">مؤرشف</em>':"")+'</b><small>'+esc(m?m.name:"—")+'</small></div><span class="tv-health h-'+health[0]+'">'+esc(health[1])+'</span></div>'+(newCommentsIn(mine)?'<div class="tv-newline">💬 '+newCommentsIn(mine)+' تعليق جديد</div>':"")+
        (p.description?'<p class="tv-proj-desc">'+esc(p.description)+'</p>':"")+
        '<div class="tv-proj-num"><b>'+done+'</b><span>من '+total+' مهمة تمت</span><em>'+(total?Math.round(done*100/total):0)+'%</em></div>'+segBar(c,total)+'<div class="tv-legend">'+segLegend(c)+'</div>'+
        '<div class="tv-proj-next">'+(!total?"أضف أول مهمة للمشروع":(left?'المتبقي <b>'+left+'</b>'+(open?' · الأقرب: '+esc(open.title)+' <em class="'+(isOverdue(open)?"late":"")+'">'+esc(dueNote(open).replace(/^ · /,""))+'</em>':""):"كل المهام تمت ✓"))+'</div>'+
        '<div class="tv-proj-foot"><span class="tv-avs">'+members+'</span><small>'+(last?"آخر نشاط "+esc(relTime(last)):"")+'</small></div></article>';
    }
    function projectPage(p){
      var m=state.people.find(function(x){return x.id===p.manager_id;}),mine=projTasks(p),c=segCounts(mine),total=mine.length,done=c.done,archived=!!state.archived[p.id];
      var canUpdate=window.SSMPDRoles.canModuleAction(admin,"tasks","update"),canAdd=window.SSMPDRoles.canModuleAction(admin,"tasks","create");
      var roots=sortTasks(mine.filter(function(t){return !t.parent_task_id;}),"manual"),f=state.pFilter;
      function kidsOf(t){return mine.filter(function(x){return x.parent_task_id===t.id;});}
      function rowWithKids(t){var kids=kidsOf(t),sub=kids.length?{total:kids.length,done:kids.filter(function(x){return x.status==="done";}).length,open:!!state.expanded[t.id]}:null;return taskRow(t,sub,{})+(sub&&sub.open?'<div class="tv-kids">'+sortTasks(kids,"manual").map(function(k){return taskRow(k,null,{});}).join("")+'</div>':"");}
      function rootSeg(t){return seg(t);}
      var body="";
      if(!total)body='<div class="tv-empty"><div>🗂️</div><h3>المشروع لسه فاضي</h3><p>ابدأ بإضافة أول مهمة وحدّد مسؤول وموعد.</p>'+(p.can_manage&&canAdd&&!archived?'<button class="btn btn-primary" data-action="new-task" data-project="'+p.id+'">+ مهمة</button>':"")+'</div>';
      else if(f!=="all"){
        var list=roots.filter(function(t){return rootSeg(t)===f||kidsOf(t).some(function(k){return seg(k)===f;});});
        body=list.length?'<div class="tv-list">'+list.map(rowWithKids).join("")+'</div>':'<div class="tv-empty"><h3>مفيش مهام بالحالة دي</h3></div>';
      }else{
        var order=[["review","بانتظار المراجعة"],["late","متأخرة"],["active","شغّالة دلوقتي"],["blocked","متوقفة"],["todo","لم تبدأ"]];
        order.forEach(function(g){var items=roots.filter(function(t){return rootSeg(t)===g[0];});if(items.length)body+='<section class="tv-group g-'+g[0]+'"><h3>'+g[1]+' <span>'+items.length+'</span></h3><div class="tv-list">'+items.map(rowWithKids).join("")+'</div></section>';});
        var dn=roots.filter(function(t){return rootSeg(t)==="done";});
        if(dn.length)body+='<details class="tv-group g-done tv-done"><summary>المكتملة <span>'+dn.length+'</span></summary><div class="tv-list">'+dn.sort(function(a,b){return new Date(b.updated_at||0)-new Date(a.updated_at||0);}).map(rowWithKids).join("")+'</div></details>';
      }
      var memberList=p.members||[],membersOpen=!!state.membersOpen[p.id],shown=membersOpen?memberList:memberList.slice(0,4);
      var chips=shown.map(function(x){return '<span class="tv-chip">'+esc(x.name)+' <small>'+esc({manager:"مدير مشارك",contributor:"منفذ",reviewer:"مراجع"}[x.role]||"عضو")+'</small></span>';}).join("")+(memberList.length>4?'<button type="button" class="tv-chip more" data-action="members" data-project="'+p.id+'">'+(membersOpen?"إخفاء":"+"+(memberList.length-4)+" آخرين")+'</button>':"");
      return '<div class="tv-page"><div class="tv-page-bar"><button type="button" class="tv-back" data-action="back-projects">› كل المشاريع</button><div class="tv-bar-actions">'+(p.can_manage&&canAdd&&!archived?'<button class="btn btn-primary" data-action="new-task" data-project="'+p.id+'">+ مهمة</button>':"")+(p.can_manage&&canUpdate&&!archived?'<button class="btn btn-quiet" data-action="edit-project" data-project="'+p.id+'">تعديل</button>':"")+(p.can_manage&&canUpdate?'<button class="btn btn-quiet" data-action="archive-project" data-project="'+p.id+'" data-state="'+(archived?"off":"on")+'">'+(archived?"إلغاء الأرشفة":"أرشفة")+'</button>':"")+(p.can_manage?'<button class="btn btn-quiet tv-danger" data-action="delete-project" data-project="'+p.id+'">حذف</button>':"")+'</div></div>'+
        '<header class="tv-ph"><span class="tv-logo lg">'+esc(String(p.title||"م").trim().charAt(0))+'</span><div class="tv-ph-name"><h2>'+esc(p.title)+(archived?' <em class="tv-arch">مؤرشف</em>':"")+'</h2><p>مدير المشروع: '+esc(m?m.name:"—")+'</p></div><div class="tv-bigpct"><b>'+(total?Math.round(done*100/total):0)+'%</b><small>'+done+' من '+total+' تمت · المتبقي '+(total-done)+'</small></div></header>'+
        (p.description?'<p class="tv-ph-desc">'+esc(p.description)+'</p>':"")+
        '<div class="tv-chips">'+(chips||'<span class="tv-chip muted">بدون فريق</span>')+'</div>'+segBar(c,total)+
        '<div class="tv-filters"><button type="button" class="tv-fchip'+(f==="all"?" on":"")+'" data-action="pf" data-id="all">الكل <b>'+total+'</b></button>'+SEG_ORDER.filter(function(k){return c[k];}).map(function(k){return '<button type="button" class="tv-fchip g-'+k+(f===k?" on":"")+'" data-action="pf" data-id="'+k+'">'+SEG_LABEL[k]+' <b>'+c[k]+'</b></button>';}).join("")+'</div>'+body+'</div>';
    }
    function projectsHome(){
      var archivedCount=state.projects.filter(function(p){return state.archived[p.id];}).length;
      var shown=state.projects.filter(function(p){return state.showArchived||!state.archived[p.id];});
      var canCreate=window.SSMPDRoles.canModuleAction(admin,"tasks","create")&&(isAdmin||window.SSMPDRoles.isControlledFinance(admin));
      if(!state.projects.length)return '<div class="tv-empty"><div>🗂️</div><h3>مفيش مشاريع لسه</h3><p>المشروع أو خطة العمل هي اللي بتتجمّع تحتها المهام ويتابعها فريق محدد.</p>'+(canCreate?'<button class="btn btn-primary" data-action="new-project">+ مشروع / خطة عمل</button>':"")+'</div>';
      var sorted=shown.slice().sort(function(a,b){var la=Math.max.apply(null,[0].concat(projTasks(a).map(function(t){return new Date(t.updated_at||0).getTime();}))),lb=Math.max.apply(null,[0].concat(projTasks(b).map(function(t){return new Date(t.updated_at||0).getTime();})));return lb-la;});
      return (archivedCount?'<div class="tv-sub-actions"><button class="btn btn-quiet" data-action="toggle-archived">'+(state.showArchived?"إخفاء المؤرشفة":"عرض المؤرشفة ("+archivedCount+")")+'</button></div>':"")+'<div class="tv-grid">'+(sorted.map(projectTile).join("")||'<div class="tv-empty"><div>🗂️</div><h3>كل المشاريع مؤرشفة</h3><p>اضغط "عرض المؤرشفة" لو عايز تشوفها.</p></div>')+'</div>';
    }
    function needsStrip(base,unread){
      var mgr=isAdmin||base.some(function(t){return t.can_manage;});
      var mineOpen=base.filter(function(t){return t.assignee_id===admin.id&&t.status!=="done";});
      var items=[];
      if(mgr)items.push(["review","بانتظار مراجعتك",base.filter(function(t){return t.status==="review"&&(isAdmin||t.can_manage);}).length]);
      items.push(["mine","مهامي المفتوحة",mineOpen.length]);
      items.push(["overdue","متأخرة",base.filter(isOverdue).length]);
      items.push(["soon","تنتهي خلال يومين",poolFor(base,"soon").length]);
      items.push(["notices","إشعارات جديدة",unread]);
      return '<div class="tv-needs" role="group" aria-label="محتاج منك دلوقتي">'+items.map(function(i){return '<button type="button" class="tv-need n-'+i[0]+(i[2]?" has":"")+'" data-action="stat" data-id="'+i[0]+'"><b>'+i[2]+'</b><span>'+i[1]+'</span></button>';}).join("")+'</div>';
    }
    function mineHtml(){
      var own=sortTasks(baseTasks().filter(function(t){return t.assignee_id===admin.id;}),"manual"),mine=own.filter(function(t){return t.status!=="done";}),todo=mine.filter(function(t){return t.status!=="review";}),waiting=mine.filter(function(t){return t.status==="review";});
      function hasOpenParent(t){return todo.some(function(p){return p.id===t.parent_task_id&&p.id!==t.id;});}
      function cards(list,trail){trail=trail||[];return list.filter(function(t){return trail.indexOf(t.id)<0;}).map(function(t){
        var kids=t.status!=="review"&&t.status!=="done"?own.filter(function(k){return k.parent_task_id===t.id&&k.id!==t.id&&trail.indexOf(k.id)<0;}):[],cc=state.checkCounts[t.id],finished=kids.filter(function(k){return k.status==="done";}).length,total=kids.length||(cc&&cc.total)||0,done=kids.length?finished:(cc&&cc.done)||0;
        var progress=total?'<div class="tw-card-progress"><span>'+done+' من '+total+(kids.length?' مهام فرعية معتمدة':' بنود مكتملة')+'</span><progress max="'+total+'" value="'+done+'" aria-label="'+(kids.length?'المهام الفرعية المعتمدة':'بنود القائمة المكتملة')+'"></progress></div>':'';
        var caption=t.status==="review"?"عرض التسليم":"فتح المهمة";
        return '<article class="tw-card s-'+esc(t.status)+(isOverdue(t)?' tw-card-late':'')+'" data-task-id="'+t.id+'"><div class="tw-card-top"><span>'+esc(t.parent_title||t.project_title||projectOf(t).title||"مهمة")+'</span><span class="tv-pill g-'+seg(t)+'">'+esc(isOverdue(t)?"متأخرة":STATUS[t.status])+'</span></div><h2>'+esc(t.title)+'</h2><p class="tw-help">'+esc(t.assigner_name?'أسندها: '+t.assigner_name:t.creator_name?'أنشأها: '+t.creator_name+' · الإسناد القديم غير مسجل':'صاحب الإسناد غير مسجل')+'</p>'+progress+'<div class="tw-card-bottom"><span class="'+(isOverdue(t)?'late':'')+'">'+esc(t.due_at?"التسليم "+date(t.due_at):"بدون موعد")+'</span><button type="button" class="btn btn-primary" data-action="open-task" data-id="'+t.id+'">'+caption+'</button></div>'+(kids.length?'<details class="tw-subtasks" data-task-group="'+esc(t.id)+'" '+(state.expanded['mine:'+t.id]?'open':'')+'><summary>المهام الفرعية <span>'+finished+' من '+kids.length+'</span></summary><div class="tw-subtask-list">'+cards(kids,trail.concat([t.id]))+'</div></details>':'')+'</article>';
      }).join("");}
      var roots=todo.filter(function(t){return !hasOpenParent(t);});
      // A malformed cycle must not make an assigned task disappear.
      if(!roots.length&&todo.length)roots=todo;
      var reviewRoots=waiting.filter(function(t){return !hasOpenParent(t);});
      return '<section class="tv-body"><div class="tw-summary" aria-label="ملخص مهامي"><div><strong>'+todo.length+'</strong><span>مطلوب تنفيذها</span></div><div class="tw-summary-late"><strong>'+todo.filter(isOverdue).length+'</strong><span>متأخرة</span></div><div><strong>'+waiting.length+'</strong><span>بانتظار المراجعة</span></div></div><p class="tw-order">ابدأ من أول مهمة. الترتيب حسب ترتيب المدير ثم موعد التسليم.</p>'+(roots.length?'<div class="tw-cards">'+cards(roots)+'</div>':'<div class="tv-empty"><h3>مفيش شغل مطلوب منك دلوقتي</h3><p>المهام الجديدة هتظهر هنا.</p></div>')+(reviewRoots.length?'<details class="tw-waiting"><summary>بانتظار مراجعة المدير ('+reviewRoots.length+')</summary><div class="tw-cards">'+cards(reviewRoots)+'</div></details>':'')+'</section>';
    }
    function tabsBar(base,shownCount){
      var open=base.filter(function(t){return t.status!=="done";}).length,done=base.filter(function(t){return t.status==="done";}).length;
      var items=[["mine","مهامي",base.filter(function(t){return t.assignee_id===admin.id&&t.status!=="done";}).length],["projects","المشاريع",shownCount],["tasks","كل المهام",open],["done","المنجزة",done],["comments","المناقشة",newCommentsIn(base)||""]];if(isAdmin||base.some(function(t){return t.can_manage;}))items.push(["team","الفريق",""]);
      return '<nav class="tv-tabs" role="tablist">'+items.map(function(i){return '<button type="button" role="tab" class="tv-tab'+(state.tab===i[0]?" on":"")+'" data-action="tab" data-id="'+i[0]+'" aria-selected="'+(state.tab===i[0])+'">'+i[1]+(i[2]!==""?' <b>'+i[2]+'</b>':"")+'</button>';}).join("")+'</nav>';
    }
    function teamTable(base,since){
      var rows={};
      base.forEach(function(t){var key=t.assignee_id||"none";var r=rows[key]||(rows[key]={name:t.assignee_name||"بدون مسؤول",updated:0,done:0,review:0,late:0,open:0});
        if(new Date(t.updated_at)>=since)r.updated++;
        if(t.status==="done"&&new Date(t.updated_at)>=since)r.done++;
        if(t.status==="review")r.review++;
        if(isOverdue(t))r.late++;
        if(t.status!=="done")r.open++;});
      var list=Object.keys(rows).map(function(k){return rows[k];}).sort(function(a,b){return b.late-a.late||b.open-a.open;});
      if(!list.length)return "";
      return '<div class="tsk-team"><table><thead><tr><th>الموظف</th><th>مفتوحة</th><th>تحديثات الأسبوع</th><th>اكتملت</th><th>بانتظار المراجعة</th><th>متأخرة</th></tr></thead><tbody>'+list.map(function(r){return '<tr><td data-label="الموظف"><b>'+esc(r.name)+'</b></td><td data-label="مفتوحة">'+r.open+'</td><td data-label="تحديثات الأسبوع">'+r.updated+'</td><td data-label="اكتملت">'+r.done+'</td><td data-label="بانتظار المراجعة">'+r.review+'</td><td data-label="متأخرة" class="'+(r.late?"late":"")+'">'+r.late+'</td></tr>';}).join("")+'</tbody></table></div>';
    }
    function draw(){
      work.capture();
      var unread=state.notifications.filter(function(n){return !n.read_at;}).length;
      var base=baseTasks();
      var since=new Date(Date.now()-7*86400000);
      var week=base.filter(function(t){return new Date(t.updated_at)>=since;});
      var overdue=base.filter(isOverdue);
      var canCreate=window.SSMPDRoles.canModuleAction(admin,"tasks","create")&&(isAdmin||window.SSMPDRoles.isControlledFinance(admin));
      var pOpts=state.projects.map(function(p){return '<option value="'+p.id+'">'+esc(p.title)+'</option>';}).join("");
      var personOpts=state.people.map(function(p){return '<option value="'+p.id+'">'+esc(p.name||p.email)+'</option>';}).join("");
      var banner=state.error?'<div class="tsk-error">'+esc(state.error)+'</div>':"";
      var shownProjects=state.projects.filter(function(p){return state.showArchived||!state.archived[p.id];});
      var html='<section class="tsk-page tv" dir="rtl"><div class="tv-head"><div><h1>'+(isAdmin?"المهام والمشاريع":"مهامي")+'</h1><p>'+(isAdmin?"تابع التنفيذ وراجع الشغل المسلّم.":"شوف المطلوب منك، كمّل شغلك، وسلّمه للمدير.")+'</p></div><div class="tsk-head-actions"><button class="btn btn-quiet tv-bell" data-action="notifications" aria-label="الإشعارات">🔔'+(unread?' <b class="tsk-badge">'+unread+'</b>':"")+'</button>'+(canCreate?'<button class="btn btn-primary" data-action="new-project">+ مشروع / خطة عمل</button>':"")+'</div></div>'+banner;
      if(state.notice)html+='<div class="tw-success" role="status">'+esc(state.notice)+'</div>';
      html+=(isAdmin?needsStrip(base,unread):"")+tabsBar(base,shownProjects.length);
      if(state.tab==="mine"){html+=mineHtml();}
      else if(state.tab==="projects"){
        var op=state.openProject&&state.projects.find(function(x){return x.id===state.openProject;});
        if(state.openProject&&!op)state.openProject="";
        html+='<section class="tv-body">'+(op?projectPage(op):projectsHome())+'</section>';
      }else if(state.tab==="comments"){
        html+=commentsTabHtml();
      }else if(state.tab==="team"){
        html+='<section class="tv-body tsk-week"><div class="tsk-week-row"><span>المهام التي تم تحديثها <b>'+week.length+'</b></span><span>اكتملت <b>'+week.filter(function(t){return t.status==="done";}).length+'</b></span><span>تحتاج مراجعة <b>'+base.filter(function(t){return t.status==="review";}).length+'</b></span><span>متأخرة <b>'+overdue.length+'</b></span></div>'+teamTable(base,since)+'<h3 class="tsk-sub-title">آخر المهام المحدّثة</h3><div class="tsk-week-list">'+(week.slice().sort(function(a,b){return new Date(b.updated_at)-new Date(a.updated_at);}).slice(0,8).map(function(t){return '<div><span>'+esc(t.title)+'</span><span>'+esc(t.assignee_name||"")+'</span><span>'+esc(STATUS[t.status])+'</span></div>';}).join("")||'<p class="tsk-empty">مفيش تحديثات الأسبوع ده.</p>')+'</div></section>';
      }else{
        html+='<section class="tv-body">'+toolbarHtml()+'<div data-list-host>'+listHtml()+'</div></section>';
      }
      if(state.modal==="confirm-delete"&&state.deleteTarget){
        var dt=state.deleteTarget,kindLabel=dt.kind==="project"?"المشروع":"المهمة";
        html+=modal("تأكيد حذف "+kindLabel,'<div class="tsk-delete-confirm"><p>هل تريد حذف <b>'+esc(dt.title)+'</b>؟</p><p>سيتم حذف '+(dt.kind==="project"?"المشروع وكل المهام والمهام الفرعية التابعة له.":"المهمة وكل المهام الفرعية التابعة لها.")+' وسجل التحديثات المرتبط بها.</p><footer><button class="btn btn-danger" data-action="confirm-delete">نعم، احذف</button><button type="button" class="btn" data-action="close-modal">إلغاء</button></footer></div>');
      }
      if(state.modal==="project"){
        html+=modal("إنشاء مشروع أو خطة عمل",'<form data-form="project"><label>اسم المشروع<input name="title" required maxlength="180"></label><label>وصف الخطة<textarea name="description" rows="3"></textarea></label><label>مدير المشروع<select name="manager_id" required>'+personOpts+'</select></label><div class="tsk-member-picker"><b>أعضاء المشروع وأدوارهم</b>'+state.people.map(function(p){return '<label class="tsk-member"><input type="checkbox" name="member" value="'+p.id+'"><span>'+esc(p.name||p.email)+'</span><select name="role_'+p.id+'"><option value="contributor">عضو منفذ</option><option value="reviewer">مراجع</option><option value="manager">مدير مشارك</option></select></label>';}).join("")+'</div><footer><button class="btn btn-primary">إنشاء المشروع</button><button type="button" class="btn" data-action="close-modal">إلغاء</button></footer></form>');
      }
      if(state.modal==="edit-project"&&state.editProject){
        var ep=state.editProject;
        var editManagerOpts=state.people.map(function(x){return '<option value="'+x.id+'" '+(x.id===ep.manager_id?"selected":"")+'>'+esc(x.name||x.email)+'</option>';}).join("");
        var editMemberFields=state.people.filter(function(x){return x.id!==ep.manager_id;}).map(function(x){
          var member=(ep.members||[]).find(function(m){return m.id===x.id;});
          var role=member&&member.role||"contributor";
          return '<label class="tsk-member"><input type="checkbox" name="member" value="'+x.id+'" '+(member?"checked":"")+'><span>'+esc(x.name||x.email)+'</span><select name="role_'+x.id+'"><option value="contributor" '+(role==="contributor"?"selected":"")+'>عضو منفذ</option><option value="reviewer" '+(role==="reviewer"?"selected":"")+'>مراجع</option><option value="manager" '+(role==="manager"?"selected":"")+'>مدير مشارك</option></select></label>';
        }).join("");
        html+=modal("تعديل المشروع أو خطة العمل",'<form data-form="project-edit"><input type="hidden" name="project_id" value="'+esc(ep.id)+'"><label>اسم المشروع<input name="title" required maxlength="180" value="'+esc(ep.title)+'"></label><label>وصف الخطة<textarea name="description" rows="3">'+esc(ep.description)+'</textarea></label><label>مدير المشروع<select name="manager_id" required>'+editManagerOpts+'</select></label><div class="tsk-member-picker"><b>أعضاء المشروع وأدوارهم</b>'+editMemberFields+'</div><footer><button class="btn btn-primary">حفظ التعديلات</button><button type="button" class="btn" data-action="close-modal">إلغاء</button></footer></form>');
      }
      if(state.modal==="task"){
        var projectId=state.modalProject||"";
        var parentId=state.modalParent||"";
        html+=modal(parentId?"إضافة مهمة فرعية":"إضافة مهمة",'<form data-form="task"><input type="hidden" name="project_id" value="'+esc(projectId)+'"><input type="hidden" name="parent_task_id" value="'+esc(parentId)+'"><label>عنوان المهمة<input name="title" required maxlength="180"></label><label>المطلوب من الموظف<textarea name="description" rows="3" required placeholder="مثال: حددي فئات الجمهور واحتياجات كل فئة للخدمات المسندة إليك"></textarea></label><label>شكل التسليم<textarea name="expected_output" rows="2" required placeholder="مثال: جدول Word أو Excel، لكل فئة الخدمة والاحتياج ومخاوف الجمهور"></textarea></label><label>المسؤول<select name="assignee_id" required>'+personOpts+'</select></label><div class="tsk-form-row"><label>موعد التسليم<input type="date" name="due_at" required></label><label>الأولوية<select name="priority"><option value="normal">عادية</option><option value="low">منخفضة</option><option value="high">عالية</option><option value="urgent">عاجلة</option></select></label></div>'+repeatFields(null)+'<footer><button class="btn btn-primary">إسناد المهمة</button><button type="button" class="btn" data-action="close-modal">إلغاء</button></footer></form>');
      }
      if(state.modal==="edit-task"&&state.editTask){
        var et=state.editTask;
        var editPersonOpts=state.people.map(function(p){return '<option value="'+p.id+'" '+(p.id===et.assignee_id?"selected":"")+'>'+esc(p.name||p.email)+'</option>';}).join("");
        var editPriorityOpts=Object.keys(PRIORITY).map(function(k){return '<option value="'+k+'" '+(et.priority===k?"selected":"")+'>'+PRIORITY[k]+'</option>';}).join("");
        html+=modal("تعديل المهمة",'<form data-form="task-edit"><input type="hidden" name="task_id" value="'+esc(et.id)+'"><label>عنوان المهمة<input name="title" required maxlength="180" value="'+esc(et.title)+'"></label><label>وصف المطلوب<textarea name="description" rows="3">'+esc(et.description)+'</textarea></label><label>النتيجة المتوقعة<textarea name="expected_output" rows="2">'+esc(et.expected_output)+'</textarea></label><label>المسؤول<select name="assignee_id" required>'+editPersonOpts+'</select></label><div class="tsk-form-row"><label>موعد التسليم<input type="date" name="due_at" value="'+dateValue(et.due_at)+'"></label><label>الأولوية<select name="priority">'+editPriorityOpts+'</select></label></div>'+repeatFields(et)+(et.recurrence_id?'<label class="tsk-repeat-toggle"><input type="checkbox" name="update_future" checked><span>تطبيق التعديلات على التكرارات القادمة</span></label>':"")+'<footer><button class="btn btn-primary">حفظ التعديلات</button><button type="button" class="btn" data-action="close-modal">إلغاء</button></footer></form>');
      }
      if(state.modal==="task-view"){var vt=state.tasks.find(function(x){return x.id===state.viewId;});if(vt)html+=modal("تفاصيل المهمة",taskDetail(vt),"tv-wide");}
      if(state.modal==="note"&&state.note){
        var nc=NOTE[state.note.action]||NOTE.progress,nTitle=state.note.action==="progress"&&state.note.starting?nc.start:nc.title;
        html+=modal(nTitle,'<form data-form="note" novalidate><p class="tsk-note-for">'+esc(state.note.subject||"")+'</p>'+
          (nc.confirm?'<p class="tsk-hint">'+esc(nc.hint)+'</p>':"")+
          (nc.noText?"":'<label>'+esc(nc.label)+'<textarea name="note" rows="4" maxlength="2000" '+(nc.confirm?"":'placeholder="'+esc(nc.hint)+'"')+'></textarea></label>')+
          '<p class="tsk-field-error" role="alert" hidden></p><div class="tsk-form-actions"><button type="submit" class="btn btn-primary">'+esc(nc.button)+'</button><button type="button" class="btn" data-action="close-modal">إلغاء</button></div></form>');
      }
      if(state.modal==="notifications"){
        html+=modal("إشعارات المهام",'<div class="tsk-notifications">'+(state.notifications.map(function(n){return '<button class="tsk-notice '+(n.read_at?"":"unread")+'" data-action="read-notice" data-id="'+n.id+'"><b>'+esc(n.message)+'</b><small>'+esc(stamp(n.created_at))+(n.task_id?" · اضغط لفتح المهمة":"")+'</small></button>';}).join("")||'<div class="tsk-empty tsk-empty-rich"><div class="tsk-empty-icon">🔔</div><h3>مفيش إشعارات</h3><p>هتظهر هنا لما حد يحدّث مهمة أو يسند لك مهمة.</p></div>')+'</div>');
      }
      if(state.modal==="checklist"){
        var ct=state.tasks.find(function(x){return x.id===state.checkTask;})||{};
        html+=modal("قائمة مهام صغيرة",(ct.title?'<p class="tsk-note-for">'+esc(ct.title)+'</p>':"")+'<form data-form="check-add" class="tsk-check-add"><input name="body" maxlength="300" placeholder="أضف بند جديد واضغط إضافة" required><button class="btn btn-primary">إضافة</button></form><div class="tsk-checklist">'+((state.checklist||[]).map(function(c){return '<div class="tsk-check-row'+(c.done?" done":"")+'"><label><input type="checkbox" data-check-id="'+c.id+'" '+(c.done?"checked":"")+'> <span>'+esc(c.body)+'</span></label><button type="button" class="btn-link" data-action="check-remove" data-id="'+c.id+'" aria-label="حذف البند">حذف</button></div>';}).join("")||'<p class="tsk-empty">مفيش بنود لسه. قسّم المهمة لخطوات صغيرة وعلّم عليها وانت بتخلصها.</p>')+'</div>');
      }
      if(state.modal==="history"){
        var ht=state.tasks.find(function(x){return x.id===state.historyTask;})||{};
        html+=modal("التعليقات وسجل التحديثات",(ht.title?'<p class="tsk-note-for">'+esc(ht.title)+'</p>':"")+
          '<form data-form="comment" class="tsk-comment-form"><textarea name="comment" rows="3" maxlength="5000" placeholder="اكتب تعليق، أو الصق رابط ملف (Drive مثلاً)…"></textarea>'+recipientsHtml(ht)+'<div class="tsk-file-list" data-file-list></div><p class="tsk-field-error" role="alert" hidden></p><div class="tsk-form-actions"><label class="btn tsk-file-btn">📎 إرفاق ملفات<input type="file" multiple data-comment-files accept=".png,.jpg,.jpeg,.webp,.gif,.pdf,.txt,.csv,.doc,.docx,.xls,.xlsx,.ppt,.pptx"></label><button class="btn btn-primary" type="submit">إرسال التعليق</button></div><p class="tsk-hint">حتى 10 ملفات، كل ملف لحد 10 ميجا (صور، PDF، Word، Excel، PowerPoint، نص). الملفات بتتحفظ على Google Drive.</p></form>'+
          '<div class="tsk-history">'+((state.history||[]).map(function(u){var toName=u.addressed_to?personName(u.addressed_to):"";return '<article><div class="tsk-update-meta"><b>'+esc(u.author_name||"عضو الفريق")+'</b>'+(toName?'<span class="tsk-to-tag'+(u.author_id===CLAUDE_ID?" reply":"")+'">'+esc((u.author_id===CLAUDE_ID?"رد على ":"إلى: ")+toName)+'</span>':"")+'<small>'+esc(stamp(u.created_at))+'</small>'+(u.status_to?'<span class="tsk-hist-status">'+esc((STATUS[u.status_from]||"")+(u.status_from?" ← ":"")+(STATUS[u.status_to]||u.status_to))+'</span>':"")+'</div>'+bodyHtml(u.body)+attsHtml(u.id)+'</article>';}).join("")||'<p class="tsk-empty">لا توجد تعليقات أو تحديثات بعد.</p>')+'</div>');
      }
      el.innerHTML=html;
      el.querySelectorAll(".tw-subtasks").forEach(function(group){group.ontoggle=function(){if(group.isConnected)state.expanded["mine:"+group.dataset.taskGroup]=group.open;};});
      el.querySelectorAll('form[data-form="task"],form[data-form="task-edit"]').forEach(syncRepeat);
      var timingHost=el.querySelector('.tv-detail');
      if(timingHost&&state.viewId)work.mount(state.viewId);
      if(timingHost&&state.viewId&&window.SSMPDIndicatorReports)window.SSMPDIndicatorReports.taskContext(timingHost,state.viewId);
    }
    function stamp(v){var d=new Date(v);return isNaN(d)?"":d.toLocaleString("ar-EG-u-nu-latn",{day:"numeric",month:"short",hour:"2-digit",minute:"2-digit"});}
    function attsHtml(updateId){
      var list=state.historyAtts[updateId];if(!list||!list.length)return "";
      function dl(u){var m=/\/d\/([\w-]+)/.exec(u||"")||/[?&]id=([\w-]+)/.exec(u||"");return m?"https://drive.google.com/uc?export=download&id="+m[1]:"";}
      return '<div class="tsk-atts">'+list.map(function(a){var ok=/^https:\/\/(drive|docs)\.google\.com\//.test(a.file_url||""),d=ok?dl(a.file_url):"";return '<span class="tsk-att-wrap"><a class="tsk-att" href="'+esc(ok?a.file_url:"#")+'" target="_blank" rel="noopener noreferrer">📎 '+esc(a.file_name)+(a.size_bytes?' <small>'+esc(fileSize(a.size_bytes))+'</small>':"")+'</a>'+(d?'<a class="tsk-att-dl" href="'+esc(d)+'" target="_blank" rel="noopener noreferrer" download title="تحميل" aria-label="تحميل '+esc(a.file_name)+'">⬇</a>':"")+'</span>';}).join("")+'</div>';
    }
    function renderFiles(){
      var box=el.querySelector("[data-file-list]");if(!box)return;
      box.innerHTML=state.pendingFiles.map(function(f,i){return '<span class="tsk-file-chip">📎 '+esc(f.name)+' <small>'+esc(fileSize(f.size))+'</small><button type="button" data-action="remove-file" data-id="'+i+'" aria-label="إزالة الملف">×</button></span>';}).join("");
    }
    function addFiles(input){
      var form=input.closest("form"),err=form&&form.querySelector(".tsk-field-error"),problem="";
      Array.prototype.slice.call(input.files||[]).forEach(function(f){
        var ext=(String(f.name).match(/\.([A-Za-z0-9]+)$/)||[])[1];
        if(!ext||FILE_EXT.indexOf(ext.toLowerCase())<0){problem="نوع الملف \""+f.name+"\" غير مسموح. المسموح: صور، PDF، Word، Excel، PowerPoint، نص.";return;}
        if(f.size>MAX_BYTES){problem="الملف \""+f.name+"\" أكبر من 10 ميجا.";return;}
        if(state.pendingFiles.length>=MAX_FILES){problem="الحد الأقصى "+MAX_FILES+" ملفات في التعليق.";return;}
        state.pendingFiles.push(f);
      });
      input.value="";
      if(err){err.textContent=problem;err.hidden=!problem;}
      renderFiles();
    }
    function showErr(form,msg){var p=form.querySelector(".tsk-field-error");if(p){p.textContent=msg;p.hidden=false;}}
    function reloadChecklist(){return window.SSMPDDb.taskChecklistList(state.checkTask).then(function(rows){state.checklist=rows||[];var done=state.checklist.filter(function(c){return c.done;}).length;state.checkCounts[state.checkTask]={total:state.checklist.length,done:done};window.__tskCounts=state.checkCounts;draw();});}
    function openChecklist(id){state.checkTask=id;state.checklist=[];state.modal="checklist";draw();reloadChecklist().catch(function(e){state.modal="";state.error=e&&e.message||"تعذر تحميل القائمة";draw();});}
    function personName(id){if(id===CLAUDE_ID)return "Claude";var p=state.people.find(function(x){return x.id===id;});return p?(p.name||p.email||"عضو الفريق"):"عضو الفريق";}
    // التعليق لمين: الكل / Claude (لمدير المشروع) / المسؤول / مدير المشروع / شخص تاني
    function recipientsHtml(t){var me=(window.SSMPDAuth.currentAdmin||{}).id,seen={},chips=[];
      function add(id,label){if(!id||id===me||seen[id])return;seen[id]=1;chips.push('<label class="tsk-to-chip"><input type="radio" name="to" value="'+esc(id)+'"><span>'+esc(label)+'</span></label>');}
      if(t.can_manage)add(CLAUDE_ID,"🤖 Claude");
      if(t.assignee_id&&t.assignee_id!==CLAUDE_ID)add(t.assignee_id,personName(t.assignee_id)+" (المسؤول)");
      if(t.project_manager_id)add(t.project_manager_id,personName(t.project_manager_id)+" (مدير المشروع)");
      var others=state.people.filter(function(p){return p.id!==me&&!seen[p.id];});
      return '<div class="tsk-to"><b>التعليق لـ:</b><label class="tsk-to-chip"><input type="radio" name="to" value="" checked><span>الكل</span></label>'+chips.join("")+
        (others.length?'<label class="tsk-to-chip"><input type="radio" name="to" value="other"><span>شخص تاني</span></label><select name="to_other" hidden>'+others.map(function(p){return '<option value="'+esc(p.id)+'">'+esc(p.name||p.email)+'</option>';}).join("")+'</select>':"")+
        '</div><p class="tsk-to-hint" data-to-hint hidden>Claude هيقرا تعليقك وينفّذه على المهمة دي في أول تشغيل (خلال ساعة تقريبًا)، ويرد عليك هنا بالنتيجة.</p>';}
    function openHistory(id){
      var rows;
      Promise.all([window.SSMPDDb.taskListUpdates(id),window.SSMPDDb.taskListAttachments?window.SSMPDDb.taskListAttachments(id).catch(function(){return [];}):Promise.resolve([])]).then(function(v){
        rows=v[0]||[];rows.forEach(function(x){var p=state.people.find(function(y){return y.id===x.author_id;});x.author_name=p&&(p.name||p.email);});
        state.historyAtts={};(v[1]||[]).forEach(function(a){(state.historyAtts[a.update_id]=state.historyAtts[a.update_id]||[]).push(a);});
        if(state.historyTask!==id)state.pendingFiles=[];
        state.history=rows;state.historyTask=id;state.modal="history";draw();renderFiles();
      }).catch(function(e){state.error=e&&e.message||"تعذر تحميل السجل";state.modal="";draw();});
    }
    function moveTask(task,direction){
      if(!task.can_manage)return;
      var peers=sortTasks(state.tasks.filter(function(x){return x.project_id===task.project_id&&x.parent_task_id===task.parent_task_id;}),"manual");
      var at=peers.findIndex(function(x){return x.id===task.id;}),to=at+(direction==="up"?-1:1);
      if(at<0||to<0||to>=peers.length)return;
      var moved=peers.splice(at,1)[0];peers.splice(to,0,moved);
      window.SSMPDDb.taskSetOrder(peers.map(function(x){return x.id;})).then(refresh).catch(function(e){state.error=e.message||"تعذر حفظ ترتيب المهام";draw();});
    }
    function focusTask(id){
      if(work.busy())return false;
      var t=state.tasks.find(function(x){return x.id===id;});if(!t)return;
      state.tab="projects";store("tab","projects");state.openProject=t.project_id;state.pFilter="all";
      if(state.archived[t.project_id])state.showArchived=true;
      if(t.parent_task_id)state.expanded[t.parent_task_id]=true;
      state.viewId=id;state.modal="task-view";draw();return true;
    }
    currentFocus=focusTask;
    function submitNote(form,fd){
      var n=state.note;if(!n)return;
      var cfg=NOTE[n.action]||NOTE.progress,text=String(fd.get("note")||"").trim();
      if(cfg.required&&!text){showErr(form,n.action==="return"?"اكتب سبب الإرجاع حتى يعرف الموظف ما المطلوب.":"اكتب الملاحظة قبل المتابعة.");var ta=form.querySelector("textarea");if(ta)ta.focus();return;}
      var btn=form.querySelector("button[type=submit]");if(btn)btn.disabled=true;
      var db=window.SSMPDDb,call;
      if(n.action==="archive"||n.action==="unarchive")call=db.taskSetProjectArchived(n.id,n.action==="archive");
      else if(n.action==="approve"||n.action==="return")call=db.taskReview(n.id,n.action==="approve",text);
      else call=db.taskSetStatus(n.id,n.action==="blocked"?"blocked":(n.action==="submit"?"review":"in_progress"),text);
      call.then(function(){state.modal="";state.note=null;return refresh();}).catch(function(e){if(btn)btn.disabled=false;showErr(form,e&&e.message||"تعذر الحفظ");});
    }
    function submitComment(form,fd){
      var text=String(fd.get("comment")||"").trim(),files=state.pendingFiles.slice();
      if(!text&&!files.length){showErr(form,"اكتب التعليق أو أرفق ملفاً أولاً.");return;}
      if(!text&&fd.get("to")===CLAUDE_ID){showErr(form,"اكتب لـ Claude المطلوب منه.");return;}
      var btn=form.querySelector("button[type=submit]");if(btn){btn.disabled=true;if(files.length)btn.textContent="بيرفع الملفات…";}
      var db=window.SSMPDDb,taskId=state.historyTask;
      Promise.all(files.map(function(f){return db.taskUploadAttachment(taskId,f,(state.tasks.find(function(x){return x.id===taskId;})||{}).title);})).then(function(atts){var to=fd.get("to")||"";if(to==="other")to=fd.get("to_other")||"";return db.taskAddComment(taskId,text,atts,to||null);}).then(function(){state.pendingFiles=[];openHistory(taskId);}).catch(function(e){if(btn){btn.disabled=false;btn.textContent="إرسال التعليق";}showErr(form,e&&e.message||"تعذر إرسال التعليق");});
    }
    function onEscape(ev){if(!el.isConnected){document.removeEventListener("keydown",onEscape);return;}if(ev.key==="Escape"&&state.modal){if(work.busy())return;work.capture();state.modal="";state.note=null;state.pendingFiles=[];draw();}}
    document.addEventListener("keydown",onEscape);
    el.onkeydown=function(ev){var tile=ev.target.closest&&ev.target.closest(".tv-proj");if(tile&&ev.target===tile&&(ev.key==="Enter"||ev.key===" ")){ev.preventDefault();tile.click();}};
    el.oninput=function(ev){if(ev.target.matches&&ev.target.matches('[name="repeat_until"]'))syncRepeat(ev.target.closest("form"));if(ev.target.matches&&ev.target.matches("[data-search]")){state.q=ev.target.value;drawList();}};
    el.onclick=function(ev){
      var b=ev.target.closest("[data-action]");if(!b)return;if(work.busy())return;
      if(b.dataset.action==="close-modal"&&ev.target!==b&&ev.target.closest(".tsk-modal"))return;
      var action=b.dataset.action,id=b.dataset.id,t=state.tasks.find(function(x){return x.id===id;});
      if(action==="close-modal"){if(work.busy())return;work.capture();state.modal="";state.note=null;state.pendingFiles=[];draw();return;}
      if(action==="confirm-delete"&&state.deleteTarget){
        var target=state.deleteTarget,call=target.kind==="project"?window.SSMPDDb.taskDeleteProject(target.id):window.SSMPDDb.taskDelete(target.id);
        b.disabled=true;call.then(function(){state.modal="";state.deleteTarget=null;return refresh();}).catch(function(e){b.disabled=false;state.error=e.message||"تعذر الحذف";draw();});return;
      }
      if(action==="filter"){state.filter=id;drawList();return;}
      if(action==="stat"){
        if(id==="notices"){state.modal="notifications";draw();return;}
        state.tab="tasks";store("tab","tasks");state.view="list";state.q="";state.fProject="";state.fAssignee="";state.filter=id;
        draw();var host=el.querySelector("[data-list-host]");if(host&&host.scrollIntoView)host.scrollIntoView({behavior:"smooth",block:"start"});return;
      }
      if(action==="tab"){state.tab=id;store("tab",id);if(id==="projects")state.openProject="";state.q="";state.fProject="";state.fAssignee="";draw();return;}
      if(action==="open-project"){state.openProject=b.dataset.project;state.pFilter="all";draw();if(el.scrollIntoView)el.scrollIntoView({block:"start"});return;}
      if(action==="back-projects"){state.openProject="";draw();return;}
      if(action==="pf"){state.pFilter=id;draw();return;}
      if(action==="members"){state.membersOpen[b.dataset.project]=!state.membersOpen[b.dataset.project];draw();return;}
      if(action==="view"){state.view=id==="board"||id==="calendar"?id:"list";store("view",state.view);draw();return;}
      if(action==="clear-filters"){state.q="";state.fProject="";state.fAssignee="";state.filter="all";draw();return;}
      if(action==="toggle-sub"){state.expanded[id]=!state.expanded[id];draw();return;}
      if(action==="open-task"&&t){state.viewId=id;state.modal="task-view";draw();return;}
      if(action==="move-task"&&t){moveTask(t,b.dataset.direction);return;}
      if(action==="delete-task"&&t){state.deleteTarget={kind:"task",id:t.id,title:t.title,children:state.tasks.filter(function(x){return x.parent_task_id===t.id;}).length};state.modal="confirm-delete";draw();return;}
      if(action==="delete-project"){var dp=state.projects.find(function(x){return x.id===b.dataset.project;});if(dp){state.deleteTarget={kind:"project",id:dp.id,title:dp.title,children:state.tasks.filter(function(x){return x.project_id===dp.id;}).length};state.modal="confirm-delete";draw();}return;}
      if(action==="toggle-archived"){state.showArchived=!state.showArchived;if(!state.showArchived&&state.archived[state.fProject])state.fProject="";draw();return;}
      if(action==="archive-project"){var ap=state.projects.find(function(p){return p.id===b.dataset.project;});if(ap){state.note={action:b.dataset.state==="on"?"archive":"unarchive",id:ap.id,subject:ap.title};state.modal="note";draw();}return;}
      if(action==="new-project"){state.modal="project";draw();return;}
      if(action==="edit-project"){var project=state.projects.find(function(p){return p.id===b.dataset.project;});if(project){state.editProject=project;state.modal="edit-project";draw();}return;}
      if(action==="new-task"){state.modal="task";state.modalProject=b.dataset.project;state.modalParent="";draw();return;}
      if(action==="subtask"){state.modal="task";state.modalProject=t.project_id;state.modalParent=t.id;draw();return;}
      if(action==="edit-task"&&t){state.editTask=t;state.modal="edit-task";draw();return;}
      if(action==="cal-prev"||action==="cal-next"||action==="cal-today"){var cm=state.calMonth;state.calMonth=action==="cal-today"?new Date(new Date().getFullYear(),new Date().getMonth(),1):new Date(cm.getFullYear(),cm.getMonth()+(action==="cal-next"?1:-1),1);draw();return;}
      if(action==="checklist"){openChecklist(id);return;}
      if(action==="check-remove"){window.SSMPDDb.taskChecklistRemove(id).then(function(){return reloadChecklist();}).catch(function(e){state.error=e.message||"تعذر الحذف";draw();});return;}
      if(action==="notifications"){state.modal="notifications";draw();return;}
      if(action==="read-notice"){
        var notice=state.notifications.find(function(x){return x.id===id;});
        state.modal="";
        window.SSMPDDb.taskMarkNotificationRead(id).catch(function(){}).then(refresh).then(function(){if(notice&&notice.task_id)focusTask(notice.task_id);});
        return;
      }
      if(action==="history"){state.pendingFiles=[];state.historyTask="";openHistory(id);return;}
      if(action==="remove-file"){state.pendingFiles.splice(Number(id),1);renderFiles();return;}
      if(action==="progress"||action==="submit"||action==="blocked"||action==="approve"||action==="return"){
        if(!t)return;
        state.note={action:action,id:id,starting:t.status==="todo"||t.status==="revision",subject:t.title};
        state.modal="note";draw();
      }
    };
    el.onchange=function(ev){
      if(ev.target.matches&&ev.target.matches("[data-check-id]")){window.SSMPDDb.taskChecklistToggle(ev.target.dataset.checkId,ev.target.checked).then(reloadChecklist).catch(function(e){state.error=e.message||"تعذر الحفظ";draw();});return;}
      if(ev.target.matches&&ev.target.matches("[data-comment-files]")){addFiles(ev.target);return;}
      if(ev.target.matches&&ev.target.matches('input[name="to"]')){var cf=ev.target.closest("form"),sel=cf.querySelector('select[name="to_other"]'),hint=cf.querySelector("[data-to-hint]");if(sel)sel.hidden=ev.target.value!=="other";if(hint)hint.hidden=ev.target.value!==CLAUDE_ID;return;}
      var s=ev.target.closest&&ev.target.closest("[data-sel]");
      if(s){var k=s.dataset.sel;if(k==="project")state.fProject=s.value;else if(k==="assignee")state.fAssignee=s.value;else{state.sort=s.value;store("sort",s.value);}drawList();return;}
      if(ev.target.matches('[name="repeat_active"],[name="repeat_until"]'))syncRepeat(ev.target.closest("form"));
    };
    el.onsubmit=function(ev){
      var form=ev.target.closest("form[data-form]");if(!form)return;ev.preventDefault();
      if((form.dataset.form==="task"||form.dataset.form==="task-edit")&&!syncRepeat(form)){
        form.querySelector('[name="repeat_until"]').focus();return;
      }
      var fd=new FormData(form);
      if(form.dataset.form==="note"){submitNote(form,fd);return;}
      if(form.dataset.form==="comment"){submitComment(form,fd);return;}
      if(form.dataset.form==="check-add"){var cb=String(fd.get("body")||"").trim();if(!cb)return;window.SSMPDDb.taskChecklistAdd(state.checkTask,cb).then(reloadChecklist).catch(function(e){state.error=e.message||"تعذر الإضافة";draw();});return;}
      // ضغطتين على «إسناد المهمة»/«حفظ» كانوا بيعملوا مهمتين (أو سلسلتين تكرار) — زرار واحد = طلب واحد
      if(form.dataset.busy==="1")return;
      var saveBtn=form.querySelector("footer .btn-primary");
      function lockSave(){form.dataset.busy="1";if(saveBtn)saveBtn.disabled=true;}
      function unlockSave(){form.dataset.busy="";if(saveBtn)saveBtn.disabled=false;}
      if(form.dataset.form==="project"||form.dataset.form==="project-edit"){lockSave();
        var members=Array.from(form.querySelectorAll('input[name="member"]:checked')).map(function(x){return {admin_id:x.value,role_name:fd.get("role_"+x.value)||"contributor"};});
        var projectSave=form.dataset.form==="project-edit"
          ?window.SSMPDDb.taskUpdateProject(fd.get("project_id"),fd.get("title"),fd.get("description"),fd.get("manager_id"),members)
          :window.SSMPDDb.taskCreateProject(fd.get("title"),fd.get("description"),fd.get("manager_id"),members);
        projectSave.then(function(){state.modal="";state.editProject=null;return refresh();}).catch(function(e){unlockSave();window.alert(e.message);});
      }else if(form.dataset.form==="task-edit"){lockSave();
        var editDue=fd.get("due_at"),recurring=fd.get("repeat_active")==="on";
        window.SSMPDDb.taskUpdateDetails(fd.get("task_id"),fd.get("title"),fd.get("description"),fd.get("expected_output"),fd.get("assignee_id"),editDue?new Date(editDue+"T23:59:00").toISOString():null,fd.get("priority"),recurring,Number(fd.get("repeat_interval")||1),fd.get("repeat_unit")||"day",fd.get("repeat_until")||null,fd.get("update_future")==="on").then(function(){state.modal="";state.editTask=null;return refresh();}).catch(function(e){unlockSave();taskSaveError(form,e);});
      }else{lockSave();
        var due=fd.get("due_at"),repeat=fd.get("repeat_active")==="on";
        var args=[fd.get("project_id"),fd.get("parent_task_id")||null,fd.get("title"),fd.get("description"),fd.get("expected_output"),fd.get("assignee_id"),due?new Date(due+"T23:59:00").toISOString():null,fd.get("priority")];
        var createPromise=repeat?window.SSMPDDb.taskCreateRecurring.apply(null,args.concat([Number(fd.get("repeat_interval")||1),fd.get("repeat_unit")||"day",fd.get("repeat_until")||null])):window.SSMPDDb.taskCreate.apply(null,args);
        createPromise.then(function(){state.modal="";return refresh();}).catch(function(e){unlockSave();taskSaveError(form,e);});
      }
    };
    refresh().then(function(){liveTimer=setInterval(function(){if(!el.isConnected){clearInterval(liveTimer);liveTimer=null;return;}refresh();},90000);});
  }
  window.SSMPDRenderTasks={render:render,focus:function(id){return currentFocus?currentFocus(id):false;}};
})();
