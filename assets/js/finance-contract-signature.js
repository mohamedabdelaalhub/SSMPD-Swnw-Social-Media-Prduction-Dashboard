/* Online doctor contracts, accountant side (separate file; chains onto SSMPDFinanceControls like finance-channels.js, does not touch finance-doctors.js or db.js).
   - next to each doctor's group of ACTIVE contracts (same reference): «إرسال للتوقيع» (creates a signature request for that doctor + contract set + current published template version)
   - on each contract row: «وافق الطبيب بتاريخ …» / «بانتظار موافقة الطبيب» / «رفض: السبب» / «النص اتغيّر — أعد الإرسال»  (a recorded status only; accruals are NOT affected)
   - a block for the contract / consent texts with «تعديل النص» (owner/financial manager): title, intro, add / remove / reorder clauses; every save is a new VERSION (draft, or published at once)
   - a block with the owner-set ENFORCEMENT START DATE per rule (unsigned contract / no declaration): empty = off (default). This only records the date and shows who would be affected; nothing is blocked by this file.
   - «عرض العقد الموقّع» on signed rows: the text + the doctor's signature image (drawn or uploaded) + version, sha256 and time
   The server (migration 20261108280000) decides everything; this file only shows and sends. Nothing is painted when the migration is not applied (RPC missing). */
