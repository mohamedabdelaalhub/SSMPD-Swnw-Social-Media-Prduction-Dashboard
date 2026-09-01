/* ===========================================================
   جسر مصروفات الإعلانات الفعلية — SWNW Ads Expenses Bridge
   مشروع Apps Script منفصل تماماً عن Code.gs (جسر أرشيف Drive) —
   Web App مستقل بيرجّع ملخص "الإقفال الشهري" + سجل الحركات التفصيلي
   + بنود "مصروفات أخرى" التفصيلية جاهزين كـJSON.

   ليه موجود: قراءة ملف xlsx على Drive بـ`alt=media` + مفتاح API بس
   (من غير OAuth) كانت بترجع 503 بشكل متكرر مش مضمون. الحل: Apps
   Script يقرا الملف مباشرة بحساب المالك (OAuth) ويرجّع بس الأرقام
   الجاهزة — مفيش تنزيل ملف خام من المتصفح خالص.

   النشر: Deploy → Manage deployments → ✏️ → Version: New version → Deploy
   (بيحافظ على نفس رابط /exec المستخدم في config.js → adsExpensesWebAppUrl)

   إضافة سجل الحركات (٢٠٢٦-٠٩-٠١): بترجّع كمان `transactions` — كل صف من
   شيت "سجل الحركات" (التاريخ/الوقت/النوع/القيمة/كود العملية/البيان/الشهر
   بصيغة yyyy-MM/ملاحظات/المصدر) — بيُستخدم في الداشبورد عشان لما حد يدوس
   على رقم في جدول الإقفال الشهري يشوف الحركات التفصيلية اللي جمّعت الرقم ده.

   إضافة بنود "مصروفات أخرى" التفصيلية (٢٠٢٦-٠٩-٠١): كان عمود "مصروفات أخرى"
   في شيت "الإقفال الشهري" بيرجع رقم إجمالي بس من غير أي تفصيل — مع إن ملف
   الإكسل فعلياً فيه شيت منفصل "اشتراكات ومصروفات أخرى" بيسجّل كل بند لوحده
   (اسم الجهة/الاشتراك، القيمة، البيان). بترجّع دلوقتي `otherExpensesItems` —
   كل صف من الشيت ده (التاريخ/الوقت/الجهة أو الاشتراك/القيمة/كود العملية/
   البيان/الشهر بصيغة yyyy-MM/ملاحظات/المصدر) — عشان تبقى متاحة في مودال
   تفاصيل "مصروفات أخرى" في الداشبورد بدل ملاحظة عامة بدون تفصيل.
   =========================================================== */
function doGet(e) {
  var ss = SpreadsheetApp.openById('1MGDJe3Jn3fRcthqq7-264l5PzsA6c6Nr');
  var sheet = ss.getSheetByName('الإقفال الشهري');
  var data = sheet.getDataRange().getValues();
  var nowStr = Utilities.formatDate(new Date(), 'GMT+2', 'yyyy-MM');
  var monthly = [];
  for (var i = 0; i < data.length; i++) {
    var row = data[i];
    var month = row[0];
    if (!month) continue;
    var monthStr = (month instanceof Date) ? Utilities.formatDate(month, 'GMT+2', 'yyyy-MM') : String(month);
    if (!/^\d{4}-\d{2}$/.test(monthStr)) continue;
    if (monthStr > nowStr) continue;
    monthly.push({ month: monthStr, fbSpend: Number(row[1]) || 0, paid: Number(row[2]) || 0, otherExpenses: Number(row[3]) || 0, closingBalance: Number(row[6]) || 0 });
  }
  var txSheet = ss.getSheetByName('سجل الحركات');
  var txData = txSheet ? txSheet.getDataRange().getValues() : [];
  var transactions = [];
  for (var j = 1; j < txData.length; j++) {
    var t = txData[j];
    if (!t[6]) continue;
    transactions.push({
      date: t[0] instanceof Date ? Utilities.formatDate(t[0], 'GMT+2', 'yyyy-MM-dd') : String(t[0]),
      time: t[1] instanceof Date ? Utilities.formatDate(t[1], 'GMT+2', 'HH:mm') : String(t[1]),
      type: String(t[2] || ''), amount: Number(t[3]) || 0, opCode: String(t[4] || ''),
      description: String(t[5] || ''), month: String(t[6]), notes: String(t[7] || ''), source: String(t[8] || '')
    });
  }
  var oeSheet = ss.getSheetByName('اشتراكات ومصروفات أخرى');
  var oeData = oeSheet ? oeSheet.getDataRange().getValues() : [];
  var otherExpensesItems = [];
  for (var k = 1; k < oeData.length; k++) {
    var o = oeData[k];
    if (!o[6]) continue;
    otherExpensesItems.push({
      date: o[0] instanceof Date ? Utilities.formatDate(o[0], 'GMT+2', 'yyyy-MM-dd') : String(o[0]),
      time: o[1] instanceof Date ? Utilities.formatDate(o[1], 'GMT+2', 'HH:mm') : String(o[1]),
      vendor: String(o[2] || ''), amount: Number(o[3]) || 0, opCode: String(o[4] || ''),
      description: String(o[5] || ''), month: String(o[6]), notes: String(o[7] || ''), source: String(o[8] || '')
    });
  }
  var out = { lastRecordAt: new Date().toISOString(), monthly: monthly, transactions: transactions, otherExpensesItems: otherExpensesItems };
  return ContentService.createTextOutput(JSON.stringify(out)).setMimeType(ContentService.MimeType.JSON);
}
