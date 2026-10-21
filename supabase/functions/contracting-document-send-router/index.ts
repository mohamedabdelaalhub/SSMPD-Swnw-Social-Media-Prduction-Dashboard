import "jsr:@supabase/functions-js/edge-runtime.d.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, "Content-Type": "application/json" },
  });
}

async function invokeInternal(name: string, req: Request, body: unknown) {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  for (const h of ["authorization", "apikey", "x-client-info"]) {
    const v = req.headers.get(h);
    if (v) headers[h] = v;
  }
  const response = await fetch(`${SUPABASE_URL}/functions/v1/${name}`, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(30000),
  });
  const data = await response.json().catch(() => ({ error: `تعذر قراءة رد ${name}` }));
  return { response, data };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: CORS });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  let body: any;
  try { body = await req.json(); } catch { return json({ error: "بيانات غير صالحة" }, 400); }

  const core = await invokeInternal("contracting-document-send-core", req, body);
  if (core.response.ok || body?.channel !== "whatsapp" || core.data?.code !== "WHATSAPP_WINDOW_EXPIRED") {
    return json(core.data, core.response.status);
  }

  const template = await invokeInternal("contracting-document-template-send", req, {
    agreement_id: body?.agreement_id,
    recipient: body?.recipient,
    filename: body?.filename,
    pdf_base64: body?.pdf_base64,
  });

  if (template.response.ok) return json(template.data, template.response.status);

  const templateCode = String(template.data?.code || "");
  if (/^WHATSAPP_TEMPLATE_(PENDING|REJECTED|PAUSED|DISABLED|MISSING|NOT_CONFIGURED|UNAVAILABLE)$/.test(templateCode)) {
    return json({
      ...core.data,
      error: `${core.data?.error || "لا يمكن الإرسال المباشر خارج نافذة 24 ساعة."}\n${template.data?.error || "قالب واتساب غير جاهز بعد."}`,
      template_status: template.data?.template_status || null,
      template_id: template.data?.template_id || null,
      template_code: templateCode,
    }, core.response.status);
  }

  return json(template.data, template.response.status);
});
