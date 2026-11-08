// Nursing day-only reception view (preview gated to the owner's test account).
const fs=require('node:fs'),assert=require('node:assert/strict'),vm=require('node:vm');
const ctx={window:{}};vm.createContext(ctx);vm.runInContext(fs.readFileSync('assets/js/roles.js','utf8'),ctx);const R=ctx.window.SSMPDRoles;
const t='swnwclinics+staff@gmail.com',real='nurse@example.com';
assert.equal(R.isNursingDayOnly({email:t,role:'nursing'}),true);assert.equal(R.isNursingDayOnly({email:t,role:'head_nursing'}),true);
assert.equal(R.isNursingDayOnly({email:real,role:'nursing'}),true,'rolled out to all nurses');
assert.equal(R.isNursingDayOnly({email:t,role:'reception'}),false);assert.equal(R.isNursingDayOnly({email:t,role:'nursing',extra_roles:['reception'],roles:['nursing','reception']}),false,'mixed roles keep full view');
assert.equal(R.canSeeTab({id:'1',email:t,role:'head_nursing'},'reception_services'),true);assert.equal(R.canSeeTab({id:'1',email:real,role:'head_nursing'},'reception_services'),true);
const ws=fs.readFileSync('assets/js/reception-workspace.js','utf8');assert(ws.includes("if(nursingDayOnly()){var day=rows.filter(function(r){return r[0]==='journey';})"));assert(ws.includes("(nursingDayOnly()?'':btn('back','','رجوع للأقسام'))"));
console.log('PASS nursing day-only view: all nurses, nursing + head nursing, mixed roles keep full view, journey section only, no back button.');
