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
 *
 * ⚠️ فولدرين إضافيين — أرشيف المرضى وفواتير الليدز — بيُستخدموا بس من
 * Edge Functions على السيرفر (مش من الفرونت‌إند مباشرة زي التلاتة فوق)،
 * عشان نتجنّب مشكلة "Service Account مفيش عنده مساحة تخزين" (الحل موثّق
 * في CLAUDE.md). الفولدرين دول **مقفولين** (Restricted، مش "Anyone with
 * the link")، وبيوصلهم غير التوثيق/الصلاحية بتاعت الـ Edge Function نفسها:
 *   - أرشيف المرضى (فولدر مريض/فئة متداخل) → category: "patient_archive"
 *   - فواتير حجوزات الليدز (فولدر واحد مسطّح) → category: "leads_invoice"
 *   - عقود الجهات → داخل فولدر الأرشيف، فولدر مستقل لكل جهة
 *   - منشورات مؤرشفة (بعد النشر بيومين) → داخل فولدر الأرشيف: منشورات مؤرشفة/<سنة-شهر>/<مادة> (action: "content_archive")
 *   - مرفقات المهام → داخل فولدر الأرشيف: مرفقات المهام/<سنة-شهر> (category: "task_attachment")
 */

var CATEGORY_FOLDER_IDS = {
  content: "1dYiejCkw31-DP6SnWBo4KSOP1oRY3Wzq", // إنتاج المحتوى
  design:  "1E9OsjadaOUGc8asCzscrVHG5OFP_HVaS", // التصميمات
  archive: "1xghscimJG2f8CB2N3I0lC3fHrhZk2aMO", // الأرشيف
  patient_archive: "1T7DkhF0aIpJ2Qix0ahukcAe1RAEFSp5Y", // أرشيف المرضى (مقفول)
  leads_invoice:   "1SIILJdTq4p4ZOcfiIwGhKMdXoNkIDdCP"  // فواتير حجوزات الليدز (مقفول)
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
    if (action === "video_archive") return handleVideoArchive_(payload);
    if (action === "content_archive") return handleContentArchive_(payload);
    if (action === "material_library") return handleMaterialLibrary_(payload);
    if (action === "log") return handleLog_(payload);
    return handleUpload_(payload);
  } catch (err) {
    return jsonOut({ ok: false, error: String(err) });
  }
}

function doGet() {
  return jsonOut({ ok: true, message: "SSMPD Drive Bridge شغّال" });
}

