/* SSMPD — رفع ملفات التصميم لأرشيف Google Drive عبر Apps Script Web App */
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

  var Drive = {
    // يرفع ملف تصميم واحد. الباك إند (Apps Script) هو اللي يقرر فولدر سنة/شهر/يوم.
    uploadDesignFile: function (file, meta) {
      var url = window.SSMPD_CONFIG.driveBridge.webAppUrl;
      if (!url || url.indexOf("REPLACE") === 0) {
        return Promise.reject(new Error("جسر Google Drive لسه مش متظبط (config.js)"));
      }
      return fileToBase64(file).then(function (base64) {
        var payload = {
          fileName: file.name,
          mimeType: file.type || "application/octet-stream",
          base64: base64,
          contentTitle: meta.title || "",
          contentId: meta.contentId || ""
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
  };

  window.SSMPDDrive = Drive;
})();
