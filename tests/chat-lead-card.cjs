// «الليد» card in the chat contact pane (owner 2026-11-22): «يظهرلي علي الشمال انه اتعمله ليد وتفاصيل الليد وحالته ولما ادوس عليه يفتحلي الليد».
// 1) migration 20261122180000 on PGlite: lookup order (link → bot flow → ingest event → WhatsApp phone), inbox-only access,
//    can_open mirrors leads RLS, create (WhatsApp phone, missing_data without phone, open duplicate linked, least-busy customer service), rollback.
// 2) UI: loading → card with Arabic status/agent/last attempt, click opens the lead modal, «اعمل ليد» flow, read-only note, English digits.
const fs=require('fs'),path=require('path'),assert=require('node:assert/strict');
const J=x=>JSON.parse(JSON.stringify(x));
async function sql(){
 const {PGlite}=require('@electric-sql/pglite');const db=new PGlite();
 await db.exec(fs.readFileSync('supabase/migrations/20261113120000_ads_leads_ingest_and_spend.sql','utf8').match(/create or replace function public\.normalize_phone_eg[\s\S]*?\$\$;/)[0].replace(/^/,'')
  .replace('create or replace function public.normalize_phone_eg','create role anon;create role authenticated;create or replace function public.normalize_phone_eg'));
 await db.exec(`create table admins(id uuid primary key default gen_random_uuid(),name text,role text,active boolean default true,created_at timestamptz default now());
  create table admin_extra_roles(admin_id uuid,role text);
  create function public.my_admin_id() returns uuid language sql stable as $$ select nullif(current_setting('t.me',true),'')::uuid $$;
  create function public.has_role(r text) returns boolean language sql stable as $$ select coalesce(current_setting('t.roles',true),'') like '%'||r||'%' $$;
  create function public.is_super() returns boolean language sql stable as $$ select public.has_role('super_admin') $$;
  create function public.social_comments_access() returns boolean language sql stable as $$ select public.has_role('super_admin') or public.has_role('general_manager') or public.has_role('approver') or public.has_role('page_manager') $$;
  create table leads(id uuid primary key default gen_random_uuid(),customer_name text not null,phone_raw text,phone_normalized text,source text not null,message_text text,received_at timestamptz default now(),received_by uuid,interested_service text,assigned_to uuid,current_status text default 'new',acquisition_type text,utm_campaign text,meta_campaign_id text,created_at timestamptz default now(),updated_at timestamptz default now());
  create table lead_attempts(id uuid primary key default gen_random_uuid(),lead_id uuid,attempt_date timestamptz default now(),result text);
  create table social_messages(id text primary key,platform text,conversation_id text,is_page boolean,sender_name text,message text,sent_at timestamptz,conversation_url text);
  create table messenger_flow_state(conversation_id text primary key,lead_id uuid);
  create table lead_ingest_events(event_id text primary key,lead_id uuid);`);
 await db.exec(fs.readFileSync('supabase/migrations/20261122180000_social_conversation_leads.sql','utf8'));
 const q=async(s,p=[])=>(await db.query(s,p)).rows;
 const [pm,cs1,cs2,sup]=(await q(`insert into admins(name,role) values('منى','page_manager'),('سارة','customer_service'),('علي','customer_service'),('محمد','super_admin') returning id`)).map(r=>r.id);
 const as=async(roles,me)=>{await db.exec(`set t.roles='${roles}';set t.me='${me||''}'`);};
 const [flowLead]=(await q(`insert into leads(customer_name,source,phone_normalized,assigned_to) values('أم محمد','messenger','+201000000001',$1) returning id`,[cs1])).map(r=>r.id);
 await q(`insert into messenger_flow_state values('t_flow',$1)`,[flowLead]);
 await q(`insert into lead_attempts(lead_id,attempt_date,result) values($1,now()-interval '2 days','no_answer'),($1,now()-interval '1 hour','answered')`,[flowLead]);
 const [waLead]=(await q(`insert into leads(customer_name,source,phone_normalized,current_status,assigned_to,utm_campaign) values('حماده','whatsapp','+201000000002','booked',$1,'رمضان') returning id`,[cs2])).map(r=>r.id);
 await q(`insert into social_messages values('m1','facebook','t_new',false,'سامي رياض','عايز أحجز علاج طبيعي',now(),'https://www.facebook.com/x'),('m2','whatsapp','whatsapp:201000000003',false,'ميدو','سعر الكشف',now(),'https://wa.me/201000000003'),('m3','instagram','ig_dup',false,'نبيلة','موعد أسنان',now(),null)`);
 const call=async(fn,args)=>(await q(`select public.${fn}(${args.map((_,i)=>'$'+(i+1)).join(',')}) r`,args))[0].r;
 // no inbox role → refused
 await as('customer_service',cs1);await assert.rejects(call('social_conversation_lead',['t_flow']),/FORBIDDEN/);
 await as('page_manager',pm);
 let r=await call('social_conversation_lead',['t_flow']);assert.equal(r.lead.id,flowLead,'bot flow lead found');assert.equal(r.lead.status,'new');assert.equal(r.lead.assigned,'سارة');
 assert.equal(r.lead.last_attempt.result,'answered','latest attempt');assert.equal(r.lead.can_open,false,'page manager cannot open (leads RLS)');assert.equal(r.lead.phone,null,'phone hidden on Messenger for inbox-only roles');
 r=await call('social_conversation_lead',['whatsapp:201000000002']);assert.equal(r.lead.id,waLead,'WhatsApp by phone');assert.equal(r.lead.phone,'+201000000002');assert.equal(r.lead.campaign,'رمضان');
 assert.equal((await call('social_conversation_lead',['t_new'])).lead,null);
 await as('page_manager,customer_service',pm);assert.equal((await call('social_conversation_lead',['t_flow'])).lead.can_open,false,'customer service only for own leads');
 await as('general_manager',sup);assert.equal((await call('social_conversation_lead',['t_flow'])).lead.can_open,true);
 // create from Messenger without phone → missing_data, assigned to the least busy customer service (علي has 1 open... سارة has 1 open too → earliest created)
 await q(`update leads set current_status='rejected' where id=$1`,[waLead]);
 await as('page_manager',pm);r=await call('social_conversation_lead_create',['t_new',null,null]);
 assert.equal(r.ok,true);assert.equal(r.existing,false);assert.equal(r.lead.status,'missing_data');assert.equal(r.lead.name,'سامي رياض');assert.equal(r.lead.assigned,'علي','fewest open leads');assert.equal(r.lead.linked,true);
 const row=(await q(`select source,received_by,message_text from leads where id=$1`,[r.lead.id]))[0];assert.equal(row.source,'messenger');assert.equal(row.received_by,pm);assert.match(row.message_text,/عايز أحجز[\s\S]*facebook\.com/);
 assert.equal((await call('social_conversation_lead',['t_new'])).lead.id,r.lead.id,'link remembered');
 // WhatsApp: phone from wa_id
 r=await call('social_conversation_lead_create',['whatsapp:201000000003',null,'dental']);assert.equal(r.lead.status,'new');assert.equal(r.lead.phone,'+201000000003');
 // Instagram with a typed phone that matches an open lead → linked, no duplicate
 const n0=(await q(`select count(*)::int n from leads`))[0].n;
 r=await call('social_conversation_lead_create',['ig_dup','٠١٠٠٠٠٠٠٠٠١',null]);assert.equal(r.existing,true);assert.equal(r.lead.id,flowLead,'open lead with the same phone linked');
 assert.equal((await q(`select count(*)::int n from leads`))[0].n,n0,'no duplicate');
 assert.match((await call('social_conversation_lead_create',['nope',null,null])).error,/مش موجودة/);
 assert.match((await call('social_conversation_lead_create',['t_flow2x','12',null])).error,/مش موجودة|ناقص/);
 await q(`insert into social_messages values('m4','facebook','t_short',false,'x','y',now(),null)`);assert.match((await call('social_conversation_lead_create',['t_short','123',null])).error,/ناقص/);
 const g=await q(`select p.proname, has_function_privilege('anon',p.oid,'execute') a from pg_proc p where proname like 'social_conversation_lead%'`);assert.equal(g.length,4);g.forEach(x=>assert.equal(x.a,false,x.proname));
 assert.equal((await q(`select has_table_privilege('authenticated','public.social_conversation_leads','select') x`))[0].x,false);
 await db.exec(fs.readFileSync('supabase/rollbacks/20261122180000_social_conversation_leads.rollback.sql','utf8'));
 assert.equal((await q(`select to_regclass('public.social_conversation_leads') x`))[0].x,null);
}
async function ui(){
 const {chromium}=require('playwright');const b=await chromium.launch();
 try{for(const width of [1440,390]){const page=await b.newPage({viewport:{width,height:900}}),errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.route('**/*',r=>{const u=new URL(r.request().url());if(u.origin==='https://lead.test'){if(u.pathname==='/')return r.fulfill({contentType:'text/html',body:'<html lang="ar" dir="rtl"><main id="view-container" class="view"></main></html>'});const f=path.resolve('.'+u.pathname);if(f.startsWith(path.resolve('assets')+path.sep)&&fs.existsSync(f))return r.fulfill({path:f});}return r.abort();});
 await page.goto('https://lead.test/');for(const f of ['styles','dashboard-theme','comments-workspace'])await page.addStyleTag({url:'/assets/css/'+f+'.css'});
 await page.evaluate(()=>{window.calls=[];window.opened=[];window.setInterval=()=>0;window.prompts=[];window.prompt=(m)=>{prompts.push(m);return '01000000009';};window.confirm=()=>true;window.alert=x=>{throw Error(x);};window.SSMPDToast={show(){}};
  window.SSMPDRenderLeads={openLeadById:id=>opened.push(id)};const ago=m=>new Date(Date.now()-m*60000).toISOString();
  const rows=[{id:'a',conversation_id:'t_1',platform:'facebook',brand:'sono',sender_id:'U1',sender_name:'Samy Riyad',is_page:false,message:'عايز أحجز',status:'replied',sent_at:ago(30),conversation_url:'https://www.facebook.com/x'},
   {id:'b',conversation_id:'t_2',platform:'instagram',brand:'sono',sender_id:'U2',sender_name:'Nabila',is_page:false,message:'سعر التنظيف؟',status:'new',sent_at:ago(10)}];
  window.fixtures={social_messages:rows,social_comments:[],social_reply_templates:[],content_items:[],admins:[]};window.SSMPDAuth={currentAdmin:{id:'A1',role:'super_admin'}};
  const lead={id:'L1',name:'Samy Riyad',phone:'+201000000001',source:'messenger',status:'in_progress',campaign:'رمضان',assigned:'سارة',created_at:'2026-11-20T10:00:00Z',last_attempt:{at:'2026-11-21T10:00:00Z',result:'no_answer'},can_open:true,linked:true};
  window.SSMPDDb={client:{from:n=>{const q={select(){return q;},order(){return q;},limit(){return q;},eq(){return q;},in(){return q;},is(){return q;},gte(){return q;},maybeSingle(){return q;},then(ok,bad){return Promise.resolve({data:fixtures[n]||[],error:null}).then(ok,bad);}};return q;},
   channel:()=>({on(){return this;},subscribe(){return this;}}),removeChannel(){},
   rpc:async(n,p)=>{calls.push([n,p]);if(n==='social_conversation_lead')return {data:{lead:p.p_conversation_id==='t_1'?lead:null}};
     if(n==='social_conversation_lead_create')return {data:{ok:true,existing:false,lead:{...lead,id:'L2',name:'Nabila',source:'instagram',status:'new',assigned:'علي',last_attempt:null,campaign:null,can_open:false,phone:null}}};return {data:true};},functions:{invoke:async()=>({data:{ok:true}})}}};});
 await page.addScriptTag({path:'assets/js/render-comments.js'});await page.evaluate(()=>SSMPDRenderComments.render(document.querySelector('main')));
 await page.locator('[data-section="messages"]').click();await page.waitForSelector('.cm-conv');
 await page.locator('.cm-conv',{hasText:'Samy Riyad'}).click();if(width<1100)await page.locator('[data-cm-info]').click();
 await page.waitForSelector('[data-lead-open]');const card=await page.locator('.cm-lead-open').innerText();
 assert.match(card,/قيد المتابعة/);assert.match(card,/سارة/);assert.match(card,/ماسنجر · حملة رمضان/);assert.match(card,/21 نوفمبر · مردش/);assert(!/[٠-٩]/.test(card),'English digits');
 await page.locator('[data-lead-open]').click();assert.deepEqual(await page.evaluate(()=>opened),['L1']);
 if(width<1100){await page.locator('.cm-sheet-close').click();await page.locator('[data-cm-back]').click();}
 await page.locator('.cm-conv',{hasText:'Nabila'}).click();if(width<1100)await page.locator('[data-cm-info]').click();
 await page.waitForSelector('[data-lead-create]');assert.match(await page.locator('.cm-lead-none').innerText(),/مفيش ليد/);
 await page.locator('[data-lead-create]').click();await page.waitForSelector('.cm-lead-note >> text=تفاصيل الليد بتتفتح لخدمة العملاء والإدارة.');
 assert.deepEqual(await page.evaluate(()=>calls.find(c=>c[0]==='social_conversation_lead_create')[1]),{p_conversation_id:'t_2',p_phone:'01000000009',p_service:null});
 assert.match(await page.evaluate(()=>prompts[0]),/^تأكيد: اعمل ليد لـ «Nabila»/);assert.equal(await page.locator('[data-lead-open]').count(),0,'read-only when can_open is false');
 assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'no sideways scroll');
 for(const e of await page.locator('.cm-lead-st,.cm-lead .btn').all())assert(await e.evaluate(x=>x.scrollWidth<=x.clientWidth+1),'no clipped chip');
 assert.deepEqual(errors,[]);await page.close();}}finally{await b.close();}
}
(async()=>{await sql();await ui();console.log('PASS chat lead card: lookup link→flow→ingest→WhatsApp phone, inbox-only access, can_open = leads RLS, create (WhatsApp phone / missing_data / open duplicate linked / least-busy agent), rollback; UI card + open + create at 1440/390.');})().catch(e=>{console.error(e);process.exit(1);});
