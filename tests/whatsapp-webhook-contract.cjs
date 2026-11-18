// Behavioral transport tests. No real WhatsApp, model, patient lookup or booking writes.
const assert = require('node:assert/strict'), fs = require('node:fs'), vm = require('node:vm'), ts = require('typescript');
const { webcrypto } = require('node:crypto');
const enc = new TextEncoder();
let passed = 0;
async function test(name, run) { await run(); passed++; console.log('PASS ' + name); }

function setup(options = {}) {
  let handler;
  const rows = new Map(), outbound = [], calls = [], background = [];
  const env = { WHATSAPP_VERIFY_TOKEN: 'test-verify', WHATSAPP_APP_SECRET: 'test-signing',
    WHATSAPP_TOKEN: 'test-send', WHATSAPP_ALERT_SECRET: 'test-knowledge',
    WHATSAPP_AUTOREPLY: 'on', WHATSAPP_ALLOWED_NUMBERS: '201000000001',
    WHATSAPP_BRANDS: JSON.stringify({ second: 'dr_dina' }),
    SUPABASE_SERVICE_ROLE_KEY: 'test-service', SUPABASE_URL: 'https://not-real.supabase.test', ...options.env };
  const db = { from: table => {
    calls.push(['table', table]);
    let kind = 'read', row, id;
    const q = {
      select: () => q, eq: (key, val) => { if (key === 'id') id = val; return q; }, neq: () => q,
      order: () => q, limit: () => q,
      upsert: data => { kind = 'insert'; row = data; return q; },
      update: data => { kind = 'update'; row = data; return q; },
      then: (resolve, reject) => Promise.resolve().then(() => {
        if (options.databaseError) return { data: null, error: { message: 'database unavailable' } };
        if (kind === 'insert') { if (rows.has(row.id)) return { data: [], error: null }; rows.set(row.id, row); return { data: [{ id: row.id }], error: null }; }
        if (kind === 'update') { rows.set(id, { ...rows.get(id), ...row }); return { data: null, error: null }; }
        return { data: [], error: null };
      }).then(resolve, reject),
    };
    return q;
  } };
  const context = vm.createContext({ console: { warn() {}, error() {} }, Response, Request, URL, AbortSignal,
    TextEncoder, crypto: webcrypto,
    EdgeRuntime: { waitUntil: promise => background.push(promise) },
    Deno: { env: { get: key => env[key] }, serve: fn => handler = fn },
    createClient: () => db,
    clinicInfo: async () => 'الدكاترة: د. دينا — المخ والأعصاب',
    decideReply: async input => { calls.push(['decision', input]); return options.decision || { ok: true, category: 'general', reply: 'رد تجريبي' }; },
    fetch: async (url, init) => {
      if (url.endsWith('/clinic-knowledge')) return Response.json({ ok: true, text: 'لوكيشن الخريطة: https://maps.app.goo.gl/test' });
      const payload = JSON.parse(init.body); outbound.push(payload);
      if (options.sendError && payload.type === 'text') return Response.json({ error: { message: 'send failed' } }, { status: 400 });
      return Response.json({ messages: [{ id: 'delivered-to-meta-test' }] });
    },
  });
  for (const file of ['meta-comments/clinic-facts.ts', 'whatsapp-webhook/index.ts']) {
    const source = fs.readFileSync('supabase/functions/' + file, 'utf8').replace(/^import .*;\n/gm, '').replace(/^export /gm, '');
    vm.runInContext(ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText, context);
  }
  async function signed(body, mutateSignature = false) {
    const raw = typeof body === 'string' ? body : JSON.stringify(body);
    const key = await webcrypto.subtle.importKey('raw', enc.encode(env.WHATSAPP_APP_SECRET), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
    const signature = Buffer.from(await webcrypto.subtle.sign('HMAC', key, enc.encode(raw))).toString('hex');
    const response = await handler(new Request('https://test/whatsapp-webhook', { method: 'POST', body: raw,
      headers: { 'X-Hub-Signature-256': 'sha256=' + (mutateSignature ? '0'.repeat(64) : signature) } }));
    await Promise.all(background.splice(0));
    return response;
  }
  const event = (message = {}, metadata = {}) => ({ entry: [{ changes: [{ field: 'messages', value: {
    metadata: { phone_number_id: 'first', ...metadata },
    messages: [{ id: 'test-inbound', from: '201000000001', timestamp: '1792333500', type: 'text', text: { body: 'عنوانكم' }, ...message }],
  } }] }] });
  return { env, rows, calls, outbound, signed, event, handler, sent: () => outbound.filter(p => p.type === 'text') };
}

(async () => {
  await test('Meta verification challenge and wrong token', async () => {
    const s = setup(); let r = await s.handler(new Request('https://test/?hub.mode=subscribe&hub.verify_token=test-verify&hub.challenge=challenge-test'));
    assert.equal(r.status, 200); assert.equal(await r.text(), 'challenge-test');
    assert.equal((await s.handler(new Request('https://test/?hub.mode=subscribe&hub.verify_token=wrong'))).status, 403);
  });
  await test('wrong HTTP method', async () => assert.equal((await setup().handler(new Request('https://test/', { method: 'PUT' }))).status, 405));
  await test('unsigned payload cannot write or send', async () => {
    const s = setup(); assert.equal((await s.handler(new Request('https://test/', { method: 'POST', body: '{}' }))).status, 401);
    assert.equal(s.rows.size, 0); assert.equal(s.outbound.length, 0);
  });
  await test('modified HMAC cannot write or send', async () => {
    const s = setup(); assert.equal((await s.signed(s.event(), true)).status, 401); assert.equal(s.rows.size, 0);
  });
  await test('signed malformed JSON', async () => assert.equal((await setup().signed('{bad')).status, 400));
  await test('missing service key', async () => {
    const s = setup({ env: { SUPABASE_SERVICE_ROLE_KEY: '' } }); assert.equal((await s.signed(s.event())).status, 500);
  });
  await test('text lifecycle persists inbound, category and sent reply', async () => {
    const s = setup(); assert.equal((await s.signed(s.event())).status, 200);
    assert.equal(s.rows.get('whatsapp:test-inbound').status, 'replied'); assert.equal(s.sent().length, 1);
  });
  await test('duplicate Meta delivery sends only once', async () => {
    const s = setup(); await s.signed(s.event()); await s.signed(s.event()); assert.equal(s.sent().length, 1);
  });
  await test('kill switch saves without replying', async () => {
    const s = setup({ env: { WHATSAPP_AUTOREPLY: 'off' } }); await s.signed(s.event()); assert.equal(s.rows.size, 1); assert.equal(s.sent().length, 0);
  });
  await test('test allowlist blocks other senders', async () => {
    const s = setup(); await s.signed(s.event({ from: '201000000099' })); assert.equal(s.sent().length, 0);
  });
  await test('interactive list selection reaches the reply engine as text', async () => {
    const s = setup(); await s.signed(s.event({ type: 'interactive', interactive: { list_reply: { id: 'doctor-123', title: 'د. دينا' } } }));
    assert.equal(s.calls.find(c => c[0] === 'decision')[1].text, 'د. دينا');
  });
  await test('interactive button selection reaches the reply engine', async () => {
    const s = setup(); await s.signed(s.event({ type: 'interactive', interactive: { button_reply: { id: 'confirm-123', title: 'تأكيد' } } }));
    assert.equal(s.calls.find(c => c[0] === 'decision')[1].text, 'تأكيد');
  });
  await test('audio gets a text request without calling the model', async () => {
    const s = setup(); await s.signed(s.event({ type: 'audio' })); assert.match(s.sent()[0].text.body, /تكتبلنا/);
    assert.equal(s.calls.filter(c => c[0] === 'decision').length, 0);
  });
  await test('image gets a text request', async () => {
    const s = setup(); await s.signed(s.event({ type: 'image' })); assert.match(s.sent()[0].text.body, /تكتبلنا/);
  });
  await test('spam is recorded as skipped without a reply', async () => {
    const s = setup({ decision: { ok: true, category: 'spam', reply: '' } }); await s.signed(s.event());
    assert.equal(s.rows.get('whatsapp:test-inbound').status, 'skipped'); assert.equal(s.sent().length, 0);
  });
  for (const category of ['complaint', 'emergency']) await test(category + ' creates dashboard alert flag', async () => {
    const s = setup({ decision: { ok: true, category, reply: 'رد اختبار معتمد' } }); await s.signed(s.event());
    assert.equal(s.rows.get('whatsapp:test-inbound').alert, true);
  });
  await test('Graph API refusal is recorded as failed', async () => {
    const s = setup({ sendError: true }); await s.signed(s.event()); const r = s.rows.get('whatsapp:test-inbound');
    assert.equal(r.status, 'failed'); assert.equal(r.last_error, 'send failed');
  });
  await test('second brand mapping reaches the model', async () => {
    const s = setup(); await s.signed(s.event({}, { phone_number_id: 'second' }));
    assert.equal(s.calls.find(c => c[0] === 'decision')[1].brand, 'dr_dina');
  });
  await test('message without id is ignored', async () => {
    const s = setup(); await s.signed(s.event({ id: '' })); assert.equal(s.rows.size, 0); assert.equal(s.sent().length, 0);
  });
  await test('provider exhaustion records failure; no fallback currently exists', async () => {
    const s = setup({ decision: { ok: false, error: 'quota exhausted' } }); await s.signed(s.event());
    assert.equal(s.rows.get('whatsapp:test-inbound').status, 'failed'); assert.equal(s.sent().length, 0);
  });
  await test('booking language cannot cause an actual booking in this handler', async () => {
    const s = setup(); await s.signed(s.event({ text: { body: 'أكد حجز دينا السبت الساعة 8' } }));
    assert(s.calls.filter(c => c[0] === 'table').every(c => c[1] === 'social_messages'));
    assert(s.outbound.every(p => p.type !== 'interactive'));
  });
  console.log(`${passed} transport tests passed. Known missing capabilities are not acceptance passes: outbound lists/buttons, booking state and availability, actual booking creation, and provider fallback.`);
})().catch(error => { console.error(error); process.exitCode = 1; });
