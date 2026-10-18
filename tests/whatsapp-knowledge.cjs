const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');

function load(files, extra = {}) {
  const context = vm.createContext({ console, Response, Request, URL, AbortSignal, TextEncoder,
    crypto: globalThis.crypto, ...extra });
  for (const file of files) {
    const source = fs.readFileSync('supabase/functions/' + file, 'utf8')
      .replace(/^import .*;\n/gm, '').replace(/^export /gm, '');
    const result = ts.transpileModule(source, { compilerOptions: {
      target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None, ignoreDeprecations: "6.0",
    }, reportDiagnostics: true });
    assert.equal(result.diagnostics.filter(d => d.category === ts.DiagnosticCategory.Error).length, 0);
    vm.runInContext(result.outputText, context, { filename: file });
    const names = [...fs.readFileSync('supabase/functions/' + file, 'utf8').matchAll(/export (?:async )?(?:function|const) (\w+)/g)].map(m => m[1]);
    if (names.length) vm.runInContext('Object.assign(globalThis, {' + names.join(',') + '})', context);
  }
  return context;
}
const site = { content: {
  doctor: [
    { title: 'د. دينا حسني', metadata: { department: 'عيادة المخ والأعصاب', rank: 'استشاري', private_note: 'NOT_FOR_CUSTOMERS' }, summary: 'DO_NOT_EXPORT', imagePath: 'NO_IMAGE' },
    { title: 'د/احمد الرشيدي', metadata: { department: 'أسنان', rank: 'أخصائي' } },
  ], specialty: [], service: [],
} };
const parse = load(['meta-comments/clinic-facts.ts']);
const facts = parse.websiteClinicFacts(site);
assert.match(facts, /د\. دينا حسني — عيادة المخ والأعصاب — استشاري/);
assert.match(facts, /التخصصات: عيادة المخ والأعصاب؛ أسنان/);
assert.doesNotMatch(facts, /NOT_FOR_CUSTOMERS|DO_NOT_EXPORT|NO_IMAGE/);
assert.throws(() => parse.websiteClinicFacts({ content: { doctor: [], specialty: [], service: [] } }), /EMPTY/);
assert.throws(() => parse.websiteClinicFacts({ error: 'not found' }), /INVALID/);
assert.throws(() => parse.websiteClinicFacts({ content: { doctor: Array.from({ length: 400 }, () => ({ title: 'س'.repeat(400) })) } }), /TOO_LARGE/);
const legacy = parse.websiteClinicFacts({ content: { doctor: [{ name: 'Doctor', fields: { specialty: 'ENT', degree: 'Consultant' } }], specialty: [{ title: 'ENT' }], service: [{ name: 'Hearing' }] } });
assert.match(legacy, /Doctor — ENT — Consultant/);
assert.match(legacy, /الخدمات: Hearing/);

