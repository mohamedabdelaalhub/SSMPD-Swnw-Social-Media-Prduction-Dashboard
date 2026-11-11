// Connect a YouTube channel (sono / dr_dina) to the dashboard with Google OAuth, and save the Google OAuth app.
//   POST {op:"status", brand}          → is the app set up, is this brand's channel connected (any publishing role)
//   POST {op:"save_app", client_id, client_secret}   → super admin only; stored service-role-only, never returned
//   POST {op:"connect", brand}         → Google consent URL (offline access, so the server can upload later)
//   GET  ?code&state                   → Google sends the user back here; we keep only the refresh token
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const SB_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const ANON = Deno.env.get("SUPABASE_ANON_KEY")!;
const PUBLIC_API = "https://api.swnwclinics.com";
const REDIRECT_URI = PUBLIC_API + "/functions/v1/youtube-auth";
const DASHBOARD = "https://dashboard.swnwclinics.com/";
const ORIGINS = ["https://dashboard.swnwclinics.com", "https://mohamedabdelaalhub.github.io"];
const SCOPES = "https://www.googleapis.com/auth/youtube.upload https://www.googleapis.com/auth/youtube.readonly";
const admin = createClient(SB_URL, SERVICE, { auth: { persistSession: false } });

function cors(req: Request) {
  const o = req.headers.get("Origin") || "";
  return {
    "Access-Control-Allow-Origin": ORIGINS.includes(o) ? o : ORIGINS[0],
    "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-client-info",
    "Access-Control-Allow-Methods": "POST, GET, OPTIONS",
    "Vary": "Origin",
    "Content-Type": "application/json; charset=utf-8",
  };
}

async function currentAdmin(req: Request) {
  const token = req.headers.get("Authorization")?.replace(/^Bearer\s+/i, "");
  if (!token) throw new Error("سجّل الدخول للداشبورد الأول.");
  const client = createClient(SB_URL, ANON, { global: { headers: { Authorization: "Bearer " + token } }, auth: { persistSession: false } });
  const { data: u, error: ue } = await client.auth.getUser(token);
  if (ue || !u.user) throw new Error("جلسة الدخول انتهت. سجّل الدخول مرة أخرى.");
  const { data: row, error } = await admin.from("admins").select("id,user_id,role,active").eq("user_id", u.user.id).maybeSingle();
  if (error || !row || !row.active || !["page_manager", "approver", "general_manager", "super_admin"].includes(row.role)) {
    throw new Error("حسابك لا يملك صلاحية ربط قناة يوتيوب.");
  }
  return row;
}

async function appConfig() {
  const { data, error } = await admin.from("youtube_app_config").select("client_id,client_secret").eq("id", 1).maybeSingle();
  if (error) throw error;
  return data as { client_id: string; client_secret: string } | null;
}

function page(message: string, ok: boolean) {
  const safe = message.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]!));
  return new Response(`<!doctype html><html lang="ar" dir="rtl"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>ربط يوتيوب</title><body style="font:17px system-ui,Tahoma,sans-serif;padding:32px;text-align:center;color:#16212E"><p style="font-size:42px;margin:0">${ok ? "✅" : "⚠️"}</p><p>${safe}</p><p><a href="${DASHBOARD}" style="color:#0F369D">الرجوع إلى الداشبورد</a></p><script>setTimeout(()=>location.replace("${DASHBOARD}"),2500)</script></body></html>`,
    { headers: { "Content-Type": "text/html; charset=utf-8" } });
}

