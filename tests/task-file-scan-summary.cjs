const assert=require('node:assert/strict');
const fs=require('node:fs');
const {JSDOM}=require('jsdom');
const sleep=t=>new Promise(r=>setTimeout(r,t));
(async()=>{
 const dom=new JSDOM('<!doctype html><html lang="ar"><body><section class="digital-team"></section></body></html>',{url:'https://test.invalid',runScripts:'outside-only'});
 const w=dom.window,d=w.document;
 let calls=0;
 w.SSMPDDigitalTeam={isOwner:()=>true};
 w.SSMPD_CONFIG={supabase:{url:'https://fixture.invalid',anonKey:'test'}};
 w.supabase={createClient:()=>({rpc:async(name)=>{
  assert.equal(name,'task_file_scan_overview');calls++;
  return {data:{counts:{scanned:18,restricted:3},recent:[
   {id:'a',file_name:'%D8%B3%D8%AC%D9%84_%D8%A7%D9%84%D8%AC%D9%87%D8%A7%D8%AA.xlsx',state:'scanned',task_id:'task1',summary:'الملف يحوي قائمة جهات',analysis:{findings:['اسم جهتين غير مكتمل'],missing_information:['تواريخ التواصل']}},
   {id:'b',file_name:'بيانات المرضى.pdf',state:'restricted',task_id:'task2',summary:'ملف يحتاج مراجعة بشرية',analysis:{}}
  ]},error:null};
 }})};
 w.eval(fs.readFileSync('assets/js/task-file-scan-summary.js','utf8'));
 w.dispatchEvent(new w.Event('ssmpd-digital-team-rendered'));await sleep(35);
 assert(d.querySelector('[data-scan-summary]'));
 assert(d.body.textContent.includes('18'));
 assert(d.body.textContent.includes('3'));
 assert(!d.body.textContent.includes('%D8'),'file names decoded for humans');
 assert(!d.body.textContent.includes('الملف يحوي قائمة جهات'),'needs action filter hides completed items');
 d.querySelector('[data-scan-filter="scanned"]').click();await sleep(35);
 assert(d.body.textContent.includes('الملف يحوي قائمة جهات'));
 const item=d.querySelector('.ss-file');item.open=true;
 assert(item.textContent.includes('اسم جهتين غير مكتمل'));
 assert(item.textContent.includes('تواريخ التواصل'));
 assert(!d.querySelector('[data-scan-run]'),'no per-file manual scan button');
 assert(calls>=2);
 dom.window.close();console.log('PASS readable task file names, scoped filters and per-file explanations');
})().catch(e=>{console.error(e);process.exit(1);});