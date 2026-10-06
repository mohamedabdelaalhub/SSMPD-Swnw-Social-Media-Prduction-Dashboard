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
    container.innerHTML = "<div class=\"loading\"> <!--ssmpd-i18n:%D8%A8%D9%8A%D8%AD%D9%85%D9%91%D9%84%E2%80%A6-->بيحمّل…</div>";

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

      var html = "<h2 style=\"margin-bottom:16px;\"> <!--ssmpd-i18n:%D8%B4%D8%A7%D8%B4%D8%A9%20%D8%A7%D9%84%D8%AA%D8%B5%D9%85%D9%8A%D9%85-->شاشة التصميم</h2>";
      html += '<div class="section"><h3>محتوى جاهز للتصميم (' + actionable.length + ')</h3>';
      if (!actionable.length) {
        html += '<div class="empty-state">مفيش تاسكات محتاجة تصميم دلوقتي</div>';
      } else {
        html += "<table class=\"simple\"><thead><tr><th> <!--ssmpd-i18n:%D8%A7%D9%84%D8%B9%D9%86%D9%88%D8%A7%D9%86-->العنوان</th><th> <!--ssmpd-i18n:%D8%A7%D9%84%D8%AD%D8%A7%D9%84%D8%A9-->الحالة</th><th></th></tr></thead><tbody>";
        actionable.forEach(function (i) {
          var ds = W.designStatusFor(i);
          var statusCell;
          if (ds === "pending") {
            statusCell = '<button class="btn sm" data-receive="' + i.id + '">استلام</button>';
          } else if (ds === "received") {
            // ضغط "استلام" بالغلط؟ رجّعها تاني لحالة "في انتظار الاستلام"
            statusCell = '<span class="status-pill ' + W.DESIGN_STATUS[ds].pillClass + '">' + W.DESIGN_STATUS[ds].label + '</span> ' +
              '<button class="btn ghost sm" data-undo-receive="' + i.id + '" title="لو ضغطت استلام بالغلط">تراجع</button>';
          } else {
            statusCell = '<span class="status-pill ' + W.DESIGN_STATUS[ds].pillClass + '">' + W.DESIGN_STATUS[ds].label + '</span>';
          }
          html += '<tr><td><span class="link-open" data-open="' + i.id + '">' + escapeHtml(i.title) + '</span>' + W.brandBadgeHtml(i.brand) + '</td>' +
            '<td>' + statusCell + '</td>' +
            '<td><button class="btn ghost sm" data-open="' + i.id + "\"> <!--ssmpd-i18n:%D9%81%D8%AA%D8%AD-->فتح</button> " + C.commentButtonHtml(i.id, stats) + '</td></tr>';
        });
        html += '</tbody></table>';
      }
      html += '</div>';

      html += '<div class="section"><h3>المواد المعتمدة (' + done.length + ')</h3>';
      if (!done.length) {
        html += '<div class="empty-state">لسه مفيش</div>';
      } else {
        html += "<table class=\"simple\"><thead><tr><th> <!--ssmpd-i18n:%D8%A7%D9%84%D8%B9%D9%86%D9%88%D8%A7%D9%86-->العنوان</th><th> <!--ssmpd-i18n:%D8%A7%D9%84%D8%AD%D8%A7%D9%84%D8%A9-->الحالة</th></tr></thead><tbody>";
        done.forEach(function (i) {
          html += '<tr><td><span class="link-open" data-open="' + i.id + '">' + escapeHtml(i.title) + '</span>' + W.brandBadgeHtml(i.brand) + '</td>' +
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
      container.querySelectorAll("[data-undo-receive]").forEach(function (btn) {
        btn.onclick = function (e) {
          e.stopPropagation();
          handleUndoReceive(btn.getAttribute("data-undo-receive"));
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

  // تراجع عن "استلام" لو المصمم ضغط عليها بالغلط — بترجّع الحالة لـ "في انتظار الاستلام"
  function handleUndoReceive(id) {
    if (!confirm("متأكد إنك عايز ترجّع الحالة لـ\"في انتظار الاستلام\"؟")) return;
    var me = window.SSMPDAuth.currentAdmin;
    window.SSMPDDb.updateContentItem(id, { design_received_at: null })
      .then(function () {
        return window.SSMPDDb.logActivity({ content_id: id, actor_id: me.id, action: "تراجع عن استلام التصميم", from_stage: "in_design", to_stage: "in_design" });
      })
      .then(function () { render(document.getElementById("view-container")); })
      .catch(function (e) { alert("خطأ: " + e.message); });
  }

  function openDesignModal(id) {
    window.SSMPDDb.getContentItem(id).then(function (item) {
      var backdrop = document.createElement("div");
      backdrop.className = "modal-backdrop";
      backdrop.innerHTML = '<div class="modal"><div class="modal-head"><h3>' + escapeHtml(item.title) + W.brandBadgeHtml(item.brand) + '</h3>' +
        '<button class="modal-close">×</button></div>' +
      W.contentFormatDetailsHtml(item) +
        '<p style="white-space:pre-wrap;">' + escapeHtml(item.body || "") + '</p>' +
        (item.design_file_url ? '<p><a href="' + item.design_file_url + '" target="_blank" class="btn ghost sm">فتح آخر تصميم مرفوع</a></p>' : '') +
        '<div style="margin:10px 0;">' + W.itemActionsHtml(item, window.SSMPDAuth.currentAdmin) + '</div>' +
        '<div id="design-studio-slot"></div>' +
        '<div class="upload-box" id="upload-box">اسحب ملف التصميم هنا أو اضغط للاختيار<br>' +
        '<input type="file" id="design-file-input" style="display:none;"></div>' +
        '<div id="upload-status" style="font-size:12px;color:var(--c-muted);"></div>' +
        W.metaLinksSectionHtml(item) +
        '<div id="comments-slot"></div></div>';
      document.body.appendChild(backdrop);
      window.SSMPDDesignStudio.mount(backdrop.querySelector("#design-studio-slot"), item);
      backdrop.querySelector(".modal-close").onclick = function () { backdrop.remove(); };
      backdrop.onclick = function (e) { if (e.target === backdrop) backdrop.remove(); };
      W.wireItemActions(backdrop, item, function () { render(document.getElementById("view-container")); });
      W.wireMetaLinksSection(backdrop, item, window.SSMPDAuth.currentAdmin);

      window.SSMPDDb.listAdminsBasic().then(function (admins) {
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
    if(backdrop.dataset.uploading)return;backdrop.dataset.uploading="1";

    (async function(){
      var res;
      if(['image/png','image/jpeg','image/webp'].includes(file.type)){
        status.textContent='حفظ التصميم على الحساب…';
        if(file.size>20*1024*1024)throw new Error('اختر صورة بحجم أقل من ٢٠ ميجابايت');
        var latest=await window.SSMPDDesignFiles.latest(item.id);
        var local=URL.createObjectURL(file),png;
        try{var image=await window.SSMPDDesignComposer.loadImage(local),canvas=document.createElement('canvas');canvas.width=image.width;canvas.height=image.height;canvas.getContext('2d').drawImage(image,0,0);png=await new Promise(function(resolve,reject){canvas.toBlob(function(blob){blob?resolve(blob):reject(new Error('تعذر تصدير التصميم'));},'image/png');});}finally{URL.revokeObjectURL(local);}
        var saved=await window.SSMPDDesignFiles.save(item,png,null,{template:'uploaded-flat-image',original_name:file.name},null,latest&&latest.id);
        res={fileUrl:saved.item.design_file_url,private:true};
        window.SSMPDDrive.uploadDesignFile(file,{title:item.title,contentId:item.id}).catch(function(){});
      }else{
        // Keep the existing PDF/video/working-file upload route.
        res=await window.SSMPDDrive.uploadDesignFile(file,{title:item.title,contentId:item.id});
      }
      var newStage=item.stage==='in_design'||item.stage==='needs_revision'?'final_approval':item.stage;
      var patch={stage:newStage};if(!res.private)patch.design_file_url=res.fileUrl;if(res.folderUrl)patch.design_drive_folder=res.folderUrl;
      var updated=await window.SSMPDDb.updateContentItem(item.id,patch);
      window.SSMPDDrive.logDesignUploaded(item.id,updated.title).catch(function(){});
      window.SSMPDDb.logUsageActivity(me.id,'رفع تصميم',file.name+' — '+item.title).catch(function(){});
      await window.SSMPDDb.logActivity({content_id:item.id,actor_id:me.id,action:'رفع تصميم',from_stage:item.stage,to_stage:newStage});
      status.textContent='تم حفظ التصميم وإرساله للمراجعة';
    })().then(function () {
        setTimeout(function () {
          backdrop.remove();
          render(document.getElementById("view-container"));
        }, 700);
      }).catch(function (e) {
        backdrop.dataset.uploading="";status.textContent = "خطأ: " + e.message;
      });
  }

  window.SSMPDRenderDesign = { render: render };
})();


