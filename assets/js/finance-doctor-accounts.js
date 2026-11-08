/* «حساب الأطباء» tab + HR staff picker for the doctor contract form.
   - New finance tab "doctor-accounts" (registered in finance-cash.js, group "الصرف والمستحقات"): lists ONLY doctors that have an account, with balance / payable now / waiting for collection,
     a click opens the existing doctor statement (action "doctor-statement" of finance-doctors.js, nothing re-implemented here).
   - Contract form: «كود الطبيب الثابت» is no longer typed; a picker of HR staff fills code + name (manual entry stays as an explicit fallback for doctors that are not in HR).
   - "Doctors needing a contract": HR doctors with no pending/active contract, with a button that opens the contract form prefilled.
   Read-only: uses db.financeDoctorAccounts() / db.financeHrStaff() (migration 20261108270000, not applied until the owner approves). Chains onto SSMPDFinanceControls like finance-channels.js does. */
(function () {
  'use strict';
  var prior = window.SSMPDFinanceControls;
  if (!prior) return;
  var TTL = 30000, TAB = 'doctor-accounts';
  var cache = null, cacheAt = 0, loading = false /* in-flight promise or false */, filterKey = 'all', nameFilter = '', presetPerson = null;
  var STATUS = { active: 'نشط', on_leave: 'في إجازة', needs_setup: 'يحتاج إعداد', ended: 'منتهي' };
  var KIND = { doctor: 'طبيب', both: 'طبيب وموظف', employee: 'موظف', unclassified: 'غير مصنف' };

  function db() { return window.SSMPDDb; }
  function call(name) {
    var d = db();
    if (!d || typeof d[name] !== 'function') return Promise.resolve({ ok: false, missing: true });
    return Promise.resolve().then(function () { return d[name](); }).then(function (v) { return { ok: true, v: v || {} }; }, function (e) { return { ok: false, error: e }; });
  }
  function sig(c) { return JSON.stringify([c.acc.ok && c.acc.v.doctors, c.hr.ok && c.hr.v.people, c.acc.ok, c.hr.ok]); }

  /** Re-draw the finance section through the workspace's own navigation (buttons get bound by the workspace). Never while a dialog is open. */
  function redraw(tabId) {
    var cash = window.SSMPDFinanceCash;
    if (!cash || typeof cash.navigate !== 'function' || document.querySelector('.fc-modal')) return;
    if (!document.querySelector('[data-da-tab="' + tabId + '"]')) return;
    cash.navigate(tabId);
  }
  /** One request at a time; resolves with {changed}. */
  function fetchAll() {
    if (loading) return loading;
    loading = Promise.all([call('financeDoctorAccounts'), call('financeHrStaff')]).then(function (r) {
      var next = { acc: r[0], hr: r[1] }, changed = !cache || sig(next) !== sig(cache);
      cache = next; cacheAt = Date.now(); loading = false;
      paintBadges();
      return { changed: changed };
    }, function () { loading = false; return { changed: false }; });
    return loading;
  }
  function ensure(tabId, force) {
    if (loading) return;
    if (!force && cache && Date.now() - cacheAt < TTL) return;
    fetchAll().then(function (r) { if (r.changed || force) redraw(tabId); });
  }

  /* ---- notification badge: number of HR doctors without a contract.
     Loaded once when the finance entry first appears, then at most once per hour (HOUR timer below, nothing shorter, no realtime), and re-read after a contract is created (see act). */
  var HOUR = 60 * 60 * 1000, started = false;
  var BADGE_HOSTS = '#tabs-bar [data-tab="accounting"],[data-goto="accounting"],[data-fc-group="dues"],[data-fc-tab="doctor-accounts"]';
  function needCount() { return cache && cache.hr.ok ? doctorsNeedingContract().length : 0; }
  function paintBadges() {
    var n = needCount(), hosts = document.querySelectorAll(BADGE_HOSTS);
    [].forEach.call(hosts, function (host) {
      var b = host.querySelector(':scope > [data-da-badge]');
      if (!n) { if (b) b.remove(); return; }
      if (!b) {
        b = document.createElement('span'); b.setAttribute('data-da-badge', '');
        b.setAttribute('style', 'display:inline-block;background:#D0402A;color:#fff;border-radius:10px;font-size:11px;line-height:1.4;padding:0 6px;margin-inline-start:6px;font-weight:600');
        host.appendChild(b);
      }
      var t = n > 99 ? '99+' : String(n), label = n + ' طبيب في الموارد البشرية ملهمش عقد';
      if (b.textContent !== t) b.textContent = t;
      if (b.getAttribute('title') !== label) { b.setAttribute('title', label); b.setAttribute('aria-label', label); }
    });
  }
  var painting = false;
  function onDomChange() {
    if (painting) return; painting = true;
    Promise.resolve().then(function () {
      painting = false;
      if (!started && document.querySelector('#tabs-bar [data-tab="accounting"],[data-goto="accounting"]')) { started = true; fetchAll(); }
      paintBadges();
    });
  }
  if (typeof MutationObserver === 'function' && document.body) new MutationObserver(onDomChange).observe(document.body, { childList: true, subtree: true });
  setInterval(function () { if (started && document.querySelector('#tabs-bar [data-tab="accounting"],[data-goto="accounting"]')) fetchAll(); }, HOUR);
  onDomChange();

  function doctorsNeedingContract() {
    if (!cache || !cache.hr.ok) return [];
    return (cache.hr.v.people || []).filter(function (p) { return p.needs_contract && (p.kind === 'doctor' || p.kind === 'both'); });
  }
  function needsHtml(d, h) {
    var list = doctorsNeedingContract(), e = h.esc, b = h.btn;
    if (!list.length) return '';
    return '<div class="fc-da-needs" data-da-needs><h4>أطباء مسجلين في الموارد البشرية وملهمش عقد (' + list.length + ')</h4><p class="fc-note">الأطباء دول اتسجلوا في الموارد البشرية ولسه مفيش لهم عقد أتعاب. اضغط «إعداد عقد» يفتح نموذج العقد باسمهم وكودهم جاهزين، وتكمّل القسم والخدمات والنسبة.</p>' +
      h.table(['الطبيب', 'الكود في الموارد البشرية', 'القسم', 'الوظيفة', 'الحالة', 'الإجراء'], list.map(function (p) {
        return [e(p.full_name), e(p.contract_key), e(p.department || '—'), e(p.job_title || '—'), e(STATUS[p.status] || p.status), d.can_create ? b('doctor-contract-for', p.person_id, 'إعداد عقد') : 'تحتاج صلاحية الإنشاء'];
      })) + '</div>';
  }

  function accountsRows(rows, h, d) {
    var e = h.esc, b = h.btn, m = h.money;
    return h.table(['الطبيب', 'الكود', 'الرصيد', 'مستحق للصرف الآن', 'بانتظار التحصيل', 'طلبات صرف معلّقة', 'المصروف', 'الإجراء'], rows.map(function (r) {
      var wait = m(r.waiting) + (Number(r.waiting_invoices) ? ' <small>(' + Number(r.waiting_invoices) + ' فاتورة)</small>' : '');
      return [b('doctor-statement', r.doctor_key, r.doctor_name || r.doctor_key) + (r.has_active_contract ? '' : ' <small>بدون عقد معتمد</small>'), e(r.doctor_key), m(r.balance), '<strong>' + m(r.payable_now) + '</strong>', wait, m(r.pending_payouts), m(r.paid_out), b('doctor-statement', r.doctor_key, 'فتح الحساب') + (d && d.can_create ? ' ' + b('doctor-dues', r.doctor_key, 'صرف بالفواتير') : '')];
    }));
  }
  function accountsPanel(d, h) {
    var e = h.esc, m = h.money, b = h.btn;
    ensure(TAB);
    var html = '<div data-da-tab="' + TAB + '"><p>الأطباء اللي ليهم حساب فعلي بس (أتعاب مستحقة أو مصروفات أو رصيد افتتاحي أو رصيد غير صفر). اضغط على اسم الطبيب لفتح كشف حسابه بالتفصيل. «مستحق للصرف الآن» = الرصيد بعد خصم أتعاب الفواتير اللي لسه ماتسددتش بالكامل، وهو نفس الرقم في كشف الدكتور.</p><div class="fc-actions">' +
      b('doctor-accounts-refresh', '', 'تحديث') + (d.can_create ? b('open-disbursement', 'doctor_payment', 'طلب صرف مستحقات') : '') + '</div>';
    if (!cache) return html + '<p role="status">جاري تحميل حسابات الأطباء…</p></div>';
    if (!cache.acc.ok) {
      var em = String((cache.acc.error && cache.acc.error.message) || ''), denied = /صلاحية|permission|42501/i.test(em);
      return html + '<p role="alert">' + (denied ? e(em) : 'تعذر تحميل حسابات الأطباء. الميزة تحتاج تطبيق تحديث قاعدة البيانات أولًا.') + '</p></div>';
    }
    var rows = cache.acc.v.doctors || [], now = rows.reduce(function (s, r) { return s + Number(r.payable_now || 0); }, 0), wait = rows.reduce(function (s, r) { return s + Number(r.waiting || 0); }, 0),
      owed = rows.filter(function (r) { return Number(r.payable_now) > 0; }).length;
    html += '<div class="fc-st-cards"><div class="fc-st-card"><span>عدد الأطباء اللي ليهم حساب</span><strong>' + rows.length + '</strong></div><div class="fc-st-card ok"><span>مستحق للصرف الآن (' + owed + ' طبيب)</span><strong>' + m(now) + '</strong></div><div class="fc-st-card wait"><span>بانتظار التحصيل</span><strong>' + m(wait) + '</strong></div></div>';
    html += '<div class="fc-filter-bar">' + [['all', 'الكل (' + rows.length + ')'], ['owed', 'ليهم مستحق الآن (' + owed + ')'], ['waiting', 'عندهم أتعاب بانتظار التحصيل']].map(function (c) {
      return '<button type="button" class="btn ghost sm fc-chip' + (filterKey === c[0] ? ' active' : '') + '" data-da-filter="' + c[0] + '">' + e(c[1]) + '</button>';
    }).join(' ') + '<input type="search" class="fc-name-filter" data-da-name placeholder="بحث باسم الدكتور أو كوده" value="' + e(nameFilter) + '"></div>';
    html += '<div class="fc-da-table">' + (rows.length ? accountsRows(rows, h, d) : '<p>مفيش أطباء ليهم حساب لسه.</p>') + '</div>';
    html += needsHtml(d, h);
    Promise.resolve().then(applyFilter);
    return html + '</div>';
  }

  function applyFilter() {
    if (!cache || !cache.acc.ok) return;
    var by = {};
    (cache.acc.v.doctors || []).forEach(function (r) { by[r.doctor_key] = r; });
    var q = String(nameFilter || '').trim().toLowerCase();
    [].forEach.call(document.querySelectorAll('.fc-da-table tbody tr'), function (tr) {
      var btn = tr.querySelector('[data-id]'), r = btn && by[btn.getAttribute('data-id')];
      if (!r) return;
      var ok = filterKey === 'all' || (filterKey === 'owed' && Number(r.payable_now) > 0) || (filterKey === 'waiting' && Number(r.waiting) > 0);
      if (ok && q) ok = (String(r.doctor_name || '') + ' ' + r.doctor_key).toLowerCase().indexOf(q) >= 0;
      tr.hidden = !ok;
    });
    [].forEach.call(document.querySelectorAll('[data-da-filter]'), function (c) { c.classList.toggle('active', c.getAttribute('data-da-filter') === filterKey); });
  }
  if (!window.__fcDoctorAccountsBound) {
    window.__fcDoctorAccountsBound = true;
    document.addEventListener('click', function (ev) {
      var c = ev.target && ev.target.closest && ev.target.closest('[data-da-filter]');
      if (c) { filterKey = c.getAttribute('data-da-filter'); applyFilter(); }
    });
    document.addEventListener('input', function (ev) {
      if (ev.target && ev.target.hasAttribute && ev.target.hasAttribute('data-da-name')) { nameFilter = ev.target.value; applyFilter(); }
    });
  }

  function panel(tab, d, h) {
    if (tab === TAB) return accountsPanel(d, h);
    var html = prior.panel(tab, d, h);
    if (tab !== 'doctors') return html;
    ensure('doctors');
    return '<div data-da-tab="doctors" hidden></div>' + needsHtml(d, h) + html;
  }

  /* ---- contract form: HR picker instead of a typed code ---- */
  function staffOptionLabel(p) {
    return p.full_name + ' — ' + p.contract_key + (p.department ? ' (' + p.department + ')' : '') + (p.needs_contract ? ' — بدون عقد' : ' — له عقد');
  }
  function enhanceContractForm(h) {
    var form = document.querySelector('.fc-modal form');
    if (!form || !form.elements.doctor_key || !form.elements.doctor_name || form.querySelector('[data-hr-picker]')) return;
    var keyIn = form.elements.doctor_key, nameIn = form.elements.doctor_name, keyLabel = keyIn.closest('label');
    var wrap = document.createElement('div');
    wrap.innerHTML = '<label class="fc-field">اختر الطبيب من الموارد البشرية<select data-hr-picker><option value="">جاري تحميل الموظفين…</option></select></label>' +
      '<label class="fc-check"><input type="checkbox" data-hr-all>عرض باقي الموظفين (ممرضين وغيرهم وغير المصنفين)</label><p class="fc-note" data-hr-note>الكود والاسم بيتملوا تلقائيًا من ملف الموظف في الموارد البشرية.</p>';
    keyLabel.before(wrap);
    var sel = wrap.querySelector('select'), all = wrap.querySelector('[data-hr-all]'), note = wrap.querySelector('[data-hr-note]'), people = [];
    function lock(on) { keyIn.readOnly = on; nameIn.readOnly = on; }
    function fill() {
      var keep = sel.value, list = people.filter(function (p) { return all.checked || p.kind === 'doctor' || p.kind === 'both'; });
      list.sort(function (a, b) { return (b.needs_contract ? 1 : 0) - (a.needs_contract ? 1 : 0) || String(a.full_name).localeCompare(String(b.full_name), 'ar'); });
      sel.innerHTML = '<option value="">اختر الطبيب</option>' + list.map(function (p) { return '<option value="' + h.esc(p.person_id) + '">' + h.esc(staffOptionLabel(p)) + '</option>'; }).join('') + '<option value="__manual">غير مسجل في الموارد البشرية — كتابة الكود والاسم يدويًا</option>';
      if (keep) sel.value = keep;
      pick();
    }
    function pick() {
      var p = people.filter(function (x) { return x.person_id === sel.value; })[0];
      if (p) { keyIn.value = p.contract_key; nameIn.value = p.full_name; lock(true); note.textContent = 'الكود ' + p.contract_key + (p.doctor_key ? ' (مربوط بالموارد البشرية)' : ' (كود الموظف في الموارد البشرية)') + (p.needs_contract ? '' : ' — للطبيب عقود موجودة بالفعل، العقد الجديد يتضاف عليها.'); }
      else if (sel.value === '__manual') { lock(false); note.textContent = 'اكتب كود الطبيب واسمه يدويًا. الأفضل تسجيله في الموارد البشرية أولًا.'; }
      else { keyIn.value = ''; nameIn.value = ''; lock(true); note.textContent = 'اختر الطبيب لتعبئة الكود والاسم.'; }
    }
    sel.onchange = pick; all.onchange = fill;
    lock(true);
    function ready() {
      if (!form.isConnected) return;
      if (!cache || !cache.hr.ok) { sel.innerHTML = '<option value="__manual">كتابة الكود والاسم يدويًا</option>'; sel.value = '__manual'; note.textContent = 'تعذر تحميل قائمة الموارد البشرية (الميزة تحتاج تطبيق تحديث قاعدة البيانات). اكتب الكود والاسم يدويًا.'; lock(false); return; }
      people = (cache.hr.v.people || []).filter(function (p) { return p.status !== 'ended'; });
      if (presetPerson) { var pp = people.filter(function (x) { return x.person_id === presetPerson; })[0]; if (pp && pp.kind !== 'doctor' && pp.kind !== 'both') all.checked = true; }
      fill();
      if (presetPerson) { sel.value = presetPerson; presetPerson = null; pick(); }
    }
    if (cache && Date.now() - cacheAt < TTL) ready();
    else fetchAll().then(ready, ready);
  }

  function act(action, id, d, h) {
    if (action === 'doctor-contract-for') { presetPerson = id; return act('doctor-contract', '', d, h); }
    if (action === 'doctor-contract') {
      var handled = prior.act(action, id, d, h);
      cacheAt = 0; // the HR "needs a contract" list must be re-read after a contract is saved
      if (handled) enhanceContractForm(h);
      return handled;
    }
    if (action === 'doctor-accounts-refresh') { ensure(TAB, true); return true; }
    return prior.act(action, id, d, h);
  }
  window.SSMPDDoctorAccounts = { needing: doctorsNeedingContract };
  window.SSMPDFinanceControls = { panel: panel, act: act, due: prior.due };
})();
