/* SSMPD — «تنفيذ الكل» + clear «تنفيذ» checks (owner 2026-11-27 «موافق على تنفيذ الكل»; mockup docs/ui-references/mockups/execute-all.html;
   mig 20261127270000; help 331).
   1) guard(root, c, order): the single «تنفيذ» window checks its fields BEFORE sending and writes the message right under the field:
      «اختار الجهاز» · «اكتب دقايق تشغيل الجهاز» · «اكتب قراءة العداد قبل وبعد» · «قراءة بعد لازم تبقى أكبر من قراءة قبل» · «اختار مخزن الصرف».
   2) reveal(root, c): in «تفاصيل الزيارة» the «✓ تنفيذ الكل (N)» button shows only when N ≥ 2 services wait and the server says this user
      may execute (public.clinic_reception_execute_all_info).
   3) open(c, visitId): ONE window — tick the services (search when 9+), the session once (doctor per department, store, device, total
      minutes, counter before/after; split shown live by each service's standard minutes, counter chained), a service priced per pulse gets
      its own counter, actual supplies once (combined BOMs, − / +, add), extras approval once → c.command('execute_many') — the server runs
      the SAME «تنفيذ» for each service, all or nothing. Every single «تنفيذ» button stays. */
(function(w,d){'use strict';
var info={};
function esc(v){return String(v==null?'':v).replace(/[&<>"']/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c];});}
function num(v){return Number(v||0).toLocaleString('en-US',{maximumFractionDigits:3});}
function client(){return w.SSMPDDb&&w.SSMPDDb.client;}
function getInfo(ws){if(info[ws])return info[ws];var c=client();
 var p=c?Promise.resolve(c.rpc('clinic_reception_execute_all_info',{p_workspace:ws})).then(function(r){if(r&&r.error)throw r.error;return (r&&r.data)||{};}):Promise.resolve({});
 info[ws]=p.catch(function(){delete info[ws];return {can_execute:false,pulse_codes:[]};});return info[ws];}
function waiting(c,visitId){return ((c.data&&c.data.orders)||[]).filter(function(o){return o.visit_id===visitId&&o.status==='ordered';});}
function nameOf(o){return (o.snapshot&&o.snapshot.name)||'خدمة';}
function deviceOf(c,id){return ((c.data&&c.data.devices)||[]).filter(function(x){return x.id===id;})[0]||null;}
/* «آخر قراءة» on THIS device by anyone — always fresh from the server when a window opens / the device changes */
function lastReading(ws,dev){var c=client();if(!c||!dev)return Promise.resolve(null);
 return Promise.resolve(c.rpc('clinic_reception_device_last_reading',{p_workspace:ws,p_device:dev})).then(function(r){if(r&&r.error)throw r.error;return r?r.data:null;}).catch(function(){return null;});}
function uploadPhoto(file){var c=client();if(!c||!c.storage)return Promise.reject(new Error('مقدرتش أرفع الصورة — تقدر تكمّل من غيرها'));
 if(file.size>8*1024*1024)return Promise.reject(new Error('الصورة أكبر من 8 ميجا'));
 return Promise.resolve(c.auth&&c.auth.getUser?c.auth.getUser():null).then(function(u){var uid=u&&u.data&&u.data.user&&u.data.user.id;if(!uid)throw new Error('سجل الدخول تاني');
  var ext=(String(file.name||'').split('.').pop()||'jpg').toLowerCase().replace(/[^a-z0-9]/g,'').slice(0,5)||'jpg',pth=uid+'/laser-'+Date.now()+'-'+Math.random().toString(36).slice(2,8)+'.'+ext;
  return Promise.resolve(c.storage.from('shift-expense-receipts').upload(pth,file,{upsert:false,contentType:file.type||undefined})).then(function(r){if(r&&r.error)throw r.error;return pth;});});}
function when(v){try{return v?new Date(v).toLocaleString('ar-EG-u-nu-latn',{timeZone:'Africa/Cairo',day:'numeric',month:'short',hour:'numeric',minute:'2-digit'}):'';}catch(e){return '';}}
/* counter tools on a form: «آخر قراءة» line + gap / overlap note under «قبل», and «من / إلى» ↔ «عدد النبضات» */
function meterTools(root,c,f,opts){opts=opts||{};var before=f[opts.before||'meter_before'],after=f[opts.after||'meter_after'];if(!before||!after||before.__mt)return null;before.__mt=true;
 var bl=before.closest('label')||before,al=after.closest('label')||after,last=null;
 var info=d.createElement('small');info.className='xall-last';info.setAttribute('data-last-reading','');info.hidden=true;bl.parentNode.insertBefore(info,bl.nextSibling);
 var mode=d.createElement('div');mode.className='xall-mode';mode.setAttribute('data-meter-mode','');mode.setAttribute('data-wide','');mode.hidden=true;
 mode.innerHTML='<span>اكتب العداد:</span><label><input type="radio" name="'+(opts.modeName||'meter_mode')+'" value="range" checked> من / إلى</label><label><input type="radio" name="'+(opts.modeName||'meter_mode')+'" value="count"> عدد النبضات</label><label><input type="radio" name="'+(opts.modeName||'meter_mode')+'" value="none" data-no-meter-opt> مش عارف قراية العداد</label>';
 bl.parentNode.insertBefore(mode,bl);
 var cl=d.createElement('label');cl.setAttribute('data-pulses-label','');cl.hidden=true;cl.innerHTML=(opts.countLabel||'عدد النبضات')+'<input name="'+(opts.countName||'pulses')+'" type="number" min="1" step="1" inputmode="numeric" disabled>';al.parentNode.insertBefore(cl,al.nextSibling);
 var count=cl.querySelector('input');
 /* «مش عارف قراية العداد» (owner 2026-11-27 «موافق على النبضات من غير عداد مؤقتاً»): pulses only + an optional photo of the device screen */
 var nm=d.createElement('div');nm.className='xall-nm';nm.setAttribute('data-no-meter-box','');nm.setAttribute('data-wide','');nm.hidden=true;
 nm.innerHTML='<input type="hidden" name="'+(opts.noMeterName||'no_meter')+'" value="true" disabled><input type="hidden" name="'+(opts.evidenceName||'evidence')+'" value="" disabled>'+
  '<p class="rbm-hint w">الجلسة هتتسجل «من غير قراية عداد» وهتظهر للمالك والمدير. السعر والخصم من باكج النبضات بيتحسبوا من عدد النبضات اللي هتكتبه.</p>'+
  '<label class="xall-photo">صورة شاشة الجهاز (اختياري)<input type="file" accept="image/*" capture="environment" data-no-meter-photo></label><small class="xall-last" data-no-meter-photo-st hidden></small>';
 cl.parentNode.insertBefore(nm,cl.nextSibling);
 var nmFlag=nm.querySelector('input[name="'+(opts.noMeterName||'no_meter')+'"]'),evInp=nm.querySelector('input[name="'+(opts.evidenceName||'evidence')+'"]'),photo=nm.querySelector('[data-no-meter-photo]'),photoSt=nm.querySelector('[data-no-meter-photo-st]');
 photo.onchange=function(){var file=photo.files&&photo.files[0];evInp.value='';if(!file)return;photoSt.hidden=false;photoSt.classList.remove('warn');photoSt.textContent='بيرفع الصورة…';
  uploadPhoto(file).then(function(pth){evInp.value=pth;photoSt.textContent='الصورة اترفعت ✓';}).catch(function(e){photoSt.textContent=(e&&e.message)||'مقدرتش أرفع الصورة — تقدر تكمّل من غيرها';photoSt.classList.add('warn');photo.value='';});};
 function note(){if(last==null||before.value===''){info.textContent=last!=null?'آخر قراءة على الجهاز ده: '+num(last.meter_after)+(last.by?' — '+last.by:'')+(last.at?' · '+when(last.at):''):'';info.hidden=!info.textContent;info.classList.remove('warn');return;}
  var diff=+before.value-(+last.meter_after),base='آخر قراءة على الجهاز ده: '+num(last.meter_after)+(last.by?' — '+last.by:'')+(last.at?' · '+when(last.at):'');
  info.textContent=diff>0?base+' · فيه فجوة '+num(diff)+' عن آخر قراءة':diff<0?base+' · تداخل: أقل من آخر قراءة بـ '+num(-diff):base;info.classList.toggle('warn',diff!==0);info.hidden=false;}
 function setMode(m){var cnt=m==='count'||m==='none',none=m==='none';al.hidden=cnt;after.disabled=cnt;bl.hidden=none;before.disabled=none;cl.hidden=!cnt;count.disabled=!cnt;
  nm.hidden=!none;nmFlag.disabled=!none;evInp.disabled=!none;if(none)info.hidden=true;else note();if(opts.onChange)opts.onChange();}
 mode.querySelectorAll('input').forEach(function(r){r.onchange=function(){setMode(r.value);};});
 before.addEventListener('input',note);
 function load(devId,show){mode.hidden=!show;if(!show){var r0=mode.querySelector('input[value="range"]');if(r0)r0.checked=true;setMode('range');info.hidden=true;return Promise.resolve();}
  return lastReading(c.workspace,devId).then(function(x){last=x&&x.meter_after!=null?x:null;if(last&&(before.value===''||before.__auto)){before.value=last.meter_after;before.__auto=true;before.dispatchEvent(new Event('input',{bubbles:true}));}note();
   if(!last&&mode.querySelector('input:checked').value!=='none'){info.textContent='مفيش قراية عداد متسجلة للجهاز ده لسه — لو مش عارفها اختار «مش عارف قراية العداد».';info.hidden=false;info.classList.add('warn');}});}
 before.addEventListener('input',function(e){if(e.isTrusted)before.__auto=false;});
 return {load:load,count:count,mode:function(){var r=mode.querySelector('input:checked');return r?r.value:'range';},note:note};}

/* ---------- field messages ---------- */
function clearErr(root){root.querySelectorAll('[data-field-err]').forEach(function(x){x.remove();});root.querySelectorAll('.rx-bad').forEach(function(x){x.classList.remove('rx-bad');});}
function err(root,el,msg){if(!el)return;var lab=el.closest('label')||el;if(lab.querySelector&&lab.querySelector('[data-field-err]'))return;
 var s=d.createElement('small');s.className='rx-field-err';s.setAttribute('data-field-err','');s.setAttribute('role','alert');s.textContent=msg;
 if(lab.nextSibling)lab.parentNode.insertBefore(s,lab.nextSibling);else lab.parentNode.appendChild(s);el.classList.add('rx-bad');}
function blank(v){return v==null||String(v).trim()==='';}
/* checks of one execute set; returns the list of problems [el,msg] */
function checks(f,o,c,opt){opt=opt||{};var out=[],dev=f.device_id&&f.device_id.value?deviceOf(c,f.device_id.value):null;
 if(!dev&&o&&o.snapshot&&o.snapshot.requires_device&&f.device_id)out.push([f.device_id,'اختار الجهاز']);
 if(dev){var mn=f.minutes&&f.minutes.value;if(f.minutes&&(blank(mn)||!/^\s*\d+\s*$/.test(mn)||+mn<=0))out.push([f.minutes,'اكتب دقايق تشغيل الجهاز']);
  if(dev.meter_kind&&dev.meter_kind!=='none'&&opt.none){var pn=f[opt.countName||'pulses'];if(pn&&(blank(pn.value)||!(+pn.value>0)))out.push([pn,'اكتب عدد النبضات (أكبر من صفر)']);}
  else if(dev.meter_kind&&dev.meter_kind!=='none'&&opt.count&&f.meter_before){var pc=f[opt.countName||'pulses'];
   if(blank(f.meter_before.value))out.push([f.meter_before,'اكتب قراءة العداد قبل']);if(pc&&(blank(pc.value)||!(+pc.value>0)))out.push([pc,'اكتب عدد النبضات (أكبر من صفر)']);}
  else if(dev.meter_kind&&dev.meter_kind!=='none'&&f.meter_before&&f.meter_after){var b=f.meter_before.value,a=f.meter_after.value;
   if(blank(b))out.push([f.meter_before,'اكتب قراءة العداد قبل وبعد']);if(blank(a))out.push([f.meter_after,'اكتب قراءة العداد قبل وبعد']);
   if(!blank(b)&&!blank(a)&&(isNaN(+b)||isNaN(+a)))out.push([f.meter_after,'قراءة العداد لازم تبقى رقم']);
   else if(!blank(b)&&!blank(a)&&+a<+b)out.push([f.meter_after,'قراءة بعد لازم تبقى أكبر من قراءة قبل']);
   else if(!blank(b)&&!blank(a)&&opt.strict&&+a===+b)out.push([f.meter_after,'قراءة بعد لازم تبقى أكبر من قراءة قبل']);}}
 if(opt.hasMaterials&&f.location_id&&!f.location_id.value)out.push([f.location_id,'اختار مخزن الصرف']);
 return out;}
/* the single «تنفيذ» window */
function guard(root,c,o){if(!root||root.__xallGuard)return;root.__xallGuard=true;var form=root.querySelector('form');if(!form)return;
 var mt=meterTools(root,c,form.elements),dsel=form.elements.device_id;
 function sync(){var dev=dsel&&dsel.value?deviceOf(c,dsel.value):null;if(mt)mt.load(dsel&&dsel.value,!!(dev&&dev.meter_kind&&dev.meter_kind!=='none'));}
 if(dsel)dsel.addEventListener('change',sync);sync();
 root.addEventListener('submit',function(e){var f=form.elements;clearErr(root);
  var mat=Array.prototype.some.call(root.querySelectorAll('[data-rx-lines] [data-field="quantity"]'),function(q){return +q.value>0;});
  var bad=checks(f,o,c,{hasMaterials:mat,count:mt&&mt.mode()==='count',none:mt&&mt.mode()==='none'});if(!bad.length)return;
  e.preventDefault();e.stopImmediatePropagation();bad.forEach(function(x){err(root,x[0],x[1]);});var st=root.querySelector('[data-rx-status]');if(st)st.textContent='كمّل الخانات اللي تحتها كلام بالأحمر.';
  if(bad[0][0]&&bad[0][0].focus)bad[0][0].focus();},true);
 form.addEventListener('input',function(e){var t=e.target,lab=t&&t.closest&&t.closest('label');if(t&&t.classList)t.classList.remove('rx-bad');var n=lab&&lab.nextSibling;if(n&&n.hasAttribute&&n.hasAttribute('data-field-err'))n.remove();});}

/* ---------- «تفاصيل الزيارة» button ---------- */
function reveal(root,c){if(!root||!c||!c.workspace)return Promise.resolve();var b=root.querySelector('[data-xall]');if(!b)return Promise.resolve();
 return getInfo(c.workspace).then(function(i){if(i&&i.can_execute&&b.isConnected)b.hidden=false;});}

/* ---------- split ---------- */
function splitInt(total,weights){var sum=weights.reduce(function(t,x){return t+x;},0)||weights.length,raw=weights.map(function(x){return total*(x||1)/(sum||1);}),
 base=raw.map(function(x){return Math.max(1,Math.floor(x));}),left=total-base.reduce(function(t,x){return t+x;},0),order=raw.map(function(x,i){return [x-Math.floor(x),i];}).sort(function(a,b){return b[0]-a[0];});
 for(var k=0;left>0&&k<order.length*4;k++){base[order[k%order.length][1]]++;left--;}
 for(k=base.length-1;left<0&&k>=0;k--){while(left<0&&base[k]>1){base[k]--;left++;}}return base;}
function chain(start,total,weights){var sum=weights.reduce(function(t,x){return t+x;},0)||1,out=[],cur=start,acc=0;
 weights.forEach(function(wt,i){acc+=wt;var end=i===weights.length-1?start+total:Math.round((start+total*acc/sum)*1000)/1000;out.push([cur,end]);cur=end;});return out;}

/* ---------- the window ---------- */
function open(c,visitId){var v=((c.data&&c.data.visits)||[]).filter(function(x){return x.id===visitId;})[0];if(!v)return false;
 var list=waiting(c,visitId);if(list.length<2){if(w.SSMPDToast&&w.SSMPDToast.show)w.SSMPDToast.show('محتاج خدمتين أو أكتر مستنيين تنفيذ','error');return false;}
 getInfo(c.workspace).then(function(i){draw(c,v,list,(i&&i.pulse_codes)||[]);});return true;}
function draw(c,v,list,pulseCodes){var e=esc,data=c.data||{},ap=(data.appointments||[]).filter(function(a){return a.id===v.appointment_id;})[0]||{};
 var isPulse=function(o){return pulseCodes.indexOf(o.snapshot&&o.snapshot.code)>=0;};
 var depts=[];list.forEach(function(o){var dp=o.snapshot&&o.snapshot.department||'';if(depts.indexOf(dp)<0)depts.push(dp);});
 var provs=function(dp){return (data.providers||[]).filter(function(p){return p.active!==false&&(!dp||p.department===dp);});};
 var pick='<input type="search" class="xall-q" data-xall-q placeholder="دوّر في الخدمات" aria-label="دوّر في الخدمات"'+(list.length<9?' hidden':'')+'><div class="xall-list" data-xall-list>'+list.map(function(o){
   return '<label class="xall-pick" data-xall-row="'+e(o.id)+'"><input type="checkbox" data-xall-on value="'+e(o.id)+'" checked><span><b>'+e(nameOf(o))+'</b><small>'+e((o.snapshot&&o.snapshot.minutes||'')+(o.snapshot&&o.snapshot.minutes?' د':''))+(isPulse(o)?' · بالنبضة':'')+'</small></span><span>'+num((+o.price||0)*(+o.quantity||1))+'</span></label>';}).join('')+'</div>'+
   '<p class="rbm-hint">شيل العلامة من أي خدمة مش هتتعمل دلوقتي، وهتفضل «مستنية تنفيذ».</p>';
 var docs=depts.map(function(dp){var first=list.filter(function(o){return (o.snapshot&&o.snapshot.department||'')===dp;})[0];
   return '<label>الطبيب المنفذ'+(depts.length>1?' — '+e(dp):'')+'<select name="provider_'+e(dp)+'" data-xall-doc="'+e(dp)+'">'+provs(dp).map(function(p){return '<option value="'+e(p.id)+'"'+(first&&first.provider_id===p.id?' selected':'')+'>'+e(p.name)+'</option>';}).join('')+'</select></label>';}).join('');
 var devList=data.devices||[],du=(data.device_uses||[]).filter(function(u){return list.some(function(o){return o.id===u.order_id;});})[0],
  defDev=ap.device_id||(du&&du.device_id)||(list.some(function(o){return o.snapshot&&o.snapshot.requires_device;})&&devList.length===1?devList[0].id:'');
 var devs=devList.map(function(x){return '<option value="'+e(x.id)+'"'+(defDev===x.id?' selected':'')+'>'+e(x.name)+'</option>';}).join('');
 var locs=(data.locations||[]).map(function(x){return '<option value="'+e(x.id)+'">'+e(x.name)+'</option>';}).join('');
 var stdMin=list.reduce(function(t,o){return t+(+(o.snapshot&&o.snapshot.minutes)||0);},0);
 var body='<section class="xall-sec" data-wide><h4>1) الخدمات اللي هتتنفّذ</h4>'+pick+'</section>'+
  '<section class="xall-sec" data-wide><h4>2) الجلسة — مرة واحدة</h4><div class="xall-f">'+docs+
  '<label>مخزن الصرف<select name="location_id"><option value="">اختر</option>'+locs+'</select></label>'+
  '<label>الجهاز<select name="device_id"><option value="">بدون جهاز</option>'+devs+'</select></label>'+
  '<label data-xall-dev>دقايق التشغيل للجلسة كلها<input name="minutes" type="number" min="1" step="1" inputmode="numeric" value="'+(stdMin||'')+'"></label>'+
  '<label data-xall-meter>العداد قبل الجلسة<input name="meter_before" type="number" min="0" step="0.001" inputmode="decimal"></label>'+
  '<label data-xall-meter data-xall-after>العداد بعد الجلسة<input name="meter_after" type="number" min="0" step="0.001" inputmode="decimal"></label></div>'+
  '<div data-xall-pulse></div><p class="rbm-hint" data-xall-split-h>التقسيم على الخدمات بيتعمل لوحده حسب الوقت القياسي لكل خدمة، والعداد بيتسلسل من غير فجوة:</p><div class="xall-split" data-xall-split></div></section>'+
  '<section class="xall-sec" data-wide><h4>3) المستلزمات الفعلية — مرة واحدة للجلسة</h4><div class="xall-mats" data-xall-mats></div>'+
  '<label class="xall-add">ضيف مستلزم<select data-xall-additem><option value="">اختار مستلزم</option>'+(data.items||[]).map(function(i){return '<option value="'+e(i.id)+'">'+e(i.name)+(+i.sale_price?' — '+num(i.sale_price):'')+'</option>';}).join('')+'</select></label>'+
  '<label>سبب اختلاف الاستهلاك عن المكونات (لو فيه)<input name="material_note" maxlength="300"></label>'+
  '<p class="rbm-hint">الكمية المشتركة بتتوزع على الخدمات بالمكونات بتاعتها، والزيادة على أول خدمة. المشمول مش بيتحسب على المريض تاني.</p></section>'+
  '<section class="xall-sec" data-wide><h4>4) الموافقة على الإضافات</h4><label><select name="additional_confirmed"><option value="false">لا توجد موافقة على إضافات</option><option value="true">وافق المريض على الكميات وأسعار البيع المبينة</option></select></label></section>'+
  '<p class="rbm-hint w" data-wide>لو خدمة واحدة مش هينفع تتنفّذ، مفيش حاجة بتتنفّذ، والرسالة بتقول اسم الخدمة والسبب.</p>';
 var title='تنفيذ الكل — '+(c.lookup?c.lookup('patients',v.patient_id):'')+' · زيارة '+v.visit_no;
 var mats={};/* item_id → {name, unit, qty, bom:{order_id:q}} */
 function itemOf(id){return (data.items||[]).filter(function(i){return i.id===id;})[0]||{};}
 function chosen(){return list.filter(function(o){var cb=root.querySelector('[data-xall-on][value="'+o.id+'"]');return cb&&cb.checked;});}
 function rebuildMats(){var keep={};Object.keys(mats).forEach(function(k){if(mats[k].added)keep[k]=mats[k];});var next={};
  chosen().forEach(function(o){(o.snapshot&&o.snapshot.bom||[]).forEach(function(b){var q=(+b.quantity||0)*(+o.quantity||1),k=b.item_id;
   if(!next[k])next[k]={name:itemOf(k).name||b.name||'مستلزم',unit:itemOf(k).unit||'',qty:0,bom:{},touched:false};next[k].bom[o.id]=(next[k].bom[o.id]||0)+q;next[k].qty+=q;});});
  Object.keys(next).forEach(function(k){if(mats[k]&&mats[k].touched){next[k].qty=mats[k].qty;next[k].touched=true;}});
  Object.keys(keep).forEach(function(k){if(!next[k])next[k]=keep[k];});mats=next;paintMats();}
 function paintMats(){var box=root.querySelector('[data-xall-mats]'),keys=Object.keys(mats);
  box.innerHTML=keys.length?keys.map(function(k){var m=mats[k],bs=Object.keys(m.bom).reduce(function(t,x){return t+m.bom[x];},0);
   return '<div class="xall-mat" data-xall-mat="'+e(k)+'"><span>'+e(m.name)+'<small>'+(bs?'المكونات: '+num(bs):'إضافة')+'</small></span><span class="xall-qty"><button type="button" data-xall-minus aria-label="أقل">−</button><input type="number" min="0" step="0.001" value="'+e(m.qty)+'" data-xall-qtyin aria-label="الكمية"><button type="button" data-xall-plus aria-label="أكتر">+</button></span><span>'+e(m.unit)+'</span></div>';}).join(''):'<p class="rbm-hint">مفيش مستلزمات مكونات للخدمات دي.</p>';
  box.querySelectorAll('[data-xall-mat]').forEach(function(row){var k=row.getAttribute('data-xall-mat'),inp=row.querySelector('[data-xall-qtyin]');
   var set=function(v){mats[k].qty=Math.max(0,Math.round(v*1000)/1000);mats[k].touched=true;inp.value=mats[k].qty;};
   row.querySelector('[data-xall-minus]').onclick=function(){set((+inp.value||0)-1);};row.querySelector('[data-xall-plus]').onclick=function(){set((+inp.value||0)+1);};inp.oninput=function(){set(+inp.value||0);};});}
 function plan(){var f=root.querySelector('form').elements,sel=chosen(),dev=f.device_id.value?deviceOf(c,f.device_id.value):null,meter=dev&&dev.meter_kind&&dev.meter_kind!=='none';
  var pulse=sel.filter(isPulse),rest=sel.filter(function(o){return !isPulse(o);}),own={};
  pulse.forEach(function(o){var x=root.querySelector('[data-xall-pc="'+o.id+'"]');own[o.id]=x?x.value:'';});
  var M=+f.minutes.value||0,mins=dev&&M>0?splitInt(M,sel.map(function(o){return +(o.snapshot&&o.snapshot.minutes)||1;})):[];
  var nmode=mt&&mt.mode()==='none',cnt=mt&&(mt.mode()==='count'||nmode),B=nmode?0:+f.meter_before.value,total=cnt?+(f.session_pulses&&f.session_pulses.value):(+f.meter_after.value-B),
   haveTotal=(nmode||!blank(f.meter_before.value))&&(cnt?!blank(f.session_pulses&&f.session_pulses.value):!blank(f.meter_after.value)),
   pulseUsed=pulse.reduce(function(t,o){return t+Math.max(0,+own[o.id]||0);},0),T=total-pulseUsed;
  var ch=meter&&haveTotal&&T>=0&&rest.length?chain(B,T,rest.map(function(o){return +(o.snapshot&&o.snapshot.minutes)||1;})):null;
  /* services priced per pulse start where the previous one stopped */
  var pc={},cur=B+(rest.length?Math.max(0,T):0);pulse.forEach(function(o){var n=+own[o.id]||0;pc[o.id]=[cur,cur+n];cur+=n;});
  return {sel:sel,dev:dev,meter:meter,mins:mins,own:own,rest:rest,ch:ch,T:T,pulse:pulse,pc:pc,haveTotal:haveTotal,cnt:cnt,total:total,nm:nmode};}
 function paint(){var p=plan(),f=root.querySelector('form').elements;
  root.querySelectorAll('[data-xall-dev]').forEach(function(x){x.hidden=!p.dev;});root.querySelectorAll('[data-xall-meter]').forEach(function(x){x.hidden=!p.meter||(x.hasAttribute('data-xall-after')&&p.cnt)||(!x.hasAttribute('data-xall-after')&&p.nm);});
  var pb=root.querySelector('[data-xall-pulse]');var have={};pb.querySelectorAll('[data-xall-pc]').forEach(function(x){have[x.getAttribute('data-xall-pc')]=x.value;});
  pb.innerHTML=p.meter?p.pulse.map(function(o){return '<div class="xall-pulse"><b>«'+e(nameOf(o))+'» سعره بعدد النبضات</b><div class="xall-f"><label>عدد نبضات البند ده<input type="number" min="1" step="1" inputmode="numeric" data-xall-pc="'+e(o.id)+'" value="'+e(have[o.id]||'')+'"></label></div><small class="rbm-hint">بيبدأ من الرقم اللي وقفت عنده الخدمة اللي قبله.</small></div>';}).join(''):'';
  pb.querySelectorAll('input').forEach(function(x){x.oninput=function(){paintSplit();};});paintSplit();
  var ok=root.querySelector('button[type=submit]');if(ok)ok.textContent='✓ نفّذ '+p.sel.length+' خدمات';}
 function paintSplit(){var p=plan(),box=root.querySelector('[data-xall-split]'),h=root.querySelector('[data-xall-split-h]');
  var show=p.dev&&p.sel.length;box.hidden=!show;h.hidden=!show;if(!show){box.innerHTML='';return;}
  var ri=0;box.innerHTML='<div class="xall-r h"><span>الخدمة</span><span>الدقايق</span><span>العداد</span></div>'+p.sel.map(function(o,i){var m=p.mins[i]!=null?p.mins[i]:'—',cnt='—';
   if(p.meter&&p.nm){if(isPulse(o))cnt=p.own[o.id]?num(p.own[o.id])+' نبضة (من غير عداد)':'—';else if(p.ch){var y=p.ch[ri++];cnt=num(y[1]-y[0])+' نبضة (من غير عداد)';}}
   else if(p.meter){if(isPulse(o)){cnt=p.haveTotal&&p.own[o.id]?num(p.pc[o.id][0])+' → '+num(p.pc[o.id][1])+' (بالنبضة)':'—';}else if(p.ch){var x=p.ch[ri++];cnt=num(x[0])+' → '+num(x[1]);}}
   return '<div class="xall-r"><span>'+e(nameOf(o))+'</span><span>'+e(m)+'</span><span dir="ltr">'+e(cnt)+'</span></div>';}).join('');}
 function payload(){var p=plan(),f=root.querySelector('form').elements,bad=[];clearErr(root);
  if(p.sel.length<2)bad.push([root.querySelector('[data-xall-list]'),'اختار خدمتين على الأقل — لخدمة واحدة استخدم «تنفيذ»']);
  var needDev=p.sel.some(function(o){return o.snapshot&&o.snapshot.requires_device;});
  var hasMat=Object.keys(mats).some(function(k){return mats[k].qty>0;});
  checks(f,needDev?{snapshot:{requires_device:true}}:null,c,{hasMaterials:hasMat,count:p.cnt&&!p.nm,none:p.nm,countName:'session_pulses'}).forEach(function(x){bad.push(x);});
  if(p.meter&&p.pulse.length)p.pulse.forEach(function(o){var x=root.querySelector('[data-xall-pc="'+o.id+'"]');if(blank(x.value)||!(+x.value>0))bad.push([x,'اكتب عدد نبضات البند ده (أكبر من صفر)']);});
  if(p.meter&&p.haveTotal&&p.T<0)bad.push([p.cnt?f.session_pulses:f.meter_after,'إجمالي الجلسة أقل من نبضات البنود اللي بالنبضة']);
  var short=Object.keys(mats).some(function(k){var m=mats[k],bs=Object.keys(m.bom).reduce(function(t,x){return t+m.bom[x];},0);return bs>0&&m.qty<bs;});
  if(short&&blank(f.material_note.value))bad.push([f.material_note,'اكتب سبب إن المستلزمات أقل من المكونات']);
  var extra=Object.keys(mats).some(function(k){var m=mats[k],bs=Object.keys(m.bom).reduce(function(t,x){return t+m.bom[x];},0);return m.qty>bs&&(+itemOf(k).sale_price||0)>0;});
  if(extra&&f.additional_confirmed.value!=='true')bad.push([f.additional_confirmed,'فيه مستلزمات زيادة بتتحسب على المريض — اختار «وافق المريض»']);
  if(bad.length){bad.forEach(function(x){err(root,x[0],x[1]);});if(bad[0][0]&&bad[0][0].focus)bad[0][0].focus();throw new Error('كمّل الخانات اللي تحتها كلام بالأحمر.');}
  /* supplies back per service: each BOM first, the surplus on the first service */
  var per={};p.sel.forEach(function(o){per[o.id]=[];});
  Object.keys(mats).forEach(function(k){var m=mats[k],left=m.qty,ids=p.sel.map(function(o){return o.id;}).filter(function(id){return m.bom[id]!=null;});
   ids.forEach(function(id){var q=Math.min(left,m.bom[id]);left=Math.round((left-q)*1000)/1000;per[id].push({item_id:k,quantity:q});});
   if(left>0){var tgt=ids[0]||p.sel[0].id,row=per[tgt].filter(function(x){return x.item_id===k;})[0];if(row)row.quantity=Math.round((row.quantity+left)*1000)/1000;else per[tgt].push({item_id:k,quantity:left});}});
  var ri=0,orders=p.sel.map(function(o,i){var dp=o.snapshot&&o.snapshot.department||'',doc=root.querySelector('[data-xall-doc="'+dp+'"]');
   var x={id:o.id,provider_id:doc?doc.value:o.provider_id,materials:per[o.id]};
   if(p.dev){x.minutes=p.mins[i];if(p.meter&&p.nm){if(isPulse(o)){x.pulses=+p.own[o.id];x.own_meter=true;}else if(p.ch){var rr=p.ch[ri++];x.pulses=Math.round((rr[1]-rr[0])*1000)/1000;}}
    else if(p.meter){if(isPulse(o)){x.meter_before=p.pc[o.id][0];x.pulses=+p.own[o.id];x.own_meter=true;}else if(p.ch){var r=p.ch[ri++];x.meter_before=r[0];x.meter_after=r[1];}}}
   return x;});
  var out={visit_id:v.id,orders:orders,location_id:f.location_id.value||null,material_note:f.material_note.value||null,additional_confirmed:f.additional_confirmed.value==='true'};
  if(p.dev)out.device_id=f.device_id.value;if(p.meter&&p.nm){out.no_meter=true;var ev=root.querySelector('input[name="session_evidence"]');if(ev&&ev.value)out.evidence=ev.value;}return out;}
 var root=c.modal(title,body,function(vals,key){var pl;try{pl=payload();}catch(x){return Promise.reject(x);}return c.command('execute_many',pl,key);},function(r){if(w.SSMPDToast&&w.SSMPDToast.show)w.SSMPDToast.show('اتنفّذت '+((r&&r.executed)||'')+' خدمات','success');},{ok:'✓ نفّذ '+list.length+' خدمات'});
 if(!root)return null;root.classList.add('xall-modal');root.setAttribute('data-xall-modal','');
 var form=root.querySelector('form');
 root.querySelectorAll('[data-xall-on]').forEach(function(cb){cb.onchange=function(){rebuildMats();paint();};});
 var q=root.querySelector('[data-xall-q]');if(q)q.oninput=function(){var t=q.value.trim();root.querySelectorAll('[data-xall-row]').forEach(function(r){r.hidden=!!t&&r.textContent.indexOf(t)<0;});};
 var mt=null;
 ['device_id','minutes','meter_before','meter_after'].forEach(function(n){var el=form.elements[n];if(el){el.addEventListener('input',paint);el.addEventListener('change',paint);}});
 mt=meterTools(root,c,form.elements,{modeName:'session_mode',countName:'session_pulses',countLabel:'عدد نبضات الجلسة كلها',noMeterName:'session_no_meter',evidenceName:'session_evidence',onChange:function(){paint();}});
 if(form.elements.session_pulses)form.elements.session_pulses.addEventListener('input',paint);
 var syncDev=function(){var dv=form.elements.device_id.value?deviceOf(c,form.elements.device_id.value):null;if(mt)mt.load(form.elements.device_id.value,!!(dv&&dv.meter_kind&&dv.meter_kind!=='none')).then(paint);};
 form.elements.device_id.addEventListener('change',syncDev);
 var add=root.querySelector('[data-xall-additem]');add.onchange=function(){var k=add.value;if(!k)return;if(!mats[k])mats[k]={name:itemOf(k).name||'مستلزم',unit:itemOf(k).unit||'',qty:1,bom:{},added:true,touched:true};else{mats[k].qty+=1;mats[k].touched=true;}add.value='';paintMats();};
 form.addEventListener('input',function(e){var t=e.target,lab=t&&t.closest&&t.closest('label');if(t&&t.classList)t.classList.remove('rx-bad');var n=lab&&lab.nextSibling;if(n&&n.hasAttribute&&n.hasAttribute('data-field-err'))n.remove();});
 rebuildMats();paint();syncDev();return root;}
w.SSMPDExecuteAll={guard:guard,reveal:reveal,open:open,_t:{splitInt:splitInt,chain:chain,checks:checks,reset:function(){info={};}}};
})(window,document);
