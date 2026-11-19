// Training center UI (PR 2): trainee course → exam → submit; owner/reviewer lists; escaping; RPC arguments.
// Synthetic data only; the RPC layer is mocked (server rules are covered by tests/training-center-*-rollback.sql).
const { JSDOM } = require('jsdom');
const fs = require('fs');
const path = require('path');
const assert = require('assert');
const root = path.join(__dirname, '..');

const dom = new JSDOM('<!DOCTYPE html><body><div id="v"></div></body>', { runScripts: 'outside-only', url: 'https://example.test/' });
const w = dom.window;
const calls = [];
const evil = '<img src=x onerror="window.__xss=1">';
let role = 'reception';
const state = { completed: {}, attempt: null, list: [] };
function questions() {
  return Array.from({ length: 30 }, (_, i) => ({ id: 'q' + i, text: 'سؤال تجريبي ' + (i + 1), options: ['c', 'a', 'd', 'b'].map((id) => ({ id, text: 'اختيار ' + id })) }));
}
const MOCK = {
  training_assignments: () => state.list,
  training_course_progress: () => ({ modules: ['m1', 'm2', 'm3', 'm4', 'm5', 'm6', 'm7', 'm8'], completed: state.completed, exam: state.attempt && { status: state.attempt.status, submitted_at: state.attempt.submitted_at }, bank_ready: true, duration_minutes: 40, questions_per_attempt: 30 }),
  training_complete_module: (a) => { state.completed[a.p_module] = new Date().toISOString(); return null; },
  training_start_exam: () => {
    if (Object.keys(state.completed).length < 8) throw { message: 'training: complete all course modules first' };
    if (!state.attempt) state.attempt = { status: 'in_progress', answers: {} };
    return state.attempt.status === 'submitted' ? { status: 'submitted', questions: null } : { status: 'in_progress', server_now: new Date().toISOString(), deadline_at: new Date(Date.now() + 1500e3).toISOString(), questions: questions(), answers: Object.assign({}, state.attempt.answers) };
  },
  training_save_answer: (a) => { state.attempt.answers[a.p_question] = a.p_option; return { saved: true, status: 'in_progress' }; },
  training_record_blur: () => null,
  training_submit_exam: () => { state.attempt.status = 'submitted'; state.attempt.submitted_at = new Date().toISOString(); return { status: 'submitted', questions: null }; },
  training_bank_summary: () => ({ meta: { version: 'TEST', questions_per_attempt: 30, duration_minutes: 40 }, competencies: [] }),
  training_people: () => [{ id: 'p1', name: 'موظف تجريبي ١' }, { id: 'p2', name: 'موظف تجريبي ٢' }],
  training_assign: () => 'new-id',
  training_cancel_assignment: () => null,
};
w.SSMPDDb = { client: { rpc: async (name, args) => { calls.push([name, args]); try { return { data: MOCK[name](args || {}), error: null }; } catch (e) { return { data: null, error: e }; } } } };
w.SSMPDAuth = { currentAdmin: { id: 'me', role } };
w.SSMPDRoles = { hasRole: (a, r) => a.role === r };
w.SSMPDToast = { show: () => {} };
for (const f of ['assets/js/training-course-data.js', 'assets/js/training-evaluation.js']) w.eval(fs.readFileSync(path.join(root, f), 'utf8'));
const tick = () => new Promise((r) => setTimeout(r, 0));
const $ = (s) => w.document.querySelector(s);
const click = async (s) => { const el = typeof s === 'string' ? $(s) : s; assert(el, 'missing ' + s); el.click(); for (let i = 0; i < 6; i++) await tick(); };
const row = (o) => Object.assign({ id: 'A1', track: 'branch_manager', track_name: 'مدير فرع', trainee_id: 'me', trainee_name: evil, reviewer_id: 'r', reviewer_name: 'مراجع تجريبي', due_at: null, status: 'assigned', modules_done: 0, modules_total: 8, relation: 'trainee' }, o);

