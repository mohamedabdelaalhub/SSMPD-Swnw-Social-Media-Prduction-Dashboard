/* SSMPD — مكوّن الكومنتات (Thread) — يُستخدم داخل مودال أي مادة
   + حساب عداد "تعليق جديد" (أحمر لغير المقروء، رمادي بعد القراءة)
   + حالة كل كومنت: في انتظار التعديل / تم التعديل */
(function () {
  "use strict";

  function fmtTime(iso) {
    var d = new Date(iso);
    return d.toLocaleString("ar-EG", { hour: "2-digit", minute: "2-digit", day: "2-digit", month: "2-digit" });
  }

  function escapeHtml(s) {
    return String(s == null ? "" : s)
      .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  }

  var Comments = {
    // container: عنصر DOM، contentId: uuid، adminsById: خريطة id->admin (للاسم)
    render: function (container, contentId, adminsById) {
      container.innerHTML = '<div class="loading">بيحمّل الكومنتات…</div>';
      return window.SSMPDDb.listComments(contentId).then(function (rows) {
        var html = '<div class="comment-thread"><h4 style="font-size:13px;margin-bottom:10px;">الكومنتات (' + rows.length + ')</h4>';
        if (!rows.length) {
          html += '<div class="empty-state" style="padding:14px;">مفيش كومنتات لسه</div>';
        } else {
          rows.forEach(function (c) {
            var authorRow = adminsById && adminsById[c.author_id];
            var author = authorRow ? (authorRow.name || authorRow.email) : "مستخدم محذوف";
            var status = c.status || "pending";
            html += '<div class="comment"><div class="head"><b>' + escapeHtml(author) + '</b><span>' + fmtTime(c.created_at) + '</span></div>' +
              '<div>' + escapeHtml(c.body) + '</div>' +
              '<div style="margin-top:6px;"><select class="comment-status-select" data-comment-id="' + c.id + '">' +
              '<option value="pending"' + (status === "pending" ? " selected" : "") + '>في انتظار التعديل</option>' +
              '<option value="done"' + (status === "done" ? " selected" : "") + '>تم التعديل</option>' +
              '</select></div></div>';
          });
        }
        html += '<div style="margin-top:10px;display:flex;gap:8px;">' +
          '<textarea class="new-comment-box" placeholder="اكتب كومنت..." style="flex:1;min-height:44px;"></textarea>' +
          '</div><div style="text-align:left;margin-top:6px;"><button class="btn sm send-comment-btn">إرسال</button></div></div>';
        container.innerHTML = html;

        // استخدام querySelector على الـ container نفسه (مش document) عشان الكومبوننت ده يشتغل صح
        // حتى لو أكتر من مادة عندها تريد كومنتات ظاهر في نفس الصفحة في نفس الوقت (زي تاب النشر)
        container.querySelector(".send-comment-btn").onclick = function () {
          var box = container.querySelector(".new-comment-box");
          var body = box.value.trim();
          if (!body) return;
          var authorId = window.SSMPDAuth.currentAdmin.id;
          window.SSMPDDb.addComment({ content_id: contentId, author_id: authorId, body: body, status: "pending" }).then(function () {
            box.value = "";
            Comments.render(container, contentId, adminsById);
          }).catch(function (e) { alert("خطأ: " + e.message); });
        };

        container.querySelectorAll(".comment-status-select").forEach(function (sel) {
          sel.onchange = function () {
            window.SSMPDDb.updateComment(sel.getAttribute("data-comment-id"), { status: sel.value })
              .catch(function (e) { alert("خطأ: " + e.message); });
          };
        });

        // فتح الكومنتات (سواء من "فتح" أو "تعليق جديد") يعتبر قراءة لها الآن
        var me = window.SSMPDAuth.currentAdmin;
        if (me) window.SSMPDDb.markCommentsRead(me.id, contentId).catch(function () {});
      });
    },

    // يحسب لكل مادة: إجمالي الكومنتات + عدد الجديد (غير المقروء وغير كتابتي أنا) بناءً على آخر وقت قراءة
    computeCommentStats: function (allComments, myReads, myAdminId) {
      var readMap = {};
      (myReads || []).forEach(function (r) { readMap[r.content_id] = r.last_read_at; });
      var total = {}, unread = {};
      (allComments || []).forEach(function (c) {
        total[c.content_id] = (total[c.content_id] || 0) + 1;
        if (c.author_id === myAdminId) return; // كومنتاتي مش هتتحسب كجديدة عندي
        var lastRead = readMap[c.content_id];
        if (!lastRead || new Date(c.created_at) > new Date(lastRead)) {
          unread[c.content_id] = (unread[c.content_id] || 0) + 1;
        }
      });
      return { total: total, unread: unread };
    },

    // زرار "تعليق جديد" + العداد — أحمر لو فيه جديد، رمادي لو اتقرا
    // لو مفيش كومنتات خالص على المادة دي، الزرار نفسه ميظهرش (مفيش داعي له)
    commentButtonHtml: function (id, stats) {
      var total = (stats.total && stats.total[id]) || 0;
      if (total === 0) return "";
      var unread = (stats.unread && stats.unread[id]) || 0;
      var cls = unread > 0 ? "unread" : "read";
      var n = unread > 0 ? unread : total;
      var badge = '<span class="comment-badge ' + cls + '">' + n + '</span>';
      return '<button class="btn ghost sm" data-comment="' + id + '">تعليقات' + badge + '</button>';
    }
  };

  window.SSMPDComments = Comments;
})();
