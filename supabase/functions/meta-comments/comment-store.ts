// Saving comments read from Facebook/Instagram without letting one bad row lose a whole batch.
// Before: a single upsert of every comment of every post that changed; if ONE row was rejected by Postgres (for example a comment
// containing a NUL character) the whole batch failed, the post was never marked as read, and every run failed the same way, so all new
// comments of that brand stopped appearing. Now: batch first, then chunks, then single rows (bounded); only the posts that still have
// an unsaved row are left unmarked and retried on the next run.

// Postgres text cannot hold \u0000; Graph occasionally sends it.
import { mapPool } from "./pool.ts";

export const cleanText = (s: unknown): string => String(s ?? "").replace(/\u0000/g, "");

export type SaveResult = { saved: number; failedRefs: Set<string> };

export async function saveCommentRows(db: any, rows: Record<string, unknown>[], report: { errors: string[] }, label: string, maxSingles = 60): Promise<SaveResult> {
  const failedRefs = new Set<string>();
  if (!rows.length) return { saved: 0, failedRefs };
  const up = (part: Record<string, unknown>[]) => db.from("social_comments").upsert(part, { onConflict: "id", ignoreDuplicates: true });
  const all = await up(rows);
  if (!all.error) return { saved: rows.length, failedRefs };
  let saved = 0, singles = 0, firstError = all.error.message as string;
  const sample: string[] = [];
  const fail = (r: Record<string, unknown>, msg: string) => {
    if (r.post_ref) failedRefs.add(String(r.post_ref));
    if (sample.length < 3) sample.push(`${r.id}: ${msg}`.slice(0, 200));
  };
  for (let i = 0; i < rows.length; i += 20) {
    const chunk = rows.slice(i, i + 20);
    const c = await up(chunk);
    if (!c.error) { saved += chunk.length; continue; }
    for (const r of chunk) {
      if (singles >= maxSingles) { fail(r, "not tried (too many failing rows this run)"); continue; }
      singles++;
      const s = await up([r]);
      if (s.error) fail(r, s.error.message); else saved++;
    }
  }
  report.errors.push(`${label} save: batch failed (${String(firstError).slice(0, 120)}); saved ${saved}/${rows.length}; unsaved e.g. ${sample.join(" | ")}`);
  return { saved, failedRefs };
}

// A reply that was claimed ("sending") but never confirmed (crash, timeout) must not stay "sending" forever.
// Not resent automatically: it may already be on Facebook. Marked failed with a clear note so staff check it.
export async function releaseStuckSending(db: any, olderThanMinutes = 15): Promise<void> {
  const cutoff = new Date(Date.now() - olderThanMinutes * 60e3).toISOString();
  await db.from("social_comments").update({ status: "failed", last_error: "الرد ما اتأكدش — راجعه على فيسبوك قبل ما تبعته تاني", updated_at: new Date().toISOString() })
    .eq("status", "sending").lt("updated_at", cutoff);
}

// Sends the replies staff (or the autopilot) approved. Claimed row by row right before the POST, up to `concurrency` at a time, and no new
// row is claimed after `budgetMs`: the rest stays "approved" for the next run. Before this a run posted them one after another, 8 replies took
// 64 s, and that single stage used up the whole minute the edge runtime allows (no comment sync happened).
export async function sendApprovedComments(db: any, report: { errors: string[]; sent: number },
  deps: { pageToken: (brand: string) => string | null; gpost: (path: string, params: Record<string, string>) => Promise<{ ok: boolean; data: any; error?: string }>; withContact: (t: string) => string },
  opts: { onlyId?: string; budgetMs?: number; concurrency?: number; now?: () => number } = {}): Promise<void> {
  const now = opts.now ?? Date.now, started = now(), budgetMs = opts.budgetMs ?? 20000;
  let q = db.from("social_comments").select("*").eq("status", "approved").limit(20);
  if (opts.onlyId) q = q.eq("id", opts.onlyId);
  const { data } = await q;
  await mapPool((data || []) as any[], opts.concurrency ?? 4, async (c: any) => {
    if (!opts.onlyId && now() - started > budgetMs) return; // not claimed: stays approved, sent by the next run
    // Claim the row so two runs never send the same reply twice.
    const claim = await db.from("social_comments").update({ status: "sending", updated_at: new Date(now()).toISOString() })
      .eq("id", c.id).eq("status", "approved").select("id");
    if (!claim.data?.length) return;
    const token = deps.pageToken(c.brand);
    const target = c.parent_comment_id || c.platform_comment_id; // reply in the same thread
    const message = deps.withContact(c.final_reply);
    const r = !token ? { ok: false, error: "no page token", data: {} as any }
      : c.platform === "facebook"
        ? await deps.gpost(`${target}/comments`, { message, access_token: token })
        : await deps.gpost(`${target}/replies`, { message, access_token: token });
    if (r.ok) {
      await db.from("social_comments").update({ status: "replied", final_reply: message, reply_platform_id: r.data.id || null, replied_at: new Date(now()).toISOString(), last_error: null, updated_at: new Date(now()).toISOString() }).eq("id", c.id);
      report.sent++;
    } else {
      await db.from("social_comments").update({ status: "failed", last_error: String(r.error || "send failed").slice(0, 300), updated_at: new Date(now()).toISOString() }).eq("id", c.id);
      report.errors.push(`send ${c.id}: ${r.error}`);
    }
  });
}
