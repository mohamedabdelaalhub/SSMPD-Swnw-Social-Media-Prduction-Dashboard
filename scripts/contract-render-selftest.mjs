// Contract welcome-post renderer self-test: NOTHING is published, scheduled or saved in the database.
// 1) draws a sample doctor post with the real template and fonts into a local PNG file;
// 2) proves the worker key is accepted by contract-marketing and content-ai, using a made-up job id that both
//    reject at the very first database check («انتهت صلاحية الطلب» / «طلب التعاقد غير متاح»), before any AI call or write.
// Usage: SWNW_CONTRACT_CONFIG=<config> node scripts/contract-render-selftest.mjs [output.png]
import crypto from 'node:crypto';import fs from 'node:fs/promises';import os from 'node:os';import path from 'node:path';
import {renderContract} from './contract-template-renderer.mjs';
const api='https://api.swnwclinics.com/functions/v1/';
const out=process.argv[2]||path.join(os.tmpdir(),'contract-render-selftest.png');
let failed=false;const report=(ok,what,detail)=>{if(!ok)failed=true;console.log((ok?'PASS ':'FAIL ')+what+(detail?' — '+detail:''));};
try{
 const root=new URL('../',import.meta.url);
 const photo=await fs.readFile(new URL('assets/design-templates/sono-doctor/background.webp',root));
 const r=await renderContract({kind:'doctor',name:'طبيب تجريبي',facts:{prefix:'الدكتور',title:'استشاري تجريبي — اختبار فقط',days:'السبت - الثلاثاء',time_from:'10:00',time_to:'14:00'}},photo,{doctor_brief:{name:'طبيب تجريبي'}});
 const ok=r.bytes.subarray(1,4).toString()==='PNG'&&r.settings.width===1080&&r.settings.height===1350;
 await fs.writeFile(out,r.bytes);report(ok,'render: sample doctor post drawn with the real template',out);
}catch(e){report(false,'render',String(e.message).slice(0,200));}
const configPath=process.env.SWNW_CONTRACT_CONFIG;
if(!configPath){report(false,'key','SWNW_CONTRACT_CONFIG is required');}
else{
 const c=JSON.parse((await fs.readFile(configPath,'utf8')).replace(/^﻿/,''));
 const key=crypto.createPrivateKey({key:Buffer.concat([Buffer.from('302e020100300506032b657004220420','hex'),crypto.createHash('sha256').update(String(c.secret)).digest()]),format:'der',type:'pkcs8'});
 const auth=()=>{const s=String(Date.now());return 'Bearer CM.'+s+'.'+crypto.sign(null,Buffer.from(s),key).toString('base64url');};
 const fake={id:crypto.randomUUID(),lease:crypto.randomUUID()};
 const post=async(fn,body)=>{const res=await fetch(api+fn,{method:'POST',headers:{'Content-Type':'application/json',Authorization:auth()},body:JSON.stringify(body),signal:AbortSignal.timeout(30000)});let d={};try{d=await res.json();}catch{}return {status:res.status,error:String(d.error||'')};};
 for(const [fn,body,expected] of [['contract-marketing',{action:'generate',...fake},'انتهت صلاحية الطلب'],['content-ai',{contract_marketing_job:fake},'طلب التعاقد غير متاح']]){
  try{const r=await post(fn,body);const denied=r.status===401||/غير مصرح/.test(r.error);
   report(!denied&&r.error.includes(expected),fn+': worker key accepted, made-up job refused (nothing written)',r.status+' '+r.error.slice(0,120));}
  catch(e){report(false,fn,String(e.message).slice(0,200));}
 }
}
process.exitCode=failed?1:0;
