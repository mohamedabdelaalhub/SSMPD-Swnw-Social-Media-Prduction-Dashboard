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
 return '<article class="mv-row '+cls(r)+'"><div class="mv-time">'+esc(time(r.at))+'</div><div class="mv-who"><strong>'+esc(r.title)+'</strong>'+(multi?'<span class="mv-emp">الموظف: '+esc(r.cashier_name)+'</span>':'')+'<small>'+esc(r.detail||'')+'</small></div>'+
  '<div class="mv-kind"><span class="mv-tag '+cls(r)+'">'+esc(kindLabel(r))+'</span>'+(ins?'<small>'+esc(ins.payer)+(ins.cover!=null?' بتتحمل '+esc(ins.cover)+'٪':'')+' · مطالبة على الجهة '+esc(money(ins.claim))+' · إجمالي الخدمة '+esc(money(ins.total))+'</small>':'')+'</div>'+
  '<div class="mv-method">'+esc(methodLabel(r.method))+'<small>'+esc(r.reference||'')+'</small></div>'+
  '<div class="mv-amt"><bdi dir="ltr">'+(amount>0&&r.direction!=='fix'?'+':'')+num(amount)+'</bdi> ج.م</div></article>';}
function totals(rows){var sum=function(f){return rows.filter(f).reduce(function(n,r){return n+Number(r.amount||0);},0);};
 return {cashIn:sum(function(r){return r.direction==='in'&&r.method==='cash';}),cashOut:-sum(function(r){return r.direction==='out'&&r.method==='cash';}),
  card:sum(function(r){return r.direction==='in'&&r.method==='pos';}),instapay:sum(function(r){return r.direction==='in'&&r.method==='instapay';}),
  ins:sum(function(r){return r.direction==='in'&&r.kind==='insurance';}),claims:rows.reduce(function(n,r){return n+(r.insurance?Number(r.insurance.claim||0):0);},0)};}
