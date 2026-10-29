import {verifyWorkerToken} from './worker-auth.ts';
import {createClient} from 'https://esm.sh/@supabase/supabase-js@2';
const project=Deno.env.get('SUPABASE_URL')!;
const admin=createClient(project,Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
const cors={'Access-Control-Allow-Origin':'*','Access-Control-Allow-Headers':'authorization,apikey,content-type','Access-Control-Allow-Methods':'POST,OPTIONS'};
const reply=(data:unknown,status=200)=>Response.json(data,{status,headers:cors});
async function rpc(client:any,name:string,args:any){const r=await client.rpc(name,args);if(r.error)throw Error(r.error.message);return r.data;}
async function workerAuth(req:Request){return verifyWorkerToken(req.headers.get('authorization')||'');}
function image(bytes:Uint8Array,mime:string){return bytes.length>12&&bytes.length<=5242880&&((mime==='image/png'&&bytes[0]===137&&bytes[1]===80&&bytes[2]===78&&bytes[3]===71)||(mime==='image/jpeg'&&bytes[0]===255&&bytes[1]===216&&bytes[2]===255)||(mime==='image/webp'&&new TextDecoder().decode(bytes.slice(0,4))==='RIFF'&&new TextDecoder().decode(bytes.slice(8,12))==='WEBP'));}
function decode(b64:string){if(b64.length>7100000)throw Error('الصورة أكبر من 5 ميجابايت');return Uint8Array.from(atob(b64),c=>c.charCodeAt(0));}
async function signed(path:string|null){if(!path)return null;const r=await admin.storage.from('contract-marketing').createSignedUrl(path,600);if(r.error)throw Error('تعذر قراءة صورة التعاقد');return r.data.signedUrl;}
const factsKeys=['prefix','title','department','days','time_from','time_to','qualifications','experience','site_match','website','announcement'];
Deno.serve(async(req)=>{
 if(req.method==='OPTIONS')return new Response('ok',{headers:cors});if(req.method!=='POST')return reply({error:'POST only'},405);
 try{
  if(Number(req.headers.get('content-length')||0)>8000000)return reply({error:'طلب أكبر من الحد'},413);
  const raw=await req.text();if(raw.length>8000000)return reply({error:'طلب أكبر من الحد'},413);const b=JSON.parse(raw);
  if(['profile','save'].includes(b.action)){
   const client=createClient(project,Deno.env.get('SUPABASE_ANON_KEY')!,{global:{headers:{Authorization:req.headers.get('authorization')||''}}});
   const settings=b.action==='save'?b.settings:null;
   if(settings){if(settings.auto_announce&&!(settings.platforms||[]).length)throw Error('اختر منصات الإعلان');const input=settings.facts||{};settings.facts=Object.fromEntries(factsKeys.map(k=>[k,String(input[k]||'').trim().slice(0,2000)]));if(settings.facts.website&&!/^https:\/\//.test(settings.facts.website))throw Error('رابط الجهة يجب أن يبدأ بـ https');if(b.kind==='doctor'&&settings.auto_announce){if(!settings.facts.title||!settings.facts.days||![settings.facts.time_from,settings.facts.time_to].every(x=>/^([01]\d|2[0-3]):[0-5]\d$/.test(x)))throw Error('أكمل تخصص الطبيب وأيام وساعات العمل');}}
   let data=await rpc(client,'contract_marketing_profile',{p_kind:b.kind,p_key:b.key,p_settings:null});
   if(settings){
    if(b.image){if(!data.profile)data=await rpc(client,'contract_marketing_profile',{p_kind:b.kind,p_key:b.key,p_settings:{website_enabled:false}});const bytes=decode(b.image.base64);if(!image(bytes,b.image.mime))throw Error('اختر صورة PNG أو JPG أو WebP صحيحة حتى 5 ميجابايت');const ext=b.image.mime==='image/jpeg'?'jpg':b.image.mime==='image/png'?'png':'webp';const name=data.profile.id+'/'+crypto.randomUUID()+'.'+ext;const upload=await admin.storage.from('contract-marketing').upload(name,bytes,{contentType:b.image.mime,upsert:false});if(upload.error)throw Error('فشل رفع الصورة');settings.asset_path=name;}
    if(settings.auto_announce&&!settings.asset_path&&!data.profile?.asset_path)throw Error('ارفع صورة الطبيب أو لوجو الجهة قبل تفعيل الإعلان');
    data=await rpc(client,'contract_marketing_profile',{p_kind:b.kind,p_key:b.key,p_settings:settings});
   }
   return reply({...data,image_url:await signed(data.profile?.asset_path)});
  }
  if(!await workerAuth(req))return reply({error:'غير مصرح'},401);
  const call=(action:string,data:any={})=>rpc(admin,'contract_marketing_worker',{p_action:action,p_data:data});
  if(b.action==='snapshot'){const rows=await call('snapshot');return reply({observedAt:new Date().toISOString(),items:await Promise.all(rows.map(async(r:any)=>({...r,image_url:r.visible?await signed(r.asset_path):null})))});}
  if(b.action==='claim'){const job=await call('claim');return reply(job?{...job,image_url:await signed(job.profile.asset_path)}:{job:null});}
  const proof={id:b.id,lease:b.lease};const current=await call('get',proof);
  if(b.action==='generate'){
   if(current.job.idea)return reply({idea:current.job.idea});
   await call('begin_generation',proof);
   const response=await fetch(project+'/functions/v1/content-ai',{method:'POST',headers:{'Content-Type':'application/json',Authorization:req.headers.get('authorization')!},body:JSON.stringify({contract_marketing_job:proof})});
   const generated=await response.json();if(!response.ok||!generated.ideas?.[0])throw Error(generated.error||'تعذر توليد المحتوى');
   await call('idea',{...proof,idea:generated.ideas[0]});return reply({idea:generated.ideas[0]});
  }
  if(b.action==='finish'){
   const bytes=decode(b.image?.base64||'');if(!image(bytes,'image/png'))throw Error('ملف التصميم غير صالح');
   const folder=current.job.id+'/'+crypto.randomUUID()+'/';const file=folder+'output.png';
   const uploaded=await admin.storage.from('content-designs').upload(file,bytes,{contentType:'image/png',upsert:false});if(uploaded.error)throw Error('تعذر حفظ التصميم');
   return reply(await call('finish',{...proof,output_url:project+'/storage/v1/object/authenticated/content-designs/'+file,settings:b.settings||{}}));
  }
  if(b.action==='fail')return reply(await call('fail',{...proof,code:b.code,error:String(b.error||'تعذر التنفيذ').slice(0,500)}));
  return reply({error:'إجراء غير معروف'},400);
 }catch(e){return reply({error:e instanceof Error?e.message:'تعذر التنفيذ'},400);}
});


