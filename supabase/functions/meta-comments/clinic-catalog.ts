// Clinic catalog for comment/message replies: active specialties + doctors from the owner's
// "SWNW Booking Master - LIVE" sheet (Specialties + Doctors tabs, active rows only; names only — no
// prices or phone numbers). Snapshot 2026-11-07. Update this list when the sheet changes.
// Center hours come from the dashboard tab «تحديث بيانات الشات بوت» (clinic_hours / clinic_profile).
export const CATALOG: { name: string; doctors: string[] }[] = [
  { name: "الباطنة", doctors: ["د. احمد علي", "د. امل علي", "د. احمد السيد عباده", "د. عمر خالد"] },
  { name: "العظام", doctors: ["د. احمد مصطفي", "د. ايمن عبد الله", "د. بلال الصفتي", "د. احمد متولي"] },
  { name: "الجراحة", doctors: ["د. شريف ابراهيم", "د. احمد الخولي"] },
  { name: "الجلدية والتجميل", doctors: ["د. احمد سمير", "د. امنيه السيد"] },
  { name: "الأنف والأذن", doctors: ["د. محمد قدري"] },
  { name: "النساء والتوليد", doctors: ["د. ايه مفتاح", "د. محمد فتحي", "د. احمد حمزه"] },
  { name: "النفسية والتخاطب", doctors: ["د. مريم القس", "د. مي اللبودي", "د. لينا الحسني"] },
  { name: "أطفال", doctors: ["د. الهام قدري"] },
  { name: "علاج طبيعي وتغذية", doctors: ["د. سما نبيل", "د. يحيي ذكريا", "د. وفاء مصطفي"] },
  { name: "القلب والصدر", doctors: ["د. احمد عادل", "د. حسن محمد عبد العزيز"] },
  { name: "الأورام", doctors: ["د. هاني شاكر", "د. محمد ابوطالب"] },
  { name: "الأوعية الدموية", doctors: ["د. احمد عبدالله فودة"] },
  { name: "الأسنان", doctors: ["د. غاده علي قدري", "د. معتز الهجين", "د. عبد الرحمن الطوخي", "د. هاجر"] },
  { name: "مسالك بولية", doctors: ["د. مصطفي محمد"] },
  { name: "المخ والأعصاب", doctors: ["د. دينا حسني"] },
  { name: "جراحة المخ والأعصاب", doctors: ["د. احمد عبد العزيز"] },
  { name: "جراحة التجميل", doctors: ["د. ابانوب مجدي"] },
];

export const CENTER_FACTS = [
  "مواعيد المركز: كل أيام الأسبوع من 12 الضهر لحد 12 بالليل (مواعيد كل دكتور بتختلف حسب جدوله، والاستقبال بيأكدها).",
  "الخدمات المنزلية متاحة على مدار الساعة.",
  "العنوان: الجيزة، حدائق الأهرام، 45ع شارع الخزان، قدام خزان المياه.",
  "الحجز بالتليفون أو الواتساب، والاستقبال بيأكد الميعاد. ممكن حجز أكتر من فرد من العيلة في نفس اليوم حسب المواعيد المتاحة."
];

export function catalogText(): string {
  return [
    "## تخصصات وعيادات مركز سونو (القائمة الرسمية من شيت الحجز)",
    "التخصصات المتاحة: " + CATALOG.map((c) => c.name).join("، "),
    "الدكاترة حسب التخصص:",
    ...CATALOG.map((c) => `- ${c.name}: ${c.doctors.join("، ")}`),
    "## معلومات المركز",
    ...CENTER_FACTS.map((f) => "- " + f)
  ].join("\n");
}

const norm = (s: string) => String(s || "").replace(/[إأآ]/g, "ا").replace(/ة/g, "ه").replace(/ى/g, "ي")
  .replace(/^(عياده|عيادة|قسم|تخصص)\s+/, "").replace(/(^|\s)ال/g, "$1").replace(/\s+/g, " ").trim();
// Match what the model named ("الأطفال", "عيادة الأسنان", "القلب") to an official specialty name.
export function findSpecialty(name: string): string {
  const n = norm(name);
  if (!n) return "";
  let best = "", bestScore = 0;
  for (const c of CATALOG) {
    const cn = norm(c.name);
    if (cn === n) return c.name;
    const parts = cn.split(/\s+/).map((p) => p.replace(/^و/, "")).filter((p) => p.length > 2);
    const hits = parts.filter((p) => n.includes(p)).length;
    // Prefer the name that covers most of what was said, then the more specific (longer) name.
    const score = cn.includes(n) ? 100 : hits ? hits * 10 - Math.abs(parts.length - hits) : 0;
    if (score > bestScore) { bestScore = score; best = c.name; }
  }
  return best;
}
