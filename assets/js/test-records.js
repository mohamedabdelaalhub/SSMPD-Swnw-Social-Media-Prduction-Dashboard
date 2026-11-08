/* «سجلات تجريبية» — OWNER-ONLY panel (super_admin) to flag a record as «تجريبي» and then delete it safely.
   Card in the admin area (above «كل المستخدمين»). Everything is enforced by the database (migration 20261109110000_test_record_delete.sql, not applied until the owner approves):
   only the owner role, only records carrying a «تجريبي» flag, a full archive copy before the delete, refusal when the record is tied to payments/payouts/claims/stock/closed periods.
   This file only shows the owner what will happen and sends the typed confirmations. If the migration is missing the panel says so and does nothing. */
(function () {
  'use strict';
  if (window.__SWNWTestRecords) return;
  window.__SWNWTestRecords = true;

  var TYPES = [['invoice', 'فاتورة'], ['doctor_contract', 'عقد دكتور'], ['doctor_key', 'دكتور تجريبي كامل (كل عقوده ومستحقاته)'], ['inventory_item', 'صنف مخزون'], ['pricing_supply', 'مستلزم تسعير']];
  var TNAME = { invoice: 'فاتورة', doctor_contract: 'عقد دكتور', doctor_key: 'دكتور كامل', inventory_item: 'صنف مخزون', pricing_supply: 'مستلزم تسعير' };
  var TABLES = { 'clinic_finance.invoices': 'فاتورة', 'clinic_finance.entries': 'قيد يومية', 'clinic_finance.lines': 'سطر قيد', 'clinic_finance.audit': 'سجل مراجعة', 'clinic_finance.doctor_accruals': 'مستحق دكتور',
    'clinic_finance.doctor_allocations': 'توزيع أتعاب', 'clinic_finance.doctor_allocation_lines': 'سطر توزيع أتعاب', 'clinic_finance.doctor_extra_allocations': 'مؤدٍّ إضافي', 'clinic_finance.channel_allocations': 'توزيع قناة',
    'clinic_finance.doctor_contracts': 'عقد دكتور', 'public.inventory_items': 'صنف مخزون', 'clinic_reception.items': 'صنف استقبال', 'public.inventory_alerts': 'تنبيه مخزون', 'public.inventory_price_history': 'سجل أسعار',
    'clinic_finance.inventory_catalog_prices': 'سعر مرجعي', 'public.pricing_supplies': 'مستلزم تسعير' };
  var scheduled = false;

  function e(v) { return String(v == null ? '' : v).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function isOwner() {
    var a = window.SSMPDAuth && window.SSMPDAuth.currentAdmin;
    if (!a) return false;
    return a.role === 'super_admin' || (Array.isArray(a.roles) && a.roles.indexOf('super_admin') !== -1);
  }
  function msg(err) {
    var m = String((err && err.message) || err || '');
    if (/Could not find the function|does not exist|404|PGRST202/i.test(m)) return 'الميزة لم تُفعَّل بعد على قاعدة البيانات (مستني موافقة المالك على تحديث القاعدة).';
    return m.replace(/^.*?(ERROR:\s*)/, '') || 'حصل خطأ غير متوقع';
  }
  function date(x) { return x ? String(x).slice(0, 10) : ''; }
  function counts(c) {
    var parts = Object.keys(c || {}).map(function (k) { return (TABLES[k] || k) + ': ' + c[k]; });
    return parts.length ? parts.join(' — ') : 'لا شيء';
  }

  function open() {
    var db = window.SSMPDDb;
    if (!db || document.querySelector('[data-test-records-modal]')) return;
    var st = { type: 'invoice', q: '', results: null, scan: null, ov: null, notice: '', error: '', busy: false, openDelete: null };
    var bd = document.createElement('div'); bd.className = 'modal-backdrop'; bd.setAttribute('data-test-records-modal', '1');
    var box = document.createElement('div'); box.className = 'modal'; box.setAttribute('role', 'dialog'); box.setAttribute('aria-label', 'سجلات تجريبية');
    bd.appendChild(box); document.body.appendChild(bd);
    bd.addEventListener('click', function (ev) { if (ev.target === bd) bd.remove(); });

    function say(n, er) { st.notice = n || ''; st.error = er || ''; }
    function load() {
      return db.financeTestOverview().then(function (r) { st.ov = r; }).catch(function (er) { st.ov = null; st.error = msg(er); });
    }
    function scanBlock(sc, ctx) {
      var h = '';
      if (!sc.exists) return '<p class="muted">السجل غير موجود.</p>';
      h += '<p><strong>' + e(sc.label) + '</strong></p><p class="muted">هيتمسح لو اتحذف: ' + e(counts(sc.counts)) + '</p>';
      if ((sc.blockers || []).length) {
        h += '<div role="alert" data-tr-blockers style="background:#fff0ef;border:1px solid #f0b4ae;border-radius:10px;padding:8px 12px;margin:6px 0;color:#9f2d20;"><strong>مرفوض — السجل مرتبط بنشاط حقيقي:</strong><ul style="margin:4px 0 0;padding-inline-start:18px;">' +
          sc.blockers.map(function (b) { return '<li>' + e(b.label) + ' (' + e(b.count) + ')</li>'; }).join('') + '</ul></div>';
      }
      return h;
    }
    function render() {
      var h = '<div class="modal-head"><h3>🧪 سجلات تجريبية — حذف آمن</h3><button class="btn" type="button" data-tr-close aria-label="إغلاق">إغلاق</button></div>';
      h += '<div style="padding:0 4px 8px;display:grid;gap:12px;max-height:72vh;overflow:auto;">';
      h += '<p class="muted" style="line-height:1.8;margin:0;">الخطوة ١: علّم السجل «تجريبي» (بسبب وتأكيد). الخطوة ٢: احذفه من قايمة المعلَّمة. قبل أي حذف بيتنسخ كل السجل كامل في أرشيف محفوظ (مين، إمتى، ليه، إيه). ' +
        'أي سجل مش معلَّم «تجريبي» مش بيتحذف أبدًا، وأي سجل عليه دفع أو صرف أو تأمين أو حركة مخزون بيترفض.</p>';
      if (st.error) h += '<div role="alert" data-tr-error style="background:#fff0ef;border:1px solid #f0b4ae;border-radius:10px;padding:8px 12px;color:#9f2d20;">' + e(st.error) + '</div>';
      if (st.notice) h += '<div role="status" data-tr-notice style="background:#eefbf3;border:1px solid #a6e4bf;border-radius:10px;padding:8px 12px;color:#116a3a;">' + e(st.notice) + '</div>';

      // ---- 1. find + flag
      h += '<div class="section" data-tr-find><h4 style="margin:0 0 8px;">١) تعليم سجل كتجريبي</h4><form data-tr-search style="display:flex;gap:8px;flex-wrap:wrap;align-items:end;">' +
        '<label class="field" style="flex:1;min-width:150px;">نوع السجل<select name="type">' + TYPES.map(function (t) { return '<option value="' + t[0] + '"' + (t[0] === st.type ? ' selected' : '') + '>' + e(t[1]) + '</option>'; }).join('') + '</select></label>' +
        '<label class="field" style="flex:2;min-width:180px;">بحث (اسم / رقم / مرجع)<input name="q" value="' + e(st.q) + '" autocomplete="off"></label><button class="btn" type="submit"' + (st.busy ? ' disabled' : '') + '>بحث</button></form>';
      if (st.results) {
        h += st.results.length ? '<div data-tr-results style="margin-top:8px;display:grid;gap:6px;">' + st.results.map(function (r) {
          return '<div style="display:flex;gap:8px;align-items:center;justify-content:space-between;border:1px solid #dfe6f2;border-radius:10px;padding:6px 10px;"><div><strong>' + e(r.label) + '</strong><br><small class="muted">' + e(r.sub) + '</small></div>' +
            (r.flagged ? '<span class="badge" data-tr-flagged>معلَّم تجريبي</span>' : '<button class="btn" type="button" data-tr-scan="' + e(r.key) + '">فحص</button>') + '</div>';
        }).join('') + '</div>' : '<p class="muted" data-tr-empty>مفيش نتائج.</p>';
      }
      if (st.scan) {
        var sc = st.scan, can = sc.exists && !sc.flagged && !(sc.blockers || []).length;
        h += '<div data-tr-scan-box style="margin-top:10px;border-top:1px dashed #dfe6f2;padding-top:8px;">' + scanBlock(sc);
        if (sc.flagged) h += '<p class="muted">السجل معلَّم تجريبي بالفعل — احذفه من القايمة تحت.</p>';
        if (can) h += '<form data-tr-flag style="display:grid;gap:8px;"><label class="field">سبب اعتباره تجريبيًا<input name="reason" required minlength="5" maxlength="300" placeholder="مثال: فاتورة تجربة عملها المحاسب"></label>' +
          '<label class="field">اكتب كلمة «تجريبي» للتأكيد<input name="confirm" required autocomplete="off"></label><button class="btn" type="submit"' + (st.busy ? ' disabled' : '') + '>علّم كتجريبي</button></form>';
        h += '</div>';
      }
      h += '</div>';

      // ---- 2. flagged records
      h += '<div class="section" data-tr-flags><h4 style="margin:0 0 8px;">٢) السجلات المعلَّمة «تجريبي»</h4>';
      if (!st.ov) h += '<p class="muted">' + (st.error ? '' : 'جاري التحميل…') + '</p>';
      else if (!st.ov.flags.length) h += '<p class="muted" data-tr-noflags>مفيش سجلات معلَّمة دلوقتي.</p>';
      else h += st.ov.flags.map(function (f) {
        var sc = f.scan || {}, k = f.type + '|' + f.key, blocked = (sc.blockers || []).length > 0 || !sc.exists;
        return '<div data-tr-flag-row="' + e(k) + '" style="border:1px solid #dfe6f2;border-radius:12px;padding:8px 12px;margin-bottom:8px;"><div><span class="badge">' + e(TNAME[f.type] || f.type) + '</span> ' + scanBlock(sc, f) +
          '<small class="muted">علّمه ' + e(f.flagged_by || '—') + ' في ' + e(date(f.flagged_at)) + ' — السبب: ' + e(f.reason) + '</small></div>' +
          '<div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:8px;">' +
          '<button class="btn" type="button" data-tr-del-open="' + e(k) + '"' + (blocked ? ' disabled title="مرتبط بنشاط حقيقي"' : '') + '>حذف نهائي (مع أرشفة)</button>' +
          '<button class="btn" type="button" data-tr-unflag="' + e(k) + '">إلغاء علامة تجريبي</button></div>' +
          (st.openDelete === k && !blocked ? '<form data-tr-delete="' + e(k) + '" style="display:grid;gap:8px;margin-top:8px;"><label class="field">سبب الحذف<input name="reason" required minlength="5" maxlength="300"></label>' +
            '<label class="field">اكتب كلمة «حذف» للتأكيد (مفيش رجوع من الشاشة؛ النسخة محفوظة في الأرشيف)<input name="confirm" required autocomplete="off"></label><button class="btn" type="submit"' + (st.busy ? ' disabled' : '') + '>تأكيد الحذف</button></form>' : '') + '</div>';
      }).join('');
      h += '</div>';

      // ---- 3. history
      h += '<div class="section" data-tr-history><h4 style="margin:0 0 8px;">٣) آخر عمليات الحذف (الأرشيف)</h4>';
      if (st.ov && st.ov.deletions.length) h += st.ov.deletions.map(function (d) {
        return '<div style="border-bottom:1px solid #eef2f8;padding:6px 0;"><strong>' + e(d.label) + '</strong> <span class="badge">' + e(TNAME[d.type] || d.type) + '</span><br><small class="muted">' + e(date(d.deleted_at)) + ' — ' + e(d.deleted_by || '—') + ' — السبب: ' + e(d.reason) + ' — اتمسح: ' + e(counts(d.counts)) + '</small></div>';
      }).join('');
      else h += '<p class="muted">لسه ما اتحذفش حاجة.</p>';
      h += '</div></div>';
      box.innerHTML = h;
    }

    function run(p, ok) {
      st.busy = true; say('', ''); render();
      return p.then(function (r) { st.busy = false; if (ok) ok(r); return load(); }).catch(function (er) { st.busy = false; say('', msg(er)); }).then(render);
    }
    function split(k) { var i = k.indexOf('|'); return [k.slice(0, i), k.slice(i + 1)]; }

    box.addEventListener('click', function (ev) {
      var t = ev.target; if (!t || !t.closest) return;
      if (t.closest('[data-tr-close]')) { bd.remove(); return; }
      var b;
      if ((b = t.closest('[data-tr-scan]'))) { run(db.financeTestScan(st.type, b.getAttribute('data-tr-scan')), function (sc) { st.scan = sc; st.scan.key = b.getAttribute('data-tr-scan'); }); return; }
      if ((b = t.closest('[data-tr-del-open]'))) { st.openDelete = b.getAttribute('data-tr-del-open'); render(); return; }
      if ((b = t.closest('[data-tr-unflag]'))) {
        var k = split(b.getAttribute('data-tr-unflag')), why = window.prompt('سبب إلغاء علامة «تجريبي» (٥ حروف على الأقل)');
        if (!why) return;
        run(db.financeTestUnflag(k[0], k[1], why), function () { say('اتلغت علامة «تجريبي». السجل رجع عادي ومش هيتحذف.', ''); });
      }
    });
    box.addEventListener('submit', function (ev) {
      var f = ev.target; ev.preventDefault(); if (!f || !f.getAttribute) return;
      if (f.hasAttribute('data-tr-search')) {
        st.type = f.elements.type.value; st.q = f.elements.q.value; st.scan = null; st.results = null;
        run(db.financeTestFind(st.type, st.q), function (r) { st.results = r || []; });
      } else if (f.hasAttribute('data-tr-flag')) {
        var sc = st.scan;
        run(db.financeTestFlag(st.type, sc.key, f.elements.reason.value, f.elements.confirm.value), function () { st.scan = null; st.results = null; say('اتعلّم السجل «تجريبي». تقدر تحذفه من قايمة السجلات المعلَّمة.', ''); });
      } else if (f.hasAttribute('data-tr-delete')) {
        var k = split(f.getAttribute('data-tr-delete'));
        run(db.financeTestDelete(k[0], k[1], f.elements.reason.value, f.elements.confirm.value), function () { st.openDelete = null; st.scan = null; st.results = null; say('اتحذف السجل بعد ما اتنسخ كامل في الأرشيف.', ''); });
      }
    });
    render(); load().then(render);
  }

  function addCard() {
    if (!isOwner()) return;
    var users = document.getElementById('admin-users');
    if (!users || document.querySelector('[data-test-records-card]')) return;
    var card = document.createElement('div'); card.className = 'section'; card.setAttribute('data-test-records-card', '1');
    card.innerHTML = '<div style="display:flex;align-items:center;justify-content:space-between;gap:14px;flex-wrap:wrap;"><div><h3 style="margin:0 0 5px;">سجلات تجريبية — حذف آمن (للمالك فقط)</h3>' +
      '<p style="margin:0;color:var(--c-muted);font-size:12px;line-height:1.6;">علّم فاتورة أو عقد أو صنف مخزون كـ«تجريبي» ثم احذفه، مع نسخة كاملة في الأرشيف. مفيش حذف لأي حاجة مش معلَّمة، ولا لأي حاجة عليها دفع أو صرف.</p></div>' +
      '<button class="btn" type="button" data-test-records-open>فتح</button></div>';
    users.parentNode.insertBefore(card, users);
    card.querySelector('[data-test-records-open]').onclick = open;
  }
  function schedule() { if (scheduled) return; scheduled = true; requestAnimationFrame(function () { scheduled = false; addCard(); }); }
  function start() { addCard(); var root = document.getElementById('app-root') || document.body; new MutationObserver(schedule).observe(root, { childList: true, subtree: true }); }
  window.SSMPDTestRecords = { open: open, isOwner: isOwner };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start, { once: true }); else start();
})();
