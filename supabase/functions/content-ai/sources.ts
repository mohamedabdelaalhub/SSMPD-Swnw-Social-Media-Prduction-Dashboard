// المصادر الطبية لمخرجات content-ai: sources + cover_source_text (نفس schema بلجن ChatGPT).
// النموذج ما بيتصفحش الإنترنت، فبنقبل بس روابط https من جهات طبية معروفة، وكل رابط خارج القايمة بيتشال — مفيش اختراع مصادر.
export const SOURCE_PREFIX = "المصدر الطبي للمحتوى: ";

const ALLOWED_HOSTS = [
  "nhs.uk", "who.int", "cdc.gov", "nih.gov", "medlineplus.gov", "fda.gov", "mayoclinic.org", "clevelandclinic.org",
  "hopkinsmedicine.org", "health.harvard.edu", "nice.org.uk", "cochrane.org", "bmj.com", "thelancet.com", "nejm.org",
  "jamanetwork.com", "aad.org", "aap.org", "healthychildren.org", "heart.org", "diabetes.org", "cancer.org", "ada.org",
  "ema.europa.eu", "ecdc.europa.eu", "moh.gov.eg", "eahealth.gov.eg", "ncbi.nlm.nih.gov", "nlm.nih.gov", "kidney.org",
  "aan.com", "epilepsy.com", "alz.org", "parkinson.org", "stroke.org", "mja.com.au",
];

export const sourceProperties = {
  sources: {
    type: "array", maxItems: 4,
    items: {
      type: "object", additionalProperties: false,
      required: ["name", "title", "url", "type", "is_primary"],
      properties: {
        name: { type: "string" }, title: { type: "string" }, url: { type: "string" },
        type: { type: "string", enum: ["medical_authority", "guideline", "study", "patient_education"] },
        is_primary: { type: "boolean" },
      },
    },
  },
  cover_source_text: { type: "string" },
};

export const sourceInstructions =
  "\nالمصادر الطبية: لو المحتوى طبي (مرض، أعراض، علاج، تحاليل، وقاية) أرجع في sources مصدرًا أساسيًا واحدًا على الأقل من جهة طبية رسمية معروفة (مثل NHS أو WHO أو CDC أو Mayo Clinic) برابط https لصفحة تعرف أنها موجودة فعلًا، مع is_primary=true لواحد فقط. لا تخترع مصدرًا أو رابطًا أو عنوان دراسة؛ لو لا تعرف صفحة محددة بيقين اترك sources فارغة. cover_source_text يكون «" + SOURCE_PREFIX + "اسم المصدر الأساسي». للمحتوى غير الطبي (ترحيب بطبيب، عروض، إعلان خدمة، تعريف بالمركز): sources=[] و cover_source_text=\"\". لا تضع الرابط أو عنوان الصفحة في أي نص تصميم.";

function str(v: unknown, max: number): string {
  return String(v ?? "").replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim().slice(0, max);
}

export function allowedUrl(value: unknown): string {
  try {
    const url = new URL(str(value, 500));
    if (url.protocol !== "https:") return "";
    const host = url.hostname.toLowerCase();
    return ALLOWED_HOSTS.some((d) => host === d || host.endsWith("." + d)) ? url.href : "";
  } catch { return ""; }
}

export function cleanSources(list: unknown): Array<{ name: string; title: string; url: string; type: string; is_primary: boolean }> {
  if (!Array.isArray(list)) return [];
  const out: Array<{ name: string; title: string; url: string; type: string; is_primary: boolean }> = [];
  const seen = new Set<string>();
  for (const row of list as any[]) {
    if (!row || typeof row !== "object" || out.length >= 4) continue;
    const url = allowedUrl(row.url), name = str(row.name, 80);
    if (!url || !name || seen.has(url)) continue;
    seen.add(url);
    out.push({ name, title: str(row.title, 200), url, type: str(row.type, 40) || "medical_authority", is_primary: row.is_primary === true });
  }
  let primary = -1;
  out.forEach((s, i) => { if (s.is_primary && primary < 0) primary = i; else s.is_primary = false; });
  if (out.length && primary < 0) out[0].is_primary = true;
  return out;
}

// بيطبّق الشكل النهائي على الفكرة: النص على التصميم بيتبني من اسم المصدر الأساسي — مش بنثق في نص النموذج.
export function applySources(idea: any): void {
  idea.sources = cleanSources(idea?.sources);
  const main = idea.sources.find((s: any) => s.is_primary) || idea.sources[0];
  idea.cover_source_text = main ? SOURCE_PREFIX + main.name : "";
}
