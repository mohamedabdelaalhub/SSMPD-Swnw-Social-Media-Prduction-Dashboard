/* «اسأل المساعد» — floating staff assistant + request cards + owner «طلبات الموظفين».
   Server contract (stub names agreed with main chat): list_my_requests, create_request, list_all_requests, decide_request,
   set_request_status + Edge Function assistant-answer. The assistant only explains and opens requests: it never edits data or moves money.
   Hidden until list_my_requests succeeds (rule 9: no button the server would refuse). */
(function (w) {
  'use strict';
  var d = w.document, S = { ok: false, panel: null, btn: null, reqs: [], msgs: [], redact: true, ctx: true, shot: null, owner: null };
  var ST = { open: 'مستني المالك', approved: 'اتوافق', in_progress: 'بيتنفذ', shipped: 'نزل', rejected: 'اترفض', need_info: 'محتاج توضيح' };
  function esc(v) { return String(v == null ? '' : v).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function admin() { return w.SSMPDAuth && w.SSMPDAuth.currentAdmin; }
  function isSuper() { var a = admin(); return !!(a && (a.roles || [a.role]).indexOf('super_admin') >= 0); }
  function client() { return w.SSMPDDb && w.SSMPDDb.client; }
  function rpc(n, a) { var c = client(); return c && c.rpc ? c.rpc(n, a || {}).then(function (r) { if (r.error) throw new Error(r.error.message || 'خطأ'); return r.data; }) : Promise.reject(new Error('no db')); }
  function answer(q, ctx) { var c = client(); return c && c.functions ? c.functions.invoke('assistant-answer', { body: { question: q, context: ctx } }).then(function (r) { if (r.error) throw new Error(r.error.message || 'خطأ'); return r.data; }) : Promise.reject(new Error('no fn')); }
  /* Adapter (the only place that knows server names) */
  var A = {
    mine: function () { return rpc('list_my_requests'); },
    create: function (p) { return rpc('create_request', p); },
    all: function () { return rpc('list_all_requests'); },
    decide: function (id, decision, note) { return rpc('decide_request', { p_id: id, p_decision: decision, p_note: note || null }); },
    status: function (id, st) { return rpc('set_request_status', { p_id: id, p_status: st }); },
    ask: answer
  };
  /* Redaction: patient names/phones never leave the screen (file number only). */
  function redact(t) { if (!S.redact) return String(t || ''); return String(t || '').replace(/(?:\+?\d[\d\s-]{8,}\d)/g, '[رقم تليفون]').replace(/٠-٩/g, ''); }
  function screenContext() {
    var tab = ''; try { tab = w.sessionStorage.getItem('ssmpd_active_tab') || ''; } catch (e) {}
    var title = (w.SSMPDUITitles && w.SSMPDUITitles.tabs && w.SSMPDUITitles.tabs[tab]) || tab;
    var heads = Array.prototype.slice.call(d.querySelectorAll('#view-container h1,#view-container h2,#view-container .tab-btn.active,#view-container button')).slice(0, 25)
      .map(function (n) { return (n.textContent || '').replace(/\s+/g, ' ').trim(); }).filter(Boolean);
    var txt = heads.join(' | ');
    return { tab: tab, title: title, labels: S.redact ? redact(txt) : txt };
  }
  function toast(m, k) { if (w.SSMPDToast) w.SSMPDToast.show(m, k || 'info'); }
  function statusChip(s) { return '<span class="sa-chip sa-' + esc(s) + '">' + esc(ST[s] || s) + '</span>'; }
  function reqCard(r) {
    var order = ['open', 'approved', 'in_progress', 'shipped'];
    return '<div class="sa-req" data-sa-req="' + esc(r.id) + '"><div class="sa-rh"><b>طلب ' + esc(r.number || r.id) + '</b>' + statusChip(r.status) + '</div><small>' + esc(r.text || '') + '</small>' + (r.screen ? '<small>الشاشة: ' + esc(r.screen) + '</small>' : '') +
      '<div class="sa-tl">' + order.map(function (k) { return '<i' + (k === r.status ? ' class="on"' : '') + '>' + esc(ST[k]) + '</i>'; }).join('') + '</div></div>';
  }
  function msgHtml(m) {
    if (m.kind === 'me') return '<div class="sa-m sa-me">' + (m.ctx ? '<span class="sa-ctx">📍 ' + esc(m.ctx) + '</span><br>' : '') + (m.shot ? '<div class="sa-shot">📷 صورة الشاشة اتحفظت مع الطلب</div>' : '') + esc(m.text) + '</div>';
    if (m.kind === 'steps') {
      return '<div class="sa-m sa-bot"><b>الخطوات:</b><ol class="sa-steps">' + m.steps.map(function (s) { return '<li>' + esc(s) + '</li>'; }).join('') + '</ol><div class="sa-row">' +
        (m.open ? '<button type="button" class="btn sa-pri" data-sa-open="' + esc(m.open) + '">ودّيني هناك ←</button>' : '') +
        (m.article ? '<button type="button" class="btn" data-sa-article="' + esc(m.article) + '">افتح الشرح</button>' : '') +
        (m.suggest ? '<button type="button" class="btn" data-sa-newreq="' + esc(m.q) + '">ده محتاج تعديل؟ افتح طلب</button>' : '') +
        '</div>' + (m.article ? '<div class="sa-src">المصدر: دليل الشرح</div>' : '') + '<div class="sa-safe">أنا بشرح بس. مش بعدّل بيانات ومش بحرّك فلوس.</div></div>';
    }
    if (m.kind === 'req') return '<div class="sa-m sa-bot">ده محتاج تعديل من الإدارة، فتحت لك <b>طلب رقم ' + esc(m.req.number || m.req.id) + '</b>.' + reqCard(m.req) + '</div>';
    if (m.kind === 'done') return '<div class="sa-m sa-bot sa-done"><b>✓ طلب ' + esc(m.req.number || m.req.id) + ' اتعمل</b><br>الحاجة اللي طلبتها اتعملت — ' + esc(m.req.how_to || 'اعملها كده: افتح الشاشة وجرّب.') + (m.req.open ? '<div class="sa-row"><button type="button" class="btn" data-sa-open="' + esc(m.req.open) + '">ودّيني هناك ←</button></div>' : '') + '</div>';
    return '<div class="sa-m sa-bot">' + esc(m.text) + '</div>';
  }
  function draw() {
    if (!S.panel) return;
    var box = S.panel.querySelector('[data-sa-msgs]'); if (!box) return;
    var list = S.msgs.length ? S.msgs : [{ kind: 'bot', text: 'اسألني «أعمل إزاي؟» أو قولي إيه اللي مش ظاهر أو غلط، وأنا أفتحلك طلب.' }];
    box.innerHTML = list.map(msgHtml).join('') + (S.reqs.length && !S.msgs.length ? '<div class="sa-m sa-bot"><b>طلباتي:</b>' + S.reqs.slice(0, 5).map(reqCard).join('') + '</div>' : '');
    box.scrollTop = box.scrollHeight;
  }
  function send() {
    var inp = S.panel.querySelector('[data-sa-input]'), q = inp.value.trim(); if (!q) return;
    var c = S.ctx ? screenContext() : null; inp.value = '';
    S.msgs.push({ kind: 'me', text: redact(q), ctx: c && c.title ? 'الشاشة: ' + c.title : '', shot: !!S.shot }); draw();
    A.ask(redact(q), c).then(function (r) {
      S.msgs.push({ kind: 'steps', q: q, steps: (r && r.steps) || [], article: r && r.help_article_id, open: r && r.can_open_screen ? (r.screen || (c && c.tab)) : '', suggest: !!(r && r.suggest_request) }); draw();
    }).catch(function () { S.msgs.push({ kind: 'bot', text: 'مقدرتش أجاوب دلوقتي. تقدر تفتح طلب للإدارة.' }); S.msgs.push({ kind: 'steps', q: q, steps: [], suggest: true }); draw(); });
  }
  function newReq(q) {
    var c = S.ctx ? screenContext() : null;
    A.create({ p_screen: c && c.title || null, p_text: redact(q), p_context: c ? { tab: c.tab, labels: c.labels } : null, p_image_ref: S.shot || null }).then(function (r) {
      var req = r && r.request ? r.request : (r || {}); req.text = q; req.screen = c && c.title; req.status = req.status || 'open'; S.shot = null;
      S.reqs.unshift(req); S.msgs.push({ kind: 'req', req: req }); draw();
    }).catch(function (e) { toast('مقدرتش أفتح الطلب: ' + e.message, 'error'); });
  }
  function openScreen(id) { close(); if (w.SSMPDApp && w.SSMPDApp.switchTab) w.SSMPDApp.switchTab(id); else { var b = d.querySelector('[data-tab="' + id + '"],[data-goto="' + id + '"]'); if (b) b.click(); } }
  function close() { if (S.panel) { S.panel.remove(); S.panel = null; d.removeEventListener('keydown', key, true); } }
  function key(e) { if (e.key === 'Escape' && S.panel) { e.stopPropagation(); close(); } }
  function open() {
    if (S.panel) return;
    var p = d.createElement('section'); p.className = 'sa-panel'; p.setAttribute('role', 'dialog'); p.setAttribute('aria-label', 'اسأل المساعد'); p.dir = 'rtl';
    p.innerHTML = '<div class="sa-ph"><button type="button" class="sa-x" data-sa-close aria-label="إغلاق">✕</button><h3>اسأل المساعد<small>بيشرحلك ويفتحلك طلب لو الحاجة محتاجة تعديل</small></h3></div><div class="sa-msgs" data-sa-msgs></div>' +
      '<div class="sa-comp"><div class="sa-opts"><label><input type="checkbox" data-sa-ctx checked> الشاشة اللي أنا فيها تتبعت كسياق</label><label><input type="checkbox" data-sa-red checked> إخفاء أسماء المرضى وتليفوناتهم (رقم الملف بس)</label></div>' +
      '<div class="sa-row"><label class="sa-tool" title="إرفاق صورة شاشة">إرفاق صورة<input type="file" accept="image/*" data-sa-file hidden></label><input data-sa-input maxlength="500" placeholder="اكتب سؤالك أو الصق صورة الشاشة…" aria-label="سؤالك"><button type="button" class="btn sa-pri" data-sa-send>إرسال</button></div>' +
      (isSuper() ? '<button type="button" class="btn sa-owner" data-sa-owner>طلبات الموظفين</button>' : '') + '</div>';
    d.body.appendChild(p); S.panel = p; d.addEventListener('keydown', key, true);
    p.onclick = function (e) {
      var t = e.target.closest('button,label'); if (!t) return;
      if (t.hasAttribute('data-sa-close')) close(); else if (t.hasAttribute('data-sa-send')) send();
      else if (t.hasAttribute('data-sa-open')) openScreen(t.getAttribute('data-sa-open'));
      else if (t.hasAttribute('data-sa-article')) { if (w.SSMPDDashboardHelp) w.SSMPDDashboardHelp.open(t.getAttribute('data-sa-article')); }
      else if (t.hasAttribute('data-sa-newreq')) newReq(t.getAttribute('data-sa-newreq'));
      else if (t.hasAttribute('data-sa-owner')) openOwner();
    };
    p.querySelector('[data-sa-ctx]').onchange = function (e) { S.ctx = e.target.checked; };
    p.querySelector('[data-sa-red]').onchange = function (e) { S.redact = e.target.checked; };
    p.querySelector('[data-sa-input]').onkeydown = function (e) { if (e.key === 'Enter') send(); };
    p.querySelector('[data-sa-file]').onchange = function (e) { var f = e.target.files && e.target.files[0]; if (f) { S.shot = f.name; toast('الصورة هتتحفظ مع الطلب بس', 'info'); } };
    p.querySelector('[data-sa-input]').onpaste = function (e) { var it = (e.clipboardData && e.clipboardData.files) || []; if (it[0]) { S.shot = it[0].name || 'screenshot'; toast('الصورة هتتحفظ مع الطلب بس', 'info'); } };
    draw();
  }
  /* Owner screen */
  function openOwner() {
    var o = d.createElement('div'); o.className = 'sa-owner-pop'; o.setAttribute('role', 'dialog'); o.dir = 'rtl'; S.owner = o;
    o.innerHTML = '<div class="sa-ow"><div class="sa-ph"><button type="button" class="sa-x" data-sa-oback aria-label="رجوع">→</button><h3>طلبات الموظفين<small>للمالك بس</small></h3><button type="button" class="sa-x" data-sa-oclose aria-label="إغلاق">✕</button></div><div class="sa-obody" data-sa-obody>جاري التحميل…</div></div>';
    d.body.appendChild(o);
    function shut() { o.remove(); S.owner = null; }
    o.onclick = function (e) {
      var b = e.target.closest('button'); if (!b) return;
      if (b.hasAttribute('data-sa-oclose') || b.hasAttribute('data-sa-oback')) shut();
      else if (b.hasAttribute('data-sa-dec')) A.decide(b.getAttribute('data-id'), b.getAttribute('data-sa-dec'), null).then(load).catch(function (er) { toast(er.message, 'error'); });
      else if (b.hasAttribute('data-sa-st')) A.status(b.getAttribute('data-id'), b.getAttribute('data-sa-st')).then(load).catch(function (er) { toast(er.message, 'error'); });
    };
    function load() {
      A.all().then(function (rows) {
        rows = rows || []; var n = function (s) { return rows.filter(function (r) { return r.status === s; }).length; };
        o.querySelector('[data-sa-obody]').innerHTML = '<div class="sa-sum"><div class="sa-tile"><small>مستنية قرارك</small><b>' + n('open') + '</b></div><div class="sa-tile"><small>بيتنفذ</small><b>' + (n('in_progress') + n('approved')) + '</b></div><div class="sa-tile"><small>نزلت</small><b>' + n('shipped') + '</b></div></div>' +
          (rows.length ? rows.map(function (r) {
            return '<section class="sa-rq"><div class="sa-rh"><b>طلب ' + esc(r.number || r.id) + '</b>' + statusChip(r.status) + (r.requester ? '<span class="sa-chip sa-gy">' + esc(r.requester) + '</span>' : '') + (r.screen ? '<span class="sa-chip sa-blue">' + esc(r.screen) + '</span>' : '') + '</div><p>' + esc(r.text || '') + '</p>' +
              (r.suggested_fix ? '<div class="sa-sug"><b>اقتراح الحل:</b> ' + esc(r.suggested_fix) + (r.impact ? '<br><small>هيأثّر على: ' + esc(r.impact) + '</small>' : '') + '</div>' : '') +
              (r.status === 'open' || r.status === 'need_info' ? '<div class="sa-row"><button class="btn sa-pri" data-sa-dec="approve" data-id="' + esc(r.id) + '">موافق</button><button class="btn" data-sa-dec="reject" data-id="' + esc(r.id) + '">لأ</button><button class="btn" data-sa-dec="need_info" data-id="' + esc(r.id) + '">محتاج توضيح</button></div>' : '') +
              (r.status === 'approved' ? '<div class="sa-row"><button class="btn" data-sa-st="in_progress" data-id="' + esc(r.id) + '">بدأ التنفيذ</button></div>' : '') +
              (r.status === 'in_progress' ? '<div class="sa-row"><button class="btn sa-pri" data-sa-st="shipped" data-id="' + esc(r.id) + '">نزل</button></div>' : '') + '</section>';
          }).join('') : '<p>مفيش طلبات دلوقتي.</p>');
      }).catch(function (e) { o.querySelector('[data-sa-obody]').textContent = 'مقدرتش أحمّل الطلبات: ' + e.message; });
    }
    load();
  }
  /* «اتعملت» notification: shipped requests the employee hasn't been told about */
  function notifyShipped(rows) {
    var seen = {}; try { seen = JSON.parse(w.localStorage.getItem('sa_seen') || '{}'); } catch (e) {}
    rows.filter(function (r) { return r.status === 'shipped' && !seen[r.id]; }).forEach(function (r) { S.msgs.push({ kind: 'done', req: r }); seen[r.id] = 1; });
    try { w.localStorage.setItem('sa_seen', JSON.stringify(seen)); } catch (e) {}
  }
  function mount() {
    if (S.btn || !admin()) return Promise.resolve(false);
    return A.mine().then(function (rows) {
      S.ok = true; S.reqs = rows || []; notifyShipped(S.reqs);
      var b = d.createElement('button'); b.type = 'button'; b.className = 'sa-fab'; b.setAttribute('data-sa-fab', ''); b.textContent = '✦ اسأل المساعد'; b.onclick = open; d.body.appendChild(b); S.btn = b;
      if (S.msgs.some(function (m) { return m.kind === 'done'; })) b.classList.add('sa-dot');
      return true;
    }).catch(function () { return false; });
  }
  function dispose() { close(); if (S.owner) { S.owner.remove(); S.owner = null; } if (S.btn) { S.btn.remove(); S.btn = null; } S.ok = false; S.msgs = []; S.reqs = []; }
  w.SSMPDStaffAssistant = { mount: mount, open: open, close: close, dispose: dispose, redact: redact, _adapter: A };
  function boot() { var t = 0, iv = setInterval(function () { if (admin()) { clearInterval(iv); mount(); } else if (++t > 60) clearInterval(iv); }, 1000); }
  if (d.readyState === 'loading') d.addEventListener('DOMContentLoaded', boot); else boot();
})(window);
