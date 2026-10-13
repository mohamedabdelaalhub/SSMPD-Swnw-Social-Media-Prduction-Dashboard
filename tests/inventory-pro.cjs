const assert=require('node:assert/strict'),fs=require('fs'),path=require('path'),http=require('http');
const {chromium}=require('playwright');
const root=path.resolve(__dirname,'..');
const html=`<!doctype html><html lang="ar" dir="rtl"><head><meta charset="utf-8"><link rel="stylesheet" href="/assets/css/styles.css"><link rel="stylesheet" href="/assets/css/inventory.css"></head><body><div id="r"></div>
<script>
var d1=function(n){return new Date(Date.now()+n*86400000).toISOString().slice(0,10)};
window.calls=[];
var items=[];for(var k=1;k<=30;k++)items.push({id:'i'+k,sku:'S'+k,name:'صنف '+k,category:k%2?'مستلزمات':'أدوية',base_unit:'قطعة',units_per_pack:10,minimum_quantity:5,on_hand:k===1?3:50,available:50,current_average_cost:2,current_sale_price:3,markup_percent:50,track_lots:k===2});
var snap={items:items,requests:[{id:'r1',request_type:'purchase',status:'approved',requester_id:'a1',requester_name:'محمد',supplier_name:'مورد 1',requested_at:new Date().toISOString(),lines:[{item_id:'i2',item_name:'صنف 2',quantity:20,package_cost:20,received_quantity:0,fulfilled_quantity:0,track_lots:true}]},{id:'r2',request_type:'issue',status:'pending',requester_id:'a1',requester_name:'محمد',requested_at:new Date().toISOString(),lines:[{item_id:'i3',item_name:'صنف 3',quantity:2,received_quantity:0,fulfilled_quantity:0}]}],
movements:[{id:'m1',item_id:'i1',item_name:'صنف 1',movement_type:'sale',quantity_delta:-14,unit_cost:2,unit_sale_price:3,profit_amount:14,created_at:new Date().toISOString(),actor_name:'محمد'},{id:'m2',item_id:'i3',item_name:'صنف 3',movement_type:'waste',quantity_delta:-1,unit_cost:2,created_at:new Date().toISOString(),note:'تلف',actor_name:'محمد'}],
counts:[],alerts:[],schedules:[],lots:[{id:'l1',item_id:'i4',lot_number:'A1',expiry_date:d1(10),remaining:5},{id:'l2',item_id:'i5',lot_number:'B1',expiry_date:d1(-2),remaining:2}],
suppliers:[{id:'s1',name:'مورد 1',phone:'010',notes:'',active:true}],can_manage:true,me:'a1'};
window.SSMPDAuth={currentAdmin:{id:'a1'}};
window.SSMPDRoles={canModuleAction:function(){return true},canSeeTab:function(){return true}};
window.SSMPDDb={taskPeople:function(){return Promise.resolve([{id:'a1',name:'محمد'}])},client:{rpc:function(n,a){calls.push([n,a]);return Promise.resolve({data:n==='inventory_snapshot'?snap:null,error:null});}}};
</script><script src="/assets/js/render-inventory.js"></script><script>SSMPDRenderInventory.render(document.getElementById('r'))</script></body></html>`;
(async()=>{
const server=http.createServer((req,res)=>{const url=decodeURIComponent(req.url.split('?')[0]);if(url==='/'){res.setHeader('content-type','text/html');return res.end(html);}const f=path.join(root,url);if(!f.startsWith(root)||!fs.existsSync(f)||fs.statSync(f).isDirectory()){res.statusCode=404;return res.end();}const ext=path.extname(f);res.setHeader('content-type',ext==='.css'?'text/css':ext==='.js'?'text/javascript':'application/octet-stream');res.end(fs.readFileSync(f));}).listen(0);
const port=server.address().port;
const browser=await chromium.launch({executablePath:process.env.PW_CHROMIUM||undefined,args:['--no-sandbox']});
try{
 for(const width of [1280,390]){
  const page=await browser.newPage({viewport:{width,height:900}});const errors=[];page.on('pageerror',e=>errors.push(e.message));page.on('dialog',d=>{if(!/مطلوب/.test(d.message()))errors.push('native dialog: '+d.message());d.dismiss();});
  await page.goto('http://localhost:'+port+'/');await page.waitForSelector('.inv-kpi');
  const txt=async s=>(await page.locator(s).first().textContent());
  assert(!/[٠-٩]/.test(await page.locator('body').textContent()),'Latin digits only');
  // KPI: low stock -> items filtered
  await page.click('[data-kpi="low"]');await page.waitForSelector('[data-item-stock]');
  assert.equal(await page.locator('.inv-card tbody tr').count(),1,'low filter shows 1');
  assert(await page.locator('.inv-row-low').count()===1,'low row highlighted');
  await page.click('[data-kpi="expiring"]').catch(()=>{});
  await page.click('[data-view="overview"]');await page.click('[data-kpi="expiring"]');
  assert.equal(await page.locator('.inv-card tbody tr').count(),2,'expiring filter shows 2 (near + expired)');
  assert(/منتهي منذ 2/.test(await page.locator('.inv-card tbody').textContent()),'expired badge');
  // search + pagination
  await page.selectOption('[data-item-stock]','all');
  assert.equal(await page.locator('.inv-card tbody tr').count(),25,'page size 25');
  await page.click('[data-page="items"][data-to="2"]');
  assert.equal(await page.locator('.inv-card tbody tr').count(),5,'page 2 has 5');
  await page.fill('[data-item-q]','صنف 12');
  assert.equal(await page.locator('.inv-card tbody tr').count(),1,'search');
  await page.fill('[data-item-q]','zzz');
  assert(await page.locator('.inv-empty').count()===1,'empty state');
  await page.fill('[data-item-q]','');
  // pending requests KPI + review modal (no native prompt)
  await page.click('[data-view="overview"]');await page.click('[data-kpi="pending"]');
  assert.equal(await page.locator('.inv-card tbody tr').count(),1);
  await page.click('[data-review="r2"][data-approve="0"]');
  await page.click('[data-save]');
  assert(await page.locator('.inv-modal').count()===1,'reject requires reason');
  await page.fill('.inv-modal [name="note"]','غير لازم');await page.click('[data-save]');
  await page.waitForFunction(()=>calls.some(c=>c[0]==='inventory_review_request'));
  assert.equal(await page.evaluate(()=>calls.find(c=>c[0]==='inventory_review_request')[1].p_note),'غير لازم');
  // receipt modal requires expiry for tracked item
  await page.click('[data-filter="status"]').catch(()=>{});
  await page.selectOption('[data-filter="status"]','');
  await page.click('[data-fulfill="r1"]');
  await page.click('[data-save]');
  assert(await page.locator('.inv-modal').count()===1,'expiry required');
  await page.fill('.inv-receive [name="lot"]','L9');await page.fill('.inv-receive [name="exp"]',new Date(Date.now()+200*86400000).toISOString().slice(0,10));
  await page.click('[data-save]');
  await page.waitForFunction(()=>calls.some(c=>c[0]==='inventory_receive_request'));
  const rc=await page.evaluate(()=>calls.find(c=>c[0]==='inventory_receive_request')[1].p_lines[0]);
  assert.equal(rc.lot_number,'L9');assert(rc.expiry_date);
  // write-off modal
  await page.click('[data-view="items"]');await page.click('[data-writeoff=""]');
  await page.fill('.inv-modal [name="qty"]','2');await page.fill('.inv-modal [name="note"]','كُسر');await page.click('[data-save]');
  await page.waitForFunction(()=>calls.some(c=>c[0]==='inventory_write_off'));
  // reports
  await page.click('[data-view="reports"]');await page.waitForSelector('[data-reorder]');
  assert(/صنف 1/.test(await page.locator('.inv-card').first().textContent()),'reorder suggests low item');
  await page.click('[data-reorder]');
  assert(await page.locator('.inv-modal [data-line]').count()>=1,'reorder prefills lines');
  await page.click('[data-cancel]');
  // suppliers
  await page.click('[data-view="suppliers"]');
  assert(/مورد 1/.test(await txt('.inv-card')));
  assert.deepEqual(errors,[],errors.join('|'));
  await page.close();
 }
 console.log('PASS: inventory modals, clickable KPIs, search/filters, pagination, expiry badges, receipt lots, write-off, reports/reorder, suppliers. Mocked RPCs only.');
}finally{await browser.close();server.close();}
})().catch(e=>{console.error(e);process.exit(1);});
