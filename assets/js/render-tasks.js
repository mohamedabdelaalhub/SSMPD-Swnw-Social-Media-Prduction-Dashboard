/* SSMPD — تاب مهام الموظفين */
(function () {
  "use strict";
  var liveTimer=null;
  var STATUS = {todo:"لم تبدأ",in_progress:"جاري العمل",review:"بانتظار المراجعة",revision:"مطلوب تعديل",done:"مكتملة",blocked:"متوقفة"};
  var PRIORITY = {low:"منخفضة",normal:"عادية",high:"عالية",urgent:"عاجلة"};
  function esc(v){return String(v==null?"":v).replace(/[&<>"']/g,function(c){return {"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c];});}
  function date(v){if(!v)return "بدون موعد";var d=new Date(v);return isNaN(d)?"":d.toLocaleDateString("ar-EG",{year:"numeric",month:"short",day:"numeric"});}
  function dateValue(v){if(!v)return "";var d=new Date(v);if(isNaN(d))return "";return d.getFullYear()+"-"+String(d.getMonth()+1).padStart(2,"0")+"-"+String(d.getDate()).padStart(2,"0");}
  function repeatFields(t){t=t||{};var active=!!t.recurrence_active;return '<label class="tsk-repeat-toggle"><input type="checkbox" name="repeat_active" '+(active?"checked":"")+'><span>تكرار المهمة تلقائياً</span></label><div class="tsk-repeat-fields" '+(active?"":"hidden")+'><div class="tsk-form-row"><label>كل<input type="number" name="repeat_interval" min="1" max="365" value="'+esc(t.recurrence_interval_value||1)+'"></label><label>الفترة<select name="repeat_unit"><option value="day" '+(t.recurrence_interval_unit==="day"?"selected":"")+'>يوم</option><option value="week" '+(t.recurrence_interval_unit==="week"?"selected":"")+'>أسبوع</option><option value="month" '+(t.recurrence_interval_unit==="month"?"selected":"")+'>شهر</option></select></label></div><label>إيقاف التكرار في (اختياري)<input type="date" name="repeat_until" value="'+dateValue(t.recurrence_ends_at)+'"></label><small>سيتم إنشاء مهمة جديدة تلقائياً بالبيانات نفسها وإسنادها للمسؤول.</small></div>';}
  function allManager(a){return window.SSMPDRoles.hasAnyRole(a,["general_manager","super_admin"]);}
  function modal(title,body){return '<div class="tsk-modal-backdrop" data-action="close-modal"><section class="tsk-modal" role="dialog" aria-modal="true"><header><h3>'+esc(title)+'</h3><button type="button" class="tsk-x" data-action="close-modal" aria-label="إغلاق">×</button></header>'+body+'</section></div>';}
  var PRANK={urgent:0,high:1,normal:2,low:3};
  function prank(t){var r=PRANK[t.priority];return r===undefined?2:r;}
  function dayStart(d){return new Date(d.getFullYear(),d.getMonth(),d.getDate());}
  function isOverdue(t){return t.status!=="done"&&!!t.due_at&&new Date(t.due_at)<new Date();}
  function daysLeft(t){if(!t.due_at||t.status==="done")return null;var d=new Date(t.due_at);if(isNaN(d))return null;return Math.round((dayStart(d)-dayStart(new Date()))/86400000);}
  function dayWord(n){return n===1?"يوم":(n===2?"يومين":(n<=10?n+" أيام":n+" يوم"));}
  function dueNote(t){var n=daysLeft(t);if(n===null)return "";if(n<0)return " · متأخرة "+dayWord(-n);if(n===0)return " · ينتهي النهارده";if(n===1)return " · ينتهي بكرة";return " · باقي "+dayWord(n);}
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
  function linkify(text){return esc(text).replace(/(https?:\/\/[^\s<]+)/g,function(u){var clean=u.replace(/[.,،؛)]+$/,""),tail=u.slice(clean.length);return '<a href="'+clean+'" target="_blank" rel="noopener noreferrer">'+clean+'</a>'+tail;});}
  var FILE_EXT=["png","jpg","jpeg","webp","gif","pdf","txt","csv","doc","docx","xls","xlsx","ppt","pptx"],MAX_FILES=10,MAX_BYTES=10485760;
  function fileSize(n){return n>=1048576?(n/1048576).toFixed(1).replace(/\.0$/,"")+" MB":Math.max(1,Math.round(n/1024))+" KB";}
  function store(key,value){try{if(value===undefined)return window.localStorage.getItem("ssmpd.tasks."+key);window.localStorage.setItem("ssmpd.tasks."+key,value);}catch(e){}return null;}
  var NOTE={
    progress:{title:"تسجيل تحديث",start:"بدء المهمة",label:"إيه اللي اتعمل أو هتشتغل عليه؟",hint:"مثال: خلّصت جرد الرف الأول وهبدأ الرف التاني",required:true,button:"حفظ التحديث"},
    submit:{title:"إرسال للمراجعة",label:"ملخص الإنجاز",hint:"مثال: رفعت الشيت كامل على المنصة وراجعت الأرقام",required:true,button:"إرسال للمراجعة"},
    blocked:{title:"تحديد المهمة كمتوقفة",label:"سبب التوقف",hint:"مثال: مستني ردّ المورد على الأسعار",required:true,button:"تحديد كمتوقفة"},
    approve:{title:"اعتماد وإكمال المهمة",label:"ملاحظة الاعتماد (اختياري)",hint:"المهمة هتتقفل كمكتملة بعد الاعتماد.",required:false,button:"اعتماد وإكمال",confirm:true},
    return:{title:"إرجاع المهمة للتعديل",label:"المطلوب تعديله",hint:"اكتب بوضوح إيه اللي ناقص عشان الموظف يعرف يعدّل",required:true,button:"إرجاع للتعديل"},
    archive:{title:"أرشفة المشروع",label:"",hint:"المشروع ومهامه هيختفوا من الشاشة الأساسية، وتقدر ترجّعهم من زر \"عرض المؤرشفة\".",required:false,button:"أرشفة المشروع",confirm:true,noText:true},
    unarchive:{title:"إلغاء أرشفة المشروع",label:"",hint:"المشروع ومهامه هيرجعوا للشاشة الأساسية.",required:false,button:"إلغاء الأرشفة",confirm:true,noText:true}
  };
  function card(t,project,admin,people,mayManage,sub){
    var overdue=t.status!=="done"&&t.due_at&&new Date(t.due_at)<new Date();
    var statusClass="s-"+t.status;
    var html='<article class="tsk-card '+statusClass+(overdue?' is-overdue':'')+' '+(t.parent_task_id?'tsk-child':'tsk-main-task')+'" data-task-id="'+t.id+'"><div class="tsk-card-main"><div class="tsk-title-row"><h3>'+esc(t.title)+'</h3><span class="tsk-status '+statusClass+'">'+esc(STATUS[t.status]||t.status)+'</span></div>'+
      '<div class="tsk-meta"><span>'+esc(t.project_title||project.title||"مشروع")+'</span><span>المسؤول: '+esc(t.assignee_name||"—")+'</span><span class="'+(overdue?"tsk-overdue":"")+'">الموعد: '+date(t.due_at)+dueNote(t)+'</span><span class="tsk-prio p-'+esc(t.priority||'normal')+'">الأولوية: '+esc(PRIORITY[t.priority]||"عادية")+'</span></div>'+
      (t.description?'<p class="tsk-description">'+esc(t.description)+'</p>':"")+
      (t.expected_output?'<p class="tsk-output"><b>المطلوب:</b> '+esc(t.expected_output)+'</p>':"")+
      (t.recurrence_active?'<p class="tsk-output">↻ تتكرر كل '+esc(t.recurrence_interval_value)+' '+esc(({day:"يوم",week:"أسبوع",month:"شهر"})[t.recurrence_interval_unit]||"فترة")+'</p>':"")+
      (t.return_note?'<p class="tsk-return"><b>ملاحظة المدير:</b> '+esc(t.return_note)+'</p>':"")+
      (sub?'<button type="button" class="tsk-sub-toggle" data-action="toggle-sub" data-id="'+t.id+'" aria-expanded="'+(sub.open?"true":"false")+'"><span class="tsk-caret">'+(sub.open?"▾":"▸")+'</span> '+sub.total+' مهام فرعية · '+sub.done+' مكتملة<span class="tsk-progress-bar mini"><i style="width:'+Math.round(sub.done*100/sub.total)+'%"></i></span></button>':"")+
      '<div class="tsk-actions">';
    var own=t.assignee_id===admin.id;
    if(window.SSMPDRoles.canModuleAction(admin,"tasks","update")&&own&&t.status!=="done"&&t.status!=="review"){
      if(t.status==="todo"||t.status==="revision") html+='<button class="btn btn-primary" data-action="progress" data-id="'+t.id+'">بدء المهمة</button>';
      else html+='<button class="btn" data-action="progress" data-id="'+t.id+'">تسجيل تحديث</button><button class="btn btn-primary" data-action="submit" data-id="'+t.id+'">إرسال للمراجعة</button>';
      html+='<button class="btn" data-action="blocked" data-id="'+t.id+'">تحديد كمتوقفة</button>';
    }
    if(window.SSMPDRoles.canModuleAction(admin,"tasks","update")&&mayManage&&t.status==="review"){
      html+='<button class="btn btn-primary" data-action="approve" data-id="'+t.id+'">اعتماد وإكمال</button><button class="btn btn-warn" data-action="return" data-id="'+t.id+'">إرجاع للتعديل</button>';
    }
    if(t.parent_task_id)html+='<button class="btn btn-small" data-action="open-task" data-id="'+t.id+'">عرض التفاصيل</button>';
    if(mayManage){
      if(window.SSMPDRoles.canModuleAction(admin,"tasks","update"))html+='<button class="btn" data-action="edit-task" data-id="'+t.id+'">تعديل المهمة</button>';
      html+='<button class="btn btn-danger" data-action="delete-task" data-id="'+t.id+'">حذف</button>';
      if(window.SSMPDRoles.canModuleAction(admin,"tasks","create"))html+='<button class="btn" data-action="subtask" data-id="'+t.id+'">إضافة مهمة فرعية</button>';
      html+='<button class="btn btn-order" data-action="move-task" data-id="'+t.id+'" data-direction="up" title="تقديم في الترتيب">↑</button><button class="btn btn-order" data-action="move-task" data-id="'+t.id+'" data-direction="down" title="تأخير في الترتيب">↓</button>';
    }
    html+='<button class="btn btn-quiet" data-action="history" data-id="'+t.id+'">التعليقات والسجل</button></div></div></article>';
    return html;
  }
  function render(el){
    if(!window.SSMPDRoles.canModuleAction(window.SSMPDAuth.currentAdmin,"tasks","view")){el.innerHTML="<p>ليس لديك صلاحية عرض المهام.</p>";return;}
    var admin=window.SSMPDAuth.currentAdmin;
    var state={projects:[],tasks:[],people:[],notifications:[],archived:{},modal:"",error:"",filter:"all",view:store("view")==="board"?"board":"list",sort:(["smart","manual","due","priority","updated"].indexOf(store("sort"))>=0?store("sort"):"smart"),q:"",fProject:"",fAssignee:"",showArchived:false,expanded:{},note:null,deleteTarget:null,viewId:"",historyTask:"",history:[],historyAtts:{},pendingFiles:[]};
    var isAdmin=allManager(admin);
    function refresh(){return window.SSMPDDb.taskRefreshOverdue().catch(function(){return 0;}).then(function(){return Promise.all([
      window.SSMPDDb.taskListProjects(),window.SSMPDDb.taskListVisible(),window.SSMPDDb.taskPeople(),
      window.SSMPDDb.taskListNotifications(),
      window.SSMPDDb.taskProjectArchives?window.SSMPDDb.taskProjectArchives().catch(function(){return [];}):Promise.resolve([])
    ]);}).then(function(v){state.projects=v[0]||[];state.tasks=v[1]||[];state.people=v[2]||[];state.notifications=v[3]||[];state.archived={};(v[4]||[]).forEach(function(r){if(r.archived_at)state.archived[r.id]=true;});state.error="";if(!state.modal&&!typing())draw();}).catch(function(e){var raw=e&&e.message||"تعذر تحميل المهام";
      state.error=/schema cache|could not find function/i.test(raw)
        ?"دوال المهام غير ظاهرة بعد في Supabase. نفّذ في SQL Editor: NOTIFY pgrst, 'reload schema'; ثم حدّث الصفحة."
        :raw;if(!state.modal)draw();});}
    function typing(){var a=document.activeElement;return !!(a&&el.contains(a)&&a.matches&&a.matches("[data-search]"));}
    function baseTasks(){return state.showArchived?state.tasks:state.tasks.filter(function(t){return !state.archived[t.project_id];});}
    function matches(t){
      if(state.fProject&&t.project_id!==state.fProject)return false;
      if(state.fAssignee&&(t.assignee_id||"")!==state.fAssignee)return false;
      if(state.q){var hay=norm([t.title,t.description,t.assignee_name,t.project_title,t.expected_output].join(" "));if(hay.indexOf(norm(state.q))<0)return false;}
      return true;
    }
    function projectOf(t){return state.projects.find(function(x){return x.id===t.project_id;})||{};}
    function cardFor(t,sub){return card(t,projectOf(t),admin,state.people,isAdmin||t.can_manage,sub);}
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
    function listHtml(){
      var base=baseTasks(),pool=base.filter(matches),board=state.view==="board";
      var filtering=!!(state.q||state.fProject||state.fAssignee||(!board&&state.filter!=="all"));
      var canMakeTask=window.SSMPDRoles.canModuleAction(admin,"tasks","create")&&state.projects.some(function(p){return p.can_manage&&!state.archived[p.id];});
      var html="";
      if(!board){
        html+='<div class="tsk-chipbar" role="tablist">'+["all"].concat(Object.keys(STATUS)).map(function(k){var n=k==="all"?pool.length:pool.filter(function(t){return t.status===k;}).length;return '<button type="button" class="tsk-fchip '+(k==="all"?"":"s-"+k)+(state.filter===k?" on":"")+'" data-action="filter" data-id="'+k+'">'+(k==="all"?"الكل":STATUS[k])+' <b>'+n+'</b></button>';}).join("")+'</div>';
      }
      var vis=sortTasks(board||state.filter==="all"?pool:pool.filter(function(t){return t.status===state.filter;}),state.sort);
      if(!base.length)return html+emptyHtml("none",canMakeTask);
      if(!vis.length)return html+emptyHtml("filtered",canMakeTask);
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
    function drawList(){draw();}
    function toolbarHtml(){
      var base=baseTasks(),seen={},people=[];
      base.forEach(function(t){if(t.assignee_id&&!seen[t.assignee_id]){seen[t.assignee_id]=true;people.push({id:t.assignee_id,name:t.assignee_name||"—"});}});
      people.sort(function(a,b){return String(a.name).localeCompare(String(b.name),"ar");});
      var projs=state.projects.filter(function(p){return state.showArchived||!state.archived[p.id];});
      var sorts={smart:"الأهم أولاً",manual:"ترتيب مدير المشروع",due:"الأقرب موعداً",priority:"الأعلى أولوية",updated:"آخر تحديث"};
      return '<div class="tsk-toolbar"><input type="search" class="tsk-search" data-search placeholder="ابحث باسم المهمة أو المسؤول أو المشروع…" value="'+esc(state.q)+'" aria-label="بحث في المهام">'+
        '<select data-sel="project" aria-label="المشروع"><option value="">كل المشاريع</option>'+projs.map(function(p){return '<option value="'+p.id+'" '+(state.fProject===p.id?"selected":"")+'>'+esc(p.title)+'</option>';}).join("")+'</select>'+
        (people.length>1?'<select data-sel="assignee" aria-label="المسؤول"><option value="">كل المسؤولين</option>'+people.map(function(p){return '<option value="'+p.id+'" '+(state.fAssignee===p.id?"selected":"")+'>'+esc(p.name)+'</option>';}).join("")+'</select>':"")+
        '<select data-sel="sort" aria-label="الترتيب">'+Object.keys(sorts).map(function(k){return '<option value="'+k+'" '+(state.sort===k?"selected":"")+'>'+sorts[k]+'</option>';}).join("")+'</select>'+
        '<div class="tsk-viewtoggle" role="group" aria-label="طريقة العرض"><button type="button" data-action="view" data-id="list" class="'+(state.view==="list"?"on":"")+'">قائمة</button><button type="button" data-action="view" data-id="board" class="'+(state.view==="board"?"on":"")+'">لوحة</button></div></div>';
    }
    function projectCard(p){
      var m=state.people.find(function(x){return x.id===p.manager_id;});
      var projectTasks=sortTasks(state.tasks.filter(function(t){return t.project_id===p.id;}),"manual");
      var roots=projectTasks.filter(function(t){return !t.parent_task_id;});
      function treeItem(task,children){
        var isOpen=!!state.expanded[task.id],canMove=!!task.can_manage;
        return '<div class="tsk-tree-task '+(task.parent_task_id?'is-subtask':'')+'"><div class="tsk-tree-row">'+miniCard(task)+'<span class="tsk-tree-status s-'+esc(task.status)+'">'+esc(STATUS[task.status]||task.status)+'</span><button type="button" class="btn btn-small" data-action="open-task" data-id="'+task.id+'">عرض التفاصيل</button>'+
          (canMove?'<button type="button" class="btn btn-order" data-action="move-task" data-id="'+task.id+'" data-direction="up" aria-label="تقديم">↑</button><button type="button" class="btn btn-order" data-action="move-task" data-id="'+task.id+'" data-direction="down" aria-label="تأخير">↓</button>':"")+
          (children&&children.length?'<button type="button" class="tsk-sub-toggle" data-action="toggle-sub" data-id="'+task.id+'" aria-expanded="'+(isOpen?"true":"false")+'">'+(isOpen?"إخفاء":"عرض")+' '+children.length+' مهام فرعية</button>':"")+'</div>'+
          (children&&children.length&&isOpen?'<div class="tsk-tree-subtasks">'+children.map(function(child){return treeItem(child,[]);}).join("")+'</div>':"")+'</div>';
      }
      var hierarchy=roots.map(function(root){return treeItem(root,projectTasks.filter(function(t){return t.parent_task_id===root.id;}));}).join("");
      var chips=(p.members||[]).map(function(x){return '<span class="tsk-chip">'+esc(x.name)+' <small>'+esc({manager:"مدير مشارك",contributor:"عضو منفذ",reviewer:"مراجع"}[x.role]||"عضو")+'</small></span>';}).join("");
      var mine=state.tasks.filter(function(t){return t.project_id===p.id;}),done=mine.filter(function(t){return t.status==="done";}).length,pct=mine.length?Math.round(done*100/mine.length):0,late=mine.filter(isOverdue).length,archived=!!state.archived[p.id];
      var canUpdate=window.SSMPDRoles.canModuleAction(admin,"tasks","update"),canAdd=window.SSMPDRoles.canModuleAction(admin,"tasks","create");
      return '<div class="tsk-project'+(archived?" is-archived":"")+'" data-project-id="'+p.id+'"><div class="tsk-project-top"><span class="tsk-avatar">'+esc(String(p.title||"م").trim().charAt(0))+'</span><div class="tsk-project-name"><b>'+esc(p.title)+(archived?' <em class="tsk-arch-badge">مؤرشف</em>':"")+'</b><span>مدير المشروع: '+esc(m?m.name:"—")+'</span></div><span class="tsk-count" title="عدد المهام">'+mine.length+'</span></div>'+
        (p.description?'<p class="tsk-project-desc">'+esc(p.description)+'</p>':"")+
        '<div class="tsk-progress" title="'+done+' من '+mine.length+' مكتملة"><div class="tsk-progress-bar"><i style="width:'+pct+'%"></i></div><span>'+(mine.length?done+" من "+mine.length+" مكتملة · "+pct+"%":"لا توجد مهام بعد")+(late?' · <em class="tsk-late-text">'+late+' متأخرة</em>':"")+'</span></div>'+
        '<div class="tsk-chips">'+(chips||'<span class="tsk-chip muted">بدون فريق</span>')+'</div>'+
        (p.can_manage?'<div class="tsk-project-actions">'+(canUpdate&&!archived?'<button class="btn btn-small" data-action="edit-project" data-project="'+p.id+'">تعديل المشروع</button>':"")+(canAdd&&!archived?'<button class="btn btn-small" data-action="new-task" data-project="'+p.id+'">إضافة مهمة</button>':"")+(canUpdate?'<button class="btn btn-small btn-quiet" data-action="archive-project" data-project="'+p.id+'" data-state="'+(archived?"off":"on")+'">'+(archived?"إلغاء الأرشفة":"أرشفة")+'</button>':"")+(p.can_manage?'<button class="btn btn-small btn-danger" data-action="delete-project" data-project="'+p.id+'">حذف المشروع</button>':"")+'</div>':"")+
        '<details class="tsk-project-hierarchy" open><summary>مهام المشروع <b>'+projectTasks.length+'</b></summary><div class="tsk-project-tree">'+(hierarchy||'<p class="tsk-tree-empty">لا توجد مهام داخل المشروع.</p>')+'</div></details></div>';
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
      var unread=state.notifications.filter(function(n){return !n.read_at;}).length;
      var base=baseTasks();
      var since=new Date(Date.now()-7*86400000);
      var week=base.filter(function(t){return new Date(t.updated_at)>=since;});
      var overdue=base.filter(isOverdue);
      var canCreate=window.SSMPDRoles.canModuleAction(admin,"tasks","create")&&(isAdmin||window.SSMPDRoles.isControlledFinance(admin));
      var pOpts=state.projects.map(function(p){return '<option value="'+p.id+'">'+esc(p.title)+'</option>';}).join("");
      var personOpts=state.people.map(function(p){return '<option value="'+p.id+'">'+esc(p.name||p.email)+'</option>';}).join("");
      var banner=state.error?'<div class="tsk-error">'+esc(state.error)+'</div>':"";
      var html='<section class="tsk-page" dir="rtl"><div class="tsk-head"><div><p class="tsk-eyebrow">تنظيم الشغل ومتابعته</p><h1>المهام والمشاريع</h1><p>حدّث تقدمك باستمرار، وسيظهر لك ما أُسند إليك فقط.</p></div><div class="tsk-head-actions"><button class="btn" data-action="notifications">الإشعارات'+(unread?' <b class="tsk-badge">'+unread+'</b>':"")+'</button>'+(canCreate?'<button class="btn btn-primary" data-action="new-project">+ مشروع / خطة عمل</button>':"")+'</div></div>'+banner;
      html+='<div class="tsk-stats"><div class="st-blue"><span>تحديثات آخر 7 أيام</span><b>'+week.length+'</b></div><div class="st-amber"><span>قيد المراجعة</span><b>'+base.filter(function(t){return t.status==="review";}).length+'</b></div><div class="st-red"><span>متأخرة</span><b>'+overdue.length+'</b></div><div class="st-green"><span>مكتملة</span><b>'+week.filter(function(t){return t.status==="done";}).length+'</b></div></div>';
      var archivedCount=state.projects.filter(function(p){return state.archived[p.id];}).length;
      var shownProjects=state.projects.filter(function(p){return state.showArchived||!state.archived[p.id];});
      if(state.projects.length){html+='<section class="tsk-panel"><div class="tsk-panel-head"><div><h2>المشاريع</h2><p>المدير وأعضاء الخطة وأدوارهم</p></div>'+(archivedCount?'<div class="tsk-filters"><button class="btn btn-quiet" data-action="toggle-archived">'+(state.showArchived?"إخفاء المؤرشفة":"عرض المؤرشفة ("+archivedCount+")")+'</button></div>':"")+'</div><div class="tsk-project-grid">'+(shownProjects.map(projectCard).join("")||'<div class="tsk-empty tsk-empty-rich"><div class="tsk-empty-icon">🗂️</div><h3>كل المشاريع مؤرشفة</h3><p>اضغط "عرض المؤرشفة" لو عايز تشوفها.</p></div>')+'</div></section>';}
      else html+='<section class="tsk-panel"><div class="tsk-empty tsk-empty-rich"><div class="tsk-empty-icon">🗂️</div><h3>مفيش مشاريع لسه</h3><p>المشروع أو خطة العمل هي اللي بتتجمّع تحتها المهام ويتابعها فريق محدد.</p>'+(canCreate?'<button class="btn btn-primary" data-action="new-project">+ مشروع / خطة عمل</button>':"")+'</div></section>';
      html+='<section class="tsk-panel"><div class="tsk-panel-head"><div><h2>'+(isAdmin?"كل المهام المسموح لك بمتابعتها":"مهامي")+'</h2><p>اكتب ما أنجزته عند كل تحديث. الإكمال النهائي يحتاج اعتماد المدير.</p></div><div class="tsk-filters">'+(window.SSMPDRoles.canModuleAction(admin,"tasks","create")&&state.projects.some(function(p){return p.can_manage&&!state.archived[p.id];})?'<button class="btn btn-primary" data-action="new-task" data-project="'+(state.projects.find(function(p){return p.can_manage&&!state.archived[p.id];})||{}).id+'">+ مهمة</button>':"")+'</div></div>';
      html+=toolbarHtml()+'<div data-list-host>'+listHtml()+'</div></section>';
      html+='<section class="tsk-panel tsk-week"><div class="tsk-panel-head"><div><h2>ملخص الأسبوع</h2><p>آخر سبعة أيام حتى الآن، وحالة كل موظف</p></div></div><div class="tsk-week-row"><span>المهام التي تم تحديثها <b>'+week.length+'</b></span><span>اكتملت <b>'+week.filter(function(t){return t.status==="done";}).length+'</b></span><span>تحتاج مراجعة <b>'+base.filter(function(t){return t.status==="review";}).length+'</b></span><span>متأخرة <b>'+overdue.length+'</b></span></div>'+teamTable(base,since)+'<h3 class="tsk-sub-title">آخر المهام المحدّثة</h3><div class="tsk-week-list">'+(week.slice().sort(function(a,b){return new Date(b.updated_at)-new Date(a.updated_at);}).slice(0,8).map(function(t){return '<div><span>'+esc(t.title)+'</span><span>'+esc(t.assignee_name||"")+'</span><span>'+esc(STATUS[t.status])+'</span></div>';}).join("")||'<p class="tsk-empty">مفيش تحديثات الأسبوع ده.</p>')+'</div></section>';
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
        html+=modal(parentId?"إضافة مهمة فرعية":"إضافة مهمة",'<form data-form="task"><input type="hidden" name="project_id" value="'+esc(projectId)+'"><input type="hidden" name="parent_task_id" value="'+esc(parentId)+'"><label>عنوان المهمة<input name="title" required maxlength="180"></label><label>وصف المطلوب<textarea name="description" rows="3"></textarea></label><label>النتيجة المتوقعة<textarea name="expected_output" rows="2"></textarea></label><label>المسؤول<select name="assignee_id" required>'+personOpts+'</select></label><div class="tsk-form-row"><label>موعد التسليم<input type="date" name="due_at"></label><label>الأولوية<select name="priority"><option value="normal">عادية</option><option value="low">منخفضة</option><option value="high">عالية</option><option value="urgent">عاجلة</option></select></label></div>'+repeatFields(null)+'<footer><button class="btn btn-primary">إسناد المهمة</button><button type="button" class="btn" data-action="close-modal">إلغاء</button></footer></form>');
      }
      if(state.modal==="edit-task"&&state.editTask){
        var et=state.editTask;
        var editPersonOpts=state.people.map(function(p){return '<option value="'+p.id+'" '+(p.id===et.assignee_id?"selected":"")+'>'+esc(p.name||p.email)+'</option>';}).join("");
        var editPriorityOpts=Object.keys(PRIORITY).map(function(k){return '<option value="'+k+'" '+(et.priority===k?"selected":"")+'>'+PRIORITY[k]+'</option>';}).join("");
        html+=modal("تعديل المهمة",'<form data-form="task-edit"><input type="hidden" name="task_id" value="'+esc(et.id)+'"><label>عنوان المهمة<input name="title" required maxlength="180" value="'+esc(et.title)+'"></label><label>وصف المطلوب<textarea name="description" rows="3">'+esc(et.description)+'</textarea></label><label>النتيجة المتوقعة<textarea name="expected_output" rows="2">'+esc(et.expected_output)+'</textarea></label><label>المسؤول<select name="assignee_id" required>'+editPersonOpts+'</select></label><div class="tsk-form-row"><label>موعد التسليم<input type="date" name="due_at" value="'+dateValue(et.due_at)+'"></label><label>الأولوية<select name="priority">'+editPriorityOpts+'</select></label></div>'+repeatFields(et)+(et.recurrence_id?'<label class="tsk-repeat-toggle"><input type="checkbox" name="update_future" checked><span>تطبيق التعديلات على التكرارات القادمة</span></label>':"")+'<footer><button class="btn btn-primary">حفظ التعديلات</button><button type="button" class="btn" data-action="close-modal">إلغاء</button></footer></form>');
      }
      if(state.modal==="task-view"){var vt=state.tasks.find(function(x){return x.id===state.viewId;});if(vt)html+=modal("تفاصيل المهمة",cardFor(vt));}
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
      if(state.modal==="history"){
        var ht=state.tasks.find(function(x){return x.id===state.historyTask;})||{};
        html+=modal("التعليقات وسجل التحديثات",(ht.title?'<p class="tsk-note-for">'+esc(ht.title)+'</p>':"")+
          '<form data-form="comment" class="tsk-comment-form"><textarea name="comment" rows="3" maxlength="5000" placeholder="اكتب تعليق، أو الصق رابط ملف (Drive مثلاً)…"></textarea><div class="tsk-file-list" data-file-list></div><p class="tsk-field-error" role="alert" hidden></p><div class="tsk-form-actions"><label class="btn tsk-file-btn">📎 إرفاق ملفات<input type="file" multiple data-comment-files accept=".png,.jpg,.jpeg,.webp,.gif,.pdf,.txt,.csv,.doc,.docx,.xls,.xlsx,.ppt,.pptx"></label><button class="btn btn-primary" type="submit">إرسال التعليق</button></div><p class="tsk-hint">حتى 10 ملفات، كل ملف لحد 10 ميجا (صور، PDF، Word، Excel، PowerPoint، نص). الملفات بتتحفظ على Google Drive.</p></form>'+
          '<div class="tsk-history">'+((state.history||[]).map(function(u){return '<article><b>'+esc(u.author_name||"عضو الفريق")+'</b><small>'+esc(stamp(u.created_at))+'</small>'+(u.status_to?'<span class="tsk-hist-status">'+esc((STATUS[u.status_from]||"")+(u.status_from?" ← ":"")+(STATUS[u.status_to]||u.status_to))+'</span>':"")+'<p>'+linkify(u.body)+'</p>'+attsHtml(u.id)+'</article>';}).join("")||'<p class="tsk-empty">لا توجد تعليقات أو تحديثات بعد.</p>')+'</div>');
      }
      el.innerHTML=html;
    }
    function stamp(v){var d=new Date(v);return isNaN(d)?"":d.toLocaleString("ar-EG",{day:"numeric",month:"short",hour:"2-digit",minute:"2-digit"});}
    function attsHtml(updateId){
      var list=state.historyAtts[updateId];if(!list||!list.length)return "";
      return '<div class="tsk-atts">'+list.map(function(a){return '<a class="tsk-att" href="'+esc(/^https:\/\/(drive|docs)\.google\.com\//.test(a.file_url||"")?a.file_url:"#")+'" target="_blank" rel="noopener noreferrer">📎 '+esc(a.file_name)+(a.size_bytes?' <small>'+esc(fileSize(a.size_bytes))+'</small>':"")+'</a>';}).join("")+'</div>';
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
      var t=state.tasks.find(function(x){return x.id===id;});if(!t)return;
      state.view="list";state.filter="all";state.q="";state.fProject="";state.fAssignee="";
      if(state.archived[t.project_id])state.showArchived=true;
      if(t.parent_task_id)state.expanded[t.parent_task_id]=true;
      draw();
      var node=el.querySelector('[data-task-id="'+id+'"]');
      if(node){if(node.scrollIntoView)node.scrollIntoView({behavior:"smooth",block:"center"});node.classList.add("tsk-flash");setTimeout(function(){node.classList.remove("tsk-flash");},2600);}
    }
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
      var btn=form.querySelector("button[type=submit]");if(btn){btn.disabled=true;if(files.length)btn.textContent="بيرفع الملفات…";}
      var db=window.SSMPDDb,taskId=state.historyTask;
      Promise.all(files.map(function(f){return db.taskUploadAttachment(taskId,f,(state.tasks.find(function(x){return x.id===taskId;})||{}).title);})).then(function(atts){return db.taskAddComment(taskId,text,atts);}).then(function(){state.pendingFiles=[];openHistory(taskId);}).catch(function(e){if(btn){btn.disabled=false;btn.textContent="إرسال التعليق";}showErr(form,e&&e.message||"تعذر إرسال التعليق");});
    }
    function onEscape(ev){if(!el.isConnected){document.removeEventListener("keydown",onEscape);return;}if(ev.key==="Escape"&&state.modal){state.modal="";state.note=null;state.pendingFiles=[];draw();}}
    document.addEventListener("keydown",onEscape);
    el.oninput=function(ev){if(ev.target.matches&&ev.target.matches("[data-search]")){state.q=ev.target.value;drawList();}};
    el.onclick=function(ev){
      var b=ev.target.closest("[data-action]");if(!b)return;
      if(b.dataset.action==="close-modal"&&ev.target!==b&&ev.target.closest(".tsk-modal"))return;
      var action=b.dataset.action,id=b.dataset.id,t=state.tasks.find(function(x){return x.id===id;});
      if(action==="close-modal"){state.modal="";state.note=null;state.pendingFiles=[];draw();return;}
      if(action==="confirm-delete"&&state.deleteTarget){
        var target=state.deleteTarget,call=target.kind==="project"?window.SSMPDDb.taskDeleteProject(target.id):window.SSMPDDb.taskDelete(target.id);
        b.disabled=true;call.then(function(){state.modal="";state.deleteTarget=null;return refresh();}).catch(function(e){b.disabled=false;state.error=e.message||"تعذر الحذف";draw();});return;
      }
      if(action==="filter"){state.filter=id;drawList();return;}
      if(action==="view"){state.view=id==="board"?"board":"list";store("view",state.view);draw();return;}
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
      if(ev.target.matches&&ev.target.matches("[data-comment-files]")){addFiles(ev.target);return;}
      var s=ev.target.closest&&ev.target.closest("[data-sel]");
      if(s){var k=s.dataset.sel;if(k==="project")state.fProject=s.value;else if(k==="assignee")state.fAssignee=s.value;else{state.sort=s.value;store("sort",s.value);}drawList();return;}
      if(ev.target.matches('input[name="repeat_active"]')){var fields=ev.target.closest("form").querySelector(".tsk-repeat-fields");if(fields)fields.hidden=!ev.target.checked;}
    };
    el.onsubmit=function(ev){
      var form=ev.target.closest("form[data-form]");if(!form)return;ev.preventDefault();
      var fd=new FormData(form);
      if(form.dataset.form==="note"){submitNote(form,fd);return;}
      if(form.dataset.form==="comment"){submitComment(form,fd);return;}
      if(form.dataset.form==="project"||form.dataset.form==="project-edit"){
        var members=Array.from(form.querySelectorAll('input[name="member"]:checked')).map(function(x){return {admin_id:x.value,role_name:fd.get("role_"+x.value)||"contributor"};});
        var projectSave=form.dataset.form==="project-edit"
          ?window.SSMPDDb.taskUpdateProject(fd.get("project_id"),fd.get("title"),fd.get("description"),fd.get("manager_id"),members)
          :window.SSMPDDb.taskCreateProject(fd.get("title"),fd.get("description"),fd.get("manager_id"),members);
        projectSave.then(function(){state.modal="";state.editProject=null;return refresh();}).catch(function(e){window.alert(e.message);});
      }else if(form.dataset.form==="task-edit"){
        var editDue=fd.get("due_at"),recurring=fd.get("repeat_active")==="on";
        window.SSMPDDb.taskUpdateDetails(fd.get("task_id"),fd.get("title"),fd.get("description"),fd.get("expected_output"),fd.get("assignee_id"),editDue?new Date(editDue+"T23:59:00").toISOString():null,fd.get("priority"),recurring,Number(fd.get("repeat_interval")||1),fd.get("repeat_unit")||"day",fd.get("repeat_until")||null,fd.get("update_future")==="on").then(function(){state.modal="";state.editTask=null;return refresh();}).catch(function(e){window.alert(e.message);});
      }else{
        var due=fd.get("due_at"),repeat=fd.get("repeat_active")==="on";
        var args=[fd.get("project_id"),fd.get("parent_task_id")||null,fd.get("title"),fd.get("description"),fd.get("expected_output"),fd.get("assignee_id"),due?new Date(due+"T23:59:00").toISOString():null,fd.get("priority")];
        var createPromise=repeat?window.SSMPDDb.taskCreateRecurring.apply(null,args.concat([Number(fd.get("repeat_interval")||1),fd.get("repeat_unit")||"day",fd.get("repeat_until")||null])):window.SSMPDDb.taskCreate.apply(null,args);
        createPromise.then(function(){state.modal="";return refresh();}).catch(function(e){window.alert(e.message);});
      }
    };
    refresh().then(function(){liveTimer=setInterval(function(){if(!el.isConnected){clearInterval(liveTimer);liveTimer=null;return;}refresh();},90000);});
  }
  window.SSMPDRenderTasks={render:render};
})();
