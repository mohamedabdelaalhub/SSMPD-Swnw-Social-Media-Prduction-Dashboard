import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
const DRIVE_BRIDGE_URL = "https://script.google.com/macros/s/AKfycbzEs73BE101-gIlSx_qwdF625nSalQ2i6mob7mGqH3oN4x40NlZoowjNta3KtKaXYjTYA/exec";
const MAX_BYTES = 15 * 1024 * 1024;
const ALLOWED_EXTENSIONS = new Set(["pdf", "doc", "docx", "png", "jpg", "jpeg"]);

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...CORS, "Content-Type": "application/json" } });
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(binary);
}

async function getCaller(req: Request) {
  const authorization = req.headers.get("Authorization");
  if (!authorization) return null;
  const userClient = createClient(SUPABASE_URL, ANON_KEY, { global: { headers: { Authorization: authorization } } });
  const { data: { user }, error } = await userClient.auth.getUser();
  if (error || !user) return null;
  const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);
  const { data } = await admin.from("admins")
    .select("id, role, active, admin_extra_roles!admin_id(role)")
    .eq("user_id", user.id).eq("active", true).maybeSingle();
  if (!data) return null;
  const extra = ((data as unknown as { admin_extra_roles?: { role: string }[] }).admin_extra_roles || []).map((r) => r.role);
  const roles = [data.role, ...extra];
  const allowed = roles.some((role) => ["super_admin", "general_manager", "contract_manager"].includes(role));
  return allowed ? { id: data.id } : null;
}

async function uploadViaBridge(entityName: string, contractId: string, file: File, bytes: Uint8Array) {
  const res = await fetch(DRIVE_BRIDGE_URL, {
    method: "POST",
    headers: { "Content-Type": "text/plain;charset=utf-8" },
    body: JSON.stringify({
      category: "contracting_entity_contract",
      entityName,
      contractId,
      fileName: file.name,
      mimeType: file.type || "application/octet-stream",
      base64: bytesToBase64(bytes),
    }),
  });
  const result = await res.json().catch(() => null);
  if (!res.ok || !result?.ok) throw new Error(result?.error || "فشل رفع العقد إلى Google Drive");
  return result as { fileUrl: string; folderUrl: string; fileId: string };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: CORS });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  const caller = await getCaller(req);
  if (!caller) return json({ error: "مفيش صلاحية لإدارة العقود" }, 403);

  let form: FormData;
  try { form = await req.formData(); } catch { return json({ error: "لازم ترفع الملف كـ multipart/form-data" }, 400); }
  const contractId = form.get("contract_id")?.toString();
  const file = form.get("file");
  if (!contractId) return json({ error: "contract_id مطلوب" }, 400);
  if (!(file instanceof File)) return json({ error: "ملف العقد مطلوب" }, 400);
  const extension = (file.name.split(".").pop() || "").toLowerCase();
  if (!ALLOWED_EXTENSIONS.has(extension)) return json({ error: "صيغة الملف غير مدعومة. استخدم PDF أو Word أو صورة." }, 400);
  if (file.size > MAX_BYTES) return json({ error: "أقصى حجم للعقد 15 ميجابايت" }, 400);

  const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);
  const { data: contract, error: contractError } = await admin.from("contracting_entity_contracts")
    .select("id, contracting_entities(name)").eq("id", contractId).maybeSingle();
  const entity = contract && (contract as unknown as { contracting_entities?: { name?: string } }).contracting_entities;
  if (contractError || !contract || !entity?.name) return json({ error: "العقد غير موجود" }, 404);

  try {
    const bytes = new Uint8Array(await file.arrayBuffer());
    const uploaded = await uploadViaBridge(entity.name, contractId, file, bytes);
    const { data: updated, error: updateError } = await admin.from("contracting_entity_contracts").update({
      signed_document_url: uploaded.fileUrl,
      signed_document_drive_file_id: uploaded.fileId,
      signed_document_file_name: file.name,
      signed_document_mime_type: file.type || null,
      signed_document_uploaded_at: new Date().toISOString(),
      signed_document_uploaded_by: caller.id,
    }).eq("id", contractId).select().single();
    if (updateError) return json({ error: updateError.message }, 500);
    return json({ contract: updated, drive_folder_url: uploaded.folderUrl });
  } catch (error) {
    return json({ error: (error as Error).message }, 502);
  }
});
