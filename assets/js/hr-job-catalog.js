(function (w) {
  'use strict';
  // Job catalog («دليل الوظائف»): HR tab + job block in the employee file + «وظيفتي» + contract annex print.
  // Server: hr_jobs / hr_job_save / hr_job_assign / hr_job_band / hr_my_job / hr_job_annex (migration 20261121190000).
  // Salary figures arrive only for super_admin / finance (server-side); doctors are outside the catalog.
  var cat = null;
  function U() { return w.SSMPDWorkforceUtils; }
  function e(v) { return U().escape(v); }
  function num(v) { return Number(v).toLocaleString('en-US'); }
  function load() { return U().rpc('hr_jobs').then(function (r) { cat = r; return r; }); }
  function badge(k) { return '<span class="jc-badge ' + (k === 'auto' ? 'auto' : 'manual') + '">' + (k === 'auto' ? 'تلقائي' : 'يدوي') + '</span>'; }
  function list(items) { return (items || []).length ? '<ul class="jc-list">' + items.map(function (t) { return '<li>' + e(t) + '</li>'; }).join('') + '</ul>' : '<p class="wn-empty">لسه مش متكتب</p>'; }
  function bandText(j) { return j.salary_min != null && j.salary_max != null ? num(j.salary_min) + ' – ' + num(j.salary_max) : 'النطاق لسه مش محدد'; }
  function err(box, ex) { var p = box.querySelector('[data-jc-err]'); if (p) p.textContent = ex && ex.message || 'تعذر التنفيذ'; }

  // ---- contract annex (official letterhead, logo only — no centre name in the title) ----
  function printAnnex(d) {
    var P = w.SSMPDPrint, win = P.blank();
    function box(h, items) { return '<div class="box"><h4>' + P.esc(h) + '</h4>' + (items.length ? items.map(function (t) { return '<div class="kv"><span>' + P.esc(t) + '</span></div>'; }).join('') : '<div class="kv"><span>—</span></div>') + '</div>'; }
    var body = P.title('ملحق عقد العمل — الوصف الوظيفي') +
      P.meta([['الموظف', d.full_name], ['الوظيفة', d.title_ar], ['القسم', d.department], d.experience ? ['الخبرة', d.experience] : null]) +
      box('المهام', d.tasks || []) + box('المؤهلات المطلوبة', d.qualifications || []) +
      P.sig([['توقيع الموظف', ''], ['توقيع الإدارة', '']]);
    P.open(P.documentHtml('ملحق عقد العمل', P.page(body)), win);
  }

  // ---- salary vs band bar (LTR scale, warning only) ----
  function bandBar(b) {
    if (!b || !b.visible) return '';
    var msg = { no_job: 'اربط الموظف بوظيفة علشان تظهر المقارنة.', no_band: 'نطاق الراتب للوظيفة دي لسه مش محدد.', no_salary: 'مفيش عقد راتب معتمد ساري للموظف في الحسابات.' }[b.status];
    if (msg) return '<p class="wn-empty">' + msg + '</p>';
    var mn = Number(b.salary_min), mx = Number(b.salary_max), s = Number(b.salary), lo = Math.floor((Math.min(mn, s) - 1000) / 500) * 500, hi = Math.ceil((Math.max(mx, s) + 1000) / 500) * 500;
    function pos(v) { return ((v - lo) / (hi - lo) * 100).toFixed(1); }
    var ok = b.status === 'within', text = ok ? 'الراتب المسجل ' + num(s) + ' داخل نطاق الوظيفة.' : 'الراتب المسجل ' + num(s) + ' ' + (b.status === 'below' ? 'أقل' : 'أعلى') + ' من نطاق الوظيفة بـ ' + num(b.diff) + '.';
    return '<div class="jc-bar" dir="ltr"><i class="rng" style="left:' + pos(mn) + '%;width:' + (pos(mx) - pos(mn)).toFixed(1) + '%"></i><i class="dot ' + (ok ? 'ok' : 'warn') + '" style="left:' + pos(s) + '%"></i></div>' +
      '<div class="jc-scale" dir="ltr"><span>' + num(lo) + '</span><span>' + num(mn) + '</span><span>' + num(mx) + '</span><span>' + num(hi) + '</span></div>' +
      '<p class="jc-note ' + (ok ? 'ok' : 'warn') + '">' + e(text) + '</p><p class="wn-empty">ده تنبيه بس، ومش بيمنع حفظ الراتب.</p>';
  }

  // ---- edit dialog ----
  function parseKpis(txt) {
    return String(txt || '').split('\n').map(function (l) { return l.trim(); }).filter(Boolean).map(function (l) {
      var m = /^(تلقائي|يدوي)\s*[:：]\s*(.+?)(?:\s*\|\s*(.*))?$/.exec(l);
      if (!m) throw Error('اكتب كل مؤشر في سطر بالشكل: تلقائي: الاسم | الهدف — أو: يدوي: الاسم | الهدف');
      return { kind: m[1] === 'تلقائي' ? 'auto' : 'manual', name: m[2].trim(), target: (m[3] || '').trim() };
    });
  }
  function lines(txt) { return String(txt || '').split('\n').map(function (l) { return l.trim(); }).filter(Boolean); }
  function area(name, label, val) { return '<label class="wp-field wp-wide">' + e(label) + '<textarea name="' + name + '" rows="4">' + e(val) + '</textarea></label>'; }
  function editJob(j, done) {
    var u = U(), sv = cat.salary_visible, isNew = !j; j = j || { tasks: [], qualifications: [], kpis: [] };
    var kp = (j.kpis || []).map(function (k) { return (k.kind === 'auto' ? 'تلقائي' : 'يدوي') + ': ' + k.name + (k.target ? ' | ' + k.target : ''); }).join('\n');
    u.modal(isNew ? 'وظيفة جديدة' : 'تعديل ' + j.title_ar,
      u.field('title_ar', 'اسم الوظيفة', 'text', j.title_ar, 'required') + u.field('title_en', 'الاسم بالإنجليزي', 'text', j.title_en) + u.field('department', 'القسم', 'text', j.department) + u.field('experience', 'الخبرة المطلوبة', 'text', j.experience) +
      area('tasks', 'المهام (كل مهمة في سطر)', (j.tasks || []).join('\n')) + area('qualifications', 'المؤهلات (كل واحد في سطر)', (j.qualifications || []).join('\n')) +
      area('kpis', 'مؤشرات الأداء (سطر لكل مؤشر: «تلقائي: الاسم | الهدف» أو «يدوي: الاسم | الهدف»)', kp) + u.field('incentive', 'الحافز (وصف)', 'text', j.incentive) +
      (sv ? u.field('salary_min', 'أقل راتب في النطاق', 'number', j.salary_min, 'min="0" step="1"') + u.field('salary_max', 'أعلى راتب في النطاق', 'number', j.salary_max, 'min="0" step="1"') + u.field('salary_approved', 'الراتب المعتمد (لو متحدد)', 'number', j.salary_approved, 'min="0" step="1"') + u.field('salary_note', 'ملاحظة على الراتب', 'text', j.salary_note) : '<p class="wp-wide">الرواتب بتتعدل من السوبر أدمن أو الحسابات بس.</p>'),
      function (v) {
        var p;
        try { p = { id: j.id || null, revision: j.revision || 0, title_ar: v.title_ar, title_en: v.title_en, department: v.department, experience: v.experience, tasks: lines(v.tasks), qualifications: lines(v.qualifications), kpis: parseKpis(v.kpis), incentive: v.incentive }; } catch (ex) { return Promise.reject(ex); }
        if (sv) { p.salary_min = v.salary_min; p.salary_max = v.salary_max; p.salary_approved = v.salary_approved; p.salary_note = v.salary_note; }
        return u.rpc('hr_job_save', { p_payload: p }).then(done);
      });
  }

  // ---- HR tab ----
  function mount(shell, data, state) {
    var box = document.createElement('div'); box.className = 'jc'; shell.append(box);
    box.innerHTML = '<p class="wn-empty">جاري تحميل دليل الوظائف…</p>';
    function draw() { return load().then(function () { render(box, data, state, draw); }).catch(function (ex) { box.innerHTML = '<p role="alert" class="wn-empty">' + e(ex.message) + '</p>'; }); }
    draw();
  }
  function personOptions(data, jobId) { return (data.people || []).filter(function (p) { return p.kind !== 'doctor' && p.status !== 'ended' && p.job_id !== jobId; }).map(function (p) { return [p.id, p.full_name]; }); }
  function assign(box, data, pid, jid, redraw) { U().rpc('hr_job_assign', { p_person: pid, p_job: jid || null }).then(function () { var pp = (data.people || []).find(function (x) { return x.id === pid; }); if (pp) pp.job_id = jid || null; redraw(); }).catch(function (ex) { err(box, ex); }); }
  function render(box, data, state, redraw) {
    var jobs = cat.jobs, j = state.jobId && jobs.find(function (x) { return x.id === state.jobId; });
    if (j) return detail(box, j, data, state, redraw);
    var empty = jobs.filter(function (x) { return !x.people.length; }).length, linked = jobs.reduce(function (a, x) { return a + x.people.length; }, 0), un = cat.unclassified || [];
    var depts = Array.from(new Set(jobs.map(function (x) { return x.department; }).filter(Boolean))), f = state.jobDept || '';
    box.innerHTML = '<div class="jc-head"><div><h3>دليل الوظائف</h3><p>كل وظيفة بمهامها ومؤهلاتها ومؤشرات أدائها — والموظف بيتربط بوظيفة واحدة (منفصلة عن دوره في الداشبورد). الأطباء برّه الدليل.</p></div>' + (cat.can_edit ? '<button type="button" class="btn" data-jc-new>+ وظيفة جديدة</button>' : '') + '</div>' +
      '<div class="jc-pills" role="group" aria-label="تصفية بالقسم"><button type="button" data-jc-dept="" aria-pressed="' + (!f) + '">الكل</button>' + depts.map(function (d) { return '<button type="button" data-jc-dept="' + e(d) + '" aria-pressed="' + (f === d) + '">' + e(d) + '</button>'; }).join('') + '</div>' +
      '<div class="jc-kpis"><div class="jc-kpi hero"><b>' + empty + '</b><span>وظايف مفيش حد عليها لسه</span></div><div class="jc-kpi"><b>' + jobs.length + '</b><span>وظيفة في الدليل</span></div><div class="jc-kpi"><b>' + linked + '</b><span>موظف مربوط</span></div><div class="jc-kpi"><b>' + un.length + '</b><span>ملف برّه الدليل</span></div></div>' +
      '<div class="jc-grid">' + jobs.filter(function (x) { return !f || x.department === f; }).map(function (x) {
        return '<button type="button" class="jc-card" data-jc-open="' + e(x.id) + '"><span class="jc-chip">' + e(x.department) + '</span><h4>' + e(x.title_ar) + '</h4>' +
          (cat.salary_visible ? '<p class="jc-band">' + e(bandText(x)) + '</p>' : '<p class="jc-lock">🔒 الراتب ظاهر للسوبر أدمن والحسابات بس</p>') +
          (x.incentive ? '<p class="jc-inc">' + e(x.incentive) + '</p>' : '') + '<p class="' + (x.people.length ? 'jc-cnt' : 'jc-cnt none') + '">' + (x.people.length ? x.people.length + ' موظف على الوظيفة' : 'مفيش حد عليها لسه') + '</p></button>';
      }).join('') + '</div>' +
      (un.length ? '<section class="jc-out"><h4>ملفات برّه الدليل (' + un.length + ')</h4><p class="wn-empty">اربط كل ملف بوظيفة من القائمة، أو سيبه لو الوظيفة مش في الدليل.</p>' + un.map(function (p) {
        return '<div class="jc-row"><span>' + e(p.full_name) + (p.job_title ? ' <small>(' + e(p.job_title) + ')</small>' : '') + '</span>' + U().select('job_for_' + p.id, '', [['', '— اختر الوظيفة —']].concat(jobs.map(function (x) { return [x.id, x.title_ar]; })), '') + '<button type="button" class="btn ghost" data-jc-link="' + e(p.id) + '">ربط</button></div>';
      }).join('') + '</section>' : '') + '<p role="alert" data-jc-err></p>';
    box.querySelectorAll('[data-jc-dept]').forEach(function (b) { b.onclick = function () { state.jobDept = b.dataset.jcDept; render(box, data, state, redraw); }; });
    box.querySelectorAll('[data-jc-open]').forEach(function (b) { b.onclick = function () { state.jobId = b.dataset.jcOpen; render(box, data, state, redraw); }; });
    var nb = box.querySelector('[data-jc-new]'); if (nb) nb.onclick = function () { editJob(null, redraw); };
    box.querySelectorAll('[data-jc-link]').forEach(function (b) { b.onclick = function () { var s = box.querySelector('[name=job_for_' + b.dataset.jcLink + ']'); if (!s.value) return err(box, Error('اختر الوظيفة الأول')); assign(box, data, b.dataset.jcLink, s.value, redraw); }; });
  }
  function detail(box, j, data, state, redraw) {
    var opts = personOptions(data, j.id);
    box.innerHTML = '<p class="jc-crumb"><button type="button" class="btn ghost" data-jc-back>← دليل الوظائف</button> <span>' + e(j.department) + '</span></p><h3>' + e(j.title_ar) + (j.title_en ? ' <small>' + e(j.title_en) + '</small>' : '') + '</h3>' +
      '<div class="jc-two"><div><section class="jc-box"><h4>المهام</h4>' + list(j.tasks) + '</section><section class="jc-box"><h4>المؤهلات المطلوبة' + (j.experience ? ' — الخبرة: ' + e(j.experience) : '') + '</h4>' + list(j.qualifications) + '</section>' +
      '<section class="jc-box"><h4>مؤشرات الأداء</h4><p class="wn-empty">الهدف يحدده السوبر أدمن والمدير الإداري. المؤشر التلقائي بيتحسب من بيانات الداشبورد، واليدوي بيقيّمه المدير المباشر ويعتمده السوبر أدمن.</p>' +
      ((j.kpis || []).length ? j.kpis.map(function (k) { return '<div class="jc-kpirow"><span>' + e(k.name) + '</span>' + badge(k.kind) + '<em>' + (k.target ? 'الهدف: ' + e(k.target) : 'الهدف: يتحدد') + '</em></div>'; }).join('') : '<p class="wn-empty">لسه مفيش مؤشرات</p>') + '</section></div>' +
      '<div><section class="jc-box"><h4>الراتب والحافز</h4>' + (cat.salary_visible ? '<p class="jc-band big">' + e(bandText(j)) + '</p>' + (j.salary_approved != null ? '<p>المعتمد: ' + num(j.salary_approved) + '</p>' : '') + (j.salary_note ? '<p>' + e(j.salary_note) + '</p>' : '') : '<p class="jc-lock">🔒 الراتب ظاهر للسوبر أدمن والحسابات بس</p>') + (j.incentive ? '<p>الحافز: ' + e(j.incentive) + '</p>' : '') + '</section>' +
      '<section class="jc-box"><h4>الموظفون على الوظيفة (' + j.people.length + ')</h4>' + (j.people.length ? j.people.map(function (p) { return '<div class="jc-row"><span>' + e(p.full_name) + '</span><button type="button" class="btn ghost" data-jc-annex="' + e(p.id) + '">ملحق العقد (PDF)</button><button type="button" class="btn ghost" data-jc-unlink="' + e(p.id) + '">فك الربط</button></div>'; }).join('') : '<p class="wn-empty">مفيش حد على الوظيفة دي لسه</p>') +
      (opts.length ? '<div class="jc-row">' + U().select('jc_person', '', [['', '— اختر موظف —']].concat(opts), '') + '<button type="button" class="btn" data-jc-add>ربط موظف بالوظيفة</button></div>' : '') + '</section>' +
      (cat.can_edit ? '<button type="button" class="btn" data-jc-edit>تعديل الوصف</button>' : '') + '<p role="alert" data-jc-err></p></div></div>';
    box.querySelector('[data-jc-back]').onclick = function () { state.jobId = null; render(box, data, state, redraw); };
    var eb = box.querySelector('[data-jc-edit]'); if (eb) eb.onclick = function () { editJob(j, redraw); };
    var ab = box.querySelector('[data-jc-add]'); if (ab) ab.onclick = function () { var s = box.querySelector('[name=jc_person]'); if (!s.value) return err(box, Error('اختر الموظف الأول')); assign(box, data, s.value, j.id, redraw); };
    box.querySelectorAll('[data-jc-unlink]').forEach(function (b) { b.onclick = function () { assign(box, data, b.dataset.jcUnlink, null, redraw); }; });
    box.querySelectorAll('[data-jc-annex]').forEach(function (b) { b.onclick = function () { U().rpc('hr_job_annex', { p_person: b.dataset.jcAnnex }).then(printAnnex).catch(function (ex) { err(box, ex); }); }; });
  }

  // ---- block inside the HR employee file ----
  function profile(box, person, data) {
    if (!data.can_manage || !person || person.kind === 'doctor') return;
    box.className = 'jc-profile'; box.innerHTML = '<h3>الوظيفة في الدليل</h3><p class="wn-empty">جاري التحميل…</p>';
    function draw() {
      var jobs = cat.jobs, cur = jobs.find(function (x) { return x.id === person.job_id; });
      box.innerHTML = '<h3>الوظيفة في الدليل</h3>' + U().select('jc_job', 'الوظيفة (منفصلة عن دور الدخول)', [['', '— من غير وظيفة —']].concat(jobs.map(function (x) { return [x.id, x.title_ar + ' — ' + x.department]; })), person.job_id || '') +
        '<div class="jc-row"><button type="button" class="btn" data-jc-save>حفظ الوظيفة</button>' + (cur ? '<button type="button" class="btn ghost" data-jc-annex>ملحق العقد (PDF)</button>' : '') + '</div><div data-jc-band></div><p role="alert" data-jc-err></p>';
      box.querySelector('[data-jc-save]').onclick = function () { var v = box.querySelector('[name=jc_job]').value; U().rpc('hr_job_assign', { p_person: person.id, p_job: v || null }).then(function () { person.job_id = v || null; return load().then(draw); }).catch(function (ex) { err(box, ex); }); };
      var an = box.querySelector('[data-jc-annex]'); if (an) an.onclick = function () { U().rpc('hr_job_annex', { p_person: person.id }).then(printAnnex).catch(function (ex) { err(box, ex); }); };
      if (cat.salary_visible) U().rpc('hr_job_band', { p_person: person.id }).then(function (b) { var t = box.querySelector('[data-jc-band]'); if (t) t.innerHTML = '<h4>الراتب مقابل نطاق الوظيفة <small>🔒 للسوبر أدمن والحسابات</small></h4>' + bandBar(b); }).catch(function () { });
    }
    load().then(draw).catch(function (ex) { box.innerHTML = '<p role="alert" class="wn-empty">' + e(ex.message) + '</p>'; });
  }

  // ---- «وظيفتي» (no salary, no incentive, no targets) ----
  function mine(shell) {
    var box = document.createElement('div'); box.className = 'jc'; shell.append(box); box.innerHTML = '<p class="wn-empty">جاري التحميل…</p>';
    U().rpc('hr_my_job').then(function (r) {
      var j = r && r.job; if (!j) { box.innerHTML = '<p class="wn-empty">لسه ماتربطتش بوظيفة في دليل الوظائف. كلّم الموارد البشرية.</p>'; return; }
      box.innerHTML = '<h3>وظيفتي: ' + e(j.title_ar) + '</h3><p>' + e(j.department) + ' — الراتب مش بيظهر هنا.</p><section class="jc-box"><h4>مهامي</h4>' + list(j.tasks) + '</section><section class="jc-box"><h4>المؤهلات</h4>' + list(j.qualifications) + '</section>' +
        '<section class="jc-box"><h4>إزاي بيتقيّم أدائي</h4>' + ((j.kpis || []).length ? j.kpis.map(function (k) { return '<div class="jc-kpirow"><span>' + e(k.name) + '</span>' + badge(k.kind) + '</div>'; }).join('') : '<p class="wn-empty">لسه مفيش مؤشرات</p>') + '</section><button type="button" class="btn" data-jc-print>تحميل ملحق العقد (PDF)</button>';
      box.querySelector('[data-jc-print]').onclick = function () { var a = w.SSMPDAuth && w.SSMPDAuth.currentAdmin || {}; printAnnex({ full_name: a.name || '', title_ar: j.title_ar, department: j.department, experience: j.experience, tasks: j.tasks, qualifications: j.qualifications }); };
    }).catch(function (ex) { box.innerHTML = '<p role="alert" class="wn-empty">' + e(ex.message) + '</p>'; });
  }

  w.SSMPDHRJobs = { mount: mount, profile: profile, mine: mine, printAnnex: printAnnex };
})(window);
