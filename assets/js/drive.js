/* SSMPD — رفع ملفات التصميم لأرشيف Google Drive + تسجيل ملفات التتبع (Excel) عبر Apps Script Web App */
(function () {
  "use strict";

  function fileToBase64(file) {
    return new Promise(function (resolve, reject) {
      var reader = new FileReader();
      reader.onload = function () {
        var result = reader.result; // data:...;base64,XXXX
        resolve(result.split(",")[1]);
      };
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });
  }

  // فولدر الرفع على الدرايف — 3 أنواع ثابتة، كل واحد بيتنظم سنة/شهر/يوم تلقائياً
  // جوه Code.gs. لازم يطابق المفاتيح في CATEGORY_FOLDER_IDS هناك بالظبط.
  var CATEGORIES = { CONTENT: "content", DESIGN: "design", ARCHIVE: "archive" };

  function bridgeUrl() {
    var url = window.SSMPD_CONFIG.driveBridge.webAppUrl;
    if (!url || url.indexOf("REPLACE") === 0) return null;
    return url;
  }

  function uploadFile(file, meta, category) {
    var url = bridgeUrl();
    if (!url) {
      return Promise.reject(new Error("جسر Google Drive لسه مش متظبط (config.js)"));
    }
    return fileToBase64(file).then(function (base64) {
      var payload = {
        fileName: file.name,
        mimeType: file.type || "application/octet-stream",
        base64: base64,
        contentTitle: (meta && meta.title) || "",
        contentId: (meta && meta.contentId) || "",
        category: category
      };
      return fetch(url, {
        method: "POST",
        headers: { "Content-Type": "text/plain;charset=utf-8" }, // يتفادى preflight CORS مع Apps Script
        body: JSON.stringify(payload)
      }).then(function (r) { return r.json(); });
    }).then(function (res) {
      if (!res || !res.ok) throw new Error((res && res.error) || "فشل الرفع لجوجل درايف");
      return res; // { ok:true, fileUrl, folderUrl }
    });
  }

  // تسجيل صف في شيت التتبع (إكسيل) داخل فولدر النوع — عملية خلفية غير حرجة:
  // لو الجسر لسه مش متظبط أو حصل أي خطأ شبكة، بنتجاهله بهدوء بدون ما نزعج المستخدم،
  // لأنه مجرد سجل مساعد ومش جزء من سير العمل الأساسي.
  function logEvent(category, logType, data) {
    var url = bridgeUrl();
    if (!url) return Promise.resolve({ ok: false, skipped: true });
    var payload = Object.assign({ action: "log", category: category, logType: logType }, data);
    return fetch(url, {
      method: "POST",
      headers: { "Content-Type": "text/plain;charset=utf-8" },
      body: JSON.stringify(payload)
    }).then(function (r) { return r.json(); }).catch(function () { return { ok: false }; });
  }

  var Drive = {
    CATEGORIES: CATEGORIES,
    // يرفع ملف تصميم واحد → فولدر "التصميمات"
    uploadDesignFile: function (file, meta) {
      return uploadFile(file, meta, CATEGORIES.DESIGN);
    },
    // يرفع ملف إنتاج محتوى (مرجعي/خام) → فولدر "إنتاج المحتوى"
    uploadContentFile: function (file, meta) {
      return uploadFile(file, meta, CATEGORIES.CONTENT);
    },
    // يرفع تقرير/تحليل → فولدر "الأرشيف"
    uploadArchiveFile: function (file, meta) {
      return uploadFile(file, meta, CATEGORIES.ARCHIVE);
    },

    // ---------- تسجيل تلقائي في ملفات إكسيل التتبع (e/f/g) ----------
    // عند إنشاء فكرة/محتوى جديد → صف في شيت "تتبع - إنتاج المحتوى"
    logIdea: function (contentId, title) {
      return logEvent(CATEGORIES.CONTENT, "idea", { contentId: contentId, title: title });
    },
    // عند الاعتماد الأولي وإسناد مصمم (المادة بتتحول لـ in_design)
    logDesignSent: function (contentId, title) {
      return Promise.all([
        logEvent(CATEGORIES.CONTENT, "approved", { contentId: contentId, title: title }),
        logEvent(CATEGORIES.DESIGN, "design_sent", { contentId: contentId, title: title })
      ]);
    },
    // عند رفع ملف التصميم (المادة بتتحول لـ final_approval)
    logDesignUploaded: function (contentId, title) {
      return Promise.all([
        logEvent(CATEGORIES.CONTENT, "designed", { contentId: contentId, title: title }),
        logEvent(CATEGORIES.DESIGN, "design_uploaded", { contentId: contentId, title: title })
      ]);
    },
    // عند النشر — بيسجل في الثلاث شيتات، وبيبعت stageHistory عشان الأرشيف يحسب مدة كل مرحلة
    logPublished: function (contentId, title, link, stageHistory) {
      return Promise.all([
        logEvent(CATEGORIES.CONTENT, "published", { contentId: contentId, title: title, link: link }),
        logEvent(CATEGORIES.DESIGN, "published", { contentId: contentId, title: title, link: link }),
        logEvent(CATEGORIES.ARCHIVE, "published", { contentId: contentId, title: title, link: link, stageHistory: stageHistory })
      ]);
    }
  };

  window.SSMPDDrive = Drive;
})();
