// Brand kit (frames, music, outros, logos, templates) on our server first, Supabase bucket "automation-kit" as fallback.
// Owner decision 2026-11-10: content files live on files.swnwclinics.com to cut Supabase egress (the kit was read from
// Storage ~20 times a day, ~25 MB). Base "" (secret SWNW_FILES_BASE unset) = old behaviour only.
// Server copy: <base>/f/kit/<name> (private area). The caller's own X-Run-Token is passed on, so the server checks the
// same token table the gateway already checked. A file missing on the server is read from Storage and copied up once.
// deno-lint-ignore no-explicit-any
type Admin = any;
const SEG = /^[A-Za-z0-9][A-Za-z0-9._@+=-]{0,120}$/;
const BUCKET = "automation-kit";

export function serverName(name: string): string | null {
  const parts = name.split("/");
  if (parts.length > 7 || !parts.every((p) => SEG.test(p))) return null;
  return parts.map(encodeURIComponent).join("/");
}

export function makeKitStore(filesBase: string, fetchImpl: typeof fetch = fetch, background: (p: Promise<unknown>) => void = (p) => { p.catch(() => {}); }) {
  async function putServer(rel: string, bytes: Uint8Array, token: string): Promise<boolean> {
    try {
      const r = await fetchImpl(`${filesBase}/v1/f/kit/${rel}`, { method: "PUT", headers: { "X-Run-Token": token, "Content-Type": "application/octet-stream" }, body: bytes as BodyInit });
      const out = await r.json().catch(() => null);
      if (r.ok && out?.ok && out.size === bytes.length) return true;
      console.warn("kit copy to files server failed:", r.status, String(out?.error || "").slice(0, 80));
    } catch (e) {
      console.warn("kit copy to files server error:", String(e instanceof Error ? e.message : e).slice(0, 120));
    }
    return false;
  }

  // -> bytes as a Response body, or null when the file exists nowhere.
  async function get(admin: Admin, name: string, token: string): Promise<{ body: BodyInit; source: "server" | "supabase" } | null> {
    const rel = filesBase ? serverName(name) : null;
    if (rel) {
      try {
        const r = await fetchImpl(`${filesBase}/f/kit/${rel}`, { headers: { "X-Run-Token": token } });
        if (r.ok && r.body) return { body: r.body, source: "server" };
        if (r.status !== 404) console.warn("kit read from files server failed:", r.status);
        else await r.body?.cancel();
      } catch (e) {
        console.warn("kit read from files server error:", String(e instanceof Error ? e.message : e).slice(0, 120));
      }
    }
    const { data, error } = await admin.storage.from(BUCKET).download(name);
    if (error || !data) return null;
    const bytes = new Uint8Array(await data.arrayBuffer());
    if (rel) background(putServer(rel, bytes, token));   // copy up once; the next read comes from the server
    return { body: bytes, source: "supabase" };
  }

  // Supabase stays the master copy (uploads cost no egress); the server copy is refreshed right away.
  async function put(admin: Admin, name: string, bytes: Uint8Array, token: string): Promise<string | null> {
    const { error } = await admin.storage.from(BUCKET).upload(name, bytes, { upsert: true, contentType: "application/octet-stream" });
    if (error) return error.message;
    const rel = filesBase ? serverName(name) : null;
    if (rel && !(await putServer(rel, bytes, token))) {
      // never leave an older server copy in front of the new file: drop it, reads fall back to Supabase
      try { await fetchImpl(`${filesBase}/v1/f/kit/${rel}`, { method: "DELETE", headers: { "X-Run-Token": token } }); } catch { /* next read heals it */ }
    }
    return null;
  }

  return { get, put };
}
