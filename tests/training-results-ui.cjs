// Training center PR 6 UI: trainee «نتيجتي» (no numbers) + review request, owner review list/close, printable final report
// (official letterhead, no brand name), candidate result link, and the view-once candidate result page. RPC/fetch mocked.
const { JSDOM } = require('jsdom');
const fs = require('fs');
const path = require('path');
const assert = require('assert');
const root = path.join(__dirname, '..');
const read = (f) => fs.readFileSync(path.join(root, f), 'utf8');
const tick = () => new Promise((r) => setTimeout(r, 0));
const settle = async () => { for (let i = 0; i < 8; i++) await tick(); };

async function app(role) {
  const dom = new JSDOM('<!DOCTYPE html><body><div id="v"></div></body>', { runScripts: 'outside-only', url: 'https://example.test/app/index.html' });
  const w = dom.window; const calls = [];
  const list = role === 'super_admin'
    ? [{ id: 'A1', status: 'decided', relation: 'owner', track_name: 'مدير فرع', trainee_name: 'متدرب', reviewer_name: 'م', exam_status: 'submitted' }]
    : [{ id: 'A1', status: 'decided', relation: 'trainee', track_name: 'مدير فرع', trainee_name: 'أنا', reviewer_name: 'م', exam_status: 'submitted' }];
  const MOCK = {
    training_assignments: () => list, training_candidates: () => [{ candidate_id: 'C1', assignment_id: 'A9', name: 'مرشح', phone: '01012345678', track_name: 'مدير فرع', invite_status: 'submitted', assignment_status: 'decided', reviewer_name: 'م', minimal: false }],
    training_bank_summary: () => ({ meta: { version: 'T', questions_per_attempt: 30, duration_minutes: 40 }, competencies: [] }), training_bank_view: () => ({ bank: 'manager', meta: null, groups: [] }),
    training_course_progress: () => ({ modules: [], completed: {}, exam: null }),
    training_my_result: () => ({ decided: true, decision: 'ready_after_training', label: 'جاهز بعد تدريب', message: 'رسالة', learning_areas: ['التشغيل'], review: null }),
    training_request_result_review: () => null,
    training_result_reviews: () => [{ assignment_id: 'A1', reason: 'سبب الطلب', status: 'open', trainee_name: 'متدرب', track_name: 'مدير فرع', decision: 'جاهز بعد تدريب' }],
    training_close_result_review: () => null,
    training_issue_result_link: () => ({ token: 'R'.repeat(64), expires_at: new Date(Date.now() + 864e5).toISOString() }),
    training_final_report: () => ({ subject_kind: 'trainee', subject_name: 'متدرب', track_name: 'مدير فرع', reviewer_name: 'م', created_at: new Date().toISOString(), status: 'decided',
      exam: { percent: 66, grade: 'medium', risk_flags: 1, answered: 30, total: 30, used_seconds: 1500, blur_count: 2, auto_submitted: false },
      decision: { label: 'جاهز بعد تدريب', suggested_label: 'جاهز بعد تدريب', decided_at: new Date().toISOString(), decided_by: 'المالك', message: 'رسالة', computed: { complete: true, interview_avg: 3.9, roleplay_avg: 3.5, blocking_flags: 0, result: 71.5, weaknesses: [{ name_ar: 'التشغيل' }] } } })
  };
  w.SSMPDDb = { client: { rpc: async (n, a) => { calls.push([n, a]); try { return { data: MOCK[n](a || {}), error: null }; } catch (e) { return { data: null, error: e }; } } } };
  w.SSMPDAuth = { currentAdmin: { id: 'me', role } }; w.SSMPDRoles = { hasRole: (a, r) => a.role === r }; w.SSMPDToast = { show: () => {} };
  w.eval(read('assets/js/swnw-print.js'));
  for (const f of ['assets/js/training-course-data.js', 'assets/js/training-evaluation.js', 'assets/js/training-candidates.js', 'assets/js/training-results.js']) w.eval(read(f));
  return { w, calls, $: (s) => w.document.querySelector(s), click: async (s) => { const el = typeof s === 'string' ? w.document.querySelector(s) : s; assert(el, 'missing ' + s); el.click(); await settle(); } };
}

