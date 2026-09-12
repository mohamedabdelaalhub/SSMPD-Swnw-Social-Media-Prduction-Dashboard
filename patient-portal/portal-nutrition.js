(function(){
"use strict";
var root=document.getElementById("portal-root"),cfg=window.SSMPD_CONFIG&&window.SSMPD_CONFIG.supabase;
if(!root||!cfg||!window.supabase)return;
var client=window.supabase.createClient(cfg.url,cfg.anonKey,{auth:{persistSession:true,autoRefreshToken:true,storageKey:"swnw-patient-portal-auth"}});
function esc(v){return String(v==null?"":v).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;");}
function invoke(body){return client.functions.invoke("patient-portal-nutrition",{body:body}).then(function(r){if(r.error||!r.data||r.data.error)throw new Error("request failed");return r.data;});}
function current(view){return view.isConnected&&!!root.querySelector('[data-nutrition-tab].active');}
function open(){
  var c=root.querySelector(".profile-content");if(!c)return;
  root.querySelectorAll(".profile-tabs button").forEach(function(b){b.classList.toggle("active",b.hasAttribute("data-nutrition-tab"));});
  c.innerHTML='<section class="portal-medical-view nutrition-view"><div class="nutrition-heading"><h2>التغذية</h2><button type="button" class="btn" data-refresh>تحديث</button></div><p>أكد تناول كل وجبة في زيارة التغذية المسجلة.</p><div data-list></div><p data-status role="status"></p><button type="button" class="btn" data-more hidden>عرض المزيد</button></section>';
  var view=c.firstElementChild,list=view.querySelector("[data-list]"),status=view.querySelector("[data-status]"),more=view.querySelector("[data-more]"),offset=0;
  view.querySelector("[data-refresh]").onclick=open;
  function load(){
    more.disabled=true;status.textContent="جاري تحميل زيارات التغذية…";
    invoke({op:"overview",offset:offset}).then(function(data){
      if(!current(view))return;
      (data.visits||[]).forEach(function(v){
        var card=document.createElement("article");card.className="medical-record-card nutrition-card";
        var patient=v.patients||{};
        card.innerHTML='<h3>'+esc(patient.full_name||"ملف المريض")+'</h3><p>'+esc(patient.patient_code)+' · '+esc(v.visit_date)+(v.doctor_name?' · '+esc(v.doctor_name):'')+'</p><h4>'+esc(v.template_name_snapshot||"الوجبات المسجلة")+'</h4>';
        var meals=Array.isArray(v.meals)?v.meals:[];
        if(!meals.length)card.insertAdjacentHTML("beforeend",'<p>لا توجد وجبات مسجلة لهذه الزيارة.</p>');
        meals.forEach(function(m){
          if(!m)return;
          var saved=(v.completions||[]).find(function(x){return x.meal_id===m.id;})||{completed:false};
          var row=document.createElement("div");row.className="nutrition-meal";
          row.innerHTML='<div><h4>'+esc(m.name||"وجبة")+'</h4><p>'+esc(Array.isArray(m.ingredients)?m.ingredients.join("، "):"")+'</p>'+(m.calories!=null?'<small>'+esc(m.calories)+' سعر حراري</small>':'')+'</div><label><input type="checkbox"> تناولت الوجبة</label><span role="status"></span>';
          var checkbox=row.querySelector("input"),message=row.querySelector('[role="status"]');
          checkbox.checked=saved.completed===true;checkbox.disabled=typeof m.id!=="string"||!m.id;
          checkbox.onchange=function(){
            var desired=checkbox.checked;checkbox.disabled=true;message.textContent="جاري الحفظ…";
            invoke({op:"set_completion",visit_id:v.id,meal_id:m.id,completed:desired}).then(function(data){
              if(!current(view))return;
              saved=data.completion;checkbox.checked=saved.completed===true;
              message.textContent="تم الحفظ";
            }).catch(function(){if(current(view)){checkbox.checked=saved.completed===true;message.textContent="تعذر تأكيد الحفظ. حاول مرة أخرى أو حدّث البيانات.";}}).finally(function(){checkbox.disabled=false;});
          };
          card.appendChild(row);
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
