import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

// Media Buyer — Zero-Secret Agent Pairing (Phase 2B)
//
// جسر ربط لمرة واحدة بين لوحة SSMPD والوكيل الخارجي (Claude Media Buyer على
// مشروع Meta منفصل تمامًا). الهدف: مفيش أي سر طويل العمر (زي
// MEDIA_BUYER_AGENT_TOKEN) لازم ينتقل بين البيئتين — الوكيل بيولّد زوج
// مفاتيح Ed25519 عنده هو بس (المفتاح الخاص يفضل في الجهاز بتاعه، عادة
// macOS Keychain)، وبيبعتلنا بس المفتاح العام + كود ربط مؤقت. بعد كده كل
// طلب من الوكيل بيتوقّع محليًا وبيتحقق منه هنا بالمفتاح العام المُسجَّل —
// راجع media-buyer-propose للتحقق من التوقيع وقت الاستخدام الفعلي.
//
// عمليتين على نفس الدالة (body.op):
//  - create_pairing_code: يستدعيها مدير لوحة مُسجَّل دخول (JWT حقيقي، مش
//    توكن الوكيل) — general_manager/super_admin بس.
//  - register_agent: يستدعيها الوكيل الخارجي نفسه (مفيش جلسة دashboard خالص)
//    — التحقق بيحصل عن طريق كود الربط، مش JWT.
// عشان العمليتين الاتنين يعدّوا من نفس المسار من غير جلسة دashboard إجبارية
// على التانية، الدالة دي لازم verify_jwt=false على مستوى المنصة (زي
// media-buyer-propose بالظبط) — التحقق من هوية المدير بيحصل يدويًا جوه
// create_pairing_code بس، مش عن طريق بوابة الـplatform.

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY");

function getServiceRoleKey(): string | null {
  const secretKeysRaw = Deno.env.get("SUPABASE_SECRET_KEYS");
  if (secretKeysRaw) {
    try {
      const parsed = JSON.parse(secretKeysRaw);
      if (parsed && typeof parsed === "object" && typeof parsed["default"] === "string" && parsed["default"]) {
        return parsed["default"];
      }
    } catch {
      // نتجاهل ونكمل على المفتاح القديم
    }
  }
  const legacy = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (legacy) return legacy;
  return null;
}
const SERVICE_ROLE_KEY = getServiceRoleKey();

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...CORS, "Content-Type": "application/json" } });
}
function fail(code: string, error: string, status = 400) {
  return json({ ok: false, code, error }, status);
}

function isStr(v: unknown): v is string { return typeof v === "string"; }

// ---------- هاش الكود (SHA-256 hex) — النص الخام أبدًا مش بيتخزن ----------
async function sha256Hex(text: string): Promise<string> {
  const bytes = new TextEncoder().encode(text);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

function randomHex(byteLen: number): string {
  const bytes = new Uint8Array(byteLen);
  crypto.getRandomValues(bytes);
  return Array.from(bytes).map((b) => b.toString(16).padStart(2, "0")).join("");
}

// المفتاح العام لازم يكون base64 قياسي لـ32 بايت خام (Ed25519 raw public key)
// — نتحقق من الطول ومن إنه فعلاً مفتاح صالح عن طريق استيراده فعليًا في
// WebCrypto (مش بس فحص طول شكلي)
function base64ToBytes(b64: string): Uint8Array | null {
  try {
    const bin = atob(b64.trim());
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return bytes;
  } catch {
    return null;
  }
}

async function isValidEd25519PublicKey(b64: string): Promise<boolean> {
  const bytes = base64ToBytes(b64);
  if (!bytes || bytes.length !== 32) return false;
  try {
    await crypto.subtle.importKey("raw", bytes, { name: "Ed25519" }, true, ["verify"]);
    return true;
  } catch {
    return false;
  }
}

// ---------- التحقق من هوية المدير (نفس نمط admin-set-password) ----------
async function getCallerManager(req: Request) {
  const authHeader = req.headers.get("Authorization");
  if (!authHeader || !ANON_KEY || !SERVICE_ROLE_KEY) return null;
  const userClient = createClient(SUPABASE_URL, ANON_KEY, {
    global: { headers: { Authorization: authHeader } },
  });
  const { data: { user }, error } = await userClient.auth.getUser();
  if (error || !user) return null;
  const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);
  const { data: row } = await admin
    .from("admins")
    .select("id, role, active, admin_extra_roles!admin_id(role)")
    .eq("user_id", user.id)
    .eq("active", true)
    .maybeSingle();
  if (!row) return null;
  const extra = (row as unknown as { admin_extra_roles?: { role: string }[] }).admin_extra_roles;
  const roles = [row.role as string, ...(extra ?? []).map((r) => r.role)];
  const canManage = roles.includes("general_manager") || roles.includes("super_admin");
  if (!canManage) return null;
  return { id: row.id as string };
}

