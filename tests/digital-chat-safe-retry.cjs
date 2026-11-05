const assert=require('node:assert/strict');
const fs=require('node:fs');
const {JSDOM}=require('jsdom');
const sql=fs.readFileSync('supabase/migrations/20261105041500_digital_chat_owner_safe_retry.sql','utf8');
assert(sql.includes('digital_chat_owner()'),'server checks owner');
assert(sql.includes("m.sender_type='owner'"),'retry only applies to owner messages');
assert(sql.includes('response.reply_to_id=m.id'),'no reprocessing when a reply exists');
assert(sql.includes("m.process_state='failed'"),'retry only failed or expired');
assert(sql.includes('revoke all on function public.digital_chat_retry(uuid)'),'no public execution');
const wait=ms=>new Promise(ok=>setTimeout(ok,ms));
async function main(){
 const dom=new JSDOM('<!doctype html><html><body><section class="digital-team"></section></body></html>',{url:'https://test.invalid',runScripts:'outside-only'});
 const w=dom.window,d=w.document,tid='aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',mid='bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';
 const now=new Date().toISOString();
 const threads=[{id:tid,title:'سيا',updated_at:now}],participants=[{thread_id:tid,agent_code:'sia'}];
 let messages=[{id:mid,thread_id:tid,sender_type:'owner',kind:'chat',body:'اختبار استرجاع الرد',process_state:'failed',created_at:now,verification:'owner'}];
 let retryCalls=0,invokeCalls=0,sendCalls=0;
 const lookup=table=>({filters:{},select(){return this;},eq(k,v){this.filters[k]=v;return this;},in(k,v){this.filters[k]=v;return this;},order(){return this;},then(resolve,reject){return this.limit().then(resolve,reject);},limit(){
  const data={digital_chat_threads:threads,digital_chat_participants:participants,digital_chat_messages:messages,digital_chat_instructions:[],digital_chat_schedules:[]}[table]||[];
  return Promise.resolve({data:data.filter(x=>Object.keys(this.filters).every(k=>Array.isArray(this.filters[k])?this.filters[k].includes(x[k]):x[k]===this.filters[k])).slice().reverse(),error:null});
 }});
 const client={
  from:lookup,
  rpc:async (name,p)=>{
   if(name==='digital_chat_create')return{data:tid,error:null};
   if(name==='digital_chat_retry'){retryCalls++;if(p.p_message!==mid||messages[0].process_state!=='failed')return{data:false,error:null};messages[0].process_state='queued';return{data:true,error:null};}
   if(name==='digital_chat_send'){sendCalls++;return{data:null,error:null};}
   throw Error('unexpected rpc '+name);
  },
  functions:{invoke:async(name,args)=>{
   assert.equal(name,'digital-chat-reply');assert.equal(args.body.message_id,mid);invokeCalls++;messages[0].process_state='complete';
   messages.push({id:'cccccccc-cccc-cccc-cccc-cccccccccccc',thread_id:tid,sender_type:'agent',agent_code:'sia',kind:'reply',body:'رد الاختبار',process_state:'complete',verification:'advisory',created_at:now});
   return{data:{ok:true},error:null};
  }}
 };
 w.SSMPDDigitalTeam={isOwner:()=>true};
 w.SSMPDAuth={currentAdmin:{name:'المالك'}};
 w.SSMPD_CONFIG={supabase:{url:'https://fake.invalid',anonKey:'test'}};
 w.supabase={createClient:()=>client};
 w.eval(fs.readFileSync('assets/js/digital-team-chat.js','utf8'));
 w.dispatchEvent(new w.Event('ssmpd-digital-team-rendered'));
 await w.SSMPDDigitalChat.openDirect('sia');await wait(65);
 const button=d.querySelector('[data-chat-retry]');
 if(!button)console.log('DEBUG_CHAT_RENDER',{status:d.querySelector('[data-chat-status]')?.textContent,thread:d.querySelector('[data-chat-threads]')?.textContent,body:d.querySelector('[data-chat-messages]')?.innerHTML?.slice(0,900)});
 assert(button,'failed owner bubble offers retry');
 button.click();await wait(70);
 assert.equal(retryCalls,1);assert.equal(invokeCalls,1);assert.equal(sendCalls,0,'no second owner message created');
 assert.equal(messages.length,2,'only one reply added');
 assert(!d.querySelector('[data-chat-retry]'),'retry disappears after success');
 dom.window.close();
 console.log('PASS owner-scoped chat retry UI, idempotent submission and SQL permission guard');
}
main().catch(e=>{console.error(e);process.exit(1);});
