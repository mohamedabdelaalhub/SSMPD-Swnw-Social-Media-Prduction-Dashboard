// Saving comments read from Facebook/Instagram without letting one bad row lose a whole batch.
// Before: a single upsert of every comment of every post that changed; if ONE row was rejected by Postgres (for example a comment
// containing a NUL character) the whole batch failed, the post was never marked as read, and every run failed the same way, so all new
// comments of that brand stopped appearing. Now: batch first, then chunks, then single rows (bounded); only the posts that still have
// an unsaved row are left unmarked and retried on the next run.

// Postgres text cannot hold \u0000; Graph occasionally sends it.
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
