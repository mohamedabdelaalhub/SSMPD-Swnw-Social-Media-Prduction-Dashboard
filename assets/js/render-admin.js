/* SSMPD — لوحة تحكم السوبر أدمن: المستخدمون والصلاحيات */
(function () {
  "use strict";
  var R = window.SSMPDRoles;

  function escapeHtml(s) {
    return String(s == null ? "" : s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  }

  function render(container) {
    container.innerHTML = '<div class="loading">بيحمّل…</div>';
    window.SSMPDDb.listAdmins().then(function (admins) {
      var myId = window.SSMPDAuth.currentAdmin.id;
      var activeSupers = admins.filter(function (a) { return a.role === "super_admin" && a.active; });

      var html = '<h2 style="margin-bottom:16px;">المستخدمون والصلاحيات</h2>';
      html += '<div class="section"><h3>إضافة مستخدم جديد</h3>' +
        '<div style="display:flex;gap:8px;flex-wrap:wrap;">' +
        '<input id="new-email" placeholder="البريد الإلكتروني" style="flex:1;min-width:200px;padding:9px 12px;border-radius:10px;border:1px solid var(--c-border);">' +
        '<input id="new-name" placeholder="الاسم" style="flex:1;min-width:150px;padding:9px 12px;border-radius:10px;border:1px solid var(--c-border);">' +
        '<select id="new-role" style="padding:9px 12px;border-radius:10px;border:1px solid var(--c-border);">' +
        Object.keys(R.ALL).map(function (k) { return '<option value="' + k + '">' + R.label(k) + '</option>'; }).join("") +
        '</select><button class="btn" id="add-admin-btn">إضافة</button></div>' +
        '<p style="font-size:11px;color:var(--c-muted);margin-top:8px;">هو اللي هيفتح رابط اللوحة ويعمل "حساب جديد" بنفس البريد ده وينشئ كلمة سره — إنت مش بتحط له كلمة سر.</p></div>';

      html += '<div class="section"><h3>كل المستخدمين (' + admins.length + ')</h3>' +
        '<table class="simple"><thead><tr><th>الاسم</th><th>البريد</th><th>الدور</th><th>الحالة</th><th></th></tr></thead><tbody>';

      admins.forEach(function (a) {
        var lastSuper = a.role === "super_admin" && a.active && activeSupers.length === 1;
        html += '<tr><td>' + escapeHtml(a.name || "—") + '</td><td>' + escapeHtml(a.email) + '</td>' +
          '<td><select data-role="' + a.id + '" ' + (lastSuper ? "disabled" : "") + '>' +
          Object.keys(R.ALL).map(function (k) {
            return '<option value="' + k + '" ' + (k === a.role ? "selected" : "") + '>' + R.label(k) + '</option>';
          }).join("") + '</select></td>' +
          '<td>' + (a.user_id ? '<span class="status-pill approved">مفعّل</span>' : '<span class="status-pill draft">بانتظار إنشاء الحساب</span>') + '</td>' +
          '<td>' +
          '<button class="btn ghost sm" data-toggle="' + a.id + '" ' + (lastSuper ? "disabled" : "") + '>' + (a.active ? "إيقاف" : "تفعيل") + '</button> ' +
          '<button class="btn danger sm" data-del="' + a.id + '" ' + (lastSuper || a.id === myId ? "disabled" : "") + '>حذف</button>' +
          '</td></tr>';
      });
      html += '</tbody></table></div>';

      container.innerHTML = html;

      document.getElementById("add-admin-btn").onclick = function () {
        var email = document.getElementById("new-email").value.trim();
        var name = document.getElementById("new-name").value.trim();
        var role = document.getElementById("new-role").value;
        if (!email) { alert("اكتب البريد"); return; }
        window.SSMPDDb.inviteAdmin(email, name, role).then(function () {
          render(container);
        }).catch(function (e) { alert("خطأ: " + e.message); });
      };

      container.querySelectorAll("[data-role]").forEach(function (sel) {
        sel.onchange = function () {
          window.SSMPDDb.updateAdmin(sel.getAttribute("data-role"), { role: sel.value }).catch(function (e) { alert("خطأ: " + e.message); render(container); });
        };
      });
      container.querySelectorAll("[data-toggle]").forEach(function (btn) {
        btn.onclick = function () {
          var id = btn.getAttribute("data-toggle");
          var row = admins.filter(function (a) { return a.id === id; })[0];
          window.SSMPDDb.updateAdmin(id, { active: !row.active }).then(function () { render(container); })
            .catch(function (e) { alert("خطأ: " + e.message); });
        };
      });
      container.querySelectorAll("[data-del]").forEach(function (btn) {
        btn.onclick = function () {
          if (!confirm("متأكد من حذف هذا المستخدم نهائياً؟")) return;
          window.SSMPDDb.deleteAdmin(btn.getAttribute("data-del")).then(function () { render(container); })
            .catch(function (e) { alert("خطأ: " + e.message); });
        };
      });
    }).catch(function (e) {
      container.innerHTML = '<div class="err-msg">خطأ: ' + e.message + '</div>';
    });
  }

  window.SSMPDRenderAdmin = { render: render };
})();
