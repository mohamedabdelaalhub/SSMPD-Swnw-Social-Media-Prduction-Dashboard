// «نفّذ الآن» — يشغّل مهمة Claude Creative (طابور التصميم) فورًا بدل انتظار ميعادها المجدول.
// بيتنادى من الداشبورد بعد تسجيل طلب في claude_design_requests. لا يكتب أي حاجة في القاعدة.
// الأسرار المطلوبة (Supabase → Edge Functions → Secrets):
//   CLAUDE_DESIGN_QUEUE_FIRE_URL   = رابط الـ API trigger بتاع المهمة (https://api.anthropic.com/v1/claude_code/routines/trig_…/fire)
//   CLAUDE_DESIGN_QUEUE_FIRE_TOKEN = التوكن اللي بيتولّد مرة واحدة من صفحة المهمة (sk-ant-oat01-…)
// لو الأسرار مش موجودة بيرجّع not_configured والطلب يفضل في الطابور للميعاد المجدول.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.57.4';
const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, apikey, content-type, x-client-info', 'Access-Control-Allow-Methods': 'POST, OPTIONS', 'Cache-Control': 'no-store' };
const reply = (body: unknown, status = 200) => Response.json(body, { status, headers: cors });
// تشغيلة واحدة بتاخد كل الطلبات المعلّقة، فمفيش داعي لأكتر من تشغيلة كل دقيقتين.
let lastFiredAt = 0;
Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method !== 'POST') return reply({ ok: false, reason: 'post_only' }, 405);
  try {
    const token = req.headers.get('Authorization') || '';
    if (!/^Bearer\s+\S+$/i.test(token)) return reply({ ok: false, reason: 'unauthenticated' }, 401);
    const db = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_ANON_KEY')!, { global: { headers: { Authorization: token } } });
    const user = await db.auth.getUser();
    if (user.error || !user.data.user) return reply({ ok: false, reason: 'unauthenticated' }, 401);
    const admin = await db.rpc('my_admin_id');
    if (admin.error || !admin.data) return reply({ ok: false, reason: 'forbidden' }, 403);
    const pending = await db.from('claude_design_requests').select('id', { count: 'exact', head: true }).eq('status', 'pending');
    if (pending.error) return reply({ ok: false, reason: 'lookup_failed' }, 500);
    if (!pending.count) return reply({ ok: false, reason: 'no_pending' });
    const url = Deno.env.get('CLAUDE_DESIGN_QUEUE_FIRE_URL') || '', secret = Deno.env.get('CLAUDE_DESIGN_QUEUE_FIRE_TOKEN') || '';
    if (!/^https:\/\/api\.anthropic\.com\/v1\/claude_code\/routines\/[A-Za-z0-9_]+\/fire$/.test(url) || !secret) return reply({ ok: false, reason: 'not_configured' });
    const now = Date.now();
    if (now - lastFiredAt < 120000) return reply({ ok: true, started: false, reason: 'already_started' });
    lastFiredAt = now;
    const fired = await fetch(url, {
      method: 'POST', signal: AbortSignal.timeout(20000),
      headers: { Authorization: 'Bearer ' + secret, 'anthropic-beta': 'experimental-cc-routine-2026-04-01', 'anthropic-version': '2023-06-01', 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: 'تشغيل فوري من زرار الداشبورد: فيه طلب تصميم جديد في الطابور.' }),
    });
    if (!fired.ok) { lastFiredAt = 0; console.error('claude-run-now fire failed', fired.status); return reply({ ok: false, reason: 'fire_failed', status: fired.status }); }
    return reply({ ok: true, started: true });
  } catch (e) {
    console.error('claude-run-now', e instanceof Error ? e.message : 'error');
    return reply({ ok: false, reason: 'error' }, 500);
  }
});
