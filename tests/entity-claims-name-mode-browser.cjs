// Owner 2026-11-25 («طبقه» on docs/ui-references/mockups/entity-service-names.html): claim documents print the service as
// the entity's own name / the center's name / both; default saved per entity (entity_claim_name_mode / _save).
// Synthetic data only. Set PW_CHROMIUM to a Chromium binary when the bundled Playwright browser is missing.
const {chromium}=require('playwright'),http=require('http'),fs=require('fs'),path=require('path'),assert=require('node:assert/strict');
const root=path.resolve(__dirname,'..');
const fixture=`<!doctype html><html dir="rtl" lang="ar"><meta charset="utf-8"><link rel="stylesheet" href="/assets/css/styles.css"><link rel="stylesheet" href="/assets/css/entity-claims.css"><body><script>
window.TEST={calls:[],saved:'entity',canSave:true,exported:null};window.SSMPDAuth={currentAdmin:{id:'admin-1'}};
const q=(i,svc,en,ec)=>({invoice_id:'inv-'+i,claim_id:'claim-'+i,reference:'INV-'+i,entity_id:'entity-1',entity_name:'ميد نت',patient_name:'مستفيد '+i,medical_record_no:'MR-'+i,member_reference:'CARD-'+i,service_category:'أشعة',service_name:svc,service_date:'2026-11-20',price_terms:{price:420,item_terms:en?{external_name:en,external_code:ec}:{external_name:'',external_code:''}},total:420,patient_total:84,entity_total:336,claimed_amount:336,lines:[{kind:'service',name:svc,quantity:1,unit:'خدمة',gross:420,discount:0,net:420,patient:84,entity:336}]});
const bills=[q(1,'سونار على البطن والحوض','Ultrasound Abdomen & Pelvis','US-012'),q(2,'جلسة تنظيف بشرة عميق','','')];
const access=()=>({can_create:true,can_view:true,can_review:true,can_terms:true,me:'admin-1'});
window.SSMPDDb={client:{rpc:async(name,args={})=>{TEST.calls.push({name,args});let data;
 if(name==='entity_claims_workspace')data={...access(),entities:[{id:'entity-1',name:'ميد نت'}],contracts:[],invoices:bills.map(b=>({invoice_id:b.invoice_id,claim_id:b.claim_id,reference:b.reference,service_date:b.service_date,snapshot:b,remaining:336,batch_id:'batch-1'})),batches:[{id:'batch-1',entity_id:'entity-1',entity_name:'ميد نت',reference:'CLM-1',period_from:'2026-11-01',period_to:'2026-11-30',revision:1,status:'draft',created_by:'admin-1',invoice_count:2,amount:672,remaining:672,attachments:[]}]};
 else if(name==='entity_claim_document')data=args.p_kind==='invoice'?{...bills[0],access:access()}:{id:'batch-1',entity_id:'entity-1',entity_name:'ميد نت',reference:'CLM-1',period_from:'2026-11-01',period_to:'2026-11-30',status:'draft',revision:1,created_by:'admin-1',lines:bills.map(b=>({...b,current_remaining:336})),remaining:672,adjustments:[],attachments:[],access:access()};
 else if(name==='entity_claim_name_mode')data={mode:TEST.saved,can_save:TEST.canSave};
 else if(name==='entity_claim_name_mode_save'){TEST.saved=args.p_mode;data={mode:args.p_mode};}
 else if(name==='insurance_open_shifts')data=[];
 else throw Error('Unexpected RPC '+name);
 return {data,error:null};}}};
window.SSMPDFinanceControls={panel:()=>'',act:()=>false,due:x=>x.amount};window.SSMPDDrive={};
window.XLSX={utils:{book_new:()=>({s:[]}),aoa_to_sheet:rows=>({rows}),book_append_sheet:(b,s)=>b.s.push(s)},writeFile:(b)=>TEST.exported=b.s[0].rows};
</script><script src="/assets/js/swnw-print.js"></script><script src="/assets/js/entity-claims-print.js"></script><script src="/assets/js/entity-claims.js"></script></body></html>`;
(async()=>{const server=http.createServer((req,res)=>{if(req.url==='/fixture'){res.setHeader('Content-Type','text/html;charset=utf-8');res.end(fixture);return;}const file=path.join(root,decodeURIComponent(req.url.split('?')[0]));if(!file.startsWith(root+path.sep)||!fs.existsSync(file)){res.writeHead(404);res.end();return;}res.setHeader('Content-Type',({'.js':'application/javascript','.css':'text/css'})[path.extname(file)]||'application/octet-stream');fs.createReadStream(file).pipe(res);});await new Promise(r=>server.listen(0,'127.0.0.1',r));let browser;try{
 browser=await chromium.launch({headless:true,args:['--no-sandbox'],...(process.env.PW_CHROMIUM?{executablePath:process.env.PW_CHROMIUM}:{})});const page=await browser.newPage({viewport:{width:1280,height:900}});const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.goto('http://127.0.0.1:'+server.address().port+'/fixture');await page.evaluate(()=>SSMPDEntityClaims.open());
 const frame=()=>page.evaluate(()=>document.querySelector('iframe.ec-preview').srcdoc);
 // invoice document: saved default «اسم الجهة» is selected and printed
 await page.locator('[data-ec="invoice"]').first().click();await page.waitForSelector('iframe.ec-preview');await page.waitForSelector('[data-ec="name-mode"][data-id="entity"].on');
 let doc=await frame();assert(doc.includes('Ultrasound Abdomen &amp; Pelvis')&&doc.includes('US-012'),'entity name + code in invoice');
 assert.match(await page.locator('[data-ec-name-note]').innerText(),/الافتراضي/);
 // switch to «اسم المركز»: center name, no entity code; note says this print only
 await page.locator('[data-ec="name-mode"][data-id="center"]').click();doc=await frame();assert(!doc.includes('Ultrasound')&&doc.includes('سونار على البطن والحوض'));assert.match(await page.locator('[data-ec-name-note]').innerText(),/للطباعة دي بس/);
 // «الاتنين» + save as default
 await page.locator('[data-ec="name-mode"][data-id="both"]').click();doc=await frame();assert(doc.includes('Ultrasound Abdomen &amp; Pelvis — سونار على البطن والحوض'),'both in invoice');
 await page.locator('[data-ec="name-default"]').click();await page.waitForFunction(()=>TEST.saved==='both');
 const save=await page.evaluate(()=>TEST.calls.filter(c=>c.name==='entity_claim_name_mode_save').map(c=>c.args));assert.deepEqual(save,[{p_entity:'entity-1',p_mode:'both'}]);
 assert.match(await page.locator('[data-ec-name-note]').innerText(),/الافتراضي/);
 await page.locator('[data-ec="excel"]').click();let ex=await page.evaluate(()=>TEST.exported);assert.deepEqual(ex[0].slice(8,11),['الخدمة عند الجهة','كود الجهة','الخدمة في لائحة المركز']);assert.deepEqual(ex[1].slice(8,11),['Ultrasound Abdomen & Pelvis','US-012','سونار على البطن والحوض']);
 // batch: statement with both + entity code column; the service without an entity name says so
 await page.locator('[data-ec="back"]').click();await page.locator('[data-tab="batches"]').click();await page.locator('[data-ec="batch"]').first().click();await page.waitForSelector('[data-ec="preview"]');
 await page.locator('[data-ec="excel"]').click();await page.waitForFunction(()=>TEST.exported&&TEST.exported[0].includes('كود الجهة'));
 await page.locator('[data-ec="preview"]').click();await page.waitForSelector('iframe.ec-preview');doc=await frame();
 assert(doc.includes('<th>كود الجهة</th>')&&doc.includes('اسم الجهة مش متسجل')&&doc.includes('جلسة تنظيف بشرة عميق'),'batch both');
 // no save button for someone who cannot save
 await page.evaluate(()=>{TEST.canSave=false;});await page.locator('[data-ec="back"]').click();await page.locator('[data-ec="preview"]').click();await page.waitForSelector('iframe.ec-preview');
 assert.equal(await page.locator('[data-ec="name-default"]').count(),0,'save hidden without permission');
 if(process.env.CLAIM_NAMES_QA_DIR){await page.evaluate(()=>{TEST.canSave=true;});await page.locator('[data-ec="back"]').click();await page.locator('[data-ec="preview"]').click();await page.waitForSelector('iframe.ec-preview');await page.waitForTimeout(400);for(const w of [1280,390]){await page.setViewportSize({width:w,height:900});await page.waitForTimeout(200);await page.screenshot({path:path.join(process.env.CLAIM_NAMES_QA_DIR,'claim-names-built-'+(w>500?'desktop':'mobile')+'.png'),fullPage:false});}}
 assert.deepEqual(errors,[]);console.log('PASS claim names: saved default loads, entity / center / both re-render the preview, save as default (entity_claim_name_mode_save), Excel columns per mode, batch statement entity-code column + «اسم الجهة مش متسجل», save hidden without permission.');
}finally{if(browser)await browser.close();server.close();}})().catch(e=>{console.error(e);process.exit(1);});
