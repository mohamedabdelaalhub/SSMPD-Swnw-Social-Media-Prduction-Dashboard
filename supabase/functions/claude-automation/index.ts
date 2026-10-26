import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

// Claude daily-content gateway ("البوابة").
// Who can call it: only a request carrying X-Run-Token = an unexpired row in
// public.automation_run_tokens. Those rows can only be created with database access
// (SQL / service role), which the scheduled Claude run has.
// What it does: signs in as the Claude Creative dashboard account with the password the
// owner stored in the Edge secret SSMPD_CLAUDE_PASSWORD, then forwards a short whitelist
// of content requests with that user's session -- so RLS, guard_content_transition() and
// the activity log apply exactly as if the account clicked in the dashboard.
// It has no access to patients, accounts, leads or anything outside content publishing.
//
//   POST ?op=upload_image&content_id=<uuid>   body = PNG bytes  -> {url}
//   POST ?op=upload_video                      body = MP4 bytes  -> {url}
//   POST ?op=upload_cover&content_id=<uuid>   body = PNG bytes  -> {url, linked}  reel cover (video items):
//        saved as <id>/<uuid>/reel-cover.png and merged into content_items.cover_settings.cover_image_url
//   POST ?op=tts_quota                                           -> ElevenLabs characters used/limit/reset date
//   POST ?op=tts                               {text, model?, stability?, style?, speed?, chunk?} -> MP3 bytes (ElevenLabs)
//        The text first goes through the pronunciation list (kit file tts/pronunciations.json,
//        plus the built-in defaults below): words Mohamed flagged are rewritten before speaking.
//   POST ?op=download&bucket=video-inputs|content-designs&path=<p>  -> file bytes
//   POST ?op=stock                            {q,type?,orientation?,brand,content_id?} -> Pixabay hits
//        NO-REPEAT RULE (Mohamed, 2026-10-25): with brand, hits already used in that page's last
//        20 items are removed (excluded_recent tells how many). allow_repeat:true skips the filter.
//   POST ?op=fetch_media&url=<pixabay url>&brand=<sono|dr_dina>&id=<pixabay hit id>&kind=<photo|video>[&content_id=&q=]
//        -> file bytes; logs the use. 409 if that hit was used in the page's last 20 items.
//   POST ?op=image                             {prompt,brand,content_id?,size?,quality?} -> PNG (OpenAI)
//        logs the prompt; 409 if the exact same prompt was used in the page's last 20 items.
//   POST ?op=media_recent                     {brand, items?} -> what that page used lately (keys, queries, prompts)
//   POST ?op=kit_get&name=<file>                                 -> file bytes (private kit)
//   POST ?op=kit_put&name=<file>               body = bytes     -> {ok}
//   POST {op:"rest", method, path, body?, prefer?}               -> REST response
//
// To switch it off: delete this function, or run
//   delete from public.automation_run_tokens;  (and don't mint new tokens)

const SB = Deno.env.get("SUPABASE_URL")!;
const ANON = Deno.env.get("SUPABASE_ANON_KEY")!;
const CLAUDE_EMAIL = "claude.swnw@gmail.com";
const CLAUDE_ADMIN_ID = "a0fbdfee-d147-4282-b988-186a9ae3e88c";
const VOICE_ID = Deno.env.get("SSMPD_ELEVENLABS_VOICE_ID") || "VXERCtS1keFWRMOi7czu";
const ALLOWED: [string, RegExp][] = [
  ["GET", /^\/rest\/v1\/(content_items|post_insights|meta_publish_jobs|design_versions)\?/],
  ["POST", /^\/rest\/v1\/content_items(\?|$)/],
  ["PATCH", /^\/rest\/v1\/content_items\?id=eq\.[0-9a-f-]{36}$/],
  ["POST", /^\/rest\/v1\/rpc\/(save_private_carousel|save_private_design_version)$/],
  ["POST", /^\/rest\/v1\/meta_publish_jobs(\?|$)/],
  // التقرير الأسبوعي: مهام Claude نفسه فقط (RLS بتمنع أي حاجة تانية)
  ["GET", /^\/rest\/v1\/(tasks|task_updates)\?/],
  ["POST", /^\/rest\/v1\/rpc\/(task_set_status|task_add_comment|task_add_comment_to|task_review)$/],
  // 2026-10-27: Claude-only RPCs (claude_task_create / claude_task_update / ...). Each one checks it is Claude, the
  // capability switch + daily limit (claude_capabilities) and the project membership inside the database. The database
  // also stops Claude from approving/closing/deleting tasks (claude_task_guard), whatever is called here.
  ["POST", /^\/rest\/v1\/rpc\/claude_[a-z_]+$/],
];
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

