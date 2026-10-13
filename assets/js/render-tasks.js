/* SSMPD — تاب مهام الموظفين */
(function () {
  "use strict";
  var liveTimer=null;
  var STATUS = {todo:"لم تبدأ",in_progress:"جاري العمل",review:"بانتظار المراجعة",revision:"مطلوب تعديل",done:"مكتملة",blocked:"متوقفة"};
  var PRIORITY = {low:"منخفضة",normal:"عادية",high:"عالية",urgent:"عاجلة"};
  function esc(v){return String(v==null?"":v).replace(/[&<>"']/g,function(c){return {"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c];});}
  function date(v){if(!v)return "بدون موعد";var d=new Date(v);return isNaN(d)?"":d.toLocaleDateString("ar-EG",{year:"numeric",month:"short",day:"numeric"});}
  function allManager(a){return window.SSMPDRoles.hasAnyRole(a,["general_manager","super_admin"]);}
  function modal(title,body){return '<div class="tsk-modal-backdrop" data-action="close-modal"><section class="tsk-modal" role="dialog" aria-modal="true"><header><h3>'+esc(title)+'</h3><button type="button" class="tsk-x" data-action="close-modal" aria-label="إغلاق">×</button></header>'+body+'</section></div>';}
  function card(t,project,admin,people,mayManage){
    var overdue=t.status!=="done"&&t.due_at&&new Date(t.due_at)<new Date();
    var statusClass="s-"+t.status;
    var html='<article class="tsk-card '+(t.parent_task_id?'tsk-child':'')+'"><div class="tsk-card-main"><div class="tsk-title-row"><h3>'+esc(t.title)+'</h3><span class="tsk-status '+statusClass+'">'+esc(STATUS[t.status]||t.status)+'</span></div>'+
      '<div class="tsk-meta"><span>'+esc(t.project_title||project.title||"مشروع")+'</span><span>المسؤول: '+esc(t.assignee_name||"—")+'</span><span class="'+(overdue?"tsk-overdue":"")+'">الموعد: '+date(t.due_at)+(overdue?" · متأخرة":"")+'</span><span>الأولوية: '+esc(PRIORITY[t.priority]||"عادية")+'</span></div>'+
      (t.description?'<p class="tsk-description">'+esc(t.description)+'</p>':"")+
      (t.expected_output?'<p class="tsk-output"><b>المطلوب:</b> '+esc(t.expected_output)+'</p>':"")+
      (t.return_note?'<p class="tsk-return"><b>ملاحظة المدير:</b> '+esc(t.return_note)+'</p>':"")+
      '<div class="tsk-actions">';
    var own=t.assignee_id===admin.id;
    if(own&&t.status!=="done"&&t.status!=="review"){
      if(t.status==="todo"||t.status==="revision") html+='<button class="btn btn-primary" data-action="progress" data-id="'+t.id+'">بدء المهمة</button>';
      else html+='<button class="btn" data-action="progress" data-id="'+t.id+'">تسجيل تحديث</button><button class="btn btn-primary" data-action="submit" data-id="'+t.id+'">إرسال للمراجعة</button>';
      html+='<button class="btn" data-action="blocked" data-id="'+t.id+'">تحديد كمتوقفة</button>';
    }
    if(mayManage&&t.status==="review"){
      html+='<button class="btn btn-primary" data-action="approve" data-id="'+t.id+'">اعتماد وإكمال</button><button class="btn btn-warn" data-action="return" data-id="'+t.id+'">إرجاع للتعديل</button>';
    }
    if(mayManage){
      html+='<button class="btn" data-action="subtask" data-id="'+t.id+'">إضافة مهمة فرعية</button>';
    }
    html+='<button class="btn btn-quiet" data-action="history" data-id="'+t.id+'">سجل التحديثات</button></div></div></article>';
    return html;
  }
  function render(el){
    var admin=window.SSMPDAuth.currentAdmin;
    var state={projects:[],tasks:[],people:[],notifications:[],modal:"",error:"",filter:"all"};
    var isAdmin=allManager(admin);
    function refresh(){return window.SSMPDDb.taskRefreshOverdue().catch(function(){return 0;}).then(function(){return Promise.all([
      window.SSMPDDb.taskListProjects(),window.SSMPDDb.taskListVisible(),window.SSMPDDb.taskPeople(),
      window.SSMPDDb.taskListNotifications()
    ]);}).then(function(v){state.projects=v[0]||[];state.tasks=v[1]||[];state.people=v[2]||[];state.notifications=v[3]||[];state.error="";draw();}).catch(function(e){var raw=e&&e.message||"تعذر تحميل المهام";
      state.error=/schema cache|could not find function/i.test(raw)
        ?"دوال المهام غير ظاهرة بعد في Supabase. نفّذ في SQL Editor: NOTIFY pgrst, 'reload schema'; ثم حدّث الصفحة."
        :raw;draw();});}
    function draw(){
      var unread=state.notifications.filter(function(n){return !n.read_at;}).length;
      var allVisible=state.tasks.filter(function(t){return state.filter==="all"||t.status===state.filter;});
      var since=new Date(Date.now()-7*86400000);
      var week=state.tasks.filter(function(t){return new Date(t.updated_at)>=since;});
      var overdue=state.tasks.filter(function(t){return t.status!=="done"&&t.due_at&&new Date(t.due_at)<new Date();});
      var canCreate=isAdmin||state.projects.some(function(p){return p.can_manage;});
      var pOpts=state.projects.map(function(p){return '<option value="'+p.id+'">'+esc(p.title)+'</option>';}).join("");
      var personOpts=state.people.map(function(p){return '<option value="'+p.id+'">'+esc(p.name||p.email)+'</option>';}).join("");
      var banner=state.error?'<div class="tsk-error">'+esc(state.error)+'</div>':"";
      var html='<section class="tsk-page" dir="rtl"><div class="tsk-head"><div><p class="tsk-eyebrow">تنظيم الشغل ومتابعته</p><h1>المهام والمشاريع</h1><p>حدّث تقدمك باستمرار، وسيظهر لك ما أُسند إليك فقط.</p></div><div class="tsk-head-actions"><button class="btn" data-action="notifications">الإشعارات'+(unread?' <b class="tsk-badge">'+unread+'</b>':"")+'</button>'+(canCreate?'<button class="btn btn-primary" data-action="new-project">+ مشروع / خطة عمل</button>':"")+'</div></div>'+banner;
      html+='<div class="tsk-stats"><div><span>تحديثات آخر 7 أيام</span><b>'+week.length+'</b></div><div><span>قيد المراجعة</span><b>'+state.tasks.filter(function(t){return t.status==="review";}).length+'</b></div><div><span>متأخرة</span><b>'+overdue.length+'</b></div><div><span>مكتملة</span><b>'+week.filter(function(t){return t.status==="done";}).length+'</b></div></div>';
      if(state.projects.length){html+='<section class="tsk-panel"><div class="tsk-panel-head"><div><h2>المشاريع</h2><p>المدير وأعضاء الخطة وأدوارهم</p></div></div><div class="tsk-project-grid">'+(state.projects.map(function(p){var m=state.people.find(function(x){return x.id===p.manager_id;});var team=(p.members||[]).map(function(x){return esc(x.name)+" · "+({manager:"مدير مشارك",contributor:"عضو منفذ",reviewer:"مراجع"}[x.role]||"عضو");}).join("، ");return '<div class="tsk-project"><b>'+esc(p.title)+'</b><span>مدير المشروع: '+esc(m?m.name:"—")+'</span><small>'+esc(p.description||"بدون وصف")+'</small><small>الفريق: '+(team||"—")+'</small>'+(p.can_manage?'<button class="btn btn-small" data-action="new-task" data-project="'+p.id+'">إضافة مهمة</button>':"")+'</div>';}).join("")||'<p class="tsk-empty">لا توجد مشاريع حتى الآن.</p>')+'</div></section>';}
      html+='<section class="tsk-panel"><div class="tsk-panel-head"><div><h2>'+(isAdmin?"كل المهام المسموح لك بمتابعتها":"مهامي")+'</h2><p>اكتب ما أنجزته عند كل تحديث. الإكمال النهائي يحتاج اعتماد المدير.</p></div><div class="tsk-filters"><select data-filter><option value="all">كل الحالات</option>'+Object.keys(STATUS).map(function(k){return '<option value="'+k+'" '+(state.filter===k?"selected":"")+'>'+STATUS[k]+'</option>';}).join("")+'</select>'+(state.projects.some(function(p){return p.can_manage;})?'<button class="btn btn-primary" data-action="new-task" data-project="'+(state.projects.find(function(p){return p.can_manage;})||{}).id+'">+ مهمة</button>':"")+'</div></div>';
      html+='<div class="tsk-list">'+(allVisible.map(function(t){var p=state.projects.find(function(x){return x.id===t.project_id;});return card(t,p||{},admin,state.people,isAdmin||t.can_manage);}).join("")||'<div class="tsk-empty">مفيش مهام في الحالة دي حالياً.</div>')+'</div></section>';
      html+='<section class="tsk-panel tsk-week"><div class="tsk-panel-head"><div><h2>ملخص الأسبوع</h2><p>آخر سبعة أيام حتى الآن</p></div></div><div class="tsk-week-row"><span>المهام التي تم تحديثها <b>'+week.length+'</b></span><span>اكتملت <b>'+week.filter(function(t){return t.status==="done";}).length+'</b></span><span>تحتاج مراجعة <b>'+week.filter(function(t){return t.status==="review";}).length+'</b></span><span>متأخرة <b>'+overdue.length+'</b></span></div><div class="tsk-week-list">'+week.slice(0,8).map(function(t){return '<div><span>'+esc(t.title)+'</span><span>'+esc(t.assignee_name||"")+'</span><span>'+esc(STATUS[t.status])+'</span></div>';}).join("")+'</div></section>';
      if(state.modal==="project"){
        html+=modal("إنشاء مشروع أو خطة عمل",'<form data-form="project"><label>اسم المشروع<input name="title" required maxlength="180"></label><label>وصف الخطة<textarea name="description" rows="3"></textarea></label><label>مدير المشروع<select name="manager_id" required>'+personOpts+'</select></label><div class="tsk-member-picker"><b>أعضاء المشروع وأدوارهم</b>'+state.people.map(function(p){return '<label class="tsk-member"><input type="checkbox" name="member" value="'+p.id+'"><span>'+esc(p.name||p.email)+'</span><select name="role_'+p.id+'"><option value="contributor">عضو منفذ</option><option value="reviewer">مراجع</option><option value="manager">مدير مشارك</option></select></label>';}).join("")+'</div><footer><button class="btn btn-primary">إنشاء المشروع</button><button type="button" class="btn" data-action="close-modal">إلغاء</button></footer></form>');
      }
      if(state.modal==="task"){
        var projectId=state.modalProject||"";
        var parentId=state.modalParent||"";
        html+=modal(parentId?"إضافة مهمة فرعية":"إضافة مهمة",'<form data-form="task"><input type="hidden" name="project_id" value="'+esc(projectId)+'"><input type="hidden" name="parent_task_id" value="'+esc(parentId)+'"><label>عنوان المهمة<input name="title" required maxlength="180"></label><label>وصف المطلوب<textarea name="description" rows="3"></textarea></label><label>النتيجة المتوقعة<textarea name="expected_output" rows="2"></textarea></label><label>المسؤول<select name="assignee_id" required>'+personOpts+'</select></label><div class="tsk-form-row"><label>موعد التسليم<input type="date" name="due_at"></label><label>الأولوية<select name="priority"><option value="normal">عادية</option><option value="low">منخفضة</option><option value="high">عالية</option><option value="urgent">عاجلة</option></select></label></div><footer><button class="btn btn-primary">إسناد المهمة</button><button type="button" class="btn" data-action="close-modal">إلغاء</button></footer></form>');
      }
      if(state.modal==="notifications"){
        html+=modal("إشعارات المهام",'<div class="tsk-notifications">'+(state.notifications.map(function(n){return '<button class="tsk-notice '+(n.read_at?"":"unread")+'" data-action="read-notice" data-id="'+n.id+'"><b>'+esc(n.message)+'</b><small>'+date(n.created_at)+'</small></button>';}).join("")||'<p class="tsk-empty">لا توجد إشعارات حالياً.</p>')+'</div>');
      }
      if(state.modal==="history"){
        html+=modal("سجل تحديثات المهمة",'<div class="tsk-history">'+((state.history||[]).map(function(u){return '<article><b>'+esc(u.author_name||"عضو الفريق")+'</b><small>'+date(u.created_at)+'</small><p>'+esc(u.body)+'</p></article>';}).join("")||'<p class="tsk-empty">لا توجد تحديثات بعد.</p>')+'</div>');
      }
      el.innerHTML=html;
    }
    el.onclick=function(ev){
      var b=ev.target.closest("[data-action]");if(!b)return;
      if(b.dataset.action==="close-modal"&&ev.target!==b&&ev.target.closest(".tsk-modal"))return;
      var action=b.dataset.action,id=b.dataset.id,t=state.tasks.find(function(x){return x.id===id;});
      if(action==="close-modal"){state.modal="";draw();return;}
      if(action==="new-project"){state.modal="project";draw();return;}
      if(action==="new-task"){state.modal="task";state.modalProject=b.dataset.project;state.modalParent="";draw();return;}
      if(action==="subtask"){state.modal="task";state.modalProject=t.project_id;state.modalParent=t.id;draw();return;}
      if(action==="notifications"){state.modal="notifications";draw();return;}
      if(action==="read-notice"){window.SSMPDDb.taskMarkNotificationRead(id).then(refresh);return;}
      if(action==="history"){window.SSMPDDb.taskListUpdates(id).then(function(rows){return window.SSMPDDb.taskPeople().then(function(people){rows.forEach(function(x){var p=people.find(function(y){return y.id===x.author_id;});x.author_name=p&&p.name;});state.history=rows;state.modal="history";draw();});}).catch(function(e){state.error=e.message;draw();});return;}
      if(action==="progress"||action==="submit"||action==="blocked"){
        var note=window.prompt(action==="blocked"?"اكتب سبب التوقف":"اكتب ما تم إنجازه أو ما ستعمل عليه");
        if(note===null)return;
        if(action==="progress"&&!note.trim()){window.alert("اكتب تحديثاً قصيراً قبل الحفظ.");return;}
        var status=action==="blocked"?"blocked":(action==="submit"?"review":"in_progress");
        if(status==="review"&&!note.trim()){window.alert("اكتب ملخص الإنجاز قبل الإرسال للمراجعة.");return;}
        window.SSMPDDb.taskSetStatus(id,status,note).then(refresh).catch(function(e){window.alert(e.message);});
        return;
      }
      if(action==="approve"||action==="return"){
        var msg=window.prompt(action==="return"?"اكتب ملاحظة واضحة للمهمة التي ستُعاد":"ملاحظة الاعتماد (اختياري)") ;
        if(msg===null)return;
        if(action==="return"&&!msg.trim()){window.alert("اكتب سبب الإرجاع حتى يعرف الموظف ما المطلوب.");return;}
        window.SSMPDDb.taskReview(id,action==="approve",msg).then(refresh).catch(function(e){window.alert(e.message);});
      }
    };
    el.onchange=function(ev){if(ev.target.matches("[data-filter]")){state.filter=ev.target.value;draw();}};
    el.onsubmit=function(ev){
      var form=ev.target.closest("form[data-form]");if(!form)return;ev.preventDefault();
      var fd=new FormData(form);
      if(form.dataset.form==="project"){
        var members=Array.from(form.querySelectorAll('input[name="member"]:checked')).map(function(x){return {admin_id:x.value,role_name:fd.get("role_"+x.value)||"contributor"};});
        window.SSMPDDb.taskCreateProject(fd.get("title"),fd.get("description"),fd.get("manager_id"),members).then(function(){state.modal="";return refresh();}).catch(function(e){window.alert(e.message);});
      }else{
        var due=fd.get("due_at");
        window.SSMPDDb.taskCreate(fd.get("project_id"),fd.get("parent_task_id")||null,fd.get("title"),fd.get("description"),fd.get("expected_output"),fd.get("assignee_id"),due?new Date(due+"T23:59:00").toISOString():null,fd.get("priority")).then(function(){state.modal="";return refresh();}).catch(function(e){window.alert(e.message);});
      }
    };
    refresh().then(function(){liveTimer=setInterval(function(){if(!el.isConnected){clearInterval(liveTimer);liveTimer=null;return;}refresh();},90000);});
  }
  window.SSMPDRenderTasks={render:render};
})();