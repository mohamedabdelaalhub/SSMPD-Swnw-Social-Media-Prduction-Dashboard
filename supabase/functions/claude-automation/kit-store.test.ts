import { makeKitStore, serverName } from "./kit-store.ts";
function assert(c: unknown, m: string) { if (!c) throw new Error(m); }
const TOK = "11111111-2222-3333-4444-555555555555";
const BASE = "https://files.example";

function fakeAdmin(files: Record<string, Uint8Array>, uploadError: string | null = null) {
  const calls = { downloads: [] as string[], uploads: [] as string[] };
  const admin = {
    storage: {
      from: (b: string) => {
        assert(b === "automation-kit", "bucket " + b);
        return {
          download: (n: string) => { calls.downloads.push(n); return Promise.resolve(files[n] ? { data: new Blob([files[n]]), error: null } : { data: null, error: { message: "nf" } }); },
          upload: (n: string, bytes: Uint8Array) => { calls.uploads.push(n); if (!uploadError) files[n] = bytes; return Promise.resolve({ error: uploadError ? { message: uploadError } : null }); },
        };
      },
    },
  };
  return { admin, calls };
}
type Call = { url: string; method: string; token: string | null };
function fakeServer(store: Record<string, Uint8Array>, opts: { down?: boolean; putFails?: boolean } = {}) {
  const calls: Call[] = [];
  const f = (async (url: string | URL, init?: RequestInit) => {
    const u = String(url), method = init?.method || "GET", token = new Headers(init?.headers).get("X-Run-Token");
    calls.push({ url: u, method, token });
    if (opts.down) throw new Error("connect refused");
    const key = u.replace(BASE + "/v1/f/kit/", "").replace(BASE + "/f/kit/", "");
    if (method === "GET") return store[key] ? new Response(store[key]) : new Response("{}", { status: 404 });
    if (method === "PUT") {
      if (opts.putFails) return new Response(JSON.stringify({ ok: false, error: "disk" }), { status: 507 });
      const b = new Uint8Array(init!.body as Uint8Array); store[key] = b;
      return new Response(JSON.stringify({ ok: true, size: b.length }));
    }
    if (method === "DELETE") { delete store[key]; return new Response(JSON.stringify({ ok: true })); }
    return new Response("?", { status: 405 });
  }) as typeof fetch;
  return { f, calls };
}
const bytes = (s: string) => new TextEncoder().encode(s);
const text = async (b: BodyInit) => await new Response(b).text();

Deno.test("serverName accepts kit paths, rejects what the server would refuse", () => {
  assert(serverName("sono/frame_light.png") === "sono/frame_light.png", "plain");
  assert(serverName("tts/pronunciations.json") === "tts/pronunciations.json", "json");
  assert(serverName("sono/") === null, "folder listing");
  assert(serverName("a b.png") === null, "space");
  assert(serverName(".hidden") === null, "dot first");
});

Deno.test("base unset: Storage only, server never called", async () => {
  const { admin, calls } = fakeAdmin({ "sono/a.png": bytes("A") });
  const srv = fakeServer({});
  const k = makeKitStore("", srv.f);
  const got = await k.get(admin, "sono/a.png", TOK);
  assert(got?.source === "supabase" && await text(got.body) === "A", "storage read");
  assert(srv.calls.length === 0 && calls.downloads.length === 1, "no server");
});

Deno.test("server hit: no Storage download, caller token passed on", async () => {
  const { admin, calls } = fakeAdmin({ "sono/a.png": bytes("OLD") });
  const srv = fakeServer({ "sono/a.png": bytes("A") });
  const got = await makeKitStore(BASE, srv.f).get(admin, "sono/a.png", TOK);
  assert(got?.source === "server" && await text(got.body) === "A", "server bytes");
  assert(calls.downloads.length === 0, "storage untouched");
  assert(srv.calls[0].url === BASE + "/f/kit/sono/a.png" && srv.calls[0].token === TOK, "url+token");
});

Deno.test("server miss: Storage read, then copied up once in the background", async () => {
  const { admin } = fakeAdmin({ "dina/outro.mp4": bytes("VID") });
  const store: Record<string, Uint8Array> = {};
  const srv = fakeServer(store);
  const bg: Promise<unknown>[] = [];
  const k = makeKitStore(BASE, srv.f, (p) => bg.push(p));
  const got = await k.get(admin, "dina/outro.mp4", TOK);
  assert(got?.source === "supabase" && await text(got.body) === "VID", "fallback bytes");
  await Promise.all(bg);
  assert(new TextDecoder().decode(store["dina/outro.mp4"]) === "VID", "mirrored");
  const again = await k.get(admin, "dina/outro.mp4", TOK);
  assert(again?.source === "server", "second read from server");
});

Deno.test("server down: Storage read, no throw", async () => {
  const { admin } = fakeAdmin({ "sono/a.png": bytes("A") });
  const got = await makeKitStore(BASE, fakeServer({}, { down: true }).f).get(admin, "sono/a.png", TOK);
  assert(got?.source === "supabase", "fallback");
});

Deno.test("missing everywhere: null (gateway answers 404)", async () => {
  const { admin } = fakeAdmin({});
  const got = await makeKitStore(BASE, fakeServer({}).f).get(admin, "sono/none.png", TOK);
  assert(got === null, "null");
});

Deno.test("unsafe name: Storage only", async () => {
  const { admin } = fakeAdmin({ "a b.png": bytes("A") });
  const srv = fakeServer({});
  const got = await makeKitStore(BASE, srv.f).get(admin, "a b.png", TOK);
  assert(got?.source === "supabase" && srv.calls.length === 0, "no server call");
});

Deno.test("put writes Storage and server", async () => {
  const files: Record<string, Uint8Array> = {}, store: Record<string, Uint8Array> = {};
  const { admin } = fakeAdmin(files);
  const err = await makeKitStore(BASE, fakeServer(store).f).put(admin, "tts/pronunciations.json", bytes("{}"), TOK);
  assert(err === null && files["tts/pronunciations.json"] && store["tts/pronunciations.json"], "both written");
});

Deno.test("put: server copy fails -> old server copy deleted (no stale file)", async () => {
  const files: Record<string, Uint8Array> = {}, store: Record<string, Uint8Array> = { "sono/a.png": bytes("OLD") };
  const { admin } = fakeAdmin(files);
  const srv = fakeServer(store, { putFails: true });
  const err = await makeKitStore(BASE, srv.f).put(admin, "sono/a.png", bytes("NEW"), TOK);
  assert(err === null && !store["sono/a.png"], "stale removed");
  assert(srv.calls.some((c) => c.method === "DELETE"), "delete sent");
});

Deno.test("put: Storage error is returned, server not written", async () => {
  const store: Record<string, Uint8Array> = {};
  const { admin } = fakeAdmin({}, "quota");
  const srv = fakeServer(store);
  const err = await makeKitStore(BASE, srv.f).put(admin, "sono/a.png", bytes("X"), TOK);
  assert(err === "quota" && srv.calls.length === 0, "error, no server write");
});