// Words the voice said wrong (Mohamed, 2026-10-11). Whole words only; the kit file adds more.
const DEFAULT_PRONUNCIATIONS: Record<string, string> = {
  "الحِمل": "الحِمْل", "الحمل على": "الحِمْل على",
  "تانياً": "ثانياً", "تانيًا": "ثانياً", "تانيا": "ثانياً",
  "تالتاً": "ثالثاً", "تالتًا": "ثالثاً", "تالتا": "ثالثاً",
  "براحة": "بالراحة",
  "اثبت": "اثْبَتْ",
  "قسم": "قِسْم",
  "العظام": "العِظام", "العضام": "العِظام",
};
let kitPronunciations: { at: number; map: Record<string, string> } | null = null;

// ---- No-repeat rule for stock / generated media (per page, last N items) ----
const BRANDS = ["sono", "dr_dina"];
const RECENT_ITEMS = 20;
// deno-lint-ignore no-explicit-any
// exceptContent: media the same item already used (a revision re-using its own photo) is not a repeat.
async function recentMedia(admin: any, brand: string, items = RECENT_ITEMS, exceptContent = "") {
  const { data, error } = await admin.rpc("automation_recent_media", { p_brand: brand, p_items: items });
  if (error) throw new Error("recent media: " + error.message);
  // deno-lint-ignore no-explicit-any
  return ((data || []) as any[]).filter((u) => !exceptContent || u.content_id !== exceptContent);
}
async function sha256(text: string): Promise<string> {
  const d = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text.trim().replace(/\s+/g, " ").toLowerCase()));
  return Array.from(new Uint8Array(d)).map((b) => b.toString(16).padStart(2, "0")).join("");
}
// deno-lint-ignore no-explicit-any
async function logMedia(admin: any, row: Record<string, unknown>) {
  const { error } = await admin.from("automation_media_usage").insert(row);
  if (error) console.error("media log", error.message);
}

function serviceKey(): string | null {
  const raw = Deno.env.get("SUPABASE_SECRET_KEYS");
  if (raw) { try { const p = JSON.parse(raw); if (typeof p?.default === "string" && p.default) return p.default; } catch { /* legacy */ } }
  return Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || null;
}
const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { "Content-Type": "application/json" } });

async function store(jwt: string, bucket: string, path: string, bytes: Uint8Array, type: string) {
  const r = await fetch(`${SB}/storage/v1/object/${bucket}/${path}`, {
    method: "POST", body: bytes,
    headers: { apikey: ANON, Authorization: `Bearer ${jwt}`, "Content-Type": type, "x-upsert": "false" },
  });
  if (!r.ok) throw new Error(`upload ${r.status} ${(await r.text()).slice(0, 300)}`);
  return `${SB}/storage/v1/object/authenticated/${bucket}/${path}`;
}

