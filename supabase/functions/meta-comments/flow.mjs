// Messenger / Instagram booking flow — rule based, no free-form AI talk about medicine.
// The bot (a) collects service, name, phone and preferred time one question at a time, (b) hands the lead to
// reception when complete, and (c) hands the conversation to a human on: a medical question, an emergency,
// a complaint, an explicit request for a person, or two unclear answers in a row.
// Pure functions only (testable in Node, imported by messages.ts).

const AR = "٠١٢٣٤٥٦٧٨٩", FA = "۰۱۲۳۴۵۶۷۸۹";
export const digits = (s) => String(s ?? "").replace(/[٠-٩]/g, (c) => AR.indexOf(c)).replace(/[۰-۹]/g, (c) => FA.indexOf(c));

export function extractPhone(text) {
  const t = digits(text).replace(/[\s\-().]/g, "");
  const m = t.match(/(?:\+?20|0)?(1[0125]\d{8})(?!\d)/);
  return m ? "+20" + m[1] : null;
}

export const SERVICES = [
  { key: "physiotherapy", label: "علاج طبيعي", re: /علاج\s*طبيع|فيزيو|تأهيل|تاهيل/ },
  { key: "cosmetic_laser", label: "ليزر", re: /ليزر|ازالة\s*الشعر|إزالة\s*الشعر|كانديلا|دايود/ },
  { key: "dental", label: "أسنان", re: /اسنان|أسنان|سنان|تقويم|زراعة|حشو|تنظيف\s*(ال)?جير/ },
  { key: "checkup", label: "كشف", re: /كشف|فحص/ },
];
export function extractService(text) {
  const t = String(text ?? "");
  const hit = SERVICES.find((s) => s.re.test(t));
  return hit ? hit.key : null;
}
export const serviceLabel = (key) => (SERVICES.find((s) => s.key === key) || { label: "خدمة" }).label;

const HUMAN_RE = /(موظف|بشري|بني\s*ادم|بنى\s*ادم|حد\s*(يرد|يكلمني|يكلمنى)|كلموني|كلمونى|عايز\s*(اكلم|أكلم)|عايزة\s*(اكلم|أكلم)|خدمة\s*العملاء|مسؤول|مدير)/;
export const humanRequested = (t) => HUMAN_RE.test(String(t ?? ""));
export const isQuestion = (t) => /[؟?]|بكام|سعر|اسعار|أسعار|ايه|إيه|ازاي|إزاي|فين|عنوان|مواعيد|ميعاد|بتعملوا|عندكم/.test(String(t ?? ""));

export function extractName(text) {
  let t = String(text ?? "").trim().replace(/^(اسمي|اسمى|أنا|انا|الاسم)\s+/, "").trim();
  if (!t || t.length > 40 || /\d/.test(digits(t)) || isQuestion(t)) return null;
  if (t.split(/\s+/).length > 4) return null;
  if (extractService(t) && t.split(/\s+/).length > 2) return null;
  return t;
}

const MSG = {
  greet: "أهلاً بحضرتك في عيادات سونو التخصصية 🌿 أنا المساعد الآلي، هساعدك تحجز وزميلنا في الاستقبال هيأكد الميعاد معاك.",
  service: "حضرتك محتاج/ة أنهي خدمة؟ (علاج طبيعي، ليزر، أسنان، أو خدمة تانية)",
  name: "اسم حضرتك إيه؟",
  phone: "رقم موبايل حضرتك علشان زميلنا في الاستقبال يكلمك ويأكد الميعاد؟",
  time: "إيه اليوم أو الوقت المناسب لحضرتك؟",
  unclear: "محتاج توضيح أكتر علشان أفهم حضرتك 🙏",
  unclear2: "هنحوّل حضرتك لزميل من فريقنا يكمل معاك 🙏",
  human: "تمام، زميل من فريقنا هيكمل معاك في أقرب وقت 🙏",
  medical: "شكراً لسؤال حضرتك 🌿 وكيل بشري من فريقنا هيكمل معاك في أقرب وقت.",
};
export const MESSAGES = MSG;

const DEFAULT = { stage: "collecting", name: null, phone: null, service: null, preferred_time: null, expect: null, unclear: 0, handoff_reason: null };
const askOf = (expect) => MSG[expect] || null;

function missing(s) {
  if (!s.service) return "service";
  if (!s.name) return "name";
  if (!s.phone) return "phone";
  if (!s.preferred_time) return "time";
  return null;
}

// advance(state, text, { category, firstContact }) → { state, reply, handoff, alert, ready, infoReply, silent, passthrough }
export function advance(prev, text, ctx = {}) {
  const s = { ...DEFAULT, ...(prev || {}) };
  const out = (extra) => ({ state: s, reply: null, handoff: null, alert: false, ready: false, infoReply: false, silent: false, passthrough: false, ...extra });
  if (s.stage === "handoff" || s.stage === "ready") return out({ silent: true });

  const cat = ctx.category || "general";
  const t = String(text ?? "");
  const toHandoff = (reason, reply, alert = false) => { s.stage = "handoff"; s.handoff_reason = reason; return out({ handoff: reason, reply, alert }); };

  if (humanRequested(t)) return toHandoff("human", MSG.human);
  if (cat === "medical_sensitive") return toHandoff("medical", MSG.medical);
  if (cat === "emergency") return toHandoff("emergency", null, true);   // caller sends the approved emergency template + red alert
  if (cat === "complaint") return toHandoff("complaint", null, true);   // caller sends the approved complaint template + red alert
  if (cat === "thanks" || cat === "spam") return out({ passthrough: true });

  let progress = false;
  const ph = extractPhone(t);
  if (ph && !s.phone) { s.phone = ph; progress = true; }
  const sv = extractService(t);
  if (sv && !s.service) { s.service = sv; progress = true; }
  if (s.expect === "name" && !s.name) { const n = extractName(t); if (n) { s.name = n; progress = true; } }
  if (s.expect === "time" && !s.preferred_time) {
    const clean = t.trim();
    if (clean && clean.length <= 140 && !ph && !isQuestion(clean)) { s.preferred_time = clean; progress = true; }
  }

  const q = isQuestion(t);
  if (progress) s.unclear = 0;
  else if (s.expect && !q) {
    s.unclear += 1;
    if (s.unclear >= 2) return toHandoff("unclear", MSG.unclear2);
    return out({ reply: MSG.unclear + "\n" + askOf(s.expect) });
  }

  const need = missing(s);
  if (!need) { s.stage = "ready"; s.expect = null; return out({ ready: true, reply: `تمام يا ${s.name} 🌿 سجّلنا طلبك لـ${serviceLabel(s.service)}. زميلنا من الاستقبال هيتواصل مع حضرتك على رقمك لتأكيد الميعاد.` }); }
  s.expect = need;
  const question = askOf(need);
  if (q && !progress) return out({ infoReply: true, reply: question });
  return out({ reply: ctx.firstContact ? MSG.greet + "\n" + question : question });
}