(async () => {
  let now = 100000, calls = 0, fail = false;
  const fakeDate = class extends Date { static now() { return now; } };
  const cache = load(['meta-comments/clinic-facts.ts'], { Date: fakeDate, console: { warn() {} } });
  const get = cache.factCache(async () => { calls++; if (fail) throw Error('offline'); return 'complete facts'; }, 300000);
  assert.deepEqual(await Promise.all([get(), get(), get()]), ['complete facts', 'complete facts', 'complete facts']);
  assert.equal(calls, 1, 'parallel reads share one request');
  now += 299999; await get(); assert.equal(calls, 1);
  now += 2; fail = true; assert.equal(await get(), 'complete facts');
  assert.equal(calls, 2); await get(); assert.equal(calls, 2, 'failed source is not retried on every message');
  now += 3600000; assert.equal(await get(), '', 'stale knowledge eventually expires');
  now += 30001; fail = false; assert.equal(await get(), 'complete facts');

  let promptRequests = [], websiteReads = 0;
  const ai = load(['meta-comments/clinic-facts.ts', 'whatsapp-webhook/reply-rules.ts', 'meta-comments/ai.ts'], {
    Deno: { env: { get: () => 'test-key-not-a-real-secret' } },
    fetch: async (url, options) => {
      if (url.includes('published.json')) { websiteReads++; return Response.json(site); }
      assert.equal(url, 'https://api.openai.com/v1/responses');
      promptRequests.push(JSON.parse(options.body));
      return Response.json({ output_text: JSON.stringify({ category: 'general', reply: 'رد تجريبي', specialty: '' }) });
    },
  });
  const clinic = await ai.clinicInfo(); await ai.clinicInfo(); assert.equal(websiteReads, 1);
  await ai.decideReply({ brand: 'sono', channel: 'whatsapp', text: 'عندكو مخ وأعصاب', clinicInfo: clinic, history: ['العميل: دينا حسني'] });
  const wa = promptRequests.at(-1), payload = JSON.parse(wa.input);
  assert.equal(payload.clinic_info, facts); assert.deepEqual(payload.earlier_messages, ['العميل: دينا حسني']);
  assert.match(wa.instructions, /عدم ذكر خدمة أو تخصص مش دليل إنه غير موجود/);
  assert.match(wa.instructions, /أرسل رابط «لوكيشن الخريطة» الموجود نفسه/);
  assert.match(wa.instructions, /لا تؤكد حجزًا أو تحويلًا/);
  await ai.decideReply({ brand: 'sono', channel: 'comment', text: 'عنوانكم', clinicInfo: clinic });
  assert.match(promptRequests.at(-1).instructions, /ممنوع أي سعر أو تكلفة أو عرض/);
  assert.notEqual(promptRequests.at(-1).instructions, wa.instructions, 'social comment rules remain separate');

  // Real clinic-knowledge handler with fake database: output must retain late sections and fail on query errors.
  let handler, broken = false, selects = [];
  const tableRows = {
    clinic_profile: { address: 'عنوان الاختبار', maps_url: 'https://maps.app.goo.gl/example', agent_notes: 'تعليمات الإدارة', updated_at: '2026-10-18' },
    clinic_hours: [{ department: 'المركز', days: ['sat'], open_time: '12:00:00', close_time: '00:00:00' }],
    clinic_offers: [], clinic_faqs: [{ question: 'سؤال', answer: 'ج'.repeat(6500) }],
    contracting_entities: [], contracting_entity_contracts: [],
  };
  const knowledge = load(['clinic-knowledge/index.ts'], {
    Deno: { env: { get: k => k === 'WHATSAPP_ALERT_SECRET' ? 'test-secret' : k === 'SUPABASE_SERVICE_ROLE_KEY' ? 'test-service' : k === 'SUPABASE_URL' ? 'https://example.supabase.co' : undefined }, serve: fn => handler = fn },
    createClient: () => ({ from: table => {
      const q = { select: fields => { selects.push({ table, fields }); return q; }, eq: () => q, order: () => q,
        maybeSingle: () => q, then: (resolve, reject) => Promise.resolve({ data: tableRows[table], error: broken && table === 'clinic_faqs' ? { message: 'db down' } : null }).then(resolve, reject) };
      return q;
    } }),
  });
  const request = secret => new Request('https://example/clinic-knowledge', { method: 'POST', headers: { 'X-WhatsApp-Alert-Secret': secret } });
  assert.equal((await handler(request('wrong'))).status, 401);
  let result = await handler(request('test-secret')); assert.equal(result.status, 200);
  const data = await result.json(); assert.match(data.text, /تعليمات الإدارة$/); assert(data.text.length > 6500);
  assert(selects.every(s => !s.fields.includes('*')), 'no full-row reads for knowledge');
  broken = true; result = await handler(request('test-secret')); assert.equal(result.status, 503);

  let queryFilters = [], decisionInput, sends = 0, knowledgeCalls = 0, serve;
  const webhook = load(['meta-comments/clinic-facts.ts', 'whatsapp-webhook/index.ts'], {
    Deno: { env: { get: k => ({ WHATSAPP_AUTOREPLY: 'on', WHATSAPP_ALLOWED_NUMBERS: '201000000001', WHATSAPP_ALERT_SECRET: 'test-secret', SUPABASE_URL: 'https://test.supabase.co' })[k] }, serve: fn => serve = fn },
    clinicInfo: async () => facts,
    decideReply: async input => { decisionInput = input; return { ok: true, category: 'general', reply: 'رد الاختبار' }; },
    fetch: async (url, options) => {
      if (url.endsWith('/clinic-knowledge')) { knowledgeCalls++; return Response.json({ ok: true, text: data.text }); }
      if (JSON.parse(options.body).type === 'text') sends++;
      return Response.json({ messages: [{ id: 'sent-test' }] });
    },
  });
  const db = { from: () => {
    let op = '';
    const q = { upsert: () => { op = 'upsert'; return q; }, select: () => q, update: () => { op = 'update'; return q; },
      eq: (key, value) => { queryFilters.push([key, value]); return q; }, neq: () => q, order: () => q,
      limit: n => { assert.equal(n, 6, 'no increase in history query size'); return q; },
      then: (resolve, reject) => Promise.resolve({ data: op === 'upsert' ? [{ id: 'test' }] : op === 'update' ? null : [
        { message: 'سؤال جديد', reply_text: 'UNSENT_REPLY', status: 'failed' },
        { message: 'دينا حسني', reply_text: 'REPLY_THAT_WAS_SENT', status: 'replied' },
      ] }).then(resolve, reject) };
    return q;
  } };
  const event = { metadata: { phone_number_id: 'test-number' }, messages: [{ from: '201000000001', id: 'inbound-test', type: 'text', text: { body: 'نكمل' } }] };
  await webhook.handle(db, event);
  assert.match(decisionInput.clinicInfo, /تعليمات الإدارة/);
  assert.match(decisionInput.clinicInfo, /أسنان/);
  assert(decisionInput.clinicInfo.length > 6500, 'dashboard facts are not sliced at 6000');
  assert(!decisionInput.history.join('\n').includes('UNSENT_REPLY'));
  assert(decisionInput.history.join('\n').includes('REPLY_THAT_WAS_SENT'));
  assert(queryFilters.some(([k, v]) => k === 'brand' && v === 'sono'));
  assert(queryFilters.some(([k, v]) => k === 'platform' && v === 'whatsapp'));
  await webhook.handle(db, event); assert.equal(knowledgeCalls, 1, 'existing five minute knowledge cache retained');
  assert.equal(sends, 2);
  const count = sends;
  await webhook.handle(db, { ...event, messages: [{ ...event.messages[0], from: '201000000099' }] });
  assert.equal(sends, count, 'test allowlist still blocks other senders');
  console.log('PASS WhatsApp knowledge: website metadata, specialties, whitelisted fields, legacy format, unavailable/oversized sources, concurrent and bounded caches, channel isolation, authenticated clinic facts, DB failures, unsliced facts, sent-only history and test containment. Mocked DB/LLM/Meta; no live sends.');
})().catch(error => { console.error(error); process.exitCode = 1; });