// deno-lint-ignore no-explicit-any
async function pronunciations(admin: any): Promise<Record<string, string>> {
  if (!kitPronunciations || Date.now() - kitPronunciations.at > 5 * 60_000) {
    let map: Record<string, string> = {};
    try {
      const { data } = await admin.storage.from("automation-kit").download("tts/pronunciations.json");
      if (data) { const parsed = JSON.parse(await data.text()); if (parsed && typeof parsed === "object") map = parsed; }
    } catch { /* no kit list yet */ }
    kitPronunciations = { at: Date.now(), map };
  }
  return { ...DEFAULT_PRONUNCIATIONS, ...kitPronunciations.map };
}

export function applyPronunciations(text: string, map: Record<string, string>): string {
  const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  // A leading و/ف (and, so) stays attached. Longest entries first, so "الحمل على" wins over shorter ones.
  for (const word of Object.keys(map).sort((a, b) => b.length - a.length)) {
    const to = String(map[word] || "");
    if (!word || !to) continue;
    text = text.replace(new RegExp(`(^|[\\s،,.؟?!:؛;"'«»()\\-])(و|ف)?${esc(word)}(?=$|[\\s،,.؟?!:؛;"'«»()\\-])`, "g"), `$1$2${to}`);
  }
  return text;
}

