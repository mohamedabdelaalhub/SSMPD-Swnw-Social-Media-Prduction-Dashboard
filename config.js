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
    webAppUrl: "REPLACE_AFTER_APPS_SCRIPT_DEPLOY",
    rootFolderName: "أرشيف SSMPD"
  },

  // بصمة الكاش — ترفع مع أي تعديل على JS/CSS
  cacheVersion: 1
};
