(function(){
"use strict";
var root=document.getElementById("portal-root"),cfg=window.SSMPD_CONFIG&&window.SSMPD_CONFIG.supabase;
if(!root||!cfg||!window.supabase)return;
var client=window.supabase.createClient(cfg.url,cfg.anonKey,{auth:{persistSession:true,autoRefreshToken:true,storageKey:"swnw-patient-portal-auth"}});
function esc(v){return String(v==null?"":v).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;")}
function invoke(body){return client.functions.invoke("patient-portal-medications",{body:body}).then(function(r){if(r.error||!r.data||r.data.error)throw new Error("request failed");return r.data})}
function time(v){var p=String(v||"").slice(0,5).split(":"),h=Number(p[0]);return p.length===2?(h%12||12)+":"+p[1]+(h>=12?" مساءً":" صباحًا"):""}
function freq(m){return m.frequency_hours%24===0?"كل "+(m.frequency_hours/24)+" يوم":"كل "+m.frequency_hours+" ساعات"}
function nowMinutes(){var p=new Intl.DateTimeFormat("en-GB",{timeZone:"Africa/Cairo",hour:"2-digit",minute:"2-digit",hourCycle:"h23"}).formatToParts(new Date()),x={};p.forEach(function(a){x[a.type]=a.value});return Number(x.hour)*60+Number(x.minute)}
function due(d){var p=String(d.scheduled_time||"").split(":");return Number(p[0])*60+Number(p[1])}
function doseState(d){if(d.completion&&d.completion.status==="taken")return"taken";if(d.completion&&d.completion.status==="missed")return"missed";return due(d)<nowMinutes()?"late":"upcoming"}
function remaining(d){var minutes=due(d)-nowMinutes();if(minutes<=0)return"";var hours=Math.floor(minutes/60),mins=minutes%60,parts=[];if(hours)parts.push(hours+" "+(hours===1?"ساعة":"ساعات"));if(mins)parts.push(mins+" دقيقة");return parts.length?"متبقي "+parts.join(" و"):"متبقي أقل من دقيقة"}
function label(s){return s==="taken"?"تم أخذها":s==="missed"?"لم تؤخذ":s==="late"?"فات موعدها":"الجرعة القادمة"}
function sharedInstruction(rows){var a=(rows[0].medicine.instructions||"").trim();return a&&rows.every(function(x){return (x.medicine.instructions||"").trim()===a})?a:""}
function sharedDoctor(rows){var a=((rows[0].medicine.visit||{}).doctor_name||"").trim();return a&&rows.every(function(x){return ((x.medicine.visit||{}).doctor_name||"").trim()===a})?a:""}
function setActive(){var tabs=root.querySelector(".profile-tabs");if(tabs)tabs.querySelectorAll("button").forEach(function(b){b.classList.toggle("active",b.getAttribute("data-medical-tab")==="prescriptions")})}
function groups(meds){var out={},list=[];meds.forEach(function(m){(m.doses||[]).forEach(function(d){var key=d.scheduled_key;if(!out[key]){out[key]={key:key,time:d.scheduled_time,rows:[]};list.push(out[key])}out[key].rows.push({medicine:m,dose:d})})});return list.sort(function(a,b){return a.key.localeCompare(b.key)})}
function open(){
 var c=root.querySelector(".profile-content");if(!c)return;setActive();
 c.innerHTML='<section class="portal-medical-view medication-view"><header class="medication-page-head"><div><span>خطة العلاج</span><h2>الأدوية اليوم</h2><p>سجّل الجرعة بعد أخذها ليظهر الالتزام للفريق المعالج.</p></div><button class="medication-refresh" type="button" data-refresh aria-label="تحديث">تحديث</button></header><div class="medication-summary" data-summary></div><div class="medication-day" data-day></div><div class="medication-slots" data-list></div><p class="medication-status" data-status></p></section>';
 var view=c.firstElementChild,list=view.querySelector("[data-list]"),status=view.querySelector("[data-status]"),summary=view.querySelector("[data-summary]");
 view.querySelector("[data-refresh]").onclick=open;status.textContent="جاري تحميل جدول الجرعات…";
 invoke({op:"overview"}).then(function(data){
  if(!view.isConnected)return;
  view.querySelector("[data-day]").textContent="جدول جرعات اليوم · "+data.day;
  var meds=data.medications||[],all=[];meds.forEach(function(m){(m.doses||[]).forEach(function(d){all.push(d)})});
  var taken=all.filter(function(d){return doseState(d)==="taken"}).length,missed=all.filter(function(d){return doseState(d)==="missed"||doseState(d)==="late"}).length,pending=all.length-taken-missed;
  summary.innerHTML='<div><b>'+taken+' من '+all.length+'</b><span>جرعات تم تسجيلها اليوم</span></div><progress max="'+Math.max(all.length,1)+'" value="'+taken+'"></progress><div class="summary-counts"><span class="taken">'+taken+' تم أخذها</span><span class="upcoming">'+pending+' قادمة</span>'+(missed?'<span class="missed">'+missed+' تحتاج تسجيلًا</span>':'')+'</div>';
  if(!meds.length){list.innerHTML='<div class="medication-empty">لا توجد جرعات مجدولة لليوم.</div>';status.textContent="";return}
  groups(meds).forEach(function(slot){
   var states=slot.rows.map(function(x){return doseState(x.dose)}),state=states.indexOf("missed")>=0||states.indexOf("late")>=0?"late":states.every(function(x){return x==="taken"})?"taken":"upcoming",instruction=sharedInstruction(slot.rows),doctor=sharedDoctor(slot.rows);
   var card=document.createElement("section");card.className="medication-slot slot-"+state;
   card.innerHTML='<div class="slot-head"><div class="slot-state"><span class="slot-icon"></span><div><h3>'+esc(time(slot.time))+'</h3><p>'+esc(label(state))+(state==="upcoming"&&remaining(slot.rows[0].dose)?" · "+esc(remaining(slot.rows[0].dose)):"")+'</p></div></div>'+((doctor||instruction)?'<div class="slot-side">'+(doctor?'<span class="dose-doctor">الطبيب: '+esc(doctor)+'</span>':'')+(instruction?'<span class="dose-instruction">'+esc(instruction)+'</span>':'')+'</div>':'')+'</div><div class="slot-medications"></div>';
   var rows=card.querySelector(".slot-medications");
   slot.rows.forEach(function(x){
    var m=x.medicine,d=x.dose,state=doseState(d),row=document.createElement("article");row.className="scheduled-medication";
    row.innerHTML=[
      '<div class="medicine-copy"><h4>',esc(m.medicine_name),
      m.strength?' <small>'+esc(m.strength)+'</small>':'',
      '</h4><p>',esc(m.dosage||"الجرعة غير مسجلة"),' · ',esc(freq(m)),' · لمدة ',esc(m.duration_days),' يوم</p>',
      (!instruction&&m.instructions?'<span class="dose-instruction">'+esc(m.instructions)+'</span>':''),
      '</div><div class="dose-actions"><span class="dose-confirmation"></span><div><button type="button" class="dose-taken" data-taken>تم أخذها</button><button type="button" class="dose-missed" data-missed>لم تؤخذ</button></div></div>'
    ].join("");
    var note=row.querySelector(".dose-confirmation"),takenBtn=row.querySelector("[data-taken]"),missedBtn=row.querySelector("[data-missed]");
    function draw(){state=doseState(d);row.dataset.state=state;takenBtn.classList.toggle("active",state==="taken");missedBtn.classList.toggle("active",state==="missed");note.textContent=state==="taken"?(d.completion&&d.completion.taken_at?"تم التسجيل":"تم أخذها"):state==="missed"?"تم تسجيل عدم الأخذ":state==="late"?"فات موعد الجرعة":"";
    }function save(next){takenBtn.disabled=missedBtn.disabled=true;note.textContent="جاري الحفظ…";invoke({op:"set_dose",medication_id:m.id,scheduled_key:d.scheduled_key,status:next}).then(function(res){d.completion=res.completion;draw();open()}).catch(function(){note.textContent="تعذر الحفظ. حاول مرة أخرى."}).finally(function(){takenBtn.disabled=missedBtn.disabled=false})}
    takenBtn.onclick=function(){save("taken")};missedBtn.onclick=function(){save("missed")};draw();rows.appendChild(row);
   });list.appendChild(card);
  });status.textContent="";
 }).catch(function(){if(view.isConnected)status.textContent="تعذر تحميل جدول الأدوية. حاول مرة أخرى."});
}
root.addEventListener("click",function(e){var b=e.target.closest('.profile-tabs [data-medical-tab="prescriptions"]');if(!b)return;e.preventDefault();e.stopImmediatePropagation();open()},true);
})();