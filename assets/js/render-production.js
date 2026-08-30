/* SSMPD — شاشة إنتاج المحتوى (موظف الصفحات) */
(function () {
  "use strict";
  var W = window.SSMPDWorkflow;
  var C = window.SSMPDComments;

  function escapeHtml(s) {
    return String(s == null ? "" : s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  }

  function stagePillClass(stage) {
    if (stage === "published") return "published";
    if (stage === "needs_revision") return "revision";
    if (stage === "scheduled") return "received";
    if (stage === "ready_to_publish") return "approved";
    if (stage === "idea_selection") return "draft";
    return "approval";
  }

  function render(container) {
    var me = window.SSMPDAuth.currentAdmin;
    container.innerHTML = '<div class="loading">بيحمّل…</div>';

    Promise.all([
      window.SSMPDDb.listContentItems({ createdBy: me.id }),
      window.SSMPDDb.listAllComments(),
      window.SSMPDDb.listMyCommentReads(me.id)
    ]).then(function (res) {
      var items = res[0];
      var stats = C.computeCommentStats(res[1], res[2], me.id);

      var html = '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px;">' +
        '<h2>إنتاج المحتوى</h2><button class="btn" id="new-content-btn">+ فكرة/محتوى جديد</button></div>';

      html += '<div class="section"><h3>كل المواد بتاعتي (' + items.length + ')</h3>';
      if (!items.length) {
        html += '<div class="empty-state">لسه مفيش محتوى — ابدأ بفكرة جديدة</div>';
      } else {
        html += '<table class="simple"><thead><tr><th>العنوان</th><th>الحالة</th><th>آخر تحديث</th><th></th></tr></thead><tbody>';
        items.forEach(function (i) {
          html += '<tr><td><span class="link-open" data-open="' + i.id + '">' + escapeHtml(i.title) + '</span>' + W.brandBadgeHtml(i.brand) + W.specialtyBadgeHtml(i.specialty) + '</td>' +
            '<td><span class="status-pill ' + stagePillClass(i.stage) + '">' + W.stageLabel(i.stage) + '</span></td>' +
            '<td>' + new Date(i.updated_at).toLocaleDateString("ar-EG") + '</td>' +
            '<td><button class="btn ghost sm" data-open="' + i.id + '">فتح</button> ' + C.commentButtonHtml(i.id, stats) + '</td></tr>';
        });
        html += '</tbody></table>';
      }
      html += '</div>';

      container.innerHTML = html;

      document.getElementById("new-content-btn").onclick = openCreateModal;
      container.querySelectorAll("[data-open]").forEach(function (btn) {
        btn.onclick = function () { openViewModal(btn.getAttribute("data-open")); };
      });
      container.querySelectorAll("[data-comment]").forEach(function (btn) {
        btn.onclick = function () { openViewModal(btn.getAttribute("data-comment")); };
      });
    }).catch(function (e) {
      container.innerHTML = '<div class="err-msg">خطأ: ' + e.message + '</div>';
    });
  }

  function openCreateModal() {
    var backdrop = document.createElement("div");
    backdrop.className = "modal-backdrop";
    backdrop.innerHTML = '<div class="modal"><div class="modal-head"><h3>فكرة/محتوى جديد</h3>' +
      '<button class="modal-close">×</button></div>' +
      '<div class="field"><label>العنوان</label><input id="cf-title" placeholder="عنوان المحتوى"></div>' +
      '<div class="field"><label>المادة دي لصفحة</label>' + W.brandSelectHtml("cf-brand", "") + '</div>' +
      '<div class="field"><label>التخصص</label>' + W.specialtySelectHtml("cf-specialty", "") + '</div>' +
      '<div class="field"><label>نص المحتوى</label><textarea id="cf-body" placeholder="اكتب الفكرة والنص..."></textarea></div>' +
      '<div style="text-align:left;margin-top:10px;"><button class="btn" id="cf-submit">إرسال للاعتماد الأولي</button> ' +
      '<button class="btn ghost" id="cf-draft">حفظ كمسودة</button></div></div>';
    document.body.appendChild(backdrop);
    backdrop.querySelector(".modal-close").onclick = function () { backdrop.remove(); };
    backdrop.onclick = function (e) { if (e.target === backdrop) backdrop.remove(); };

    function submit(stage) {
      var title = document.getElementById("cf-title").value.trim();
      var body = document.getElementById("cf-body").value.trim();
      var brand = document.getElementById("cf-brand").value;
      var specialty = document.getElementById("cf-specialty").value;
      if (!title) { alert("اكتب عنوان الأول"); return; }
      if (!brand) { alert("اختر المادة دي لصفحة سونو ولا د.دينا"); return; }
      var me = window.SSMPDAuth.currentAdmin;
      window.SSMPDDb.createContentItem({ title: title, body: body, stage: stage, created_by: me.id, brand: brand, specialty: specialty || null })
        .then(function (row) {
          window.SSMPDDrive.logIdea(row.id, title).catch(function () {});
          window.SSMPDDb.logUsageActivity(me.id, "إنشاء مادة محتوى", title).catch(function () {});
          return window.SSMPDDb.logActivity({ content_id: row.id, actor_id: me.id, action: "إنشاء", from_stage: null, to_stage: stage });
        }).then(function () {
          backdrop.remove();
          render(document.getElementById("view-container"));
        }).catch(function (e) { alert("خطأ: " + e.message); });
    }
    document.getElementById("cf-submit").onclick = function () { submit("initial_approval"); };
    document.getElementById("cf-draft").onclick = function () { submit("idea_selection"); };
  }

  function openViewModal(id) {
    window.SSMPDDb.getContentItem(id).then(function (item) {
      var me = window.SSMPDAuth.currentAdmin;
      var backdrop = document.createElement("div");
      backdrop.className = "modal-backdrop";
      backdrop.innerHTML = '<div class="modal"><div class="modal-head"><h3>' + escapeHtml(item.title) + W.brandBadgeHtml(item.brand) + W.specialtyBadgeHtml(item.specialty) + '</h3>' +
        '<button class="modal-close">×</button></div>' +
        '<div class="status-pill ' + stagePillClass(item.stage) + '" style="margin-bottom:12px;">' + W.stageLabel(item.stage) + '</div>' +
        '<p style="white-space:pre-wrap;">' + escapeHtml(item.body || "") + '</p>' +
        (item.design_file_url ? '<p><a href="' + item.design_file_url + '" target="_blank" class="btn ghost sm">فتح ملف التصميم</a></p>' : '') +
        '<div style="margin:10px 0;">' + W.itemActionsHtml(item, me) + '</div>' +
        '<div id="comments-slot"></div></div>';
      document.body.appendChild(backdrop);
      backdrop.querySelector(".modal-close").onclick = function () { backdrop.remove(); };
      backdrop.onclick = function (e) { if (e.target === backdrop) backdrop.remove(); };
      W.wireItemActions(backdrop, item, function () { render(document.getElementById("view-container")); });

      window.SSMPDDb.listAdminsBasic().then(function (admins) {
        var map = {}; admins.forEach(function (a) { map[a.id] = a; });
        window.SSMPDComments.render(document.getElementById("comments-slot"), item.id, map);
      });
    });
  }

  window.SSMPDRenderProduction = { render: render };
})();