// ---------- رفع ملفات (تصميم / محتوى / أرشيف / أرشيف مرضى / فواتير ليدز) ----------
function handleUpload_(payload) {
  var category = payload.category || "design";
  if (category === "contracting_entity_contract") return handleContractingEntityContractUpload_(payload);
  if (category === "task_attachment") return handleTaskAttachmentUpload_(payload);
  if (!CATEGORY_FOLDER_IDS[category]) return jsonOut({ ok: false, error: "نوع فولدر غير معروف: " + category });
  if (!payload.base64) return jsonOut({ ok: false, error: "لا يوجد محتوى ملف" });

  if (category === "patient_archive") return handlePatientArchiveUpload_(payload);
  if (category === "leads_invoice") return handleLeadsInvoiceUpload_(payload);

  var fileName = payload.fileName || ("file-" + new Date().getTime());
  var mimeType = payload.mimeType || "application/octet-stream";
  var base64 = payload.base64;

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

// أرشيف المرضى: Patient_<code>/<فئة المستند> — نفس تسمية الفولدرات اللي
// كانت شغالة قبل كده بالـ Service Account (ID_Documents/Insurance/...)
// عشان الملفات القديمة والجديدة تفضل منظّمة في نفس المكان
function handlePatientArchiveUpload_(payload) {
  var patientCode = payload.patientCode;
  var docFolderName = payload.docFolderName;
  if (!patientCode) return jsonOut({ ok: false, error: "لا يوجد كود مريض" });
  if (!docFolderName) return jsonOut({ ok: false, error: "لا يوجد تصنيف مستند" });

  var root = DriveApp.getFolderById(CATEGORY_FOLDER_IDS.patient_archive);
  var patientFolder = getOrCreateFolder_(root, "Patient_" + patientCode);
  var categoryFolder = getOrCreateFolder_(patientFolder, docFolderName);

  var fileName = payload.fileName || ("file-" + new Date().getTime());
  var mimeType = payload.mimeType || "application/octet-stream";
  var bytes = Utilities.base64Decode(payload.base64);
  var blob = Utilities.newBlob(bytes, mimeType, fileName);
  var file = categoryFolder.createFile(blob);

  return jsonOut({ ok: true, fileUrl: file.getUrl(), folderUrl: categoryFolder.getUrl(), fileId: file.getId() });
}

// فواتير حجوزات الليدز: فولدر واحد مسطّح (بدون سنة/شهر/يوم) — العدد المتوقع
// صغير، والفلترة الفعلية بتتم من جدول lead_invoices في القاعدة مش من الدرايف
function handleLeadsInvoiceUpload_(payload) {
  var root = DriveApp.getFolderById(CATEGORY_FOLDER_IDS.leads_invoice);
  var fileName = payload.fileName || ("invoice-" + new Date().getTime());
  var mimeType = payload.mimeType || "application/octet-stream";
  var bytes = Utilities.base64Decode(payload.base64);
  var blob = Utilities.newBlob(bytes, mimeType, fileName);
  var file = root.createFile(blob);
  file.setDescription("SSMPD Leads — leadId: " + (payload.leadId || ""));

  return jsonOut({ ok: true, fileUrl: file.getUrl(), folderUrl: root.getUrl(), fileId: file.getId() });
}

// عقود الجهات: الأرشيف/جهات التعاقد/<اسم الجهة>/العقود.
// استخدمنا جذر الأرشيف الحالي حتى لا نحتاج إعداد Drive جديد أو صلاحية جديدة.
function handleContractingEntityContractUpload_(payload) {
  var entityName = payload.entityName;
  if (!entityName) return jsonOut({ ok: false, error: "لا يوجد اسم جهة التعاقد" });
  var archiveRoot = DriveApp.getFolderById(CATEGORY_FOLDER_IDS.archive);
  var entitiesRoot = getOrCreateFolder_(archiveRoot, "جهات التعاقد");
  var entityFolder = getOrCreateFolder_(entitiesRoot, entityName);
  var contractsFolder = getOrCreateFolder_(entityFolder, "العقود");
  var fileName = payload.fileName || ("contract-" + new Date().getTime());
  var mimeType = payload.mimeType || "application/octet-stream";
  var bytes = Utilities.base64Decode(payload.base64);
  var file = contractsFolder.createFile(Utilities.newBlob(bytes, mimeType, fileName));
  file.setDescription("SSMPD Contract | entity: " + entityName + " | contractId: " + (payload.contractId || ""));
  return jsonOut({ ok: true, fileUrl: file.getUrl(), folderUrl: contractsFolder.getUrl(), fileId: file.getId() });
}

// مرفقات تعليقات المهام: الأرشيف/مرفقات المهام/<سنة-شهر>.
// بنستخدم جذر الأرشيف الحالي من غير فولدر جديد أو صلاحية جديدة.
function handleTaskAttachmentUpload_(payload) {
  if (!payload.base64) return jsonOut({ ok: false, error: "لا يوجد محتوى ملف" });
  var archiveRoot = DriveApp.getFolderById(CATEGORY_FOLDER_IDS.archive);
  var tasksRoot = getOrCreateFolder_(archiveRoot, "مرفقات المهام");
  var monthName = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), "yyyy-MM");
  var monthFolder = getOrCreateFolder_(tasksRoot, monthName);
  var fileName = payload.fileName || ("task-file-" + new Date().getTime());
  var mimeType = payload.mimeType || "application/octet-stream";
  var bytes = Utilities.base64Decode(payload.base64);
  var file = monthFolder.createFile(Utilities.newBlob(bytes, mimeType, fileName));
  file.setDescription("SSMPD Task attachment | taskId: " + (payload.taskId || "") + " | " + (payload.contentTitle || ""));
  return jsonOut({ ok: true, fileUrl: file.getUrl(), folderUrl: monthFolder.getUrl(), fileId: file.getId() });
}

