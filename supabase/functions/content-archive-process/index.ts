// أرشفة وسائط المحتوى المنشور على Google Drive (بعد يومين من النشر).
//
// بتتنادى بطريقتين:
//   1) pg_cron مرة كل ساعة عن طريق net.http_post بهيدر X-Cron-Secret (نفس سر باقي دوال ميتا).
//   2) من الداشبورد بتوكن سوبر أدمن/مدير عام (تشغيل يدوي، وممكن dry_run).
//
// كل مرة:
//   أ) نسخ: لكل مادة جاهزة (content_archive_candidates) نحمّل ملفاتها من Supabase Storage، نبعتها لجسر الدرايف
//      (action=content_archive مع sha256 — الجسر بيتأكد منه)، نسجل كل ملف في content_archive_files،
//      ولما كل الملفات توصل نبدّل الروابط في المادة (content_archive_commit).
//   ب) مسح: بعد يوم إضافي من النقل (content_archive_pending_cleanup) نمسح الملفات من Storage ونشيل نسخ التصميم القديمة.
//   ج) نسخ ميتا المؤقتة: ملفات bucket "meta-publish-assets" لمهام نشر اتنشرت من يومين.
// أي فشل في ملف بيوقف المادة دي بس (بتتعاد بعدين، حد أقصى 5 محاولات) ومفيش حاجة بتتمسح قبل ما النسخة تتأكد.
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
const CRON_SECRET = Deno.env.get("META_PUBLISH_CRON_SECRET");
const DRIVE_BRIDGE_URL = Deno.env.get("DRIVE_BRIDGE_URL") ||
  "https://script.google.com/macros/s/AKfycbzEs73BE101-gIlSx_qwdF625nSalQ2i6mob7mGqH3oN4x40NlZoowjNta3KtKaXYjTYA/exec";
const BASE = `${SUPABASE_URL.replace(/\/+$/, "")}/storage/v1/object/authenticated/`;
const BUCKETS = ["content-designs", "video-inputs"];
const MAX_BYTES = 30 * 1024 * 1024;
const TIME_BUDGET_MS = 100_000;
const MAX_ATTEMPTS = 5;

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-cron-secret",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...CORS, "Content-Type": "application/json" } });

const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, { auth: { persistSession: false } });

async function isManager(req: Request): Promise<boolean> {
  const authorization = req.headers.get("Authorization");
  if (!authorization) return false;
  const userClient = createClient(SUPABASE_URL, ANON_KEY, { global: { headers: { Authorization: authorization } } });
  const { data: { user }, error } = await userClient.auth.getUser();
  if (error || !user) return false;
  const { data } = await admin.from("admins").select("role, active").eq("user_id", user.id).eq("active", true).maybeSingle();
  return !!data && ["super_admin", "general_manager"].includes((data as { role: string }).role);
}

type Ref = { bucket: string; path: string };
function parseStorageUrl(url: unknown): Ref | null {
  if (typeof url !== "string" || !url.startsWith(BASE)) return null;
  const rest = url.slice(BASE.length);
  const bucket = rest.split("/")[0];
  const path = decodeURIComponent(rest.slice(bucket.length + 1));
  if (!BUCKETS.includes(bucket) || !path || path.includes("..")) return null;
  return { bucket, path };
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(binary);
}
async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

type Item = {
  content_id: string; title: string; brand: string | null; content_format: string | null; published_at: string;
  design_file_url: string | null; carousel_slides: unknown; cover_image_url: string | null;
};
type PlanFile = { kind: "design" | "video" | "slide" | "cover"; position: number; ref: Ref };

function planFor(item: Item): PlanFile[] {
  const files: PlanFile[] = [];
  const design = parseStorageUrl(item.design_file_url);
  if (design) files.push({ kind: design.bucket === "video-inputs" ? "video" : "design", position: 0, ref: design });
  if (Array.isArray(item.carousel_slides)) {
    item.carousel_slides.forEach((url, index) => {
      const ref = parseStorageUrl(url);
      if (ref) files.push({ kind: "slide", position: index + 1, ref });
    });
  }
  const cover = parseStorageUrl(item.cover_image_url);
  if (cover) files.push({ kind: "cover", position: 0, ref: cover });
  return files;
}

