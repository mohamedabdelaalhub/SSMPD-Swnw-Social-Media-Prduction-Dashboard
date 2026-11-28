/* SSMPD — «تنبيه الخدمة المكررة» (owner 2026-11-28: «لما … بيضيف خدمة هي موجودة بالفعل، نفس الخدمة، ينبهوا … فيختار هو عايزها فعلا
   أو لأ تراجع»; mig 20261128180000). The server refuses adding / booking the SAME service (same code) that is already on the visit,
   on the patient's visits today or booked for the patient today (hint 'duplicate_service'). This file wraps the shared Supabase
   client once, so EVERY screen that adds a service (+ إضافة خدمة، تغيير الخدمة، الحجز، الحجز الفوري، طلب خدمة من تشغيل اليوم) shows the
   same window with the server's message and two buttons:
     «أيوه، ضيفها تاني» (or «أيوه، احجزها تاني») → resends with payload.confirm_duplicate = true
                                                    (journey request → clinic_reception_journey_request_service_again)
     «لا، تراجع» / ✕ / Esc                         → nothing is saved; the caller gets the error «تراجعت — الخدمة ما اتضافتش تاني».
   «أثناء التسجيل» (owner 2026-11-28: «يطلع له تنبيه … قبل ما يضيف اصلا عشان نقضي على التكرار من بابه»): the moment a service is
   chosen in a form (select[name=service_id] with visit_id / appointment_id / patient_id+day in the same form) the read-only
   clinic_reception_duplicate_service_check is asked and the SAME window opens right away:
     «لا، تراجع» / ✕ / Esc → the chosen service is cleared (nothing typed elsewhere is lost);
     «أيوه، …»            → the choice stays, and the save that follows goes out confirmed (no second window).
   The window after «حفظ» stays as the safety net (other screens, Masa, the agent).
   SSMPDDupService.ask(message, booking) / precheck(select) are exposed for tests. */