function exportRows(rows){return rows.map(function(r){var i=r.insurance||{};return [day(r.at),time(r.at),r.cashier_name,r.register_name,r.title,r.detail||'',kindLabel(r),i.payer||'',i.cover!=null?i.cover+'%':'',i.claim!=null?Number(i.claim):'',methodLabel(r.method),r.reference||'',r.direction==='out'?'خارج':r.direction==='fix'?'تصحيح':'داخل',Number(r.amount)];});}
var HEAD=['اليوم','الوقت','الموظف','الخزينة','المريض / البيان','الخدمة والملف','النوع','جهة التأمين','نسبة الجهة','مطالبة على الجهة','طريقة التحصيل','المرجع','داخل / خارج','المبلغ'];
function exportExcel(rows,title){var name=String(title||'حركات الخزينة').replace(/[\\/:*?"<>|]/g,'-');
 if(window.XLSX&&window.XLSX.utils){var ws=window.XLSX.utils.aoa_to_sheet([HEAD].concat(exportRows(rows)));ws['!cols']=[16,7,14,16,22,30,22,18,10,14,14,14,10,12].map(function(w){return {wch:w};});var wb=window.XLSX.utils.book_new();wb.Workbook={Views:[{RTL:true}]};window.XLSX.utils.book_append_sheet(wb,ws,'الحركات');window.XLSX.writeFile(wb,name+'.xlsx');return 'xlsx';}
 var csv='﻿'+[HEAD].concat(exportRows(rows)).map(function(r){return r.map(function(v){return '"'+String(v).replace(/"/g,'""')+'"';}).join(',');}).join('\r\n');
 var a=document.createElement('a');a.href=URL.createObjectURL(new Blob([csv],{type:'text/csv;charset=utf-8'}));a.download=name+'.csv';document.body.appendChild(a);a.click();a.remove();setTimeout(function(){URL.revokeObjectURL(a.href);},1000);return 'csv';}
function printSection(section){var root=document.documentElement;section.classList.add('mv-print-target');root.classList.add('mv-printing');
 var done=function(){root.classList.remove('mv-printing');section.classList.remove('mv-print-target');window.removeEventListener('afterprint',done);};window.addEventListener('afterprint',done);
 try{window.print();}finally{setTimeout(done,1500);}}
/* host: element to fill. opts: {rpc, manager, shifts:[{cashier_id,cashier_name}], shift (optional id)} */
function mount(host,opts){opts=opts||{};var state={filter:'all',from:cairoDay(),to:cairoDay(),cashier:'',shift:opts.shift||null,data:null,error:null,loading:false};
 var rpc=opts.rpc||function(name,args){return window.SSMPDDb.client.rpc(name,args).then(function(r){if(r.error)throw r.error;return r.data;});};
 function title(){if(!state.data)return '';if(!opts.manager)return 'حركات الوردية — '+((state.data.shifts||[])[0]?state.data.shifts[0].register_name+' — '+state.data.shifts[0].cashier_name:'');
  var who=state.cashier?((opts.staff||[]).find(function(s){return s.id===state.cashier;})||{}).name||'':'كل الموظفين';return state.shift?'حركات الوردية — '+(((state.data.shifts||[])[0]||{}).register_name||'')+' — '+(((state.data.shifts||[])[0]||{}).cashier_name||''):'حركات الخزن — من '+state.from+' إلى '+state.to+' — '+who;}
 function load(){state.loading=true;paint();var args=state.shift?{p_shift:state.shift}:opts.manager?{p_from:state.from,p_to:state.to,p_cashier:state.cashier||null}:{};
  Promise.resolve(rpc('clinic_finance_shift_movements',args)).then(function(d){state.loading=false;state.error=null;state.data=d||{movements:[]};paint();}).catch(function(e){state.loading=false;state.error=(e&&e.message)||'تعذر تحميل الحركات';paint();});}
 function paint(){if(!host.isConnected&&host.parentNode===null)return;var all=(state.data&&state.data.movements)||[],rows=all.filter(FILTERS[state.filter]),multi=!!opts.manager,t=totals(all);
  var filters=opts.manager?'<div class="mv-mgr-filters">'+(state.shift?'<button type="button" class="btn ghost sm" data-mv-all>رجوع لكل الحركات</button>':'<label>من<input type="date" data-mv-from value="'+esc(state.from)+'"></label><label>إلى<input type="date" data-mv-to value="'+esc(state.to)+'"></label><label>الموظف<select data-mv-cashier><option value="">كل الموظفين</option>'+(opts.staff||[]).map(function(s){return '<option value="'+esc(s.id)+'"'+(s.id===state.cashier?' selected':'')+'>'+esc(s.name)+'</option>';}).join('')+'</select></label>')+'</div>':'';
  host.innerHTML='<section class="mv-section" aria-label="حركات الخزينة"><div class="mv-print-head"><h2>'+esc(title())+'</h2><p>مركز عيادات Swnw — اتطبع '+esc(new Date().toLocaleString('ar-EG-u-nu-latn',{timeZone:'Africa/Cairo'}))+' · '+rows.length+' حركة</p></div>'+
   '<h5>'+(opts.manager&&!state.shift?'كل الحركات بالتفصيل':'حركات الوردية بالتفصيل')+'</h5><p class="mv-sub">'+(opts.manager?'كل حركة في الخزن حسب الفلتر، بالترتيب.':'كل حركة دخلت أو خرجت من خزينتك في الوردية دي، بالترتيب.')+' الألوان: أزرق خاص (المريض بيدفع كامل)، بنفسجي تأمين، أحمر خارج، برتقالي تصحيح.</p>'+filters+
   '<div class="mv-filters" role="group" aria-label="فلتر الحركات">'+FILTER_LABELS.map(function(f){return '<button type="button" data-mv-filter="'+f[0]+'" aria-pressed="'+(state.filter===f[0])+'">'+f[1]+'</button>';}).join('')+'</div>'+
   '<div class="mv-tools"><button type="button" class="btn ghost sm" data-mv-export="xlsx"'+(rows.length?'':' disabled')+'>⬇ تصدير Excel</button><button type="button" class="btn ghost sm" data-mv-export="pdf"'+(rows.length?'':' disabled')+'>⬇ تصدير PDF</button></div>'+
   (state.loading?'<p class="mv-empty" role="status">جاري تحميل الحركات…</p>':state.error?'<p class="mv-empty mv-error" role="alert">'+esc(state.error)+'</p>':'<div class="mv-list">'+(rows.map(function(r){return rowHtml(r,multi);}).join('')||'<p class="mv-empty">مفيش حركات هنا.</p>')+'</div>')+
   (state.data&&state.data.capped?'<p class="mv-empty">ظاهر أول ٣٠٠٠ حركة بس؛ ضيّق الفترة.</p>':'')+
   '<div class="mv-foot"><span>نقدي داخل: <b>'+money(t.cashIn)+'</b></span><span>نقدي خارج: <b class="neg">'+money(t.cashOut)+'</b></span><span>فيزا: <b>'+money(t.card)+'</b></span><span>إنستا باي: <b>'+money(t.instapay)+'</b></span><span>نصيب مرضى التأمين: <b>'+money(t.ins)+'</b></span><span>مطالبات على جهات التأمين (مش في الخزينة): <b class="ins">'+money(t.claims)+'</b></span></div></section>';}
 host.addEventListener('click',function(e){var f=e.target.closest('[data-mv-filter]');if(f){state.filter=f.dataset.mvFilter;paint();return;}
  var x=e.target.closest('[data-mv-export]');if(x){var rows=((state.data&&state.data.movements)||[]).filter(FILTERS[state.filter]);if(!rows.length)return;if(x.dataset.mvExport==='pdf')printSection(host.querySelector('.mv-section'));else exportExcel(rows,title());return;}
  if(e.target.closest('[data-mv-all]')){state.shift=null;load();}});
 host.addEventListener('change',function(e){var t=e.target;if(t.matches('[data-mv-cashier]')){state.cashier=t.value;load();}
  else if(t.matches('[data-mv-from],[data-mv-to]')){var from=host.querySelector('[data-mv-from]').value,to=host.querySelector('[data-mv-to]').value;if(t.matches('[data-mv-from]')&&from&&(!to||to<from))to=from;if(t.matches('[data-mv-to]')&&to&&(!from||from>to))from=to;if(from&&to){state.from=from;state.to=to;load();}}});
 load();return {showShift:function(id){state.shift=id;state.filter='all';load();host.scrollIntoView&&host.scrollIntoView({behavior:'smooth',block:'start'});},reload:load,state:state};}
window.SSMPDShiftMovements={mount:mount,exportExcel:exportExcel,helpers:{totals:totals,exportRows:exportRows,methodLabel:methodLabel}};
})();
