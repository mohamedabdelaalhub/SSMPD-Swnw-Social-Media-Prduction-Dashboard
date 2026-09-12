const assert=require('node:assert/strict');
const fs=require('node:fs');
const {JSDOM}=require('jsdom');
const delay=ms=>new Promise(r=>setTimeout(r,ms));
const w=new JSDOM('<main id="portal-root"></main>',{url:'https://example.test/patient-portal/',runScripts:'outside-only'}).window;
const root=w.document.getElementById('portal-root');let calls=0,fail=false;
w.SSMPD_CONFIG={supabase:{url:'https://example.test',anonKey:'test'}};
w.supabase={createClient:()=>({functions:{invoke:async()=>{calls++;return fail?{error:new Error('offline')}:{data:{documents:[{id:'doc1',source:'physio_report',category:'physical_therapy',title:'Physio',details:[]}]}};}}})};
w.eval(fs.readFileSync('patient-portal/portal-performance-fix.js','utf8'));
w.eval(fs.readFileSync('patient-portal/portal-file-categories.js','utf8'));
function render(loading=false){root.innerHTML='<section class="documents-section" data-documents-loading="'+loading+'"><h3>Documents</h3>'+(loading?'<div class="compact-empty"><span class="spinner"></span></div>':'<div class="document-list"><article class="document-row" data-file-id="f1" data-file-category="radiology"></article></div>')+'</section>';}
(async()=>{
 await delay(1250); // Login/API completes after the old final timer.
 render();await delay(70);
 assert.equal(root.querySelectorAll('.generated-document-row').length,1,'Late-rendered files tab must load clinical reports');
 assert.equal(root.querySelectorAll('.portal-file-category-bar').length,1);
 const before=calls;render(true);await delay(50);assert.equal(calls,before,'Do not fetch clinical reports for a temporary loading view');
 render();await delay(70);assert.equal(root.querySelectorAll('.generated-document-row').length,1,'Replacing root after upload request must retain reports');
 const steady=calls;root.querySelector('[data-file-filter="physical_therapy"]').click();await delay(70);assert.equal(calls,steady,'Filter must not trigger another API request');assert.ok(root.querySelector('[data-file-id="f1"]').hidden);
 fail=true;render();await delay(70);assert.ok(root.querySelector('.portal-documents-status'));const failedCalls=calls;await delay(100);assert.equal(calls,failedCalls,'Failure must not cause retry loop');
 fail=false;root.querySelector('.portal-documents-retry').click();await delay(70);assert.equal(root.querySelectorAll('.generated-document-row').length,1);assert.equal(root.querySelector('.portal-documents-status'),null);
 console.log('PASS: delayed render, loading screen, root replacement, stable filtering and explicit retry');w.close();
})().catch(e=>{console.error(e);w.close();process.exitCode=1});
