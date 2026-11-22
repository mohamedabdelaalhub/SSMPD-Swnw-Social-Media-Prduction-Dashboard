/* SSMPD — تاب التعليقات: تعليقات فيسبوك/انستجرام على البوستات المنشورة من الداشبورد + الردود المعتمدة */
(function () {
  "use strict";

  var state = { filter: "pending", brand: "", platform: "", section: "inbox", mfilter: "all", q: "", category: "", postRef: "", open: { inbox: "", messages: "" }, info: true, sheet: false, drafts: {} };
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
  function alertList(data) {
    var out = [];
    data.comments.forEach(function (c) { if (c.alert && !c.alert_resolved_at) out.push({ kind: "comment", id: c.id, platform: c.platform, brand: c.brand, who: c.author_name, text: c.message, reply: c.final_reply, at: c.commented_at, url: c.comment_url, category: c.category }); });
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
        '<div class="cm-msg"><b>' + esc(a.who || "مستخدم") + '</b> <span class="muted">' + when(a.at) + " · " + ago(a.at) + "</span>" +
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
      return { key: "c:" + c.id, kind: "comment", c: c, thread: thread, name: c.author_name || "مستخدم", platform: c.platform, brand: c.brand,
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
        pending: waiting > 0, unread: waiting, status: lastCust.status, at: c.last.sent_at, preview: (lastShown.is_page ? "أنت: " : "") + (lastShown.message || ""),
        sensitive: !!(lastCust.alert && !lastCust.alert_resolved_at), url: c.last.conversation_url,
        open24: !!lastCust.sent_at && Date.now() - new Date(lastCust.sent_at).getTime() <= WINDOW_MS,
        search: [lastCust.sender_name].concat(c.list.map(function (m) { return m.message; })).join(" ").toLowerCase() };
    }).filter(function (it) {
      var q = state.q.trim().toLowerCase();
      if (q && it.search.indexOf(q) < 0) return false;
      if (state.mfilter === "new") return it.pending;
      if (state.mfilter === "done") return !it.pending;
      return true;
    });
  }
  function avatar(it) {
    var p = it.platform;
    return '<span class="cm-av cm-av-' + esc(p) + '" aria-hidden="true">' + esc(initial(it.name)) + '<i class="cm-av-pl">' + (p === "facebook" ? "f" : p === "instagram" ? "◎" : p === "whatsapp" ? "✆" : "") + "</i></span>";
  }
  function convCard(it, open) {
    return '<button type="button" class="cm-conv' + (open ? " on" : "") + (it.sensitive ? " sensitive" : "") + '" data-open-conv="' + esc(it.key) + '" aria-pressed="' + open + '"' + (it.kind === "comment" ? ' data-id="' + esc(it.c.id) + '"' : "") + ">" + avatar(it) +
      '<span class="cm-conv-mid"><span class="cm-conv-name"><b>' + esc(it.name) + '</b><span class="cm-conv-brand">' + esc(BRANDS[it.brand] || it.brand || "") + "</span></span>" +
      '<span class="cm-conv-prev">' + esc(String(it.preview || "").split("\n")[0]) + "</span></span>" +
      '<span class="cm-conv-end"><span class="cm-conv-time">' + esc(listWhen(it.at)) + "</span>" +
      (it.pending ? '<span class="cm-conv-unread" title="محتاج رد">' + (it.unread || 1) + "</span>" : '<span class="cm-conv-done" aria-hidden="true"></span>') + "</span></button>";
  }
  function bubble(side, text, at, who, extraCls) {
    return '<div class="cm-b ' + side + (extraCls ? " " + extraCls : "") + '">' + (who ? '<span class="cm-b-who">' + esc(who) + "</span>" : "") + "<p>" + rich(text) + "</p><time>" + esc(tm(at)) + "</time></div>";
  }
  function withDays(items) {
    var out = "", prev = "";
    items.forEach(function (x) { if (x.at) { var k = dkey(x.at); if (k !== prev) { out += '<div class="cm-day">' + esc(dayName(x.at)) + "</div>"; prev = k; } } out += x.html; });
    return out;
  }
  function staffName(id, data) { if (!id) return ""; var me = window.SSMPDAuth && window.SSMPDAuth.currentAdmin; return me && me.id === id ? "أنت" : (data.staff[id] || "موظف"); }
  function commentChat(it, data) {
    var c = it.c, items = [{ at: c.commented_at, html: bubble("them", c.message, c.commented_at) }];
    it.thread.forEach(function (r) { items.push({ at: r.commented_at, html: r.author_is_page ? bubble("me", r.message, r.commented_at, "الصفحة") : bubble("them", r.message, r.commented_at, r.author_name || "مستخدم") }); });
    if (c.status === "replied" && c.final_reply && !it.thread.some(function (r) { return r.author_is_page && r.message === c.final_reply; }))
      items.push({ at: c.replied_at, html: bubble("me", c.final_reply, c.replied_at, c.handled_by ? staffName(c.handled_by, data) : "رد تلقائي", c.handled_by ? "" : "auto") });
    items.sort(function (a, b) { return new Date(a.at) - new Date(b.at); });
    var canAnswer = ["new", "drafted", "failed"].indexOf(c.status) !== -1;
    var foot = c.status === "failed" && c.last_error ? '<div class="err-msg">' + esc(c.last_error) + "</div>" : "";
    if (canAnswer) foot += '<div class="cm-composer"><textarea class="cm-input" rows="2" data-draft="' + esc(it.key) + '" placeholder="اكتب الرد على التعليق…">' + esc(state.drafts[it.key] != null ? state.drafts[it.key] : (c.suggested_reply || "")) + "</textarea>" +
      '<div class="cm-composer-row"><span class="cm-hint">بيانات الحجز (العنوان + التليفون + الواتساب) بتتضاف لوحدها في آخر الرد لو مش موجودة.</span>' +
      '<button type="button" class="btn ghost sm" data-suggest="' + esc(c.id) + '">✨ ' + (c.suggested_reply ? "اقترح رد تاني" : "اقترح رد") + "</button>" +
      '<button type="button" class="btn ghost sm" data-ignore="' + esc(c.id) + '">تجاهل</button>' +
      '<button type="button" class="btn sm cm-send" data-approve="' + esc(c.id) + '">اعتمد وانشر</button></div></div>';
    else if (c.status === "approved" || c.status === "sending") foot += '<div class="cm-closed">الرد في الطريق للنشر…</div>';
    else if (c.status === "ignored") foot += '<div class="cm-closed">التعليق ده اتجاهل.</div>';
    return '<div class="cm-msgs" data-cm-msgs><div class="cm-post-ref"><span class="cm-post-thumb" aria-hidden="true"></span><span><small>تعليق على بوست</small><b>' + esc(it.post) + "</b></span></div>" + withDays(items) + "</div>" + foot;
  }
  function messageChat(it, data) {
    var c = it.conv, items = [];
    c.list.forEach(function (m) {
      var sys = m.is_page && sysText(m.message);
      if (sys) { items.push({ at: m.sent_at, html: '<div class="cm-sys">' + esc(sys) + " · " + esc(tm(m.sent_at)) + "</div>" }); return; }
      items.push({ at: m.sent_at, html: m.is_page ? bubble("me", m.message, m.sent_at, m.sent_by ? staffName(m.sent_by, data) : "الصفحة") : bubble("them", m.message, m.sent_at) });
    });
    var lc = it.lastCust;
    if (lc.status === "replied" && lc.reply_text && !c.list.some(function (m) { return m.is_page && new Date(m.sent_at) >= new Date(lc.sent_at); }))
      items.push({ at: lc.replied_at, html: bubble("me", lc.reply_text, lc.replied_at, lc.sent_by ? staffName(lc.sent_by, data) : "رد تلقائي", lc.sent_by ? "" : "auto") });
    var foot = lc.status === "failed" && lc.last_error ? '<div class="err-msg">' + esc(lc.last_error) + "</div>" : "";
    if (it.platform !== "facebook" && it.platform !== "instagram") foot += '<div class="cm-closed">الرد على ' + esc(PLAT[it.platform] || it.platform) + " بيكون من التطبيق نفسه" + (it.url ? ' — <a href="' + esc(it.url) + '" target="_blank" rel="noopener">افتح المحادثة ↗</a>' : "") + ".</div>";
    else if (!it.open24) foot += '<div class="cm-closed" data-window-closed>' + WINDOW_NOTE + (it.url ? ' — <a href="' + esc(it.url) + '" target="_blank" rel="noopener">افتح المحادثة على ميتا ↗</a>' : "") + "</div>";
    else foot += '<div class="cm-composer"><textarea class="cm-input" rows="2" data-draft="' + esc(it.key) + '" placeholder="اكتب رسالة…">' + esc(state.drafts[it.key] || "") + "</textarea>" +
      '<div class="cm-composer-row"><span class="cm-hint">ميتا بتسمح بالرد خلال 24 ساعة من آخر رسالة من العميل.</span>' +
      '<button type="button" class="btn ghost sm" data-msuggest="' + esc(c.id) + '">✨ اقترح رد</button>' +
      '<button type="button" class="btn sm cm-send" data-msend="' + esc(c.id) + '">إرسال</button></div></div>';
    return '<div class="cm-msgs" data-cm-msgs>' + withDays(items) + "</div>" + foot;
  }
  function infoHtml(it, data) {
    var isC = it.kind === "comment", stLabel = isC ? (STATUS[it.status] || it.status) : (MSTATUS[it.status] || it.status), cat = isC ? it.c.category : it.lastCust.category;
    var first = isC ? it.c.commented_at : (it.conv.list[0] || {}).sent_at;
    var h = '<div class="cm-info">' + avatar(it) + "<h3>" + esc(it.name) + '</h3><p class="cm-info-sub">' + esc(platLabel(it.kind, it.platform)) + " · " + esc(BRANDS[it.brand] || it.brand || "") + "</p>";
    if (it.url) h += '<a class="btn ghost sm cm-open" href="' + esc(it.url) + '" target="_blank" rel="noopener">' + (it.platform === "whatsapp" ? "كلّمه على واتساب" : isC ? "افتح التعليق" : "افتح المحادثة") + " ↗</a>";
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
      '<span class="cm-badge st-' + esc(it.status) + '">' + esc(isC ? (STATUS[it.status] || it.status) : (MSTATUS[it.status] || it.status)) + "</span>" +
      (it.url ? '<a class="cm-ibtn" href="' + esc(it.url) + '" target="_blank" rel="noopener" title="افتح على ميتا" aria-label="افتح على ميتا">↗</a>' : "") +
      '<button type="button" class="cm-ibtn" data-cm-info aria-label="بيانات العميل" aria-pressed="' + state.info + '">ⓘ</button></div>' + (isC ? commentChat(it, data) : messageChat(it, data))
      : '<div class="cm-chat-empty"><b>اختار ' + (isC ? "تعليق" : "محادثة") + " من القايمة</b><p>هتفتح هنا زي شات واتساب.</p></div>";
    var showInfo = it && (state.info || state.sheet);
    return (isC ? "" : '<p class="muted cm-messages-intro">رسايل ماسنجر وانستجرام دايركت. تقدر ترد من هنا خلال 24 ساعة من آخر رسالة من العميل.</p>') +
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
      '<div class="cm-msg"><b>' + link(c.author_url, esc(c.author_name || "مستخدم")) + '</b> <span class="muted">' + when(c.commented_at) + " · " + ago(c.commented_at) + "</span>" +
      (c.comment_url ? ' <a class="cm-open" href="' + esc(c.comment_url) + '" target="_blank" rel="noopener">افتح على ' + (c.platform === "facebook" ? "فيسبوك" : "انستجرام") + " ↗</a>" : "") +
      "<p>" + rich(c.message) + "</p></div>";
    thread.forEach(function (r) {
      h += '<div class="cm-reply' + (r.author_is_page ? " page" : "") + '"><b>' + esc(r.author_is_page ? "رد الصفحة" : (r.author_name || "مستخدم")) + "</b> <span class=\"muted\">" + when(r.commented_at) + "</span><p>" + rich(r.message) + "</p></div>";
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
          if (r.error || !d.ok) throw new Error(d.message || d.error || "تعذر إرسال الرسالة");
          state.drafts["m:" + b.dataset.msend] = "";
          if (window.SSMPDToast && window.SSMPDToast.show) window.SSMPDToast.show("اتبعتت الرسالة");
          again();
        }).catch(function (e) { b.disabled = false; b.textContent = "إرسال"; fail(e); });
      };
    });
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
