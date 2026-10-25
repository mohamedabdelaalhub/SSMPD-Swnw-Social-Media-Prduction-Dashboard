import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const ANON = Deno.env.get("SUPABASE_ANON_KEY")!;
const DASHBOARD = "https://mohamedabdelaalhub.github.io/SSMPD-Swnw-Social-Media-Prduction-Dashboard/";
const DASHBOARD_ORIGIN = "https://mohamedabdelaalhub.github.io";
const REDIRECT_URI = SUPABASE_URL.replace(/\/+$/, "") + "/functions/v1/tiktok-auth";
const admin = createClient(SUPABASE_URL, SERVICE, { auth: { persistSession: false } });
const cors = {
  "Access-Control-Allow-Origin": DASHBOARD_ORIGIN,
  "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-client-info",
  "Access-Control-Allow-Methods": "POST, GET, OPTIONS",
  "Content-Type": "application/json; charset=utf-8"
};
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: cors });

// كل صفحة (brand) لها تطبيق TikTok منفصل، بمفتاحين خاصين بيها في أسرار Supabase.
// لما يتعمل تطبيق TikTok لصفحة د.دينا، يتضاف TIKTOK_CLIENT_KEY_DR_DINA / TIKTOK_CLIENT_SECRET_DR_DINA
// بدون أي تعديل تاني في الكود هنا.
const BRAND_LABELS: Record<string, string> = { sono: "Swnw", dr_dina: "د.دينا" };
// "sono" هو القيمة الداخلية القديمة لصفحة المركز الرئيسي في قاعدة البيانات (ومنتشرة في جداول تانية كتير)،
// لكن الاسم المعروض دايمًا Swnw. أسرار Supabase بتتسمى بالاسم المعروض SWNW علشان ميبقاش فيه لبس.
const BRAND_ENV_SUFFIX: Record<string, string> = { sono: "SWNW", dr_dina: "DR_DINA" };
function credsFor(brand: string) {
  const envSuffix = BRAND_ENV_SUFFIX[brand] || brand.toUpperCase();
  const key = Deno.env.get(`TIKTOK_CLIENT_KEY_${envSuffix}`);
  const secret = Deno.env.get(`TIKTOK_CLIENT_SECRET_${envSuffix}`);
  if (!key || !secret) return null;
  return { key, secret };
}

async function currentAdmin(req: Request) {
  const token = req.headers.get("Authorization")?.replace(/^Bearer\s+/i, "");
  if (!token) throw new Error("سجّل الدخول للداشبورد الأول.");
  const client = createClient(SUPABASE_URL, ANON, { global: { headers: { Authorization: "Bearer " + token } }, auth: { persistSession: false } });
  const { data: userData, error: userError } = await client.auth.getUser(token);
  if (userError || !userData.user) throw new Error("جلسة الدخول انتهت. سجّل الدخول مرة أخرى.");
  const { data: row, error } = await admin.from("admins").select("id,user_id,role,active").eq("user_id", userData.user.id).maybeSingle();
  if (error || !row || !row.active || !["page_manager","approver","general_manager","super_admin"].includes(row.role)) {
    throw new Error("حسابك لا يملك صلاحية ربط حساب TikTok.");
  }
  return { user: userData.user, row };
}

