// Publish copies for Meta: our server (files.swnwclinics.com) first, Supabase bucket "meta-publish-assets" as fallback.
// Owner decision 2026-11-10 — content files live on our server to cut Supabase egress. Base "" = old behaviour only.
// deno-lint-ignore no-explicit-any
type Admin = any;
const SAFE_NAME = /^[A-Za-z0-9][A-Za-z0-9._-]{0,120}$/;

export function makePublishAssetStore(filesBase: string, fetchImpl: typeof fetch = fetch, now: () => number = Date.now) {
  let cached: { token: string; exp: number } | null = null;
  async function runToken(admin: Admin): Promise<string> {
    if (cached && cached.exp > now() + 60_000) return cached.token;
    const exp = now() + 30 * 60_000;
    const r = await admin.from("automation_run_tokens").insert({ note: "meta-publish -> files server", expires_at: new Date(exp).toISOString() }).select("token").single();
    if (r.error || !r.data) throw new Error("run token: " + (r.error?.message || "no row"));
    cached = { token: r.data.token, exp };
    return cached.token;
  }
  return async function storePublishAsset(admin: Admin, path: string, bytes: Uint8Array, contentType: string): Promise<string> {
    if (filesBase && SAFE_NAME.test(path)) {
      try {
        const token = await runToken(admin);
        const res = await fetchImpl(`${filesBase}/v1/p/meta/${path}`, { method: "PUT", headers: { "X-Run-Token": token, "Content-Type": contentType }, body: bytes });
        const out = await res.json().catch(() => null);
        if (res.ok && out?.ok && typeof out.url === "string" && out.size === bytes.length) return out.url;
        console.warn("files server upload failed, falling back to Supabase:", res.status, String(out?.error || "").slice(0, 80));
      } catch (e) {
        console.warn("files server upload error, falling back to Supabase:", String(e instanceof Error ? e.message : e).slice(0, 120));
      }
    }
    const up = await admin.storage.from("meta-publish-assets").upload(path, bytes, { contentType, upsert: true });
    if (up.error) throw new Error("فشل رفع الملف لـSupabase Storage: " + up.error.message);
    return admin.storage.from("meta-publish-assets").getPublicUrl(path).data.publicUrl;
  };
}
