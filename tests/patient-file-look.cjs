// Patient file new look (owner «طبقه» 2026-11-22, mockup docs/ui-references/mockups/patient-file.html) — assets/js/patient-file-look.js.
// White header with code / age / phone / allergy chips, one «زيارة جديدة» (drives the existing add-visit button), «⋯» menu,
// tab counts, summary tiles with Arabic month names, personal data grid with «ناقص · كمّله», health history rows (allergy flagged),
// visits as cards (last 5 + «عرض الكل», the original action buttons moved in), filter chips + one upload / create picker,
// English digits, no AM/PM, no sideways scroll at 1280/390/360.
const fs=require('node:fs'),assert=require('node:assert/strict');const {chromium}=require('playwright');
let fixture=fs.readFileSync('tests/patient-profile-ui.cjs','utf8');fixture=fixture.slice(fixture.indexOf('const patient='),fixture.indexOf("for(const f of [")).replace(/\bw\./g,'window.');
fixture=fixture.replace("const patient={id:'patient-1',full_name:'مريض <تجريبي>',age:6}","const patient={id:'patient-1',full_name:'يوسف <تجريبي>',age:6,gender:'male',phone:'01000000000',patient_code:'P-2026-000123',created_at:'2026-06-12T10:00:00',created_by_name:'منى',last_visit_date:'2026-10-17'}")
 .replace("const visit={id:'v1',visit_date:date,complaint:'متابعة',session_number:1};","const visit={id:'v1',visit_date:'2026-10-17T12:00:00',complaint:'متابعة <b>x</b>',doctor_name:'د. سارة',visit_number:'V-104',medications:'مسكن',follow_up_date:'2026-11-29',follow_up_time:'17:30:00',follow_up_status:'pending'};const visits=[visit].concat([2,3,4,5,6].map(i=>({id:'v'+i,visit_date:'2026-0'+(9-i)+'-1'+i+'T10:00:00',complaint:'زيارة '+i,follow_up_date:i===2?'2026-07-20':null,follow_up_status:i===2?'no_show':null})));")
 .replace("listPatientVisits:async()=>[visit]","listPatientVisits:async()=>visits")
 .replace("getPatientMedicalProfile:async()=>({chronic_conditions:[],surgeries:[],family_history:[]})","getPatientMedicalProfile:async()=>({chronic_conditions:[{name:'drug_allergies',has:true,medication:'بنسلين'},{name:'diabetes',has:true}],surgeries:[],family_history:[{has:true,disease:'سكر'}]})");
