import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.57.4';
import { fieldsFrom, checkedReview, instructions, schema } from './review.ts';
const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, apikey, content-type, x-client-info', 'Access-Control-Allow-Methods': 'POST, OPTIONS', 'Cache-Control': 'no-store' };
// A small per-isolate burst guard, in addition to one explicit review per save in the UI.
const calls = new Map<string, number>();
Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method !== 'POST') return Response.json({ error: 'POST only' }, { status: 405, headers: cors });
  try {
    const token = req.headers.get('Authorization') || '';
    if (!/^Bearer\s+\S+$/i.test(token)) return Response.json({ error: 'سجّل الدخول أولًا.' }, { status: 401, headers: cors });
    const db = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_ANON_KEY')!, { global: { headers: { Authorization: token } } });
    const user = await db.auth.getUser();
    if (user.error || !user.data.user) return Response.json({ error: 'انتهت جلسة الدخول.' }, { status: 401, headers: cors });
    const admin = await db.rpc('my_admin_id');
    if (admin.error || !admin.data) return Response.json({ error: 'هذا الحساب غير مسجل كموظف نشط.' }, { status: 403, headers: cors });
    const raw = await req.text();
    if (raw.length > 35000) throw Error('المحتوى أطول من حد المراجعة.');
    const fields = fieldsFrom(JSON.parse(raw).fields);
    const key = user.data.user.id, now = Date.now();
    if (now - (calls.get(key) || 0) < 4000) return Response.json({ error: 'انتظر لحظات ثم أعد المراجعة.' }, { status: 429, headers: cors });
    if (calls.size > 1000) for (const [id, at] of calls) if (now - at > 60000) calls.delete(id);
    calls.set(key, now);
    const apiKey = Deno.env.get('OPENAI_API_KEY');
    if (!apiKey) throw Error('خدمة المراجعة اللغوية غير مهيأة حاليًا.');
    const response = await fetch('https://api.openai.com/v1/responses', { method: 'POST', signal: AbortSignal.timeout(45000), headers: { Authorization: 'Bearer ' + apiKey, 'Content-Type': 'application/json' }, body: JSON.stringify({
      model: Deno.env.get('CONTENT_AI_MODEL') || 'gpt-4.1-mini', store: false, instructions, input: JSON.stringify({ fields }), max_output_tokens: 10000,
      text: { format: { type: 'json_schema', name: 'swnw_proofreading', strict: true, schema } }
    }) });
    const result = await response.json();
    if (!response.ok || result.status === 'incomplete') throw Error('تعذرت المراجعة اللغوية الآن.');
    const text = result.output_text || (result.output || []).flatMap((x: any) => x.content || []).map((x: any) => x.text || '').join('');
    return Response.json(checkedReview(JSON.parse(text), fields), { headers: cors });
  } catch (_) {
    // Do not return provider errors, input content, credentials or log submitted text.
    return Response.json({ error: 'تعذرت المراجعة اللغوية أو لم تكتمل. يمكنك إعادة المحاولة أو المتابعة بالنص الأصلي.' }, { status: 400, headers: cors });
  }
});
