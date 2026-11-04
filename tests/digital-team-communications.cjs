const assert=require('node:assert/strict');
const fs=require('node:fs');
const {JSDOM}=require('jsdom');
const sleep=t=>new Promise(r=>setTimeout(r,t));
async function main(){
 const dom=new JSDOM('<!doctype html><html lang="ar"><body><div class="digital-team" dir="rtl"></div></body></html>',{url:'https://test.invalid',runScripts:'outside-only'});
 const w=dom.window,d=w.document;
 let sends=[],invocations=[];
 let dispatches=[],events=[];
 const query=(table)=>{
  const q={filters:{},select(){return this;},eq(k,v){this.filters[k]=v;return this;},in(){return this;},order(){return this;},limit(){let data=table==='digital_team_dispatches'?dispatches:events;
   if(this.filters.recipient_code)data=data.filter(x=>x.recipient_code===this.filters.recipient_code);
   if(this.filters.message_kind)data=data.filter(x=>x.message_kind===this.filters.message_kind);
   return Promise.resolve({data,error:null});
  }};return q;
 };
 const client={rpc:async(name,payload)=>{
  if(name==='task_file_scan_overview')return {data:{counts:{pending:3,scanned:2},recent:[{id:'scan1',file_name:'تقرير.xlsx',state:'scanned',summary:'تم تحليل صفوف الملف',analysis:{findings:[]}}]},error:null};
  if(name!=='digital_team_send')throw Error('Bad RPC '+name);
  sends.push(payload);
  const keys=payload.p_targets;
  dispatches=keys.map((code,i)=>({id:'00000000-0000-0000-0000-'+String(i+1).padStart(12,'0'),recipient_code:code,message_kind:payload.p_kind,body:payload.p_body,state:'queued',created_at:new Date().toISOString()}));
  events=dispatches.map(x=>({id:'evt'+x.id,dispatch_id:x.id,from_agent_code:null,to_agent_code:x.recipient_code,message_type:'task',content:x.body,provenance:'owner',created_at:new Date().toISOString()}));
  return {data:{count:keys.length,dispatch_ids:dispatches.map(x=>x.id)},error:null};
 },from:query,
 functions:{invoke:async(name,args)=>{
  invocations.push({name,args});
  dispatches=dispatches.map(d=>({...d,state:d.recipient_code==='hapi'||d.recipient_code==='claude_creative'?'awaiting_runtime':'analysis_complete'}));
  events.push({id:'e99',dispatch_id:dispatches[0].id,from_agent_code:'sia',to_agent_code:'hotep',message_type:'handoff_request',content:'محتاج رأيك في شكاوى المرضى',provenance:'agent_ai',created_at:new Date().toISOString()});
  events.push({id:'e100',dispatch_id:dispatches[0].id,from_agent_code:'hotep',to_agent_code:'sia',message_type:'handoff_answer',content:'راجع شكوى المريض مع التشغيل',provenance:'agent_ai',created_at:new Date().toISOString()});
  return {data:{ok:true,dispatches:dispatches.map(x=>({id:x.id,state:x.state})),external_actions_executed:false},error:null};
 }}};
 w.SSMPDDigitalTeam={isOwner:()=>true};
 w.SSMPD_CONFIG={supabase:{url:'https://local.invalid',anonKey:'mock'}};
 w.supabase={createClient:()=>client};
 w.eval(fs.readFileSync('assets/js/digital-team-communications.js','utf8'));
 w.dispatchEvent(new w.Event('ssmpd-digital-team-rendered'));await sleep(40);
 assert(d.querySelector('[data-dtc-panel]'),'comms panel mounted');
 assert.equal(d.querySelectorAll('[data-dtc-form] option[value="all"]').length,1,'broadcast option');
 const form=d.querySelector('[data-dtc-form]');form.elements.recipient.value='all';form.elements.kind.value='task';
 form.elements.body.value='حللوا دورة الحجز وأرسلوا خطة عمل فردية';
 form.dispatchEvent(new w.Event('submit',{bubbles:true,cancelable:true}));
 await sleep(130);
 assert.equal(sends.length,1,'broadcast RPC used once');
 assert.equal(sends[0].p_targets.length,7,'all 7 members included');
 assert.equal(invocations.length,1,'coordination processor invoked');
 assert.equal(dispatches.length,7,'one auditable dispatch per recipient');
 assert(d.body.textContent.includes('محتاج رأيك في شكاوى المرضى'),'agent-to-agent handoff recorded');
 assert(d.body.textContent.includes('راجع شكوى المريض مع التشغيل'),'answer visible');
 assert(d.body.textContent.includes('المحرك التشغيلي غير مربوط'),'unintegrated legacy agent status truthful');
 assert(d.body.textContent.includes('تم تحليل صفوف الملف'),'autoscan summary visible without manual file scan');
 w.dispatchEvent(new w.Event('ssmpd-digital-team-rendered'));
 await sleep(25);
 assert.equal(d.querySelectorAll('[data-dtc-panel]').length,1,'no duplicate panel');
 dom.window.close();console.log('PASS digital team broadcast, 7 dispatches, real handoff feed and auto-file status');
}
main().catch(e=>{console.error(e);process.exit(1);});