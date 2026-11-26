/* HR — «مهمة خارجية» UI (help 301, mockup docs/ui-references/mockups/hr-external-mission.html, owner-approved 2026-11-26).
   Server: public.hr_mission(p_action, p_payload) from PR #893 — workspace / create / review / cancel / add_travel / travel_review.
   A second person always approves (no auto-approve); travel hours cover the shift only. Nothing here writes except through that RPC. */
(function (w, d) {
  'use strict';
  var U = function () { return w.SSMPDWorkforceUtils; };
  var MONTHS = ['يناير', 'فبراير', 'مارس', 'أبريل', 'مايو', 'يونيو', 'يوليو', 'أغسطس', 'سبتمبر', 'أكتوبر', 'نوفمبر', 'ديسمبر'];
  var STATUS = { pending: ['منتظرة الاعتماد', 'pending'], approved: ['معتمدة', 'approved'], rejected: ['مرفوضة', 'rejected'], cancelled: ['ملغاة', 'cancelled'] };
  function esc(v) { return String(v == null ? '' : v).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function today() { return new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Cairo', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date()); }
  function fdate(s) { var t = String(s || '').slice(0, 10).split('-'); return t.length === 3 ? +t[2] + ' ' + MONTHS[+t[1] - 1] : '—'; }
  function hm(t) { return String(t || '').slice(0, 5); }
  function toast(m, k) { if (w.SSMPDToast && w.SSMPDToast.show) w.SSMPDToast.show(m, k); }
  function call(action, payload) { return U().rpc('hr_mission', { p_action: action, p_payload: payload || {} }); }

  /* ---------- create form (HR/manager for a person, or the employee for himself) ---------- */
  function form(person) {
    var u = U(), self = !person, t = today();
    var html = (self ? '' : '<p class="wp-wide"><b>' + esc(person.full_name || '') + '</b></p>') +
      u.select('mode', 'المدة', [['whole', 'يوم كامل'], ['hours', 'ساعات']], 'whole') +
      u.field('from_date', 'من يوم', 'date', t, 'required') + u.field('to_date', 'إلى يوم', 'date', t, 'required') +
      '<div class="hmi-hours" hidden>' + u.field('from_time', 'من الساعة', 'time', '09:00') + u.field('to_time', 'إلى الساعة', 'time', '14:00') + '</div>' +
      u.field('place', 'المكان', 'text', '', 'required maxlength="120"') + u.field('note', 'الملاحظة / السبب', 'text', '', 'required minlength="3" maxlength="300"') +
      '<p class="wp-wide hmi-note">' + (self ? 'الطلب بيتبعت لمديرك المباشر أو الموارد البشرية زي طلب الإجازة، ومش بيتحسب غير بعد الموافقة.'
        : 'لازم حد تاني يعتمد المهمة، حتى لو إنت اللي سجلتها. بعد الاعتماد بيظهر «مهمة خارجية» بدل «لم يصل»، ومش بيتحسب غياب ولا تأخير.') + '</p>';
    var f = u.modal(self ? 'طلب مهمة خارجية' : 'مهمة خارجية — ' + (person.full_name || ''), html, function (v) {
      var hours = v.mode === 'hours';
      if (hours && (!v.from_time || !v.to_time)) throw Error('اكتب ساعة البداية والنهاية أو اختار «يوم كامل»');
      var p = { from_date: v.from_date, to_date: v.to_date || v.from_date, from_time: hours ? v.from_time : null, to_time: hours ? v.to_time : null, place: v.place, note: v.note };
      if (!self) p.person_id = person.id;
      return call('create', p).then(function () { toast(self ? 'اتبعت الطلب لحد يراجعه' : 'اتسجلت المهمة — منتظرة اعتماد حد تاني', 'success'); });
    });
    var box = d.querySelector('.wp-overlay'), mode = box && box.querySelector('[name=mode]'), hrs = box && box.querySelector('.hmi-hours');
    if (mode) mode.onchange = function () { hrs.hidden = mode.value !== 'hours'; };
    return f;
  }

  /* ---------- panel: needs your review / mine / my team ---------- */
  function card(m, kind) {
    var s = STATUS[m.status] || [m.status, ''], when = fdate(m.from_date) + (m.to_date && m.to_date !== m.from_date ? ' — ' + fdate(m.to_date) : '') + ' · ' + (m.whole_day ? 'يوم كامل' : '<bdi>' + esc(hm(m.from_time)) + '</bdi> إلى <bdi>' + esc(hm(m.to_time)) + '</bdi>');
    var tr = (m.travel || []).map(function (x) {
      var ts = STATUS[x.status] || [x.status, ''];
      return '<div class="hmi-tr"><span>ساعات الطريق: <bdi>' + esc(x.minutes) + '</bdi> دقيقة — ' + esc(ts[0]) + (x.note ? ' · ' + esc(x.note) : '') + '</span>' +
        (x.can_review ? '<span class="hmi-b"><button type="button" class="btn" data-hmi="travel_review" data-id="' + esc(x.id) + '" data-d="approved">اعتماد</button><button type="button" class="btn ghost" data-hmi="travel_review" data-id="' + esc(x.id) + '" data-d="rejected">رفض</button></span>' : '') + '</div>';
    }).join('');
    var b = [];
    if (m.can_review) b.push('<button type="button" class="btn" data-hmi="review" data-id="' + esc(m.id) + '" data-d="approved">اعتماد</button><button type="button" class="btn ghost" data-hmi="review" data-id="' + esc(m.id) + '" data-d="rejected">رفض</button>');
    if (m.can_add_travel) b.push('<button type="button" class="btn" data-hmi="travel" data-id="' + esc(m.id) + '">أضف ساعات الطريق</button>');
    if (m.can_cancel) b.push('<button type="button" class="btn ghost" data-hmi="cancel" data-id="' + esc(m.id) + '">إلغاء</button>');
    return '<article class="hmi-card" data-hmi-card="' + esc(m.id) + '"><div class="hmi-h"><b>' + esc(kind === 'mine' ? 'مهمة خارجية' : m.person_name) + '</b><span class="hmi-chip ' + esc(s[1]) + '">' + esc(s[0]) + '</span></div>' +
      '<small>' + when + ' · ' + esc(m.place || '') + '</small>' + (m.note ? '<small>' + esc(m.note) + '</small>' : '') + (m.review_note ? '<small>سبب القرار: ' + esc(m.review_note) + '</small>' : '') + tr +
      (b.length ? '<div class="hmi-b">' + b.join('') + '</div>' : '') + '</article>';
  }
  function panel() {
    var box = d.createElement('div'); box.className = 'wp-overlay hmi'; box.dataset.hmiPanel = '';
    box.innerHTML = '<section class="wp-modal" role="dialog" aria-modal="true" aria-label="المهام الخارجية"><header><h2>المهام الخارجية</h2><button type="button" aria-label="إغلاق" data-close>×</button></header><div class="hmi-body" role="status">جاري التحميل…</div></section>';
    d.body.append(box);
    function close() { box.remove(); }
    box.addEventListener('click', function (e) {
      if (e.target.closest('[data-close]') || e.target === box) { close(); return; }
      var b = e.target.closest('[data-hmi]'); if (!b) return;
      var id = b.dataset.id, a = b.dataset.hmi;
      if (a === 'cancel') { run(call('cancel', { id: id }), 'اتلغت'); return; }
      if (a === 'travel') { U().modal('ساعات الطريق', U().field('minutes', 'المدة بالدقايق', 'number', '', 'required min="1" max="720" step="1"') + U().field('note', 'ملاحظة (اختياري)', 'text', '', 'maxlength="200"') + '<p class="wp-wide hmi-note">ساعات الطريق بتتحسب جوه الوردية بس، ومش بتتحسب وقت إضافي.</p>',
        function (v) { return call('add_travel', { id: id, minutes: Number(v.minutes), note: v.note || null }).then(function () { toast('اتضافت ساعات الطريق', 'success'); load(); }); }); return; }
      var title = a === 'review' ? 'مراجعة المهمة الخارجية' : 'مراجعة ساعات الطريق', dec = b.dataset.d;
      U().modal(title + ' — ' + (dec === 'approved' ? 'اعتماد' : 'رفض'), U().field('note', 'سبب القرار' + (dec === 'rejected' ? '' : ' (اختياري)'), 'text', '', dec === 'rejected' ? 'required' : ''),
        function (v) { return call(a, { id: id, decision: dec, note: v.note || '' }).then(function () { toast('تم الحفظ', 'success'); load(); }); });
    });
    function run(p, msg) { return p.then(function () { toast(msg, 'success'); load(); }).catch(function (e) { toast((e && e.message) || 'تعذر التنفيذ'); }); }
    function load() {
      return call('workspace', {}).then(function (r) {
        if (!box.isConnected) return;
        var sec = function (t, list, kind) { return list && list.length ? '<h3>' + esc(t) + ' <small>(' + list.length + ')</small></h3>' + list.map(function (m) { return card(m, kind); }).join('') : ''; };
        var html = sec('محتاجة مراجعتك', r.to_review, 'review') + sec('مهماتي', r.mine, 'mine') + sec('مهمات فريقي', (r.team || []).filter(function (m) { return !(r.to_review || []).some(function (x) { return x.id === m.id; }); }), 'team');
        box.querySelector('.hmi-body').innerHTML = html || '<p>مفيش مهام خارجية.</p>'; box.querySelector('.hmi-body').removeAttribute('role');
      }).catch(function (e) { if (box.isConnected) box.querySelector('.hmi-body').innerHTML = '<p role="alert">' + esc((e && e.message) || 'تعذر التحميل') + '</p>'; });
    }
    load(); return box;
  }

  /* entry card in «الإجازات والطلبات» / «إجازاتي وطلباتي» */
  function mount(host) {
    if (!host || host.querySelector('[data-hmi-entry]')) return;
    var c = d.createElement('div'); c.className = 'wp-actions hmi-entry'; c.dataset.hmiEntry = '';
    c.innerHTML = '<button type="button" class="btn ghost" data-hmi-open="self">طلب مهمة خارجية</button><button type="button" class="btn ghost" data-hmi-open="panel">المهام الخارجية</button>';
    c.addEventListener('click', function (e) { var b = e.target.closest('[data-hmi-open]'); if (!b) return; if (b.dataset.hmiOpen === 'self') form(null); else panel(); });
    host.append(c);
  }
  w.SSMPDHRMission = { form: form, panel: panel, mount: mount };
})(window, document);
