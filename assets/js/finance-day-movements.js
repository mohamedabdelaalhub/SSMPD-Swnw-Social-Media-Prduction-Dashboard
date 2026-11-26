/* SSMPD — «حركات اليوم» (owner «طبّق شكل حركات اليوم», 2026-11-26; mockup docs/ui-references/mockups/day-movements.html rev 2).
   Adds three tabs (المرضى / الأطباء / الخصومات) and a summary of the user's own shift on top of «حركات الوردية بالتفصيل»
   (finance-shift-movements.js). The existing view is NOT changed: it stays as the tab «كل الحركات», mounted exactly as before.
   Compact one-line lists; every detail opens in a popup with ✕ (and → back when nested). Data: public.clinic_finance_day_movements
   (mig 20261126220000, read-only, same scope as the movements: own shift for the cashier, any shift / period for FM/GM/SA). */
(function(){'use strict';
var SM=window.SSMPDShiftMovements;if(!SM||SM.__day)return;
var ORIG=SM.mount;
var M={cash:'نقدي',pos:'فيزا',bank:'تحويل بنكي',instapay:'إنستا باي',wallet:'محفظة'};
var SRC={unknown:'مباشر',whatsapp:'واتساب',messenger:'ماسنجر',facebook:'فيسبوك',instagram:'إنستجرام',website:'الموقع',meta_form:'فورم ميتا',phone:'تليفون',referral:'ترشيح',walk_in:'حضور مباشر',tiktok:'تيك توك',google:'جوجل'};
var KIND={staff:'خصم العاملين بالمركز',vezeeta:'فيزيتا',family:'كارت العيلة',syndicate:'نقابة / جهة',special:'خاص'};
function esc(v){return String(v==null?'':v).replace(/[&<>"']/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c];});}
function n(v){return Number(v||0);}
function money(v){return n(v).toLocaleString('en-US',{maximumFractionDigits:2})+' ج.م';}
function minus(v){return '<bdi dir="ltr">−'+n(v).toLocaleString('en-US',{maximumFractionDigits:2})+'</bdi> ج.م';}
function time(v){return v?new Date(v).toLocaleTimeString('ar-EG-u-nu-latn',{timeZone:'Africa/Cairo',hour:'2-digit',minute:'2-digit'}):'';}
function methodLabel(m){return M[m]||m||'';}
/* ---------- derived data ---------- */
function source(v,ch){if(v.discount_kind==='vezeeta')return ['vz','فيزيتا'];if(ch&&ch.name)return [ch.payable==='commission'?'rf':'vz',ch.name];
 if(v.source==='referral')return ['rf','ترشيح'];return ['wk',SRC[v.source]||v.source||'مباشر'];}
function discountOf(v,s){if(!(n(s.discount)>0))return null;var r=s.request,k=v.discount_staff?'staff':v.discount_kind;
 if(r)return {kind:'خاص',cls:'sp',pct:n(r.percent)||n(s.discount_percent),amt:n(s.discount),by:r.by||'—',ok:r.approved_by||'—',note:r.reason||''};
 var auto=k==='staff'?'تلقائي — موظف نشط في HR':k==='vezeeta'?'تلقائي — فيزيتا':k==='family'?'تلقائي — كارت العيلة':k==='syndicate'?'بالكارت':'—';
 return {kind:KIND[k]||'خصم',cls:k==='staff'?'st':k==='vezeeta'?'vz':'sp',pct:n(s.discount_percent),amt:n(s.discount),by:v.discount_by||'—',ok:auto,note:v.discount_reason||''};}
function build(day,mv){var V=(day&&day.visits)||[],C=(day&&day.channels)||{},P=(day&&day.payouts)||[],rows=(mv&&mv.movements)||[];
 var visits=V.map(function(v,i){var sv=v.services||[],due=0,claim=0,got=0,here=0,disc=0,share=0,plat=0,ref=0,platName='';
  sv.forEach(function(s){due+=n(s.due);claim+=n(s.claim);got+=n(s.collected_total);here+=n(s.collected_here);disc+=n(s.discount);share+=n(s.doctor_fee);
   var ch=s.finance_invoice_id&&C[s.finance_invoice_id];if(ch){if(ch.payable==='commission')ref+=n(ch.platform_share);else{plat+=n(ch.platform_share);platName=ch.name;}}});
  var left=Math.max(0,Math.round((due-claim-got)*100)/100),flags=[];
  if(left>0)flags.push(got>0?'متحصّل جزئي — باقي '+money(left):'مش متحصّل — '+money(left));
  if((v.fixes||[]).length)flags.push('تصحيح طريقة دفع');
  var chAny=null;sv.some(function(s){return (chAny=s.finance_invoice_id&&C[s.finance_invoice_id]);});
  return {i:i,v:v,src:source(v,chAny),due:due,got:got,here:here,disc:disc,share:share,plat:plat,platName:platName,ref:ref,left:left,flags:flags};});
 var docs={},order=[];function doc(id,name){if(!docs[id]){docs[id]={id:id,name:name||'طبيب',visits:[],here:0,disc:0,share:0,paid:0,payouts:[]};order.push(id);}return docs[id];}
 visits.forEach(function(x){var seen={};(x.v.services||[]).forEach(function(s){var d=doc(s.provider_id,s.provider);if(!seen[s.provider_id]){seen[s.provider_id]=1;d.visits.push(x.i);}d.here+=n(s.collected_here);d.disc+=n(s.discount);d.share+=n(s.doctor_fee);});});
 P.forEach(function(p){var d=doc(p.provider_id||('k:'+p.doctor_key),p.doctor_name);d.paid+=n(p.amount);d.payouts.push(p);});
 var discounts=[];visits.forEach(function(x){(x.v.services||[]).forEach(function(s,si){var d=discountOf(x.v,s);if(d)discounts.push(Object.assign({vi:x.i,si:si,at:x.v.at,patient:x.v.patient,service:s.name},d));});});
 var by={},cashIn=0,cashOut=0,outAll=0,inAll=0;rows.forEach(function(r){var a=n(r.amount);if(r.direction==='in'){inAll+=a;by[r.method]=(by[r.method]||0)+a;if(r.method==='cash')cashIn+=a;}else if(r.direction==='out'){outAll+=-a;if(r.method==='cash')cashOut+=-a;}});
 var paidDoctors=P.reduce(function(t,p){return t+n(p.amount);},0),opening=null;
 if(day&&day.manager)(day.shifts||[]).forEach(function(s){if(s.opening_book!=null)opening=(opening||0)+n(s.opening_book);});
 return {visits:visits,doctors:order.map(function(k){return docs[k];}),discounts:discounts,payouts:P,outRows:rows.filter(function(r){return r.direction==='out';}),
  sum:{inAll:inAll,by:by,outAll:outAll,paidDoctors:paidDoctors,other:Math.max(0,outAll-paidDoctors),disc:discounts.reduce(function(t,d){return t+d.amt;},0),cashIn:cashIn,cashOut:cashOut,opening:opening}};}
/* ---------- html ---------- */
function ln(key,a,b,c,dot){return '<button type="button" class="dm-ln" data-dm-open="'+esc(key)+'"><span class="dm-a">'+(dot==null?'':'<span class="dm-dot'+(dot?' r':'')+'"></span>')+a+'</span><span class="dm-b">'+b+'</span><span class="dm-c">'+c+'</span><span class="dm-go" aria-hidden="true">‹</span></button>';}
function tag(cls,t){return '<span class="dm-tag '+cls+'">'+esc(t)+'</span>';}
function r(k,v,cls){return '<div class="dm-r'+(cls?' '+cls:'')+'"><span>'+esc(k)+'</span><b>'+v+'</b></div>';}
function methodsLine(by){var o=['cash','pos','instapay','bank','wallet'].filter(function(m){return by[m];});return o.length?o.map(function(m){return methodLabel(m)+' '+n(by[m]).toLocaleString('en-US');}).join(' · '):'مفيش تحصيل لسه';}
function summaryHtml(D,manager){var s=D.sum,cashNet=s.cashIn-s.cashOut;
 var last=manager&&s.opening!=null?'<button type="button" class="dm-tile" data-dm-open="sum/cash"><small>المفروض في الدرج (نقدي)</small><b>'+money(s.opening+cashNet)+'</b><span>رصيد أول الوردية + داخل − خارج</span></button>'
  :'<button type="button" class="dm-tile" data-dm-open="sum/cash"><small>صافي النقدي في ورديتك</small><b>'+money(cashNet)+'</b><span>نقدي داخل '+n(s.cashIn).toLocaleString('en-US')+' − خارج '+n(s.cashOut).toLocaleString('en-US')+'</span></button>';
 return '<div class="dm-sum"><button type="button" class="dm-tile hero" data-dm-open="sum/in"><small>'+(manager?'اتحصّل':'اتحصّل في ورديتك')+'</small><b>'+money(s.inAll)+'</b><span>'+esc(methodsLine(s.by))+'</span></button>'+
  '<button type="button" class="dm-tile" data-dm-open="sum/out"><small>'+(manager?'اتصرف من الخزينة':'اتصرف من خزينتك')+'</small><b class="neg">'+money(s.outAll)+'</b><span>للأطباء '+n(s.paidDoctors).toLocaleString('en-US')+' · مصروفات وغيرها '+n(s.other).toLocaleString('en-US')+'</span></button>'+
  '<button type="button" class="dm-tile" data-dm-open="sum/disc"><small>'+(manager?'الخصومات':'خصومات عملتها')+'</small><b class="warn">'+money(s.disc)+'</b><span>'+D.discounts.length+' خصم</span></button>'+last+'</div>';}
function match(q,arr){if(!q)return true;q=q.trim().toLowerCase();return arr.some(function(x){return String(x||'').toLowerCase().indexOf(q)>=0;});}
function listHtml(tab,D,q,chip){
 if(tab==='patients'){var L=D.visits.filter(function(x){return match(q,[x.v.patient,x.v.file_no,x.v.provider])&&(chip!=='flag'||x.flags.length);});
  return L.length?'<div class="dm-list">'+L.map(function(x){return ln('v'+x.i,'<b>'+esc(x.v.patient)+'</b>'+tag(x.src[0],x.src[1]),esc(time(x.v.at)+' · '+(x.v.provider||''))+(x.flags.length?' · <span class="neg">'+esc(x.flags[0])+'</span>':''),money(x.here),!!x.flags.length);}).join('')+'</div>':'<p class="mv-empty">مفيش زيارات هنا.</p>';}
 if(tab==='doctors'){var Ld=D.doctors.map(function(d,i){return [d,i];}).filter(function(p){var d=p[0];return match(q,[d.name].concat(d.visits.map(function(i){return D.visits[i].v.patient;})))&&(chip!=='left'||d.share-d.paid>0.009);});
  return Ld.length?'<div class="dm-list">'+Ld.map(function(p){var d=p[0],left=d.share-d.paid;return ln('d'+p[1],'<b>'+esc(d.name)+'</b>',d.visits.length+' حالة · نصيبه '+money(d.share)+' · اتصرفله '+money(d.paid),'<span class="'+(left>0.009?'warn':'pos')+'">باقي '+money(Math.max(0,left))+'</span>');}).join('')+'</div>':'<p class="mv-empty">مفيش أطباء هنا.</p>';}
 var Lx=D.discounts.map(function(x,i){return [x,i];}).filter(function(p){return match(q,[p[0].patient,p[0].kind,p[0].service]);});
 return Lx.length?'<div class="dm-list">'+Lx.map(function(p){var x=p[0];return ln('x'+p[1],'<b>'+esc(x.patient)+'</b>'+tag(x.cls,x.kind+' '+x.pct+'٪'),esc(time(x.at)+' · '+x.service+' · '+(x.ok==='—'?'عمله '+x.by:x.ok)),'<span class="neg">'+minus(x.amt)+'</span>');}).join('')+'</div>':'<p class="mv-empty">مفيش خصومات هنا.</p>';}
function head(title,sub,back){return '<div class="dm-ph">'+(back?'<button type="button" class="dm-x" data-dm-back aria-label="رجوع" title="رجوع">→</button>':'')+'<div class="dm-tt"><h3 id="dm-pop-title">'+esc(title)+'</h3><p>'+esc(sub)+'</p></div><button type="button" class="dm-x" data-dm-close aria-label="قفل" title="قفل">✕</button></div>';}
function popHtml(key,D,back,manager){var m;
 if((m=/^v(\d+)$/.exec(key))){var x=D.visits[+m[1]],v=x.v;if(!x)return '';
  return head(v.patient,'ملف '+(v.file_no||'—')+' · '+time(v.at)+' · '+(v.provider||'')+' · '+x.src[1],back)+
   (x.flags.length?'<div class="dm-flags">'+x.flags.map(function(f){return tag('red','⚠ '+f);}).join('')+'</div>':'')+
   (v.services||[]).map(function(s,si){var d=discountOf(v,s),dk=d?D.discounts.findIndex(function(z){return z.vi===x.i&&z.si===si;}):-1;
    return '<div class="dm-kv"><h4>'+esc(s.name)+(s.provider&&s.provider!==v.provider?' — '+esc(s.provider):'')+'</h4>'+r('السعر',money(s.gross))+
     (d?'<button type="button" class="dm-r" data-dm-open="x'+dk+'"><span>الخصم — '+esc(d.kind)+' '+d.pct+'٪ ‹</span><b class="neg">'+minus(d.amt)+'</b></button>':r('الخصم','—'))+
     r('المستحق',money(s.due),'tot')+(n(s.claim)>0?r('على جهة التأمين',money(s.claim)):'')+
     r('اتحصّل',(n(s.collected_total)+n(s.claim)<n(s.due)-0.009?'<span class="neg">':'<span class="pos">')+money(s.collected_total)+'</span>')+
     ((s.payments||[]).length?r('طريقة الدفع',esc(s.payments.map(function(p){return methodLabel(p.method)+' '+n(p.amount).toLocaleString('en-US')+(p.receipt_no?' · إيصال '+p.receipt_no:'');}).join(' + '))):'')+
     (n(s.collected_total)>n(s.collected_here)+0.009?r('اتحصّل في وردية تانية',money(n(s.collected_total)-n(s.collected_here))):'')+'</div>';}).join('')+
   ((v.fixes||[]).length?'<div class="dm-kv"><h4>تصحيح طريقة الدفع</h4>'+v.fixes.map(function(f){return r(time(f.at)+' · '+(f.by||''),'<span class="warn">'+esc(methodLabel(f.from)+' ← '+methodLabel(f.to)+' · '+n(f.amount).toLocaleString('en-US'))+'</span>');}).join('')+'</div>':'')+
   '<div class="dm-kv"><h4>التوزيع</h4>'+r('نصيب الطبيب',money(x.share))+(x.plat?r('نصيب '+(x.platName||'المنصة'),money(x.plat)):'')+(x.ref?r('عمولة الترشيح',money(x.ref)):'')+'</div>';}
 if((m=/^d(\d+)$/.exec(key))){var d=D.doctors[+m[1]];if(!d)return '';var left=d.share-d.paid;
  return head(d.name,manager?'حسب الفلتر':'في ورديتك وخزينتك بس',back)+'<div class="dm-kv">'+r('عدد الحالات',String(d.visits.length))+r('اتحصّل من حالاته',money(d.here))+r('الخصومات',d.disc?minus(d.disc):'—')+r('نصيبه',money(d.share))+
   r(manager?'اتصرفله من الخزينة':'اتصرفله من خزينتك',money(d.paid))+r('الباقي له','<span class="'+(left>0.009?'warn':'pos')+'">'+money(Math.max(0,left))+'</span>','tot')+'</div>'+
   (d.payouts.length?'<div class="dm-kv"><h4>اللي اتصرفله</h4>'+d.payouts.map(function(p){return r(time(p.at)+' · '+(p.reference||''),money(p.amount));}).join('')+'</div>':'')+
   (d.visits.length?'<div class="dm-list">'+d.visits.map(function(i){var x=D.visits[i],sh=(x.v.services||[]).filter(function(s){return s.provider_id===d.id;}).reduce(function(t,s){return t+n(s.doctor_fee);},0);return ln('v'+i,'<b>'+esc(x.v.patient)+'</b>',esc(time(x.v.at))+' · نصيبه '+money(sh),money(x.here),!!x.flags.length);}).join('')+'</div>':'');}
 if((m=/^x(\d+)$/.exec(key))){var z=D.discounts[+m[1]];if(!z)return '';var sv=D.visits[z.vi].v.services[z.si];
  return head('خصم '+z.kind+' '+z.pct+'٪',z.patient+' · '+z.service+' · '+time(z.at),back)+'<div class="dm-kv">'+r('السعر',money(sv.gross))+r('الخصم','<span class="neg">'+minus(z.amt)+'</span>')+r('بعد الخصم',money(sv.due),'tot')+r('عمله',esc(z.by))+r('اعتمده',esc(z.ok))+(z.note?r('ملاحظة',esc(z.note)):'')+'</div>'+
   '<div class="dm-list">'+ln('v'+z.vi,'<b>'+esc(z.patient)+'</b>','افتح الزيارة كلها',money(D.visits[z.vi].here))+'</div>';}
 var s=D.sum;
 if(key==='sum/in')return head(manager?'اللي اتحصّل':'اللي اتحصّل في ورديتك','بطريقة الدفع',back)+'<div class="dm-kv">'+['cash','pos','instapay','bank','wallet'].filter(function(k){return s.by[k];}).map(function(k){return r(methodLabel(k),money(s.by[k]));}).join('')+r('الإجمالي',money(s.inAll),'tot')+'</div>';
 if(key==='sum/out')return head(manager?'اللي اتصرف من الخزينة':'اللي اتصرف من خزينتك','صرف أتعاب ومصروفات ومرتجعات',back)+(D.outRows.length?'<div class="dm-kv">'+D.outRows.map(function(o){return r(time(o.at)+' · '+(o.title||'')+(o.detail?' — '+o.detail:''),'<span class="neg">'+minus(-n(o.amount))+'</span>');}).join('')+r('الإجمالي',minus(s.outAll),'tot')+'</div>':'<p class="mv-empty">مفيش صرف.</p>');
 if(key==='sum/disc')return head(manager?'الخصومات':'الخصومات اللي عملتها','',back)+(D.discounts.length?'<div class="dm-list">'+D.discounts.map(function(z,i){return ln('x'+i,'<b>'+esc(z.patient)+'</b>',esc(z.kind+' '+z.pct+'٪'),'<span class="neg">'+minus(z.amt)+'</span>');}).join('')+'</div>':'<p class="mv-empty">مفيش خصومات.</p>');
 if(key==='sum/cash')return head(manager&&s.opening!=null?'المفروض في الدرج':'صافي النقدي في ورديتك','نقدي بس',back)+'<div class="dm-kv">'+(manager&&s.opening!=null?r('رصيد أول الوردية',money(s.opening)):'')+r('نقدي داخل',money(s.cashIn))+r('نقدي خارج',minus(s.cashOut))+r(manager&&s.opening!=null?'المفروض في الدرج':'الصافي',money((manager&&s.opening!=null?s.opening:0)+s.cashIn-s.cashOut),'tot')+'</div>';
 return '';}
/* ---------- export ---------- */
function table(tab,D){if(tab==='patients')return {head:['الوقت','المريض','رقم الملف','الطبيب','المصدر','المستحق','اتحصّل هنا','الخصم','نصيب الطبيب','المنصة','الترشيح','ملاحظات'],rows:D.visits.map(function(x){return [time(x.v.at),x.v.patient,x.v.file_no||'',x.v.provider||'',x.src[1],x.due,x.here,x.disc,x.share,x.plat,x.ref,x.flags.join(' · ')];})};
 if(tab==='doctors')return {head:['الطبيب','الحالات','اتحصّل من حالاته','الخصومات','نصيبه','اتصرفله','الباقي'],rows:D.doctors.map(function(d){return [d.name,d.visits.length,d.here,d.disc,d.share,d.paid,Math.max(0,d.share-d.paid)];})};
 return {head:['الوقت','المريض','الخدمة','نوع الخصم','النسبة','القيمة','عمله','اعتمده'],rows:D.discounts.map(function(z){return [time(z.at),z.patient,z.service,z.kind,z.pct+'%',z.amt,z.by,z.ok];})};}
var TITLE={patients:'حركات اليوم — المرضى',doctors:'حركات اليوم — الأطباء',discounts:'حركات اليوم — الخصومات'};
function excel(tab,D){var t=table(tab,D),name=TITLE[tab];
 if(window.XLSX&&window.XLSX.utils){var ws=window.XLSX.utils.aoa_to_sheet([t.head].concat(t.rows)),wb=window.XLSX.utils.book_new();wb.Workbook={Views:[{RTL:true}]};window.XLSX.utils.book_append_sheet(wb,ws,'حركات اليوم');window.XLSX.writeFile(wb,name+'.xlsx');return 'xlsx';}
 var csv='﻿'+[t.head].concat(t.rows).map(function(row){return row.map(function(v){return '"'+String(v).replace(/"/g,'""')+'"';}).join(',');}).join('\r\n');
 var a=document.createElement('a');a.href=URL.createObjectURL(new Blob([csv],{type:'text/csv;charset=utf-8'}));a.download=name+'.csv';document.body.appendChild(a);a.click();a.remove();setTimeout(function(){URL.revokeObjectURL(a.href);},1000);return 'csv';}
function print(tab,D,who){var P=window.SSMPDPrint;if(!P)throw Error('ملف الطباعة غير محمّل');var t=table(tab,D),e=P.esc;
 var body='<table class="mv"><thead><tr>'+t.head.map(function(h){return '<th>'+e(h)+'</th>';}).join('')+'</tr></thead><tbody>'+t.rows.map(function(row){return '<tr>'+row.map(function(v){return '<td>'+(typeof v==='number'?'<bdi class="ltr">'+e(P.money(v))+'</bdi>':e(v))+'</td>';}).join('')+'</tr>';}).join('')+'</tbody></table>';
 var css='<style>.dmp table.mv{width:100%;border-collapse:collapse;font-size:9.5px}.dmp th,.dmp td{border:1px solid #c7d0e6;padding:3px 4px;text-align:center}.dmp th{background:#0F369D;color:#fff}.dmp .meta{margin:6px 0 10px;font-size:11px}</style>';
 var win=P.blank();P.open(P.documentHtml(TITLE[tab],P.flow(css+'<div class="dmp">'+P.title(TITLE[tab])+'<div class="meta">'+e(who||'')+' · عدد السطور: <bdi class="ltr">'+t.rows.length+'</bdi></div>'+body+'</div>')),win);return win;}
/* ---------- mount wrapper ---------- */
function mount(host,opts){opts=opts||{};
 var base=opts.rpc||function(name,args){return window.SSMPDDb.client.rpc(name,args).then(function(r){if(r.error)throw r.error;return r.data;});};
 var st={tab:'all',q:'',chip:'',day:null,mv:null,err:null,stack:[]};
 host.innerHTML='<div class="dm-wrap"><div class="dm-top" data-dm-top></div><div data-dm-orig></div><div class="dm-pane" data-dm-pane hidden></div><div class="dm-ov" data-dm-ov hidden><div class="dm-pop" role="dialog" aria-modal="true" aria-labelledby="dm-pop-title" data-dm-pop></div></div></div>';
 var top=host.querySelector('[data-dm-top]'),orig=host.querySelector('[data-dm-orig]'),pane=host.querySelector('[data-dm-pane]'),ov=host.querySelector('[data-dm-ov]'),pop=host.querySelector('[data-dm-pop]');
 var seq=0;
 function rpc(name,args){var p=base(name,args);if(name==='clinic_finance_shift_movements'){var my=++seq,a={p_shift:args.p_shift||null,p_from:args.p_from||null,p_to:args.p_to||null,p_cashier:args.p_cashier||null};
   st.day=null;st.err=null;paint();
   Promise.resolve(p).then(function(d){if(my===seq){st.mv=d;paint();}},function(){});
   Promise.resolve(base('clinic_finance_day_movements',a)).then(function(d){if(my===seq){st.day=d||{visits:[]};paint();}}).catch(function(e){if(my===seq){st.err=(e&&e.message)||'تعذر تحميل حركات اليوم';paint();}});}
  return p;}
 function data(){return build(st.day,st.mv);}
 function manager(){return !!(st.day&&st.day.manager&&opts.manager);}
 function paint(){var ready=st.day&&st.mv,D=ready?data():null,c={patients:D?D.visits.length:'',doctors:D?D.doctors.length:'',discounts:D?D.discounts.length:''};
  top.innerHTML=(D?summaryHtml(D,manager()):st.err?'<p class="mv-empty mv-error" role="alert">'+esc(st.err)+'</p>':'<p class="mv-empty" role="status">جاري تحميل ملخص الوردية…</p>')+
   '<div class="dm-tabs" role="tablist" aria-label="حركات اليوم">'+[['all','كل الحركات'],['patients','المرضى'],['doctors','الأطباء'],['discounts','الخصومات']].map(function(t){return '<button type="button" role="tab" data-dm-tab="'+t[0]+'" aria-selected="'+(st.tab===t[0])+'">'+t[1]+(c[t[0]]!==undefined&&c[t[0]]!==''?'<span class="dm-n">'+c[t[0]]+'</span>':'')+'</button>';}).join('')+'</div>';
  orig.hidden=st.tab!=='all';pane.hidden=st.tab==='all';
  if(st.tab!=='all'){var chips=st.tab==='patients'?[['','الكل'],['flag','⚠ محتاج مراجعة']]:st.tab==='doctors'?[['','كل الأطباء'],['left','ليهم باقي']]:[];
   pane.innerHTML='<div class="dm-bar"><input type="search" data-dm-q placeholder="دوّر باسم المريض أو رقم الملف أو الدكتور" value="'+esc(st.q)+'" aria-label="بحث"><span class="dm-sp"></span><button type="button" class="btn ghost sm" data-dm-print'+(D?'':' disabled')+'>🖨 طباعة</button><button type="button" class="btn ghost sm" data-dm-excel'+(D?'':' disabled')+'>⬇ Excel</button></div>'+
    (chips.length?'<div class="dm-chips">'+chips.map(function(ch){return '<button type="button" class="dm-chip'+(st.chip===ch[0]?' on':'')+'" data-dm-chip="'+ch[0]+'">'+ch[1]+'</button>';}).join('')+'</div>':'')+
    '<div data-dm-list>'+(D?listHtml(st.tab,D,st.q,st.chip):st.err?'':'<p class="mv-empty" role="status">جاري التحميل…</p>')+'</div>'+(st.day&&st.day.capped?'<p class="mv-empty">ظاهر أول 1000 زيارة بس؛ ضيّق الفترة.</p>':'');}
  if(!ov.hidden&&st.stack.length&&D)pop.innerHTML=popHtml(st.stack[st.stack.length-1],D,st.stack.length>1,manager());}
 function open(key){var D=st.day&&st.mv&&data();if(!D)return;var h=popHtml(key,D,st.stack.length>0,manager());if(!h)return;st.stack.push(key);pop.innerHTML=popHtml(key,D,st.stack.length>1,manager());ov.hidden=false;var x=pop.querySelector('[data-dm-close]');if(x&&x.focus)x.focus();}
 function close(){st.stack=[];ov.hidden=true;pop.innerHTML='';}
 function back(){st.stack.pop();if(!st.stack.length)return close();var D=data();pop.innerHTML=popHtml(st.stack[st.stack.length-1],D,st.stack.length>1,manager());}
 host.addEventListener('click',function(e){var t=e.target.closest('[data-dm-tab]');if(t){st.tab=t.dataset.dmTab;st.chip='';paint();return;}
  var o=e.target.closest('[data-dm-open]');if(o){open(o.dataset.dmOpen);return;}
  if(e.target.closest('[data-dm-close]')||e.target===ov){close();return;}
  if(e.target.closest('[data-dm-back]')){back();return;}
  var c=e.target.closest('[data-dm-chip]');if(c){st.chip=c.dataset.dmChip;paint();return;}
  if(e.target.closest('[data-dm-excel]')){var D=data();excel(st.tab,D);return;}
  if(e.target.closest('[data-dm-print]')){try{print(st.tab,data(),manager()?'حسب الفلتر':'ورديتك');}catch(er){var msg=(er&&er.message)||'تعذر فتح نافذة الطباعة';if(window.SSMPDToast&&window.SSMPDToast.show)window.SSMPDToast.show(msg);else window.alert(msg);}return;}});
 host.addEventListener('input',function(e){if(e.target.matches('[data-dm-q]')){st.q=e.target.value;var l=pane.querySelector('[data-dm-list]'),D=st.day&&st.mv&&data();if(l&&D)l.innerHTML=listHtml(st.tab,D,st.q,st.chip);}});
 host.addEventListener('keydown',function(e){if(e.key==='Escape'&&!ov.hidden){e.stopPropagation();close();}});
 paint();
 var handle=ORIG(orig,Object.assign({},opts,{rpc:rpc}));
 return Object.assign({},handle,{dayState:st,openDetail:open});}
SM.mount=mount;SM.__day=true;SM.dayHelpers={build:build,discountOf:discountOf,table:table};
})();
