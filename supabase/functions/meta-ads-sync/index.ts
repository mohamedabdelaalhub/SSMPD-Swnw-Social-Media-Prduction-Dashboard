import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

// Meta Ads daily sync — READ ONLY (Graph GET requests only; never POST/DELETE to Meta).
//  • pg_cron (X-Cron-Secret = META_PUBLISH_CRON_SECRET): pulls the last 3 days of ad-level insights into
//    public.meta_ads_daily, then sends any new 80% / 100% spend-limit alerts (once per limit per window).
//  • {"op":"compare","day":"YYYY-MM-DD"} (cron secret): returns that day's spend straight from Meta and from our table
//    WITHOUT writing, to check against Ads Manager before the first real run.
//  • {"op":"save_token","token":"..."} (real super-admin session): stores the read token server-side. Never returned.
// Token needs ads_read on the ad account (System User). Missing permission => the run fails loudly, nothing partial is stored.

const CRON_SECRET = Deno.env.get("META_PUBLISH_CRON_SECRET");
const NTFY_URL = Deno.env.get("ADS_ALERT_NTFY_URL");  // optional, e.g. https://ntfy.example/topic
const GRAPH = "https://graph.facebook.com/v26.0/";

function serviceKey(): string | null {
  const raw = Deno.env.get("SUPABASE_SECRET_KEYS");
  if (raw) { try { const p = JSON.parse(raw); if (typeof p?.default === "string" && p.default) return p.default; } catch { /* legacy */ } }
  return Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || null;
}
// Browser calls (super-admin token box) come from the dashboard origin; cron calls ignore these headers.
const CORS = { "Access-Control-Allow-Origin": "https://dashboard.swnwclinics.com", "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-client-info", "Access-Control-Allow-Methods": "POST, OPTIONS", "Vary": "Origin" };
const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { ...CORS, "Content-Type": "application/json" } });
function safeEqual(a: string, b: string) {
  if (a.length !== b.length) return false;
  let d = 0; for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return d === 0;
}
const num = (v: unknown) => { const n = Number(v); return Number.isFinite(n) ? n : 0; };
const actionCount = (actions: any[] | undefined, type: string) =>
  Math.round(num((actions || []).find((a) => a.action_type === type)?.value));

async function graphGet(path: string, params: Record<string, string>, token: string) {
  const u = new URL(GRAPH + path);
  for (const [k, v] of Object.entries(params)) u.searchParams.set(k, v);
  u.searchParams.set("access_token", token);
  const r = await fetch(u.toString());
  const d = await r.json().catch(() => ({}));
  if (!r.ok || d.error) throw new Error(d.error?.message || `Graph HTTP ${r.status}`);
  return d;
}

async function fetchInsights(acct: string, token: string, since: string, until: string) {
  const rows: any[] = [];
  let d = await graphGet(`act_${acct}/insights`, {
    level: "ad", time_increment: "1", limit: "200",
    time_range: JSON.stringify({ since, until }),
    fields: "ad_id,ad_name,campaign_id,campaign_name,adset_id,spend,impressions,reach,clicks,actions",
  }, token);
  rows.push(...(d.data || []));
  for (let i = 0; i < 20 && d.paging?.next; i++) {
    const r = await fetch(d.paging.next);
    d = await r.json();
    if (d.error) throw new Error(d.error.message);
    rows.push(...(d.data || []));
  }
  return rows;
}

// صفحة الإعلان => الصفحة (سونو/د. دينا) عن طريق meta_brand_config. مفيش تخمين: لو مش معروفة brand = null.
async function brandMap(admin: any, acct: string, token: string, adIds: string[]) {
  const { data: cfg } = await admin.from("meta_brand_config").select("brand,facebook_page_id");
  const byPage = new Map<string, string>((cfg || []).map((c: any) => [String(c.facebook_page_id), c.brand]));
  const out = new Map<string, string>();
  for (let i = 0; i < adIds.length; i += 50) {
    const chunk = adIds.slice(i, i + 50);
    const d = await graphGet("", { ids: chunk.join(","), fields: "creative{effective_object_story_id}" }, token);
    for (const id of chunk) {
      const story = d[id]?.creative?.effective_object_story_id as string | undefined;
      const brand = story ? byPage.get(story.split("_")[0]) : undefined;
      if (brand) out.set(id, brand);
    }
  }
  return out;
}

