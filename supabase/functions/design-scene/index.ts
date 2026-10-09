import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
// @deno-types="npm:@types/pngjs@6.0.5"
import pngjs from 'npm:pngjs@7.0.0';
import { Buffer } from 'node:buffer';
const { PNG } = pngjs;
const headers = {'Access-Control-Allow-Origin':'*','Access-Control-Allow-Headers':'authorization,apikey,content-type,x-client-info','Access-Control-Allow-Methods':'POST,OPTIONS'};
function imageBytes(value: unknown): Uint8Array {
 if(typeof value!=='string'||value.length>5600000||!/^data:image\/png;base64,[A-Za-z0-9+/=]+$/.test(value))throw new Error('الصورة غير صالحة أو تتجاوز ٤ ميجابايت');
 const bytes=Uint8Array.from(atob(value.split(',')[1]),c=>c.charCodeAt(0));
 if(bytes.length>4*1024*1024||bytes.length<24||Buffer.from(bytes.subarray(0,8)).toString('hex')!=='89504e470d0a1a0a')throw new Error('اختر صورة PNG');
 const view=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength),w=view.getUint32(16),h=view.getUint32(20);
 if(!w||!h||w*h>1600000||Math.max(w,h)>2048)throw new Error('أبعاد الصورة غير صالحة');
 return bytes;
}
async function digest(value: string){const bytes=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(value));return Array.from(new Uint8Array(bytes),v=>v.toString(16).padStart(2,'0')).join('');}
async function expansionLinks(db: any,job: any){
 const expansion=job.render_settings?.expansion;if(!expansion)return null;
 const {data,error}=await db.storage.from('design-scenes').createSignedUrl(expansion.original_path,3600);if(error)throw error;
 return {mode:expansion.mode,original_url:data.signedUrl,original_path:expansion.original_path};
}
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
  if(Number(req.headers.get('content-length')||0)>14000000)throw new Error('حجم الطلب يتجاوز الحد');
  const requestText=await req.text();if(requestText.length>14000000)throw new Error('حجم الطلب يتجاوز الحد');
  const body=JSON.parse(requestText);
  if(body.action&&!['library','expand','original'].includes(body.action))throw new Error('عملية غير صالحة');
  if(body.action==='library') {
   const {data,error}=await userDb.from('design_jobs').select('id,scene_storage_path,scene_prompt,image_quality,created_at,render_settings').like('scene_storage_path','sono/%').order('created_at',{ascending:false}).limit(30);
   if(error) throw error;
   const images=await Promise.all((data||[]).map(async row=>{
    const {data:signed,error:e}=await db.storage.from('design-scenes').createSignedUrl(row.scene_storage_path,3600); if(e) throw e;
    return {...row,url:signed!.signedUrl,expansion:await expansionLinks(db,row)};
   }));
   return Response.json({images},{headers});
  }
  if(body.action==='original'){
   const {data:job,error}=await userDb.from('design_jobs').select('render_settings').eq('id',body.job_id).maybeSingle();if(error||!job)throw new Error('الصورة الأصلية غير متاحة');
   return Response.json({expansion:await expansionLinks(db,job)},{headers});
  }
  if(!key) throw new Error('لم يتم إعداد مفتاح التوليد');
  const expand=body.action==='expand';
  let prepared: any=null;
  if(expand){
   if(!['horizontal','all'].includes(body.mode))throw new Error('اختر اتجاه التوسيع');
   const image=imageBytes(body.image),mask=imageBytes(body.mask),original=imageBytes(body.original);
   const pixels=PNG.sync.read(Buffer.from(image)),maskPixels=PNG.sync.read(Buffer.from(mask));
   PNG.sync.read(Buffer.from(original));
   const size=body.mode==='horizontal'?'1536x1024':'1024x1536';
   if(pixels.width+'x'+pixels.height!==size||maskPixels.width!==pixels.width||maskPixels.height!==pixels.height)throw new Error('أبعاد الصورة والقناع غير متطابقة');
   const maskData=maskPixels.data as unknown as Uint8Array;
   let protectedPixels=0;for(let i=3;i<maskData.length;i+=4)if(maskData[i]===255)protectedPixels++;
   if(protectedPixels<pixels.width*pixels.height*.1||protectedPixels>pixels.width*pixels.height*.9)throw new Error('مساحة التوسيع غير صالحة');
   prepared={image,mask,original,pixels,maskPixels,size};
  }
  const inputHash=expand?await digest(body.mode+'|'+body.image+'|'+body.mask+'|'+body.original):'';
  const prompt=expand?'Expand background '+body.mode+'. Preserve original subject. Input SHA256 '+inputHash:String(body.prompt||'');
  const {data:reserved,error}=await userDb.rpc('reserve_design_scene',{p_content_id:body.content_id,p_request_key:body.request_key,p_prompt:prompt,p_quality:expand?'high':body.quality||'medium'});
  if(error) throw error;
  const job=reserved.job;
  if(expand&&job.scene_prompt!==prompt)throw new Error('طلب التوسيع لا يطابق الصورة الأصلية');
  if(!reserved.new) {
   let url=null;
   if(job.scene_storage_path) {const signed=await db.storage.from('design-scenes').createSignedUrl(job.scene_storage_path,3600); url=signed.data?.signedUrl;}
   return Response.json({job_id:job.id,status:job.status,url,expansion:await expansionLinks(db,job),error:job.error_message},{headers});
  }
  jobId=job.id;
  let response: Response;
  if(expand){
   const form=new FormData();
   form.append('model','gpt-image-1.5');form.append('quality',job.image_quality);form.append('size',prepared.size);form.append('n','1');form.append('output_format','png');form.append('input_fidelity','high');
   form.append('image',new Blob([prepared.image],{type:'image/png'}),'scene.png');form.append('mask',new Blob([prepared.mask],{type:'image/png'}),'mask.png');
   form.append('prompt','Outpaint only the transparent masked borders. Continue the existing background seamlessly with matching light, colors and perspective. Do not add text, logos, people or objects. Keep the complete original protected rectangle unchanged, including the person, face, clothing, anatomy and their size. Do not zoom or reframe. Fill every transparent border with natural background.');
   response=await fetch('https://api.openai.com/v1/images/edits',{method:'POST',headers:{Authorization:'Bearer '+key},body:form,signal:AbortSignal.timeout(150000)});
  }else{
  response=await fetch('https://api.openai.com/v1/images/generations',{
   method:'POST',headers:{Authorization:'Bearer '+key,'Content-Type':'application/json'},
   body:JSON.stringify({model:'gpt-image-1.5',quality:job.image_quality,size:'1024x1536',n:1,output_format:'png',
    prompt:'Create only a photorealistic scene for a medical social post. No text, letters, digits, logos, watermarks or contact details. Pale clean background, natural anatomy. Portrait framing. Extend the photograph naturally to the top edge, with no blank horizontal header or white margin. Keep only the small upper-left logo corner calm and light, without faces or important details. Extend the scene downward by at least 300 pixels at final 1080-pixel-wide scale, showing additional lower body and background for a fade. Never place a logo yourself. Follow the requested title safe area. Scene brief: '+prompt}),
   signal:AbortSignal.timeout(150000)
  });
  }
  const result=await response.json(); if(!response.ok) throw new Error(result.error?.message||'فشل توليد الصورة');
  const encoded=result.data?.[0]?.b64_json; if(!encoded) throw new Error('لم ترجع صورة');
  let bytes=Uint8Array.from(atob(encoded),(c:string)=>c.charCodeAt(0));
  let expansion: any=null;
  if(expand){
   const output=PNG.sync.read(Buffer.from(imageBytes('data:image/png;base64,'+encoded)));
   if(output.width!==prepared.pixels.width||output.height!==prepared.pixels.height)throw new Error('التوسيع رجع بأبعاد غير مطابقة');
   const outputData=output.data as unknown as Uint8Array,originalData=prepared.pixels.data as Uint8Array;
   for(let i=0;i<outputData.length;i+=4)if(prepared.maskPixels.data[i+3]===255)outputData.set(originalData.subarray(i,i+4),i);
   bytes=new Uint8Array(PNG.sync.write(output) as unknown as Uint8Array);
   const originalPath='sono/'+job.id+'/original.png';
   const originalUpload=await db.storage.from('design-scenes').upload(originalPath,prepared.original,{contentType:'image/png',upsert:false});if(originalUpload.error)throw originalUpload.error;
   expansion={mode:body.mode,original_path:originalPath};
  }
  const path='sono/'+job.id+'/scene.png';
  const upload=await db.storage.from('design-scenes').upload(path,bytes,{contentType:'image/png',upsert:false}); if(upload.error) throw upload.error;
  const saved=await db.from('design_jobs').update({status:'scene_ready',scene_storage_path:path,render_settings:{expansion,usage:result.usage||null,cost_note:'Conservative reservation; reconcile with provider billing'},updated_at:new Date().toISOString()}).eq('id',job.id); if(saved.error) throw saved.error;
  const signed=await db.storage.from('design-scenes').createSignedUrl(path,3600); if(signed.error) throw signed.error;
  return Response.json({job_id:job.id,status:'scene_ready',url:signed.data.signedUrl,expansion:await expansionLinks(db,{render_settings:{expansion}})},{headers});
 } catch(error) {
  const message=error instanceof Error?error.message:(error as any)?.message||String(error);
  if(jobId) await db.from('design_jobs').update({status:'failed',error_message:message,updated_at:new Date().toISOString()}).eq('id',jobId);
  return Response.json({error:message,status:jobId?'failed':undefined},{headers,status:400});
 }
});

