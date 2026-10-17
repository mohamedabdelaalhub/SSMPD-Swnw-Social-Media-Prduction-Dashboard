const fs=require('fs'),path=require('path'),http=require('http'),assert=require('node:assert/strict');
const {chromium}=require('playwright');
const root=path.resolve(__dirname,'..');
const html=`<!doctype html><html lang="ar" dir="rtl"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/assets/css/styles.css"><link rel="stylesheet" href="/assets/css/inventory.css"><link rel="stylesheet" href="/assets/css/finance-cash.css"></head><body><div id="inventory-navigation" hidden></div><main class="view" id="r"></main>
<script>
window.calls=[];window.errors=[];window.SSMPDToast={error:function(t){errors.push(t)},success:function(){}};
var item={id:'i1',name:'كانيولا صفراء',base_unit:'قطعة',units_per_pack:10,category:'مستلزمات',on_hand:50,minimum_quantity:5,current_average_cost:2,current_sale_price:3};
var snap={workspace_version:2,location_id:'central',me:'admin',can_manage:true,can_setup:true,can_request:true,can_receive:true,can_approve:true,items:[item],lots:[],suppliers:[],requests:[],movements:[],alerts:[],imports:[],schedules:[],audit:[],branches:[{id:'b1',name:'الفرع الحالي'}],locations:[{id:'central',name:'الرئيسي',can_view:true},{id:'nurse',name:'التمريض',branch_name:'الفرع الحالي',branch_id:'b1',can_view:true}],staff:[{location_id:'nurse',admin_id:'receiver',responsibility:'receiver',name:'المستلم'},{location_id:'central',admin_id:'admin',responsibility:'counter',name:'محمد'}],counts:[{id:'c1',title:'جرد اليوم',assigned_to:'admin',assignee_name:'محمد',starts_at:'2026-01-01',due_at:'2027-01-01',status:'open',lines:[{id:'cl1',item_id:'i1',item_name:'كانيولا صفراء',counted_quantity:null}]}],transfers:[{id:'t1',status:'pending',source_id:'central',destination_id:'nurse',can_storekeeper:true,can_manager:true,lines:[{item_id:'i1',item_name:'كانيولا صفراء',quantity:5,allocations:[]}]}]};
window.SSMPDAuth={currentAdmin:{id:'admin'}};window.SSMPDRoles={canModuleAction:function(){return true},canSeeTab:function(){return true}};
window.SSMPDDb={taskPeople:function(){throw Error('inventory must not depend on task permission')},client:{rpc:function(n,a){calls.push([n,a]);if(n==='inventory_people')return Promise.resolve({data:[{id:'admin',name:'محمد'}]});if(n==='inventory_workspace_snapshot'){if(window.failInventoryReload)return Promise.resolve({error:{message:'offline'}});var d=JSON.parse(JSON.stringify(snap));d.location_id=a.p_location||'central';return Promise.resolve({data:d});}return Promise.resolve({data:'new-id'});}}};
</script><script src="/assets/js/inventory-workspace.js"></script><script src="/assets/js/render-inventory.js"></script><script>SSMPDRenderInventory.render(document.getElementById('r'))</script></body></html>`;
(async()=>{
 const server=http.createServer((req,res)=>{const url=decodeURIComponent(req.url.split('?')[0]);if(url==='/'){res.setHeader('content-type','text/html');return res.end(html);}const file=path.join(root,url);if(!file.startsWith(root)||!fs.existsSync(file)){res.statusCode=404;return res.end();}res.setHeader('content-type',file.endsWith('.css')?'text/css':'text/javascript');res.end(fs.readFileSync(file));}).listen(0);
 const browser=await chromium.launch({executablePath:process.env.PW_CHROMIUM||undefined,args:['--no-sandbox']});
 try{
  for(const width of [1280,390,360]){
   const page=await browser.newPage({viewport:{width,height:900}});const crashes=[];page.on('pageerror',e=>crashes.push(e.message));

  async function go(view){
   const groups={overview:'overview',items:'stock',balances:'stock',requests:'operations',transfers:'operations',usage:'operations',sales:'operations',counts:'stocktakes',imports:'stocktakes',reports:'reporting',movements:'reporting'};
   if(view==='suppliers'){await go('requests');await page.click('[data-view="suppliers"]');return;}
   if(view==='overview'){await page.click('[data-group="overview"]');return;}
   if(!await page.locator('[data-view="'+view+'"]').count())await page.click('[data-group="'+groups[view]+'"]');
   await page.click('[data-view="'+view+'"]');
  }
   await page.goto('http://localhost:'+server.address().port);await page.waitForSelector('[data-w-location]');
   assert.equal(await page.locator('[data-group]').count(),5,'exactly five primary tabs');
   const beforeNav=await page.evaluate(()=>calls.length);
   await page.click('[data-group="stock"]');assert.equal(await page.locator('#r [data-inv-table]').count(),0,'group initially shows buttons only');assert.equal(await page.locator('.fc-section-grid [data-view]').count(),2);assert.equal(await page.locator('[data-view="transfers"]').count(),0,'unrelated submenus hidden');
   await page.click('[data-group="operations"]');assert.equal(await page.locator('.fc-section-grid [data-view]').count(),5);assert.equal(await page.locator('#r [data-inv-table]').count(),0);assert.equal(await page.evaluate(()=>calls.length),beforeNav,'group navigation is local');
   if(process.env.INVENTORY_QA_SHOTS)await page.screenshot({path:path.join(process.env.INVENTORY_QA_SHOTS,'inventory-groups-'+width+'.png')});

   async function fits(label){const size=await page.evaluate(()=>({screen:innerWidth,doc:document.documentElement.scrollWidth}));assert(size.doc<=size.screen+1,label+' must not widen document: '+JSON.stringify(size));}
   await go('transfers');await fits('transfers');
   if(process.env.INVENTORY_QA_SHOTS)await page.screenshot({path:path.join(process.env.INVENTORY_QA_SHOTS,'inventory-transfers-'+width+'.png')});
   await go('balances');await fits('balances');
   if(process.env.INVENTORY_QA_SHOTS)await page.screenshot({path:path.join(process.env.INVENTORY_QA_SHOTS,'inventory-balances-'+width+'.png')});
   await page.click('[data-w-open-structure]');await fits('structure');
   if(process.env.INVENTORY_QA_SHOTS)await page.screenshot({path:path.join(process.env.INVENTORY_QA_SHOTS,'inventory-structure-'+width+'.png')});
   // Existing dashboard reads a scoped snapshot; only explicit location changes reset the view.
   await page.selectOption('[data-w-location]','nurse');await page.waitForFunction(()=>calls.filter(c=>c[0]==='inventory_workspace_snapshot').some(c=>c[1].p_location==='nurse'));
   await go('transfers');await page.click('[data-w-new-transfer]');
   await page.selectOption('.inv-modal [name="dst"]','nurse');await page.selectOption('.inv-modal [name="receiver"]','receiver');
   await page.fill('[data-w-tline] input','5');await page.click('[data-save]');await page.waitForFunction(()=>calls.some(c=>c[0]==='inventory_create_transfer'));
   const tr=await page.evaluate(()=>calls.find(c=>c[0]==='inventory_create_transfer')[1]);assert.equal(tr.p_lines[0].quantity,5);assert.equal(tr.p_receiver,'receiver');
   await go('usage');await page.fill('[data-w-usage] [name="quantity"]','2');await page.fill('[data-w-usage] [name="note"]','استخدام بالعيادة');await page.click('[data-w-usage] button');await page.waitForFunction(()=>calls.some(c=>c[0]==='inventory_consume_at'));const use=await page.evaluate(()=>calls.find(c=>c[0]==='inventory_consume_at')[1]);assert.equal(use.p_location,'nurse');assert.equal(use.p_kind,'issue');
   await go('imports');await page.click('[data-w-manual]');
   await page.selectOption('.inv-modal [name="item"]','i1');await page.fill('.inv-modal [name="quantity"]','٠');
   await page.fill('.inv-modal [name="asof"]','2026-10-15T12:00');await page.fill('.inv-modal [name="cost"]','2');
   const bounds=await page.locator('.inv-modal').boundingBox();assert(bounds.width<=width,'modal fits viewport');
   if(process.env.INVENTORY_QA_SHOTS)await page.screenshot({path:path.join(process.env.INVENTORY_QA_SHOTS,'inventory-import-'+width+'.png')});
   await page.click('[data-save]');await page.waitForFunction(()=>calls.some(c=>c[0]==='inventory_stage_import'));
   const imp=await page.evaluate(()=>calls.find(c=>c[0]==='inventory_stage_import')[1]);assert.equal(imp.p_rows[0].quantity,0);assert.equal(imp.p_rows[0].item_id,'i1');assert.equal(imp.p_rows[0].unit,'قطعة');
   await go('counts');await page.click('[data-w-count-edit]');await page.waitForSelector('[data-w-cline]');
   await page.click('[data-save]');await page.waitForFunction(()=>calls.some(c=>c[0]==='inventory_save_count_draft'));
   const draft=await page.evaluate(()=>calls.find(c=>c[0]==='inventory_save_count_draft')[1]);assert.equal(draft.p_lines[0].counted_quantity,null,'blank preserved');assert.equal(draft.p_submit,false);
   const callsBefore=await page.evaluate(()=>calls.length);await page.evaluate(()=>{window.failInventoryReload=true;});await page.click('[data-w-open-structure]');await page.waitForSelector('[data-w-rename-branch]');assert.equal(await page.evaluate(()=>calls.length),callsBefore,'opening structure uses loaded data without a network reload');await page.evaluate(()=>{window.failInventoryReload=false;});await page.click('[data-w-rename-branch]');await page.fill('.inv-modal [name="name"]','حدائق الأهرام');await page.click('[data-save]');await page.waitForFunction(()=>calls.some(c=>c[0]==='inventory_rename_structure'));const renamed=await page.evaluate(()=>calls.find(c=>c[0]==='inventory_rename_structure')[1]);assert.equal(renamed.p_kind,'branch');assert.equal(renamed.p_name,'حدائق الأهرام');await page.click('[data-w-rename-location="central"]');await page.fill('.inv-modal [name="name"]','مخزن التوريد');await page.click('[data-save]');await page.waitForFunction(()=>calls.filter(c=>c[0]==='inventory_rename_structure').length===2);await page.click('[data-w-new-branch]');await page.fill('.inv-modal [name="name"]','فرع 2');await page.selectOption('.inv-modal [name="copy"]','b1');await page.click('[data-save]');await page.waitForFunction(()=>calls.some(c=>c[0]==='inventory_save_structure'));
   const branch=await page.evaluate(()=>calls.find(c=>c[0]==='inventory_save_structure')[1]);assert.equal(branch.p_copy_branch,'b1');
   assert.deepEqual(crashes,[]);
   const parsed=await page.evaluate(()=>SSMPDInventoryWorkspace.parseRows([['الصنف','العدد','علبة \\ عدد'],['كاب حجامة',3,'علبة (10 في العلبة)'],['كانولا','٠','عدد']]));
   assert.equal(parsed[0].factor,10);assert.equal(parsed[0].unit,'قطعة');assert.equal(parsed[1].quantity,0);
   await page.evaluate(()=>{snap.can_manage=false;snap.can_setup=false;});await page.selectOption('[data-w-location]','central');await page.waitForFunction(()=>!document.querySelector('[data-w-open-structure]'));await page.click('[data-group="reporting"]');assert.equal(await page.locator('[data-view="reports"]').count(),0,'management reports remain hidden');assert.equal(await page.locator('[data-w-open-structure]').count(),0,'setup remains hidden');await go('requests');assert.equal(await page.locator('[data-view="suppliers"]').count(),0,'supplier management remains hidden');
   await page.close();
  }
  console.log('PASS inventory UI at 1280/390/360: bounded table scrolling, location switching, transfer request, individual entry, Arabic zero, draft counts, branch copy and Excel-column parser; RPCs mocked');
 }finally{await browser.close();server.close();}
})().catch(e=>{console.error(e);process.exit(1);});


