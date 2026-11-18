// Portal activation requires accepting the current privacy policy & terms; version is the same in
// the page, the portal and the server; the server rejects activation without it (before using a code).
const fs=require('fs'),assert=require('node:assert/strict'),vm=require('vm'),{stripTypeScriptTypes}=require('node:module');
const page=fs.readFileSync('patient-portal/privacy.html','utf8'),app=fs.readFileSync('patient-portal/app.js','utf8'),
  fnSrc=fs.readFileSync('supabase/functions/patient-portal-self-service/index.ts','utf8');
const v1=/id="terms-version">([^<]+)</.exec(page)[1],v2=/PORTAL_TERMS_VERSION="([^"]+)"/.exec(app)[1],v3=/const PORTAL_TERMS_VERSION = "([^"]+)"/.exec(fnSrc)[1];
assert.equal(v1,v2);assert.equal(v2,v3);
assert.match(app,/id="accept-terms" type="checkbox"/);
assert.match(app,/terms_version:PORTAL_TERMS_VERSION/);
assert.match(app,/if\(!document\.getElementById\("accept-terms"\)\.checked\)/);
for(const h of ['123','151 لسنة 2020','مش للطوارئ','24 ساعة'])assert.ok(page.includes(h),'page mentions '+h);
(async()=>{
  const src=stripTypeScriptTypes(fnSrc.replace(/^import .*;\n/gm,''));let handler,touched=[];
  const q=t=>{touched.push(t);const self={select(){return self},eq(){return self},is(){return self},gt(){return self},order(){return self},limit(){return self},update(){return self},insert(){return self},maybeSingle(){return Promise.resolve({data:null,error:null})},then(r){return Promise.resolve({data:[],error:null}).then(r)}};return self;};
  vm.runInNewContext(src,{Request,Response,console,Date,Intl,Set,Map,Array,JSON,Number,String,Math,URL,URLSearchParams,crypto,TextEncoder,fetch:async()=>new Response('{}'),
    Deno:{env:{get:()=>'x'},serve:f=>handler=f},createClient:()=>({from:q,auth:{getUser:async()=>({data:{user:null}}),admin:{}}})});
  const r=await handler(new Request('https://f.test',{method:'POST',body:JSON.stringify({op:'activate',email:'a@b.co',code:'12345678',new_password:'longpassword1'})}));
  assert.equal(r.status,400);assert.equal((await r.json()).error,'TERMS_NOT_ACCEPTED');
  assert.ok(!touched.includes('patient_activation_codes'),'no activation code consumed or counted without consent');
  console.log('portal terms consent: OK');
})().catch(e=>{console.error(e);process.exit(1);});
