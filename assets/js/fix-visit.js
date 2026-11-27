/* «في غلط في زيارة أو حساب مريض» (owner «طبقه» 2026-11-26, mockup docs/ui-references/mockups/fix-visit-panel.html, help 295).
   One panel for the reception: pick today's patient → see the visit's journey (اتحجز / وصل / اتنادى / دخل يكشف / خلّص), which step is
   missing and why collection is not showing yet → the same buttons the «تشغيل اليوم» card already has (change service, reschedule,
   discount details, collect, «الزيارة اتسجلت غلط», reopen before collection). NO new action and NO RPC: every button goes through
   SSMPDTodayOps.press, i.e. the real card handler, and a button is listed only when the card would show it to this role.
   «نسبة الدكتور» is not editable per visit (no server action) and «تعديل تفاصيل الخصم» after arrival is NOT offered (no server action
   yet): the card itself only offers the discount edit before arrival. Entry: SSMPDFixVisit.open() ← «عايز تعمل كذا؟» (reception-drawer.js). */
(function(w,d){'use strict';
var STEPS=['اتحجز','وصل','اتنادى عليه','دخل يكشف','خلّص'];
var REACHED={expected:0,on_the_way:0,waiting:1,called:2,in_service:3,on_hold:3,completed:4};
var WHY={expected:'المريض لسه ما وصلش. لما يوصل دوس «وصل»، وبعدها «نادي».',on_the_way:'المريض في الطريق. لما يوصل دوس «وصل»، وبعدها «نادي».',
 waiting:'المريض وصل لكن لسه ما اتنادّاش عليه. التحصيل بيظهر بعد ما يدخل الكشف وتنهي الزيارة.',
 called:'المريض اتنادى عليه لكن لسه ما دخلش الكشف. التحصيل بيظهر بعد «إنهاء الزيارة».',
 in_service:'المريض جوه الكشف. التحصيل بيظهر لما تدوس «إنهاء الزيارة».',
 on_hold:'المريض مستني نتيجة تحليل أو إجراء. بعد ما يرجع للدكتور وتنهي الزيارة بيظهر التحصيل.'};
var ORDER={completed:0,in_service:1,on_hold:1,called:2,waiting:3,expected:4,on_the_way:4};
/* the card buttons this panel re-offers, in this order; hint = small grey line, label = fixed text (null = the card's own label) */
var ACTS=[['change_service','تغيير الخدمة','يلغي الخدمة القديمة ويضيف الجديدة'],['reschedule','تغيير اليوم والساعة','تعديل الحجز'],
 ['booking_discount','تعديل تفاصيل الخصم','النسبة، نوع الخصم، النقابة — قبل الوصول'],['visit_discount',null,'قبل التحصيل'],['visit_same_discount',null,'نفس خصم الزيارة'],
 ['visit_reopen',null,'إعادة فتح الزيارة قبل التحصيل'],['collect_due',null,'تحصيل الباقي'],['visit_void','الزيارة اتسجلت غلط','طلب للحسابات']];
function esc(v){return String(v==null?'':v).replace(/[&<>"']/g,function(c){return{'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c];});}
function toast(m,k){if(w.SSMPDToast&&w.SSMPDToast.show)w.SSMPDToast.show(m,k||'info');}
function T(){return w.SSMPDTodayOps;}
function hhmm(v){var t=new Date(v);if(isNaN(t))return '';return new Intl.DateTimeFormat('ar-EG-u-nu-latn',{timeZone:'Africa/Cairo',hour:'numeric',minute:'2-digit'}).format(t);}
function money(n){return Number(n||0).toLocaleString('en-US',{maximumFractionDigits:2})+' ج.م';}
function cairoDay(){if(window.SSMPDBusinessDay)return window.SSMPDBusinessDay.today();/* «يوم العمل» 20261127340000 */return new Intl.DateTimeFormat('en-CA',{timeZone:'Africa/Cairo',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());}
function reached(q){return REACHED[q]==null?0:REACHED[q];}
function liveList(){return T().appointments().filter(function(a){return a.queue_status!=='cancelled'&&a.queue_status!=='no_show';}).sort(function(x,y){var o=(ORDER[x.queue_status]==null?9:ORDER[x.queue_status])-(ORDER[y.queue_status]==null?9:ORDER[y.queue_status]);return o||String(x.starts_at).localeCompare(String(y.starts_at));});}
function rowNote(a){var q=a.queue_status,hasDue=a.can_view_finance&&Number(a.patient_due)>0;
 if(q==='completed')return hasDue?{t:'خلّص — التحصيل جاهز: '+money(a.patient_due),hi:Number(a.patient_paid)>0?false:true}:{t:'خلّص'+(a.can_view_finance&&Number(a.patient_paid)>0?' — اتحصّل':''),hi:false};
 if(WHY[q]&&reached(q)>=1)return {t:'لسه ما خلّصش — الخطوة الجاية: '+STEPS[reached(q)+1],hi:true};
 return {t:(q==='on_the_way'?'في الطريق':'حجز '+hhmm(a.starts_at)+' — لسه ما وصلش'),hi:false};}
function stepsHtml(q){var r=reached(q);return '<div class="fv-steps">'+STEPS.map(function(s,i){return '<div class="fv-st'+(i<=r?' ok':(i===r+1?' miss':''))+'">'+esc(s)+(i<=r?' ✓':'')+'</div>';}).join('')+'</div>';}
function whyHtml(a){var q=a.queue_status,hasDue=a.can_view_finance&&Number(a.patient_due)>0;
 if(q==='completed'){if(hasDue)return 'الزيارة خلّصت والمطلوب '+money(a.patient_due)+' — دوس «حصّل».';
  return Number(a.patient_paid)>0?'اتحصّل على الزيارة دي بالكامل.':'مفيش مبلغ مطلوب على الزيارة دي. راجع الخدمة أو الخصم لو ده غلط.';}
 return WHY[q]||'';}

function close(){var m=d.querySelector('[data-fv]');if(m)m.remove();}
function shell(){close();var m=d.createElement('div');m.className='fv-sheet';m.setAttribute('data-fv','');m.setAttribute('role','dialog');m.setAttribute('aria-modal','true');m.setAttribute('aria-label','في غلط في زيارة أو حساب مريض');
 m.innerHTML='<div class="fv-box"><div class="fv-h"><b data-fv-title></b><button type="button" class="btn" data-fv-close aria-label="إغلاق">✕</button></div><div data-fv-body></div></div>';d.body.appendChild(m);
 m.addEventListener('click',function(e){if(e.target===m)close();});m.querySelector('[data-fv-close]').onclick=close;
 d.addEventListener('keydown',function k(e){if(e.key==='Escape'){close();d.removeEventListener('keydown',k);}});return m;}
function picker(m){var rows=liveList(),day=T().day(),title=m.querySelector('[data-fv-title]'),body=m.querySelector('[data-fv-body]');
 title.textContent='مين المريض؟';
 body.innerHTML='<input type="search" class="fv-q" data-fv-q placeholder="اكتب اسم المريض أو التليفون أو رقم الملف" aria-label="دوّر">'+(day!==cairoDay()?'<p class="fv-note">الشاشة بتعرض يوم '+esc(day)+' مش النهارده.</p>':'')+
  '<div class="fv-list" data-fv-list></div><p class="fv-note">المريض اللي لسه ما خلّصش بيظهر عليه الخطوة الجاية.</p>';
 var list=body.querySelector('[data-fv-list]');
 function paint(){var v=String(body.querySelector('[data-fv-q]').value||'').trim().toLowerCase();
  var shown=rows.filter(function(a){return !v||[a.patient_name,a.phone,a.file_no].some(function(x){return String(x||'').toLowerCase().indexOf(v)>=0;});});
  list.innerHTML=shown.length?shown.map(function(a){var n=rowNote(a);return '<button type="button" class="fv-li'+(n.hi?' hi':'')+'" data-fv-pick="'+esc(a.id)+'"><span>'+esc(a.patient_name||'مريض')+(a.provider_name?' · '+esc(a.provider_name):'')+'<small>'+esc(n.t)+'</small></span><em>←</em></button>';}).join(''):'<p class="fv-note">مفيش حجوزات تطابق البحث.</p>';
  list.querySelectorAll('[data-fv-pick]').forEach(function(b){b.onclick=function(){panel(m,b.getAttribute('data-fv-pick'));};});}
 body.querySelector('[data-fv-q]').oninput=paint;paint();}
function panel(m,id){var a=T().appointments().filter(function(x){return x.id===id;})[0];if(!a){picker(m);return;}
 var acts=T().actions(id),by={};acts.forEach(function(x){if(!by[x.name])by[x.name]=x;});
 var next=acts.filter(function(x){return x.primary;})[0]||null;
 var title=m.querySelector('[data-fv-title]'),body=m.querySelector('[data-fv-body]');title.textContent=(a.patient_name||'مريض')+(a.service_name?' · '+a.service_name:'')+(a.provider_name?' · '+a.provider_name:'');
 var btns=ACTS.filter(function(r){return by[r[0]]&&!(next&&next.name===r[0]);}).map(function(r){var x=by[r[0]];return '<button type="button" class="btn fv-act" data-fv-act="'+esc(x.name)+'" data-fv-id="'+esc(x.id)+'" data-fv-v2="'+(x.v2?'1':'')+'"><span>'+esc(r[1]||x.label)+'</span><small>'+esc(r[2])+'</small></button>';}).join('');
 var canFix=!!(by.change_service||by.visit_void);
 body.innerHTML='<button type="button" class="btn fv-back" data-fv-back>← مريض تاني</button>'+stepsHtml(a.queue_status)+'<p class="fv-why" data-fv-why>'+esc(whyHtml(a))+'</p>'+
  (next?'<button type="button" class="btn btn-primary fv-next" data-fv-act="'+esc(next.name)+'" data-fv-id="'+esc(next.id)+'" data-fv-v2="'+(next.v2?'1':'')+'">الخطوة الجاية: '+esc(next.label)+'</button>':'')+
  (btns?'<div class="fv-acts">'+btns+'</div>':(next?'':'<p class="fv-note">مفيش إجراء متاح ليك على الزيارة دي دلوقتي.</p>'))+
  (canFix?'<p class="fv-note">نسبة الدكتور بتتحسب من عقده ومابتتعدّلش لزيارة واحدة. لو الخدمة أو السعر غلط، صلّحهم من الأزرار اللي فوق والنسبة بتتحسب تاني من العقد.</p>':'');
 body.querySelector('[data-fv-back]').onclick=function(){picker(m);};
 body.querySelectorAll('[data-fv-act]').forEach(function(b){b.onclick=function(){var name=b.getAttribute('data-fv-act'),v2=!!b.getAttribute('data-fv-v2'),aid=b.getAttribute('data-fv-id')||a.id;close();
  if(!T().press(name,aid,v2))toast('تعذر فتح الإجراء — افتح «تشغيل اليوم» وجرّب تاني.','error');};});}

function gotoJourney(){if(w.SSMPDReception&&w.SSMPDReception.openSection)return Promise.resolve(w.SSMPDReception.openSection('journey')).catch(function(){});
 if(w.SSMPDGotoTab)w.SSMPDGotoTab('reception_services');else{var n=d.querySelector('[data-goto="reception_services"]');if(n)n.click();}return Promise.resolve();}
function ready(ms){var end=Date.now()+(ms||10000);return new Promise(function(ok){(function tick(){if(T()&&T().ready()){ok(true);return;}if(Date.now()>end){ok(false);return;}setTimeout(tick,150);})();});}
function open(){if(!T()){toast('شاشة «تشغيل اليوم» لسه ما اتحمّلتش — جرّب بعد ثواني.','error');return Promise.resolve(false);}
 var go=T().ready()?Promise.resolve():gotoJourney();
 return go.then(function(){return ready();}).then(function(ok){if(!ok){toast('مقدرتش أجيب حجوزات اليوم — افتح «تشغيل اليوم» وجرّب تاني.','error');return false;}picker(shell());return true;});}
w.SSMPDFixVisit={open:open,_t:{reached:reached,rowNote:rowNote}};
})(window,document);
