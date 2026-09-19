import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-client-info",
  "Access-Control-Allow-Methods": "POST, OPTIONS"
};

const instructions = `أنت خبير تسويق طبي استراتيجي ومدير محتوى للرعاية الصحية لعيادات سونو التخصصية SwnW Specialized Clinics.
معلومات ثابتة لا تتغير: الشعار "جذور الخبرة.. لصحتك بكرة"، الإدارة الطبية د. دينا حسني استشاري المخ والأعصاب، العنوان الجيزة حدائق الأهرام 45ع شارع الخزان، الهاتف 0236230005، واتساب 01010686264. لا تخترع أو تغير أي معلومات عن المركز.
اكتب بالعربية المصرية الطبيعية وبنبرة مهنية موثوقة دافئة. لا تشخّص ولا تقدّم وعودًا مضمونة ولا تخويفًا. في علامات الخطر أو الأعراض العصبية الحادة، اجعل CTA للطوارئ فورًا ولا تستخدم حجزًا.
أعطِ بالضبط 3 أفكار مختلفة فعلاً. كل فكرة مكتملة بالحقول المطلوبة. لا تضع عناوين أو شرحًا خارج JSON.
الحقول: title, idea, hook, angle, format (video أو image_post أو link_post), script, caption, cta_type (save_share أو whatsapp أو book أو message أو call أو learn_more أو comment أو emergency_action أو custom), cta_text, duration_min_seconds, duration_max_seconds, video_template (medical_educational أو doctor_talking أو quick_tips), hypothesis_reason.
لـ video: script صوت فقط بلا تعليمات مونتاج، والمدة أرقام مناسبة فعليًا. لغير الفيديو اترك حقول الفيديو فارغة أو null.
اعتمد على الـBrief الحالي فقط للمعلومات المتغيرة. إذا كان الدليل ضعيفًا استخدم لغة مثل "فرضية تستحق الاختبار" ولا تدّعِ فوزًا أو ضمانًا.`;

function responseText(data: any): string {
  if (typeof data?.output_text === "string") return data.output_text;
  const parts: string[] = [];
  for (const item of data?.output || []) {
    for (const content of item?.content || []) if (typeof content?.text === "string") parts.push(content.text);
  }
  return parts.join("");
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return Response.json({ error: "POST only" }, { status: 405, headers: cors });

  try {
    const token = req.headers.get("Authorization") || "";
    if (!token) throw new Error("سجّل الدخول أولًا.");
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
    const authDb = createClient(supabaseUrl, anonKey, { global: { headers: { Authorization: token } } });
    const active = await authDb.rpc("my_admin_id");
    if (active.error || !active.data) throw new Error("هذا الحساب غير مسجل كموظف نشط.");

    const apiKey = Deno.env.get("OPENAI_API_KEY");
    if (!apiKey) throw new Error("لم يتم إعداد OPENAI_API_KEY في أسرار Supabase بعد.");

    const body = await req.json();
    const mode = body?.mode === "develop" ? "develop" : "ideas";
    if (!body?.brand) throw new Error("الصفحة مطلوبة.");
    if (mode === "develop" && !String(body?.manual_draft || body?.topic || body?.title || "").trim()) {
      throw new Error("اكتب فكرة أو مسودة لتطويرها.");
    }

    const brief = {
      mode,
      brand: String(body.brand || ""),
      specialty: String(body.specialty || ""),
      advertising_objective: String(body.advertising_objective || ""),
      preferred_format: String(body.preferred_format || ""),
      topic: String(body.topic || ""),
      title: String(body.title || ""),
      manual_draft: String(body.manual_draft || ""),
      performance_brief: String(body.performance_brief || "")
    };

    const schema = {
      type: "object",
      additionalProperties: false,
      required: ["ideas"],
      properties: {
        ideas: {
          type: "array", minItems: 3, maxItems: 3,
          items: {
            type: "object", additionalProperties: false,
            required: ["title","idea","hook","angle","format","script","caption","cta_type","cta_text","duration_min_seconds","duration_max_seconds","video_template","hypothesis_reason"],
            properties: {
              title:{type:"string"}, idea:{type:"string"}, hook:{type:"string"}, angle:{type:"string"},
              format:{type:"string",enum:["video","image_post","link_post"]}, script:{type:["string","null"]}, caption:{type:"string"},
              cta_type:{type:"string",enum:["save_share","whatsapp","book","message","call","learn_more","comment","emergency_action","custom"]},
              cta_text:{type:"string"}, duration_min_seconds:{type:["integer","null"]}, duration_max_seconds:{type:["integer","null"]},
              video_template:{type:["string","null"],enum:["medical_educational","doctor_talking","quick_tips",null]},
              hypothesis_reason:{type:"string"}
            }
          }
        }
      }
    };

    const openai = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: { "Authorization": "Bearer " + apiKey, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "gpt-5.6-sol",
        instructions,
        input: "SSMPD Dashboard Brief:\n" + JSON.stringify(brief),
        text: { format: { type: "json_schema", name: "ssmpd_content_ideas", strict: true, schema } }
      })
    });
    const raw = await openai.json();
    if (!openai.ok) throw new Error(raw?.error?.message || "تعذر الاتصال بـ OpenAI.");
    const parsed = JSON.parse(responseText(raw));
    if (!Array.isArray(parsed?.ideas) || parsed.ideas.length !== 3) throw new Error("النتيجة لم تحتوِ على ٣ أفكار مكتملة.");
    return Response.json({ ideas: parsed.ideas, model: "gpt-5.6-sol" }, { headers: { ...cors, "Content-Type": "application/json" } });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "حدث خطأ غير معروف." }, { status: 400, headers: { ...cors, "Content-Type": "application/json" } });
  }
});