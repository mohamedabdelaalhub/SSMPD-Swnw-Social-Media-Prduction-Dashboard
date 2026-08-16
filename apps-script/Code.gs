/**
 * SSMPD — جسر أرشيف Google Drive + ملفات التتبع (Excel) التلقائية
 * يُنشر من حساب Google الخاص بالمركز نفسه (مش حساب موظف فردي)
 * حتى يفضل الأرشيف ملك المركز دايماً.
 *
 * طريقة النشر:
 * 1) من حساب المركز على Google، افتح script.google.com → مشروع جديد
 * 2) الصق هذا الكود كامل بدل الكود الافتراضي
 * 3) Deploy → New deployment → Web app
 *    - Execute as: Me (حساب المركز)
 *    - Who has access: Anyone with the link
 * 4) انسخ رابط الـ Web App وحطه في config.js داخل driveBridge.webAppUrl
 *
 * البنية: فولدر جذر واحد على الدرايف (مُشارَك بالفعل) وجواه 3 فولدرات
 * ثابتة بحسب النوع، وكل واحد فيهم بيتكوّن جواه سنة/شهر/يوم تلقائياً:
 *   - إنتاج المحتوى  → category: "content"
 *   - التصميمات      → category: "design"  (الافتراضي)
 *   - الأرشيف (تقارير وتحليلات) → category: "archive"
 *
 * كل فولدر نوع فيه كمان ملف إكسيل تتبّع واحد ثابت (بيتحدّث تلقائياً مع
 * كل حدث من الداشبورد: فكرة جديدة / اعتماد / رفع تصميم / نشر).
 */

var CATEGORY_FOLDER_IDS = {
  content: "1dYiejCkw31-DP6SnWBo4KSOP1oRY3Wzq", // إنتاج المحتوى
  design:  "1E9OsjadaOUGc8asCzscrVHG5OFP_HVaS", // التصميمات
  archive: "1xghscimJG2f8CB2N3I0lC3fHrhZk2aMO"  // الأرشيف
};

var TRACKING_SHEET_NAMES = {
  content: "تتبع - إنتاج المحتوى",
  design:  "تتبع - التصميمات",
  archive: "تقرير الأداء - الأرشيف"
};

var TRACKING_HEADERS = {
  content: ["معرف المادة", "الفكرة", "تاريخ الإضافة", "الموقف الحالي", "لينك النشر"],
  design:  ["معرف المادة", "عنوان التصميم", "تاريخ ووقت الإرسال للتصميم", "تاريخ ووقت رفع التصميم للاعتماد", "تاريخ ووقت النشر", "لينك النشر"],
  archive: ["معرف المادة", "العنوان", "تاريخ الفكرة", "تاريخ الإرسال للتصميم", "تاريخ رفع التصميم", "تاريخ النشر", "لينك النشر",
            "إجمالي رحلة الفكرة للنشر", "وقت مرحلة الاعتماد الأولي", "وقت مرحلة التصميم", "وقت مرحلة الاعتماد النهائي", "وقت مرحلة الجاهزية للنشر"]
};

function doPost(e) {
  try {
    var payload = JSON.parse(e.postData.contents);
    var action = payload.action || "upload";
    if (action === "log") return handleLog_(payload);
    return handleUpload_(payload);
  } catch (err) {
    return jsonOut({ ok: false, error: String(err) });
  }
}

function doGet() {
  return jsonOut({ ok: true, message: "SSMPD Drive Bridge شغّال" });
}

