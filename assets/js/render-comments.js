/* SSMPD — تاب التعليقات: تعليقات فيسبوك/انستجرام على البوستات المنشورة من الداشبورد + الردود المعتمدة */
(function () {
  "use strict";

  var state = { filter: "pending", brand: "", platform: "", section: "inbox" };
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
    try { return new Date(d).toLocaleString("ar-EG", { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" }); } catch (e) { return ""; }
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
  function link(url, text) { return url ? '<a href="' + esc(url) + '" target="_blank" rel="noopener">' + text + "</a>" : text; }

  function load() {
    return Promise.all([
      db().from("social_comments").select("*").order("commented_at", { ascending: false }).limit(400),
      db().from("social_reply_templates").select("*").order("created_at", { ascending: false }),
      db().from("content_items").select("id,title")
    ]).then(function (r) {
      if (r[0].error) throw r[0].error;
      return { comments: r[0].data || [], templates: r[1].data || [], titles: (r[2].data || []).reduce(function (m, c) { m[c.id] = c.title; return m; }, {}) };
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
    var pendingCount = top.filter(isPending).length;
    var overdueCount = top.filter(isOverdue).length;
    updateTabBadge(pendingCount, overdueCount);

    var list = top.filter(function (c) {
      if (state.brand && c.brand !== state.brand) return false;
      if (state.platform && c.platform !== state.platform) return false;
      if (state.filter === "pending") return ["new", "drafted", "failed", "approved", "sending"].indexOf(c.status) !== -1;
      if (state.filter === "replied") return c.status === "replied";
      if (state.filter === "ignored") return c.status === "ignored";
      return true;
    });

    var html = '<div class="cm-head"><div><h2>التعليقات</h2><p class="muted">تعليقات فيسبوك وانستجرام على البوستات اللي اتنشرت من الداشبورد — بتتحدث كل ٥ دقايق.</p></div>' +
      '<button class="btn ghost sm" id="cm-refresh">اسحب التعليقات الجديدة دلوقتي</button></div>' +
      '<div class="cm-tabs">' +
      '<button class="btn sm ' + (state.section === "inbox" ? "" : "ghost") + '" data-section="inbox">التعليقات' + (pendingCount ? ' <span class="cm-count">' + pendingCount + "</span>" : "") + "</button>" +
      '<button class="btn sm ' + (state.section === "templates" ? "" : "ghost") + '" data-section="templates">الردود المعتمدة (' + data.templates.length + ")</button></div>";

    if (overdueCount && state.section !== "templates") html += '<div class="cm-alert">⚠️ فيه ' + overdueCount + ' تعليق مستني رد من أكتر من ساعة — الرد السريع بيفرق مع الناس.</div>';
    if (state.section === "templates") html += templatesHtml(data.templates);
    else {
      html += '<div class="cm-filters">' +
        select("cm-filter", state.filter, { pending: "محتاج رد", replied: "تم الرد", ignored: "متجاهل", all: "الكل" }) +
        select("cm-brand", state.brand, { "": "كل الصفحات", sono: "سونو", dr_dina: "د. دينا" }) +
        select("cm-platform", state.platform, { "": "فيسبوك وانستجرام", facebook: "فيسبوك بس", instagram: "انستجرام بس" }) + "</div>";
      html += list.length ? list.map(function (c) { return card(c, byParent[c.platform_comment_id] || [], data); }).join("")
        : '<div class="empty">مفيش تعليقات هنا دلوقتي.</div>';
    }
    container.innerHTML = '<div class="cm-wrap" dir="rtl">' + html + "</div>";
    wire(container, data);
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
      "<p>" + esc(c.message) + "</p></div>";
    thread.forEach(function (r) {
      h += '<div class="cm-reply' + (r.author_is_page ? " page" : "") + '"><b>' + esc(r.author_is_page ? "رد الصفحة" : (r.author_name || "مستخدم")) + "</b> <span class=\"muted\">" + when(r.commented_at) + "</span><p>" + esc(r.message) + "</p></div>";
    });
    if (c.status === "replied" && c.final_reply) {
      h += '<div class="cm-reply page"><b>ردنا</b> <span class="muted">' + when(c.replied_at) + "</span><p>" + esc(c.final_reply) + "</p></div>";
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
        var box = b.closest(".cm-card").querySelector(".cm-input");
        b.disabled = true; var label = b.textContent; b.textContent = "بيكتب رد…";
        db().functions.invoke("meta-comments", { body: { action: "suggest", id: b.dataset.suggest } }).then(function (r) {
          var d = r.data || {};
          if (r.error || !d.ok) throw new Error(d.error || "تعذر اقتراح رد");
          box.value = d.text; box.focus();
        }).catch(fail).then(function () { b.disabled = false; b.textContent = label; });
      };
    });
    q("[data-section]").forEach(function (b) { b.onclick = function () { state.section = b.dataset.section; draw(container, data); }; });
    var f = container.querySelector("#cm-filter"); if (f) f.onchange = function () { state.filter = f.value; draw(container, data); };
    var br = container.querySelector("#cm-brand"); if (br) br.onchange = function () { state.brand = br.value; draw(container, data); };
    q("[data-approve]").forEach(function (b) {
      b.onclick = function () {
        var text = b.closest(".cm-card").querySelector(".cm-input").value.trim();
        if (!text) return alert("اكتب الرد الأول");
        b.disabled = true;
        db().rpc("social_comment_approve", { p_id: b.dataset.approve, p_reply: text }).then(function (r) {
          if (r.error) throw r.error;
          return db().functions.invoke("meta-comments", { body: { id: b.dataset.approve } });
        }).then(again).catch(function (e) { b.disabled = false; fail(e); });
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
    if (!window.SSMPDDb || !window.SSMPDDb.client || !document.querySelector('.tab-btn[data-tab="comments"]')) return;
    db().from("social_comments").select("commented_at,status,author_is_page,parent_comment_id")
      .in("status", ["new", "drafted", "failed"]).eq("author_is_page", false).is("parent_comment_id", null).limit(500)
      .then(function (r) { if (r.error) return; var rows = r.data || []; updateTabBadge(rows.length, rows.filter(isOverdue).length); });
  }
  setTimeout(pollBadge, 4000);
  setInterval(pollBadge, 120000);

  window.SSMPDRenderComments = { render: render };
})();
