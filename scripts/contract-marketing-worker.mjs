import fs from 'node:fs/promises';
import {renderContract} from './contract-template-renderer.mjs';
const endpoint='https://uuijfbpgvtdxgaosqpxo.supabase.co/functions/v1/contract-marketing';
const configPath=process.env.SWNW_CONTRACT_CONFIG;
if(!configPath)throw Error('SWNW_CONTRACT_CONFIG is required');
let busy=false;
async function tick(){if(busy)return;busy=true;let job,call;
 try{
  const config=JSON.parse((await fs.readFile(configPath,'utf8')).replace(/^\uFEFF/,''));if(!config.enabled)return;
  if(typeof config.secret!=='string'||config.secret.length<32)throw Error('Worker secret is not configured');
  call=async data=>{const r=await fetch(endpoint,{method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer '+config.secret},body:JSON.stringify(data),signal:AbortSignal.timeout(240000)});const result=await r.json();if(!r.ok)throw Error(result.error||'Worker request failed');return result;};
  const snapshot=await call({action:'snapshot'});
  for(const item of snapshot.items){try{const response=await fetch('http://127.0.0.1:8787/api/integrations/contracts',{method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer '+config.secret},body:JSON.stringify({...item,observedAt:snapshot.observedAt}),signal:AbortSignal.timeout(30000)});if(!response.ok)throw Error('Website contract synchronization failed: '+response.status);}catch(error){console.error('Contract card sync failed:',item.id,String(error.message).slice(0,100));}}
  const claim=await call({action:'claim'});if(!claim.job)return;job=claim.job;
  if(claim.profile.kind!=='doctor'){const e=new Error('قالب إعلان الجهات بانتظار الإضافة');e.code='TEMPLATE_NOT_READY';throw e;}
  const generated=await call({action:'generate',id:job.id,lease:job.lease});
  const response=await fetch(claim.image_url,{signal:AbortSignal.timeout(20000)});if(!response.ok)throw Error('تعذر تحميل الصورة');const bytes=Buffer.from(await response.arrayBuffer());if(bytes.length>5242880)throw Error('الصورة أكبر من الحد');
  const output=await renderContract({...claim.profile,name:claim.source.name},bytes,generated.idea);
  await call({action:'finish',id:job.id,lease:job.lease,image:{base64:output.bytes.toString('base64')},settings:output.settings});
  console.log('Contract announcement scheduled:',job.id);
 }catch(error){console.error('Contract automation:',String(error.message).slice(0,300));if(job&&call)try{await call({action:'fail',id:job.id,lease:job.lease,error:error.message,code:error.code});}catch{console.error('Could not record worker failure');}}
 finally{busy=false;}}
await tick();if(!process.argv.includes('--once'))setInterval(tick,60000);