// ---------- رفع ملفات (تصميم / محتوى / أرشيف) ----------
function handleUpload_(payload) {
  var fileName = payload.fileName || ("file-" + new Date().getTime());
  var mimeType = payload.mimeType || "application/octet-stream";
  var base64 = payload.base64;
  var category = payload.category || "design";

  if (!base64) return jsonOut({ ok: false, error: "لا يوجد محتوى ملف" });
  if (!CATEGORY_FOLDER_IDS[category]) return jsonOut({ ok: false, error: "نوع فولدر غير معروف: " + category });

  var dayFolder = getOrCreateTodayFolder_(category);
  var bytes = Utilities.base64Decode(base64);
  var blob = Utilities.newBlob(bytes, mimeType, fileName);
  var file = dayFolder.createFile(blob);
  file.setDescription("SSMPD — " + (payload.contentTitle || "") + " | contentId: " + (payload.contentId || ""));

  return jsonOut({
    ok: true,
    fileUrl: file.getUrl(),
    folderUrl: dayFolder.getUrl(),
    fileId: file.getId()
  });
}

// ---------- تسجيل حدث في ملف التتبع (Excel) المناسب ----------
function handleLog_(payload) {
  var category = payload.category;
  var logType = payload.logType;
  var contentId = payload.contentId;
  if (!CATEGORY_FOLDER_IDS[category]) return jsonOut({ ok: false, error: "نوع فولدر غير معروف: " + category });
  if (!contentId) return jsonOut({ ok: false, error: "لا يوجد معرف مادة" });

  var sheet = getOrCreateTrackingSheet_(category);

  if (category === "content") {
    var statusMap = { idea: "في الاعتماد", approved: "تم الاعتماد", designed: "تم التصميم", published: "تم النشر" };
    upsertTrackingRow_(sheet, TRACKING_HEADERS.content, contentId, {
      "معرف المادة": contentId,
      "الفكرة": payload.title || "",
      "تاريخ الإضافة": logType === "idea" ? nowStr_() : undefined,
      "الموقف الحالي": statusMap[logType] || "",
      "لينك النشر": payload.link || undefined
    });
  } else if (category === "design") {
    var patch = { "معرف المادة": contentId, "عنوان التصميم": payload.title || "" };
    if (logType === "design_sent") patch["تاريخ ووقت الإرسال للتصميم"] = nowStr_();
    if (logType === "design_uploaded") patch["تاريخ ووقت رفع التصميم للاعتماد"] = nowStr_();
    if (logType === "published") { patch["تاريخ ووقت النشر"] = nowStr_(); patch["لينك النشر"] = payload.link || ""; }
    upsertTrackingRow_(sheet, TRACKING_HEADERS.design, contentId, patch);
  } else if (category === "archive" && logType === "published") {
    var hist = payload.stageHistory || [];
    var durations = computeDurations_(hist);
    upsertTrackingRow_(sheet, TRACKING_HEADERS.archive, contentId, {
      "معرف المادة": contentId,
      "العنوان": payload.title || "",
      "تاريخ الفكرة": findStageAt_(hist, "idea_selection"),
      "تاريخ الإرسال للتصميم": findStageAt_(hist, "in_design"),
      "تاريخ رفع التصميم": findStageAt_(hist, "final_approval"),
      "تاريخ النشر": nowStr_(),
      "لينك النشر": payload.link || "",
      "إجمالي رحلة الفكرة للنشر": durations.total || "",
      "وقت مرحلة الاعتماد الأولي": durations["initial_approval"] || "",
      "وقت مرحلة التصميم": durations["in_design"] || "",
      "وقت مرحلة الاعتماد النهائي": durations["final_approval"] || "",
      "وقت مرحلة الجاهزية للنشر": durations["ready_to_publish"] || ""
    });
  }
  return jsonOut({ ok: true });
}

function nowStr_() {
  return Utilities.formatDate(new Date(), Session.getScriptTimeZone(), "yyyy-MM-dd HH:mm");
}

function findStageAt_(hist, stageKey) {
  for (var i = 0; i < hist.length; i++) if (hist[i].stage === stageKey) return hist[i].at;
  return "";
}

