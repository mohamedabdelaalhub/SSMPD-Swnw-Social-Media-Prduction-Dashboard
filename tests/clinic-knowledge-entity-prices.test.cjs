// clinic-knowledge edge function: per-entity prices + offer price lists from clinic_knowledge_feed (mig 20261127030000),
// and the unchanged one-line fallback when the RPC is missing. Runs the real index.ts with Deno/Supabase mocked.
const fs = require('fs'), assert = require('assert'), mod = require('module');
const src = fs.readFileSync('supabase/functions/clinic-knowledge/index.ts', 'utf8').replace(/^import .*$/gm, '');
const js = mod.stripTypeScriptTypes(src);
async function run(feed) {
  let handler = null;
  const Deno = { env: { get: (k) => ({ WHATSAPP_ALERT_SECRET: 's3cret', SUPABASE_SERVICE_ROLE_KEY: 'k', SUPABASE_URL: 'http://x' })[k] }, serve: (h) => { handler = h; } };
  const data = {
    clinic_profile: { data: { address: 'العنوان' }, error: null }, clinic_hours: { data: [], error: null }, clinic_offers: { data: [], error: null },
    clinic_faqs: { data: [], error: null },
    contracting_entities: { data: [{ id: 'e1', name: 'دار الارقم' }, { id: 'e2', name: 'نقابة المهندسين' }], error: null },
    contracting_entity_contracts: { data: [{ entity_id: 'e1', status: 'active', discount_percent: 40, services: 'جميع خدمات' },
                                           { entity_id: 'e2', status: 'active', discount_percent: 0, services: 'الكشف والأشعة' }], error: null } };
  const q = (t) => { const r = Promise.resolve(data[t]); const chain = new Proxy(r, { get: (o, p) => (p === 'then' ? o.then.bind(o) : () => chain) }); return chain; };
  const createClient = () => ({ from: q, rpc: async (n) => { assert.strictEqual(n, 'clinic_knowledge_feed'); return feed; } });
  new Function('Deno', 'createClient', 'Response', js)(Deno, createClient, Response);
  const res = await handler(new Request('http://x', { headers: { 'X-WhatsApp-Alert-Secret': 's3cret' } }));
  return (await res.json()).text;
}
(async () => {
  const fallback = await run({ data: null, error: { message: 'function public.clinic_knowledge_feed() does not exist' } });
  assert(fallback.includes('- دار الارقم — خصم 40% — على: جميع خدمات'), 'fallback percent line unchanged');
  assert(fallback.includes('- نقابة المهندسين — على: الكشف والأشعة'), 'fallback line for entity without percent unchanged');
  assert(!fallback.includes('أسعار خاصة') && !fallback.includes('## العروض الحالية'), 'fallback adds nothing new');
  const fed = await run({ error: null, data: { as_of: '2026-11-27', offers: [{ name: 'عرض وايت فرايداي — ليزر كانديلا', valid_to: '2026-11-30', lines: [{ name: 'ليزر الوش', price: 140 }], more: 19 }],
    entities: [{ entity: 'نقابة المهندسين', services: 'الكشف والأشعة', billing: 'discount', coverage: 0, has_list: true, lines: [{ name: 'كشف باطنة', price: 300 }, { name: 'سونار بطن', price: 250.5 }], more: 3 },
               { entity: 'دار الارقم', discount_percent: 40, services: 'جميع خدمات', billing: 'discount', coverage: 0, has_list: false, lines: [], more: 0 },
               { entity: 'ميد شور', discount_percent: 0, services: null, billing: 'insurer', coverage: 80, has_list: false, lines: [], more: 0 }] } });
  const want = ['## العروض الحالية', '- عرض وايت فرايداي — ليزر كانديلا (لحد 2026-11-30)', '  - ليزر الوش: 140 جنيه', '  - و 19 خدمة تانية في العرض: اسأل الاستقبال عن سعرها',
    '## جهات متعاقدين معاها (تأمين/شركات/نقابات)', '- نقابة المهندسين — أسعار خاصة — على: الكشف والأشعة', '  - كشف باطنة: 300 جنيه', '  - سونار بطن: 250.5 جنيه',
    '  - و 3 خدمة تانية: اسأل الاستقبال عن سعرها', '- دار الارقم — خصم 40% — على: جميع خدمات', '- ميد شور — التأمين بيغطي 80%'];
  for (const w of want) assert(fed.includes(w), 'missing line: ' + w);
  assert(!/[٠-٩]/.test(fed), 'English digits only (rule 8)');
  console.log('PASS clinic-knowledge: per-entity price lines, offer lists, insurer coverage, and the unchanged fallback');
})().catch((e) => { console.error(e); process.exit(1); });
