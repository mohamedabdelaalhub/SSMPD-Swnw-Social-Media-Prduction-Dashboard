import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import {createClient} from "npm:@supabase/supabase-js@2";
const url=Deno.env.get('SUPABASE_URL')!,key=Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,anon=Deno.env.get('SUPABASE_ANON_KEY')!;
const HOME='https://mohamedabdelaalhub.github.io/SSMPD-Swnw-Social-Media-Prduction-Dashboard/';
const cors={'Access-Control-Allow-Origin':'*','Access-Control-Allow-Headers':'authorization,apikey,content-type,x-client-info','Access-Control-Allow-Methods':'POST, OPTIONS'};
const json=(b:unknown,s=200)=>new Response(JSON.stringify(b),{status:s,headers:{...cors,'Content-Type':'application/json','Cache-Control':'no-store'}});
const esc=(v:string)=>v.replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]!));
function b64(v:string){return btoa(Array.from(new TextEncoder().encode(v),b=>String.fromCharCode(b)).join(''));}
Deno.serve(async req=>{
 if(req.method==='OPTIONS')return new Response('ok',{headers:cors});
 if(req.method!=='POST')return json({error:'طلب غير متاح'},405);
 let job:any=null,mailStarted=false;const db=createClient(url,key);
 try{
  const userClient=createClient(url,anon,{global:{headers:{Authorization:req.headers.get('Authorization')||''}}});
  const {data:{user},error:authError}=await userClient.auth.getUser();if(authError||!user)return json({error:'سجل الدخول'},401);
  const {data:actor}=await userClient.rpc('my_admin_id');if(!actor)return json({error:'الحساب غير فعال'},403);
  const input=await req.json();if(!/^[\da-f-]{36}$/i.test(input.job_id||''))return json({error:'مرجع الدعوة غير صحيح'},400);
  const claimed=await db.rpc('hr_claim_account_job',{p_id:input.job_id,p_actor:actor});if(claimed.error)return json({error:claimed.error.message},403);job=claimed.data;
  if(job.status!=='claimed')return json({status:job.status});
  const cid=Deno.env.get('GMAIL_CLIENT_ID'),secret=Deno.env.get('GMAIL_CLIENT_SECRET'),refresh=Deno.env.get('GMAIL_REFRESH_TOKEN'),from=Deno.env.get('GMAIL_FROM');
  if(!cid||!secret||!refresh||!from)throw Error('إرسال البريد غير مهيأ؛ الملف محفوظ ويمكن إعادة المحاولة بعد ضبط البريد');
  const tokenRes=await fetch('https://oauth2.googleapis.com/token',{method:'POST',body:new URLSearchParams({client_id:cid,client_secret:secret,refresh_token:refresh,grant_type:'refresh_token'}),signal:AbortSignal.timeout(20000)});
  const token=await tokenRes.json();if(!tokenRes.ok||!token.access_token)throw Error('تعذر الاتصال ببريد المركز؛ الملف محفوظ');
  const generated=await db.auth.admin.generateLink({type:job.auth_user_id?'recovery':'invite',email:job.email,options:{redirectTo:HOME+'?staff_welcome=1',data:{name:job.name}}});
  if(generated.error||!generated.data.user||!generated.data.properties?.action_link)throw Error('تعذر تجهيز الدعوة. لو البريد مسجل بالفعل اختَر ربط المستخدم الحالي من لوحة المستخدمين');
  const uid=generated.data.user.id;
  if(job.auth_user_id&&job.auth_user_id!==uid)throw Error('هوية الحساب تغيرت');
  const saved=await db.from('hr_account_jobs').update({auth_user_id:uid}).eq('id',job.id).eq('status','sending');if(saved.error)throw Error('تعذر تسجيل حالة الدعوة');
  const bound=await db.from('admins').update({user_id:uid}).eq('id',job.admin_id).is('user_id',null);if(bound.error)throw Error('تعذر ربط حساب الدخول');
  const actual=await db.from('admins').select('user_id,active,role,email').eq('id',job.admin_id).single();if(actual.error||actual.data.user_id!==uid||!actual.data.active||actual.data.role!==job.role||actual.data.email.toLowerCase().trim()!==job.email)throw Error('الحساب تغير أثناء تجهيز الدعوة');
  const link=generated.data.properties.action_link;
  const html='<div dir="rtl" style="font-family:Tahoma,Arial;line-height:1.9"><h2>أهلًا '+esc(job.name)+'</h2><p>تمت إضافتك إلى نظام Swnw.</p><p>بريد الدخول: <b>'+esc(job.email)+'</b></p><p>١. اضغط الزر التالي<br>٢. اختر كلمة سر خاصة بك واحفظها<br>٣. ادخل بعد ذلك ببريدك وكلمة السر</p><p><a href="'+esc(link)+'" style="background:#0F369D;color:white;padding:12px 20px;border-radius:12px">تفعيل حسابي واختيار كلمة السر</a></p><p>الرابط خاص بك ومؤقت، لا تشاركه مع أي شخص. الأقسام المتاحة حسب دورك الوظيفي، ولطلب صلاحية إضافية تواصل مع الإدارة.</p><p><a href="'+HOME+'">فتح النظام</a></p></div>';
  const message=['From: Swnw <'+from+'>','To: '+job.email,'Subject: =?UTF-8?B?'+b64('دعوتك للانضمام إلى نظام Swnw')+'?=','MIME-Version: 1.0','Content-Type: text/html; charset=UTF-8','Content-Transfer-Encoding: base64','',b64(html)].join('\r\n');
  mailStarted=true;
  const sent=await fetch('https://gmail.googleapis.com/gmail/v1/users/me/messages/send',{method:'POST',headers:{Authorization:'Bearer '+token.access_token,'Content-Type':'application/json'},body:JSON.stringify({raw:b64(message).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'')}),signal:AbortSignal.timeout(25000)});
  if(!sent.ok){mailStarted=false;throw Error('لم يقبل بريد المركز إرسال الدعوة؛ الحساب محفوظ ويمكن إعادة المحاولة');}
  const result=await sent.json();const updated=await db.from('hr_account_jobs').update({status:'sent',sent_at:new Date().toISOString(),mail_id:result.id,lease_until:null}).eq('id',job.id);
  if(updated.error)throw Error('تعذر تأكيد تسجيل الإرسال');
  return json({status:'sent'});
 }catch(e){if(job?.id)await db.from('hr_account_jobs').update({status:mailStarted?'delivery_unknown':'failed',lease_until:null}).eq('id',job.id);return json({error:mailStarted?'قد تكون الدعوة أُرسلت، لكن تعذر تأكيدها. راجع البريد قبل إعادة الإرسال':String((e as Error).message||'تعذر تجهيز الدعوة')},400);}
});
