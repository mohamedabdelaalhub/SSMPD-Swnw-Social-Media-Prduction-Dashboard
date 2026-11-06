/* Insurance invoice / claim sheet on the official Swnw letterhead (A4). Pure renderer + print window. Input = one invoice from buildInvoices(). */
(function(w){'use strict';
var BASE='https://mohamedabdelaalhub.github.io/SSMPD-Swnw-Social-Media-Prduction-Dashboard/';
var DEPT={service:'الكشوفات والخدمات',radiology:'الأشعة',lab:'المعامل',pharmacy:'الأدوية',supplies:'المستلزمات'};
var PER_PAGE=14;
function esc(v){return String(v==null?'':v).replace(/[&<>"']/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c];});}
function money(n){return Number(n||0).toFixed(2);}
function css(){return "@font-face{font-family:'BigVesta Arabic';src:url('"+BASE+"assets/fonts/BigVesta-Regular.woff2') format('woff2')}"+
"@font-face{font-family:'BigVesta Arabic';font-weight:700;src:url('"+BASE+"assets/fonts/BigVesta-Bold.woff2') format('woff2')}"+
"@page{size:A4;margin:0}html,body{margin:0;background:#fff;direction:rtl;font-family:'BigVesta Arabic',Tahoma,sans-serif}"+
".pg{position:relative;width:210mm;height:297mm;overflow:hidden;page-break-after:always}.pg:last-child{page-break-after:auto}"+
".bg{position:absolute;top:0;left:-8mm;width:226mm;height:297mm;object-fit:fill}"+
".bd{position:absolute;top:43mm;bottom:50mm;right:15mm;left:15mm;font-size:14px;line-height:1.6}"+
"h2{text-align:center;color:#0f369d;font-size:24px;margin:0 0 10px}.meta{display:grid;grid-template-columns:1fr 1fr;gap:2px 16px;margin-bottom:10px}"+
"table{width:100%;border-collapse:collapse;font-size:13px}th,td{border:1px solid #9aa9cf;padding:3px 6px;text-align:center}th{background:#eef2fb;color:#0f369d}td.n{text-align:right}"+
".tot td{font-weight:700;background:#f6f8fd}.sig{display:flex;justify-content:space-between;margin-top:26px}.sig div{width:45%;text-align:center}";}
function lineRows(lines){return lines.map(function(l){return '<tr><td>'+esc(l.serial)+'</td><td class="n">'+esc(l.name||('خدمة '+l.serviceId))+'</td><td>'+money(l.before)+'</td><td>'+money(l.discount)+'</td><td>'+money(l.after)+'</td><td>'+money(l.patientShare)+'</td><td>'+money(l.insurerShare)+'</td></tr>';}).join('');}
function pageHtml(inv,ctx,rows,last,no,of){
  var t=inv.totals||{};
  var head='<tr><th>م</th><th>الخدمة</th><th>قبل الخصم</th><th>الخصم</th><th>بعد الخصم</th><th>حصة المريض</th><th>حصة التأمين</th></tr>';
  var tot=last?'<tr class="tot"><td colspan="2">الإجمالي</td><td>'+money(t.before)+'</td><td>'+money(t.discount)+'</td><td>'+money(t.after)+'</td><td>'+money(t.patientShare)+'</td><td>'+money(t.insurerShare)+'</td></tr>':'';
  var sig=last?'<div class="sig"><div>توقيع المحاسب<br><br>................</div><div>ختم المركز<br><br>................</div></div>':'';
  return '<section class="pg"><img class="bg" crossorigin="anonymous" src="'+BASE+'assets/img/swnw-official-letterhead.png" alt=""><div class="bd">'+
   '<h2>مطالبة تأمينية — '+esc(DEPT[inv.department]||inv.department)+'</h2>'+
   '<div class="meta"><div><b>المريض:</b> '+esc(ctx.patientName)+'</div><div><b>جهة التأمين:</b> '+esc(ctx.insurerName||'—')+'</div>'+
   '<div><b>رقم الفاتورة:</b> '+'<span dir="ltr">'+esc(ctx.invoiceNo||'—')+'</span></div><div><b>التاريخ:</b> <span dir="ltr">'+esc(ctx.date||'')+'</span></div>'+
   '<div><b>رقم العضوية:</b> '+'<span dir="ltr">'+esc(ctx.memberNo||'—')+'</span></div><div><b>صفحة:</b> '+no+' / '+of+'</div></div>'+
   '<table>'+head+rows+tot+'</table>'+sig+'</div></section>';
}
function invoiceHtml(inv,ctx){
  if(!inv||!Array.isArray(inv.lines)||!inv.lines.length)throw Error('Invoice with lines required');
  if(!ctx||!ctx.patientName)throw Error('Patient name required');
  var chunks=[];for(var i=0;i<inv.lines.length;i+=PER_PAGE)chunks.push(inv.lines.slice(i,i+PER_PAGE));
  return chunks.map(function(c,i){return pageHtml(inv,ctx,lineRows(c),i===chunks.length-1,i+1,chunks.length);}).join('');
}
function documentHtml(invoices,ctx){return '<!doctype html><html lang="ar" dir="rtl"><head><meta charset="utf-8"><title>مطالبة تأمينية</title><style>'+css()+'</style></head><body>'+invoices.map(function(i){return invoiceHtml(i,ctx);}).join('')+'</body></html>';}
function openPrint(invoices,ctx){
  var win=w.open('','_blank');if(!win)throw Error('المتصفح منع نافذة الطباعة');
  win.document.open();win.document.write(documentHtml(invoices,ctx));win.document.close();
  var imgs=Array.prototype.slice.call(win.document.images),left=imgs.length;
  var go=function(){win.focus();win.print();};if(!left)return go();
  imgs.forEach(function(im){if(im.complete){if(!--left)go();}else{im.onload=im.onerror=function(){if(!--left)go();};}});
}
w.SSMPDServiceInvoicePrint={invoiceHtml:invoiceHtml,documentHtml:documentHtml,openPrint:openPrint,_pure:{esc:esc,money:money,PER_PAGE:PER_PAGE}};
})(typeof window!=='undefined'?window:globalThis);
