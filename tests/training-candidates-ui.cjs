// Training center PR 4 UI: owner candidates section (invite, one-time link, WhatsApp prefill, revoke, delete) and the
// public candidate page flow (consent → profile → exam → submit, one-time token in the hash). RPC and fetch are mocked;
// server rules are covered by tests/training-center-candidate-rollback.sql.
const { JSDOM } = require('jsdom');
const fs = require('fs');
const path = require('path');
const assert = require('assert');
const root = path.join(__dirname, '..');
const read = (f) => fs.readFileSync(path.join(root, f), 'utf8');
const tick = () => new Promise((r) => setTimeout(r, 0));
const settle = async () => { for (let i = 0; i < 8; i++) await tick(); };
const evil = '<img src=x onerror="window.__xss=1">';

async function owner() {
  const dom = new JSDOM('<!DOCTYPE html><body><div id="v"></div></body>', { runScripts: 'outside-only', url: 'https://example.test/app/index.html' });
  const w = dom.window; const calls = []; let role = 'super_admin';
  const state = { list: [{ candidate_id: 'C1', assignment_id: 'A1', name: evil, phone: '01012345678', email: null, experience: 'خبرة', track_name: 'مدير فرع', invite_status: 'pending', expires_at: new Date(Date.now() + 864e5).toISOString(), reviewer_name: 'مراجع', returning_applicant: true, minimal: false, owner_notes: '' },
                      { candidate_id: 'C2', assignment_id: 'A2', name: 'مرشح ثان', track_name: 'مدير فريق', invite_status: 'submitted', reviewer_name: 'مراجع', minimal: false }] };
  const MOCK = {
    training_assignments: () => [], training_candidates: () => state.list,
    training_people: () => [{ id: 'p1', name: 'مراجع تجريبي' }],
    training_invite_candidate: (a) => ({ candidate_id: 'C3', assignment_id: 'A3', token: 'T'.repeat(64), expires_at: new Date(Date.now() + 7 * 864e5).toISOString(), returning_applicant: false }),
    training_revoke_candidate_invite: () => null, training_delete_candidate_data: () => null, training_candidate_note: () => null,
    training_bank_summary: () => ({ meta: { version: 'T', questions_per_attempt: 30, duration_minutes: 40 }, competencies: [] }),
    training_bank_view: () => ({ bank: 'manager', meta: null, groups: [] })
  };
  w.SSMPDDb = { client: { rpc: async (n, a) => { calls.push([n, a]); try { return { data: MOCK[n](a || {}), error: null }; } catch (e) { return { data: null, error: e }; } } } };
  w.SSMPDAuth = { currentAdmin: { id: 'me', role } }; w.SSMPDRoles = { hasRole: (a, r) => a.role === r }; w.SSMPDToast = { show: () => {} };
  for (const f of ['assets/js/training-course-data.js', 'assets/js/training-evaluation.js', 'assets/js/training-candidates.js']) w.eval(read(f));
  const $ = (s) => w.document.querySelector(s);
  const click = async (s) => { const el = typeof s === 'string' ? $(s) : s; assert(el, 'missing ' + s); el.click(); await settle(); };

  await w.SSMPDTrainingEvaluation.render($('#v')); await settle();
  assert($('[data-candidates]'), 'owner sees the candidates section');
  assert(!w.__xss && !$('[data-candidates] img'), 'candidate names are escaped');
  assert(/تقدّم سابقًا/.test($('[data-candidates]').textContent), 'returning applicant badge');
  assert($('[data-result="A2"]') && $('[data-revoke="A1"]') && !$('[data-revoke="A2"]'), 'row actions follow invite status');
  // invite flow
  await click('[data-invite]');
  const set = (n, v) => { $('.te-overlay [name=' + n + ']').value = v; };
  await click('.te-overlay [data-ok]');
  assert(/اكتب اسم المرشح/.test($('.te-overlay .te-err').textContent), 'name required');
  set('name', 'مرشح جديد'); set('phone', '0101 234 5678'); set('reviewer', 'p1'); set('days', '9');
  await click('.te-overlay [data-ok]'); await settle();
  const inv = calls.filter((c) => c[0] === 'training_invite_candidate').pop();
  assert.strictEqual(JSON.stringify(inv[1]), JSON.stringify({ p_name: 'مرشح جديد', p_phone: '0101 234 5678', p_email: null, p_track: 'branch_manager', p_reviewer: 'p1', p_days: 9 }));
  const url = $('.te-overlay [data-url]').value;
  assert.strictEqual(url, 'https://example.test/app/candidate.html#t=' + 'T'.repeat(64), 'link built from the token in the hash');
  const wa = $('.te-overlay a[href^="https://wa.me/"]');
  assert(wa && wa.getAttribute('href').indexOf('wa.me/201012345678?text=') > 0, 'WhatsApp prefill normalises the number');
  assert(/لا يُرسل شيئًا/.test($('.te-overlay').textContent), 'prefill is not described as sending');
  assert(!/«إرسال»|تم الإرسال/.test($('.te-overlay').textContent));
  // revoke needs a reason
  await click('.te-overlay [data-x]');
  await click('[data-revoke="A1"]');
  await click('.te-overlay [data-ok]');
  assert(/اكتب السبب/.test($('.te-overlay .te-err').textContent));
  $('.te-overlay [name=reason]').value = 'خطأ في البيانات'; await click('.te-overlay [data-ok]');
  assert.strictEqual(JSON.stringify(calls.filter((c) => c[0] === 'training_revoke_candidate_invite').pop()[1]), JSON.stringify({ p_assignment: 'A1', p_reason: 'خطأ في البيانات' }));
  // a non-owner reviewer sees the list but no invite/delete controls
  role = 'reception'; w.SSMPDAuth.currentAdmin.role = 'reception';
  await w.SSMPDTrainingEvaluation.render($('#v')); await settle();
  assert($('[data-candidates]') && !$('[data-invite]') && !$('[data-delete]') && !$('[data-revoke]'), 'reviewer: read-only section');
  // no candidates and not owner: section removed
  state.list = [];
  await w.SSMPDTrainingEvaluation.render($('#v')); await settle();
  assert(!$('[data-candidates]'), 'reviewer without candidates sees nothing');
}

