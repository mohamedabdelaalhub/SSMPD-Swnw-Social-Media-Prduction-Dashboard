import {JSDOM} from 'jsdom';
import vm from 'node:vm';import fs from 'node:fs';import assert from 'node:assert/strict';
const routeCode=fs.readFileSync(new URL('../patient-portal/routing.js',import.meta.url),'utf8');const appCode=fs.readFileSync(new URL('../patient-portal/app.js',import.meta.url),'utf8');
for(const [search,selector] of [['?view=login','#login-email'],['?view=activate','#activation-code'],['?view=reset','#forgot-email'],['?reset=1&view=reset','#new-password']]){
 const dom=new JSDOM('<main id="portal-root"></main>');let destination=null;
 const client={auth:{onAuthStateChange(){},getSession:async()=>({data:{session:null}}),signInWithPassword:async()=>({data:{}})},functions:{invoke:async()=>({data:{}})}};
 const window={SSMPD_CONFIG:{supabase:{url:'https://example.test',anonKey:'public-test'}},supabase:{createClient:()=>client}};
 const context={window,document:dom.window.document,location:{search,assign:url=>destination=url},URL,URLSearchParams,console};vm.createContext(context);vm.runInContext(routeCode,context);vm.runInContext(appCode,context);await new Promise(r=>setTimeout(r,0));
 assert.ok(context.document.querySelector(selector),search+' '+context.document.body.textContent);
 if(search==='?view=login'){
  context.location.search+='&returnUrl='+encodeURIComponent('https://swnwclinics.com/account');
  context.document.querySelector('#login-email').value='test@example.test';context.document.querySelector('#login-password').value='test-password';context.document.querySelector('#login-btn').click();await new Promise(r=>setTimeout(r,0));assert.equal(destination,'https://swnwclinics.com/account');
 }
 dom.window.close();
}
console.log('PASS actual portal screens and return after mocked successful login');
