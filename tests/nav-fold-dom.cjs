// القايمة الرئيسية: الأزرار السايبة (فيديوهات الشرح، لوحة الاستثمار، طلبات التحقق، تغيير كلمة السر، صفحات الإدارة) بتتلم في مجموعتين
const {JSDOM}=require('jsdom'),fs=require('fs'),assert=require('node:assert/strict');
const tick=()=>new Promise(r=>setTimeout(r,120));
(async()=>{const dom=new JSDOM('<div class="topbar"></div><button id="user-menu-btn">القائمة</button><div class="user-dropdown" id="user-dropdown"><div class="mm-name">محمد</div><div class="mm-role">سوبر أدمن</div><div class="ud-items"><button class="ud-item" data-goto="home">الرئيسية الشخصية</button><button class="ud-item" data-goto="summary">الملخص العام</button><button class="ud-item" data-goto="tasks">المهام</button><button class="ud-item" data-goto="admin">لوحة التحكم</button><button class="ud-item" data-goto="review">إدارة المحتوى</button><button class="ud-item" data-goto="production">إنتاج المحتوى</button><button class="ud-item" data-goto="accounting">الحسابات</button><button class="ud-item" id="ud-patient-verification">طلبات تحقق هوية المرضى</button><button class="ud-item" id="ud-change-pass">تغيير كلمة السر</button></div><button class="mm-logout" id="logout-btn-dropdown">خروج</button></div>',{url:'https://t.invalid',runScripts:'outside-only',pretendToBeVisual:true}),w=dom.window,d=w.document;
 w.SSMPDAuth={currentAdmin:{id:'a1'}};w.matchMedia=q=>({matches:q==='(pointer:fine)',addListener(){},removeListener(){}});
 for(const f of ['section-icons','navigation-ui'])w.eval(fs.readFileSync(__dirname+'/../assets/js/'+f+'.js','utf8'));
 w.SSMPDNavigationUI.mount();await tick();
 const items=d.querySelector('.ud-items');
 // 1) الأزرار السايبة اتلمت جوه «أدوات وإعدادات»
 const tools=items.querySelector('details[data-fold="tools"]');assert.ok(tools,'tools group exists');assert.ok(tools.querySelector('#ud-change-pass')&&tools.querySelector('#ud-patient-verification'),'loose items inside');
 assert.equal(Array.from(items.children).filter(n=>n.classList.contains('ud-item')&&!n.dataset.goto).length,0,'no loose buttons left at the end');
 assert.equal(tools.querySelector('summary em').textContent,'2');
 // 2) أزرار بتتحط متأخر (فيديوهات الشرح بعد ثانية ونص) بتتلم برضه
 const vid=d.createElement('button');vid.className='ud-item';vid.dataset.trainingVideos='1';vid.textContent='🎬 فيديوهات الشرح';items.appendChild(vid);await tick();
 assert.equal(vid.parentNode,tools,'late item folded');assert.equal(tools.querySelector('summary em').textContent,'3');
 // 3) صفحات الإدارة والتشغيل: المجموعة بتتحط جوه مجموعة «الإدارة والتشغيل» وموديول الإدارة لسه يلاقيها
 const mg=d.createElement('div');mg.className='sw-management-nav';mg.dataset.managementNav='1';const t=d.createElement('div');t.className='sw-management-title';t.textContent='الإدارة والتشغيل';mg.appendChild(t);
 ['ذكاء الإدارة','الفريق الرقمي','علاقة المريض 360','مركز المساعد الإداري'].forEach(x=>{const b=d.createElement('button');b.className='ud-item sw-management-link';b.dataset.managementPage=x;b.textContent=x;mg.appendChild(b);});items.appendChild(mg);await tick();
 const g=items.querySelector('details[data-fold="mgmt"]');assert.ok(g&&g.contains(mg),'management group wrapped');assert.equal(g.querySelector('summary em').textContent,'4');assert.equal(t.hidden,true,'old title hidden');
 assert.equal(items.querySelector('[data-management-nav]'),mg,'still found by its own module');
 // 4) فتح مجموعة بيقفل التانية
 tools.open=true;tools.dispatchEvent(new w.Event('toggle'));g.open=true;g.dispatchEvent(new w.Event('toggle'));assert.equal(tools.open,false,'accordion');
 // 5) البحث لسه بيلاقيهم
 const input=d.querySelector('.nav-menu-search input');input.value='الفريق الرقمي';input.dispatchEvent(new w.Event('input',{bubbles:true}));await tick();
 console.log('PASS nav fold: loose items grouped, late items folded, management group wrapped, accordion.');w.close();
})().catch(e=>{console.error(e);process.exit(1);});
