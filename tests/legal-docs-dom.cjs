const {JSDOM,VirtualConsole}=require('jsdom'),fs=require('fs'),path=require('path'),assert=require('node:assert/strict');
const root=path.join(__dirname,'..'),read=n=>fs.readFileSync(path.join(root,'assets/js',n+'.js'),'utf8'),tick=()=>new Promise(r=>setTimeout(r,12));
(async()=>{
 // 1. Isolated legal site (legal-site/): standalone, local fonts, no scripts, no external requests, same-domain cross-links, honest planned-vs-deployed wording.
 const site=path.join(root,'legal-site'),B='https://backup-legal.swnwclinics.com';
 for(const f of ['index.html','privacy.html','terms.html']){
  const h=fs.readFileSync(path.join(site,f),'utf8');
  assert.ok(/<html lang="ar" dir="rtl">/.test(h),f+' is RTL Arabic');
  assert.ok(!/<script/i.test(h),f+' has no scripts');
  assert.ok(!/fonts\.googleapis|fonts\.gstatic|<link rel="stylesheet"[^>]+href="https?:\/\/|<script[^>]+src=|<img/i.test(h),f+' loads nothing external and has no logos/images');
  assert.ok(h.includes('href="'+B+'/privacy"')&&h.includes('href="'+B+'/terms"')&&h.includes('href="'+B+'/"'),f+' links home/privacy/terms on the same domain');
  assert.ok(h.includes('rel="canonical"'),f+' has canonical');
  assert.ok(/swnwclinics@gmail\.com/.test(h)&&/drive\.file/.test(h),f+' has contact and scope');
  assert.ok(/المقصود/.test(h)&&/لا يعني أنها فُعّلت أو اختُبرت/.test(h),f+' states intended vs deployed');
  assert.ok(!/(يُشفَّر|تُشفَّر|يتم|نراجعها|نختبر|نراقب)\s/.test(h.replace(/يُقصد أن تُشفَّر/g,'')),f+' avoids present-tense operating claims');
 }
 const priv=fs.readFileSync(path.join(site,'privacy.html'),'utf8');
 assert.ok(/Google One/.test(priv)&&/مزوّد تخزين خارجيًا/.test(priv)&&/Limited Use/.test(priv)&&/myaccount\.google\.com\/permissions/.test(priv),'privacy: account, external provider, limited use, revocation');
 assert.ok(!/SSH|جدار حماية|مراقبة|اختبار الاسترجاع بصورة دورية/.test(priv),'privacy: no unverified control claims');
 const css=fs.readFileSync(path.join(site,'assets/css/legal-pages.css'),'utf8');
 assert.ok(!/googleapis|gstatic/.test(css)&&/#0F369D/i.test(css)&&/Hiragino/.test(css));
 for(const f of ['BigVesta-Regular','BigVesta-Bold','Hiragino-W3','Hiragino-W6','Hiragino-W8'])assert.ok(fs.existsSync(path.join(site,'assets/fonts',f+'.woff2')),f);
 assert.ok(fs.existsSync(path.join(site,'_headers')));
 for(const f of ['backup-privacy.html','backup-terms.html','assets/css/legal-pages.css'])assert.ok(!fs.existsSync(path.join(root,f)),f+' is not published by the dashboard');
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
 assert.deepEqual(links.map(u=>u.replace('https://example.invalid/app/','')),['https://backup-legal.swnwclinics.com/privacy','https://backup-legal.swnwclinics.com/terms','privacy.html','terms.html','privacy-policy.html','data-deletion.html']);
 for(const u of links)if(!u.startsWith('https://backup-legal.'))assert.ok(fs.existsSync(path.join(root,u.replace('https://example.invalid/app/',''))),u+' exists');
 assert.ok(links.every(u=>u.startsWith('https://')),'absolute public links');
 assert.ok([...panel.querySelectorAll('.ld-actions a')].every(a=>a.target==='_blank'&&/noopener/.test(a.rel)));
 let copied=null;Object.defineProperty(w,'isSecureContext',{value:true});Object.defineProperty(w.navigator,'clipboard',{value:{writeText:async t=>{copied=t;}}});
 panel.querySelector('.ld-actions button').click();await tick();
 assert.equal(copied,'https://backup-legal.swnwclinics.com/privacy');assert.ok(/تم نسخ رابط/.test(panel.querySelector('.ld-status').textContent));
 assert.equal(calls.filter(c=>/^(update|add|remove|save|delete|upsert|insert|set)/i.test(c)).length,0,'hub performs no writes');
 assert.deepEqual(errors,[]);
 // 3. Without the module the admin panel is unchanged (6 cards, no legal panel).
 const d2=new JSDOM('<main></main>',{url:'https://example.invalid/',runScripts:'outside-only'}),w2=d2.window;w2.HTMLElement.prototype.scrollIntoView=function(){};
 w2.SSMPDAuth=w.SSMPDAuth;w2.SSMPDRoles=w.SSMPDRoles;w2.confirm=()=>false;w2.alert=()=>{};w2.SSMPDToast=w.SSMPDToast;w2.SSMPDDb=new Proxy({listAdmins:async()=>admins,getAppSettings:async()=>null,listBrandLogos:async()=>[]},{get:(t,k)=>t[k]||(()=>Promise.resolve())});
 w2.eval(read('admin-workspace'));w2.eval(read('render-admin'));const h2=w2.document.querySelector('main');w2.SSMPDRenderAdmin.render(h2);await tick();
 assert.equal(w2.document.querySelectorAll('.aw-section-card').length,6);assert.equal(w2.document.querySelector('[data-admin-view=legal]'),null);
 console.log('legal-docs-dom OK');
})().catch(e=>{console.error(e);process.exit(1);});
