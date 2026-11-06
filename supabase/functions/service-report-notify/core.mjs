// Pure helpers for service-report-notify (testable in node; imported by index.ts).
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const PORTAL_URL="https://mohamedabdelaalhub.github.io/SSMPD-Swnw-Social-Media-Prduction-Dashboard/patient-portal/";
export function parseBody(b){
  if(!b||typeof b!=="object")throw new Error("INVALID_BODY");
  if(!UUID.test(String(b.workspace||""))||!UUID.test(String(b.order||"")))throw new Error("INVALID_IDS");
  return {workspace:String(b.workspace),order:String(b.order)};
}
// No medical details, no service name: only that something new is waiting in the portal.
export function buildEmail(portalUrl=PORTAL_URL){
  const subject="تقرير جديد في ملفك — مراكز Swnw";
  const text=["أهلاً بحضرتك،","","تم رفع تقرير جديد في ملفك بمراكز Swnw.","لعرضه، سجّل الدخول إلى بوابة المريض من الرابط التالي:",portalUrl,"","للاستفسار تواصل مع المركز.","مراكز Swnw"].join("\n");
  const esc=(s)=>String(s).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;");
  const html=`<div dir="rtl" style="font-family:Tahoma,Arial,sans-serif;line-height:1.8"><p>أهلاً بحضرتك،</p><p>تم رفع تقرير جديد في ملفك بمراكز Swnw.</p><p>لعرضه، سجّل الدخول إلى <a href="${esc(portalUrl)}">بوابة المريض</a>.</p><p>للاستفسار تواصل مع المركز.<br>مراكز Swnw</p></div>`;
  return {subject,text,html};
}
export function senderEmail(from){const m=String(from||"").match(/<([^>]+)>/);return m?m[1]:String(from||"");}
export function pickProvider(env){
  if(env.gmail&&env.gmail.id&&env.gmail.secret&&env.gmail.refresh&&env.gmail.from)return {name:"gmail"};
  if(!env.from)return {error:"EMAIL_FROM_NOT_CONFIGURED"};
  if(env.resend)return {name:"resend"};
  if(env.brevo)return {name:"brevo"};
  if(env.sendgrid)return {name:"sendgrid"};
  return {error:"EMAIL_NOT_CONFIGURED"};
}
const b64=(str)=>{const u=new TextEncoder().encode(str);let b="";for(const x of u)b+=String.fromCharCode(x);return btoa(b);};
const b64url=(str)=>b64(str).replace(/\+/g,"-").replace(/\//g,"_").replace(/=+$/,"");
export function buildMime(from,to,msg){
  return ["From: "+from,"To: "+to,"Subject: =?UTF-8?B?"+b64(msg.subject)+"?=","MIME-Version: 1.0","Content-Type: text/html; charset=UTF-8","Content-Transfer-Encoding: base64","",b64(msg.html)].join("\r\n");
}
async function sendGmail(g,to,msg,fetchImpl){
  const t=await fetchImpl("https://oauth2.googleapis.com/token",{method:"POST",headers:{"Content-Type":"application/x-www-form-urlencoded"},body:new URLSearchParams({client_id:g.id,client_secret:g.secret,refresh_token:g.refresh,grant_type:"refresh_token"}).toString()});
  if(!t.ok)return {ok:false,code:"EMAIL_SEND_FAILED",provider:"gmail",status:t.status};
  const tok=(await t.json()).access_token;
  const r=await fetchImpl("https://gmail.googleapis.com/gmail/v1/users/me/messages/send",{method:"POST",headers:{Authorization:"Bearer "+tok,"Content-Type":"application/json"},body:JSON.stringify({raw:b64url(buildMime(g.from,to,msg))})});
  if(!r.ok)return {ok:false,code:"EMAIL_SEND_FAILED",provider:"gmail",status:r.status};
  return {ok:true,provider:"gmail"};
}
export async function sendEmail(env,to,msg,fetchImpl=fetch){
  const p=pickProvider(env);if(p.error)return {ok:false,code:p.error};
  if(p.name==="gmail"){try{return await sendGmail(env.gmail,to,msg,fetchImpl);}catch(e){return {ok:false,code:"EMAIL_SEND_FAILED",provider:"gmail"};}}
  const sender=senderEmail(env.from);let r;
  try{
    if(p.name==="resend")r=await fetchImpl("https://api.resend.com/emails",{method:"POST",headers:{Authorization:`Bearer ${env.resend}`,"Content-Type":"application/json"},body:JSON.stringify({from:env.from,to:[to],subject:msg.subject,text:msg.text,html:msg.html})});
    else if(p.name==="brevo")r=await fetchImpl("https://api.brevo.com/v3/smtp/email",{method:"POST",headers:{"api-key":env.brevo,"Content-Type":"application/json",accept:"application/json"},body:JSON.stringify({sender:{name:"Swnw Clinics",email:sender},to:[{email:to}],subject:msg.subject,textContent:msg.text,htmlContent:msg.html})});
    else r=await fetchImpl("https://api.sendgrid.com/v3/mail/send",{method:"POST",headers:{Authorization:`Bearer ${env.sendgrid}`,"Content-Type":"application/json"},body:JSON.stringify({personalizations:[{to:[{email:to}]}],from:{email:sender,name:"Swnw Clinics"},subject:msg.subject,content:[{type:"text/plain",value:msg.text},{type:"text/html",value:msg.html}]})});
  }catch(e){return {ok:false,code:"EMAIL_SEND_FAILED",provider:p.name};}
  if(!r.ok)return {ok:false,code:"EMAIL_SEND_FAILED",provider:p.name,status:r.status};
  return {ok:true,provider:p.name};
}
