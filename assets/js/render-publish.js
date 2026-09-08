/* SSMPD — تاب النشر: المواد المعتمدة (محتوى + تصميم) بتتجدول أو تتنشر من هنا
   قسم ٤٣: فيسبوك/انستجرام بقوا بينشروا فعليًا (Meta Auto Publisher — خلفية
   عن طريق meta_publish_jobs + Edge Function + pg_cron) بدل تأكيد رابط يدوي.
   تيكتوك/يوتيوب/الموقع الإلكتروني لسه نشر يدوي زي الأول بالظبط. */
(function () {
  "use strict";
  var W = window.SSMPDWorkflow;
  var C = window.SSMPDComments;

  var META_PLATFORMS = ["facebook", "instagram"];

  var JOB_STATUS_LABELS = {
    pending: { label: "في الانتظار", cls: "draft" },
    processing: { label: "جاري النشر", cls: "received" },
    published: { label: "تم النشر", cls: "approved" },
    partial: { label: "نشر جزئي", cls: "revision" },
    failed: { label: "فشل", cls: "rejected" },
    cancelled: { label: "أُلغي", cls: "draft" }
  };

  function escapeHtml(s) {
    return String(s == null ? "" : s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  }

  function valueOf(id) {
    var el = document.getElementById(id);
    return el ? el.value.trim() : "";
  }

  function hasMetaPlatform(platforms) {
    return platforms.some(function (p) { return META_PLATFORMS.indexOf(p) !== -1; });
  }

  function render(container) {
    var me = window.SSMPDAuth.currentAdmin;
    container.innerHTML = '<div class="loading">بيحمّل…</div>';
    Promise.all([
      window.SSMPDDb.listContentItems({}),
      window.SSMPDDb.listAdminsBasic(),
      window.SSMPDDb.listAllComments(),
      window.SSMPDDb.listMyCommentReads(me.id)
    ]).then(function (res) {
      var items = res[0], admins = res[1];
      var stats = C.computeCommentStats(res[2], res[3], me.id);
      var adminsById = {}; admins.forEach(function (a) { adminsById[a.id] = a; });

      var scheduled = items.filter(function (i) { return i.stage === "scheduled"; });
      scheduled.sort(function (a, b) {
        return new Date(a.scheduled_publish_at || 0) - new Date(b.scheduled_publish_at || 0);
      });
      var ready = items.filter(function (i) { return i.stage === "ready_to_publish"; });

      var contentIds = scheduled.concat(ready).map(function (i) { return i.id; });
      return window.SSMPDDb.listMetaPublishJobsForContent(contentIds).catch(function () { return []; }).then(function (jobs) {
        // أحدث job لكل مادة (الاستعلام مرتب created_at desc بالفعل)
        var jobByContent = {};
        jobs.forEach(function (j) { if (!jobByContent[j.content_id]) jobByContent[j.content_id] = j; });

        var html = '<h2 style="margin-bottom:16px;">النشر</h2>' +
          '<p style="color:var(--c-muted);font-size:12px;margin-top:-10px;margin-bottom:16px;">هنا كل مادة خلصت اعتماد نهائي وتصميم — جاهزة تتجدول أو تتنشر مباشرة. فيسبوك/انستجرام بينشروا تلقائيًا، وباقي المنصات (تيكتوك/يوتيوب/الموقع) لسه بتحتاج تأكيد يدوي.</p>';

        html += '<div class="section"><h3>مجدولة للنشر (' + scheduled.length + ')</h3>';
        if (!scheduled.length) {
          html += '<div class="empty-state">مفيش مواد مجدولة دلوقتي</div>';
        } else {
          scheduled.forEach(function (i) { html += renderCard(i, adminsById, "scheduled", jobByContent[i.id]); });
        }
        html += '</div>';

        html += '<div class="section"><h3>جاهزة للنشر (' + ready.length + ')</h3>';
        if (!ready.length) {
          html += '<div class="empty-state">مفيش مواد جاهزة للنشر دلوقتي</div>';
        } else {
          ready.forEach(function (i) { html += renderCard(i, adminsById, "ready", jobByContent[i.id]); });
        }
        html += '</div>';

        container.innerHTML = html;
        wire(container);
        scheduled.concat(ready).forEach(function (i) {
          var slot = document.getElementById("comments-slot-" + i.id);
          if (slot) window.SSMPDComments.render(slot, i.id, adminsById);
        });
      });
    }).catch(function (e) {
      container.innerHTML = '<div class="err-msg">خطأ: ' + e.message + '</div>';
    });
  }

  // حالة/نتيجة job النشر التلقائي (فيسبوك/انستجرام) — بند ٨: عرض حقيقي
  // بدل رابط يدوي، بروابط فعلية للمنشورات لو نجح.
  function jobStatusHtml(job) {
    if (!job) return "";
    var st = JOB_STATUS_LABELS[job.status] || { label: job.status, cls: "draft" };
    var html = '<div style="margin-top:8px;padding:8px 10px;border:1px solid var(--c-border);border-radius:8px;font-size:12px;">' +
      '<div><b>حالة النشر التلقائي:</b> <span class="status-pill ' + st.cls + '">' + escapeHtml(st.label) + '</span>' +
      (job.last_attempt_at ? ' <span style="color:var(--c-muted);">— آخر محاولة: ' + new Date(job.last_attempt_at).toLocaleString("ar-EG") + '</span>' : '') + '</div>';
    if (job.publish_facebook) {
      html += '<div>فيسبوك: ' + (job.facebook_permalink
        ? '<a href="' + job.facebook_permalink + '" target="_blank" rel="noopener noreferrer">فتح المنشور ↗</a>'
        : (job.status === "failed" || job.status === "partial" ? 'لسه متنشرش' : 'قيد الانتظار')) + '</div>';
    }
    if (job.publish_instagram) {
      html += '<div>انستجرام: ' + (job.instagram_permalink
        ? '<a href="' + job.instagram_permalink + '" target="_blank" rel="noopener noreferrer">فتح المنشور ↗</a>'
        : (job.status === "failed" || job.status === "partial" ? 'لسه متنشرش' : 'قيد الانتظار')) + '</div>';
    }
    if (job.error_message && (job.status === "failed" || job.status === "partial")) {
      html += '<div style="color:var(--c-negative);">سبب المشكلة: ' + escapeHtml(job.error_message) + '</div>';
    }
    if (job.status === "pending") {
      html += '<div style="margin-top:4px;"><button class="btn ghost sm" data-cancel-meta-job="' + job.id + '">إلغاء النشر التلقائي</button></div>';
    }
    html += '</div>';
    return html;
  }

  function itemPlatforms(i) {
    var p = i.publish_platforms || i.publish_platform || [];
    return Array.isArray(p) ? p : (p ? [p] : []);
  }

  function nonMetaPlatforms(platforms) {
    return (platforms || []).filter(function (p) { return META_PLATFORMS.indexOf(p) === -1; });
  }

  function updateManualLinkVisibility(id) {
    var platforms = W.readPlatformCheckboxes("pb-platform-" + id);
    var manualWrap = document.getElementById("pb-manual-wrap-" + id);
    var metaHint = document.getElementById("pb-meta-hint-" + id);
    if (manualWrap) manualWrap.style.display = nonMetaPlatforms(platforms).length ? "block" : "none";
    if (metaHint) metaHint.style.display = hasMetaPlatform(platforms) ? "block" : "none";
  }

  function renderCard(i, adminsById, mode, job) {
    var ownerName = (adminsById[i.created_by] || {}).name || "—";
    var designerName = i.assigned_designer ? ((adminsById[i.assigned_designer] || {}).name || "—") : "—";
    var scheduledLine = (mode === "scheduled" && i.scheduled_publish_at)
      ? '<span style="color:var(--c-muted);font-size:12px;">ميعاد النشر: <b>' + new Date(i.scheduled_publish_at).toLocaleString("ar-EG") + '</b></span>'
      : "";
    var platformsNow = itemPlatforms(i);
    var manualScheduled = nonMetaPlatforms(platformsNow);

    var jobHtml = jobStatusHtml(job);
    var jobIsLive = job && ["pending", "processing", "published", "partial"].indexOf(job.status) !== -1;

    var actionsHtml;
    if (mode === "ready") {
      actionsHtml =
        '<div class="field"><label>المادة دي لصفحة</label>' + W.brandSelectHtml("pb-brand-" + i.id, i.brand || "") + '</div>' +
        '<div class="field"><label>هتتنشر على (تقدر تختار أكتر من منصة)</label><div id="pb-platform-' + i.id + '">' + W.platformCheckboxesHtml("pb-platform-" + i.id, i.publish_platforms || i.publish_platform || []) + '</div></div>' +
        '<div id="pb-meta-hint-' + i.id + '" style="display:none;margin:6px 0 10px;padding:8px 10px;border:1px solid var(--c-border);border-radius:8px;color:var(--c-muted);font-size:12px;">فيسبوك/انستجرام: رابط المنشور بيتسجل تلقائيًا بعد نجاح النشر.</div>' +
        '<div class="field"><label>معاد النشر المجدول</label><input type="datetime-local" id="pb-when-' + i.id + '"></div>' +
        '<div id="pb-manual-wrap-' + i.id + '" style="display:none;">' +
        '<div class="field"><label>رابط المنشور للمنصات اليدوية فقط (تيكتوك/يوتيوب/الموقع)</label>' +
        '<input placeholder="https://..." id="pb-url-' + i.id + '"></div>' +
        '</div>' +
        '<div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center;margin-top:6px;">' +
        '<button class="btn" data-schedule="' + i.id + '">جدولة</button>' +
        '<button class="btn ghost" data-publish-now="' + i.id + '">نشر الآن</button>' +
        '</div>' + jobHtml;
    } else {
      actionsHtml = jobHtml;
      if (!jobIsLive) {
        if (manualScheduled.length) {
          actionsHtml +=
            '<div class="field"><label>رابط المنشور للمنصات اليدوية فقط</label><input placeholder="https://..." id="pb-url-' + i.id + '"></div>' +
            '<div style="display:flex;gap:8px;margin-top:6px;">' +
            '<button class="btn" data-confirm-publish="' + i.id + '">تأكيد النشر يدويًا</button>' +
            '<button class="btn ghost" data-cancel-schedule="' + i.id + '">إلغاء الجدولة</button>' +
            '</div>';
        } else {
          actionsHtml +=
            '<div style="margin-top:8px;padding:8px 10px;border:1px solid var(--c-border);border-radius:8px;color:var(--c-muted);font-size:12px;">روابط Facebook/Instagram هتتسجل تلقائيًا بعد نجاح النشر.</div>' +
            '<div style="display:flex;gap:8px;margin-top:6px;">' +
            '<button class="btn ghost" data-cancel-schedule="' + i.id + '">إلغاء الجدولة</button>' +
            '</div>';
        }
      } else if (job.status !== "pending" && job.status !== "processing") {
        actionsHtml += '<div style="display:flex;gap:8px;margin-top:6px;">' +
          '<button class="btn ghost" data-cancel-schedule="' + i.id + '">إلغاء الجدولة والرجوع لجاهزة للنشر</button>' +
          '</div>';
      }
    }

    var statusLabel = mode === "scheduled" ? "مجدولة" : "جاهزة للنشر";
    return '<div class="section" style="border:1px solid var(--c-border);border-radius:12px;padding:12px 14px;margin-bottom:10px;">' +
      '<div style="display:flex;gap:12px;align-items:center;justify-content:space-between;flex-wrap:wrap;">' +
      '<div style="min-width:0;flex:1;">' +
      '<div class="title" style="font-weight:800;margin-bottom:4px;">' + escapeHtml(i.title) + W.brandBadgeHtml(i.brand) + '</div>' +
      '<div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;">' +
      '<span class="status-pill ' + (mode === "scheduled" ? "received" : "approved") + '">' + statusLabel + '</span>' +
      scheduledLine +
      '</div>' +
      '</div>' +
      '<button class="btn ghost sm" data-toggle-publish-details="' + i.id + '">فتح التفاصيل</button>' +
      '</div>' +
      '<div id="publish-details-' + i.id + '" style="display:none;margin-top:12px;padding-top:12px;border-top:1px solid var(--c-border);">' +
      '<div class="meta">بواسطة: ' + escapeHtml(ownerName) + ' · مصمم: ' + escapeHtml(designerName) + '</div>' +
      (i.body ? '<p style="white-space:pre-wrap;margin:8px 0;">' + escapeHtml(i.body) + '</p>' : '') +
      (i.design_file_url ? '<p><a href="' + i.design_file_url + '" target="_blank" class="btn ghost sm">فتح ملف التصميم المعتمد</a></p>' : '<p style="color:var(--c-muted);font-size:12px;">مفيش ملف تصميم مرفوع</p>') +
      actionsHtml +
      '<div id="comments-slot-' + i.id + '" style="margin-top:10px;"></div>' +
      '</div>' +
      '</div>';
  }

  function wire(container) {
    container.querySelectorAll("[data-toggle-publish-details]").forEach(function (btn) {
      btn.onclick = function () {
        var id = btn.getAttribute("data-toggle-publish-details");
        var box = document.getElementById("publish-details-" + id);
        if (!box) return;
        var open = box.style.display !== "none";
        box.style.display = open ? "none" : "block";
        btn.textContent = open ? "فتح التفاصيل" : "إخفاء التفاصيل";
        if (!open) updateManualLinkVisibility(id);
      };
    });
    container.querySelectorAll(".platform-cb").forEach(function (cb) {
      cb.addEventListener("change", function () {
        var m = (cb.id || "").match(/^pb-platform-(.+?)-(facebook|instagram|tiktok|youtube|website|email)$/);
        if (m) updateManualLinkVisibility(m[1]);
      });
    });
    container.querySelectorAll("[data-schedule]").forEach(function (btn) {
      btn.onclick = function () { schedule(btn.getAttribute("data-schedule")); };
    });
    container.querySelectorAll("[data-publish-now]").forEach(function (btn) {
      btn.onclick = function () { publishNow(btn.getAttribute("data-publish-now")); };
    });
    container.querySelectorAll("[data-confirm-publish]").forEach(function (btn) {
      btn.onclick = function () { confirmPublish(btn.getAttribute("data-confirm-publish")); };
    });
    container.querySelectorAll("[data-cancel-schedule]").forEach(function (btn) {
      btn.onclick = function () { cancelSchedule(btn.getAttribute("data-cancel-schedule"), btn); };
    });
    container.querySelectorAll("[data-cancel-meta-job]").forEach(function (btn) {
      btn.onclick = function () { cancelMetaJob(btn.getAttribute("data-cancel-meta-job")); };
    });
  }

  // بديل alert() — رسالة toast مش بلوكينج (alert() ممكن يتمنع/يتجاهل جوه متصفحات
  // مدمجة في تطبيقات الموبايل زي واتساب/ماسنجر، فيبان للمستخدم إن الزرار "ماعملش حاجة")
  function notify(msg, type) {
    if (window.SSMPDToast) window.SSMPDToast.show(msg, type);
    else alert(msg);
  }

  // بيعمل meta_publish_job لو من ضمن المنصات المختارة فيسبوك/انستجرام —
  // بيتنفّذ فعليًا بواسطة Edge Function meta-publish-process (كل دقيقة).
  function maybeCreateMetaJob(id, brand, platforms, scheduledAtIso) {
    if (!hasMetaPlatform(platforms)) return Promise.resolve(null);
    var me = window.SSMPDAuth.currentAdmin;
    return window.SSMPDDb.createMetaPublishJob({
      contentId: id, brand: brand, scheduledAt: scheduledAtIso,
      publishFacebook: platforms.indexOf("facebook") !== -1,
      publishInstagram: platforms.indexOf("instagram") !== -1,
      createdBy: me.id
    });
  }

  // جدولة مادة "جاهزة للنشر" لمعاد محدد — بتنقلها لحالة "مجدولة للنشر"، وبتعمل
  // job نشر تلقائي لو من ضمن المنصات المختارة فيسبوك/انستجرام
  function schedule(id) {
    var brand = valueOf("pb-brand-" + id);
    var platforms = W.readPlatformCheckboxes("pb-platform-" + id);
    var when = valueOf("pb-when-" + id);
    if (!brand) { notify("اختر المادة دي لصفحة سونو ولا د.دينا الأول", "error"); return; }
    if (!platforms.length) { notify("اختر هتتنشر على أنهي منصة (تقدر تختار أكتر من واحدة)", "error"); return; }
    if (!when) { notify("حدد معاد النشر المجدول", "error"); return; }
    var me = window.SSMPDAuth.currentAdmin;
    var whenIso = new Date(when).toISOString();
    window.SSMPDDb.updateContentItem(id, {
      stage: "scheduled", brand: brand, publish_platform: platforms[0], publish_platforms: platforms,
      scheduled_publish_at: whenIso, scheduled_by: me.id
    }).then(function () {
      return window.SSMPDDb.logActivity({ content_id: id, actor_id: me.id, action: "جدولة للنشر", from_stage: "ready_to_publish", to_stage: "scheduled" });
    }).then(function () {
      return maybeCreateMetaJob(id, brand, platforms, whenIso);
    }).then(function () {
      notify(hasMetaPlatform(platforms) ? "تمت الجدولة — فيسبوك/انستجرام هينشروا تلقائيًا في المعاد ده" : "تمت الجدولة");
      render(document.getElementById("view-container"));
    }).catch(function (e) { notify("خطأ: " + e.message, "error"); });
  }

  // نشر فوري — لو من ضمن المنصات فيسبوك/انستجرام، بيعمل job نشر تلقائي فوري
  // (scheduled_at = الآن، الـEdge Function هتاخده في تشغيلة الدقيقة الجاية).
  // لمنصات تانية (تيكتوك/يوتيوب/الموقع) لازم رابط يدوي زي ما كان.
  function publishNow(id) {
    var brand = valueOf("pb-brand-" + id);
    var platforms = W.readPlatformCheckboxes("pb-platform-" + id);
    var url = valueOf("pb-url-" + id);
    var metaSelected = hasMetaPlatform(platforms);
    var others = platforms.filter(function (p) { return META_PLATFORMS.indexOf(p) === -1; });
    if (!brand) { notify("اختر المادة دي لصفحة سونو ولا د.دينا الأول", "error"); return; }
    if (!platforms.length) { notify("اختر هتتنشر على أنهي منصة (تقدر تختار أكتر من واحدة)", "error"); return; }
    if (others.length && !url) { notify("حط رابط المنشور للمنصات غير فيسبوك/انستجرام", "error"); return; }
    if (!others.length && !metaSelected) { notify("مفيش منصة مختارة", "error"); return; }

    var me = window.SSMPDAuth.currentAdmin;
    var nowIso = new Date().toISOString();

    if (metaSelected) {
      // فيسبوك/انستجرام: جدولة فورية (stage="scheduled" بمعاد = الآن) —
      // بتتحول لـ"published" تلقائيًا بعد ما الـEdge Function تنشر فعليًا.
      // رابط المنصات التانية (لو موجود) بيتسجّل في published_urls لكل منصة
      // على حدة — عشان الـEdge Function متكتبش فوقه لما تنشر Meta بعد كده
      // (بند ١ من المراجعة المعمارية).
      var otherUrlsPatch = {};
      others.forEach(function (p) { otherUrlsPatch[p] = url; });
      window.SSMPDDb.updateContentItem(id, {
        stage: "scheduled", brand: brand, publish_platform: platforms[0], publish_platforms: platforms,
        scheduled_publish_at: nowIso, scheduled_by: me.id,
        published_url: others.length ? url : null,
        published_urls: otherUrlsPatch
      }).then(function () {
        return window.SSMPDDb.logActivity({ content_id: id, actor_id: me.id, action: "نشر فوري (تلقائي)", from_stage: "ready_to_publish", to_stage: "scheduled" });
      }).then(function () {
        return maybeCreateMetaJob(id, brand, platforms, nowIso);
      }).then(function () {
        notify("هينشر تلقائيًا خلال دقيقة تقريبًا — تقدر تتابع الحالة هنا");
        render(document.getElementById("view-container"));
      }).catch(function (e) { notify("خطأ: " + e.message, "error"); });
      return;
    }

    // مفيش فيسبوك/انستجرام مختارين — نفس السلوك اليدوي القديم بالكامل
    window.SSMPDDb.updateContentItem(id, {
      stage: "published", published_url: url, published_by: me.id, published_at: nowIso,
      brand: brand, publish_platform: platforms[0], publish_platforms: platforms
    }).then(function (updated) {
      window.SSMPDDrive.logPublished(id, updated.title, url, updated.stage_history).catch(function () {});
      return window.SSMPDDb.logActivity({ content_id: id, actor_id: me.id, action: "نشر", from_stage: "ready_to_publish", to_stage: "published" });
    }).then(function () {
      notify("اتنشرت — هتظهر في الملخص والأرشيف دلوقتي");
      render(document.getElementById("view-container"));
    }).catch(function (e) { notify("خطأ: " + e.message, "error"); });
  }

  // تأكيد يدوي إن المادة المجدولة اتنشرت (لمنصات غير فيسبوك/انستجرام بس —
  // لو فيه job نشر تلقائي شغّال، الزرار ده مبيظهرش خالص).
  function confirmPublish(id) {
    var url = valueOf("pb-url-" + id);
    if (!url) { notify("حط رابط المنشور الأول", "error"); return; }
    var me = window.SSMPDAuth.currentAdmin;
    // بند ١ من المراجعة المعمارية (٢٠٢٦-٠٩-٠٨): قبل الكتابة، نجيب حالة المادة
    // الحالية — لو فيها رابط Meta تلقائي متسجل بالفعل (من منصة تانية غير اللي
    // بنأكدها هنا)، منكتبش فوقه في published_url، وبنسجل رابطنا في
    // published_urls لكل منصة على حدة بدل ما نكلبش القديم.
    window.SSMPDDb.getContentItem(id).then(function (current) {
      var mergedUrls = Object.assign({}, (current && current.published_urls) || {});
      var platform = (current && current.publish_platform) || "manual";
      mergedUrls[platform] = url;
      var patch = {
        stage: "published", published_by: me.id, published_at: new Date().toISOString(),
        published_url: (current && current.published_url) ? current.published_url : url,
        published_urls: mergedUrls
      };
      return window.SSMPDDb.updateContentItem(id, patch);
    }).then(function (updated) {
      window.SSMPDDrive.logPublished(id, updated.title, url, updated.stage_history).catch(function () {});
      return window.SSMPDDb.logActivity({ content_id: id, actor_id: me.id, action: "تأكيد نشر مجدول", from_stage: "scheduled", to_stage: "published" });
    }).then(function () {
      notify("اتأكد النشر — هتظهر في الملخص والأرشيف دلوقتي");
      render(document.getElementById("view-container"));
    }).catch(function (e) { notify("خطأ: " + e.message, "error"); });
  }

  // إلغاء الجدولة — تأكيد بضغطة تانية على نفس الزرار بدل نافذة confirm() المتصفح
  // (زي alert()، confirm() ممكن يتمنع جوه متصفحات مدمجة في تطبيقات الموبايل)
  function cancelSchedule(id, btn) {
    if (btn && !btn.classList.contains("confirm-pending")) {
      btn.classList.add("confirm-pending");
      btn.textContent = "متأكد؟ دوس تاني للإلغاء";
      btn._cancelTimer = setTimeout(function () {
        btn.classList.remove("confirm-pending");
        btn.textContent = "إلغاء الجدولة";
      }, 4000);
      return;
    }
    if (btn && btn._cancelTimer) clearTimeout(btn._cancelTimer);
    var me = window.SSMPDAuth.currentAdmin;
    window.SSMPDDb.updateContentItem(id, { stage: "ready_to_publish", scheduled_publish_at: null, scheduled_by: null })
      .then(function () {
        return window.SSMPDDb.logActivity({ content_id: id, actor_id: me.id, action: "إلغاء جدولة النشر", from_stage: "scheduled", to_stage: "ready_to_publish" });
      })
      .then(function () {
        notify("اتلغت الجدولة");
        render(document.getElementById("view-container"));
      })
      .catch(function (e) { notify("خطأ: " + e.message, "error"); });
  }

  // إلغاء job النشر التلقائي (فيسبوك/انستجرام) لسه pending — الـRLS بتمنع
  // إلغاء job خلص معالجة (processing/published/...) عن قصد.
  function cancelMetaJob(jobId) {
    window.SSMPDDb.cancelMetaPublishJob(jobId).then(function () {
      notify("اتلغى النشر التلقائي لهذه المادة");
      render(document.getElementById("view-container"));
    }).catch(function (e) { notify("خطأ: " + e.message, "error"); });
  }

  window.SSMPDRenderPublish = { render: render };
})();
