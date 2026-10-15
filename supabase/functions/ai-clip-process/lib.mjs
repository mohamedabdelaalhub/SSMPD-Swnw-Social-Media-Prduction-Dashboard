// دوال نقية (من غير شبكة) لتوليد لقطات Veo — معزولة عشان تتختبر بـ node.

export function costUsd(prices, model, seconds) {
  const p = Number(prices?.[model]);
  if (!isFinite(p) || p < 0) throw new Error("سعر النموذج غير معروف: " + model);
  return +(p * Number(seconds)).toFixed(4);
}

// قرار الميزانية: التكلفة بالجنيه = تكلفة الدولار × سعر الصرف. بنسمح بس لو الباقي يكفي.
export function budgetDecision({ spentEgp, budgetEgp, estUsd, rate }) {
  const estEgp = +(Number(estUsd) * Number(rate)).toFixed(2);
  const remaining = +(Number(budgetEgp) - Number(spentEgp)).toFixed(2);
  return { ok: estEgp <= remaining, estEgp, remaining };
}

export function extractVideoUri(op) {
  const r = op?.response ?? {};
  const samples = r.generateVideoResponse?.generatedSamples ?? r.generatedVideos ?? r.videos ?? [];
  const first = Array.isArray(samples) ? samples[0] : null;
  return first?.video?.uri ?? first?.uri ?? null;
}

export function extractError(op) {
  if (op?.error?.message) return String(op.error.message);
  const filtered = op?.response?.generateVideoResponse?.raiMediaFilteredReasons;
  if (Array.isArray(filtered) && filtered.length) return "رُفض المحتوى من فلاتر الأمان: " + filtered.join(" | ");
  return null;
}

// نختار أحدث نموذج نصي سريع (flash) من القائمة المتاحة للمفتاح، من غير ما نثبّت اسم قد يتغير.
export function pickTextModel(models) {
  const ok = (models || []).filter((m) => /^models\/gemini-[\d.]+-flash$/.test(m.name) && (m.supportedGenerationMethods || []).includes("generateContent"));
  ok.sort((a, b) => parseFloat(b.name.match(/gemini-([\d.]+)-flash/)[1]) - parseFloat(a.name.match(/gemini-([\d.]+)-flash/)[1]));
  return ok[0]?.name?.replace(/^models\//, "") ?? "gemini-2.5-flash";
}

const BRAND_STYLE = {
  sono: "clean modern medical clinic, soft natural light, calm reassuring mood, white and blue color palette",
  dr_dina: "warm elegant women's wellness and aesthetics setting, soft daylight, calm and trustworthy mood",
};

// بديل ثابت لو كتابة الوصف بالذكاء الاصطناعي فشلت (النص العربي بيتحط كما هو كموضوع).
export function fallbackPrompt(item) {
  const style = BRAND_STYLE[item?.brand] || BRAND_STYLE.sono;
  const topic = String(item?.title || "health awareness").slice(0, 120);
  return `Cinematic vertical 9:16 b-roll for a medical clinic social media video about: ${topic}. ` +
    `${style}. Smooth slow camera movement, shallow depth of field, realistic, high quality. ` +
    `No on-screen text, no logos, no subtitles, no distorted hands or faces.`;
}

export function promptRequest(item) {
  const brief = [item?.title, item?.hook_text, item?.script_text || item?.body].filter(Boolean).join("\n").slice(0, 1500);
  return "Write ONE English prompt (max 90 words) for an AI video generator describing a single 8-second cinematic vertical (9:16) b-roll shot " +
    "that visually supports this Arabic medical social media post. Describe subject, setting, lighting, camera movement and mood. " +
    "Do not include any text, captions, logos, brand names, or recognizable people. Avoid close-up faces and hands. Output only the prompt.\n\nPOST:\n" + brief;
}

export function cleanPrompt(text, item) {
  const t = String(text || "").replace(/^["'`\s]+|["'`\s]+$/g, "").replace(/\s+/g, " ").trim();
  return t.length >= 30 ? t.slice(0, 700) : fallbackPrompt(item);
}

export function bytesToBase64(bytes) {
  let bin = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) bin += String.fromCharCode(...bytes.subarray(i, i + chunk));
  return btoa(bin);
}

export function classifyApiError(status, message) {
  const m = String(message || "");
  if (status === 429 || /quota|RESOURCE_EXHAUSTED|rate limit/i.test(m)) return { retry: true, text: "تجاوز حد الاستخدام عند جوجل، هنعيد المحاولة: " + m.slice(0, 160) };
  if (status === 403 || status === 400 && /billing|API key|permission|not enabled/i.test(m)) return { retry: false, text: "مشكلة في المفتاح أو الدفع على Google AI Studio: " + m.slice(0, 200) };
  if (status >= 500) return { retry: true, text: "خطأ مؤقت من جوجل: " + m.slice(0, 160) };
  return { retry: false, text: m.slice(0, 220) || ("HTTP " + status) };
}
