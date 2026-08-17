/* SSMPD — شاشة إدارة المحتوى (مسؤول الاعتماد) — Kanban بـ٧ مراحل */
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
      window.SSMPDDb.listAdmins(),
      window.SSMPDDb.listAllComments(),
      window.SSMPDDb.listMyCommentReads(me.id)
    ]).then(function (res) {
        var items = res[0], admins = res[1];
        var stats = C.computeCommentStats(res[2], res[3], me.id);
        var adminsById = {}; admins.forEach(function (a) { adminsById[a.id] = a; });

        var html = '<h2 style="margin-bottom:16px;">إدارة المحتوى</h2>';

        // سكشن "جاهز للنشر" — المواد اللي خلصت تصميم واعتماد نهائي، مع اختيار الصفحة والمنصة وقت النشر
        var ready = items.filter(function (i) { return i.stage === "ready_to_publish"; });
        html += '<div class="section"><h3>جاهز للنشر (' + ready.length + ')</h3>';
        if (!ready.length) {
          html += '<div class="empty-state">مفيش مواد جاهزة للنشر دلوقتي</div>';
        } else {
          html += '<table class="simple"><thead><tr><th>العنوان</th><th>الصفحة</th><th>المنصة</th><th>رابط النشر</th><th></th></tr></thead><tbody>';
          ready.forEach(function (i) {
            html += '<tr>' +
              '<td><span class="link-open" data-open="' + i.id + '">' + escapeHtml(i.title) + '</span></td>' +
              '<td>' + W.brandSelectHtml("ready-brand-" + i.id, i.brand || "") + '</td>' +
              '<td>' + W.platformSelectHtml("ready-platform-" + i.id, i.publish_platform || "") + '</td>' +
              '<td><input id="ready-url-' + i.id + '" placeholder="https://..." style="width:100%;padding:8px 10px;border-radius:9px;border:1px solid var(--c-border);background:#FAFBFD;"></td>' +
              '<td><button class="btn sm" data-ready-publish="' + i.id + '">نشر</button></td></tr>';
          });
          html += '</tbody></table>';
        }
        html += '</div>';

        html += '<div class="kanban">';
        W.STAGES.forEach(function (s) {
          var colItems = items.filter(function (i) { return i.stage === s.key; });
          html += '<div class="kanban-col"><h4>' + s.label + '<span class="count">' + colItems.length + '</span></h4>';
          colItems.forEach(function (i) {
            var ownerName = (adminsById[i.created_by] || {}).name || "—";
            var designerName = i.assigned_designer ? ((adminsById[i.assigned_designer] || {}).name || "—") : "";
            html += '<div class="kanban-card" data-id="' + i.id + '"><div class="title">' + escapeHtml(i.title) + W.brandBadgeHtml(i.brand) + C.commentButtonHtml(i.id, stats) + '</div>' +
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
            openReviewModal(el.getAttribute("data-id"), items, admins);
          };
        });
        container.querySelectorAll("[data-comment]").forEach(function (btn) {
          btn.onclick = function (e) {
            e.stopPropagation();
            openReviewModal(btn.getAttribute("data-comment"), items, admins);
          };
        });
        container.querySelectorAll("[data-open]").forEach(function (el) {
          el.onclick = function () { openReviewModal(el.getAttribute("data-open"), items, admins); };
        });
        container.querySelectorAll("[data-ready-publish]").forEach(function (btn) {
          btn.onclick = function () { publishFromReady(btn.getAttribute("data-ready-publish")); };
        });
      }).catch(function (e) {
        container.innerHTML = '<div class="err-msg">خطأ: ' + e.message + '</div>';
      });
  }

  // نشر مباشر من سكشن "جاهز للنشر" — يطلب اختيار الصفحة والمنصة ورابط النشر
  function publishFromReady(id) {
    var brandSel = document.getElementById("ready-brand-" + id);
    var platformSel = document.getElementById("ready-platform-" + id);
    var urlInput = document.getElementById("ready-url-" + id);
    var brand = brandSel ? brandSel.value : "";
    var platform = platformSel ? platformSel.value : "";
    var url = urlInput ? urlInput.value.trim() : "";
    if (!brand) { alert("اختر المادة دي لصفحة سونو ولا د.دينا الأول"); return; }
    if (!platform) { alert("اختر هتتنشر على أنهي منصة"); return; }
    if (!url) { alert("حط رابط المنشور الأول"); return; }
    var me = window.SSMPDAuth.currentAdmin;
    window.SSMPDDb.updateContentItem(id, {
      stage: "published", published_url: url, published_by: me.id, published_at: new Date().toISOString(),
      brand: brand, publish_platform: platform
    }).then(function (updated) {
      window.SSMPDDrive.logPublished(id, updated.title, url, updated.stage_history).catch(function () {});
      return window.SSMPDDb.logActivity({ content_id: id, actor_id: me.id, action: "نشر", from_stage: "ready_to_publish", to_stage: "published" });
    }).then(function () {
      render(document.getElementById("view-container"));
    }).catch(function (e) { alert("خطأ: " + e.message); });
  }

  function openReviewModal(id, items, admins) {
    var item = items.filter(function (i) { return i.id === id; })[0];
    if (!item) return;
    var designers = admins.filter(function (a) { return a.role === "designer" && a.active; });

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

    backdrop.innerHTML = '<div class="modal"><div class="modal-head"><h3>' + escapeHtml(item.title) + W.brandBadgeHtml(item.brand) + '</h3>' +
      '<button class="modal-close">×</button></div>' +
      '<div class="status-pill approval" style="margin-bottom:12px;">' + W.stageLabel(item.stage) + '</div>' +
      '<div class="field" style="display:flex;align-items:flex-end;gap:8px;max-width:280px;">' +
      '<div style="flex:1;"><label>المادة دي لصفحة</label>' + W.brandSelectHtml("rv-brand", item.brand || "") + '</div>' +
      '<button class="btn ghost sm" id="rv-save-brand" style="margin-bottom:1px;">حفظ</button></div>' +
      '<p style="white-space:pre-wrap;">' + escapeHtml(item.body || "") + '</p>' +
      (item.design_file_url ? '<p><a href="' + item.design_file_url + '" target="_blank" class="btn ghost sm">فتح ملف التصميم</a></p>' : '') +
      '<div style="margin:6px 0 14px;">' + W.itemActionsHtml(item, window.SSMPDAuth.currentAdmin) + '</div>' +
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
      if (!newBrand) { alert("اختر المادة دي لصفحة سونو ولا د.دينا"); return; }
      window.SSMPDDb.updateContentItem(item.id, { brand: newBrand })
        .then(function () { backdrop.remove(); render(document.getElementById("view-container")); })
        .catch(function (e) { alert("خطأ: " + e.message); });
    };

    var approveBtn = document.getElementById("rv-approve");
    var rejectBtn = document.getElementById("rv-reject");
    var me = window.SSMPDAuth.currentAdmin;

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
      var box = document.getElementById("new-comment-box");
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
