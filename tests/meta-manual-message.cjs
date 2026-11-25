// Manual Messenger / Instagram Direct reply from the dashboard (owner 2026-11-22): meta-comments action send_message.
// Checks: 24h window («عدّى 24 ساعة…»), Graph call shape (page/messages, RESPONSE, page token), page row saved with sent_by,
// waiting customer rows marked replied with sent_by, WhatsApp / empty / too long refused, Graph error surfaced in Arabic,
// and index.ts gates both new actions behind the same staff roles as comment approval.
const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict'),ts=require('typescript');
const src=fs.readFileSync('supabase/functions/meta-comments/messages.ts','utf8').replace(/^import .*$/gm,'');
const js=ts.transpileModule(src,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
const gjs=ts.transpileModule(fs.readFileSync('supabase/functions/meta-comments/graph.ts','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
function load(fetchImpl){const gsb={exports:{},module:{},fetch:fetchImpl,URL,URLSearchParams,JSON,String,Number,Promise,AbortSignal,Error,Math};gsb.module.exports=gsb.exports;vm.runInNewContext(gjs,gsb);
 const sb={exports:{},module:{},fetch:fetchImpl,gget:gsb.exports.gget,gpostJson:gsb.exports.gpostJson,URL,JSON,Date,String,Number,Set,Promise,console,
 decideReply:async()=>({ok:true,reply:'رد مقترح'}),clinicInfo:async()=>'',advance:()=>({}),serviceLabel:x=>x,reviewHandoffs:async()=>{}};sb.module.exports=sb.exports;vm.runInNewContext(js,sb);return sb.exports;}
function fakeDb(rows){const writes=[];const q=(table)=>{const st={table,filters:{}};const api={select(){return api;},eq(k,v){st.filters[k]=v;return api;},order(){return api;},limit(){return api;},in(k,v){st.in=[k,v];return api;},
  maybeSingle(){return Promise.resolve({data:table==='meta_brand_config'?{facebook_page_id:'PAGE1'}:null,error:null});},
  upsert(row,o){writes.push({op:'upsert',table,row,o});return Promise.resolve({error:null});},update(row){st.update=row;return api;},
  then(ok,bad){if(st.update){writes.push({op:'update',table,row:st.update,in:st.in});return Promise.resolve({error:null}).then(ok,bad);}return Promise.resolve({data:rows.filter(r=>r.conversation_id===st.filters.conversation_id).sort((a,b)=>b.sent_at.localeCompare(a.sent_at)),error:null}).then(ok,bad);}};return api;};return {db:{from:q},writes};}
const NOW=Date.parse('2026-11-22T18:00:00Z'),ago=h=>new Date(NOW-h*3600e3).toISOString();
const conv=(plat,lastH)=>[{id:plat+':a',conversation_id:'C',platform:plat,brand:'sono',is_page:false,sender_id:'U9',message:'السلام عليكم',sent_at:ago(lastH+1),status:'replied',conversation_url:'https://www.facebook.com/x'},
 {id:plat+':b',conversation_id:'C',platform:plat,brand:'sono',is_page:true,sender_id:'PAGE1',message:'أهلاً',sent_at:ago(lastH+0.5),status:'replied'},
 {id:plat+':c',conversation_id:'C',platform:plat,brand:'sono',is_page:false,sender_id:'U9',message:'بكام الكشف؟',sent_at:ago(lastH),status:'new',conversation_url:'https://www.facebook.com/x'}];
(async()=>{
 let calls=[];const okFetch=async(url,init)=>{calls.push({url,body:JSON.parse(init.body)});return {ok:true,json:async()=>({message_id:'m_77'})};};
 // 1) inside the window: sends, saves page row + who sent, marks the waiting customer row
 let m=load(okFetch),f=fakeDb(conv('facebook',2));
 let r=await m.sendManualMessage(f.db,{conversationId:'C',text:'  الكشف 400 جنيه  ',adminId:'ADM1',token:b=>b==='sono'?'TOKEN':null,now:NOW});
 assert.equal(r.ok,true,JSON.stringify(r));assert.equal(calls.length,1);
 assert.match(calls[0].url,/\/v26\.0\/PAGE1\/messages\?access_token=TOKEN$/);assert.deepEqual(JSON.parse(JSON.stringify(calls[0].body)),{recipient:{id:'U9'},messaging_type:'RESPONSE',message:{text:'الكشف 400 جنيه',metadata:'swnw-dashboard:ADM1'}});
 const up=f.writes.find(w=>w.op==='upsert');assert.equal(up.row.id,'facebook:m_77');assert.equal(up.row.is_page,true);assert.equal(up.row.sent_by,'ADM1');assert.equal(up.row.message,'الكشف 400 جنيه');
 const upd=f.writes.find(w=>w.op==='update');assert.deepEqual(JSON.parse(JSON.stringify(upd.in)),['id',['facebook:c']],'only the waiting customer message');assert.equal(upd.row.status,'replied');assert.equal(upd.row.sent_by,'ADM1');
 // 2) Instagram works the same way
 calls=[];m=load(okFetch);f=fakeDb(conv('instagram',23));r=await m.sendManualMessage(f.db,{conversationId:'C',text:'تمام',adminId:'ADM1',token:()=>'TOKEN',now:NOW});assert.equal(r.ok,true);assert.equal(calls.length,1);
 // 3) outside 24h: blocked with the Arabic note, nothing sent
 calls=[];m=load(okFetch);f=fakeDb(conv('facebook',25));r=await m.sendManualMessage(f.db,{conversationId:'C',text:'متأخر',adminId:'ADM1',token:()=>'TOKEN',now:NOW});
 assert.equal(r.ok,false);assert.equal(r.error,'WINDOW_CLOSED');assert.equal(r.message,'عدّى 24 ساعة من آخر رسالة للعميل — ميتا مش بتسمح بالرد');assert.equal(calls.length,0);assert.equal(f.writes.length,0);
 // 4) WhatsApp / empty / too long refused without a call
 f=fakeDb(conv('whatsapp',1));r=await m.sendManualMessage(f.db,{conversationId:'C',text:'x',adminId:'A',token:()=>'T',now:NOW});assert.equal(r.ok,false);assert.match(r.error,/ماسنجر وانستجرام/);
 r=await m.sendManualMessage(fakeDb(conv('facebook',1)).db,{conversationId:'C',text:'   ',adminId:'A',token:()=>'T',now:NOW});assert.equal(r.error,'اكتب الرسالة الأول');
 r=await m.sendManualMessage(fakeDb(conv('facebook',1)).db,{conversationId:'C',text:'ا'.repeat(2001),adminId:'A',token:()=>'T',now:NOW});assert.match(r.error,/2000/);
 r=await m.sendManualMessage(fakeDb(conv('facebook',1)).db,{conversationId:'C',text:'x',adminId:'A',token:()=>null,now:NOW});assert.match(r.error,/التوكن/);assert.equal(calls.length,0);
 // 5) Graph refuses: Arabic error, nothing saved
 m=load(async()=>({ok:false,json:async()=>({error:{message:'(#10) outside allowed window'}})}));f=fakeDb(conv('facebook',1));
 r=await m.sendManualMessage(f.db,{conversationId:'C',text:'x',adminId:'A',token:()=>'T',now:NOW});assert.equal(r.ok,false);assert.match(r.error,/^ميتا رفضت الإرسال: /);assert.equal(f.writes.length,0);
 // 6) suggest reads the waiting customer messages only
 r=await load(okFetch).suggestMessage(fakeDb(conv('facebook',1)).db,'C');assert.equal(r.ok,true);assert.equal(r.text,'رد مقترح');
 // 7) index.ts: both actions sit after the staff role check (page_manager/approver/general_manager/super_admin)
 const idx=fs.readFileSync('supabase/functions/meta-comments/index.ts','utf8');const gate=idx.indexOf('["page_manager", "approver", "general_manager", "super_admin"]');
 assert(gate>0&&idx.indexOf('"send_message"')>gate&&idx.indexOf('"suggest_message"')>gate,'new actions are behind the role check');assert(!/console\.log\([^)]*token/i.test(idx+src),'no token logging');
 const mig=fs.readFileSync('supabase/migrations/20261122140000_social_messages_manual_reply.sql','utf8');assert.match(mig,/add column if not exists sent_by uuid references public\.admins\(id\)/);
 console.log('PASS manual Messenger/Instagram reply: 24h window with Arabic note, RESPONSE send with page token, page row + waiting rows logged with sent_by, WhatsApp/empty/long/no-token refused, Graph error in Arabic, suggest, role gate.');
})().catch(e=>{console.error(e);process.exit(1);});
