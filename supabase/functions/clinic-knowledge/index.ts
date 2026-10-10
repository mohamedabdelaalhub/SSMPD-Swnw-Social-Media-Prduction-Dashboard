import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

// Clinic facts for the WhatsApp agent (read-only, customer-facing facts only).
// Staff edit them in the dashboard tab "معلومات المركز"; the agent fetches this every few minutes.
// Auth: the same shared secret the agent already uses for dashboard alerts (X-WhatsApp-Alert-Secret).
// Returns nothing internal (no contacts, cashback, contract numbers or documents).

const SECRET = Deno.env.get("WHATSAPP_ALERT_SECRET");
const DAYS: Record<string, string> = { sat: "السبت", sun: "الأحد", mon: "الإثنين", tue: "الثلاثاء", wed: "الأربعاء", thu: "الخميس", fri: "الجمعة" };
const ORDER = ["sat", "sun", "mon", "tue", "wed", "thu", "fri"];

function serviceKey(): string | null {
  const raw = Deno.env.get("SUPABASE_SECRET_KEYS");
  if (raw) { try { const p = JSON.parse(raw); if (typeof p?.default === "string" && p.default) return p.default; } catch { /* legacy */ } }
  return Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || null;
}
function safeEqual(a: string, b: string) {
  if (a.length !== b.length) return false;
  let d = 0; for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return d === 0;
}
function t12(v: string | null): string {
  if (!v) return "";
  const [h, m] = v.split(":").map(Number);
  const suffix = h === 0 ? "بالليل" : h < 12 ? "الصبح" : h < 17 ? "الضهر" : "بالليل";
  const hh = h % 12 === 0 ? 12 : h % 12;
  return `${hh}${m ? ":" + String(m).padStart(2, "0") : ""} ${suffix}`;
}
function dayList(days: string[]): string {
  const d = ORDER.filter((x) => days.includes(x));
  return d.length === 7 ? "كل يوم" : d.map((x) => DAYS[x]).join("، ");
}
const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status, headers: { "Content-Type": "application/json; charset=utf-8" } });

Deno.serve(async (req) => {
  if (!SECRET) return json({ ok: false, error: "MISCONFIGURED" }, 500);
  if (!safeEqual(req.headers.get("X-WhatsApp-Alert-Secret") || "", SECRET)) return json({ ok: false, error: "UNAUTHORIZED" }, 401);
  const key = serviceKey();
  if (!key) return json({ ok: false, error: "MISCONFIGURED" }, 500);
  const db = createClient(Deno.env.get("SUPABASE_URL")!, key, { auth: { persistSession: false } });
  const today = new Date().toISOString().slice(0, 10);
  const [p, h, o, f, ent, con] = await Promise.all([
    db.from("clinic_profile").select("*").eq("id", 1).maybeSingle(),
    db.from("clinic_hours").select("*").eq("active", true).order("sort").order("department"),
    db.from("clinic_offers").select("*").eq("active", true),
    db.from("clinic_faqs").select("*").eq("active", true).order("sort"),
    db.from("contracting_entities").select("id,name"),
    db.from("contracting_entity_contracts").select("entity_id,status,start_date,end_date,discount_percent,services")
  ]);
  const lines: string[] = [];
  const pr: any = p.data || {};
  const add = (label: string, v: unknown) => { if (v && String(v).trim()) lines.push(`${label}: ${String(v).trim()}`); };
  lines.push("## بيانات المركز");
  add("العنوان", pr.address); add("لوكيشن الخريطة", pr.maps_url); add("التليفون", pr.phone); add("واتساب", pr.whatsapp);
  add("الإيميل", pr.email); add("الموقع", pr.website); add("الوصول والركن", pr.directions_notes);
  if ((pr.payment_methods || []).length) add("طرق الدفع", (pr.payment_methods as string[]).join("، "));
  add("ملاحظات الدفع", pr.payment_notes); add("الكشف المنزلي", pr.home_visits); add("نتائج التحاليل والأشعة", pr.results_notes);
  add("سياسة الحجز والإلغاء", pr.booking_policy);
  if ((h.data || []).length) {
    lines.push("\n## مواعيد العمل");
    for (const r of h.data as any[]) {
      lines.push(`- ${r.department}: ${dayList(r.days || [])} — ${r.closed ? "مقفول" : `من ${t12(r.open_time)} لـ ${t12(r.close_time)}`}${r.notes ? ` (${r.notes})` : ""}`);
    }
  }
  const offers = (o.data || []).filter((x: any) => (!x.starts_on || x.starts_on <= today) && (!x.ends_on || x.ends_on >= today));
  if (offers.length) {
    lines.push("\n## العروض الحالية");
    for (const x of offers as any[]) lines.push(`- ${x.title}${x.price_text ? ` — ${x.price_text}` : ""}${x.details ? `: ${x.details}` : ""}${x.ends_on ? ` (لحد ${x.ends_on})` : ""}`);
  }
  const names = new Map((ent.data || []).map((e: any) => [e.id, e.name]));
  const active = (con.data || []).filter((c: any) => (c.status || "active") === "active" && (!c.end_date || c.end_date >= today) && (!c.start_date || c.start_date <= today));
  if (active.length) {
    lines.push("\n## جهات متعاقدين معاها (تأمين/شركات/نقابات)");
    for (const c of active as any[]) {
      const name = names.get(c.entity_id); if (!name) continue;
      lines.push(`- ${name}${c.discount_percent ? ` — خصم ${Number(c.discount_percent)}%` : ""}${c.services ? ` — على: ${c.services}` : ""}`);
    }
  }
  if ((f.data || []).length) {
    lines.push("\n## أسئلة شائعة");
    for (const x of f.data as any[]) lines.push(`س: ${x.question}\nج: ${x.answer}`);
  }
  if (pr.agent_notes) { lines.push("\n## تعليمات الإدارة للوكيل"); lines.push(String(pr.agent_notes)); }
  return json({ ok: true, text: lines.join("\n"), updated_at: pr.updated_at || null });
});