async function archiveFile(item: Item, file: PlanFile) {
  const existing = await admin.from("content_archive_files").select("id")
    .eq("original_bucket", file.ref.bucket).eq("original_path", file.ref.path).maybeSingle();
  if (existing.data) return "already";
  const download = await admin.storage.from(file.ref.bucket).download(file.ref.path);
  if (download.error || !download.data) throw new Error(`تعذّر تحميل ${file.ref.path}: ${download.error?.message || "no data"}`);
  const bytes = new Uint8Array(await download.data.arrayBuffer());
  if (!bytes.length || bytes.length > MAX_BYTES) throw new Error(`حجم الملف غير مناسب (${bytes.length} بايت): ${file.ref.path}`);
  const sha256 = await sha256Hex(bytes);
  const name = file.ref.path.split("/").pop() || "file";
  const response = await fetch(DRIVE_BRIDGE_URL, {
    method: "POST",
    headers: { "Content-Type": "text/plain;charset=utf-8" },
    body: JSON.stringify({
      action: "content_archive", contentId: item.content_id, title: item.title, brand: item.brand, kind: file.kind,
      position: file.position, publishedAt: item.published_at, fileName: name,
      mimeType: download.data.type || "application/octet-stream", sha256, base64: bytesToBase64(bytes),
    }),
  });
  const result = await response.json().catch(() => null);
  if (!response.ok || !result?.ok || typeof result.fileUrl !== "string") {
    throw new Error(`جسر الدرايف رفض الملف: ${String(result?.error || response.status).slice(0, 160)}`);
  }
  const insert = await admin.from("content_archive_files").insert({
    content_id: item.content_id, kind: file.kind, position: file.position, original_bucket: file.ref.bucket,
    original_path: file.ref.path, drive_url: result.fileUrl, drive_file_id: result.fileId || null,
    size_bytes: bytes.length, sha256,
  });
  if (insert.error) throw new Error("تعذّر تسجيل الملف المؤرشف: " + insert.error.message);
  return "copied";
}

async function recordFailure(contentId: string, message: string) {
  const current = await admin.from("content_archive_state").select("attempts").eq("content_id", contentId).maybeSingle();
  const attempts = ((current.data as { attempts: number } | null)?.attempts || 0) + 1;
  await admin.from("content_archive_state").upsert({
    content_id: contentId, attempts, last_error: message.slice(0, 500), last_attempt_at: new Date().toISOString(),
  });
}

async function listAll(bucket: string, prefix: string): Promise<string[]> {
  const out: string[] = [];
  const entries = await admin.storage.from(bucket).list(prefix, { limit: 1000 });
  if (entries.error) throw new Error(entries.error.message);
  for (const entry of entries.data || []) {
    const full = `${prefix}/${entry.name}`;
    if (entry.id) out.push(full);
    else out.push(...await listAll(bucket, full));
  }
  return out;
}

