const fs=require('node:fs'),assert=require('node:assert/strict');const {chromium}=require('playwright');
const source=fs.readFileSync('tests/patient-profile-ui.cjs','utf8');const fixture=source.slice(source.indexOf('const patient='),source.indexOf("for(const f of [")).replace(/\bw\./g,'window.');
(async()=>{const browser=await chromium.launch({args:['--no-sandbox']});try{
 for(const width of [1280,390,360]){const page=await browser.newPage({viewport:{width,height:900}}),errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.setContent('<!doctype html><html lang="ar" dir="rtl"><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><body><main id="view-container" style="padding:16px"></main></body></html>');
 for(const name of ['styles','child-assessment-forms','patient-profile-ui'])await page.addStyleTag({content:fs.readFileSync('assets/css/'+name+'.css','utf8')});
 await page.addScriptTag({content:fixture});
 // A real same-origin route is unnecessary for this offline fixture; setContent starts on about:blank.
 await page.addScriptTag({content:"history.replaceState = function(){}; history.pushState=function(){};"});
 for(const name of ['nutrition-view','patient-profile-ui','child-assessment-forms','render-patients'])await page.addScriptTag({content:fs.readFileSync('assets/js/'+name+'.js','utf8')});
 await page.evaluate(()=>{SSMPDRenderPatients.render(document.getElementById('view-container'));SSMPDRenderPatients.openPatientById(patient.id)});
 await page.waitForSelector('.pp-page');assert.equal(await page.locator('.pp-tab').count(),5);assert.equal(await page.locator('.pp-panel:not([hidden])').count(),1);
 await page.locator('[data-edit-personal]').hover();await page.waitForFunction(()=>getComputedStyle(document.querySelector('[data-edit-personal]')).color==='rgb(15, 54, 157)');assert.equal(await page.locator('[data-edit-personal]').evaluate(el=>getComputedStyle(el).color),'rgb(15, 54, 157)');
 await page.locator('[data-pp-tab="visits"]').click();await page.locator('[data-del-visit]').hover();await page.waitForFunction(()=>getComputedStyle(document.querySelector('[data-del-visit]')).color==='rgb(208, 64, 42)');assert.equal(await page.locator('[data-del-visit]').evaluate(el=>getComputedStyle(el).color),'rgb(208, 64, 42)');await page.locator('[data-del-visit]').click();await page.waitForSelector('.pp-confirm[open]');assert.equal(await page.evaluate(()=>deletions.length),0);assert.equal(await page.locator('[data-cancel]').evaluate(el=>el===document.activeElement),true);await page.keyboard.press('Escape');assert.equal(await page.locator('.pp-confirm').count(),0);
 await page.locator('[data-pp-tab="specialties"]').click();await page.locator('.pp-specialty').filter({hasText:'التخاطب'}).locator('summary').first().click();await page.locator('[data-edit-speech-profile]').click();await page.waitForSelector('#sp-save-profile');assert(await page.locator('.ca-form [data-pp-legacy-speech]').isVisible());await page.locator('#sp-save-profile').evaluate(el=>el.closest('.modal-backdrop').querySelector('.modal-close').click());
 const metrics=await page.evaluate(()=>({viewport:innerWidth,body:document.documentElement.scrollWidth}));assert(metrics.body<=metrics.viewport+1,'no page overflow '+JSON.stringify(metrics));
 if(process.env.PROFILE_QA_SHOTS)await page.screenshot({path:process.env.PROFILE_QA_SHOTS+'/profile-specialties-'+width+'.png',fullPage:true});
 assert.deepEqual(errors,[]);await page.close();
 }console.log('PASS browser 1280/390/360: actual icon hover colors, native named confirmation, cancel focus/Escape, profile tabs, speech integration and viewport fit; mocked records.');
}finally{await browser.close()}})().catch(e=>{console.error(e);process.exitCode=1});
