/* SSMPD — «حركات الوردية بالتفصيل» (owner 2026-11-15).
   Cashier: own open shift(s). Financial manager / GM / super admin: any shift, period ≤ 31 days, employee filter.
   Filters by method/kind, totals, Excel export (SheetJS when loaded, CSV otherwise) and PDF via the print dialog. */
(function(){'use strict';
var M={cash:'نقدي',pos:'فيزا',bank:'تحويل بنكي',instapay:'إنستا باي',wallet:'محفظة'};
function esc(v){return String(v==null?'':v).replace(/[&<>"']/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c];});}
function num(v){return Number(v||0).toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:2});}
function money(v){return num(v)+' ج.م';}
function time(v){return v?new Date(v).toLocaleTimeString('ar-EG-u-nu-latn',{timeZone:'Africa/Cairo',hour:'2-digit',minute:'2-digit'}):'';}
function day(v){return v?new Date(v).toLocaleDateString('ar-EG-u-nu-latn',{timeZone:'Africa/Cairo',weekday:'long',day:'numeric',month:'long'}):'';}
function cairoDay(){return new Intl.DateTimeFormat('en-CA',{timeZone:'Africa/Cairo',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());}
function methodLabel(m){if(m&&m.indexOf('>')>0){var p=m.split('>');return (M[p[0]]||p[0])+' ← '+(M[p[1]]||p[1]);}return M[m]||m||'';}
function kindLabel(r){return r.direction==='fix'?'تصحيح طريقة دفع':r.direction==='out'?'خارج من الخزينة':r.kind==='insurance'?'تأمين — نصيب المريض':'خاص — المريض بيدفع كامل';}
function cls(r){return r.direction==='fix'?'fix':r.direction==='out'?'out':r.kind==='insurance'?'ins':'';}
var FILTERS={all:function(){return true;},cash:function(r){return r.method==='cash';},pos:function(r){return r.method==='pos'||/>pos$/.test(r.method||'');},instapay:function(r){return r.method==='instapay';},ins:function(r){return r.kind==='insurance';},out:function(r){return r.direction==='out';}};
var FILTER_LABELS=[['all','الكل'],['cash','نقدي'],['pos','فيزا'],['instapay','إنستا باي'],['ins','تأمين'],['out','صرف ومرتجع']];
function rowHtml(r,multi){var ins=r.insurance;var amount=Number(r.amount);
 return '<article class="mv-row '+cls(r)+'"><div class="mv-time">'+esc(time(r.at))+'</div><div class="mv-who"><strong>'+esc(r.title)+'</strong>'+(multi?'<span class="mv-emp">الموظف: '+esc(r.cashier_name)+'</span>':'')+'<small>'+esc(r.detail||'')+'</small>'+(window.SSMPDMultiPay?window.SSMPDMultiPay.block(r.mp_visits,r.mp_note,r.mp_cross):'')+'</div>'+
  '<div class="mv-kind"><span class="mv-tag '+cls(r)+'">'+esc(kindLabel(r))+'</span>'+(ins?'<small>'+esc(ins.payer)+(ins.cover!=null?' بتتحمل '+esc(ins.cover)+'٪':'')+' · مطالبة على الجهة '+esc(money(ins.claim))+' · إجمالي الخدمة '+esc(money(ins.total))+'</small>':'')+'</div>'+
  '<div class="mv-method">'+esc(methodLabel(r.method))+'<small>'+esc(r.reference||'')+'</small></div>'+
  '<div class="mv-amt"><bdi dir="ltr">'+(amount>0&&r.direction!=='fix'?'+':'')+num(amount)+'</bdi> ج.م</div></article>';}
function totals(rows){var sum=function(f){return rows.filter(f).reduce(function(n,r){return n+Number(r.amount||0);},0);};
 return {cashIn:sum(function(r){return r.direction==='in'&&r.method==='cash';}),cashOut:-sum(function(r){return r.direction==='out'&&r.method==='cash';}),
  card:sum(function(r){return r.direction==='in'&&r.method==='pos';}),instapay:sum(function(r){return r.direction==='in'&&r.method==='instapay';}),
  ins:sum(function(r){return r.direction==='in'&&r.kind==='insurance';}),claims:rows.reduce(function(n,r){return n+(r.insurance?Number(r.insurance.claim||0):0);},0)};}
function exportRows(rows){return rows.map(function(r){var i=r.insurance||{};return [day(r.at),time(r.at),r.cashier_name,r.register_name,r.title,r.detail||'',kindLabel(r),i.payer||'',i.cover!=null?i.cover+'%':'',i.claim!=null?Number(i.claim):'',methodLabel(r.method),r.reference||'',r.direction==='out'?'خارج':r.direction==='fix'?'تصحيح':'داخل',Number(r.amount),Number(r.mp_visits)>1?r.mp_note||'':'',Number(r.mp_visits)>1?Number(r.mp_visits):''];});}
var HEAD=['اليوم','الوقت','الموظف','الخزينة','المريض / البيان','الخدمة والملف','النوع','جهة التأمين','نسبة الجهة','مطالبة على الجهة','طريقة التحصيل','المرجع','داخل / خارج','المبلغ','ملاحظة الدفعة','عدد الزيارات'];
function exportExcel(rows,title){var name=String(title||'حركات الخزينة').replace(/[\\/:*?"<>|]/g,'-');
 if(window.XLSX&&window.XLSX.utils){var ws=window.XLSX.utils.aoa_to_sheet([HEAD].concat(exportRows(rows)));ws['!cols']=[16,7,14,16,22,30,22,18,10,14,14,14,10,12,36,10].map(function(w){return {wch:w};});var wb=window.XLSX.utils.book_new();wb.Workbook={Views:[{RTL:true}]};window.XLSX.utils.book_append_sheet(wb,ws,'الحركات');window.XLSX.writeFile(wb,name+'.xlsx');return 'xlsx';}
 var csv='﻿'+[HEAD].concat(exportRows(rows)).map(function(r){return r.map(function(v){return '"'+String(v).replace(/"/g,'""')+'"';}).join(',');}).join('\r\n');
 var a=document.createElement('a');a.href=URL.createObjectURL(new Blob([csv],{type:'text/csv;charset=utf-8'}));a.download=name+'.csv';document.body.appendChild(a);a.click();a.remove();setTimeout(function(){URL.revokeObjectURL(a.href);},1000);return 'csv';}
function P_day(v){return window.SSMPDPrint?window.SSMPDPrint.day(v):String(v||'');}
function printSection(section){var root=document.documentElement;section.classList.add('mv-print-target');root.classList.add('mv-printing');
 var done=function(){root.classList.remove('mv-printing');section.classList.remove('mv-print-target');window.removeEventListener('afterprint',done);};window.addEventListener('afterprint',done);
 try{window.print();}finally{setTimeout(done,1500);}}
/* owner 2026-11-24 «ليه تقرير ال pdf بيطلع بالشكل دا، ليه مش متقسم جدول واضح وسهل»: the PDF is a real table on the official
   letterhead (swnw-print.js, CLAUDE.md rule 7): date + time on every row, one section per day with its subtotal, grand total, no
   centre name in the title, formal Arabic, Latin digits. */
var PM={cash:'نقدي',pos:'بطاقة',bank:'تحويل بنكي',instapay:'إنستا باي',wallet:'محفظة إلكترونية'};
function pdfMethod(m){if(m&&m.indexOf('>')>0){var p=m.split('>');return (PM[p[0]]||p[0])+' ← '+(PM[p[1]]||p[1]);}return PM[m]||m||'—';}
function pdfKind(r){return r.direction==='fix'?'تصحيح طريقة الدفع':r.direction==='out'?'صرف من الخزينة':r.kind==='insurance'?'تأمين — حصة المريض':'خاص';}
function splitDetail(r){var parts=String(r.detail||'').split(' · ').map(function(x){return x.trim();}).filter(Boolean),file='',rest=[];
 parts.forEach(function(x){if(/^ملف\s+/.test(x)&&!file)file=x.replace(/^ملف\s+/,'');else rest.push(x);});return {service:rest.join(' · '),file:file};}
function cairoKey(v){return new Intl.DateTimeFormat('en-CA',{timeZone:'Africa/Cairo',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(v));}
function dayName(v){return new Date(v).toLocaleDateString('ar-EG-u-nu-latn',{timeZone:'Africa/Cairo',weekday:'long'});}
function dmy(v){var x=new Intl.DateTimeFormat('en-GB',{timeZone:'Africa/Cairo',day:'2-digit',month:'2-digit',year:'numeric'}).formatToParts(new Date(v)).reduce(function(o,p){o[p.type]=p.value;return o;},{});return x.day+'-'+x.month+'-'+x.year;}
function countWord(n){return n===1?'حركة واحدة':n===2?'حركتان':n<=10?n+' حركات':n+' حركة';}
function pdfHtml(rows,o){var P=window.SSMPDPrint,e=P.esc,mo=P.money;o=o||{};rows=rows.slice().sort(function(a,b){return new Date(a.at)-new Date(b.at);});
 var head=['التاريخ والوقت','المريض / البيان','الخدمة','رقم الملف','الموظف','طريقة الدفع','نوع السداد','رقم الإيصال / المرجع','المبلغ (ج.م)'];
 var widths=[11,14,14,11,10,8,9,14,9];
 var sums=function(list){var i=0,out=0;list.forEach(function(r){var a=Number(r.amount||0);if(r.direction==='fix')return;if(a>=0)i+=a;else out+=a;});return {in:i,out:out,net:i+out};};
 var days=[],by={};rows.forEach(function(r){var k=cairoKey(r.at);if(!by[k]){by[k]=[];days.push(k);}by[k].push(r);});
 var line=function(r){var d=splitDetail(r),a=Number(r.amount||0);return '<tr><td><bdi class="ltr">'+e(dmy(r.at))+'</bdi><br><span class="tm">'+e(P.time(r.at))+'</span></td><td class="n">'+e(r.title||'—')+'</td><td class="n">'+e(d.service||'—')+'</td><td><bdi class="ltr">'+e(d.file||'—')+'</bdi></td><td class="n">'+e(r.cashier_name||'—')+'</td><td>'+e(pdfMethod(r.method))+'</td><td>'+e(pdfKind(r))+'</td><td><bdi class="ltr">'+e(r.reference||'—')+'</bdi></td><td class="amt'+(a<0?' neg':'')+'"><bdi class="ltr">'+(a<0?'−':'')+mo(Math.abs(a))+'</bdi></td></tr>';};
 var body='';days.forEach(function(k){var list=by[k],t=sums(list);
  body+='<tr class="dh"><td colspan="9">'+e(dayName(list[0].at))+' — <bdi class="ltr">'+e(dmy(list[0].at))+'</bdi> — '+e(countWord(list.length))+'</td></tr>'+list.map(line).join('')+
   '<tr class="sub"><td colspan="8">إجمالي يوم <bdi class="ltr">'+e(dmy(list[0].at))+'</bdi> — المقبوضات <bdi class="ltr">'+mo(t.in)+'</bdi> · المدفوعات <bdi class="ltr">'+mo(Math.abs(t.out))+'</bdi></td><td class="amt"><bdi class="ltr">'+mo(t.net)+'</bdi></td></tr>';});
 var g=sums(rows),meth={},order=[];rows.forEach(function(r){if(r.direction!=='in')return;var m=pdfMethod(r.method);if(!(m in meth)){meth[m]=0;order.push(m);}meth[m]+=Number(r.amount||0);});
 var grand='<tr class="gt"><td colspan="8">الإجمالي العام للفترة — المقبوضات <bdi class="ltr">'+mo(g.in)+'</bdi> · المدفوعات <bdi class="ltr">'+mo(Math.abs(g.out))+'</bdi> · الصافي</td><td class="amt"><bdi class="ltr">'+mo(g.net)+'</bdi></td></tr>';
 var methods=order.length?'<div class="mvp-sum"><h4>المقبوضات حسب طريقة الدفع</h4>'+P.table(['طريقة الدفع','المبلغ (ج.م)'],order.map(function(m){return '<tr><td>'+e(m)+'</td><td class="amt"><bdi class="ltr">'+mo(meth[m])+'</bdi></td></tr>';}),'<tr class="tot"><td>إجمالي المقبوضات</td><td class="amt"><bdi class="ltr">'+mo(g.in)+'</bdi></td></tr>')+'</div>':'';
 var css='<style>.mvp table.mv{width:100%;border-collapse:collapse;table-layout:fixed;font-size:9px;margin-bottom:8px}.mvp table.mv th,.mvp table.mv td{border:1px solid #c7d0e6;padding:3px 4px;text-align:center;vertical-align:middle;word-wrap:break-word}.mvp table.mv th{background:#0F369D;color:#fff;font-weight:700}.mvp table.mv thead{display:table-header-group}.mvp table.mv td.n{text-align:right}.mvp td.amt{font-weight:700;white-space:nowrap}.mvp td.neg{color:#D0402A}.mvp .tm{color:#5B6676}.mvp bdi.ltr{white-space:nowrap}.mvp table.mv td{overflow:hidden}.mvp tr{break-inside:avoid}.mvp tr.dh td{background:#EEF2FB;color:#0F369D;font-weight:700;text-align:right;font-size:10px}.mvp tr.sub td{background:#F7F9FD;font-weight:700;text-align:right}.mvp tr.sub td.amt,.mvp tr.gt td.amt{text-align:center}.mvp tr.gt td{background:#0F369D;color:#fff;font-weight:700;text-align:right;font-size:10px}.mvp-sum{break-inside:avoid;width:60%}.mvp h4{margin:10px 0 4px;color:#0F369D;font-size:12px}</style>';
 var table='<table class="mv"><colgroup>'+widths.map(function(x){return '<col style="width:'+x+'%">';}).join('')+'</colgroup><thead><tr>'+head.map(function(h){return '<th>'+e(h)+'</th>';}).join('')+'</tr></thead><tbody>'+body+grand+'</tbody></table>';
 var bd=function(x){return '<bdi class="ltr">'+e(x)+'</bdi>';},period=o.from&&o.to?'من '+bd(dmy(o.from+'T12:00:00Z'))+' إلى '+bd(dmy(o.to+'T12:00:00Z')):e(o.period||'—');
 var mrow=function(k,v){return '<div><span class="k">'+e(k)+':</span> '+v+'</div>';};
 var meta='<div class="meta">'+mrow('الفترة',period)+mrow('الموظف',e(o.who||'جميع الموظفين'))+mrow('عدد الحركات',bd(String(rows.length)))+mrow('تاريخ الطباعة',bd(dmy(new Date()))+' '+e(P.time(new Date())))+(o.filter?mrow('التصفية',e(o.filter)):'')+'</div>';
 var inner=css+'<div class="mvp">'+P.title(o.heading||'كشف حركات الخزائن')+meta+table+methods+'</div>';
 return P.documentHtml(o.heading||'كشف حركات الخزائن',P.flow(inner));}
function printPdf(rows,o){var P=window.SSMPDPrint;if(!P)throw Error('ملف الطباعة غير محمّل');var win=P.blank();P.open(pdfHtml(rows,o),win);return win;}
/* host: element to fill. opts: {rpc, manager, shifts:[{cashier_id,cashier_name}], shift (optional id)} */
function mount(host,opts){opts=opts||{};var state={filter:'all',from:cairoDay(),to:cairoDay(),cashier:'',shift:opts.shift||null,data:null,error:null,loading:false};
 var rpc=opts.rpc||function(name,args){return window.SSMPDDb.client.rpc(name,args).then(function(r){if(r.error)throw r.error;return r.data;});};
 function title(){if(!state.data)return '';if(!opts.manager)return 'حركات الوردية — '+((state.data.shifts||[])[0]?state.data.shifts[0].register_name+' — '+state.data.shifts[0].cashier_name:'');
  var who=state.cashier?((opts.staff||[]).find(function(s){return s.id===state.cashier;})||{}).name||'':'كل الموظفين';return state.shift?'حركات الوردية — '+(((state.data.shifts||[])[0]||{}).register_name||'')+' — '+(((state.data.shifts||[])[0]||{}).cashier_name||''):'حركات الخزن — من '+state.from+' إلى '+state.to+' — '+who;}
 function load(){state.loading=true;paint();var args=state.shift?{p_shift:state.shift}:opts.manager?{p_from:state.from,p_to:state.to,p_cashier:state.cashier||null}:{};
  Promise.resolve(rpc('clinic_finance_shift_movements',args)).then(function(d){state.loading=false;state.error=null;state.data=d||{movements:[]};paint();notes(state.data);}).catch(function(e){state.loading=false;state.error=(e&&e.message)||'تعذر تحميل الحركات';paint();});}
 /* owner 2026-11-23 «طبقه» (20261122390000): a payment that covered more than one visit shows «دفعة واحدة لـN زيارات» + its note */
 function notes(data){var MP=window.SSMPDMultiPay,rows=(data&&data.movements)||[],ids=rows.filter(function(r){return r.direction==='in'&&r.source_id;}).map(function(r){return r.source_id;});
  if(!MP||!ids.length)return;MP.load({ids:ids.slice(0,3000)}).then(function(sum){if(!sum||!sum.rows||!sum.rows.length||state.data!==data)return;var by={};sum.rows.forEach(function(x){by[x.id]=x;});
   rows.forEach(function(r){var x=r.direction==='in'&&by[r.source_id];if(x){r.mp_visits=x.visits;r.mp_note=x.note;r.mp_cross=x.cross_patient;}});paint();});}
 function paint(){if(!host.isConnected&&host.parentNode===null)return;var all=(state.data&&state.data.movements)||[],rows=all.filter(FILTERS[state.filter]),multi=!!opts.manager,t=totals(all);
  var filters=opts.manager?'<div class="mv-mgr-filters">'+(state.shift?'<button type="button" class="btn ghost sm" data-mv-all>رجوع لكل الحركات</button>':'<label>من<input type="date" data-mv-from value="'+esc(state.from)+'"></label><label>إلى<input type="date" data-mv-to value="'+esc(state.to)+'"></label><label>الموظف<select data-mv-cashier><option value="">كل الموظفين</option>'+(opts.staff||[]).map(function(s){return '<option value="'+esc(s.id)+'"'+(s.id===state.cashier?' selected':'')+'>'+esc(s.name)+'</option>';}).join('')+'</select></label>')+'</div>':'';
  host.innerHTML='<section class="mv-section" aria-label="حركات الخزينة"><div class="mv-print-head"><h2>'+esc(title())+'</h2><p>مركز عيادات سونو التخصصية — اتطبع '+esc(new Date().toLocaleString('ar-EG-u-nu-latn',{timeZone:'Africa/Cairo'}))+' · '+rows.length+' حركة</p></div>'+
   '<h5>'+(opts.manager&&!state.shift?'كل الحركات بالتفصيل':'حركات الوردية بالتفصيل')+'</h5><p class="mv-sub">'+(opts.manager?'كل حركة في الخزن حسب الفلتر، بالترتيب.':'كل حركة دخلت أو خرجت من خزينتك في الوردية دي، بالترتيب.')+' الألوان: أزرق خاص (المريض بيدفع كامل)، بنفسجي تأمين، أحمر خارج، برتقالي تصحيح.</p>'+filters+
   '<div class="mv-filters" role="group" aria-label="فلتر الحركات">'+FILTER_LABELS.map(function(f){return '<button type="button" data-mv-filter="'+f[0]+'" aria-pressed="'+(state.filter===f[0])+'">'+f[1]+'</button>';}).join('')+'</div>'+
   '<div class="mv-tools"><button type="button" class="btn ghost sm" data-mv-export="xlsx"'+(rows.length?'':' disabled')+'>⬇ تصدير Excel</button><button type="button" class="btn ghost sm" data-mv-export="pdf"'+(rows.length?'':' disabled')+'>⬇ تصدير PDF</button></div>'+
   (state.loading?'<p class="mv-empty" role="status">جاري تحميل الحركات…</p>':state.error?'<p class="mv-empty mv-error" role="alert">'+esc(state.error)+'</p>':'<div class="mv-list">'+(rows.map(function(r){return rowHtml(r,multi);}).join('')||'<p class="mv-empty">مفيش حركات هنا.</p>')+'</div>')+
   (state.data&&state.data.capped?'<p class="mv-empty">ظاهر أول ٣٠٠٠ حركة بس؛ ضيّق الفترة.</p>':'')+
   '<div class="mv-foot"><span>نقدي داخل: <b>'+money(t.cashIn)+'</b></span><span>نقدي خارج: <b class="neg">'+money(t.cashOut)+'</b></span><span>فيزا: <b>'+money(t.card)+'</b></span><span>إنستا باي: <b>'+money(t.instapay)+'</b></span><span>نصيب مرضى التأمين: <b>'+money(t.ins)+'</b></span><span>مطالبات على جهات التأمين (مش في الخزينة): <b class="ins">'+money(t.claims)+'</b></span></div></section>';}
 host.addEventListener('click',function(e){var f=e.target.closest('[data-mv-filter]');if(f){state.filter=f.dataset.mvFilter;paint();return;}
  var x=e.target.closest('[data-mv-export]');if(x){var rows=((state.data&&state.data.movements)||[]).filter(FILTERS[state.filter]);if(!rows.length)return;if(x.dataset.mvExport==='pdf'){var one=state.shift||!opts.manager,sh=one&&((state.data&&state.data.shifts)||[])[0];try{printPdf(rows,{heading:one?'كشف حركات الوردية':'كشف حركات الخزائن',period:one?(sh?'وردية '+(sh.register_name||'')+(sh.opened_at?' — بدأت '+P_day(sh.opened_at):''):''):'',from:one?null:state.from,to:one?null:state.to,who:one?(sh&&sh.cashier_name):(opts.manager?(state.cashier?((opts.staff||[]).find(function(z){return z.id===state.cashier;})||{}).name:'جميع الموظفين'):((state.data.shifts||[])[0]||{}).cashier_name),filter:state.filter==='all'?'':(FILTER_LABELS.find(function(f){return f[0]===state.filter;})||[])[1]});}catch(er){var msg=(er&&er.message)||'تعذر فتح نافذة الطباعة';if(window.SSMPDToast&&window.SSMPDToast.show)window.SSMPDToast.show(msg);else window.alert(msg);}}else exportExcel(rows,title());return;}
  if(e.target.closest('[data-mv-all]')){state.shift=null;load();}});
 host.addEventListener('change',function(e){var t=e.target;if(t.matches('[data-mv-cashier]')){state.cashier=t.value;load();}
  else if(t.matches('[data-mv-from],[data-mv-to]')){var from=host.querySelector('[data-mv-from]').value,to=host.querySelector('[data-mv-to]').value;if(t.matches('[data-mv-from]')&&from&&(!to||to<from))to=from;if(t.matches('[data-mv-to]')&&to&&(!from||from>to))from=to;if(from&&to){state.from=from;state.to=to;load();}}});
 load();return {showShift:function(id){state.shift=id;state.filter='all';load();host.scrollIntoView&&host.scrollIntoView({behavior:'smooth',block:'start'});},reload:load,state:state};}
window.SSMPDShiftMovements={mount:mount,exportExcel:exportExcel,pdfHtml:pdfHtml,printPdf:printPdf,helpers:{totals:totals,exportRows:exportRows,methodLabel:methodLabel}};
})();
