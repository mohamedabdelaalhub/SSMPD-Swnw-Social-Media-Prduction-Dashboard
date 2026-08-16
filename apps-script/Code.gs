/**
 * SSMPD — جسر أرشيف Google Drive
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
 */

var ROOT_FOLDER_NAME = "أرشيف SSMPD"; // فولدر الجذر — يتكوّن جواه سنة/شهر/يوم تلقائياً

function doPost(e) {
  try {
    var payload = JSON.parse(e.postData.contents);
    var fileName = payload.fileName || ("design-" + new Date().getTime());
    var mimeType = payload.mimeType || "application/octet-stream";
    var base64 = payload.base64;

    if (!base64) {
      return jsonOut({ ok: false, error: "لا يوجد محتوى ملف" });
    }

    var dayFolder = getOrCreateTodayFolder_();
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
  } catch (err) {
    return jsonOut({ ok: false, error: String(err) });
  }
}

function doGet() {
  return jsonOut({ ok: true, message: "SSMPD Drive Bridge شغّال" });
}

/** يجيب فولدر اليوم داخل سنة/شهر، وينشئه لو مش موجود */
function getOrCreateTodayFolder_() {
  var root = getOrCreateFolder_(DriveApp.getRootFolder(), ROOT_FOLDER_NAME);
  var now = new Date();
  var year = Utilities.formatDate(now, Session.getScriptTimeZone(), "yyyy");
  var month = Utilities.formatDate(now, Session.getScriptTimeZone(), "MM - MMMM");
  var day = Utilities.formatDate(now, Session.getScriptTimeZone(), "dd");

  var yearFolder = getOrCreateFolder_(root, year);
  var monthFolder = getOrCreateFolder_(yearFolder, month);
  var dayFolder = getOrCreateFolder_(monthFolder, day);
  return dayFolder;
}

function getOrCreateFolder_(parent, name) {
  var it = parent.getFoldersByName(name);
  if (it.hasNext()) return it.next();
  return parent.createFolder(name);
}

function jsonOut(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}
