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
  adsExpensesWebAppUrl: "https://script.google.com/macros/s/AKfycbzkks4u3SUsQBLtIzN5o091dBANRA7Or1xm5KCBfG8ms1NyOhRAUG6mtZCcz51jlJrM3g/exec",

  // بصمة الكاش — ترفع مع أي تعديل على JS/CSS
  cacheVersion: 34
};

// مراقب أخطاء خفيف: يسجل فقط الأخطاء الفعلية وآخر زر مرتبط بها، بدون أسرار.
(function loadSystemErrorMonitor(){
  if(window.__SWNWSystemErrorMonitor || document.querySelector('script[data-system-error-monitor]')) return;
  var script=document.createElement('script');
  script.src='assets/js/system-error-monitor.js?v=system-errors-20261028-3';
  script.async=false;
  script.dataset.systemErrorMonitor='1';
  document.head.appendChild(script);
})();

// مدخل خفيف وثابت لصفحة تشخيص النظام. لا يشغل أي فحوصات في الخلفية.
(function loadSystemDiagnosticsLauncher(){
  if(window.__SWNWSystemDiagnosticsLauncher || document.querySelector('script[data-system-diagnostics-launcher]')) return;
  var script=document.createElement('script');
  script.src='assets/js/system-diagnostics-launcher.js?v=system-diagnostics-20261028-4';
  script.async=false;
  script.dataset.systemDiagnosticsLauncher='1';
  document.head.appendChild(script);
})();

// حماية مبكرة ضد تقطيع الشبكة: config.js يتحمل قبل auth.js، لذلك نلف SSMPDAuth
// لحظة إنشائه. ده يضمن الـ retry حتى لو المتصفح ماسك نسخة أقدم من auth.js.
(function installAuthNetworkResilience(){
  var stored;
  function networkError(err){
    var m=String(err&&err.message||err||"");
    return /Failed to fetch|NetworkError|Load failed|fetch failed|network request failed/i.test(m);
  }
  function retry(work,left,delay){
    return Promise.resolve().then(work).catch(function(err){
      if(!networkError(err)||left<=1) throw err;
      return new Promise(function(resolve){setTimeout(resolve,delay);})
        .then(function(){return retry(work,left-1,Math.min(Math.round(delay*1.7),1400));});
    });
  }
  function wrap(auth){
    if(!auth||auth.__networkResilienceV1) return auth;
    ["signIn","signUp","getSession","loadCurrentAdmin","resetPasswordForEmail"].forEach(function(name){
      if(typeof auth[name]!=="function") return;
      var original=auth[name];
      auth[name]=function(){
        var self=this,args=arguments;
        return retry(function(){return original.apply(self,args);},2,450);
      };
    });
    auth.__networkResilienceV1=true;
    return auth;
  }
  try{
    Object.defineProperty(window,"SSMPDAuth",{
      configurable:true,
      get:function(){return stored;},
      set:function(value){
        stored=wrap(value);
        Object.defineProperty(window,"SSMPDAuth",{value:stored,writable:true,configurable:true});
      }
    });
  }catch(e){}
})();

// الموديولات الإضافية لا نحمّلها على شاشة الدخول. ننتظر نجاح الدخول أولًا،
// وده يقلل طلبات الشبكة والـ observers وقت فتح الصفحة على الكمبيوتر والموبايل.
(function(){
  function afterAdminReady(fn){
    function check(){
      if(window.SSMPDAuth&&window.SSMPDAuth.currentAdmin){ fn(); return; }
      setTimeout(check,1500);
    }
    if(document.readyState==="complete") check();
    else window.addEventListener("load",check,{once:true});
  }
  function loadOnce(flag,src,dataKey){
    if(window[flag]||document.querySelector('script[data-post-login="'+dataKey+'"]')) return;
    var script=document.createElement("script");
    script.src=src; script.async=false; script.dataset.postLogin=dataKey;
    document.head.appendChild(script);
  }

  afterAdminReady(function(){
    loadOnce("__SSMPDHomeWelcomeRedesign","assets/js/home-welcome-redesign.js?v=home-welcome-20261025-2","home-welcome");
    loadOnce("__SSMPDPerformanceV2","assets/js/employee-performance.js?v=performance-v2-20261025-3","performance-v2");
    loadOnce("__SSMPDInsuranceContractsV1","assets/js/insurance-contracts.js?v=insurance-20261026-1","insurance");
    loadOnce("__SWNWTaskStageNavigation","assets/js/task-stage-navigation.js?v=task-stage-nav-20261027-2","task-stage-navigation");
    loadOnce("__SWNWLeadsArchiveGrantRuntimeV3","assets/js/leads-archive-permission-column.js?v=leads-archive-permission-20261028-1","leads-archive-permission");
    loadOnce("__SWNWLeadsMissingDataEnhancement","assets/js/leads-missing-data-enhancement.js?v=leads-missing-data-20261028-2","leads-missing-data");
    loadOnce("__SWNWContractServiceMapping","assets/js/contract-service-mapping.js?v=contract-service-mapping-20261028-1","contract-service-mapping");
  });
})();