export function splitSentences(text: string, max = 110): string[] {
  // One sentence per call; a long sentence is cut at its commas; very short pieces join the next one.
  const pieces: string[] = [];
  for (const sentence of text.split(/(?<=[.؟?!])\s+/).map((x) => x.trim()).filter(Boolean)) {
    if (sentence.length <= max) { pieces.push(sentence); continue; }
    let cur = "";
    for (const part of sentence.split(/(?<=[،,])\s+/)) {
      if (cur && (cur + " " + part).length > max) { pieces.push(cur); cur = part; } else cur = cur ? cur + " " + part : part;
    }
    if (cur) pieces.push(cur);
  }
  const out: string[] = [];
  for (const p of pieces) { if (out.length && out[out.length - 1].length < 25) out[out.length - 1] += " " + p; else out.push(p); }
  return out.length ? out : [text];
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return json({ ok: false, error: "POST only" }, 405);
  const key = serviceKey();
  const password = Deno.env.get("SSMPD_CLAUDE_PASSWORD");
  if (!key || !password) return json({ ok: false, error: "MISCONFIGURED" }, 500);
  const admin = createClient(SB, key, { auth: { persistSession: false } });

  const tok = req.headers.get("X-Run-Token") || "";
  if (!UUID.test(tok)) return json({ ok: false, error: "UNAUTHORIZED" }, 401);
  const { data: t } = await admin.from("automation_run_tokens").select("token")
    .eq("token", tok).gt("expires_at", new Date().toISOString()).maybeSingle();
  if (!t) return json({ ok: false, error: "UNAUTHORIZED" }, 401);

  const q = new URL(req.url).searchParams;
  const op = q.get("op") || "";

  // Private brand kit (fonts, logos, outros, music, templates) -- service storage, bucket "automation-kit".
  if (op === "kit_get" || op === "kit_put") {
    const name = q.get("name") || "";
    if (!/^[\w\-. \/]{1,120}$/.test(name) || name.includes("..")) return json({ ok: false, error: "name" }, 400);
    if (op === "kit_get") {
      const { data, error } = await admin.storage.from("automation-kit").download(name);
      if (error || !data) return json({ ok: false, error: "not found" }, 404);
      return new Response(data, { headers: { "Content-Type": "application/octet-stream" } });
    }
    const bytes = new Uint8Array(await req.arrayBuffer());
    const { error } = await admin.storage.from("automation-kit").upload(name, bytes, { upsert: true, contentType: "application/octet-stream" });
    if (name === "tts/pronunciations.json") kitPronunciations = null;
    return error ? json({ ok: false, error: error.message }, 500) : json({ ok: true });
  }

  // Read a staff-uploaded file (raw center videos / images) attached to a content item.
  if (op === "download") {
    const bucket = q.get("bucket") || "", path = q.get("path") || "";
    if (!["video-inputs", "content-designs"].includes(bucket) || !path || path.includes("..")) return json({ ok: false, error: "bucket/path" }, 400);
    const { data, error } = await admin.storage.from(bucket).download(path);
    if (error || !data) return json({ ok: false, error: "not found" }, 404);
    return new Response(data, { headers: { "Content-Type": "application/octet-stream" } });
  }

  // Stock photos/videos (Pixabay, key already stored as PIXABAY_API_KEY).
  if (op === "stock") {
    const key = Deno.env.get("PIXABAY_API_KEY");
    if (!key) return json({ ok: false, error: "PIXABAY_API_KEY missing" }, 500);
    const b = await req.json().catch(() => ({}));
    const query = String(b?.q || "").trim().slice(0, 100);
    if (!query) return json({ ok: false, error: "q required" }, 400);
    const video = b?.type === "video";
    const u = new URL(video ? "https://pixabay.com/api/videos/" : "https://pixabay.com/api/");
    u.searchParams.set("key", key); u.searchParams.set("q", query); u.searchParams.set("safesearch", "true");
    u.searchParams.set("per_page", String(Math.min(Math.max(Number(b?.per_page || 20), 3), 50)));
    if (!video) { u.searchParams.set("image_type", "photo"); if (b?.orientation) u.searchParams.set("orientation", String(b.orientation)); }
    const r = await fetch(u);
    if (!r.ok) return json({ ok: false, error: "pixabay " + r.status }, 502);
    const d = await r.json();
    // deno-lint-ignore no-explicit-any
    const hits = (d.hits || []).map((h: any) => video
      // deno-lint-ignore no-explicit-any
      ? { id: h.id, tags: h.tags, duration: h.duration, files: Object.fromEntries(Object.entries(h.videos || {}).filter(([, v]: any) => v?.url).map(([k, v]: any) => [k, { url: v.url, width: v.width, height: v.height }])) }
      : { id: h.id, tags: h.tags, width: h.imageWidth, height: h.imageHeight, preview: h.webformatURL, large: h.largeImageURL });
    const brand = String(b?.brand || "");
    if (!brand || b?.allow_repeat === true) {
      return json({ ok: true, total: d.totalHits || 0, hits, excluded_recent: 0, note: brand ? "allow_repeat" : "pass brand to drop media this page used recently" });
    }
    if (!BRANDS.includes(brand)) return json({ ok: false, error: "brand must be sono or dr_dina" }, 400);
    const used = new Set((await recentMedia(admin, brand, RECENT_ITEMS, UUID.test(String(b?.content_id || "")) ? String(b.content_id) : "")).map((u) => u.media_key));
    const kind = video ? "video" : "photo";
    // deno-lint-ignore no-explicit-any
    const fresh = hits.filter((h: any) => !used.has(`pixabay:${kind}:${h.id}`));
    return json({ ok: true, total: d.totalHits || 0, hits: fresh, excluded_recent: hits.length - fresh.length,
      note: fresh.length ? undefined : "all hits were used recently for this page — change the search words (synonyms, another scene/angle) or ask for per_page 50" });
  }

  if (op === "media_recent") {
    const b = await req.json().catch(() => ({}));
    const brand = String(b?.brand || "");
    if (!BRANDS.includes(brand)) return json({ ok: false, error: "brand must be sono or dr_dina" }, 400);
    const rows = await recentMedia(admin, brand, Math.min(Math.max(Number(b?.items || RECENT_ITEMS), 1), 100));
    return json({ ok: true, brand, items: Number(b?.items || RECENT_ITEMS), used: rows });
  }

  // Download a Pixabay file found by op=stock (the run's shell can't reach pixabay directly).
  if (op === "fetch_media") {
    const src = q.get("url") || "";
    let host = ""; try { host = new URL(src).hostname; } catch { /* bad url */ }
    if (!/(^|\.)pixabay\.com$/.test(host)) return json({ ok: false, error: "pixabay URLs only" }, 400);
    const brand = q.get("brand") || "", hitId = q.get("id") || "", kind = q.get("kind") === "video" ? "video" : "photo";
    const cid = q.get("content_id") || "";
    if (!BRANDS.includes(brand) || !/^\d{1,15}$/.test(hitId)) {
      return json({ ok: false, error: "no-repeat rule: pass &brand=sono|dr_dina&id=<pixabay hit id>&kind=photo|video (and &content_id= when you have it)" }, 400);
    }
    const key = `pixabay:${kind}:${hitId}`;
    if (q.get("allow_repeat") !== "1" && (await recentMedia(admin, brand, RECENT_ITEMS, UUID.test(cid) ? cid : "")).some((u) => u.media_key === key)) {
      return json({ ok: false, error: "used_recently", detail: "this " + kind + " was already used in one of this page's last " + RECENT_ITEMS + " items — pick another hit" }, 409);
    }
    const r = await fetch(src);
    if (!r.ok) return json({ ok: false, error: "fetch " + r.status }, 502);
    // Same item re-downloading the same file (retry, cover + reel) counts once.
    const { data: dup } = await admin.from("automation_media_usage").select("id").eq("brand", brand).eq("media_key", key)
      .eq("content_id", UUID.test(cid) ? cid : "00000000-0000-0000-0000-000000000000").limit(1);
    if (!dup?.length) await logMedia(admin, { brand, content_id: UUID.test(cid) ? cid : null, provider: "pixabay", media_kind: kind, media_key: key, search_query: (q.get("q") || "").slice(0, 200) || null });
    return new Response(r.body, { headers: { "Content-Type": r.headers.get("Content-Type") || "application/octet-stream" } });
  }

  // Generated photo (OpenAI, same key the design studio uses). Returns PNG bytes.
  if (op === "image") {
    const oa = Deno.env.get("OPENAI_API_KEY");
    if (!oa) return json({ ok: false, error: "OPENAI_API_KEY missing" }, 500);
    const b = await req.json().catch(() => ({}));
    const prompt = String(b?.prompt || "").trim();
    if (!prompt || prompt.length > 3000) return json({ ok: false, error: "prompt 1..3000 chars" }, 400);
    const brand = String(b?.brand || ""), cid = String(b?.content_id || "");
    if (!BRANDS.includes(brand)) return json({ ok: false, error: "no-repeat rule: pass brand (sono|dr_dina) and content_id" }, 400);
    const key = "openai:" + await sha256(prompt);
    if (b?.allow_repeat !== true && (await recentMedia(admin, brand, RECENT_ITEMS, UUID.test(cid) ? cid : "")).some((u) => u.media_key === key)) {
      return json({ ok: false, error: "used_recently", detail: "the same prompt was used in one of this page's last " + RECENT_ITEMS + " items — change the person, place, angle or action" }, 409);
    }
    const size = ["1024x1024", "1024x1536", "1536x1024"].includes(b?.size) ? b.size : "1024x1536";
    const quality = ["low", "medium", "high"].includes(b?.quality) ? b.quality : "medium";
    const r = await fetch("https://api.openai.com/v1/images/generations", {
      method: "POST", headers: { Authorization: `Bearer ${oa}`, "Content-Type": "application/json" },
      body: JSON.stringify({ model: "gpt-image-1.5", prompt, size, quality, n: 1, output_format: "png" }),
    });
    const d = await r.json().catch(() => null);
    const b64 = d?.data?.[0]?.b64_json;
    if (!r.ok || !b64) return json({ ok: false, error: "openai " + r.status + " " + JSON.stringify(d?.error?.message || "").slice(0, 200) }, 502);
    await logMedia(admin, { brand, content_id: UUID.test(cid) ? cid : null, provider: "openai", media_kind: "photo", media_key: key, prompt: prompt.slice(0, 1000) });
    return new Response(Uint8Array.from(atob(b64), (c) => c.charCodeAt(0)), { headers: { "Content-Type": "image/png" } });
  }

  // How many ElevenLabs characters are left this month (check before writing a reel's voice).
  if (op === "tts_quota") {
    const el = Deno.env.get("SSMPD_ELEVENLABS_API_KEY");
    if (!el) return json({ ok: false, error: "ElevenLabs key missing" }, 500);
    const r = await fetch("https://api.elevenlabs.io/v1/user/subscription", { headers: { "xi-api-key": el } });
    const d = await r.json().catch(() => null);
    if (!r.ok || !d) return json({ ok: false, error: "elevenlabs " + r.status }, 502);
    const used = Number(d.character_count || 0), limit = Number(d.character_limit || 0);
    return json({ ok: true, tier: d.tier, used, limit, left: Math.max(0, limit - used), resets_at: d.next_character_count_reset_unix ? new Date(d.next_character_count_reset_unix * 1000).toISOString() : null, status: d.status });
  }

  if (op === "tts") {
    const el = Deno.env.get("SSMPD_ELEVENLABS_API_KEY");
    if (!el) return json({ ok: false, error: "ElevenLabs key missing" }, 500);
    const b = await req.json().catch(() => null);
    const raw = String(b?.text || "").trim();
    if (!raw || raw.length > 2500) return json({ ok: false, error: "text 1..2500 chars" }, 400);
    const text = applyPronunciations(raw, await pronunciations(admin));
    const model = ["eleven_multilingual_v2", "eleven_v3", "eleven_flash_v2_5", "eleven_turbo_v2_5"].includes(b?.model) ? b.model : (Deno.env.get("SSMPD_TTS_MODEL") || "eleven_multilingual_v2");
    const num = (v: unknown, d: number, lo: number, hi: number) => { const n = Number(v); return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : d; };
    const settings = model === "eleven_v3"
      ? { stability: num(b?.stability, 0.5, 0, 1), similarity_boost: 0.75, use_speaker_boost: true }
      : { speed: num(b?.speed, 1.0, 0.7, 1.2), stability: num(b?.stability, 0.5, 0, 1), similarity_boost: 0.75, style: num(b?.style, 0, 0, 1), use_speaker_boost: true };
    // Sentence-by-sentence made the voice worse (Mohamed, 2026-10-11): off by default, opt-in with chunk:true.
    const chunks = b?.chunk === true ? splitSentences(text) : [text];
    const parts: Uint8Array[] = [];
    for (let i = 0; i < chunks.length; i++) {
      const body: Record<string, unknown> = { text: chunks[i], model_id: model, voice_settings: settings };
      if (model === "eleven_v3" || model.includes("2_5")) body.language_code = "ar";
      if (model !== "eleven_v3") { if (i > 0) body.previous_text = chunks.slice(0, i).join(" ").slice(-400); if (i < chunks.length - 1) body.next_text = chunks.slice(i + 1).join(" ").slice(0, 300); }
      const r = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${VOICE_ID}?output_format=mp3_44100_128`, {
        method: "POST",
        headers: { "xi-api-key": el, "Content-Type": "application/json", Accept: "audio/mpeg" },
        body: JSON.stringify(body),
      });
      if (!r.ok) return json({ ok: false, error: `elevenlabs ${r.status} ${(await r.text()).slice(0, 200)}` }, 502);
      let bytes = new Uint8Array(await r.arrayBuffer());
      // Drop the ID3 tag of every piece after the first, so the joined file is one clean MP3 stream.
      if (i > 0 && bytes[0] === 0x49 && bytes[1] === 0x44 && bytes[2] === 0x33) bytes = bytes.subarray(10 + ((bytes[6] << 21) | (bytes[7] << 14) | (bytes[8] << 7) | bytes[9]));
      parts.push(bytes);
    }
    const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
    let at = 0; for (const p of parts) { out.set(p, at); at += p.length; }
    return new Response(out, { headers: { "Content-Type": "audio/mpeg", "X-Spoken-Text": encodeURIComponent(text).slice(0, 7000), "X-Chunks": String(chunks.length) } });
  }

  // Everything below acts as the Claude Creative account.
  const user = createClient(SB, ANON, { auth: { persistSession: false } });
  const ses = await user.auth.signInWithPassword({ email: CLAUDE_EMAIL, password });
  const jwt = ses.data.session?.access_token;
  if (!jwt) return json({ ok: false, error: "LOGIN_FAILED" }, 500);

  try {
    if (op === "upload_image") {
      const cid = q.get("content_id") || "";
      if (!UUID.test(cid)) return json({ ok: false, error: "content_id" }, 400);
      const bytes = new Uint8Array(await req.arrayBuffer());
      if (bytes.length < 100 || bytes.length > 12_000_000 || bytes[0] !== 0x89 || bytes[1] !== 0x50) return json({ ok: false, error: "PNG only (<12MB)" }, 400);
      return json({ ok: true, url: await store(jwt, "content-designs", `${cid}/${crypto.randomUUID()}/output.png`, bytes, "image/png") });
    }
    if (op === "upload_cover") {
      const cid = q.get("content_id") || "";
      if (!UUID.test(cid)) return json({ ok: false, error: "content_id" }, 400);
      const bytes = new Uint8Array(await req.arrayBuffer());
      if (bytes.length < 100 || bytes.length > 12_000_000 || bytes[0] !== 0x89 || bytes[1] !== 0x50) return json({ ok: false, error: "PNG only (<12MB)" }, 400);
      const url = await store(jwt, "content-designs", `${cid}/${crypto.randomUUID()}/reel-cover.png`, bytes, "image/png");
      // Link it on the item, keeping the rest of cover_settings.
      const h = { apikey: ANON, Authorization: `Bearer ${jwt}`, "Content-Type": "application/json" };
      const cur = await fetch(`${SB}/rest/v1/content_items?id=eq.${cid}&select=cover_settings`, { headers: h }).then((r) => r.json()).catch(() => null);
      const settings = { ...((Array.isArray(cur) && cur[0]?.cover_settings) || {}), cover_image_url: url };
      const p = await fetch(`${SB}/rest/v1/content_items?id=eq.${cid}`, { method: "PATCH", headers: { ...h, Prefer: "return=minimal" }, body: JSON.stringify({ cover_settings: settings }) });
      return json({ ok: true, url, linked: p.ok, link_error: p.ok ? undefined : (await p.text()).slice(0, 300) });
    }
    if (op === "upload_video") {
      const bytes = new Uint8Array(await req.arrayBuffer());
      if (bytes.length < 1000 || bytes.length > 200_000_000) return json({ ok: false, error: "MP4 size" }, 400);
      return json({ ok: true, url: await store(jwt, "video-inputs", `${CLAUDE_ADMIN_ID}/${crypto.randomUUID()}/reel.mp4`, bytes, "video/mp4") });
    }
  } catch (e) {
    return json({ ok: false, error: String((e as Error).message || e) }, 502);
  }

  const b = await req.json().catch(() => null);
  if (!b || b.op !== "rest") return json({ ok: false, error: "bad request" }, 400);
  const method = String(b.method || "GET").toUpperCase(), path = String(b.path || "");
  if (!ALLOWED.some(([m, re]) => m === method && re.test(path))) return json({ ok: false, error: "not allowed: " + method + " " + path.split("?")[0] }, 403);
  const r = await fetch(SB + path, {
    method, body: b.body === undefined ? undefined : JSON.stringify(b.body),
    headers: { apikey: ANON, Authorization: `Bearer ${jwt}`, "Content-Type": "application/json", ...(b.prefer ? { Prefer: String(b.prefer) } : {}) },
  });
  const text = await r.text();
  let data: unknown = null; try { data = text ? JSON.parse(text) : null; } catch { data = text; }
  return json({ ok: r.ok, status: r.status, data }, r.ok ? 200 : 422);
});
