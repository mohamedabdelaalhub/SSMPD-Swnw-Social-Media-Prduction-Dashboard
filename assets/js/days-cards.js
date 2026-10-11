/* SSMPD — عرض "كروت الأيام" المشترك (بنفس شكل تاب النشر): كارت لكل يوم، مواد سونو فوق ود. دينا تحتها بفاصل خفيف،
   ثمبنيل التصميم على الشمال (الكفر للكاروسيل، أول فريم للفيديو)، وساعة كل مادة. بيستخدم نفس CSS بتاع .pbd-* في styles.css.
   المستخدم الحالي: إدارة المحتوى. التجميع بآخر نشاط على المادة (updated_at). */
(function () {
  "use strict";
  var LATN = "ar-EG-u-nu-latn";
  var BRANDS = [["sono", "سونو"], ["dr_dina", "د. دينا"], ["", "بدون صفحة"]];

  function esc(value) { return String(value == null ? "" : value).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;"); }
  function dayKey(d) { return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0"); }
  function timeParts(iso) {
    var out = { h: "", m: "", p: "" };
    new Intl.DateTimeFormat(LATN, { hour: "2-digit", minute: "2-digit", hour12: true }).formatToParts(new Date(iso)).forEach(function (x) {
      if (x.type === "hour") out.h = x.value; if (x.type === "minute") out.m = x.value; if (x.type === "dayPeriod") out.p = x.value;
    });
    return out;
  }

  // ---------- ثمبنيل التصميم (الصور الخاصة بتتحوّل لرابط مؤقت وتتحمّل لما الصف يقرّب من الشاشة) ----------
  var cache = new Map();
  function signed(url, force) {
    var hit = cache.get(url);
    if (!force && hit && hit.until > Date.now()) return hit.promise;
    var promise = window.SSMPDDesignFiles ? window.SSMPDDesignFiles.resolve(url) : Promise.resolve(url);
    cache.set(url, { promise: promise, until: Date.now() + 240000 });
    promise.catch(function () { cache.delete(url); });
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
    return '<div class="pbd-thumb" data-thumb="' + esc(it.id) + '" data-kind="' + info.kind + '" aria-hidden="true"><span class="pbd-ph">' + (info.kind === "video" ? "🎬" : "🖼️") + "</span>" + badge + "</div>";
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
    var retried = false;
    function fail() { media.remove(); }
    function attach(url) {
      var safe = safeHttp(url);
      if (!safe) { fail(); return; }
      media.src = info.kind === "video" ? safe + "#t=0.1" : safe;
      if (!media.isConnected) box.insertBefore(media, box.firstChild);
    }
    media.addEventListener("error", function () {
      if (retried || drive) { fail(); return; }
      retried = true;
      signed(info.url, true).then(attach).catch(fail);
    });
    media.addEventListener(info.kind === "video" ? "loadeddata" : "load", function () { var ph = box.querySelector(".pbd-ph"); if (ph) ph.remove(); });
    if (drive) { attach("https://drive.google.com/thumbnail?id=" + drive[1] + "&sz=w240"); return; }
    signed(info.url).then(attach).catch(fail);
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
  function wireKeys(container) {
    container.querySelectorAll(".pbd-row[role=button]").forEach(function (el) {
      el.onkeydown = function (e) { if (e.target === el && (e.key === "Enter" || e.key === " ")) { e.preventDefault(); el.click(); } };
    });
  }

  // ---------- التجميع حسب آخر نشاط (الأحدث أولاً) ----------
  var BUCKETS = ["النهارده", "أمس", "الأسبوع ده", "الأسبوع اللي فات", "أقدم من كده"];
  function bucketOf(date, now) {
    var today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    var day = new Date(date.getFullYear(), date.getMonth(), date.getDate());
    var diff = Math.round((today - day) / 86400000);
    if (diff <= 0) return 0;
    if (diff === 1) return 1;
    var weekStart = new Date(today.getFullYear(), today.getMonth(), today.getDate() - today.getDay());
    if (day >= weekStart) return 2;
    if (day >= new Date(weekStart.getFullYear(), weekStart.getMonth(), weekStart.getDate() - 7)) return 3;
    return 4;
  }

  /* o.dateOf(item) → ISO · o.rowAttr(item) → attrs للصف · o.metaHtml(item) → شارات · o.linesHtml(item) → سطور تحت الشارات */
  function build(items, o) {
    var now = new Date(), byDay = {};
    items.forEach(function (it) {
      var iso = o.dateOf(it); if (!iso) return;
      var k = dayKey(new Date(iso));
      (byDay[k] = byDay[k] || []).push(it);
    });
    var keys = Object.keys(byDay).sort().reverse();
    if (!keys.length) return o.emptyHtml || '<div class="empty-state" style="margin-top:12px;">مفيش مواد</div>';
    var todayKey = dayKey(now), yesterdayKey = dayKey(new Date(now.getTime() - 86400000));
    var html = "";
    BUCKETS.forEach(function (label, b) {
      var days = keys.filter(function (k) { return bucketOf(new Date(k + "T12:00:00"), now) === b; });
      if (!days.length) return;
      var total = days.reduce(function (n, k) { return n + byDay[k].length; }, 0);
      html += '<div class="pbd-week">' + label + " <small>(" + total + ')</small></div><div class="pbd-grid">';
      days.forEach(function (k) {
        var rows = byDay[k].slice().sort(function (a, c) { return new Date(o.dateOf(c)) - new Date(o.dateOf(a)); });
        var first = new Date(o.dateOf(rows[0]));
        var today = k === todayKey;
        var tag = today ? '<span class="pbd-tag today">النهارده</span>' : (k === yesterdayKey ? '<span class="pbd-tag">أمس</span>' : "");
        html += '<div class="pbd-card' + (today ? " today" : "") + '"><div class="pbd-head"><div class="pbd-daynum">' + first.getDate() + '</div>' +
          '<div class="pbd-day"><div class="pbd-dayname">' + esc(first.toLocaleDateString("ar-EG", { weekday: "long" })) + '</div>' +
          '<div class="pbd-daymonth">' + esc(first.toLocaleDateString(LATN, { month: "long", year: "numeric" })) + '</div></div>' +
          tag + '<span class="pbd-count" title="عدد المواد">' + rows.length + '</span></div><div class="pbd-list">';
        var groups = BRANDS.map(function (g) {
          return { label: g[1], rows: rows.filter(function (it) { return g[0] ? it.brand === g[0] : it.brand !== "sono" && it.brand !== "dr_dina"; }) };
        }).filter(function (g) { return g.rows.length; });
        groups.forEach(function (g) {
          if (groups.length > 1) html += '<div class="pbd-sep"><span>' + g.label + "</span></div>";
          g.rows.forEach(function (it) {
            var t = timeParts(o.dateOf(it));
            html += '<div class="pbd-row" ' + o.rowAttr(it) + ' role="button" tabindex="0">' +
              '<div class="pbd-time">' + esc(t.h + ":" + t.m) + "<small>" + esc(t.p) + "</small></div>" +
              '<div class="pbd-main"><div class="pbd-title">' + esc(it.title) + "</div>" +
              '<div class="pbd-meta">' + o.metaHtml(it) + "</div>" + (o.linesHtml ? o.linesHtml(it) : "") + "</div>" + thumbHtml(it) + "</div>";
          });
        });
        html += "</div></div>";
      });
      html += "</div>";
    });
    return html;
  }

  window.SSMPDDaysCards = { build: build, mountThumbs: mountThumbs, thumbHtml: thumbHtml, wireKeys: wireKeys, timeParts: timeParts, esc: esc };
})();