(function () {
  'use strict';
  var prior = window.SSMPDFinanceControls;
  if (!prior) return;
  var info = null, loading = null, seq = 0;
  var KIND = { contract: 'نص العقد', consent: 'إقرار المسؤولية المهنية' };

  function rpc(name, args) {
    var db = window.SSMPDDb, c = db && db.client;
    if (!c || typeof c.rpc !== 'function') return Promise.reject(new Error('no client'));
    return Promise.resolve(c.rpc(name, args || {})).then(function (r) { if (r && r.error) throw r.error; return r ? r.data : null; });
  }
  function refresh() {
    var my = ++seq;
    loading = rpc('clinic_finance_contract_signature_status').then(function (r) { if (my === seq) info = r; return info; }, function () { if (my === seq) info = null; return null; });
    return loading;
  }
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function day(ts) { return ts ? String(ts).slice(0, 10) : ''; }
  function stateText(s) {
    if (!s) return '';
    if (s.state === 'accepted') return 'وافق الطبيب بتاريخ ' + day(s.at);
    if (s.state === 'rejected') return 'رفض: ' + (s.reason || '');
    if (s.state === 'stale') return 'النص أو الشروط اتغيّرت — أعد الإرسال';
    return 'بانتظار موافقة الطبيب';
  }
  function sigWord(k) { return k === 'drawn' ? 'رسم باليد' : k === 'uploaded' ? 'صورة مرفوعة' : ''; }
  function compText(key, enf) {
    var c = info && info.compliance && info.compliance[key]; if (!c) return '';
    var e = enf || {}, a = [];
    a.push('العقد: ' + (c.contract_ok ? 'موقّع' : 'غير موقّع' + (e.contract_signature && e.contract_signature.start_date ? ' (يُشترط من ' + e.contract_signature.start_date + ')' : '')));
    a.push('الإقرار: ' + (c.consent_ok ? 'تم' : 'لم يتم' + (e.consent && e.consent.start_date ? ' (يُشترط من ' + e.consent.start_date + ')' : '')));
    return a.join(' — ');
  }
  function order(d) { var o = [], seen = {}; (d.doctor_contracts || []).forEach(function (c) { if (!seen[c.doctor_key]) { seen[c.doctor_key] = 1; o.push(c.doctor_key); } }); return o; }
  function groupsOf(list) { // active contracts of one doctor split by reference
    var by = {}, o = [];
    list.forEach(function (c) { if (c.status !== 'active') return; if (!by[c.reference]) { by[c.reference] = []; o.push(c.reference); } by[c.reference].push(c); });
    return o.map(function (r) { return { reference: r, contracts: by[r] }; });
  }

  function paint(d) {
    var root = document.querySelector('.fc-workspace') || document;
    var groups = root.querySelectorAll('.fc-doctor-group'), keys = order(d);
    [].forEach.call(root.querySelectorAll('.fc-sig-btn,.fc-sig-state,[data-sig-templates]'), function (n) { n.remove(); });
    if (!info || !groups.length) { if (info) { templates(d, root); wire(d, root); } return; }
    var map = info.contracts || {};
    [].forEach.call(groups, function (g, gi) {
      var key = keys[gi]; if (!key) return;
      var cs = (d.doctor_contracts || []).filter(function (c) { return c.doctor_key === key; });
      var rows = g.querySelectorAll('tbody tr');
      [].forEach.call(rows, function (tr, ri) {
        var c = cs[ri], s = c && map[c.id]; if (!s || !tr.children[5]) return;
        var el = document.createElement('small'); el.className = 'fc-sig-state'; el.setAttribute('data-sig-state', s.state); el.style.display = 'block'; el.textContent = stateText(s);
        if (s.acceptance_id && s.state === 'accepted') { var v = document.createElement('button'); v.type = 'button'; v.className = 'btn ghost sm'; v.setAttribute('data-fin-action', 'contract-signed-view'); v.setAttribute('data-id', s.acceptance_id); v.textContent = 'عرض العقد الموقّع' + (s.signature_kind ? ' (' + sigWord(s.signature_kind) + ')' : ''); el.appendChild(v); }
        tr.children[5].appendChild(el);
      });
      var sum = g.querySelector('summary'), ct = compText(key, info.enforcement);
      if (ct && sum) { var cs0 = document.createElement('small'); cs0.className = 'fc-sig-state fc-comp'; cs0.setAttribute('data-sig-comp', key); cs0.textContent = ct; sum.appendChild(cs0);
        var cc = info.consents && info.consents[key]; if (cc && cc.acceptance_id) { var vb = document.createElement('button'); vb.type = 'button'; vb.className = 'btn ghost sm fc-sig-btn'; vb.setAttribute('data-fin-action', 'contract-signed-view'); vb.setAttribute('data-id', cc.acceptance_id); vb.textContent = 'عرض الإقرار الموقّع'; sum.appendChild(vb); } }
      if (d.can_create) {
        groupsOf(cs).forEach(function (gr) {
          var b = document.createElement('button'); b.type = 'button'; b.className = 'btn ghost sm fc-sig-btn'; b.setAttribute('data-fin-action', 'contract-signature-send'); b.setAttribute('data-id', gr.contracts[0].id);
          b.textContent = 'إرسال للتوقيع' + (groupsOf(cs).length > 1 ? ' (' + gr.reference + ')' : '');
          if (sum) sum.appendChild(b);
        });
      }
    });
    templates(d, root);
    wire(d, root);
  }
  // The buttons painted here are added after the finance panel bound its [data-fin-action] click handlers, so they would do nothing: bind them here.
  function wire(d, root) {
    [].forEach.call(root.querySelectorAll('.fc-sig-btn,.fc-sig-state,[data-sig-templates]'), function (n) {
      [].forEach.call(n.hasAttribute('data-fin-action') ? [n] : n.querySelectorAll('[data-fin-action]'), function (b) {
        b.onclick = function () {
          var cash = window.SSMPDFinanceCash, h = cash && cash.helpers, a = window.SSMPDFinanceControls && window.SSMPDFinanceControls.act;
          if (a && h) a(b.getAttribute('data-fin-action'), b.getAttribute('data-id'), d, h);
        };
      });
    });
  }
  function templates(d, root) {
    var host = root.querySelector('.fc-doctor-group'); host = host && host.parentNode; if (!host || !info) return;
    var list = info.templates || [], cur = {};
    list.forEach(function (t) { if (t.published && !cur[t.kind]) cur[t.kind] = t; });
    var box = document.createElement('div'); box.setAttribute('data-sig-templates', 'yes'); box.className = 'fc-note';
    box.innerHTML = '<h4>نصوص العقد الإلكتروني</h4>' + ['contract', 'consent'].map(function (k) {
      var t = cur[k]; return '<p><strong>' + KIND[k] + ':</strong> ' + (t ? 'المنشور: نسخة ' + t.version + ' — ' + esc(t.title) : 'لا يوجد نص منشور — لا يمكن إرسال عقود للتوقيع قبل نشره') +
        (d.can_review ? ' <button type="button" class="btn ghost sm" data-fin-action="contract-template-edit" data-id="' + k + '">تعديل النص</button>' : '') + (list.some(function (x) { return x.kind === k && !x.published; }) ? ' <small>(في مسودة غير منشورة)</small>' : '') + '</p>';
    }).join('') + (list.some(function (t) { return t.placeholder && !t.published; }) ? '<p><small>النصوص المبدئية الموجودة مجرد مسودة بانتظار المستشار القانوني ولا تُعرض للأطباء قبل نشرها.</small></p>' : '');
    var en = info.enforcement || {};
    box.innerHTML += '<h4>بداية التطبيق (يحددها المالك)</h4><p><small>افتراضيًا لا شيء يمنع أي شغل أو استحقاق. حدّد تاريخ بداية لكل قاعدة عند الجاهزية؛ قبل التاريخ يظهر التنبيه فقط.</small></p>' +
      [['contract_signature', 'عقد غير موقّع'], ['consent', 'عدم الإقرار بالمسؤولية']].map(function (r) {
        var e = en[r[0]] || {};
        return '<p><label>' + r[1] + ' — يُطبَّق من: <input type="date" data-enf-rule="' + r[0] + '" value="' + esc(e.start_date || '') + '"' + (d.can_review ? '' : ' disabled') + '></label> ' +
          (e.start_date ? (e.active ? '<strong>مُفعّل الآن</strong>' : 'سيبدأ في ' + esc(e.start_date)) : 'غير مفعّل') +
          (d.can_review ? ' <button type="button" class="btn ghost sm" data-fin-action="contract-enforcement-save" data-id="' + r[0] + '">حفظ</button>' : '') + '</p>';
      }).join('');
    host.insertBefore(box, host.firstChild);
  }

  function cmd(action, payload, token) { return window.SSMPDDb.client.rpc('clinic_finance_contract_signature_command', { p_action: action, p_payload: payload, p_token: token }).then(function (r) { if (r.error) throw r.error; return r.data; }); }
  function newToken() { return (window.crypto && window.crypto.randomUUID) ? window.crypto.randomUUID() : 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function (c) { var r = Math.random() * 16 | 0; return (c === 'x' ? r : (r & 3 | 8)).toString(16); }); }
  function overlay(html) {
    var o = document.createElement('div'); o.className = 'modal-backdrop fc-sig-overlay'; o.innerHTML = '<div class="modal" role="dialog" aria-modal="true" dir="rtl" style="max-width:820px;width:96vw;max-height:92vh;overflow:auto">' + html + '</div>';
    document.body.appendChild(o); o.addEventListener('click', function (e) { if (e.target.closest && e.target.closest('[data-sig-close]')) o.remove(); }); return o;
  }
  function clauseRow(text) {
    return '<div class="fc-clause" data-clause style="display:flex;gap:6px;margin:6px 0"><textarea rows="2" data-clause-text style="flex:1">' + esc(text) + '</textarea>' +
      '<button type="button" class="btn ghost sm" data-clause-up aria-label="أعلى">↑</button><button type="button" class="btn ghost sm" data-clause-down aria-label="أسفل">↓</button><button type="button" class="btn ghost sm" data-clause-del aria-label="حذف البند">✕</button></div>';
  }
  function editor(kind, d) {
    var list = (info && info.templates || []).filter(function (t) { return t.kind === kind; }), draft = list.filter(function (x) { return !x.published; })[0], t = draft;
    if (!draft) { // published texts are immutable: only an unpublished draft can be edited
      return overlay('<div class="modal-head"><h2>' + KIND[kind] + '</h2><button type="button" class="modal-close" aria-label="إغلاق" data-sig-close>×</button></div>' +
        '<p class="fc-note" role="status" data-tpl-locked>هذا النص منشور ولا يمكن تعديله بعد النشر. المنشور يظل كما وقّع عليه الأطباء، ولا توجد مسودة غير منشورة لتعديلها.</p>' +
        '<div class="fc-actions"><button type="button" class="btn ghost" data-sig-close>إغلاق</button></div>');
    }
    var o = overlay('<div class="modal-head"><h2>تعديل ' + KIND[kind] + '</h2><button type="button" class="modal-close" aria-label="إغلاق" data-sig-close>×</button></div>' +
      '<p class="fc-note">' + 'بتعدّل مسودة (نسخة ' + draft.version + ') غير منشورة. بعد النشر النص بيتقفل ومبيتعدّلش.' +
      (kind === 'contract' ? ' تقدر تستخدم في المقدمة والبنود: {{doctor_name}} {{doctor_key}} {{reference}} {{template_version}}. جدول الشروط المالية بيتضاف تلقائيًا بعد البنود.' : '') + '</p>' +
      '<label class="fc-field">العنوان<input name="title" data-tpl-title value="' + esc(t.title) + '"></label>' +
      '<label class="fc-field">المقدمة<textarea name="body" rows="5" data-tpl-body>' + esc(t.body) + '</textarea></label>' +
      '<h4>البنود</h4><div data-clauses>' + (t.clauses || []).map(clauseRow).join('') + '</div>' +
      '<p><button type="button" class="btn ghost sm" data-clause-add>＋ إضافة بند</button></p><p role="status" data-tpl-msg></p>' +
      '<div class="fc-actions"><button type="button" class="btn ghost" data-tpl-save="draft">حفظ كمسودة</button> <button type="button" class="btn" data-tpl-save="publish">نشر هذه المسودة</button> <button type="button" class="btn ghost" data-sig-close>إلغاء</button></div>');
    var msg = function (m) { o.querySelector('[data-tpl-msg]').textContent = m || ''; }, armed = false;
    o.addEventListener('click', function (e) {
      var b = e.target.closest && e.target.closest('button'); if (!b) return; var row = b.closest('[data-clause]'), box = o.querySelector('[data-clauses]');
      if (b.hasAttribute('data-clause-add')) { box.insertAdjacentHTML('beforeend', clauseRow('')); return; }
      if (b.hasAttribute('data-clause-del') && row) { row.remove(); return; }
      if (b.hasAttribute('data-clause-up') && row && row.previousElementSibling) { box.insertBefore(row, row.previousElementSibling); return; }
      if (b.hasAttribute('data-clause-down') && row && row.nextElementSibling) { box.insertBefore(row.nextElementSibling, row); return; }
      var mode = b.getAttribute('data-tpl-save'); if (!mode) return;
      if (mode === 'publish' && !armed) { armed = true; b.textContent = 'تأكيد النشر (لا يمكن التراجع)'; return; }
      var payload = { kind: kind, title: o.querySelector('[data-tpl-title]').value, body: o.querySelector('[data-tpl-body]').value, publish: mode === 'publish',
        clauses: [].map.call(o.querySelectorAll('[data-clause-text]'), function (x) { return x.value; }).filter(function (x) { return x.trim(); }) };
      payload.id = draft.id;
      cmd('template_save', payload, newToken()).then(function () { o.remove(); return refresh(); }).then(function () { paint(d); }, function (er) { armed = false; msg((er && er.message) || 'تعذر الحفظ'); });
    });
    return o;
  }
  function signedView(id) {
    return window.SSMPDDb.client.rpc('clinic_finance_contract_signed_document', { p_acceptance: id }).then(function (r) {
      if (r.error) throw r.error; var x = r.data;
      return overlay('<div class="modal-head"><h2>' + (x.kind === 'consent' ? 'الإقرار الموقّع' : 'العقد الموقّع') + ' — ' + esc(x.doctor_key) + '</h2><button type="button" class="modal-close" aria-label="إغلاق" data-sig-close>×</button></div>' +
        '<div style="white-space:pre-wrap" data-signed-text>' + esc(x.text) + '</div>' +
        (x.signature_image ? '<p>التوقيع (' + esc(sigWord(x.signature_kind)) + '):</p><img data-signed-image alt="توقيع الطبيب" style="max-width:360px;max-height:160px;background:#fff;border:1px solid #ccc" src="' + esc(x.signature_image) + '">' : '') +
        '<p><small>نسخة النص ' + esc(x.template_version) + ' — ' + esc(String(x.decided_at).slice(0, 19).replace('T', ' ')) + ' — بصمة النص ' + esc(String(x.text_sha256).slice(0, 16)) + '… — بصمة التوقيع ' + esc(String(x.signature_sha256 || '').slice(0, 16)) + '…</small></p>');
    });
  }

  function panel(tab, d, h) {
    var html = prior.panel(tab, d, h);
    if (tab === 'doctors') {
      var go = function () { if (document.querySelector('.fc-doctor-group,[data-fc-body]')) paint(d); };
      Promise.resolve(refresh()).then(go);
    }
    return html;
  }
  function act(action, id, d, h) {
    if (action === 'contract-signature-send') {
      var c = (d.doctor_contracts || []).filter(function (x) { return x.id === id; })[0]; if (!c) return true;
      var grp = (d.doctor_contracts || []).filter(function (x) { return x.doctor_key === c.doctor_key && x.reference === c.reference && x.status === 'active'; });
      var pending = (d.doctor_contracts || []).some(function (x) { return x.doctor_key === c.doctor_key && x.reference === c.reference && x.status === 'pending'; });
      var prev = info && info.contracts && info.contracts[id];
      h.modal('إرسال للتوقيع — ' + c.doctor_name,
        '<p class="fc-note">هيتبعت للدكتور (من حسابه المربوط بكوده ' + esc(c.doctor_key) + ') عقد بنص العقد المنشور حاليًا + جدول بالعقود المعتمدة دي (' + grp.length + '): ' + esc(grp.map(function (x) { return h.esc(x.service_scope) + ' ' + h.money(x.rate) + '%'; }).join('، ')) + '. المرجع: ' + esc(c.reference) + '.</p>' +
        (pending ? '<p class="fc-note">تنبيه: في عقود لسه قيد الاعتماد بنفس المرجع؛ لازم تتعتمد قبل الإرسال.</p>' : '') +
        (prev && prev.state === 'pending' ? '<p class="fc-note">في طلب سابق بانتظار الدكتور؛ الإرسال الجديد هيلغيه.</p>' : ''),
        function (v, k) { return window.SSMPDDb.client.rpc('clinic_finance_contract_signature_command', { p_action: 'send', p_payload: { doctor_key: c.doctor_key, reference: c.reference }, p_token: k }).then(function (r) { if (r.error) throw r.error; return r.data; }); });
      return true;
    }
    if (action === 'contract-template-edit') { editor(id, d); return true; }
    if (action === 'contract-signed-view') { signedView(id).catch(function (e) { h.modal('تعذر العرض', '<p class="fc-note">' + esc((e && e.message) || '') + '</p>', function () { return Promise.resolve(); }); }); return true; }
    if (action === 'contract-enforcement-save') {
      var inp = document.querySelector('[data-enf-rule="' + id + '"]'); if (!inp) return true;
      cmd('set_enforcement', { rule: id, start_date: inp.value || null }, newToken()).then(function () { return refresh(); }).then(function () { paint(d); }, function (e) { h.modal('تعذر الحفظ', '<p class="fc-note">' + esc((e && e.message) || '') + '</p>', function () { return Promise.resolve(); }); });
      return true;
    }
    return prior.act(action, id, d, h);
  }
  window.SSMPDContractSignature = { refresh: refresh, stateText: stateText };
  window.SSMPDFinanceControls = { panel: panel, act: act, due: prior.due };
})();
