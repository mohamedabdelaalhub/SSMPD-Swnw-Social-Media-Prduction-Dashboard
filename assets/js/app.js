/* SSMPD — نقطة البداية: الدخول، الشِل العام، التنقّل بين الشاشات */
(function () {
  "use strict";

  var R = window.SSMPDRoles;
  var currentTab = null;
  var realtimeChannel = null;
  var commentsChannel = null;
  var leadsChannel = null;
  var pollTimer = null;
  var usageSessionId = null;
  var usageHeartbeatTimer = null;

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
      '<div class="field"><label>البريد الإلكتروني</label><input id="auth-email" type="email" autocomplete="username" autocapitalize="off" autocorrect="off" spellcheck="false"></div>' +
      '<div class="field"><label>كلمة السر</label><input id="auth-pass" type="password" autocomplete="current-password" autocapitalize="off" autocorrect="off" spellcheck="false"></div>';

    if (mode === "signup") {
      html += '<div class="field"><label>الاسم</label><input id="auth-name"></div>' +
        '<button class="btn block" id="auth-submit">إنشاء الحساب</button>' +
        '<p style="margin-top:14px;font-size:12px;"><a href="#" id="switch-mode">عندك حساب؟ سجّل الدخول</a></p>';
    } else {
      html += '<button class="btn block" id="auth-submit">دخول</button>' +
        '<p style="margin-top:14px;font-size:12px;"><a href="#" id="forgot-pass">نسيت كلمة السر؟</a></p>' +
        '<p style="margin-top:6px;font-size:12px;"><a href="#" id="switch-mode">حساب جديد؟ اضغط هنا (لو اتضفت من الأدمن)</a></p>';
    }
    html += '</div></div>';
    root().innerHTML = html;

    document.getElementById("switch-mode").onclick = function (e) {
      e.preventDefault();
      showAuthScreen(mode === "login" ? "signup" : "login");
    };

    var forgotLink = document.getElementById("forgot-pass");
    if (forgotLink) {
      forgotLink.onclick = function (e) {
        e.preventDefault();
        openForgotPasswordModal();
      };
    }

    document.getElementById("auth-submit").onclick = function () {
      var email = document.getElementById("auth-email").value.trim();
      // تريم زي الإيميل بالظبط — بيمنع مسافة/سطر جديد مخفي (شائع لو الباسورد
      // اتنسخ من رسالة واتساب/ماسنجر) يسبب "الباسورد غلط" وهو أصلاً صح
      var pass = document.getElementById("auth-pass").value.trim();
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
        startUsageSession();
      });
    }).catch(function (err) {
      window.SSMPDAuth.signOut();
      showAuthScreen("login", translateAuthError(err));
    });
  }

  // ---------- تقرير الاستخدام: جلسة واحدة = من تحميل الداشبورد لحد الخروج/آخر نبضة ----------
  // (تقرير الاستخدام نفسه بيتعرض في لوحة التحكم — render-admin.js)
  function startUsageSession() {
    var admin = window.SSMPDAuth.currentAdmin;
    if (!admin || !admin.id) return;
    window.SSMPDDb.startLoginSession(admin.id).then(function (row) {
      usageSessionId = row.id;
      if (usageHeartbeatTimer) clearInterval(usageHeartbeatTimer);
      usageHeartbeatTimer = setInterval(function () {
        if (usageSessionId) window.SSMPDDb.touchLoginSession(usageSessionId).catch(function () {});
      }, 120000);
    }).catch(function () {});
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
      '<div style="position:relative;flex:1;max-width:280px;margin:0 10px;">' +
      '<input id="global-search-input" type="search" placeholder="بحث (Ctrl+K)…" autocomplete="off" style="width:100%;padding:7px 10px;border-radius:10px;border:1px solid var(--c-border);font-size:12px;">' +
      '<div id="global-search-results" hidden style="position:absolute;top:100%;right:0;left:0;background:var(--c-card);border:1px solid var(--c-border);border-radius:10px;margin-top:4px;max-height:340px;overflow:auto;z-index:50;box-shadow:0 6px 18px rgba(0,0,0,.12);"></div>' +
      '</div>' +
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
      if (usageHeartbeatTimer) { clearInterval(usageHeartbeatTimer); usageHeartbeatTimer = null; }
      var finish = function () { window.SSMPDAuth.signOut().then(function () { location.reload(); }); };
      if (usageSessionId) { window.SSMPDDb.endLoginSession(usageSessionId).then(finish, finish); } else { finish(); }
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

    setupGlobalSearch(admin, tabs);

    // نرجّع آخر تاب كان مفتوح (لو لسه موجود ومسموح للدور ده) بدل ما نرجع دايماً للشاشة الافتراضية
    // — كده الريفريش/رجوع للصفحة (F5) ما يرجعش المستخدم للرئيسية من غير داعي
    var savedTab = null;
    try { savedTab = sessionStorage.getItem(ACTIVE_TAB_KEY); } catch (e) {}
    var startTab = (savedTab && tabs.indexOf(savedTab) !== -1) ? savedTab : R.defaultTab(admin);
    switchTab(startTab);
    setupRealtime();
  }

  // بحث موحّد في الشريط العلوي (مرحلة ٦): بيدوّر بالتوازي في المحتوى/الليدز/
  // أرشيف المرضى — كل واحد بس لو الدور عنده وصول للتاب المقابل (تكلفة صفر
  // على أي حد مش هيستخدمه). Ctrl+K/⌘K يفوكّس الحقل، Enter يبحث، Escape يقفل.
  function setupGlobalSearch(admin, tabs) {
    var input = document.getElementById("global-search-input");
    var resultsBox = document.getElementById("global-search-results");
    if (!input || !resultsBox) return;

    function escapeHtml(s) {
      return String(s == null ? "" : s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
    }
    function hideResults() { resultsBox.hidden = true; resultsBox.innerHTML = ""; }
    function itemBtn(type, id, label) {
      return '<button type="button" class="gsearch-item" data-type="' + type + '" data-id="' + (id || "") + '" ' +
        'style="display:block;width:100%;text-align:right;padding:7px 10px;border:none;background:none;font-size:12px;cursor:pointer;">' +
        escapeHtml(label) + '</button>';
    }

    function runSearch(term) {
      term = term.trim();
      if (term.length < 2) { hideResults(); return; }
      var canContent = tabs.indexOf("review") !== -1 || tabs.indexOf("production") !== -1;
      var canLeads = tabs.indexOf("leads") !== -1;
      var canPatients = tabs.indexOf("patients") !== -1;

      Promise.all([
        canContent ? window.SSMPDDb.searchContentItems(term) : Promise.resolve([]),
        canLeads ? window.SSMPDDb.listLeads({ search: term, page_size: 6 }) : Promise.resolve(null),
        canPatients ? window.SSMPDDb.listPatientsArchive({ search: term, page_size: 6 }) : Promise.resolve(null)
      ]).then(function (res) {
        var contentItems = res[0] || [];
        var leadsItems = (res[1] && res[1].leads) || [];
        var patientsItems = (res[2] && res[2].patients) || [];

        var html = "";
        if (contentItems.length) {
          html += '<div style="padding:6px 10px;font-size:11px;color:var(--c-muted);">المحتوى</div>';
          contentItems.forEach(function (i) { html += itemBtn("content", i.id, i.title); });
        }
        if (leadsItems.length) {
          html += '<div style="padding:6px 10px;font-size:11px;color:var(--c-muted);">الليدز</div>';
          leadsItems.forEach(function (l) { html += itemBtn("leads", "", l.customer_name || l.phone_raw || "—"); });
        }
        if (patientsItems.length) {
          html += '<div style="padding:6px 10px;font-size:11px;color:var(--c-muted);">أرشيف المرضى</div>';
          patientsItems.forEach(function (p) { html += itemBtn("patients", "", p.full_name || p.phone || "—"); });
        }
        if (!html) html = '<div style="padding:10px;font-size:12px;color:var(--c-muted);">مفيش نتائج</div>';
        resultsBox.innerHTML = html;
        resultsBox.hidden = false;

        resultsBox.querySelectorAll(".gsearch-item").forEach(function (btn) {
          btn.onclick = function () {
            var type = btn.getAttribute("data-type");
            hideResults();
            input.value = "";
            if (type === "content") {
              window.SSMPDPendingOpenContentId = btn.getAttribute("data-id");
              switchTab(tabs.indexOf("review") !== -1 ? "review" : "production");
            } else if (type === "leads") {
              window.SSMPDRenderLeads.openSearch(term);
              switchTab("leads");
            } else if (type === "patients") {
              window.SSMPDRenderPatients.openSearch(term);
              switchTab("patients");
            }
          };
        });
      }).catch(function () { hideResults(); });
    }

    input.addEventListener("keydown", function (e) {
      if (e.key === "Enter") { e.preventDefault(); runSearch(input.value); }
      else if (e.key === "Escape") { input.blur(); hideResults(); }
    });
    document.addEventListener("click", function (e) {
      if (!resultsBox.contains(e.target) && e.target !== input) hideResults();
    });
    document.addEventListener("keydown", function (e) {
      var mod = e.ctrlKey || e.metaKey;
      if (mod && e.key.toLowerCase() === "k") { e.preventDefault(); input.focus(); input.select(); }
    });
  }

  // مودال "نسيت كلمة السر؟" — بدون أي اعتماد على إيميل Supabase (القرار:
  // التحكم بالكامل عن طريق السوبر أدمن، مش عن طريق خدمة إيميل خارجية).
  // بيوضح للموظف إنه يتواصل مع السوبر أدمن، اللي عنده زرار "تغيير كلمة
  // السر" مباشر لأي مستخدم من لوحة "المستخدمون والصلاحيات" (`?v=35`).
  function openForgotPasswordModal() {
    var backdrop = document.createElement("div");
    backdrop.className = "modal-backdrop";
    backdrop.innerHTML = '<div class="modal" style="max-width:420px;">' +
      '<div class="modal-head"><h3>نسيت كلمة السر؟</h3><button class="modal-close">×</button></div>' +
      '<p style="font-size:13px;color:var(--c-text);line-height:1.7;">كلمة السر بتتغيّر بس عن طريق السوبر أدمن — تواصل معاه وهيغيّرها لك مباشرة من لوحة التحكم.</p>' +
      '<button class="btn block" id="fp-ok">تمام</button>' +
      '</div>';
    document.body.appendChild(backdrop);

    function close() { backdrop.remove(); }
    backdrop.querySelector(".modal-close").onclick = close;
    backdrop.querySelector("#fp-ok").onclick = close;
    backdrop.addEventListener("click", function (e) { if (e.target === backdrop) close(); });
  }

  function openChangePasswordModal() {
    var backdrop = document.createElement("div");
    backdrop.className = "modal-backdrop";
    backdrop.innerHTML = '<div class="modal" style="max-width:420px;">' +
      '<div class="modal-head"><h3>تغيير كلمة السر</h3><button class="modal-close">×</button></div>' +
      '<div class="field"><label>كلمة السر الجديدة</label><input id="cp-pass1" type="password" autocomplete="new-password" autocapitalize="off" autocorrect="off" spellcheck="false"></div>' +
      '<div class="field"><label>تأكيد كلمة السر</label><input id="cp-pass2" type="password" autocomplete="new-password" autocapitalize="off" autocorrect="off" spellcheck="false"></div>' +
      '<button class="btn block" id="cp-save" style="margin-top:10px;">حفظ</button>' +
      '</div>';
    document.body.appendChild(backdrop);

    function close() { backdrop.remove(); }
    backdrop.querySelector(".modal-close").onclick = close;
    backdrop.addEventListener("click", function (e) { if (e.target === backdrop) close(); });

    backdrop.querySelector("#cp-save").onclick = function () {
      var p1 = document.getElementById("cp-pass1").value.trim();
      var p2 = document.getElementById("cp-pass2").value.trim();
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
    // لينك "نسيت كلمة السر" بيرجّع المستخدم هنا بجلسة مؤقتة تلقائية —
    // Supabase بيطلق الحدث ده، فبنفتحله مودال "تغيير كلمة السر" مباشرة
    window.SSMPDAuth.onAuthChange(function (event) {
      if (event === "PASSWORD_RECOVERY") openChangePasswordModal();
    });
    window.SSMPDAuth.getSession().then(function (session) {
      if (session) return bootAfterAuth();
      showAuthScreen("login");
    });
  });
})();
