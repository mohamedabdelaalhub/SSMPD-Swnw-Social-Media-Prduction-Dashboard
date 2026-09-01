/* ===========================================================
   جسر مصروفات الإعلانات الفعلية — SWNW Ads Expenses Bridge
   مشروع Apps Script منفصل تماماً عن Code.gs (جسر أرشيف Drive) —
   Web App مستقل بيرجّع ملخص "الإقفال الشهري" جاهز كـJSON.

   ليه موجود: قراءة ملف xlsx على Drive بـ`alt=media` + مفتاح API بس
   (من غير OAuth) كانت بترجع 503 بشكل متكرر مش مضمون. الحل: Apps
   Script يقرا الملف مباشرة بحساب المالك (OAuth) ويرجّع بس الأرقام
   الجاهزة — مفيش تنزيل ملف خام من المتصفح خالص.

   النشر: Deploy → New deployment → Web app →
     Execute as: Me (مالك المشروع) → Who has access: Anyone
   الرابط الناتج يتحط في config.js → adsExpensesWebAppUrl
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
  var out = { lastRecordAt: new Date().toISOString(), monthly: monthly };
  return ContentService.createTextOutput(JSON.stringify(out)).setMimeType(ContentService.MimeType.JSON);
}
