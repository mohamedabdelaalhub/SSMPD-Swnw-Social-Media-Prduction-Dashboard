// A call that times out EVERY run (observed: sono Instagram conversations, 20 s lost each run) is paused for a while instead of being
// retried each time. State lives in social_settings (key = "cooldown:<name>"), one small row; reading/writing it never breaks a run.
export async function isCoolingDown(db: any, name: string, now: () => number = Date.now): Promise<boolean> {
  try {
    const { data } = await db.from("social_settings").select("value").eq("key", `cooldown:${name}`).maybeSingle();
    const until = Date.parse(String(data?.value?.until || ""));
    return Number.isFinite(until) && until > now();
  } catch { return false; }
}
export async function startCooldown(db: any, name: string, minutes: number, reason: string, now: () => number = Date.now): Promise<void> {
  try {
    await db.from("social_settings").upsert({ key: `cooldown:${name}`, value: { until: new Date(now() + minutes * 60e3).toISOString(), reason: String(reason).slice(0, 160) }, updated_at: new Date(now()).toISOString() }, { onConflict: "key" });
  } catch { /* ignore */ }
}
