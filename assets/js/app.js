/* SSMPD — نقطة البداية: الدخول، الشِل العام، التنقّل بين الشاشات */
(function () {
  "use strict";

  var R = window.SSMPDRoles;
  var currentTab = null;
  var realtimeChannel = null;
  var commentsChannel = null;
  var pollTimer = null;

  var RENDERERS = {
    summary: window.SSMPDRenderSummary,
    production: window.SSMPDRenderProduction,
    review: window.SSMPDRenderReview,
    design: window.SSMPDRenderDesign,
    archive: window.SSMPDRenderArchive,
    admin: window.SSMPDRenderAdmin
  };
  var TAB_LABELS = {
    summary: "الملخص العام",
    production: "إنتاج المحتوى",
    review: "إدارة المحتوى",
    design: "شاشة التصميم",
    archive: "الأرشيف",
    admin: "⚙ المستخدمون"
  };

  function root() { return document.getElementById("app-root"); }

  function showAuthScreen(mode, errorMsg) {
    mode = mode || "login";
    var html = '<div class="auth-screen"><div class="auth-box">' +
      '<img class="logo" src="assets/img/logo.svg" alt="Swnw">' +
      '<h1>لوحة إنتاج المحتوى</h1><p class="sub">' + window.SSMPD_CONFIG.centerName + '</p>' +
      (errorMsg ? '<div class="err-msg">' + errorMsg + '</div>' : '') +
      '<div class="field"><label>البريد الإلكتروني</label><input id="auth-email" type="email"></div>' +
      '<div class="field"><label>كلمة السر</label><input id="auth-pass" type="password"></div>';

    if (mode === "signup") {
      html += '<div class="field"><label>الاسم</label><input id="auth-name"></div>' +
        '<button class="btn block" id="auth-submit">إنشاء الحساب</button>' +
        '<p style="margin-top:14px;font-size:12px;"><a href="#" id="switch-mode">عندك حساب؟ سجّل الدخول</a></p>';
    } else {
      html += '<button class="btn block" id="auth-submit">دخول</button>' +
        '<p style="margin-top:14px;font-size:12px;"><a href="#" id="switch-mode">حساب جديد؟ اضغط هنا (لو اتضفت من الأدمن)</a></p>';
    }
    html += '</div></div>';
    root().innerHTML = html;

    document.getElementById("switch-mode").onclick = function (e) {
      e.preventDefault();
      showAuthScreen(mode === "login" ? "signup" : "login");
    };

    document.getElementById("auth-submit").onclick = function () {
      var email = document.getElementById("auth-email").value.trim();
      var pass = document.getElementById("auth-pass").value;
      if (!email || !pass) { showAuthScreen(mode, "اكتب البريد وكلمة السر"); return; }

      var action;
      if (mode === "signup") {
        var name = document.getElementById("auth-name").value.trim();
        action = window.SSMPDAuth.signUp(email, pass, name);
      } else {
        action = window.SSMPDAuth.signIn(email, pass);
      }

      action.then(function () { return bootAfterAuth(); })
        .catch(function (err) {
          showAuthScreen(mode, translateAuthError(err));
        });
    };
  }

  function translateAuthError(err) {
    var m = String(err && err.message || err);
    if (m === "NOT_INVITED") return "هذا البريد غير مُضاف من مدير المركز. اطلب من السوبر أدمن يضيفك أولاً.";
    if (m === "INACTIVE") return "حسابك موقوف حالياً. تواصل مع مدير المركز.";
    if (/Invalid login credentials/i.test(m)) return "البريد أو كلمة السر غلط.";
    if (/Email not confirmed/i.test(m)) return "البريد لسه محتاج تأكيد.";
    return m;
  }

  function bootAfterAuth() {
    return window.SSMPDAuth.getSession().then(function (session) {
      if (!session) { showAuthScreen("login"); return; }
      window.SSMPDAuth.currentUser = session.user;
      return window.SSMPDAuth.loadCurrentAdmin(session.user.id, session.user.email).then(function () {
        renderShell();
      });
    }).catch(function (err) {
      window.SSMPDAuth.signOut();
      showAuthScreen("login", translateAuthError(err));
    });
  }

  function renderShell() {
    var admin = window.SSMPDAuth.currentAdmin;
    var tabs = Object.keys(TAB_LABELS).filter(function (t) { return R.canSeeTab(admin.role, t); });

    var html = '<div class="app-shell"><div class="topbar">' +
      '<div class="brand"><img src="assets/img/mark.svg" alt=""><span>SSMPD</span></div>' +
      '<div class="who"><span class="role-badge">' + R.label(admin.role) + '</span> <b>' + escapeHtml(admin.name || admin.email) + '</b>' +
      ' <button class="btn ghost sm" id="logout-btn">خروج</button></div></div>' +
      '<div class="tabs">' + tabs.map(function (t) { return '<button class="tab-btn" data-tab="' + t + '">' + TAB_LABELS[t] + '</button>'; }).join("") + '</div>' +
      '<main class="view" id="view-container"></main></div>';
    root().innerHTML = html;

    document.getElementById("logout-btn").onclick = function () {
      window.SSMPDAuth.signOut().then(function () { location.reload(); });
    };

    document.querySelectorAll(".tab-btn").forEach(function (btn) {
      btn.onclick = function () { switchTab(btn.getAttribute("data-tab")); };
    });

    switchTab(R.defaultTab(admin.role));
    setupRealtime();
  }

  function switchTab(tab) {
    currentTab = tab;
    document.querySelectorAll(".tab-btn").forEach(function (b) {
      b.classList.toggle("active", b.getAttribute("data-tab") === tab);
    });
    var renderer = RENDERERS[tab];
    if (renderer) renderer.render(document.getElementById("view-container"));
  }

  // تحديث لحظي بسيط: أعد رسم التاب الحالي لو بيعرض بيانات محتوى، وما فيش مودال مفتوح دلوقتي
  function refreshCurrentTab() {
    if (["summary", "production", "review", "design", "archive"].indexOf(currentTab) !== -1) {
      var el = document.getElementById("view-container");
      if (el && !document.querySelector(".modal-backdrop")) {
        RENDERERS[currentTab].render(el);
      }
    }
  }

  function setupRealtime() {
    if (realtimeChannel) window.SSMPDDb.unsubscribe(realtimeChannel);
    if (commentsChannel) window.SSMPDDb.unsubscribe(commentsChannel);
    realtimeChannel = window.SSMPDDb.subscribeTable("content_items", refreshCurrentTab);
    commentsChannel = window.SSMPDDb.subscribeTable("comments", refreshCurrentTab);

    // نسخة احتياطية: ريفريش تلقائي دوري لو الاتصال اللحظي (WebSocket) انقطع أو اتأخر
    if (pollTimer) clearInterval(pollTimer);
    pollTimer = setInterval(refreshCurrentTab, 45000);
  }

  function escapeHtml(s) {
    return String(s == null ? "" : s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  }

  // ---------- تشغيل ----------
  document.addEventListener("DOMContentLoaded", function () {
    window.SSMPDAuth.getSession().then(function (session) {
      if (session) return bootAfterAuth();
      showAuthScreen("login");
    });
  });
})();
