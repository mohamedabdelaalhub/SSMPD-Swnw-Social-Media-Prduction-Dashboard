// Job catalog UI: HR tab (cards, filters, link/unlink), salary lock, employee-file block with the band bar, «وظيفتي» without pay.
const assert = require('node:assert/strict'), fs = require('fs'), makeEnv = require('./helpers/att-hub-env.cjs');
const job = (id, ar, dep, people, extra = {}) => ({ id, code: id, title_ar: ar, title_en: '', department: dep, tasks: ['مهمة ' + ar], qualifications: ['مؤهل'], experience: '', kpis: [{ name: 'مؤشر تلقائي', target: '100%', kind: 'auto' }, { name: 'مؤشر يدوي', target: '', kind: 'manual' }], incentive: 'حافز', revision: 1, people, ...extra });
const person = (id, name, jobId) => ({ id, admin_id: null, full_name: name, code: 'EMP-' + id, kind: 'employee', department: 'قسم', status: 'active', revision: 1, leave_balance: 30, phone: '', job_id: jobId || null });
(async () => {
  const people = [person('p1', 'ممرضة أولى', 'j1'), person('p2', 'موظف حر'), { ...person('p3', 'طبيب'), kind: 'doctor' }];
  let sv = false, assignArgs = null;
  const mkRpc = () => async (fn, a) => {
    if (fn === 'hr_jobs') return { data: { can_edit: sv, salary_visible: sv, jobs: [job('j1', 'ممرض / ممرضة', 'الطاقم التمريضي', [{ id: 'p1', full_name: 'ممرضة أولى' }], sv ? { salary_min: 7000, salary_max: 8000, salary_approved: 7500, salary_note: '' } : {}), job('j2', 'موظف استقبال', 'التشغيل', [], sv ? { salary_min: 7000, salary_max: 8000 } : {})], unclassified: [{ id: 'p2', full_name: 'موظف حر', job_title: 'غير معروف' }] } };
    if (fn === 'hr_job_assign') { assignArgs = a; return { data: null }; }
    if (fn === 'hr_job_band') return { data: { visible: true, status: 'below', salary_min: 7000, salary_max: 8000, salary: 6500, diff: 500 } };
    if (fn === 'hr_my_job') return { data: { job: { title_ar: 'ممرض / ممرضة', department: 'الطاقم التمريضي', tasks: ['تجهيز الغرف'], qualifications: ['دبلوم'], experience: '', kpis: [{ name: 'تعقيم', kind: 'manual' }] } } };
    return undefined;
  };
  // 1) HR manager without salary access
  let t = await makeEnv({ people, rpc: mkRpc() }); t.w.eval(fs.readFileSync('assets/js/hr-job-catalog.js', 'utf8'));
  t.w.SSMPDHumanResources.render(t.host); await t.tick();
  t.d.querySelector('[data-hr-open=jobs]').click(); await t.tick(); await t.tick(); await t.tick();
  let cards = [...t.d.querySelectorAll('.jc-card')]; assert.equal(cards.length, 2, '2 jobs shown');
  assert(t.d.querySelector('.jc-kpi.hero b').textContent === '1', 'one job with nobody');
  assert(!t.d.body.textContent.includes('7,000'), 'no salary shown without finance/super');
  assert(t.d.querySelector('.jc-lock'), 'lock note shown');
  assert(!t.d.querySelector('[data-jc-new]'), 'HR-only user cannot create jobs');
  // filter
  t.d.querySelector('[data-jc-dept="التشغيل"]').click(); assert.equal(t.d.querySelectorAll('.jc-card').length, 1);
  // open detail, link a person
  t.d.querySelector('[data-jc-open=j2]').click(); assert(t.d.querySelector('.jc h3').textContent.includes('موظف استقبال'));
  assert(t.d.querySelector('.jc-badge.auto') && t.d.querySelector('.jc-badge.manual'), 'auto/manual tags');
  const opts = [...t.d.querySelectorAll('[name=jc_person] option')].map(o => o.textContent); assert(opts.includes('موظف حر') && !opts.includes('طبيب'), 'doctors are not offered');
  t.d.querySelector('[name=jc_person]').value = 'p2'; t.d.querySelector('[data-jc-add]').click(); await t.tick();
  assert.equal(JSON.stringify(assignArgs), JSON.stringify({ p_person: 'p2', p_job: 'j2' }));
  // unclassified row on the catalog
  t.d.querySelector('[data-jc-back]').click(); assert(t.d.querySelector('.jc-out'), 'out-of-catalog list'); assert.equal(t.d.querySelector('.jc-kpis .jc-kpi:last-child b').textContent, '1');
  // 2) finance/super: salary visible + band bar in the employee file block
  sv = true; t = await makeEnv({ people, rpc: mkRpc() }); t.w.eval(fs.readFileSync('assets/js/hr-job-catalog.js', 'utf8'));
  t.w.SSMPDHumanResources.render(t.host); await t.tick(); t.d.querySelector('[data-hr-open=jobs]').click(); await t.tick(); await t.tick(); await t.tick();
  assert(t.d.body.textContent.includes('7,000'), 'salary band visible'); assert(t.d.querySelector('[data-jc-new]'), 'owner can add a job');
  const box = t.d.createElement('div'); t.d.body.append(box); t.w.SSMPDHRJobs.profile(box, people[0], { can_manage: true }); await t.tick(); await t.tick(); await t.tick();
  assert.equal(box.querySelector('[name=jc_job]').value, 'j1'); assert(box.querySelector('.jc-bar .dot.warn'), 'below band → red dot'); assert(box.textContent.includes('أقل من نطاق الوظيفة بـ 500') && box.textContent.includes('مش بيمنع حفظ الراتب'));
  const dbox = t.d.createElement('div'); t.w.SSMPDHRJobs.profile(dbox, people[2], { can_manage: true }); assert.equal(dbox.innerHTML, '', 'doctors get no job block');
  // 3) employee «وظيفتي»
  t = await makeEnv({ manager: false, people, rpc: mkRpc() }); t.w.eval(fs.readFileSync('assets/js/hr-job-catalog.js', 'utf8'));
  t.w.SSMPDHumanResources.render(t.host); await t.tick(); const tab = t.d.querySelector('[data-hr-open=myjob]'); assert(tab, 'myjob tab for employees'); tab.click(); await t.tick(); await t.tick(); await t.tick();
  const txt = t.d.querySelector('[data-hr-section=myjob]').textContent; assert(txt.includes('تجهيز الغرف') && !/7,000|راتب:|حافز/.test(txt.replace('الراتب مش بيظهر هنا', '')), 'tasks yes, pay no');
  console.log('PASS job catalog UI: cards/filter/link, salary lock, band bar warning, doctors excluded, employee view without pay.');
})().catch(e => { console.error(e); process.exit(1); });
