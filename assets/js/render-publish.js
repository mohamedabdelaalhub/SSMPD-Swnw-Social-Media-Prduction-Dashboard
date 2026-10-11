/* SSMPD — تاب النشر: المواد المعتمدة (محتوى + تصميم) بتتجدول أو تتنشر من هنا
   قسم ٤٣: فيسبوك/انستجرام بقوا بينشروا فعليًا (Meta Auto Publisher — خلفية
   عن طريق meta_publish_jobs + Edge Function + pg_cron) بدل تأكيد رابط يدوي.
   تيكتوك/يوتيوب الإلكتروني لسه نشر يدوي زي الأول بالظبط. */
(function () {
  "use strict";
  var W = window.SSMPDWorkflow;
  var C = window.SSMPDComments;

  var META_PLATFORMS = ["facebook", "instagram"];
  var previewPending = new Set();

  function reviewBeforePublishing(id, label, proceed) {
    if (previewPending.has(id)) return;
    previewPending.add(id);
    window.SSMPDDb.getContentItem(id).then(function (item) {
      if (!item || item.stage !== "ready_to_publish") throw new Error("المادة لم تعد جاهزة للنشر. حدّث الصفحة.");
      return window.SSMPDContentText.preview(item, label);
    }).then(function (accepted) {
      if (accepted) proceed();
    }).catch(function (error) { notify(error.message, "error"); })
      .finally(function () { previewPending.delete(id); });
  }

  // حالة عرض الكالندر (اختياري بجانب القائمة العادية) — نفس نمط شاشة الأرشيف
  var viewState = { mode: "list", calView: "month", cursor: new Date() };

  function dayKey(d) {
    return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
  }

  var JOB_STATUS_LABELS = {
    pending: { label: "في الانتظار", cls: "draft" },
    processing: { label: "جاري النشر", cls: "received" },
    published: { label: "تم النشر", cls: "approved" },
    partial: { label: "نشر جزئي", cls: "revision" },
    failed: { label: "فشل", cls: "rejected" },
    cancelled: { label: "أُلغي", cls: "draft" }
  };

  function escapeHtml(s) {
    return String(s == null ? "" : s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  }

  function valueOf(id) {
    var el = document.getElementById(id);
    return el ? el.value.trim() : "";
  }

  function hasMetaPlatform(platforms) {
    return platforms.some(function (p) { return META_PLATFORMS.indexOf(p) !== -1; });
  }

  function render(container) {
    var me = window.SSMPDAuth.currentAdmin;
    container.innerHTML = "<div class=\"loading\"> <!--ssmpd-i18n:%D8%A8%D9%8A%D8%AD%D9%85%D9%91%D9%84%E2%80%A6-->بيحمّل…</div>";
    Promise.all([
      window.SSMPDDb.listContentItems({}),
      window.SSMPDDb.listAdminsBasic(),
      window.SSMPDDb.listAllComments(),
      window.SSMPDDb.listMyCommentReads(me.id)
    ]).then(function (res) {
      var items = res[0], admins = res[1];
      var stats = C.computeCommentStats(res[2], res[3], me.id);
      var adminsById = {}; admins.forEach(function (a) { adminsById[a.id] = a; });

      var scheduled = items.filter(function (i) { return i.stage === "scheduled"; });
      scheduled.sort(function (a, b) {
        return new Date(a.scheduled_publish_at || 0) - new Date(b.scheduled_publish_at || 0);
      });
      var ready = items.filter(function (i) { return i.stage === "ready_to_publish"; });

      var contentIds = scheduled.concat(ready).map(function (i) { return i.id; });
      return window.SSMPDDb.listMetaPublishJobsForContent(contentIds).catch(function () { return []; }).then(function (jobs) {
        // أحدث job لكل مادة (الاستعلام مرتب created_at desc بالفعل)
        var jobByContent = {};
        jobs.forEach(function (j) { if (!jobByContent[j.content_id]) jobByContent[j.content_id] = j; });

        var ctx = { allItems: items, scheduled: scheduled, ready: ready, adminsById: adminsById, jobByContent: jobByContent };
        if (viewState.mode === "calendar") renderCalendarView(container, ctx);
        else if (viewState.mode === "days") renderDaysView(container, ctx);
        else renderListView(container, ctx);

      });
    }).catch(function (e) {
      container.innerHTML = '<div class="err-msg">خطأ: ' + e.message + '</div>';
    });
  }

  function viewToggleHtml() {
    return '<div style="display:flex;gap:6px;">' +
      '<button class="btn ' + (viewState.mode === "list" ? "" : "ghost") + ' sm" id="pb-view-list">قائمة</button>' +
      '<button class="btn ' + (viewState.mode === "days" ? "" : "ghost") + ' sm" id="pb-view-days">كروت الأيام</button>' +
      '<button class="btn ' + (viewState.mode === "calendar" ? "" : "ghost") + ' sm" id="pb-view-calendar">كالندر</button>' +
      '</div>';
  }

  function wireViewToggle(container, ctx) {
    var listBtn = document.getElementById("pb-view-list");
    var calBtn = document.getElementById("pb-view-calendar");
    var daysBtn = document.getElementById("pb-view-days");
    if (daysBtn) daysBtn.onclick = function () { viewState.mode = "days"; renderDaysView(container, ctx); };
    if (listBtn) listBtn.onclick = function () { viewState.mode = "list"; renderListView(container, ctx); };
    if (calBtn) calBtn.onclick = function () { viewState.mode = "calendar"; renderCalendarView(container, ctx); };
  }

  function renderListView(container, ctx) {
    var scheduled = ctx.scheduled, ready = ctx.ready, adminsById = ctx.adminsById, jobByContent = ctx.jobByContent;
    var html = '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px;flex-wrap:wrap;gap:8px;">' +
      "<h2 style=\"margin:0;\"> <!--ssmpd-i18n:%D8%A7%D9%84%D9%86%D8%B4%D8%B1-->النشر</h2>" + viewToggleHtml() + '</div>' +
      '<p style="color:var(--c-muted);font-size:12px;margin-top:-10px;margin-bottom:16px;">هنا كل مادة خلصت اعتماد نهائي وتصميم — جاهزة تتجدول أو تتنشر مباشرة. فيسبوك/انستجرام بينشروا تلقائيًا، تيكتوك/يوتيوب بتحتاج تأكيد يدوي. نشر الموقع له قسم مستقل.</p>';

    html += '<div class="section"><h3>مجدولة للنشر (' + scheduled.length + ')</h3>';
    if (!scheduled.length) {
      html += '<div class="empty-state">مفيش مواد مجدولة دلوقتي</div>';
    } else {
      scheduled.forEach(function (i) { html += renderCard(i, adminsById, "scheduled", jobByContent[i.id]); });
    }
    html += '</div>';

    html += '<div class="section"><h3>جاهزة للنشر (' + ready.length + ')</h3>';
    if (!ready.length) {
      html += '<div class="empty-state">مفيش مواد جاهزة للنشر دلوقتي</div>';
    } else {
      ready.forEach(function (i) { html += renderCard(i, adminsById, "ready", jobByContent[i.id]); });
    }
    html += '</div>';

    container.innerHTML = html;
    window.SSMPDWebsite.mount(container, ctx.allItems);
    wireViewToggle(container, ctx);
    wire(container);
    window.SSMPDScheduleHistory.mountAll(container, scheduled, adminsById);
    window.SSMPDPublicationPreview.mountSlots(container,scheduled.concat(ready));
    window.SSMPDWebsite.mountActions(container,scheduled.concat(ready));
    scheduled.concat(ready).forEach(function (i) {
      var slot = document.getElementById("comments-slot-" + i.id);
      if (slot) window.SSMPDComments.render(slot, i.id, adminsById);
    });
  }

  // عرض كالندر اختياري (شهر/أسبوع) للمواد المجدولة حسب معاد النشر — نفس
  // فكرة كالندر الأرشيف بالظبط. المواد "جاهزة للنشر" لسه من غير معاد محدد،
  // فبتتعرض في قايمة صغيرة تحت الكالندر بدل ما تختفي.
  function renderCalendarView(container, ctx) {
    var W = window.SSMPDWorkflow;
    var scheduled = ctx.scheduled, ready = ctx.ready, adminsById = ctx.adminsById;
    var byDay = {};
    scheduled.forEach(function (i) {
      if (!i.scheduled_publish_at) return;
      var k = dayKey(new Date(i.scheduled_publish_at));
      (byDay[k] = byDay[k] || []).push(i);
    });

    var cursor = viewState.cursor;
    var year = cursor.getFullYear(), month = cursor.getMonth();
    var monthLabel = cursor.toLocaleDateString("ar-EG", { month: "long", year: "numeric" });

    var html = '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px;flex-wrap:wrap;gap:8px;">' +
      "<h2 style=\"margin:0;\"> <!--ssmpd-i18n:%D8%A7%D9%84%D9%86%D8%B4%D8%B1-->النشر</h2>" + viewToggleHtml() + '</div>';

    html += '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:14px;flex-wrap:wrap;gap:8px;">' +
      '<h3 style="margin:0;">' + monthLabel + '</h3>' +
      '<div style="display:flex;gap:6px;">' +
      "<button class=\"btn ghost sm\" id=\"pb-cal-prev\"> <!--ssmpd-i18n:%E2%80%B9%20%D8%A7%D9%84%D8%B3%D8%A7%D8%A8%D9%82-->‹ السابق</button>" +
      '<button class="btn ghost sm" id="pb-cal-today">النهارده</button>' +
      "<button class=\"btn ghost sm\" id=\"pb-cal-next\"> <!--ssmpd-i18n:%D8%A7%D9%84%D8%AA%D8%A7%D9%84%D9%8A%20%E2%80%BA-->التالي ›</button>" +
      '<button class="btn ' + (viewState.calView === "month" ? "" : "ghost") + " sm\" id=\"pb-cal-month\"> <!--ssmpd-i18n:%D8%B4%D9%87%D8%B1-->شهر</button>" +
      '<button class="btn ' + (viewState.calView === "week" ? "" : "ghost") + " sm\" id=\"pb-cal-week\"> <!--ssmpd-i18n:%D8%A3%D8%B3%D8%A8%D9%88%D8%B9-->أسبوع</button>" +
      '</div></div>';

    var firstOfMonth = new Date(year, month, 1);
    var startOffset = firstOfMonth.getDay();
    var daysInMonth = new Date(year, month + 1, 0).getDate();

    var cellsStart;
    if (viewState.calView === "week") {
      var wd = cursor.getDay();
      cellsStart = new Date(cursor); cellsStart.setDate(cursor.getDate() - wd);
    }

    html += '<div class="calendar-grid">';
    ["أحد", "اثنين", "ثلاثاء", "أربعاء", "خميس", "جمعة", "سبت"].forEach(function (d) {
      html += '<div style="text-align:center;font-size:11px;font-weight:700;color:var(--c-muted);">' + d + '</div>';
    });

    var cellsToRender = [];
    if (viewState.calView === "month") {
      for (var i = 0; i < startOffset; i++) cellsToRender.push(null);
      for (var d = 1; d <= daysInMonth; d++) cellsToRender.push(new Date(year, month, d));
    } else {
      for (var wdi = 0; wdi < 7; wdi++) {
        var dd = new Date(cellsStart); dd.setDate(cellsStart.getDate() + wdi);
        cellsToRender.push(dd);
      }
    }

    var todayKey = dayKey(new Date());
    cellsToRender.forEach(function (d) {
      if (!d) { html += '<div class="calendar-cell" style="background:transparent;border:none;"></div>'; return; }
      var k = dayKey(d);
      var dayItems = byDay[k] || [];
      var isToday = k === todayKey;
      html += '<div class="calendar-cell"' + (isToday ? ' style="border-color:var(--c-primary);"' : '') + '><div class="day-num">' + d.getDate() + '</div>';
      dayItems.forEach(function (it) {
        var timeLabel = new Date(it.scheduled_publish_at).toLocaleTimeString("ar-EG", { hour: "2-digit", minute: "2-digit" });
        html += '<div class="item" data-open-pub="' + it.id + '" title="' + escapeHtml(it.title) + '">' + timeLabel + ' — ' + escapeHtml(it.title) + W.brandBadgeHtml(it.brand) + '</div>';
      });
      html += '</div>';
    });
    html += '</div>';

    html += '<div class="section" style="margin-top:16px;"><h3>جاهزة للنشر بدون معاد محدد (' + ready.length + ')</h3>';
    if (!ready.length) {
      html += '<div class="empty-state">مفيش مواد جاهزة للنشر دلوقتي</div>';
    } else {
      html += '<div style="display:flex;flex-direction:column;gap:6px;">' + ready.map(function (i) {
        return '<div class="item" data-open-pub="' + i.id + '" style="cursor:pointer;padding:8px 10px;border:1px solid var(--c-border);border-radius:8px;">' +
          escapeHtml(i.title) + W.brandBadgeHtml(i.brand) + '</div>';
      }).join('') + '</div>';
    }
    html += '</div>';

    container.innerHTML = html;
    window.SSMPDWebsite.mount(container, ctx.allItems);
    wireViewToggle(container, ctx);

    document.getElementById("pb-cal-prev").onclick = function () {
      if (viewState.calView === "month") cursor.setMonth(cursor.getMonth() - 1); else cursor.setDate(cursor.getDate() - 7);
      renderCalendarView(container, ctx);
    };
    document.getElementById("pb-cal-next").onclick = function () {
      if (viewState.calView === "month") cursor.setMonth(cursor.getMonth() + 1); else cursor.setDate(cursor.getDate() + 7);
      renderCalendarView(container, ctx);
    };
    document.getElementById("pb-cal-today").onclick = function () {
      viewState.cursor = new Date(); renderCalendarView(container, ctx);
    };
    document.getElementById("pb-cal-month").onclick = function () { viewState.calView = "month"; renderCalendarView(container, ctx); };
    document.getElementById("pb-cal-week").onclick = function () { viewState.calView = "week"; renderCalendarView(container, ctx); };

    container.querySelectorAll("[data-open-pub]").forEach(function (el) {
      el.onclick = function () { openPublishDetailModal(el.getAttribute("data-open-pub"), ctx); };
    });
  }

  // عرض "كروت الأيام": كل يوم فيه مواد مجدولة كارت لوحده، مجمّعين تحت عناوين (متأخرة / الأسبوع ده / الأسبوع الجاي / بعد كده)،
  // وجوه الكارت كل مادة بساعتها وعنوانها وتحتهم الصفحة والمنصات ومين جدولها.
  var LATN = "ar-EG-u-nu-latn";
  function timeParts(iso) {
    var parts = new Intl.DateTimeFormat(LATN, { hour: "2-digit", minute: "2-digit", hour12: true }).formatToParts(new Date(iso)), out = { h: "", m: "", p: "" };
    parts.forEach(function (x) { if (x.type === "hour") out.h = x.value; if (x.type === "minute") out.m = x.value; if (x.type === "dayPeriod") out.p = x.value; });
    return out;
  }
  // ثمبنيل التصميم على شمال كل مادة في كروت الأيام: بوست = التصميم، كاروسيل = الكفر (الشريحة الأولى)، فيديو = أول فريم.
  // الصور خاصة فبتتحوّل لرابط مؤقت (SSMPDDesignFiles.resolve) وبتتحمّل وقت ما الصف يظهر على الشاشة بس.
  var thumbCache = new Map();
  function thumbSigned(url, force) {
    var hit = thumbCache.get(url);
    if (!force && hit && hit.until > Date.now()) return hit.promise;
    var promise = window.SSMPDDesignFiles ? window.SSMPDDesignFiles.resolve(url) : Promise.resolve(url);
    thumbCache.set(url, { promise: promise, until: Date.now() + 240000 });
    promise.catch(function () { thumbCache.delete(url); });
    return promise;
  }
  function thumbInfo(it) {
    var slides = Array.isArray(it.carousel_slides) ? it.carousel_slides.filter(function (u) { return typeof u === "string" && u; }) : [];
    if (it.content_format === "carousel") return slides.length ? { kind: "carousel", url: slides[0], count: slides.length } : { kind: "none" };
    if (!it.design_file_url) return { kind: "none" };
    return { kind: it.content_format === "video" ? "video" : "image", url: it.design_file_url };
  }
  function thumbHtml(it) {
    var info = thumbInfo(it);
    var badge = info.kind === "carousel" ? '<span class="pbd-badge">▤ ' + info.count + "</span>" : (info.kind === "video" ? '<span class="pbd-badge">▶</span>' : "");
    return '<div class="pbd-thumb" data-thumb="' + it.id + '" data-kind="' + info.kind + '" aria-hidden="true"><span class="pbd-ph">' + (info.kind === "video" ? "🎬" : "🖼️") + "</span>" + badge + "</div>";
  }
  function safeHttp(value) {
    try { var u = new URL(value, location.href); return /^https?:$/.test(u.protocol) ? u.href : null; } catch (e) { return null; }
  }
  function loadThumb(box, it) {
    if (box.__loaded) return;
    box.__loaded = true;
    var info = thumbInfo(it);
    if (info.kind === "none") return;
    var drive = /^https:\/\/drive\.google\.com\/(?:file\/d\/|open\?id=|uc\?id=)([\w-]+)/.exec(info.url || "");
    var media = document.createElement(info.kind === "video" ? "video" : "img");
    if (info.kind === "video") { media.muted = true; media.preload = "metadata"; media.playsInline = true; } else { media.alt = ""; media.decoding = "async"; }
    function fail() { media.remove(); }
    var retried = false;
    function attach(url) {
      var safe = safeHttp(url);
      if (!safe) { fail(); return; }
      media.src = info.kind === "video" ? safe + "#t=0.1" : safe;
      if (!media.isConnected) box.insertBefore(media, box.firstChild);
    }
    media.addEventListener("error", function () {
      if (retried || drive) { fail(); return; }
      retried = true;
      thumbSigned(info.url, true).then(attach).catch(fail);
    });
    media.addEventListener(info.kind === "video" ? "loadeddata" : "load", function () { var ph = box.querySelector(".pbd-ph"); if (ph) ph.remove(); });
    if (drive) { attach("https://drive.google.com/thumbnail?id=" + drive[1] + "&sz=w240"); return; }
    thumbSigned(info.url).then(attach).catch(fail);
  }
  function mountThumbs(container, items) {
    var byId = {}; items.forEach(function (i) { byId[i.id] = i; });
    var boxes = Array.prototype.slice.call(container.querySelectorAll(".pbd-thumb"));
    var go = function (box) { var it = byId[box.getAttribute("data-thumb")]; if (it) loadThumb(box, it); };
    if (typeof IntersectionObserver === "undefined") { boxes.forEach(go); return; }
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (e) { if (e.isIntersecting) { io.unobserve(e.target); go(e.target); } });
    }, { rootMargin: "200px" });
    boxes.forEach(function (b) { io.observe(b); });
  }

  function daysRowHtml(it, adminsById, showTime) {
    var t = it.scheduled_publish_at ? timeParts(it.scheduled_publish_at) : null;
    var who = (adminsById[it.scheduled_by] || {}).name;
    var plats = W.platformsLabel(itemPlatforms(it));
    return '<div class="pbd-row" data-open-pub="' + it.id + '" role="button" tabindex="0">' +
      (showTime ? '<div class="pbd-time">' + (t ? escapeHtml(t.h + ":" + t.m) + "<small>" + escapeHtml(t.p) + "</small>" : "—") + "</div>" : "") +
      '<div class="pbd-main"><div class="pbd-title">' + escapeHtml(it.title) + "</div>" +
      '<div class="pbd-meta">' + W.brandBadgeHtml(it.brand) + '<span>' + escapeHtml(plats) + "</span></div>" +
      (who ? '<div class="pbd-who">جدولها: ' + escapeHtml(who) + "</div>" : "") + "</div>" + thumbHtml(it) + "</div>";
  }
  function renderDaysView(container, ctx) {
    var scheduled = ctx.scheduled, ready = ctx.ready, adminsById = ctx.adminsById;
    var byDay = {}, undated = [];
    scheduled.forEach(function (i) {
      if (!i.scheduled_publish_at) { undated.push(i); return; }
      var k = dayKey(new Date(i.scheduled_publish_at));
      (byDay[k] = byDay[k] || []).push(i);
    });
    var keys = Object.keys(byDay).sort();
    var now = new Date(), todayKey = dayKey(now), tomorrowKey = dayKey(new Date(now.getTime() + 86400000));
    var weekStart = new Date(now.getFullYear(), now.getMonth(), now.getDate() - now.getDay());
    var nextWeekStart = new Date(weekStart.getFullYear(), weekStart.getMonth(), weekStart.getDate() + 7);
    var afterNextStart = new Date(weekStart.getFullYear(), weekStart.getMonth(), weekStart.getDate() + 14);
    function bucket(k) {
      if (k < todayKey) return 0;
      var d = new Date(k + "T00:00:00");
      if (d < nextWeekStart) return 1;
      if (d < afterNextStart) return 2;
      return 3;
    }
    var BUCKETS = [["متأخرة — فات ميعادها", "late"], ["الأسبوع ده", ""], ["الأسبوع الجاي", ""], ["بعد كده", ""]];
    var html = '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px;flex-wrap:wrap;gap:8px;">' +
      '<h2 style="margin:0;">النشر</h2>' + viewToggleHtml() + '</div>';
    html += '<h3 style="margin:0;">مجدولة للنشر حسب اليوم (' + scheduled.length + ')</h3>';
    if (!keys.length && !undated.length) html += '<div class="empty-state" style="margin-top:12px;">مفيش مواد مجدولة دلوقتي</div>';
    BUCKETS.forEach(function (info, b) {
      var days = keys.filter(function (k) { return bucket(k) === b; });
      if (!days.length) return;
      var total = days.reduce(function (n, k) { return n + byDay[k].length; }, 0);
      html += '<div class="pbd-week ' + info[1] + '">' + info[0] + ' <small>(' + total + ')</small></div><div class="pbd-grid">';
      days.forEach(function (k) {
        var items = byDay[k].slice().sort(function (a, b2) { return new Date(a.scheduled_publish_at) - new Date(b2.scheduled_publish_at); });
        var first = new Date(items[0].scheduled_publish_at);
        var late = k < todayKey, today = k === todayKey;
        var tag = today ? '<span class="pbd-tag today">النهارده</span>' : (k === tomorrowKey ? '<span class="pbd-tag">بكره</span>' : (late ? '<span class="pbd-tag late">متأخرة</span>' : ""));
        html += '<div class="pbd-card' + (today ? " today" : "") + (late ? " late" : "") + '"><div class="pbd-head">' +
          '<div class="pbd-daynum">' + first.getDate() + '</div>' +
          '<div class="pbd-day"><div class="pbd-dayname">' + escapeHtml(first.toLocaleDateString("ar-EG", { weekday: "long" })) + '</div>' +
          '<div class="pbd-daymonth">' + escapeHtml(first.toLocaleDateString(LATN, { month: "long", year: "numeric" })) + '</div></div>' +
          tag + '<span class="pbd-count" title="عدد المواد">' + items.length + '</span></div><div class="pbd-list">';
        // سونو فوق ودينا تحتها (وأي مادة بدون صفحة في الآخر) — فاصل خفيف باسم الصفحة بينهم لو اليوم فيه أكتر من صفحة
        var groups = [["sono", "سونو"], ["dr_dina", "د. دينا"], ["", "بدون صفحة"]].map(function (g) {
          return { label: g[1], rows: items.filter(function (it) { return g[0] ? it.brand === g[0] : it.brand !== "sono" && it.brand !== "dr_dina"; }) };
        }).filter(function (g) { return g.rows.length; });
        groups.forEach(function (g) {
          if (groups.length > 1) html += '<div class="pbd-sep"><span>' + g.label + '</span></div>';
          g.rows.forEach(function (it) { html += daysRowHtml(it, adminsById, true); });
        });
        html += '</div></div>';
      });
      html += '</div>';
    });
    if (undated.length) {
      html += '<div class="pbd-week">مجدولة من غير ميعاد محدد <small>(' + undated.length + ')</small></div><div class="pbd-plain">' +
        undated.map(function (i) { return daysRowHtml(i, adminsById, false); }).join("") + '</div>';
    }
    html += '<div class="pbd-week">جاهزة للنشر بدون معاد محدد <small>(' + ready.length + ')</small></div>';
    html += ready.length ? '<div class="pbd-plain">' + ready.map(function (i) { return daysRowHtml(i, adminsById, false); }).join("") + '</div>' : '<div class="empty-state">مفيش مواد جاهزة للنشر دلوقتي</div>';
    container.innerHTML = html;
    window.SSMPDWebsite.mount(container, ctx.allItems);
    wireViewToggle(container, ctx);
    mountThumbs(container, scheduled.concat(ready));
    container.querySelectorAll("[data-open-pub]").forEach(function (el) {
      el.onclick = function () { openPublishDetailModal(el.getAttribute("data-open-pub"), ctx); };
      el.onkeydown = function (e) { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); el.click(); } };
    });
  }

  // مودال تفاصيل/إجراءات مادة واحدة — بيتفتح من كليك على عنصر في الكالندر
  // (بيستخدم نفس renderCard/wire اللي القائمة العادية بتستخدمهم).
  function openPublishDetailModal(id, ctx) {
    var all = ctx.scheduled.concat(ctx.ready);
    var item = all.filter(function (i) { return i.id === id; })[0];
    if (!item) return;
    var mode = ctx.scheduled.indexOf(item) !== -1 ? "scheduled" : "ready";
    var backdrop = document.createElement("div");
    backdrop.className = "modal-backdrop";
    backdrop.innerHTML = '<div class="modal"><div class="modal-head"><h3>تفاصيل النشر</h3>' +
      '<button class="modal-close">×</button></div>' +
      W.contentFormatDetailsHtml(item) +
      '<div id="pb-modal-card"></div></div>';
    document.body.appendChild(backdrop);
    backdrop.querySelector("#pb-modal-card").innerHTML = renderCard(item, ctx.adminsById, mode, ctx.jobByContent[item.id]);
    var detailsBox = backdrop.querySelector('[id^="publish-details-"]');
    if (detailsBox) detailsBox.style.display = "block";
    wire(backdrop);
    window.SSMPDScheduleHistory.mountAll(backdrop, [item], ctx.adminsById);
    window.SSMPDPublicationPreview.mountSlots(backdrop,[item]);
    window.SSMPDWebsite.mountActions(backdrop,[item]);
    updateManualLinkVisibility(item.id);
    var slot = backdrop.querySelector("#comments-slot-" + item.id);
    if (slot) window.SSMPDComments.render(slot, item.id, ctx.adminsById);
    backdrop.querySelector(".modal-close").onclick = function () { backdrop.remove(); };
    backdrop.onclick = function (e) { if (e.target === backdrop) backdrop.remove(); };
  }

  // حالة/نتيجة job النشر التلقائي (فيسبوك/انستجرام) — بند ٨: عرض حقيقي
  // بدل رابط يدوي، بروابط فعلية للمنشورات لو نجح.
  function jobStatusHtml(job) {
    if (!job) return "";
    var st = JOB_STATUS_LABELS[job.status] || { label: job.status, cls: "draft" };
    var html = '<div style="margin-top:8px;padding:8px 10px;border:1px solid var(--c-border);border-radius:8px;font-size:12px;">' +
      '<div><b>حالة النشر التلقائي:</b> <span class="status-pill ' + st.cls + '">' + escapeHtml(st.label) + '</span>' +
      (job.last_attempt_at ? ' <span style="color:var(--c-muted);">— آخر محاولة: ' + new Date(job.last_attempt_at).toLocaleString("ar-EG") + '</span>' : '') + '</div>';
    if (job.publish_facebook) {
      html += '<div>فيسبوك: ' + (job.facebook_permalink
        ? '<a href="' + job.facebook_permalink + '" target="_blank" rel="noopener noreferrer">فتح المنشور ↗</a>'
        : (job.status === "failed" || job.status === "partial" ? 'لسه متنشرش' : 'قيد الانتظار')) + '</div>';
    }
    if (job.publish_instagram) {
      html += '<div>انستجرام: ' + (job.instagram_permalink
        ? '<a href="' + job.instagram_permalink + '" target="_blank" rel="noopener noreferrer">فتح المنشور ↗</a>'
        : (job.status === "failed" || job.status === "partial" ? 'لسه متنشرش' : 'قيد الانتظار')) + '</div>';
    }
    if (job.error_message && (job.status === "failed" || job.status === "partial")) {
      html += '<div style="color:var(--c-negative);">سبب المشكلة: ' + escapeHtml(job.error_message) + '</div>';
    }
    if (job.status === "pending") {
      html += '<div style="margin-top:4px;"><button class="btn ghost sm" data-cancel-meta-job="' + job.id + '">إلغاء النشر التلقائي</button></div>';
    }
    html += '</div>';
    return html;
  }

  function socialPlatformCheckboxes(prefix, selected) {
    var box = document.createElement("div");
    box.innerHTML = W.platformCheckboxesHtml(prefix, selected);
    var website = box.querySelector('input[value="website"]');
    if (website) website.parentElement.remove();
    return box.innerHTML;
  }

  function updateSocialContent(id, patch) {
    if (!patch.publish_platforms) return window.SSMPDDb.updateContentItem(id, patch);
    return window.SSMPDDb.client.from("website_publications").select("action").eq("content_id", id).maybeSingle().then(function (r) {
      if (r.data && r.data.action === "upsert" && patch.publish_platforms.indexOf("website") < 0) patch.publish_platforms.push("website");
      return window.SSMPDDb.updateContentItem(id, patch);
    });
  }

  function itemPlatforms(i) {
    var p = i.publish_platforms || i.publish_platform || [];
    return Array.isArray(p) ? p : (p ? [p] : []);
  }

  function nonMetaPlatforms(platforms) {
    return (platforms || []).filter(function (p) { return META_PLATFORMS.indexOf(p) === -1 && p !== "website"; });
  }

  function updateManualLinkVisibility(id) {
    var platforms = W.readPlatformCheckboxes("pb-platform-" + id);
    var manualWrap = document.getElementById("pb-manual-wrap-" + id);
    var metaHint = document.getElementById("pb-meta-hint-" + id);
    if (manualWrap) manualWrap.style.display = nonMetaPlatforms(platforms).length ? "block" : "none";
    if (metaHint) metaHint.style.display = hasMetaPlatform(platforms) ? "block" : "none";
  }

  // datetime-local بيحتاج الوقت المحلي بصيغة YYYY-MM-DDTHH:MM
  function toLocalInput(iso) {
    if (!iso) return "";
    var d = new Date(iso); if (isNaN(d)) return "";
    var pad = function (n) { return String(n).padStart(2, "0"); };
    return d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate()) + "T" + pad(d.getHours()) + ":" + pad(d.getMinutes());
  }

  function renderCard(i, adminsById, mode, job) {
    var ownerName = (adminsById[i.created_by] || {}).name || "—";
    var designerName = i.assigned_designer ? ((adminsById[i.assigned_designer] || {}).name || "—") : "—";
    var scheduledLine = (mode === "scheduled" && i.scheduled_publish_at)
      ? '<span style="color:var(--c-muted);font-size:12px;">ميعاد النشر: <b>' + new Date(i.scheduled_publish_at).toLocaleString("ar-EG") + '</b></span>'
      : "";
    var platformsNow = itemPlatforms(i);
    var manualScheduled = nonMetaPlatforms(platformsNow);

    var jobHtml = jobStatusHtml(job);
    var jobIsLive = job && ["pending", "processing", "published", "partial"].indexOf(job.status) !== -1;

    var actionsHtml;
    if (mode === "ready") {
      actionsHtml =
        "<div class=\"field\"><label> <!--ssmpd-i18n:%D8%A7%D9%84%D9%85%D8%A7%D8%AF%D8%A9%20%D8%AF%D9%8A%20%D9%84%D8%B5%D9%81%D8%AD%D8%A9-->المادة دي لصفحة</label>" + W.brandSelectHtml("pb-brand-" + i.id, i.brand || "") + '</div>' +
        '<div class="field"><label>هتتنشر على (تقدر تختار أكتر من منصة)</label><div id="pb-platform-' + i.id + '">' + socialPlatformCheckboxes("pb-platform-" + i.id, i.publish_platforms || i.publish_platform || []) + '</div></div>' +
        '<div id="pb-meta-hint-' + i.id + '" style="display:none;margin:6px 0 10px;padding:8px 10px;border:1px solid var(--c-border);border-radius:8px;color:var(--c-muted);font-size:12px;">فيسبوك/انستجرام: رابط المنشور بيتسجل تلقائيًا بعد نجاح النشر.</div>' +
        '<div class="field"><label>معاد النشر المجدول</label><input type="datetime-local" id="pb-when-' + i.id + '"></div>' +
        '<div id="pb-manual-wrap-' + i.id + '" style="display:none;">' +
        '<div class="field"><label>رابط المنشور للمنصات اليدوية فقط (تيكتوك/يوتيوب)</label>' +
        '<input placeholder="https://..." id="pb-url-' + i.id + '"></div>' +
        '</div>' +
        '<div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center;margin-top:6px;">' +
        '<button class="btn" data-schedule="' + i.id + '">جدولة</button>' +
        '<button class="btn ghost" data-publish-now="' + i.id + '">نشر السوشيال الآن</button>' +
        '</div>' + jobHtml;
    } else {
      actionsHtml = jobHtml;
      // تعديل ميعاد النشر — متاح طالما النشر التلقائي لسه مابدأش
      if (!job || job.status === "pending") {
        actionsHtml +=
          '<div class="field" style="margin-top:10px;"><label>تعديل ميعاد النشر</label>' +
          '<div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center;">' +
          '<input type="datetime-local" id="pb-rewhen-' + i.id + '" value="' + toLocalInput(i.scheduled_publish_at) + '" style="flex:1;min-width:200px;">' +
          '<button class="btn" data-reschedule="' + i.id + '">حفظ الميعاد الجديد</button>' +
          '</div></div>';
      }
      // النشر التلقائي لسه مستني: زرار واحد يلغي النشر التلقائي ويرجّع المادة لجاهزة للنشر (وClaude مايرجعش يجدولها).
      if (job && job.status === "pending") {
        actionsHtml += '<div style="display:flex;gap:8px;margin-top:6px;">' +
          '<button class="btn ghost" data-cancel-schedule="' + i.id + '" data-job="' + job.id + '">إلغاء الجدولة</button>' +
          '</div>';
      }
      if (!jobIsLive) {
        if (manualScheduled.length) {
          actionsHtml +=
            '<div class="field"><label>رابط المنشور للمنصات اليدوية فقط</label><input placeholder="https://..." id="pb-url-' + i.id + '"></div>' +
            '<div style="display:flex;gap:8px;margin-top:6px;">' +
            '<button class="btn" data-confirm-publish="' + i.id + '">تأكيد النشر يدويًا</button>' +
            '<button class="btn ghost" data-cancel-schedule="' + i.id + '">إلغاء الجدولة</button>' +
            '</div>';
        } else {
          actionsHtml +=
            '<div style="margin-top:8px;padding:8px 10px;border:1px solid var(--c-border);border-radius:8px;color:var(--c-muted);font-size:12px;">روابط Facebook/Instagram هتتسجل تلقائيًا بعد نجاح النشر.</div>' +
            '<div style="display:flex;gap:8px;margin-top:6px;">' +
            '<button class="btn ghost" data-cancel-schedule="' + i.id + '">إلغاء الجدولة</button>' +
            '</div>';
        }
      } else if (job.status !== "pending" && job.status !== "processing") {
        actionsHtml += '<div style="display:flex;gap:8px;margin-top:6px;">' +
          '<button class="btn ghost" data-cancel-schedule="' + i.id + '">إلغاء الجدولة والرجوع لجاهزة للنشر</button>' +
          '</div>';
      }
    }

    var statusLabel = mode === "scheduled" ? "مجدولة" : "جاهزة للنشر";
    return '<div class="section" style="border:1px solid var(--c-border);border-radius:12px;padding:12px 14px;margin-bottom:10px;">' +
      '<div style="display:flex;gap:12px;align-items:center;justify-content:space-between;flex-wrap:wrap;">' +
      '<div style="min-width:0;flex:1;">' +
      '<div class="title" style="font-weight:800;margin-bottom:4px;">' + escapeHtml(i.title) + W.brandBadgeHtml(i.brand) + '</div>' +
      '<div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;">' +
      '<span class="status-pill ' + (mode === "scheduled" ? "received" : "approved") + '">' + statusLabel + '</span>' +
      (i.claude_hold ? '<span class="status-pill draft" title="Claude مش هيجدول المادة دي لحد ما تسمح له">⏸ موقوفة عن Claude</span>' : '') +
      scheduledLine +
      '</div>' +
      '</div>' +
      '<button class="btn ghost sm" data-toggle-publish-details="' + i.id + "\"> <!--ssmpd-i18n:%D9%81%D8%AA%D8%AD%20%D8%A7%D9%84%D8%AA%D9%81%D8%A7%D8%B5%D9%8A%D9%84-->فتح التفاصيل</button>" +
      '</div>' +
      (canRevise(i)?'<button class="btn ghost sm" data-prepublish-edit="'+i.id+'">تعديل قبل النشر</button>':'')+
      (mode === "ready" ? ' <button class="btn ghost sm" data-claude-hold="' + i.id + '" data-hold="' + (i.claude_hold ? '0' : '1') + '">' + (i.claude_hold ? '▶️ سيب Claude يجدولها' : '⏸ ماتجدولهاش يا Claude') + '</button>' : '') +
      '<div data-publication-preview="' + i.id + '"></div>' +
      '<div data-website-publish-action="' + i.id + '"></div>' +
      '<div id="publish-details-' + i.id + '" style="display:none;margin-top:12px;padding-top:12px;border-top:1px solid var(--c-border);">' +
      '<div class="meta">بواسطة: ' + escapeHtml(ownerName) + ' · مصمم: ' + escapeHtml(designerName) + '</div>' +
      (mode === "scheduled" ? window.SSMPDScheduleHistory.sectionHtml(i, adminsById) : "") +
      actionsHtml +
      '<div id="comments-slot-' + i.id + '" style="margin-top:10px;"></div>' +
      '</div>' +
      '</div>';
  }

  function canRevise(item){var me=window.SSMPDAuth.currentAdmin;return ['ready_to_publish','scheduled'].indexOf(item.stage)>=0&&(W.canEditItem(me,item)||window.SSMPDRoles.hasRole(me,'approver'));}
  function wire(container) {
    container.querySelectorAll('[data-prepublish-edit]').forEach(function(button){button.onclick=async function(){button.disabled=true;try{
      var item=await window.SSMPDDb.getContentItem(button.dataset.prepublishEdit);
      if(!canRevise(item))throw new Error('المادة لم تعد متاحة للتعديل قبل النشر. حدّث القائمة.');
      var jobs=await window.SSMPDDb.listMetaPublishJobsForContent([item.id]);
      if(jobs.some(function(job){return ['processing','published','partial'].indexOf(job.status)>=0;}))throw new Error('النشر بدأ أو تم جزئيًا. حدّث الحالة قبل التعديل.');
      W.openEditContentModal(item,function(){closePublishModal();render(document.getElementById('view-container'));notify('تم حفظ التعديل وإلغاء الجدولة. المادة الآن في الاعتماد النهائي.');},{beforePublish:true,save:async function(id,patch){
        if(!window.SSMPDContentText.confirmSave(patch))throw new Error('تم إلغاء الحفظ.');
        var result=await window.SSMPDDb.client.rpc('revise_content_before_publish',{p_id:id,p_patch:patch,p_expected_updated_at:item.updated_at});
        if(result.error)throw result.error;return result.data;
      }});
    }catch(e){notify(e.message,'error');}finally{button.disabled=false;}};});
    container.querySelectorAll("[data-toggle-publish-details]").forEach(function (btn) {
      btn.onclick = function () {
        var id = btn.getAttribute("data-toggle-publish-details");
        var box = document.getElementById("publish-details-" + id);
        if (!box) return;
        var open = box.style.display !== "none";
        box.style.display = open ? "none" : "block";
        btn.textContent = open ? "فتح التفاصيل" : "إخفاء التفاصيل";
        if (!open) updateManualLinkVisibility(id);
      };
    });
    container.querySelectorAll(".platform-cb").forEach(function (cb) {
      cb.addEventListener("change", function () {
        var m = (cb.id || "").match(/^pb-platform-(.+?)-(facebook|instagram|tiktok|youtube|website|email)$/);
        if (m) updateManualLinkVisibility(m[1]);
      });
    });
    container.querySelectorAll("[data-schedule]").forEach(function (btn) {
      btn.onclick = function () { schedule(btn.getAttribute("data-schedule")); };
    });
    container.querySelectorAll("[data-publish-now]").forEach(function (btn) {
      btn.onclick = function () { publishNow(btn.getAttribute("data-publish-now")); };
    });
    container.querySelectorAll("[data-confirm-publish]").forEach(function (btn) {
      btn.onclick = function () { confirmPublish(btn.getAttribute("data-confirm-publish")); };
    });
    container.querySelectorAll("[data-cancel-schedule]").forEach(function (btn) {
      btn.onclick = function () { cancelSchedule(btn.getAttribute("data-cancel-schedule"), btn); };
    });
    container.querySelectorAll("[data-claude-hold]").forEach(function (btn) {
      btn.onclick = function () { setClaudeHold(btn.getAttribute("data-claude-hold"), btn.getAttribute("data-hold") === "1", btn); };
    });
    container.querySelectorAll("[data-reschedule]").forEach(function (btn) {
      btn.onclick = function () { reschedule(btn.getAttribute("data-reschedule"), btn); };
    });
    container.querySelectorAll("[data-cancel-meta-job]").forEach(function (btn) {
      btn.onclick = function () { cancelMetaJob(btn.getAttribute("data-cancel-meta-job")); };
    });
  }

  // بيقفل مودال تفاصيل النشر (لو مفتوح) بعد أي إجراء ناجح — عشان مايفضلش
  // معلّق فاضل على بيانات قديمة بعد ما الشاشة الأساسية تتحدّث من ورايه.
  function closePublishModal() {
    document.querySelectorAll(".modal-backdrop").forEach(function (el) { el.remove(); });
  }

  // بديل alert() — رسالة toast مش بلوكينج (alert() ممكن يتمنع/يتجاهل جوه متصفحات
  // مدمجة في تطبيقات الموبايل زي واتساب/ماسنجر، فيبان للمستخدم إن الزرار "ماعملش حاجة")
  function notify(msg, type) {
    if (window.SSMPDToast) window.SSMPDToast.show(msg, type);
    else alert(msg);
  }

  // بيعمل meta_publish_job لو من ضمن المنصات المختارة فيسبوك/انستجرام —
  // بيتنفّذ فعليًا بواسطة Edge Function meta-publish-process (كل دقيقة).
  function maybeCreateMetaJob(id, brand, platforms, scheduledAtIso) {
    if (!hasMetaPlatform(platforms)) return Promise.resolve(null);
    var me = window.SSMPDAuth.currentAdmin;
    return window.SSMPDDb.createMetaPublishJob({
      contentId: id, brand: brand, scheduledAt: scheduledAtIso,
      publishFacebook: platforms.indexOf("facebook") !== -1,
      publishInstagram: platforms.indexOf("instagram") !== -1,
      createdBy: me.id
    });
  }

  // جدولة مادة "جاهزة للنشر" لمعاد محدد — بتنقلها لحالة "مجدولة للنشر"، وبتعمل
  // job نشر تلقائي لو من ضمن المنصات المختارة فيسبوك/انستجرام
  function schedule(id, reviewed) {
    if (W.readPlatformCheckboxes("pb-platform-" + id).indexOf("website") !== -1) { notify("جدولة الموقع غير مفعلة. انشر الموقع من قسمه، وحدد منصات السوشيال للجدولة.", "error"); return; }
    var brand = valueOf("pb-brand-" + id);
    var platforms = W.readPlatformCheckboxes("pb-platform-" + id);
    var when = valueOf("pb-when-" + id);
    if (!brand) { notify("اختر المادة دي لصفحة سونو ولا د.دينا الأول", "error"); return; }
    if (!platforms.length) { notify("اختر هتتنشر على أنهي منصة (تقدر تختار أكتر من واحدة)", "error"); return; }
    if (!when) { notify("حدد معاد النشر المجدول", "error"); return; }
    if (!reviewed) { reviewBeforePublishing(id, "تأكيد الجدولة", function () { schedule(id, true); }); return; }
    var me = window.SSMPDAuth.currentAdmin;
    var whenIso = new Date(when).toISOString();
    updateSocialContent(id, {
      stage: "scheduled", brand: brand, publish_platform: platforms[0], publish_platforms: platforms,
      scheduled_publish_at: whenIso, scheduled_by: me.id
    }).then(function () {
      return window.SSMPDDb.logActivity({ content_id: id, actor_id: me.id, action: "جدولة للنشر — ميعاد النشر " + new Date(whenIso).toLocaleString("sv-SE", { timeZone: "Africa/Cairo" }).slice(0, 16) + " (توقيت القاهرة)", from_stage: "ready_to_publish", to_stage: "scheduled" });
    }).then(function () {
      return maybeCreateMetaJob(id, brand, platforms, whenIso);
    }).then(function () {
      notify(hasMetaPlatform(platforms) ? "تمت الجدولة — فيسبوك/انستجرام هينشروا تلقائيًا في المعاد ده" : "تمت الجدولة");
      closePublishModal(); render(document.getElementById("view-container"));
    }).catch(function (e) { notify("خطأ: " + e.message, "error"); });
  }

  // نشر فوري — لو من ضمن المنصات فيسبوك/انستجرام، بيعمل job نشر تلقائي فوري
  // (scheduled_at = الآن، الـEdge Function هتاخده في تشغيلة الدقيقة الجاية).
  // لمنصات تانية (تيكتوك/يوتيوب) لازم رابط يدوي زي ما كان.
  function publishNow(id, reviewed) {
    if (W.readPlatformCheckboxes("pb-platform-" + id).indexOf("website") !== -1) { notify("استخدم قسم نشر الموقع لتأكيد النشر، وانشر السوشيال بشكل مستقل.", "error"); return; }
    var brand = valueOf("pb-brand-" + id);
    var platforms = W.readPlatformCheckboxes("pb-platform-" + id);
    var url = valueOf("pb-url-" + id);
    var metaSelected = hasMetaPlatform(platforms);
    var others = platforms.filter(function (p) { return META_PLATFORMS.indexOf(p) === -1 && p !== "website"; });
    if (!brand) { notify("اختر المادة دي لصفحة سونو ولا د.دينا الأول", "error"); return; }
    if (!platforms.length) { notify("اختر هتتنشر على أنهي منصة (تقدر تختار أكتر من واحدة)", "error"); return; }
    if (others.length && !url) { notify("حط رابط المنشور للمنصات غير فيسبوك/انستجرام", "error"); return; }
    if (!others.length && !metaSelected) { notify("مفيش منصة مختارة", "error"); return; }
    if (!reviewed) { reviewBeforePublishing(id, "تأكيد النشر", function () { publishNow(id, true); }); return; }

    var me = window.SSMPDAuth.currentAdmin;
    var nowIso = new Date().toISOString();

    if (metaSelected) {
      // فيسبوك/انستجرام: جدولة فورية (stage="scheduled" بمعاد = الآن) —
      // بتتحول لـ"published" تلقائيًا بعد ما الـEdge Function تنشر فعليًا.
      // رابط المنصات التانية (لو موجود) بيتسجّل في published_urls لكل منصة
      // على حدة — عشان الـEdge Function متكتبش فوقه لما تنشر Meta بعد كده
      // (بند ١ من المراجعة المعمارية).
      var otherUrlsPatch = {};
      others.forEach(function (p) { otherUrlsPatch[p] = url; });
      updateSocialContent(id, {
        stage: "scheduled", brand: brand, publish_platform: platforms[0], publish_platforms: platforms,
        scheduled_publish_at: nowIso, scheduled_by: me.id,
        published_url: others.length ? url : null,
        published_urls: otherUrlsPatch
      }).then(function () {
        return window.SSMPDDb.logActivity({ content_id: id, actor_id: me.id, action: "نشر فوري (تلقائي)", from_stage: "ready_to_publish", to_stage: "scheduled" });
      }).then(function () {
        return maybeCreateMetaJob(id, brand, platforms, nowIso);
      }).then(function () {
        notify("هينشر تلقائيًا خلال دقيقة تقريبًا — تقدر تتابع الحالة هنا");
        closePublishModal(); render(document.getElementById("view-container"));
      }).catch(function (e) { notify("خطأ: " + e.message, "error"); });
      return;
    }

    // مفيش فيسبوك/انستجرام مختارين — نفس السلوك اليدوي القديم بالكامل
    updateSocialContent(id, {
      stage: "published", published_url: url, published_by: me.id, published_at: nowIso,
      brand: brand, publish_platform: platforms[0], publish_platforms: platforms
    }).then(function (updated) {
      window.SSMPDDrive.logPublished(id, updated.title, url, updated.stage_history).catch(function () {});
      return window.SSMPDDb.logActivity({ content_id: id, actor_id: me.id, action: "نشر", from_stage: "ready_to_publish", to_stage: "published" });
    }).then(function () {
      notify("اتنشرت — هتظهر في الملخص والأرشيف دلوقتي");
      closePublishModal(); render(document.getElementById("view-container"));
    }).catch(function (e) { notify("خطأ: " + e.message, "error"); });
  }

  // تأكيد يدوي إن المادة المجدولة اتنشرت (لمنصات غير فيسبوك/انستجرام بس —
  // لو فيه job نشر تلقائي شغّال، الزرار ده مبيظهرش خالص).
  function confirmPublish(id) {
    var url = valueOf("pb-url-" + id);
    if (!url) { notify("حط رابط المنشور الأول", "error"); return; }
    var me = window.SSMPDAuth.currentAdmin;
    // بند ١ من المراجعة المعمارية (٢٠٢٦-٠٩-٠٨): قبل الكتابة، نجيب حالة المادة
    // الحالية — لو فيها رابط Meta تلقائي متسجل بالفعل (من منصة تانية غير اللي
    // بنأكدها هنا)، منكتبش فوقه في published_url، وبنسجل رابطنا في
    // published_urls لكل منصة على حدة بدل ما نكلبش القديم.
    window.SSMPDDb.getContentItem(id).then(function (current) {
      var mergedUrls = Object.assign({}, (current && current.published_urls) || {});
      var platform = (current && current.publish_platform) || "manual";
      mergedUrls[platform] = url;
      var patch = {
        stage: "published", published_by: me.id, published_at: new Date().toISOString(),
        published_url: (current && current.published_url) ? current.published_url : url,
        published_urls: mergedUrls
      };
      return updateSocialContent(id, patch);
    }).then(function (updated) {
      window.SSMPDDrive.logPublished(id, updated.title, url, updated.stage_history).catch(function () {});
      return window.SSMPDDb.logActivity({ content_id: id, actor_id: me.id, action: "تأكيد نشر مجدول", from_stage: "scheduled", to_stage: "published" });
    }).then(function () {
      notify("اتأكد النشر — هتظهر في الملخص والأرشيف دلوقتي");
      closePublishModal(); render(document.getElementById("view-container"));
    }).catch(function (e) { notify("خطأ: " + e.message, "error"); });
  }

  // تعديل ميعاد مادة مجدولة — بيحرّك ميعاد المادة وميعاد النشر التلقائي (لو لسه
  // pending) مع بعض في خطوة واحدة على السيرفر، فمايحصلش اختلاف بينهم.
  function reschedule(id, btn) {
    var when = valueOf("pb-rewhen-" + id);
    if (!when) { notify("حدد الميعاد الجديد", "error"); return; }
    var whenDate = new Date(when);
    if (isNaN(whenDate) || whenDate.getTime() < Date.now() - 60000) { notify("اختار ميعاد في المستقبل", "error"); return; }
    if (btn) btn.disabled = true;
    window.SSMPDDb.client.rpc("reschedule_content_publish", { p_id: id, p_when: whenDate.toISOString() })
      .then(function (r) {
        if (r.error) throw r.error;
        notify("اتغيّر ميعاد النشر لـ " + whenDate.toLocaleString("ar-EG"));
        closePublishModal(); render(document.getElementById("view-container"));
      })
      .catch(function (e) { if (btn) btn.disabled = false; notify("خطأ: " + e.message, "error"); });
  }

  // إلغاء الجدولة — تأكيد بضغطة تانية على نفس الزرار بدل نافذة confirm() المتصفح
  // (زي alert()، confirm() ممكن يتمنع جوه متصفحات مدمجة في تطبيقات الموبايل)
  function cancelSchedule(id, btn) {
    if (btn && !btn.classList.contains("confirm-pending")) {
      btn.classList.add("confirm-pending");
      btn.textContent = "متأكد؟ دوس تاني للإلغاء";
      btn._cancelTimer = setTimeout(function () {
        btn.classList.remove("confirm-pending");
        btn.textContent = "إلغاء الجدولة";
      }, 4000);
      return;
    }
    if (btn && btn._cancelTimer) clearTimeout(btn._cancelTimer);
    var me = window.SSMPDAuth.currentAdmin, jobId = btn && btn.getAttribute("data-job");
    (jobId ? window.SSMPDDb.cancelMetaPublishJob(jobId) : Promise.resolve())
      .then(function () { return holdPatch(id, { stage: "ready_to_publish", scheduled_publish_at: null, scheduled_by: null, claude_hold: true }); })
      .then(function () {
        return window.SSMPDDb.logActivity({ content_id: id, actor_id: me.id, action: "إلغاء جدولة النشر", from_stage: "scheduled", to_stage: "ready_to_publish" });
      })
      .then(function () {
        notify("اتلغت الجدولة — والمادة موقوفة عن Claude لحد ما تدوس «سيب Claude يجدولها»");
        closePublishModal(); render(document.getElementById("view-container"));
      })
      .catch(function (e) { notify("خطأ: " + e.message, "error"); });
  }

  // claude_hold: علامة "Claude مايجدولش المادة دي". لو عمود القاعدة لسه مااتضافش، الإلغاء يكمّل من غير العلامة.
  function holdPatch(id, patch) {
    return updateSocialContent(id, Object.assign({}, patch)).catch(function (e) {
      if (!/claude_hold/.test(String(e && e.message))) throw e;
      var rest = Object.assign({}, patch); delete rest.claude_hold;
      return Object.keys(rest).length ? updateSocialContent(id, rest) : Promise.reject(new Error("شغّل تحديث قاعدة البيانات الخاص بإيقاف جدولة Claude الأول (قسم ٥٥ في setup.sql)."));
    });
  }
  function setClaudeHold(id, on, btn) {
    if (btn) btn.disabled = true;
    holdPatch(id, { claude_hold: on }).then(function () {
      var me = window.SSMPDAuth.currentAdmin;
      return window.SSMPDDb.logActivity({ content_id: id, actor_id: me.id, action: on ? "إيقاف جدولة Claude للمادة" : "السماح لـClaude بجدولة المادة" });
    }).then(function () {
      notify(on ? "تمام — Claude مش هيجدول المادة دي" : "تمام — Claude يقدر يجدولها في أقرب دورة");
      closePublishModal(); render(document.getElementById("view-container"));
    }).catch(function (e) { if (btn) btn.disabled = false; notify("خطأ: " + e.message, "error"); });
  }

  // إلغاء job النشر التلقائي (فيسبوك/انستجرام) لسه pending — الـRLS بتمنع
  // إلغاء job خلص معالجة (processing/published/...) عن قصد.
  function cancelMetaJob(jobId) {
    window.SSMPDDb.cancelMetaPublishJob(jobId).then(function () {
      notify("اتلغى النشر التلقائي لهذه المادة");
      closePublishModal(); render(document.getElementById("view-container"));
    }).catch(function (e) { notify("خطأ: " + e.message, "error"); });
  }

  window.SSMPDRenderPublish = { render: render };
})();