const PAIRING_CODE_TTL_MINUTES = 10;

async function createPairingCode(req: Request, db: ReturnType<typeof createClient>) {
  const manager = await getCallerManager(req);
  if (!manager) return fail("UNAUTHORIZED", "غير مصرح — لازم تكون مدير عام أو سوبر أدمن مسجّل دخول", 401);

  const code = "mbp_" + randomHex(20); // 40 هيكس + بادئة — نص واحد يُرجع مرة واحدة بس
  const codeHash = await sha256Hex(code);
  const expiresAt = new Date(Date.now() + PAIRING_CODE_TTL_MINUTES * 60_000).toISOString();

  const { error } = await db.from("media_buyer_pairing_codes").insert({
    code_hash: codeHash,
    expires_at: expiresAt,
    created_by: manager.id,
  });
  if (error) return fail("SERVER_ERROR", "تعذّر إنشاء كود الربط", 500);

  // النص الصريح بيترجع هنا مرة واحدة بس — القاعدة عندها الهاش بس، من دلوقتي
  // مفيش أي طريقة نسترجعه بيها تاني
  return json({ ok: true, pairing_code: code, expires_at: expiresAt, expires_in_minutes: PAIRING_CODE_TTL_MINUTES });
}

async function registerAgent(body: Record<string, unknown>, db: ReturnType<typeof createClient>) {
  const pairingCode = body.pairing_code;
  const publicKey = body.public_key;
  const agentName = body.agent_name;

  if (!isStr(pairingCode) || !pairingCode.trim()) return fail("VALIDATION_ERROR", "pairing_code مطلوب");
  if (!isStr(publicKey) || !publicKey.trim()) return fail("VALIDATION_ERROR", "public_key مطلوب");
  if (agentName != null && (!isStr(agentName) || agentName.length > 200)) {
    return fail("VALIDATION_ERROR", "agent_name غير صالح");
  }
  if (!(await isValidEd25519PublicKey(publicKey))) {
    return fail("VALIDATION_ERROR", "public_key لازم يكون Ed25519 raw public key (32 بايت) مُرمّز base64");
  }

  const codeHash = await sha256Hex(pairingCode.trim());
  const { data: codeRow, error: codeErr } = await db
    .from("media_buyer_pairing_codes")
    .select("id, expires_at, used_at")
    .eq("code_hash", codeHash)
    .maybeSingle();
  if (codeErr) return fail("SERVER_ERROR", "تعذّر التحقق من كود الربط", 500);
  if (!codeRow) return fail("INVALID_CODE", "كود ربط غير صحيح", 401);
  if (codeRow.used_at) return fail("CODE_USED", "كود الربط ده اتستخدم قبل كده", 401);
  if (new Date(codeRow.expires_at as string).getTime() < Date.now()) {
    return fail("CODE_EXPIRED", "كود الربط ده منتهي الصلاحية", 401);
  }

  const keyId = "mba_" + randomHex(16);
  const { data: agentRow, error: insertErr } = await db
    .from("media_buyer_agents")
    .insert({
      key_id: keyId,
      name: (isStr(agentName) && agentName.trim()) || "claude_media_buyer",
      public_key: (publicKey as string).trim(),
      status: "active",
    })
    .select("id")
    .single();
  if (insertErr) return fail("SERVER_ERROR", "تعذّر تسجيل الوكيل", 500);

  // تعليم الكود كمُستخدم — بعد نجاح تسجيل الوكيل بس، عشان لو الإدراج فشل
  // الكود يفضل قابل لإعادة المحاولة بدل ما يتحرق من غير فايدة
  const { error: markErr } = await db
    .from("media_buyer_pairing_codes")
    .update({ used_at: new Date().toISOString() })
    .eq("id", codeRow.id);
  if (markErr) {
    // الوكيل اتسجّل فعلاً — نرجّع نجاح، بس نسجّل تحذير داخلي إن الكود ماتعلمش مُستخدم
    console.log(JSON.stringify({ event: "media_buyer_pair_mark_used_failed", agent_id: agentRow.id }));
  }

  return json({ ok: true, key_id: keyId });
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: CORS });
  if (req.method !== "POST") return fail("METHOD_NOT_ALLOWED", "POST only", 405);

  if (!SERVICE_ROLE_KEY) {
    console.log(JSON.stringify({ event: "media_buyer_pair_misconfigured", reason: "no_admin_key" }));
    return fail("MISCONFIGURED", "Server database key not configured", 500);
  }

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return fail("VALIDATION_ERROR", "Invalid JSON body");
  }

  const op = body.op;
  const db = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

  if (op === "create_pairing_code") return createPairingCode(req, db);
  if (op === "register_agent") return registerAgent(body, db);
  return fail("VALIDATION_ERROR", 'op must be "create_pairing_code" or "register_agent"');
});