function html(message: string) {
  const safe = message.replace(/[&<>"]/g, c => ({ "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;" }[c]!));
  return new Response(`<!doctype html><html lang="ar" dir="rtl"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>ربط TikTok</title><body style="font:16px sans-serif;padding:32px;text-align:center"><p>${safe}</p><a href="${DASHBOARD}">الرجوع إلى الداشبورد</a><script>setTimeout(()=>location.replace("${DASHBOARD}"),1800)</script></body></html>`, { headers: { "Content-Type": "text/html; charset=utf-8" } });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  try {
    if (req.method === "POST") {
      const { row } = await currentAdmin(req);
      const body = await req.json().catch(() => ({}));
      const brand = body.brand;
      if (!["sono","dr_dina"].includes(brand)) return json({ error: "اختار صفحة سونو أو د.دينا." }, 400);
      const creds = credsFor(brand);
      if (body.op === "connection") {
        const { data, error } = await admin.from("tiktok_accounts").select("brand,display_name,avatar_url,updated_at").eq("brand",brand).maybeSingle();
        if(error)throw error;
        return json({ connected:!!data, account:data||null });
      }
      if (body.op === "creator_info") {
        const { data: account, error } = await admin.from("tiktok_accounts").select("*").eq("brand",brand).maybeSingle();
        if(error)throw error;
        if(!account)return json({ connected:false });
        if(!creds) return json({ error: `تطبيق TikTok الخاص بصفحة ${BRAND_LABELS[brand]} مش مضبوط لسه.` }, 500);
        let token=account.access_token;
        if(new Date(account.access_token_expires_at).getTime()<=Date.now()+5*60*1000){
          if(new Date(account.refresh_token_expires_at).getTime()<=Date.now())return json({connected:true,reauthorize:true});
          const refresh=await fetch("https://open.tiktokapis.com/v2/oauth/token/",{method:"POST",headers:{"Content-Type":"application/x-www-form-urlencoded"},body:new URLSearchParams({client_key:creds.key,client_secret:creds.secret,grant_type:"refresh_token",refresh_token:account.refresh_token})});
          const rd=await refresh.json().catch(()=>({}));
          if(!refresh.ok||rd.error||!rd.access_token)return json({connected:true,reauthorize:true});
          token=rd.access_token;
          await admin.from("tiktok_accounts").update({access_token:rd.access_token,refresh_token:rd.refresh_token||account.refresh_token,access_token_expires_at:new Date(Date.now()+Number(rd.expires_in||86400)*1000).toISOString(),refresh_token_expires_at:new Date(Date.now()+Number(rd.refresh_expires_in||31536000)*1000).toISOString(),updated_at:new Date().toISOString()}).eq("brand",brand);
        }
        const response=await fetch("https://open.tiktokapis.com/v2/post/publish/creator_info/query/",{method:"POST",headers:{Authorization:"Bearer "+token,"Content-Type":"application/json; charset=UTF-8"},body:"{}"});
        const data=await response.json().catch(()=>({}));
        if(!response.ok||data.error?.code&&data.error.code!=="ok")throw new Error(data.error?.message||"تعذر قراءة إعدادات حساب TikTok.");
        return json({connected:true,creator:data.data||{}});
      }
      if (body.op !== "connect") return json({ error: "عملية غير معروفة." }, 400);
      if (!creds) return json({ error: `تطبيق TikTok الخاص بصفحة ${BRAND_LABELS[brand]} مش مضبوط لسه.` }, 500);
      const stateBytes = crypto.getRandomValues(new Uint8Array(32));
      const state = Array.from(stateBytes, x => x.toString(16).padStart(2,"0")).join("");
      const { error } = await admin.from("tiktok_oauth_states").insert({
        state, brand, admin_user_id: row.user_id, expires_at: new Date(Date.now()+10*60*1000).toISOString()
      });
      if (error) throw error;
      const authorize = new URL("https://www.tiktok.com/v2/auth/authorize/");
      authorize.searchParams.set("client_key", creds.key);
      authorize.searchParams.set("response_type", "code");
      authorize.searchParams.set("scope", "user.info.basic,video.publish");
      authorize.searchParams.set("redirect_uri", REDIRECT_URI);
      authorize.searchParams.set("state", state);
      return json({ authorize_url: authorize.toString(), redirect_uri: REDIRECT_URI });
    }
    if (req.method !== "GET") return json({ error: "Method not allowed" }, 405);
    const url = new URL(req.url);
    if (url.searchParams.get("error")) return html("لم يكتمل ربط حساب TikTok. ارجع للداشبورد وحاول مرة أخرى.");
    const code = url.searchParams.get("code"), state = url.searchParams.get("state");
    if (!code || !state) return html("بيانات العودة من TikTok ناقصة.");
    const { data: stateRow, error: stateError } = await admin.from("tiktok_oauth_states").delete().eq("state",state).gt("expires_at",new Date().toISOString()).select("brand,admin_user_id").maybeSingle();
    if (stateError || !stateRow) return html("انتهت صلاحية محاولة الربط. ارجع للداشبورد وابدأ الربط مرة أخرى.");
    const creds = credsFor(stateRow.brand);
    if (!creds) return html(`تطبيق TikTok الخاص بصفحة ${BRAND_LABELS[stateRow.brand] || stateRow.brand} مش مضبوط لسه.`);
    const tokenRes = await fetch("https://open.tiktokapis.com/v2/oauth/token/", {
      method:"POST", headers:{"Content-Type":"application/x-www-form-urlencoded"},
      body:new URLSearchParams({client_key:creds.key,client_secret:creds.secret,code,grant_type:"authorization_code",redirect_uri:REDIRECT_URI})
    });
    const tokenData = await tokenRes.json().catch(()=>({}));
    if (!tokenRes.ok || tokenData.error || !tokenData.access_token) {
      console.error("TikTok OAuth exchange failed", tokenData.error || tokenRes.status);
      return html("TikTok لم يُكمل التفويض. راجع إعداد Redirect URI في صفحة التطبيق ثم حاول مرة أخرى.");
    }
    const profileRes = await fetch("https://open.tiktokapis.com/v2/user/info/?fields=open_id,display_name,avatar_url", {
      headers:{Authorization:"Bearer "+tokenData.access_token}
    });
    const profileData = await profileRes.json().catch(()=>({}));
    const profile = profileData.data?.user || {};
    const { error: saveError } = await admin.from("tiktok_accounts").upsert({
      brand:stateRow.brand, open_id:tokenData.open_id, username:profile.username||null,
      display_name:profile.display_name||null, avatar_url:profile.avatar_url||null,
      access_token:tokenData.access_token, refresh_token:tokenData.refresh_token,
      access_token_expires_at:new Date(Date.now()+Number(tokenData.expires_in||86400)*1000).toISOString(),
      refresh_token_expires_at:new Date(Date.now()+Number(tokenData.refresh_expires_in||31536000)*1000).toISOString(),
      scopes:String(tokenData.scope||"").split(",").filter(Boolean), connected_by:stateRow.admin_user_id,
      updated_at:new Date().toISOString()
    },{onConflict:"brand"});
    if (saveError) throw saveError;
    return html("تم ربط حساب TikTok بنجاح.");
  } catch (e) {
    if (req.method === "GET") return html("تعذر ربط الحساب. ارجع للداشبورد وحاول مرة أخرى.");
    return json({ error: e instanceof Error ? e.message : "تعذر ربط الحساب." }, 400);
  }
});
