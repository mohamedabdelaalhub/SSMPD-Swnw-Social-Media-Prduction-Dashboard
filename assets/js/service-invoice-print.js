/* Insurance invoice / claim sheet on the official Swnw letterhead (A4). Pure renderer + print window. Input = one invoice from buildInvoices(). */
(function(w){'use strict';
var BASE='https://mohamedabdelaalhub.github.io/SSMPD-Swnw-Social-Media-Prduction-Dashboard/';
var DEPT={consult:'الكشوفات والخدمات',service:'الكشوفات والخدمات',radiology:'الأشعة',lab:'المعامل',pharmacy:'الأدوية',supplies:'المستلزمات'};
var PER_PAGE=14;
function esc(v){return String(v==null?'':v).replace(/[&<>"']/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c];});}
function money(n){return Number(n||0).toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:2});}
var METHOD={cash:'نقدي',pos:'فيزا',bank:'تحويل بنكي',instapay:'إنستا باي',wallet:'محفظة'};
function css(){return "@font-face{font-family:'BigVesta Arabic';src:url('"+BASE+"assets/fonts/BigVesta-Regular.woff2') format('woff2')}"+
"@font-face{font-family:'BigVesta Arabic';font-weight:700;src:url('"+BASE+"assets/fonts/BigVesta-Bold.woff2') format('woff2')}"+
"@page{size:A4;margin:0}html,body{margin:0;background:#fff;direction:rtl;font-family:'BigVesta Arabic',Tahoma,sans-serif;color:#16212E}"+
".pg{position:relative;width:210mm;height:297mm;overflow:hidden;page-break-after:always}.pg:last-child{page-break-after:auto}"+
".bg{position:absolute;inset:0;width:100%;height:100%}.bd{position:absolute;top:44mm;bottom:52mm;right:16mm;left:16mm;font-size:12.5px;line-height:1.55}"+
".ttl{display:flex;justify-content:space-between;align-items:flex-end;border-bottom:2px solid #0F369D;padding-bottom:6px;margin-bottom:8px}.ttl h2{margin:0;color:#0F369D;font-size:22px}"+
".no{font-size:12px;color:#3B4658;text-align:left}.no b{display:block;font-size:17px;color:#F15A22;direction:ltr}.pgno{font-size:11px;color:#8a94a6}"+
".meta{display:grid;grid-template-columns:1fr 1fr 1fr;gap:3px 14px;margin:0 0 10px;padding:8px 10px;background:#f4f6fb;border-radius:8px}.meta span.k{color:#5b6577}"+
"table{width:100%;border-collapse:collapse;font-size:12px;margin-bottom:8px}th,td{border:1px solid #c7d0e6;padding:4px 6px;text-align:center}th{background:#0F369D;color:#fff;font-weight:700}td.n{text-align:right}td.doc .dn{display:block;font-weight:700}td.doc .ds{display:block;font-size:10.5px;color:#5b6577}"+
".tot td{font-weight:700;background:#f4f6fb}.sum{display:grid;grid-template-columns:1.3fr 1fr;gap:12px;align-items:start}.box{border:1px solid #c7d0e6;border-radius:8px;padding:6px 10px}.box h4{margin:0 0 4px;color:#0F369D;font-size:13px}"+
".kv{display:flex;justify-content:space-between;padding:2px 0;border-bottom:1px dashed #dde3f0}.kv:last-child{border-bottom:0}.kv.big{font-size:15px;font-weight:700;color:#0F369D}.ltr{direction:ltr;unicode-bidi:isolate}"+
".sig{display:grid;grid-template-columns:repeat(3,1fr);gap:18px;margin-top:18px;font-size:12.5px}.sig div{height:92px;padding:6px 8px;display:flex;flex-direction:column;justify-content:space-between;text-align:center;color:#3B4658}.sig div b{color:#0F369D}"+
".sig div i{font-style:normal;font-size:11px;color:#8a94a6;border-top:1px solid #c7d0e6;padding-top:4px}.note{font-size:11px;color:#5b6577;margin-top:8px}";}
function docCell(l){return l.doctorName?'<b class="dn">'+esc(l.doctorName)+'</b>'+(l.doctorSpecialty?'<small class="ds">'+esc(l.doctorSpecialty)+'</small>':''):'—';}
function lineRows(lines){return lines.map(function(l){return '<tr><td>'+esc(l.serial)+'</td><td class="n">'+esc(l.name||('خدمة '+l.serviceId))+'</td><td class="doc">'+docCell(l)+'</td><td>'+money(l.before)+'</td><td>'+money(l.discount)+'</td><td>'+money(l.after)+'</td><td>'+money(l.patientShare)+'</td><td>'+money(l.insurerShare)+
'</td></tr>';}).join('');}
function uniq(a){return a.filter(function(x,i){return x&&a.indexOf(x)===i;});}
function doctorMeta(lines){var docs=uniq((lines||[]).map(function(l){return l.doctorName;})),sp=uniq((lines||[]).map(function(l){return l.doctorSpecialty;}));if(!docs.length)return '';return '<div><span class="k">الطبيب:</span> '+esc(docs.length===1?docs[0]:'أكثر من طبيب')+'</div><div><span class="k">التخصص:</span> '+esc(sp.join('، ')||'—')+'</div>';}
function pageHtml(inv,ctx,rows,last,no,of){
  var t=inv.totals||{};
  var head='<tr><th>م</th><th>الخدمة</th><th>الطبيب / التخصص</th><th>قبل الخصم</th><th>الخصم</th><th>بعد الخصم</th><th>حصة المريض</th><th>حصة الجهة</th></tr>';
  var tot=last?'<tr class="tot"><td colspan="3">الإجمالي</td><td>'+money(t.before)+'</td><td>'+money(t.discount)+'</td><td>'+money(t.after)+'</td><td>'+money(t.patientShare)+'</td><td>'+money(t.insurerShare)+'</td></tr>':'';
  var pays=ctx.payments||[],cover=Number(t.after)>0?Math.round(Number(t.insurerShare)/Number(t.after)*100):0;
  var tail=last?'<div class="sum"><div class="box"><h4>حصة المريض — المدفوعات</h4>'+(pays.length?'<table><tr><th>رقم الإيصال</th><th>الطريقة</th><th>رقم العملية</th><th>المبلغ</th></tr>'+pays.map(function(p){return '<tr><td class="ltr">'+esc(p.receipt_no||'—')+'</td><td>'+esc(METHOD[p.method]||p.method||'')+'</td><td class="ltr">'+esc(p.reference||'—')+'</td><td>'+money(p.amount)+'</td></tr>'+(Number(p.visits)>1?'<tr><td colspan="4" style="font-size:11px;color:#5b6577">جزء من دفعة '+money(p.total)+' غطّت '+Number(p.visits)+' زيارات'+(p.note?' — '+esc(p.note):'')+'</td></tr>':'');}).join('')+'</table>':'<p>مفيش مدفوعات مسجّلة على الزيارة.</p>')+'</div>'+
    '<div class="box"><h4>المطلوب من الجهة</h4><div class="kv big"><span>المبلغ المطالَب به</span><span>'+money(t.insurerShare)+'</span></div><div class="kv"><span>نسبة التغطية</span><span>'+cover+'٪</span></div>'+(ctx.approvalNo?'<div class="kv"><span>رقم الموافقة</span><span class="ltr">'+esc(ctx.approvalNo)+'</span></div>':'')+'</div></div>'+
    '<div class="sig"><div><b>توقيع المحاسب</b><i>الاسم والتوقيع</i></div><div><b>توقيع المريض / المستفيد</b><i>الاسم والتوقيع</i></div><div><b>ختم المركز</b><i>&nbsp;</i></div></div>'+
    '<div class="note">مرفق: صورة الموافقة وصورة إيصال سداد حصة المريض. الأسعار بالجنيه المصري.</div>':'';
  return '<section class="pg"><img class="bg" crossorigin="anonymous" src="'+BASE+'assets/img/swnw-official-letterhead.png" alt=""><div class="bd">'+
   '<div class="ttl"><h2>فاتورة مطالبة — '+esc(DEPT[inv.department]||inv.department)+'</h2><div class="no">رقم الفاتورة<b>'+esc(ctx.invoiceNo||'—')+'</b>'+(of>1?'<span class="pgno">صفحة '+no+' / '+of+'</span>':'')+'</div></div>'+
   '<div class="meta"><div><span class="k">جهة التعاقد:</span> '+esc(ctx.insurerName||'—')+'</div><div><span class="k">رقم العضوية:</span> <span class="ltr">'+esc(ctx.memberNo||'—')+'</span></div><div><span class="k">رقم الموافقة:</span> <span class="ltr">'+esc(ctx.approvalNo||'—')+'</span></div>'+
   '<div><span class="k">المريض:</span> '+esc(ctx.patientName)+'</div><div><span class="k">رقم الملف:</span> <span class="ltr">'+esc(ctx.fileNo||'—')+'</span></div><div><span class="k">تاريخ الخدمة:</span> <span class="ltr">'+esc(ctx.date||'')+'</span></div>'+doctorMeta(inv.lines)+'</div>'+
   '<table>'+head+rows+tot+'</table>'+tail+'</div></section>';
}
function invoiceHtml(inv,ctx){
  if(!inv||!Array.isArray(inv.lines)||!inv.lines.length)throw Error('Invoice with lines required');
  if(!ctx||!ctx.patientName)throw Error('Patient name required');
  var chunks=[];for(var i=0;i<inv.lines.length;i+=PER_PAGE)chunks.push(inv.lines.slice(i,i+PER_PAGE));
  return chunks.map(function(c,i){return pageHtml(inv,ctx,lineRows(c),i===chunks.length-1,i+1,chunks.length);}).join('');
}
function documentHtml(invoices,ctx){return '<!doctype html><html lang="ar" dir="rtl"><head><meta charset="utf-8"><title>فاتورة مطالبة</title><style>'+css()+'</style></head><body>'+invoices.map(function(i){return invoiceHtml(i,ctx);}).join('')+'</body></html>';}
function openPrint(invoices,ctx,target){
  var win=target||w.open('','_blank');if(!win)throw Error('المتصفح منع نافذة الطباعة');
  win.document.open();win.document.write(documentHtml(invoices,ctx));win.document.close();
  var imgs=Array.prototype.slice.call(win.document.images),left=imgs.length;
  var go=function(){win.focus();win.print();};if(!left)return go();
  imgs.forEach(function(im){if(im.complete){if(!--left)go();}else{im.onload=im.onerror=function(){if(!--left)go();};}});
}
w.SSMPDServiceInvoicePrint={invoiceHtml:invoiceHtml,documentHtml:documentHtml,openPrint:openPrint,_pure:{esc:esc,money:money,PER_PAGE:PER_PAGE}};
})(typeof window!=='undefined'?window:globalThis);
