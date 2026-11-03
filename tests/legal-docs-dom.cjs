const {JSDOM,VirtualConsole}=require('jsdom'),fs=require('fs'),path=require('path'),assert=require('node:assert/strict');
const root=path.join(__dirname,'..'),read=n=>fs.readFileSync(path.join(root,'assets/js',n+'.js'),'utf8'),tick=()=>new Promise(r=>setTimeout(r,12));
(async()=>{
 // 1. Public backup pages: standalone, local fonts, no scripts, no external requests, cross-linked.
 for(const f of ['backup-privacy.html','backup-terms.html']){
  const h=fs.readFileSync(path.join(root,f),'utf8');
  assert.ok(/<html lang="ar" dir="rtl">/.test(h),f+' is RTL Arabic');
  assert.ok(!/<script/i.test(h),f+' has no scripts');
  assert.ok(!/fonts\.googleapis|fonts\.gstatic|https?:\/\/[^"' ]*\.(js|css|woff2?)/i.test(h),f+' loads nothing external');
  assert.ok(/swnwclinics@gmail\.com/.test(h)&&/drive\.file/.test(h)&&/myaccount\.google\.com\/permissions/.test(h),f+' has contact, scope and revocation');
  assert.ok(/backup-privacy\.html/.test(h)&&/backup-terms\.html/.test(h),f+' links both pages');
 }
 const css=fs.readFileSync(path.join(root,'assets/css/legal-pages.css'),'utf8');
 assert.ok(!/googleapis|gstatic/.test(css)&&/#0F369D/i.test(css)&&/Hiragino/.test(css));
 for(const f of ['BigVesta-Regular','BigVesta-Bold','Hiragino-W3','Hiragino-W6','Hiragino-W8'])assert.ok(fs.existsSync(path.join(root,'assets/fonts',f+'.woff2')),f);
 // 2. Hub inside the admin panel: read-only, every listed document exists, copy works, nothing is written.
 const errors=[],vc=new VirtualConsole();vc.on('jsdomError',e=>errors.push(e.message));
 const dom=new JSDOM('<main></main>',{url:'https://example.invalid/app/index.html',runScripts:'outside-only',virtualConsole:vc}),w=dom.window,d=w.document,host=d.querySelector('main');w.HTMLElement.prototype.scrollIntoView=function(){};
 const admins=[{id:'me',name:'م',email:'o@example.invalid',role:'super_admin',active:true,user_id:'u1'}],calls=[];
 w.SSMPDAuth={currentAdmin:{id:'me',role:'super_admin'}};w.SSMPDRoles={ALL:{super_admin:'سوبر أدمن'},label:r=>r};w.confirm=()=>false;w.alert=()=>{};w.SSMPDToast={show:()=>{}};
 w.SSMPDDb=new Proxy({listAdmins:async()=>admins,getAppSettings:async()=>null,listBrandLogos:async()=>[]},{get:(t,k)=>t[k]||((...a)=>{calls.push(String(k));return Promise.resolve();})});
 w.eval(read('legal-docs'));w.eval(read('admin-workspace'));w.eval(read('render-admin'));w.SSMPDRenderAdmin.render(host);await tick();
 const card=d.querySelector('[data-admin-view=legal]');assert.ok(card,'legal card exists on the admin home');assert.equal(card.textContent.includes('المستندات القانونية'),true);
 assert.equal(d.querySelectorAll('.aw-section-card').length,7,'6 existing cards + 1 legal');
 card.click();const panel=d.querySelector('[data-admin-panel=legal]');assert.equal(panel.hidden,false);
 assert.equal(panel.querySelectorAll('.ld-group').length,3);assert.equal(panel.querySelectorAll('.ld-row').length,6);
 const links=[...panel.querySelectorAll('.ld-actions a')].map(a=>a.getAttribute('href'));
 assert.deepEqual(links.map(u=>u.replace('https://example.invalid/app/','')),['backup-privacy.html','backup-terms.html','privacy.html','terms.html','privacy-policy.html','data-deletion.html']);
 for(const u of links)assert.ok(fs.existsSync(path.join(root,u.replace('https://example.invalid/app/',''))),u+' exists');
 assert.ok(links.every(u=>u.startsWith('https://')),'absolute public links');
 assert.ok([...panel.querySelectorAll('.ld-actions a')].every(a=>a.target==='_blank'&&/noopener/.test(a.rel)));
 let copied=null;Object.defineProperty(w,'isSecureContext',{value:true});Object.defineProperty(w.navigator,'clipboard',{value:{writeText:async t=>{copied=t;}}});
 panel.querySelector('.ld-actions button').click();await tick();
 assert.equal(copied,'https://example.invalid/app/backup-privacy.html');assert.ok(/تم نسخ رابط/.test(panel.querySelector('.ld-status').textContent));
 assert.equal(calls.filter(c=>/^(update|add|remove|save|delete|upsert|insert|set)/i.test(c)).length,0,'hub performs no writes');
 assert.deepEqual(errors,[]);
 // 3. Without the module the admin panel is unchanged (6 cards, no legal panel).
 const d2=new JSDOM('<main></main>',{url:'https://example.invalid/',runScripts:'outside-only'}),w2=d2.window;w2.HTMLElement.prototype.scrollIntoView=function(){};
 w2.SSMPDAuth=w.SSMPDAuth;w2.SSMPDRoles=w.SSMPDRoles;w2.confirm=()=>false;w2.alert=()=>{};w2.SSMPDToast=w.SSMPDToast;w2.SSMPDDb=new Proxy({listAdmins:async()=>admins,getAppSettings:async()=>null,listBrandLogos:async()=>[]},{get:(t,k)=>t[k]||(()=>Promise.resolve())});
 w2.eval(read('admin-workspace'));w2.eval(read('render-admin'));const h2=w2.document.querySelector('main');w2.SSMPDRenderAdmin.render(h2);await tick();
 assert.equal(w2.document.querySelectorAll('.aw-section-card').length,6);assert.equal(w2.document.querySelector('[data-admin-view=legal]'),null);
 console.log('legal-docs-dom OK');
})().catch(e=>{console.error(e);process.exit(1);});
