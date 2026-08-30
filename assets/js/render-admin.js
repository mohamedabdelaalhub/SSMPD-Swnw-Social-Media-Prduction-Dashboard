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
        '<table class="simple"><thead><tr><th>الاسم</th><th>البريد</th><th>الدور الأساسي</th><th>أدوار إضافية</th><th>أرشيف المرضى</th><th>معاينة الأرشيف فقط</th><th>حذف الليدز</th><th>الحالة</th><th></th></tr></thead><tbody>';

      admins.forEach(function (a) {
        var lastSuper = a.role === "super_admin" && a.active && activeSupers.length === 1;
        var extraRoles = a.extra_roles || [];
        html += '<tr><td>' + escapeHtml(a.name || "—") + '</td><td>' + escapeHtml(a.email) + '</td>' +
          '<td><select data-role="' + a.id + '" ' + (lastSuper ? "disabled" : "") + '>' +
          Object.keys(R.ALL).map(function (k) {
            return '<option value="' + k + '" ' + (k === a.role ? "selected" : "") + '>' + R.label(k) + '</option>';
          }).join("") + '</select></td>' +
          '<td>' + Object.keys(R.ALL).filter(function (k) { return k !== a.role; }).map(function (k) {
            return '<label style="display:inline-flex;align-items:center;gap:3px;font-size:11px;margin-inline-end:8px;white-space:nowrap;">' +
              '<input type="checkbox" data-extra-role="' + a.id + '" data-extra-role-value="' + k + '" ' + (extraRoles.indexOf(k) !== -1 ? "checked" : "") + '>' + R.label(k) + '</label>';
          }).join("") + '</td>' +
          '<td style="text-align:center;"><input type="checkbox" data-archive="' + a.id + '" ' + (a.has_archive_access ? "checked" : "") + '></td>' +
          '<td style="text-align:center;"><input type="checkbox" data-archive-view-only="' + a.id + '" ' + (a.has_archive_view_only ? "checked" : "") + '></td>' +
          '<td style="text-align:center;"><input type="checkbox" data-delete-leads="' + a.id + '" ' + (a.can_delete_leads ? "checked" : "") + '></td>' +
          '<td>' + (a.user_id ? '<span class="status-pill approved">مفعّل</span>' : '<span class="status-pill draft">بانتظار إنشاء الحساب</span>') + '</td>' +
          '<td>' +
          '<button class="btn ghost sm" data-toggle="' + a.id + '" ' + (lastSuper ? "disabled" : "") + '>' + (a.active ? "إيقاف" : "تفعيل") + '</button> ' +
          '<button class="btn ghost sm" data-set-pass="' + a.id + '" ' + (a.user_id ? "" : "disabled") + '>تغيير كلمة السر</button> ' +
          '<button class="btn danger sm" data-del="' + a.id + '" ' + (lastSuper || a.id === myId ? "disabled" : "") + '>حذف</button>' +
          '</td></tr>';
      });
      html += '</tbody></table>' +
        '<p style="font-size:11px;color:var(--c-muted);margin-top:8px;">"الدور الأساسي" بيتحكم في الشاشة الافتراضية وبادچ الدور. "أدوار إضافية" بتضيف صلاحيات دور تاني للمستخدم نفسه من غير ما تغيّر دوره الأساسي — مثلاً موظف خدمة عملاء تحب يبقى ليه كمان صلاحية الاستقبال أو إدارة المحتوى.</p>' +
        '<p style="font-size:11px;color:var(--c-muted);margin-top:4px;">"أرشيف المرضى" صلاحية منفصلة عن الرول — أي مستخدم مفعّلة عنده بيقدر يوصل لتاب أرشيف المرضى مهما كان روله.</p>' +
        '<p style="font-size:11px;color:var(--c-muted);margin-top:4px;">"معاينة الأرشيف فقط" لمين محتاج يتصفح ملفات المرضى بس (مثال: طبيب سونو) — بيقدر يشوف ويفتح الملفات، من غير رفع أو حذف أو مراجعة.</p>' +
        '<p style="font-size:11px;color:var(--c-muted);margin-top:4px;">"حذف الليدز" صلاحية حذف نهائي لأي ليد من موديول إدارة الليدز — متاحة تلقائياً للسوبر أدمن، وممكن تتفعّل لأي مستخدم تاني هنا.</p></div>';

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
      container.querySelectorAll("[data-extra-role]").forEach(function (cb) {
        cb.onchange = function () {
          var adminId = cb.getAttribute("data-extra-role");
          var role = cb.getAttribute("data-extra-role-value");
          var action = cb.checked
            ? window.SSMPDDb.addAdminExtraRole(adminId, role, myId)
            : window.SSMPDDb.removeAdminExtraRole(adminId, role);
          action.then(function () { render(container); }, function (e) { alert("خطأ: " + e.message); render(container); });
        };
      });
      container.querySelectorAll("[data-archive]").forEach(function (cb) {
        cb.onchange = function () {
          window.SSMPDDb.updateAdmin(cb.getAttribute("data-archive"), { has_archive_access: cb.checked })
            .catch(function (e) { alert("خطأ: " + e.message); render(container); });
        };
      });
      container.querySelectorAll("[data-archive-view-only]").forEach(function (cb) {
        cb.onchange = function () {
          window.SSMPDDb.updateAdmin(cb.getAttribute("data-archive-view-only"), { has_archive_view_only: cb.checked })
            .catch(function (e) { alert("خطأ: " + e.message); render(container); });
        };
      });
      container.querySelectorAll("[data-delete-leads]").forEach(function (cb) {
        cb.onchange = function () {
          window.SSMPDDb.updateAdmin(cb.getAttribute("data-delete-leads"), { can_delete_leads: cb.checked })
            .catch(function (e) { alert("خطأ: " + e.message); render(container); });
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
      container.querySelectorAll("[data-set-pass]").forEach(function (btn) {
        btn.onclick = function () {
          var id = btn.getAttribute("data-set-pass");
          var row = admins.filter(function (a) { return a.id === id; })[0];
          openSetPasswordModal(row);
        };
      });
      container.querySelectorAll("[data-del]").forEach(function (btn) {
        btn.onclick = function () {
          if (!confirm("متأكد من حذف هذا المستخدم نهائياً؟")) return;
          window.SSMPDDb.deleteAdmin(btn.getAttribute("data-del")).then(function () { render(container); })
            .catch(function (e) {
              var msg = e && e.message ? e.message : "";
              if (msg.indexOf("foreign key") !== -1 || msg.indexOf("violates") !== -1 || (e && e.code === "23503")) {
                alert("متقدرش تمسح المستخدم ده نهائياً — ليه سجلات مرتبطة بيه (مواد محتوى/تعليقات/ملفات مرضى/ليدز... إلخ) لازم تتشال أو تتنقل الأول. استخدم زرار \"إيقاف\" بدل الحذف — بيمنعه من الدخول من غير ما يمسح تاريخه.");
              } else {
                alert("خطأ: " + msg);
              }
            });
        };
      });
    }).catch(function (e) {
      container.innerHTML = '<div class="err-msg">خطأ: ' + e.message + '</div>';
    });
  }

  // مودال السوبر أدمن لتغيير كلمة سر مستخدم تاني مباشرة (بدون معرفة كلمة سره
  // القديمة) — عن طريق admin-set-password Edge Function (service role).
  function openSetPasswordModal(admin) {
    var backdrop = document.createElement("div");
    backdrop.className = "modal-backdrop";
    backdrop.innerHTML = '<div class="modal" style="max-width:420px;">' +
      '<div class="modal-head"><h3>تغيير كلمة سر: ' + escapeHtml(admin.name || admin.email) + '</h3><button class="modal-close">×</button></div>' +
      '<div class="field"><label>كلمة السر الجديدة</label><input id="sp-pass1" type="password" autocomplete="new-password" autocapitalize="off" autocorrect="off" spellcheck="false"></div>' +
      '<div class="field"><label>تأكيد كلمة السر</label><input id="sp-pass2" type="password" autocomplete="new-password" autocapitalize="off" autocorrect="off" spellcheck="false"></div>' +
      '<button class="btn block" id="sp-save">حفظ</button>' +
      '</div>';
    document.body.appendChild(backdrop);

    function close() { backdrop.remove(); }
    backdrop.querySelector(".modal-close").onclick = close;
    backdrop.addEventListener("click", function (e) { if (e.target === backdrop) close(); });

    backdrop.querySelector("#sp-save").onclick = function () {
      var p1 = document.getElementById("sp-pass1").value.trim();
      var p2 = document.getElementById("sp-pass2").value.trim();
      if (!p1 || p1.length < 6) { window.SSMPDToast.show("كلمة السر لازم تكون ٦ حروف/أرقام على الأقل", "error"); return; }
      if (p1 !== p2) { window.SSMPDToast.show("كلمة السر وتأكيدها مش متطابقين", "error"); return; }
      window.SSMPDDb.adminSetUserPassword(admin.id, p1).then(function () {
        window.SSMPDToast.show("اتغيّرت كلمة السر بنجاح");
        close();
      }).catch(function (e) { window.SSMPDToast.show("خطأ: " + e.message, "error"); });
    };
  }

  window.SSMPDRenderAdmin = { render: render };
})();