(async()=>{const browser=await chromium.launch({args:['--no-sandbox']});try{for(const width of [1280,390,360]){
 const page=await browser.newPage({viewport:{width,height:900}}),errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.setContent('<!doctype html><html lang="ar" dir="rtl"><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><body><main id="view-container" style="padding:16px"></main></body></html>');
 for(const n of ['styles','dashboard-theme','child-assessment-forms','patient-profile-ui','patient-file-look'])await page.addStyleTag({content:fs.readFileSync('assets/css/'+n+'.css','utf8')});
 await page.addScriptTag({content:fixture});await page.addScriptTag({content:"history.replaceState=function(){};history.pushState=function(){};window.clicks=[];document.addEventListener('click',e=>{const b=e.target.closest('[data-add-visit],[data-edit-personal],[data-upload-cat],[data-new-prescription],[data-new-lab-request],[data-new-radiology-request]');if(b)clicks.push([...b.attributes].map(a=>a.name).find(n=>n.startsWith('data-')));},true);"});
 for(const n of ['nutrition-view','patient-file-look','patient-profile-ui','child-assessment-forms','render-patients'])await page.addScriptTag({content:fs.readFileSync('assets/js/'+n+'.js','utf8')});
 await page.evaluate(()=>{SSMPDRenderPatients.render(document.getElementById('view-container'));SSMPDRenderPatients.openPatientById(patient.id);});
 await page.waitForSelector('.pf-look .pf-head');
 // header
 assert.equal(await page.locator('.pf-head').evaluate(e=>getComputedStyle(e).backgroundColor),'rgb(255, 255, 255)','white header card');
 assert.equal((await page.locator('.pf-who h3').innerText()).trim(),'يوسف <تجريبي>','name escaped, no empty code brackets');
 const chips=await page.locator('.pf-chips').innerText();assert.match(chips,/رقم الملف P-2026-000123/);assert.match(chips,/6 سنين · ذكر/);assert.match(chips,/01000000000/);assert.match(chips,/حساسية: بنسلين/);
 assert.equal(await page.locator('.pf-head [data-pp-icon="print"]').count(),1,'print kept in header');
 await page.locator('[data-pf-new-visit]').click();assert.equal(await page.evaluate(()=>clicks.pop()),'data-add-visit','header button drives the existing add-visit');
 await page.keyboard.press('Escape');await page.evaluate(()=>document.querySelectorAll('.modal-backdrop').forEach(x=>x.remove()));
 await page.locator('.pf-more').click();assert(await page.locator('.pf-pop').isVisible());const items=await page.locator('.pf-pop-item').allInnerTexts();
 assert.deepEqual(items.map(s=>s.trim()),['تحديث الملف','نسخ رابط الملف','تعديل البيانات']);await page.keyboard.press('Escape');assert(await page.locator('.pf-pop').isHidden());
 // tabs + summary
 const tabs=await page.locator('.pp-tab').evaluateAll(b=>b.map(x=>x.getAttribute('aria-label')));assert.equal(tabs[1],'الزيارات والمتابعات (6)');
 const tiles=await page.locator('.pf-tile').allInnerTexts();assert.equal(tiles.length,4);assert.match(tiles[0],/17 أكتوبر/);assert.match(tiles[1],/29 نوفمبر/);assert.match(tiles[1],/5:30 م/);assert.match(tiles[2],/6 زيارات/);
 await page.locator('[data-pf-tile="popup"]').click();await page.waitForSelector('.pf-dialog[open]');assert.equal(await page.locator('.pf-dialog .pf-row').count(),6);await page.locator('[data-pf-goto]').click();
 assert.equal(await page.locator('.pp-page').getAttribute('data-pp-active'),'visits','popup → visits tab');
 await page.locator('[data-pp-tab="overview"]').click();
 const kv=await page.locator('.pf-kv').innerText();assert.match(kv.replace(/\s+/g," "),/الرقم الطبي ناقص · كمّله/);assert.match(kv,/12 يونيو 2026/);
 await page.locator('[data-pf-fill]').click();assert.equal(await page.evaluate(()=>clicks.pop()),'data-edit-personal','«كمّله» opens the existing edit form');
 await page.evaluate(()=>document.querySelectorAll('.modal-backdrop').forEach(x=>x.remove()));
 assert.equal(await page.locator('.pf-hrow.flag').innerText().then(t=>t.replace(/\s+/g,' ').trim()),'حساسية من الأدوية بنسلين');assert.match(await page.locator('.pf-hist').innerText(),/السكر/);
 // visits
 await page.locator('[data-pp-tab="visits"]').click();
 assert.equal(await page.locator('.pf-visit').count(),6);assert.equal(await page.locator('.pf-visit:visible').count(),5,'last 5 shown');
 assert.equal(await page.locator('.pf-visit [data-del-visit]').count(),6,'original action buttons moved into the cards');assert.equal(await page.locator('#pp-panel-visits table').count(),0);
 assert.match(await page.locator('.pf-visit').first().innerText(),/متابعة 29 نوفمبر|29 نوفمبر/);assert.match(await page.locator('.pf-visit').first().innerText(),/<b>x<\/b>/,'complaint escaped');
 assert.equal(await page.locator('.pf-st.miss').count(),1,'no-show follow-up flagged');
 await page.locator('.pf-showall').click();assert.equal(await page.locator('.pf-visit:visible').count(),6);
 await page.locator('.pf-visit [data-pf-expand]').first().click();assert(await page.locator('.pf-visit.open .pf-vmore').first().isVisible());
 // clinical: chips filter + upload/create pickers drive the existing buttons
 await page.locator('[data-pp-tab="clinical"]').click();
 const chipTexts=await page.locator('#pp-panel-clinical .pf-fchips button').allInnerTexts();assert.match(chipTexts[0],/الكل/);
 const visibleGroups=await page.locator('#pp-panel-clinical .pf-group:visible').count();const zero=await page.locator('#pp-panel-clinical .pf-fchips button.zero').count();assert(zero>=1,'an empty type is a dimmed chip');
 assert.equal(visibleGroups,await page.locator('#pp-panel-clinical .pf-group').count()-zero,'empty groups folded under «الكل»');
 await page.locator('#pp-panel-clinical .pf-fchips button.zero').first().click();assert.equal(await page.locator('#pp-panel-clinical .pf-group:visible').count(),1);
 await page.locator('[data-pf-upload="clinical"]').click();await page.waitForSelector('.pf-dialog[open] [data-pf-i]');await page.locator('.pf-dialog[open] [data-pf-i]').first().click();
 assert.equal(await page.evaluate(()=>clicks.pop()),'data-upload-cat','upload picker clicks the category\'s own upload button');
 await page.locator('[data-pf-create="clinical"]').click();await page.waitForSelector('.pf-dialog[open] [data-pf-i]');await page.locator('.pf-dialog[open] [data-pf-close]').click();
 // documents
 await page.locator('[data-pp-tab="documents"]').click();assert.equal(await page.locator('[data-pf-upload="documents"]').count(),1);
 const all=await page.locator('.pp-page').innerText();assert(!/[٠-٩]/.test(all),'English digits');assert(!/\b(AM|PM)\b/.test(all),'no AM/PM');assert(!/\d{1,2}\/\d{1,2}\/\d{4}/.test(all),'no numeric dates');
 assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),'no sideways scroll @'+width);
 for(const b of await page.locator('.pf-tile b,.pf-chip,.pf-st,.pp-tab').all())if(await b.isVisible())assert(await b.evaluate(x=>x.scrollWidth<=x.clientWidth+1),'no clipped label');
 assert.deepEqual(errors,[]);await page.close();}}finally{await browser.close();}
 console.log('PASS patient file new look 1280/390/360: header chips + allergy, new-visit/menu drive existing actions, tab counts, Arabic-month tiles + visits popup, personal grid with «كمّله», flagged allergy, visit cards (5 + all, actions moved, escaped), filter chips + upload/create pickers, English digits, no overflow.');
})().catch(e=>{console.error(e);process.exit(1);});