(function (w) {
  'use strict';
  var d = w.document, ACTIONS = ['order_add', 'book', 'walk_in'], JOURNEY = 'clinic_reception_journey_request_service';
  var BACK = 'تراجعت — الخدمة ما اتضافتش تاني.', lastWorkspace = null, confirmed = [];
  function okFor(service) { var now = Date.now(); confirmed = confirmed.filter(function (x) { return now - x.at < 15 * 60000; }); return confirmed.some(function (x) { return x.service === service; }); }
  function take(service) { var i = -1; confirmed.forEach(function (x, n) { if (x.service === service) i = n; }); if (i >= 0) confirmed.splice(i, 1); }
  function esc(v) { return String(v == null ? '' : v).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function css() {
    if (d.getElementById('dup-service-css')) return;
    var s = d.createElement('style'); s.id = 'dup-service-css';
    s.textContent = '.dupsv-back{position:fixed;inset:0;background:rgba(22,33,46,.45);display:flex;align-items:center;justify-content:center;z-index:100000;padding:16px}' +
      '.dupsv{background:#fff;border-radius:16px;max-width:460px;width:100%;box-shadow:0 20px 50px rgba(15,54,157,.25);overflow:hidden;font-family:inherit}' +
      '.dupsv-head{background:#0F369D;color:#fff;display:flex;justify-content:space-between;align-items:center;gap:8px;padding:12px 16px;font-weight:700}' +
      '.dupsv-x{background:rgba(255,255,255,.18);border:0;color:#fff;border-radius:8px;width:32px;height:32px;font-size:16px;cursor:pointer}' +
      '.dupsv-body{padding:16px;display:grid;gap:14px}' +
      '.dupsv-msg{margin:0;border:2px solid #F15A22;background:#FFF4EE;border-radius:12px;padding:12px;line-height:1.9;font-size:14px;color:#16212E}' +
      '.dupsv-btns{display:flex;gap:8px;flex-wrap:wrap}.dupsv-btns .btn{flex:1;min-width:150px}';
    d.head.appendChild(s);
  }
  function ask(message, booking) {
    css();
    return new Promise(function (done) {
      var back = d.createElement('div'); back.className = 'dupsv-back'; back.setAttribute('data-dup-service', '');
      back.innerHTML = '<div class="dupsv" role="alertdialog" aria-modal="true" aria-labelledby="dupsv-title">' +
        '<div class="dupsv-head"><span id="dupsv-title">⚠ الخدمة دي موجودة بالفعل</span><button type="button" class="dupsv-x" data-dup-x aria-label="قفل">✕</button></div>' +
        '<div class="dupsv-body"><p class="dupsv-msg" data-dup-msg>' + esc(message) + '</p>' +
        '<div class="dupsv-btns"><button type="button" class="btn btn-primary" data-dup-yes>' + (booking ? 'أيوه، احجزها تاني' : 'أيوه، ضيفها تاني') + '</button>' +
        '<button type="button" class="btn" data-dup-no>لا، تراجع</button></div></div></div>';
      d.body.appendChild(back);
      function finish(v) { d.removeEventListener('keydown', key, true); back.remove(); done(v); }
      function key(e) { if (e.key === 'Escape') { e.stopPropagation(); finish(false); } }
      d.addEventListener('keydown', key, true);
      back.querySelector('[data-dup-yes]').onclick = function () { finish(true); };
      back.querySelector('[data-dup-no]').onclick = function () { finish(false); };
      back.querySelector('[data-dup-x]').onclick = function () { finish(false); };
      back.addEventListener('click', function (e) { if (e.target === back) finish(false); });
      var no = back.querySelector('[data-dup-no]'); if (no && no.focus) no.focus();
    });
  }
  function isDup(r) { return !!(r && r.error && r.error.hint === 'duplicate_service'); }
  function wrap() {
    var c = w.SSMPDDb && w.SSMPDDb.client; if (!c || typeof c.rpc !== 'function') return false; if (c.__dupServiceWrapped) return true;
    var orig = c.rpc; c.__dupServiceWrapped = true;
    c.__dupOrig = orig;
    c.rpc = function (name, args) {
      if (args && args.p_workspace && /^clinic_reception_/.test(String(name))) lastWorkspace = args.p_workspace;
      // a service already confirmed in the form («أيوه» at the moment it was chosen) goes out confirmed — no second window
      if (name === 'clinic_reception_command' && args && ACTIONS.indexOf(args.p_action) >= 0 && args.p_payload && typeof args.p_payload === 'object'
          && !args.p_payload.confirm_duplicate && okFor(String(args.p_payload.service_id || ''))) {
        take(String(args.p_payload.service_id));
        return orig.call(c, name, Object.assign({}, args, { p_payload: Object.assign({}, args.p_payload, { confirm_duplicate: true }) }));
      }
      if (name === JOURNEY && args && okFor(String(args.p_service || ''))) { take(String(args.p_service)); return orig.call(c, 'clinic_reception_journey_request_service_again', args); }
      var res = orig.apply(c, arguments);
      var watched = (name === 'clinic_reception_command' && args && ACTIONS.indexOf(args.p_action) >= 0 && args.p_payload && typeof args.p_payload === 'object' && !args.p_payload.confirm_duplicate) || name === JOURNEY;
      if (!watched) return res;
      return Promise.resolve(res).then(function (r) {
        if (!isDup(r)) return r;
        var booking = name === 'clinic_reception_command' && args.p_action !== 'order_add';
        return ask(r.error.message, booking).then(function (yes) {
          if (!yes) return { data: null, error: { message: BACK, hint: 'duplicate_service_back', code: 'P0001', details: r.error.details }, status: 400 };
          if (name === JOURNEY) return orig.call(c, 'clinic_reception_journey_request_service_again', args);
          return orig.call(c, name, Object.assign({}, args, { p_payload: Object.assign({}, args.p_payload, { confirm_duplicate: true }) }));
        });
      });
    };
    return true;
  }
  // ---- «أثناء التسجيل»: ask the moment the service is chosen ----
  function field(form, n) { var el = form.querySelector('[name="' + n + '"]'); return el ? String(el.value || '') : ''; }
  function precheck(sel) {
    var form = sel && (sel.closest('form') || sel.closest('.modal') || sel.closest('[role="dialog"]')), service = sel && String(sel.value || '');
    var c = w.SSMPDDb && w.SSMPDDb.client;
    if (!form || !service || !c || !lastWorkspace) return Promise.resolve(null);
    var title = (form.closest('.modal') || form).querySelector('h3,[id$="-title"]');
    if (title && /تعديل الحجز/.test(title.textContent || '')) return Promise.resolve(null);   // editing a booking is a reschedule, not a new one
    var p = { service_id: service }, visit = field(form, 'visit_id'), appt = field(form, 'appointment_id'), patient = field(form, 'patient_id');
    if (visit) p.visit_id = visit; else if (appt) p.appointment_id = appt; else if (patient) { p.patient_id = patient; var day = field(form, 'day'), st = field(form, 'starts_at'); if (day) p.day = day; else if (/^\d{4}-\d{2}-\d{2}T/.test(st)) p.starts_at = st; }
    else return Promise.resolve(null);
    if (okFor(service)) return Promise.resolve(null);
    var call = c.__dupOrig ? c.__dupOrig.call(c, 'clinic_reception_duplicate_service_check', { p_workspace: lastWorkspace, p_payload: p }) : c.rpc('clinic_reception_duplicate_service_check', { p_workspace: lastWorkspace, p_payload: p });
    return Promise.resolve(call).then(function (r) {
      var x = r && r.data; if (!x || !x.duplicate || String(sel.value || '') !== service) return null;
      return ask(x.message, !!x.booking).then(function (yes) {
        if (yes) { confirmed.push({ service: service, at: Date.now() }); return true; }
        sel.value = ''; sel.dispatchEvent(new w.Event('change', { bubbles: true })); return false;
      });
    }, function () { return null; });
  }
  d.addEventListener('change', function (e) {
    var t = e.target; if (!t || !t.matches) return;
    if (t.matches('select[name="service_id"]')) { precheck(t); return; }
    if (t.matches('[name="patient_id"],[name="day"]')) { var f = t.closest('form') || t.closest('.modal'); var s = f && f.querySelector('select[name="service_id"]'); if (s && s.value) precheck(s); }
  }, true);
  function start() { if (!wrap()) w.setTimeout(start, 400); }
  w.SSMPDDupService = { ask: ask, wrap: wrap, precheck: precheck, BACK: BACK, setWorkspace: function (x) { lastWorkspace = x; } };
  if (d.readyState === 'loading') d.addEventListener('DOMContentLoaded', start); else start();
})(window);
