(function(){
"use strict";

var cfg=window.SSMPD_CONFIG&&window.SSMPD_CONFIG.supabase;
var root=document.getElementById("portal-root");
if(!cfg||!cfg.url||!cfg.anonKey||!root||!window.supabase)return;

var client=window.supabase.createClient(cfg.url,cfg.anonKey,{
  auth:{persistSession:true,autoRefreshToken:true,storageKey:"swnw-patient-portal-auth"}
});
var medicalCache=null,medicalCacheAt=0,statusCache=null,statusCacheAt=0,enhancing=false;

var TYPE_LABELS={
  checkup:"كشف",follow_up:"متابعة",emergency:"طوارئ",session:"جلسة",
  lab:"تحليل",radiology:"أشعة",home_visit:"زيارة منزلية"
};

function esc(v){return String(v==null?"":v).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;");}
function fmtDate(v){
  if(!v)return "—";
  var d=new Date(String(v).length===10?v+"T00:00:00":v);
  if(isNaN(d.getTime()))return esc(v);
  return new Intl.DateTimeFormat("ar-EG",{year:"numeric",month:"long",day:"numeric"}).format(d);
}
function invoke(name,body){
  return client.functions.invoke(name,{body:body}).then(function(r){
    if(r.error){
      var ctx=r.error&&r.error.context;
      if(ctx&&typeof ctx.clone==="function"){
        return ctx.clone().json().then(function(p){throw new Error(p&&p.error?p.error:(r.error.message||String(r.error)));});
      }
      throw r.error;
    }
    if(r.data&&r.data.error)throw new Error(r.data.error);
    return r.data||{};
  });
}
function getMedical(){
  if(medicalCache&&Date.now()-medicalCacheAt<30000)return Promise.resolve(medicalCache);
  return invoke("patient-portal-medical-data",{op:"overview"}).then(function(d){medicalCache=d||{records:[]};medicalCacheAt=Date.now();return medicalCache;});
}
function getStatus(force){
  if(!force&&statusCache&&Date.now()-statusCacheAt<15000)return Promise.resolve(statusCache);
  return invoke("patient-portal-experience",{op:"status"}).then(function(d){statusCache=d||{rated_visit_ids:[]};statusCacheAt=Date.now();return statusCache;});
}
function toast(text,type){
  var old=document.querySelector(".experience-toast");if(old)old.remove();
  var el=document.createElement("div");el.className="experience-toast "+(type||"");el.textContent=text;document.body.appendChild(el);
  requestAnimationFrame(function(){el.classList.add("show");});
  setTimeout(function(){el.classList.remove("show");setTimeout(function(){el.remove();},180);},3200);
}
function questionsFor(type){
  var q2="كيف تقيم تواصل الطبيب واحترافيته؟";
  var q3="هل شرح لك الطبيب حالتك والعلاج بشكل واضح؟";
  if(type==="lab"||type==="radiology"){
    q2="كيف تقيم تعامل فريق الخدمة واحترافيته؟";
    q3="هل تم شرح خطوات الخدمة والتعليمات بشكل واضح؟";
  }else if(type==="session"){
    q2="كيف تقيم تواصل الأخصائي واحترافيته؟";
    q3="هل شرح لك الأخصائي خطة الجلسة والتعليمات بشكل واضح؟";
  }else if(type==="home_visit"){
    q2="كيف تقيم تواصل مقدم الخدمة واحترافيته؟";
    q3="هل تم شرح حالتك والخطة أو التعليمات بشكل واضح؟";
  }
  return [
    "كيف كانت تجربتك في التعامل مع طاقم الاستقبال؟",
    q2,
    q3,
    "ما مدى رضاك عن جودة الخدمة بشكل عام؟",
    "من وجهة نظرك هل كانت تكلفة الخدمة مناسبة؟",
    "إلى أي مدى قد ترشح عيادات SwnW لعائلتك وأصدقائك؟"
  ];
}
function scoreRow(i){
  return '<div class="experience-score" role="radiogroup">'+[1,2,3,4,5].map(function(n){
    return '<label><input type="radio" name="experience-q'+i+'" value="'+n+'"><span>'+n+'</span></label>';
  }).join("")+'</div><div class="experience-score-ends"><span>غير راضٍ</span><span>راضٍ جدًا</span></div>';
}
function openModal(item,button){
  var v=item.visit||{},p=item.patient||{},type=v.encounter_type||"checkup",questions=questionsFor(type);
  var backdrop=document.createElement("div");backdrop.className="experience-modal-backdrop";
  backdrop.innerHTML='<div class="experience-modal" role="dialog" aria-modal="true" aria-label="قيّم تجربتك">'+
    '<div class="experience-modal-head"><div><span>تجربتك تهمنا</span><h2>قيّم تجربتك</h2></div><button type="button" class="experience-close" aria-label="إغلاق">×</button></div>'+
    '<div class="experience-service-summary"><div><small>الخدمة</small><b>'+esc(TYPE_LABELS[type]||"زيارة")+'</b></div><div><small>التاريخ</small><b>'+fmtDate(v.visit_date)+'</b></div>'+(v.doctor_name?'<div><small>الطبيب / مقدم الخدمة</small><b>'+esc(v.doctor_name)+'</b></div>':'')+'</div>'+
    '<p class="experience-intro">نسعى دائمًا لتحسين جودة الخدمة. التقييم مرتبط بهذه الخدمة تلقائيًا ولن تحتاج لاختيار التاريخ أو الملف يدويًا.</p>'+
    '<div class="experience-questions">'+questions.map(function(q,i){return '<section class="experience-question"><h3>'+(i+1)+'. '+esc(q)+'</h3>'+scoreRow(i)+'</section>';}).join("")+'</div>'+
    '<div class="experience-comment"><label for="experience-comment">تعليق إضافي <span>(اختياري)</span></label><textarea id="experience-comment" maxlength="1000" placeholder="اكتب أي ملاحظة تساعدنا على تحسين تجربتك"></textarea></div>'+
    '<div class="experience-actions"><button type="button" class="experience-submit">حفظ التقييم</button></div>'+
  '</div>';
  document.body.appendChild(backdrop);
  var close=function(){backdrop.remove();};
  backdrop.querySelector(".experience-close").onclick=close;
  backdrop.onclick=function(e){if(e.target===backdrop)close();};
  backdrop.querySelector(".experience-submit").onclick=function(){
    var submit=this,ratings=[];
    for(var i=0;i<questions.length;i++){
      var checked=backdrop.querySelector('input[name="experience-q'+i+'"]:checked');
      if(!checked){toast("جاوب على كل أسئلة التقييم الأول.","error");return;}
      ratings.push(Number(checked.value));
    }
    submit.disabled=true;submit.textContent="جاري حفظ التقييم…";
    invoke("patient-portal-experience",{op:"submit",visit_id:v.id,ratings:ratings,comment:(backdrop.querySelector("#experience-comment").value||"").trim()}).then(function(){
      statusCacheAt=0;
      if(button){button.disabled=true;button.classList.add("rated");button.textContent="✓ تم تقييم تجربتك";}
      close();toast("شكرًا لك. تم حفظ تقييم تجربتك.","ok");
    }).catch(function(e){
      var m=String(e&&e.message||e||"");
      if(m.indexOf("ALREADY_RATED")>=0){
        if(button){button.disabled=true;button.classList.add("rated");button.textContent="✓ تم تقييم تجربتك";}
        close();toast("تم تقييم هذه الخدمة بالفعل.","ok");return;
      }
      submit.disabled=false;submit.textContent="حفظ التقييم";toast("تعذر حفظ التقييم الآن. حاول مرة أخرى.","error");
      console.error("patient portal experience",e);
    });
  };
}
function currentFilter(){
  var b=root.querySelector('.encounter-filters [data-visit-filter].active');
  return b?b.getAttribute("data-visit-filter")||"all":"all";
}
function flattened(data,filter){
  var items=[];
  (data.records||[]).forEach(function(r){
    (r.visits||[]).forEach(function(v){
      var type=v.encounter_type||"checkup";
      if(filter==="all"||type===filter)items.push({patient:r.patient||{},visit:v});
    });
  });
  return items;
}
function enhanceVisits(){
  if(enhancing||!root.querySelector(".unified-visits-view"))return;
  enhancing=true;
  Promise.all([getMedical(),getStatus(false).catch(function(){return {rated_visit_ids:[]};})]).then(function(res){
    if(!root.querySelector(".unified-visits-view"))return;
    var data=res[0],rated=new Set((res[1].rated_visit_ids||[]).map(String)),items=flattened(data,currentFilter());
    var cards=Array.prototype.slice.call(root.querySelectorAll(".unified-visit-card"));
    cards.forEach(function(card,i){
      var item=items[i];if(!item||!item.visit||!item.visit.id)return;
      card.setAttribute("data-visit-id",item.visit.id);
      if(card.querySelector(".experience-visit-action"))return;
      var wrap=document.createElement("div");wrap.className="experience-visit-action";
      var btn=document.createElement("button");btn.type="button";btn.className="experience-rate-btn";
      if(rated.has(String(item.visit.id))){btn.disabled=true;btn.classList.add("rated");btn.textContent="✓ تم تقييم تجربتك";}
      else{btn.textContent="⭐ قيّم تجربتك";btn.onclick=function(){openModal(item,btn);};}
      wrap.appendChild(btn);card.appendChild(wrap);
    });
  }).catch(function(e){console.error("experience enhance",e);}).finally(function(){enhancing=false;});
}
function scheduleEnhance(){[80,220,500,1000].forEach(function(ms){setTimeout(enhanceVisits,ms);});}

document.addEventListener("click",function(e){
  var t=e.target&&e.target.closest?e.target.closest('[data-extra-tab="visits"],[data-visit-filter]'):null;
  if(t)scheduleEnhance();
},true);

scheduleEnhance();
})();
