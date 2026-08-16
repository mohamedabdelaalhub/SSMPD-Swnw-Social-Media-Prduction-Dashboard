/* SSMPD — مكوّن الكومنتات (Thread) — يُستخدم داخل مودال أي مادة */
(function () {
  "use strict";

  function fmtTime(iso) {
    var d = new Date(iso);
    return d.toLocaleString("ar-EG", { hour: "2-digit", minute: "2-digit", day: "2-digit", month: "2-digit" });
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
            var author = (adminsById && adminsById[c.author_id]) ? adminsById[c.author_id].name : "مستخدم";
            html += '<div class="comment"><div class="head"><b>' + escapeHtml(author) + '</b><span>' + fmtTime(c.created_at) + '</span></div>' +
              '<div>' + escapeHtml(c.body) + '</div></div>';
          });
        }
        html += '<div style="margin-top:10px;display:flex;gap:8px;">' +
          '<textarea id="new-comment-box" placeholder="اكتب كومنت..." style="flex:1;min-height:44px;"></textarea>' +
          '</div><div style="text-align:left;margin-top:6px;"><button class="btn sm" id="send-comment-btn">إرسال</button></div></div>';
        container.innerHTML = html;

        document.getElementById("send-comment-btn").onclick = function () {
          var box = document.getElementById("new-comment-box");
          var body = box.value.trim();
          if (!body) return;
          var authorId = window.SSMPDAuth.currentAdmin.id;
          window.SSMPDDb.addComment({ content_id: contentId, author_id: authorId, body: body }).then(function () {
            box.value = "";
            Comments.render(container, contentId, adminsById);
          }).catch(function (e) { alert("خطأ: " + e.message); });
        };
      });
    }
  };

  function escapeHtml(s) {
    return String(s == null ? "" : s)
      .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  }

  window.SSMPDComments = Comments;
})();
