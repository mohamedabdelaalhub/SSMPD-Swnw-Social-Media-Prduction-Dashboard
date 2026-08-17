/* SSMPD — تاب النشر: المواد المعتمدة (محتوى + تصميم) بتتجدول أو تتنشر من هنا */
(function () {
  "use strict";
  var W = window.SSMPDWorkflow;
  var C = window.SSMPDComments;

  function escapeHtml(s) {
    return String(s == null ? "" : s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  }

  function valueOf(id) {
    var el = document.getElementById(id);
    return el ? el.value.trim() : "";
  }

  function render(container) {
    var me = window.SSMPDAuth.currentAdmin;
    container.innerHTML = '<div class="loading">بيحمّل…</div>';
    Promise.all([
      window.SSMPDDb.listContentItems({}),
      window.SSMPDDb.listAdmins(),
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

      var html = '<h2 style="margin-bottom:16px;">النشر</h2>' +
        '<p style="color:var(--c-muted);font-size:12px;margin-top:-10px;margin-bottom:16px;">هنا كل مادة خلصت اعتماد نهائي وتصميم — جاهزة تتجدول أو تتنشر مباشرة.</p>';

      html += '<div class="section"><h3>مجدولة للنشر (' + scheduled.length + ')</h3>';
      if (!scheduled.length) {
        html += '<div class="empty-state">مفيش مواد مجدولة دلوقتي</div>';
      } else {
        scheduled.forEach(function (i) { html += renderCard(i, adminsById, stats, "scheduled"); });
      }
      html += '</div>';

      html += '<div class="section"><h3>جاهزة للنشر (' + ready.length + ')</h3>';
      if (!ready.length) {
        html += '<div class="empty-state">مفيش مواد جاهزة للنشر دلوقتي</div>';
      } else {
        ready.forEach(function (i) { html += renderCard(i, adminsById, stats, "ready"); });
      }
      html += '</div>';

      container.innerHTML = html;
      wire(container);
      scheduled.concat(ready).forEach(function (i) {
        var slot = document.getElementById("comments-slot-" + i.id);
        if (slot) window.SSMPDComments.render(slot, i.id, adminsById);
      });
    }).catch(function (e) {
      container.innerHTML = '<div class="err-msg">خطأ: ' + e.message + '</div>';
    });
  }

  function renderCard(i, adminsById, stats, mode) {
    var ownerName = (adminsById[i.created_by] || {}).name || "—";
    var designerName = i.assigned_designer ? ((adminsById[i.assigned_designer] || {}).name || "—") : "—";
    var scheduledLine = (mode === "scheduled" && i.scheduled_publish_at)
      ? '<div class="meta">معاد النشر: <b>' + new Date(i.scheduled_publish_at).toLocaleString("ar-EG") + '</b></div>'
      : "";

    var actionsHtml;
    if (mode === "ready") {
      actionsHtml =
        '<div class="field"><label>المادة دي لصفحة</label>' + W.brandSelectHtml("pb-brand-" + i.id, i.brand || "") + '</div>' +
        '<div class="field"><label>هتتنشر على</label>' + W.platformSelectHtml("pb-platform-" + i.id, i.publish_platform || "") + '</div>' +
        '<div class="field"><label>معاد النشر المجدول</label><input type="datetime-local" id="pb-when-' + i.id + '"></div>' +
        '<div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center;margin-top:6px;">' +
        '<button class="btn" data-schedule="' + i.id + '">جدولة</button>' +
        '<span style="color:var(--c-muted);font-size:11px;">أو لو اتنشرت فعلاً دلوقتي:</span>' +
        '<input placeholder="https://... رابط المنشور" id="pb-url-' + i.id + '" style="flex:1;min-width:180px;padding:8px 10px;border-radius:9px;border:1px solid var(--c-border);background:#FAFBFD;">' +
        '<button class="btn ghost" data-publish-now="' + i.id + '">نشر الآن</button>' +
        '</div>';
    } else {
      actionsHtml =
        '<div class="field"><label>رابط المنشور</label><input placeholder="https://..." id="pb-url-' + i.id + '"></div>' +
        '<div style="display:flex;gap:8px;margin-top:6px;">' +
        '<button class="btn" data-confirm-publish="' + i.id + '">تأكيد النشر</button>' +
        '<button class="btn ghost" data-cancel-schedule="' + i.id + '">إلغاء الجدولة</button>' +
        '</div>';
    }

    return '<div class="section" style="border:1px solid var(--c-border);border-radius:12px;padding:14px;margin-bottom:12px;">' +
      '<div class="title" style="font-weight:800;margin-bottom:4px;">' + escapeHtml(i.title) + W.brandBadgeHtml(i.brand) + '</div>' +
      '<div class="meta">بواسطة: ' + escapeHtml(ownerName) + ' · مصمم: ' + escapeHtml(designerName) + '</div>' +
      scheduledLine +
      (i.body ? '<p style="white-space:pre-wrap;margin:8px 0;">' + escapeHtml(i.body) + '</p>' : '') +
      (i.design_file_url ? '<p><a href="' + i.design_file_url + '" target="_blank" class="btn ghost sm">فتح ملف التصميم المعتمد</a></p>' : '<p style="color:var(--c-muted);font-size:12px;">مفيش ملف تصميم مرفوع</p>') +
      actionsHtml +
      '<div id="comments-slot-' + i.id + '" style="margin-top:10px;"></div>' +
      '</div>';
  }

  function wire(container) {
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
  }

  // بديل alert() — رسالة toast مش بلوكينج (alert() ممكن يتمنع/يتجاهل جوه متصفحات
  // مدمجة في تطبيقات الموبايل زي واتساب/ماسنجر، فيبان للمستخدم إن الزرار "ماعملش حاجة")
  function notify(msg, type) {
    if (window.SSMPDToast) window.SSMPDToast.show(msg, type);
    else alert(msg);
  }

  // جدولة مادة "جاهزة للنشر" لمعاد محدد — بتنقلها لحالة "مجدولة للنشر" لحد ما حد يأكد إنها اتنشرت فعلاً
  function schedule(id) {
    var brand = valueOf("pb-brand-" + id);
    var platform = valueOf("pb-platform-" + id);
    var when = valueOf("pb-when-" + id);
    if (!brand) { notify("اختر المادة دي لصفحة سونو ولا د.دينا الأول", "error"); return; }
    if (!platform) { notify("اختر هتتنشر على أنهي منصة", "error"); return; }
    if (!when) { notify("حدد معاد النشر المجدول", "error"); return; }
    var me = window.SSMPDAuth.currentAdmin;
    window.SSMPDDb.updateContentItem(id, {
      stage: "scheduled", brand: brand, publish_platform: platform,
      scheduled_publish_at: new Date(when).toISOString(), scheduled_by: me.id
    }).then(function () {
      return window.SSMPDDb.logActivity({ content_id: id, actor_id: me.id, action: "جدولة للنشر", from_stage: "ready_to_publish", to_stage: "scheduled" });
    }).then(function () {
      notify("تمت الجدولة");
      render(document.getElementById("view-container"));
    }).catch(function (e) { notify("خطأ: " + e.message, "error"); });
  }

  // نشر فوري من غير جدولة — لمادة اتنشرت فعلاً ومحتاجين بس نسجل الرابط
  function publishNow(id) {
    var brand = valueOf("pb-brand-" + id);
    var platform = valueOf("pb-platform-" + id);
    var url = valueOf("pb-url-" + id);
    if (!brand) { notify("اختر المادة دي لصفحة سونو ولا د.دينا الأول", "error"); return; }
    if (!platform) { notify("اختر هتتنشر على أنهي منصة", "error"); return; }
    if (!url) { notify("حط رابط المنشور الأول", "error"); return; }
    var me = window.SSMPDAuth.currentAdmin;
    window.SSMPDDb.updateContentItem(id, {
      stage: "published", published_url: url, published_by: me.id, published_at: new Date().toISOString(),
      brand: brand, publish_platform: platform
    }).then(function (updated) {
      window.SSMPDDrive.logPublished(id, updated.title, url, updated.stage_history).catch(function () {});
      return window.SSMPDDb.logActivity({ content_id: id, actor_id: me.id, action: "نشر", from_stage: "ready_to_publish", to_stage: "published" });
    }).then(function () {
      notify("اتنشرت — هتظهر في الملخص والأرشيف دلوقتي");
      render(document.getElementById("view-container"));
    }).catch(function (e) { notify("خطأ: " + e.message, "error"); });
  }

  // تأكيد إن المادة المجدولة اتنشرت فعلاً — بيقفل الحلقة ويحفظ رابط المنشور
  function confirmPublish(id) {
    var url = valueOf("pb-url-" + id);
    if (!url) { notify("حط رابط المنشور الأول", "error"); return; }
    var me = window.SSMPDAuth.currentAdmin;
    window.SSMPDDb.updateContentItem(id, {
      stage: "published", published_url: url, published_by: me.id, published_at: new Date().toISOString()
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

  window.SSMPDRenderPublish = { render: render };
})();