Deno.serve(async (req) => {
  const h = cors(req);
  const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: h });
  if (req.method === "OPTIONS") return new Response("ok", { headers: h });
  try {
    if (req.method === "POST") {
      const row = await currentAdmin(req);
      const body = await req.json().catch(() => ({}));
      if (body.op === "save_app") {
        if (row.role !== "super_admin") return json({ error: "إعداد تطبيق Google للسوبر أدمن بس." }, 403);
        const id = String(body.client_id || "").trim(), secret = String(body.client_secret || "").trim();
        if (!/^[0-9]+-[a-z0-9]+\.apps\.googleusercontent\.com$/.test(id)) return json({ error: "Client ID شكله مش صحيح — لازم ينتهي بـ .apps.googleusercontent.com" }, 400);
        if (!/^[A-Za-z0-9_-]{20,80}$/.test(secret)) return json({ error: "Client Secret شكله مش صحيح." }, 400);
        const { error } = await admin.from("youtube_app_config").upsert({ id: 1, client_id: id, client_secret: secret, updated_by: row.id, updated_at: new Date().toISOString() });
        if (error) throw error;
        return json({ ok: true });
      }
      const brand = body.brand;
      if (!["sono", "dr_dina"].includes(brand)) return json({ error: "اختار صفحة سونو أو د.دينا." }, 400);
      const cfg = await appConfig();
      if (body.op === "status") {
        const { data, error } = await admin.from("youtube_accounts").select("channel_title,thumbnail_url,updated_at").eq("brand", brand).maybeSingle();
        if (error) throw error;
        return json({ app_ready: !!cfg, is_super: row.role === "super_admin", connected: !!data, channel: data || null, redirect_uri: REDIRECT_URI });
      }
      if (body.op !== "connect") return json({ error: "عملية غير معروفة." }, 400);
      if (!cfg) return json({ error: "تطبيق Google لسه متظبطش. السوبر أدمن يحط بياناته الأول." }, 400);
      const state = Array.from(crypto.getRandomValues(new Uint8Array(32)), (x) => x.toString(16).padStart(2, "0")).join("");
      const { error } = await admin.from("youtube_oauth_states").insert({ state, brand, admin_user_id: row.user_id, expires_at: new Date(Date.now() + 15 * 60_000).toISOString() });
      if (error) throw error;
      const u = new URL("https://accounts.google.com/o/oauth2/v2/auth");
      u.searchParams.set("client_id", cfg.client_id);
      u.searchParams.set("redirect_uri", REDIRECT_URI);
      u.searchParams.set("response_type", "code");
      u.searchParams.set("scope", SCOPES);
      u.searchParams.set("access_type", "offline");
      u.searchParams.set("prompt", "consent select_account");
      u.searchParams.set("include_granted_scopes", "true");
      u.searchParams.set("state", state);
      return json({ authorize_url: u.toString() });
    }
    if (req.method !== "GET") return json({ error: "Method not allowed" }, 405);

    const url = new URL(req.url);
    if (url.searchParams.get("error")) return page("ربط القناة ما كملش. ارجع للداشبورد وجرّب تاني.", false);
    const code = url.searchParams.get("code"), state = url.searchParams.get("state");
    if (!code || !state) return page("بيانات الرجوع من جوجل ناقصة.", false);
    const { data: st, error: se } = await admin.from("youtube_oauth_states").delete().eq("state", state).gt("expires_at", new Date().toISOString()).select("brand,admin_user_id").maybeSingle();
    if (se || !st) return page("محاولة الربط انتهت صلاحيتها. ابدأ الربط من الداشبورد تاني.", false);
    const cfg = await appConfig();
    if (!cfg) return page("تطبيق Google لسه متظبطش.", false);
    const tr = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ code, client_id: cfg.client_id, client_secret: cfg.client_secret, redirect_uri: REDIRECT_URI, grant_type: "authorization_code" }),
    });
    const tok = await tr.json().catch(() => ({}));
    if (!tr.ok || !tok.access_token) {
      console.error("YouTube OAuth exchange failed", tok.error || tr.status);
      return page("جوجل ما كملتش التفويض. اتأكد إن رابط الرجوع متسجل في تطبيق Google بالظبط، وجرّب تاني.", false);
    }
    if (!tok.refresh_token) return page("جوجل ما رجّعتش صلاحية دائمة. افتح myaccount.google.com/permissions، شيل صلاحية التطبيق، وجرّب الربط تاني.", false);
    const granted = String(tok.scope || "").split(" ").filter(Boolean);
    if (!granted.includes("https://www.googleapis.com/auth/youtube.upload")) return page("لازم توافق على صلاحية رفع الفيديوهات عشان النشر الآلي يشتغل. جرّب تاني وعلّم على كل الصلاحيات.", false);
    const cr = await fetch("https://www.googleapis.com/youtube/v3/channels?part=snippet&mine=true", { headers: { Authorization: "Bearer " + tok.access_token } });
    const cd = await cr.json().catch(() => ({}));
    const ch = cd.items?.[0];
    if (!cr.ok || !ch) return page("الحساب ده مالوش قناة يوتيوب. اختار حساب القناة (أو Brand Account بتاعها) وانت بتربط.", false);
    const { error: ae } = await admin.from("youtube_accounts").upsert({
      brand: st.brand, channel_id: ch.id, channel_title: ch.snippet?.title || null,
      thumbnail_url: ch.snippet?.thumbnails?.default?.url || null,
      refresh_token: tok.refresh_token, access_token: tok.access_token,
      access_token_expires_at: new Date(Date.now() + Number(tok.expires_in || 3600) * 1000).toISOString(),
      scopes: granted, connected_by: st.admin_user_id, connected_at: new Date().toISOString(), updated_at: new Date().toISOString(),
    }, { onConflict: "brand" });
    if (ae) throw ae;
    return page("تم ربط قناة «" + (ch.snippet?.title || "يوتيوب") + "» بنجاح.", true);
  } catch (e) {
    console.error("youtube-auth", e instanceof Error ? e.message : String(e));
    if (req.method === "GET") return page("تعذّر ربط القناة. ارجع للداشبورد وجرّب تاني.", false);
    return json({ error: e instanceof Error ? e.message : "تعذّر تنفيذ الطلب." }, 400);
  }
});
