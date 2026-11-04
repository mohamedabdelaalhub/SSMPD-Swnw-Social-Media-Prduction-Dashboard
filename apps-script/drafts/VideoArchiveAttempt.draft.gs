/**
 * DRAFT (2026-11-04), NOT DEPLOYED, NOT part of Code.gs. Additive Apps Script actions for the attempt-scoped video archive.
 * To adopt: owner adds these two functions to Code.gs and two routes in doPost (new bridge version); the existing "video_archive" action is untouched.
 *   if (action === "video_archive_attempt") return handleVideoArchiveAttempt_(payload);
 *   if (action === "video_archive_cleanup") return handleVideoArchiveCleanup_(payload);
 * Reuses getOrCreateFolder_, jsonOut and CATEGORY_FOLDER_IDS from Code.gs. Layout: Videos/<brand>/<yyyy>/<MM>/<contentId>_<jobId>/attempt-NN/{final.mp4,cover.jpg,cover_N.jpg}
 * The database (video_job_commit_fenced) decides which attempt wins; this bridge never decides and never deletes an attempt it was not told to.
 */
var VIDEO_UUID_ = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function videoAttemptNumber_(value) {
  var n = Number(value);
  if (!isFinite(n) || n % 1 !== 0 || n < 1 || n > 99) throw new Error("Invalid attempt");
  return n;
}

function videoAttemptFolderName_(attempt) {
  return "attempt-" + ("0" + attempt).slice(-2);
}

/** Finds (or with create=true creates) the per-job folder; the same path as handleVideoArchive_. */
function videoJobFolder_(p, create) {
  var date = new Date(p.createdAt);
  if (isNaN(date.getTime())) throw new Error("Invalid job date");
  var folder = DriveApp.getFolderById(CATEGORY_FOLDER_IDS.design);
  var brand = String(p.brand || "unassigned").replace(/[\/\\\x00-\x1f]/g, "-").slice(0, 100);
  var names = ["Videos", brand, Utilities.formatDate(date, "UTC", "yyyy"), Utilities.formatDate(date, "UTC", "MM"), p.contentId + "_" + p.jobId];
  for (var i = 0; i < names.length; i++) {
    if (create) {
      folder = getOrCreateFolder_(folder, names[i]);
    } else {
      var it = folder.getFoldersByName(names[i]);
      if (!it.hasNext()) return null;
      folder = it.next();
    }
  }
  return folder;
}

function handleVideoArchiveAttempt_(p) {
  if (!VIDEO_UUID_.test(p.jobId || "") || !VIDEO_UUID_.test(p.contentId || "")) throw new Error("Invalid video identity");
  var attempt = videoAttemptNumber_(p.attempt);
  if (p.kind !== "video" && p.kind !== "cover" && !/^cover_[1-5]$/.test(p.kind)) throw new Error("Invalid archive kind");
  if (!/^[a-f0-9]{64}$/.test(p.sha256 || "")) throw new Error("Invalid checksum");
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
    var jobFolder = videoJobFolder_(p, true);
    var folder = getOrCreateFolder_(jobFolder, videoAttemptFolderName_(attempt));
    var name = p.kind === "video" ? "final.mp4" : (p.kind === "cover" ? "cover.jpg" : p.kind + ".jpg");
    var existing = folder.getFilesByName(name);
    var file;
    if (existing.hasNext()) {
      file = existing.next();
      // same attempt + same bytes = idempotent duplicate callback; different bytes inside ONE attempt is a real conflict
      if (file.getDescription().indexOf("sha256=" + checksum) < 0) throw new Error("Attempt archive checksum conflict");
    } else {
      file = folder.createFile(Utilities.newBlob(bytes, p.kind === "video" ? "video/mp4" : "image/jpeg", name));
      file.setDescription("SSMPD Video attempt " + attempt + " | sha256=" + checksum + " | " + String(p.contentTitle || ""));
    }
    return jsonOut({ok: true, archiveVersion: 2, attempt: attempt, fileId: file.getId(), fileUrl: file.getUrl(), folderUrl: folder.getUrl()});
  } finally {
    lock.releaseLock();
  }
}

/** Trashes ONLY the named attempt-NN folders of one job (never other names, never keepAttempt). Duplicate callbacks are harmless. */
function handleVideoArchiveCleanup_(p) {
  if (!VIDEO_UUID_.test(p.jobId || "") || !VIDEO_UUID_.test(p.contentId || "")) throw new Error("Invalid video identity");
  if (!Array.isArray(p.attempts) || p.attempts.length < 1 || p.attempts.length > 20) throw new Error("Invalid attempts");
  var wanted = p.attempts.map(videoAttemptNumber_);
  if (p.keepAttempt !== undefined && p.keepAttempt !== null) {
    var keep = videoAttemptNumber_(p.keepAttempt);
    if (wanted.indexOf(keep) >= 0) throw new Error("Refusing to remove the kept attempt");
  }
  var lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    var jobFolder = videoJobFolder_(p, false);
    var removed = 0;
    if (jobFolder) {
      wanted.forEach(function (attempt) {
        var it = jobFolder.getFoldersByName(videoAttemptFolderName_(attempt));
        while (it.hasNext()) { it.next().setTrashed(true); removed++; }
      });
    }
    return jsonOut({ok: true, archiveVersion: 2, removed: removed});
  } finally {
    lock.releaseLock();
  }
}
