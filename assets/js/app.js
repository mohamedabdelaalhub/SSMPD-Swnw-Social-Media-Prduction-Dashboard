/* SSMPD — نقطة البداية: الدخول، الشِل العام، التنقّل بين الشاشات */
(function () {
  "use strict";

  var R = window.SSMPDRoles;
  var currentTab = null;
  var realtimeChannel = null;
  var commentsChannel = null;
  var leadsChannel = null;
  var pollTimer = null;

  var RENDERERS = {
    summary: window.SSMPDRenderSummary,
    production: window.SSMPDRenderProduction,
    review: window.SSMPDRenderReview,
    design: window.SSMPDRenderDesign,
    publish: window.SSMPDRenderPublish,
    archive: window.SSMPDRenderArchive,
    patients: window.SSMPDRenderPatients,
    leads: window.SSMPDRenderLeads,
    admin: window.SSMPDRenderAdmin
  };
  var TAB_LABELS = {
    summary: "الملخص العام",
    production: "إنتاج المحتوى",
    review: "إدارة المحتوى",
    design: "شاشة التصميم",
    publish: "النشر",
    archive: "الأرشيف",
    patients: "أرشيف المرضى",
    leads: "إدارة الليدز والتواصل",
    admin: "لوحة التحكم"
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
    var tabs = Object.keys(TAB_LABELS).filter(function (t) { return R.canSeeTab(admin, t); });
    var displayName = escapeHtml(admin.name || admin.email);
    var roleLabel = R.labelAll(admin);

    // قائمة منسدلة موحّدة (أيقونة بجانب الاسم) — بالترتيب اللي طلبه المستخدم بالظبط:
    // الاسم، ثم الدور، ثم SSMPD، ثم أرشيف المرضى، ثم إدارة الليدز والتواصل، ثم تغيير كلمة السر،
    // ثم لوحة التحكم (لو سوبر أدمن)، ثم خروج
    // ملحوظة مهمة: "أرشيف المرضى" و"إدارة الليدز" و"لوحة التحكم" بقوا تابات
    // القائمة المنسدلة فقط — اتشالوا من شريط التابات العادي (وقائمة الموبايل
    // القديمة) عشان ميبقوش متكررين في مكانين، ويبانوا بس في المكان اللي
    // المستخدم طلبه (جوه القائمة المنسدلة).
    var mainSuiteTabs = tabs.filter(function (t) { return ["patients", "leads", "admin"].indexOf(t) === -1; });

    function tabButtonsHtml() {
      return mainSuiteTabs.map(function (t) { return '<button class="tab-btn" data-tab="' + t + '">' + TAB_LABELS[t] + '</button>'; }).join("");
    }
    var ddItems = '';
    if (mainSuiteTabs.length) ddItems += '<button class="ud-item" data-goto="' + mainSuiteTabs[0] + '">SSMPD</button>';
    if (tabs.indexOf("patients") !== -1) ddItems += '<button class="ud-item" data-goto="patients">أرشيف المرضى</button>';
    if (tabs.indexOf("leads") !== -1) ddItems += '<button class="ud-item" data-goto="leads">إدارة الليدز والتواصل</button>';
    ddItems += '<button class="ud-item" id="ud-change-pass">تغيير كلمة السر</button>';
    if (tabs.indexOf("admin") !== -1) ddItems += '<button class="ud-item" data-goto="admin">لوحة التحكم</button>';

    // شريط تابات عادي على الشاشات الكبيرة + زرار قائمة منسدلة (اسم + سهم) يظهر بدل الشريط على الموبايل/التابلت
    // ترتيب محتوى القائمة المنسدلة زي ما طلب المستخدم بالظبط: الاسم، ثم الدور، ثم قائمة التابات، ثم خروج
    var html = '<div class="app-shell"><div class="topbar">' +
      '<div class="brand"><img src="assets/img/mark.svg" alt=""><span id="brand-section-name">مركز عيادات سونو التخصصية</span></div>' +
      '<div class="who"><span class="role-badge">' + roleLabel + '</span> <b>' + displayName + '</b>' +
      '<button class="user-menu-icon" id="user-menu-btn" type="button" title="القائمة" aria-label="القائمة">☰</button>' +
      ' <button class="btn ghost sm" id="logout-btn">خروج</button></div>' +
      '<button class="menu-toggle" id="menu-toggle-btn" type="button"><b>' + displayName + '</b><span class="mt-arrow">▾</span></button>' +
      '</div>' +
      '<div class="user-dropdown" id="user-dropdown">' +
      '<div class="mm-name">' + displayName + '</div>' +
      '<div class="mm-role"><span class="role-badge">' + roleLabel + '</span></div>' +
      '<div class="ud-items">' + ddItems + '</div>' +
      '<button class="btn ghost sm mm-logout" id="logout-btn-dropdown">خروج</button>' +
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
    var userDropdown = document.getElementById("user-dropdown");
    var userMenuBtn = document.getElementById("user-menu-btn");

    function doLogout() {
      try { sessionStorage.removeItem(ACTIVE_TAB_KEY); } catch (e) {}
      window.SSMPDAuth.signOut().then(function () { location.reload(); });
    }
    document.getElementById("logout-btn").onclick = doLogout;
    document.getElementById("logout-btn-mobile").onclick = doLogout;
    document.getElementById("logout-btn-dropdown").onclick = doLogout;

    menuToggleBtn.onclick = function (e) {
      e.stopPropagation();
      mobileMenu.classList.toggle("open");
    };
    userMenuBtn.onclick = function (e) {
      e.stopPropagation();
      userDropdown.classList.toggle("open");
    };
    document.addEventListener("click", function (e) {
      if (mobileMenu.classList.contains("open") && !mobileMenu.contains(e.target) && e.target !== menuToggleBtn && !menuToggleBtn.contains(e.target)) {
        mobileMenu.classList.remove("open");
      }
      if (userDropdown.classList.contains("open") && !userDropdown.contains(e.target) && e.target !== userMenuBtn && !userMenuBtn.contains(e.target)) {
        userDropdown.classList.remove("open");
      }
    });

    document.getElementById("ud-change-pass").onclick = function () {
      userDropdown.classList.remove("open");
      openChangePasswordModal();
    };
    userDropdown.querySelectorAll("[data-goto]").forEach(function (btn) {
      btn.onclick = function () {
        switchTab(btn.getAttribute("data-goto"));
        userDropdown.classList.remove("open");
      };
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
    var startTab = (savedTab && tabs.indexOf(savedTab) !== -1) ? savedTab : R.defaultTab(admin);
    switchTab(startTab);
    setupRealtime();
  }

  function openChangePasswordModal() {
    var backdrop = document.createElement("div");
    backdrop.className = "modal-backdrop";
    backdrop.innerHTML = '<div class="modal" style="max-width:420px;">' +
      '<div class="modal-head"><h3>تغيير كلمة السر</h3><button class="modal-close">×</button></div>' +
      '<div class="field"><label>كلمة السر الجديدة</label><input id="cp-pass1" type="password"></div>' +
      '<div class="field"><label>تأكيد كلمة السر</label><input id="cp-pass2" type="password"></div>' +
      '<button class="btn block" id="cp-save" style="margin-top:10px;">حفظ</button>' +
      '</div>';
    document.body.appendChild(backdrop);

    function close() { backdrop.remove(); }
    backdrop.querySelector(".modal-close").onclick = close;
    backdrop.addEventListener("click", function (e) { if (e.target === backdrop) close(); });

    backdrop.querySelector("#cp-save").onclick = function () {
      var p1 = document.getElementById("cp-pass1").value;
      var p2 = document.getElementById("cp-pass2").value;
      if (!p1 || p1.length < 6) { window.SSMPDToast.show("كلمة السر لازم تكون ٦ حروف/أرقام على الأقل", "error"); return; }
      if (p1 !== p2) { window.SSMPDToast.show("كلمة السر وتأكيدها مش متطابقين", "error"); return; }
      window.SSMPDAuth.changePassword(p1).then(function () {
        window.SSMPDToast.show("اتغيّرت كلمة السر بنجاح");
        close();
      }).catch(function (err) {
        window.SSMPDToast.show("خطأ: " + (err && err.message ? err.message : err), "error");
      });
    };
  }

  function switchTab(tab) {
    currentTab = tab;
    try { sessionStorage.setItem(ACTIVE_TAB_KEY, tab); } catch (e) {}
    document.querySelectorAll(".tab-btn").forEach(function (b) {
      b.classList.toggle("active", b.getAttribute("data-tab") === tab);
    });

    // اسم الشعار بيتغيّر حسب السكشن المفتوح دلوقتي: اسم المركز + اسم السكشن
    var brandName = document.getElementById("brand-section-name");
    if (brandName) {
      brandName.textContent = "مركز عيادات سونو التخصصية" + (TAB_LABELS[tab] ? " | " + TAB_LABELS[tab] : "");
    }

    // فصل بصري: تابات السويت الرئيسي (SSMPD) بتتخفي تماماً لما نكون جوه موديول
    // منفصل (أرشيف المرضى / الليدز / لوحة التحكم) عشان ميظهرش هيدر حاجتين مع بعض
    var isSeparateModule = ["patients", "leads", "admin"].indexOf(tab) !== -1;
    var tabsBar = document.getElementById("tabs-bar");
    if (tabsBar) tabsBar.style.display = isSeparateModule ? "none" : "";
    var mmTabs = document.querySelector("#mobile-menu .mm-tabs");
    if (mmTabs) mmTabs.style.display = isSeparateModule ? "none" : "";

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
    if (["summary", "production", "review", "design", "publish", "archive", "patients", "leads"].indexOf(currentTab) !== -1) {
      var el = document.getElementById("view-container");
      if (el && !document.querySelector(".modal-backdrop") && !isUserEditing()) {
        RENDERERS[currentTab].render(el);
      }
    }
  }

  function setupRealtime() {
    if (realtimeChannel) window.SSMPDDb.unsubscribe(realtimeChannel);
    if (commentsChannel) window.SSMPDDb.unsubscribe(commentsChannel);
    if (leadsChannel) window.SSMPDDb.unsubscribe(leadsChannel);
    realtimeChannel = window.SSMPDDb.subscribeTable("content_items", refreshCurrentTab);
    commentsChannel = window.SSMPDDb.subscribeTable("comments", refreshCurrentTab);
    leadsChannel = window.SSMPDDb.subscribeTable("leads", refreshCurrentTab);

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