async function candidatePage() {
  const html = read('candidate.html');
  assert(/noindex/.test(html) && /no-referrer/.test(html), 'page is not indexable and sends no referrer');
  const dom = new JSDOM('<!DOCTYPE html><body><main id="app"></main></body>', { runScripts: 'outside-only', url: 'https://example.test/candidate.html#t=' + 'T'.repeat(64) });
  const w = dom.window; const sent = [];
  let stage = 'consent';
  const exam = { remaining_seconds: 1800, total: 2, answers: {}, questions: [{ id: 'q1', text: 'س1', options: [{ id: 'a', text: 'أ' }, { id: 'b', text: 'ب' }] }, { id: 'q2', text: 'س2', options: [{ id: 'a', text: 'أ' }] }] };
  const base = { name: 'مرشح', email: null, phone: null, experience: null, qualifications: null };
  w.SSMPD_CONFIG = { supabase: { url: 'https://api.test', anonKey: 'k' } };
  w.fetch = async (u, o) => {
    const b = JSON.parse(o.body); sent.push(b);
    assert.strictEqual(u, 'https://api.test/functions/v1/training-candidate');
    assert.strictEqual(b.token, 'T'.repeat(64)); assert(b.device.length >= 16);
    if (b.action === 'open') return { json: async () => ({ ok: true, data: Object.assign({ stage }, base) }) };
    if (b.action === 'consent') { stage = 'profile'; return { json: async () => ({ ok: true, data: Object.assign({ stage }, base) }) }; }
    if (b.action === 'profile') { stage = 'ready'; return { json: async () => ({ ok: true, data: Object.assign({ stage }, base) }) }; }
    if (b.action === 'start') { stage = 'exam'; return { json: async () => ({ ok: true, data: Object.assign({ stage, exam }, base) }) }; }
    if (b.action === 'save') return { json: async () => ({ ok: true, data: { saved: true, status: 'in_progress' } }) };
    if (b.action === 'submit') { stage = 'done'; return { json: async () => ({ ok: true, data: Object.assign({ stage, exam: null }, base) }) }; }
    return { json: async () => ({ ok: true, data: null }) };
  };
  w.confirm = () => true;
  w.eval(read('assets/js/candidate-exam.js'));
  const $ = (s) => w.document.querySelector(s);
  await settle();
  assert(/مرحبًا مرشح/.test($('#app').textContent) && $('#go').disabled, 'consent first, button disabled until ticked');
  $('#ok').checked = true; $('#ok').dispatchEvent(new w.Event('change')); assert(!$('#go').disabled);
  $('#go').click(); await settle();
  assert.strictEqual(sent.filter((s) => s.action === 'consent')[0].version, 'draft-1');
  assert($('#ex') && $('#qu'), 'profile form');
  $('#ex').value = 'خبرة'; $('#qu').value = 'مؤهل'; $('#go').click(); await settle();
  assert(/ابدأ الاختبار/.test($('#app').textContent), 'ready stage');
  $('#go').click(); await settle();
  assert.strictEqual(w.document.querySelectorAll('.ce-q').length, 2, 'exam rendered');
  assert(!/points|critical|grade/.test($('#app').innerHTML), 'no key or score in the candidate DOM');
  const r = $('.ce-q input[value="b"]'); r.checked = true; r.dispatchEvent(new w.Event('change', { bubbles: true })); await settle();
  const sv = sent.filter((x) => x.action === 'save').pop();
  assert.strictEqual(sv.question + sv.option, 'q1b');
  $('#sub').click(); await settle();
  assert(/تم استلام إجاباتك/.test($('#app').textContent) && !/درجة|نسبة/.test($('#app').textContent), 'done: no score shown');
}
(async () => { await owner(); console.log('PASS training candidates owner UI'); await candidatePage(); console.log('PASS candidate page flow'); })().catch((e) => { console.error(e); process.exit(1); });
