/* Public candidate result page (training center PR 6). The link works ONCE: the server marks it viewed on the first
   valid call, so this page offers «حفظ PDF» (browser print) and «حفظ كصورة» before the candidate leaves.
   Only the decision label and the owner's message are ever returned: no score, no grade, no interview details. */
(function () {
  'use strict';
  var cfg = (window.SSMPD_CONFIG && window.SSMPD_CONFIG.supabase) || {};
  var URL_FN = String(cfg.url || '').replace(/\/+$/, '') + '/functions/v1/training-candidate';
  var app = document.getElementById('app');
  var ERR = { invalid_link: 'هذا الرابط غير صالح.', expired: 'انتهت صلاحية هذا الرابط.', closed: 'سبق فتح هذا الرابط أو أُلغي. تواصل مع المركز إن احتجت نسخة جديدة.', slow_down: 'محاولات كثيرة، انتظر دقيقة ثم أعد المحاولة.', server_error: 'حدث خطأ مؤقت، أعد المحاولة.' };
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function shell(inner) { app.innerHTML = '<div class="ce-card"><div class="ce-brand"><img src="assets/img/logo.svg" alt="Swnw"></div>' + inner + '</div>'; }
  function fail(m) { shell('<h1>تعذّر فتح الرابط</h1><p class="ce-err">' + esc(m) + '</p>'); }
  function show(r) {
    shell('<h1>نتيجة التقييم</h1><p>السيد/ة ' + esc(r.name) + '</p><p><strong style="font-size:22px;color:#0F369D">' + esc(r.label) + '</strong></p>' +
      (r.message ? '<div class="ce-consent"><p>' + esc(r.message).replace(/\n/g, '<br>') + '</p></div>' : '') +
      '<p class="ce-note">هذا الرابط يُفتح مرة واحدة فقط. احفظ نتيجتك الآن قبل إغلاق الصفحة.</p>' +
      '<button class="ce-btn" id="pdf">حفظ PDF</button> <button class="ce-btn ghost" id="img">حفظ كصورة</button>');
    app.querySelector('#pdf').onclick = function () { window.print(); };
    app.querySelector('#img').onclick = function () { savePng(r); };
  }
  function wrap(ctx, text, x, y, maxW, lh) {
    var words = String(text).split(/\s+/), line = '';
    words.forEach(function (w) { var t = line ? line + ' ' + w : w; if (ctx.measureText(t).width > maxW && line) { ctx.fillText(line, x, y); line = w; y += lh; } else line = t; });
    ctx.fillText(line, x, y); return y + lh;
  }
  function savePng(r) {
    var c = document.createElement('canvas'); c.width = 1000; c.height = 700; var x = c.getContext('2d');
    x.fillStyle = '#fff'; x.fillRect(0, 0, 1000, 700); x.fillStyle = '#0F369D'; x.fillRect(0, 0, 1000, 14);
    x.direction = 'rtl'; x.textAlign = 'right';
    x.font = '700 34px "BigVesta Arabic",Tahoma,sans-serif'; x.fillText('نتيجة التقييم', 940, 90);
    x.fillStyle = '#16212E'; x.font = '26px "BigVesta Arabic",Tahoma,sans-serif'; x.fillText('السيد/ة ' + r.name, 940, 150);
    x.fillStyle = '#0F369D'; x.font = '700 40px "BigVesta Arabic",Tahoma,sans-serif'; x.fillText(r.label, 940, 230);
    x.fillStyle = '#16212E'; x.font = '24px "BigVesta Arabic",Tahoma,sans-serif';
    if (r.message) wrap(x, r.message, 940, 300, 880, 40);
    var a = document.createElement('a'); a.download = 'result.png'; a.href = c.toDataURL('image/png'); document.body.appendChild(a); a.click(); a.remove();
  }
  var m = /[#&]t=([A-Za-z0-9]+)/.exec(location.hash || ''), token = m ? m[1] : '';
  if (token.length < 40) { fail(ERR.invalid_link); return; }
  var KEY = 'swnw-result-' + token.slice(0, 12), cached = null;
  try { cached = JSON.parse(sessionStorage.getItem(KEY) || 'null'); } catch (e) { /* none */ }
  if (cached) { show(cached); return; }
  fetch(URL_FN, { method: 'POST', headers: { 'Content-Type': 'application/json', apikey: cfg.anonKey || '' }, body: JSON.stringify({ action: 'result', token: token }) })
    .then(function (r) { return r.json().catch(function () { return { ok: false, error: 'server_error' }; }); })
    .then(function (j) { if (!j.ok) return fail(ERR[j.error] || ERR.server_error); try { sessionStorage.setItem(KEY, JSON.stringify(j.data)); } catch (e) { /* ignore */ } show(j.data); })
    .catch(function () { fail(ERR.server_error); });
})();
