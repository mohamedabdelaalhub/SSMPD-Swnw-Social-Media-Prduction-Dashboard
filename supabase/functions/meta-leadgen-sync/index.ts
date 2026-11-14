import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

// فورم فيسبوك (Lead Ads) ← الليدز في الداشبورد.
// pg_cron كل 5 دقايق (X-Cron-Secret = META_PUBLISH_CRON_SECRET). بيقرا فورمات صفحتي سونو ودينا
// (meta_brand_config.facebook_page_id) بتوكن الـ system user المحفوظ في meta_ads_config (نفس توكن
// مزامنة الصرف بعد إضافة صلاحيات الفورم)، ويسجّل كل ليد جديد عبر public.ingest_lead (source = facebook_form).
// idempotent: event_id = fbform:<lead id>. القراءة بس من Meta — مفيش أي كتابة على Meta.
// {"dry_run": true}: يقرا ويعدّ بس، من غير ما يسجّل ليدز ولا يحرّك نقطة البداية.

const GRAPH = "https://graph.facebook.com/v21.0";
const CRON_SECRET = Deno.env.get("META_PUBLISH_CRON_SECRET");
const OVERLAP_MS = 10 * 60 * 1000;      // نرجع 10 دقايق لورا عشان مانفوّتش ليد وصل متأخر (التكرار متأمّن بـ event_id)
const FIRST_RUN_LOOKBACK_MS = 3 * 24 * 3600 * 1000;

function serviceKey(): string | null {
  const raw = Deno.env.get("SUPABASE_SECRET_KEYS");
  if (raw) { try { const p = JSON.parse(raw); if (typeof p?.default === "string" && p.default) return p.default; } catch { /* legacy */ } }
  return Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || null;
}
const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { "Content-Type": "application/json" } });
function safeEqual(a: string, b: string) {
  if (a.length !== b.length) return false;
  let d = 0; for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return d === 0;
}
async function graphGet(path: string, params: Record<string, string>, token: string) {
  const u = new URL(path.startsWith("http") ? path : `${GRAPH}/${path}`);
  Object.entries(params).forEach(([k, v]) => u.searchParams.set(k, v));
  if (!u.searchParams.has("access_token")) u.searchParams.set("access_token", token);
  const res = await fetch(u.toString(), { signal: AbortSignal.timeout(20000) });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || data?.error) throw new Error(`graph ${data?.error?.code ?? res.status}: ${String(data?.error?.message ?? "").slice(0, 160)}`);
  return data;
}

type Field = { name?: string; values?: string[] };
export function pickContact(fields: Field[]) {
  const get = (re: RegExp) => {
    const f = fields.find((x) => re.test(String(x?.name ?? "").toLowerCase()));
    return f?.values?.[0]?.trim() || "";
  };
  let name = get(/^full_name$|^name$|الاسم/);
  if (!name) name = [get(/^first_name$/), get(/^last_name$/)].filter(Boolean).join(" ");
  const phone = get(/phone|موبايل|تليفون|رقم/);
  return { name: name.slice(0, 120), phone: phone.slice(0, 25) };
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return json({ ok: false, error: "POST only" }, 405);
  if (!CRON_SECRET || !safeEqual(req.headers.get("X-Cron-Secret") || "", CRON_SECRET)) return json({ ok: false, error: "UNAUTHORIZED" }, 401);
  const key = serviceKey();
  if (!key) return json({ ok: false, error: "MISCONFIGURED" }, 500);
  const body = await req.json().catch(() => ({}));
  const dryRun = body?.dry_run === true;

  const admin = createClient(Deno.env.get("SUPABASE_URL")!, key);
  const { data: cfg } = await admin.from("meta_ads_config").select("access_token").eq("id", 1).maybeSingle();
  if (!cfg?.access_token) return json({ ok: false, error: "NO_TOKEN" }, 409);
  const userToken = cfg.access_token as string;
  const { data: brands } = await admin.from("meta_brand_config").select("brand,facebook_page_id");
  const { data: states } = await admin.from("meta_leadgen_sync_state").select("form_id,last_lead_time");
  const lastByForm = new Map((states ?? []).map((s: any) => [s.form_id, s.last_lead_time]));

  const report: any[] = [];
  let created = 0, existing = 0, seen = 0;
  for (const b of brands ?? []) {
    const pageId = String(b.facebook_page_id || "");
    if (!pageId) continue;
    try {
      // توكن الصفحة من توكن الـ system user (لازم الصفحة تكون متعيّنة له في Business Manager)
      const pg = await graphGet(pageId, { fields: "access_token" }, userToken);
      const pageToken = pg.access_token || userToken;
      const forms = await graphGet(`${pageId}/leadgen_forms`, { fields: "id,name,status", limit: "100" }, pageToken);
      for (const f of forms.data ?? []) {
        const formId = String(f.id);
        const last = lastByForm.get(formId);
        const sinceMs = last ? Date.parse(last) - OVERLAP_MS : Date.now() - FIRST_RUN_LOOKBACK_MS;
        let newest = last ? Date.parse(last) : 0;
        let count = 0, err: string | null = null;
        try {
          let page: any = await graphGet(`${formId}/leads`, {
            fields: "id,created_time,field_data,ad_id,adset_id,campaign_id",
            filtering: JSON.stringify([{ field: "time_created", operator: "GREATER_THAN", value: Math.floor(sinceMs / 1000) }]),
            limit: "100",
          }, pageToken);
          for (let guard = 0; page && guard < 20; guard++) {
            for (const lead of page.data ?? []) {
              count++; seen++;
              const t = Date.parse(lead.created_time) || Date.now();
              if (t > newest) newest = t;
              if (dryRun) continue;
              const c = pickContact(lead.field_data ?? []);
              const { data, error } = await admin.rpc("ingest_lead", {
                p_event_id: `fbform:${lead.id}`, p_source: "facebook_form", p_name: c.name || null, p_phone: c.phone || null,
                p_message: `فورم فيسبوك: ${String(f.name ?? formId).slice(0, 200)}`, p_received_at: new Date(t).toISOString(),
                p_ad_id: lead.ad_id ?? null, p_adset_id: lead.adset_id ?? null, p_campaign_id: lead.campaign_id ?? null,
              });
              if (error) throw new Error("ingest_failed");
              const row = Array.isArray(data) ? data[0] : data;
              if (row?.was_new) created++; else existing++;
            }
            page = page.paging?.next ? await graphGet(page.paging.next, {}, pageToken) : null;
          }
        } catch (e) { err = String((e as Error).message || e).slice(0, 300); }
        if (!dryRun) {
          await admin.from("meta_leadgen_sync_state").upsert({
            form_id: formId, page_id: pageId, brand: b.brand, form_name: String(f.name ?? "").slice(0, 200),
            last_lead_time: err ? (last ?? null) : (newest ? new Date(newest).toISOString() : (last ?? null)),
            last_run_at: new Date().toISOString(), last_error: err,
          });
        }
        report.push({ brand: b.brand, form: f.name, status: f.status, leads: count, error: err });
      }
    } catch (e) {
      report.push({ brand: b.brand, error: String((e as Error).message || e).slice(0, 300) });
    }
  }
  return json({ ok: true, dry_run: dryRun, seen, created, existing, forms: report });
});
