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

      html += '<div class="section"><h3>أداء الموظفين</h3>' +
        '<p style="font-size:11px;color:var(--c-muted);margin-bottom:8px;">ملخص إنتاجية كل موظف في موديول المحتوى (إنشاء/تصميم/نشر) في مكان واحد — بدل ما تتجمع يدوياً من شاشات متفرقة.</p>' +
        '<button class="btn ghost sm" id="perf-load-btn">تحميل تقرير الأداء</button>' +
        '<div id="perf-report-box" style="margin-top:12px;"></div></div>';

      html += '<div class="section"><h3>تقرير الاستخدام</h3>' +
        '<p style="font-size:11px;color:var(--c-muted);margin-bottom:8px;">كل مرة حد بيفتح الداشبورد بيتسجّل كجلسة (وقت الدخول/الخروج والمدة)، وكل عملية رفع/إنشاء مهمة (تصميم، مادة محتوى، مستند مريض، تقرير مؤشرات/إعلانات، إكسيل ليدز، فاتورة حجز) بتتسجّل باسمها في سجل الأنشطة.</p>' +
        '<button class="btn ghost sm" id="usage-load-btn">تحميل تقرير الاستخدام</button>' +
        '<div id="usage-report-box" style="margin-top:12px;"></div></div>';

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
      var perfBtn = document.getElementById("perf-load-btn");
      if (perfBtn) {
        perfBtn.onclick = function () {
          perfBtn.disabled = true;
          perfBtn.textContent = "بيحمّل…";
          var box = document.getElementById("perf-report-box");
          window.SSMPDDb.listContentItems().then(function (items) {
            box.innerHTML = renderPerformanceReportHtml(items || [], admins);
          }).catch(function (e) {
            box.innerHTML = '<div class="err-msg">خطأ: ' + e.message + '</div>';
          }).then(function () { perfBtn.disabled = false; perfBtn.textContent = "تحميل تقرير الأداء"; });
        };
      }
      var usageBtn = document.getElementById("usage-load-btn");
      if (usageBtn) {
        usageBtn.onclick = function () {
          usageBtn.disabled = true;
          usageBtn.textContent = "بيحمّل…";
          var box = document.getElementById("usage-report-box");
          Promise.all([window.SSMPDDb.listLoginSessions(200), window.SSMPDDb.listUsageActivity(200)])
            .then(function (results) {
              box.innerHTML = renderUsageReportHtml(results[0] || [], results[1] || [], admins);
            })
            .catch(function (e) { box.innerHTML = '<div class="err-msg">خطأ: ' + e.message + '</div>'; })
            .then(function () { usageBtn.disabled = false; usageBtn.textContent = "تحميل تقرير الاستخدام"; });
        };
      }
    }).catch(function (e) {
      container.innerHTML = '<div class="err-msg">خطأ: ' + e.message + '</div>';
    });
  }

  function fmtDateTime(iso) {
    if (!iso) return "—";
    var d = new Date(iso);
    return d.toLocaleDateString("ar-EG") + " " + d.toLocaleTimeString("ar-EG", { hour: "2-digit", minute: "2-digit" });
  }

  function fmtDurationMins(startIso, endIso) {
    if (!startIso || !endIso) return "—";
    var mins = Math.round((new Date(endIso) - new Date(startIso)) / 60000);
    if (mins < 1) return "أقل من دقيقة";
    if (mins < 60) return mins + " دقيقة";
    return Math.floor(mins / 60) + " س " + (mins % 60) + " د";
  }

  // لوحة نشاط الفريق: ملخص ذكي فوق السجلات الخام — الأكثر نشاطاً، مين مبيدخلش
  // من فترة، ومتوسط وقت الجلسة لكل مستخدم. بيتحسب من نفس البيانات المُحمّلة
  // بالفعل (200 آخر جلسة/نشاط) — من غير أي نداء إضافي للسيرفر.
  function sessionDurationMins(s) {
    var end = s.logout_at || s.last_seen_at;
    if (!s.login_at || !end) return 0;
    var mins = (new Date(end) - new Date(s.login_at)) / 60000;
    return mins > 0 ? mins : 0;
  }

  function fmtMinsPlain(mins) {
    mins = Math.round(mins);
    if (mins < 1) return "أقل من دقيقة";
    if (mins < 60) return mins + " دقيقة";
    return Math.floor(mins / 60) + " س " + (mins % 60) + " د";
  }

  function renderUsageSummaryHtml(admins, sessions, activity) {
    var byAdmin = {};
    (admins || []).forEach(function (a) {
      byAdmin[a.id] = { admin: a, sessionsCount: 0, totalMins: 0, activityCount: 0, lastLoginAt: null };
    });
    sessions.forEach(function (s) {
      var row = byAdmin[s.admin_id];
      if (!row) return;
      row.sessionsCount++;
      row.totalMins += sessionDurationMins(s);
      if (!row.lastLoginAt || new Date(s.login_at) > new Date(row.lastLoginAt)) row.lastLoginAt = s.login_at;
    });
    activity.forEach(function (a) {
      var row = byAdmin[a.admin_id];
      if (row) row.activityCount++;
    });

    var rows = Object.keys(byAdmin).map(function (id) { return byAdmin[id]; })
      .filter(function (r) { return r.admin.active; });

    var mostActive = rows.slice().sort(function (a, b) { return b.totalMins - a.totalMins; }).filter(function (r) { return r.totalMins > 0; }).slice(0, 5);
    var neverLoggedIn = rows.filter(function (r) { return !r.lastLoginAt; });

    var html = '<h4 style="margin-bottom:8px;">لوحة نشاط الفريق</h4>';
    html += '<table class="simple"><thead><tr><th>المستخدم</th><th>عدد الجلسات</th><th>إجمالي وقت الاستخدام</th><th>متوسط الجلسة</th><th>عدد الأنشطة</th><th>آخر دخول</th></tr></thead><tbody>';
    if (!mostActive.length) {
      html += '<tr><td colspan="6" style="color:var(--c-muted);">مفيش بيانات كفاية للترتيب — حمّل التقرير الأول.</td></tr>';
    } else {
      mostActive.forEach(function (r) {
        var avg = r.sessionsCount ? r.totalMins / r.sessionsCount : 0;
        html += '<tr><td>' + escapeHtml(r.admin.name || r.admin.email) + '</td>' +
          '<td>' + r.sessionsCount + '</td>' +
          '<td>' + fmtMinsPlain(r.totalMins) + '</td>' +
          '<td>' + fmtMinsPlain(avg) + '</td>' +
          '<td>' + r.activityCount + '</td>' +
          '<td>' + fmtDateTime(r.lastLoginAt) + '</td></tr>';
      });
    }
    html += '</tbody></table>';

    if (neverLoggedIn.length) {
      html += '<p style="font-size:12px;color:var(--c-muted);margin-top:10px;">مستخدمين مفعّلين بس مسجّلش أي جلسة (ضمن آخر ٢٠٠ جلسة): ' +
        neverLoggedIn.map(function (r) { return escapeHtml(r.admin.name || r.admin.email); }).join("، ") + '</p>';
    }
    return html;
  }

  function renderUsageReportHtml(sessions, activity, admins) {
    var html = renderUsageSummaryHtml(admins || [], sessions, activity);
    html += '<h4 style="margin:16px 0 8px;">سجل الجلسات (' + sessions.length + ')</h4>' +
      '<table class="simple"><thead><tr><th>المستخدم</th><th>وقت الدخول</th><th>وقت الخروج</th><th>المدة</th></tr></thead><tbody>';
    if (!sessions.length) {
      html += '<tr><td colspan="4" style="color:var(--c-muted);">مفيش جلسات مسجّلة.</td></tr>';
    } else {
      sessions.forEach(function (s) {
        var endRef = s.logout_at || s.last_seen_at;
        html += '<tr><td>' + escapeHtml((s.admins && s.admins.name) || "—") + '</td>' +
          '<td>' + fmtDateTime(s.login_at) + '</td>' +
          '<td>' + (s.logout_at ? fmtDateTime(s.logout_at) : '<span style="color:var(--c-muted);">جلسة مفتوحة</span>') + '</td>' +
          '<td>' + fmtDurationMins(s.login_at, endRef) + '</td></tr>';
      });
    }
    html += '</tbody></table>';

    html += '<h4 style="margin:16px 0 8px;">سجل الأنشطة المهمة (' + activity.length + ')</h4>' +
      '<table class="simple"><thead><tr><th>المستخدم</th><th>النشاط</th><th>اسم التقرير/الملف</th><th>الوقت</th></tr></thead><tbody>';
    if (!activity.length) {
      html += '<tr><td colspan="4" style="color:var(--c-muted);">مفيش أنشطة مسجّلة.</td></tr>';
    } else {
      activity.forEach(function (a) {
        html += '<tr><td>' + escapeHtml((a.admins && a.admins.name) || "—") + '</td>' +
          '<td>' + escapeHtml(a.action_type) + '</td>' +
          '<td>' + escapeHtml(a.report_name || "—") + '</td>' +
          '<td>' + fmtDateTime(a.created_at) + '</td></tr>';
      });
    }
    html += '</tbody></table>';
    return html;
  }

  // تقرير أداء موحّد — بيتحسب في المتصفح من نفس مصفوفة content_items اللي
  // بتتحمّل مرة واحدة عند الضغط على الزرار (نداء واحد للسيرفر بس، زي نمط
  // تقرير الاستخدام). بيغطي موديول المحتوى (إنشاء/تصميم/نشر) — موديول
  // الليدز عنده داشبورد دخل/أداء منفصل بالفعل (تاب "داشبورد الإدارة").
  function renderPerformanceReportHtml(items, admins) {
    var byAdmin = {};
    (admins || []).forEach(function (a) {
      if (!a.active) return;
      byAdmin[a.id] = { admin: a, created: 0, designed: 0, published: 0 };
    });
    items.forEach(function (it) {
      if (it.created_by && byAdmin[it.created_by]) byAdmin[it.created_by].created++;
      if (it.assigned_designer && byAdmin[it.assigned_designer] && it.design_received_at) byAdmin[it.assigned_designer].designed++;
      if (it.published_by && byAdmin[it.published_by]) byAdmin[it.published_by].published++;
    });

    var rows = Object.keys(byAdmin).map(function (id) { return byAdmin[id]; })
      .filter(function (r) { return r.created || r.designed || r.published; })
      .sort(function (a, b) { return (b.created + b.designed + b.published) - (a.created + a.designed + a.published); });

    var html = '<table class="simple"><thead><tr><th>الموظف</th><th>مواد أنشأها</th><th>مواد صممها (استلمها)</th><th>مواد نشرها</th></tr></thead><tbody>';
    if (!rows.length) {
      html += '<tr><td colspan="4" style="color:var(--c-muted);">مفيش بيانات كفاية.</td></tr>';
    } else {
      rows.forEach(function (r) {
        html += '<tr><td>' + escapeHtml(r.admin.name || r.admin.email) + '</td>' +
          '<td>' + r.created + '</td><td>' + r.designed + '</td><td>' + r.published + '</td></tr>';
      });
    }
    html += '</tbody></table>' +
      '<p style="font-size:11px;color:var(--c-muted);margin-top:8px;">مؤشرات موديول الليدز (الدخل/الحجوزات حسب الموظف) موجودة في تاب "داشبورد الإدارة" داخل موديول إدارة الليدز.</p>';
    return html;
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
