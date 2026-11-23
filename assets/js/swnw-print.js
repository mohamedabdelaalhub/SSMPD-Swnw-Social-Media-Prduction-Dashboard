/* ONE look for every printed invoice / receipt / claim (owner 2026-11-19, rule in docs/ui-references/PRINT-DOCUMENTS.md):
   the official A4 letterhead, BigVesta, blue title + orange number, grey facts band, blue-header tables, frameless signatures.
   No brand name in titles — the logo on the letterhead says it. Two layouts:
     page(...)  fixed A4 pages (invoice, receipt)        flow(...)  long documents; the letterhead repeats on every printed page. */
(function(w){'use strict';
var BASE='https://mohamedabdelaalhub.github.io/SSMPD-Swnw-Social-Media-Prduction-Dashboard/';
var METHOD={cash:'نقدي',pos:'فيزا',bank:'تحويل بنكي',instapay:'إنستا باي',wallet:'محفظة'};
function esc(v){return String(v==null?'':v).replace(/[&<>"']/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c];});}
function money(n){return Number(n||0).toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:2});}
function day(v){var d=new Date(v);return isNaN(d)?String(v||''):new Intl.DateTimeFormat('en-GB',{timeZone:'Africa/Cairo',day:'2-digit',month:'2-digit',year:'numeric'}).format(d);}
function time(v){var d=new Date(v);return isNaN(d)?'':new Intl.DateTimeFormat('ar-EG-u-nu-latn',{timeZone:'Africa/Cairo',hour:'numeric',minute:'2-digit'}).format(d);}
function stamp(v){var t=time(v);return day(v)+(t?' — '+t:'');}
/* Arabic amount in words (pounds + piastres), e.g. 750 → «سبعمائة وخمسون جنيهًا فقط لا غير» */
var ONES=['','واحد','اثنان','ثلاثة','أربعة','خمسة','ستة','سبعة','ثمانية','تسعة','عشرة','أحد عشر','اثنا عشر','ثلاثة عشر','أربعة عشر','خمسة عشر','ستة عشر','سبعة عشر','ثمانية عشر','تسعة عشر'];
var TENS=['','','عشرون','ثلاثون','أربعون','خمسون','ستون','سبعون','ثمانون','تسعون'];
var HUND=['','مائة','مائتان','ثلاثمائة','أربعمائة','خمسمائة','ستمائة','سبعمائة','ثمانمائة','تسعمائة'];
function below1000(n){var h=Math.floor(n/100),r=n%100,p=[];if(h)p.push(HUND[h]);if(r){if(r<20)p.push(ONES[r]);else{var o=r%10,t=Math.floor(r/10);p.push(o?ONES[o]+' و'+TENS[t]:TENS[t]);}}return p.join(' و');}
function scale(n,one,two,few,many){if(!n)return '';if(n===1)return one;if(n===2)return two;if(n<=10)return below1000(n)+' '+few;return below1000(n)+' '+many;}
function intWords(n){if(!n)return 'صفر';var m=Math.floor(n/1e6),k=Math.floor(n%1e6/1000),r=n%1000,p=[];
 if(m)p.push(scale(m,'مليون','مليونان','ملايين','مليون'));if(k)p.push(scale(k,'ألف','ألفان','آلاف','ألف'));if(r)p.push(below1000(r));return p.join(' و');}
function words(amount){var a=Math.round(Math.abs(Number(amount)||0)*100),g=Math.floor(a/100),pt=a%100;
 var s=intWords(g)+' جنيهًا';if(pt)s+=' و'+intWords(pt)+' قرشًا';return s+' فقط لا غير';}
function css(){return "@font-face{font-family:'BigVesta Arabic';src:url('"+BASE+"assets/fonts/BigVesta-Regular.woff2') format('woff2')}"+
"@font-face{font-family:'BigVesta Arabic';font-weight:700;src:url('"+BASE+"assets/fonts/BigVesta-Bold.woff2') format('woff2')}"+
"@page{size:A4;margin:0}html,body{margin:0;background:#fff;direction:rtl;font-family:'BigVesta Arabic',Tahoma,sans-serif;color:#16212E;-webkit-print-color-adjust:exact;print-color-adjust:exact}"+
".pg{position:relative;width:210mm;height:297mm;overflow:hidden;background:#fff;page-break-after:always}.pg:last-child{page-break-after:auto}"+
".bg{position:absolute;inset:0;width:100%;height:100%}.bd{position:absolute;top:44mm;bottom:52mm;right:16mm;left:16mm;font-size:12.5px;line-height:1.55}"+
".bgf{position:fixed;top:0;left:0;width:210mm;height:297mm;z-index:0}.flow{position:relative;z-index:1;width:210mm;border-collapse:collapse;margin:0}.flow>thead td,.flow>tfoot td,.flow>tbody>tr>td{border:0;padding:0;text-align:right;background:none}"+
".flow .sp-top{height:44mm}.flow .sp-bot{height:52mm}.flow .fb{padding:0 16mm;font-size:12.5px;line-height:1.55}.brk{break-before:page}"+
".ttl{display:flex;justify-content:space-between;align-items:flex-end;border-bottom:2px solid #0F369D;padding-bottom:6px;margin-bottom:8px}.ttl h2{margin:0;color:#0F369D;font-size:22px}"+
".no{font-size:12px;color:#3B4658;text-align:left}.no b{display:block;font-size:17px;color:#F15A22;direction:ltr}.pgno{font-size:11px;color:#8a94a6}"+
".meta{display:grid;grid-template-columns:1fr 1fr 1fr;gap:3px 14px;margin:0 0 10px;padding:8px 10px;background:#f4f6fb;border-radius:8px}.meta span.k{color:#5b6577}"+
"table.t{width:100%;border-collapse:collapse;font-size:12px;margin-bottom:8px}.t th,.t td{border:1px solid #c7d0e6;padding:4px 6px;text-align:center}.t th{background:#0F369D;color:#fff;font-weight:700}.t td.n{text-align:right}.t thead{display:table-header-group}.t td bdi.ltr,.t td.ltr{white-space:nowrap}.t tr{break-inside:avoid}"+
".tot td{font-weight:700;background:#f4f6fb}.sum{display:grid;grid-template-columns:1.3fr 1fr;gap:12px;align-items:start;break-inside:avoid}.box{border:1px solid #c7d0e6;border-radius:8px;padding:6px 10px}.box h4{margin:0 0 4px;color:#0F369D;font-size:13px}"+
".kv{display:flex;justify-content:space-between;gap:10px;padding:2px 0;border-bottom:1px dashed #dde3f0}.kv:last-child{border-bottom:0}.kv.big{font-size:15px;font-weight:700;color:#0F369D}.kv.due{font-weight:700;color:#D0402A}.kv.due.ok{color:#2F7D5C}"+
".ltr{direction:ltr;unicode-bidi:isolate}.sig{display:grid;grid-template-columns:repeat(3,1fr);gap:18px;margin-top:18px;font-size:12.5px;break-inside:avoid}.sig.two{grid-template-columns:repeat(2,1fr)}"+
".sig div{height:92px;padding:6px 8px;display:flex;flex-direction:column;justify-content:space-between;text-align:center;color:#3B4658}.sig div b{color:#0F369D}.sig div i{font-style:normal;font-size:11px;color:#8a94a6;border-top:1px solid #c7d0e6;padding-top:4px}"+
".note{font-size:11px;color:#5b6577;margin-top:8px}.tag{display:inline-block;padding:0 6px;border-radius:9px;font-size:11px;background:#e6f2ec;color:#2F7D5C}.draft{display:inline-block;padding:2px 10px;border-radius:9px;background:#fdeee7;color:#F15A22;font-weight:700}"+
".letter p{margin:6px 0;font-size:13.5px;line-height:1.9}h3.sec{color:#0F369D;font-size:15px;margin:12px 0 6px}";}
function title(text,label,no,pageNo,pages){return '<div class="ttl"><h2>'+esc(text)+'</h2>'+(no!=null&&no!==''?'<div class="no">'+esc(label||'')+'<b>'+esc(no)+'</b>'+(pages>1?'<span class="pgno">صفحة '+pageNo+' / '+pages+'</span>':'')+'</div>':'')+'</div>';}
function meta(pairs){return '<div class="meta">'+pairs.filter(Boolean).map(function(p){return '<div><span class="k">'+esc(p[0])+':</span> '+(p[2]?'<span class="ltr">'+esc(p[1]==null||p[1]===''?'—':p[1])+'</span>':esc(p[1]==null||p[1]===''?'—':p[1]))+'</div>';}).join('')+'</div>';}
function kv(label,value,cls){return '<div class="kv'+(cls?' '+cls:'')+'"><span>'+esc(label)+'</span><span>'+value+'</span></div>';}
function table(head,rows,total){return '<table class="t"><thead><tr>'+head.map(function(h){return '<th>'+esc(h)+'</th>';}).join('')+'</tr></thead><tbody>'+rows.join('')+(total||'')+'</tbody></table>';}
function sig(labels){return '<div class="sig'+(labels.length===2?' two':'')+'">'+labels.map(function(l){return '<div><b>'+esc(l[0])+'</b><i>'+(l[1]?esc(l[1]):'&nbsp;')+'</i></div>';}).join('')+'</div>';}
function page(body){return '<section class="pg"><img class="bg" crossorigin="anonymous" src="'+BASE+'assets/img/swnw-official-letterhead.png" alt=""><div class="bd">'+body+'</div></section>';}
function flow(body){return '<img class="bgf" crossorigin="anonymous" src="'+BASE+'assets/img/swnw-official-letterhead.png" alt=""><table class="flow"><thead><tr><td><div class="sp-top"></div></td></tr></thead><tfoot><tr><td><div class="sp-bot"></div></td></tr></tfoot><tbody><tr><td><div class="fb">'+body+'</div></td></tr></tbody></table>';}
function documentHtml(docTitle,inner){return '<!doctype html><html lang="ar" dir="rtl"><head><meta charset="utf-8"><title>'+esc(docTitle)+'</title><style>'+css()+'</style></head><body>'+inner+'</body></html>';}
function open(html,win){win=win||w.open('','_blank');if(!win)throw Error('المتصفح منع نافذة الطباعة — اسمح بالنوافذ المنبثقة');
 var d=win.document;if(d.open)d.open();d.write(html);if(d.close)d.close();var done=false,go=function(){if(done)return;done=true;try{win.focus();win.print();}catch(e){}};
 var imgs=Array.prototype.slice.call(win.document.images||[]),left=imgs.filter(function(i){return !i.complete;}).length;
 if(!left)setTimeout(go,300);else imgs.forEach(function(i){if(!i.complete)i.onload=i.onerror=function(){if(!--left)setTimeout(go,150);};});setTimeout(go,4000);return win;}
function blank(){var win=w.open('','_blank');if(!win)throw Error('المتصفح منع نافذة الطباعة — اسمح بالنوافذ المنبثقة');win.document.write('<p dir="rtl" style="font-family:Tahoma">جاري تجهيز المستند…</p>');return win;}
/* single-payment receipt (approved mockup docs/ui-references/mockups/payment-receipt.html) */
function receiptHtml(r){var inv=r.invoice||null,rest=inv?Math.max(0,Number(inv.due||0)):null;
 var body=title('إيصال سداد','رقم الإيصال',r.receipt_no||r.reference||'—')+
  meta([['المريض',r.patient_name],['رقم الملف',r.file_no,1],['التاريخ',stamp(r.created_at),1],['على فاتورة',inv&&inv.no,1],['الزيارة',r.visit],['الوردية',r.shift]].concat(r.doctor?[['الطبيب',r.doctor],['التخصص',r.specialty||'—']]:[]))+
  '<div class="sum"><div class="box"><h4>بيانات الدفعة</h4>'+kv('المبلغ المستلم',money(r.amount)+' ج.م','big')+kv('المبلغ بالحروف',esc(words(r.amount)))+kv('طريقة الدفع',esc(METHOD[r.method]||r.method||'—'))+
   (r.method&&r.method!=='cash'?kv('رقم العملية','<span class="ltr">'+esc(r.reference||'—')+'</span>')+kv('صورة إيصال الماكينة / التحويل',r.has_proof?'<span class="tag">مرفقة في النظام</span>':'—'):'')+
   (Number(r.credit_amount)>0?kv('أُضيف إلى رصيد المريض',money(r.credit_amount)):'')+(r.note&&(inv||r.lines)?kv('ملاحظة',esc(r.note)):'')+'</div>'+
  (r.lines&&r.lines.length?'<div class="box"><h4>غطّت هذه الدفعة '+r.lines.length+' زيارات</h4>'+r.lines.map(function(l){var left=Math.max(0,Number(l.due||0));return kv((l.patient||'—')+(l.no?' — '+l.no:''),money(l.applied)+(left>0?' · الباقي '+money(left):' <span class="tag">مسدّدة</span>'));}).join('')+'</div>':
  (inv?'<div class="box"><h4>حساب الفاتورة بعد الدفعة</h4>'+kv('إجمالي الفاتورة',money(inv.total))+kv('المدفوع سابقًا',money(Math.max(0,Number(inv.total)-Number(inv.due||0)-Number(r.applied||0))))+kv('هذه الدفعة',money(r.applied!=null?r.applied:r.amount))+
   '<div class="kv due'+(rest<=0?' ok':'')+'"><span>المتبقي</span><span>'+money(rest)+(rest<=0?' <span class="tag">مسدّدة بالكامل</span>':'')+'</span></div></div>':'<div class="box"><h4>ملاحظة</h4><p>'+esc(r.note||'دفعة على حساب المريض.')+'</p></div>'))+'</div>'+
  sig([['توقيع الموظف',r.cashier],['توقيع المريض','الاسم والتوقيع'],['ختم المركز','']])+
  '<div class="note">هذا إيصال بدفعة واحدة، وتُستخرج الفاتورة الكاملة بجميع الدفعات من «طباعة فاتورة الزيارة». طُبع من لوحة التحكم بتاريخ <span class="ltr">'+esc(day(new Date()))+'</span> الساعة '+esc(time(new Date()))+'.</div>';
 return documentHtml('إيصال '+(r.receipt_no||r.reference||''),page(body));}
w.SSMPDPrint={BASE:BASE,METHOD:METHOD,esc:esc,money:money,day:day,time:time,stamp:stamp,words:words,css:css,title:title,meta:meta,kv:kv,table:table,sig:sig,page:page,flow:flow,documentHtml:documentHtml,open:open,blank:blank,receiptHtml:receiptHtml};
})(typeof window!=='undefined'?window:globalThis);