// يحسب مدة كل مرحلة (الفرق بين وقت الدخول فيها ووقت الانتقال اللي بعدها) + إجمالي الرحلة من أول خطوة لآخر خطوة
function computeDurations_(hist) {
  var out = {};
  if (!hist || !hist.length) return out;
  for (var i = 0; i < hist.length - 1; i++) {
    var stage = hist[i].stage;
    var ms = new Date(hist[i + 1].at) - new Date(hist[i].at);
    out[stage] = fmtDuration_(ms);
  }
  var totalMs = new Date(hist[hist.length - 1].at) - new Date(hist[0].at);
  out.total = fmtDuration_(totalMs);
  return out;
}

function fmtDuration_(ms) {
  if (ms < 0) ms = 0;
  var totalMin = Math.round(ms / 60000);
  var days = Math.floor(totalMin / 1440);
  var hours = Math.floor((totalMin % 1440) / 60);
  var mins = totalMin % 60;
  var parts = [];
  if (days) parts.push(days + "ي");
  if (hours) parts.push(hours + "س");
  if (mins || !parts.length) parts.push(mins + "د");
  return parts.join(" ");
}

/** يجيب فولدر اليوم داخل فولدر النوع (سنة/شهر/يوم)، وينشئه لو مش موجود */
function getOrCreateTodayFolder_(category) {
  var categoryRoot = DriveApp.getFolderById(CATEGORY_FOLDER_IDS[category]);
  var now = new Date();
  var year = Utilities.formatDate(now, Session.getScriptTimeZone(), "yyyy");
  var month = Utilities.formatDate(now, Session.getScriptTimeZone(), "MM - MMMM");
  var day = Utilities.formatDate(now, Session.getScriptTimeZone(), "dd");

  var yearFolder = getOrCreateFolder_(categoryRoot, year);
  var monthFolder = getOrCreateFolder_(yearFolder, month);
  var dayFolder = getOrCreateFolder_(monthFolder, day);
  return dayFolder;
}

function getOrCreateFolder_(parent, name) {
  var it = parent.getFoldersByName(name);
  if (it.hasNext()) return it.next();
  return parent.createFolder(name);
}

/** يجيب شيت التتبع الثابت جوه فولدر النوع (مباشرة، مش جوه سنة/شهر/يوم)، وينشئه أول مرة بعناوينه */
function getOrCreateTrackingSheet_(category) {
  var root = DriveApp.getFolderById(CATEGORY_FOLDER_IDS[category]);
  var name = TRACKING_SHEET_NAMES[category];
  var files = root.getFilesByName(name);
  var ss;
  if (files.hasNext()) {
    ss = SpreadsheetApp.open(files.next());
  } else {
    ss = SpreadsheetApp.create(name);
    var file = DriveApp.getFileById(ss.getId());
    root.addFile(file);
    try { DriveApp.getRootFolder().removeFile(file); } catch (e) { /* لو مش جوه My Drive الأساسي أصلاً، تجاهل */ }
    var sheet0 = ss.getSheets()[0];
    sheet0.getRange(1, 1, 1, TRACKING_HEADERS[category].length).setValues([TRACKING_HEADERS[category]]);
    sheet0.setFrozenRows(1);
  }
  return ss.getSheets()[0];
}

/** يحدّث صف موجود (بحسب عمود "معرف المادة") أو يضيف صف جديد لو مش موجود */
function upsertTrackingRow_(sheet, headers, keyVal, dataObj) {
  var lastRow = sheet.getLastRow();
  var rowIdx = -1;
  if (lastRow > 1) {
    var ids = sheet.getRange(2, 1, lastRow - 1, 1).getValues();
    for (var i = 0; i < ids.length; i++) {
      if (ids[i][0] === keyVal) { rowIdx = i + 2; break; }
    }
  }
  if (rowIdx === -1) {
    rowIdx = lastRow + 1;
  }
  headers.forEach(function (h, idx) {
    if (idx === 0) {
      sheet.getRange(rowIdx, 1).setValue(keyVal);
      return;
    }
    if (Object.prototype.hasOwnProperty.call(dataObj, h) && dataObj[h] !== undefined && dataObj[h] !== "") {
      sheet.getRange(rowIdx, idx + 1).setValue(dataObj[h]);
    }
  });
}

function jsonOut(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}
