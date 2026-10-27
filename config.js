/* ===========================================================
   SSMPD — إعدادات المشروع
   ⚠️ لا تُعِد كتابة هذا الملف بالكامل بعد إدخال مفاتيح Supabase —
   عدّل سطراً بعينه فقط. الكتابة فوقه بالخطأ توقف الدخول للوحة.
   =========================================================== */
window.SSMPD_CONFIG = {

  updateNoticeTrial: true,

  centerName: "مركز عيادات Swnw التخصصية — فرع حدائق الأهرام",

  // مفاتيح Supabase — تُملأ بعد إنشاء المشروع (خطوة البنية التحتية)
  supabase: {
    url: "https://uuijfbpgvtdxgaosqpxo.supabase.co",
    anonKey: "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InV1aWpmYnBndnRkeGdhb3NxcHhvIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODY5MDc3MDUsImV4cCI6MjEwMjQ4MzcwNX0.kIiSfXRG2SJtsP1v3GlllIhcxYP9sOEhdGk40tOhsNw"
  },

  // جسر أرشيف Google Drive — رابط Web App بعد نشر السكريبت من حساب المركز
  driveBridge: {
    webAppUrl: "https://script.google.com/macros/s/AKfycbzEs73BE101-gIlSx_qwdF625nSalQ2i6mob7mGqH3oN4x40NlZoowjNta3KtKaXYjTYA/exec",
    rootFolderName: "أرشيف SSMPD"
  },

  // مصروفات الإعلانات الفعلية — Apps Script Web App (OAuth، حساب المركز)
  // بيرجّع ملخص شهري جاهز كـJSON مباشرة (مفيش قراءة Drive API بمفتاح من
  // المتصفح تاني — كانت بتفشل بـ503 على alt=media). راجع render-summary.js → loadAdsExpenses
  adsExpensesWebAppUrl: "https://script.google.com/macros/s/AKfycbzkks4u3SUsQBLtIzN5o091dBANRA7Or1xm5KCBfG8ms1NyOhRAUG6mtZCcz51jlJrM3g/exec",

  // بصمة الكاش — ترفع مع أي تعديل على JS/CSS
  cacheVersion: 21
};

// تحسين بطاقة الترحيب في الرئيسية الشخصية بدون المساس بمنطق الصفحة الأساسي.
(function(){
  if(document.querySelector('script[data-home-welcome-redesign]')) return;
  var script = document.createElement('script');
  script.src = 'assets/js/home-welcome-redesign.js?v=home-welcome-20261025-2';
  script.async = false;
  script.dataset.homeWelcomeRedesign = '1';
  document.head.appendChild(script);
})();

// حمّل آخر نسخة من تقييم الأداء بعد اكتمال سكربتات الصفحة؛ الحارس داخل الملف يمنع التكرار.
(function(){
  function loadPerformanceV2(){
    if(window.__SSMPDPerformanceV2) return;
    var script = document.createElement('script');
    script.src = 'assets/js/employee-performance.js?v=performance-v2-20261025-3';
    script.async = false;
    script.dataset.employeePerformanceV2 = '1';
    document.head.appendChild(script);
  }
  if(document.readyState === 'complete') loadPerformanceV2();
  else window.addEventListener('load', loadPerformanceV2, { once: true });
})();

// إدارة التأمين: فئات الكارنيه، التحمل، المطالبات والتحصيل.
(function(){
  function loadInsurance(){
    if(window.__SSMPDInsuranceContractsV1) return;
    var script = document.createElement('script');
    script.src = 'assets/js/insurance-contracts.js?v=insurance-20261026-1';
    script.async = false;
    script.dataset.insuranceContracts = '1';
    document.head.appendChild(script);
  }
  if(document.readyState === 'complete') loadInsurance();
  else window.addEventListener('load', loadInsurance, { once: true });
})();

// تنقل ذكي بين مراحل المهمة: يحتفظ بسياق المهمة الرئيسية على الموبايل والديسكتوب.
(function(){
  function loadTaskStageNavigation(){
    if(window.__SWNWTaskStageNavigation) return;
    var script = document.createElement('script');
    script.src = 'assets/js/task-stage-navigation.js?v=task-stage-nav-20261027-2';
    script.async = false;
    script.dataset.taskStageNavigation = '1';
    document.head.appendChild(script);
  }
  if(document.readyState === 'complete') loadTaskStageNavigation();
  else window.addEventListener('load', loadTaskStageNavigation, { once: true });
})();

// وصول مستقل للقراءة إلى أرشيف الليدز + تحكم السوبر أدمن في منح الصلاحية.
(function(){
  function loadLeadsArchiveAccess(){
    if(window.__SWNWLeadsArchiveAccess) return;
    var script = document.createElement('script');
    script.src = 'assets/js/leads-archive-access.js?v=leads-archive-access-20261027-1';
    script.async = false;
    script.dataset.leadsArchiveAccess = '1';
    document.head.appendChild(script);
  }
  if(document.readyState === 'complete') loadLeadsArchiveAccess();
  else window.addEventListener('load', loadLeadsArchiveAccess, { once: true });
})();
