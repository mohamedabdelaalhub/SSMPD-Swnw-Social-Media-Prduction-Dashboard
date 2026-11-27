/* Reception trial: executed-service subledger, packages and inventory. No live cutover. */
(function(){'use strict';
var active='summary',showAll={};
/* owner 2026-11-22: the accounts summary shows only the latest 5 of each list; «عرض الكل» opens the rest in place */
function latest(list,key,dateKey){var rows=(list||[]).slice();if(dateKey)rows.sort(function(x,y){return String(y[dateKey]||'').localeCompare(String(x[dateKey]||''));});return showAll[key]?rows:rows.slice(0,5);}
function moreBtn(b,key,total,c){return total>5?'<div class="rx-actions">'+b('summary-all',key,showAll[key]?'إظهار آخر 5 فقط':'عرض الكل ('+total+')')+'</div>':'';}
/* Owner 2026-11-21 «هو الموظفين لازم يعملوا ريفريش بعد فتح الوردية؟»: the collect form re-reads the shifts when it opens
   (a shift opened in another tab/screen after this page loaded now shows), lists open shifts only, picks the user's own
   open shift by itself, and with none shows «افتح ورديتك الأول» with a button that opens it. */
function shiftLabel(c,x){return c.lookup('registers',x.register_id)+(x.status==='open'?'':' — '+x.status);}
function paintShifts(c,fields,root){var sel=fields.elements.shift_id;if(!sel)return;var me=window.SSMPDAuth&&window.SSMPDAuth.currentAdmin&&window.SSMPDAuth.currentAdmin.id,open=(c.data.shifts||[]).filter(function(x){return x.status==='open'&&!x.ended_at;}),mine=open.filter(function(x){return x.cashier_id===me;}),keep=sel.value;
 sel.innerHTML='<option value="">اختر عند الكاش أو الفيزا</option>'+open.map(function(x){return '<option value="'+c.esc(x.id)+'">'+c.esc(shiftLabel(c,x))+(x.cashier_id===me?' (ورديتك)':'')+'</option>';}).join('');
 if(keep&&open.some(function(x){return x.id===keep;}))sel.value=keep;else if(mine.length===1)sel.value=mine[0].id;
 var note=fields.querySelector('[data-rx-no-shift]');if(!mine.length){if(!note){sel.closest('label').insertAdjacentHTML('afterend','<p class="rx-no-shift" data-rx-no-shift role="status">مفيش وردية مفتوحة باسمك — افتح ورديتك الأول عشان تحصّل كاش أو فيزا. <button type="button" class="btn" data-rx-open-shift>افتح ورديتي</button></p>');fields.querySelector('[data-rx-open-shift]').onclick=function(){if(root)root.remove();var live=c.data.workspace&&c.data.workspace.mode==='live';if(live&&window.SSMPDBookingCash&&document.querySelector('[data-goto="booking_cash"]'))window.SSMPDBookingCash.openForm=true;act(live?'shared-shifts':'shift_open','',c);};}}else if(note)note.remove();}
function freshShifts(c,fields,root){paintShifts(c,fields,root);var db=window.SSMPDDb;if(!db||!db.receptionSnapshot)return;Promise.resolve(db.receptionSnapshot(c.workspace,c.from,c.to)).then(function(fresh){if(!fresh||!fresh.shifts||!fields.isConnected)return;c.data.shifts=fresh.shifts;if(fresh.registers)c.data.registers=fresh.registers;paintShifts(c,fields,root);}).catch(function(){});}
/* Owner 2026-11-21: the doctor (name + specialty = provider department) on each invoice row. */
function invoiceDoctor(d,i,e){var o=i.order_id&&(d.orders||[]).find(function(x){return x.id===i.order_id;}),pr=o&&o.provider_id&&(d.providers||[]).find(function(x){return x.id===o.provider_id;});return pr?'<b>'+e(pr.name)+'</b>'+(pr.department?'<br><small>'+e(pr.department)+'</small>':''):'—';}
function rows(c,list,key){return (c.data[list]||[]).map(function(x){return [x.id,key?key(x):x.name];});}
function table(c,head,records){return '<div class="rx-table"><table><thead><tr>'+head.map(function(x){return '<th>'+c.esc(x)+'</th>';}).join('')+'</tr></thead><tbody>'+records.map(function(r){return '<tr>'+r.map(function(x){return '<td>'+x+'</td>';}).join('')+'</tr>';}).join('')+'</tbody></table></div>';}
function info(c,title,body){var r=c.modal(title,body,function(){return Promise.resolve();});r.querySelector('[type="submit"]').hidden=true;r.querySelector('[data-rx-cancel]').textContent='إغلاق';r.querySelectorAll('[data-rx-action]').forEach(function(b){b.onclick=function(){r.remove();act(b.dataset.rxAction,b.dataset.id,c);};});return r;}
function form(c,title,html,action,transform){return c.modal(title,html,function(v,k){return c.command(action,transform?transform(v):v,k);});}
function listEditor(c,title,html,action,base,columns,initial){var serial=0,root,editor;
var r=form(c,title,html+'<fieldset><legend>البنود</legend><div data-rx-lines></div><button type="button" class="btn" data-rx-add>إضافة بند</button></fieldset>',action,function(v){var out=base?base(v):v;out.lines=Array.from(editor.children).map(function(row){var x={};row.querySelectorAll('[data-field]').forEach(function(el){x[el.dataset.field]=el.dataset.field==='included'?el.value==='true':el.type==='checkbox'?el.checked:el.value;});return x;});if(action==='service'){out.bom=out.lines;delete out.lines;}if(action==='execute'){out.materials=out.lines;delete out.lines;}if(action==='package_sell'){if(out.lines.length)out.installments=out.lines;delete out.lines;}Object.keys(out).forEach(function(k){if(k.startsWith('line_'))delete out[k];});return out;});root=r;editor=r.querySelector('[data-rx-lines]');
function add(value){var div=document.createElement('div');div.className='rx-line-editor';div.innerHTML=columns.map(function(col){var n='line_'+(++serial),v=value&&value[col.key];return col.options?c.select(n,col.label,col.options,v).replace('<select ', '<select data-field="'+col.key+'" '):c.field(n,col.label,col.type||'text',v,col.extra||'required').replace('<input ','<input data-field="'+col.key+'" ');}).join('')+'<button class="btn" type="button" aria-label="إزالة البند">إزالة</button>';div.querySelector('button').onclick=function(){div.remove();};editor.appendChild(div);}
r.querySelector('[data-rx-add]').onclick=function(){add({});};r.replaceInstallmentLines=function(lines){editor.replaceChildren();lines.forEach(add);};(initial===undefined?[{}]:initial).forEach(add);return root;}
// Package offers (owner 2026-11-24, server 20261123170000): sell window + the minimum next payment (the server enforces both).
function pkgSellable(t,today){return (!t.sell_from||String(t.sell_from).slice(0,10)<=today)&&(!t.sell_until||String(t.sell_until).slice(0,10)>=today);}
function pkgWindowLabel(t){var u=t.sell_until?String(t.sell_until).slice(0,10).split('-').reverse().join('/'):'';return u?' — عرض لحد '+u:'';}
function pkgMinimum(p){if(!p||p.min_first_percent==null||p.min_first_percent==='')return null;var pct=+p.min_first_percent,price=+p.contract_price||0,owed=Math.max(0,price-(+p.funded||0))+(+p.due||0),first=!(+p.paid>0),
 visits={};(p.lines||[]).forEach(function(l){if(+l.used<+l.quantity)visits[l.visit_no]=1;});var left=Math.max(1,Object.keys(visits).length),base=Math.round(price*pct)/100;
 var min=first?base:Math.max(base,Math.round(owed/left*100)/100);return {percent:pct,first:first,owed:Math.round(owed*100)/100,minimum:Math.min(Math.round(owed*100)/100,min)};}
// Packages whose number of visits the patient chooses at sale (laser: one package per device). The template price is ONE visit.
function attachVariableVisits(root,templates,money){
 var fieldset=root.querySelector('[data-rx-variable]'),template=root.querySelector('[name="template_id"]');
 var visits=fieldset.querySelector('[name="var_visits"]'),days=fieldset.querySelector('[name="var_days"]'),total=fieldset.querySelector('output');
 function selected(){return templates.find(function(item){return item.id===template.value;});}
 function refresh(){
  var item=selected(),on=!!(item&&item.variable_visits),count=Number(visits.value);
  fieldset.hidden=!on;visits.disabled=!on;days.disabled=!on;visits.required=on;
  total.textContent=on&&Number.isInteger(count)&&count>=1&&count<=365?'الإجمالي '+money(Number(item.price)*count)+' ('+count+' × '+money(item.price)+')':'';
 }
 root.visitTerms=function(){
  var item=selected();
  if(!item||!item.variable_visits)return null;
  var terms={visits:visits.value.trim()};
  if(days.value.trim())terms.days=days.value.trim();
  return terms;
 };
 template.addEventListener('change',refresh);
 ['input','change'].forEach(function(name){visits.addEventListener(name,refresh);days.addEventListener(name,refresh);});
 refresh();
}
function attachOrthodonticSchedule(root, templates, money){
 var toggle=root.querySelector('[data-rx-orthodontic]');
 var fieldset=toggle.closest('fieldset');
 var date=fieldset.querySelector('[data-rx-start]');
 var preview=fieldset.querySelector('output');
 var button=fieldset.querySelector('button');
 var template=root.querySelector('[name="template_id"]');
 var price=fieldset.querySelector('[name="ortho_price"]');
 var visitsField=fieldset.querySelector('[name="ortho_visits"]');
 var days=fieldset.querySelector('[name="ortho_days"]');
 var mode=fieldset.querySelector('[name="ortho_schedule"]');
 function defaults(){
  var selected=templates.find(function(item){return item.id===template.value;});
  price.value=selected&&selected.price||'';
  visitsField.value=selected&&selected.visits||'';
  days.value=selected&&selected.validity_days||'';
  refresh();
 }
 root.orthodonticTerms=function(){
  var selected=templates.find(function(item){return item.id===template.value;});
  return toggle.checked&&selected&&selected.orthodontic?{
   price:price.value,visits:visitsField.value,days:days.value,schedule:mode.value
  }:null;
 };
 function schedule(){
  var selected=templates.find(function(item){return item.id===template.value;});
  if(!selected||!date.value)return null;
  var terms=root.orthodonticTerms();
  var total=Math.round(Number(terms?terms.price:selected.price)*100);
  var visits=Number(terms?terms.visits:selected.visits);
  if(!Number.isSafeInteger(total)||total<1||!Number.isInteger(visits)||visits<1||visits>365)return null;
  var deposit=Math.round(total/4);
  var balance=total-deposit;
  var amount=Math.floor(balance/visits);
  var remainder=balance%visits;
  var first=new Date(date.value+'T00:00:00Z');
  if(Number.isNaN(first.valueOf()))return null;
  var lines=[{due_on:date.value,amount:(deposit/100).toFixed(2)}];
  for(var index=1;index<=visits;index++){
   var month=new Date(Date.UTC(first.getUTCFullYear(),first.getUTCMonth()+index,1));
   var last=new Date(Date.UTC(month.getUTCFullYear(),month.getUTCMonth()+1,0)).getUTCDate();
   month.setUTCDate(Math.min(last,first.getUTCDate()));
   var installment=amount+Number(index<=remainder);
   if(installment>0)lines.push({due_on:month.toISOString().slice(0,10),amount:(installment/100).toFixed(2)});
  }
  return {deposit:deposit,amount:amount,visits:visits,lines:lines};
 }
 function refresh(){
  var plan=toggle.checked?schedule():null;
  button.disabled=!plan;
  [price,visitsField,days,mode].forEach(function(field){field.disabled=!root.orthodonticTerms();});
  preview.textContent=plan?'المقدم '+money(plan.deposit/100)+'، والقسط حسب '+plan.visits+' زيارة حوالي '+money(plan.amount/100):'';
 }
 toggle.addEventListener('change',refresh);
 date.addEventListener('change',refresh);
 template.addEventListener('change',defaults);
 [price,visitsField,days,mode].forEach(function(field){field.addEventListener('input',refresh);});
 button.onclick=function(){
  var plan=schedule();
  if(!toggle.checked||!plan)return;
  if(root.querySelector('[data-rx-lines]').children.length&&!window.confirm('استبدال جدول الدفعات الحالي؟'))return;
  root.replaceInstallmentLines(plan.lines);
 };
 refresh();
}
function packagePaymentPosition(pkg, today, attended){
 var planned=(pkg.installments||[]).slice().sort(function(a,b){return pkg.payment_schedule==='visit'?a.plan_visit_no-b.plan_visit_no:a.due_on.localeCompare(b.due_on);});
 if(!planned.length)return null;
 var total=Math.round(Number(pkg.contract_price)*100);
 var paid=Math.round(Number(pkg.paid||0)*100);
 var remaining=Math.max(0,total-paid);
 var scheduled=0,due=0,suggested=0;
 planned.forEach(function(line){
  var amount=Math.round(Number(line.amount)*100);
  var before=scheduled;
  scheduled+=amount;
  if(pkg.payment_schedule==='visit'?line.plan_visit_no===0||attended.includes(line.plan_visit_no):line.due_on<=today)due+=amount;
  if(!suggested&&scheduled>paid)suggested=Math.min(amount,scheduled-Math.max(before,paid));
 });
 var overdue=Math.max(0,due-paid);
 if(pkg.payment_schedule==='visit')suggested=Math.min(overdue,suggested);
 return {remaining:remaining/100,overdue:overdue/100,suggested:Math.min(remaining,suggested)/100};
}
function cairoDate(){
 var parts=new Intl.DateTimeFormat('en-GB',{timeZone:'Africa/Cairo',year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(new Date());
 var value={};
 parts.forEach(function(part){value[part.type]=part.value;});
 return value.year+'-'+value.month+'-'+value.day;
}
function patient(c){return c.select('patient_id','رقم الملف — المريض',rows(c,'patients',function(p){return p.file_no+' — '+p.name;}));}
function reason(c){return c.field('reason','السبب');}
function review(c,title,action,id){return form(c,title,c.select('approve','القرار',[['true','اعتماد'],['false','رفض']]),action,function(v){return {id:id,approve:v.approve==='true'};});}
function reviseSchedule(c,pkg){
 var rows=(pkg.installments||[]).filter(function(line){return line.plan_visit_no>0&&!line.invoice_id&&line.due_on>cairoDate();});
 var body=c.field('reason','سبب تغيير المواعيد');
 rows.forEach(function(line,index){
  body+=c.field('due_'+index,'زيارة '+line.plan_visit_no+' · '+c.money(line.amount),'date',line.due_on);
 });
 c.modal('تعديل تواريخ الأقساط',body,function(values,token){
  var dates=rows.map(function(line,index){return {id:line.id,due_on:values['due_'+index]};})
   .filter(function(line,index){return line.due_on!==rows[index].due_on;});
  return c.command('revise_plan_schedule',{package_id:pkg.id,reason:values.reason,dates:dates},token);
 });
}
/* «دفعة واحدة لأكتر من زيارة» (20261122160000; Manar 2026-11-22: one wallet transfer paid two family visits). The server checks the family
   (أفراد العيلة + same phone) again; here we only offer the open visits of the same patient or the same phone. */
function phoneKey(v){var x=String(v||'').replace(/\D/g,'');return x.length>=8?x.slice(-10):'';}
/* owner 2026-11-23 «طبقه» (20261122390000): a payment that covered more than one visit shows «دفعة واحدة لـN زيارات» + its note */
function payVisits(d,pid){var MP=window.SSMPDMultiPay;if(!MP)return 0;return MP.countVisits((d.allocations||[]).filter(function(a){return a.payment_id===pid;}),function(a){var i=(d.invoices||[]).find(function(x){return x.id===a.invoice_id;});return i?(i.visit_id||i.id):a.invoice_id;});}
function payNote(d,p){var MP=window.SSMPDMultiPay;return MP?MP.block(payVisits(d,p.id),p.note,p.cross_patient):'';}
function multiCandidates(d,fixed){var pats=d.patients||[],me=pats.find(function(p){return p.id===fixed.patient_id;})||{},ph=phoneKey(me.phone);
 var fam={};fam[fixed.patient_id]=1;pats.forEach(function(p){if(ph&&phoneKey(p.phone)===ph)fam[p.id]=1;});(d.family_links||[]).forEach(function(l){if(fam[l.patient_id])fam[l.relative_id]=1;else if(fam[l.relative_id])fam[l.patient_id]=1;});
 var open=(d.invoices||[]).filter(function(i){return i.id!==fixed.id&&!i.package_id&&Number(i.due)>0;});
 return {family:open.filter(function(i){return fam[i.patient_id];}),others:open.filter(function(i){return !fam[i.patient_id];})};}
/* owner 2026-11-23 (friends, one transfer): «دفع كمان عن زيارة مريض تاني» — open visits of ANY patient, a mandatory note
   «مين دفع عن مين؟», one receipt / one reference; the payment is flagged for the finance reviewer (20261122380000). */
function multiBlock(c,cand){var line=function(i,attr){return '<label data-rx-multi-row data-q="'+c.esc((c.lookup('patients',i.patient_id)||'')+' '+(c.lookup('patients',i.patient_id,'file_no')||''))+'"><input type="checkbox" '+attr+' value="'+c.esc(i.id)+'" data-due="'+c.esc(i.due)+'"> '+c.esc(c.lookup('patients',i.patient_id))+' — '+c.esc(c.lookup('patients',i.patient_id,'file_no')||'')+' — '+c.esc(i.description)+' — باقي '+c.money(i.due)+'</label>';};
 return '<fieldset class="rx-multi" data-rx-multi><legend><label><input type="checkbox" data-rx-multi-on> الدفعة دي لأكتر من زيارة (نفس التحويل أو نفس الإيصال)</label></legend><div data-rx-multi-list hidden><p>علّم الزيارات التانية اللي اتدفعت بنفس المبلغ — للمريض أو لحد من عيلته. هيطلع إيصال واحد برقم عملية واحد، وكل زيارة تتسجل لوحدها في الحسابات.</p>'+
 (cand.family.length?cand.family.map(function(i){return line(i,'data-rx-multi-inv');}).join(''):'<p class="rx-multi-none">مفيش زيارات تانية مفتوحة للمريض أو عيلته.</p>')+
 (cand.others.length?'<div class="rx-multi-other"><label><input type="checkbox" data-rx-multi-other-on> <b>دفع كمان عن زيارة مريض تاني</b> (مش من العيلة — صاحبه أو زميله مثلاً)</label><div data-rx-multi-other hidden><input type="search" data-rx-multi-q placeholder="ابحث بالاسم أو رقم الملف" aria-label="ابحث عن زيارة مريض تاني">'+
  cand.others.map(function(i){return line(i,'data-rx-multi-inv data-rx-multi-x');}).join('')+'<p class="rx-multi-warn">لازم تكتب في «ملاحظة» مين دفع عن مين. التحصيل ده بيظهر للمراجعة المالية إنه «دفعة واحدة لأكتر من مريض».</p></div></div>':'')+
 '<p data-rx-multi-total></p></div></fieldset>';}
function bindMulti(c,root,fixed){var box=root.querySelector('[data-rx-multi]');if(!box)return;var on=box.querySelector('[data-rx-multi-on]'),list=box.querySelector('[data-rx-multi-list]'),amount=root.querySelector('[name="amount"]'),total=box.querySelector('[data-rx-multi-total]');
 var oOn=box.querySelector('[data-rx-multi-other-on]'),oBox=box.querySelector('[data-rx-multi-other]'),q=box.querySelector('[data-rx-multi-q]'),note=root.querySelector('[name="note"]');
 function sum(){var t=Number(fixed.due)||0,n=1,x=false;if(on.checked)box.querySelectorAll('[data-rx-multi-inv]:checked').forEach(function(el){if(el.hasAttribute('data-rx-multi-x')&&!(oOn&&oOn.checked))return;t+=Number(el.getAttribute('data-due'))||0;n++;if(el.hasAttribute('data-rx-multi-x'))x=true;});if(amount)amount.value=Math.round(t*100)/100;total.textContent=n>1?'إجمالي '+n+' زيارات: '+c.money(t):'';
  if(note){note.required=x;note.minLength=x?5:0;note.placeholder=x?'مين دفع عن مين؟ مثلًا: يحيى دفع التحويل كله عن نفسه وعن صاحبه':'مثلًا: تحويل واحد لزيارتين — منار وابنها';}}
 on.addEventListener('change',function(){list.hidden=!on.checked;sum();});box.querySelectorAll('[data-rx-multi-inv]').forEach(function(x){x.addEventListener('change',sum);});
 if(oOn)oOn.addEventListener('change',function(){oBox.hidden=!oOn.checked;sum();});
 if(q)q.addEventListener('input',function(){var v=q.value.trim().toLowerCase();oBox.querySelectorAll('[data-rx-multi-row]').forEach(function(r){r.hidden=!!v&&String(r.getAttribute('data-q')).toLowerCase().indexOf(v)<0;});});}
function multiPicked(root){var box=root&&root.querySelector('[data-rx-multi]');if(!box||!box.querySelector('[data-rx-multi-on]').checked)return [];var oOn=box.querySelector('[data-rx-multi-other-on]');
 return Array.prototype.filter.call(box.querySelectorAll('[data-rx-multi-inv]:checked'),function(x){return !x.hasAttribute('data-rx-multi-x')||(oOn&&oOn.checked);}).map(function(x){return x.value;});}
function multiCross(root){var box=root&&root.querySelector('[data-rx-multi]'),oOn=box&&box.querySelector('[data-rx-multi-other-on]');return !!(box&&box.querySelector('[data-rx-multi-on]').checked&&oOn&&oOn.checked&&box.querySelector('[data-rx-multi-x]:checked'));}
function splitReceipt(c,pkg){
 var fields=c.field,select=c.select,format=c.money;
 var methods=[['cash','نقدي'],['pos','بطاقة'],['instapay','إنستا باي'],['bank','تحويل بنكي'],['wallet','محفظة إلكترونية']];
 var shifts=[['','بدون وردية']].concat(rows(c,'shifts',function(x){return c.lookup('registers',x.register_id)+' — '+x.status;}));
 var body='';
 for(var part=1;part<=2;part++){
  body+='<fieldset><legend>جزء '+part+'</legend>'+
   fields('amount_'+part,'المبلغ','number','','required min="0.01" step="0.01"')+
   select('method_'+part,'طريقة السداد',methods)+
   fields('reference_'+part,'مرجع العملية')+(window.SSMPDPaymentProof?window.SSMPDPaymentProof.field(part):'')+select('shift_'+part,'الوردية',shifts)+'</fieldset>';
 }
 var splitRoot=c.modal('تحصيل باكج بطريقتين',body,function(v,key){
  var proof=window.SSMPDPaymentProof;
  return Promise.all([1,2].map(function(n){return (proof?proof.upload(c.workspace,v['method_'+n],v['reference_'+n],v['proof_file_'+n]):Promise.resolve(v['reference_'+n])).then(function(ref){
   return {amount:v['amount_'+n],method:v['method_'+n],reference:ref,shift_id:v['shift_'+n]||null};});})).then(function(parts){
  return c.command('collect_split',{patient_id:pkg.patient_id,package_id:pkg.id,parts:parts},key);});
 },function(receipt){
  info(c,'إيصال التحصيل','<p>رقم الإيصال '+c.esc(receipt.id)+'</p><p>الإجمالي '+format(receipt.total)+'</p>');
 });
 if(splitRoot&&window.SSMPDPaymentProof)[1,2].forEach(function(n){window.SSMPDPaymentProof.bind(splitRoot,n);});
}
function panel(section,c){var d=c.data,e=c.esc,m=c.money,b=c.btn;/* moved out of «التحصيل والمستلزمات» (owner 2026-11-22) */if(section==='followup')return window.SSMPDReceptionControls?window.SSMPDReceptionControls.panel('followup',c):'';if(section==='packages'&&window.SSMPDReceptionLook&&window.SSMPDReceptionLook.packages){window.SSMPDReceptionLook.pkgTools=pkgTools;return window.SSMPDReceptionLook.packages(c);}if(section==='packages')return '<div class="rx-actions">'+b('package_sell','','تعاقد على باكج')+(d.can_manage?b('template','','تعريف باكج'):'')+'</div>'+table(c,['الباكج والمريض','الرصيد المالي','الزيارات','الإجراء'],(d.packages||[]).map(function(p){var done=Array.from(new Set(p.lines.map(function(l){return l.visit_no;}))).filter(function(n){return p.lines.filter(function(l){return l.visit_no===n;}).every(function(l){return +l.used>=+l.quantity;});}).length;return [e(p.name)+'<br>'+e(c.lookup('patients',p.patient_id)), 'قيمة التعاقد '+m(p.contract_price)+'<br>محصل ومخصص '+m(p.paid)+'<br>مطلوب حاليًا '+m(p.due)+'<br>باقي قيمة العقد '+m(Math.max(0,p.contract_price-p.funded)),'مكتمل الخدمات '+done+' / '+p.visits+'<br>الصلاحية '+e(p.expires_on),b('package-detail',p.id,'كشف الباكج')+b('collect-package',p.id,'تحصيل')];}));
if(section!=='operations')return '';
var tabs=[['summary','الحساب والفواتير'],['stock','المستلزمات والمخزون'],['shifts','الخزن والورديات'],['controls','التعاقدات والتصحيحات'],['reports','التقارير والتحليل']];if(d.can_review&&!d.can_manage)tabs.push(['review','المراجعة والاعتماد']);if(d.can_manage)tabs.push(['catalog','الإعدادات والعقود'],['review','المراجعة والاعتماد'],['journal','سجل القيود']);
if(!tabs.some(function(t){return t[0]===active;}))active='summary';var html='<nav class="rx-subnav" aria-label="أقسام العمليات">'+tabs.filter(function(t){return !['catalog','review','journal'].includes(t[0]);}).map(function(t){return '<button type="button" class="btn '+((['catalog','review'].includes(active)?'controls':active==='journal'?'reports':active)===t[0]?'btn-primary':'')+'" data-rx-action="operations-tab" data-id="'+t[0]+'">'+t[1]+'</button>';}).join('')+'</nav>';
if(window.SSMPDReceptionControls&&['controls','reports'].includes(active))html+=window.SSMPDReceptionControls.panel(active,c);
if(active==='summary'){/* owner 2026-11-22: «حطه مكان الجدول الحالي» — patient balances in the new look replace the plain table here */if(window.SSMPDReceptionLook&&window.SSMPDReceptionLook.balances)html+=window.SSMPDReceptionLook.balances(c);else html+='<div class="rx-actions">'+b('collect','','تسجيل تحصيل')+b('credit_apply','','استخدام رصيد المريض')+'</div>'+'<h4>ملفات المرضى (الأعلى مديونية أولًا)</h4>'+table(c,['ملف المريض','عليه الآن','له رصيد'],latest((d.patients||[]).slice().sort(function(x,y){return (+y.due||0)-(+x.due||0);}),'patients').map(function(p){return [e(p.file_no)+' — '+e(p.name),m(p.due),m(p.credit)];}))+moreBtn(b,'patients',(d.patients||[]).length,c);html+='<h4>'+(showAll.invoices?'كل الفواتير':'آخر 5 فواتير')+'</h4>'+table(c,['الفاتورة والزيارة','المريض','الطبيب / التخصص','القيمة','الباقي','إجراء'],latest(d.invoices,'invoices','created_at').map(function(i){var visit=d.visits.find(function(v){return v.id===i.visit_id;});return [e(i.description)+'<br>'+(visit?'زيارة '+visit.visit_no:'قسط تعاقدي'),e(c.lookup('patients',i.patient_id)),invoiceDoctor(d,i,e),m(i.amount),m(i.due),b('invoice-detail',i.id,'عرض البيان')+(i.visit_id&&window.SSMPDPatientInvoicePrint?b('visit-invoice-print',i.visit_id,'طباعة فاتورة الزيارة'):'')+(+i.due>0?b('collect-invoice',i.id,'تحصيل'):'مسددة')];}))+moreBtn(b,'invoices',(d.invoices||[]).length,c);html+='<h4>'+(showAll.payments?'كل إيصالات التحصيل':'آخر 5 إيصالات تحصيل')+'</h4>'+table(c,['إيصال التحصيل','الطريقة','المبلغ','التاريخ','الإجراء'],latest(d.payments,'payments','created_at').map(function(p){return [(p.receipt_no?'<span dir="ltr">'+e(p.receipt_no)+'</span>'+(p.method!=='cash'?'<br><small>رقم العملية '+e(p.reference)+'</small>':''):e(p.reference))+payNote(d,p),e(method(p.method)),m(p.amount),c.stamp(p.created_at),b('receipt-detail',p.id,'عرض الإيصال')+(p.proof_path&&window.SSMPDPaymentProof?b('payment-proof',p.id,'صورة الإيصال'):'')];}))+moreBtn(b,'payments',(d.payments||[]).length,c);}
if(active==='stock'){html+='<div class="rx-actions">'+b('transfer_request','','طلب تحويل مخزن')+b('count','','تسجيل جرد')+(d.can_manage?b('purchase','','إذن شراء'):'')+'</div>'+table(c,['المستلزم','سعر البيع للجمهور','التشغيلة / الصلاحية','المخزن','المتاح'],(d.stock||[]).map(function(s){var i=d.items.find(function(i){return i.id===s.item_id;});return [e(i&&i.name),m(i&&i.sale_price),e(s.number||'—')+' / '+e(s.expiry_date||'بدون صلاحية'),e(c.lookup('locations',s.location_id)),e(s.quantity)];}));html+=table(c,['إذن الشراء','الحالة','الإجراء'],(d.purchases||[]).map(function(p){return [e(p.reference)+' — '+e(c.lookup('suppliers',p.supplier_id)),e(p.status),p.status==='approved'&&p.lines.some(function(l){return +l.received<+l.quantity;})?b('receive_purchase',p.id,'استلام فعلي'):''];}));}
if(active==='shifts'&&window.SSMPDReceptionShiftsView){html+=window.SSMPDReceptionShiftsView.panel({c:c,d:d,b:b,e:e,m:m});}else if(active==='shifts'){html+='<div class="rx-actions">'+b('shift_open','','فتح وردية')+'</div>'+table(c,['الخزينة','الحالة','النتيجة','الإجراء'],(d.shifts||[]).map(function(s){return [e(c.lookup('registers',s.register_id)),e(s.status),s.status==='open'?'العد عند الإغلاق':('الفعلي '+m(s.counted)+' — الفرق '+m(s.difference)),s.status==='open'?b('shift_close',s.id,'إغلاق وعد النقدية'):s.status==='submitted'&&d.can_manage?b('shift_review',s.id,'مراجعة مستقلة'):''];}));}
if(active==='catalog'){html+='<div class="rx-actions">'+[['item','مستلزم'],['location','مخزن'],['supplier','مورد'],['register','خزينة'],['device','جهاز'],['agreement','عقد أتعاب طبيب'],['member','صلاحيات التجربة']].map(function(x){return b(x[0],'','إضافة '+x[1]);}).join('')+'</div>';html+=table(c,['المستلزم','مرجع الشراء الأعلى','هامش على التكلفة','سعر البيع'],d.items.map(function(i){return [e(i.name),m(i.highest_cost),e(i.markup)+'%',m(i.sale_price)];}));html+=table(c,['الطبيب والخدمة','النسبة','الأساس','الحالة'],d.agreements.map(function(a){return [e(c.lookup('providers',a.provider_id))+' / '+e(a.service_code),e(a.rate)+'%',a.deduct_material_cost?'صافي الخدمة بعد تكلفة المشمول':'صافي الخدمة المنفذة',e(a.status)];}));}
if(active==='review'){html+='<p>المراجع يجب أن يكون شخصًا آخر. منح الصلاحية لا يرسل رسالة أو دعوة.</p>';[['agreements','agreement_review','عقد أتعاب'],['purchases','purchase_review','أمر شراء'],['discounts','discount_review','خصم']].forEach(function(set){html+=table(c,[set[2],'الإجراء'],(d[set[0]]||[]).filter(function(x){return x.status==='pending';}).map(function(x){return [e(x.reference||x.reason),b(set[1],x.id,'مراجعة')];}));});(d.packages||[]).forEach(function(p){html+=table(c,['قسط '+p.name,'الإجراء'],p.installments.filter(function(x){return !x.invoice_id;}).map(function(x){return [e(x.due_on)+' — '+m(x.amount),b('installment_bill',x.id,'إثبات حق تحصيل غير مشروط')];}));});}
if(active==='journal'){html+=table(c,['الحدث','التاريخ','الحساب','مدين','دائن'],(d.journal||[]).flatMap(function(j){return j.lines.map(function(l){return [e(j.description),c.stamp(j.created_at),e(window.SSMPDFinanceLabels&&window.SSMPDFinanceLabels.accountLabel?window.SSMPDFinanceLabels.accountLabel(l.account,l.account_name):l.account),m(l.debit),m(l.credit)];});}));}
if(active==='stock'&&d.workspace.mode==='trial'&&window.SSMPDReceptionControls)html+=window.SSMPDReceptionControls.panel('transfers',c);return html;}
function method(v){return {cash:'نقدي',pos:'فيزا',instapay:'إنستا باي',bank:'تحويل بنكي',wallet:'محفظة إلكترونية'}[v]||v;}
/* package tools shared by the classic statement and the new look — same permission conditions */
function pkgTools(c,p){var d=c.data,id=p.id,t=[];if(p.status==='active'&&window.SSMPDReceptionControls)t.push(['request-package-cancel','طلب إيقاف وتسوية']);if(d.split_receipts_enabled)t.push(['collect-split','تحصيل بطريقتين']);if(d.split_receipts_enabled&&d.can_manage&&p.status==='active'&&p.payment_schedule==='fixed'&&(p.installments||[]).some(function(line){return line.plan_visit_no>0&&!line.invoice_id&&line.due_on>cairoDate();}))t.push(['revise-schedule','تعديل تواريخ الأقساط']);if(d.plan_amendments_enabled&&d.can_manage&&p.status==='active'&&p.payment_schedule==='visit')t.push(['amend-plan','تعديل السعر والزيارات']);if(d.plan_amendments_enabled&&d.can_manage&&p.status==='active'&&(p.lines||[]).some(function(line){return line.snapshot.name.includes('ليزر')&&!Number(line.used);}))t.push(['amend-laser','تعديل طريقة حساب زيارة ليزر']);return t;}
function act(a,id,c){var d=c.data,e=c.esc,b=c.btn,m=c.money,f=c.field,s=c.select,r;if(window.SSMPDVisitSupplies&&window.SSMPDVisitSupplies.act(a,id,c))return true;if(window.SSMPDReceptionBridge&&window.SSMPDReceptionBridge.act(a,id,c))return true;if(window.SSMPDReceptionControls&&window.SSMPDReceptionControls.act(a,id,c))return true;
if(a==='operations-tab'){active=id;c.load();return true;}
if(a==='summary-all'){showAll[id]=!showAll[id];c.load();return true;}
if(a==='patient-detail'&&window.SSMPDReceptionLook){var lp=d.patients.find(function(p){return p.id===id;});if(lp){info(c,'تفاصيل المريض والحساب',window.SSMPDReceptionLook.patientDetail(c,lp));return true;}}
if(a==='patient-detail'){var pat=d.patients.find(function(p){return p.id===id;});info(c,'كشف ملف التجربة','<p>'+e(pat.file_no)+' — '+e(pat.name)+'</p>'+(pat.archive_patient_id?b('archive-open',pat.archive_patient_id,'فتح الملف الطبي بالأرشيف'):'')+'<p>عليه الآن '+m(pat.due)+' — له رصيد '+m(pat.credit)+'</p>'+table(c,['الزيارة','الحالة'],d.visits.filter(function(v){return v.patient_id===id;}).map(function(v){return [b('visit-detail',v.id,'زيارة '+v.visit_no),e(v.status)];})));return true;}
if(a==='execute_all'&&window.SSMPDExecuteAll){window.SSMPDExecuteAll.open(c,id);return true;}/* «تنفيذ الكل» (owner 2026-11-27) */if(a==='visit-detail'&&window.SSMPDReceptionLook){var lv=d.visits.find(function(x){return x.id===id;});if(lv){var vr=info(c,'تفاصيل الزيارة',window.SSMPDReceptionLook.visitDetail(c,lv));if(vr&&window.SSMPDExecuteAll)window.SSMPDExecuteAll.reveal(vr,c);return true;}}
if(a==='visit-detail'){var v=d.visits.find(function(x){return x.id===id;});info(c,'زيارة '+v.visit_no+' — '+c.lookup('patients',v.patient_id),'<p>ملف '+e(c.lookup('patients',v.patient_id,'file_no'))+'</p>'+table(c,['الخدمة','المبلغ','الحالة','الإجراء'],d.orders.filter(function(o){return o.visit_id===id;}).map(function(o){return [e(o.snapshot.name),m(o.price*o.quantity),e(o.status),o.status==='ordered'?b('execute',o.id,'تنفيذ وتسجيل الاستهلاك')+b('discount',o.id,'خصم')+b('order_cancel',o.id,'إلغاء الطلب')+b('quote',o.id,'تطبيق عقد جهة'):'تم التنفيذ'];}))+(d.orders.some(function(o){return o.visit_id===id&&o.status==='completed';})?b('visit-supplies',id,'مستلزمات الزيارة'):'')+(v.status==='open'?b('order_add',id,'إضافة خدمة للزيارة')+b('visit_close',id,'إنهاء الزيارة'):''));return true;}
if(a==='visit-invoice-print'){window.SSMPDPatientInvoicePrint.print(c.workspace,id).catch(function(err){alert((err&&err.message)||'تعذر تجهيز الفاتورة');});return true;}
if(a==='payment-proof'){var pp=(d.payments||[]).find(function(x){return x.id===id;});if(pp&&pp.proof_path)window.SSMPDPaymentProof.open(pp.proof_path).catch(function(){alert('تعذر فتح الصورة');});return true;}
if(a==='package-detail'&&window.SSMPDReceptionLook&&window.SSMPDReceptionLook.packageDetail){var lk=d.packages.find(function(x){return x.id===id;});if(lk){info(c,lk.name,window.SSMPDReceptionLook.packageDetail(c,lk,pkgTools(c,lk),(d.split_receipts||[]).filter(function(r){return r.package_id===id;})));return true;}}
if(a==='package-detail'){var p=d.packages.find(function(x){return x.id===id;});info(c,p.name,'<p>'+e(c.lookup('patients',p.patient_id))+' — '+e(p.terms)+'</p><p>قيمة العقد '+m(p.contract_price)+' · المحصل المخصص '+m(p.paid)+' · المستحق الآن '+m(p.due)+' · خدمات منفذة '+m(p.recognized)+'</p><p>رصيد المريض العام '+m((d.patients.find(function(x){return x.id===p.patient_id;})||{}).credit)+'؛ قد يشمل مبالغ لا تخص هذا الباكج.</p>'+table(c,['زيارة الباكج','الخدمة','المتاح','القيمة المخصصة'],p.lines.map(function(l){return [e(l.visit_no),e(l.snapshot.name),e(l.quantity-l.used)+' / '+e(l.quantity),m(l.allocated_value)];}))+(d.split_receipts||[]).filter(function(receipt){return receipt.package_id===id;}).map(function(receipt){return b('split-receipt',receipt.id,'إيصال '+m(receipt.total));}).join('')+b('collect-package',id,'تحصيل للباكج')+(p.status==='active'&&window.SSMPDReceptionControls?b('request-package-cancel',id,'طلب إيقاف وتسوية'):'')+(d.split_receipts_enabled?b('collect-split',id,'تحصيل بطريقتين'):'')+(d.split_receipts_enabled&&d.can_manage&&p.status==='active'&&p.payment_schedule==='fixed'&&(p.installments||[]).some(function(line){return line.plan_visit_no>0&&!line.invoice_id&&line.due_on>cairoDate();})?b('revise-schedule',id,'تعديل تواريخ الأقساط'):'')+(d.plan_amendments_enabled&&d.can_manage&&p.status==='active'&&p.payment_schedule==='visit'?b('amend-plan',id,'تعديل السعر والزيارات'):'')+(d.plan_amendments_enabled&&d.can_manage&&p.status==='active'&&(p.lines||[]).some(function(line){return line.snapshot.name.includes('ليزر')&&!Number(line.used);})?b('amend-laser',id,'تعديل طريقة حساب زيارة ليزر'):''));return true;}
if(a==='item')form(c,'تعريف مستلزم',f('code','كود المستلزم')+f('name','الاسم')+f('unit','الوحدة')+f('markup','نسبة الزيادة على تكلفة الشراء %','number','0','required min="0" step="0.0001"')+s('track_expiry','له صلاحية',[['true','نعم'],['false','لا']]),a,function(v){v.track_expiry=v.track_expiry==='true';return v;});
else if(['location','supplier'].includes(a))form(c,a==='location'?'تعريف مخزن':'تعريف مورد',f('name','الاسم'),a);
else if(a==='register')form(c,'إعداد خزينة',f('name','اسم الخزينة')+s('direction','نوع الحركة',[['receive','استلام فقط'],['pay','صرف فقط'],['both','صرف واستلام']]),a);
else if(a==='device')form(c,'تعريف جهاز',f('code','كود الجهاز')+f('name','الاسم')+s('meter_kind','نوع العداد',[['none','بدون عداد'],['shots','نبضات'],['hours','ساعات']])+f('asset_key','مرجع الأصل إن وجد','text','',' '),a);
else if(a==='member'){r=form(c,'صلاحيات مساحة التجربة',s('admin_id','المستخدم',rows(c,'people'))+'<fieldset><legend>الصلاحيات — إلغاء الكل يسحب العضوية</legend>'+[['view','عرض'],['book','حجز وملفات'],['execute','تنفيذ خدمات'],['collect','تحصيل وورديات'],['warehouse','استلام مخزون'],['review','مراجعة مستقلة'],['manage','إدارة كاملة'],['finance_review','اعتماد مالي للخصم الكبير'],['reports','تقارير']].map(function(x){return '<label><input type="checkbox" name="cap_'+x[0]+'">'+x[1]+'</label>';}).join('')+'</fieldset>',a,function(v){return {admin_id:v.admin_id,capabilities:Object.keys(v).filter(function(k){return k.startsWith('cap_');}).map(function(k){return k.slice(4);})};});var user=r.querySelector('[name="admin_id"]');user.onchange=function(){var member=(d.members||[]).find(function(x){return x.admin_id===user.value;});r.querySelectorAll('[type="checkbox"]').forEach(function(x){x.checked=!!member&&member.capabilities.includes(x.name.slice(4));});};}
else if(a==='agreement')form(c,'عقد أتعاب الطبيب',s('provider_id','الطبيب',rows(c,'providers'))+s('service_code','الخدمة',d.services.map(function(s){return [s.code,s.name];}))+f('rate','النسبة %','number','0','required min="0" max="100" step="0.0001"')+s('deduct_material_cost','أساس الأتعاب',[['false','صافي الخدمة المنفذة'],['true','صافي الخدمة بعد تكلفة المستلزم المشمول']])+f('from','من','date')+f('to','إلى','date')+f('reference','رقم العقد'),a,function(v){v.deduct_material_cost=v.deduct_material_cost==='true';return v;});
else if(['agreement_review','purchase_review','discount_review'].includes(a))review(c,'مراجعة واعتماد مستقل',a,id);
else if(a==='purchase')listEditor(c,'إذن شراء',s('supplier_id','المورد',rows(c,'suppliers'))+f('reference','رقم فاتورة / إيصال المورد')+f('note','ملاحظات','text','',' '),a,null,[{key:'item_id',label:'المستلزم',options:rows(c,'items')},{key:'quantity',label:'الكمية',type:'number',extra:'required min="0.001" step="0.001"'},{key:'unit_cost',label:'سعر شراء الوحدة',type:'number',extra:'required min="0" step="0.0001"'}]);
else if(a==='receive_purchase'){var purchase=d.purchases.find(function(p){return p.id===id;});listEditor(c,'استلام فعلي — '+purchase.reference,s('location_id','مخزن الاستلام',rows(c,'locations')),a,function(v){return {id:id,location_id:v.location_id};},[{key:'line_id',label:'البند',options:purchase.lines.filter(function(l){return +l.received<+l.quantity;}).map(function(l){return [l.id,c.lookup('items',l.item_id)+' — متبقٍ '+(l.quantity-l.received)];})},{key:'quantity',label:'الكمية المستلمة',type:'number',extra:'required min="0.001" step="0.001"'},{key:'lot_number',label:'رقم التشغيلة',extra:' '},{key:'expiry_date',label:'الصلاحية إن وجدت',type:'date',extra:' '}]);}
else if(a==='template')listEditor(c,'تعريف باكج بعدد زيارات وخدمات محددة',f('code','الكود')+f('name','اسم الباكج')+f('price','إجمالي سعر الباكج','number','','required min="0.01" step="0.01"')+f('visits','عدد الزيارات','number','2','required min="1" max="365" step="1"')+f('validity_days','الصلاحية بالأيام','number','90','required min="1" max="3650" step="1"')+f('terms','شروط المشمول والإلغاء'),a,null,[{key:'visit_no',label:'رقم الزيارة',type:'number',extra:'required min="1" step="1"'},{key:'service_id',label:'الخدمة',options:rows(c,'services')},{key:'quantity',label:'العدد في الزيارة',type:'number',extra:'required min="0.001" step="0.001"'}]);
else if(a==='package_sell'){var packageForm=listEditor(c,'تعاقد باكج — الأقساط تذكير حتى اعتماد استحقاقها',patient(c)+s('template_id','الباكج',rows({data:{templates:(d.templates||[]).filter(function(t){return pkgSellable(t,cairoDate());})}},'templates',function(p){return p.name+' — '+m(p.price)+(p.variable_visits?' للزيارة الواحدة':'')+pkgWindowLabel(p);}))+'<fieldset data-rx-variable hidden><legend>زيارات تحددها المريضة</legend><label>عدد الزيارات<input type="number" min="1" max="365" step="1" name="var_visits"></label><label>المدة بالأيام (اختياري)<input type="number" min="1" max="3650" step="1" name="var_days"></label><output data-rx-variable-total></output></fieldset>'+'<fieldset><legend>جدول التقويم بتواريخ ثابتة</legend><label><input type="checkbox" data-rx-orthodontic> احتساب مقدم ٢٥٪ والأقساط على عدد زيارات الباكج</label><label>تاريخ المقدم المتفق عليه<input type="date" data-rx-start></label><label>السعر المتفق عليه<input type="number" min="1" step="0.01" name="ortho_price"></label><label>عدد الزيارات<input type="number" min="1" max="365" name="ortho_visits"></label><label>المدة بالأيام<input type="number" min="1" max="3650" name="ortho_days"></label><label>الاستحقاق<select name="ortho_schedule"><option value="visit">عند الزيارة</option><option value="fixed">بتواريخ ثابتة</option></select></label><output></output><button type="button" class="btn">إنشاء جدول الدفعات</button></fieldset>',a,function(v){var terms=packageForm.orthodonticTerms(),visitTerms=packageForm.visitTerms();return {patient_id:v.patient_id,template_id:v.template_id,...(terms?{orthodontic_terms:terms}:{}),...(visitTerms?{visit_terms:visitTerms}:{})};},[{key:'due_on',label:'تاريخ القسط',type:'date'},{key:'amount',label:'المبلغ',type:'number',extra:'required min="0.01" step="0.01"'}],[]);attachOrthodonticSchedule(packageForm,d.templates||[],m);attachVariableVisits(packageForm,d.templates||[],m);}
else if(a==='installment_bill')form(c,'إثبات قسط مستحق دون شرط',f('evidence','مرجع النص التعاقدي المؤيد لحق التحصيل')+s('unconditional','راجع طبيعة الحق',[['true','حق غير مشروط ومعتمد']]),a,function(v){return {id:id,evidence:v.evidence,unconditional:true};});
else if(a==='order_add')form(c,'إضافة خدمة إلى الزيارة',s('service_id','الخدمة',rows(c,'services'))+s('provider_id','الطبيب',rows(c,'providers'))+f('quantity','العدد','number','1','required min="0.001" step="0.001"'),a,function(v){return {...v,visit_id:id};});
else if(a==='visit_close')form(c,'إنهاء الزيارة','<p>راجع تنفيذ أو إلغاء كل الخدمات المطلوبة أولًا. يحتفظ حساب المريض بأي مبلغ غير مسدد بعد إنهاء الزيارة.</p>'+f('reason','سبب إنهاء الزيارة دون خدمة منفذة إن وجد','text','',' '),a,function(v){return {...v,id:id};});
else if(a==='order_cancel')form(c,'إلغاء خدمة لم تنفذ',reason(c),a,function(v){return {...v,id:id};});
else if(a==='discount')form(c,'خصم على خدمة منفردة',f('percent','نسبة الخصم %','number','0','required min="0" max="100" step="0.01"')+reason(c),a,function(v){return {...v,id:id};});
else if(a==='service'){listEditor(c,'خدمة ونسخة سعر ومكونات',f('code','كود الخدمة')+f('name','الاسم')+f('department','القسم')+f('price','سعر الخدمة','number','','required min="0" step="0.01"')+f('minutes','الدقائق','number','30','required min="5" max="480" step="1"')+s('requires_device','يتطلب جهازًا',[['false','لا'],['true','نعم']]),a,function(v){return {code:v.code,name:v.name,department:v.department,price:v.price,minutes:v.minutes,requires_device:v.requires_device==='true'};},[{key:'item_id',label:'المستلزم',options:rows(c,'items')},{key:'quantity',label:'كمية لكل وحدة خدمة',type:'number',extra:'required min="0.001" step="0.001"'},{key:'included',label:'المستلزم',options:[['true','مشمول — لا يضاف للفاتورة'],['false','إضافي بسعر البيع']]}],[]);}
else if(a==='execute'){var o=d.orders.find(function(x){return x.id===id;});r=listEditor(c,'تنفيذ '+o.snapshot.name+' وتأكيد الاستهلاك الفعلي','<p>السعر المحفوظ '+m(o.price*o.quantity)+'؛ المشمول لا يضاف لسعر الخدمة مرة أخرى. أي إضافة تسعّر بسعر البيع الحالي قبل التأكيد.</p>'+s('provider_id','الطبيب المنفذ',rows(c,'providers'))+s('location_id','مخزن الصرف',rows(c,'locations'))+f('material_note','سبب اختلاف الاستهلاك عن المكونات إن وجد','text','',' ')+s('additional_confirmed','الموافقة على الإضافات',[['false','لا توجد موافقة على إضافات'],['true','وافق المريض على الكميات وأسعار البيع المبينة']])+'<label>الجهاز إن استخدم<select name="device_id"><option value="">بدون جهاز</option>'+rows(c,'devices').map(function(x){return '<option value="'+x[0]+'">'+e(x[1])+'</option>';}).join('')+'</select></label>'+f('minutes','دقائق تشغيل الجهاز إن استخدم','number',o.snapshot.minutes,'min="1" step="1"')+f('meter_before','قراءة قبل','number','','min="0" step="0.001"')+f('meter_after','قراءة بعد','number','','min="0" step="0.001"'),a,function(v){var out={...v,id:id,additional_confirmed:v.additional_confirmed==='true'};if(!out.device_id){delete out.device_id;delete out.meter_before;delete out.meter_after;}return out;},[{key:'item_id',label:'المستلزم — سعر بيع الوحدة',options:rows(c,'items',function(i){return i.name+' — '+m(i.sale_price)+(i.patient_billable?' — بيتحاسب على المريض':'');})},{key:'quantity',label:'الكمية الفعلية',type:'number',extra:'required min="0" step="0.001"'}],(o.snapshot.bom||[]).map(function(x){return {...x,quantity:x.quantity*o.quantity};}));r.querySelector('[name="provider_id"]').value=o.provider_id;r.querySelector('[name="location_id"]').required=false;/* clear checks under the field before sending (owner 2026-11-27, help 331) */if(window.SSMPDExecuteAll)window.SSMPDExecuteAll.guard(r,c,o);/* owner 2026-11-25 supplies: «بدون مستلزمات (سبب)» clears the lines and asks for the reason */var none=document.createElement('button');none.type='button';none.className='btn';none.dataset.rxNoSupplies='1';none.textContent='بدون مستلزمات (سبب)';none.onclick=function(){var ed=r.querySelector('[data-rx-lines]');if(ed)ed.innerHTML='';var note=r.querySelector('[name="material_note"]');if(note){note.required=true;note.minLength=3;note.placeholder='ليه مفيش مستلزمات؟ مثلاً: المريض رفض';note.focus();}};var addBtn=r.querySelector('[data-rx-add]');if(addBtn)addBtn.parentNode.insertBefore(none,addBtn.nextSibling);}
else if(a==='request-package-cancel'&&window.SSMPDReceptionControls){
 return window.SSMPDReceptionControls.act(a,id,c);
}
else if(a==='amend-laser'){
 var laserPlan=d.packages.find(function(item){return item.id===id;});
 if(!laserPlan||!d.can_manage)return false;
 var unused=laserPlan.lines.filter(function(line){return line.snapshot.name.includes('ليزر')&&!Number(line.used);});
 var services=d.services.filter(function(service){return service.name.includes('ليزر');});
 form(c,'تعديل طريقة حساب زيارة ليزر',
  s('entitlement_id','الزيارة',unused.map(function(line){return [line.id,line.visit_no+' — '+line.snapshot.name];}))+
  s('service_id','الخدمة الجديدة',services.map(function(service){return [service.id,service.name];}))+
  f('quantity','الكمية المتفق عليها','number',1,'required min="1" step="1"')+
  f('reason','سبب التعديل'),'amend_laser_visit');
}
else if(a==='amend-plan'){
 var amendable=d.packages.find(function(item){return item.id===id;});
 if(!amendable||!d.can_manage)return false;
 form(c,'تعديل اتفاق التقويم والزيارات المتبقية',
  f('price','السعر المتفق عليه','number',amendable.contract_price,'required min="1" step="0.01"')+
  f('visits','عدد الزيارات','number',amendable.visits,'required min="1" max="365" step="1"')+
  f('reason','سبب التعديل'),'amend_plan',function(values){return {...values,package_id:id};});
}
else if(a==='revise-schedule'){
 var plan=d.packages.find(function(item){return item.id===id;});
 if(plan&&d.can_manage&&plan.payment_schedule==='fixed')reviseSchedule(c,plan);
}
else if(a==='split-receipt'){
 var receipt=(d.split_receipts||[]).find(function(row){return row.id===id;});
 if(receipt)info(c,'إيصال التحصيل','<p>رقم الإيصال '+e(receipt.id)+'</p><p>الإجمالي '+m(receipt.total)+'</p>');
}
else if(a==='collect-split'){
 var splitPackage=d.packages.find(function(item){return item.id===id;});
 if(splitPackage&&d.split_receipts_enabled)splitReceipt(c,splitPackage);
}
else if(['collect','collect-invoice','collect-package'].includes(a)){var fixed=a==='collect-invoice'?d.invoices.find(function(x){return x.id===id;}):a==='collect-package'?d.packages.find(function(x){return x.id===id;}):null;var position=a==='collect-package'&&fixed?packagePaymentPosition(fixed,cairoDate(),(d.attended_package_visits||{})[fixed.id]||[]):null;var suggested=position?position.suggested:fixed&&fixed.due>0?fixed.due:'';var balance=position?'<p data-rx-package-balance>المتبقي من الخطة '+m(position.remaining)+' · المتأخر حسب الجدول '+m(position.overdue)+'</p>':'';var pmin=a==='collect-package'?pkgMinimum(fixed):null;if(pmin&&pmin.owed>0){if(!(+suggested>=pmin.minimum))suggested=pmin.minimum;balance+='<p data-rx-package-min>أقل دفعة مسموح بيها دلوقتي: <b>'+m(pmin.minimum)+'</b> ('+(pmin.first?pmin.percent+'٪ من قيمة الباكج كأول دفعة':'الأكبر من '+pmin.percent+'٪ أو الباقي على الزيارات اللي فاضلة')+') — أو الباقي كله '+m(pmin.owed)+'</p>';}var proof=window.SSMPDPaymentProof;c.modal('تسجيل تحصيل',fixed?'<p>ملف '+e(c.lookup('patients',fixed.patient_id,'file_no'))+' — '+e(c.lookup('patients',fixed.patient_id))+'</p>'+balance:patient(c),function(v,k){var mroot=document.querySelector('.rx-modal'),picked=fixed&&a==='collect-invoice'?multiPicked(mroot):[],cross=picked.length&&multiCross(mroot);if(cross&&String(v.note||'').trim().length<5)return Promise.reject(new Error('اكتب في «ملاحظة» مين دفع عن مين (اسم اللي دفع والسبب)'));return (proof?proof.attach(c.workspace,v):Promise.resolve(v)).then(function(x){delete x.proof_file;if(!x.note)delete x.note;if(picked.length){var inv=x.invoice_id;delete x.invoice_id;x.invoice_ids=[inv].concat(picked);if(cross)x.one_payer=true;return c.command('collect_multi',x,k);}return c.command('collect',x,k);});});r=document.querySelector('.rx-modal');var fields=r.querySelector('form');var sharedPayments=window.SSMPDFinanceCash&&window.SSMPDFinanceCash.helpers;fields.insertAdjacentHTML('afterbegin',sharedPayments?sharedPayments.paymentFields({amount:suggested||'',shifts:rows(c,'shifts',function(x){return c.lookup('registers',x.register_id)+' — '+x.status;})}):(f('amount','المبلغ','number',suggested||'','required min="0.01" step="0.01"')+s('method','طريقة السداد',[['cash','نقدي'],['pos','فيزا'],['instapay','إنستا باي'],['bank','تحويل بنكي'],['wallet','محفظة إلكترونية']])+f('reference','رقم الإيصال / مرجع العملية')+'<label>وردية الكاش أو الفيزا<select name="shift_id"><option value="">اختر عند الكاش أو الفيزا</option>'+rows(c,'shifts',function(x){return c.lookup('registers',x.register_id)+' — '+x.status;}).map(function(x){return '<option value="'+x[0]+'">'+e(x[1])+'</option>';}).join('')+'</select></label>'));if(sharedPayments)sharedPayments.bindPaymentFields(fields);freshShifts(c,fields,r);if(proof&&fields.elements.method){fields.elements.method.closest('label').insertAdjacentHTML('afterend',proof.field());proof.bind(fields);}fields.insertAdjacentHTML('beforeend','<label>ملاحظة (اختياري)<input name="note" maxlength="300" placeholder="مثلًا: تحويل واحد لزيارتين — منار وابنها"></label>');if(a==='collect-invoice'&&fixed&&!fixed.package_id){var others=multiCandidates(d,fixed);if(others.family.length||others.others.length){fields.insertAdjacentHTML('beforeend',multiBlock(c,others));bindMulti(c,fields,fixed);}}if(fixed){[['patient_id',fixed.patient_id],[a==='collect-invoice'?'invoice_id':'package_id',fixed.id]].forEach(function(x){var input=document.createElement('input');input.type='hidden';input.name=x[0];input.value=x[1];fields.appendChild(input);});}else fields.insertAdjacentHTML('afterbegin','<p>التحصيل العام يضيف رصيدًا للمريض؛ لتحصيل فاتورة أو باكج افتحهما أولًا.</p>');/* «راجع قبل ما تحصّل» (owner 2026-11-27, help 329) */if(a!=='collect-package'&&window.SSMPDCollectReview)window.SSMPDCollectReview.attach(r,c,{action:a,id:id,patient:fixed&&fixed.patient_id});}
else if(a==='credit_apply')form(c,'استخدام رصيد سابق للمريض',s('invoice_id','الفاتورة',rows(c,'invoices',function(i){return c.lookup('patients',i.patient_id)+' — '+i.description+' — باقي '+m(i.due);}))+f('amount','المبلغ','number','','required min="0.01" step="0.01"'),a);
else if(a==='shift_open')form(c,'فتح وردية',s('register_id','الخزينة',rows(c,'registers')),a);
else if(a==='shift_close')form(c,'إغلاق الوردية وعد النقدية الفعلية',f('counted','الكاش المعدود فعليًا','number','','required min="0" step="0.01"'),a,function(v){return {...v,id:id};});
else if(a==='shift_review')form(c,'تسجيل مراجعة الوردية','<p>الفرق لا يثبت مسؤولية الموظف ولا يخصم من راتبه. يسجل للمراجعة والتحقيق والقرار.</p>'+f('note','نتيجة المراجعة والإجراء التالي'),a,function(v){return {...v,id:id};});
else return false;return true;
}
window.SSMPDReceptionModules={sections:function(){return [['packages','الباكجز وأرصدة المرضى','زيارات محددة ومشمولات وكشف مالي واضح.'],['operations','التحصيل والمستلزمات','الفواتير والمخزون والورديات والمراجعات.'],['followup','المتابعة والتواصل','مهام متابعة المرضى ومسودات رسائل التواصل (اعتماد داخلي).']];},panel:panel,act:act,
bookingFields:function(c,patientId,a){return (c.data.workspace.mode==='live'?'<label>الليد المرتبط بنفس ملف المريض إن وجد<select name="lead_id"><option value="">بدون ليد</option></select></label>':'')+'<p data-book-duration>مدة حجز الطبيب الأساسي تتحدد من خدمات الزيارة.</p><label>الجهاز المحجوز إن لزم<select name="device_id"><option value="">بدون جهاز</option>'+(c.data.devices||[]).map(function(x){return '<option value="'+x.id+'" '+(a&&a.device_id===x.id?'selected':'')+'>'+c.esc(x.name)+'</option>';}).join('')+'</select></label><label>الباكج إن وجد<select name="package_id"><option value="">خدمة منفردة</option>'+(c.data.packages||[]).filter(function(p){return p.status==='active';}).map(function(p){return '<option value="'+p.id+'" '+(a&&a.package_id===p.id?'selected':'')+'>'+c.esc(c.lookup('patients',p.patient_id))+' — '+c.esc(p.name)+'</option>';}).join('')+'</select></label>'+c.field('package_visit_no','رقم زيارة الباكج','number',a&&a.package_visit_no||'','min="1" step="1"');},
bookingWire:function(form,c){if(form.elements.lead_id&&window.SSMPDDb.receptionPatientLeads){var leadVersion=0;async function leads(){var v=++leadVersion,patient=form.elements.patient_id.value;form.elements.lead_id.innerHTML='<option value="">بدون ليد</option>';if(!patient)return;try{var rows=await window.SSMPDDb.receptionPatientLeads(c.workspace,patient);if(!form.isConnected||v!==leadVersion)return;form.elements.lead_id.innerHTML='<option value="">بدون ليد</option>'+rows.map(function(l){return '<option value="'+c.esc(l.id)+'">'+c.esc(l.label)+'</option>';}).join('');if(form.dataset.selectedLead){form.elements.lead_id.value=form.dataset.selectedLead;delete form.dataset.selectedLead;}}catch(e){if(form.isConnected&&v===leadVersion)form.querySelector('[data-rx-status]').textContent=e.message;}}form.elements.patient_id.addEventListener('change',leads);leads();}var changeService=form.elements.service_id.onchange;form.elements.service_id.onchange=function(){if(changeService)changeService();var service=c.data.services.find(function(s){return s.id===form.elements.service_id.value;});var pkg=(c.data.packages||[]).find(function(p){return p.id===form.elements.package_id.value;});form.elements.device_id.required=!!service&&service.requires_device||!!pkg&&pkg.lines.some(function(l){return l.visit_no===+form.elements.package_visit_no.value&&+l.used<+l.quantity&&l.snapshot.requires_device;});};form.elements.package_visit_no.onchange=function(){var p=(c.data.packages||[]).find(function(p){return p.id===form.elements.package_id.value;});var line=p&&p.lines.find(function(l){return l.visit_no===+form.elements.package_visit_no.value&&+l.used<+l.quantity;});var service=line&&c.data.services.find(function(s){return s.code===line.snapshot.code;});if(service)form.elements.service_id.value=service.id;form.elements.service_id.onchange();};form.elements.package_id.onchange=function(){var p=(c.data.packages||[]).find(function(p){return p.id===form.elements.package_id.value;});form.elements.package_visit_no.required=!!p;if(p){form.elements.patient_id.value=p.patient_id;var first=p.lines.find(function(l){return +l.used<+l.quantity;});if(first){form.elements.package_visit_no.value=first.visit_no;var current=c.data.services.find(function(s){return s.code===first.snapshot.code;});if(current){form.elements.service_id.value=current.id;form.elements.service_id.dispatchEvent(new Event('change'));}}}else{form.elements.package_visit_no.value='';form.elements.service_id.onchange();}};}
};
})();
