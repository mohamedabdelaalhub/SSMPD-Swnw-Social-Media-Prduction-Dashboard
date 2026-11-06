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
  if(!env.from)return {error:"EMAIL_FROM_NOT_CONFIGURED"};
  if(env.resend)return {name:"resend"};
  if(env.brevo)return {name:"brevo"};
  if(env.sendgrid)return {name:"sendgrid"};
  return {error:"EMAIL_NOT_CONFIGURED"};
}
export async function sendEmail(env,to,msg,fetchImpl=fetch){
  const p=pickProvider(env);if(p.error)return {ok:false,code:p.error};
  const sender=senderEmail(env.from);let r;
  try{
    if(p.name==="resend")r=await fetchImpl("https://api.resend.com/emails",{method:"POST",headers:{Authorization:`Bearer ${env.resend}`,"Content-Type":"application/json"},body:JSON.stringify({from:env.from,to:[to],subject:msg.subject,text:msg.text,html:msg.html})});
    else if(p.name==="brevo")r=await fetchImpl("https://api.brevo.com/v3/smtp/email",{method:"POST",headers:{"api-key":env.brevo,"Content-Type":"application/json",accept:"application/json"},body:JSON.stringify({sender:{name:"Swnw Clinics",email:sender},to:[{email:to}],subject:msg.subject,textContent:msg.text,htmlContent:msg.html})});
    else r=await fetchImpl("https://api.sendgrid.com/v3/mail/send",{method:"POST",headers:{Authorization:`Bearer ${env.sendgrid}`,"Content-Type":"application/json"},body:JSON.stringify({personalizations:[{to:[{email:to}]}],from:{email:sender,name:"Swnw Clinics"},subject:msg.subject,content:[{type:"text/plain",value:msg.text},{type:"text/html",value:msg.html}]})});
  }catch(e){return {ok:false,code:"EMAIL_SEND_FAILED",provider:p.name};}
  if(!r.ok)return {ok:false,code:"EMAIL_SEND_FAILED",provider:p.name,status:r.status};
  return {ok:true,provider:p.name};
}
