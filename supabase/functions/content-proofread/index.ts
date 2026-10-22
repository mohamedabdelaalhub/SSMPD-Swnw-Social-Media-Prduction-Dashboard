import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.57.4';
import { fieldsFrom, checkedReview, instructions, schema } from './review.ts';
import { isSchedule, reviewSchedule } from './schedule.ts';
const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, apikey, content-type, x-client-info', 'Access-Control-Allow-Methods': 'POST, OPTIONS', 'Cache-Control': 'no-store' };
// Reject concurrent reviews per user in this isolate, without blocking sequential form reviews.
const calls = new Map<string, number>();
Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method !== 'POST') return Response.json({ error: 'POST only' }, { status: 405, headers: cors });
  let phase='input', providerStatus=0, requestKey='';
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
    const body=JSON.parse(raw),fields = fieldsFrom(body.fields),fieldLabels:Record<string,string>={};
    for(const key of Object.keys(fields))if(typeof body.field_labels?.[key]==='string')fieldLabels[key]=body.field_labels[key].slice(0,120);
    const key = user.data.user.id, now = Date.now();
    if (calls.has(key)) return Response.json({ error: 'المراجعة السابقة جارية. انتظر اكتمالها.' }, { status: 429, headers: cors });
    if (calls.size > 1000) for (const [id, at] of calls) if (now - at > 60000) calls.delete(id);
    calls.set(key, now);
    requestKey=key;
    const apiKey = Deno.env.get('OPENAI_API_KEY');
    phase='configuration';
    if (!apiKey) throw Error('خدمة المراجعة اللغوية غير مهيأة حاليًا.');
    const signal=AbortSignal.timeout(45000);
    const generate=async(passFields:Record<string,string>,round=0)=>{
    const passSchema=JSON.parse(JSON.stringify(schema));
    passSchema.properties.issues.items.properties.field.enum=Object.keys(passFields);
    for(let attempt=0;attempt<2;attempt++){
    phase='provider';
    const response = await fetch('https://api.openai.com/v1/responses', { method: 'POST', signal, headers: { Authorization: 'Bearer ' + apiKey, 'Content-Type': 'application/json' }, body: JSON.stringify({
      model: Deno.env.get('CONTENT_AI_MODEL') || 'gpt-4.1-mini', store: false, instructions:instructions+(round?'\nهذه جولة تدقيق لاحقة. افحص جميع الأسماء والتخصصات كلمة كلمة بحثًا عن الأخطاء المتبقية بعد التصحيحات السابقة. لا ترجع تصحيحًا إلى تهجئة خاطئة ولا تقترح تغييرات أسلوبية.':'')+(attempt?'\nأعد المراجعة من النص الأصلي. المحاولة السابقة لم تجتز التحقق. استخدم مقتطفات حرفية فريدة غير متداخلة، مع سياق يكفي لتمييز تكرار الكلمات، ولا تغير الأرقام أو الروابط أو فواصل الأسطر. لا ترجع نتيجة جزئية.':''), input: JSON.stringify({ fields:passFields,field_labels:fieldLabels }), max_output_tokens: 10000,
      text: { format: { type: 'json_schema', name: 'swnw_proofreading', strict: true, schema:passSchema } }
    }) });
    const result = await response.json();
    providerStatus=response.status;
    if (!response.ok) throw Error('تعذرت المراجعة اللغوية الآن.');
    phase='validation';
    const text = result.output_text || (result.output || []).flatMap((x: any) => x.content || []).map((x: any) => x.text || '').join('');
    try {if(result.status==='incomplete')throw Error('incomplete');return checkedReview(JSON.parse(text), passFields);}
    catch(error){if(attempt===1)throw error;}
    }
    throw Error('incomplete');
    };
    const reviewed=isSchedule(fields,fieldLabels)?await reviewSchedule(fields,fieldLabels,generate):await generate(fields);
    return Response.json(reviewed,{headers:cors});
  } catch (_) {
    // Only diagnostic categories. Never input content, provider bodies or credentials.
    console.warn(JSON.stringify({event:'proofreading_failed',phase,provider_status:providerStatus}));
    const messages:Record<string,string>={input:'النص أطول من حد المراجعة أو غير صالح. راجع طول الحقول.',configuration:'خدمة المراجعة غير مهيأة حاليًا.',provider:'تعذر الاتصال بخدمة التصحيح الآن. أعد المحاولة بعد قليل.',validation:'لم تكتمل مطابقة التصحيحات بالنص بعد إعادة المراجعة. أعد المحاولة أو أكمل بالنص الأصلي.'};
    return Response.json({ error: messages[phase], code:'proofreading_'+phase }, { status: 400, headers: cors });
  } finally {
    if(requestKey)calls.delete(requestKey);
  }
});
