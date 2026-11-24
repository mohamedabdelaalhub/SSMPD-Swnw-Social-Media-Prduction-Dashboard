// Customer names for Messenger / Instagram conversations.
// The conversations API often returns a placeholder ("User", "Facebook User", "Instagram User") instead of the profile
// name; the real name is read from the sender's profile (page token, works for people who messaged the page).
export const GENERIC_NAME = /^(user|users|facebook\s+user|instagram\s+user|meta\s+user|unknown|مستخدم(\s+(فيسبوك|انستجرام|إنستجرام))?)$/i;
export function isGenericName(n: unknown): boolean {
  const t = String(n ?? "").replace(/\s+/g, " ").trim();
  return !t || GENERIC_NAME.test(t);
}
// Same shape the dashboard filter uses for old rows (PostgREST `or` filter on social_messages.sender_name).
export const GENERIC_NAME_FILTER = "sender_name.is.null,sender_name.ilike.user,sender_name.ilike.facebook user,sender_name.ilike.instagram user,sender_name.ilike.meta user,sender_name.ilike.unknown,sender_name.ilike.مستخدم*";
export const NAME_TRIED = "عميل"; // marker: the profile could not be read, do not retry in the backfill

type Gget = (path: string, params: Record<string, string>) => Promise<{ ok: boolean; data: any; error?: string }>;

export async function fetchProfileName(gget: Gget, id: string, token: string, platform: "facebook" | "instagram"): Promise<{ name: string | null; error?: string }> {
  const r = await gget(id, { fields: platform === "facebook" ? "name,first_name,last_name" : "name,username", access_token: token });
  if (!r.ok) return { name: null, error: r.error };
  const d = r.data || {};
  const full = d.name || [d.first_name, d.last_name].filter(Boolean).join(" ") || d.username || null;
  return { name: full && !isGenericName(full) ? String(full).trim() : null };
}

export function makeNameResolver(gget: Gget, token: string, report: any, label: string) {
  const cache = new Map<string, string | null>();
  return async function resolve(id: string | null | undefined, platform: "facebook" | "instagram"): Promise<string | null> {
    if (!id) return null;
    const key = `${platform}:${id}`;
    if (cache.has(key)) return cache.get(key)!;
    const r = await fetchProfileName(gget, id, token, platform);
    if (r.error) report.nameErrors = (report.nameErrors || 0) + 1;
    if (r.error && !report.nameErrorSample) report.nameErrorSample = `${label}: ${String(r.error).slice(0, 160)}`;
    cache.set(key, r.name);
    return r.name;
  };
}

// Rows already stored with a placeholder: resolve a few senders per run, newest first. A sender whose profile cannot
// be read is marked NAME_TRIED so the backfill does not retry it every five minutes.
export async function backfillSenderNames(db: any, brand: string, resolve: (id: string, p: "facebook" | "instagram") => Promise<string | null>, limit = 15) {
  const { data } = await db.from("social_messages").select("sender_id,platform,sent_at").eq("brand", brand).eq("is_page", false)
    .not("sender_id", "is", null).or(GENERIC_NAME_FILTER).order("sent_at", { ascending: false }).limit(200);
  const seen = new Set<string>(); let done = 0, named = 0;
  for (const row of data || []) {
    const key = `${row.platform}:${row.sender_id}`;
    if (seen.has(key)) continue; seen.add(key);
    if (done++ >= limit) break;
    const plat = row.platform === "instagram" ? "instagram" : "facebook";
    const name = await resolve(row.sender_id, plat);
    if (name) named++;
    await db.from("social_messages").update({ sender_name: name || NAME_TRIED }).eq("brand", brand).eq("platform", row.platform).eq("sender_id", row.sender_id).eq("is_page", false).or(GENERIC_NAME_FILTER);
  }
  return { checked: done, named };
}
