/* Training center PR 6: «نتيجتي» for the trainee (+ result-review request), review requests and the printable final
   report for the owner, and the candidate result link. All rules live in the server RPCs (migration 20261119150000);
   the trainee/candidate views never receive a number, a score, the interview scores or the answer key. */
(function (w) {
  'use strict';
  function e(v) { return String(v == null ? '' : v).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function rpc(name, args) {
    var c = w.SSMPDDb && w.SSMPDDb.client;
    if (!c) return Promise.reject(new Error('x'));
    return c.rpc(name, args || {}).then(function (r) { if (r.error) throw r.error; return r.data; });
  }
  function msg(err) {
    var m = String(err && err.message || err || '');
    if (/reason is required|response is required/.test(m)) return 'اكتب النص المطلوب.';
    if (/already requested/.test(m)) return 'سبق أن طلبت مراجعة هذه النتيجة.';
    if (/no decision/.test(m)) return 'لم يصدر قرار بعد.';
    if (/owner only|not allowed|not your/.test(m)) return 'ليست لديك صلاحية لهذا الإجراء.';
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
    var f = o.querySelector('textarea,input,[data-ok]'); if (f) f.focus();
    return o;
  }

  // ---------------------------------------------------------------- trainee: «نتيجتي»
  function myResult(id) {
    rpc('training_my_result', { p_assignment: id }).then(function (r) {
      if (!r || !r.decided) { modal('نتيجتي', '<p>لم يصدر القرار بعد.</p>'); return; }
      var h = '<p><strong style="font-size:20px">' + e(r.label) + '</strong></p>' +
        (r.learning_areas && r.learning_areas.length ? '<p>مجالات تحتاج إلى مزيد من التدريب والتطوير:</p><ul>' + r.learning_areas.map(function (a) { return '<li>' + e(a) + '</li>'; }).join('') + '</ul>' : '') +
        (r.message ? '<div class="te-card"><b>رسالة من الإدارة</b><p>' + e(r.message).replace(/\n/g, '<br>') + '</p></div>' : '');
      if (r.review) {
        h += '<p class="te-muted">' + (r.review.status === 'open' ? 'طلب مراجعة النتيجة قيد النظر.' : 'تمت مراجعة طلبك.') + '</p>' +
          (r.review.response ? '<div class="te-card"><b>رد الإدارة</b><p>' + e(r.review.response).replace(/\n/g, '<br>') + '</p></div>' : '');
        modal('نتيجتي', h);
      } else {
        var o = modal('نتيجتي', h + '<button type="button" class="btn ghost" data-ask>طلب مراجعة النتيجة</button>');
        o.querySelector('[data-ask]').onclick = function () { o.remove(); askReview(id); };
      }
    }).catch(function (x) { toast(msg(x), true); });
  }
  function askReview(id) {
    modal('طلب مراجعة النتيجة', '<p>اكتب سبب طلبك. تراجع الإدارة الطلب وتردّ عليك هنا.</p><label>سبب الطلب<textarea name="reason" rows="3" maxlength="1000"></textarea></label>', 'إرسال الطلب', function (o) {
      var r = o.querySelector('[name=reason]').value.trim(); if (r.length < 3) throw { userText: 'اكتب سبب الطلب.' };
      return rpc('training_request_result_review', { p_assignment: id, p_reason: r }).then(function () { toast('تم إرسال طلب المراجعة.'); });
    });
  }

  // ---------------------------------------------------------------- owner: review requests
  function reviewsSection(host) {
    return rpc('training_result_reviews').then(function (list) {
      var sec = host.querySelector('[data-reviews]');
      if (!list.length) { if (sec) sec.remove(); return; }
      if (!sec) { sec = document.createElement('section'); sec.className = 'te-card'; sec.setAttribute('data-reviews', ''); host.appendChild(sec); }
      sec.innerHTML = '<h3>طلبات مراجعة النتائج</h3>' + list.map(function (r) {
        return '<div class="te-card"><b>' + e(r.trainee_name) + '</b> · ' + e(r.track_name) + ' · القرار: ' + e(r.decision) + ' · ' + (r.status === 'open' ? 'مفتوح' : 'مُغلق') +
          '<p>' + e(r.reason).replace(/\n/g, '<br>') + '</p>' + (r.response ? '<p class="te-muted">الرد: ' + e(r.response) + '</p>' : '') +
          (r.status === 'open' ? '<button type="button" class="btn btn-primary" data-close-review="' + e(r.assignment_id) + '">الرد وإغلاق الطلب</button>' : '') + '</div>';
      }).join('');
      sec.querySelectorAll('[data-close-review]').forEach(function (b) { b.onclick = function () {
        modal('الرد على طلب المراجعة', '<label>ردّك على المتدرب<textarea name="r" rows="3" maxlength="2000"></textarea></label>', 'إغلاق الطلب', function (o) {
          var t = o.querySelector('[name=r]').value.trim(); if (t.length < 3) throw { userText: 'اكتب الرد.' };
          return rpc('training_close_result_review', { p_assignment: b.getAttribute('data-close-review'), p_response: t }).then(function () { toast('تم.'); reviewsSection(host); });
        }); }; });
    }).catch(function () { /* section is optional */ });
  }

  // ---------------------------------------------------------------- owner: printable final report
  var GR = { strong: 'قوي', medium: 'متوسط', weak: 'ضعيف' };
  function reportHtml(r) {
    var P = w.SSMPDPrint, d = r.decision || {}, x = r.exam, c = d.computed || {};
    var body = P.title('تقرير تقييم', 'القرار', d.label || 'قيد التقييم') +
      P.meta([['الاسم', r.subject_name], ['الصفة', r.subject_kind === 'candidate' ? 'مرشح' : 'موظف'], ['المسار', r.track_name], ['المراجع', r.reviewer_name], ['تاريخ الإسناد', P.day(r.created_at), 1], ['تاريخ القرار', d.decided_at ? P.day(d.decided_at) : '—', 1]]);
    if (x) body += '<h3 class="sec">الاختبار</h3>' + P.table(['النسبة', 'التقدير', 'علامات الخطر', 'الأسئلة المجابة', 'المدة', 'مرات مغادرة الصفحة'],
      ['<tr><td>' + P.esc(x.percent) + '%</td><td>' + P.esc(GR[x.grade] || x.grade) + '</td><td>' + P.esc(x.risk_flags) + '</td><td>' + P.esc(x.answered) + ' من ' + P.esc(x.total) + '</td><td>' + Math.floor((x.used_seconds || 0) / 60) + ' د' + (x.auto_submitted ? ' (تسليم تلقائي)' : '') + '</td><td>' + P.esc(x.blur_count) + '</td></tr>']);
    if (c.complete) body += '<h3 class="sec">المقابلة والتمثيل والقرار</h3>' + P.table(['متوسط المقابلة (من 5)', 'متوسط التمثيل (من 5)', 'علامات حاجزة', 'النتيجة المحسوبة', 'المقترح'],
      ['<tr><td>' + P.esc(c.interview_avg) + '</td><td>' + P.esc(c.roleplay_avg) + '</td><td>' + P.esc(c.blocking_flags) + '</td><td>' + P.esc(c.result) + '</td><td>' + P.esc(d.suggested_label) + '</td></tr>']);
    if (c.weaknesses && c.weaknesses.length) body += '<h3 class="sec">مجالات تحتاج إلى تطوير</h3><p>' + c.weaknesses.map(function (k) { return P.esc(k.name_ar); }).join('، ') + '</p>';
    if (d.override_reason) body += '<div class="box"><h4>سبب تغيير القرار المقترح</h4><p>' + P.esc(d.override_reason) + '</p></div>';
    if (d.message) body += '<div class="box"><h4>رسالة الإدارة</h4><p>' + P.esc(d.message) + '</p></div>';
    if (r.review) body += '<div class="box"><h4>طلب مراجعة النتيجة</h4><p>' + P.esc(r.review.reason) + '</p><p>' + (r.review.status === 'open' ? 'قيد النظر' : 'الرد: ' + P.esc(r.review.response)) + '</p></div>';
    body += P.sig([['اعتماد الإدارة', d.decided_by || ''], ['المراجع', r.reviewer_name || ''], ['ختم المركز', '']]) +
      '<div class="note">تقرير داخلي سري. طُبع من اللوحة يوم <span class="ltr">' + P.esc(P.day(new Date())) + '</span>.</div>';
    return P.documentHtml('تقرير تقييم', P.flow(body));
  }
  function printReport(id) {
    if (!w.SSMPDPrint) { toast('تعذّر تحميل قالب الطباعة.', true); return; }
    var win; try { win = w.SSMPDPrint.blank(); } catch (x) { toast(x.message, true); return; }
    rpc('training_final_report', { p_assignment: id }).then(function (r) { w.SSMPDPrint.open(reportHtml(r), win); }).catch(function (x) { try { win.close(); } catch (y) { /* ignore */ } toast(msg(x), true); });
  }

  // ---------------------------------------------------------------- owner: candidate result link
  function issueResultLink(id, name, phone) {
    modal('رابط نتيجة المرشح', '<p>يُنشأ رابط جديد ويُلغى أي رابط سابق. الرابط يُفتح مرة واحدة فقط، ويظهر لك الآن فقط.</p><label>مدة الصلاحية بالأيام<input name="days" type="number" min="1" max="60" value="14"></label>', 'إنشاء الرابط', function (o) {
      var days = parseInt(o.querySelector('[name=days]').value, 10); if (!(days >= 1 && days <= 60)) throw { userText: 'مدة الصلاحية من يوم إلى 60 يومًا.' };
      return rpc('training_issue_result_link', { p_assignment: id, p_days: days }).then(function (r) {
        var base = location.href.split('#')[0].split('?')[0].replace(/[^\/]*$/, ''), url = base + 'candidate-result.html#t=' + r.token;
        var digits = String(phone || '').replace(/\D/g, ''); if (digits.indexOf('00') === 0) digits = digits.slice(2); else if (digits.charAt(0) === '0') digits = '20' + digits.slice(1);
        var wa = digits ? 'https://wa.me/' + digits + '?text=' + encodeURIComponent('السلام عليكم ' + name + '، هذا رابط نتيجة تقييمك من مركز Swnw. يُفتح مرة واحدة فقط: ' + url) : null;
        setTimeout(function () {
          var o2 = modal('رابط نتيجة المرشح', '<p>صلاحية الرابط حتى ' + e(date(r.expires_at)) + '. يُفتح مرة واحدة فقط.</p><input type="text" readonly dir="ltr" value="' + e(url) + '" data-url>' +
            '<div class="te-actions"><button type="button" class="btn ghost" data-copy>نسخ اللينك</button>' + (wa ? '<a class="btn ghost" target="_blank" rel="noopener" href="' + e(wa) + '">تجهيز رسالة واتساب</a>' : '') + '</div>' +
            '<p class="te-muted">«تجهيز رسالة واتساب» يفتح المحادثة بالنص جاهزًا، ولا يُرسل شيئًا حتى تضغط أنت إرسال.</p>');
          o2.querySelector('[data-copy]').onclick = function () { (navigator.clipboard ? navigator.clipboard.writeText(url) : Promise.reject()).then(function () { toast('تم نسخ الرابط.'); }, function () { o2.querySelector('[data-url]').select(); toast('حدّد الرابط وانسخه يدويًا.', true); }); };
        }, 0);
      });
    });
  }

  // Hook: after the training home renders, add the «نتيجتي» / «تقرير نهائي» buttons and the review-requests section.
  function install() {
    var T = w.SSMPDTrainingEvaluation;
    if (!T || T._resultsHooked) return;
    T._resultsHooked = true;
    var orig = T.render;
    T.render = function (el) {
      var p = orig.apply(this, arguments);
      return Promise.resolve(p).then(function (r) {
        var page = el && el.querySelector('.te-page'), list = (T._state && T._state.list) || [];
        if (!page) return r;
        list.forEach(function (a) {
          if (a.status !== 'decided') return;
          page.querySelectorAll('[data-open="' + a.id + '"]').forEach(function (b) {
            if (b.parentNode.querySelector('[data-myresult="' + a.id + '"]') || a.relation !== 'trainee') return;
            var nb = document.createElement('button'); nb.type = 'button'; nb.className = 'btn ghost'; nb.setAttribute('data-myresult', a.id); nb.textContent = 'نتيجتي';
            nb.onclick = function () { myResult(a.id); }; b.parentNode.appendChild(nb);
          });
          if (isOwner()) page.querySelectorAll('[data-open="' + a.id + '"],[data-result="' + a.id + '"]').forEach(function (b) {
            if (b.parentNode.querySelector('[data-report="' + a.id + '"]')) return;
            var nb = document.createElement('button'); nb.type = 'button'; nb.className = 'btn ghost'; nb.setAttribute('data-report', a.id); nb.textContent = 'تقرير نهائي';
            nb.onclick = function () { printReport(a.id); }; b.parentNode.appendChild(nb);
          });
        });
        if (isOwner()) reviewsSection(page);
        return r;
      });
    };
  }
  install();
  w.SSMPDTrainingResults = { myResult: myResult, printReport: printReport, issueResultLink: issueResultLink, _reportHtml: reportHtml };
})(window);
