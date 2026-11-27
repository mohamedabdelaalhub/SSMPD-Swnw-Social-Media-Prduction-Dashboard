// Graph API helpers with a hard timeout. Without one, a single hanging request (no answer from Meta) stalls the whole sync run until the
// edge runtime kills it: everything after that call in the run (other brands, messages, sending approved replies) never executes.
export const GRAPH = "https://graph.facebook.com/v26.0/";
export type GraphResult = { ok: boolean; data: any; error?: string };

async function call(url: string, init: RequestInit | undefined, timeoutMs: number): Promise<GraphResult> {
  try {
    const r = await fetch(url, { ...init, signal: AbortSignal.timeout(timeoutMs) });
    const d = await r.json().catch(() => ({}));
    return { ok: r.ok && !d.error, data: d, error: d.error?.message as string | undefined };
  } catch (e) {
    const name = (e as any)?.name;
    return { ok: false, data: {}, error: name === "TimeoutError" || name === "AbortError" ? `Graph timeout after ${Math.round(timeoutMs / 1000)}s` : `Graph request failed: ${String((e as any)?.message || e).slice(0, 120)}` };
  }
}

export function gget(path: string, params: Record<string, string>, timeoutMs = 20000): Promise<GraphResult> {
  const u = new URL(GRAPH + path);
  for (const [k, v] of Object.entries(params)) u.searchParams.set(k, v);
  return call(u.toString(), undefined, timeoutMs);
}
export function gpost(path: string, params: Record<string, string>, timeoutMs = 30000): Promise<GraphResult> {
  return call(GRAPH + path, { method: "POST", body: new URLSearchParams(params) }, timeoutMs);
}
export function gpostJson(path: string, token: string, body: unknown, timeoutMs = 30000): Promise<GraphResult> {
  return call(`${GRAPH}${path}?access_token=${encodeURIComponent(token)}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }, timeoutMs);
}
