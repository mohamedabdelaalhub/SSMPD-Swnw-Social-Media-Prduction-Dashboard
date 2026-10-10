/* SSMPD — تاب "تحديث بيانات الشات بوت": البيانات اللي وكيل الواتساب بيرد منها (مواعيد، دفع، عروض، أسئلة شائعة…).
   أي تعديل هنا بيوصل للوكيل خلال دقايق (Edge Function clinic-knowledge). جهات التعاقد بتتقري من تابها. */
(function () {
  "use strict";

  var DAYS = [["sat", "سبت"], ["sun", "أحد"], ["mon", "إتنين"], ["tue", "تلات"], ["wed", "أربع"], ["thu", "خميس"], ["fri", "جمعة"]];
  var PAYMENTS = ["كاش", "فيزا / ماستركارد", "ميزة", "إنستاباي", "فودافون كاش", "محافظ إلكترونية تانية", "تقسيط"];
  var state = { section: "profile", editing: false };
  var LIST_SECTIONS = ["hours", "offers", "faqs"];

  function db() { return window.SSMPDDb.client; }
  function esc(s) { return String(s == null ? "" : s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;"); }
  function toast(msg) { if (window.SSMPDToast && window.SSMPDToast.show) window.SSMPDToast.show(msg); else alert(msg); }
  function fail(e) { alert((e && e.message) || "حصل خطأ"); }
  function q(c, s) { return c.querySelector(s); }
  function qa(c, s) { return Array.prototype.slice.call(c.querySelectorAll(s)); }
  function hhmm(t) { return t ? String(t).slice(0, 5) : ""; }

  function load() {
    return Promise.all([
      db().from("clinic_profile").select("*").eq("id", 1).maybeSingle(),
      db().from("clinic_hours").select("*").order("sort").order("department"),
      db().from("clinic_offers").select("*").order("updated_at", { ascending: false }),
      db().from("clinic_faqs").select("*").order("sort").order("updated_at"),
      db().from("contracting_entity_contracts").select("entity_id,status,discount_percent,services,end_date"),
      db().from("contracting_entities").select("id,name")
    ]).then(function (r) {
      if (r[0].error) throw r[0].error;
      var names = {}; (r[5].data || []).forEach(function (e) { names[e.id] = e.name; });
      return {
        profile: r[0].data || { id: 1 }, hours: r[1].data || [], offers: r[2].data || [], faqs: r[3].data || [],
        contracts: (r[4].data || []).filter(function (c) { return c.status === "active"; }).map(function (c) { return Object.assign({ name: names[c.entity_id] || "—" }, c); })
      };
    });
  }

  function render(container) {
    container.innerHTML = '<div class="loading">بيحمّل…</div>';
    load().then(function (data) { draw(container, data); }).catch(function (e) {
      container.innerHTML = '<div class="err-msg">' + (/permission|does not exist/i.test(e.message || "") ? "مش متاح لحسابك." : "خطأ: " + esc(e.message)) + "</div>";
    });
  }

  var SECTIONS = [["profile", "بيانات المركز"], ["hours", "مواعيد العمل"], ["payment", "الدفع والخدمات"], ["offers", "العروض"], ["faqs", "أسئلة شائعة"], ["contracts", "جهات التعاقد"], ["notes", "تعليمات للوكيل"]];

  function draw(container, data) {
    var html = '<div class="ci-wrap" dir="rtl"><div class="cm-head"><div><h2>تحديث بيانات الشات بوت</h2>' +
      '<p class="muted">البيانات اللي وكيل الواتساب بيرد منها على العملاء. أي تعديل بتحفظه هنا بيوصل للوكيل خلال دقايق.</p></div></div>' +
      '<div class="cm-tabs">' + SECTIONS.map(function (s) {
        return '<button class="btn sm ' + (state.section === s[0] ? "" : "ghost") + '" data-sec="' + s[0] + '">' + s[1] + "</button>";
      }).join("") + "</div>";
    var p = data.profile;
    var editable = state.section !== "contracts";
    var headHtml = html, tb = "";
    html = "";
    if (editable) {
      tb = '<div style="float:left;margin:0 0 8px 8px;">' + (state.editing
        ? '<button class="btn ghost sm" data-cancel-edit>' + (LIST_SECTIONS.indexOf(state.section) !== -1 ? "تم" : "إلغاء") + "</button>"
        : '<button class="btn btn-primary sm" data-edit>تعديل</button>') + "</div>";
    }
    if (editable && !state.editing) {
      html += viewSection(state.section, data);
    } else if (state.section === "profile") {
      html += '<div class="ci-card">' +
        field("address", "العنوان", p.address) + field("maps_url", "لينك اللوكيشن (جوجل ماب)", p.maps_url, "url") +
        '<div class="ci-row">' + field("phone", "تليفون المركز", p.phone) + field("whatsapp", "واتساب", p.whatsapp) + "</div>" +
        '<div class="ci-row">' + field("email", "الإيميل", p.email, "email") + field("website", "الموقع", p.website, "url") + "</div>" +
        area("directions_notes", "إزاي توصل / ركن العربيات / علامات مميزة", p.directions_notes) +
        saveBtn() + "</div>";
    } else if (state.section === "payment") {
      var pm = p.payment_methods || [];
      html += '<div class="ci-card"><label class="ci-label">طرق الدفع المتاحة</label><div class="ci-chips">' +
        PAYMENTS.map(function (m) { return '<label class="ci-chip"><input type="checkbox" data-pay value="' + esc(m) + '"' + (pm.indexOf(m) !== -1 ? " checked" : "") + "> " + esc(m) + "</label>"; }).join("") +
        "</div>" + area("payment_notes", "ملاحظات الدفع (مثلاً: التقسيط على أنهي خدمات)", p.payment_notes) +
        area("home_visits", "الكشف / التحاليل المنزلية (متاحة؟ في أنهي مناطق؟ إزاي تتحجز؟)", p.home_visits) +
        area("results_notes", "نتايج التحاليل والأشعة (بتطلع امتى؟ بتتبعت إزاي؟)", p.results_notes) +
        area("booking_policy", "سياسة الحجز والإلغاء والتأجيل", p.booking_policy) + saveBtn() + "</div>";
    } else if (state.section === "notes") {
      html += '<div class="ci-card">' + area("agent_notes", "تعليمات الإدارة للوكيل (أي حاجة عايز الوكيل يلتزم بيها، مثلاً: متقولش سعر تحليل معيّن، أو وجّه أسئلة التجميل لرقم كذا)", p.agent_notes, 8) + saveBtn() + "</div>";
    } else if (state.section === "hours") {
      html += '<p class="muted">مواعيد كل قسم (المركز، المعمل، الأشعة، الصيدلية…). مواعيد الدكاترة نفسهم بتيجي من شيت الحجز.</p>' +
        data.hours.map(hourRow).join("") + hourRow({}) ;
    } else if (state.section === "offers") {
      html += data.offers.map(offerRow).join("") + offerRow({ active: true });
    } else if (state.section === "faqs") {
      html += '<p class="muted">أسئلة بتتكرر وإجابتها المعتمدة — الوكيل بيستخدم الإجابة دي بالظبط.</p>' + data.faqs.map(faqRow).join("") + faqRow({ active: true });
    } else if (state.section === "contracts") {
      html += '<p class="muted">الوكيل بيعرف جهات التعاقد السارية من تاب <b>جهات التعاقد</b> تلقائياً (الاسم + نسبة الخصم + الخدمات بس). للتعديل افتح التاب ده.</p>' +
        (data.contracts.length ? '<table class="ci-table"><tr><th>الجهة</th><th>الخصم</th><th>الخدمات</th></tr>' + data.contracts.map(function (c) {
          return "<tr><td>" + esc(c.name) + "</td><td>" + (c.discount_percent ? esc(c.discount_percent) + "%" : "—") + "</td><td>" + esc(c.services || "—") + "</td></tr>";
        }).join("") + "</table>" : '<div class="empty">مفيش عقود سارية.</div>');
    }
    if (tb) {
      var inserted = false;
      html = html.replace(/<div class="ci-card[^"]*"[^>]*>/, function (m) { inserted = true; return m + tb; });
      if (!inserted) html = tb + html;
    }
    container.innerHTML = headHtml + html + "</div>";
    wire(container, data);
  }

  function vrow(label, value) {
    return '<div class="field ci-field"><label>' + label + '</label><div style="white-space:pre-wrap;">' + (value ? esc(value) : '<span class="muted">—</span>') + "</div></div>";
  }
  function viewSection(sec, data) {
    var p = data.profile;
    if (sec === "profile") {
      return '<div class="ci-card">' + vrow("العنوان", p.address) + vrow("لينك اللوكيشن (جوجل ماب)", p.maps_url) +
        '<div class="ci-row">' + vrow("تليفون المركز", p.phone) + vrow("واتساب", p.whatsapp) + "</div>" +
        '<div class="ci-row">' + vrow("الإيميل", p.email) + vrow("الموقع", p.website) + "</div>" +
        vrow("إزاي توصل / ركن العربيات / علامات مميزة", p.directions_notes) + "</div>";
    }
    if (sec === "payment") {
      var pm = p.payment_methods || [];
      return '<div class="ci-card">' + vrow("طرق الدفع المتاحة", pm.join("، ")) + vrow("ملاحظات الدفع", p.payment_notes) +
        vrow("الكشف / التحاليل المنزلية", p.home_visits) + vrow("نتايج التحاليل والأشعة", p.results_notes) +
        vrow("سياسة الحجز والإلغاء والتأجيل", p.booking_policy) + "</div>";
    }
    if (sec === "notes") return '<div class="ci-card">' + vrow("تعليمات الإدارة للوكيل", p.agent_notes) + "</div>";
    if (sec === "hours") {
      var names = {}; DAYS.forEach(function (d) { names[d[0]] = d[1]; });
      return data.hours.length ? data.hours.map(function (h) {
        var when = h.closed ? "مقفول" : hhmm(h.open_time) + " – " + hhmm(h.close_time);
        return '<div class="ci-card">' + vrow(h.department || "—", (h.days || []).map(function (d) { return names[d] || d; }).join("، ") + " | " + when + (h.notes ? " | " + h.notes : "")) + "</div>";
      }).join("") : '<div class="empty">لسه مفيش مواعيد مسجلة.</div>';
    }
    if (sec === "offers") {
      return data.offers.length ? data.offers.map(function (o) {
        return '<div class="ci-card">' + vrow((o.active === false ? "[متوقف] " : "") + (o.title || "—"), [o.price_text, o.details, (o.starts_on || o.ends_on) ? "من " + (o.starts_on || "—") + " إلى " + (o.ends_on || "—") : ""].filter(Boolean).join("\n")) + "</div>";
      }).join("") : '<div class="empty">لسه مفيش عروض.</div>';
    }
    return '<p class="muted">أسئلة بتتكرر وإجابتها المعتمدة — الوكيل بيستخدم الإجابة دي بالظبط.</p>' + (data.faqs.length ? data.faqs.map(function (f) {
      return '<div class="ci-card">' + vrow((f.active === false ? "[متوقف] " : "") + (f.question || "—"), f.answer) + "</div>";
    }).join("") : '<div class="empty">لسه مفيش أسئلة.</div>');
  }

  function field(name, label, value, type) {
    return '<div class="field ci-field"><label>' + label + '</label><input data-f="' + name + '" type="' + (type || "text") + '" value="' + esc(value) + '"></div>';
  }
  function area(name, label, value, rows) {
    return '<div class="field ci-field"><label>' + label + '</label><textarea data-f="' + name + '" rows="' + (rows || 3) + '">' + esc(value) + "</textarea></div>";
  }
  function saveBtn() { return '<div class="cm-actions"><button class="btn btn-primary sm" data-save-profile>حفظ</button></div>'; }

  function hourRow(h) {
    var days = h.days || [];
    return '<div class="ci-card ci-item" data-hour="' + esc(h.id || "") + '">' +
      '<div class="ci-row">' + '<div class="field ci-field"><label>القسم</label><input data-k="department" placeholder="مثلاً: المركز / المعمل / الأشعة" value="' + esc(h.department) + '"></div>' +
      '<div class="field ci-field ci-small"><label>من</label><input data-k="open_time" type="time" value="' + hhmm(h.open_time) + '"></div>' +
      '<div class="field ci-field ci-small"><label>لـ</label><input data-k="close_time" type="time" value="' + hhmm(h.close_time) + '"></div></div>' +
      '<div class="ci-chips">' + DAYS.map(function (d) { return '<label class="ci-chip"><input type="checkbox" data-day value="' + d[0] + '"' + (days.indexOf(d[0]) !== -1 ? " checked" : "") + "> " + d[1] + "</label>"; }).join("") +
      '<label class="ci-chip"><input type="checkbox" data-k="closed"' + (h.closed ? " checked" : "") + "> مقفول الأيام دي</label></div>" +
      '<div class="field ci-field"><label>ملاحظة (اختياري)</label><input data-k="notes" value="' + esc(h.notes) + '"></div>' +
      '<div class="cm-actions"><button class="btn btn-primary sm" data-save-hour>' + (h.id ? "حفظ" : "إضافة") + "</button>" +
      (h.id ? '<button class="btn ghost sm" data-del="clinic_hours|' + h.id + '">حذف</button>' : "") + "</div></div>";
  }
  function offerRow(o) {
    return '<div class="ci-card ci-item" data-offer="' + esc(o.id || "") + '">' +
      '<div class="ci-row"><div class="field ci-field"><label>اسم العرض</label><input data-k="title" value="' + esc(o.title) + '"></div>' +
      '<div class="field ci-field ci-small"><label>السعر / الخصم</label><input data-k="price_text" placeholder="مثلاً: 300 جنيه بدل 500" value="' + esc(o.price_text) + '"></div></div>' +
      '<div class="field ci-field"><label>التفاصيل</label><textarea data-k="details" rows="2">' + esc(o.details) + "</textarea></div>" +
      '<div class="ci-row"><div class="field ci-field ci-small"><label>يبدأ</label><input data-k="starts_on" type="date" value="' + esc(o.starts_on) + '"></div>' +
      '<div class="field ci-field ci-small"><label>ينتهي</label><input data-k="ends_on" type="date" value="' + esc(o.ends_on) + '"></div>' +
      '<label class="ci-chip"><input type="checkbox" data-k="active"' + (o.active !== false ? " checked" : "") + "> شغال</label></div>" +
      '<div class="cm-actions"><button class="btn btn-primary sm" data-save-offer>' + (o.id ? "حفظ" : "إضافة عرض") + "</button>" +
      (o.id ? '<button class="btn ghost sm" data-del="clinic_offers|' + o.id + '">حذف</button>' : "") + "</div></div>";
  }
  function faqRow(f) {
    return '<div class="ci-card ci-item" data-faq="' + esc(f.id || "") + '">' +
      '<div class="field ci-field"><label>السؤال</label><input data-k="question" value="' + esc(f.question) + '"></div>' +
      '<div class="field ci-field"><label>الإجابة المعتمدة</label><textarea data-k="answer" rows="3">' + esc(f.answer) + "</textarea></div>" +
      '<label class="ci-chip"><input type="checkbox" data-k="active"' + (f.active !== false ? " checked" : "") + "> شغال</label>" +
      '<div class="cm-actions"><button class="btn btn-primary sm" data-save-faq>' + (f.id ? "حفظ" : "إضافة سؤال") + "</button>" +
      (f.id ? '<button class="btn ghost sm" data-del="clinic_faqs|' + f.id + '">حذف</button>' : "") + "</div></div>";
  }

  function collect(card) {
    var row = {};
    qa(card, "[data-k]").forEach(function (el) {
      var k = el.getAttribute("data-k");
      row[k] = el.type === "checkbox" ? el.checked : (el.value.trim() || null);
    });
    return row;
  }
  function upsert(table, id, row) {
    row.updated_at = new Date().toISOString();
    var req = id ? db().from(table).update(row).eq("id", id) : db().from(table).insert(row);
    return req.then(function (r) { if (r.error) throw r.error; });
  }

  function wire(container, data) {
    var again = function () {
      toast("اتحفظ ✓ — هيوصل للوكيل خلال دقايق");
      if (LIST_SECTIONS.indexOf(state.section) === -1) state.editing = false;
      render(container);
    };
    qa(container, "[data-sec]").forEach(function (b) { b.onclick = function () { state.section = b.getAttribute("data-sec"); state.editing = false; draw(container, data); }; });
    var eb = q(container, "[data-edit]");
    if (eb) eb.onclick = function () { state.editing = true; draw(container, data); };
    var cb = q(container, "[data-cancel-edit]");
    if (cb) cb.onclick = function () { state.editing = false; render(container); };
    var sp = q(container, "[data-save-profile]");
    if (sp) sp.onclick = function () {
      var row = { updated_at: new Date().toISOString() };
      qa(container, "[data-f]").forEach(function (el) { row[el.getAttribute("data-f")] = el.value.trim() || null; });
      if (q(container, "[data-pay]")) row.payment_methods = qa(container, "[data-pay]:checked").map(function (el) { return el.value; });
      sp.disabled = true;
      db().from("clinic_profile").update(row).eq("id", 1).then(function (r) { if (r.error) throw r.error; again(); }).catch(function (e) { sp.disabled = false; fail(e); });
    };
    qa(container, "[data-save-hour]").forEach(function (b) {
      b.onclick = function () {
        var card = b.closest("[data-hour]"), row = collect(card);
        row.days = qa(card, "[data-day]:checked").map(function (el) { return el.value; });
        if (!row.department) return alert("اكتب اسم القسم");
        if (!row.days.length) return alert("اختار الأيام");
        if (!row.closed && (!row.open_time || !row.close_time)) return alert("اكتب الساعة من ولـ");
        b.disabled = true;
        upsert("clinic_hours", card.getAttribute("data-hour"), row).then(again).catch(function (e) { b.disabled = false; fail(e); });
      };
    });
    qa(container, "[data-save-offer]").forEach(function (b) {
      b.onclick = function () {
        var card = b.closest("[data-offer]"), row = collect(card);
        if (!row.title) return alert("اكتب اسم العرض");
        b.disabled = true;
        upsert("clinic_offers", card.getAttribute("data-offer"), row).then(again).catch(function (e) { b.disabled = false; fail(e); });
      };
    });
    qa(container, "[data-save-faq]").forEach(function (b) {
      b.onclick = function () {
        var card = b.closest("[data-faq]"), row = collect(card);
        if (!row.question || !row.answer) return alert("اكتب السؤال والإجابة");
        b.disabled = true;
        upsert("clinic_faqs", card.getAttribute("data-faq"), row).then(again).catch(function (e) { b.disabled = false; fail(e); });
      };
    });
    qa(container, "[data-del]").forEach(function (b) {
      b.onclick = function () {
        if (!confirm("متأكد إنك عايز تحذف ده؟")) return;
        var parts = b.getAttribute("data-del").split("|");
        db().from(parts[0]).delete().eq("id", parts[1]).then(function (r) { if (r.error) throw r.error; render(container); }).catch(fail);
      };
    });
  }

  window.SSMPDRenderClinicInfo = { render: function (container) { state.editing = false; render(container); } };
})();
