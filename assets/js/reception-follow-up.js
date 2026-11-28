/* «متابعة» (owner approved 2026-11-28, mockup docs/ui-references/mockups/follow-up-visits.html, server 20261128160000).
   One window from «عايز تعمل كذا؟ ← مريض جاي متابعة»:
     «احجز متابعة»  pick the patient → his open follow-ups (visit / package) with «فاضل N من M · لحد …», or a recent visit → «برسوم 100»;
                    the doctor is ALWAYS the origin visit's doctor («المتابعة لازم تبقى مع نفس الطبيب»); expired → fee + «اطلب مدّ» (1..3 days).
     «طلبات المدّ» pending extensions — approved by ANOTHER person (accounts / center manager).
     «تقرير المتابعات» per doctor (included / fee / fee income / no-show) + follow-ups left per patient.
     «إعدادات المتابعة» (accounts / manager only): included follow-ups + valid days per service (searchable list).
   The today board cards get a chip «متابعة على زيارة 206 — من المشمول (فاضل 2 من 3)» / «… برسوم 100». */
(function(w,d){'use strict';
var CSS='.fu-ov{position:fixed;inset:0;z-index:130;background:rgba(22,33,46,.45);display:flex;align-items:center;justify-content:center;padding:12px}'+
 '.fu{background:#fff;border-radius:18px;width:100%;max-width:760px;max-height:92vh;max-height:92dvh;overflow:auto;padding:14px;display:grid;gap:10px}'+
 '.fu-h{display:flex;align-items:center;justify-content:space-between;gap:8px}.fu-h h3{margin:0;font-size:17px;color:#0F369D}'+
 '.fu-x{border:1px solid #CBD5E1;background:#fff;border-radius:10px;min-width:36px;height:36px;font-size:16px;cursor:pointer}'+
 '.fu-tabs{display:flex;gap:6px;flex-wrap:wrap}.fu-tab{border:1px solid #CBD5E1;background:#fff;border-radius:999px;padding:6px 12px;font:inherit;font-size:13px;cursor:pointer}.fu-tab.on{background:#0F369D;border-color:#0F369D;color:#fff}'+
 '.fu label.fu-f{display:grid;gap:4px;font-size:13px}.fu input,.fu select{font:inherit;padding:8px 10px;border:1px solid #CBD5E1;border-radius:10px;min-width:0}'+
 '.fu-list{display:grid;gap:8px}.fu-opt{border:1.5px solid #CBD5E1;border-radius:12px;padding:9px 10px;display:grid;gap:3px;font-size:13px;cursor:pointer}.fu-opt.on{border-color:#0F369D;background:#EEF3FD}'+
 '.fu-opt small{color:#5b6577}.fu-chip{display:inline-block;border-radius:999px;padding:2px 9px;font-size:12px;font-weight:700}.fu-chip.free{background:#E8F4EE;color:#1f5d43}.fu-chip.fee{background:#FFF6E5;color:#8A5A00}.fu-chip.end{background:#FDECE8;color:#9b2c1c}'+
 '.fu-sum{display:grid;grid-template-columns:auto 1fr;gap:4px 10px;font-size:13px;background:#F6F8FC;border-radius:10px;padding:8px 10px}.fu-sum b{color:#0F369D}'+
 '.fu-row2{display:grid;grid-template-columns:1fr 1fr;gap:8px}.fu-acts{display:flex;gap:8px;flex-wrap:wrap}.fu-note{font-size:12px;color:#5b6577;margin:0;line-height:1.7}.fu-err{color:#D0402A;font-size:13px;margin:0}'+
 '.fu-tell{margin:0;border-radius:10px;padding:8px 10px;font-size:13px;line-height:1.8;background:#E8F4EE;color:#1f5d43}.fu-tell.warn{background:#FFF6E5;color:#8A5A00}.fu-tell .btn{margin-top:6px}'+
 '.fu-tbl{overflow:auto}.fu-tbl table{width:100%;border-collapse:collapse;font-size:12.5px}.fu-tbl th,.fu-tbl td{border-bottom:1px solid #E6EBF3;padding:6px;text-align:right}.fu-tbl th{color:#0F369D}.fu-tbl input{width:70px}'+
 '.fu-pat{display:grid;gap:4px;max-height:220px;overflow:auto}.fu-pat button{text-align:right;border:1px solid #E3E8F2;background:#fff;border-radius:10px;padding:7px 10px;font:inherit;font-size:13px;cursor:pointer}'+
 '.journey-fu-chip{display:inline-block;margin:4px 0 0;border-radius:999px;padding:2px 9px;font-size:11.5px;font-weight:700}.journey-fu-chip.free{background:#E8F4EE;color:#1f5d43}.journey-fu-chip.fee{background:#FFF6E5;color:#8A5A00}'+
 '@media(max-width:560px){.fu-row2{grid-template-columns:1fr}}';
function css(){if(d.getElementById('fu-css'))return;var s=d.createElement('style');s.id='fu-css';s.textContent=CSS;(d.head||d.documentElement).appendChild(s);}
function esc(v){return String(v==null?'':v).replace(/[&<>"']/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c];});}
function num(v){return Number(v||0).toLocaleString('en-US',{maximumFractionDigits:2});}
function dm(v){if(!v)return '';var p=String(v).slice(0,10).split('-');return p.length===3?p[2]+'/'+p[1]+(p[0]!==String(new Date().getFullYear())?'/'+p[0]:''):v;}
function toast(m,k){if(w.SSMPDToast&&w.SSMPDToast.show)w.SSMPDToast.show(m,k||'success');}
function uuid(){return w.crypto&&w.crypto.randomUUID?w.crypto.randomUUID():'10000000-1000-4000-8000-'+String(Date.now()).slice(-12).padStart(12,'0');}
function ctx(){var T=w.SSMPDTodayOps;return T&&T.context?T.context():null;}
function wsId(c){c=c||ctx();return c&&(c.workspace||(c.data&&c.data.workspace&&c.data.workspace.id))||null;}
function rpc(a,p,ws){var c=w.SSMPDDb&&w.SSMPDDb.client;if(!c)return Promise.reject(new Error('تعذر الاتصال'));ws=ws||wsId();if(!ws)return Promise.reject(new Error('افتح «تشغيل اليوم» الأول'));
 return Promise.resolve(c.rpc('clinic_reception_follow_up',{p_workspace:ws,p_action:a,p_payload:p||{}})).then(function(r){if(r&&r.error)throw new Error(r.error.message||'تعذر');return r?r.data:null;});}
function cairoDay(){return new Intl.DateTimeFormat('en-CA',{timeZone:'Africa/Cairo',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());}
/* Cairo wall time → ISO (handles summer time) */
function cairoIso(day,hm){var t=Date.parse(day+'T'+hm+':00Z');for(var i=0;i<3;i++){var p={};new Intl.DateTimeFormat('en-GB',{timeZone:'Africa/Cairo',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).formatToParts(new Date(t)).forEach(function(x){p[x.type]=x.value;});
  var shown=Date.parse(p.year+'-'+p.month+'-'+p.day+'T'+p.hour+':'+p.minute+':00Z'),want=Date.parse(day+'T'+hm+':00Z');if(shown===want)break;t+=want-shown;}return new Date(t).toISOString();}
function norm(s){return String(s||'').replace(/[أإآ]/g,'ا').replace(/ة/g,'ه').replace(/ى/g,'ي').replace(/[ً-ْ]/g,'').replace(/[٠-٩]/g,function(c){return String(c.charCodeAt(0)-1632);}).toLowerCase();}
var api={},TABS=[['book','احجز متابعة'],['ext','طلبات المدّ'],['report','تقرير المتابعات'],['rules','إعدادات المتابعة']];
api.open=function(opts){opts=opts||{};var c=ctx();if(!wsId(c)){toast('افتح «تشغيل اليوم» الأول وبعدين «متابعة».','error');return Promise.resolve(false);}css();
 var old=d.querySelector('[data-fu]');if(old)old.remove();
 var ov=d.createElement('div');ov.className='fu-ov';ov.setAttribute('data-fu','');ov.innerHTML='<section class="fu" role="dialog" aria-modal="true" aria-label="متابعة"><div class="fu-h"><h3>متابعة</h3><button type="button" class="fu-x" data-fu-close aria-label="إغلاق">✕</button></div>'+
  '<div class="fu-tabs" role="tablist">'+TABS.map(function(t){return '<button type="button" class="fu-tab" role="tab" data-fu-tab="'+t[0]+'">'+t[1]+'</button>';}).join('')+'</div><div data-fu-body></div></section>';
 d.body.appendChild(ov);var body=ov.querySelector('[data-fu-body]');
 function close(){ov.remove();}ov.querySelector('[data-fu-close]').onclick=close;ov.addEventListener('click',function(e){if(e.target===ov)close();});ov.addEventListener('keydown',function(e){if(e.key==='Escape')close();});
 function tab(k){[].forEach.call(ov.querySelectorAll('[data-fu-tab]'),function(b){var on=b.getAttribute('data-fu-tab')===k;b.classList.toggle('on',on);b.setAttribute('aria-selected',on);});
  body.innerHTML='<p class="fu-note">جاري التحميل…</p>';({book:bookTab,ext:extTab,report:reportTab,rules:rulesTab})[k](body,c,close,opts);}
 [].forEach.call(ov.querySelectorAll('[data-fu-tab]'),function(b){b.onclick=function(){tab(b.getAttribute('data-fu-tab'));};});
 tab(opts.tab||'book');var x=ov.querySelector('[data-fu-close]');if(x.focus)x.focus();api._ov=ov;return Promise.resolve(true);};

function bookTab(body,c,close,opts){var pats=(c&&c.data&&c.data.patients)||[];
 body.innerHTML='<label class="fu-f">المريض<input type="search" data-fu-q placeholder="اكتب الاسم أو رقم الملف أو التليفون" aria-label="دوّر على المريض"></label><div class="fu-pat" data-fu-pats></div><div data-fu-src></div>';
 var q=body.querySelector('[data-fu-q]'),list=body.querySelector('[data-fu-pats]');
 function paint(){var v=norm(q.value.trim());var rows=(v?pats.filter(function(p){return norm([p.name,p.file_no,p.phone].join(' ')).indexOf(v)>=0;}):[]).slice(0,20);
  list.innerHTML=rows.map(function(p){return '<button type="button" data-fu-pat="'+esc(p.id)+'">'+esc(p.name)+' — <bdi dir="ltr">'+esc(p.file_no||'')+'</bdi>'+(p.phone?' — <bdi dir="ltr">'+esc(p.phone)+'</bdi>':'')+'</button>';}).join('')||(v?'<p class="fu-note">مفيش مريض بالاسم ده.</p>':'');
  [].forEach.call(list.querySelectorAll('[data-fu-pat]'),function(b){b.onclick=function(){var p=pats.filter(function(x){return x.id===b.getAttribute('data-fu-pat');})[0];list.innerHTML='';q.value=p?p.name+' — '+(p.file_no||''):'';sources(body.querySelector('[data-fu-src]'),p,close);};});}
 q.oninput=paint;if(opts.patient_id){var p=pats.filter(function(x){return x.id===opts.patient_id;})[0];if(p){q.value=p.name+' — '+(p.file_no||'');sources(body.querySelector('[data-fu-src]'),p,close);}}else q.focus();}

function sources(box,p,close){box.innerHTML='<p class="fu-note">بيدوّر على متابعات '+esc(p.name)+'…</p>';
 rpc('sources',{patient_id:p.id}).then(function(s){var fee=Number(s.fee||100),opts=[];
  (s.follow_ups||[]).forEach(function(f){var left=+f.left,ok=!f.expired&&left>0;opts.push({key:'f:'+f.id,follow_up_id:f.id,provider:f.provider,visit_no:f.visit_no,title:'متابعة على زيارة '+f.visit_no+' — '+f.service,
   sub:f.provider+' · '+dm(f.done_on)+' · فاضل '+left+' من '+f.included+' · صالحة لحد '+dm(f.valid_until),cov:ok?'included':'fee',expired:!!f.expired,pending:!!f.pending_extension,f:f,ok:f.has_service});});
  (s.visits||[]).forEach(function(v){opts.push({key:'v:'+v.visit_id,visit_id:v.visit_id,provider:v.provider,visit_no:v.visit_no,title:'متابعة على زيارة '+v.visit_no+' — '+v.service,sub:v.provider+' · '+dm(v.done_on)+' · الخدمة دي مالهاش متابعات مشمولة',cov:'fee',ok:v.has_service});});
  var pk=(s.packages||[]);
  box.innerHTML=(opts.length?'<p class="fu-note">اختار المتابعة على أنهي زيارة:</p><div class="fu-list">'+opts.map(function(o,i){return '<label class="fu-opt'+(i?'':' on')+'" data-fu-opt="'+esc(o.key)+'"><span><input type="radio" name="fu-src" value="'+esc(o.key)+'"'+(i?'':' checked')+'> <b>'+esc(o.title)+'</b></span><small>'+esc(o.sub)+'</small><span>'+
     (o.cov==='included'?'<span class="fu-chip free">مشمولة — 0 ج</span>':'<span class="fu-chip fee">برسوم متابعة '+num(fee)+' ج</span>')+(o.expired?' <span class="fu-chip end">الصلاحية خلصت</span>':'')+(o.pending?' <span class="fu-chip end">طلب مدّ مستني موافقة</span>':'')+'</span>'+
     (o.expired&&!o.pending&&o.f&&+o.f.left>0?'<span class="fu-acts"><button type="button" class="btn" data-fu-ext="'+esc(o.follow_up_id)+'">اطلب مدّ الصلاحية</button></span>':'')+(o.ok?'':'<span class="fu-err">مفيش خدمة «متابعة» للطبيب ده — الحسابات تضيفها لقسمه.</span>')+'</label>';}).join('')+'</div>':'<p class="fu-note">المريض ده مالوش زيارات في آخر 4 شهور تتعمل عليها متابعة.</p>')+
   (pk.length?'<p class="fu-note">عنده باقة شغّالة ('+pk.map(function(x){return 'فاضل '+x.left+' من '+x.visits+' لحد '+dm(x.expires_on);}).join('، ')+') — زيارات الباقة بتتحجز من «حجز موعد» ← الباقة زي دلوقتي.</p>':'')+
   (opts.length?'<div class="fu-sum" data-fu-sum></div><p class="fu-tell" data-fu-tell role="status"></p><div class="fu-row2"><label class="fu-f">اليوم<input type="date" data-fu-day min="'+cairoDay()+'" value="'+cairoDay()+'"></label><label class="fu-f">الساعة<input type="time" data-fu-time step="300" value="18:00"></label></div>'+
    '<p class="fu-err" data-fu-err role="alert" hidden></p><div class="fu-acts"><button type="button" class="btn btn-primary" data-fu-book>احجز المتابعة</button><button type="button" class="btn" data-fu-cancel>إلغاء</button></div>':'<div class="fu-acts"><button type="button" class="btn" data-fu-cancel>إغلاق</button></div>');
  function cur(){var r=box.querySelector('input[name="fu-src"]:checked');return r&&opts.filter(function(o){return o.key===r.value;})[0];}
  /* owner 2026-11-28: «عايز صلاحية المتابعة تظهر للريسبشن وهو بيحجز … علشان يبلغ المريض … عشان يختار قبل ما يحجز»: the summary says
     until when the free follow-up is valid and what happens after; a day AFTER the validity turns the booking into the fee before saving */
  function sum(){var o=cur(),el=box.querySelector('[data-fu-sum]'),tell=box.querySelector('[data-fu-tell]');if(!o||!el)return;[].forEach.call(box.querySelectorAll('[data-fu-opt]'),function(l){l.classList.toggle('on',l.getAttribute('data-fu-opt')===o.key);});
   var dayEl=box.querySelector('[data-fu-day]'),day=dayEl&&dayEl.value,f=o.f,until=f&&f.valid_until,free=!!(f&&!f.expired&&+f.left>0),late=free&&day&&until&&day>until,cov=free&&!late?'included':'fee';
   el.innerHTML='<span>الطبيب</span><b>'+esc(o.provider)+' — نفس طبيب الزيارة</b><span>الخدمة</span><b>متابعة</b><span>التغطية</span><b>'+(cov==='included'?'مشمولة في زيارة '+esc(o.visit_no)+' (بعدها يفضل '+(Math.max(0,+f.left-1))+' من '+f.included+')':'برسوم متابعة')+'</b>'+
    (free?'<span>المجانية سارية لحد</span><b>'+dm(until)+'</b>':'')+'<span>المريض يدفع</span><b>'+(cov==='included'?'0':num(fee))+' ج.م</b>';
   if(tell){var msg='';
    if(free&&!late)msg='<b>قول للمريض:</b> «متابعتك المجانية سارية لحد يوم '+dm(until)+' (فاضلك '+f.left+' من '+f.included+'). لو جيت بعد يوم '+dm(until)+' المتابعة هتبقى برسوم '+num(fee)+' جنيه.»';
    else if(late)msg='<b>⚠ اليوم اللي اخترته بعد انتهاء الصلاحية ('+dm(until)+') — المتابعة هتبقى برسوم '+num(fee)+' جنيه.</b> قول للمريض، ولو عايزها مجانية احجز يوم '+dm(until)+' أو قبله. <button type="button" class="btn" data-fu-lastfree>احجز في آخر يوم مجاني ('+dm(until)+')</button>';
    else if(f&&f.expired)msg='<b>قول للمريض:</b> «متابعتك المجانية خلصت صلاحيتها يوم '+dm(until)+'، والمتابعة دلوقتي برسوم '+num(fee)+' جنيه.» لو فيه سبب، اطلب مدّ الصلاحية (يوم لـ 3 أيام بموافقة الحسابات أو المدير).';
    else if(f&&+f.left<=0)msg='<b>قول للمريض:</b> «المتابعات المجانية خلصت ('+f.included+' من '+f.included+')، والمتابعة دي برسوم '+num(fee)+' جنيه.»';
    else msg='<b>قول للمريض:</b> «المتابعة دي برسوم '+num(fee)+' جنيه.»';
    tell.className='fu-tell'+(late||cov==='fee'?' warn':'');tell.innerHTML=msg;
    var lf=tell.querySelector('[data-fu-lastfree]');if(lf)lf.onclick=function(){dayEl.value=until;sum();};}}
  [].forEach.call(box.querySelectorAll('input[name="fu-src"]'),function(r){r.onchange=sum;});sum();
  var dEl=box.querySelector('[data-fu-day]');if(dEl){dEl.addEventListener('change',sum);dEl.addEventListener('input',sum);}
  var cn=box.querySelector('[data-fu-cancel]');if(cn)cn.onclick=close;
  [].forEach.call(box.querySelectorAll('[data-fu-ext]'),function(b){b.onclick=function(e){e.preventDefault();extendForm(b.closest('.fu-opt'),b.getAttribute('data-fu-ext'),function(){sources(box,p,close);});};});
  var go=box.querySelector('[data-fu-book]');if(go){var token=uuid();go.onclick=function(){var o=cur(),err=box.querySelector('[data-fu-err]'),day=box.querySelector('[data-fu-day]').value,tm=box.querySelector('[data-fu-time]').value;
   err.hidden=true;if(!o||!o.ok){err.textContent='اختار زيارة ليها خدمة متابعة';err.hidden=false;return;}if(!day||!tm){err.textContent='اختار اليوم والساعة';err.hidden=false;return;}
   go.disabled=true;rpc('book',{follow_up_id:o.follow_up_id||null,visit_id:o.visit_id||null,starts_at:cairoIso(day,tm),token:token}).then(function(r){
    toast('اتحجزت المتابعة على زيارة '+(r.visit_no||o.visit_no)+' — '+(r.coverage==='included'?'مشمولة (0 ج)':'برسوم '+num(r.fee)+' ج'));api._board=null;close();
    var T=w.SSMPDTodayOps;if(T&&T.refresh)T.refresh();}).catch(function(e){go.disabled=false;err.textContent=e.message;err.hidden=false;});};}
 }).catch(function(e){box.innerHTML='<p class="fu-err" role="alert">'+esc(e.message)+'</p>';});}

function extendForm(host,id,done){if(host.querySelector('[data-fu-extf]'))return;var f=d.createElement('div');f.setAttribute('data-fu-extf','');f.className='fu-row2';
 f.innerHTML='<label class="fu-f">مدّ كام يوم<select data-fu-days><option value="1">يوم</option><option value="2">يومين</option><option value="3">3 أيام</option></select></label><label class="fu-f">السبب<input data-fu-reason maxlength="300" placeholder="مثلاً: الدكتور كان مسافر"></label>'+
  '<div class="fu-acts"><button type="button" class="btn btn-primary" data-fu-extgo>ابعت طلب المدّ</button><button type="button" class="btn" data-fu-extno>تراجع</button></div><p class="fu-err" data-fu-exterr hidden></p>';
 host.appendChild(f);f.addEventListener('click',function(e){e.stopPropagation();});
 f.querySelector('[data-fu-extno]').onclick=function(e){e.preventDefault();f.remove();};
 f.querySelector('[data-fu-extgo]').onclick=function(e){e.preventDefault();var b=e.currentTarget;b.disabled=true;rpc('extend_request',{follow_up_id:id,days:+f.querySelector('[data-fu-days]').value,reason:f.querySelector('[data-fu-reason]').value}).then(function(){toast('طلب المدّ اتبعت — مستني موافقة الحسابات أو المدير');done();})
  .catch(function(x){b.disabled=false;var er=f.querySelector('[data-fu-exterr]');er.textContent=x.message;er.hidden=false;});};}

function extTab(body){rpc('extensions').then(function(r){var it=r.items||[];
 body.innerHTML=it.length?'<div class="fu-tbl"><table><thead><tr><th>المريض</th><th>على زيارة</th><th>الطبيب</th><th>كانت لحد</th><th>المدّ</th><th>السبب</th><th>طلبه</th><th></th></tr></thead><tbody>'+it.map(function(x){
   return '<tr><td>'+esc(x.patient)+' <bdi dir="ltr">'+esc(x.file_no)+'</bdi></td><td>'+esc(x.visit_no)+'</td><td>'+esc(x.provider)+'</td><td>'+dm(x.expires_on)+'</td><td>'+x.days+' يوم</td><td>'+esc(x.reason)+'</td><td>'+esc(x.requested_by||'')+'</td><td>'+
    (r.can_review&&!x.mine?'<button type="button" class="btn btn-primary" data-fu-ok="'+esc(x.id)+'">وافق</button> <button type="button" class="btn" data-fu-no="'+esc(x.id)+'">ارفض</button>':(x.mine?'<small>طلبك — يوافق عليه حد تاني</small>':'<small>الموافقة للحسابات أو المدير</small>'))+'</td></tr>';}).join('')+'</tbody></table></div>':'<p class="fu-note">مفيش طلبات مدّ مستنية.</p>';
 [].forEach.call(body.querySelectorAll('[data-fu-ok],[data-fu-no]'),function(b){b.onclick=function(){b.disabled=true;var ok=b.hasAttribute('data-fu-ok');rpc('extend_review',{id:b.getAttribute(ok?'data-fu-ok':'data-fu-no'),approve:ok}).then(function(){toast(ok?'اتوافق على المدّ':'اترفض الطلب');extTab(body);}).catch(function(e){b.disabled=false;toast(e.message,'error');});};});
}).catch(function(e){body.innerHTML='<p class="fu-err" role="alert">'+esc(e.message)+'</p>';});}

function reportTab(body){var to=cairoDay(),from=new Date(Date.parse(to)-30*86400000).toISOString().slice(0,10);
 body.innerHTML='<div class="fu-row2"><label class="fu-f">من<input type="date" data-fu-from value="'+from+'"></label><label class="fu-f">لحد<input type="date" data-fu-to value="'+to+'"></label></div><div data-fu-rep></div>';
 function load(){var out=body.querySelector('[data-fu-rep]');out.innerHTML='<p class="fu-note">جاري التحميل…</p>';rpc('report',{from:body.querySelector('[data-fu-from]').value,to:body.querySelector('[data-fu-to]').value}).then(function(r){
  out.innerHTML='<h4>متابعات كل طبيب</h4><div class="fu-tbl"><table><thead><tr><th>الطبيب</th><th>مشمولة</th><th>برسوم</th><th>إيراد الرسوم</th><th>محجوزة</th><th>لم يحضر</th></tr></thead><tbody>'+((r.doctors||[]).map(function(x){return '<tr><td>'+esc(x.provider)+'</td><td>'+x.included+'</td><td>'+x.fee+'</td><td>'+num(x.fee_income)+'</td><td>'+x.booked+'</td><td>'+x.no_show+'</td></tr>';}).join('')||'<tr><td colspan="6">مفيش متابعات في الفترة دي</td></tr>')+'</tbody></table></div>'+
   '<h4>المتابعات اللي فاضلة لكل مريض</h4><div class="fu-tbl"><table><thead><tr><th>المريض</th><th>على</th><th>الطبيب</th><th>فاضل</th><th>لحد</th></tr></thead><tbody>'+((r.remaining||[]).map(function(x){return '<tr><td>'+esc(x.patient)+' <bdi dir="ltr">'+esc(x.file_no)+'</bdi></td><td>زيارة '+esc(x.visit_no)+' — '+esc(x.service)+'</td><td>'+esc(x.provider)+'</td><td>'+x.left+' من '+x.included+'</td><td>'+dm(x.valid_until)+'</td></tr>';}).join('')||'<tr><td colspan="5">مفيش</td></tr>')+'</tbody></table></div>';
 }).catch(function(e){out.innerHTML='<p class="fu-err" role="alert">'+esc(e.message)+'</p>';});}
 body.querySelector('[data-fu-from]').onchange=load;body.querySelector('[data-fu-to]').onchange=load;load();}

function rulesTab(body){rpc('rules_get').then(function(r){var sv=r.services||[];
 body.innerHTML='<p class="fu-note">عدد المتابعات المشمولة ومدتها لكل خدمة — '+(r.can_manage?'بيحددها الحسابات أو مدير المركز بعد ما يعرف من الطبيب.':'<b>للعرض بس</b> — التعديل للحسابات أو مدير المركز.')+' رسوم المتابعة الزيادة: <b>'+num(r.fee)+' ج</b> لكل المتابعات (الباقات المدفوعة مسبقاً من لائحة الأسعار).</p>'+
  '<label class="fu-f">دوّر على الخدمة<input type="search" data-fu-rq placeholder="اسم الخدمة أو الكود أو القسم"></label><div class="fu-tbl"><table><thead><tr><th>الخدمة</th><th>القسم</th><th>متابعات مشمولة</th><th>صالحة كام يوم</th><th></th></tr></thead><tbody>'+sv.map(function(s){
   return '<tr data-fu-rule="'+esc(s.service_id)+'" data-q="'+esc(norm(s.name+' '+s.code+' '+s.department))+'"><td>'+esc(s.name)+' <small dir="ltr">'+esc(s.code)+'</small></td><td>'+esc(s.department)+'</td><td><input type="number" min="0" max="50" data-fu-n value="'+(s.included_count==null?'':s.included_count)+'"'+(r.can_manage?'':' disabled')+'></td><td><input type="number" min="1" max="730" data-fu-days value="'+(s.valid_days==null?'':s.valid_days)+'"'+(r.can_manage?'':' disabled')+'></td><td>'+(r.can_manage?'<button type="button" class="btn" data-fu-save>حفظ</button>':'')+'</td></tr>';}).join('')+'</tbody></table></div>';
 var rq=body.querySelector('[data-fu-rq]');rq.oninput=function(){var v=norm(rq.value.trim());[].forEach.call(body.querySelectorAll('[data-fu-rule]'),function(tr){tr.hidden=!!v&&tr.getAttribute('data-q').indexOf(v)<0;});};
 [].forEach.call(body.querySelectorAll('[data-fu-save]'),function(b){b.onclick=function(){var tr=b.closest('[data-fu-rule]'),n=tr.querySelector('[data-fu-n]').value,dd=tr.querySelector('[data-fu-days]').value;
  if(n===''||dd===''){toast('اكتب عدد المتابعات وعدد الأيام','error');return;}b.disabled=true;rpc('rules_set',{service_id:tr.getAttribute('data-fu-rule'),included_count:+n,valid_days:+dd}).then(function(){b.disabled=false;toast('اتحفظ');}).catch(function(e){b.disabled=false;toast(e.message,'error');});};});
}).catch(function(e){body.innerHTML='<p class="fu-err" role="alert">'+esc(e.message)+'</p>';});}

/* today board chips */
api._board=null;
function chip(x){var t=x.coverage==='included'?'متابعة على زيارة '+x.visit_no+' — من المشمول (فاضل '+x.left+' من '+x.included+')':'متابعة على زيارة '+(x.visit_no||'')+' — برسوم '+num(x.fee);
 return '<span class="journey-fu-chip '+(x.coverage==='included'?'free':'fee')+'" data-fu-chip>'+esc(t)+'</span>';}
api.decorate=function(root){root=root||d;var cards=root.querySelectorAll?root.querySelectorAll('.journey-card[data-appointment]'):[];if(!cards.length||!wsId())return;css();
 var T=w.SSMPDTodayOps,day=T&&T.day?T.day():cairoDay(),now=Date.now();
 if(!api._board||api._board.day!==day||now-api._board.at>60000){if(api._board&&api._board.loading)return;api._board={day:day,at:now,loading:true,map:(api._board&&api._board.map)||{}};
  rpc('board',{day:day}).then(function(m){api._board={day:day,at:Date.now(),map:m||{}};api.decorate(root);}).catch(function(){api._board={day:day,at:Date.now(),map:{}};});return;}
 var map=api._board.map||{};[].forEach.call(cards,function(card){var x=map[card.getAttribute('data-appointment')];if(!x||card.querySelector('[data-fu-chip]'))return;var host=card.querySelector('.journey-card-main,.journey-card-head')||card;host.insertAdjacentHTML('beforeend',chip(x));});};
function start(){if(!w.MutationObserver)return;var pend=false;new MutationObserver(function(){if(pend)return;pend=true;setTimeout(function(){pend=false;if(d.querySelector('.journey-card[data-appointment]'))api.decorate(d);},300);}).observe(d.body||d.documentElement,{childList:true,subtree:true});}
if(d.readyState==='loading')d.addEventListener('DOMContentLoaded',start);else start();
api._t={cairoIso:cairoIso,norm:norm,chip:chip};
w.SSMPDFollowUp=api;
})(window,document);
