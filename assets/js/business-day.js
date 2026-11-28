/* «يوم العمل» (owner 2026-11-27 «موافق، ساعة القفل 4 الفجر ولكن عايز يبقي عندي اوبشن اغيرها بعدين», server 20261127340000).
   Anything before the cutoff (Cairo time, default 04:00) belongs to the PREVIOUS working day. The ONE client helper:
     SSMPDBusinessDay.today()      → 'YYYY-MM-DD' of the working day now
     SSMPDBusinessDay.of(ts)       → working day of a moment
     SSMPDBusinessDay.cutoff       → 'HH:MM' (from public.clinic_reception_business_day('get'), cached; 04:00 until it loads)
     SSMPDBusinessDay.load()       → refresh the cutoff from the server
     SSMPDBusinessDay.openEditor(modal) → «ساعة قفل اليوم» window for super_admin / general_manager (reason required, logged). */
(function(w){'use strict';
var KEY='swnw-business-day-cutoff',st={cutoff:'04:00',canSet:false,history:[],loaded:false,flight:null};
try{var c0=w.localStorage&&w.localStorage.getItem(KEY);if(/^\d\d:\d\d$/.test(c0||''))st.cutoff=c0;}catch(e){}
function mins(hhmm){var m=String(hhmm||'04:00').match(/^(\d\d):(\d\d)/);return m?(+m[1])*60+(+m[2]):240;}
function cairo(ts){var o={};new Intl.DateTimeFormat('en-CA',{timeZone:'Africa/Cairo',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23'})
 .formatToParts(ts instanceof Date?ts:new Date(ts==null?Date.now():ts)).forEach(function(p){o[p.type]=p.value;});return o;}
function of(ts){var p=cairo(ts),d=Date.UTC(+p.year,+p.month-1,+p.day);if((+p.hour)*60+(+p.minute)<mins(st.cutoff))d-=86400000;
 return new Date(d).toISOString().slice(0,10);}
function today(){return of(Date.now());}
function esc(v){return String(v==null?'':v).replace(/[&<>"']/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c];});}
function rpc(name,args){var C=w.SSMPDDb&&w.SSMPDDb.client;if(!C)return Promise.reject(Error('الاتصال مش جاهز — حدّث الصفحة'));
 return C.rpc(name,args).then(function(r){if(r&&r.error)throw r.error;return r?r.data:null;});}
function load(){if(st.flight)return st.flight;
 st.flight=rpc('clinic_reception_business_day',{p_action:'get',p_payload:{}}).then(function(d){if(d&&/^\d\d:\d\d$/.test(d.cutoff||'')){st.cutoff=d.cutoff;try{w.localStorage.setItem(KEY,d.cutoff);}catch(e){}}
  st.canSet=!!(d&&d.can_set);st.history=(d&&d.history)||[];st.loaded=true;st.flight=null;return api;},function(e){st.flight=null;throw e;});return st.flight;}
function openEditor(modal){if(typeof modal!=='function')return null;
 var hist=(st.history||[]).map(function(h){return '<li><b dir="ltr">'+esc(h.old)+' ← '+esc(h.new)+'</b> · '+esc(h.by||'')+' · <span dir="ltr">'+esc(String(h.at||'').slice(0,16).replace('T',' '))+'</span><br><small>'+esc(h.reason)+'</small></li>';}).join('');
 var m=modal('ساعة قفل اليوم','<p class="bd-hint" data-wide>أي شغل قبل الساعة دي (بتوقيت القاهرة) بيتحسب على اليوم اللي فات — «تشغيل اليوم» و«النهارده» و«تحصيلاتي». الساعة دلوقتي: <b dir="ltr" data-bd-now>'+esc(st.cutoff)+'</b> · يوم العمل الحالي: <b dir="ltr">'+esc(today())+'</b></p>'+
  '<label>ساعة القفل الجديدة<input type="time" name="cutoff" required min="00:00" max="08:00" value="'+esc(st.cutoff)+'" data-bd-cutoff></label>'+
  '<label data-wide>السبب (إجباري)<input name="reason" required minlength="3" maxlength="300" data-bd-reason></label>'+
  (hist?'<details data-wide class="bd-hist"><summary>آخر التغييرات</summary><ul>'+hist+'</ul></details>':''),
  function(v){return rpc('clinic_reception_business_day',{p_action:'set',p_payload:{cutoff:v.cutoff,reason:v.reason}}).then(function(r){
   if(r&&r.cutoff){st.cutoff=r.cutoff;try{w.localStorage.setItem(KEY,r.cutoff);}catch(e){}}if(w.SSMPDToast&&w.SSMPDToast.show)w.SSMPDToast.show(r&&r.changed?'اتغيرت ساعة قفل اليوم لـ '+r.cutoff:'مفيش تغيير','success');return load().catch(function(){});});},
  null,{ok:'حفظ',cancel:'تراجع'});
 return m;}
var api={today:today,of:of,load:load,openEditor:openEditor,get cutoff(){return st.cutoff;},get canSet(){return st.canSet;},_set:function(c){st.cutoff=c;}};
w.SSMPDBusinessDay=api;
function boot(n){if(w.SSMPDDb&&w.SSMPDDb.client&&w.SSMPDAuth&&w.SSMPDAuth.currentAdmin){load().catch(function(){});return;}if((n||0)<60)w.setTimeout(function(){boot((n||0)+1);},1000);}
if(w.setTimeout)w.setTimeout(boot,0);
})(window);
