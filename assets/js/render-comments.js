/* SSMPD — تاب التعليقات: تعليقات فيسبوك/انستجرام على البوستات المنشورة من الداشبورد + الردود المعتمدة */
(function () {
  "use strict";

  var state = { filter: "pending", brand: "", section: "inbox" };
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
    var pendingCount = top.filter(function (c) { return ["new", "drafted", "failed"].indexOf(c.status) !== -1; }).length;

    var list = top.filter(function (c) {
      if (state.brand && c.brand !== state.brand) return false;
      if (state.filter === "pending") return ["new", "drafted", "failed", "approved", "sending"].indexOf(c.status) !== -1;
      if (state.filter === "replied") return c.status === "replied";
      if (state.filter === "ignored") return c.status === "ignored";
      return true;
    });

    var html = '<div class="cm-head"><div><h2>التعليقات</h2><p class="muted">تعليقات فيسبوك وانستجرام على البوستات اللي اتنشرت من الداشبورد — بتتحدث كل ٥ دقايق.</p></div>' +
      '<button class="btn ghost sm" id="cm-refresh">تحديث</button></div>' +
      '<div class="cm-tabs">' +
      '<button class="btn sm ' + (state.section === "inbox" ? "" : "ghost") + '" data-section="inbox">التعليقات' + (pendingCount ? ' <span class="cm-count">' + pendingCount + "</span>" : "") + "</button>" +
      '<button class="btn sm ' + (state.section === "templates" ? "" : "ghost") + '" data-section="templates">الردود المعتمدة (' + data.templates.length + ")</button></div>";

    if (state.section === "templates") html += templatesHtml(data.templates);
    else {
      html += '<div class="cm-filters">' +
        select("cm-filter", state.filter, { pending: "محتاج رد", replied: "تم الرد", ignored: "متجاهل", all: "الكل" }) +
        select("cm-brand", state.brand, { "": "كل الصفحات", sono: "سونو", dr_dina: "د. دينا" }) + "</div>";
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
      '<span class="muted cm-post">على: ' + esc(title) + "</span></div>" +
      '<div class="cm-msg"><b>' + esc(c.author_name || "مستخدم") + '</b> <span class="muted">' + when(c.commented_at) + "</span><p>" + esc(c.message) + "</p></div>";
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
      h += '<textarea class="cm-input" rows="3" placeholder="اكتب الرد…">' + esc(c.suggested_reply || "") + "</textarea>" +
        '<div class="cm-actions"><button class="btn btn-primary sm" data-approve="' + esc(c.id) + '">اعتمد وانشر</button>' +
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
    var refresh = container.querySelector("#cm-refresh"); if (refresh) refresh.onclick = again;
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

  window.SSMPDRenderComments = { render: render };
})();
