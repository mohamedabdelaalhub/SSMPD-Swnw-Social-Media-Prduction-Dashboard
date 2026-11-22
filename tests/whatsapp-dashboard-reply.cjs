// WhatsApp replies from the dashboard (owner 2026-11-22: «عايز الرد على الواتساب من الداشبورد»).
// 1) migration 20261122170000 on PGlite: enqueue (24h window, template allow-list, text limits), lease/ack, sweep, templates refresh,
//    bot_state flip on ack, privileges (service_role only).
// 2) whatsapp-sync edge logic (sync.ts): customer/bot/staff turns -> social_messages, waiting rows answered, lease/ack/templates pass-through.
// 3) meta-comments routes WhatsApp to the queue (whatsapp.ts) behind the staff role check; Messenger sends carry the dashboard tag.
// 4) UI: chip «البوت شغّال / موظف ماسك المحادثة», queued send waits for the agent, «رجّع للبوت», template picker after 24h.
const fs=require('fs'),path=require('path'),vm=require('vm'),assert=require('node:assert/strict'),ts=require('typescript');
const J=x=>JSON.parse(JSON.stringify(x));
async function migration(){
 const {PGlite}=require('@electric-sql/pglite');const db=new PGlite();
 await db.exec(`create role anon;create role authenticated;create role service_role;
  create table public.admins(id uuid primary key default gen_random_uuid(),name text);
  create table public.social_messages(id text primary key,platform text not null,brand text not null,conversation_id text not null,conversation_url text,sender_id text,sender_name text,is_page boolean not null default false,message text not null default '',sent_at timestamptz,status text not null default 'new',sent_by uuid,updated_at timestamptz not null default now());`);
 await db.exec(fs.readFileSync('supabase/migrations/20261122170000_whatsapp_dashboard_reply.sql','utf8'));
 const [adm]=(await db.query(`insert into admins(name) values('منى') returning id`)).rows;
 await db.exec(`insert into social_messages(id,platform,brand,conversation_id,is_page,message,sent_at) values
  ('whatsapp:a','whatsapp','sono','whatsapp:201000000001',false,'السلام عليكم',now()-interval '2 hours'),
  ('whatsapp:b','whatsapp','sono','whatsapp:201000000001',true,'أهلاً',now()-interval '1 hour'),
  ('whatsapp:c','whatsapp','sono','whatsapp:201000000002',false,'شكراً',now()-interval '30 hours');`);
 const q=async(sql,p=[])=>(await db.query(sql,p)).rows[0];
 const enq=async(type,conv,text=null,tn=null,tl=null)=>(await q(`select public.whatsapp_outbox_enqueue($1,$2,$3,$4,$5,$6) r`,[type,conv,adm.id,text,tn,tl])).r;
 const api=async(a,p)=>(await q(`select public.whatsapp_outbox_api($1,$2::jsonb) r`,[a,JSON.stringify(p||{})])).r;
 let r=await enq('send','whatsapp:201000000001','  تمام يا فندم  ');assert.equal(r.ok,true);const id1=r.id;
 assert.equal((await enq('send','whatsapp:201000000002','متأخر')).error,'WINDOW_CLOSED');
 assert.match((await enq('send','whatsapp:201000000002','متأخر')).message,/إلا بقالب معتمد/);
 assert.equal((await enq('send','whatsapp:201000000001','   ')).error,'اكتب الرسالة الأول');
 assert.match((await enq('send','whatsapp:201000000001','ا'.repeat(4001))).error,/4000/);
 assert.equal((await enq('send','facebook:123','x')).error,'المحادثة مش واتساب');
 assert.match((await enq('send','whatsapp:209999999999','x')).error,/مفيش رسالة من العميل/);
 assert.match((await enq('template','whatsapp:201000000002',null,'followup','ar')).error,/مش في قايمة القوالب/);
 assert.equal((await api('templates',{templates:[{name:'followup',language:'ar',category:'UTILITY',text:'حابين نطمن على حضرتك'},{name:'',language:'ar'}]})).ok,true);
 assert.deepEqual(J((await q(`select public.whatsapp_templates_list() r`)).r),[{name:'followup',language:'ar',category:'UTILITY',text:'حابين نطمن على حضرتك'}]);
 r=await enq('template','whatsapp:201000000002',null,'followup','ar');assert.equal(r.ok,true,'template allowed outside 24h');const id2=r.id;
 r=await enq('return','whatsapp:201000000001');assert.equal(r.ok,true);const id3=r.id;
 const lease=await api('lease',{limit:10});assert.equal(lease.commands.length,3);
 assert.deepEqual(J(lease.commands[0]),{id:id1,type:'send',wa_id:'201000000001',text:'تمام يا فندم',sent_by:adm.id});
 assert.deepEqual(J(lease.commands[1]),{id:id2,type:'template',wa_id:'201000000002',template_name:'followup',template_language:'ar',sent_by:adm.id});
 assert.equal((await api('lease',{})).commands.length,0,'leased rows are not handed out twice');
 assert.equal((await api('ack',{id:id1,status:'sent'})).ok,true);assert.equal((await api('ack',{id:id1,status:'sent'})).ok,false,'ack once');
 assert.equal((await q(`select bot_state from social_messages where id='whatsapp:b'`)).bot_state,'human','staff send -> human');
 assert.equal((await api('ack',{id:id3,status:'sent'})).ok,true);assert.equal((await q(`select bot_state from social_messages where id='whatsapp:b'`)).bot_state,'ai','return -> ai');
 await api('ack',{id:id2,status:'failed',error:'ميتا رفضت'});
 assert.deepEqual(J((await q(`select public.whatsapp_outbox_get($1) r`,[id2])).r),{status:'failed',error:'ميتا رفضت'});
 // stale lease goes back to the queue; anything open after 10 minutes fails
 r=await enq('send','whatsapp:201000000001','تاني');await api('lease',{});await db.query(`update ops_private.whatsapp_outbox set leased_at=now()-interval '3 minutes' where id=$1`,[r.id]);
 assert.equal((await q(`select public.whatsapp_outbox_get($1) r`,[r.id])).r.status,'queued');
 await db.query(`update ops_private.whatsapp_outbox set created_at=now()-interval '11 minutes' where id=$1`,[r.id]);
 assert.equal((await q(`select public.whatsapp_outbox_get($1) r`,[r.id])).r.status,'failed');
 const grants=(await db.query(`select p.proname, has_function_privilege('authenticated',p.oid,'execute') a, has_function_privilege('anon',p.oid,'execute') n, has_function_privilege('service_role',p.oid,'execute') s from pg_proc p where proname like 'whatsapp_%'`)).rows;
 assert.equal(grants.length,5);for(const g of grants){assert.equal(g.a,false,g.proname);assert.equal(g.n,false,g.proname);if(g.proname!=='whatsapp_outbox_sweep')assert.equal(g.s,true,g.proname);}
 assert.equal((await q(`select has_table_privilege('authenticated','ops_private.whatsapp_outbox','select') x`)).x,false);
 await db.exec(fs.readFileSync('supabase/rollbacks/20261122170000_whatsapp_dashboard_reply.rollback.sql','utf8'));
 assert.equal((await q(`select count(*)::int n from information_schema.columns where table_name='social_messages' and column_name='bot_state'`)).n,0,'rollback clean');
}
function loadTs(file,extra={}){const js=ts.transpileModule(fs.readFileSync(file,'utf8').replace(/^import .*$/gm,''),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
 const sb={exports:{},module:{},crypto:{randomUUID:()=>'uuid-1'},JSON,Date,String,Number,Array,Promise,isNaN,...extra};sb.module.exports=sb.exports;vm.runInNewContext(js,sb);return sb.exports;}
function fakeDb(){const log=[];const q=(table)=>{const st={table,eq:[]};const api={select(){return api;},eq(k,v){st.eq.push([k,v]);return api;},lte(k,v){st.lte=[k,v];return api;},
 maybeSingle(){return Promise.resolve({data:table==='admins'&&st.eq[0][1]==='11111111-1111-4111-8111-111111111111'?{id:st.eq[0][1]}:null});},
 upsert(row,o){log.push({op:'upsert',row,o});return Promise.resolve({error:null});},update(row){st.update=row;return api;},
 then(ok,bad){if(st.update)log.push({op:'update',row:st.update,eq:st.eq,lte:st.lte});return Promise.resolve({error:null}).then(ok,bad);}};return api;};
 return {log,db:{from:q,rpc:async(n,p)=>{log.push({op:'rpc',n,p});return {data:{ok:true,commands:[]},error:null};}}};}
async function edge(){
 const m=loadTs('supabase/functions/whatsapp-sync/sync.ts');
 let f=fakeDb(),r=await m.handle(f.db,{direction:'in',wa_id:'+20 100-000-0001',name:'أم محمد',text:'عايزة أحجز',message_id:'wamid.AB=',at:'2026-11-22T18:00:00Z',bot_state:'ai'});
 assert.equal(r.status,200);const row=f.log[0].row;
 assert.deepEqual(J(row),{...J(row),id:'whatsapp:wamid.AB=',platform:'whatsapp',brand:'sono',conversation_id:'whatsapp:201000000001',conversation_url:'https://wa.me/201000000001',sender_id:'201000000001',sender_name:'أم محمد',is_page:false,message:'عايزة أحجز',status:'new',bot_state:'ai'});
 assert.equal(f.log[0].o.ignoreDuplicates,true);assert.equal(f.log.length,1,'inbound does not touch other rows');
 f=fakeDb();await m.handle(f.db,{direction:'out',wa_id:'201000000001',text:'تمام',by:'human',operator_id:'11111111-1111-4111-8111-111111111111',bot_state:'human'});
 const out=f.log.find(x=>x.op==='upsert').row;assert.equal(out.is_page,true);assert.equal(out.sent_by,'11111111-1111-4111-8111-111111111111');assert.equal(out.id,'whatsapp:out-uuid-1');assert.equal(out.bot_state,'human');
 const upd=f.log.find(x=>x.op==='update');assert.equal(upd.row.status,'replied');assert.equal(upd.row.sent_by,'11111111-1111-4111-8111-111111111111');assert.deepEqual(J(upd.eq),[['conversation_id','whatsapp:201000000001'],['is_page',false],['status','new']]);
 f=fakeDb();await m.handle(f.db,{direction:'out',wa_id:'201000000001',text:'رد البوت',by:'ai',operator_id:'22222222-2222-4222-8222-222222222222',bot_state:'ai'});
 assert.equal(f.log.find(x=>x.op==='upsert').row.sent_by,undefined,'unknown/ai operator not stored');
 for(const bad of [{direction:'in',wa_id:'12',text:'x'},{direction:'x',wa_id:'201000000001',text:'x'},{direction:'in',wa_id:'201000000001',text:'  '}])assert.equal((await m.handle(fakeDb().db,bad)).status,400);
 f=fakeDb();await m.handle(f.db,{action:'lease',limit:5});await m.handle(f.db,{action:'ack',id:'x',status:'sent'});await m.handle(f.db,{action:'templates',templates:[]});
 assert.deepEqual(J(f.log.map(x=>[x.n,x.p])),[['whatsapp_outbox_api',{p_action:'lease',p_payload:{limit:5}}],['whatsapp_outbox_api',{p_action:'ack',p_payload:{id:'x',status:'sent',error:null}}],['whatsapp_outbox_api',{p_action:'templates',p_payload:{templates:[]}}]]);
 assert.equal((await m.handle(fakeDb().db,{action:'drop'})).status,400);
 const idx=fs.readFileSync('supabase/functions/whatsapp-sync/index.ts','utf8');assert.match(idx,/safeEqual\(req\.headers\.get\("X-WhatsApp-Alert-Secret"\)/);assert.match(idx,/WHATSAPP_ALERT_SECRET/);
 // meta-comments
 const w=loadTs('supabase/functions/meta-comments/whatsapp.ts');const calls=[];const db={rpc:async(n,p)=>{calls.push([n,p]);return {data:n==='whatsapp_templates_list'?[{name:'followup'}]:{ok:true,id:'q1'},error:null};}};
 assert.deepEqual(J(await w.queueText(db,{conversationId:'whatsapp:201000000001',text:'هاي',adminId:'A'})),{ok:true,id:'q1',queued:true});
 await w.queueTemplate(db,{conversationId:'whatsapp:201000000001',name:'followup',language:'ar',adminId:'A'});await w.queueReturn(db,{conversationId:'whatsapp:201000000001',adminId:'A'});
 assert.deepEqual(J(calls.map(c=>c[1].p_type)),['send','template','return']);assert.deepEqual(J((await w.listTemplates(db)).templates),[{name:'followup'}]);
 assert.equal(w.isWhatsApp('whatsapp:201000000001'),true);assert.equal(w.isWhatsApp('t_123'),false);
 const mc=fs.readFileSync('supabase/functions/meta-comments/index.ts','utf8'),gate=mc.indexOf('["page_manager", "approver", "general_manager", "super_admin"]');
 for(const a of ['"list_templates"','"send_template"','"return_to_bot"','"outbox_status"','isWhatsApp(body.conversation_id)'])assert(mc.indexOf(a)>gate,a+' behind the role check');
 assert(mc.indexOf('isWhatsApp(body.conversation_id)) return reply(await queueText')<mc.indexOf('sendManualMessage(db,'),'WhatsApp routed before the Messenger send');
}
async function ui(){
 const {chromium}=require('playwright');const browser=await chromium.launch();
 try{for(const width of [1280,390]){const page=await browser.newPage({viewport:{width,height:900}}),errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.route('**/*',r=>{const u=new URL(r.request().url());if(u.origin==='https://wa.test'){if(u.pathname==='/')return r.fulfill({contentType:'text/html',body:'<html lang="ar" dir="rtl"><main id="view-container" class="view"></main></html>'});const f=path.resolve('.'+u.pathname);if(f.startsWith(path.resolve('assets')+path.sep)&&fs.existsSync(f))return r.fulfill({path:f});}return r.abort();});
 await page.goto('https://wa.test/');for(const f of ['styles','dashboard-theme','comments-workspace'])await page.addStyleTag({url:'/assets/css/'+f+'.css'});
 await page.evaluate(()=>{window.calls=[];window.setInterval=()=>0;const nt=window.setTimeout;window.setTimeout=(fn,ms,...a)=>nt(fn,ms===3000?10:ms,...a);window.confirm=()=>true;window.alerts=[];window.alert=x=>alerts.push(x);window.toasts=[];window.SSMPDToast={show:x=>toasts.push(x)};
  const ago=m=>new Date(Date.now()-m*60000).toISOString(),old=h=>new Date(Date.now()-h*3600e3).toISOString();
  const rows=[{id:'whatsapp:1',conversation_id:'whatsapp:201000000001',platform:'whatsapp',brand:'sono',sender_id:'201000000001',sender_name:'أم محمد',is_page:false,message:'عايزة أحجز علاج طبيعي',status:'replied',sent_at:ago(40),bot_state:'ai'},
   {id:'whatsapp:2',conversation_id:'whatsapp:201000000001',platform:'whatsapp',brand:'sono',sender_id:'page',is_page:true,message:'أهلاً بحضرتك، إيه الوقت المناسب؟',status:'replied',sent_at:ago(39),bot_state:'ai'},
   {id:'whatsapp:3',conversation_id:'whatsapp:201000000001',platform:'whatsapp',brand:'sono',sender_id:'page',is_page:true,sent_by:'A2',message:'الدكتورة متاحة السبت',status:'replied',sent_at:ago(10),bot_state:'human'},
   {id:'whatsapp:4',conversation_id:'whatsapp:201000000002',platform:'whatsapp',brand:'sono',sender_id:'201000000002',sender_name:'ميدو',is_page:false,message:'شكراً',status:'replied',sent_at:old(30),bot_state:'ai'}];
  window.fixtures={social_messages:rows.sort((a,b)=>b.sent_at.localeCompare(a.sent_at)),social_comments:[],social_reply_templates:[],content_items:[],admins:[{id:'A2',name:'منى'}]};
  window.SSMPDAuth={currentAdmin:{id:'A1',role:'super_admin'}};
  window.SSMPDDb={client:{from:name=>{const q={select(){return q;},order(){return q;},limit(){return q;},eq(){return q;},in(){return q;},is(){return q;},gte(){return q;},maybeSingle(){return q;},then(ok,bad){return Promise.resolve({data:fixtures[name]||[],error:null}).then(ok,bad);}};return q;},
   rpc:async()=>({data:true}),channel:()=>({on(){return this;},subscribe(){return this;}}),removeChannel(){},
   functions:{invoke:async(n,p)=>{const b=p.body;calls.push(b);if(b.action==='list_templates')return {data:{ok:true,templates:[{name:'followup',language:'ar',text:'حابين نطمن على حضرتك'}]}};
     if(b.action==='outbox_status')return {data:{ok:true,status:b.id==='q-fail'?'failed':'sent',error:b.id==='q-fail'?'ميتا رفضت الإرسال':null}};
     if(['send_message','send_template','return_to_bot'].includes(b.action))return {data:{ok:true,queued:true,id:b.action==='send_template'?'q-fail':'q-ok'}};return {data:{ok:true,text:'رد مقترح'}};}}}};});
 await page.addScriptTag({path:'assets/js/render-comments.js'});
 await page.evaluate(()=>SSMPDRenderComments.render(document.querySelector('main')));
 await page.waitForSelector('[data-section="messages"]');await page.locator('[data-section="messages"]').click();await page.waitForSelector('.cm-conv');
 await page.locator('.cm-conv',{hasText:'أم محمد'}).click();await page.waitForSelector('.cm-chat-head');
 if(width>760)assert.equal(await page.locator('.cm-chat-head .cm-bot.human').innerText(),'موظف ماسك المحادثة');
 assert.deepEqual(await page.locator('.cm-chat-pane .cm-b.me .cm-b-who').allInnerTexts(),['البوت','منى'],'bot vs staff on bubbles');
 assert.match(await page.locator('.cm-chat-pane .cm-hint').innerText(),/البوت ساكت/);
 await page.locator('.cm-chat-pane .cm-input').fill('تمام، هنأكد مع حضرتك');await page.locator('[data-msend]').click();
 await page.waitForFunction(()=>toasts.includes('اتبعتت على واتساب'));
 assert.deepEqual(await page.evaluate(()=>calls.slice(0,2)),[{action:'send_message',conversation_id:'whatsapp:201000000001',text:'تمام، هنأكد مع حضرتك'},{action:'outbox_status',id:'q-ok'}]);
 await page.waitForSelector('[data-wa-return]');await page.locator('[data-wa-return]').click();await page.waitForFunction(()=>calls.some(c=>c.action==='return_to_bot'));
 assert.deepEqual(await page.evaluate(()=>calls.find(c=>c.action==='return_to_bot')),{action:'return_to_bot',conversation_id:'whatsapp:201000000001'});
 if(width<=760)await page.locator('[data-cm-back]').click();
 await page.locator('.cm-conv',{hasText:'ميدو'}).click();await page.waitForSelector('[data-wa-load-tpl]');assert.equal(await page.locator('.cm-chat-pane [data-msend]').count(),0);
 await page.locator('[data-wa-load-tpl]').click();await page.waitForSelector('[data-wa-tpl="followup"]');assert.match(await page.locator('.cm-tpl').innerText(),/حابين نطمن/);
 await page.locator('[data-wa-tpl="followup"]').click();await page.waitForFunction(()=>alerts.length===1);
 assert.deepEqual(await page.evaluate(()=>calls.find(c=>c.action==='send_template')),{action:'send_template',conversation_id:'whatsapp:201000000002',name:'followup',language:'ar'});
 assert.equal(await page.evaluate(()=>alerts[0]),'ميتا رفضت الإرسال','failed send told in Arabic');
 assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'no sideways scroll');
 const txt=await page.locator('.cm-wrap').innerText();assert(!/[٠-٩]/.test(txt),'English digits');assert.deepEqual(errors,[]);await page.close();}}finally{await browser.close();}
}
(async()=>{await migration();await edge();await ui();
 console.log('PASS WhatsApp dashboard reply: outbox migration (24h window, template allow-list, lease/ack once, sweep, bot_state flip, service_role only, rollback), whatsapp-sync events + pass-through, meta-comments routing behind role gate, UI chip/queued send/return/templates at 1280+390.');})().catch(e=>{console.error(e);process.exit(1);});
