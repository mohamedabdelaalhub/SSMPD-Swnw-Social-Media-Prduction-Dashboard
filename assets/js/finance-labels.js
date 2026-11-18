/* Arabic names for the technical codes the finance server returns (statuses, entry sources, methods).
   Owner 2026-11-18: no English word may appear in the accounting screens. Unknown codes are never invented:
   label() returns a neutral Arabic word and keeps the code in the tooltip for the accountant. */
(function(){
'use strict';
var L={
 // statuses
 open:'مفتوحة',submitted:'للمراجعة',reviewed:'تمت المراجعة',closed:'مقفولة',pending:'قيد المراجعة',approved:'معتمد',rejected:'مرفوض',cancelled:'ملغي',canceled:'ملغي',
 received:'تم الاستلام',confirmed:'مؤكد',scheduled:'محجوز',arrived:'وصل',completed:'تم',done:'تم',no_show:'ماحضرش',draft:'مسودة',posted:'مرحّل',reversed:'معكوس',voided:'ملغاة',void:'إلغاء خدمة غير محصلة',
 active:'نشط',inactive:'موقوف',ended:'منتهي',expired:'منتهي',paid:'مدفوع',unpaid:'غير مدفوع',partial:'مدفوع جزئيًا',overdue:'متأخر',sent:'اتبعتت',failed:'ماتبعتتش',queued:'في الانتظار',delivery_unknown:'مش معروف وصلت ولا لأ',
 collected:'عند التحصيل',performed:'عند تنفيذ الخدمة',matched:'متطابق',unmatched:'غير متطابق',
 // methods
 cash:'نقدي',pos:'فيزا / بطاقة',card:'فيزا / بطاقة',instapay:'إنستا باي',bank:'بنك',wallet:'محفظة',insurance:'تأمين',
 // request kinds
 refund:'استرداد خدمة',expense:'نثريات',fund:'تمويل من البنك',deposit:'توريد للبنك',opening:'رصيد افتتاحي',
 // journal entry sources
 payment:'تحصيل',collection:'تحصيل',invoice:'فاتورة خدمة',invoice_external:'فاتورة لجهة',manual:'قيد يدوي',manual_correction:'تصحيح يدوي',manual_reversal:'قيد عكسي',manual_opening:'رصيد افتتاحي',
 doctor_accrual:'استحقاق أتعاب طبيب',doctor_payment:'صرف أتعاب طبيب',doctor_withholding:'خصم من أتعاب طبيب',
 insurance_claim:'مطالبة تأمين',insurance_payment:'سداد من جهة تأمين',insurance_collection:'تحصيل من جهة تأمين',insurance_allowance_release:'رد مخصص تأمين',insurance_credit_loss:'خسارة مطالبة تأمين',insurance_contractual:'خصم تعاقدي للتأمين',
 supplier_payment:'سداد لمورد',supplier_refund:'استرداد من مورد',supplier_return_credit:'مرتجع لمورد',supplier_return_variance:'فرق مرتجع مورد',
 stock_revenue:'بيع مستلزمات',stock_cost:'تكلفة مستلزمات',patient_stock_return:'مرتجع مستلزمات من مريض',inventory_purchase:'شراء مخزون',inventory_usage:'صرف مخزون للاستخدام',inventory_waste:'هالك مخزون',inventory_count:'تسوية جرد',
 pos_net:'تسوية فيزا',pos_fee:'عمولة فيزا',payroll_gross:'استحقاق مرتبات',payroll_attendance_deduction:'خصم حضور من المرتب',tax_assessment:'ربط ضريبي',depreciation:'إهلاك',
 legacy_asset_cost:'أصل قديم — التكلفة',legacy_asset_accumulated:'أصل قديم — مجمع الإهلاك',cash_voucher:'سند صرف',cash_voucher_withholding:'خصم من سند صرف',
 advance_receipt:'مقدم حجز',advance_allocation:'استخدام مقدم على فاتورة',advance_refund:'رد مقدم حجز',treasury_transfer_in:'تحويل وارد للخزينة',treasury_transfer_out:'تحويل صادر من الخزينة',
 claim_correction:'تصحيح مطالبة',method_fix:'تصحيح طريقة الدفع',staff:'موظف',system:'تلقائي من النظام',auto:'تلقائي',reception_services:'خدمات الاستقبال',shift_close:'إقفال وردية',handover:'تسليم نقدية'
};
var PREFIX=[['reception_','الاستقبال'],['payroll_','المرتبات'],['business_','عمليات الإدارة'],['manual_','قيد يدوي'],['treasury_','الخزينة'],['insurance_','التأمين'],['doctor_','الأطباء'],['supplier_','الموردين'],['inventory_','المخزن']];
function known(code){return Object.prototype.hasOwnProperty.call(L,code);}
function label(code){var c=String(code==null?'':code).trim();if(!c)return '';if(known(c))return L[c];var k=c.toLowerCase();if(known(k))return L[k];
 if(/^[a-z][a-z0-9_]*$/.test(k)){for(var i=0;i<PREFIX.length;i++)if(k.indexOf(PREFIX[i][0])===0)return PREFIX[i][1];return 'حركة أخرى';}
 return c;}
/* a cell or line that is *only* a technical code becomes Arabic (code kept in the tooltip) */
function translate(root){if(!root||!root.querySelectorAll)return;root.querySelectorAll('td,.fc-code').forEach(function(td){if(td.children.length||td.hasAttribute('data-fl'))return;var t=td.textContent.trim();if(!known(t))return;var a=label(t);if(a&&a!==t){td.textContent=a;td.title=t;td.setAttribute('data-fl','');}});}
/* one date format everywhere (owner 2026-11-18): «18 نوفمبر 2026», with time «18 نوفمبر 2026 · 9:05 ص» — Cairo time, Latin digits */
var MONTHS=['يناير','فبراير','مارس','أبريل','مايو','يونيو','يوليو','أغسطس','سبتمبر','أكتوبر','نوفمبر','ديسمبر'];
function fmtDate(v){if(!v)return '—';var m=/^(\d{4})-(\d{2})-(\d{2})$/.exec(String(v).slice(0,10));if(m&&String(v).length===10)return Number(m[3])+' '+MONTHS[Number(m[2])-1]+' '+m[1];var d=new Date(v);if(isNaN(d))return String(v);var p=parts(d);return Number(p.day)+' '+MONTHS[Number(p.month)-1]+' '+p.year;}
function parts(d){var o={};new Intl.DateTimeFormat('en-GB',{timeZone:'Africa/Cairo',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hour12:false}).formatToParts(d).forEach(function(x){o[x.type]=x.value;});return o;}
function fmtStamp(v){if(!v)return '—';var d=new Date(v);if(isNaN(d))return String(v);var p=parts(d),h=Number(p.hour)%24,ap=h<12?'ص':'م',h12=h%12||12;return Number(p.day)+' '+MONTHS[Number(p.month)-1]+' '+p.year+' · '+h12+':'+p.minute+' '+ap;}
var NUM=/^[-+\u2212]?[\d,]+(\.\d+)?$/,ISO=/^\d{4}-\d{2}-\d{2}$/;
/* numbers keep their sign on the left in RTL (no «20.00-»), ISO dates read as Arabic dates */
function tidy(root){if(!root||!root.querySelectorAll)return;root.querySelectorAll('td,.fc-num').forEach(function(td){if(td.children.length||td.hasAttribute('data-ff'))return;var t=td.textContent.trim();if(NUM.test(t)){td.setAttribute('data-ff','');td.innerHTML='<span class="acs-num" dir="ltr">'+t.replace(/^-/,'\u2212')+'</span>';}else if(ISO.test(t)){td.setAttribute('data-ff','');td.textContent=fmtDate(t);td.title=t;}});}
window.SSMPDFinanceLabels={label:label,known:known,translate:function(r){translate(r);tidy(r);},map:L,fmtDate:fmtDate,fmtStamp:fmtStamp,tidy:tidy};
})();