// أرشفة وسائط محتوى منشور (بتتنادى من Edge Function content-archive-process بعد يومين من النشر):
// الأرشيف/منشورات مؤرشفة/<سنة-شهر>/<عنوان المادة>__<8 حروف من المعرف>/design|video|slide-NN|cover.<امتداد>
// بنتأكد من sha256 قبل الحفظ، وبنرجّع الملف الموجود لو اتبعت قبل كده بنفس الـchecksum (آمن لإعادة المحاولة).
function handleContentArchive_(p) {
  var uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  if (!uuid.test(p.contentId || "")) throw new Error("Invalid content id");
  if (["design", "video", "slide", "cover"].indexOf(p.kind) < 0) throw new Error("Invalid archive kind");
  if (!/^[a-f0-9]{64}$/.test(p.sha256 || "")) throw new Error("Invalid checksum");
  if (!p.base64 || p.base64.length > 48933548) throw new Error("Archive bridge file limit is 35 MiB");
  var date = new Date(p.publishedAt);
  if (isNaN(date.getTime())) date = new Date();
  var bytes = Utilities.base64Decode(p.base64);
  if (!bytes.length || bytes.length > 35 * 1024 * 1024) throw new Error("Invalid file size");
  var checksum = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, bytes).map(function (b) {
    return ("0" + ((b + 256) % 256).toString(16)).slice(-2);
  }).join("");
  if (checksum !== p.sha256) throw new Error("Checksum mismatch");
  var lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    var archiveRoot = DriveApp.getFolderById(CATEGORY_FOLDER_IDS.archive);
    var root = getOrCreateFolder_(archiveRoot, "منشورات مؤرشفة");
    var month = getOrCreateFolder_(root, Utilities.formatDate(date, "UTC", "yyyy-MM"));
    var title = String(p.title || "مادة").replace(/[\/\\\x00-\x1f:*?"<>|]/g, " ").replace(/\s+/g, " ").trim().slice(0, 60) || "مادة";
    var folder = getOrCreateFolder_(month, title + "__" + p.contentId.slice(0, 8));
    var ext = String(p.fileName || "").split(".").pop().toLowerCase().replace(/[^a-z0-9]/g, "").slice(0, 5) || "bin";
    var base = p.kind === "slide" ? "slide-" + ("0" + Math.max(1, Number(p.position) || 1)).slice(-2) : p.kind;
    var name = base + "." + ext;
    var existing = folder.getFilesByName(name);
    var file;
    if (existing.hasNext()) {
      file = existing.next();
      if (String(file.getDescription() || "").indexOf("sha256=" + checksum) < 0) {
        name = base + "-" + checksum.slice(0, 8) + "." + ext;
        file = folder.createFile(Utilities.newBlob(bytes, p.mimeType || "application/octet-stream", name));
        file.setDescription("SSMPD Archive | sha256=" + checksum + " | contentId: " + p.contentId);
      }
    } else {
      file = folder.createFile(Utilities.newBlob(bytes, p.mimeType || "application/octet-stream", name));
      file.setDescription("SSMPD Archive | sha256=" + checksum + " | contentId: " + p.contentId);
    }
    return jsonOut({ ok: true, fileId: file.getId(), fileUrl: file.getUrl(), folderUrl: folder.getUrl(), size: bytes.length });
  } finally {
    lock.releaseLock();
  }
}

