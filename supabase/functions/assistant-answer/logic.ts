// Pure helpers of assistant-answer (no Deno, no network) — unit-tested from node (tests/assistant-answer-edge.cjs).
export type Article = { id: string; title: string; tab?: string; terms?: string; meaning?: string; steps?: string[]; reason?: string; links?: string[] };

const DROP_KEY = /(name|phone|mobile|tel|whatsapp|national|address|email)/i;
const PHONE_RUN = /[0-9٠-٩+][0-9٠-٩ -]{6,}[0-9٠-٩]/g;

// patient names / phones never go to the model: name-ish keys dropped, phone-like digit runs masked; file_no kept as is
export function redact(v: unknown, depth = 0): unknown {
  if (depth > 6 || v == null) return v ?? null;
  if (typeof v === "string") return v.replace(PHONE_RUN, "•••").slice(0, 500);
  if (Array.isArray(v)) return v.slice(0, 30).map((x) => redact(x, depth + 1));
  if (typeof v === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, x] of Object.entries(v as Record<string, unknown>).slice(0, 40)) {
      if (k === "file_no") { out[k] = String(x ?? "").slice(0, 40); continue; }
      if (DROP_KEY.test(k)) continue;
      out[k] = redact(x, depth + 1);
    }
    return out;
  }
  return v;
}
export const redactText = (s: string) => String(s || "").replace(PHONE_RUN, "•••").slice(0, 1000);

// Arabic-friendly normalisation for matching (أ/إ/آ → ا, ة → ه, ى → ي, no tashkeel, Arabic digits → Latin)
export function norm(s: string): string {
  return String(s || "").toLowerCase()
    .replace(/[ً-ْـ]/g, "").replace(/[أإآ]/g, "ا").replace(/ة/g, "ه").replace(/ى/g, "ي")
    .replace(/[٠-٩]/g, (d) => String("٠١٢٣٤٥٦٧٨٩".indexOf(d)))
    .replace(/[^\p{L}\p{N}]+/gu, " ").trim();
}
const STOP = new Set(["ازاي", "اعمل", "عايز", "عاوز", "انا", "في", "من", "على", "علي", "ده", "دي", "اللي", "او", "و", "لو", "مش", "ايه", "هو", "هي", "يعني", "بتاع", "بتاعت", "the", "a"]);
export function words(s: string): string[] {
  return norm(s).split(" ").filter((w) => w.length > 1 && !STOP.has(w));
}

// the few articles that best match the question (+ the screen); only these go into the user turn
export function pick(articles: Article[], question: string, screen: string, n = 4): Article[] {
  const q = words(question), sc = norm(screen);
  if (!q.length) return [];
  const scored = articles.map((a) => {
    const title = norm(a.title), terms = norm(a.terms || ""), meaning = norm(a.meaning || ""), steps = norm((a.steps || []).join(" "));
    let s = 0;
    for (const w of q) {
      if (title.includes(w)) s += 3;
      if (terms.includes(w)) s += 2;
      if (meaning.includes(w)) s += 1;
      if (steps.includes(w)) s += 0.5;
    }
    if (sc && (title.includes(sc) || (a.tab && sc.includes(norm(a.tab))))) s += 2;
    return { a, s };
  }).filter((x) => x.s >= 2).sort((x, y) => y.s - x.s || x.a.id.localeCompare(y.a.id));
  return scored.slice(0, n).map((x) => x.a);
}

// stable (cached) system prompt: rules + a compact index of every article (sorted, so the bytes never change between calls)
export function systemPrompt(articles: Article[]): string {
  const index = [...articles].sort((x, y) => x.id.localeCompare(y.id)).map((a) => `${a.id} | ${a.title} | ${a.tab || ""}`).join("\n");
  return [
    "You are «المساعد», the help assistant inside the Swnw clinic dashboard. Staff ask «أعمل إزاي…» questions.",
    "Answer ONLY from the dashboard help articles given in the user turn (and this index). Never invent buttons, screens, prices or rules.",
    "Write the steps in short Egyptian Arabic, one action per step, quoting button names exactly as «…». English digits 0-9 only.",
    "You EXPLAIN only: you never change data, never move money, never promise an edit. If the question needs a change by the management",
    "(a bug, wrong data, a missing button, a permission), set suggest_request=true and say in note that a request can be opened.",
    "If no article answers it, return no steps, help_article_id \"\" and suggest_request=true.",
    "Patient names and phones are hidden on purpose; never ask for them. Respect the user's role: if the article says the role cannot do it, say so.",
    "help_article_id must be the id of the article you used (from the index), or \"\".",
    "",
    "Help article index (id | title | tab):",
    index,
  ].join("\n");
}

export const ANSWER_SCHEMA = {
  type: "object", additionalProperties: false,
  required: ["steps", "help_article_id", "suggest_request", "note"],
  properties: {
    steps: { type: "array", items: { type: "string" } },
    help_article_id: { type: "string" },
    suggest_request: { type: "boolean" },
    note: { type: "string" },
  },
} as const;

export type Answer = { steps: string[]; help_article_id: string; suggest_request: boolean; note: string };

// what the screen gets back: only known article ids, a tab to open (the UI checks the role), trimmed steps
export function shape(a: Answer, articles: Article[]) {
  const art = articles.find((x) => x.id === a.help_article_id) || null;
  const steps = (Array.isArray(a.steps) ? a.steps : []).map((s) => String(s).slice(0, 300)).filter(Boolean).slice(0, 8);
  return {
    ok: true as const,
    steps,
    help_article_id: art ? art.id : null,
    help_title: art ? art.title : null,
    open: art && art.tab ? { tab: art.tab } : null,
    suggest_request: !!a.suggest_request || (!art && !steps.length),
    note: a.note ? String(a.note).slice(0, 400) : null,
  };
}

export function parseHelpData(js: string): Article[] {
  const i = js.indexOf("{", js.indexOf("SSMPDHelpData"));
  const j = js.lastIndexOf("}");
  if (i < 0 || j < i) return [];
  const d = JSON.parse(js.slice(i, j + 1));
  return (d.articles || []).filter((a: Article) => a && a.id && a.title);
}

export const MESSAGES = {
  cap: "المساعد واقف النهارده — ابعت طلب للإدارة لو الحاجة مستعجلة.",
  off: "المساعد متوقف دلوقتي — ابعت طلب للإدارة لو الحاجة مستعجلة.",
  error: "المساعد مش قادر يرد دلوقتي — جرّب تاني كمان شوية أو افتح طلب.",
};
