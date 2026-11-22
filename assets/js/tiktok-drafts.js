/* "Send to TikTok as a draft" — super admin only, at the bottom of the Publish tab.
   Lists videos that never got a TikTok link. One press: copies the caption to the clipboard and queues ONE upload to
   the page's TikTok inbox (Content Posting API Upload flow, video.upload — works before the Direct Post audit).
   The owner then opens TikTok, pastes the caption, picks the cover and taps Post.
   The database refuses a second draft for the same reel (unless the first one failed).
   When SSMPD_CONFIG.tiktokDirectPostAudited is true (set it after TikTok approves the audit), the same button opens
   the full Direct Post panel (tiktok-post-panel.js) instead and posts straight to the account. */
(function () {
  "use strict";
  function esc(s) { return String(s == null ? "" : s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;"); }
  function t(ar) { return window.SSMPDI18n ? window.SSMPDI18n.textHtml(ar) : esc(ar); }
  function tr(ar) { return window.SSMPDI18n ? window.SSMPDI18n.t(ar) : ar; }
  function toast(msg, type) { if (window.SSMPDToast) window.SSMPDToast.show(tr(msg), type); }
  function caption(item) { return String(item.caption_text || item.body || item.title || "").slice(0, 2200); }
  function audited() { return !!(window.SSMPD_CONFIG && window.SSMPD_CONFIG.tiktokDirectPostAudited); }
  var STATUS = {
    pending: "في الطابور", processing: "بيترفع", published: "وصلت صندوق TikTok", failed: "فشل", cancelled: "اتلغت"
  };
  var BRANDS = { sono: "سونو", dr_dina: "د.دينا" };

  function copy(text) {
    if (navigator.clipboard && navigator.clipboard.writeText) return navigator.clipboard.writeText(text).then(function () { return true; }, function () { return false; });
    return Promise.resolve(false);
  }

  function rowHtml(item, job) {
    var status = job ? '<span title="' + esc(job.error_message || job.publish_status || "") + '">' + t(STATUS[job.status] || job.status) + "</span>" : "";
    var sent = job && job.status !== "failed" && job.status !== "cancelled";
    var label = audited() ? "نشر على TikTok" : "ابعت لـTikTok كمسودة + انسخ الكابشن";
    return '<div class="card" style="padding:10px;margin-bottom:8px;display:flex;gap:10px;align-items:center;flex-wrap:wrap;">' +
      '<div style="flex:1;min-width:200px;"><b dir="auto">' + esc(item.title || "—") + "</b>" +
      '<div style="color:var(--c-muted);font-size:12px;">' + t(BRANDS[item.brand] || "بدون صفحة") +
      (item.published_at ? " · " + esc(new Date(item.published_at).toLocaleDateString("ar-EG-u-nu-latn")) : "") + (status ? " · " + status : "") + "</div></div>" +
      '<button type="button" class="btn ghost sm" data-tt-copy="' + item.id + '">' + t("انسخ الكابشن") + "</button>" +
      '<button type="button" class="btn sm" data-tt-draft="' + item.id + '"' + (sent && !audited() ? " disabled" : "") + ">" + t(sent && !audited() ? "اتبعتت كمسودة" : label) + "</button></div>";
  }

  function sendDraft(item, btn, reload) {
    var text = caption(item);
    if (!window.confirm(tr("هيتبعت الفيديو ده لصندوق TikTok كمسودة (مرة واحدة بس). تكمل؟"))) return;
    btn.disabled = true;
    // Copy first, while the click still counts as a user gesture for the clipboard.
    copy(text).then(function (copied) {
      return window.SSMPDDb.queueTikTokInboxDraft(item.id).then(function () {
        toast(copied ? "اتبعتت للطابور واتنسخ الكابشن. خلال دقيقتين افتح TikTok ← صندوق الوارد ← الصق الكابشن واختار الغلاف وانشر." : "اتبعتت للطابور. انسخ الكابشن من الزرار التاني.");
        reload();
      });
    }).catch(function (e) { btn.disabled = false; toast(e.message || "تعذر الإرسال", "error"); });
  }

  // After the audit: the same button opens the guideline-compliant Direct Post panel in a dialog.
  function directPost(item, reload) {
    var P = window.SSMPDTikTokPanel, back = document.createElement("div");
    back.className = "modal-backdrop";
    back.innerHTML = '<div class="modal" style="max-width:520px;"><div id="tt-direct-body"></div>' +
      '<div style="display:flex;gap:8px;margin-top:10px;"><button type="button" class="btn" data-publish-now="' + item.id + '">' + t("نشر على TikTok") + '</button><button type="button" class="btn ghost" data-tt-close>' + t("إلغاء") + "</button></div></div>";
    document.body.appendChild(back);
    back.querySelector("#tt-direct-body").innerHTML = P.html(item);
    var box = document.getElementById("pb-tiktok-options-" + item.id); if (box) box.style.display = "block";
    P.load(item.id, item.brand, function (brand) { return window.SSMPDDb.tiktokCreatorInfo(brand); }, function () { toast("اربط حساب TikTok من بطاقة النشر.", "error"); });
    back.querySelector("[data-tt-close]").onclick = function () { back.remove(); };
    back.querySelector("[data-publish-now]").onclick = function () {
      if (!P.validate(item.id)) return;
      var p = P.payload(item.id); copy(p.title || "");
      p.contentId = item.id; p.brand = item.brand; p.scheduledAt = new Date().toISOString(); p.createdBy = window.SSMPDAuth.currentAdmin.id;
      window.SSMPDDb.createTikTokPublishJob(p).then(function () { toast("اتبعت للنشر على TikTok — هيظهر خلال دقايق."); back.remove(); reload(); })
        .catch(function (e) { toast(e.message, "error"); });
    };
  }

  function mount(container) {
    var me = window.SSMPDAuth && window.SSMPDAuth.currentAdmin;
    if (!me || me.role !== "super_admin" || !container) return Promise.resolve();
    var box = document.createElement("details");
    box.id = "tiktok-drafts"; box.style.marginTop = "18px";
    box.innerHTML = "<summary style=\"cursor:pointer;font-weight:700;\">" + t("TikTok — فيديوهات لسه ماتنشرتش عليه") + '</summary><div data-tt-list style="margin-top:8px;">' + t("بيحمّل…") + "</div>";
    container.appendChild(box);
    var list = box.querySelector("[data-tt-list]");
    function load() {
      return window.SSMPDDb.listTikTokDraftCandidates().then(function (items) {
        return window.SSMPDDb.listTikTokInboxJobs(items.map(function (i) { return i.id; })).catch(function () { return []; }).then(function (jobs) {
          var latest = {}; jobs.forEach(function (j) { if (!latest[j.content_id]) latest[j.content_id] = j; });
          var byId = {}; items.forEach(function (i) { byId[i.id] = i; });
          list.innerHTML = '<div style="color:var(--c-muted);font-size:12px;margin-bottom:8px;">' +
            t(audited() ? "الزرار بينشر الفيديو مباشرة على TikTok بعد ما تختار الإعدادات." : "الزرار بيبعت الفيديو لصندوق الوارد في تطبيق TikTok كمسودة وبينسخ الكابشن. انت بتكمّل النشر من التطبيق.") + "</div>" +
            (items.length ? items.map(function (i) { return rowHtml(i, latest[i.id]); }).join("") : t("مفيش فيديوهات ناقصة على TikTok."));
          list.querySelectorAll("[data-tt-copy]").forEach(function (b) {
            b.onclick = function () { copy(caption(byId[b.getAttribute("data-tt-copy")])).then(function (ok) { toast(ok ? "اتنسخ الكابشن." : "المتصفح رفض النسخ.", ok ? undefined : "error"); }); };
          });
          list.querySelectorAll("[data-tt-draft]").forEach(function (b) {
            b.onclick = function () { var item = byId[b.getAttribute("data-tt-draft")]; if (audited()) directPost(item, load); else sendDraft(item, b, load); };
          });
        });
      }).catch(function (e) { list.textContent = tr("تعذر التحميل") + ": " + e.message; });
    }
    return load();
  }

  window.SSMPDTikTokDrafts = { mount: mount };
})();