// مكتبة الماتيريال: الأرشيف/ماتيريال/<القسم>/<سنة-شهر>/<اسم الملف>
// الأقسام: ai_clips (لقطات Gemini) · scenes (مشاهد التصميم) · backups (نسخ احتياطية قبل المسح من Supabase).
// بنتأكد من sha256، وإعادة الإرسال لنفس الملف آمنة (بيرجّع الملف الموجود).
// {probe:true} بيرجّع ok من غير ما يلمس الدرايف — الـEdge Function بتستخدمه تتأكد إن الجسر متحدّث قبل ما تبدأ توليد.
function handleMaterialLibrary_(p) {
  if (p.probe) return jsonOut({ ok: true, probe: true, version: 1 });
  var sections = { ai_clips: "لقطات Gemini", scenes: "مشاهد التصميم", backups: "نسخ احتياطية" };
  if (!sections[p.section]) throw new Error("Invalid library section");
  if (!/^[a-f0-9]{64}$/.test(p.sha256 || "")) throw new Error("Invalid checksum");
  if (!p.base64 || p.base64.length > 48933548) throw new Error("Library bridge file limit is 35 MiB");
  var bytes = Utilities.base64Decode(p.base64);
  if (!bytes.length || bytes.length > 35 * 1024 * 1024) throw new Error("Invalid file size");
  var checksum = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, bytes).map(function (b) {
    return ("0" + ((b + 256) % 256).toString(16)).slice(-2);
  }).join("");
  if (checksum !== p.sha256) throw new Error("Checksum mismatch");
  var lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    var archiveRoot = DriveApp.getFolderById(CATEGORY_FOLDER_IDS.archive);
    var library = getOrCreateFolder_(archiveRoot, "ماتيريال");
    var section = getOrCreateFolder_(library, sections[p.section]);
    var month = getOrCreateFolder_(section, Utilities.formatDate(new Date(), "UTC", "yyyy-MM"));
    var name = String(p.fileName || "file").replace(/[\/\\\x00-\x1f:*?"<>|]/g, "-").slice(0, 120) || "file";
    var existing = month.getFilesByName(name);
    var file;
    if (existing.hasNext()) {
      file = existing.next();
      if (String(file.getDescription() || "").indexOf("sha256=" + checksum) < 0) {
        name = checksum.slice(0, 8) + "-" + name;
        file = month.createFile(Utilities.newBlob(bytes, p.mimeType || "application/octet-stream", name));
        file.setDescription("SSMPD Material | sha256=" + checksum + " | " + String(p.description || "").slice(0, 300));
      }
    } else {
      file = month.createFile(Utilities.newBlob(bytes, p.mimeType || "application/octet-stream", name));
      file.setDescription("SSMPD Material | sha256=" + checksum + " | " + String(p.description || "").slice(0, 300));
    }
    return jsonOut({ ok: true, fileId: file.getId(), fileUrl: file.getUrl(), folderUrl: month.getUrl(), size: bytes.length });
  } finally {
    lock.releaseLock();
  }
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


// Video outputs reuse the design archive root, without changing existing uploads.
function handleVideoArchive_(p) {
  var uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  if (!uuid.test(p.jobId || "") || !uuid.test(p.contentId || "")) throw new Error("Invalid video identity");
  if (p.kind !== "video" && p.kind !== "cover" && !/^cover_[1-5]$/.test(p.kind)) throw new Error("Invalid archive kind");
  if (!/^[a-f0-9]{64}$/.test(p.sha256 || "")) throw new Error("Invalid checksum");
  var date = new Date(p.createdAt);
  if (isNaN(date.getTime())) throw new Error("Invalid job date");
  if (!p.base64 || p.base64.length > 48933548) throw new Error("Video bridge file limit is 35 MiB");
  var bytes = Utilities.base64Decode(p.base64);
  if (!bytes.length || bytes.length > 35 * 1024 * 1024) throw new Error("Invalid file size");
  var checksum = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, bytes).map(function (b) {
    return ("0" + ((b + 256) % 256).toString(16)).slice(-2);
  }).join("");
  if (checksum !== p.sha256) throw new Error("Checksum mismatch");
  var lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    var root = getOrCreateFolder_(DriveApp.getFolderById(CATEGORY_FOLDER_IDS.design), "Videos");
    var brand = String(p.brand || "unassigned").replace(/[\/\\\x00-\x1f]/g, "-").slice(0, 100);
    var folder = getOrCreateFolder_(root, brand);
    folder = getOrCreateFolder_(folder, Utilities.formatDate(date, "UTC", "yyyy"));
    folder = getOrCreateFolder_(folder, Utilities.formatDate(date, "UTC", "MM"));
    folder = getOrCreateFolder_(folder, p.contentId + "_" + p.jobId);
    var name = p.kind === "video" ? "final.mp4" : (p.kind === "cover" ? "cover.jpg" : p.kind + ".jpg");
    var existing = folder.getFilesByName(name);
    var file;
    if (existing.hasNext()) {
      file = existing.next();
      if (file.getDescription().indexOf("sha256=" + checksum) < 0) throw new Error("Archive checksum conflict; create a new Video Job");
    } else {
      file = folder.createFile(Utilities.newBlob(bytes, p.kind === "video" ? "video/mp4" : "image/jpeg", name));
      file.setDescription("SSMPD Video | sha256=" + checksum + " | " + String(p.contentTitle || ""));
    }
    return jsonOut({ok: true, archiveVersion: 1, fileId: file.getId(), fileUrl: file.getUrl(), folderUrl: folder.getUrl()});
  } finally {
    lock.releaseLock();
  }
}
