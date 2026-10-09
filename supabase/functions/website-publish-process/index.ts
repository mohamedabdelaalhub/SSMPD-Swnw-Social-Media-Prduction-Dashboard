import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { buildPayload,imageBytes,deliver,privateKey } from './transport.mjs';

// Website image sources: existing private storage and legacy Drive files.
// Begin website-image helpers (also exercised with mocked network/storage).
let googleTokenCache = null;

function base64Url(bytes): string {
  let binary = "";
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function base64UrlJson(value): string {
  return base64Url(new TextEncoder().encode(JSON.stringify(value)));
}

function pemToPkcs8(pem) {
  const clean = pem
    .replace(/-----BEGIN PRIVATE KEY-----/g, "")
    .replace(/-----END PRIVATE KEY-----/g, "")
    .replace(/\s+/g, "");
  const binary = atob(clean);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes.buffer;
}

async function getGoogleDriveAccessToken() {
  if (googleTokenCache && googleTokenCache.expiresAt > Date.now() + 60_000) {
    return googleTokenCache.token;
  }

  const raw = Deno.env.get("META_PUBLISH_GOOGLE_SERVICE_ACCOUNT_KEY");
  if (!raw) throw new Error("DRIVE_SERVICE_ACCOUNT_MISSING");

  let sa;
  try {
    sa = JSON.parse(raw);
  } catch {
    throw new Error("DRIVE_SERVICE_ACCOUNT_INVALID");
  }
  if (!sa.client_email || !sa.private_key) {
    throw new Error("DRIVE_SERVICE_ACCOUNT_INVALID");
  }

  const tokenUri = "https://oauth2.googleapis.com/token";
  const now = Math.floor(Date.now() / 1000);
  const signingInput =
    base64UrlJson({ alg: "RS256", typ: "JWT" }) +
    "." +
    base64UrlJson({
      iss: sa.client_email,
      scope: "https://www.googleapis.com/auth/drive.readonly",
      aud: tokenUri,
      iat: now,
      exp: now + 3600
    });

  const key = await crypto.subtle.importKey(
    "pkcs8",
    pemToPkcs8(sa.private_key),
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const signature = await crypto.subtle.sign(
    "RSASSA-PKCS1-v1_5",
    key,
    new TextEncoder().encode(signingInput)
  );
  const assertion = signingInput + "." + base64Url(new Uint8Array(signature));

  const res = await fetch(tokenUri, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion
    })
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data.access_token) {
    throw new Error("DRIVE_AUTH_FAILED");
  }

  const expiresIn = Number(data.expires_in || 3600);
  googleTokenCache = {
    token: data.access_token,
    expiresAt: Date.now() + Math.max(60, expiresIn - 60) * 1000
  };
  return data.access_token;
}


function driveImageId(value) {
 try {
  const u=new URL(value);
  if(u.protocol!=='https:'||u.username||u.password||u.port||u.hostname!=='drive.google.com')return null;
  const match=/^\/file\/d\/([\w-]+)(?:\/|$)/.exec(u.pathname);
  const id=match?match[1]:['/open','/uc'].includes(u.pathname)?u.searchParams.get('id'):null;
  return id&&/^[\w-]+$/.test(id)?id:null;
 }catch{return null;}
}
async function readWebsiteImage(db,sourceUrl,origin) {
 const driveId=driveImageId(sourceUrl);
 if(driveId){
  const token=await getGoogleDriveAccessToken();
  const response=await fetch('https://www.googleapis.com/drive/v3/files/'+encodeURIComponent(driveId)+'?alt=media&supportsAllDrives=true',{headers:{Authorization:'Bearer '+token},redirect:'error',signal:AbortSignal.timeout(30000)});
  if(!response.ok)throw Error(response.status===403||response.status===404?'DRIVE_IMAGE_ACCESS_DENIED':'IMAGE_DOWNLOAD_FAILED');
  if(Number(response.headers.get('content-length'))>5*1024*1024){await response.body?.cancel();throw Error('INVALID_FILE');}
  const reader=response.body?.getReader();if(!reader)throw Error('INVALID_FILE');
  let length=0;const chunks=[];
  try{while(true){const next=await reader.read();if(next.done)break;length+=next.value.length;if(length>5*1024*1024){await reader.cancel();throw Error('INVALID_FILE');}chunks.push(next.value);}}finally{reader.releaseLock();}
  const bytes=new Uint8Array(length);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.length;}return bytes;
 }
 const source=new URL(sourceUrl),prefix='/storage/v1/object/';
 if(source.origin!==origin||source.protocol!=='https:'||source.username||source.password||!source.pathname.startsWith(prefix))throw Error('UNSUPPORTED_IMAGE_SOURCE');
 const path=decodeURIComponent(source.pathname.slice(prefix.length)).replace(/^(authenticated|sign|public)\//,'');
 const slash=path.indexOf('/'),bucket=path.slice(0,slash),key=path.slice(slash+1);
 if(!['content-designs','meta-publish-assets'].includes(bucket)||!key||path.includes('..'))throw Error('INVALID_FILE');
 const {data:file,error}=await db.storage.from(bucket).download(key);
 if(error||!file)throw Error('IMAGE_DOWNLOAD_FAILED');
 if(file.size>5*1024*1024)throw Error('INVALID_FILE');
 return new Uint8Array(await file.arrayBuffer());
}
// End website-image helpers.

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
  const {data:admin}=await db.from('admins').select('id,role').eq('user_id',data.user.id).eq('active',true).maybeSingle();
  const {data:extra}=admin?await db.from('admin_extra_roles').select('role').eq('admin_id',admin.id):{data:[]};
  const roles=admin?[admin.role,...(extra||[]).map((r:any)=>r.role)]:[];
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
    body.image=imageBytes(await readWebsiteImage(db,job.payload._imageUrl,new URL(url).origin));
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
   const known=['INVALID_FIELDS','INVALID_FILE','INVALID_PUBLISHED_URL','REQUEST_TOO_LARGE','UNSUPPORTED_IMAGE_SOURCE','DRIVE_SERVICE_ACCOUNT_MISSING','DRIVE_SERVICE_ACCOUNT_INVALID','DRIVE_IMAGE_ACCESS_DENIED'];
   reason=known.includes(code)?code:'TRANSPORT_OR_STORAGE_ERROR';
   result.status=known.includes(code)?'failed':'retry';
  }
  const {error:finishError}=await db.rpc('website_finish',{p_id:job.content_id,p_revision:job.revision,p_token:job.claim_token,p_status:result.status,p_http:result.http,p_error:reason,p_path:result.path});
  if(finishError)return reply({error:'RESULT_SAVE_FAILED'},503);
  processed++;
 }
 return reply({ok:true,processed});
});
