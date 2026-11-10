import { makePublishAssetStore } from "./files-store.ts";
function assert(c: unknown, m: string) { if (!c) throw new Error(m); }
function fakeAdmin() {
  const calls = { tokens: 0, uploads: [] as string[] };
  const admin = {
    from: (_t: string) => ({ insert: (_r: unknown) => ({ select: () => ({ single: async () => { calls.tokens++; return { data: { token: "tok-" + calls.tokens }, error: null }; } }) }) }),
    storage: { from: (_b: string) => ({ upload: async (p: string) => { calls.uploads.push(p); return { error: null }; }, getPublicUrl: (p: string) => ({ data: { publicUrl: "https://sb/meta-publish-assets/" + p } }) }) },
  };
  return { admin, calls };
}
const bytes = new Uint8Array([1, 2, 3, 4]);
Deno.test("server ok -> server url, token reused", async () => {
  const seen: string[] = [];
  const f = (async (url: string, init: RequestInit) => { seen.push(url + " " + (init.headers as Record<string, string>)["X-Run-Token"]); return new Response(JSON.stringify({ ok: true, url: "https://files/p/meta/a.png", size: 4 }), { status: 200 }); }) as unknown as typeof fetch;
  const { admin, calls } = fakeAdmin(); const store = makePublishAssetStore("https://files", f);
  assert(await store(admin, "a.png", bytes, "image/png") === "https://files/p/meta/a.png", "url");
  await store(admin, "b.png", bytes, "image/png");
  assert(calls.tokens === 1, "one token minted"); assert(calls.uploads.length === 0, "no supabase upload");
  assert(seen[0] === "https://files/v1/p/meta/a.png tok-1", seen[0]);
});
Deno.test("server error -> supabase fallback", async () => {
  const f = (async () => new Response(JSON.stringify({ ok: false, error: "disk" }), { status: 507 })) as unknown as typeof fetch;
  const { admin, calls } = fakeAdmin(); const store = makePublishAssetStore("https://files", f);
  assert(await store(admin, "a.png", bytes, "image/png") === "https://sb/meta-publish-assets/a.png", "fallback url"); assert(calls.uploads[0] === "a.png", "uploaded to supabase");
});
Deno.test("network throw -> fallback", async () => {
  const f = (async () => { throw new Error("down"); }) as unknown as typeof fetch;
  const { admin } = fakeAdmin(); const store = makePublishAssetStore("https://files", f);
  assert((await store(admin, "x.mp4", bytes, "video/mp4")).startsWith("https://sb/"), "fallback");
});
Deno.test("size mismatch -> fallback", async () => {
  const f = (async () => new Response(JSON.stringify({ ok: true, url: "https://files/p/meta/a.png", size: 3 }), { status: 200 })) as unknown as typeof fetch;
  const { admin } = fakeAdmin(); const store = makePublishAssetStore("https://files", f);
  assert((await store(admin, "a.png", bytes, "image/png")).startsWith("https://sb/"), "fallback on size mismatch");
});
Deno.test("flag off -> old behaviour, no fetch", async () => {
  let fetched = false; const f = (async () => { fetched = true; return new Response("{}"); }) as unknown as typeof fetch;
  const { admin, calls } = fakeAdmin(); const store = makePublishAssetStore("", f);
  await store(admin, "a.png", bytes, "image/png"); assert(!fetched && calls.tokens === 0 && calls.uploads.length === 1, "old path only");
});
Deno.test("unsafe name -> supabase only", async () => {
  let fetched = false; const f = (async () => { fetched = true; return new Response("{}"); }) as unknown as typeof fetch;
  const { admin } = fakeAdmin(); const store = makePublishAssetStore("https://files", f);
  await store(admin, "../x.png", bytes, "image/png"); assert(!fetched, "no server call for unsafe name");
});
Deno.test("token refreshed after expiry", async () => {
  let t = 0; const f = (async () => new Response(JSON.stringify({ ok: true, url: "u", size: 4 }), { status: 200 })) as unknown as typeof fetch;
  const { admin, calls } = fakeAdmin(); const store = makePublishAssetStore("https://files", f, () => t);
  await store(admin, "a.png", bytes, "image/png"); t += 29.5 * 60_000; await store(admin, "b.png", bytes, "image/png");
  assert(calls.tokens === 2, "minted again near expiry");
});
