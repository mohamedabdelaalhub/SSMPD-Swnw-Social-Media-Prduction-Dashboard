// «مساعد إنستنكت» DOM: every button clicked as the real role it is shown to, with the RPC it calls; buttons the server would refuse
// are not shown. The fake server below applies the same role rules as supabase/migrations/20261124200000_instinct_assistant.sql.
const fs = require('fs'), assert = require('node:assert/strict'), { JSDOM, VirtualConsole } = require('jsdom');
const read = f => fs.readFileSync('assets/js/' + f, 'utf8'), tick = () => new Promise(r => setTimeout(r, 15));
const PEOPLE = {
  owner: { id: 'own', name: 'المالك', role: 'super_admin', roles: ['super_admin'] },
  gm: { id: 'gm', name: 'مدير', role: 'general_manager', roles: ['general_manager'] },
  mazen: { id: 'maz', name: 'مازن', role: 'reception', roles: ['reception'] },
  acc: { id: 'acc', name: 'محاسب', role: 'accountant', roles: ['accountant'] },
  designer: { id: 'des', name: 'مصمم', role: 'designer', roles: ['designer'] },
  nurse: { id: 'nur', name: 'ممرضة', role: 'nursing', roles: ['nursing'] },
  ai: { id: 'ai', name: 'إنستنكت', role: 'ai_assistant', roles: ['ai_assistant'] }
};
const GROUP = { reception: 'reception', customer_service: 'customer_service', page_manager: 'content', designer: 'content', approver: 'content',
  accountant: 'finance', financial_manager: 'finance', general_manager: 'management', super_admin: 'management' };
