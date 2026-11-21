/* Patient invoice of one visit on the official Swnw letterhead (A4) — approved mockup docs/ui-references/mockups/patient-invoice.html.
   Data = public.clinic_reception_invoice_print(workspace, visit): ONE invoice number per visit, the service lines, every payment with its receipt number. */
(function(w){'use strict';
var BASE='https://mohamedabdelaalhub.github.io/SSMPD-Swnw-Social-Media-Prduction-Dashboard/';
var PER_PAGE=12,METHOD={cash:'نقدي',pos:'فيزا',bank:'تحويل بنكي',instapay:'إنستا باي',wallet:'محفظة'};
function esc(v){return String(v==null?'':v).replace(/[&<>"']/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c];});}
function money(n){return Number(n||0).toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:2});}
function day(v){var d=new Date(v);if(isNaN(d))return String(v||'');var p=new Intl.DateTimeFormat('en-GB',{timeZone:'Africa/Cairo',day:'2-digit',month:'2-digit',year:'numeric'}).format(d);return p;}
function time(v){var d=new Date(v);return isNaN(d)?'':new Intl.DateTimeFormat('ar-EG',{timeZone:'Africa/Cairo',hour:'numeric',minute:'2-digit'}).format(d);}
function phone(p){p=String(p||'');return p.length>5?p.slice(0,3)+'••••••'+p.slice(-2):p;}
function css(){return "@font-face{font-family:'BigVesta Arabic';src:url('"+BASE+"assets/fonts/BigVesta-Regular.woff2') format('woff2')}"+
"@font-face{font-family:'BigVesta Arabic';font-weight:700;src:url('"+BASE+"assets/fonts/BigVesta-Bold.woff2') format('woff2')}"+
"@page{size:A4;margin:0}html,body{margin:0;background:#fff;direction:rtl;font-family:'BigVesta Arabic',Tahoma,sans-serif;color:#16212E}"+
".pg{position:relative;width:210mm;height:297mm;overflow:hidden;background:#fff;page-break-after:always}.pg:last-child{page-break-after:auto}"+
".bg{position:absolute;inset:0;width:100%;height:100%}.bd{position:absolute;top:44mm;bottom:52mm;right:16mm;left:16mm;font-size:12.5px;line-height:1.55}"+
".ttl{display:flex;justify-content:space-between;align-items:flex-end;border-bottom:2px solid #0F369D;padding-bottom:6px;margin-bottom:8px}.ttl h2{margin:0;color:#0F369D;font-size:22px}"+
".no{font-size:12px;color:#3B4658;text-align:left}.no b{display:block;font-size:17px;color:#F15A22;direction:ltr}"+
".meta{display:grid;grid-template-columns:1fr 1fr 1fr;gap:3px 14px;margin:0 0 10px;padding:8px 10px;background:#f4f6fb;border-radius:8px}.meta span.k{color:#5b6577}"+
"table{width:100%;border-collapse:collapse;font-size:12px;margin-bottom:8px}th,td{border:1px solid #c7d0e6;padding:4px 6px;text-align:center}th{background:#0F369D;color:#fff;font-weight:700}td.n{text-align:right}td.doc .dn{display:block;font-weight:700}td.doc .ds{display:block;font-size:10.5px;color:#5b6577}"+
".tot td{font-weight:700;background:#f4f6fb}.sum{display:grid;grid-template-columns:1.3fr 1fr;gap:12px;align-items:start}.box{border:1px solid #c7d0e6;border-radius:8px;padding:6px 10px}.box h4{margin:0 0 4px;color:#0F369D;font-size:13px}"+
".kv{display:flex;justify-content:space-between;padding:2px 0;border-bottom:1px dashed #dde3f0}.kv:last-child{border-bottom:0}.kv.big{font-size:15px;font-weight:700;color:#0F369D}.kv.due{font-weight:700;color:#D0402A}.kv.due.ok{color:#2F7D5C}"+
".ltr{direction:ltr;unicode-bidi:isolate}.sig{display:grid;grid-template-columns:repeat(3,1fr);gap:18px;margin-top:18px;font-size:12.5px}"+
".sig div{height:92px;padding:6px 8px;display:flex;flex-direction:column;justify-content:space-between;text-align:center;color:#3B4658}.sig div b{color:#0F369D}.sig div i{font-style:normal;font-size:11px;color:#8a94a6;border-top:1px solid #c7d0e6;padding-top:4px}"+
".note{font-size:11px;color:#5b6577;margin-top:8px}.tag{display:inline-block;padding:0 6px;border-radius:9px;font-size:11px;background:#e6f2ec;color:#2F7D5C}.pgno{font-size:11px;color:#8a94a6}";}
function uniq(a){return a.filter(function(x,i){return x&&a.indexOf(x)===i;});}
function pageHtml(d,lines,first,last,no,of){
 var t=d.totals||{},all=d.lines||[],pt=d.patient||{};
 var before=all.reduce(function(s,l){return s+Number(l.price||0);},0),disc=all.reduce(function(s,l){return s+Number(l.discount||0);},0),ins=Number(t.insurer||0);
 var depts=uniq(all.map(function(l){return l.specialty||l.department;})),docs=uniq(all.map(function(l){return l.doctor;}));
 var head='<div class="ttl"><h2>فاتورة / إيصال سداد</h2><div class="no">رقم الفاتورة<b>'+esc(d.invoice_no)+'</b>'+(of>1?'<span class="pgno">صفحة '+no+' / '+of+'</span>':'')+'</div></div>'+
  '<div class="meta"><div><span class="k">المريض:</span> '+esc(pt.name)+'</div><div><span class="k">رقم الملف:</span> <span class="ltr">'+esc(pt.file_no)+'</span></div><div><span class="k">التليفون:</span> <span class="ltr">'+esc(phone(pt.phone))+'</span></div>'+
  '<div><span class="k">تاريخ الخدمة:</span> <span class="ltr">'+esc(day(d.service_date))+'</span></div><div><span class="k">التخصص:</span> '+esc(depts.join('، ')||'—')+'</div><div><span class="k">الطبيب:</span> '+esc(docs.length===1?docs[0]:docs.length?'أكثر من طبيب':'—')+'</div></div>';
 var rows=lines.map(function(l){return '<tr><td>'+esc(l.no)+'</td><td class="n">'+esc(l.service)+'</td><td class="doc">'+(l.doctor?'<b class="dn">'+esc(l.doctor)+'</b>'+(l.specialty?'<small class="ds">'+esc(l.specialty)+'</small>':''):'—')+'</td><td>'+money(l.price)+'</td><td>'+money(l.discount)+'</td><td>'+money(l.net)+'</td></tr>';}).join('');
 var tot=last?'<tr class="tot"><td colspan="3">الإجمالي</td><td>'+money(before)+'</td><td>'+money(disc)+'</td><td>'+money(t.net)+'</td></tr>':'';
 var body='<table><tr><th>م</th><th>الخدمة</th><th>الطبيب / التخصص</th><th>السعر</th><th>الخصم</th><th>الصافي</th></tr>'+rows+tot+'</table>';
 if(last){var pays=(d.payments||[]),due=Number(t.due||0);
  body+='<div class="sum"><div class="box"><h4>المدفوعات</h4>'+(pays.length?'<table><tr><th>رقم الإيصال</th><th>الطريقة</th><th>رقم العملية</th><th>المبلغ</th></tr>'+pays.map(function(p){return '<tr><td class="ltr">'+esc(p.receipt_no||'—')+'</td><td>'+esc(METHOD[p.method]||p.method)+'</td><td class="ltr">'+esc(p.reference||'—')+'</td><td>'+money(p.amount)+'</td></tr>';}).join('')+'</table>':'<p>لسه مفيش مدفوعات على الفاتورة دي.</p>')+'</div>'+
   '<div class="box"><h4>الحساب</h4><div class="kv"><span>إجمالي الخدمات</span><span>'+money(before)+'</span></div><div class="kv"><span>الخصم</span><span class="ltr">−'+money(disc)+'</span></div>'+
   (ins?'<div class="kv"><span>على جهة التعاقد</span><span>'+money(ins)+'</span></div>':'')+
   '<div class="kv big"><span>المطلوب من المريض</span><span>'+money(Number(t.net||0)-ins)+'</span></div><div class="kv"><span>المدفوع</span><span>'+money(t.paid)+'</span></div>'+
   '<div class="kv due'+(due<=0?' ok':'')+'"><span>المتبقي</span><span>'+money(Math.max(0,due))+(due<=0?' <span class="tag">مسدّدة بالكامل</span>':'')+'</span></div></div></div>'+
   '<div class="sig"><div><b>توقيع الموظف</b><i>'+esc(d.printed_by||'')+'</i></div><div><b>توقيع المريض</b><i>الاسم والتوقيع</i></div><div><b>ختم المركز</b><i>&nbsp;</i></div></div>'+
   '<div class="note">الأسعار بالجنيه المصري. اتطبعت من الداشبورد يوم <span class="ltr">'+esc(day(d.printed_at))+'</span> الساعة '+esc(time(d.printed_at))+' — '+esc(d.printed_by||'')+'.</div>';}
 return '<section class="pg"><img class="bg" crossorigin="anonymous" src="'+BASE+'assets/img/swnw-official-letterhead.png" alt=""><div class="bd">'+head+body+'</div></section>';}
function documentHtml(d){if(!d||!d.invoice_no||!Array.isArray(d.lines)||!d.lines.length)throw Error('مفيش خدمات في الفاتورة');
 var chunks=[];for(var i=0;i<d.lines.length;i+=PER_PAGE)chunks.push(d.lines.slice(i,i+PER_PAGE));
 return '<!doctype html><html lang="ar" dir="rtl"><head><meta charset="utf-8"><title>فاتورة '+esc(d.invoice_no)+'</title><style>'+css()+'</style></head><body>'+chunks.map(function(c,i){return pageHtml(d,c,i===0,i===chunks.length-1,i+1,chunks.length);}).join('')+'</body></html>';}
function openPrint(d,win){win=win||w.open('','_blank');if(!win)throw Error('المتصفح منع نافذة الطباعة — اسمح بالنوافذ المنبثقة');
 win.document.open();win.document.write(documentHtml(d));win.document.close();var go=function(){try{win.focus();win.print();}catch(e){}};
 var img=win.document.querySelector('img.bg');if(img&&!img.complete){img.onload=img.onerror=function(){setTimeout(go,150);};}else setTimeout(go,300);return win;}
/* fetches the invoice (assigns its number the first time) then prints; the window is opened first so the popup is not blocked */
async function print(workspace,visit){var win=w.open('','_blank');if(!win)throw Error('المتصفح منع نافذة الطباعة — اسمح بالنوافذ المنبثقة');
 win.document.write('<p dir="rtl" style="font-family:Tahoma">جاري تجهيز الفاتورة…</p>');
 try{var r=await w.SSMPDDb.client.rpc('clinic_reception_invoice_print',{p_workspace:workspace,p_visit:visit});if(r.error)throw r.error;return openPrint(r.data,win);}catch(e){win.close();throw e;}}
w.SSMPDPatientInvoicePrint={documentHtml:documentHtml,openPrint:openPrint,print:print};
})(window);
