/* Online doctor contracts, accountant side (separate file; chains onto SSMPDFinanceControls like finance-channels.js, does not touch finance-doctors.js or db.js).
   - next to each doctor's group of ACTIVE contracts (same reference): «إرسال للتوقيع» (creates a signature request for that doctor + contract set + current published template version)
   - on each contract row: «وافق الطبيب بتاريخ …» / «بانتظار موافقة الطبيب» / «رفض: السبب» / «النص اتغيّر — أعد الإرسال»  (a recorded status only; accruals are NOT affected)
   - a small block for the published contract / consent texts, with «نشر نص جديد» for the financial manager (the lawyer's final wording goes in here)
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
    if (!info || !groups.length) { if (info) templates(d, root); return; }
    var map = info.contracts || {};
    [].forEach.call(groups, function (g, gi) {
      var key = keys[gi]; if (!key) return;
      var cs = (d.doctor_contracts || []).filter(function (c) { return c.doctor_key === key; });
      var rows = g.querySelectorAll('tbody tr');
      [].forEach.call(rows, function (tr, ri) {
        var c = cs[ri], s = c && map[c.id]; if (!s || !tr.children[5]) return;
        var el = document.createElement('small'); el.className = 'fc-sig-state'; el.setAttribute('data-sig-state', s.state); el.style.display = 'block'; el.textContent = stateText(s);
        tr.children[5].appendChild(el);
      });
      if (d.can_create) {
        var sum = g.querySelector('summary');
        groupsOf(cs).forEach(function (gr) {
          var b = document.createElement('button'); b.type = 'button'; b.className = 'btn ghost sm fc-sig-btn'; b.setAttribute('data-fin-action', 'contract-signature-send'); b.setAttribute('data-id', gr.contracts[0].id);
          b.textContent = 'إرسال للتوقيع' + (groupsOf(cs).length > 1 ? ' (' + gr.reference + ')' : '');
          if (sum) sum.appendChild(b);
        });
      }
    });
    templates(d, root);
  }
  function templates(d, root) {
    var host = root.querySelector('.fc-doctor-group'); host = host && host.parentNode; if (!host || !info) return;
    var list = info.templates || [], cur = {};
    list.forEach(function (t) { if (t.published && !cur[t.kind]) cur[t.kind] = t; });
    var box = document.createElement('div'); box.setAttribute('data-sig-templates', 'yes'); box.className = 'fc-note';
    box.innerHTML = '<h4>نصوص العقد الإلكتروني</h4>' + ['contract', 'consent'].map(function (k) {
      var t = cur[k]; return '<p><strong>' + KIND[k] + ':</strong> ' + (t ? 'المنشور: نسخة ' + t.version + ' — ' + esc(t.title) : 'لا يوجد نص منشور — لا يمكن إرسال عقود للتوقيع قبل نشره') +
        (d.can_review ? ' <button type="button" class="btn ghost sm" data-fin-action="contract-template-publish" data-id="' + k + '">نشر نص جديد</button>' : '') + '</p>';
    }).join('') + (list.some(function (t) { return t.placeholder && !t.published; }) ? '<p><small>النصوص المبدئية الموجودة مجرد مسودة بانتظار المستشار القانوني ولا تُعرض للأطباء قبل نشرها.</small></p>' : '');
    host.insertBefore(box, host.firstChild);
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
    if (action === 'contract-template-publish') {
      var kind = id;
      h.modal('نشر ' + KIND[kind] + ' جديد',
        '<p class="fc-note">النص هيتنشر كنسخة جديدة، وأي طلب توقيع لسه معلّق على نسخة أقدم هيحتاج إعادة إرسال. في نص العقد تقدر تستخدم: {{doctor_name}} {{doctor_key}} {{reference}} {{template_version}}.</p>' +
        h.field('title', 'عنوان النص') + '<label class="fc-field">النص<textarea name="body" rows="12" required minlength="20"></textarea></label>',
        function (v, k) { return window.SSMPDDb.client.rpc('clinic_finance_contract_signature_command', { p_action: 'template_publish', p_payload: { kind: kind, title: v.title, body: v.body }, p_token: k }).then(function (r) { if (r.error) throw r.error; return r.data; }); });
      return true;
    }
    return prior.act(action, id, d, h);
  }
  window.SSMPDContractSignature = { refresh: refresh, stateText: stateText };
  window.SSMPDFinanceControls = { panel: panel, act: act, due: prior.due };
})();
