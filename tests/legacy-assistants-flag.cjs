// Owner paused Instinct + the old employee assistant (2026-11-28) via SSMPD_CONFIG.flags.legacyAssistantsOff; code stays, flag=false brings both back.
const {JSDOM}=require(require.resolve('jsdom',{paths:[process.env.SSMPD_TEST_MODULES||process.cwd()]})),fs=require('fs'),assert=require('node:assert/strict');
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
assert.match(fs.readFileSync('config.js','utf8'),/flags:\s*\{\s*legacyAssistantsOff:\s*true\s*\}/,'config sets the flag');
async function run(off){const d=new JSDOM('<body><div id="app-root"></div></body>',{url:'https://x.test/',runScripts:'outside-only',pretendToBeVisual:true}),w=d.window;
 w.SSMPD_CONFIG={flags:{legacyAssistantsOff:off}};w.SSMPDAuth={currentAdmin:{id:'a',role:'super_admin',roles:['super_admin'],active:true}};w.SSMPDDb={};
 w.eval(fs.readFileSync('assets/js/roles.js','utf8'));w.eval(fs.readFileSync('assets/js/employee-assistant.js','utf8'));await sleep(1000);
 return{instinct:w.SSMPDRoles.canSeeTab(w.SSMPDAuth.currentAdmin,'instinct'),launch:!!w.document.querySelector('.ssmpd-ea-launch')};}
(async()=>{const a=await run(true),b=await run(false);assert.equal(a.instinct,false);assert.equal(a.launch,false);assert.equal(b.instinct,true);assert.equal(b.launch,true,'flag=false restores the launcher');console.log('PASS legacy assistants flag');process.exit(0);})().catch(e=>{console.error(e);process.exit(1);});
