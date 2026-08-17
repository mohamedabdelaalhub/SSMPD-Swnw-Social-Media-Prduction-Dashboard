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
    publish: window.SSMPDRenderPublish,
    archive: window.SSMPDRenderArchive,
    admin: window.SSMPDRenderAdmin
  };
  var TAB_LABELS = {
    summary: "الملخص العام",
    production: "إنتاج المحتوى",
    review: "إدارة المحتوى",
    design: "شاشة التصميم",
    publish: "النشر",
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

  var ACTIVE_TAB_KEY = "ssmpd_active_tab";

  function renderShell() {
    var admin = window.SSMPDAuth.currentAdmin;
    var tabs = Object.keys(TAB_LABELS).filter(function (t) { return R.canSeeTab(admin.role, t); });
    var displayName = escapeHtml(admin.name || admin.email);
    var roleLabel = R.label(admin.role);

    function tabButtonsHtml() {
      return tabs.map(function (t) { return '<button class="tab-btn" data-tab="' + t + '">' + TAB_LABELS[t] + '</button>'; }).join("");
    }

    // شريط تابات عادي على الشاشات الكبيرة + زرار قائمة منسدلة (اسم + سهم) يظهر بدل الشريط على الموبايل/التابلت
    // ترتيب محتوى القائمة المنسدلة زي ما طلب المستخدم بالظبط: الاسم، ثم الدور، ثم قائمة التابات، ثم خروج
    var html = '<div class="app-shell"><div class="topbar">' +
      '<div class="brand"><img src="assets/img/mark.svg" alt=""><span>SSMPD</span></div>' +
      '<div class="who"><span class="role-badge">' + roleLabel + '</span> <b>' + displayName + '</b>' +
      ' <button class="btn ghost sm" id="logout-btn">خروج</button></div>' +
      '<button class="menu-toggle" id="menu-toggle-btn" type="button"><b>' + displayName + '</b><span class="mt-arrow">▾</span></button>' +
      '</div>' +
      '<div class="tabs" id="tabs-bar">' + tabButtonsHtml() + '</div>' +
      '<div class="mobile-menu" id="mobile-menu">' +
      '<div class="mm-name">' + displayName + '</div>' +
      '<div class="mm-role"><span class="role-badge">' + roleLabel + '</span></div>' +
      '<div class="mm-tabs">' + tabButtonsHtml() + '</div>' +
      '<button class="btn ghost sm mm-logout" id="logout-btn-mobile">خروج</button>' +
      '</div>' +
      '<main class="view" id="view-container"></main></div>';
    root().innerHTML = html;

    var mobileMenu = document.getElementById("mobile-menu");
    var menuToggleBtn = document.getElementById("menu-toggle-btn");

    function doLogout() {
      try { sessionStorage.removeItem(ACTIVE_TAB_KEY); } catch (e) {}
      window.SSMPDAuth.signOut().then(function () { location.reload(); });
    }
    document.getElementById("logout-btn").onclick = doLogout;
    document.getElementById("logout-btn-mobile").onclick = doLogout;

    menuToggleBtn.onclick = function (e) {
      e.stopPropagation();
      mobileMenu.classList.toggle("open");
    };
    document.addEventListener("click", function (e) {
      if (mobileMenu.classList.contains("open") && !mobileMenu.contains(e.target) && e.target !== menuToggleBtn && !menuToggleBtn.contains(e.target)) {
        mobileMenu.classList.remove("open");
      }
    });

    document.querySelectorAll(".tab-btn").forEach(function (btn) {
      btn.onclick = function () {
        switchTab(btn.getAttribute("data-tab"));
        mobileMenu.classList.remove("open");
      };
    });

    // نرجّع آخر تاب كان مفتوح (لو لسه موجود ومسموح للدور ده) بدل ما نرجع دايماً للشاشة الافتراضية
    // — كده الريفريش/رجوع للصفحة (F5) ما يرجعش المستخدم للرئيسية من غير داعي
    var savedTab = null;
    try { savedTab = sessionStorage.getItem(ACTIVE_TAB_KEY); } catch (e) {}
    var startTab = (savedTab && tabs.indexOf(savedTab) !== -1) ? savedTab : R.defaultTab(admin.role);
    switchTab(startTab);
    setupRealtime();
  }

  function switchTab(tab) {
    currentTab = tab;
    try { sessionStorage.setItem(ACTIVE_TAB_KEY, tab); } catch (e) {}
    document.querySelectorAll(".tab-btn").forEach(function (b) {
      b.classList.toggle("active", b.getAttribute("data-tab") === tab);
    });
    var renderer = RENDERERS[tab];
    if (renderer) renderer.render(document.getElementById("view-container"));
  }

  // بيتحقق إن مفيش المستخدم بيكتب/مختار حاجة دلوقتي في الشاشة الحالية (كومنت لسه ما اتبعتش،
  // فورم جدولة نشر لسه مليان...) عشان الريفريش التلقائي ميمسحوش من تحته
  function isUserEditing() {
    var el = document.getElementById("view-container");
    if (!el) return false;
    var active = document.activeElement;
    if (active && el.contains(active)) {
      var tag = active.tagName;
      if (tag === "TEXTAREA" || tag === "SELECT") return true;
      if (tag === "INPUT" && ["checkbox", "radio", "file", "button", "submit"].indexOf(active.type) === -1) return true;
    }
    var fields = el.querySelectorAll("textarea, input[type=text], input[type=number], input[type=date], input[type=datetime-local], input[type=email], input[type=password], input[type=search]");
    for (var i = 0; i < fields.length; i++) {
      if (fields[i].value) return true;
    }
    // زرار في وضع "متأكد؟" (تأكيد بضغطة تانية) — ما نمسحوش الحالة دي من تحت المستخدم
    if (el.querySelector(".confirm-pending")) return true;
    return false;
  }

  // تحديث لحظي: أعد رسم التاب الحالي لو بيعرض بيانات محتوى، وما فيش مودال مفتوح، ومفيش
  // إجراء/بيانات لسه المستخدم شغال عليها (كتابة كومنت، فورم جدولة، ...) دلوقتي
  function refreshCurrentTab() {
    if (["summary", "production", "review", "design", "publish", "archive"].indexOf(currentTab) !== -1) {
      var el = document.getElementById("view-container");
      if (el && !document.querySelector(".modal-backdrop") && !isUserEditing()) {
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
