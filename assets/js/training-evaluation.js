/* Training & evaluation center (tab «التدريب والتقييم»), PR 2/6: assignments, course and exam for the trainee,
   assignment management for the owner. Every rule (who sees what, exam gate, clock, single attempt) is enforced by
   the server RPCs (supabase/migrations/20261119100000/110000). The browser never receives the answer key. */
(function (w) {
  'use strict';
  var STATUS = { assigned: 'مُسنَد', in_progress: 'جارٍ', submitted: 'تم تسليم الاختبار', interviewing: 'مرحلة المقابلة', decided: 'صدر القرار', cancelled: 'ملغى' };
  var GRADES = { strong: 'قوي', medium: 'متوسط', weak: 'ضعيف' };
  var TRACKS = [['branch_manager', 'مدير فرع'], ['team_manager', 'مدير فريق']];
  var st = { el: null, list: [], view: 'home', asg: null, progress: null, exam: null, idx: 0, offset: 0, timer: null, blurHook: null, busy: false };

  function e(v) { return String(v == null ? '' : v).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function rpc(name, args) {
    var c = w.SSMPDDb && w.SSMPDDb.client;
    if (!c) return Promise.reject(new Error('تعذّر الاتصال بقاعدة البيانات.'));
    return c.rpc(name, args || {}).then(function (r) { if (r.error) throw r.error; return r.data; });
  }
  function msg(err) {
    var m = String(err && err.message || err || '');
    if (/complete all course modules/.test(m)) return 'أكمل جميع وحدات الدورة أولًا.';
    if (/bank not loaded/.test(m)) return 'بنك الأسئلة لم يُحمَّل بعد. تواصل مع الإدارة.';
    if (/already submitted|exam is closed|course is closed/.test(m)) return 'تم تسليم الاختبار ولا يمكن تعديله.';
    if (/different person|other than the trainee/.test(m)) return 'يجب أن يكون المراجع شخصًا غير المتدرب.';
    if (/due date/.test(m)) return 'يجب أن يكون الموعد النهائي في المستقبل.';
    if (/reason is required/.test(m)) return 'اكتب سبب الإلغاء.';
    if (/owner only|not allowed|not your assignment/.test(m)) return 'ليست لديك صلاحية لهذا الإجراء.';
    return 'تعذّر تنفيذ العملية. حاول مرة أخرى.';
  }
  function toast(text, bad) { if (w.SSMPDToast && w.SSMPDToast.show) w.SSMPDToast.show(text, bad ? 'error' : 'success'); }
  function isOwner() { var a = w.SSMPDAuth && w.SSMPDAuth.currentAdmin; return !!(a && w.SSMPDRoles && w.SSMPDRoles.hasRole(a, 'super_admin')); }
  function date(v) { if (!v) return '—'; var d = new Date(v); return isNaN(d) ? '—' : d.toLocaleDateString('ar-EG-u-nu-latn', { year: 'numeric', month: 'short', day: 'numeric' }); }
  function course() { return w.SSMPDTrainingCourse || { modules: [], sources: [] }; }
  function gradeChip(g) { return '<span class="te-chip" data-grade="' + e(g) + '">' + e(GRADES[g] || g) + '</span>'; }
  function chip(status) { return '<span class="te-chip" data-status="' + e(status) + '">' + e(STATUS[status] || status) + '</span>'; }

  function stopExam() {
    if (st.timer) { clearInterval(st.timer); st.timer = null; }
    if (st.blurHook) { document.removeEventListener('visibilitychange', st.blurHook); st.blurHook = null; }
  }

  function modal(title, bodyHtml, okText, onOk) {
    var o = document.createElement('div');
    o.className = 'te-overlay';
    o.innerHTML = '<div class="te-dialog" role="dialog" aria-modal="true" aria-labelledby="te-dlg-t"><h3 id="te-dlg-t">' + e(title) + '</h3><div class="te-dlg-body">' + bodyHtml +
      '</div><p class="te-err" role="alert" hidden></p><div class="te-actions"><button type="button" class="btn ghost" data-x>إلغاء</button><button type="button" class="btn btn-primary" data-ok>' + e(okText) + '</button></div></div>';
    document.body.appendChild(o);
    function close() { o.remove(); }
    o.querySelector('[data-x]').onclick = close;
    o.addEventListener('keydown', function (ev) { if (ev.key === 'Escape') close(); });
    o.querySelector('[data-ok]').onclick = function () {
      var btn = this, err = o.querySelector('.te-err');
      btn.disabled = true; err.hidden = true;
      Promise.resolve().then(function () { return onOk(o); }).then(close).catch(function (x) { err.textContent = x && x.userText || msg(x); err.hidden = false; btn.disabled = false; });
    };
    var f = o.querySelector('select,input,textarea,[data-ok]'); if (f) f.focus();
    return o;
  }

  // ---------------------------------------------------------------- home: assignment lists
  function load() {
    stopExam();
    st.view = 'home';
    st.el.innerHTML = '<div class="te-page"><p class="te-muted">جارٍ التحميل…</p></div>';
    return rpc('training_assignments').then(function (list) { st.list = list || []; home(); })
      .catch(function (x) { st.el.innerHTML = '<div class="te-page"><p class="te-err">' + e(msg(x)) + '</p></div>'; });
  }

  function rows(list, mode) {
    if (!list.length) return '<p class="te-muted">لا توجد تكليفات.</p>';
    return '<div class="te-table"><table><thead><tr><th>المسار</th>' + (mode !== 'trainee' ? '<th>المتدرب</th>' : '') + '<th>المراجع</th><th>الموعد النهائي</th><th>الدورة</th><th>الحالة</th><th></th></tr></thead><tbody>' +
      list.map(function (a) {
        var act = '';
        if (mode === 'trainee' && a.status !== 'cancelled') act = '<button type="button" class="btn btn-primary" data-open="' + e(a.id) + '">' + (a.exam_status ? 'عرض' : 'متابعة التدريب') + '</button>';
        if (mode !== 'trainee' && a.exam_status === 'submitted') act = '<button type="button" class="btn ghost" data-result="' + e(a.id) + '">نتيجة الاختبار</button>';
        if (mode === 'owner' && ['decided', 'cancelled'].indexOf(a.status) === -1) act += '<button type="button" class="btn ghost" data-cancel="' + e(a.id) + '">إلغاء التكليف</button>';
        return '<tr><td>' + e(a.track_name) + '</td>' + (mode !== 'trainee' ? '<td>' + e(a.trainee_name) + '</td>' : '') + '<td>' + e(a.reviewer_name) + '</td><td>' + e(date(a.due_at)) +
          '</td><td>' + e(a.modules_done) + ' من ' + e(a.modules_total) + '</td><td>' + chip(a.status) + (mode !== 'trainee' && a.exam_grade ? ' ' + gradeChip(a.exam_grade) + (a.exam_risk_flags ? ' <span class="te-flag">علامات خطر: ' + e(a.exam_risk_flags) + '</span>' : '') : '') + (a.exam_auto_submitted ? ' <span class="te-note">سُلِّم تلقائيًا بانتهاء الوقت</span>' : '') + '</td><td>' + act + '</td></tr>';
      }).join('') + '</tbody></table></div>';
  }

  function home() {
    var mine = st.list.filter(function (a) { return a.relation === 'trainee'; });
    var review = st.list.filter(function (a) { return a.relation === 'reviewer'; });
    var owner = isOwner();
    var h = '<div class="te-page"><header class="te-head"><div><h2>التدريب والتقييم</h2><p class="te-muted">مسارات إعداد مديري الفروع ومديري الفرق: دورة من 8 وحدات، ثم اختبار مواقف، ثم مقابلة.</p></div>' +
      (owner ? '<button type="button" class="btn btn-primary" data-new>تكليف جديد</button>' : '') + '</header>';
    if (owner) h += '<section class="te-card" data-bank><h3>بنك الأسئلة</h3><p class="te-muted">جارٍ التحقق…</p></section>';
    h += '<section class="te-card"><h3>تكليفاتي</h3>' + rows(mine, 'trainee') + '</section>';
    if (review.length) h += '<section class="te-card"><h3>تكليفات أراجعها</h3><p class="te-muted">تظهر هنا التكليفات المسندة إليك بصفتك مراجعًا. ورقة المقابلة تُتاح في مرحلة لاحقة.</p>' + rows(review, 'reviewer') + '</section>';
    if (owner) h += '<section class="te-card"><h3>كل التكليفات</h3>' + rows(st.list, 'owner') + '</section>';
    st.el.innerHTML = h + '</div>';
    var nb = st.el.querySelector('[data-new]'); if (nb) nb.onclick = newAssignment;
    st.el.querySelectorAll('[data-open]').forEach(function (b) { b.onclick = function () { openAssignment(b.getAttribute('data-open')); }; });
    st.el.querySelectorAll('[data-result]').forEach(function (b) { b.onclick = function () { resultView(b.getAttribute('data-result')); }; });
    st.el.querySelectorAll('[data-cancel]').forEach(function (b) { b.onclick = function () { cancelAssignment(b.getAttribute('data-cancel')); }; });
    if (owner) rpc('training_bank_summary').then(function (s) {
      var box = st.el.querySelector('[data-bank]'); if (!box) return;
      box.innerHTML = '<h3>بنك الأسئلة</h3>' + (s && s.meta ? '<p>الإصدار <b>' + e(s.meta.version) + '</b> · ' + e(s.meta.questions_per_attempt) + ' سؤالًا في كل اختبار · ' + e(s.meta.duration_minutes) + ' دقيقة</p><p class="te-muted">' +
        (s.competencies || []).map(function (c) { return e(c.name_ar) + ': ' + e(c.quota) + ' من ' + e(c.questions); }).join(' · ') + '</p>' :
        '<p class="te-warn">لم يُحمَّل بنك الأسئلة بعد، ولن يتمكن أحد من بدء الاختبار حتى يُحمَّل.</p>');
    }).catch(function () {});
  }

  function newAssignment() {
    rpc('training_people').then(function (people) {
      var opts = '<option value="">اختر…</option>' + (people || []).map(function (p) { return '<option value="' + e(p.id) + '">' + e(p.name) + '</option>'; }).join('');
      modal('تكليف جديد', '<label>المسار<select name="track">' + TRACKS.map(function (t) { return '<option value="' + t[0] + '">' + t[1] + '</option>'; }).join('') + '</select></label>' +
        '<label>المتدرب<select name="trainee">' + opts + '</select></label><label>المراجع (يُجري المقابلة)<select name="reviewer">' + opts + '</select></label>' +
        '<label>الموعد النهائي (اختياري)<input type="date" name="due"></label><label>ملاحظة للمراجع (لا تظهر للمتدرب)<textarea name="note" rows="2" maxlength="1000"></textarea></label>',
        'إسناد', function (o) {
          var v = function (n) { return o.querySelector('[name=' + n + ']').value; };
          if (!v('trainee') || !v('reviewer')) throw { userText: 'اختر المتدرب والمراجع.' };
          if (v('trainee') === v('reviewer')) throw { userText: 'يجب أن يكون المراجع شخصًا غير المتدرب.' };
          var due = v('due') ? new Date(v('due') + 'T23:59:00').toISOString() : null;
          return rpc('training_assign', { p_track: v('track'), p_trainee: v('trainee'), p_reviewer: v('reviewer'), p_due: due, p_note: v('note') || null })
            .then(function () { toast('تم إسناد التكليف.'); load(); });
        });
    }).catch(function (x) { toast(msg(x), true); });
  }

  function cancelAssignment(id) {
    modal('إلغاء التكليف', '<p>لن يتمكن المتدرب من متابعة الدورة أو الاختبار بعد الإلغاء.</p><label>سبب الإلغاء<textarea name="reason" rows="2" maxlength="1000"></textarea></label>', 'تأكيد الإلغاء', function (o) {
      var r = o.querySelector('[name=reason]').value.trim();
      if (!r) throw { userText: 'اكتب سبب الإلغاء.' };
      return rpc('training_cancel_assignment', { p_id: id, p_reason: r }).then(function () { toast('تم إلغاء التكليف.'); load(); });
    });
  }

  // ---------------------------------------------------------------- trainee: course
  function openAssignment(id) {
    stopExam();
    st.asg = st.list.filter(function (a) { return a.id === id; })[0];
    return rpc('training_course_progress', { p_assignment: id }).then(function (p) { st.progress = p; courseView(); })
      .catch(function (x) { toast(msg(x), true); });
  }

  function courseView() {
    st.view = 'course';
    var p = st.progress, done = p.completed || {}, mods = course().modules, n = Object.keys(done).length, all = n >= (p.modules || []).length && n > 0;
    var exam = p.exam;
    var h = '<div class="te-page"><button type="button" class="btn ghost te-back" data-back>رجوع إلى التكليفات</button><header class="te-head"><div><h2>' + e(st.asg.track_name) + '</h2><p class="te-muted">المراجع: ' + e(st.asg.reviewer_name) + ' · الموعد النهائي: ' + e(date(st.asg.due_at)) + '</p></div></header>' +
      '<section class="te-card"><h3>الدورة</h3><div class="te-progress" role="progressbar" aria-valuemin="0" aria-valuemax="8" aria-valuenow="' + n + '"><i style="width:' + Math.round(100 * n / Math.max(1, mods.length)) + '%"></i></div><p class="te-muted">أنهيت ' + n + ' من ' + mods.length + ' وحدات.</p><ol class="te-modules">' +
      mods.map(function (m, i) { var ok = !!done[m.id]; return '<li><button type="button" class="te-module" data-mod="' + i + '"><span class="te-num">' + (i + 1) + '</span><span>' + e(m.title) + '</span><span class="te-chip" data-status="' + (ok ? 'done' : 'todo') + '">' + (ok ? 'منتهية' : 'لم تبدأ') + '</span></button></li>'; }).join('') + '</ol></section>' +
      '<section class="te-card"><h3>الاختبار</h3>';
    if (exam && exam.status === 'submitted') h += '<p class="te-ok">تم استلام إجاباتك في ' + e(date(exam.submitted_at)) + '. ستُعرض عليك النتيجة بعد اعتمادها من الإدارة.</p>';
    else if (exam) h += '<p>الاختبار جارٍ. يمكنك المتابعة من حيث توقفت، والوقت مستمر.</p><button type="button" class="btn btn-primary" data-exam>متابعة الاختبار</button>';
    else if (!p.bank_ready) h += '<p class="te-warn">لم يُجهَّز بنك الأسئلة بعد. سيُتاح الاختبار بعد تجهيزه.</p>';
    else if (!all) h += '<p class="te-muted">يُتاح الاختبار بعد إنهاء جميع الوحدات.</p>';
    else h += '<ul class="te-rules"><li>' + e(p.questions_per_attempt) + ' سؤالًا، والمدة ' + e(p.duration_minutes) + ' دقيقة تبدأ من لحظة البدء.</li><li>إغلاق الصفحة لا يُسلِّم الاختبار؛ ارجع من الحساب نفسه لتكمل، والوقت مستمر.</li><li>يُسلَّم الاختبار عند الضغط على «تسليم» أو تلقائيًا عند انتهاء الوقت.</li><li>محاولة واحدة فقط.</li></ul><button type="button" class="btn btn-primary" data-start>ابدأ الاختبار</button>';
    st.el.innerHTML = h + '</section></div>';
    st.el.querySelector('[data-back]').onclick = load;
    st.el.querySelectorAll('[data-mod]').forEach(function (b) { b.onclick = function () { moduleView(+b.getAttribute('data-mod')); }; });
    var sb = st.el.querySelector('[data-start]');
    if (sb) sb.onclick = function () { modal('بدء الاختبار', '<p>سيبدأ العدّ التنازلي فور التأكيد، ولا يمكن إيقافه. هل أنت مستعد؟</p>', 'ابدأ الآن', function () { return rpc('training_start_exam', { p_assignment: st.asg.id }).then(examView); }); };
    var cb = st.el.querySelector('[data-exam]'); if (cb) cb.onclick = function () { rpc('training_start_exam', { p_assignment: st.asg.id }).then(examView).catch(function (x) { toast(msg(x), true); }); };
  }

  function moduleView(i) {
    st.view = 'module';
    var m = course().modules[i], done = !!(st.progress.completed || {})[m.id], open = !st.progress.exam;
    var list = function (a) { return '<ul>' + (a || []).map(function (x) { return '<li>' + e(x) + '</li>'; }).join('') + '</ul>'; };
    st.el.innerHTML = '<div class="te-page"><button type="button" class="btn ghost te-back" data-back>رجوع إلى الدورة</button><article class="te-card te-article"><span class="te-tag">الوحدة ' + (i + 1) + ' من ' + course().modules.length + ' · ' + e(m.tag) + '</span><h2>' + e(m.title) + '</h2>' +
      '<h3>الأهداف</h3>' + list(m.goals) + '<h3>الشرح</h3><div class="te-body">' + m.body + '</div>' +
      '<h3>موقف عملي</h3><div class="te-case"><p>' + e(m.scenario) + '</p></div>' +
      '<div class="te-dd"><div class="te-do"><h4>افعل</h4>' + list(m.do) + '</div><div class="te-dont"><h4>لا تفعل</h4>' + list(m.dont) + '</div></div>' +
      '<h3>سؤال للتحقق من الفهم</h3><div class="te-check"><p>' + e(m.check && m.check.q) + '</p><button type="button" class="btn ghost" data-reveal>إظهار الإجابة</button><p class="te-answer" hidden>' + e(m.check && m.check.a) + '</p></div>' +
      '<p class="te-sum"><b>الخلاصة:</b> ' + e(m.summary) + '</p>' +
      (done ? '<p class="te-ok">أنهيت هذه الوحدة.</p>' : open ? '<button type="button" class="btn btn-primary" data-done>أنهيت قراءة الوحدة</button>' : '') + '</article></div>';
    st.el.querySelector('[data-back]').onclick = courseView;
    st.el.querySelector('[data-reveal]').onclick = function () { st.el.querySelector('.te-answer').hidden = false; this.remove(); };
    var d = st.el.querySelector('[data-done]');
    if (d) d.onclick = function () {
      d.disabled = true;
      rpc('training_complete_module', { p_assignment: st.asg.id, p_module: m.id })
        .then(function () { return rpc('training_course_progress', { p_assignment: st.asg.id }); })
        .then(function (p) { st.progress = p; courseView(); })
        .catch(function (x) { d.disabled = false; toast(msg(x), true); });
    };
  }

  // ---------------------------------------------------------------- trainee: exam
  function remaining() { return Math.max(0, Math.round((new Date(st.exam.deadline_at).getTime() - (Date.now() + st.offset)) / 1000)); }

  function examView(x) {
    st.exam = x;
    if (!x || x.status === 'submitted') { stopExam(); return rpc('training_course_progress', { p_assignment: st.asg.id }).then(function (p) { st.progress = p; courseView(); }); }
    st.view = 'exam';
    st.offset = new Date(x.server_now).getTime() - Date.now();
    if (st.idx >= x.questions.length) st.idx = 0;
    stopExam();
    st.blurHook = function () { if (document.visibilityState === 'hidden') rpc('training_record_blur', { p_assignment: st.asg.id }).catch(function () {}); };
    document.addEventListener('visibilitychange', st.blurHook);
    st.timer = setInterval(tick, 1000);
    drawQuestion();
  }

  function tick() {
    var r = remaining(), t = st.el.querySelector('.te-timer');
    if (t) { t.textContent = Math.floor(r / 60) + ':' + ('0' + r % 60).slice(-2); t.setAttribute('data-level', r <= 60 ? 'crit' : r <= 300 ? 'low' : 'ok'); }
    if (r <= 0 && !st.busy) { st.busy = true; stopExam(); rpc('training_submit_exam', { p_assignment: st.asg.id }).then(function (p) { st.busy = false; toast('انتهى الوقت وسُلِّمت إجاباتك تلقائيًا.'); examView(p); }).catch(function () { st.busy = false; load(); }); }
  }

  function drawQuestion() {
    var x = st.exam, q = x.questions[st.idx], ans = x.answers || {}, answered = Object.keys(ans).length;
    st.el.innerHTML = '<div class="te-page te-exam"><div class="te-exam-bar"><span>السؤال ' + (st.idx + 1) + ' من ' + x.questions.length + '</span><span data-answered>أجبت عن ' + answered + '</span><span class="te-timer" aria-live="off"></span></div>' +
      '<section class="te-card"><p class="te-q">' + e(q.text) + '</p><div class="te-options" role="radiogroup">' +
      q.options.map(function (o) { var sel = ans[q.id] === o.id; return '<button type="button" class="te-opt' + (sel ? ' sel' : '') + '" role="radio" aria-checked="' + sel + '" data-opt="' + e(o.id) + '">' + e(o.text) + '</button>'; }).join('') +
      '</div><div class="te-nav"><button type="button" class="btn ghost" data-prev' + (st.idx ? '' : ' disabled') + '>السابق</button><button type="button" class="btn ghost" data-next' + (st.idx < x.questions.length - 1 ? '' : ' disabled') + '>التالي</button><button type="button" class="btn btn-primary" data-submit>تسليم</button></div></section>' +
      '<nav class="te-grid" aria-label="الأسئلة">' + x.questions.map(function (qq, i) { return '<button type="button" data-go="' + i + '" class="' + (ans[qq.id] ? 'done' : '') + (i === st.idx ? ' cur' : '') + '" aria-label="السؤال ' + (i + 1) + '">' + (i + 1) + '</button>'; }).join('') + '</nav>' +
      '<p class="te-muted">إغلاق الصفحة لا يُسلِّم الاختبار، والوقت مستمر.</p></div>';
    tick();
    st.el.querySelectorAll('[data-opt]').forEach(function (b) { b.onclick = function () { choose(q.id, b.getAttribute('data-opt')); }; });
    st.el.querySelectorAll('[data-go]').forEach(function (b) { b.onclick = function () { st.idx = +b.getAttribute('data-go'); drawQuestion(); }; });
    st.el.querySelector('[data-prev]').onclick = function () { if (st.idx) { st.idx--; drawQuestion(); } };
    st.el.querySelector('[data-next]').onclick = function () { if (st.idx < x.questions.length - 1) { st.idx++; drawQuestion(); } };
    st.el.querySelector('[data-submit]').onclick = confirmSubmit;
  }

  function choose(qid, oid) {
    var prev = st.exam.answers[qid];
    st.exam.answers[qid] = oid; markAnswer();
    rpc('training_save_answer', { p_assignment: st.asg.id, p_question: qid, p_option: oid }).then(function (r) {
      if (r && r.status === 'submitted') { toast('انتهى الوقت وسُلِّمت إجاباتك تلقائيًا.'); examView({ status: 'submitted' }); }
    }).catch(function (x) {
      if (prev) st.exam.answers[qid] = prev; else delete st.exam.answers[qid];
      if (st.view === 'exam') markAnswer();
      toast(/already submitted/.test(String(x && x.message)) ? 'تم تسليم الاختبار بالفعل.' : 'لم تُحفظ الإجابة. تحقّق من الاتصال وأعد الاختيار.', true);
    });
  }

  // Update the selected option, grid and counter in place (no re-render, keeps the scroll position on mobile).
  function markAnswer() {
    var x = st.exam, q = x.questions[st.idx], ans = x.answers || {};
    st.el.querySelectorAll('.te-opt').forEach(function (b) { var on = ans[q.id] === b.getAttribute('data-opt'); b.classList.toggle('sel', on); b.setAttribute('aria-checked', String(on)); });
    st.el.querySelectorAll('[data-go]').forEach(function (b) { b.classList.toggle('done', !!ans[x.questions[+b.getAttribute('data-go')].id]); });
    var c = st.el.querySelector('[data-answered]'); if (c) c.textContent = 'أجبت عن ' + Object.keys(ans).length;
  }

  function confirmSubmit() {
    var left = st.exam.questions.length - Object.keys(st.exam.answers || {}).length;
    modal('تسليم الاختبار', (left ? '<p class="te-warn">لم تُجب عن ' + left + ' من الأسئلة.</p>' : '') + '<p>بعد التسليم لا يمكن تعديل الإجابات أو إعادة الاختبار.</p>', 'تسليم نهائي', function () {
      stopExam();
      return rpc('training_submit_exam', { p_assignment: st.asg.id }).then(function (p) { toast('تم استلام إجاباتك.'); return examView(p); }, function (x) { examView(st.exam); throw x; });
    });
  }


  // ---------------------------------------------------------------- owner / reviewer: exam result
  function resultView(id) {
    stopExam();
    st.view = 'result';
    st.el.innerHTML = '<div class="te-page"><p class="te-muted">جارٍ تحميل النتيجة…</p></div>';
    return rpc('training_exam_result', { p_assignment: id }).then(function (r) {
      if (!r || r.status !== 'submitted') { st.el.innerHTML = '<div class="te-page"><button type="button" class="btn ghost te-back" data-back>رجوع</button><p class="te-muted">لم يُسلَّم الاختبار بعد.</p></div>'; st.el.querySelector('[data-back]').onclick = load; return; }
      var mins = Math.floor((r.used_seconds || 0) / 60), secs = (r.used_seconds || 0) % 60;
      var h = '<div class="te-page"><button type="button" class="btn ghost te-back" data-back>رجوع إلى التكليفات</button>' +
        '<header class="te-head"><div><h2>نتيجة الاختبار: ' + e(r.trainee_name) + '</h2><p class="te-muted">' + e(r.track_name) + ' · سُلِّم في ' + e(date(r.submitted_at)) + (r.auto_submitted ? ' (تلقائيًا بانتهاء الوقت)' : '') + '</p></div></header>' +
        '<section class="te-card te-stats"><div><b>' + e(r.percent) + '%</b><span>النسبة</span></div><div>' + gradeChip(r.grade) + '<span>تقدير الاختبار</span></div>' +
        '<div><b' + (r.risk_flags ? ' class="te-flag"' : '') + '>' + e(r.risk_flags) + '</b><span>علامات الخطر</span></div><div><b>' + e(r.answered) + ' من ' + e(r.total) + '</b><span>أسئلة مُجابة</span></div>' +
        '<div><b>' + mins + ':' + ('0' + secs).slice(-2) + '</b><span>المدة المستغرقة</span></div><div><b>' + e(r.blur_count) + '</b><span>مرات مغادرة الصفحة</span></div></section>' +
        (r.risk_flags ? '<p class="te-warn">علامات الخطر تفتح مراجعة بشرية في المقابلة، وليست جزاءً.</p>' : '') +
        '<section class="te-card"><h3>الكفاءات</h3><div class="te-table"><table><thead><tr><th>الكفاءة</th><th>الدرجة</th><th>النسبة</th></tr></thead><tbody>' +
        (r.by_competency || []).map(function (c) { return '<tr' + (c.percent < 60 ? ' class="te-weak"' : '') + '><td>' + e(c.name_ar) + '</td><td>' + e(c.points) + ' من ' + e(c.max_points) + '</td><td>' + e(c.percent) + '%' + (c.percent < 60 ? ' <span class="te-note">أقل من 60%</span>' : '') + '</td></tr>'; }).join('') +
        '</tbody></table></div></section><section class="te-card"><h3>تفاصيل الأسئلة</h3><ol class="te-review">' +
        (r.questions || []).map(function (q) {
          var c = q.chosen, pts = c ? c.points : 0;
          return '<li data-points="' + pts + '"><p class="te-q-small"><span class="te-tag">' + e(q.competency) + '</span> ' + e(q.text) + '</p>' +
            '<p><b>اختيار المتدرب:</b> ' + (c ? e(c.text) : '<span class="te-muted">لم يُجب</span>') + ' <span class="te-pts">' + pts + ' من 2</span>' + (c && c.critical ? ' <span class="te-flag">علامة خطر</span>' : '') + '</p>' +
            (pts < 2 ? '<p><b>الأنسب:</b> ' + e((q.best || []).join(' / ')) + '</p>' : '') + '</li>';
        }).join('') + '</ol></section><p class="te-muted">هذه نتيجة الاختبار وحده. القرار النهائي يُبنى بعد المقابلة وتمثيل المواقف، ولا يرى المتدرب هذه الصفحة.</p></div>';
      st.el.innerHTML = h;
      st.el.querySelector('[data-back]').onclick = load;
    }).catch(function (x) { toast(msg(x), true); load(); });
  }

  w.SSMPDTrainingEvaluation = {
    render: function (el) { st.el = el; st.idx = 0; return load(); },
    _state: st
  };
})(window);
