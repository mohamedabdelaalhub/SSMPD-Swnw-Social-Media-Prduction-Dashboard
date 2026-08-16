/* ===========================================================
   SSMPD — إعدادات المشروع
   ⚠️ لا تُعِد كتابة هذا الملف بالكامل بعد إدخال مفاتيح Supabase —
   عدّل سطراً بعينه فقط. الكتابة فوقه بالخطأ توقف الدخول للوحة.
   =========================================================== */
window.SSMPD_CONFIG = {

  centerName: "مركز عيادات Swnw التخصصية — فرع حدائق الأهرام",

  // مفاتيح Supabase — تُملأ بعد إنشاء المشروع (خطوة البنية التحتية)
  supabase: {
    url: "REPLACE_WITH_SUPABASE_URL",
    anonKey: "REPLACE_WITH_SUPABASE_ANON_KEY"
  },

  // جسر أرشيف Google Drive — رابط Web App بعد نشر السكريبت من حساب المركز
  driveBridge: {
    webAppUrl: "REPLACE_AFTER_APPS_SCRIPT_DEPLOY",
    rootFolderName: "أرشيف SSMPD"
  },

  // بصمة الكاش — ترفع مع أي تعديل على JS/CSS
  cacheVersion: 1
};
