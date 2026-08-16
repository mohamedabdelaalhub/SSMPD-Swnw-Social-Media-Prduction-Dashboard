/* SSMPD — شاشة التصميم (المصمم) */
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
      window.SSMPDDb.listContentItems({ assignedDesigner: me.id }),
      window.SSMPDDb.listAllComments(),
      window.SSMPDDb.listMyCommentReads(me.id)
    ]).then(function (res) {
      var items = res[0];
      var stats = C.computeCommentStats(res[1], res[2], me.id);

      var actionable = items.filter(function (i) {
        return ["in_design", "needs_revision", "final_approval"].indexOf(i.stage) !== -1;
      });
      var done = items.filter(function (i) {
        return ["ready_to_publish", "published"].indexOf(i.stage) !== -1;
      });

      var html = '<h2 style="margin-bottom:16px;">شاشة التصميم</h2>';
      html += '<div class="section"><h3>محتوى جاهز للتصميم (' + actionable.length + ')</h3>';
      if (!actionable.length) {
        html += '<div class="empty-state">مفيش تاسكات محتاجة تصميم دلوقتي</div>';
      } else {
        html += '<table class="simple"><thead><tr><th>العنوان</th><th>الحالة</th><th></th></tr></thead><tbody>';
        actionable.forEach(function (i) {
          var ds = W.designStatusFor(i);
          var statusCell = ds === "pending"
            ? '<button class="btn sm" data-receive="' + i.id + '">استلام</button>'
            : '<span class="status-pill ' + W.DESIGN_STATUS[ds].pillClass + '">' + W.DESIGN_STATUS[ds].label + '</span>';
          html += '<tr><td><span class="link-open" data-open="' + i.id + '">' + escapeHtml(i.title) + '</span></td>' +
            '<td>' + statusCell + '</td>' +
            '<td><button class="btn ghost sm" data-open="' + i.id + '">فتح</button> ' + C.commentButtonHtml(i.id, stats) + '</td></tr>';
        });
        html += '</tbody></table>';
      }
      html += '</div>';

      html += '<div class="section"><h3>المواد المعتمدة (' + done.length + ')</h3>';
      if (!done.length) {
        html += '<div class="empty-state">لسه مفيش</div>';
      } else {
        html += '<table class="simple"><thead><tr><th>العنوان</th><th>الحالة</th></tr></thead><tbody>';
        done.forEach(function (i) {
          html += '<tr><td><span class="link-open" data-open="' + i.id + '">' + escapeHtml(i.title) + '</span></td>' +
            '<td><span class="status-pill approved">' + W.stageLabel(i.stage) + '</span></td></tr>';
        });
        html += '</tbody></table>';
      }
      html += '</div>';

      container.innerHTML = html;
      container.querySelectorAll("[data-open]").forEach(function (btn) {
        btn.onclick = function () { openDesignModal(btn.getAttribute("data-open")); };
      });
      container.querySelectorAll("[data-comment]").forEach(function (btn) {
        btn.onclick = function () { openDesignModal(btn.getAttribute("data-comment")); };
      });
      container.querySelectorAll("[data-receive]").forEach(function (btn) {
        btn.onclick = function (e) {
          e.stopPropagation();
          handleReceive(btn.getAttribute("data-receive"));
        };
      });
    }).catch(function (e) {
      container.innerHTML = '<div class="err-msg">خطأ: ' + e.message + '</div>';
    });
  }

  // المصمم يدوس "استلام" فيتحول الحالة من "في انتظار الاستلام" لـ "تم الاستلام والعمل عليه"
  function handleReceive(id) {
    var me = window.SSMPDAuth.currentAdmin;
    window.SSMPDDb.updateContentItem(id, { design_received_at: new Date().toISOString() })
      .then(function () {
        return window.SSMPDDb.logActivity({ content_id: id, actor_id: me.id, action: "استلام التصميم", from_stage: "in_design", to_stage: "in_design" });
      })
      .then(function () { render(document.getElementById("view-container")); })
      .catch(function (e) { alert("خطأ: " + e.message); });
  }

  function openDesignModal(id) {
    window.SSMPDDb.getContentItem(id).then(function (item) {
      var backdrop = document.createElement("div");
      backdrop.className = "modal-backdrop";
      backdrop.innerHTML = '<div class="modal"><div class="modal-head"><h3>' + escapeHtml(item.title) + '</h3>' +
        '<button class="modal-close">×</button></div>' +
        '<p style="white-space:pre-wrap;">' + escapeHtml(item.body || "") + '</p>' +
        (item.design_file_url ? '<p><a href="' + item.design_file_url + '" target="_blank" class="btn ghost sm">فتح آخر تصميم مرفوع</a></p>' : '') +
        '<div class="upload-box" id="upload-box">اسحب ملف التصميم هنا أو اضغط للاختيار<br>' +
        '<input type="file" id="design-file-input" style="display:none;"></div>' +
        '<div id="upload-status" style="font-size:12px;color:var(--c-muted);"></div>' +
        '<div id="comments-slot"></div></div>';
      document.body.appendChild(backdrop);
      backdrop.querySelector(".modal-close").onclick = function () { backdrop.remove(); };
      backdrop.onclick = function (e) { if (e.target === backdrop) backdrop.remove(); };

      window.SSMPDDb.listAdmins().then(function (admins) {
        var map = {}; admins.forEach(function (a) { map[a.id] = a; });
        window.SSMPDComments.render(document.getElementById("comments-slot"), item.id, map);
      });

      var box = document.getElementById("upload-box");
      var input = document.getElementById("design-file-input");
      box.onclick = function () { input.click(); };
      box.ondragover = function (e) { e.preventDefault(); box.classList.add("drag"); };
      box.ondragleave = function () { box.classList.remove("drag"); };
      box.ondrop = function (e) {
        e.preventDefault(); box.classList.remove("drag");
        if (e.dataTransfer.files.length) handleUpload(e.dataTransfer.files[0], item, backdrop);
      };
      input.onchange = function () {
        if (input.files.length) handleUpload(input.files[0], item, backdrop);
      };
    });
  }

  function handleUpload(file, item, backdrop) {
    var status = document.getElementById("upload-status");
    status.textContent = "بيرفع على أرشيف Google Drive…";
    var me = window.SSMPDAuth.currentAdmin;

    window.SSMPDDrive.uploadDesignFile(file, { title: item.title, contentId: item.id })
      .then(function (res) {
        status.textContent = "اترفع بنجاح ✓";
        var newStage = item.stage === "in_design" || item.stage === "needs_revision" ? "final_approval" : item.stage;
        return window.SSMPDDb.updateContentItem(item.id, {
          design_file_url: res.fileUrl,
          design_drive_folder: res.folderUrl,
          stage: newStage
        }).then(function (updated) {
          window.SSMPDDrive.logDesignUploaded(item.id, updated.title).catch(function () {});
          return window.SSMPDDb.logActivity({ content_id: item.id, actor_id: me.id, action: "رفع تصميم", from_stage: item.stage, to_stage: newStage });
        });
      }).then(function () {
        setTimeout(function () {
          backdrop.remove();
          render(document.getElementById("view-container"));
        }, 700);
      }).catch(function (e) {
        status.textContent = "خطأ: " + e.message;
      });
  }

  window.SSMPDRenderDesign = { render: render };
})();
