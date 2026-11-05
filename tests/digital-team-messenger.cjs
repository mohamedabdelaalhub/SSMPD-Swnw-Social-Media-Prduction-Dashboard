const assert=require('node:assert/strict');
const fs=require('node:fs');
const {JSDOM}=require('jsdom');
const sleep=t=>new Promise(r=>setTimeout(r,t));
async function test(){
 const dom=new JSDOM('<!doctype html><html lang="ar"><body><section class="digital-team"></section></body></html>',{url:'https://test.invalid',runScripts:'outside-only'});
 const w=dom.window,d=w.document;
 let threads=[],participants=[],messages=[],rules=[],schedules=[],sent=[],replyCalls=0;
 w.SSMPDDigitalTeam={isOwner:()=>true};
 w.SSMPDAuth={currentAdmin:{name:'محمد عبدالعال'}};
 w.SSMPD_CONFIG={supabase:{url:'https://fake.invalid',anonKey:'test'}};
 const q=(table)=>{
  const o={filters:{},select(){return this;},eq(k,v){this.filters[k]=v;return this;},in(k,v){this.filters[k]=v;return this;},order(){return this;},limit(){
   let data={digital_chat_threads:threads,digital_chat_participants:participants,digital_chat_messages:messages,digital_chat_instructions:rules,digital_chat_schedules:schedules}[table]||[];
   for(const k in this.filters){const v=this.filters[k];data=data.filter(x=>Array.isArray(v)?v.includes(x[k]):x[k]===v);}
   return Promise.resolve({data:data.slice().reverse(),error:null});
  }};return o;
 };
 const db={
  from:q,
  rpc:async(name,args)=>{
   if(name==='digital_chat_create'){
    const id='00000000-0000-0000-0000-'+String(threads.length+1).padStart(12,'0');
    threads.push({id,title:args.p_title,updated_at:new Date().toISOString()});
    participants.push(...args.p_agents.map(code=>({thread_id:id,agent_code:code})));
    return{data:id,error:null};
   }
   if(name==='digital_chat_send'){
    const id='10000000-0000-0000-0000-'+String(messages.length+1).padStart(12,'0');
    messages.push({id,thread_id:args.p_thread,sender_type:'owner',agent_code:null,kind:args.p_kind,body:args.p_body,process_state:'queued',created_at:new Date().toISOString()});
    sent.push(args);
    if(args.p_save_instruction)rules.push(...participants.filter(x=>x.thread_id===args.p_thread).map(x=>({id:'mem'+rules.length,thread_id:args.p_thread,agent_code:x.agent_code,body:args.p_body,status:'advisory_active'})));
    if(args.p_frequency)schedules.push(...participants.filter(x=>x.thread_id===args.p_thread).map(x=>({id:'job'+schedules.length,thread_id:args.p_thread,agent_code:x.agent_code,prompt:args.p_body,frequency:args.p_frequency,next_run_at:args.p_first_run,enabled:true,status:'advisory_only'})));
    return {data:{message_id:id},error:null};
   }
   if(name==='digital_chat_set_instruction'||name==='digital_chat_set_schedule')return {data:true,error:null};
   throw Error('Unexpected RPC '+name);
  },
  functions:{invoke:async(name,args)=>{
   assert.equal(name,'digital-chat-reply');
   replyCalls++;
   const msg=messages.find(x=>x.id===args.body.message_id);
   const agentCodes=participants.filter(x=>x.thread_id===msg.thread_id).map(x=>x.agent_code);
   const replies=agentCodes.map(code=>{
    messages.push({id:'rep-'+code+messages.length,thread_id:msg.thread_id,sender_type:code==='claude_creative'||code==='hapi'?'system':'agent',agent_code:code,kind:'reply',body:code==='hapi'?'محرك حابي لم يستلم':'أهلًا، وصلتني الرسالة',process_state:'complete',created_at:new Date().toISOString()});
    return {agent:code,state:'responded'};
   });
   return {data:{ok:true,replies,external_actions_executed:false},error:null};
  }}
 };
 w.supabase={createClient:()=>db};
 w.eval(fs.readFileSync('assets/js/digital-team-chat.js','utf8'));
 w.dispatchEvent(new w.Event('ssmpd-digital-team-rendered'));
 await sleep(15);
 assert(d.querySelector('[data-chat-launcher]'),'chat launcher appears');
 await w.SSMPDDigitalChat.openDirect('nefer');await sleep(45);
 assert.equal(threads.length,1,'one direct thread created');
 const p=d.querySelector('[data-chat-window]'),form=p.querySelector('[data-chat-compose]');
 assert.equal(p.hidden,false);
 form.elements.body.value='مساء الخير';
 form.dispatchEvent(new w.Event('submit',{bubbles:true,cancelable:true}));
 await sleep(100);
 assert.equal(replyCalls,1,'response requested');
 assert(p.textContent.includes('محمد عبدالعال'),'real owner display name');
 assert(p.textContent.includes('أهلًا، وصلتني الرسالة'),'individual answer displayed');
 form.elements.kind.value='instruction';form.elements.kind.dispatchEvent(new w.Event('change'));
 assert(!form.querySelector('[data-chat-memory]').hidden);
 form.elements.memorize.checked=true;form.elements.body.value='راجع بيانات الحملات قبل تقديم توصية';
 form.dispatchEvent(new w.Event('submit',{bubbles:true,cancelable:true}));
 await sleep(100);
 assert.equal(rules.length,1,'standing instruction stored');
 assert(sent.some(x=>x.p_save_instruction===true),'memory toggle used');
 form.elements.kind.value='task';form.elements.kind.dispatchEvent(new w.Event('change'));
 form.elements.repeat.checked=true;form.elements.repeat.dispatchEvent(new w.Event('change'));
 form.elements.body.value='تقرير متابعة مبيعات يومي';
 form.dispatchEvent(new w.Event('submit',{bubbles:true,cancelable:true}));await sleep(110);
 assert.equal(schedules.length,1,'recurring task stored');
 assert.equal(schedules[0].frequency,'daily');
 w.SSMPDDigitalChat.openGroup();await sleep(15);
 const checks=p.querySelectorAll('[data-chat-person]');checks.forEach(x=>{x.checked=['sia','hor','hotep'].includes(x.value);});
 p.querySelector('[data-chat-start]').click();await sleep(85);
 assert.equal(threads.length,2);
 assert.equal(participants.filter(x=>x.thread_id===threads[1].id).length,3,'selected agents only in group');
 form.elements.kind.value='chat';form.elements.body.value='مساء الخير يا فريق';
 form.dispatchEvent(new w.Event('submit',{bubbles:true,cancelable:true}));await sleep(110);
 assert.equal(replyCalls,4,'multi-agent replies generated');
 assert(p.textContent.includes('حتب'),'group agent visible');
 p.querySelector('[data-chat-close]').click();
 assert.equal(p.hidden,true);
 dom.window.close();
 console.log('PASS direct and group Messenger, owner identity, durable instructions and recurring tasks');
}
test().catch(e=>{console.error(e);process.exit(1);});