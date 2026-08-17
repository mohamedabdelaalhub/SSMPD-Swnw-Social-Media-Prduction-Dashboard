/* SSMPD — رسالة تنبيه بسيطة (toast) مش بلوكينج، بديل عن alert()/confirm() المتصفح.
   السبب: alert()/confirm() ممكن تتجاهل أو تتمنع في بعض المتصفحات المدمجة جوه تطبيقات
   الموبايل (زي فتح اللينك من واتساب/ماسنجر) — فالمستخدم كان بياخد إحساس إن الزرار ماعملش
   حاجة أصلاً مع إنه فعلياً كان بيستنى تأكيد ما وصلوش له. الـ toast ده عنصر عادي في الصفحة
   وهيظهر دايماً بغض النظر عن نوع المتصفح. */
(function () {
  "use strict";

  function show(message, type) {
    var existing = document.querySelectorAll(".toast");
    existing.forEach(function (t) { t.remove(); });

    var el = document.createElement("div");
    el.className = "toast" + (type === "error" ? " toast-error" : "");
    el.textContent = message;
    document.body.appendChild(el);
    setTimeout(function () {
      if (el.parentNode) el.parentNode.removeChild(el);
    }, 3800);
  }

  window.SSMPDToast = { show: show };
})();
