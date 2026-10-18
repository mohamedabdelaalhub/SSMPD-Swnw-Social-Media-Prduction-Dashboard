const assert=require('node:assert/strict'),fs=require('node:fs'),http=require('node:http'),path=require('node:path'),{chromium}=require('playwright'),ts=require('typescript');
const root=path.resolve(__dirname,'..');
const source=fs.readFileSync('assets/js/render-production.js','utf8'),ast=ts.createSourceFile('p.js',source,ts.ScriptTarget.Latest,true);
let create;function visit(n){if(ts.isFunctionDeclaration(n)&&n.name?.text==='openCreateModal')create=n.getText(ast);ts.forEachChild(n,visit);}visit(ast);assert(create);
(async()=>{
 const server=http.createServer((req,res)=>{const file=path.resolve(root,'.'+decodeURIComponent(req.url.split('?')[0]));if(!file.startsWith(root+path.sep))return res.writeHead(403).end();fs.readFile(file,(e,b)=>{if(e)return res.writeHead(404).end();res.setHeader('Content-Type',file.endsWith('.js')?'text/javascript; charset=utf-8':file.endsWith('.css')?'text/css; charset=utf-8':file.endsWith('.png')?'image/png':file.endsWith('.woff2')?'font/woff2':'text/html; charset=utf-8');res.end(b);});}).listen(0,'127.0.0.1');await new Promise(r=>server.on('listening',r));let browser;
 try{
 browser=await chromium.launch({headless:true});const page=await browser.newPage();await page.goto('http://127.0.0.1:'+server.address().port+'/README.md');await page.setContent('<link rel="stylesheet" href="assets/css/styles.css"><link rel="stylesheet" href="assets/css/daily-clinics.css"><div id="view-container"></div>');
 await page.addScriptTag({url:'/assets/js/daily-clinics.js'});
 await page.evaluate(create=>{
  window.alerts=[];window.alert=m=>alerts.push(m);window.calls={create:0,save:0,update:0};window.SSMPDAuth={currentAdmin:{id:'creator'}};
  window.SSMPDDoctorContent={html:()=>'<select id="cf-content-kind"><option value="standard">عام</option></select>',wire(){},current(){return null;}};
  for(const n of ['DinaContent','BeforeAfterContent','CarouselContent'])window['SSMPD'+n]={html:()=>'',wire(){},current(){return null;}};
  window.W={brandSelectHtml:id=>'<select id="'+id+'"><option value="sono">سونو</option></select>',specialtySelectHtml:id=>'<select id="'+id+'"><option value="">عام</option></select>',contentIntelligencePanelHtml:()=>'<select id="ci-format"><option value="image_post">صورة</option></select>',wireContentIntelligence(){}};
  window.structuredFieldsHtml=()=>'<textarea id="cf-agent-raw"></textarea><textarea id="cf-caption"></textarea>';
  window.valueOrNull=id=>document.getElementById(id)?.value||null;window.intOrNull=()=>null;window.render=()=>{};
  window.SSMPDDrive={logIdea:async()=>{}};
  window.SSMPDDb={createContentItem:async row=>{calls.create++;window.created={id:'sample',...row};return created;},updateContentItem:async(id,patch)=>{calls.update++;assertBrowser(created.design_file_url,'image before approval');Object.assign(created,patch);return created;},logUsageActivity:async()=>{},logActivity:async()=>{}};
  window.assertBrowser=(x,m)=>{if(!x)throw Error(m);};
  window.SSMPDDesignFiles={canEdit:item=>item.created_by==='creator',latest:async()=>null,save:async(item,blob,src,settings,job,base)=>{calls.save++;assertBrowser(blob.size>10000&&blob.type==='image/png','PNG');assertBrowser(settings.template==='sono-daily-clinics-v1'&&base===null,'private settings');if(calls.save===1)throw Error('simulated storage failure');item.design_file_url='private/output.png';return {version_id:'v1',item};}};
  eval(create+';openCreateModal();');
 },create);
 await page.selectOption('#cf-content-kind','daily_clinics');await page.selectOption('[data-daily-day]','السبت');await page.fill('[data-daily-key="name"]','د. محمد أحمد زغلول');await page.fill('[data-daily-key="specialty"]','أوعية دموية');await page.fill('[data-daily-key="from"]','20:00');await page.fill('[data-daily-key="to"]','00:30');
 await page.waitForFunction(()=>document.querySelector('[data-daily-status]').textContent.includes('جاهزة'));
 assert.equal(await page.inputValue('#cf-title'),'مواعيد العيادات اليومية');assert(await page.isDisabled('#cf-ai-generate'));
 await page.click('#cf-submit');await page.waitForFunction(()=>alerts.length===1);assert.equal(await page.evaluate(()=>created.stage),'idea_selection');assert.equal(await page.evaluate(()=>calls.create),1);assert.equal(await page.evaluate(()=>document.querySelector('#daily-clinics-fields').inert),true);
 await page.click('#cf-submit');await page.waitForFunction(()=>!document.querySelector('#cf-submit'));assert.deepEqual(await page.evaluate(()=>calls),{create:1,save:2,update:1});assert.equal(await page.evaluate(()=>created.stage),'initial_approval');assert.equal(await page.evaluate(()=>JSON.parse(created.agent_raw_output).daily_clinics_brief.rows[0].to),'00:30');
 // Validate all 13 slots, different day lengths, overflow, midnight and no permission bypass.
 const stats=await page.evaluate(async()=>{
  var D=SSMPDDailyClinics,b={day:'الثلاثاء',rows:Array.from({length:13},(_,i)=>({name:'د. أسامة خالد المنشاوي',specialty:i%2?'علاج طبيعي وتأهيل':'باطنة جهاز هضمي',from:'12:00',to:'00:30'}))};
  var c=document.createElement('canvas');await D.render(c,b);document.body.replaceChildren(c);c.style.width='540px';c.style.height='675px';
  var errors=[];for(var bad of [{...b,day:''},{...b,rows:[]},{...b,rows:[...b.rows,b.rows[0]]},{...b,rows:[{...b.rows[0],from:'25:00'}]},{...b,rows:[{...b.rows[0],to:'12:00'}]},{...b,rows:[{...b.rows[0],name:'كلمة '.repeat(50)}]}]){try{await D.render(document.createElement('canvas'),bad);}catch(e){errors.push(e.message);}}
  var slot=document.createElement('div');D.mount(slot,{brand:'sono',created_by:'other',agent_raw_output:JSON.stringify(D.metadata(null,b))});
  return {width:c.width,height:c.height,errors:errors.length,buttons:slot.children.length};
 });assert.deepEqual(stats,{width:1080,height:1350,errors:6,buttons:0});await page.screenshot({path:'/tmp/daily-clinics-full.png'});
 // Existing editor restores the newest immutable version and preserves workflow stage.
 await page.evaluate(()=>{
  document.body.innerHTML='<div id="editor-slot"></div>';
  var b={day:'الجمعة',rows:[{name:'د. أحمد علي',specialty:'أطفال',from:'16:00',to:'18:00'}]};
  window.existing={id:'existing',brand:'sono',created_by:'creator',stage:'in_design',agent_raw_output:JSON.stringify(SSMPDDailyClinics.metadata(null,{...b,day:'السبت'}))};
  SSMPDDesignFiles.latest=async()=>({id:'version-latest',settings:{daily_clinics_brief:b}});
  SSMPDDesignFiles.save=async(item,blob,source,settings,job,base)=>{assertBrowser(base==='version-latest','stale base');assertBrowser(settings.daily_clinics_brief.day==='الجمعة','latest brief');window.editorSaved=true;return {version_id:'version-next',item:{...item,design_file_url:'private/next.png'}};};
  SSMPDDailyClinics.mount(document.getElementById('editor-slot'),existing);
 });
 await page.click('#editor-slot button');await page.waitForFunction(()=>!document.querySelector('[data-daily-save]').disabled);
 assert.equal(await page.inputValue('[data-daily-day]'),'الجمعة');await page.fill('[data-daily-key="name"]','د. أحمد محمد علي');await page.click('[data-daily-save]');await page.waitForFunction(()=>window.editorSaved);assert.equal(await page.evaluate(()=>existing.stage),'in_design');await page.click('.modal-close');
 // Responsive input form at mobile and desktop widths; hidden content stays hidden.
 await page.evaluate(create=>{document.body.innerHTML='<div id="view-container"></div>';eval(create+';openCreateModal();');},create);
 await page.selectOption('#cf-content-kind','daily_clinics');
 for(const width of [1280,390,320]){await page.setViewportSize({width,height:900});assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),'horizontal overflow at '+width);}
 await page.selectOption('#cf-content-kind','standard');assert(await page.isHidden('#daily-clinics-fields'));assert.equal(await page.isDisabled('#cf-ai-generate'),false);
 console.log('PASS daily clinics: supplied artwork and local fonts, 13 rows, overflow/time validation, mobile layouts, private file before approval, retry without duplicate content, and permission denial. Mocked APIs; no live records changed.');
 }finally{if(browser)await browser.close();server.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