(async () => {
  // trainee
  let t = await app('reception');
  await t.w.SSMPDTrainingEvaluation.render(t.$('#v')); await settle();
  await t.click('[data-myresult="A1"]');
  const m = t.$('.te-overlay').textContent;
  assert(/جاهز بعد تدريب/.test(m) && /التشغيل/.test(m) && /رسالة/.test(m), 'label, learning area and message');
  assert(!/%|\d/.test(m.replace(/\s/g, '')), 'no number anywhere in the trainee result');
  await t.click('.te-overlay [data-ask]');
  await t.click('.te-overlay [data-ok]');
  assert(/اكتب سبب الطلب/.test(t.$('.te-overlay .te-err').textContent), 'reason required');
  t.$('.te-overlay [name=reason]').value = 'أرى أن التقدير منخفض'; await t.click('.te-overlay [data-ok]');
  assert.strictEqual(JSON.stringify(t.calls.filter((c) => c[0] === 'training_request_result_review').pop()[1]), JSON.stringify({ p_assignment: 'A1', p_reason: 'أرى أن التقدير منخفض' }));
  assert(!t.$('[data-report]') && !t.$('[data-reviews]'), 'trainee has no owner controls');

  // owner
  const o = await app('super_admin');
  await o.w.SSMPDTrainingEvaluation.render(o.$('#v')); await settle();
  assert(o.$('[data-reviews]') && /سبب الطلب/.test(o.$('[data-reviews]').textContent), 'owner sees review requests');
  await o.click('[data-close-review="A1"]'); await o.click('.te-overlay [data-ok]');
  assert(/اكتب الرد/.test(o.$('.te-overlay .te-err').textContent));
  o.$('.te-overlay [name=r]').value = 'تمت المراجعة'; await o.click('.te-overlay [data-ok]');
  assert.strictEqual(JSON.stringify(o.calls.filter((c) => c[0] === 'training_close_result_review').pop()[1]), JSON.stringify({ p_assignment: 'A1', p_response: 'تمت المراجعة' }));
  assert(o.$('[data-report="A1"]'), 'final report button on decided rows');
  // printable report: official letterhead, no brand name in the title
  const html = o.w.SSMPDTrainingResults._reportHtml(await (async () => (await o.w.SSMPDDb.client.rpc('training_final_report', {})).data)());
  assert(/swnw-official-letterhead\.png/.test(html), 'official letterhead');
  const h2 = /<h2>(.*?)<\/h2>/.exec(html)[1]; assert(!/سونو|Swnw|swnw/i.test(h2), 'no brand name in the title: ' + h2);
  assert(/71\.5/.test(html) && /التشغيل/.test(html) && /ختم المركز/.test(html));
  // candidate result link
  await o.click('[data-resultlink="A9"]'); await o.click('.te-overlay [data-ok]');
  const call = o.calls.filter((c) => c[0] === 'training_issue_result_link').pop();
  assert.strictEqual(JSON.stringify(call[1]), JSON.stringify({ p_assignment: 'A9', p_days: 14 }));
  await settle();
  assert.strictEqual(o.$('.te-overlay [data-url]').value, 'https://example.test/app/candidate-result.html#t=' + 'R'.repeat(64));
  assert(/لا يُرسل شيئًا/.test(o.$('.te-overlay').textContent));
  console.log('PASS training results UI');

  // candidate result page: one call, label + message only, no score; second load uses the session copy (same tab) and offers save
  const dom = new JSDOM('<!DOCTYPE html><body><main id="app"></main></body>', { runScripts: 'outside-only', url: 'https://example.test/candidate-result.html#t=' + 'R'.repeat(64) });
  const w = dom.window; let n = 0;
  w.SSMPD_CONFIG = { supabase: { url: 'https://api.test', anonKey: 'k' } };
  w.fetch = async (u, opt) => { n++; const b = JSON.parse(opt.body); assert.strictEqual(b.action, 'result'); assert(!('device' in b)); return { json: async () => ({ ok: true, data: { name: 'مرشح', label: 'جاهز', message: 'مبروك' } }) }; };
  w.eval(read('assets/js/candidate-result.js')); await settle();
  const txt = w.document.querySelector('#app').textContent;
  assert(/جاهز/.test(txt) && /مبروك/.test(txt) && /مرة واحدة/.test(txt) && w.document.querySelector('#pdf') && w.document.querySelector('#img'), 'result page');
  assert(!/\d/.test(txt.replace(/[٠-٩]/g, '')), 'no numbers on the candidate result page');
  assert.strictEqual(n, 1);
  console.log('PASS candidate result page');
})().catch((e) => { console.error(e); process.exit(1); });