function server() {
  const S = { notes: [], threads: [], messages: [], notifs: [], calls: [], seq: 0, me: null, aiActive: true };
  const id = () => 'id' + (++S.seq), now = () => new Date(Date.UTC(2026, 10, 24, 10, S.seq)).toISOString();
  const err = m => ({ data: null, error: { message: m } });
  const ctx = () => {
    const a = S.me; if (a.role === 'ai_assistant') return { id: a.id, kind: 'instinct', owner: false, groups: [] };
    const g = [...new Set(a.roles.map(r => GROUP[r]).filter(Boolean))], owner = a.id === 'own';
    if (!owner && !g.length) return null; return { id: a.id, kind: owner ? 'owner' : 'staff', owner, groups: g };
  };
  const patient = t => /01[0125][0-9]{8}/.test(String(t).replace(/[٠-٩]/g, d => d.charCodeAt(0) - 0x660).replace(/([0-9])[\s-]+(?=[0-9])/g, '$1')) ? 'ممنوع كتابة رقم موبايل في مساعد إنستنكت (ممكن يكون رقم مريض). امسح الرقم واكتب سؤالك من غير بيانات مريض.' : null;
  const notify = (to, kind, type, eid, message) => S.notifs.push({ id: id(), recipient: to, kind, entity_type: type, entity_id: eid, message, created_at: now(), read: false });
  S.rpc = (name, a) => {
    S.calls.push({ who: S.me.id, name, args: a || {} });
    const c = ctx(); if (!c) return err('مساعد إنستنكت مش متاح لحسابك');
    if (c.kind === 'instinct' && !S.aiActive) return err('سجّل الدخول');
    const all = c.kind !== 'staff';
    switch (name) {
      case 'instinct_context': return { data: Object.assign({}, c, { can_ask: c.kind !== 'instinct', can_reply: c.kind === 'instinct', can_draft: c.kind === 'instinct',
        can_decide: c.owner, can_hide: c.owner, sees_all_threads: all, ai_accounts: c.owner ? [{ id: 'ai', name: 'إنستنكت', active: S.aiActive }] : [], unread: S.notifs.filter(n => n.recipient === c.id && !n.read).length }) };
      case 'instinct_notes_list': return { data: S.notes.filter(n => c.owner || (c.kind === 'instinct' ? (n.status === 'published' || n.created_by === c.id) : (n.status === 'published' && (n.target_role === 'all' || c.groups.includes(n.target_role))))) };
      case 'instinct_note_save': {
        const why = patient(a.p_title + a.p_body); if (why) return err(why);
        if (!a.p_id) { if (c.kind !== 'instinct') return err('كتابة مسودات الملاحظات لمساعد إنستنكت بس');
          const n = { id: id(), title: a.p_title, body: a.p_body, target_role: a.p_target, status: 'draft', created_by: c.id, created_at: now(), updated_at: now() };
          S.notes.push(n); notify('own', 'new_draft', 'note', n.id, 'مسودة ملاحظة جديدة من مساعد إنستنكت: ' + n.title); return { data: n }; }
        const n = S.notes.find(x => x.id === a.p_id); if (n.status !== 'draft') return err('الملاحظة دي اتعتمدت — مينفعش تتعدل');
        if (!c.owner) return err('تعديل المسودة للمالك بس');
        Object.assign(n, { title: a.p_title, body: a.p_body, target_role: a.p_target, updated_at: now() }); return { data: n };
      }
      case 'instinct_note_decide': {
        if (!c.owner) return err('الاعتماد والنشر للمالك بس');
        const n = S.notes.find(x => x.id === a.p_id);
        if (a.p_action === 'approve') { if (n.status !== 'draft') return err('الملاحظة دي مش مسودة'); n.status = 'approved'; }
        else { if (n.status === 'published') return err('الملاحظة منشورة بالفعل'); n.status = 'published'; n.published_at = now(); }
        return { data: n };
      }
      case 'instinct_ask': {
        if (c.kind === 'instinct') return err('مساعد إنستنكت بيرد على الأسئلة، مش بيسأل');
        const why = patient(a.p_body); if (why) return err(why);
        let t = a.p_thread ? S.threads.find(x => x.id === a.p_thread) : null;
        if (a.p_thread && (!t || t.staff_id !== c.id)) return err('المحادثة دي مش بتاعتك');
        if (!t) { t = { id: id(), staff_id: c.id, staff_name: S.me.name, created_at: now() }; S.threads.push(t); }
        t.last_message_at = now(); t.answered = false; S.messages.push({ id: id(), thread: t.id, author_kind: 'staff', body: a.p_body, created_at: now() });
        if (c.id !== 'own') notify('own', 'new_question', 'thread', t.id, 'سؤال جديد لمساعد إنستنكت من ' + S.me.name); notify('ai', 'new_question', 'thread', t.id, 'سؤال جديد من ' + S.me.name);
        return { data: { thread_id: t.id } };
      }
      case 'instinct_reply': {
        if (c.kind !== 'instinct') return err('الرد على الأسئلة لمساعد إنستنكت بس');
        const why = patient(a.p_body); if (why) return err(why);
        const t = S.threads.find(x => x.id === a.p_thread); t.answered = true; t.last_message_at = now();
        S.messages.push({ id: id(), thread: t.id, author_kind: 'instinct', body: a.p_body, created_at: now() }); notify(t.staff_id, 'reply', 'thread', t.id, 'مساعد إنستنكت رد على سؤالك');
        return { data: { thread_id: t.id } };
      }
      case 'instinct_threads_list': return { data: S.threads.filter(t => all || t.staff_id === c.id).map(t => Object.assign({}, t, { first_question: (S.messages.find(m => m.thread === t.id) || {}).body })) };
      case 'instinct_thread': { const t = S.threads.find(x => x.id === a.p_thread); if (!t || !(all || t.staff_id === c.id)) return err('المحادثة دي مش بتاعتك');
        return { data: { id: t.id, staff_name: t.staff_name, messages: S.messages.filter(m => m.thread === t.id && (all || !m.hidden)) } }; }
      case 'instinct_message_hide': { if (!c.owner) return err('إخفاء الردود للمالك بس'); const m = S.messages.find(x => x.id === a.p_message); m.hidden = !!a.p_hidden; return { data: { id: m.id, hidden: m.hidden } }; }
      case 'instinct_set_ai_active': if (!c.owner) return err('إيقاف حساب إنستنكت للمالك بس'); S.aiActive = !!a.p_active; return { data: { id: a.p_admin, active: S.aiActive } };
      case 'instinct_notifications_list': return { data: S.notifs.filter(n => n.recipient === c.id) };
      case 'instinct_notifications_read': { let k = 0; S.notifs.forEach(n => { if (n.recipient === c.id && !n.read) { n.read = true; k++; } }); return { data: k }; }
      case 'instinct_staff_profiles': if (!all) return err('الوصف ده للمالك ومساعد إنستنكت بس'); return { data: [{ admin_id: 'maz', description: 'مازن — الدور: استقبال' }] };
      case 'instinct_audit_list': if (!c.owner) return err('سجل التدقيق للمالك بس'); return { data: [{ at: now(), actor_name: 'المالك', action: 'note_publish', detail: { title: 'الحجز' } }] };
    }
    return err('unknown rpc ' + name);
  };
  return S;
}
(async () => {
  // roles: who sees the tab
  const vc0 = new VirtualConsole(), d0 = new JSDOM('', { runScripts: 'outside-only', virtualConsole: vc0 }).window; d0.eval(read('roles.js')); const R = d0.SSMPDRoles;
  for (const k of ['owner', 'gm', 'mazen', 'acc', 'designer', 'ai']) assert.equal(R.canSeeTab(PEOPLE[k], 'instinct'), true, k + ' sees the tab');
  for (const r of ['customer_service', 'page_manager', 'approver', 'financial_manager']) assert.equal(R.canSeeTab({ id: 'x', role: r }, 'instinct'), true, r);
  for (const r of ['nursing', 'head_nursing', 'sono_doctor', 'doctor_assistant', 'contract_manager', 'psychology_specialist']) assert.equal(R.canSeeTab({ id: 'x', role: r }, 'instinct'), false, r);
  for (const t of ['home', 'human_resources', 'training_evaluation', 'reports', 'accounting', 'booking_cash', 'patients', 'leads', 'reception_services', 'tasks', 'admin', 'summary'])
    assert.equal(R.canSeeTab(PEOPLE.ai, t), false, 'ai_assistant must not see ' + t);
  assert.equal(R.defaultTab(PEOPLE.ai), 'instinct'); assert.equal(R.label('ai_assistant'), 'مساعد إنستنكت (ذكاء اصطناعي)');
  const app = read('app.js'); assert.match(app, /instinct: window\.SSMPDInstinct/); assert.match(app, /data-goto="instinct">مساعد إنستنكت</);
  assert.match(fs.readFileSync('index.html', 'utf8'), /instinct-assistant\.js\?v=[^"]+"><\/script>\n<script src="assets\/js\/app\.js/, 'loaded before app.js');

  const errors = [], vc = new VirtualConsole(); vc.on('jsdomError', e => errors.push(e.message));
  const dom = new JSDOM('<div id="user-dropdown"><button class="ud-item" data-goto="instinct">مساعد إنستنكت</button></div><div id="view"></div>', { url: 'https://test.invalid', runScripts: 'outside-only', virtualConsole: vc });
  const w = dom.window, d = w.document, S = server(), toasts = [];
  w.SSMPDAuth = { currentAdmin: PEOPLE.mazen }; w.SSMPDToast = { show: m => toasts.push(m) };
  w.SSMPDDb = { client: { rpc: (n, a) => Promise.resolve(S.rpc(n, a)) } };
  w.eval(read('roles.js')); w.eval(read('instinct-assistant.js'));
  const I = w.SSMPDInstinct, view = d.getElementById('view');
  const as = async who => { S.me = PEOPLE[who]; w.SSMPDAuth.currentAdmin = PEOPLE[who]; await I.render(view); await tick(); };
  const $ = s => view.querySelector(s), $$ = s => Array.from(view.querySelectorAll(s)), txt = s => $$(s).map(b => b.textContent.trim());
  const click = async el => { assert.ok(el, 'button exists'); el.click(); await tick(); await tick(); };
  const calls = n => S.calls.filter(c => c.name === n);
  const buttons = () => txt('[data-ins-root] button').filter(t => t !== 'سؤال');

  // 1. Instinct (ai_assistant): new draft, no ask/approve/publish
  await as('ai');
  assert.deepEqual(buttons(), ['ملاحظة جديدة', 'تحديث']);
  await click($('[data-ins-new-note]'));
  $('[data-ins-title]').value = 'الحجز السريع'; $('[data-ins-body]').value = 'كلم ٠١٠١٢٣٤٥٦٧٨'; $('[data-ins-target]').value = 'reception';
  await click($('[data-ins-save]')); assert.match($('[data-ins-error]').textContent, /رقم موبايل/); assert.equal(calls('instinct_note_save').length, 0, 'client check stops it before the server');
  $('[data-ins-body]').value = 'افتح الاستقبال والخدمات ثم حجز جديد';
  await click($('[data-ins-save]')); assert.equal(calls('instinct_note_save').length, 1); assert.equal(calls('instinct_note_save')[0].who, 'ai');
  assert.deepEqual(txt('.ins-chip'), ['مسودة']); assert.deepEqual(txt('.ins-note button'), [], 'Instinct never edits, approves or publishes');
  assert.ok(d.body.classList.contains('ins-ai-only'), 'AI-only shell hides the other header tools');
  // a second draft for finance
  await click($('[data-ins-new-note]')); $('[data-ins-title]').value = 'قفل الوردية'; $('[data-ins-body]').value = 'راجع الخزينة قبل القفل'; $('[data-ins-target]').value = 'finance';
  await click($('[data-ins-save]')); await click($('[data-ins-new-note]')); await click($('[data-ins-cancel]')); assert.equal($('[data-ins-form]'), null);

  // 2. Mazen (reception): drafts hidden; ask in the bottom-up chat with the fixed warning; follow-up in the same thread
  await as('mazen');
  assert.deepEqual(buttons(), ['اسأل إنستنكت', 'تحديث']); assert.equal($$('.ins-note').length, 0, 'drafts are hidden from staff');
  assert.equal($('[data-ins-profiles]'), null); assert.equal($('[data-ins-audit]'), null);
  await click($('[data-ins-ask]'));
  const chat = () => view.querySelector('[data-ins-chat]');
  assert.equal(chat().hidden, false); const form = chat().querySelector('.ins-chat-form');
  assert.equal(form.firstElementChild.textContent, 'ممنوع كتابة اسم أو رقم أو بيانات مريض', 'warning sits above the question box');
  chat().querySelector('[data-ins-input]').value = 'المريض رقمه 010 1234 5678'; await click(chat().querySelector('[data-ins-send]'));
  assert.match(chat().querySelector('[data-ins-chat-error]').textContent, /رقم موبايل/); assert.equal(calls('instinct_ask').length, 0);
  chat().querySelector('[data-ins-input]').value = 'إزاي أعمل حجز جديد؟'; await click(chat().querySelector('[data-ins-send]')); await tick();
  assert.equal(calls('instinct_ask').length, 1); assert.equal(calls('instinct_ask')[0].args.p_thread, null);
  assert.deepEqual(Array.from(chat().querySelectorAll('.ins-msg.me')).map(m => m.firstChild.textContent), ['إزاي أعمل حجز جديد؟']);
  chat().querySelector('[data-ins-input]').value = 'وإزاي ألغيه؟'; await click(chat().querySelector('[data-ins-send]')); await tick();
  assert.equal(calls('instinct_ask')[1].args.p_thread, S.threads[0].id, 'follow-up in the same thread');
  await click(chat().querySelector('[data-ins-close]')); assert.equal(chat().hidden, true);
  // the accountant asks too
  await as('acc'); await click($('[data-ins-ask]')); chat().querySelector('[data-ins-input]').value = 'إزاي أقفل الوردية؟'; await click(chat().querySelector('[data-ins-send]')); await tick();

  // 3. Owner: approve, publish, read only in staff threads, hidden descriptions, audit, notifications
  await as('owner');
  assert.deepEqual(buttons().slice(0, 2), ['اسأل إنستنكت', 'تحديث']);
  assert.deepEqual(txt('.ins-note button'), ['تعديل', 'اعتماد', 'نشر', 'تعديل', 'اعتماد', 'نشر']);
  assert.ok(!d.body.classList.contains('ins-ai-only'));
  await click($(`[data-ins-edit="${S.notes[0].id}"]`)); $('[data-ins-body]').value = 'افتح الاستقبال والخدمات ثم اضغط حجز جديد'; await click($('[data-ins-save]'));
  assert.equal(calls('instinct_note_save').at(-1).args.p_id, S.notes[0].id); assert.equal(calls('instinct_note_save').at(-1).who, 'own');
  assert.equal(txt('[data-ins-unread]')[0], '5', '2 drafts + 3 questions'); assert.equal(d.querySelector('[data-goto="instinct"] .ins-menu-badge').textContent, '5');
  await click($(`[data-ins-approve="${S.notes[0].id}"]`)); assert.equal(calls('instinct_note_decide')[0].args.p_action, 'approve'); assert.equal(calls('instinct_note_decide')[0].who, 'own');
  assert.deepEqual(txt(`[data-ins-note="${S.notes[0].id}"] button`), ['نشر'], 'approved: publish only, no edit');
  await click($(`[data-ins-publish="${S.notes[0].id}"]`)); await click($(`[data-ins-publish="${S.notes[1].id}"]`));
  assert.deepEqual(calls('instinct_note_decide').map(c => c.args.p_action), ['approve', 'publish', 'publish']); assert.deepEqual(txt('.ins-note .ins-chip'), ['منشورة', 'منشورة']);
  assert.equal($$('.ins-thread').length, 2, 'owner sees all threads');
  await click($(`[data-ins-thread="${S.threads[0].id}"]`)); assert.equal(chat().querySelector('[data-ins-send]'), null, 'owner reads staff threads only');
  assert.equal(chat().querySelector('.ins-chat-ro').textContent, 'عرض فقط');
  const prof = $('[data-ins-profiles]'); prof.open = true; prof.dispatchEvent(new w.Event('toggle')); await tick(); await tick();
  assert.match($('[data-ins-profiles-body]').textContent, /مازن — الدور: استقبال/);
  const aud = $('[data-ins-audit]'); aud.open = true; aud.dispatchEvent(new w.Event('toggle')); await tick(); await tick(); assert.match($('[data-ins-audit-body]').textContent, /نشر ملاحظة: الحجز/);
  await click($('[data-ins-notifs] [data-ins-open-thread]')); assert.equal(chat().hidden, false, 'a question notification opens its thread');
  await click($('[data-ins-read-all]')); assert.equal(calls('instinct_notifications_read').length, 1); assert.equal($('[data-ins-unread]').hidden, true);
  await click($('[data-ins-refresh]'));

  // 4. general manager: not the owner — no approve / publish / audit
  await as('gm'); assert.equal($$('[data-ins-approve],[data-ins-publish],[data-ins-edit]').length, 0); assert.equal($('[data-ins-audit]'), null);

  // 5. Instinct replies in the thread; the server refusal of patient data is shown
  await as('ai'); assert.equal($$('.ins-thread').length, 2);
  await click($(`[data-ins-thread="${S.threads[0].id}"]`)); assert.equal(chat().querySelector('[data-ins-send]').textContent, 'إرسال الرد');
  chat().querySelector('[data-ins-input]').value = 'افتح «الاستقبال والخدمات» ثم «حجز جديد».'; await click(chat().querySelector('[data-ins-send]')); await tick();
  assert.equal(calls('instinct_reply').length, 1); assert.equal(calls('instinct_reply')[0].args.p_thread, S.threads[0].id);
  assert.equal(chat().querySelectorAll('.ins-msg.them').length, 1); assert.equal(chat().querySelectorAll('[data-ins-hide]').length, 0, 'only the owner hides');
  S.rpc = (orig => (n, a) => n === 'instinct_reply' ? { data: null, error: { message: 'ممنوع كتابة كود ملف مريض (P-…) في مساعد إنستنكت.' } } : orig(n, a))(S.rpc);
  chat().querySelector('[data-ins-input]').value = 'تمام'; await click(chat().querySelector('[data-ins-send]'));
  assert.match(chat().querySelector('[data-ins-chat-error]').textContent, /كود ملف مريض/, 'server refusal shown in Arabic');

  // 6. Mazen sees the reply, his group's note only; the accountant sees the finance note only; designer none
  await as('mazen'); assert.deepEqual(txt('.ins-note h4'), ['الحجز السريع']); assert.equal($$('.ins-thread').length, 1); assert.match($('.ins-thread small').textContent, /اترد عليه/);
  await click($('.ins-thread')); assert.equal(chat().querySelectorAll('.ins-msg').length, 3); assert.ok(chat().querySelector('[data-ins-send]'), 'own thread: can follow up');
  assert.equal(chat().querySelector('.ins-msg.them .ins-ai-label').textContent, 'رد من مساعد آلي (إنستنكت) — مش تعليمات رسمية من الإدارة');
  assert.equal(chat().querySelectorAll('[data-ins-hide]').length, 0);
  // the owner hides the reply → Mazen no longer sees it; then shows it again
  await as('owner'); await click($(`[data-ins-thread="${S.threads[0].id}"]`)); await click(chat().querySelector('[data-ins-hide]'));
  assert.equal(calls('instinct_message_hide')[0].args.p_hidden, true); assert.equal(chat().querySelector('[data-ins-hide]').textContent, 'إظهار الرد');
  await as('mazen'); await click($('.ins-thread')); assert.equal(chat().querySelectorAll('.ins-msg').length, 2);
  await as('owner'); await click($(`[data-ins-thread="${S.threads[0].id}"]`)); await click(chat().querySelector('[data-ins-hide]')); assert.equal(calls('instinct_message_hide')[1].args.p_hidden, false);
  // kill switch: one click (after confirm) as the owner; the AI is then refused everywhere; switch back on
  w.confirm = () => true; assert.equal($('[data-ins-kill]').textContent, 'إيقاف الحساب'); await click($('[data-ins-kill]'));
  assert.equal(JSON.stringify(calls('instinct_set_ai_active')[0].args), JSON.stringify({ p_admin: 'ai', p_active: false })); assert.equal($('[data-ins-kill]').textContent, 'تشغيل الحساب');
  await as('ai'); assert.match(view.textContent, /سجّل الدخول/); assert.equal(view.querySelectorAll('button').length, 0);
  await as('owner'); await click($('[data-ins-kill]')); assert.equal(calls('instinct_set_ai_active')[1].args.p_active, true);
  await as('gm'); assert.equal($('[data-ins-kill]'), null, 'kill switch: owner only');
  await as('mazen'); await click($('.ins-thread'));
  assert.ok(/[0-9]{2}\/[0-9]{2}\/2026/.test($('.ins-meta').textContent.replace(/\u200f/g, '')) && !/[٠-٩]/.test(view.textContent), 'Latin digits in dates');
  await as('acc'); assert.deepEqual(txt('.ins-note h4'), ['قفل الوردية']);
  await as('designer'); assert.equal($$('.ins-note').length, 0); assert.equal($$('.ins-thread').length, 0);
  // 7. nursing: refused by the server, no buttons at all
  await as('nurse'); assert.match(view.textContent, /مش متاح لحسابك/); assert.equal(view.querySelectorAll('button').length, 0);
  assert.ok(toasts.length >= 0); assert.deepEqual(errors, []);
  w.close(); console.log('PASS instinct assistant DOM: tab per role, AI-only shell, drafts (Instinct), approve/publish (owner only), bottom-up chat with fixed warning, ask/follow-up (staff), reply (Instinct), read-only owner view, patient-data refusals, notifications, hidden descriptions, audit.');
})().catch(e => { console.error(e); process.exit(1); });
