/* SSMPD — شاشة إدارة المحتوى (مسؤول الاعتماد) — Kanban بـ٨ مراحل */
(function () {
  "use strict";
  var W = window.SSMPDWorkflow;
  var C = window.SSMPDComments;

  function escapeHtml(s) {
    return String(s == null ? "" : s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  }

  function render(container) {
    var me = window.SSMPDAuth.currentAdmin;
    container.innerHTML = '<div class="loading">بيحمّل…</div>';
    Promise.all([
      window.SSMPDDb.listContentItems({}),
      window.SSMPDDb.listAdminsBasic(),
      window.SSMPDDb.listAllComments(),
      window.SSMPDDb.listMyCommentReads(me.id),
      window.SSMPDDb.listDesignersAll().catch(function () { return []; }),
      window.SSMPDDb.getAppSettings().catch(function () { return null; })
    ]).then(function (res) {
        var items = res[0], admins = res[1];
        var stats = C.computeCommentStats(res[2], res[3], me.id);
        var designersAll = res[4] || [];
        var settings = res[5];
        var adminsById = {}; admins.forEach(function (a) { adminsById[a.id] = a; });

        var html = '<h2 style="margin-bottom:16px;">إدارة المحتوى</h2>';

        // تنبيه SLA: مواد واقفة في مرحلة اعتماد (أولي أو نهائي) من غير حركة
        // لأكتر من حد SLA (قابل للتعديل من لوحة الأدمن، افتراضي ٤٨ ساعة) —
        // بيتحسب من نفس الـ items المُحمّلة بالفعل، من غير أي نداء إضافي
        // للسيرفر (`updated_at` بيتحدّث تلقائياً مع كل تغيير في المادة).
        var slaHours = (settings && settings.content_sla_hours) || 48;
        var slaMs = slaHours * 60 * 60 * 1000;
        var nowTs = Date.now();
        var stuckItems = items.filter(function (i) {
          return (i.stage === "initial_approval" || i.stage === "final_approval") &&
            i.updated_at && (nowTs - new Date(i.updated_at).getTime()) > slaMs;
        });
        if (stuckItems.length) {
          html += '<div class="section" style="border-inline-start:3px solid var(--c-negative);">' +
            '<h3 style="color:var(--c-negative);">⚠ مواد متأخرة في الاعتماد (' + stuckItems.length + ')</h3>' +
            '<p style="font-size:12px;color:var(--c-muted);margin-bottom:8px;">من غير حركة لأكتر من ' + slaHours + ' ساعة:</p><ul style="margin:0;padding-inline-start:18px;font-size:13px;">' +
            stuckItems.map(function (i) { return '<li>' + escapeHtml(i.title) + '</li>'; }).join("") +
            '</ul></div>';
        }

        html += '<div class="kanban">';
        W.STAGES.forEach(function (s) {
          var colItems = items.filter(function (i) { return i.stage === s.key; });
          html += '<div class="kanban-col"><h4>' + s.label + '<span class="count">' + colItems.length + '</span></h4>';
          colItems.forEach(function (i) {
            var ownerName = (adminsById[i.created_by] || {}).name || "—";
            var designerName = i.assigned_designer ? ((adminsById[i.assigned_designer] || {}).name || "—") : "";
            html += '<div class="kanban-card" data-id="' + i.id + '"><div class="title">' + escapeHtml(i.title) + W.brandBadgeHtml(i.brand) + W.specialtyBadgeHtml(i.specialty) + C.commentButtonHtml(i.id, stats) + '</div>' +
              '<div class="meta">بواسطة: ' + escapeHtml(ownerName) + (designerName ? " · مصمم: " + escapeHtml(designerName) : "") + '</div></div>';
          });
          if (!colItems.length) html += '<div style="text-align:center;color:var(--c-muted);font-size:11px;padding:10px 0;">فارغ</div>';
          html += '</div>';
        });
        html += '</div>';

        container.innerHTML = html;
        container.querySelectorAll("[data-id]").forEach(function (el) {
          el.onclick = function (e) {
            if (e.target.closest("[data-comment]")) return; // زرار الكومنت له نفس أثر فتح المودال أصلاً
            openReviewModal(el.getAttribute("data-id"), items, admins, designersAll);
          };
        });
        container.querySelectorAll("[data-comment]").forEach(function (btn) {
          btn.onclick = function (e) {
            e.stopPropagation();
            openReviewModal(btn.getAttribute("data-comment"), items, admins, designersAll);
          };
        });
        container.querySelectorAll("[data-open]").forEach(function (el) {
          el.onclick = function () { openReviewModal(el.getAttribute("data-open"), items, admins, designersAll); };
        });

        // فتح تلقائي لو المستخدم جاي من البحث الموحّد في الشريط العلوي (مرحلة ٦)
        if (window.SSMPDPendingOpenContentId) {
          var pendingId = window.SSMPDPendingOpenContentId;
          window.SSMPDPendingOpenContentId = null;
          if (items.some(function (i) { return i.id === pendingId; })) openReviewModal(pendingId, items, admins, designersAll);
        }
      }).catch(function (e) {
        container.innerHTML = '<div class="err-msg">خطأ: ' + e.message + '</div>';
      });
  }

  function openReviewModal(id, items, admins, designersAll) {
    var item = items.filter(function (i) { return i.id === id; })[0];
    if (!item) return;
    // designersAll (list_designers_all RPC) بيشمل الرول الأساسي والإضافي —
    // fallback لفلترة admins القديمة (رول أساسي بس) لو الدالة لسه مش
    // منشورة على القاعدة الحية.
    var designers = (designersAll && designersAll.length) ? designersAll : admins.filter(function (a) { return a.role === "designer" && a.active; });

    var backdrop = document.createElement("div");
    backdrop.className = "modal-backdrop";
    var actionsHtml = "";

    if (item.stage === "initial_approval") {
      actionsHtml = '<div class="field"><label>اختر المصمم</label><select id="rv-designer">' +
        '<option value="">— اختر —</option>' +
        designers.map(function (d) { return '<option value="' + d.id + '">' + escapeHtml(d.name || d.email) + '</option>'; }).join("") +
        '</select></div>' +
        '<div style="display:flex;gap:8px;"><button class="btn" id="rv-approve">اعتماد أولي — أرسل للتصميم</button>' +
        '<button class="btn danger" id="rv-reject">طلب تعديل</button></div>';
    } else if (item.stage === "final_approval") {
      actionsHtml = '<div style="display:flex;gap:8px;"><button class="btn" id="rv-approve">اعتماد نهائي — جاهز للنشر</button>' +
        '<button class="btn danger" id="rv-reject">طلب تعديل</button></div>';
    } else {
      actionsHtml = '<p style="color:var(--c-muted);font-size:12px;">لا يوجد إجراء اعتماد على هذه المرحلة حالياً.</p>';
    }

    // تغيير المصمم المسؤول — متاح في أي مرحلة بعد ما يتحدد مصمم (حتى لو الشغل بدأ)
    var reassignHtml = "";
    if (item.assigned_designer) {
      reassignHtml = '<div class="field" style="margin-top:10px;"><label>المصمم المسؤول</label>' +
        '<div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;">' +
        '<select id="rv-reassign">' +
        designers.map(function (d) {
          return '<option value="' + d.id + '" ' + (d.id === item.assigned_designer ? "selected" : "") + '>' + escapeHtml(d.name || d.email) + '</option>';
        }).join("") +
        '</select>' +
        '<button class="btn ghost sm" id="rv-reassign-btn">تغيير المصمم</button></div></div>';
    }

    backdrop.innerHTML = '<div class="modal"><div class="modal-head"><h3>' + escapeHtml(item.title) + W.brandBadgeHtml(item.brand) + W.specialtyBadgeHtml(item.specialty) + '</h3>' +
      '<button class="modal-close">×</button></div>' +
      '<div class="status-pill approval" style="margin-bottom:12px;">' + W.stageLabel(item.stage) + '</div>' +
      '<div class="field" style="display:flex;align-items:flex-end;gap:8px;max-width:400px;flex-wrap:wrap;">' +
      '<div style="flex:1;min-width:140px;"><label>المادة دي لصفحة</label>' + W.brandSelectHtml("rv-brand", item.brand || "") + '</div>' +
      '<div style="flex:1;min-width:140px;"><label>التخصص</label>' + W.specialtySelectHtml("rv-specialty", item.specialty || "") + '</div>' +
      '<button class="btn ghost sm" id="rv-save-brand" style="margin-bottom:1px;">حفظ</button></div>' +
      '<p style="white-space:pre-wrap;">' + escapeHtml(item.body || "") + '</p>' +
      (item.design_file_url ? '<p><a href="' + item.design_file_url + '" target="_blank" class="btn ghost sm">فتح ملف التصميم</a></p>' : '') +
      '<div style="margin:6px 0 14px;">' + W.itemActionsHtml(item, window.SSMPDAuth.currentAdmin) + '</div>' +
      reassignHtml +
      '<div style="margin:14px 0;">' + actionsHtml + '</div>' +
      '<div id="comments-slot"></div></div>';
    document.body.appendChild(backdrop);
    backdrop.querySelector(".modal-close").onclick = function () { backdrop.remove(); };
    backdrop.onclick = function (e) { if (e.target === backdrop) backdrop.remove(); };
    W.wireItemActions(backdrop, item, function () { render(document.getElementById("view-container")); });

    var adminsById = {}; admins.forEach(function (a) { adminsById[a.id] = a; });
    window.SSMPDComments.render(document.getElementById("comments-slot"), item.id, adminsById);

    // تعديل الصفحة (سونو/د.دينا) في أي وقت من هنا لو حصل غلط عند الإنشاء
    document.getElementById("rv-save-brand").onclick = function () {
      var newBrand = document.getElementById("rv-brand").value;
      var newSpecialty = document.getElementById("rv-specialty").value;
      if (!newBrand) { alert("اختر المادة دي لصفحة سونو ولا د.دينا"); return; }
      window.SSMPDDb.updateContentItem(item.id, { brand: newBrand, specialty: newSpecialty || null })
        .then(function () { backdrop.remove(); render(document.getElementById("view-container")); })
        .catch(function (e) { alert("خطأ: " + e.message); });
    };

    var approveBtn = document.getElementById("rv-approve");
    var rejectBtn = document.getElementById("rv-reject");
    var reassignBtn = document.getElementById("rv-reassign-btn");
    var me = window.SSMPDAuth.currentAdmin;

    if (reassignBtn) reassignBtn.onclick = function () {
      var newDesignerId = document.getElementById("rv-reassign").value;
      if (!newDesignerId) { alert("اختر مصمم"); return; }
      if (newDesignerId === item.assigned_designer) { backdrop.remove(); return; }
      var oldDesignerName = (adminsById[item.assigned_designer] || {}).name || "—";
      var newDesignerName = (adminsById[newDesignerId] || {}).name || "—";
      if (!confirm("تأكيد نقل المادة من \"" + oldDesignerName + "\" إلى \"" + newDesignerName + "\"؟")) return;
      var patch = { assigned_designer: newDesignerId };
      // لو الشغل لسه في التصميم، صفّر وقت الاستلام عشان المصمم الجديد يشوفها "في انتظار الاستلام"
      if (item.stage === "in_design" || item.stage === "needs_revision") patch.design_received_at = null;
      window.SSMPDDb.updateContentItem(item.id, patch).then(function () {
        return window.SSMPDDb.logActivity({ content_id: item.id, actor_id: me.id, action: "تغيير المصمم: " + oldDesignerName + " ← " + newDesignerName, from_stage: item.stage, to_stage: item.stage });
      }).then(function () { backdrop.remove(); render(document.getElementById("view-container")); })
        .catch(function (e) { alert("خطأ: " + e.message); });
    };

    if (approveBtn) approveBtn.onclick = function () {
      var patch = {};
      var wasInitialApproval = item.stage === "initial_approval";
      if (wasInitialApproval) {
        var designerId = document.getElementById("rv-designer").value;
        if (!designerId) { alert("اختر مصمم الأول"); return; }
        patch = { stage: "in_design", assigned_designer: designerId };
      } else {
        patch = { stage: "ready_to_publish" };
      }
      window.SSMPDDb.updateContentItem(item.id, patch).then(function (updated) {
        if (wasInitialApproval) window.SSMPDDrive.logDesignSent(item.id, updated.title).catch(function () {});
        return window.SSMPDDb.logActivity({ content_id: item.id, actor_id: me.id, action: "اعتماد", from_stage: item.stage, to_stage: patch.stage });
      }).then(function () { backdrop.remove(); render(document.getElementById("view-container")); })
        .catch(function (e) { alert("خطأ: " + e.message); });
    };

    if (rejectBtn) rejectBtn.onclick = function () {
      var box = backdrop.querySelector(".new-comment-box");
      var note = box ? box.value.trim() : "";
      if (!note) { alert("لازم تكتب كومنت التعديل المطلوب في مربع الكومنتات تحت قبل الرفض"); return; }
      window.SSMPDDb.addComment({ content_id: item.id, author_id: me.id, body: "طلب تعديل: " + note }).then(function () {
        return window.SSMPDDb.updateContentItem(item.id, { stage: "needs_revision" });
      }).then(function () {
        return window.SSMPDDb.logActivity({ content_id: item.id, actor_id: me.id, action: "طلب تعديل", from_stage: item.stage, to_stage: "needs_revision" });
      }).then(function () { backdrop.remove(); render(document.getElementById("view-container")); })
        .catch(function (e) { alert("خطأ: " + e.message); });
    };
  }

  window.SSMPDRenderReview = { render: render };
})();
