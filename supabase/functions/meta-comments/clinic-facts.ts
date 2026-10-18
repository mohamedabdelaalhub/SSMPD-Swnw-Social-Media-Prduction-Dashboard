// Only published, customer-facing fields. Website rows use metadata.department/rank.
type Row = Record<string, any>;
function field(value: unknown): string {
  return typeof value === "string" ? value.trim().replace(/[\r\n]+/g, " ").slice(0, 400) : "";
}
export function websiteClinicFacts(document: unknown): string {
  const content = (document as Row)?.content;
  if (!content || typeof content !== "object" || Array.isArray(content)) throw new Error("INVALID_CLINIC_CONTENT");
  const rows = (key: string): Row[] => Array.isArray(content[key])
    ? content[key].filter((r: unknown) => r && typeof r === "object" && !Array.isArray(r)) : [];
  const doctors = rows("doctor").map(d => ({
    name: field(d.title) || field(d.name),
    specialty: field(d.specialty) || field(d.fields?.specialty) || field(d.metadata?.department),
    degree: field(d.degree) || field(d.fields?.degree) || field(d.metadata?.rank),
  })).filter(d => d.name);
  const specialties = [...new Set([
    ...rows("specialty").map(s => field(s.title) || field(s.name)),
    ...doctors.map(d => d.specialty),
  ].filter(Boolean))];
  const services = [...new Set(rows("service").map(s => field(s.title) || field(s.name)).filter(Boolean))];
  const lines = [
    "## بيانات الموقع المنشورة (قائمة جزئية، وليست حصرًا لكل خدمات المركز)",
    doctors.length ? "الدكاترة:\n" + doctors.map(d => "- " + [d.name, d.specialty, d.degree].filter(Boolean).join(" — ")).join("\n") : "",
    specialties.length ? "التخصصات: " + specialties.join("؛ ") : "",
    services.length ? "الخدمات: " + services.join("؛ ") : "",
  ].filter(Boolean);
  if (!doctors.length && !specialties.length && !services.length) throw new Error("EMPTY_CLINIC_CONTENT");
  // Fail visibly instead of cutting off doctors or metadata mid-record.
  const text = lines.join("\n");
  if (text.length > 40000) throw new Error("CLINIC_CONTENT_TOO_LARGE");
  return text;
}

// Cache one successful snapshot per warm instance; share concurrent refreshes.
// Errors never replace good facts with an empty response. Stale data expires after one hour.
export function factCache(load: () => Promise<string>, ttlMs: number, maxAgeMs = 60 * 60e3) {
  let cached: { at: number; text: string } | null = null;
  let pending: Promise<string> | null = null;
  let retryAt = 0;
  return async function get(): Promise<string> {
    const now = Date.now();
    const previous = () => cached && Date.now() - cached.at < maxAgeMs ? cached.text : "";
    if (cached && now - cached.at < ttlMs) return cached.text;
    if (pending) return pending;
    if (now < retryAt) return previous();
    pending = (async () => {
      try {
        const text = await load();
        if (!text.trim()) throw new Error("EMPTY_CLINIC_FACTS");
        cached = { at: Date.now(), text };
        retryAt = 0;
        return text;
      } catch {
        retryAt = Date.now() + 30e3;
        console.warn("clinic-facts: source unavailable; using bounded last successful snapshot if present");
        return previous();
      } finally { pending = null; }
    })();
    return pending;
  };
}
