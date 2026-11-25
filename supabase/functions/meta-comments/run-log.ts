// Leaves a small trace of the last sync run in social_settings (key «comments_last_run»), written after every stage and, inside a stage,
// at every `step`, so a run that is cut off (timeout, CPU/memory limit, restart) still shows how far it got, how long each stage took and
// the memory in use. No tokens, no message text, errors clipped.
export function createRunLog(db: any, now: () => number = Date.now) {
  const startedAt = now(), timings: Record<string, number> = {};
  let current = "", last: Record<string, unknown> = {};
  const mem = (): number | undefined => { try { return Math.round((globalThis as any).Deno?.memoryUsage?.().rss / 1048576) || undefined; } catch { return undefined; } };
  const put = async (value: Record<string, unknown>) => {
    last = value;
    try { await db.from("social_settings").upsert({ key: "comments_last_run", value, updated_at: new Date(now()).toISOString() }, { onConflict: "key" }); }
    catch { /* tracing must never break the run */ }
  };
  const write = (phase: string, report: any) => put({
    started_at: new Date(startedAt).toISOString(), at: new Date(now()).toISOString(), elapsed_ms: now() - startedAt, stage: current, phase,
    timings_ms: timings, seen: report?.seen ?? 0, sent: report?.sent ?? 0, checked: report?.checked ?? 0, mem_mb: mem(),
    errors: (report?.errors || []).slice(0, 20).map((e: unknown) => String(e).slice(0, 240))
  });
  return {
    // Sub-step marker inside a stage (e.g. syncBrand): shows the last step reached, its time and the memory, even when the run is killed.
    async step(label: string): Promise<void> {
      await put({ ...last, step: label, step_at: new Date(now()).toISOString(), step_elapsed_ms: now() - startedAt, mem_mb: mem() });
    },
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
