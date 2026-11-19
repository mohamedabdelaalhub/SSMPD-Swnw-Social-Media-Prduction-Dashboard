/* Public candidate exam page (training center PR 4). Talks only to the `training-candidate` edge function.
   No dashboard code, no login. The one-time token lives in the URL hash (#t=...) and is never sent anywhere else. */
(function () {
  'use strict';
  var cfg = (window.SSMPD_CONFIG && window.SSMPD_CONFIG.supabase) || {};
  var URL_FN = String(cfg.url || '').replace(/\/+$/, '') + '/functions/v1/training-candidate';
  var app = document.getElementById('app');
  /* Consent text version. The wording below is the owner's to finalise after legal review; the version string is stored
     with the candidate's consent so a later text can be told apart. */
  var CONSENT_VERSION = 'draft-1';
  var CONSENT_TEXT = [
    'تُجمع بياناتك (الاسم، رقم الهاتف، البريد، الخبرة والمؤهلات، وإجاباتك في الاختبار) لغرض واحد هو تقييم صلاحيتك للوظيفة.',
    'يطّلع عليها الفريق المسؤول عن التقييم فقط، ولا تُشارك مع جهة خارجية.',
    'تُحفظ بياناتك خمس سنوات، ثم يُختصر السجل إلى الاسم والهاتف وتاريخ التقدّم والنتيجة فقط.',
    'يمكنك طلب حذف بياناتك في أي وقت بالتواصل مع المركز.',
    'لا تظهر لك درجة الاختبار؛ يُبلَّغ القرار من المركز.'
  ];
  var token = '', dev = '', st = null, timer = null, left = 0;

  function el(tag, attrs, html) { var e = document.createElement(tag); for (var k in (attrs || {})) e.setAttribute(k, attrs[k]); if (html != null) e.innerHTML = html; return e; }
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function shell(inner) { app.innerHTML = '<div class="ce-card"><div class="ce-brand"><img src="assets/img/logo.svg" alt="Swnw"></div>' + inner + '</div>'; }
  function fail(msg) { stopTimer(); shell('<h1>تعذّر فتح الرابط</h1><p class="ce-err">' + esc(msg) + '</p><p class="ce-muted">إذا كان الرابط صحيحًا فتواصل مع المركز.</p>'); }
  var ERR = {
    invalid_link: 'هذا الرابط غير صالح.', expired: 'انتهت صلاحية هذا الرابط.', closed: 'أُغلق هذا الرابط.',
    other_device: 'هذا الرابط مرتبط بجهاز آخر فُتح منه أولًا، ولا يمكن فتحه من جهاز مختلف.',
    slow_down: 'محاولات كثيرة، انتظر دقيقة ثم أعد المحاولة.', invalid_request: 'تعذّر قبول البيانات، راجع الحقول.',
    server_error: 'حدث خطأ مؤقت، أعد المحاولة.'
  };

  function deviceId() {
    var k = 'swnw-candidate-device', v = '';
    try { v = localStorage.getItem(k) || ''; } catch (e) { /* private mode */ }
    if (v.length < 16) {
      var a = new Uint8Array(16); (window.crypto || {}).getRandomValues && crypto.getRandomValues(a);
      v = 'dv-' + Array.prototype.map.call(a, function (x) { return ('0' + x.toString(16)).slice(-2); }).join('') + Date.now().toString(36);
      try { localStorage.setItem(k, v); } catch (e) { /* ignore */ }
    }
    return v;
  }
  function call(action, extra) {
    var body = { action: action, token: token, device: dev };
    for (var k in (extra || {})) body[k] = extra[k];
    return fetch(URL_FN, { method: 'POST', headers: { 'Content-Type': 'application/json', apikey: cfg.anonKey || '' }, body: JSON.stringify(body) })
      .then(function (r) { return r.json().catch(function () { return { ok: false, error: 'server_error' }; }); })
      .then(function (j) { if (!j.ok) { var e = Error(ERR[j.error] || ERR.server_error); e.code = j.error; throw e; } return j.data; });
  }
  function stopTimer() { if (timer) { clearInterval(timer); timer = null; } }

  function render(s) {
    st = s; stopTimer();
    if (s.stage === 'consent') return consent();
    if (s.stage === 'profile') return profile();
    if (s.stage === 'ready') return ready();
    if (s.stage === 'exam') return exam();
    return done();
  }
  function consent() {
    shell('<h1>مرحبًا ' + esc(st.name) + '</h1><p class="ce-muted">قبل البدء، اقرأ ما يلي واضغط «أوافق».</p><div class="ce-consent">' +
      CONSENT_TEXT.map(function (t) { return '<p>' + esc(t) + '</p>'; }).join('') + '</div>' +
      '<label style="font-weight:400"><input type="checkbox" id="ok" style="width:auto"> قرأتُ ما سبق وأوافق على جمع بياناتي واستخدامها لهذا الغرض.</label>' +
      '<button class="ce-btn" id="go" disabled>أوافق ومتابعة</button><p class="ce-err" id="e"></p>');
    var ok = app.querySelector('#ok'), go = app.querySelector('#go');
    ok.onchange = function () { go.disabled = !ok.checked; };
    go.onclick = function () { go.disabled = true; call('consent', { version: CONSENT_VERSION }).then(render).catch(function (e) { app.querySelector('#e').textContent = e.message; go.disabled = false; }); };
  }
  function profile() {
    shell('<h1>بياناتك</h1><label for="ph">رقم الهاتف</label><input id="ph" inputmode="tel" value="' + esc(st.phone) + '">' +
      '<label for="em">البريد الإلكتروني (اختياري)</label><input id="em" type="email" value="' + esc(st.email) + '">' +
      '<label for="ex">خبرتك العملية</label><textarea id="ex">' + esc(st.experience) + '</textarea>' +
      '<label for="qu">مؤهلاتك الدراسية والمهنية</label><textarea id="qu">' + esc(st.qualifications) + '</textarea>' +
      '<button class="ce-btn" id="go">حفظ ومتابعة</button><p class="ce-err" id="e"></p>');
    app.querySelector('#go').onclick = function () {
      var b = app.querySelector('#go'); b.disabled = true;
      call('profile', { phone: app.querySelector('#ph').value, email: app.querySelector('#em').value, experience: app.querySelector('#ex').value, qualifications: app.querySelector('#qu').value })
        .then(render).catch(function (e) { app.querySelector('#e').textContent = e.code === 'invalid_request' ? 'اكتب الخبرة والمؤهلات.' : e.message; b.disabled = false; });
    };
  }
  function ready() {
    shell('<h1>الاختبار</h1><p>سيبدأ الوقت بمجرد الضغط على «ابدأ الاختبار» ولا يتوقف. إغلاق الصفحة لا يُسلِّم الاختبار؛ يمكنك العودة من هذا الجهاز نفسه وإكمال الإجابة ما دام الوقت باقيًا، وإلا سُلِّمت إجاباتك تلقائيًا عند انتهاء الوقت.</p>' +
      '<p class="ce-note">يُرجى عدم مغادرة الصفحة أثناء الاختبار؛ يُسجَّل ذلك للمراجعة.</p><button class="ce-btn" id="go">ابدأ الاختبار</button><p class="ce-err" id="e"></p>');
    app.querySelector('#go').onclick = function () { var b = this; b.disabled = true; call('start').then(render).catch(function (e) { app.querySelector('#e').textContent = e.message; b.disabled = false; }); };
  }
  function fmt(n) { var m = Math.floor(n / 60), s = n % 60; return (m < 10 ? '0' : '') + m + ':' + (s < 10 ? '0' : '') + s; }
  function exam() {
    var x = st.exam, h = '<div class="ce-timer"><span>الوقت المتبقي</span><span id="t">' + fmt(x.remaining_seconds) + '</span></div><div class="ce-card">';
    x.questions.forEach(function (q, i) {
      h += '<div class="ce-q" data-q="' + esc(q.id) + '"><strong>' + (i + 1) + '. ' + esc(q.text) + '</strong>' +
        q.options.map(function (o) { return '<label class="ce-opt' + (x.answers[q.id] === o.id ? ' on' : '') + '"><input type="radio" name="q' + i + '" value="' + esc(o.id) + '"' + (x.answers[q.id] === o.id ? ' checked' : '') + '><span>' + esc(o.text) + '</span></label>'; }).join('') + '</div>';
    });
    app.innerHTML = h + '<p class="ce-note" id="p"></p><button class="ce-btn" id="sub">تسليم الاختبار</button><p class="ce-err" id="e"></p></div>';
    left = x.remaining_seconds;
    var answered = Object.keys(x.answers).length, p = app.querySelector('#p');
    function prog() { p.textContent = 'أجبتَ عن ' + answered + ' من ' + x.total; } prog();
    app.querySelectorAll('.ce-q').forEach(function (qe) {
      qe.addEventListener('change', function (ev) {
        var inp = ev.target; if (!inp || inp.type !== 'radio') return;
        var id = qe.getAttribute('data-q'); if (!x.answers[id]) answered++; x.answers[id] = inp.value;
        qe.querySelectorAll('.ce-opt').forEach(function (l) { l.classList.toggle('on', l.querySelector('input').checked); });
        prog();
        call('save', { question: id, option: inp.value }).then(function (r) { if (r && r.status === 'submitted') done(); }).catch(function (e) { app.querySelector('#e').textContent = e.message; });
      });
    });
    timer = setInterval(function () {
      left = Math.max(0, left - 1); var t = app.querySelector('#t'); if (t) t.textContent = fmt(left);
      if (left === 0) { stopTimer(); call('submit').then(render).catch(function () { done(); }); }
    }, 1000);
    app.querySelector('#sub').onclick = function () {
      if (answered < x.total && !confirm('لم تُجب عن كل الأسئلة. هل تريد التسليم؟')) return;
      var b = this; b.disabled = true; call('submit').then(render).catch(function (e) { app.querySelector('#e').textContent = e.message; b.disabled = false; });
    };
  }
  function done() { stopTimer(); shell('<h1>تم استلام إجاباتك</h1><p>شكرًا لك. أُغلق هذا الرابط، وسيتواصل معك المركز بالقرار.</p>'); }

  function blurred() { if (st && st.stage === 'exam') call('blur').catch(function () { /* best effort */ }); }
  document.addEventListener('visibilitychange', function () { if (document.hidden) blurred(); });
  window.addEventListener('blur', blurred);

  var m = /[#&]t=([A-Za-z0-9]+)/.exec(location.hash || '');
  token = m ? m[1] : '';
  if (token.length < 40) { fail(ERR.invalid_link); return; }
  dev = deviceId();
  call('open').then(render).catch(function (e) { fail(e.message); });
})();