async function notify(text: string) {
  if (!NTFY_URL) return false;
  const r = await fetch(NTFY_URL, { method: "POST", body: text, headers: { Title: "Ads spend limit", "Content-Type": "text/plain; charset=utf-8" } }).catch(() => null);
  return !!r?.ok;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ ok: false, error: "POST only" }, 405);
  const key = serviceKey();
  if (!key) return json({ ok: false, error: "MISCONFIGURED" }, 500);
  const admin = createClient(Deno.env.get("SUPABASE_URL")!, key);
  const body = await req.json().catch(() => ({}));
  const op = body?.op || "sync";

  if (op === "save_token") {
    const auth = req.headers.get("Authorization");
    if (!auth) return json({ ok: false, error: "UNAUTHORIZED" }, 401);
    const userClient = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY")!, { global: { headers: { Authorization: auth } } });
    const { data: { user } } = await userClient.auth.getUser();
    if (!user) return json({ ok: false, error: "UNAUTHORIZED" }, 401);
    const { data: me } = await admin.from("admins").select("id,role,active").eq("user_id", user.id).eq("active", true).maybeSingle();
    if (!me || me.role !== "super_admin") return json({ ok: false, error: "FORBIDDEN" }, 403);
    const token = typeof body.token === "string" ? body.token.trim() : "";
    if (token.length < 30) return json({ ok: false, error: "token too short" }, 400);
    const { error } = await admin.from("meta_ads_config").upsert({ id: 1, access_token: token, updated_at: new Date().toISOString(), updated_by: me.id });
    return error ? json({ ok: false, error: "save_failed" }, 500) : json({ ok: true });
  }

  if (!CRON_SECRET || !safeEqual(req.headers.get("X-Cron-Secret") || "", CRON_SECRET)) return json({ ok: false, error: "UNAUTHORIZED" }, 401);
  const { data: cfg } = await admin.from("meta_ads_config").select("ad_account_id,access_token").eq("id", 1).maybeSingle();
  if (!cfg?.access_token) return json({ ok: false, error: "NO_TOKEN" }, 409);
  const acct = cfg.ad_account_id as string, token = cfg.access_token as string;
  const today = new Date(Date.now() + 2 * 3600e3).toISOString().slice(0, 10);  // Cairo (UTC+2 in winter)

  if (op === "compare") {
    const day = String(body.day || "");
    if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return json({ ok: false, error: "day required" }, 400);
    try {
      const rows = await fetchInsights(acct, token, day, day);
      const meta = rows.reduce((s, r) => s + num(r.spend), 0);
      const { data: ours } = await admin.from("meta_ads_daily").select("spend").eq("ad_account_id", acct).eq("day", day);
      return json({ ok: true, day, meta_spend: Math.round(meta * 100) / 100, stored_spend: (ours || []).reduce((s: number, r: any) => s + num(r.spend), 0), ads: rows.length });
    } catch (e) { return json({ ok: false, error: String((e as Error).message).slice(0, 200) }, 502); }
  }

  const { data: run } = await admin.from("meta_ads_sync_runs").insert({}).select("id").single();
  try {
    const since = new Date(Date.now() + 2 * 3600e3 - 2 * 86400e3).toISOString().slice(0, 10);
    const rows = await fetchInsights(acct, token, since, today);
    const brands = await brandMap(admin, acct, token, [...new Set(rows.map((r) => String(r.ad_id)))]);
    const out = rows.map((r) => ({
      ad_account_id: acct, day: r.date_start, ad_id: String(r.ad_id), ad_name: r.ad_name, campaign_id: r.campaign_id,
      campaign_name: r.campaign_name, adset_id: r.adset_id, brand: brands.get(String(r.ad_id)) ?? null,
      spend: num(r.spend), impressions: Math.round(num(r.impressions)), reach: Math.round(num(r.reach)), clicks: Math.round(num(r.clicks)),
      msg_started: actionCount(r.actions, "onsite_conversion.messaging_conversation_started_7d"),
      leads: actionCount(r.actions, "lead"), synced_at: new Date().toISOString(),
    }));
    if (out.length) {
      const { error } = await admin.from("meta_ads_daily").upsert(out, { onConflict: "ad_account_id,day,ad_id" });
      if (error) throw new Error("upsert failed");
    }
    const { data: alerts } = await admin.rpc("ads_new_limit_alerts");
    let sent = 0;
    for (const a of alerts || []) {
      const msg = `${a.threshold >= 100 ? "🔴 وصلنا" : "🟠 قربنا من"} حد الصرف «${a.label}»: ${Math.round(a.spent)} من ${Math.round(a.amount)} ج (${a.threshold}%).`;
      if (await notify(msg)) sent++;
    }
    await admin.from("meta_ads_sync_runs").update({ status: "success", finished_at: new Date().toISOString(), rows_upserted: out.length }).eq("id", run?.id);
    return json({ ok: true, rows: out.length, new_alerts: (alerts || []).length, alerts_pushed: sent });
  } catch (e) {
    await admin.from("meta_ads_sync_runs").update({ status: "failed", finished_at: new Date().toISOString(), error: String((e as Error).message).slice(0, 300) }).eq("id", run?.id);
    return json({ ok: false, error: "SYNC_FAILED" }, 502);
  }
});
