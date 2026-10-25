import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const CRON_SECRET = Deno.env.get("META_PUBLISH_CRON_SECRET");
const CLIENT_KEY = Deno.env.get("TIKTOK_CLIENT_KEY")!;
const CLIENT_SECRET = Deno.env.get("TIKTOK_CLIENT_SECRET")!;
const admin = createClient(URL, SERVICE, { auth: { persistSession: false } });

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status, headers: { "Content-Type": "application/json; charset=utf-8" }
});

type TikTokAccount = {
  brand:string; open_id:string; access_token:string; refresh_token:string;
  access_token_expires_at:string; refresh_token_expires_at:string;
};

async function refreshIfNeeded(account:TikTokAccount):Promise<TikTokAccount> {
  if (new Date(account.access_token_expires_at).getTime() > Date.now()+5*60*1000) return account;
  if (new Date(account.refresh_token_expires_at).getTime() <= Date.now()) throw new Error("انتهت صلاحية ربط TikTok. افصل الحساب وأعد ربطه.");
  const response=await fetch("https://open.tiktokapis.com/v2/oauth/token/",{
    method:"POST",headers:{"Content-Type":"application/x-www-form-urlencoded"},
    body:new URLSearchParams({client_key:CLIENT_KEY,client_secret:CLIENT_SECRET,grant_type:"refresh_token",refresh_token:account.refresh_token})
  });
  const data=await response.json().catch(()=>({}));
  if(!response.ok||data.error||!data.access_token) throw new Error("تعذر تجديد صلاحية TikTok. أعد ربط الحساب من الداشبورد.");
  const patch={
    access_token:data.access_token, refresh_token:data.refresh_token||account.refresh_token,
    access_token_expires_at:new Date(Date.now()+Number(data.expires_in||86400)*1000).toISOString(),
    refresh_token_expires_at:new Date(Date.now()+Number(data.refresh_expires_in||31536000)*1000).toISOString(),
    updated_at:new Date().toISOString()
  };
  const {error}=await admin.from("tiktok_accounts").update(patch).eq("brand",account.brand);
  if(error)throw error;
  return {...account,...patch};
}
function b64url(bytes:Uint8Array){let s="";for(const b of bytes)s+=String.fromCharCode(b);return btoa(s).replace(/\+/g,"-").replace(/\//g,"_").replace(/=+$/g,"");}
function b64json(v:unknown){return b64url(new TextEncoder().encode(JSON.stringify(v)));}
function pemBuffer(pem:string){const clean=pem.replace(/-----BEGIN PRIVATE KEY-----/g,"").replace(/-----END PRIVATE KEY-----/g,"").replace(/\s+/g,"");const bin=atob(clean);return Uint8Array.from(bin,c=>c.charCodeAt(0)).buffer;}
let googleToken:{value:string,expires:number}|null=null;
async function driveToken(){
  if(googleToken&&googleToken.expires>Date.now()+60000)return googleToken.value;
  const raw=Deno.env.get("META_PUBLISH_GOOGLE_SERVICE_ACCOUNT_KEY");if(!raw)throw new Error("إعداد Google Drive غير موجود.");
  const sa=JSON.parse(raw),now=Math.floor(Date.now()/1000),aud=sa.token_uri||"https://oauth2.googleapis.com/token";
  const body=b64json({alg:"RS256",typ:"JWT"})+"."+b64json({iss:sa.client_email,scope:"https://www.googleapis.com/auth/drive.readonly",aud,iat:now,exp:now+3600});
  const key=await crypto.subtle.importKey("pkcs8",pemBuffer(sa.private_key),{name:"RSASSA-PKCS1-v1_5",hash:"SHA-256"},false,["sign"]);
  const sig=await crypto.subtle.sign("RSASSA-PKCS1-v1_5",key,new TextEncoder().encode(body));
  const assertion=body+"."+b64url(new Uint8Array(sig));
  const res=await fetch(aud,{method:"POST",headers:{"Content-Type":"application/x-www-form-urlencoded"},body:new URLSearchParams({grant_type:"urn:ietf:params:oauth:grant-type:jwt-bearer",assertion})});
  const data=await res.json().catch(()=>({}));if(!res.ok||!data.access_token)throw new Error("تعذر الوصول لملف الفيديو في Drive.");
  googleToken={value:data.access_token,expires:Date.now()+Number(data.expires_in||3600)*1000};return googleToken.value;
}
function driveId(url:string){const m=/\/file\/d\/([^/?#]+)/.exec(url);if(m)return m[1];try{const u=new URL(url);if(u.hostname.endsWith("drive.google.com"))return u.searchParams.get("id");}catch{}return null;}
async function loadVideo(source:string):Promise<{bytes:Uint8Array,type:string}>{
  let res:Response;
  const id=driveId(source);
  if(id)res=await fetch("https://www.googleapis.com/drive/v3/files/"+encodeURIComponent(id)+"?alt=media&supportsAllDrives=true",{headers:{Authorization:"Bearer "+await driveToken()}});
  else{
    const u=new URL(source),m=/^\/storage\/v1\/object\/authenticated\/(content-designs|video-inputs)\/(.+)$/.exec(u.pathname);
    if(u.origin===new URL(URL).origin&&m){const f=await admin.storage.from(m[1]).download(decodeURIComponent(m[2]));if(f.error||!f.data)throw new Error("تعذر تحميل ملف الفيديو من التخزين.");res=new Response(f.data,{headers:{"content-type":f.data.type}});}
    else res=await fetch(source);
  }
  if(!res.ok)throw new Error("تعذر تحميل ملف الفيديو (HTTP "+res.status+").");
  const type=(res.headers.get("content-type")||"video/mp4").split(";")[0].trim().toLowerCase();
  if(!["video/mp4","video/quicktime","video/webm"].includes(type))throw new Error("TikTok يحتاج ملف فيديو MP4 أو MOV أو WEBM.");
  const bytes=new Uint8Array(await res.arrayBuffer());
  if(!bytes.length||bytes.length>512*1024*1024)throw new Error("حجم الفيديو غير صالح أو أكبر من حد المعالجة.");
  return {bytes,type};
}
async function api(path:string,token:string,body:unknown){
  const res=await fetch("https://open.tiktokapis.com"+path,{method:"POST",headers:{Authorization:"Bearer "+token,"Content-Type":"application/json; charset=UTF-8"},body:JSON.stringify(body)});
  const data=await res.json().catch(()=>({}));
  if(!res.ok||data.error?.code&&data.error.code!=="ok")throw new Error(data.error?.message||data.error?.code||"TikTok API returned HTTP "+res.status);
  return data.data||{};
}
async function processJob(job:any){
  try{
    const [{data:content,error:contentError},{data:rawAccount,error:accountError}]=await Promise.all([
      admin.from("content_items").select("id,title,body,caption_text,design_file_url,content_format,published_url,published_urls").eq("id",job.content_id).maybeSingle(),
      admin.from("tiktok_accounts").select("*").eq("brand",job.brand).maybeSingle()
    ]);
    if(contentError)throw contentError;
    if(!content||content.content_format!=="video"||!content.design_file_url)throw new Error("النشر التلقائي على TikTok متاح للفيديوهات التي لها ملف معتمد فقط.");
    if(accountError)throw accountError;
    if(!rawAccount)throw new Error("اربط حساب TikTok لصفحة المحتوى من بطاقة النشر.");
    const account=await refreshIfNeeded(rawAccount);
    const creator=await api("/v2/post/publish/creator_info/query/",account.access_token,{});
    if(!Array.isArray(creator.privacy_level_options)||!creator.privacy_level_options.includes(job.privacy_level))throw new Error("اختيار الخصوصية لم يعد متاحًا لهذا الحساب. افتح تفاصيل المادة واختر الخصوصية مرة أخرى.");
    if(creator.creator_can_post===false)throw new Error("حساب TikTok لا يستطيع النشر الآن. حاول لاحقًا.");
    if(!job.music_confirmation)throw new Error("يجب تأكيد موافقة TikTok على استخدام الموسيقى قبل النشر.");
    if(job.branded_content&&job.privacy_level==="SELF_ONLY")throw new Error("لا يمكن نشر محتوى الشراكة التجارية بخصوصية خاصة فقط.");
    const {bytes,type}=await loadVideo(content.design_file_url);
    const title=String(content.caption_text||content.body||content.title||"").slice(0,2200);
    if(job.publish_id){
      const status=await api("/v2/post/publish/status/fetch/",account.access_token,{publish_id:job.publish_id});
      const state=status.status||status.publish_status||"";
      if(state==="PUBLISH_COMPLETE"){
        const postIds=Array.isArray(status.publicaly_available_post_id)?status.publicaly_available_post_id:[];
        const postId=postIds.length?String(postIds[0]):null;
        const share=status.share_url||(postId?"https://www.tiktok.com/@"+(creator.creator_username||"")+"/video/"+postId:null);
        const patch={status:"published",publish_status:state,share_url:share||null,post_id:postId,published_at:new Date().toISOString(),error_message:null,updated_at:new Date().toISOString()};
        await admin.from("tiktok_publish_jobs").update(patch).eq("id",job.id);
        const urls=Object.assign({},content.published_urls||{});if(share)urls.tiktok=share;
        await admin.from("content_items").update({stage:"published",published_at:patch.published_at,published_url:content.published_url||share||null,published_urls:urls}).eq("id",content.id);
        return;
      }
      if(state==="FAILED")throw new Error(status.fail_reason||status.error_message||"TikTok لم يكمل نشر الفيديو.");
      await admin.from("tiktok_publish_jobs").update({status:"pending",publish_status:state||"PROCESSING_UPLOAD",scheduled_at:new Date(Date.now()+60000).toISOString(),updated_at:new Date().toISOString()}).eq("id",job.id);
      return;
    }
    const chunkSize=10_000_000,total=Math.ceil(bytes.length/chunkSize);
    const init=await api("/v2/post/publish/video/init/",account.access_token,{
      post_info:{title,privacy_level:job.privacy_level,disable_comment:job.disable_comment,disable_duet:job.disable_duet,disable_stitch:job.disable_stitch,brand_content_toggle:job.branded_content,brand_organic_toggle:job.your_brand,is_aigc:false},
      source_info:{source:"FILE_UPLOAD",video_size:bytes.length,chunk_size:Math.min(chunkSize,bytes.length),total_chunk_count:total}
    });
    if(!init.publish_id||!init.upload_url)throw new Error("TikTok لم يرجع رابط رفع صالحًا.");
    for(let start=0;start<bytes.length;start+=chunkSize){
      const end=Math.min(bytes.length,start+chunkSize),part=bytes.slice(start,end);
      const up=await fetch(init.upload_url,{method:"PUT",headers:{"Content-Type":type,"Content-Length":String(part.length),"Content-Range":`bytes ${start}-${end-1}/${bytes.length}`},body:part});
      if(!up.ok)throw new Error("فشل رفع جزء الفيديو إلى TikTok (HTTP "+up.status+").");
    }
    await admin.from("tiktok_publish_jobs").update({publish_id:init.publish_id,publish_status:"PROCESSING_UPLOAD",status:"pending",scheduled_at:new Date(Date.now()+60000).toISOString(),updated_at:new Date().toISOString(),error_message:null}).eq("id",job.id);
  }catch(e){
    const message=e instanceof Error?e.message:"حدث خطأ أثناء نشر TikTok.";
    await admin.from("tiktok_publish_jobs").update({status:"failed",error_message:message.slice(0,1000),updated_at:new Date().toISOString()}).eq("id",job.id);
  }
}
Deno.serve(async(req)=>{
  if(req.method!=="POST")return json({ok:false,error:"POST only"},405);
  if(!CRON_SECRET||req.headers.get("X-Cron-Secret")!==CRON_SECRET)return json({ok:false,error:"unauthorized"},401);
  if(!SERVICE||!CLIENT_KEY||!CLIENT_SECRET)return json({ok:false,error:"TikTok worker is not configured"},500);
  const {data:jobs,error}=await admin.rpc("claim_due_tiktok_publish_jobs",{p_limit:3});
  if(error)return json({ok:false,error:error.message},500);
  for(const job of jobs||[])await processJob(job);
  return json({ok:true,processed:(jobs||[]).length});
});
