import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const URL = Deno.env.get("SUPABASE_URL") || "";
const ANON = Deno.env.get("SUPABASE_ANON_KEY") || "";
function serviceKey(): string {
  const raw = Deno.env.get("SUPABASE_SECRET_KEYS");
  if (raw) { try { const obj=JSON.parse(raw);if(typeof obj?.default==="string"&&obj.default)return obj.default; } catch (_) { /* legacy env */ } }
  return Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
}
const CORS = {
  "Access-Control-Allow-Origin":"*",
  "Access-Control-Allow-Headers":"authorization,apikey,content-type,x-client-info",
  "Access-Control-Allow-Methods":"POST,OPTIONS"
};
const json=(body:unknown,status=200)=>new Response(JSON.stringify(body),{status,headers:{...CORS,"Content-Type":"application/json","Cache-Control":"no-store"}});
const strip=(value:unknown,limit:number)=>String(value??"").trim().slice(0,limit);
Deno.serve(async(req:Request)=>{
  if(req.method==="OPTIONS")return new Response(null,{status:204,headers:CORS});
  if(req.method!=="POST")return json({ok:false,error:"POST only"},405);
  const token=(req.headers.get("Authorization")||"").replace(/^Bearer\s+/i,"");
  if(!token||!URL||!ANON||!serviceKey())return json({ok:false,error:"Unauthorized"},401);
  const viewer=createClient(URL,ANON,{auth:{persistSession:false,autoRefreshToken:false},global:{headers:{Authorization:"Bearer "+token}}});
  const {data:{user},error:authErr}=await viewer.auth.getUser(token);
  if(authErr||!user)return json({ok:false,error:"Invalid session"},401);
  const db=createClient(URL,serviceKey(),{auth:{persistSession:false,autoRefreshToken:false}});
  const {data:admin,error:adminErr}=await db.from("admins").select("id").eq("user_id",user.id).eq("active",true).maybeSingle();
  if(adminErr||!admin)return json({ok:false,error:"No active employee"},403);
  let b:Record<string,unknown>;
  try{b=await req.json();}catch(_){return json({ok:false,error:"Invalid JSON"},400);}
  const resultId=strip(b.work_result_id,40),fileId=strip(b.drive_file_id,160);
  const raw=strip(b.content_excerpt,13000),fileName=strip(b.file_name,290);
  if(!/^[0-9a-f-]{36}$/.test(resultId)||!/^[A-Za-z0-9_-]{5,160}$/.test(fileId)||raw.length<10||raw.length>12000||fileName.length<1)
    return json({ok:false,error:"Invalid evidence"},400);
  if(!/\.(csv|xlsx|xls|txt)$/i.test(fileName))return json({ok:false,error:"Unsupported file"},400);
  const {data:result,error:resultErr}=await db.from("task_work_results").select("task_id,author_id,attachments").eq("id",resultId).maybeSingle();
  if(resultErr||!result||result.author_id!==admin.id)return json({ok:false,error:"Result not owned by user"},403);
  const attachments=Array.isArray(result.attachments)?result.attachments:[];
  const found=attachments.some((x:any)=>x&&String(x.file_id||"")===fileId&&String(x.name||"")===fileName);
  if(!found)return json({ok:false,error:"Attachment not in submitted result"},403);
  // Remove contact identifiers before retaining a bounded preview. This does not replace owner verification.
  const redacted=raw
    .replace(/\b(?:\+?20|0)?1[0125]\d{8}\b/g,"[PHONE_REDACTED]")
    .replace(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi,"[EMAIL_REDACTED]")
    .replace(/\b\d{14}\b/g,"[ID_REDACTED]");
  const {error:insertErr}=await db.from("task_attachment_evidence").upsert({
    task_id:result.task_id,work_result_id:resultId,
    drive_file_id:fileId,file_name:fileName,content_excerpt:redacted,
    source:"client_extract",verification_state:"unverified_client_text"
  },{onConflict:"work_result_id,drive_file_id",ignoreDuplicates:true});
  if(insertErr)return json({ok:false,error:"Could not save evidence"},500);
  return json({ok:true,state:"unverified_client_text",instruction:"File preview is not independently checked against Google Drive. Never auto-approve based only on this preview."});
});
