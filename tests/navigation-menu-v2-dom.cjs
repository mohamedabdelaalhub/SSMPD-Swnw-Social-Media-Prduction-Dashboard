// Main menu v2: icons from section-icons.js, head with name/role, real attention badges, «الأكثر استخدامًا», touch = no autofocus.
const {JSDOM}=require('jsdom'),fs=require('fs'),assert=require('node:assert/strict');
function build(coarse){const dom=new JSDOM('<div class="topbar"></div><button id="user-menu-btn">القائمة</button><div class="user-dropdown" id="user-dropdown"><div class="mm-name">محمد</div><div class="mm-role">سوبر أدمن</div><div class="ud-items"><button class="ud-item" data-goto="home">الرئيسية الشخصية</button><button class="ud-item" data-goto="summary">الملخص العام</button><button class="ud-item" data-goto="tasks">المهام</button><button class="ud-item" data-goto="admin">لوحة التحكم</button><button class="ud-item" data-goto="review">إدارة المحتوى</button><button class="ud-item" data-goto="production">إنتاج المحتوى</button><button class="ud-item" data-goto="accounting">الحسابات</button><button class="ud-item" id="ud-change-pass">تغيير كلمة السر</button></div><button class="mm-logout">خروج</button></div>',{url:'https://test.invalid',runScripts:'outside-only'}),w=dom.window;
 w.SSMPDAuth={currentAdmin:{id:'a1'}};w.matchMedia=q=>({matches:q==='(pointer:fine)'?!coarse:false});
 for(const f of ['section-icons','navigation-ui'])w.eval(fs.readFileSync(__dirname+'/../assets/js/'+f+'.js','utf8'));return w;}
(async()=>{
 let w=build(false),d=w.document;
 w.localStorage.setItem('ssmpd_nav_recent_a1',JSON.stringify(['tasks','gone','accounting','review']));
 w.SSMPDNavigationUI.mount();const menu=d.getElementById('user-dropdown');
 assert(menu.classList.contains('nav2'));
 assert.equal(d.querySelector('.nav-menu-head strong').textContent,'محمد');assert.equal(d.querySelector('.nav-menu-head small').textContent,'سوبر أدمن');
 assert.equal(d.querySelectorAll('.ud-item[data-goto] .nav-ic svg').length,7,'every section has an icon');
 assert(d.querySelector('#ud-change-pass .nav-ic'),'account items get an icon too');
 assert.equal(d.querySelector('.ud-item[data-goto="tasks"] .nav-ic').style.getPropertyValue('--nav-c'),'#6600FF','icon tinted by its group');
 d.getElementById('user-menu-btn').click();
 assert(d.body.classList.contains('nav-menu-open'),'floating launchers can step aside');
 assert.equal(d.activeElement,d.querySelector('.nav-menu-search input'),'desktop keeps search focus');
 assert.deepEqual([...d.querySelectorAll('[data-recent]')].map(b=>b.dataset.recent),['tasks','accounting','review'],'recent = authorized sections only, max 4');
 assert.equal(d.querySelectorAll('[data-goto]').length,7,'recent buttons add no new links');
 w.SSMPDNavigationUI.setAttention({tasks:'3 متأخرة',review:'2 اعتماد',nope:'x'});
 assert.equal(d.querySelector('.ud-item[data-goto="tasks"] .nav-badge').textContent,'3 متأخرة');
 assert.equal(d.querySelectorAll('.nav-badge').length,2,'only existing sections get a badge');
 const team=[...d.querySelectorAll('.ud-group')].find(g=>g.querySelector('[data-goto="tasks"]'));assert.equal(team.querySelector('.nav-att').textContent,'1 محتاج متابعة');
 w.SSMPDNavigationUI.setAttention({});assert.equal(d.querySelectorAll('.nav-badge').length,0,'badges clear with the data');
 const input=d.querySelector('.nav-menu-search input');input.value='حسا';input.dispatchEvent(new w.Event('input'));assert(d.querySelector('.nav-recent').hidden,'recent hides while searching');
 input.value='';input.dispatchEvent(new w.Event('input'));
 d.querySelector('[data-recent="accounting"]').click();assert(!menu.classList.contains('open'),'recent opens its section and closes the menu');
 assert(!d.body.classList.contains('nav-menu-open'));
 w.SSMPDNavigationUI.setCurrent('admin');assert.equal(JSON.parse(w.localStorage.getItem('ssmpd_nav_recent_a1'))[0],'admin','visited sections are remembered');
 w.close();
 w=build(true);d=w.document;w.SSMPDNavigationUI.mount();d.getElementById('user-menu-btn').click();
 assert.notEqual(d.activeElement,d.querySelector('.nav-menu-search input'),'touch: no keyboard pops up on open');
 assert.equal(d.activeElement,d.querySelector('.nav-menu-head button'),'touch: focus goes to close');
 w.close();console.log('PASS main menu v2: group icons, compact head, real attention badges, recent sections, launchers hidden, no autofocus on touch');
})().catch(e=>{console.error(e);process.exit(1);});
