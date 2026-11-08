// DOM test (end of service / settlement, HR tab): manager-only lazy section, escaping, role-gated buttons (creator cannot approve, certificate locked until the signed file, owner-only exception),
// exact command payloads, printing from the approved template with placeholders filled and text escaped, template versions, missing-migration message.
const fs = require('fs'), assert = require('node:assert/strict'), { JSDOM } = require('jsdom');
const tick = () => new Promise(r => setTimeout(r, 25));
(async () => {
  const dom = new JSDOM('<main></main>', { url: 'https://test.invalid', runScripts: 'outside-only' }), w = dom.window, d = w.document;
  const people = [{ id: 'p1', admin_id: 'hr', full_name: 'موظف أول', code: 'EMP-1', kind: 'employee', status: 'active', revision: 2, leave_balance: 5 }];
  const hrData = { can_manage: true, people, requests: [], attendance: [], documents: [], accounts: [], doctor_keys: [], employee_keys: [] };
  const line = (id, kind, label, amount, resolution, source = 'manual', note = '') => ({ id, case_id: 'c', kind, source, label, amount, resolution, resolution_note: note, created_at: '2026-11-09T10:00:00Z' });
  const mk = (id, status, extra = {}) => Object.assign({ id, person_id: 'p1', full_name: 'موظف <img src=x onerror=window.__xss=1>', code: 'EMP-1', job_title: 'محاسب', start_date: '2025-01-01', last_day: '2026-11-30', reason: 'resignation', reason_note: '', status, revision: 4,
    created_by: 'hr', created_at: '2026-11-09T09:00:00Z', sheet_by: status === 'requested' ? null : 'acc', sheet_at: status === 'requested' ? null : '2026-11-09T10:00:00Z', approved_at: null, signed_url: null, signed_at: null, cert_issued_at: null, cert_override_reason: null,
    insurance_stopped_on: null, paid_on: null, payment_reference: '', net_amount: null, settlement_template_id: 't-set-1', cert_template_id: null, return_note: '',
    net: { to_him: 6000, on_him: 800, net: 5200 },
    lines: [line('l1', 'due_to_him', 'صافي مرتبات', 6000, 'counted', 'payroll'), line('l2', 'due_on_him', 'سلف', 500, 'counted', 'advance'), line('l3', 'custody', 'مفاتيح (CUS-2)', 300, 'deducted', 'custody', 'لم تُسلَّم'), line('l4', 'custody', 'لابتوب (CUS-1)', 9000, 'pending', 'custody'), line('l5', 'document', 'عقد أصلي', 0, 'pending')] }, extra);
  const templates = [{ id: 't-set-1', kind: 'settlement', version: 1, status: 'published', note: 'أولي', body: 'مخالصة {{name}} ({{code}}) آخر يوم {{last_day}} السبب {{reason}}\nالصافي {{net}} <b>x</b>\n{{lines}}' }, { id: 't-set-2', kind: 'settlement', version: 2, status: 'draft', note: 'مراجعة', body: 'نسخة مسودة طويلة بما يكفي' },
    { id: 't-cert-1', kind: 'certificate', version: 1, status: 'published', note: '', body: 'شهادة {{name}} من {{start_date}} إلى {{last_day}} بوظيفة {{job_title}}' }];
  let ws, calls = [], tcalls = [], mode = 'ok', locks = 0, printed = [];
  const fresh = o => Object.assign({ me: 'hr', today: '2026-11-09', can_manage: true, can_prepare: false, can_review: false, is_owner: false, cases: [mk('c1', 'requested'), mk('c2', 'sheet_ready'), mk('c3', 'approved', { net_amount: 5200, approved_at: '2026-11-09T11:00:00Z' }), mk('c4', 'completed', { signed_url: 'https://f.example/s.pdf', cert_issued_at: '2026-11-10T00:00:00Z', paid_on: '2026-11-10', net_amount: 5200 })], templates, people: [{ id: 'p2', code: 'EMP-2', full_name: 'موظف ثان' }] }, o || {});
  ws = fresh();
  w.SSMPDAuth = { currentAdmin: { id: 'hr', role: 'super_admin', has_hr_access: true } }; w.SSMPDToast = { show: () => {} };
  w.open = () => { const doc = { _h: '', write(h) { this._h += h; }, close() {} }; const win = { document: doc, focus() {}, print() {} }; printed.push(doc); return win; };
  w.eval(fs.readFileSync('assets/js/roles.js', 'utf8'));
  w.SSMPDDb = { client: { rpc: async (fn, args) => {
    if (fn === 'hr_workspace') return { data: hrData };
    if (fn === 'hr_offboarding_workspace') { if (mode === 'missing') return { error: { message: 'Could not find the function public.hr_offboarding_workspace in the schema cache' } }; return { data: ws }; }
    if (fn === 'hr_offboarding_lock_due') { locks++; return { data: 0 }; }
    if (fn === 'hr_offboarding_command') { calls.push(args); if (mode === 'reject') return { error: { message: 'الكشف تغير؛ أعد تحميله قبل الاعتماد' } }; return { data: 'c1' }; }
    if (fn === 'hr_offboarding_template') { tcalls.push(args); return { data: 'x' }; }
    return { data: { rules: [], adjustments: [], devices: [], imports: [], services: [] } }; } } };
  for (const f of ['workforce-prices', 'hr-offboarding', 'hr-navigation']) w.eval(fs.readFileSync('assets/js/' + f + '.js', 'utf8'));
  const host = d.querySelector('main'), root = () => d.querySelector('[data-hr-offboarding]'), detail = () => root().querySelector('[data-offb-detail]'), btns = () => [...detail().querySelectorAll('[data-offb]')].map(b => b.dataset.offb);
  const open = async id => { [...root().querySelectorAll('tbody tr')].find(tr => tr.textContent.includes(id)); root().querySelectorAll('[data-offb=open]')[['c1', 'c2', 'c3', 'c4'].indexOf(id)].click(); await tick(); };
  const submit = async () => { d.querySelector('.wp-modal form').dispatchEvent(new w.Event('submit', { cancelable: true })); await tick(); await tick(); };
  w.SSMPDHumanResources.render(host); await tick();
  const tab = d.querySelector('[data-hr-open=offboarding]'); assert(tab && tab.textContent === 'إنهاء الخدمة'); assert.equal(locks, 0, 'lazy: nothing loaded before the section opens');
  tab.click(); await tick();
  assert.equal(root().querySelectorAll('tbody tr').length, 4); assert.equal(w.__xss, undefined); assert(!root().querySelector('img'));
  assert.deepEqual([...root().querySelectorAll('[data-offb-cards] .wp-card b')].map(x => x.textContent), ['3', '1', '1', '1']);
  assert.equal(locks, 1, 'lock-due runs once on load for manager'); for (const s of ['قيد إعداد الكشف', 'بانتظار الاعتماد', 'معتمدة — بانتظار الملف الموقع', 'مغلقة', 'استقالة']) assert(root().textContent.includes(s), s);

  // ---- manager: new case payload
  root().querySelector('[data-offb=new]').click(); let f = d.querySelector('.wp-modal form'); f.elements.person_id.value = 'p2'; f.elements.last_day.value = '2026-12-01'; f.elements.reason.value = 'termination'; f.elements.reason_note.value = 'ملاحظة';
  await submit(); assert.deepEqual([calls[0].p_action, calls[0].p_payload.person_id, calls[0].p_payload.last_day, calls[0].p_payload.reason], ['open', 'p2', '2026-12-01', 'termination']); assert(/^[0-9a-f-]{36}$/.test(calls[0].p_payload.request_id));

  // ---- requested: HR sees no sheet buttons (accountant only)
  await open('c1'); assert.deepEqual(btns().filter(x => x !== 'lastday' && x !== 'cancel'), [], 'HR has no financial buttons'); assert(btns().includes('lastday') && btns().includes('cancel'));
  assert(detail().textContent.includes('لابتوب') && detail().querySelector('[data-offb-netvalue]').textContent === '5,200.00');
  // ---- accountant view of a requested case
  ws = fresh({ can_manage: false, can_prepare: true, me: 'acc' }); w.SSMPDHumanResources.render(host); await tick(); d.querySelector('[data-hr-open=offboarding]') && 0;
  // the accountant uses the accounting tab host (same component): mount directly
  const shell = d.createElement('div'); d.body.append(shell); w.SSMPDHROffboarding.mount(shell, true); await tick();
  const aroot = shell.querySelector('[data-hr-offboarding]'), abt = () => [...aroot.querySelectorAll('[data-offb-detail] [data-offb]')].map(b => b.dataset.offb);
  assert(!aroot.querySelector('[data-offb=new]') && !aroot.querySelector('[data-offb=templates]'), 'accountant cannot open cases or edit templates');
  aroot.querySelectorAll('[data-offb=open]')[0].click(); await tick();
  assert.deepEqual(abt().filter(x => ['defaults', 'addline', 'submit', 'resolve', 'remove'].includes(x)).sort(), ['addline', 'defaults', 'remove', 'resolve', 'resolve', 'resolve', 'submit'], 'prepare buttons');
  calls.length = 0;
  aroot.querySelector('[data-offb=defaults]').click(); await tick(); assert.deepEqual([calls[0].p_action, calls[0].p_payload.id], ['load_defaults', 'c1']);
  aroot.querySelector('[data-offb=submit]').click(); await tick(); assert.equal(calls[1].p_action, 'submit_sheet');
  aroot.querySelector('[data-offb=addline]').click(); f = d.querySelector('.wp-modal form'); f.elements.kind.value = 'due_on_him'; f.elements.label.value = 'غرامة'; f.elements.amount.value = '50'; await submit();
  assert.deepEqual([calls[2].p_action, calls[2].p_payload.kind, calls[2].p_payload.label, calls[2].p_payload.amount], ['add_line', 'due_on_him', 'غرامة', '50']);
  [...aroot.querySelectorAll('[data-offb=resolve]')].find(b => b.dataset.id === 'l4').click(); f = d.querySelector('.wp-modal form'); f.elements.resolution.value = 'waived'; f.elements.note.value = 'تنازل مدير'; await submit();
  assert.deepEqual([calls[3].p_action, calls[3].p_payload.line_id, calls[3].p_payload.resolution, calls[3].p_payload.note], ['resolve_line', 'l4', 'waived', 'تنازل مدير']);
  assert(!aroot.querySelector('[data-offb=approve]'), 'accountant cannot approve');
  // approved case for the accountant: record payment
  aroot.querySelectorAll('[data-offb=open]')[2].click(); await tick(); assert(abt().includes('pay') && !abt().includes('upload') && !abt().includes('cert'));
  aroot.querySelector('[data-offb=pay]').click(); f = d.querySelector('.wp-modal form'); f.elements.reference.value = 'BANK-77'; await submit();
  assert.deepEqual([calls[4].p_action, calls[4].p_payload.id, calls[4].p_payload.reference], ['record_payment', 'c3', 'BANK-77']); shell.remove();

  // ---- financial manager: approval, creator/preparer cannot approve
  ws = fresh({ can_manage: false, can_review: true, me: 'fm' }); const s2 = d.createElement('div'); d.body.append(s2); w.SSMPDHROffboarding.mount(s2, true); await tick();
  let r2 = s2.querySelector('[data-hr-offboarding]'); r2.querySelectorAll('[data-offb=open]')[1].click(); await tick();
  let ap = r2.querySelector('[data-offb=approve]'); assert(ap && !ap.disabled); calls.length = 0; ap.click(); await tick();
  assert.deepEqual([calls[0].p_action, calls[0].p_payload.id, calls[0].p_payload.revision], ['approve', 'c2', 4]);
  r2.querySelector('[data-offb=return]').click(); f = d.querySelector('.wp-modal form'); f.elements.note.value = 'راجع العهد'; await submit(); assert.deepEqual([calls[1].p_action, calls[1].p_payload.note], ['return_sheet', 'راجع العهد']); s2.remove();
  ws = fresh({ can_manage: false, can_review: true, me: 'acc' }); const s3 = d.createElement('div'); d.body.append(s3); w.SSMPDHROffboarding.mount(s3, true); await tick();
  s3.querySelectorAll('[data-offb=open]')[1].click(); await tick(); assert(s3.querySelector('[data-offb=approve]').disabled, 'the person who prepared the sheet gets a disabled approve button'); s3.remove();

  // ---- HR on an approved case: certificate locked until the signed file, owner-only exception
  ws = fresh(); w.SSMPDHumanResources.render(host); await tick(); d.querySelector('[data-hr-open=offboarding]').click(); await tick();
  await open('c3'); assert(detail().querySelector('[data-offb-locked]'), 'locked message'); assert(!btns().includes('cert') && !btns().includes('override'), 'no certificate button, HR has no exception');
  assert(btns().includes('upload') && btns().includes('print') && btns().includes('insurance') && btns().includes('complete'));
  calls.length = 0;
  detail().querySelector('[data-offb=upload]').click(); f = d.querySelector('.wp-modal form'); f.elements.url.value = 'https://files.example/signed.pdf'; await submit(); assert.deepEqual([calls[0].p_action, calls[0].p_payload.url], ['upload_signed', 'https://files.example/signed.pdf']);
  detail().querySelector('[data-offb=insurance]').click(); f = d.querySelector('.wp-modal form'); f.elements.stopped_on.value = '2026-11-30'; f.elements.reference.value = 'إخطار 5'; f.elements.deadline.value = '2026-12-15'; await submit();
  assert.deepEqual([calls[1].p_action, calls[1].p_payload.stopped_on, calls[1].p_payload.reference, calls[1].p_payload.deadline], ['stop_insurance', '2026-11-30', 'إخطار 5', '2026-12-15']);
  detail().querySelector('[data-offb=complete]').click(); await submit(); assert.equal(calls[2].p_action, 'complete');
  // print: template body filled, text escaped, lines table present
  detail().querySelector('[data-offb=print]').click(); await tick(); const html = printed.at(-1)._h;
  for (const s of ['مخالصة', 'EMP-1', '2026-11-30', 'استقالة', '5,200.00', '&lt;b&gt;x&lt;/b&gt;', '<table', 'مفاتيح (CUS-2)']) assert(html.includes(s), 'printed ' + s); assert(!html.includes('<img') && !html.includes('{{'));
  // owner exception
  ws = fresh({ is_owner: true }); w.SSMPDHumanResources.render(host); await tick(); d.querySelector('[data-hr-open=offboarding]').click(); await tick(); await open('c3');
  assert(btns().includes('override')); calls.length = 0; detail().querySelector('[data-offb=override]').click(); f = d.querySelector('.wp-modal form'); f.elements.reason.value = 'قرار المالك'; await submit();
  assert.deepEqual([calls[0].p_action, calls[0].p_payload.override_reason], ['issue_certificate', 'قرار المالك']); assert(printed.at(-1)._h.includes('شهادة') && printed.at(-1)._h.includes('2025-01-01'), 'certificate printed after issue');
  // signed case: normal certificate button, no override
  ws = fresh({ cases: [mk('c3', 'signed', { signed_url: 'https://f.example/s.pdf', signed_at: '2026-11-10T00:00:00Z', net_amount: 5200 })] }); w.SSMPDHumanResources.render(host); await tick(); d.querySelector('[data-hr-open=offboarding]').click(); await tick();
  root().querySelector('[data-offb=open]').click(); await tick(); assert(btns().includes('cert') && !btns().includes('override') && !detail().querySelector('[data-offb-locked]')); assert(detail().querySelector('a[href="https://f.example/s.pdf"]'));
  calls.length = 0; detail().querySelector('[data-offb=cert]').click(); await tick(); await tick(); assert.deepEqual([calls[0].p_action, calls[0].p_payload.override_reason], ['issue_certificate', '']);

  // ---- templates: new version + publish
  ws = fresh(); w.SSMPDHumanResources.render(host); await tick(); d.querySelector('[data-hr-open=offboarding]').click(); await tick();
  root().querySelector('[data-offb=templates]').click(); await tick(); const tm = d.querySelector('[data-offb-templates]'); assert(tm.textContent.includes('v2') && tm.textContent.includes('مسودة'));
  [...tm.querySelectorAll('[data-offb=tpl-publish]')].forEach(b => b.click()); await tick(); assert.deepEqual([tcalls[0].p_action, tcalls[0].p_payload.id], ['publish', 't-set-2']);
  tm.querySelector('[data-offb=tpl-edit]').click(); f = [...d.querySelectorAll('.wp-modal form')].at(-1); f.elements.body.value = 'نص جديد من المحامي {{name}} {{net}}'; f.elements.note.value = 'نسخة المحامي';
  f.dispatchEvent(new w.Event('submit', { cancelable: true })); await tick(); await tick(); assert.deepEqual([tcalls[1].p_action, tcalls[1].p_payload.kind, tcalls[1].p_payload.note], ['save', 'settlement', 'نسخة المحامي']);

  // ---- stale revision error shows in the dialog; missing migration message; non-manager has no tab
  mode = 'reject'; ws = fresh({ can_manage: false, can_review: true, me: 'fm' }); const s4 = d.createElement('div'); d.body.append(s4); w.SSMPDHROffboarding.mount(s4, true); await tick(); s4.querySelectorAll('[data-offb=open]')[1].click(); await tick();
  s4.querySelector('[data-offb=approve]').click(); await tick(); await tick(); assert(s4.textContent.includes('الكشف تغير')); mode = 'ok'; s4.remove();
  mode = 'missing'; ws = fresh(); w.SSMPDHumanResources.render(host); await tick(); d.querySelector('[data-hr-open=offboarding]').click(); await tick(); assert(root().textContent.includes('غير مفعّل بعد')); mode = 'ok';
  hrData.can_manage = false; w.SSMPDAuth.currentAdmin = { id: 'a2', role: 'reception' }; w.SSMPDHumanResources.render(host); await tick(); assert(!d.querySelector('[data-hr-open=offboarding]'));
  dom.window.close();
  console.log('PASS hr offboarding DOM: lazy manager-only tab, escaping, role-gated buttons, creator/preparer cannot approve, certificate locked until the signed file, owner-only exception, exact payloads, printing from the template, template versions, errors.');
})().catch(e => { console.error(e); process.exit(1); });
