/* ===========================================================
   SSMPD — إعدادات المشروع
   ⚠️ لا تُعِد كتابة هذا الملف بالكامل بعد إدخال مفاتيح Supabase —
   عدّل سطراً بعينه فقط. الكتابة فوقه بالخطأ توقف الدخول للوحة.
   =========================================================== */
window.SSMPD_CONFIG = {

  centerName: "مركز عيادات Swnw التخصصية — فرع حدائق الأهرام",

  // مفاتيح Supabase — تُملأ بعد إنشاء المشروع (خطوة البنية التحتية)
  supabase: {
    url: "https://uuijfbpgvtdxgaosqpxo.supabase.co",
    anonKey: "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InV1aWpmYnBndnRkeGdhb3NxcHhvIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODY5MDc3MDUsImV4cCI6MjEwMjQ4MzcwNX0.kIiSfXRG2SJtsP1v3GlllIhcxYP9sOEhdGk40tOhsNw"
  },

  // جسر أرشيف Google Drive — رابط Web App بعد نشر السكريبت من حساب المركز
  driveBridge: {
    webAppUrl: "https://script.google.com/macros/s/AKfycbyTg8uqckj3ttdCS5rV32jzAjpdtTt74XKYaxNZH1tSQ3ESqR63dASUvsjbU0T_BFBl/exec",
    rootFolderName: "أرشيف SSMPD"
  },

  // مصروفات الإعلانات الفعلية — Apps Script Web App (OAuth، حساب المركز)
  // بيرجّع ملخص شهري جاهز كـJSON مباشرة (مفيش قراءة Drive API بمفتاح من
  // المتصفح تاني — كانت بتفشل بـ503 على alt=media). راجع render-summary.js → loadAdsExpenses
  adsExpensesWebAppUrl: "https://script.google.com/macros/s/AKfycbzkks4u3SUsQBLtIzN5o091dBANRA7Or1xm5KCBfG8ms1NyOhRAUG6mtZCcz51jlJrM3g/exec",

  // بصمة الكاش — ترفع مع أي تعديل على JS/CSS
  cacheVersion: 14
};
