import "jsr:@supabase/functions-js/edge-runtime.d.ts";
const allowed = new Set([
  "clinic_reception_message_claim",
  "clinic_reception_message_validate",
  "clinic_reception_message_ack",
  "clinic_reception_agent_context",
  "clinic_reception_agent_event",
  "clinic_reception_agent_health",
  "clinic_reception_agent_set_communications",
  "clinic_reception_pbx_event"
]);
const json = (body, status = 200)=>new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store"
    }
  });
async function equal(a, b) {
  const hash = async (s)=>new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s)));
  const x = await hash(a), y = await hash(b);
  let diff = 0;
  for(let i = 0; i < x.length; i++)diff |= x[i] ^ y[i];
  return diff === 0;
}
Deno.serve(async (req)=>{
  if (req.method !== "POST") return json({
    ok: false
  }, 405);
  const secret = Deno.env.get("WHATSAPP_ALERT_SECRET");
  if (!secret) return json({
    ok: false,
    error: "MISCONFIGURED"
  }, 503);
  if (!await equal(req.headers.get("X-WhatsApp-Alert-Secret") || "", secret)) return json({
    ok: false
  }, 401);
  if (Number(req.headers.get("content-length") || 0) > 32768) return json({
    ok: false
  }, 413);
  let body;
  try {
    const text = await req.text();
    if (text.length > 32768) return json({
      ok: false
    }, 413);
    body = JSON.parse(text);
  } catch  {
    return json({
      ok: false
    }, 400);
  }
  if (!allowed.has(body.rpc) || !body.params || typeof body.params !== "object" || Array.isArray(body.params)) return json({
    ok: false
  }, 400);
  let key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  try {
    key = JSON.parse(Deno.env.get("SUPABASE_SECRET_KEYS") || "{}").default || key;
  } catch  {}
  if (!key) return json({
    ok: false,
    error: "MISCONFIGURED"
  }, 503);
  try {
    const response = await fetch(Deno.env.get("SUPABASE_URL") + "/rest/v1/rpc/" + body.rpc, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "apikey": key,
        "Authorization": "Bearer " + key
      },
      body: JSON.stringify(body.params),
      signal: AbortSignal.timeout(10000)
    });
    if (!response.ok) return json({
      ok: false,
      error: "RPC_FAILED"
    }, 502);
    return json({
      ok: true,
      data: await response.json()
    });
  } catch  {
    return json({
      ok: false,
      error: "RPC_UNAVAILABLE"
    }, 502);
  }
});
