/* TikTok post panel in the Publish tab — built to TikTok's Content Sharing Guidelines (Direct Post audit):
   fresh creator_info every time the panel opens, the target account's avatar and nickname, a preview of the video,
   an editable caption, privacy with no default (only the options creator_info returns), interaction toggles off
   by default and greyed out when the account disabled them, the max video length check, commercial content
   disclosure with the TikTok labels, the Music Usage / Branded Content declaration, explicit consent, and the
   processing notice. render-publish.js owns the card; this file owns everything inside #pb-tiktok-options-<id>. */
(function () {
  "use strict";
  var MUSIC_URL = "https://www.tiktok.com/legal/page/global/music-usage-confirmation/en";
  var BRANDED_URL = "https://www.tiktok.com/legal/page/global/bc-policy/en";
  var PRIVACY_LABELS = {
    PUBLIC_TO_EVERYONE: "الكل (عام)",
    MUTUAL_FOLLOW_FRIENDS: "الأصدقاء",
    FOLLOWER_OF_CREATOR: "المتابعون",
    SELF_ONLY: "أنا فقط"
  };
  var CANNOT_POST = {
    spam_risk_too_many_posts: "حساب TikTok وصل للحد اليومي للنشر. جرّب بكرة.",
    spam_risk_user_banned_from_posting: "TikTok موقّف النشر على الحساب ده مؤقتًا. افتح تطبيق TikTok وشوف التنبيهات.",
    reached_active_user_cap: "تطبيق الداشبورد وصل لحد المستخدمين اليومي عند TikTok. جرّب بكرة."
  };
  var state = Object.create(null); // per content id: {creator, canPost, reason, duration, loading}

  function $(id) { return document.getElementById(id); }
  function esc(s) { return String(s == null ? "" : s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;"); }
  function t(ar) { return window.SSMPDI18n ? window.SSMPDI18n.textHtml(ar) : esc(ar); }
  function tr(ar) { return window.SSMPDI18n ? window.SSMPDI18n.t(ar) : ar; }
  function checked(name, id) { var el = $("pb-tiktok-" + name + "-" + id); return !!(el && el.checked); }
  function notify(msg) { if (window.SSMPDToast) window.SSMPDToast.show(tr(msg), "error"); }

  function html(item) {
    var id = item.id;
    var caption = String(item.caption_text || item.body || item.title || "").slice(0, 2200);
    var box = function (name, label) { return '<label style="display:block;"><input type="checkbox" id="pb-tiktok-' + name + "-" + id + '"> ' + t(label) + "</label>"; };
    return '<div id="pb-tiktok-options-' + id + '" data-video-url="' + esc(item.design_file_url || "") + '" style="display:none;margin:8px 0 12px;padding:10px;border:1px solid var(--c-border);border-radius:8px;font-size:12px;">' +
      '<div style="font-weight:700;margin-bottom:6px;">' + t("النشر على TikTok") + "</div>" +
      '<div id="pb-tiktok-account-' + id + '" style="margin-bottom:8px;color:var(--c-muted);">' + t("جاري قراءة حساب TikTok...") + "</div>" +
      '<div id="pb-tiktok-preview-' + id + '" style="margin-bottom:8px;"></div>' +
      '<div id="pb-tiktok-duration-' + id + '" style="margin-bottom:8px;color:var(--c-muted);"></div>' +
      '<div class="field"><label>' + t("كابشن TikTok (تقدر تعدّله)") + '</label><textarea id="pb-tiktok-title-' + id + '" maxlength="2200" rows="4" dir="auto">' + esc(caption) + '</textarea>' +
      '<div id="pb-tiktok-title-count-' + id + '" style="color:var(--c-muted);">' + caption.length + " / 2200</div></div>" +
      '<div class="field"><label>' + t("مين يقدر يشوف الفيديو ده") + '</label><select id="pb-tiktok-privacy-' + id + '" required><option value="">' + t("اختر الخصوصية يدويًا") + "</option></select>" +
      '<div id="pb-tiktok-privacy-hint-' + id + '" style="display:none;color:var(--c-muted);">' + t("محتوى الشراكة المدفوعة مينفعش يكون «أنا فقط».") + "</div></div>" +
      '<div style="font-weight:700;margin-top:6px;">' + t("السماح للمستخدمين بـ") + "</div>" +
      box("allow-comment", "التعليق") + box("allow-duet", "الـDuet") + box("allow-stitch", "الـStitch") +
      '<label style="display:block;margin-top:10px;font-weight:700;"><input type="checkbox" id="pb-tiktok-commercial-' + id + '"> ' + t("الإفصاح عن محتوى الفيديو (محتوى تجاري)") + "</label>" +
      '<div style="color:var(--c-muted);">' + t("فعّلها لو الفيديو بيروّج لسلعة أو خدمة مقابل أي قيمة. الفيديو ممكن يروّج لنفسك أو لطرف تاني أو للاتنين.") + "</div>" +
      '<div id="pb-tiktok-commercial-options-' + id + '" style="display:none;padding-inline-start:16px;margin-top:4px;">' +
      box("your-brand", "علامتك التجارية") + '<div style="color:var(--c-muted);margin:-2px 0 4px;">' + t("بتروّج لنفسك أو لنشاطك. الفيديو هيتصنّف Brand Organic.") + "</div>" +
      box("branded", "محتوى بشراكة مدفوعة") + '<div style="color:var(--c-muted);margin:-2px 0 4px;">' + t("بتروّج لعلامة أو طرف تاني. الفيديو هيتصنّف Branded Content.") + "</div>" +
      '<div id="pb-tiktok-label-' + id + '" style="display:none;font-weight:700;"></div>' +
      '<div id="pb-tiktok-commercial-hint-' + id + '" style="display:none;color:var(--c-negative);">' + t("لازم تحدد الفيديو بيروّج لنفسك ولا لطرف تاني ولا للاتنين.") + "</div></div>" +
      '<label style="display:block;margin-top:8px;"><input type="checkbox" id="pb-tiktok-aigc-' + id + '"> ' + t("الفيديو معمول بالذكاء الاصطناعي (AI-generated)") + "</label>" +
      '<div id="pb-tiktok-declaration-' + id + '" style="margin-top:8px;"></div>' +
      '<label style="display:block;margin-top:6px;"><input type="checkbox" id="pb-tiktok-consent-' + id + '"> ' + t("أوافق على إرسال الفيديو للحساب المحدد ونشره في الموعد") + "</label>" +
      '<div style="color:var(--c-muted);margin-top:5px;">' + t("بعد الإرسال TikTok بياخد كام دقيقة يعالج الفيديو قبل ما يظهر على البروفايل. حالة النشر بتظهر هنا في بطاقة المادة.") + "</div></div>";
  }

  // TikTok's declaration, in its official English wording in English mode and in Arabic otherwise (re-rendered on language switch).
  function declaration(id) {
    var slot = $("pb-tiktok-declaration-" + id); if (!slot) return;
    var en = !!(window.SSMPDI18n && window.SSMPDI18n.getLanguage() === "en");
    var link = function (url, text) { return '<a href="' + url + '" target="_blank" rel="noopener noreferrer">' + text + "</a>"; };
    var music = link(MUSIC_URL, en ? "Music Usage Confirmation" : "تأكيد استخدام الموسيقى");
    if (checked("commercial", id) && checked("branded", id)) {
      var bc = link(BRANDED_URL, en ? "Branded Content Policy" : "سياسة المحتوى الممول");
      slot.innerHTML = en ? "By posting, you agree to TikTok's " + bc + " and " + music + "." : "بالنشر، أنت موافق على " + bc + " و" + music + " الخاصين بـTikTok.";
    } else {
      slot.innerHTML = en ? "By posting, you agree to TikTok's " + music + "." : "بالنشر، أنت موافق على " + music + " الخاص بـTikTok.";
    }
  }

  // What blocks posting right now, or "" when TikTok is ready. Shared by the button gate and the final validation.
  function blocker(id) {
    var s = state[id];
    if (!s || s.loading) return "استنى لحد ما بيانات حساب TikTok تحمّل.";
    if (!s.connected) return "اربط حساب TikTok الأول.";
    if (s.canPost === false) return CANNOT_POST[s.reason] || "حساب TikTok مش هيقدر ينشر دلوقتي. جرّب بعدين.";
    var max = Number(s.creator && s.creator.max_video_post_duration_sec);
    if (max > 0 && s.duration && s.duration > max) return "الفيديو أطول من الحد المسموح للحساب ده على TikTok.";
    if (checked("commercial", id) && !checked("your-brand", id) && !checked("branded", id)) return "لازم تحدد الفيديو بيروّج لنفسك ولا لطرف تاني ولا للاتنين.";
    return "";
  }

  function buttons(id) {
    return Array.prototype.slice.call(document.querySelectorAll('[data-schedule="' + id + '"],[data-publish-now="' + id + '"]'));
  }
  // Disable the post buttons (with the reason as a tooltip) while TikTok is selected and something blocks it.
  function gate(id, selected) {
    var reason = selected ? blocker(id) : "";
    buttons(id).forEach(function (b) { b.disabled = !!reason; b.title = reason ? tr(reason) : ""; });
  }

  function refresh(id) {
    var commercial = checked("commercial", id), your = checked("your-brand", id), branded = checked("branded", id);
    var opts = $("pb-tiktok-commercial-options-" + id); if (opts) opts.style.display = commercial ? "block" : "none";
    var label = $("pb-tiktok-label-" + id);
    if (label) {
      var text = commercial && branded ? "الفيديو هيظهر عليه لابل «شراكة مدفوعة» (Paid partnership)." : (commercial && your ? "الفيديو هيظهر عليه لابل «محتوى ترويجي» (Promotional content)." : "");
      label.style.display = text ? "block" : "none"; label.innerHTML = text ? t(text) : "";
    }
    var hint = $("pb-tiktok-commercial-hint-" + id); if (hint) hint.style.display = commercial && !your && !branded ? "block" : "none";
    var privacy = $("pb-tiktok-privacy-" + id), self = privacy && privacy.querySelector('option[value="SELF_ONLY"]');
    if (self) {
      var lock = commercial && branded;
      self.disabled = lock; self.title = lock ? tr("محتوى الشراكة المدفوعة مينفعش يكون «أنا فقط».") : "";
      if (lock && privacy.value === "SELF_ONLY") privacy.value = "";
      var ph = $("pb-tiktok-privacy-hint-" + id); if (ph) ph.style.display = lock ? "block" : "none";
    }
    var title = $("pb-tiktok-title-" + id), count = $("pb-tiktok-title-count-" + id);
    if (title && count) count.textContent = title.value.length + " / 2200";
    declaration(id);
    gate(id, true);
  }

  function showDuration(id) {
    var s = state[id], slot = $("pb-tiktok-duration-" + id); if (!slot || !s) return;
    var max = Number(s.creator && s.creator.max_video_post_duration_sec), parts = [];
    if (max > 0) parts.push(tr("أقصى طول فيديو للحساب ده") + ": " + max + " " + tr("ثانية"));
    if (s.duration) parts.push(tr("طول الفيديو") + ": " + Math.ceil(s.duration) + " " + tr("ثانية"));
    slot.textContent = parts.join(" — ");
    slot.style.color = max > 0 && s.duration > max ? "var(--c-negative)" : "var(--c-muted)";
  }

  function preview(id) {
    var wrap = $("pb-tiktok-options-" + id), slot = $("pb-tiktok-preview-" + id);
    if (!wrap || !slot || slot.__done) return;
    slot.__done = true;
    var url = wrap.getAttribute("data-video-url") || "";
    if (!url) { slot.innerHTML = t("مفيش ملف فيديو للمادة دي."); return; }
    var drive = /^https:\/\/drive\.google\.com\/file\/d\/([\w-]+)/.exec(url) || /^https:\/\/drive\.google\.com\/.*[?&]id=([\w-]+)/.exec(url);
    if (drive) {
      slot.innerHTML = '<iframe title="TikTok preview" src="https://drive.google.com/file/d/' + drive[1] + '/preview" style="width:100%;max-width:260px;aspect-ratio:9/16;border:0;border-radius:8px;" loading="lazy" referrerpolicy="no-referrer" sandbox="allow-scripts allow-same-origin"></iframe>';
      return;
    }
    var resolve = window.SSMPDDesignFiles ? window.SSMPDDesignFiles.resolve(url) : Promise.resolve(url);
    resolve.then(function (src) {
      var v = document.createElement("video");
      v.controls = true; v.preload = "metadata"; v.playsInline = true;
      v.style.cssText = "width:100%;max-width:260px;aspect-ratio:9/16;background:#000;border-radius:8px;";
      v.addEventListener("loadedmetadata", function () {
        if (isFinite(v.duration) && v.duration > 0) { (state[id] = state[id] || {}).duration = v.duration; showDuration(id); gate(id, true); }
      });
      v.src = src; slot.innerHTML = ""; slot.appendChild(v);
    }).catch(function () { slot.innerHTML = t("تعذر عرض معاينة الفيديو."); });
  }

  function renderAccount(id, result, connect) {
    var slot = $("pb-tiktok-account-" + id), privacy = $("pb-tiktok-privacy-" + id);
    if (!slot) return;
    var s = state[id] = state[id] || {};
    s.loading = false; s.connected = !!(result.connected && !result.reauthorize); s.canPost = result.can_post !== false; s.reason = result.reason || ""; s.creator = result.creator || null;
    var connectBtn = function (label) {
      slot.innerHTML = t(label) + ' <button type="button" class="btn ghost sm" data-tiktok-connect="' + id + '">' + t("ربط حساب TikTok") + "</button>";
      var b = slot.querySelector("[data-tiktok-connect]"); if (b) b.onclick = function () { connect(id, b); };
    };
    if (result.reauthorize) { s.connected = false; connectBtn("انتهت صلاحية الربط."); refresh(id); return; }
    if (!result.connected) { connectBtn("حساب TikTok غير مربوط."); refresh(id); return; }
    if (result.can_post === false) {
      slot.innerHTML = '<span style="color:var(--c-negative);">' + t(CANNOT_POST[result.reason] || "حساب TikTok مش هيقدر ينشر دلوقتي. جرّب بعدين.") + "</span>";
      refresh(id); return;
    }
    var c = result.creator || {};
    var avatar = /^https:\/\//.test(c.creator_avatar_url || "") ? '<img src="' + esc(c.creator_avatar_url) + '" alt="" referrerpolicy="no-referrer" style="width:32px;height:32px;border-radius:50%;vertical-align:middle;margin-inline-end:6px;">' : "";
    slot.innerHTML = avatar + t("هيتنشر على حساب") + ' <b dir="auto">' + esc(c.creator_nickname || "TikTok") + "</b>" + (c.creator_username ? ' <span dir="ltr">@' + esc(c.creator_username) + "</span>" : "");
    if (privacy) {
      var opts = Array.isArray(c.privacy_level_options) ? c.privacy_level_options : [];
      privacy.innerHTML = '<option value="">' + t("اختر الخصوصية يدويًا") + "</option>" + opts.map(function (v) {
        return '<option value="' + esc(v) + '">' + (PRIVACY_LABELS[v] ? t(PRIVACY_LABELS[v]) : esc(v)) + "</option>";
      }).join("");
      privacy.value = "";
    }
    [["comment", c.comment_disabled], ["duet", c.duet_disabled], ["stitch", c.stitch_disabled]].forEach(function (pair) {
      var el = $("pb-tiktok-allow-" + pair[0] + "-" + id); if (!el) return;
      el.checked = false; el.disabled = !!pair[1];
      el.title = pair[1] ? tr("التفاعل ده مقفول من إعدادات حساب TikTok") : "";
      if (el.parentNode) el.parentNode.style.opacity = pair[1] ? "0.5" : "";
    });
    showDuration(id);
    refresh(id);
  }

  // Called each time the panel opens or the page (brand) changes: creator_info is always fetched fresh.
  function load(id, brand, api, connect) {
    var slot = $("pb-tiktok-account-" + id);
    preview(id);
    wire(id);
    var s = state[id] = state[id] || {};
    s.loading = true; refresh(id);
    if (!brand) { if (slot) slot.innerHTML = t("اختار الصفحة (سونو أو د.دينا) الأول."); return Promise.resolve(); }
    if (slot) slot.innerHTML = t("جاري قراءة حساب TikTok...");
    return api(brand).then(function (result) { renderAccount(id, result || {}, connect); })
      .catch(function () { s.loading = false; s.connected = false; if (slot) slot.innerHTML = t("تعذر قراءة الحساب. أعد تحميل التفاصيل."); refresh(id); });
  }

  function wire(id) {
    var wrap = $("pb-tiktok-options-" + id); if (!wrap || wrap.__wired) return;
    wrap.__wired = true;
    wrap.addEventListener("change", function () { refresh(id); });
    wrap.addEventListener("input", function (e) { if (e.target && e.target.id === "pb-tiktok-title-" + id) refresh(id); });
  }

  function validate(id) {
    var reason = blocker(id);
    if (reason) { notify(reason); return false; }
    var privacy = $("pb-tiktok-privacy-" + id);
    if (!privacy || !privacy.value) { notify("اختار خصوصية منشور TikTok يدويًا."); return false; }
    if (checked("commercial", id) && checked("branded", id) && privacy.value === "SELF_ONLY") { notify("محتوى الشراكة المدفوعة مينفعش يكون «أنا فقط»."); return false; }
    var title = $("pb-tiktok-title-" + id);
    if (title && title.value.length > 2200) { notify("كابشن TikTok أطول من ٢٢٠٠ حرف."); return false; }
    if (!checked("consent", id)) { notify("أكد موافقتك على شروط TikTok وإرسال الفيديو قبل النشر."); return false; }
    return true;
  }

  function payload(id) {
    var commercial = checked("commercial", id), title = $("pb-tiktok-title-" + id);
    return {
      title: title ? title.value.trim().slice(0, 2200) : null,
      privacyLevel: ($("pb-tiktok-privacy-" + id) || {}).value || "",
      disableComment: !checked("allow-comment", id), disableDuet: !checked("allow-duet", id), disableStitch: !checked("allow-stitch", id),
      commercialContent: commercial, yourBrand: commercial && checked("your-brand", id), brandedContent: commercial && checked("branded", id),
      isAigc: checked("aigc", id),
      // The consent box sits under TikTok's Music Usage (and Branded Content) declaration, so ticking it is that confirmation.
      musicConfirmation: checked("consent", id)
    };
  }

  document.addEventListener("ssmpd:languagechange", function () { Object.keys(state).forEach(declaration); });

  window.SSMPDTikTokPanel = { html: html, load: load, validate: validate, payload: payload, gate: gate, refresh: refresh, _state: state };
})();
