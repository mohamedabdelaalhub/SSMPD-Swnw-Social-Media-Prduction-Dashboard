import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import {createClient} from "npm:@supabase/supabase-js@2";
import jpeg from "npm:jpeg-js@0.4.4";
const SUPABASE_URL=Deno.env.get('SUPABASE_URL')!,SERVICE_ROLE_KEY=Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,ANON_KEY=Deno.env.get('SUPABASE_ANON_KEY')!;
const BRIDGE='https://script.google.com/macros/s/AKfycbzEs73BE101-gIlSx_qwdF625nSalQ2i6mob7mGqH3oN4x40NlZoowjNta3KtKaXYjTYA/exec';
const CORS={'Access-Control-Allow-Origin':'*','Access-Control-Allow-Headers':'authorization,apikey,content-type,x-client-info','Access-Control-Allow-Methods':'POST, OPTIONS'};
const json=(b:unknown,s=200)=>new Response(JSON.stringify(b),{status:s,headers:{...CORS,'Content-Type':'application/json','Cache-Control':'no-store'}});
function base64url(input: Uint8Array | string): string {
  const bytes = typeof input === "string" ? new TextEncoder().encode(input) : input;
  let str = "";
  bytes.forEach((b) => (str += String.fromCharCode(b)));
  return btoa(str).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

async function importPrivateKey(pem: string): Promise<CryptoKey> {
  const pemContents = pem
    .replace(/-----BEGIN PRIVATE KEY-----/, "")
    .replace(/-----END PRIVATE KEY-----/, "")
    .replace(/\s/g, "");
  const binaryDer = Uint8Array.from(atob(pemContents), (c) => c.charCodeAt(0));
  return crypto.subtle.importKey(
    "pkcs8",
    binaryDer.buffer,
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false,
    ["sign"],
  );
}

// The archive is already shared with the publishing reader. The patient-files
// service account is a separate identity and may not read the archive.
let driveToken: {value:string;expiresAt:number}|null=null;
async function getDriveAccessToken(): Promise<string> {
  if(driveToken&&driveToken.expiresAt>Date.now()+60000)return driveToken.value;
  const rawKey = Deno.env.get("META_PUBLISH_GOOGLE_SERVICE_ACCOUNT_KEY") || Deno.env.get("GOOGLE_SERVICE_ACCOUNT_KEY");
  if (!rawKey) throw new Error("Archive Drive reader is not configured");
  const key = JSON.parse(rawKey);
  const now = Math.floor(Date.now() / 1000);
  const header = { alg: "RS256", typ: "JWT" };
  const claim = {
    iss: key.client_email,
    scope: "https://www.googleapis.com/auth/drive.readonly",
    aud: "https://oauth2.googleapis.com/token",
    exp: now + 3600,
    iat: now,
  };
  const signingInput = `${base64url(JSON.stringify(header))}.${base64url(JSON.stringify(claim))}`;
  const cryptoKey = await importPrivateKey(key.private_key);
  const signature = await crypto.subtle.sign(
    "RSASSA-PKCS1-v1_5",
    cryptoKey,
    new TextEncoder().encode(signingInput),
  );
  const jwt = `${signingInput}.${base64url(new Uint8Array(signature))}`;

  const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion: jwt,
    }),
  });
  const tokenJson = await tokenRes.json();
  if (!tokenRes.ok||typeof tokenJson.access_token!=='string') throw new Error("Archive Drive authentication failed");
  driveToken={value:tokenJson.access_token,expiresAt:Date.now()+Math.max(60,Math.min(3600,Number(tokenJson.expires_in)||3600))*1000};
  return driveToken.value;
}

function imageBase64(bytes:Uint8Array):string {
 let binary='';bytes.forEach(b=>{binary+=String.fromCharCode(b);});return btoa(binary);
}
async function readArchivePhoto(fileId:string):Promise<Uint8Array> {
 const token=await getDriveAccessToken();
 const r=await fetch('https://www.googleapis.com/drive/v3/files/'+encodeURIComponent(fileId)+'?alt=media&supportsAllDrives=true',{headers:{Authorization:'Bearer '+token},signal:AbortSignal.timeout(20000)});
 if(!r.ok)throw Error('Archive photo is not readable');
 if(Number(r.headers.get('Content-Length')||0)>100000)throw Error('Unexpected photo size');
 const bytes=new Uint8Array(await r.arrayBuffer());
 if(bytes.length>100000||bytes.length<4||bytes[0]!==255||bytes[1]!==216)throw Error('Invalid archive photo');
 return bytes;
}

