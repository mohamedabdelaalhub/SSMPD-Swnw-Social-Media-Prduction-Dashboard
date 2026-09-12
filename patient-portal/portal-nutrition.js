(function(){
"use strict";
var root=document.getElementById("portal-root"),cfg=window.SSMPD_CONFIG&&window.SSMPD_CONFIG.supabase,ui=window.SwnwNutritionView;
if(!root||!cfg||!window.supabase||!ui)return;
var client=window.supabase.createClient(cfg.url,cfg.anonKey,{auth:{persistSession:true,autoRefreshToken:true,storageKey:"swnw-patient-portal-auth"}}),esc=ui.esc;
function invoke(body){return client.functions.invoke("patient-portal-nutrition",{body:body}).then(function(r){if(r.error||!r.data||r.data.error)throw new Error("request failed");return r.data;});}
function current(view){return view.isConnected&&!!root.querySelector('[data-nutrition-tab].active');}
function open(selected){
  var day=typeof selected==='string'?selected:ui.today();
  var c=root.querySelector(".profile-content");if(!c)return;
  root.querySelectorAll(".profile-tabs button").forEach(function(b){b.classList.toggle("active",b.hasAttribute("data-nutrition-tab"));});
  c.innerHTML='<section class="portal-medical-view nutrition-view"><div class="nutrition-heading"><h2>التغذية</h2><button type="button" class="btn" data-refresh>تحديث</button></div><label class="nutrition-day">يوم المتابعة <input type="date" data-day max="'+ui.today()+'" value="'+esc(day)+'"></label><p class="nutrition-date-note">أكد تناول وجبات اليوم المختار. التواريخ وأوقات التأكيد بتوقيت القاهرة.</p><div data-list></div><p data-status role="status"></p><button type="button" class="btn" data-more hidden>عرض المزيد</button></section>';
  var view=c.firstElementChild,list=view.querySelector("[data-list]"),status=view.querySelector("[data-status]"),more=view.querySelector("[data-more]"),picker=view.querySelector('[data-day]'),offset=0,seenPatients=new Set(),pending=0;
  view.querySelector("[data-refresh]").onclick=function(){open(day);};
  picker.onchange=function(){if(picker.value&&picker.value<=ui.today())open(picker.value);};
  function load(){
    more.disabled=true;status.textContent="جاري تحميل زيارات التغذية…";
    invoke({op:"daily_overview",offset:offset,tracking_date:day}).then(function(data){
      if(!current(view))return;
      (data.visits||[]).forEach(function(v){
        var card=document.createElement("details");card.className="nutrition-visit-card";
        card.open=!seenPatients.has(v.patient_id);seenPatients.add(v.patient_id);
        var patient=v.patients||{},meals=Array.isArray(v.meals)?v.meals:[],states=new Map((v.completions||[]).map(function(r){return [r.meal_id,r];}));
        card.innerHTML='<summary><div><h4>'+esc(v.template_name_snapshot||'خطة التغذية')+'</h4><div class="nutrition-meta">'+esc(patient.full_name||"ملف المريض")+' · '+esc(patient.patient_code)+'<br>'+ui.date(v.visit_date)+(v.visit_time?' · '+esc(v.visit_time):'')+'<br>'+esc(v.doctor_name?'الطبيب · '+v.doctor_name:'الطبيب غير مسجل')+'</div></div></summary><div class="nutrition-visit-body"><div data-progress></div><div data-meals></div><details class="nutrition-legacy"><summary>تأكيدات سابقة قبل المتابعة اليومية</summary><p>هذه التأكيدات غير مرتبطة بيوم تناول محدد.</p>'+((v.legacy_completions||[]).length?ui.status(meals,v.legacy_completions):'<p>لا توجد تأكيدات سابقة.</p>')+'</details></div>';
        var container=card.querySelector('[data-meals]'),progress=card.querySelector('[data-progress]');
        function updateProgress(){var done=meals.filter(function(m){return states.get(m.id)&&states.get(m.id).completed;}).length;progress.innerHTML=meals.length?'<div class="nutrition-progress"><b>تم تأكيد '+done+' من '+meals.length+' وجبات</b><progress max="'+meals.length+'" value="'+done+'" aria-label="الوجبات المؤكدة"></progress></div>':'<p class="nutrition-empty">لم تُضف وجبات لهذه الزيارة.</p>';}
        updateProgress();
        if(day<v.visit_date)container.innerHTML='<p class="nutrition-empty">اليوم المختار قبل بداية هذه الخطة.</p>';
        meals.forEach(function(m){
          if(!m)return;
          var saved=states.get(m.id)||{completed:false};
          var row=document.createElement("div");row.className="nutrition-meal";
          row.innerHTML='<div><h4>'+esc(m.name||"وجبة")+'</h4><p>'+esc(Array.isArray(m.ingredients)?m.ingredients.join("، "):"")+'</p>'+(m.calories!=null?'<small>'+esc(m.calories)+' سعر حراري</small>':'')+'</div><label><input type="checkbox"> تناولت الوجبة</label><span role="status"></span>';
          var checkbox=row.querySelector("input"),message=row.querySelector('[role="status"]');
          function show(){checkbox.checked=saved.completed===true;message.textContent=saved.completed?'وقت التأكيد · '+ui.confirmed(saved.completed_at):'لم يتم التأكيد';}
          show();checkbox.disabled=typeof m.id!=="string"||!m.id||day<v.visit_date;
          checkbox.onchange=function(){
            var desired=checkbox.checked;checkbox.disabled=true;pending++;picker.disabled=true;message.textContent="جاري الحفظ…";
            invoke({op:"set_daily_completion",visit_id:v.id,meal_id:m.id,tracking_date:day,completed:desired}).then(function(data){
              if(!current(view))return;
              saved=data.completion;states.set(m.id,saved);show();updateProgress();
            }).catch(function(){if(current(view)){checkbox.checked=saved.completed===true;message.textContent="تعذر تأكيد الحفظ. حاول مرة أخرى أو حدّث البيانات.";}}).finally(function(){pending--;picker.disabled=pending>0;checkbox.disabled=false;});
          };
          container.appendChild(row);
        });
        list.appendChild(card);
      });
      offset=data.next_offset;more.hidden=offset===null;more.textContent="عرض المزيد";
      status.textContent=list.children.length?"":"لا توجد زيارات تغذية متاحة لحسابك.";
    }).catch(function(){if(current(view)){status.textContent="تعذر تحميل التغذية. حاول مرة أخرى.";more.hidden=false;more.textContent="إعادة المحاولة";}}).finally(function(){more.disabled=false;});
  }
  more.onclick=load;load();
}
function attach(){var tabs=root.querySelector(".profile-tabs");if(!tabs||tabs.querySelector("[data-nutrition-tab]"))return;var b=document.createElement("button");b.type="button";b.className="medical-tab";b.setAttribute("data-nutrition-tab","");b.textContent="التغذية";b.onclick=function(e){e.preventDefault();open();};tabs.appendChild(b);}
attach();new MutationObserver(attach).observe(root,{childList:true,subtree:true});
})();
