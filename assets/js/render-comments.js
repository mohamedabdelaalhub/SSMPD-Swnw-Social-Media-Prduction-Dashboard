/* SSMPD — تاب التعليقات: تعليقات فيسبوك/انستجرام على البوستات المنشورة من الداشبورد + الردود المعتمدة */
(function () {
  "use strict";

  var state = { filter: "pending", brand: "", platform: "", section: "inbox", mfilter: "all", q: "", category: "", postRef: "", open: { inbox: "", messages: "" }, info: true, sheet: false, drafts: {}, waTemplates: null, waReq: null, waForm: null, leads: {} };
  var BRANDS = { sono: "سونو", dr_dina: "د. دينا" };
  var STATUS = {
    "new": "محتاج رد", drafted: "رد مقترح", approved: "في الطريق", sending: "بيتنشر",
    replied: "تم الرد", ignored: "متجاهل", failed: "فشل النشر"
  };

  function esc(s) {
    return String(s == null ? "" : s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  }
  function when(d) {
    if (!d) return "";
    try { return new Date(d).toLocaleString("ar-EG-u-nu-latn", { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" }); } catch (e) { return ""; }
  }
  function db() { return window.SSMPDDb.client; }
  var OVERDUE_MIN = 60; // تعليق مستني رد أكتر من ساعة = متأخر
  function ageMin(d) { return d ? Math.floor((Date.now() - new Date(d).getTime()) / 60000) : 0; }
  function ago(d) {
    var m = ageMin(d);
    if (m < 1) return "دلوقتي";
    if (m < 60) return "من " + m + " دقيقة";
    var h = Math.floor(m / 60); if (h < 24) return "من " + h + " ساعة";
    return "من " + Math.floor(h / 24) + " يوم";
  }
  function isPending(c) { return !c.author_is_page && !c.parent_comment_id && ["new", "drafted", "failed"].indexOf(c.status) !== -1; }
  // متأخر = مستني رد من أكتر من ساعة وفي آخر ٧ أيام (التعليقات الأقدم بتظهر عادي من غير تنبيه)
  function isOverdue(c) { var m = ageMin(c.commented_at); return isPending(c) && m >= OVERDUE_MIN && m < 7 * 1440; }
  // الروابط جوه نص الرسالة تتحول لزرار بدل ما تتعرض كنص طويل
  function rich(text) {
    // الرابط ساعات بيوصل متقسّم: «…/?) (comment_id=123)» — بنرجّعه رابط واحد بيفتح التعليق نفسه
    text = String(text == null ? "" : text).replace(/(https?:\/\/[^\s)]+?)\/?\?\)\s*\(comment_id=(\d+)\)/g, "$1/?comment_id=$2");
    return esc(text).replace(/https?:\/\/[^\s<>"']+/g, function (m) {
      var tail = (m.match(/[)\]}.,؟?!،:;]+$/) || [""])[0], url = tail ? m.slice(0, m.length - tail.length) : m;
      if (!url) return m;
      var label = /facebook\.com|fb\.com|fb\.watch/i.test(url) ? "افتح على فيسبوك" : /instagram\.com/i.test(url) ? "افتح على انستجرام" : /wa\.me|whatsapp/i.test(url) ? "افتح واتساب" : "فتح الرابط";
      return '<a class="btn ghost sm cm-linkbtn" href="' + url + '" target="_blank" rel="noopener noreferrer">🔗 ' + label + "</a>" + (tail === "?" ? "" : tail.replace(/^\?/, ""));
    });
  }
  function link(url, text) { return url ? '<a href="' + esc(url) + '" target="_blank" rel="noopener">' + text + "</a>" : text; }

  function load() {
    return Promise.all([
      db().from("social_comments").select("*").order("commented_at", { ascending: false }).limit(400),
      db().from("social_reply_templates").select("*").order("created_at", { ascending: false }),
      db().from("content_items").select("id,title"),
      db().from("social_messages").select("*").order("sent_at", { ascending: false }).limit(400),
      db().from("social_settings").select("value").eq("key", "autopilot").maybeSingle(),
      db().from("admins").select("id,name")
    ]).then(function (r) {
      if (r[0].error) throw r[0].error;
      return {
        comments: r[0].data || [], templates: r[1].data || [], titles: (r[2].data || []).reduce(function (m, c) { m[c.id] = c.title; return m; }, {}),
        messages: r[3].error ? [] : (r[3].data || []), autopilot: (r[4] && r[4].data && r[4].data.value) || {},
        staff: (r[5] && !r[5].error ? (r[5].data || []) : []).reduce(function (m, a) { m[a.id] = a.name; return m; }, {})
      };
    });
  }

  function render(container) {
    container.innerHTML = '<div class="loading">بيحمّل…</div>';
    load().then(function (data) { draw(container, data); }).catch(function (e) {
      var missing = /social_comments|does not exist|permission/i.test(e.message || "");
      container.innerHTML = '<div class="err-msg">' + (missing ? "تاب التعليقات لسه محتاج تفعيل في قاعدة البيانات." : "خطأ: " + esc(e.message)) + "</div>";
    });
  }

  function draw(container, data) {
    var top = data.comments.filter(function (c) { return !c.author_is_page && !c.parent_comment_id; });
    var replies = data.comments.filter(function (c) { return c.parent_comment_id; });
    var byParent = {};
    replies.forEach(function (r) { (byParent[r.parent_comment_id] = byParent[r.parent_comment_id] || []).push(r); });
    var cutoff = Date.now() - 60 * 864e5;
    var pendingCount = top.filter(function (c) { return isPending(c) && new Date(c.commented_at).getTime() >= cutoff; }).length;
    var overdueCount = top.filter(isOverdue).length;
    var alerts = alertList(data);
    updateTabBadge(pendingCount + alerts.length, overdueCount + alerts.length);
    var convs = conversations(data.messages);

    var list = top.filter(function (c) {
      if (state.brand && c.brand !== state.brand) return false;
      if (state.platform && c.platform !== state.platform) return false;
      if (state.filter === "pending") return ["new", "drafted", "failed", "approved", "sending"].indexOf(c.status) !== -1;
      if (state.filter === "replied") return c.status === "replied";
      if (state.filter === "ignored") return c.status === "ignored";
      return true;
    });

    var html = '<div class="cm-head"><div><h2>التعليقات</h2><p class="muted">تعليقات ورسايل فيسبوك وانستجرام — بتتحدث كل دقيقتين. ' + autopilotNote(data.autopilot) + '</p></div>' +
      '<button class="btn ghost sm" id="cm-refresh">اسحب التعليقات الجديدة دلوقتي</button></div>' +
      '<div class="cm-tabs">' +
      '<button class="btn sm ' + (state.section === "inbox" ? "" : "ghost") + '" data-section="inbox">التعليقات' + (pendingCount ? ' <span class="cm-count">' + pendingCount + "</span>" : "") + "</button>" +
      '<button class="btn sm ' + (state.section === "templates" ? "" : "ghost") + '" data-section="templates">الردود المعتمدة (' + data.templates.length + ")</button>" +
      '<button class="btn sm ' + (state.section === "messages" ? "" : "ghost") + '" data-section="messages">الرسايل (' + convs.length + ")</button>" +
      '<button class="btn sm ' + (state.section === "alerts" ? "" : "ghost") + (alerts.length ? " danger-btn" : "") + '" data-section="alerts">🚨 تنبيهات' + (alerts.length ? ' <span class="cm-count">' + alerts.length + "</span>" : "") + "</button></div>";
    if (alerts.length && state.section !== "alerts") html += '<div class="cm-alert danger">🚨 فيه ' + alerts.length + ' شكوى/حالة طارئة اترد عليها تلقائي ومحتاجة حد من الفريق يتواصل — <a href="#" data-section="alerts">افتح التنبيهات</a></div>';

    if (overdueCount && state.section === "inbox") html += '<div class="cm-alert">⚠️ فيه ' + overdueCount + ' تعليق مستني رد من أكتر من ساعة — الرد السريع بيفرق مع الناس.</div>';
    if (state.section === "templates") html += templatesHtml(data.templates);
    else if (state.section === "alerts") html += alertsHtml(alerts, data);
    // Owner 2026-11-22 («طبق شكل الرسايل مع الرد اليدوي», mockup docs/ui-references/mockups/chat-inbox.html):
    // comments and messages are conversation cards; tapping one opens a side chat pane with a reply box.
    else if (state.section === "messages") html += inboxHtml("messages", messageItems(convs, data), data);
    else html += inboxHtml("inbox", commentItems(list, byParent, data), data);
    container.innerHTML = '<div class="cm-wrap" dir="rtl">' + html + "</div>";
    wire(container, data);
  }

  var PLAT = { facebook: "فيسبوك", instagram: "انستجرام", whatsapp: "واتساب" };
  var CATEGORY = { handoff: "محتاج حد من الفريق", general: "استفسار", medical_sensitive: "سؤال طبي", emergency: "طوارئ", complaint: "شكوى", thanks: "شكر", spam: "سبام" };
  function autopilotNote(a) {
    var on = [];
    if (a.comments) on.push("التعليقات"); if (a.messages) on.push("الرسايل");
    return on.length ? "الرد التلقائي شغال على: " + on.join(" و") + "." : "الرد التلقائي متوقف — الردود بتستنى اعتماد.";
  }
  // تنبيهات حمرا: شكاوى/طوارئ اترد عليها تلقائياً ولسه محدش من الفريق اتعامل معاها.
  // Meta hides most Facebook commenters' names from the page (Standard Access): show a clear label instead of an empty name.
  function commenterName(c) {
    return c.author_name || (c.platform === 'instagram' ? 'زائر انستجرام' : 'زائر فيسبوك');
  }
  // supabase-js returns data = null and r.error for ANY non-2xx answer or network failure, so the server's own reason (expired session, no
  // permission) used to be replaced by the generic fallback. Read the response body and say what really happened.
  function failText(r, fallback) {
    var e = r && r.error, d = (r && r.data) || {};
    if (!e) return Promise.resolve(d.message || d.error || fallback);
    var ctx = e.context, status = ctx && ctx.status;
    var body = ctx && typeof ctx.json === "function" ? ctx.json().catch(function () { return {}; }) : Promise.resolve({});
    return body.then(function (b) {
      b = b || {};
      if (status === 401 || b.error === "AUTH_REQUIRED") return "الجلسة انتهت — حدّث الصفحة (F5) وسجّل دخول تاني وجرّب";
      if (status === 403 || b.error === "FORBIDDEN") return "حسابك مالوش صلاحية الرد من هنا — كلّم المدير";
      if (b.message) return b.message;
      if (b.error) return b.error;
      if (!ctx) return "مفيش اتصال بالسيرفر دلوقتي أو الطلب اتأخر — جرّب تاني بعد شوية";
      return fallback + " (كود " + (status || "؟") + ")";
    });
  }
  function alertList(data) {
    var out = [];
    data.comments.forEach(function (c) { if (c.alert && !c.alert_resolved_at) out.push({ kind: "comment", id: c.id, platform: c.platform, brand: c.brand, who: commenterName(c), text: c.message, reply: c.final_reply, at: c.commented_at, url: c.comment_url, category: c.category }); });
    var seen = {};
    data.messages.forEach(function (m) {
      if (!m.alert || m.alert_resolved_at || seen[m.conversation_id]) return;
      seen[m.conversation_id] = 1;
      out.push({ kind: "message", id: m.id, platform: m.platform, brand: m.brand, who: m.sender_name, text: m.message, reply: m.reply_text, at: m.sent_at, url: m.conversation_url, category: m.category });
    });
    return out.sort(function (a, b) { return new Date(b.at) - new Date(a.at); });
  }
  function alertsHtml(alerts, data) {
    var intro = '<p class="muted">الشكاوى والحالات الطارئة بيترد عليها فوراً برد ثابت (اعتذار ووعد بالتواصل / توجيه للطوارئ). هنا لازم حد من الفريق يتواصل مع الشخص بنفسه، وبعدها يضغط "تم التعامل".</p>';
    if (!alerts.length) return intro + '<div class="empty">مفيش تنبيهات مفتوحة 👌</div>';
    return intro + alerts.map(function (a) {
      return '<div class="cm-card sensitive">' +
        '<div class="cm-meta"><span class="cm-badge danger">' + (CATEGORY[a.category] || "تنبيه") + "</span>" +
        '<span class="cm-badge ' + a.platform + '">' + (PLAT[a.platform] || a.platform) + " · " + (a.kind === "comment" ? "تعليق" : "رسالة") + "</span>" +
        '<span class="cm-badge">' + (BRANDS[a.brand] || a.brand) + "</span></div>" +
        '<div class="cm-msg"><b>' + esc(a.who || "عميل") + '</b> <span class="muted">' + when(a.at) + " · " + ago(a.at) + "</span>" +
        (a.url ? ' <a class="cm-open" href="' + esc(a.url) + '" target="_blank" rel="noopener">' + (a.platform === "whatsapp" ? "كلّمه على واتساب" : "افتح " + (a.kind === "comment" ? "التعليق" : "المحادثة")) + " ↗</a>" : "") +
        "<p>" + rich(a.text) + "</p></div>" +
        (a.reply ? '<div class="cm-reply page"><b>ردنا التلقائي</b><p>' + rich(a.reply) + "</p></div>" : "") +
        '<div class="cm-actions"><button class="btn btn-primary sm" data-resolve="' + a.kind + "|" + esc(a.id) + '">تم التعامل</button></div></div>';
    }).join("");
  }
  function conversations(messages) {
    var by = {}, order = [];
    messages.slice().reverse().forEach(function (m) {
      if (!by[m.conversation_id]) { by[m.conversation_id] = []; order.push(m.conversation_id); }
      by[m.conversation_id].push(m);
    });
    return order.map(function (id) { var list = by[id]; return { id: id, list: list, last: list[list.length - 1] }; })
      .filter(function (c) { return (!state.brand || c.last.brand === state.brand) && (!state.platform || c.last.platform === state.platform); })
      .sort(function (a, b) { return new Date(b.last.sent_at) - new Date(a.last.sent_at); });
  }
  var MSTATUS = { "new": "مستنية رد", replied: "تم الرد", skipped: "سبام", failed: "فشل الإرسال", expired: "فات عليها ٢٤ ساعة" };
  function messagesHtml(convs) {
    var intro = '<p class="muted cm-messages-intro">رسايل ماسنجر وانستجرام دايركت. فيسبوك مسموح يترد فيها خلال ٢٤ ساعة بس من آخر رسالة من العميل.</p>';
    if (!convs.length) return intro + '<div class="empty">مفيش رسايل لسه — لو الصلاحية pages_messaging مش مفعّلة على توكن الصفحة، الرسايل مش هتتسحب.</div>';
    return intro + '<div class="cm-conversations">' + convs.slice(0, 80).map(function (c) {
      var cust = c.list.filter(function (m) { return !m.is_page; });
      var lastCust = cust[cust.length - 1] || c.last;
      var contact = lastCust.sender_name || 'عميل';
      var h = '<article class="cm-card cm-conversation' + (lastCust.alert ? " sensitive" : "") + '"><header class="cm-conversation-head"><div class="cm-contact"><span class="cm-avatar" aria-hidden="true">' + esc(contact.trim().charAt(0) || '؟') + '</span><div><h3>' + esc(contact) + '</h3><span class="muted cm-last-time">' + when(c.last.sent_at) + '</span></div></div><div class="cm-meta">' +
        '<span class="cm-badge ' + c.last.platform + '">' + (c.last.platform === "facebook" ? "ماسنجر" : (PLAT[c.last.platform] || c.last.platform)) + "</span>" +
        '<span class="cm-badge">' + (BRANDS[c.last.brand] || c.last.brand) + "</span>" +
        '<span class="cm-badge st-' + lastCust.status + '">' + (MSTATUS[lastCust.status] || lastCust.status) + "</span>" +
        (lastCust.category ? '<span class="cm-badge">' + (CATEGORY[lastCust.category] || lastCust.category) + "</span>" : "") +
        (c.last.conversation_url ? '<a class="cm-open" href="' + esc(c.last.conversation_url) + '" target="_blank" rel="noopener">افتح المحادثة ↗</a>' : "") + "</div></header><div class=\"cm-thread\">";
      c.list.slice(-6).forEach(function (m) {
        h += '<div class="cm-reply cm-bubble' + (m.is_page ? " page" : "") + '"><div class="cm-bubble-meta"><b>' + esc(m.is_page ? "الصفحة" : (m.sender_name || "عميل")) + '</b> <span class="muted">' + when(m.sent_at) + "</span></div><p>" + rich(m.message) + "</p></div>";
      });
      if (lastCust.status === "replied" && lastCust.reply_text && !c.list.some(function (m) { return m.is_page && new Date(m.sent_at) >= new Date(lastCust.sent_at); }))
        h += '<div class="cm-reply cm-bubble page"><div class="cm-bubble-meta"><b>ردنا</b> <span class="muted">' + when(lastCust.replied_at) + "</span></div><p>" + rich(lastCust.reply_text) + "</p></div>";
      h += '</div>';
      if (lastCust.status === "failed" && lastCust.last_error) h += '<div class="err-msg">' + esc(lastCust.last_error) + "</div>";
      return h + "</article>";
    }).join("") + "</div>";
  }

  // ---------- Chat inbox (owner 2026-11-22): list of conversation cards → side chat → reply box → contact pane ----------
  var WINDOW_MS = 24 * 3600e3;
  var WINDOW_NOTE = "عدّى 24 ساعة من آخر رسالة للعميل — ميتا مش بتسمح بالرد";
  var STAGES = { qualified: "مؤهّل", new: "جديد", contacted: "اتواصلنا", converted: "اتحوّل لعميل", unqualified: "مش مؤهّل", lost: "مقفول", won: "اتحوّل لعميل" };
  function tm(d) { try { return new Date(d).toLocaleTimeString("ar-EG-u-nu-latn", { hour: "numeric", minute: "2-digit" }); } catch (e) { return ""; } }
  function dkey(d) { var x = new Date(d); return x.getFullYear() + "-" + x.getMonth() + "-" + x.getDate(); }
  function dayName(d) {
    var now = new Date(), y = new Date(now.getTime() - 864e5);
    if (dkey(d) === dkey(now)) return "النهارده";
    if (dkey(d) === dkey(y)) return "امبارح";
    try { return new Date(d).toLocaleDateString("ar-EG-u-nu-latn", { weekday: "long", day: "numeric", month: "long" }); } catch (e) { return ""; }
  }
  function listWhen(d) { return d ? (dkey(d) === dkey(new Date()) ? tm(d) : dayName(d)) : ""; }
  function initial(name) { return String(name || "؟").trim().charAt(0) || "؟"; }
  function platLabel(kind, p) {
    if (kind === "message") return p === "facebook" ? "ماسنجر" : p === "instagram" ? "انستجرام دايركت" : (PLAT[p] || p);
    return p === "facebook" ? "تعليق فيسبوك" : "تعليق انستجرام";
  }
  function sysText(text) { var m = /^lead stage set to\s+(.+?)\.?$/i.exec(String(text || "").trim()); return m ? "اتنقل لمرحلة: " + (STAGES[m[1].toLowerCase()] || m[1]) : ""; }
  function commentItems(list, byParent, data) {
    return list.map(function (c) {
      var thread = byParent[c.platform_comment_id] || [], last = thread.length ? thread[thread.length - 1] : null;
      var lastAt = last && new Date(last.commented_at) > new Date(c.replied_at || 0) ? last.commented_at : (c.replied_at || c.commented_at);
      var preview = c.status === "replied" && c.final_reply && (!last || new Date(c.replied_at) >= new Date(last.commented_at)) ? "أنت: " + c.final_reply : last ? (last.author_is_page ? "أنت: " : "") + last.message : c.message;
      return { key: "c:" + c.id, kind: "comment", c: c, thread: thread, name: commenterName(c), platform: c.platform, brand: c.brand,
        pending: isPending(c), status: c.status, at: lastAt, preview: preview, sensitive: !!c.sensitive, url: c.comment_url, post: data.titles[c.content_id] || "بوست",
        search: [c.author_name, c.message, c.final_reply, data.titles[c.content_id]].concat(thread.map(function (r) { return r.message; })).join(" ").toLowerCase() };
    }).filter(function (it) {
      var q = state.q.trim().toLowerCase();
      if (q && it.search.indexOf(q) < 0) return false;
      if (state.category && (it.c.category || "") !== state.category) return false;
      if (state.postRef && (it.c.content_id || it.c.post_ref || "") !== state.postRef) return false;
      return true;
    });
  }
  function messageItems(convs, data) {
    return convs.map(function (c) {
      var cust = c.list.filter(function (m) { return !m.is_page; }), lastCust = cust[cust.length - 1] || c.last;
      var lastPageIdx = -1; c.list.forEach(function (m, i) { if (m.is_page) lastPageIdx = i; });
      var waiting = c.list.slice(lastPageIdx + 1).filter(function (m) { return !m.is_page && ["new", "failed"].indexOf(m.status) !== -1; }).length;
      var lastShown = c.list.filter(function (m) { return !sysText(m.message); }).slice(-1)[0] || c.last;
      return { key: "m:" + c.id, kind: "message", conv: c, lastCust: lastCust, name: lastCust.sender_name || "عميل", platform: c.last.platform, brand: c.last.brand,
        pending: waiting > 0, unread: waiting, status: lastCust.status, at: c.last.sent_at, preview: (lastShown.is_page ? (c.last.platform === "whatsapp" && !lastShown.sent_by ? "البوت: " : "أنت: ") : "") + (lastShown.message || ""),
        sensitive: !!(lastCust.alert && !lastCust.alert_resolved_at), url: c.last.conversation_url,
        open24: !!lastCust.sent_at && Date.now() - new Date(lastCust.sent_at).getTime() <= WINDOW_MS,
        bot: (c.list.filter(function (m) { return m.bot_state; }).slice(-1)[0] || {}).bot_state || "",
        search: [lastCust.sender_name].concat(c.list.map(function (m) { return m.message; })).join(" ").toLowerCase() };
    }).filter(function (it) {
      var q = state.q.trim().toLowerCase();
      if (q && it.search.indexOf(q) < 0) return false;
      if (state.mfilter === "new") return it.pending;
      if (state.mfilter === "done") return !it.pending;
      return true;
    });
  }
  // Chat look approved by the owner 2026-11-22 («طبقه», mockup docs/ui-references/mockups/chat-inbox-v2.html): line icons.
  var SVG = function (d) { return '<svg viewBox="0 0 24 24" aria-hidden="true">' + d + "</svg>"; };
  var ICON = { user: SVG('<circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/>'), facebook: SVG('<path d="M4 20 8 8l5 6 3-4"/>'),
    instagram: SVG('<rect x="5" y="5" width="14" height="14" rx="4"/>'), whatsapp: SVG('<path d="M6 18l1-3a6 6 0 1 1 2 2z"/>'),
    clock: SVG('<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>'), send: SVG('<path d="M19 12H5M11 6l-6 6 6 6"/>'),
    ext: SVG('<path d="M14 4h6v6M20 4l-9 9M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5"/>'),
    phone: SVG('<path d="M5 4h4l2 5-2.5 1.5a11 11 0 0 0 5 5L15 13l5 2v4a1 1 0 0 1-1 1A16 16 0 0 1 4 5a1 1 0 0 1 1-1"/>') };
  function windowChip(it) {
    if (it.kind !== "message" || !it.lastCust || !it.lastCust.sent_at) return "";
    var left = Math.ceil((WINDOW_MS - (Date.now() - new Date(it.lastCust.sent_at).getTime())) / 3600e3);
    if (left <= 0) return '<span class="cm-win late">' + ICON.clock + "عدّت الـ 24 ساعة</span>";
    return '<span class="cm-win' + (left <= 4 ? " late" : "") + '">' + ICON.clock + "باقي " + left + " " + (left === 1 ? "ساعة" : left <= 10 ? "ساعات" : "ساعة") + " للرد</span>";
  }
  function avatar(it) {
    var p = it.platform;
    return '<span class="cm-av cm-av-' + esc(p) + '" aria-hidden="true">' + ICON.user + '<i class="cm-av-pl">' + (ICON[p] || "") + "</i></span>";
  }
  function convCard(it, open) {
    return '<button type="button" class="cm-conv' + (open ? " on" : "") + (it.sensitive ? " sensitive" : "") + '" data-open-conv="' + esc(it.key) + '" aria-pressed="' + open + '"' + (it.kind === "comment" ? ' data-id="' + esc(it.c.id) + '"' : "") + ">" + avatar(it) +
      '<span class="cm-conv-mid"><span class="cm-conv-name"><b>' + esc(it.name) + '</b>' + (it.brand && it.brand !== "sono" ? '<span class="cm-conv-brand">' + esc(BRANDS[it.brand] || it.brand) + "</span>" : "") + "</span>" +
      '<span class="cm-conv-prev">' + esc(String(it.preview || "").split("\n")[0]) + "</span></span>" +
      '<span class="cm-conv-end"><span class="cm-conv-time">' + esc(listWhen(it.at)) + "</span>" +
      (it.pending ? '<span class="cm-conv-unread" title="محتاج رد">' + (it.unread || 1) + "</span>" : '<span class="cm-conv-done" aria-hidden="true"></span>') + "</span></button>";
  }
  function bubble(side, text, at, who, extraCls) {
    return '<div class="cm-b ' + side + (extraCls ? " " + extraCls : "") + '"><p>' + rich(text) + '</p><span class="cm-b-meta">' + (who ? '<span class="cm-b-who">' + esc(who) + "</span> · " : "") + "<time>" + esc(tm(at)) + "</time></span></div>";
  }
  function withDays(items) {
    var out = "", prev = "";
    items.forEach(function (x) { if (x.at) { var k = dkey(x.at); if (k !== prev) { out += '<div class="cm-day">' + esc(dayName(x.at)) + "</div>"; prev = k; } } out += x.html; });
    return out;
  }
  function staffName(id, data) { if (!id) return ""; var me = window.SSMPDAuth && window.SSMPDAuth.currentAdmin; return me && me.id === id ? "أنت" : (data.staff[id] || "موظف"); }
  // One bar: text + buttons; the note (and secondary buttons like «تجاهل» / «رجّع للبوت») underneath.
  function composer(key, placeholder, value, buttons, hint, extra) {
    return '<div class="cm-composer"><div class="cm-cbar"><textarea class="cm-input" rows="1" data-draft="' + esc(key) + '" placeholder="' + esc(placeholder) + '">' + esc(value) + "</textarea>" + buttons + "</div>" +
      '<div class="cm-composer-row"><span class="cm-hint">' + esc(hint) + "</span>" + (extra || "") + "</div></div>";
  }
  function commentChat(it, data) {
    var c = it.c, items = [{ at: c.commented_at, html: bubble("them", c.message, c.commented_at) }];
    it.thread.forEach(function (r) { items.push({ at: r.commented_at, html: r.author_is_page ? bubble("me", r.message, r.commented_at, "الصفحة") : bubble("them", r.message, r.commented_at, commenterName(r)) }); });
    if (c.status === "replied" && c.final_reply && !it.thread.some(function (r) { return r.author_is_page && r.message === c.final_reply; }))
      items.push({ at: c.replied_at, html: bubble("me", c.final_reply, c.replied_at, c.handled_by ? staffName(c.handled_by, data) : "رد تلقائي", c.handled_by ? "staff" : "auto") });
    items.sort(function (a, b) { return new Date(a.at) - new Date(b.at); });
    var canAnswer = ["new", "drafted", "failed"].indexOf(c.status) !== -1;
    var foot = c.status === "failed" && c.last_error ? '<div class="err-msg">' + esc(c.last_error) + "</div>" : "";
    if (canAnswer) foot += composer(it.key, "اكتب الرد على التعليق…", state.drafts[it.key] != null ? state.drafts[it.key] : (c.suggested_reply || ""),
      '<button type="button" class="btn ghost sm cm-sug" data-suggest="' + esc(c.id) + '">✨ <span>' + (c.suggested_reply ? "اقترح رد تاني" : "اقترح رد") + "</span></button>" +
      '<button type="button" class="btn sm cm-send" data-approve="' + esc(c.id) + '">اعتمد وانشر</button>',
      "بيانات الحجز (العنوان + التليفون + الواتساب) بتتضاف لوحدها في آخر الرد لو مش موجودة.",
      '<button type="button" class="btn ghost sm" data-ignore="' + esc(c.id) + '">تجاهل</button>');
    else if (c.status === "approved" || c.status === "sending") foot += '<div class="cm-closed">الرد في الطريق للنشر…</div>';
    else if (c.status === "ignored") foot += '<div class="cm-closed">التعليق ده اتجاهل.</div>';
    return '<div class="cm-msgs pl-' + esc(it.platform) + '" data-cm-msgs><div class="cm-post-ref"><span class="cm-post-thumb" aria-hidden="true"></span><span><small>تعليق على بوست</small><b>' + esc(it.post) + "</b></span></div>" + withDays(items) + "</div>" + foot;
  }
  // WhatsApp (owner 2026-11-22): the swnw-agent answers the number; staff sends are queued for it (meta-comments → outbox).
  function botChip(it) {
    if (it.kind !== "message" || it.platform !== "whatsapp" || !it.bot) return "";
    return it.bot === "human" ? '<span class="cm-bot human">موظف ماسك المحادثة</span>' : '<span class="cm-bot ai">البوت شغّال</span>';
  }
  // WhatsApp template requests (owner only): the dashboard queues them, the WhatsApp agent submits to Meta, statuses come back here.
  var TPL_STATUS = { QUEUED: "في الطابور", LEASED: "بيتقدّم لميتا", PENDING: "بانتظار مراجعة ميتا", APPROVED: "معتمد", REJECTED: "مرفوض", FAILED: "فشل التقديم" };
  function isOwner() {
    var a = window.SSMPDAuth && window.SSMPDAuth.currentAdmin;
    if (!a) return false;
    return window.SSMPDRoles && window.SSMPDRoles.hasRole ? !!window.SSMPDRoles.hasRole(a, "super_admin") : a.role === "super_admin";
  }
  function tplTextError(text) {
    var t = String(text || "").trim();
    if (t.length < 10) return "نص القالب قصير — اكتب جملة كاملة";
    if (t.length > 1024) return "نص القالب طويل — الحد 1024 حرف";
    if (/\{\{|\}\}/.test(t)) return "القوالب من غير متغيرات {{ }} في الإصدار ده";
    var digits = t.replace(/[٠-٩]/g, function (d) { return "٠١٢٣٤٥٦٧٨٩".indexOf(d); }).replace(/[\s\-.()+/]/g, "");
    if (/[0-9]{8,}/.test(digits)) return "ممنوع أرقام تليفون أو أرقام ملفات في القالب";
    return "";
  }
  function tplAdmin() {
    if (!isOwner()) return "";
    var f = state.waForm, h = '<div class="cm-tpl-admin"><div class="cm-tpl-admin-row"><button type="button" class="btn ghost sm" data-wa-new-tpl>+ قالب جديد</button>' +
      '<button type="button" class="btn ghost sm" data-wa-req-load>حالة القوالب</button></div>';
    if (f) h += '<div class="cm-tpl-form" data-wa-form><label>نص القالب (بالعربي، من غير متغيرات)<textarea class="cm-input" data-wa-form-text rows="4" maxlength="1024">' + esc(f.text) + '</textarea></label>' +
      '<small class="muted" data-wa-count>' + String(f.text.length) + ' / 1024</small>' +
      '<div class="cm-tpl-cat"><label><input type="radio" name="wa-cat" value="UTILITY"' + (f.cat === "UTILITY" ? " checked" : "") + '> خدمي</label>' +
      '<label><input type="radio" name="wa-cat" value="MARKETING"' + (f.cat === "MARKETING" ? " checked" : "") + '> تسويقي</label></div>' +
      '<p class="cm-hint">الخدمي: متابعة حجز أو زيارة فعلية. التسويقي: عروض أو إعادة تواصل — ومحتاج موافقة العميل على الرسايل التسويقية.</p>' +
      '<p class="cm-warn">ممنوع كتابة بيانات مريض أو أرقام تليفون أو أرقام ملفات في القالب.</p>' +
      '<div class="cm-tpl-preview" data-wa-preview>' + esc(f.text || "معاينة الرسالة هتظهر هنا") + '</div>' +
      '<p class="err-msg" data-wa-form-err hidden></p>' +
      '<div class="cm-composer-row"><button type="button" class="btn sm" data-wa-form-send>تقديم لميتا</button><button type="button" class="btn ghost sm" data-wa-form-cancel>إلغاء</button></div>' +
      '<small class="muted">الاسم بيتولّد تلقائي (sono_…_ar)، واللغة عربي.</small></div>';
    var r = state.waReq;
    if (r === "loading") h += '<span class="cm-hint">بيجيب حالة القوالب…</span>';
    else if (r && r.length) h += '<div class="cm-reqs">' + r.map(function (x) {
      return '<div class="cm-req"><div><b>' + esc(x.name) + '</b> <span class="cm-badge st-' + esc(x.status) + '">' + esc(TPL_STATUS[x.status] || x.status) + '</span> <small class="muted">' + esc(x.category === "UTILITY" ? "خدمي" : "تسويقي") + '</small></div>' +
        '<p>' + esc(x.text) + '</p>' + (x.reason ? '<p class="err-msg">' + esc(x.reason) + '</p>' : '') +
        '<small class="muted">قدّمه ' + esc(x.submitted_by || "—") + ' · ' + when(x.submitted_at) + '</small></div>';
    }).join("") + '</div>';
    else if (r) h += '<span class="cm-hint">لسه ما قدّمتش قوالب من الداشبورد.</span>';
    return h + "</div>";
  }
  function whatsappFoot(it) {
    var id = it.conv.id, back = it.bot === "human" ? '<button type="button" class="btn ghost sm" data-wa-return="' + esc(id) + '">رجّع للبوت</button>' : "";
    if (!it.open24) {
      var t = state.waTemplates;
      var list = !t ? '<button type="button" class="btn sm" data-wa-load-tpl>اختار قالب معتمد</button>'
        : t === "loading" ? '<span class="cm-hint">بيجيب القوالب…</span>'
        : !t.length ? '<span class="cm-hint">مفيش قوالب معتمدة من غير بيانات لسه.</span>'
        : t.map(function (x) { return '<button type="button" class="cm-tpl" data-wa-tpl="' + esc(x.name) + '" data-wa-lang="' + esc(x.language) + '"><b>' + esc(x.name) + "</b>" + (x.text ? "<span>" + esc(x.text) + "</span>" : "") + "</button>"; }).join("");
      return '<div class="cm-closed cm-wa-closed" data-window-closed data-wa-conv="' + esc(id) + '"><p>عدّى 24 ساعة من آخر رسالة للعميل — ميتا مش بتسمح بالرد إلا بقالب معتمد.</p><div class="cm-tpls">' + list + "</div>" + tplAdmin() + (back ? '<div class="cm-composer-row">' + back + "</div>" : "") + "</div>";
    }
    return composer(it.key, "اكتب رسالة واتساب…", state.drafts[it.key] || "",
      '<button type="button" class="btn ghost sm cm-sug" data-msuggest="' + esc(id) + '">✨ <span>اقترح رد</span></button>' +
      '<button type="button" class="btn sm cm-send" data-msend="' + esc(id) + '">إرسال' + ICON.send + "</button>",
      (it.bot === "human" ? "البوت ساكت في المحادثة دي — بيرجع لوحده بعد فترة من غير رد من الفريق." : "أول ما تبعت، البوت بيسكت في المحادثة دي لحد ما ترجّعه."), back);
  }
  // A queued WhatsApp command: wait (up to ~60s) for the agent to send it, then tell the person what happened.
  function waitOutbox(id) {
    var tries = 0;
    return new Promise(function (resolve) {
      (function tick() {
        db().functions.invoke("meta-comments", { body: { action: "outbox_status", id: id } }).then(function (r) {
          var d = r.data || {};
          if (d.ok && ["sent", "failed", "window_closed"].indexOf(d.status) !== -1) return resolve(d);
          if (++tries >= 20) return resolve({ status: "queued" });
          setTimeout(tick, 3000);
        }).catch(function () { if (++tries >= 20) resolve({ status: "queued" }); else setTimeout(tick, 3000); });
      })();
    });
  }
  function messageChat(it, data) {
    var c = it.conv, items = [];
    c.list.forEach(function (m) {
      var sys = m.is_page && sysText(m.message);
      if (sys) { items.push({ at: m.sent_at, html: '<div class="cm-sys">' + esc(sys) + " · " + esc(tm(m.sent_at)) + "</div>" }); return; }
      items.push({ at: m.sent_at, html: m.is_page ? bubble("me", m.message, m.sent_at, m.sent_by ? staffName(m.sent_by, data) : it.platform === "whatsapp" ? "البوت" : "الصفحة", m.sent_by ? "staff" : it.platform === "whatsapp" ? "auto" : "") : bubble("them", m.message, m.sent_at) });
    });
    var lc = it.lastCust;
    if (lc.status === "replied" && lc.reply_text && !c.list.some(function (m) { return m.is_page && new Date(m.sent_at) >= new Date(lc.sent_at); }))
      items.push({ at: lc.replied_at, html: bubble("me", lc.reply_text, lc.replied_at, lc.sent_by ? staffName(lc.sent_by, data) : "رد تلقائي", lc.sent_by ? "staff" : "auto") });
    var foot = lc.status === "failed" && lc.last_error ? '<div class="err-msg">' + esc(lc.last_error) + "</div>" : "";
    if (it.platform === "whatsapp") foot += whatsappFoot(it);
    else if (it.platform !== "facebook" && it.platform !== "instagram") foot += '<div class="cm-closed">الرد على ' + esc(PLAT[it.platform] || it.platform) + " بيكون من التطبيق نفسه" + (it.url ? ' — <a href="' + esc(it.url) + '" target="_blank" rel="noopener">افتح المحادثة ↗</a>' : "") + ".</div>";
    else if (!it.open24) foot += '<div class="cm-closed" data-window-closed>' + WINDOW_NOTE + (it.url ? ' — <a href="' + esc(it.url) + '" target="_blank" rel="noopener">افتح المحادثة على ميتا ↗</a>' : "") + "</div>";
    else foot += composer(it.key, "اكتب رسالة…", state.drafts[it.key] || "",
      '<button type="button" class="btn ghost sm cm-sug" data-msuggest="' + esc(c.id) + '">✨ <span>اقترح رد</span></button>' +
      '<button type="button" class="btn sm cm-send" data-msend="' + esc(c.id) + '">إرسال' + ICON.send + "</button>", "ميتا بتسمح بالرد خلال 24 ساعة من آخر رسالة من العميل.");
    return '<div class="cm-msgs pl-' + esc(it.platform) + '" data-cm-msgs>' + withDays(items) + "</div>" + foot;
  }
  // The lead behind a chat (owner 2026-11-22: «يظهرلي علي الشمال انه اتعمله ليد وتفاصيل الليد وحالته ولما ادوس عليه يفتحلي الليد»).
  // RPC social_conversation_lead (migration 20261122180000): limited summary for inbox staff; can_open = the leads module would open it.
  var LEAD_STATUS = { new: "جديد", in_progress: "قيد المتابعة", booked: "تم الحجز", booked_on_system: "تم الحجز على سيستم المركز", service_done: "تم إجراء الخدمة",
    interested_undecided: "مهتم لسه مقررش", rejected: "مرفوض", no_response: "لا يوجد رد", invalid_number: "رقم غير صحيح", missing_data: "ناقص بيانات" };
  var LEAD_TONE = { new: "new", in_progress: "soon", missing_data: "soon", interested_undecided: "soon", booked: "ok", booked_on_system: "ok", service_done: "ok", rejected: "old", no_response: "old", invalid_number: "late" };
  var LEAD_SOURCE = { whatsapp: "واتساب", messenger: "ماسنجر", instagram: "انستجرام", facebook_form: "فورم فيسبوك", phone: "تليفون", clinic: "المركز", doctor_referral: "تحويل دكتور" };
  var ATTEMPT = { answered: "رد", no_answer: "مردش", busy: "مشغول", call_back_later: "يتكلم بعدين", other: "أخرى" };
  function shortDate(v) { if (!v) return ""; var d = new Date(v); return isNaN(d) ? "" : d.toLocaleDateString("ar-EG-u-nu-latn", { day: "numeric", month: "long" }); }
  function leadCard(convId) {
    var st = state.leads[convId];
    if (!st || st.loading && !st.lead) return '<div class="cm-lead cm-lead-wait"><b>الليد</b><span>بيدوّر على الليد…</span></div>';
    if (st.error) return '<div class="cm-lead"><b>الليد</b><span class="cm-lead-note">' + esc(st.error) + "</span></div>";
    var l = st.lead;
    if (!l) return '<div class="cm-lead cm-lead-none"><b>الليد</b><span class="cm-lead-note">مفيش ليد للمحادثة دي لسه.</span>' +
      '<button type="button" class="btn sm cm-send" data-lead-create="' + esc(convId) + '"' + (st.busy ? " disabled" : "") + ">" + (st.busy ? "بيتعمل…" : "اعمل ليد") + "</button></div>";
    var rows = [["الاسم", l.name], ["التليفون", l.phone ? '<span dir="ltr">' + esc(l.phone) + "</span>" : "", true], ["المصدر", (LEAD_SOURCE[l.source] || l.source || "") + (l.campaign ? " · حملة " + l.campaign : l.acquisition === "ad" ? " · إعلان" : "")],
      ["المسؤول", l.assigned || "لسه متوزعش"], ["اتعمل", shortDate(l.created_at)],
      ["آخر محاولة", l.last_attempt ? shortDate(l.last_attempt.at) + " · " + (ATTEMPT[l.last_attempt.result] || l.last_attempt.result || "") : "لسه محدش كلّمه"]];
    var body = '<span class="cm-lead-head"><b>الليد</b><span class="cm-lead-st st-' + esc(LEAD_TONE[l.status] || "old") + '">' + esc(LEAD_STATUS[l.status] || l.status || "") + "</span></span>" +
      '<dl class="cm-lead-facts">' + rows.filter(function (r) { return r[1]; }).map(function (r) { return "<div><dt>" + r[0] + "</dt><dd>" + (r[2] ? r[1] : esc(r[1])) + "</dd></div>"; }).join("") + "</dl>";
    return l.can_open ? '<button type="button" class="cm-lead cm-lead-open" data-lead-open="' + esc(l.id) + '" aria-label="افتح الليد">' + body + '<span class="cm-lead-go">افتح الليد ←</span></button>'
      : '<div class="cm-lead">' + body + '<span class="cm-lead-note">تفاصيل الليد بتتفتح لخدمة العملاء والإدارة.</span></div>';
  }
  function stopLeadWatch() {
    var w = state.leadWatch; if (!w) return;
    clearInterval(w.timer);
    if (w.ch) { try { db().removeChannel(w.ch); } catch (e) {} }
    state.leadWatch = null;
  }
  function infoHtml(it, data) {
    var isC = it.kind === "comment", stLabel = isC ? (STATUS[it.status] || it.status) : (MSTATUS[it.status] || it.status), cat = isC ? it.c.category : it.lastCust.category;
    var first = isC ? it.c.commented_at : (it.conv.list[0] || {}).sent_at;
    var h = '<div class="cm-info">' + avatar(it) + "<h3>" + esc(it.name) + '</h3><p class="cm-info-sub">' + esc(platLabel(it.kind, it.platform)) + " · " + esc(BRANDS[it.brand] || it.brand || "") + "</p>";
    var acts = "";
    if (it.url) acts += '<a class="cm-act" href="' + esc(it.url) + '" target="_blank" rel="noopener"><span>' + ICON.ext + "</span>" + (it.platform === "whatsapp" ? "فتح واتساب" : "فتح في ميتا") + "</a>";
    var wa = !isC && it.platform === "whatsapp" ? String(it.conv.id).replace(/^whatsapp:/, "") : "";
    if (/^\d{8,15}$/.test(wa)) acts += '<a class="cm-act" href="tel:+' + esc(wa) + '"><span>' + ICON.phone + "</span>اتصال</a>";
    if (acts) h += '<div class="cm-acts">' + acts + "</div>";
    if (!isC) h += '<div class="cm-lead-box" data-cm-lead="' + esc(it.conv.id) + '">' + leadCard(it.conv.id) + "</div>";
    if (it.sensitive) h += '<span class="cm-badge danger">' + esc(CATEGORY[cat] || "تنبيه") + '</span><button type="button" class="btn sm cm-send" data-resolve="' + (isC ? "comment|" + esc(it.c.id) : "message|" + esc(it.lastCust.id)) + '">تم التعامل</button>';
    h += '<dl class="cm-facts"><div><dt>الحالة</dt><dd><span class="cm-badge st-' + esc(it.status) + '">' + esc(stLabel) + "</span></dd></div>" +
      (cat ? "<div><dt>التصنيف</dt><dd>" + esc(CATEGORY[cat] || cat) + "</dd></div>" : "") +
      (first ? "<div><dt>أول " + (isC ? "تعليق" : "رسالة") + "</dt><dd>" + esc(dayName(first) + " " + tm(first)) + "</dd></div>" : "") +
      (isC ? "<div><dt>البوست</dt><dd>" + esc(it.post) + "</dd></div>" : "") + "</dl>";
    if (isC && it.c.status === "replied" && it.c.final_reply) h += it.c.auto_template_id ? '<p class="muted cm-lib">✓ ضمن الردود المعتمدة</p>' : (it.c.sensitive ? "" : '<button type="button" class="btn ghost sm" data-template="' + esc(it.c.id) + '">إضافة للردود المعتمدة</button>');
    return h + "</div>";
  }
  function inboxHtml(section, items, data) {
    var isC = section === "inbox", openKey = state.open[section];
    if (openKey && !items.some(function (it) { return it.key === openKey; })) openKey = state.open[section] = "";
    if (!openKey && items.length && window.matchMedia && !window.matchMedia("(max-width: 760px)").matches) openKey = state.open[section] = items[0].key;
    var it = items.filter(function (x) { return x.key === openKey; })[0];
    var statusTabs = isC ? [["pending", "محتاج رد"], ["replied", "تم الرد"], ["ignored", "متجاهل"], ["all", "الكل"]] : [["all", "الكل"], ["new", "محتاج رد"], ["done", "تم الرد"]];
    var cur = isC ? state.filter : state.mfilter;
    var plats = isC ? [["", "الكل"], ["facebook", "فيسبوك"], ["instagram", "انستجرام"]] : [["", "الكل"], ["facebook", "ماسنجر"], ["instagram", "انستجرام"], ["whatsapp", "واتساب"]];
    var head = '<div class="cm-list-head"><label class="cm-search"><input type="search" data-cm-q placeholder="دوّر باسم أو كلمة" value="' + esc(state.q) + '" aria-label="بحث"></label>' +
      '<div class="cm-status-tabs" role="tablist">' + statusTabs.map(function (t) { return '<button type="button" role="tab" class="' + (cur === t[0] ? "on" : "") + '" aria-selected="' + (cur === t[0]) + '" data-cm-status="' + t[0] + '">' + t[1] + "</button>"; }).join("") + "</div>" +
      '<div class="cm-chips">' + plats.map(function (p) { return '<button type="button" class="cm-chip' + (state.platform === p[0] ? " on" : "") + '" data-cm-plat="' + p[0] + '">' + p[1] + "</button>"; }).join("") +
      select("cm-brand", state.brand, { "": "كل الصفحات", sono: "سونو", dr_dina: "د. دينا" }) +
      (isC ? select("cm-category", state.category, { "": "كل التصنيفات", general: "استفسار", handoff: "محتاج حد من الفريق", medical_sensitive: "سؤال طبي", complaint: "شكوى", emergency: "طوارئ", thanks: "شكر", spam: "سبام" }) + postSelect(data) : "") + "</div></div>";
    var list = '<div class="cm-convs">' + (items.length ? items.map(function (x) { return convCard(x, x.key === openKey); }).join("") : '<p class="empty">' + (isC ? "مفيش تعليقات بالفلتر ده." : "مفيش رسايل بالفلتر ده.") + "</p>") + "</div>";
    var chat = it ? '<div class="cm-chat-head"><button type="button" class="cm-ibtn cm-back" data-cm-back aria-label="رجوع للقايمة">→</button>' + avatar(it) +
      '<span class="cm-chat-title"><b>' + esc(it.name) + "</b><small>" + esc(platLabel(it.kind, it.platform)) + " · " + esc(BRANDS[it.brand] || it.brand || "") + "</small></span>" +
      '<span class="cm-badge st-' + esc(it.status) + '">' + esc(isC ? (STATUS[it.status] || it.status) : (MSTATUS[it.status] || it.status)) + "</span>" + botChip(it) + windowChip(it) +
      (it.url ? '<a class="cm-ibtn" href="' + esc(it.url) + '" target="_blank" rel="noopener" title="افتح على ميتا" aria-label="افتح على ميتا">↗</a>' : "") +
      '<button type="button" class="cm-ibtn" data-cm-info aria-label="بيانات العميل" aria-pressed="' + state.info + '">ⓘ</button></div>' + (isC ? commentChat(it, data) : messageChat(it, data))
      : '<div class="cm-chat-empty"><b>اختار ' + (isC ? "تعليق" : "محادثة") + " من القايمة</b><p>هتفتح هنا زي شات واتساب.</p></div>";
    var showInfo = it && (state.info || state.sheet);
    return (isC ? "" : '<p class="muted cm-messages-intro">رسايل ماسنجر وانستجرام دايركت وواتساب. تقدر ترد من هنا خلال 24 ساعة من آخر رسالة من العميل — وعلى واتساب بعد كده بقالب معتمد.</p>') +
      '<div class="cm-inbox' + (showInfo ? "" : " no-info") + (openKey ? " open" : "") + (state.sheet ? " sheet" : "") + '" data-cm-inbox="' + section + '">' +
      '<section class="cm-pane cm-list-pane" aria-label="المحادثات">' + head + list + "</section>" +
      '<section class="cm-pane cm-chat-pane" aria-label="المحادثة">' + chat + "</section>" +
      (showInfo ? '<aside class="cm-pane cm-info-pane" aria-label="بيانات العميل">' + (state.sheet ? '<button type="button" class="cm-ibtn cm-sheet-close" data-cm-info aria-label="إغلاق">✕</button>' : "") + infoHtml(it, data) + "</aside>" : "") + "</div>";
  }
  function postSelect(data) {
    var seen = {}, opts = { "": "كل البوستات" };
    data.comments.forEach(function (c) { var k = c.content_id || c.post_ref; if (k && !seen[k]) { seen[k] = 1; opts[k] = String(data.titles[c.content_id] || "بوست").slice(0, 40); } });
    return select("cm-post-ref", state.postRef, opts);
  }

  function select(id, value, options) {
    return '<select id="' + id + '">' + Object.keys(options).map(function (k) {
      return '<option value="' + k + '"' + (k === value ? " selected" : "") + ">" + options[k] + "</option>";
    }).join("") + "</select>";
  }

  function card(c, thread, data) {
    var title = data.titles[c.content_id] || "بوست";
    var canAnswer = ["new", "drafted", "failed"].indexOf(c.status) !== -1;
    var inLibrary = !!c.auto_template_id;
    var autoNote = c.auto_template_id && c.status !== "new" && c.handled_by == null ? '<span class="cm-badge auto">رد تلقائي</span>' : "";
    var h = '<div class="cm-card' + (c.sensitive ? " sensitive" : "") + '" data-id="' + esc(c.id) + '">' +
      '<div class="cm-meta"><span class="cm-badge ' + c.platform + '">' + (c.platform === "facebook" ? "فيسبوك" : "انستجرام") + "</span>" +
      '<span class="cm-badge">' + (BRANDS[c.brand] || c.brand) + "</span>" +
      '<span class="cm-badge st-' + c.status + '">' + (STATUS[c.status] || c.status) + "</span>" +
      (c.sensitive ? '<span class="cm-badge danger">حساس — راجعه بنفسك</span>' : "") + autoNote +
      (isOverdue(c) ? '<span class="cm-badge danger">متأخر ' + ago(c.commented_at).replace("من ", "") + "</span>" : "") +
      '<span class="muted cm-post">على: ' + esc(title) + "</span></div>" +
      '<div class="cm-msg"><b>' + link(c.author_url, esc(commenterName(c))) + '</b> <span class="muted">' + when(c.commented_at) + " · " + ago(c.commented_at) + "</span>" +
      (c.comment_url ? ' <a class="cm-open" href="' + esc(c.comment_url) + '" target="_blank" rel="noopener">افتح على ' + (c.platform === "facebook" ? "فيسبوك" : "انستجرام") + " ↗</a>" : "") +
      "<p>" + rich(c.message) + "</p></div>";
    thread.forEach(function (r) {
      h += '<div class="cm-reply' + (r.author_is_page ? " page" : "") + '"><b>' + esc(r.author_is_page ? "رد الصفحة" : commenterName(r)) + "</b> <span class=\"muted\">" + when(r.commented_at) + "</span><p>" + rich(r.message) + "</p></div>";
    });
    if (c.status === "replied" && c.final_reply) {
      h += '<div class="cm-reply page"><b>ردنا</b> <span class="muted">' + when(c.replied_at) + "</span><p>" + rich(c.final_reply) + "</p></div>";
      h += inLibrary ? '<div class="muted cm-lib">✓ ضمن الردود المعتمدة</div>'
        : (c.sensitive ? "" : '<button class="btn ghost sm" data-template="' + esc(c.id) + '">إضافة للردود المعتمدة</button>');
    }
    if (c.status === "failed" && c.last_error) h += '<div class="err-msg">' + esc(c.last_error) + "</div>";
    if (canAnswer) {
      h += '<textarea class="cm-input" rows="5" placeholder="اكتب الرد…">' + esc(c.suggested_reply || "") + "</textarea>" +
        '<div class="muted cm-hint">بيانات الحجز (العنوان + التليفون + الواتساب) بتتضاف تلقائياً في آخر أي رد لو مش موجودة.</div>' +
        '<div class="cm-actions"><button class="btn btn-primary sm" data-approve="' + esc(c.id) + '">اعتمد وانشر</button>' +
        '<button class="btn ghost sm" data-suggest="' + esc(c.id) + '">✨ ' + (c.suggested_reply ? "اقترح رد تاني" : "اقترح رد") + "</button>" +
        '<button class="btn ghost sm" data-ignore="' + esc(c.id) + '">تجاهل</button></div>';
    }
    return h + "</div>";
  }

  function templatesHtml(templates) {
    var intro = '<p class="muted">أي تعليق جديد شبه واحد من الأمثلة دي هيترد عليه تلقائياً بنفس الرد من غير اعتماد. التعليقات الحساسة (شكاوى أو أعراض خطيرة) عمرها ما بتترد تلقائي.</p>';
    if (!templates.length) return intro + '<div class="empty">لسه مفيش ردود معتمدة. بعد ما ترد على تعليق، اضغط "إضافة للردود المعتمدة" تحته.</div>';
    return intro + templates.map(function (t) {
      return '<div class="cm-card' + (t.active ? "" : " off") + '" data-tid="' + t.id + '">' +
        '<div class="cm-meta"><span class="cm-badge">' + (BRANDS[t.brand] || t.brand) + "</span>" +
        '<span class="cm-badge ' + (t.active ? "st-replied" : "st-ignored") + '">' + (t.active ? "شغال" : "متوقف") + "</span>" +
        '<span class="muted">اتستخدم ' + (t.uses_count || 0) + " مرة</span></div>" +
        '<div class="muted">بيترد على تعليقات زي:</div><ul class="cm-examples">' + (t.examples || []).map(function (e) { return "<li>" + esc(e) + "</li>"; }).join("") + "</ul>" +
        '<textarea class="cm-input" rows="3">' + esc(t.reply_text) + "</textarea>" +
        '<div class="cm-actions"><button class="btn ghost sm" data-tsave="' + t.id + '">حفظ تعديل الرد</button>' +
        '<button class="btn ' + (t.active ? "danger" : "") + ' sm" data-ttoggle="' + t.id + '" data-active="' + (t.active ? "1" : "0") + '">' + (t.active ? "إيقاف" : "تشغيل") + "</button></div></div>";
    }).join("");
  }

  function wire(container, data) {
    var again = function () { render(container); };
    var fail = function (e) { alert(e && e.message ? e.message : "حصل خطأ"); };
    var q = function (s) { return container.querySelectorAll(s); };
    var refresh = container.querySelector("#cm-refresh");
    if (refresh) refresh.onclick = function () {
      refresh.disabled = true; refresh.textContent = "بيسحب من فيسبوك وانستجرام…";
      db().functions.invoke("meta-comments", { body: { action: "sync" } }).catch(function () {}).then(again);
    };
    var pf = container.querySelector("#cm-platform"); if (pf) pf.onchange = function () { state.platform = pf.value; draw(container, data); };
    q("[data-suggest]").forEach(function (b) {
      b.onclick = function () {
        var box = (b.closest(".cm-card") || b.closest(".cm-chat-pane")).querySelector(".cm-input");
        b.disabled = true; var label = b.textContent; b.textContent = "بيكتب رد…";
        db().functions.invoke("meta-comments", { body: { action: "suggest", id: b.dataset.suggest } }).then(function (r) {
          var d = r.data || {};
          if (r.error || !d.ok) throw new Error(d.error || "تعذر اقتراح رد");
          box.value = d.text; if (box.dataset.draft) state.drafts[box.dataset.draft] = d.text; box.focus();
        }).catch(fail).then(function () { b.disabled = false; b.textContent = label; });
      };
    });
    q("[data-section]").forEach(function (b) { b.onclick = function (e) { if (e && e.preventDefault) e.preventDefault(); state.section = b.dataset.section; draw(container, data); }; });
    q("[data-resolve]").forEach(function (b) {
      b.onclick = function () {
        var parts = b.dataset.resolve.split("|");
        b.disabled = true;
        db().rpc("social_alert_resolve", { p_kind: parts[0], p_id: parts.slice(1).join("|") }).then(function (r) { if (r.error) throw r.error; again(); }).catch(function (e) { b.disabled = false; fail(e); });
      };
    });
    var f = container.querySelector("#cm-filter"); if (f) f.onchange = function () { state.filter = f.value; draw(container, data); };
    var br = container.querySelector("#cm-brand"); if (br) br.onchange = function () { state.brand = br.value; draw(container, data); };
    q("[data-approve]").forEach(function (b) {
      b.onclick = function () {
        var text = (b.closest(".cm-card") || b.closest(".cm-chat-pane")).querySelector(".cm-input").value.trim();
        if (!text) return alert("اكتب الرد الأول");
        b.disabled = true;
        db().rpc("social_comment_approve", { p_id: b.dataset.approve, p_reply: text }).then(function (r) {
          if (r.error) throw r.error;
          return db().functions.invoke("meta-comments", { body: { id: b.dataset.approve } });
        }).then(again).catch(function (e) { b.disabled = false; fail(e); });
      };
    });
    // Chat inbox: open a conversation, filters, search, back (phones), info pane, drafts, manual message reply.
    var redraw = function () { draw(container, data); };
    q("[data-open-conv]").forEach(function (b) { b.onclick = function () { state.open[state.section] = b.dataset.openConv; state.sheet = false; redraw(); }; });
    q("[data-cm-status]").forEach(function (b) { b.onclick = function () { if (state.section === "messages") state.mfilter = b.dataset.cmStatus; else state.filter = b.dataset.cmStatus; redraw(); }; });
    q("[data-cm-plat]").forEach(function (b) { b.onclick = function () { state.platform = b.dataset.cmPlat; redraw(); }; });
    var cat = container.querySelector("#cm-category"); if (cat) cat.onchange = function () { state.category = cat.value; redraw(); };
    var post = container.querySelector("#cm-post-ref"); if (post) post.onchange = function () { state.postRef = post.value; redraw(); };
    var search = container.querySelector("[data-cm-q]");
    if (search) search.oninput = function () { var pos = search.selectionStart; state.q = search.value; redraw(); var again2 = container.querySelector("[data-cm-q]"); if (again2) { again2.focus(); try { again2.setSelectionRange(pos, pos); } catch (e) {} } };
    q("[data-cm-back]").forEach(function (b) { b.onclick = function () { state.open[state.section] = ""; state.sheet = false; redraw(); }; });
    q("[data-cm-info]").forEach(function (b) { b.onclick = function () { if (window.matchMedia && window.matchMedia("(max-width: 1100px)").matches) state.sheet = !state.sheet; else state.info = !state.info; redraw(); }; });
    q("[data-draft]").forEach(function (t) { t.oninput = function () { state.drafts[t.dataset.draft] = t.value; }; });
    var msgs = container.querySelector("[data-cm-msgs]"); if (msgs) msgs.scrollTop = msgs.scrollHeight;
    q("[data-msuggest]").forEach(function (b) {
      b.onclick = function () {
        var box = container.querySelector(".cm-chat-pane .cm-input"), label = b.textContent;
        b.disabled = true; b.textContent = "بيكتب رد…";
        db().functions.invoke("meta-comments", { body: { action: "suggest_message", conversation_id: b.dataset.msuggest } }).then(function (r) {
          var d = r.data || {};
          if (r.error || !d.ok) throw new Error(d.error || "تعذر اقتراح رد");
          box.value = d.text; state.drafts["m:" + b.dataset.msuggest] = d.text; box.focus();
        }).catch(fail).then(function () { b.disabled = false; b.textContent = label; });
      };
    });
    q("[data-msend]").forEach(function (b) {
      b.onclick = function () {
        var box = container.querySelector(".cm-chat-pane .cm-input"), text = box ? box.value.trim() : "";
        if (!text) return alert("اكتب الرسالة الأول");
        b.disabled = true; b.textContent = "بيتبعت…";
        db().functions.invoke("meta-comments", { body: { action: "send_message", conversation_id: b.dataset.msend, text: text } }).then(function (r) {
          var d = r.data || {};
          if (r.error || !d.ok) return failText(r, "تعذر إرسال الرسالة").then(function (m) { throw new Error(m); });
          state.drafts["m:" + b.dataset.msend] = "";
          if (d.queued) return waOutcome(d.id, b);
          if (window.SSMPDToast && window.SSMPDToast.show) window.SSMPDToast.show("اتبعتت الرسالة");
          again();
        }).catch(function (e) { b.disabled = false; b.textContent = "إرسال"; fail(e); });
      };
    });
    // WhatsApp: the agent sends queued commands; wait for its answer, then redraw (realtime brings the message row).
    var toast = function (m) { if (window.SSMPDToast && window.SSMPDToast.show) window.SSMPDToast.show(m); };
    function waOutcome(id, b) {
      if (b) b.textContent = "بيتبعت عن طريق الواتساب…";
      return waitOutbox(id).then(function (d) {
        if (d.status === "sent") toast("اتبعتت على واتساب");
        else if (d.status === "queued") toast("الرسالة لسه في الطابور — هتظهر أول ما الوكيل يبعتها");
        else alert(d.error || "الرسالة ما اتبعتتش");
        again();
      });
    }
    var waCmd = function (b, body, label) {
      b.disabled = true; var old = b.textContent; b.textContent = label;
      db().functions.invoke("meta-comments", { body: body }).then(function (r) {
        var d = r.data || {};
        if (r.error || !d.ok) return failText(r, "تعذر التنفيذ").then(function (m) { throw new Error(m); });
        return waOutcome(d.id, b);
      }).catch(function (e) { b.disabled = false; b.textContent = old; fail(e); });
    };
    q("[data-wa-load-tpl]").forEach(function (b) {
      b.onclick = function () {
        state.waTemplates = "loading"; redraw();
        db().functions.invoke("meta-comments", { body: { action: "list_templates" } }).then(function (r) {
          var d = r.data || {};
          if (r.error || !d.ok) throw new Error(d.error || "تعذر جلب القوالب");
          state.waTemplates = d.templates || [];
        }).catch(function (e) { state.waTemplates = null; fail(e); }).then(redraw);
      };
    });
    // Owner only: «+ قالب جديد» (queue a template for Meta's review) and «حالة القوالب».
    var loadReq = function () {
      state.waReq = "loading"; redraw();
      return db().functions.invoke("meta-comments", { body: { action: "wa_template_requests" } }).then(function (r) {
        var d = r.data || {};
        if (r.error || !d.ok) throw new Error(d.error || "تعذر جلب حالة القوالب");
        state.waReq = d.requests || [];
      }).catch(function (e) { state.waReq = null; fail(e); }).then(redraw);
    };
    q("[data-wa-req-load]").forEach(function (b) { b.onclick = loadReq; });
    q("[data-wa-new-tpl]").forEach(function (b) {
      b.onclick = function () { state.waForm = state.waForm ? null : { text: "", cat: "UTILITY" }; redraw(); };
    });
    q("[data-wa-form]").forEach(function (form) {
      var txt = form.querySelector("[data-wa-form-text]"), err = form.querySelector("[data-wa-form-err]");
      txt.oninput = function () {
        state.waForm.text = txt.value;
        form.querySelector("[data-wa-count]").textContent = txt.value.length + " / 1024";
        form.querySelector("[data-wa-preview]").textContent = txt.value || "معاينة الرسالة هتظهر هنا";
        err.hidden = true;
      };
      form.querySelectorAll('input[name="wa-cat"]').forEach(function (r) { r.onchange = function () { if (r.checked) state.waForm.cat = r.value; }; });
      form.querySelector("[data-wa-form-cancel]").onclick = function () { state.waForm = null; redraw(); };
      form.querySelector("[data-wa-form-send]").onclick = function (ev) {
        var f = state.waForm, bad = tplTextError(f.text);
        if (bad) { err.textContent = bad; err.hidden = false; return; }
        if (!confirm("تأكيد: تقديم القالب ده لميتا باسم حضرتك؟ بعد التقديم ميتا بتراجعه وممكن ترفضه.")) return;
        var b = ev.currentTarget; b.disabled = true; b.textContent = "بيتقدّم…";
        db().functions.invoke("meta-comments", { body: { action: "wa_template_submit", category: f.cat, text: f.text.trim() } }).then(function (r) {
          var d = r.data || {};
          if (r.error || !d.ok) throw new Error(d.error || "تعذر تقديم القالب");
          state.waForm = null; toast("القالب اتحط في الطابور — الوكيل بيقدّمه لميتا وبعدها بيبان «بانتظار مراجعة ميتا»");
          return loadReq();
        }).catch(function (e) { b.disabled = false; b.textContent = "تقديم لميتا"; err.textContent = e.message || "تعذر تقديم القالب"; err.hidden = false; });
      };
    });
    q("[data-wa-tpl]").forEach(function (b) {
      b.onclick = function () {
        var conv = b.closest("[data-wa-conv]").dataset.waConv;
        if (!confirm("تأكيد: إرسال القالب «" + b.dataset.waTpl + "» للعميل على واتساب؟")) return;
        waCmd(b, { action: "send_template", conversation_id: conv, name: b.dataset.waTpl, language: b.dataset.waLang }, "بيتبعت…");
      };
    });
    q("[data-wa-return]").forEach(function (b) {
      b.onclick = function () {
        if (!confirm("تأكيد: رجّع البوت يرد على العميل ده؟")) return;
        waCmd(b, { action: "return_to_bot", conversation_id: b.dataset.waReturn }, "بيرجّع البوت…");
      };
    });
    // «الليد» card: load (and keep fresh) the lead behind the open conversation, create one, open it in the leads module.
    var leadBox = container.querySelector("[data-cm-lead]");
    function paintLead(conv) {
      var box = container.querySelector('[data-cm-lead="' + (window.CSS && CSS.escape ? CSS.escape(conv) : conv) + '"]');
      if (!box) return;
      box.innerHTML = leadCard(conv);
      var o = box.querySelector("[data-lead-open]");
      if (o) o.onclick = function () {
        if (window.SSMPDRenderLeads && window.SSMPDRenderLeads.openLeadById) window.SSMPDRenderLeads.openLeadById(o.dataset.leadOpen);
        else alert("قسم الليدز مش متاح لحسابك");
      };
      var c = box.querySelector("[data-lead-create]");
      if (c) c.onclick = function () {
        var it = (state.leads[conv] || {}), wa = /^whatsapp:/.test(conv), phone = null;
        var name = (container.querySelector(".cm-info h3") || {}).textContent || "العميل";
        if (wa) { if (!confirm("تأكيد: اعمل ليد لـ «" + name + "» برقم الواتساب بتاعه؟")) return; }
        else { phone = prompt("تأكيد: اعمل ليد لـ «" + name + "»\nاكتب رقم تليفونه لو بعته في الشات (اختياري — من غيره الليد هيبقى «ناقص بيانات»):", ""); if (phone === null) return; }
        state.leads[conv] = { lead: null, busy: true }; paintLead(conv);
        db().rpc("social_conversation_lead_create", { p_conversation_id: conv, p_phone: phone || null, p_service: null }).then(function (r) {
          var d = r.data || {};
          if (r.error || !d.ok) throw new Error(d.error || (r.error && r.error.message) || "تعذر عمل الليد");
          state.leads[conv] = { lead: d.lead, at: Date.now() }; paintLead(conv); watchLead(conv);
          toast(d.existing ? "المحادثة اتربطت بليد مفتوح بنفس الرقم" : "اتعمل ليد واتوزع على خدمة العملاء");
        }).catch(function (e) { state.leads[conv] = it.lead !== undefined ? { lead: it.lead } : { lead: null }; paintLead(conv); fail(e); });
      };
    }
    function loadLead(conv) {
      var cur = state.leads[conv];
      state.leads[conv] = { lead: cur ? cur.lead : undefined, loading: true };
      if (!cur) paintLead(conv);
      return db().rpc("social_conversation_lead", { p_conversation_id: conv }).then(function (r) {
        if (r.error) throw r.error;
        state.leads[conv] = { lead: (r.data || {}).lead || null, at: Date.now() };
      }).catch(function () { state.leads[conv] = cur && cur.lead ? { lead: cur.lead } : { error: "ما قدرناش نجيب الليد دلوقتي" }; }).then(function () { paintLead(conv); watchLead(conv); });
    }
    // Live: realtime on the lead (roles that may read it) + a 30s refresh while the chat is open (inbox-only roles).
    function watchLead(conv) {
      var l = (state.leads[conv] || {}).lead, key = conv + "|" + (l ? l.id : "");
      if (state.leadWatch && state.leadWatch.key === key) return;
      stopLeadWatch();
      var w = state.leadWatch = { key: key, timer: setInterval(function () { if (container.querySelector('[data-cm-lead]')) loadLead(conv); else stopLeadWatch(); }, 30000) };
      var c = db();
      if (l && l.can_open && c.channel) {
        try {
          w.ch = c.channel("cm-lead-" + l.id)
            .on("postgres_changes", { event: "*", schema: "public", table: "leads", filter: "id=eq." + l.id }, function () { loadLead(conv); })
            .on("postgres_changes", { event: "*", schema: "public", table: "lead_attempts", filter: "lead_id=eq." + l.id }, function () { loadLead(conv); })
            .subscribe();
        } catch (e) { w.ch = null; }
      }
    }
    if (leadBox) {
      var lc = leadBox.dataset.cmLead, ls = state.leads[lc];
      paintLead(lc);
      if (ls && ls.at && Date.now() - ls.at < 15000) watchLead(lc); else loadLead(lc);
    } else stopLeadWatch();
    q("[data-ignore]").forEach(function (b) {
      b.onclick = function () { db().rpc("social_comment_ignore", { p_id: b.dataset.ignore }).then(function (r) { if (r.error) throw r.error; again(); }).catch(fail); };
    });
    q("[data-template]").forEach(function (b) {
      b.onclick = function () {
        if (!confirm("أي تعليق شبه ده هيترد عليه تلقائياً بنفس الرد من غير ما يستناك. موافق؟")) return;
        db().rpc("social_reply_template_add", { p_comment_id: b.dataset.template }).then(function (r) { if (r.error) throw r.error; again(); }).catch(fail);
      };
    });
    q("[data-ttoggle]").forEach(function (b) {
      b.onclick = function () {
        db().rpc("social_reply_template_set", { p_id: b.dataset.ttoggle, p_active: b.dataset.active !== "1", p_reply: null }).then(function (r) { if (r.error) throw r.error; again(); }).catch(fail);
      };
    });
    q("[data-tsave]").forEach(function (b) {
      b.onclick = function () {
        var text = b.closest(".cm-card").querySelector(".cm-input").value.trim();
        db().rpc("social_reply_template_set", { p_id: b.dataset.tsave, p_active: null, p_reply: text }).then(function (r) { if (r.error) throw r.error; again(); }).catch(fail);
      };
    });
  }

  // شارة على تاب "التعليقات": عدد المستني رد، وبتبقى حمرا لو فيه تعليق متأخر.
  function updateTabBadge(pending, overdue) {
    document.querySelectorAll('.tab-btn[data-tab="comments"]').forEach(function (btn) {
      var b = btn.querySelector(".cm-tab-badge");
      if (!pending) { if (b) b.remove(); return; }
      if (!b) { b = document.createElement("span"); b.className = "cm-tab-badge"; btn.appendChild(b); }
      b.textContent = pending;
      b.classList.toggle("late", overdue > 0);
      b.title = overdue ? overdue + " تعليق متأخر أكتر من ساعة" : pending + " تعليق مستني رد";
    });
  }
  function pollBadge() {
    if (document.hidden) return;
    if (!window.SSMPDDb || !window.SSMPDDb.client || !document.querySelector('.tab-btn[data-tab="comments"]')) return;
    // نفس اللي بيظهر في قسم "محتاج رد" بالظبط: تعليقات آخر ٦٠ يوم المستنية رد + التنبيهات المفتوحة.
    var since = new Date(Date.now() - 60 * 864e5).toISOString();
    var base = function () {
      return db().from("social_comments").select("id", { count: "exact", head: true })
        .in("status", ["new", "drafted", "failed"]).eq("author_is_page", false).is("parent_comment_id", null).gte("commented_at", since);
    };
    var overdueFrom = new Date(Date.now() - 7 * 864e5).toISOString();
    var overdueTo = new Date(Date.now() - OVERDUE_MIN * 60000).toISOString();
    // عدّ بس (head) بدل تنزيل ٥٠٠ صف كل دقيقة — نفس الأرقام بحجم شبكة ~صفر.
    Promise.all([
      base(),
      base().gte("commented_at", overdueFrom).lte("commented_at", overdueTo),
      db().from("social_comments").select("id", { count: "exact", head: true }).eq("alert", true).is("alert_resolved_at", null),
      db().from("social_messages").select("conversation_id").eq("alert", true).is("alert_resolved_at", null).limit(200)
    ]).then(function (r) {
      var pending = r[0].error ? 0 : (r[0].count || 0);
      var overdue = r[1].error ? 0 : (r[1].count || 0);
      var alerts = (r[2].error ? 0 : (r[2].count || 0)) + (r[3].error ? 0 : Object.keys((r[3].data || []).reduce(function (m, x) { m[x.conversation_id] = 1; return m; }, {})).length);
      updateTabBadge(pending + alerts, overdue + alerts);
    }).catch(function () { updateTabBadge(0, 0); });
  }
  setTimeout(pollBadge, 4000);
  setInterval(pollBadge, 60000);
  document.addEventListener("visibilitychange", function () { if (!document.hidden) pollBadge(); });

  window.SSMPDRenderComments = { render: render };
})();