(async () => {
  assert.strictEqual(w.SSMPDTrainingCourse.modules.length, 8, 'course has 8 modules');
  // trainee home
  state.list = [row({})];
  await w.SSMPDTrainingEvaluation.render($('#v'));
  await tick();
  assert(!$('[data-new]'), 'non-owner has no «تكليف جديد»');
  assert(!w.__xss && !$('#v img'), 'names are escaped');
  await click('[data-open="A1"]');
  assert(!$('[data-start]'), 'exam locked before the course');
  assert(/بعد إنهاء جميع الوحدات/.test($('#v').textContent));
  // read and complete all 8 modules
  for (let i = 0; i < 8; i++) {
    await click('[data-mod="' + i + '"]');
    assert($('.te-answer').hidden, 'self-check answer hidden until asked');
    await click('[data-reveal]');
    await click('[data-done]');
  }
  assert.strictEqual(calls.filter((c) => c[0] === 'training_complete_module').length, 8);
  // start exam (confirm dialog)
  await click('[data-start]');
  await click('.te-overlay [data-ok]');
  assert($('.te-exam-bar'), 'exam view');
  assert.strictEqual(w.document.querySelectorAll('.te-grid button').length, 30);
  assert(!/points|critical/.test($('#v').innerHTML), 'no key fields in the exam DOM');
  assert.deepStrictEqual([...w.document.querySelectorAll('.te-opt')].map((b) => b.dataset.opt), ['c', 'a', 'd', 'b'], 'server option order kept');
  await click('.te-opt[data-opt="d"]');
  const save = calls.filter((c) => c[0] === 'training_save_answer').pop();
  assert.strictEqual(JSON.stringify(save[1]), JSON.stringify({ p_assignment: 'A1', p_question: 'q0', p_option: 'd' }));
  assert($('.te-opt.sel').dataset.opt === 'd');
  await click('[data-next]');
  assert(/السؤال 2 من 30/.test($('.te-exam-bar').textContent));
  // leaving the tab is recorded
  Object.defineProperty(w.document, 'visibilityState', { value: 'hidden', configurable: true });
  w.document.dispatchEvent(new w.Event('visibilitychange'));
  await tick();
  assert(calls.some((c) => c[0] === 'training_record_blur'));
  // submit with confirmation, warns about unanswered questions
  await click('[data-submit]');
  assert(/لم تُجب عن 29/.test($('.te-overlay').textContent));
  await click('.te-overlay [data-ok]');
  assert(/تم استلام إجاباتك/.test($('#v').textContent), 'submitted message');
  assert(!$('[data-start]') && !$('[data-exam]'), 'no second attempt button');
  assert(!/درجة|النسبة|%/.test($('#v').textContent), 'no score shown to the trainee');

  // owner: new assignment dialog validates reviewer ≠ trainee; cancel needs a reason
  w.SSMPDAuth.currentAdmin = { id: 'own', role: 'super_admin' };
  state.list = [row({ relation: 'owner', trainee_id: 'p1', trainee_name: 'موظف تجريبي ١' })];
  await w.SSMPDTrainingEvaluation.render($('#v'));
  for (let i = 0; i < 4; i++) await tick();
  assert($('[data-new]') && /TEST/.test($('[data-bank]').textContent));
  await click('[data-new]');
  $('.te-overlay [name=trainee]').value = 'p1';
  $('.te-overlay [name=reviewer]').value = 'p1';
  await click('.te-overlay [data-ok]');
  assert(/غير المتدرب/.test($('.te-overlay .te-err').textContent));
  assert(!calls.some((c) => c[0] === 'training_assign'));
  $('.te-overlay [name=reviewer]').value = 'p2';
  await click('.te-overlay [data-ok]');
  const asg = calls.filter((c) => c[0] === 'training_assign').pop()[1];
  assert.strictEqual(asg.p_trainee, 'p1'); assert.strictEqual(asg.p_reviewer, 'p2');
  await click('[data-cancel="A1"]');
  await click('.te-overlay [data-ok]');
  assert(/سبب الإلغاء/.test($('.te-overlay .te-err').textContent));
  $('.te-overlay [name=reason]').value = 'اختبار';
  await click('.te-overlay [data-ok]');
  assert(calls.some((c) => c[0] === 'training_cancel_assignment' && c[1].p_reason === 'اختبار'));
  console.log('PASS training evaluation UI: course gate, 8 modules, exam order/save/blur/submit, no key or score in trainee DOM, owner assign/cancel validation, escaping.');
  process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
