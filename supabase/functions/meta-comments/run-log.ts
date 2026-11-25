// Leaves a small trace of the last sync run in social_settings (key «comments_last_run»), written after every stage, so a run that is
// cut off (timeout, restart) still shows how far it got and how long each stage took. No tokens, no message text, errors clipped.
export function createRunLog(db: any, now: () => number = Date.now) {
  const startedAt = now(), timings: Record<string, number> = {};
  let current = "";
  const write = async (phase: string, report: any) => {
    try {
      await db.from("social_settings").upsert({
        key: "comments_last_run",
        value: { started_at: new Date(startedAt).toISOString(), at: new Date(now()).toISOString(), elapsed_ms: now() - startedAt, stage: current, phase,
          timings_ms: timings, seen: report?.seen ?? 0, sent: report?.sent ?? 0, checked: report?.checked ?? 0, errors: (report?.errors || []).slice(0, 20).map((e: unknown) => String(e).slice(0, 240)) },
        updated_at: new Date(now()).toISOString()
      }, { onConflict: "key" });
    } catch { /* tracing must never break the run */ }
  };
  return {
    async run<T>(name: string, report: any, fn: () => Promise<T>): Promise<void> {
      current = name; const t0 = now();
      await write("start", report);
      try { await fn(); }
      catch (e) { report.errors.push(`${name} threw: ${String((e as any)?.message || e).slice(0, 200)}`); }
      timings[name] = now() - t0;
      await write("done", report);
    }
  };
}