Deno.serve(async req=>{
 if(req.method==='OPTIONS')return new Response('ok',{headers:CORS});if(req.method!=='POST')return json({error:'طلب غير متاح'},405);
 try{
  const client=createClient(SUPABASE_URL,ANON_KEY,{global:{headers:{Authorization:req.headers.get('Authorization')||''}}});
  const {data:{user},error}=await client.auth.getUser();if(error||!user)return json({error:'سجل الدخول'},401);
  const {data:me}=await client.rpc('my_admin_id');if(!me)return json({error:'الحساب غير فعال'},403);
  if(Number(req.headers.get('Content-Length')||0)>180000)return json({error:'الصورة أكبر من الحد المسموح'},413);
  const raw=await req.text();if(raw.length>180000)return json({error:'الصورة أكبر من الحد المسموح'},413);const input=JSON.parse(raw);
  const target=input.admin_id||me,db=createClient(SUPABASE_URL,SERVICE_ROLE_KEY);
  if(input.action==='get'){
   const allowed=await client.rpc('staff_photo_allowed',{p_admin_id:target});if(allowed.error||!allowed.data)return json({error:'الصورة غير متاحة'},403);
   const row=await db.from('staff_profile_photos').select('drive_file_id').eq('admin_id',target).maybeSingle();if(row.error)throw Error('تعذر قراءة الصورة');if(!row.data)return json({photo:null});
   const bytes=await readArchivePhoto(row.data.drive_file_id);return json({photo:'data:image/jpeg;base64,'+imageBase64(bytes)});
  }
  if(input.action!=='upload'||target!==me)return json({error:'يمكنك رفع صورتك الشخصية فقط'},403);
  if(typeof input.base64!=='string'||input.base64.length>140000)return json({error:'اختر صورة شخصية صغيرة'},400);
  const bytes=Uint8Array.from(atob(input.base64),c=>c.charCodeAt(0));if(bytes.length>100000||bytes[0]!==255||bytes[1]!==216)return json({error:'صيغة الصورة غير صحيحة'},400);
  const decoded=jpeg.decode(bytes,{useTArray:true,maxResolutionInMP:1,maxMemoryUsageInMB:32,tolerantDecoding:false});if(decoded.width>512||decoded.height>512||!decoded.width||!decoded.height)return json({error:'الصورة أكبر من الأبعاد المسموحة'},400);
  // Re-encode to strip all EXIF/location metadata and non-image payloads.
  const clean=jpeg.encode(decoded,75).data;if(clean.length>100000)return json({error:'اختر صورة أصغر'},400);
  const b64=imageBase64(new Uint8Array(clean));
  const uploaded=await fetch(BRIDGE,{method:'POST',headers:{'Content-Type':'text/plain;charset=utf-8'},body:JSON.stringify({category:'archive',fileName:'staff-profile-'+me+'-'+crypto.randomUUID()+'.jpg',mimeType:'image/jpeg',contentTitle:'صور الموظفين',base64:b64}),signal:AbortSignal.timeout(30000)});
  const file=await uploaded.json();if(!uploaded.ok||!file.ok||!/^[A-Za-z0-9_-]{10,200}$/.test(file.fileId||''))throw Error('تعذر حفظ الصورة على جوجل درايف؛ صورتك السابقة لم تتغير');
  // Do not report success or replace the old profile until a cold read can retrieve the file.
  await readArchivePhoto(file.fileId);
  const saved=await db.from('staff_profile_photos').upsert({admin_id:me,drive_file_id:file.fileId,mime_type:'image/jpeg',updated_at:new Date().toISOString()});if(saved.error)throw Error('الصورة رُفعت لكن تعذر ربطها بالبروفايل؛ أعد المحاولة');
  return json({photo:'data:image/jpeg;base64,'+b64});
 }catch(_e){return json({error:'تعذر حفظ أو عرض الصورة. تحقق من اتصال جوجل درايف وأعد المحاولة'},400);}
});
