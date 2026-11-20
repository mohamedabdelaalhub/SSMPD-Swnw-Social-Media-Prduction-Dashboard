// «مساعد طبيب» (doctor_assistant): label, today's-operations tab like nursing (day-only), no archive tab, admin dropdown group,
// training videos, clinical finalize button, and NOT in the nurse/nursing lists.
const fs=require('node:fs'),assert=require('node:assert/strict'),vm=require('node:vm');
const ctx={window:{}};vm.createContext(ctx);vm.runInContext(fs.readFileSync('assets/js/roles.js','utf8'),ctx);const R=ctx.window.SSMPDRoles;
const a={id:'x',role:'doctor_assistant'};
assert.equal(R.label('doctor_assistant'),'مساعد طبيب');
assert.equal(R.canSeeTab(a,'reception_services'),true);assert.equal(R.isNursingDayOnly(a),true);
assert.equal(R.canSeeTab(a,'my_kpi'),true);assert.equal(R.canSeeTab(a,'tasks'),true);
assert.equal(R.canSeeTab(a,'patients'),false,'no archive tab by role');assert.equal(R.canSeeTab(a,'leads'),false);
assert.equal(R.defaultTab(a),'reception_services');
assert.equal(R.isNursingDayOnly({id:'y',role:'doctor_assistant',roles:['doctor_assistant','reception']}),false,'reception keeps the full desk');
const src=f=>fs.readFileSync('assets/js/'+f,'utf8');
assert.match(src('admin-workspace.js'),/'head_nursing','doctor_assistant'/);
assert.match(src('today-operations-finalize.js'),/has\('doctor_assistant'\)/);
assert.equal((src('training-videos.js').match(/'doctor_assistant'/g)||[]).length,2);
assert.doesNotMatch(src('employee-assistant.js'),/doctor_assistant/,'not in the nursing group');
assert.doesNotMatch(src('render-reports.js'),/doctor_assistant/,'not in nursing reports');
console.log('PASS doctor assistant role UI');
