// Synthetic task data only. Covers the reported mobile layout and recurrence failure.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {chromium}=require('playwright');
const root=path.resolve(__dirname,'..');
const report=['::report تقرير الجمهور التجريبي | عينة اختبار فقط','## قرارات مطلوبة منك','1. اعتماد الجدول الجديد || ملاحظة طويلة لاختبار عرض النص كاملًا','2. تحديث البيانات || ملاحظة أخرى','## الأرقام',...['زيارات العيادات','أسنان الأطفال','عظام ومفاصل','أسئلة واحتياجات','أسئلة عن المواعيد','إجمالي الإحالات'].map((s,i)=>'[kpi] '+s+' | '+(2821-i*301)+' | ↑ تحسن'), '## الخلاصة','- نص عربي طويل '.repeat(12),'[doc] افتح التقرير الكامل | https://docs.google.com/document/d/test','[link] https://example.invalid/'+ 'long'.repeat(60)].join('\n');
let html=fs.readFileSync(path.join(__dirname,'tasks-pro.cjs'),'utf8').match(/const page_html=`([\s\S]*?)`;/)[1];
html=html.replace('<meta charset="utf-8">','<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">').replace('</head>','<link rel="stylesheet" href="/assets/css/dashboard-theme.css"></head>');
html=html.replace('</script><script src=',`mock.updates.t1=[{id:'report',author_name:'Claude Creative',author_id:'a0fbdfee-d147-4282-b988-186a9ae3e88c',addressed_to:'a1',created_at:new Date().toISOString(),body:${JSON.stringify(report)}}];
mock.tasks[0].recurrence_active=true;mock.tasks[0].recurrence_id='series';mock.tasks[0].recurrence_ends_at='2000-01-01';
window.failDate=false;
['taskCreate','taskCreateRecurring','taskUpdateDetails'].forEach(function(name){SSMPDDb[name]=function(){calls.push([name].concat(Array.from(arguments)));return failDate?Promise.reject(Error('Recurrence end date must be in the future')):Promise.resolve();};});
</script><script src=`);
(async()=>{
 const browser=await chromium.launch({executablePath:process.env.PW_CHROMIUM||undefined,args:['--no-sandbox']});
 try{
  for(const width of [320,390,1280])for(const direction of ['rtl','ltr']){
   const page=await browser.newPage({viewport:{width,height:900},timezoneId:'Asia/Dubai'}),errors=[];
   page.on('pageerror',e=>errors.push(e.message));page.on('dialog',d=>{errors.push(d.message());d.dismiss();});
   await page.route('https://task.test/**',async route=>{const u=new URL(route.request().url());if(u.pathname==='/')return route.fulfill({contentType:'text/html',body:html});const file=path.join(root,u.pathname);return route.fulfill({path:file});});
   await page.goto('https://task.test/');await page.locator('.tv-proj').waitFor();
   await page.evaluate(dir=>document.documentElement.dir=dir,direction);
   await page.locator('.tv-proj').click();
   await page.locator('[data-task-id="t1"] .tv-row-main').click();
   await page.locator('.tv-detail [data-action="history"]').click();
   await page.locator('.tsk-report').waitFor();
   const sizes=await page.evaluate(()=>{const a=document.querySelector('.tsk-history>article'),r=a.querySelector('.tsk-report'),m=a.querySelector('.tsk-update-meta');return {article:a.clientWidth,report:r.getBoundingClientRect().width,top:r.getBoundingClientRect().top,metaBottom:m.getBoundingClientRect().bottom,overflow:r.scrollWidth-r.clientWidth,pageOverflow:document.documentElement.scrollWidth-innerWidth,columns:getComputedStyle(a.querySelector('.rep-kpis')).gridTemplateColumns.split(' ').length};});
   assert(sizes.report>=sizes.article-2,'report uses full comment width');assert(sizes.top>=sizes.metaBottom,'report below metadata');assert(sizes.overflow<=1,'no report overflow');assert(sizes.pageOverflow<=1,'no page overflow');assert.equal(sizes.columns,width<1000?2:3);
   assert.equal(await page.locator('.rep-kpi').count(),6);assert.equal(await page.locator('.rep-kpi b').first().textContent(),'2821');
   assert.equal(await page.locator('.tsk-update-meta small').evaluate(n=>getComputedStyle(n).float),'none');
   if(process.env.SWNW_QA_DIR&&direction==='rtl'){
    await page.locator('.tsk-report').scrollIntoViewIfNeeded();await page.locator('.tsk-modal').screenshot({path:path.join(process.env.SWNW_QA_DIR,'report-'+width+'.png')});
   }
   await page.keyboard.press('Escape');
   // Edit an expired series: show the error without changing dates or sending a request.
   await page.locator('[data-task-id="t1"] .tv-row-main').click();
   await page.locator('.tv-detail [data-action="edit-task"]').click();
   const end=page.locator('[name="repeat_until"]');assert.equal(await end.inputValue(),'2000-01-01');assert(await page.locator('#tsk-repeat-error').isVisible());
   await page.locator('form[data-form="task-edit"] .btn-primary').click();assert.equal(await page.evaluate(()=>calls.filter(c=>c[0]==='taskUpdateDetails').length),0);
   // Disabling repetition ignores its stale optional date and preserves the ordinary edit.
   await page.locator('[name="repeat_active"]').uncheck();assert(await end.isDisabled());
   await page.locator('form[data-form="task-edit"] .btn-primary').click();await page.locator('form[data-form="task-edit"]').waitFor({state:'detached'});
   assert.equal(await page.evaluate(()=>calls.find(c=>c[0]==='taskUpdateDetails')[8]),false);
   await page.locator('[data-action="new-task"]').first().click();
   await page.locator('[name="title"]').fill('مهمة اختبار');await page.locator('[name="description"]').fill('وصف المهمة');await page.locator('[name="expected_output"]').fill('مستند');await page.locator('[name="due_at"]').fill('2099-12-31');
   await page.locator('[name="repeat_active"]').check();await page.locator('[name="repeat_until"]').fill('2000-01-01');
   await page.locator('form[data-form="task"] .btn-primary').click();assert.equal(await page.evaluate(()=>calls.filter(c=>c[0]==='taskCreateRecurring').length),0);assert.equal(await page.locator('[name="title"]').inputValue(),'مهمة اختبار');
   // Same-day date is valid (the server rejects only dates before current_date).
   const today=await page.evaluate(()=>new Date().toISOString().slice(0,10));await page.locator('[name="repeat_until"]').fill(today);assert(await page.locator('[name="repeat_until"]').evaluate(n=>n.checkValidity()));
   // Server clock/race rejection also stays in Arabic, with entered content and save button intact.
   await page.evaluate(()=>failDate=true);await page.locator('form[data-form="task"] .btn-primary').click();await page.locator('#tsk-repeat-error').waitFor({state:'visible'});assert(await page.locator('form[data-form="task"] .btn-primary').isEnabled());assert.equal(await page.locator('[name="title"]').inputValue(),'مهمة اختبار');
   await page.evaluate(()=>failDate=false);await page.locator('[name="repeat_until"]').fill('');await page.locator('form[data-form="task"] .btn-primary').click();await page.locator('form[data-form="task"]').waitFor({state:'detached'});
   assert.equal(await page.evaluate(()=>calls.filter(c=>c[0]==='taskCreateRecurring').at(-1).at(-1)),null,'blank date stays unbounded');
   assert.deepEqual(errors,[]);await page.close();
  }
  console.log('PASS task report/date: 320/390/1280 RTL+LTR, full width, metadata, KPI values, links, past/today/blank dates, disabled recurrence, server rejection recovery. Mocked database only.');
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exit(1);});
