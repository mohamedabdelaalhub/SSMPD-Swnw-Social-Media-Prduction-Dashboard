// «فيديوهات الشرح»: each role sees only its videos; managers see all; every listed file exists.
const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict');
function load(admin){const ctx={window:{},document:{addEventListener(){},querySelector(){return null;}},setInterval(){}};ctx.window.SSMPDAuth={currentAdmin:admin};vm.createContext(ctx);vm.runInContext(fs.readFileSync('assets/js/roles.js','utf8'),ctx);ctx.window.SSMPDAuth={currentAdmin:admin};vm.runInContext(fs.readFileSync('assets/js/training-videos.js','utf8').replace('(window)','(this.window)'),ctx);return ctx.window.SSMPDTrainingVideos.list().map(v=>v.f);}
const rec=load({id:'1',role:'reception',roles:['reception']});assert.equal(rec.length,8);assert(!rec.includes('10-content.mp4'));
const nur=load({id:'2',role:'nursing',roles:['nursing']});assert.deepEqual(JSON.parse(JSON.stringify(nur)),['02-call-start.mp4','03-service-finish.mp4','05-my-tasks.mp4','07-my-kpi.mp4','08-menu-search-help.mp4']);
const pm=load({id:'3',role:'page_manager',roles:['page_manager']});assert(pm.includes('10-content.mp4')&&!pm.includes('01-booking-arrival.mp4'));
const gm=load({id:'4',role:'general_manager',roles:['general_manager']});assert.equal(gm.length,10);
for(const f of gm)assert(fs.existsSync('assets/videos/'+f),f);
console.log('PASS training videos: reception 8, nursing 5, content incl. content video, managers all 10, all files present.');
