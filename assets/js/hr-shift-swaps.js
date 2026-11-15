(function (w) {
  'use strict';
  // «تبديل وردية» — shift swaps. Server: hr_shift_swaps_list / hr_shift_swap_command (migration 20261115200000).
  // HR managers see every swap (from the shifts tab); an employee sees his own (from «حضوري ووردياتي»).
  // Flow: request → the colleague accepts → a different HR manager approves → the per-day schedule changes.
  var STATUS = { pending_partner: 'في انتظار موافقة الزميل', pending_manager: 'في انتظار اعتماد الإدارة', approved: 'معتمد',
    declined: 'رفضه الزميل', rejected: 'رفضته الإدارة', cancelled: 'مسحوب', reversed: 'أُلغي بعد الاعتماد' };
  var KIND = { same_day: 'تبديل مواعيد نفس اليوم', cross_day: 'أشتغل يومك وتشتغل يومي' };

  function mount(host) {
    if (!host) return;
    var U = w.SSMPDWorkforceUtils, e = U.escape, owner = w.SSMPDAuth && w.SSMPDAuth.currentAdmin && w.SSMPDAuth.currentAdmin.id, data = null;
    host.dataset.hrShiftSwaps = '';
    function live() { return host.isConnected && w.SSMPDAuth.currentAdmin && w.SSMPDAuth.currentAdmin.id === owner; }
    function btn(a, label, id) { return '<button type="button" class="btn ghost" data-swap="' + a + '" data-id="' + e(id || '') + '">' + e(label) + '</button>'; }
    function toast(m, k) { if (w.SSMPDToast) w.SSMPDToast.show(m, k); }
    async function command(action, payload) { await U.rpc('hr_shift_swap_command', { p_action: action, p_payload: payload }); toast('تم'); await load(); }

    function actions(s) {
      var me = data.me, hr = data.can_manage, out = [];
      if (s.status === 'pending_partner' && (s.partner_admin === me || (hr && s.created_by !== me && !s.partner_admin))) out.push(btn('accept', 'موافقة', s.id), btn('decline', 'رفض', s.id));
      if (s.status === 'pending_partner' && hr && s.partner_admin && s.partner_admin !== me && s.created_by !== me) out.push(btn('accept', 'موافقة نيابة عن الزميل', s.id));
      if (s.status === 'pending_manager' && hr && s.created_by !== me && s.partner_by !== me) out.push(btn('approve', 'اعتماد', s.id), btn('reject', 'رفض', s.id));
      if ((s.status === 'pending_partner' || s.status === 'pending_manager') && (s.created_by === me || s.requester_admin === me || hr)) out.push(btn('cancel', 'سحب الطلب', s.id));
      if (s.status === 'approved' && hr) out.push(btn('reverse', 'إلغاء التبديل', s.id));
      return out.join(' ') || '—';
    }
    function planText(s) {
      if (!s.plan || !s.plan.length) return s.kind === 'same_day' ? 'يوم ' + s.day_a : 'يوم ' + s.day_a + ' ↔ يوم ' + s.day_b;
      return s.plan.map(function (p) { return (p.person_id === s.requester_id ? s.requester_name : s.partner_name) + ' ' + p.day + ': ' + (p.off ? 'إجازة بتبديل' : p.shift); }).join(' · ');
    }
    function draw() {
      if (!live()) return;
      var waitingMe = data.swaps.filter(function (s) { return s.status === 'pending_partner' && s.partner_admin === data.me; }).length;
      host.innerHTML = '<section class="wp-detail"><h3>تبديل الورديات</h3><p>اطلب تبديل يوم مع زميل. بعد موافقة الزميل يعتمد مسؤول الموارد البشرية (غير مقدم الطلب)، فيتغير جدول اليوم ده بس. اللي عنده إجازة بسبب التبديل مش بيتحسب غايب.</p>' +
        (waitingMe ? '<p class="wp-note"><b>عندك ' + waitingMe + ' طلب تبديل في انتظار ردك.</b></p>' : '') +
        '<div class="wp-actions">' + btn('new', 'تبديل وردية') + '</div>' +
        U.table(['الطلب', 'الطرفين', 'التفاصيل', 'الحالة', 'الإجراء'], data.swaps.map(function (s) {
          return [e(KIND[s.kind] || s.kind), e(s.requester_name + ' ⇄ ' + s.partner_name), e(planText(s)) + (s.note ? '<br><small>' + e(s.note) + '</small>' : ''),
            e(STATUS[s.status] || s.status) + (s.reverse_reason ? '<br><small>' + e(s.reverse_reason) + '</small>' : s.decision_note ? '<br><small>' + e(s.decision_note) + '</small>' : ''), actions(s)];
        })) + '</section>';
      host.querySelectorAll('[data-swap]').forEach(function (n) { n.onclick = function () { act(n.dataset.swap, n.dataset.id).catch(function (err) { toast(err.message, 'error'); }); }; });
    }
    async function act(a, id) {
      if (a === 'new') {
        var people = data.people.map(function (p) { return [p.id, p.full_name + ' — ' + p.code]; }), mine = data.my_person_id;
        var reqRows = data.can_manage ? people : people.filter(function (p) { return p[0] === mine; });
        if (!reqRows.length) throw Error('ملفك غير مرتبط بجدول ورديات؛ اطلب من الموارد البشرية');
        var f = U.modal('تبديل وردية', U.select('kind', 'نوع التبديل', [['same_day', KIND.same_day], ['cross_day', KIND.cross_day]], 'same_day') +
          U.select('requester_id', 'صاحب الطلب', reqRows, mine || reqRows[0][0]) + U.select('partner_id', 'الزميل', people.filter(function (p) { return p[0] !== mine; })) +
          U.field('day_a', 'اليوم (يوم صاحب الطلب)', 'date', '', 'required') + U.field('day_b', 'يوم الزميل (للتبديل بين يومين فقط)', 'date', '') +
          U.field('note', 'السبب', 'text', '', 'maxlength="500"') +
          '<p class="wp-wide">تبديل نفس اليوم: كل واحد ياخد مواعيد التاني في اليوم ده. أشتغل يومك وتشتغل يومي: صاحب الطلب يأخذ إجازة في يومه ويشتغل يوم الزميل، والعكس.</p>',
          async function (v) {
            if (v.requester_id === v.partner_id) throw Error('اختر زميلًا آخر');
            if (v.kind === 'cross_day' && !v.day_b) throw Error('اختر يوم الزميل');
            if (v.kind === 'same_day') v.day_b = '';
            await command('request', v);
          });
        return f;
      }
      if (a === 'accept' || a === 'decline') return command('respond', { id: id, accept: a === 'accept' });
      if (a === 'cancel') return command('cancel', { id: id });
      var title = { approve: 'اعتماد التبديل', reject: 'رفض التبديل', reverse: 'إلغاء تبديل معتمد' }[a];
      U.modal(title, U.field('note', a === 'reverse' ? 'سبب الإلغاء' : 'سبب القرار', 'text', '', 'required minlength="3" maxlength="500"'),
        function (v) { return command(a, { id: id, note: v.note }); });
    }
    async function load() {
      try { data = await U.rpc('hr_shift_swaps_list', {}); draw(); }
      catch (err) { if (live()) host.innerHTML = '<p class="wp-note">' + e(/hr_shift_swaps_list/.test(err.message) ? 'تبديل الورديات غير مفعّل بعد على قاعدة البيانات' : err.message) + '</p>'; }
    }
    load();
  }
  w.SSMPDHRShiftSwaps = { mount: mount };
})(window);
