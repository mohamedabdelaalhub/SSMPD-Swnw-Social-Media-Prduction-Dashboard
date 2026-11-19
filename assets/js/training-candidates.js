/* Training center PR 4: owner/reviewer candidates section («المرشحون» + «دعوة مرشح»), appended under the
   training tab. Everything is enforced by the server RPCs (migration 20261119130000); this file only shows the data.
   The invite link is shown once at creation and is never stored in the browser. */
(function (w) {
  'use strict';
  var TRACKS = [['branch_manager', 'مدير فرع'], ['team_manager', 'مدير فريق']];
  var INVITE = { pending: 'لم يُفتح بعد', opened: 'مفتوح', submitted: 'سُلِّم الاختبار', revoked: 'مُلغى' };
  function e(v) { return String(v == null ? '' : v).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function rpc(name, args) {
    var c = w.SSMPDDb && w.SSMPDDb.client;
    if (!c) return Promise.reject(new Error('x'));
    return c.rpc(name, args || {}).then(function (r) { if (r.error) throw r.error; return r.data; });
  }
  function msg(err) {
    var m = String(err && err.message || err || '');
    if (/candidate name required/.test(m)) return 'اكتب اسم المرشح.';
    if (/reviewer must be/.test(m)) return 'اختر مراجعًا نشطًا.';
    if (/validity/.test(m)) return 'مدة الصلاحية من يوم إلى 60 يومًا.';
    if (/reason is required/.test(m)) return 'اكتب السبب.';
    if (/owner only|not allowed/.test(m)) return 'ليست لديك صلاحية لهذا الإجراء.';
    return 'تعذّر تنفيذ العملية. حاول مرة أخرى.';
  }
  function toast(t, bad) { if (w.SSMPDToast && w.SSMPDToast.show) w.SSMPDToast.show(t, bad ? 'error' : 'success'); }
  function isOwner() { var a = w.SSMPDAuth && w.SSMPDAuth.currentAdmin; return !!(a && w.SSMPDRoles && w.SSMPDRoles.hasRole(a, 'super_admin')); }
  function date(v) { if (!v) return '—'; var d = new Date(v); return isNaN(d) ? '—' : d.toLocaleDateString('ar-EG-u-nu-latn', { year: 'numeric', month: 'short', day: 'numeric' }); }

  function modal(title, body, okText, onOk) {
    var o = document.createElement('div');
    o.className = 'te-overlay';
    o.innerHTML = '<div class="te-dialog" role="dialog" aria-modal="true"><h3>' + e(title) + '</h3><div class="te-dlg-body">' + body + '</div><p class="te-err" role="alert" hidden></p>' +
      '<div class="te-actions"><button type="button" class="btn ghost" data-x>' + (onOk ? 'إلغاء' : 'إغلاق') + '</button>' + (onOk ? '<button type="button" class="btn btn-primary" data-ok>' + e(okText) + '</button>' : '') + '</div></div>';
    document.body.appendChild(o);
    function close() { o.remove(); }
    o.querySelector('[data-x]').onclick = close;
    o.addEventListener('keydown', function (ev) { if (ev.key === 'Escape') close(); });
    var ok = o.querySelector('[data-ok]');
    if (ok) ok.onclick = function () {
      var err = o.querySelector('.te-err'); ok.disabled = true; err.hidden = true;
      Promise.resolve().then(function () { return onOk(o); }).then(close).catch(function (x) { err.textContent = x && x.userText || msg(x); err.hidden = false; ok.disabled = false; });
    };
    var f = o.querySelector('input,select,textarea,[data-ok]'); if (f) f.focus();
    return o;
  }

  function linkFor(token) {
    var base = location.href.split('#')[0].split('?')[0].replace(/[^\/]*$/, '');
    return base + 'candidate.html#t=' + token;
  }
  function showLink(r, name, phone) {
    var url = linkFor(r.token), text = 'السلام عليكم ' + name + '، هذا رابط اختبارك الشخصي من مركز Swnw. يُفتح مرة واحدة من جهاز واحد: ' + url;
    var wa = null, digits = String(phone || '').replace(/\D/g, '');
    if (digits) { if (digits.indexOf('00') === 0) digits = digits.slice(2); else if (digits.charAt(0) === '0') digits = '20' + digits.slice(1); wa = 'https://wa.me/' + digits + '?text=' + encodeURIComponent(text); }
    var o = modal('رابط المرشح', '<p>' + (r.returning_applicant ? '<b>تنبيه:</b> سبق أن تقدّم صاحب هذا الرقم. ' : '') + 'هذا الرابط يظهر مرة واحدة فقط، وصلاحيته حتى ' + e(date(r.expires_at)) + '. يرتبط بأول جهاز يفتحه.</p>' +
      '<input type="text" readonly dir="ltr" value="' + e(url) + '" data-url>' +
      '<div class="te-actions"><button type="button" class="btn ghost" data-copy>نسخ اللينك</button>' + (wa ? '<a class="btn ghost" target="_blank" rel="noopener" href="' + e(wa) + '">تجهيز رسالة واتساب</a>' : '') + '</div>' +
      '<p class="te-muted">«تجهيز رسالة واتساب» يفتح المحادثة بالنص جاهزًا، ولا يُرسل شيئًا حتى تضغط أنت إرسال.</p>');
    o.querySelector('[data-copy]').onclick = function () {
      var i = o.querySelector('[data-url]'); i.select();
      (navigator.clipboard ? navigator.clipboard.writeText(url) : Promise.reject()).then(function () { toast('تم نسخ الرابط.'); }, function () { try { document.execCommand('copy'); toast('تم نسخ الرابط.'); } catch (x) { toast('حدّد الرابط وانسخه يدويًا.', true); } });
    };
  }

  function invite(done) {
    rpc('training_people').then(function (people) {
      var opts = '<option value="">اختر…</option>' + (people || []).map(function (p) { return '<option value="' + e(p.id) + '">' + e(p.name) + '</option>'; }).join('');
      modal('دعوة مرشح', '<label>اسم المرشح<input name="name" maxlength="120"></label><label>رقم الهاتف<input name="phone" inputmode="tel" maxlength="40"></label>' +
        '<label>البريد الإلكتروني (اختياري)<input name="email" type="email" maxlength="200"></label>' +
        '<label>المسار<select name="track">' + TRACKS.map(function (t) { return '<option value="' + t[0] + '">' + t[1] + '</option>'; }).join('') + '</select></label>' +
        '<label>المراجع (يُجري المقابلة)<select name="reviewer">' + opts + '</select></label>' +
        '<label>مدة صلاحية الرابط بالأيام<input name="days" type="number" min="1" max="60" value="7"></label>', 'إنشاء الرابط', function (o) {
          var v = function (n) { return o.querySelector('[name=' + n + ']').value.trim(); };
          if (v('name').length < 2) throw { userText: 'اكتب اسم المرشح.' };
          if (!v('reviewer')) throw { userText: 'اختر المراجع.' };
          var days = parseInt(v('days'), 10);
          if (!(days >= 1 && days <= 60)) throw { userText: 'مدة الصلاحية من يوم إلى 60 يومًا.' };
          return rpc('training_invite_candidate', { p_name: v('name'), p_phone: v('phone') || null, p_email: v('email') || null, p_track: v('track'), p_reviewer: v('reviewer'), p_days: days })
            .then(function (r) { setTimeout(function () { showLink(r, v('name'), v('phone')); done(); }, 0); });
        });
    }).catch(function (x) { toast(msg(x), true); });
  }

  function reasonDialog(title, hint, fn, done) {
    modal(title, '<p>' + e(hint) + '</p><label>السبب<textarea name="reason" rows="2" maxlength="1000"></textarea></label>', 'تأكيد', function (o) {
      var r = o.querySelector('[name=reason]').value.trim(); if (r.length < 3) throw { userText: 'اكتب السبب.' };
      return fn(r).then(function () { toast('تم.'); done(); });
    });
  }

  function mount(host) {
    var owner = isOwner(), sec = host.querySelector('[data-candidates]');
    if (!sec) { sec = document.createElement('section'); sec.className = 'te-card'; sec.setAttribute('data-candidates', ''); host.appendChild(sec); }
    function draw(list) {
      var h = '<div class="te-head" style="margin:0"><h3>المرشحون</h3>' + (owner ? '<button type="button" class="btn btn-primary" data-invite>دعوة مرشح</button>' : '') + '</div>';
      if (!list.length) { sec.innerHTML = h + '<p class="te-muted">لا يوجد مرشحون بعد.' + (owner ? ' اضغط «دعوة مرشح» لإنشاء رابط اختبار شخصي يُفتح مرة واحدة.' : '') + '</p>'; wire(); return; }
      h += '<div class="te-table"><table><thead><tr><th>المرشح</th><th>المسار</th><th>الحالة</th><th>المراجع</th><th></th></tr></thead><tbody>' + list.map(function (c) {
        var act = '';
        if (c.invite_status === 'submitted') act += '<button type="button" class="btn ghost" data-result="' + e(c.assignment_id) + '">نتيجة الاختبار</button> ';
        if (owner && (c.invite_status === 'pending' || c.invite_status === 'opened')) act += '<button type="button" class="btn ghost" data-revoke="' + e(c.assignment_id) + '">إلغاء الرابط</button> ';
        if (owner && !c.minimal) act += '<button type="button" class="btn ghost" data-note="' + e(c.candidate_id) + '" data-text="' + e(c.owner_notes || '') + '">ملاحظة</button> <button type="button" class="btn ghost" data-delete="' + e(c.candidate_id) + '">حذف بيانات المرشح</button>';
        return '<tr><td><b>' + e(c.name) + '</b>' + (c.returning_applicant ? ' <span class="te-chip">تقدّم سابقًا</span>' : '') + '<br><span class="te-muted" dir="ltr">' + e(c.phone || '') + '</span>' +
          (c.minimal ? '<br><span class="te-muted">سجل مختصر بعد الحذف</span>' : (c.experience ? '<br><span class="te-muted">' + e(c.experience).slice(0, 140) + '</span>' : '')) + '</td><td>' + e(c.track_name) + '</td><td>' + e(INVITE[c.invite_status] || '—') +
          (c.invite_status === 'pending' || c.invite_status === 'opened' ? '<br><span class="te-muted">حتى ' + e(date(c.expires_at)) + '</span>' : '') + '</td><td>' + e(c.reviewer_name) + '</td><td>' + act + '</td></tr>';
      }).join('') + '</tbody></table></div>';
      sec.innerHTML = h; wire();
      function reload() { rpc('training_candidates').then(draw).catch(function (x) { toast(msg(x), true); }); }
      sec.querySelectorAll('[data-result]').forEach(function (b) { b.onclick = function () { w.SSMPDTrainingEvaluation.openResult(b.getAttribute('data-result')); }; });
      sec.querySelectorAll('[data-revoke]').forEach(function (b) { b.onclick = function () { reasonDialog('إلغاء رابط المرشح', 'سيتوقف الرابط فورًا ولا يمكن إعادة استخدامه.', function (r) { return rpc('training_revoke_candidate_invite', { p_assignment: b.getAttribute('data-revoke'), p_reason: r }); }, reload); }; });
      sec.querySelectorAll('[data-delete]').forEach(function (b) { b.onclick = function () { reasonDialog('حذف بيانات المرشح', 'يبقى الاسم والهاتف فقط، وتُحذف الخبرة والمؤهلات والبريد والملاحظات. يُسجَّل الإجراء.', function (r) { return rpc('training_delete_candidate_data', { p_candidate: b.getAttribute('data-delete'), p_reason: r }); }, reload); }; });
      sec.querySelectorAll('[data-note]').forEach(function (b) { b.onclick = function () {
        modal('ملاحظة عن المرشح', '<label>الملاحظة (لا يراها المرشح ولا المراجع)<textarea name="note" rows="4" maxlength="3000">' + e(b.getAttribute('data-text')) + '</textarea></label>', 'حفظ', function (o) {
          return rpc('training_candidate_note', { p_candidate: b.getAttribute('data-note'), p_note: o.querySelector('[name=note]').value }).then(function () { toast('تم الحفظ.'); reload(); });
        }); }; });
      var ib = sec.querySelector('[data-invite]'); if (ib) ib.onclick = function () { invite(reload); };
    }
    function wire() { var ib = sec.querySelector('[data-invite]'); if (ib) ib.onclick = function () { invite(function () { rpc('training_candidates').then(draw); }); }; }
    return rpc('training_candidates').then(function (list) { if (owner || list.length) draw(list); else sec.remove(); }).catch(function () { sec.remove(); });
  }

  // Hook: after the training tab renders its home view, append the candidates section (no change to that file's flow).
  function install() {
    var T = w.SSMPDTrainingEvaluation;
    if (!T || T._candidatesHooked) return;
    T._candidatesHooked = true;
    var orig = T.render;
    T.render = function (el) {
      var p = orig.apply(this, arguments);
      return Promise.resolve(p).then(function (r) {
        var page = el && el.querySelector('.te-page');
        if (page) mount(page);
        return r;
      });
    };
  }
  install();
  w.SSMPDTrainingCandidates = { mount: mount, _linkFor: linkFor };
})(window);
