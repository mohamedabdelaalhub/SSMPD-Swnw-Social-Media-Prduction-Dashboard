import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
const headers = {'Access-Control-Allow-Origin':'*','Access-Control-Allow-Headers':'authorization,apikey,content-type,x-client-info','Access-Control-Allow-Methods':'POST,OPTIONS'};
Deno.serve(async req => {
 if(req.method==='OPTIONS') return new Response('ok',{headers});
 if(req.method!=='POST') return Response.json({error:'POST only'},{status:405,headers});
 let jobId: string | undefined;
 const db=createClient(Deno.env.get('SUPABASE_URL')!,Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
 try {
  const key=Deno.env.get('OPENAI_API_KEY');
  const auth=req.headers.get('Authorization'); if(!auth) throw new Error('سجّل الدخول');
  const userDb=createClient(Deno.env.get('SUPABASE_URL')!,Deno.env.get('SUPABASE_ANON_KEY')!,{global:{headers:{Authorization:auth}}});
  const {data:me,error:authError}=await userDb.rpc('my_admin_id'); if(authError||!me) throw new Error('غير مسموح');
  const body=await req.json();
  if(body.action==='library') {
   const {data,error}=await userDb.from('design_jobs').select('id,scene_storage_path,scene_prompt,image_quality,created_at').like('scene_storage_path','sono/%').order('created_at',{ascending:false}).limit(30);
   if(error) throw error;
   const images=await Promise.all((data||[]).map(async row=>{
    const {data:signed,error:e}=await db.storage.from('design-scenes').createSignedUrl(row.scene_storage_path,3600); if(e) throw e;
    return {...row,url:signed!.signedUrl};
   }));
   return Response.json({images},{headers});
  }
  if(!key) throw new Error('لم يتم إعداد مفتاح التوليد');
  const prompt=String(body.prompt||'');
  const {data:reserved,error}=await userDb.rpc('reserve_design_scene',{p_content_id:body.content_id,p_request_key:body.request_key,p_prompt:prompt,p_quality:body.quality||'medium'});
  if(error) throw error;
  const job=reserved.job;
  if(!reserved.new) {
   let url=null;
   if(job.scene_storage_path) {const signed=await db.storage.from('design-scenes').createSignedUrl(job.scene_storage_path,3600); url=signed.data?.signedUrl;}
   return Response.json({job_id:job.id,status:job.status,url,error:job.error_message},{headers});
  }
  jobId=job.id;
  const response=await fetch('https://api.openai.com/v1/images/generations',{
   method:'POST',headers:{Authorization:'Bearer '+key,'Content-Type':'application/json'},
   body:JSON.stringify({model:'gpt-image-1.5',quality:job.image_quality,size:'1024x1536',n:1,output_format:'png',
    prompt:'Create only a photorealistic scene for a medical social post. No text, letters, digits, logos, watermarks or contact details. Pale clean background, natural anatomy. Portrait framing. Extend the photograph naturally to the top edge, with no blank horizontal header or white margin. Keep only the small upper-left logo corner calm and light, without faces or important details. Extend the scene downward by at least 300 pixels at final 1080-pixel-wide scale, showing additional lower body and background for a fade. Never place a logo yourself. Follow the requested title safe area. Scene brief: '+prompt}),
   signal:AbortSignal.timeout(150000)
  });
  const result=await response.json(); if(!response.ok) throw new Error(result.error?.message||'فشل توليد الصورة');
  const encoded=result.data?.[0]?.b64_json; if(!encoded) throw new Error('لم ترجع صورة');
  const bytes=Uint8Array.from(atob(encoded),(c:string)=>c.charCodeAt(0));
  const path='sono/'+job.id+'/scene.png';
  const upload=await db.storage.from('design-scenes').upload(path,bytes,{contentType:'image/png',upsert:false}); if(upload.error) throw upload.error;
  const saved=await db.from('design_jobs').update({status:'scene_ready',scene_storage_path:path,render_settings:{usage:result.usage||null,cost_note:'Conservative reservation; reconcile with provider billing'},updated_at:new Date().toISOString()}).eq('id',job.id); if(saved.error) throw saved.error;
  const signed=await db.storage.from('design-scenes').createSignedUrl(path,3600); if(signed.error) throw signed.error;
  return Response.json({job_id:job.id,status:'scene_ready',url:signed.data.signedUrl},{headers});
 } catch(error) {
  const message=error instanceof Error?error.message:(error as any)?.message||String(error);
  if(jobId) await db.from('design_jobs').update({status:'failed',error_message:message,updated_at:new Date().toISOString()}).eq('id',jobId);
  return Response.json({error:message,status:jobId?'failed':undefined},{headers,status:400});
 }
});
