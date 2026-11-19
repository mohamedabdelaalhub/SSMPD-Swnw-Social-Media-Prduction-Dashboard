(function (w) {
  'use strict';
  // «أجازات المركز» (owner 2026-11-15): official holidays when the whole center closes and everyone is off (paid).
  // HR managers / general manager / super admin add; a DIFFERENT super admin or general manager approves. Once approved:
  // attendance shows «أجازة» (never «غايب»), payroll never deducts, and booking on those days is refused.
  // Server: center_closures / center_closure_command / center_closure_bookings (migration 20261115200000).
  // Mounted by hr-attendance-hub.js as the fourth inner tab.
  var C = w.SSMPDAttCore, esc = C.esc, ico = C.ico;
  var STATUS = { pending: ['بانتظار الاعتماد', 'cl-pending'], approved: ['معتمدة', 'cl-approved'], rejected: ['مرفوضة', 'cl-rejected'], cancelled: ['ملغية', 'cl-cancelled'] };
  function fmt(d) { return new Date(d + 'T12:00:00Z').toLocaleDateString('ar-EG-u-nu-latn', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' }); }
  function days(c) { return Math.round((Date.parse(c.to_date + 'T12:00:00Z') - Date.parse(c.from_date + 'T12:00:00Z')) / 864e5) + 1; }
  function dayWord(n) { return n === 1 ? 'يوم واحد' : n === 2 ? 'يومين' : n <= 10 ? n + ' أيام' : n + ' يوم'; }

  function mount(shell, active) {
    if (!shell || !active) return;
    var U = w.SSMPDWorkforceUtils, owner = w.SSMPDAuth && w.SSMPDAuth.currentAdmin && w.SSMPDAuth.currentAdmin.id;
    var data = null, serial = 0, host = document.createElement('div'), counts = {};
    host.dataset.hrClosures = ''; shell.append(host);
    function live() { return host.isConnected && w.SSMPDAuth.currentAdmin && w.SSMPDAuth.currentAdmin.id === owner; }
    function btn(action, label, id, cls) { return '<button type="button" class="' + (cls || 'btn ghost') + '" data-closures="' + action + '" data-id="' + esc(id || '') + '">' + esc(label) + '</button>'; }
    function load() {
      var n = ++serial;
      if (!data) host.innerHTML = '<div class="att-msg" role="status">جاري تحميل الأجازات…</div>';
      return U.rpc('center_closures').then(function (r) {
        if (!live() || n !== serial) return;
        data = r; draw();
        (data.can_add ? data.closures : []).filter(function (c) { return c.status === 'pending' || c.status === 'approved'; }).forEach(function (c) {
          U.rpc('center_closure_bookings', { p_id: c.id }).then(function (rows) { counts[c.id] = (rows || []).reduce(function (s, x) { return s + (+x.bookings || 0); }, 0); if (live()) draw(); }, function () {});
        });
      }).catch(function (err) {
        if (!live() || data) return;
        var missing = /center_closures|404|schema cache/i.test(err.message || '');
        host.innerHTML = '<div class="att-msg err" role="alert">' + esc(missing ? 'أجازات المركز غير مفعّلة بعد على قاعدة البيانات' : err.message) + '</div>' + btn('retry', 'إعادة المحاولة');
        bind();
      });
    }
    function card(c) {
      var st = STATUS[c.status] || [c.status, ''], n = days(c), acts = '';
      if (c.status === 'pending' && data.can_review && !c.mine) acts += btn('approve', 'اعتماد', c.id, 'btn') + btn('reject', 'رفض', c.id);
      if (c.status === 'pending' && data.can_review && c.mine) acts += '<small class="cl-wait">محتاجة اعتماد من شخص تاني (سوبر أدمن أو مدير عام)</small>';
      if (c.status === 'pending' && (c.mine || data.can_review)) acts += btn('withdraw', 'إلغاء الطلب', c.id);
      if (c.status === 'approved' && data.can_review) acts += btn('cancel', 'إلغاء الأجازة', c.id);
      var bk = counts[c.id] ? '<div class="cl-bookings" data-closures-bookings>' + ico('warn') + '<span>فيه <b>' + counts[c.id] + '</b> حجز في الأيام دي — الاستقبال يكلّم المرضى ويغيّر مواعيدهم.</span></div>' : '';
      return '<article class="cl-card ' + st[1] + '" data-closure="' + esc(c.id) + '"><header><div><h3>' + ico('sun') + esc(c.name) + '</h3><p>' + (n === 1 ? esc(fmt(c.from_date)) : 'من ' + esc(fmt(c.from_date)) + ' إلى ' + esc(fmt(c.to_date))) + ' — <b>' + dayWord(n) + '</b></p></div><span class="cl-pill">' + esc(st[0]) + '</span></header>' +
        (c.note ? '<p class="cl-note">' + esc(c.note) + '</p>' : '') +
        '<p class="cl-meta">أضافها ' + esc(c.created_by_name || '—') + (c.reviewed_by_name ? ' · ' + (c.status === 'rejected' ? 'رفضها ' : 'راجعها ') + esc(c.reviewed_by_name) : '') + (c.review_note ? ' — ' + esc(c.review_note) : '') + '</p>' + bk +
        (acts ? '<div class="cl-actions">' + acts + '</div>' : '') + '</article>';
    }
    function draw() {
      var list = data.closures || [], upcoming = list.filter(function (c) { return c.status !== 'rejected' && c.status !== 'cancelled'; }), old = list.filter(function (c) { return c.status === 'rejected' || c.status === 'cancelled'; });
      host.innerHTML = '<div class="banner cl-intro">' + ico('sun') + '<div style="flex:1;min-width:220px"><b>أجازات المركز الرسمية</b><span style="color:var(--muted);font-size:13.5px">أيام العيد والمناسبات اللي المركز كله بيقفل فيها (والطوارئ معاه) والكل أجازة مدفوعة. بعد الاعتماد: الحضور يكتب «أجازة» مش «غايب»، مفيش خصم من المرتب، والحجز في الأيام دي بيتقفل. الأجازة لازم يعتمدها شخص تاني (سوبر أدمن أو مدير عام).</span></div>' + (data.can_add ? btn('add', 'إضافة أجازة', '', 'btn') : '') + '</div>' +
        (upcoming.length ? '<div class="cl-list">' + upcoming.map(card).join('') + '</div>' : '<div class="att-msg" data-closures-empty>مفيش أجازات متسجلة.' + (data.can_add ? ' اضغط «إضافة أجازة» لإضافة أول أجازة.' : '') + '</div>') +
        (old.length ? '<details class="cl-old"><summary>المرفوضة والملغية (' + old.length + ')</summary><div class="cl-list">' + old.map(card).join('') + '</div></details>' : '');
      bind();
    }
    function run(action, payload, okMsg) {
      return U.rpc('center_closure_command', { p_action: action, p_payload: payload }).then(function () { if (okMsg && w.SSMPDToast) w.SSMPDToast.show(okMsg); return load(); });
    }
    function act(a, id) {
      var c = data && (data.closures || []).filter(function (x) { return x.id === id; })[0];
      if (a === 'retry') return load();
      if (a === 'add') U.modal('إضافة أجازة رسمية', U.field('name', 'اسم الأجازة (مثلًا عيد الأضحى)', 'text', '', 'required maxlength="80"') + U.field('from_date', 'من يوم', 'date', '', 'required') + U.field('to_date', 'إلى يوم (سيبه فاضي لو يوم واحد)', 'date', '') + '<label class="wp-field wp-wide">ملاحظة (اختياري)<textarea name="note" rows="2" maxlength="500"></textarea></label><p class="wp-wide">الأجازة مش هتشتغل غير بعد ما سوبر أدمن أو مدير عام (غيرك) يعتمدها.</p>', function (v) { return run('add', { name: v.name, from_date: v.from_date, to_date: v.to_date || v.from_date, note: v.note || '' }, 'اتضافت الأجازة — مستنية الاعتماد'); });
      if (a === 'approve') { if (!w.confirm('اعتماد «' + c.name + '»؟ الحجز هيتقفل في الأيام دي والحضور هيتسجل أجازة للكل.')) return; return run('review', { id: id, approve: true }, 'اتعتمدت الأجازة'); }
      if (a === 'reject') U.modal('رفض «' + c.name + '»', '<label class="wp-field wp-wide">سبب الرفض<textarea name="note" rows="2" required minlength="2"></textarea></label>', function (v) { return run('review', { id: id, approve: false, note: v.note }, 'اترفضت الأجازة'); });
      if (a === 'withdraw') { if (!w.confirm('إلغاء طلب «' + c.name + '»؟')) return; return run('cancel', { id: id }, 'اتلغى الطلب'); }
      if (a === 'cancel') U.modal('إلغاء أجازة «' + c.name + '»', '<p class="wp-wide">بعد الإلغاء الحجز يرجع مفتوح في الأيام دي، والحضور يتحسب عادي.</p><label class="wp-field wp-wide">سبب الإلغاء<textarea name="note" rows="2" required minlength="2"></textarea></label>', function (v) { return run('cancel', { id: id, note: v.note }, 'اتلغت الأجازة'); });
    }
    function bind() { host.querySelectorAll('[data-closures]').forEach(function (b) { b.onclick = function () { Promise.resolve(act(b.dataset.closures, b.dataset.id)).catch(function (err) { w.alert(err.message || 'تعذّر تنفيذ الطلب'); }); }; }); }
    load();
  }
  w.SSMPDHRClosures = { mount: mount };
})(window);