async function removeAll(bucket: string, paths: string[]) {
  for (let i = 0; i < paths.length; i += 100) {
    const res = await admin.storage.from(bucket).remove(paths.slice(i, i + 100));
    if (res.error) throw new Error(res.error.message);
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: CORS });
  if (req.method !== "POST") return json({ ok: false, error: "Method not allowed" }, 405);
  const cron = !!CRON_SECRET && req.headers.get("X-Cron-Secret") === CRON_SECRET;
  if (!cron && !(await isManager(req))) return json({ ok: false, error: "unauthorized" }, 401);

  const body = await req.json().catch(() => ({})) as { dry_run?: boolean; limit?: number; content_id?: string; skip_cleanup?: boolean };
  const dryRun = body.dry_run === true;
  const started = Date.now();
  const left = () => TIME_BUDGET_MS - (Date.now() - started);
  const report = { ok: true, dry_run: dryRun, archived: [] as unknown[], failed: [] as unknown[], cleaned: [] as unknown[], meta_assets_removed: 0, planned: [] as unknown[] };

  const candidates = await admin.rpc("content_archive_candidates", { p_limit: Math.max(1, Math.min(Number(body.limit) || 2, 5)), p_content: body.content_id || null });
  if (candidates.error) return json({ ok: false, error: candidates.error.message }, 500);

  for (const item of (candidates.data || []) as Item[]) {
    const plan = planFor(item);
    if (dryRun) { report.planned.push({ content_id: item.content_id, title: item.title, files: plan.map((f) => `${f.kind}:${f.ref.bucket}/${f.ref.path}`) }); continue; }
    if (left() < 25_000) break;
    try {
      let copied = 0;
      for (const file of plan) { if (left() < 12_000) throw new Error("انتهى الوقت المسموح، هتتكمل في التشغيلة الجاية"); if (await archiveFile(item, file) === "copied") copied++; }
      const commit = await admin.rpc("content_archive_commit", { p_content_id: item.content_id });
      if (commit.error) throw new Error(commit.error.message);
      report.archived.push({ content_id: item.content_id, title: item.title, files: plan.length, copied });
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      await recordFailure(item.content_id, message);
      report.failed.push({ content_id: item.content_id, title: item.title, error: message });
    }
  }

  if (!body.skip_cleanup) {
    const pending = await admin.rpc("content_archive_pending_cleanup", { p_limit: 3 });
    if (!pending.error) {
      for (const row of (pending.data || []) as { content_id: string; video_paths: string[] }[]) {
        if (dryRun) { report.planned.push({ cleanup: row.content_id, video_paths: row.video_paths }); continue; }
        if (left() < 15_000) break;
        try {
          const deleted: string[] = [];
          // كل ملفات content-designs بتاعة المادة دي (نسخ قديمة + sources + الشرايح والغلاف بعد ما اتنقلوا)
          const designPaths = await listAll("content-designs", row.content_id);
          await removeAll("content-designs", designPaths);
          designPaths.forEach((p) => deleted.push(`content-designs/${p}`));
          const videoPaths = Array.isArray(row.video_paths) ? row.video_paths : [];
          if (videoPaths.length) { await removeAll("video-inputs", videoPaths); videoPaths.forEach((p) => deleted.push(`video-inputs/${p}`)); }
          // نسخ التصميم القديمة (روابطها بقت ميتة) — بنحتفظ بآخر نسخة بس
          const versions = await admin.from("design_versions").select("id").eq("content_id", row.content_id).order("created_at", { ascending: false }).order("id", { ascending: false });
          const ids = ((versions.data || []) as { id: string }[]).map((v) => v.id).slice(1);
          if (ids.length) {
            const removed = await admin.from("design_versions").delete().in("id", ids);
            if (removed.error) throw new Error(removed.error.message);
          }
          const mark = await admin.rpc("content_archive_mark_cleared", { p_content_id: row.content_id, p_deleted_paths: deleted });
          if (mark.error) throw new Error(mark.error.message);
          report.cleaned.push({ content_id: row.content_id, files_removed: deleted.length, versions_removed: ids.length });
        } catch (e) {
          report.failed.push({ content_id: row.content_id, phase: "cleanup", error: e instanceof Error ? e.message : String(e) });
        }
      }
    }

    // ملفات ميتا المؤقتة (نسخة عامة بتتحمّل وقت النشر بس) لمهام اتنشرت من يومين
    try {
      if (!dryRun && left() > 10_000) {
        const listing = await admin.storage.from("meta-publish-assets").list("", { limit: 1000 });
        // ملفات الدرايف اللي اتجهزت مؤقتاً لنشر الموقع (website-*) بتتمسح بعد يوم
        const staleWebsite = (listing.data || []).filter((f) => f.id && f.name.startsWith("website-") && f.created_at && Date.parse(f.created_at) < Date.now() - 86400000).map((f) => f.name);
        if (staleWebsite.length) { await removeAll("meta-publish-assets", staleWebsite); report.meta_assets_removed += staleWebsite.length; }
        const byJob = new Map<string, string[]>();
        for (const f of listing.data || []) {
          const match = /^([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/i.exec(f.name);
          if (match && f.id) byJob.set(match[1], [...(byJob.get(match[1]) || []), f.name]);
        }
        if (byJob.size) {
          const cutoff = new Date(Date.now() - 2 * 86400000).toISOString();
          const jobs = await admin.from("meta_publish_jobs").select("id").in("id", [...byJob.keys()]).eq("status", "published").lte("published_at", cutoff);
          const names = ((jobs.data || []) as { id: string }[]).flatMap((j) => byJob.get(j.id) || []);
          if (names.length) { await removeAll("meta-publish-assets", names); report.meta_assets_removed += names.length; }
        }
      }
    } catch (e) {
      report.failed.push({ phase: "meta-assets", error: e instanceof Error ? e.message : String(e) });
    }
  }

  return json(report);
});
