/* SSMPD — تاب «بيانات الشركة والفروع»: السجل التجاري، البطاقة الضريبية، الختم، تليفونات وإيميلات، وكل فرع
   (حساب البنك، التراخيص، المستندات). للسوبر أدمن بس (قرار المالك 2026-11-16) — القاعدة بتفرض دا بـRLS.
   الملفات في bucket خاص org-legal-documents وبتتفتح بلينك مؤقت 5 دقايق بس. لا بيانات مرضى هنا. */
(function () {
  "use strict";

  var BUCKET = "org-legal-documents";
  var MAX_BYTES = 15 * 1024 * 1024;
  var EXT = { "application/pdf": "pdf", "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp" };
  var DOC_TYPES = [
    ["commercial_register", "السجل التجاري"], ["tax_card", "البطاقة الضريبية"], ["stamp", "الختم"],
    ["license", "ترخيص"], ["bank", "مستند بنكي"], ["contract", "عقد (إيجار/شراكة…)"],
    ["insurance", "تأمينات / نقابة / غرفة"], ["other", "مستند تاني"]
  ];
  var COMPANY_DOC_TYPES = ["commercial_register", "tax_card", "stamp", "contract", "insurance", "bank", "other"];
  var BRANCH_DOC_TYPES = ["license", "bank", "contract", "insurance", "other"];
  var SOON_DAYS = 30;
  var state = { section: "company", editing: false };

  function db() { return window.SSMPDDb.client; }
  function esc(s) { return String(s == null ? "" : s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;"); }
  function toast(msg) { if (window.SSMPDToast && window.SSMPDToast.show) window.SSMPDToast.show(msg); }
  function fail(e) { alert((e && e.message) || "حصل خطأ"); }
  function q(c, s) { return c.querySelector(s); }
  function qa(c, s) { return Array.prototype.slice.call(c.querySelectorAll(s)); }
  function typeLabel(t) { for (var i = 0; i < DOC_TYPES.length; i++) if (DOC_TYPES[i][0] === t) return DOC_TYPES[i][1]; return t; }
  function res(r) { if (r && r.error) throw r.error; return r ? r.data : null; }
  function uuid() {
    if (window.crypto && window.crypto.randomUUID) return window.crypto.randomUUID();
    return "xxxxxxxx-xxxx-4xxx-8xxx-xxxxxxxxxxxx".replace(/x/g, function () { return (Math.random() * 16 | 0).toString(16); });
  }
  function today() { var d = new Date(); return new Date(d.getFullYear(), d.getMonth(), d.getDate()); }
  // حالة تاريخ الانتهاء: expired / soon (خلال 30 يوم) / ok / ""
  function expiryState(date) {
    if (!date) return "";
    var d = new Date(String(date).slice(0, 10) + "T00:00:00"), diff = Math.round((d - today()) / 86400000);
    return diff < 0 ? "expired" : diff <= SOON_DAYS ? "soon" : "ok";
  }
  function expiryBadge(date) {
    var s = expiryState(date);
    if (!s) return "";
    var txt = s === "expired" ? "منتهي" : s === "soon" ? "قرّب ينتهي" : "ساري";
    return ' <span class="ol-badge ol-' + s + '">' + txt + " — " + esc(String(date).slice(0, 10)) + "</span>";
  }

  function load() {
    return Promise.all([
      db().from("org_company").select("*").eq("id", 1).maybeSingle(),
      db().rpc("org_branches"),
      db().from("org_branch_details").select("*"),
      db().from("org_documents").select("*").order("created_at", { ascending: false })
    ]).then(function (r) {
      var company = res(r[0]) || { id: 1 };
      var meta = res(r[1]) || {};
      var details = {}; (res(r[2]) || []).forEach(function (d) { details[d.branch_id] = d; });
      return { company: company, branches: meta.branches || [], bankAccounts: meta.bank_accounts || [], details: details, docs: res(r[3]) || [] };
    });
  }

  function render(container) {
    container.innerHTML = '<div class="loading">بيحمّل…</div>';
    load().then(function (data) { draw(container, data); }).catch(function (e) {
      container.innerHTML = '<div class="err-msg">' + (/permission|row-level|سوبر أدمن|does not exist/i.test((e && e.message) || "") ? "التاب دا للسوبر أدمن بس." : "خطأ: " + esc(e && e.message)) + "</div>";
    });
  }

  // ===== عرض/تعديل الحقول =====
  function vrow(label, value) {
    return '<div class="field ci-field"><label>' + label + '</label><div class="ol-val">' + (value ? esc(value) : '<span class="muted">—</span>') + "</div></div>";
  }
  function input(name, label, value, type, extra) {
    return '<div class="field ci-field"><label>' + label + '</label><input data-f="' + name + '" type="' + (type || "text") + '" value="' + esc(value) + '"' + (extra || "") + "></div>";
  }
  function listInput(name, label, arr, hint) {
    return '<div class="field ci-field"><label>' + label + ' <span class="muted">(' + hint + ')</span></label><textarea data-list="' + name + '" rows="2">' + esc((arr || []).join("\n")) + "</textarea></div>";
  }
  function area(name, label, value) {
    return '<div class="field ci-field"><label>' + label + '</label><textarea data-f="' + name + '" rows="3">' + esc(value) + "</textarea></div>";
  }
  function row() { return '<div class="ci-row">' + Array.prototype.join.call(arguments, "") + "</div>"; }
  function joinList(a) { return (a || []).join(" — "); }

  function companyView(c) {
    return '<div class="ci-card"><h3 class="ol-h">البيانات الأساسية</h3>' +
      row(vrow("الاسم القانوني (عربي)", c.legal_name_ar), vrow("الاسم القانوني (إنجليزي)", c.legal_name_en)) +
      row(vrow("الشكل القانوني", c.legal_form), vrow("العنوان الرسمي", c.address)) + "</div>" +
      '<div class="ci-card"><h3 class="ol-h">السجل التجاري' + expiryBadge(c.cr_expiry_date) + "</h3>" +
      row(vrow("رقم السجل", c.cr_number), vrow("مكتب السجل", c.cr_office)) +
      row(vrow("تاريخ الإصدار", c.cr_issue_date), vrow("تاريخ الانتهاء / التجديد", c.cr_expiry_date)) + "</div>" +
      '<div class="ci-card"><h3 class="ol-h">البطاقة الضريبية' + expiryBadge(c.tax_card_expiry_date) + "</h3>" +
      row(vrow("رقم التسجيل الضريبي", c.tax_card_number), vrow("المأمورية", c.tax_office)) +
      row(vrow("تاريخ الانتهاء", c.tax_card_expiry_date), vrow("رقم القيمة المضافة", c.vat_number)) + "</div>" +
      '<div class="ci-card"><h3 class="ol-h">التواصل وأرقام تانية</h3>' +
      row(vrow("التليفونات", joinList(c.phones)), vrow("الإيميلات الرسمية", joinList(c.emails))) +
      row(vrow("الموقع", c.website), vrow("رقم التأمينات الاجتماعية", c.social_insurance_number), vrow("رقم الغرفة التجارية", c.chamber_number)) +
      vrow("ملاحظات", c.notes) + "</div>";
  }
  function companyForm(c) {
    return '<div class="ci-card" data-form="company"><h3 class="ol-h">البيانات الأساسية</h3>' +
      row(input("legal_name_ar", "الاسم القانوني (عربي)", c.legal_name_ar), input("legal_name_en", "الاسم القانوني (إنجليزي)", c.legal_name_en)) +
      row(input("legal_form", "الشكل القانوني (مثلاً: شركة ذات مسؤولية محدودة)", c.legal_form), input("address", "العنوان الرسمي", c.address)) +
      '<h3 class="ol-h">السجل التجاري</h3>' +
      row(input("cr_number", "رقم السجل", c.cr_number), input("cr_office", "مكتب السجل", c.cr_office)) +
      row(input("cr_issue_date", "تاريخ الإصدار", c.cr_issue_date, "date"), input("cr_expiry_date", "تاريخ الانتهاء / التجديد", c.cr_expiry_date, "date")) +
      '<h3 class="ol-h">البطاقة الضريبية</h3>' +
      row(input("tax_card_number", "رقم التسجيل الضريبي", c.tax_card_number), input("tax_office", "المأمورية", c.tax_office)) +
      row(input("tax_card_expiry_date", "تاريخ الانتهاء", c.tax_card_expiry_date, "date"), input("vat_number", "رقم القيمة المضافة (لو موجود)", c.vat_number)) +
      '<h3 class="ol-h">التواصل وأرقام تانية</h3>' +
      row(listInput("phones", "التليفونات", c.phones, "كل رقم في سطر"), listInput("emails", "الإيميلات الرسمية", c.emails, "كل إيميل في سطر")) +
      row(input("website", "الموقع", c.website), input("social_insurance_number", "رقم التأمينات الاجتماعية", c.social_insurance_number), input("chamber_number", "رقم الغرفة التجارية", c.chamber_number)) +
      area("notes", "ملاحظات", c.notes) + saveBar() + "</div>";
  }

  function bankName(data, code) {
    for (var i = 0; i < data.bankAccounts.length; i++) if (data.bankAccounts[i].code === code) return data.bankAccounts[i].code + " — " + data.bankAccounts[i].name;
    return code || "";
  }
  function branchView(data, b, d) {
    return '<div class="ci-card"><h3 class="ol-h">بيانات الفرع</h3>' +
      row(vrow("اسم الفرع", b.name), vrow("الاسم الرسمي في التراخيص", d.official_name)) +
      row(vrow("العنوان", d.address), vrow("المدير المسؤول", d.manager_name)) +
      row(vrow("التليفونات", joinList(d.phones)), vrow("الإيميلات الرسمية", joinList(d.emails))) + "</div>" +
      '<div class="ci-card"><h3 class="ol-h">حساب البنك</h3>' +
      row(vrow("البنك", d.bank_name), vrow("فرع البنك", d.bank_branch), vrow("اسم صاحب الحساب", d.bank_account_name)) +
      row(vrow("رقم الحساب", d.bank_account_number), vrow("IBAN", d.iban), vrow("SWIFT", d.swift)) +
      vrow("مربوط بحساب البنك في الحسابات", bankName(data, d.finance_account_code)) + "</div>" +
      (d.notes ? '<div class="ci-card">' + vrow("ملاحظات", d.notes) + "</div>" : "");
  }
  function branchForm(data, b, d) {
    var opts = '<option value="">— مش مربوط —</option>' + data.bankAccounts.map(function (a) {
      return '<option value="' + esc(a.code) + '"' + (a.code === d.finance_account_code ? " selected" : "") + ">" + esc(a.code + " — " + a.name) + "</option>";
    }).join("");
    return '<div class="ci-card" data-form="branch" data-branch="' + esc(b.id) + '"><h3 class="ol-h">بيانات الفرع — ' + esc(b.name) + "</h3>" +
      row(input("official_name", "الاسم الرسمي في التراخيص", d.official_name), input("manager_name", "المدير المسؤول", d.manager_name)) +
      input("address", "العنوان", d.address) +
      row(listInput("phones", "التليفونات", d.phones, "كل رقم في سطر"), listInput("emails", "الإيميلات الرسمية", d.emails, "كل إيميل في سطر")) +
      '<h3 class="ol-h">حساب البنك</h3>' +
      row(input("bank_name", "البنك", d.bank_name), input("bank_branch", "فرع البنك", d.bank_branch), input("bank_account_name", "اسم صاحب الحساب", d.bank_account_name)) +
      row(input("bank_account_number", "رقم الحساب", d.bank_account_number, "text", ' inputmode="numeric" dir="ltr"'),
        input("iban", "IBAN", d.iban, "text", ' dir="ltr" placeholder="EG…"'), input("swift", "SWIFT", d.swift, "text", ' dir="ltr"')) +
      '<div class="field ci-field"><label>اربطه بحساب البنك في الحسابات (اختياري)</label><select data-f="finance_account_code">' + opts + "</select></div>" +
      area("notes", "ملاحظات", d.notes) + saveBar() + "</div>";
  }
  function saveBar() { return '<div class="ol-actions"><button class="btn btn-primary" data-save>حفظ</button> <button class="btn ghost" data-cancel>إلغاء</button></div>'; }

  // ===== المستندات =====
  function docsBlock(docs, ownerKey, types) {
    var list = docs.length ? docs.map(function (d) {
      return '<div class="ol-doc" data-doc="' + esc(d.id) + '"><div class="ol-doc-main"><b>' + esc(d.title) + '</b> <span class="muted">' + esc(typeLabel(d.doc_type)) + "</span>" + expiryBadge(d.expiry_date) +
        '<div class="muted ol-doc-meta">' + [d.doc_number ? "رقم: " + esc(d.doc_number) : "", d.issuer ? "جهة الإصدار: " + esc(d.issuer) : "", d.issue_date ? "إصدار: " + esc(d.issue_date) : ""].filter(Boolean).join(" · ") + "</div>" +
        (d.notes ? '<div class="muted ol-doc-meta">' + esc(d.notes) + "</div>" : "") + "</div>" +
        '<div class="ol-doc-btns"><button class="btn sm" data-open="' + esc(d.storage_path) + '">فتح</button> <button class="btn ghost sm danger-btn" data-del-doc="' + esc(d.id) + '">حذف</button></div></div>';
    }).join("") : '<div class="empty">لسه مفيش مستندات مرفوعة.</div>';
    var typeOpts = types.map(function (t) { return '<option value="' + t + '">' + esc(typeLabel(t)) + "</option>"; }).join("");
    return '<div class="ci-card"><h3 class="ol-h">المستندات والصور</h3>' + list +
      '<details class="ol-upload"><summary class="btn btn-primary sm">+ رفع مستند</summary><div data-upload="' + esc(ownerKey) + '">' +
      row('<div class="field ci-field"><label>النوع</label><select data-u="doc_type">' + typeOpts + "</select></div>", input("title", "اسم المستند", "", "text", ' data-u="title"')) +
      row(input("doc_number", "الرقم (اختياري)", "", "text", ' data-u="doc_number"'), input("issuer", "جهة الإصدار (اختياري)", "", "text", ' data-u="issuer"')) +
      row(input("issue_date", "تاريخ الإصدار", "", "date", ' data-u="issue_date"'), input("expiry_date", "تاريخ الانتهاء (لو ليه)", "", "date", ' data-u="expiry_date"')) +
      '<div class="field ci-field"><label>الملف (PDF أو صورة — لحد 15 ميجا)</label><input type="file" data-u-file accept="application/pdf,image/jpeg,image/png,image/webp"></div>' +
      '<div class="ol-actions"><button class="btn btn-primary" data-upload-go>رفع</button></div></div></details></div>';
  }

  function alertsBlock(data) {
    var items = [];
    var c = data.company;
    if (expiryState(c.cr_expiry_date) && expiryState(c.cr_expiry_date) !== "ok") items.push(["السجل التجاري", c.cr_expiry_date]);
    if (expiryState(c.tax_card_expiry_date) && expiryState(c.tax_card_expiry_date) !== "ok") items.push(["البطاقة الضريبية", c.tax_card_expiry_date]);
    var names = {}; data.branches.forEach(function (b) { names[b.id] = b.name; });
    data.docs.forEach(function (d) {
      var s = expiryState(d.expiry_date);
      if (s === "expired" || s === "soon") items.push([d.title + (d.branch_id ? " (" + (names[d.branch_id] || "فرع") + ")" : ""), d.expiry_date]);
    });
    if (!items.length) return "";
    return '<div class="ol-alerts" role="status"><b>⚠️ محتاج تجديد:</b> ' + items.map(function (i) { return esc(i[0]) + expiryBadge(i[1]); }).join("، ") + "</div>";
  }

  function draw(container, data) {
    if (state.section !== "company" && !data.branches.some(function (b) { return b.id === state.section; })) state.section = "company";
    var tabs = '<button class="btn sm ' + (state.section === "company" ? "" : "ghost") + '" data-sec="company">الشركة</button>' +
      data.branches.map(function (b) { return '<button class="btn sm ' + (state.section === b.id ? "" : "ghost") + '" data-sec="' + esc(b.id) + '">' + esc(b.name) + (b.active === false ? " (متوقف)" : "") + "</button>"; }).join("") +
      '<button class="btn ghost sm" data-add-branch>+ فرع جديد</button>';
    var body, editBtn = state.editing ? "" : '<div class="ol-actions"><button class="btn btn-primary sm" data-edit>تعديل البيانات</button></div>';
    if (state.section === "company") {
      body = editBtn + (state.editing ? companyForm(data.company) : companyView(data.company)) +
        docsBlock(data.docs.filter(function (d) { return !d.branch_id; }), "company", COMPANY_DOC_TYPES);
    } else {
      var b = data.branches.filter(function (x) { return x.id === state.section; })[0], d = data.details[b.id] || { branch_id: b.id };
      body = editBtn + (state.editing ? branchForm(data, b, d) : branchView(data, b, d)) +
        docsBlock(data.docs.filter(function (x) { return x.branch_id === b.id; }), b.id, BRANCH_DOC_TYPES);
    }
    container.innerHTML = '<div class="ci-wrap ol-wrap" dir="rtl"><div class="cm-head"><div><h2>بيانات الشركة والفروع</h2>' +
      '<p class="muted">السجل التجاري والبطاقة الضريبية والختم وبيانات كل فرع. للسوبر أدمن بس، والملفات محفوظة في مكان خاص وبتتفتح بلينك مؤقت.</p></div></div>' +
      alertsBlock(data) + '<div class="cm-tabs">' + tabs + "</div>" + body + "</div>";
    wire(container, data);
  }

  // ===== الحفظ =====
  function collect(form) {
    var row = {};
    qa(form, "[data-f]").forEach(function (el) {
      var v = String(el.value || "").trim(), k = el.getAttribute("data-f");
      if (el.type === "date" || k === "finance_account_code") row[k] = v || null;
      else if (k === "iban" || k === "swift") row[k] = v.replace(/\s+/g, "").toUpperCase();
      else row[k] = v;
    });
    qa(form, "[data-list]").forEach(function (el) {
      row[el.getAttribute("data-list")] = String(el.value || "").split(/[\n,،]+/).map(function (s) { return s.trim(); }).filter(Boolean);
    });
    return row;
  }
  function validate(row) {
    if (row.iban && !/^[A-Z]{2}[0-9]{2}[A-Z0-9]{10,30}$/.test(row.iban)) return "رقم الـIBAN مش مظبوط (لازم يبدأ بحرفين زي EG وبعدهم أرقام).";
    if (row.swift && !/^[A-Z]{6}[A-Z0-9]{2}([A-Z0-9]{3})?$/.test(row.swift)) return "كود الـSWIFT مش مظبوط (8 أو 11 حرف/رقم).";
    var bad = (row.emails || []).filter(function (e) { return !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e); });
    if (bad.length) return "الإيميل دا مش مظبوط: " + bad[0];
    if (row.cr_issue_date && row.cr_expiry_date && row.cr_expiry_date < row.cr_issue_date) return "تاريخ انتهاء السجل قبل تاريخ إصداره.";
    return "";
  }
  function save(container, form) {
    var row = collect(form), msg = validate(row);
    if (msg) return alert(msg);
    var btn = q(form, "[data-save]"); btn.disabled = true;
    var kind = form.getAttribute("data-form"), p;
    if (kind === "company") p = db().from("org_company").update(row).eq("id", 1).select("id");
    else { row.branch_id = form.getAttribute("data-branch"); p = db().from("org_branch_details").upsert(row, { onConflict: "branch_id" }).select("branch_id"); }
    Promise.resolve(p).then(function (r) {
      var out = res(r);
      if (!out || !out.length) throw new Error("محصلش حفظ — اتأكد إنك داخل بحساب السوبر أدمن.");
      state.editing = false; toast("اتحفظ ✓"); render(container);
    }).catch(function (e) { btn.disabled = false; fail(e); });
  }

  function upload(container, box) {
    var owner = box.getAttribute("data-upload"), file = q(box, "[data-u-file]").files[0];
    var get = function (k) { var el = q(box, '[data-u="' + k + '"]'); return el ? String(el.value || "").trim() : ""; };
    var title = get("title");
    if (title.length < 2) return alert("اكتب اسم المستند.");
    if (!file) return alert("اختار الملف.");
    if (!EXT[file.type]) return alert("الملف لازم يكون PDF أو صورة (JPG / PNG / WEBP).");
    if (file.size > MAX_BYTES) return alert("الملف أكبر من 15 ميجا.");
    if (get("issue_date") && get("expiry_date") && get("expiry_date") < get("issue_date")) return alert("تاريخ الانتهاء قبل تاريخ الإصدار.");
    var path = owner + "/" + uuid() + "." + EXT[file.type];
    var btn = q(box, "[data-upload-go]"); btn.disabled = true; btn.textContent = "بيرفع…";
    var store = db().storage.from(BUCKET);
    Promise.resolve(store.upload(path, file, { upsert: false, contentType: file.type })).then(function (r) {
      res(r);
      return Promise.resolve(db().from("org_documents").insert({
        branch_id: owner === "company" ? null : owner, doc_type: get("doc_type"), title: title, doc_number: get("doc_number"), issuer: get("issuer"),
        issue_date: get("issue_date") || null, expiry_date: get("expiry_date") || null, storage_path: path, mime_type: file.type, size_bytes: file.size
      })).then(function (r2) {
        // لو حفظ البيانات فشل، الملف ميفضلش مرفوع لوحده
        if (r2 && r2.error) return Promise.resolve(store.remove([path])).then(function () { throw r2.error; }, function () { throw r2.error; });
      });
    }).then(function () { toast("اترفع ✓"); render(container); }).catch(function (e) { btn.disabled = false; btn.textContent = "رفع"; fail(e); });
  }

  function openDoc(path) {
    // نفتح التاب فوراً (عشان الموبايل ميمنعهوش) وبعدين نحط فيه اللينك المؤقت
    var w = window.open("", "_blank");
    Promise.resolve(db().storage.from(BUCKET).createSignedUrl(path, 300)).then(function (r) {
      var url = res(r).signedUrl;
      if (w) { try { w.opener = null; } catch (e) {} w.location.href = url; } else window.location.assign(url);
    }).catch(function (e) { if (w) w.close(); fail(e); });
  }

  function deleteDoc(container, data, id) {
    var d = data.docs.filter(function (x) { return x.id === id; })[0];
    if (!d || !confirm("متأكد إنك عايز تحذف «" + d.title + "»؟ الملف هيتمسح نهائياً.")) return;
    Promise.resolve(db().from("org_documents").delete().eq("id", id).select("id")).then(function (r) {
      var out = res(r); if (!out || !out.length) throw new Error("محصلش حذف.");
      return Promise.resolve(db().storage.from(BUCKET).remove([d.storage_path])).catch(function () {});
    }).then(function () { toast("اتحذف"); render(container); }).catch(fail);
  }

  function addBranch(container) {
    var name = prompt("اسم الفرع الجديد:");
    if (!name || !name.trim()) return;
    Promise.resolve(db().rpc("org_branch_create", { p_name: name.trim() })).then(function (r) {
      state.section = res(r); state.editing = true; render(container);
    }).catch(fail);
  }

  function wire(container, data) {
    qa(container, "[data-sec]").forEach(function (b) { b.onclick = function () { state.section = b.getAttribute("data-sec"); state.editing = false; draw(container, data); }; });
    var add = q(container, "[data-add-branch]"); if (add) add.onclick = function () { addBranch(container); };
    var ed = q(container, "[data-edit]"); if (ed) ed.onclick = function () { state.editing = true; draw(container, data); };
    qa(container, "[data-cancel]").forEach(function (b) { b.onclick = function () { state.editing = false; draw(container, data); }; });
    qa(container, "[data-save]").forEach(function (b) { b.onclick = function () { save(container, b.closest("[data-form]")); }; });
    qa(container, "[data-upload-go]").forEach(function (b) { b.onclick = function () { upload(container, b.closest("[data-upload]")); }; });
    qa(container, "[data-open]").forEach(function (b) { b.onclick = function () { openDoc(b.getAttribute("data-open")); }; });
    qa(container, "[data-del-doc]").forEach(function (b) { b.onclick = function () { deleteDoc(container, data, b.getAttribute("data-del-doc")); }; });
  }

  window.SSMPDRenderOrgLegal = {
    render: function (container) { state.editing = false; render(container); },
    _test: { expiryState: expiryState, validate: validate }
  };
})();
