import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { buildPayload,imageBytes,deliver,privateKey } from './transport.mjs';
const cors={'Access-Control-Allow-Origin':'*','Access-Control-Allow-Headers':'authorization,apikey,content-type,x-client-info','Access-Control-Allow-Methods':'POST,OPTIONS'};
Deno.serve(async(req)=>{
 const reply=(body:unknown,status=200)=>new Response(JSON.stringify(body),{status,headers:{...cors,'Content-Type':'application/json'}});
 if(req.method==='OPTIONS')return new Response('ok',{headers:cors});
 if(req.method!=='POST')return reply({error:'METHOD_NOT_ALLOWED'},405);
 const url=Deno.env.get('SUPABASE_URL')!,key=Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
 const db=createClient(url,key,{auth:{persistSession:false}});
 let secret=Deno.env.get('WEBSITE_WEBHOOK_SECRET'),endpoint=Deno.env.get('WEBSITE_CONTENT_ENDPOINT');
 if(!secret||!endpoint){const {data:cfg}=await db.rpc('website_worker_config');secret=secret||cfg?.secret;endpoint=endpoint||cfg?.endpoint;}
 if(!secret||!endpoint)return reply({error:'INTEGRATION_DISABLED'},503);
 let target:URL;try{target=new URL(endpoint);if(target.protocol!=='https:'||target.username||target.password)throw Error();}catch{return reply({error:'INVALID_ENDPOINT'},503);}
 const bearer=(req.headers.get('Authorization')||'').replace(/^Bearer /i,'');
 if(bearer!==secret){
  const {data,error}=await db.auth.getUser(bearer);if(error||!data.user)return reply({error:'AUTH_REQUIRED'},401);
  const {data:admin}=await db.from('admins').select('id,role,admin_extra_roles(role)').eq('user_id',data.user.id).eq('active',true).maybeSingle();
  const roles=admin?[admin.role,...(admin.admin_extra_roles||[]).map((r:any)=>r.role)]:[];
  if(!roles.some((r:string)=>['page_manager','approver','general_manager','super_admin'].includes(r)))return reply({error:'FORBIDDEN'},403);
 }
 let processed=0;
 for(let i=0;i<3;i++){
  const {data,error}=await db.rpc('website_claim');if(error)return reply({error:'QUEUE_UNAVAILABLE'},503);
  const job=data?.[0];if(!job)break;
  let result={status:'retry',http:0,path:null as string|null},reason:string|null=null;
  try{
   const body=buildPayload(job.payload);
   if(job.action==='upsert' && job.payload._imageUrl){
    const source=new URL(job.payload._imageUrl),prefix='/storage/v1/object/';
    if(source.origin!==new URL(url).origin||!source.pathname.startsWith(prefix))throw Error('REUPLOAD_IMAGE_TO_CONTENT_DESIGNS');
    const path=decodeURIComponent(source.pathname.slice(prefix.length)).replace(/^(authenticated|sign|public)\//,'');
    if(!path.startsWith('content-designs/')||path.includes('..'))throw Error('INVALID_FILE');
    const {data:file,error:downloadError}=await db.storage.from('content-designs').download(path.slice('content-designs/'.length));
    if(downloadError||!file)throw Error('IMAGE_DOWNLOAD_FAILED');
    if(file.size>5*1024*1024)throw Error('INVALID_FILE');
    body.image=imageBytes(new Uint8Array(await file.arrayBuffer()));
   }
   // Carousel slides and reels: short-lived (2h) download links — the studio must copy the files when it receives them.
   if(job.action==='upsert' && Array.isArray(job.payload._slides) && job.payload._slides.length>1){
    const images=[];
    for(const [i,slide] of job.payload._slides.slice(0,10).entries()){
     const k=privateKey(slide,new URL(url).origin,'content-designs',job.content_id);if(!k)throw Error('INVALID_FILE');
     const {data:signed,error:signError}=await db.storage.from('content-designs').createSignedUrl(k,7200);
     if(signError||!signed)throw Error('IMAGE_DOWNLOAD_FAILED');
     images.push({index:i+1,url:signed.signedUrl,mime:'image/png'});
    }
    body.images=images;
   }
   if(job.action==='upsert' && job.payload._videoUrl){
    const k=privateKey(job.payload._videoUrl,new URL(url).origin,'video-inputs',null);if(!k)throw Error('INVALID_FILE');
    const {data:signed,error:signError}=await db.storage.from('video-inputs').createSignedUrl(k,7200);
    if(signError||!signed)throw Error('VIDEO_DOWNLOAD_FAILED');
    body.video={url:signed.signedUrl,mime:'video/mp4',expiresInSeconds:7200};
   }
   result=await deliver(target.href,secret,body);
   if(result.status==='failed'||result.status==='retry')reason='HTTP_'+result.http;
  }catch(e){
   const code=e instanceof Error?e.message:'';
   const known=['INVALID_FIELDS','INVALID_FILE','INVALID_PUBLISHED_URL','REQUEST_TOO_LARGE','REUPLOAD_IMAGE_TO_CONTENT_DESIGNS'];
   reason=known.includes(code)?code:'TRANSPORT_OR_STORAGE_ERROR';
   result.status=known.includes(code)?'failed':'retry';
  }
  const {error:finishError}=await db.rpc('website_finish',{p_id:job.content_id,p_revision:job.revision,p_token:job.claim_token,p_status:result.status,p_http:result.http,p_error:reason,p_path:result.path});
  if(finishError)return reply({error:'RESULT_SAVE_FAILED'},503);
  processed++;
 }
 return reply({ok:true,processed});
});
