/* SSMPD — شاشة إدارة المحتوى (مسؤول الاعتماد) — Kanban بـ٨ مراحل */
(function () {
  // ===== Claude Creative: "نفّذ التصميم" =====
  // لما مصمم المادة يكون Claude Creative: اختيار (صور حقيقية / رسوم) + زرار. الطلب بيتسجل،
  // وClaude بيصمم (أو يمنتج الفيديوهات المرفوعة) خلال ساعة ويوصّل المادة للاعتماد النهائي.
  // الاعتماد بيفضل بضغطة من مسؤول الاعتماد، وبعدها Claude بيجدولها في الميعاد اللي اقترحه.
  var CLAUDE_DESIGNER_ID = "a0fbdfee-d147-4282-b988-186a9ae3e88c";
  var CLAUDE_REQ_STATUS = {
    pending: "في الطابور — Claude هيبدأ خلال ساعة",
    working: "Claude شغال على التصميم دلوقتي…",
    done: "التصميم جاهز في الاعتماد النهائي — مستني اعتمادك",
    scheduled: "اتعتمد واتجدول للنشر ✅",
    failed: "حصلت مشكلة — اطلب تاني"
  };
  function designerOptionsHtml(item, designers, selectedId) {
    var carousel = item.content_format === "carousel";
    var options = carousel ? '<option value="' + CLAUDE_DESIGNER_ID + '"' + (selectedId === CLAUDE_DESIGNER_ID ? ' selected' : '') + '>تصميم الكاروسيل بالذكاء الاصطناعي — Claude</option>' : '';
    return options + designers.filter(function (d) { return !carousel || d.id !== CLAUDE_DESIGNER_ID; }).map(function (d) {
      return '<option value="' + escapeHtml(d.id) + '"' + (d.id === selectedId ? ' selected' : '') + '>' + escapeHtml(d.name || d.email) + '</option>';
    }).join("");
  }
  function claudeDesignHtml(item) {
    if (item.assigned_designer !== CLAUDE_DESIGNER_ID || ["in_design", "needs_revision"].indexOf(item.stage) === -1) return "";
    var isVideo = item.content_format === "video";
    return '<div id="claude-design-box" style="margin-top:12px;padding:12px;border:1px dashed var(--c-primary,#0F369D);border-radius:12px;">' +
      '<b>' + (isVideo ? "مونتاج Claude Creative" : "تصميم Claude Creative") + '</b>' +
      (isVideo ? '<p style="font-size:12px;color:var(--c-muted);margin:6px 0;">لو فيه مقاطع اتصورت في المركز ارفعها على المادة الأول وClaude هيعمل منها ريل. لو مفيش، Claude هيعمل الريل من فيديوهات جاهزة مرخّصة أو صور + تعليق صوتي + موسيقى وخاتمة الصفحة.</p>' :
      '<div style="display:flex;gap:14px;align-items:center;flex-wrap:wrap;margin:8px 0;">' +
      '<label style="display:inline-flex;gap:5px;align-items:center;"><input type="radio" name="claude-style" value="photo" checked> صور حقيقية</label>' +
      '<label style="display:inline-flex;gap:5px;align-items:center;"><input type="radio" name="claude-style" value="illustration"> رسوم</label></div>') +
      (item.stage === "needs_revision" ? '<p style="font-size:12px;color:var(--c-muted);margin:6px 0;">Claude هيطبّق كومنتات «طلب تعديل» المكتوبة على المادة. لو عايز تصميم جديد من الأول اكتب في الكومنت: أعد التصميم من الأول.</p>' : '') +
      '<button class="btn sm" id="claude-design-go">' + (item.stage === "needs_revision" ? "نفّذ التعديل" : isVideo ? "نفّذ المونتاج" : item.content_format === "carousel" ? "نفّذ الكاروسيل" : "نفّذ التصميم") + '</button>' +
      '<p id="claude-design-status" role="status" style="font-size:12px;color:var(--c-muted);margin:6px 0 0;"></p></div>';
  }
  function wireClaudeDesign(root, item) {
    var box = root.querySelector("#claude-design-box");
    if (!box) return;
    var statusEl = box.querySelector("#claude-design-status"), btn = box.querySelector("#claude-design-go");
    function show(req) {
      if (!req) { statusEl.textContent = ""; btn.disabled = false; return; }
      var note=req.note||"";try{var plan=JSON.parse(note);if(plan.task==="carousel")note="كاروسيل "+plan.slides_count+" شرايح";}catch(ignore){}
      statusEl.textContent = "آخر طلب: " + (CLAUDE_REQ_STATUS[req.status] || req.status) + (note ? " — " + note : "");
      btn.disabled = req.status === "pending" || req.status === "working";
    }
    window.SSMPDDb.latestClaudeDesignRequest(item.id).then(show, function () { statusEl.textContent = ""; });
    btn.onclick = function () {
      var picked = box.querySelector('input[name="claude-style"]:checked');
      var style = picked ? picked.value : "photo";
      btn.disabled = true;
      window.SSMPDDb.requestClaudeDesign(item.id, style, (window.SSMPDAuth.currentAdmin || {}).id, window.SSMPDCarouselContent&&window.SSMPDCarouselContent.designNote(item)).then(show, function (e) {
        btn.disabled = false;
        statusEl.textContent = /claude_design_requests/.test(e.message) ? "شغّل ملف تحديث قاعدة البيانات الخاص بتصميم Claude أولاً." : "خطأ: " + e.message;
      });
    };
  }

  "use strict";
  var W = window.SSMPDWorkflow;
  var C = window.SSMPDComments;

  function escapeHtml(s) {
    return String(s == null ? "" : s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  }

  // نص "من قد ايه" مبسّط بالعربي — بيتحول لعدد الأيام/الساعات من وقت معيّن
  // لحد دلوقتي، يستخدم في كروت الـKanban عشان يوضّح المادة اتحطت في
  // المرحلة الحالية إمتى (مطلوب المستخدم: معرفة قد ايه وهي عند المصمم)
  function timeAgo(iso) {
    if (!iso) return null;
    var ms = Date.now() - new Date(iso).getTime();
    if (isNaN(ms) || ms < 0) return null;
    var mins = Math.floor(ms / 60000);
    if (mins < 60) return mins <= 1 ? "من دقيقة" : "من " + mins + " دقيقة";
    var hours = Math.floor(mins / 60);
    if (hours < 24) return hours === 1 ? "من ساعة" : "من " + hours + " ساعة";
    var days = Math.floor(hours / 24);
    return days === 1 ? "من يوم" : "من " + days + " يوم";
  }

  function render(container) {
    var me = window.SSMPDAuth.currentAdmin;
    container.innerHTML = "<div class=\"loading\"> <!--ssmpd-i18n:%D8%A8%D9%8A%D8%AD%D9%85%D9%91%D9%84%E2%80%A6-->بيحمّل…</div>";
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

        var html = "<h2 style=\"margin-bottom:16px;\"> <!--ssmpd-i18n:%D8%A5%D8%AF%D8%A7%D8%B1%D8%A9%20%D8%A7%D9%84%D9%85%D8%AD%D8%AA%D9%88%D9%89-->إدارة المحتوى</h2>";

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

        html += '<div class="kanban content-review-board">';
        W.STAGES.forEach(function (s) {
          var colItems = items.filter(function (i) { return i.stage === s.key; });
          html += '<div class="kanban-col"><h4>' + window.SSMPDI18n.textHtml(s.label) + '<span class="count">' + colItems.length + '</span></h4>';
          colItems.forEach(function (i) {
            var ownerName = (adminsById[i.created_by] || {}).name || "—";
            var designerName = i.design_execution === "ai" ? "وكيل التصميم بالذكاء الاصطناعي" : i.assigned_designer ? ((adminsById[i.assigned_designer] || {}).name || "—") : "";
            // وقت دخول المادة للمرحلة الحالية: لو عند المصمم بنستخدم وقت
            // الاستلام الفعلي (design_received_at) لو موجود، وإلا آخر تحديث عام
            var stageTimeIso = (i.stage === "in_design" && i.design_received_at) ? i.design_received_at : i.updated_at;
            var agoLabel = timeAgo(stageTimeIso);
            var titleHtml = i.stage === "published"
              ? '<span class="link-open" data-published-open="' + i.id + '">' + escapeHtml(i.title) + '</span>'
              : escapeHtml(i.title);
            html += '<div class="kanban-card" data-id="' + i.id + '">' + W.contentFormatBadgeHtml(i) + '<div class="title">' + titleHtml + W.brandBadgeHtml(i.brand) + W.specialtyBadgeHtml(i.specialty) + C.commentButtonHtml(i.id, stats) + '</div>' +
              '<div class="meta">بواسطة: ' + escapeHtml(ownerName) + (designerName ? " · مصمم: " + escapeHtml(designerName) : "") + '</div>' +
              (agoLabel ? '<div class="meta" style="color:var(--c-muted);">في المرحلة دي ' + agoLabel + '</div>' : '') + '</div>';
          });
          if (!colItems.length) html += '<div style="text-align:center;color:var(--c-muted);font-size:11px;padding:10px 0;">فارغ</div>';
          html += '</div>';
        });
        html += '</div>';

        container.innerHTML = html;
        container.querySelectorAll("[data-id]").forEach(function (el) {
          el.onclick = function (e) {
            if (e.target.closest("[data-comment]") || e.target.closest("[data-published-open]")) return; // العنوان المنشور له اختيار منصة مستقل
            openReviewModal(el.getAttribute("data-id"), items, admins, designersAll);
          };
        });
        container.querySelectorAll("[data-published-open]").forEach(function (el) {
          el.onclick = function (e) {
            e.stopPropagation();
            var id = el.getAttribute("data-published-open");
            var item = items.filter(function (x) { return x.id === id; })[0];
            if (!item) return;
            W.openPublishedPostOptions(item, function () { openReviewModal(id, items, admins, designersAll); });
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
    return window.SSMPDDb.getContentItem(id).then(function(current) {
      if (!current) throw new Error("المادة غير موجودة");
      var latest = items.map(function(row) { return row.id === id ? current : row; });
      showReviewModal(id, latest, admins, designersAll);
    }).catch(function(error) { if(window.SSMPDToast) window.SSMPDToast.show(error.message,"error"); else alert(error.message); });
  }

  function showReviewModal(id, items, admins, designersAll) {
    var item = items.filter(function (i) { return i.id === id; })[0];
    if (!item) return;
    // designersAll (list_designers_all RPC) بيشمل الرول الأساسي والإضافي —
    // fallback لفلترة admins القديمة (رول أساسي بس) لو الدالة لسه مش
    // منشورة على القاعدة الحية.
    var designers = (designersAll && designersAll.length) ? designersAll : admins.filter(function (a) { return a.role === "designer" && a.active; });

    var backdrop = document.createElement("div");
    backdrop.className = "modal-backdrop";
    var actionsHtml = "";
    var supportsAi = item.content_format === "video" || (["sono","dr_dina"].includes(item.brand) && item.content_format === "image_post");
    var isAi = item.design_execution === "ai";
    var aiActive = isAi && ["in_design", "needs_revision"].indexOf(item.stage) !== -1;
    var canSwitchToAi = supportsAi && ["in_design", "needs_revision"].indexOf(item.stage) !== -1;

    if (item.stage === "idea_selection") {
      actionsHtml = W.draftSubmissionHtml(item, window.SSMPDAuth.currentAdmin);
    } else if (item.stage === "initial_approval") {
      actionsHtml = '<div class="field"><label>اختر جهة تنفيذ التصميم</label><select id="rv-designer">' +
        "<option value=\"\"> <!--ssmpd-i18n:%E2%80%94%20%D8%A7%D8%AE%D8%AA%D8%B1%20%E2%80%94-->— اختر —</option>" +
        (supportsAi ? '<option value="ai">وكيل التصميم بالذكاء الاصطناعي</option>' : '') +
        designerOptionsHtml(item, designers, null) +
        '</select></div>' +
        (item.content_format === 'carousel' ? '<p style="font-size:12px;color:var(--c-muted);">اختار تصميم الكاروسيل بالذكاء الاصطناعي، وبعد الاعتماد الأولي اضغط «نفّذ الكاروسيل» لإرسال كل الشرايح إلى Claude.</p>' : '') +
        '<div style="display:flex;gap:8px;"><button class="btn" id="rv-approve">اعتماد أولي — أرسل للتصميم</button>' +
        '<button class="btn danger" id="rv-reject">طلب تعديل</button></div>';
    } else if (item.stage === "final_approval") {
      actionsHtml = '<div style="display:flex;gap:8px;"><button class="btn" id="rv-approve">اعتماد نهائي — جاهز للنشر</button>' +
        '<button class="btn danger" id="rv-reject">طلب تعديل</button></div>';
    } else if (aiActive) {
      actionsHtml = '<p>جهة التنفيذ — وكيل التصميم بالذكاء الاصطناعي</p>' +
        (item.content_format === 'video' ? '<div id="rv-ai-video"></div>' : '<button class="btn ghost" id="rv-ai-open">فتح استوديو التصميم بالذكاء الاصطناعي</button>') +
        '<button class="btn ghost" id="rv-ai-submit" style="margin:10px 0;">إرسال النسخة للاعتماد النهائي</button><p id="rv-ai-feedback" role="status"></p>';
    } else {
      actionsHtml = "<p style=\"color:var(--c-muted);font-size:12px;\"> <!--ssmpd-i18n:%D9%84%D8%A7%20%D9%8A%D9%88%D8%AC%D8%AF%20%D8%A5%D8%AC%D8%B1%D8%A7%D8%A1%20%D8%A7%D8%B9%D8%AA%D9%85%D8%A7%D8%AF%20%D8%B9%D9%84%D9%89%20%D9%87%D8%B0%D9%87%20%D8%A7%D9%84%D9%85%D8%B1%D8%AD%D9%84%D8%A9%20%D8%AD%D8%A7%D9%84%D9%8A%D8%A7%D9%8B.-->لا يوجد إجراء اعتماد على هذه المرحلة حالياً.</p>";
    }

    // تغيير المصمم المسؤول — متاح في أي مرحلة بعد ما يتحدد مصمم (حتى لو الشغل بدأ)
    var reassignHtml = "";
    if (item.assigned_designer || aiActive || canSwitchToAi) {
      reassignHtml = '<div class="field" style="margin-top:10px;"><label>جهة تنفيذ التصميم</label>' +
        '<div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;">' +
        '<select id="rv-reassign">' +
        "<option value=\"\"> <!--ssmpd-i18n:%E2%80%94%20%D8%A7%D8%AE%D8%AA%D8%B1%20%E2%80%94-->— اختر —</option>" +
        (canSwitchToAi ? '<option value="ai"' + (isAi ? ' selected' : '') + '>وكيل التصميم بالذكاء الاصطناعي</option>' : '') +
        designerOptionsHtml(item, designers, item.assigned_designer) +
        '</select>' +
        '<button class="btn ghost sm" id="rv-reassign-btn">تغيير جهة التنفيذ</button></div></div>';
    }

    backdrop.innerHTML = '<div class="modal content-review-modal"><div class="modal-head"><h3>' + escapeHtml(item.title) + W.brandBadgeHtml(item.brand) + W.specialtyBadgeHtml(item.specialty) + '</h3>' +
      '<button class="modal-close">×</button></div>' +
      W.contentFormatDetailsHtml(item) +
      '<div class="status-pill approval" style="margin-bottom:12px;">' + W.stageLabel(item.stage) + '</div>' +
      '<div class="field" style="display:flex;align-items:flex-end;gap:8px;max-width:400px;flex-wrap:wrap;">' +
      "<div style=\"flex:1;min-width:140px;\"><label> <!--ssmpd-i18n:%D8%A7%D9%84%D9%85%D8%A7%D8%AF%D8%A9%20%D8%AF%D9%8A%20%D9%84%D8%B5%D9%81%D8%AD%D8%A9-->المادة دي لصفحة</label>" + W.brandSelectHtml("rv-brand", item.brand || "") + '</div>' +
      "<div style=\"flex:1;min-width:140px;\"><label> <!--ssmpd-i18n:%D8%A7%D9%84%D8%AA%D8%AE%D8%B5%D8%B5-->التخصص</label>" + W.specialtySelectHtml("rv-specialty", item.specialty || "") + '</div>' +
      "<button class=\"btn ghost sm\" id=\"rv-save-brand\" style=\"margin-bottom:1px;\"> <!--ssmpd-i18n:%D8%AD%D9%81%D8%B8-->حفظ</button></div>" +
      '<div id="review-publication-preview"></div>' +
      '<div id="review-website-publish"></div>' +
      '<div style="margin:6px 0 14px;">' + W.itemActionsHtml(item, window.SSMPDAuth.currentAdmin) + '</div>' +
      '<div id="review-design-edit-slot"></div>' +
      reassignHtml +
      (window.SSMPDCarouselContent?window.SSMPDCarouselContent.itemHtml(item):'') +
      claudeDesignHtml(item) +
      '<div style="margin:14px 0;">' + actionsHtml + '</div>' +
      W.metaLinksSectionHtml(item) +
      '<div id="comments-slot"></div></div>';
    document.body.appendChild(backdrop);
    window.SSMPDPublicationPreview.mount(backdrop.querySelector("#review-publication-preview"),item);
    window.SSMPDWebsite.mountAction(backdrop.querySelector("#review-website-publish"),item);
    if(item.design_file_url||item.stage==='final_approval')window.SSMPDDesignStudio.mount(backdrop.querySelector("#review-design-edit-slot"),item);
    backdrop.querySelector(".modal-close").onclick = function () { backdrop.remove(); };
    backdrop.onclick = function (e) { if (e.target === backdrop) backdrop.remove(); };
    W.wireItemActions(backdrop, item, function () { backdrop.remove(); render(document.getElementById("view-container")); });
    wireClaudeDesign(backdrop, item);
    W.wireMetaLinksSection(backdrop, item, window.SSMPDAuth.currentAdmin);

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
    W.wireDraftSubmission(backdrop, item, function () { backdrop.remove(); render(document.getElementById("view-container")); });

    if (reassignBtn) reassignBtn.onclick = function () {
      if (reassignBtn.disabled) return;
      var newDesignerId = document.getElementById("rv-reassign").value;
      if (!newDesignerId) { alert("اختر جهة تنفيذ التصميم"); return; }
      var toAi = newDesignerId === 'ai';
      if (toAi && !canSwitchToAi) return;
      if ((toAi && isAi) || (!toAi && !isAi && newDesignerId === item.assigned_designer)) return;
      var oldDesignerName = isAi ? "وكيل التصميم بالذكاء الاصطناعي" : (adminsById[item.assigned_designer] || {}).name || "—";
      var newDesignerName = toAi ? "وكيل التصميم بالذكاء الاصطناعي" : (adminsById[newDesignerId] || {}).name || "—";
      if (!confirm("تأكيد نقل المادة من \"" + oldDesignerName + "\" إلى \"" + newDesignerName + "\"؟")) return;
      var patch = { assigned_designer: toAi ? null : newDesignerId, design_execution: toAi ? "ai" : "human" };
      // لو الشغل لسه في التصميم، صفّر وقت الاستلام عشان المصمم الجديد يشوفها "في انتظار الاستلام"
      if (item.stage === "in_design" || item.stage === "needs_revision") patch.design_received_at = null;
      reassignBtn.disabled = true;
      window.SSMPDDb.updateContentItem(item.id, patch).then(function (updated) {
        window.SSMPDDb.logActivity({ content_id: item.id, actor_id: me.id, action: "تغيير جهة التنفيذ: " + oldDesignerName + " ← " + newDesignerName, from_stage: item.stage, to_stage: item.stage }).catch(function () {});
        backdrop.remove(); render(document.getElementById("view-container"));
        if (toAi) {
          if (updated.content_format !== 'video') window.SSMPDDesignStudio.open(updated);
          else openReviewModal(updated.id, items.map(function (row) { return row.id === updated.id ? updated : row; }), admins, designersAll);
        }
      }).catch(function (e) { reassignBtn.disabled = false; alert("خطأ: " + e.message); });
    };

    var aiOpen = backdrop.querySelector('#rv-ai-open');
    if (aiOpen) aiOpen.onclick = function () { window.SSMPDDesignStudio.open(item); };
    if (aiActive && item.content_format === 'video') {
      window.SSMPDRenderProduction.renderVideoJobSection(backdrop.querySelector('#rv-ai-video'), item);
    }
    var aiSubmit = backdrop.querySelector('#rv-ai-submit');
    if (aiSubmit) aiSubmit.onclick = function () {
      aiSubmit.disabled = true;
      window.SSMPDDb.submitAiDesign(item.id).then(function (updated) {
        window.SSMPDDrive.logDesignUploaded(item.id, updated.title).catch(function () {});
        backdrop.remove(); render(document.getElementById('view-container'));
      }).catch(function (e) {
        aiSubmit.disabled = false;
        backdrop.querySelector('#rv-ai-feedback').textContent = e.message;
      });
    };
    if (approveBtn) approveBtn.onclick = function () {
      if (approveBtn.disabled) return;
      var wasInitialApproval = item.stage === "initial_approval";
      var designerId = wasInitialApproval ? document.getElementById("rv-designer").value : '';
      if (wasInitialApproval && !designerId) { alert("اختر المصمم أو وكيل التصميم"); return; }
      approveBtn.disabled = true;
      var sendingToAi = designerId === 'ai';
      var operation = wasInitialApproval
        ? window.SSMPDDb.routeContentDesign(item.id, sendingToAi ? 'ai' : 'human', sendingToAi ? null : designerId)
        : window.SSMPDDb.updateContentItem(item.id, { stage: 'ready_to_publish' });
      operation.then(function (updated) {
        if (wasInitialApproval) window.SSMPDDrive.logDesignSent(item.id, updated.title).catch(function () {});
        else window.SSMPDDb.logActivity({ content_id: item.id, actor_id: me.id, action: 'اعتماد نهائي', from_stage: item.stage, to_stage: 'ready_to_publish' }).catch(function () {});
        backdrop.remove(); render(document.getElementById('view-container'));
        if (sendingToAi) {
          if (updated.content_format !== 'video') window.SSMPDDesignStudio.open(updated);
          else openReviewModal(updated.id, items.map(function (row) { return row.id === updated.id ? updated : row; }), admins, designersAll);
        }
      }).catch(function (e) {
        approveBtn.disabled = false;
        alert(/route_content_design/.test(e.message) ? 'شغّل تحديث قاعدة البيانات الخاص بوكيل التصميم أولاً.' : 'خطأ: ' + e.message);
      });
    };

    if (rejectBtn) rejectBtn.onclick = function () {
      var box = backdrop.querySelector(".new-comment-box");
      var note = box ? box.value.trim() : "";
      // الكومنت ممكن يكون اتبعت بالفعل بزرار "إرسال" (والمربع فاضي) — نكتفي بيه لو في كومنت "في انتظار التعديل" من نفس المستخدم
      var ready = note
        ? window.SSMPDDb.addComment({ content_id: item.id, author_id: me.id, body: "طلب تعديل: " + note, status: "pending" }).then(function () { return true; })
        : window.SSMPDDb.listComments(item.id).then(function (rows) {
            return (rows || []).some(function (c) { return c.author_id === me.id && (c.status || "pending") === "pending"; });
          });
      rejectBtn.disabled = true;
      ready.then(function (ok) {
        if (!ok) { rejectBtn.disabled = false; alert("لازم تكتب كومنت التعديل المطلوب في مربع الكومنتات تحت قبل الرفض"); return null; }
        return window.SSMPDDb.updateContentItem(item.id, { stage: "needs_revision" }).then(function () {
          return window.SSMPDDb.logActivity({ content_id: item.id, actor_id: me.id, action: "طلب تعديل", from_stage: item.stage, to_stage: "needs_revision" });
        }).then(function () { backdrop.remove(); render(document.getElementById("view-container")); });
      }).catch(function (e) { rejectBtn.disabled = false; alert("خطأ: " + e.message); });
    };
  }

  window.SSMPDRenderReview = { render: render };
})();




