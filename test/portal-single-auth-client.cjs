// Portal: all scripts share ONE Supabase auth client, and PASSWORD_RECOVERY is shown once and never
// after the new password is saved (live bug 2026-11-19: login bounced back to the reset screen).
const {JSDOM}=require('jsdom'),fs=require('fs'),path=require('path'),assert=require('node:assert/strict');
const dir=path.join(__dirname,'../patient-portal');
const html=fs.readFileSync(path.join(dir,'index.html'),'utf8');
const dom=new JSDOM(html.replace(/<script[^>]*src=[^>]*><\/script>/g,''),{url:'https://example.test/patient-portal/?reset=1',runScripts:'outside-only',pretendToBeVisual:true});
const w=dom.window;let created=0;const subs=[];let updated=0;
w.supabase={createClient(){created++;return {
  auth:{onAuthStateChange(cb){subs.push(cb);return {data:{subscription:{unsubscribe(){}}}};},
    getSession:async()=>({data:{session:null}}),updateUser:async()=>{updated++;return {data:{},error:null};},
    signInWithPassword:async()=>({data:{},error:null}),signOut:async()=>({})},
  functions:{invoke:async()=>({data:{},error:null})},rpc:async()=>({data:[],error:null}),from(){const q={select(){return q},eq(){return q},in(){return q},order(){return q},then(r){return Promise.resolve({data:[],error:null}).then(r)}};return q;}};}};
w.SSMPD_CONFIG={supabase:{url:'https://api.test',anonKey:'k'}};w.SSMPDTurnstile={token:async()=>undefined};
w.matchMedia=w.matchMedia||(()=>({matches:false,addListener(){},removeListener(){},addEventListener(){},removeEventListener(){}}));
const files=[...html.matchAll(/<script[^>]+src="([^"]+)"/g)].map(m=>m[1].split('?')[0]).filter(f=>!/^https?:/.test(f)&&!/config\.js$/.test(f));
for(const f of files){const p=path.join(dir,f);if(fs.existsSync(p)){try{w.eval(fs.readFileSync(p,'utf8'));}catch(e){/* optional page chrome may need browser APIs */}}}
const tick=()=>new Promise(r=>setTimeout(r,30));
(async()=>{
  await tick();
  assert.equal(created,1,'exactly one Supabase client for the whole portal (got '+created+')');
  const view=()=>w.document.getElementById('new-password-submit');
  assert.ok(view(),'reset link opens the new-password screen');
  subs.forEach(cb=>cb('PASSWORD_RECOVERY',{}));await tick();
  w.document.getElementById('new-password').value='NewPass123';w.document.getElementById('confirm-password').value='NewPass123';
  view().click();await tick();
  assert.equal(updated,1,'password saved');
  assert.ok(!view(),'login screen after saving');
  subs.forEach(cb=>cb('PASSWORD_RECOVERY',{}));await tick();
  assert.ok(!view(),'a late PASSWORD_RECOVERY does not reopen the reset screen');
  console.log('portal single auth client: OK');
})().catch(e=>{console.error(e);process.exit(1);});
