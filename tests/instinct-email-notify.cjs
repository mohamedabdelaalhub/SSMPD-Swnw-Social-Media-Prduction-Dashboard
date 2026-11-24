// «مساعد إنستنكت» e-mail notices (owner 2026-11-24): ops/vo-worker/vo.py instinct_notify() sends ONE line per new staff
// question (name — role — Cairo time, nothing else) and acks; drafts are acked without mail; a send failure is acked as failed;
// no secret = no-op. instinct-notify edge function: lease / ack only, clamped arguments, ids must be uuids.
const { spawnSync } = require('child_process'), ts = require('typescript'), fs = require('fs'), assert = require('assert/strict');
const py = String.raw`
import importlib.util, json, sys
spec = importlib.util.spec_from_file_location("vo", "ops/vo-worker/vo.py"); vo = importlib.util.module_from_spec(spec); spec.loader.exec_module(vo)
calls, sent = [], []
vo.log = lambda *a: None
vo.secret = lambda: ""
vo.api = lambda a, p, url=None: calls.append(a)
vo.instinct_notify(send=sent.append); assert calls == [] and sent == [], "no secret: nothing"
vo.secret = lambda: "x" * 40
items = [{"id": "11111111-1111-4111-8111-111111111111", "kind": "new_question", "employee_name": "مازن\nعلي", "role_label": "استقبال، خدمة عملاء",
          "created_at": "2026-11-24T21:05:00+00:00", "item_id": "t1", "link": "https://x/#instinct"},
         {"id": "22222222-2222-4222-8222-222222222222", "kind": "new_draft", "employee_name": "إنستنكت", "role_label": "مساعد إنستنكت", "created_at": "2026-11-24T21:06:00Z"},
         {"id": "33333333-3333-4333-8333-333333333333", "kind": "new_question", "employee_name": "محاسب", "role_label": "محاسب", "created_at": "2026-11-24T21:07:00Z"}]
def api(a, p, url=None):
    calls.append((a, p, url))
    return {"lease_token": "44444444-4444-4444-8444-444444444444", "items": items} if a == "lease" else 1
vo.api = api
def send(m):
    if "محاسب" in m.get_content(): raise OSError("smtp down")
    sent.append(m)
vo.instinct_notify(send=send)
assert len(sent) == 1, sent
m = sent[0]
print(json.dumps({"to": m["To"], "from": m["From"], "subject": m["Subject"], "body": m.get_content(), "calls": [[c[0], c[1], c[2]] for c in calls]}, ensure_ascii=False))
`;
const r = spawnSync('python3', ['-c', py], { encoding: 'utf8' });
assert.equal(r.status, 0, r.stderr);
const o = JSON.parse(r.stdout.trim().split('\n').pop());
assert.equal(o.to, 'ryxq6r@mail.instinct.com'); assert.equal(o.from, 'swnw.voiceover@gmail.com');
assert.equal(o.body.trim(), 'مازن علي — استقبال، خدمة عملاء — 2026-11-24 23:05', 'one line: name — role — Cairo time');
assert.ok(!/#instinct|t1|http/.test(o.body), 'nothing but name, role, time');
assert.deepEqual(o.calls.map(c => c[0]), ['lease', 'ack', 'ack']);
assert.ok(o.calls.every(c => c[2].endsWith('/functions/v1/instinct-notify')));
assert.deepEqual(o.calls[1][1], { lease_token: '44444444-4444-4444-8444-444444444444', ids: ['11111111-1111-4111-8111-111111111111', '22222222-2222-4222-8222-222222222222'], ok: true }, 'sent question + draft acked ok');
assert.equal(o.calls[2][1].ok, false); assert.deepEqual(o.calls[2][1].ids, ['33333333-3333-4333-8333-333333333333']); assert.match(o.calls[2][1].error, /smtp down/);
assert.match(fs.readFileSync('ops/vo-worker/vo.py', 'utf8'), /instinct_notify\(\); pull_db\(\); send_new\(\); poll\(\); report_db\(\)/);
// edge function
const src = fs.readFileSync('supabase/functions/instinct-notify/index.ts', 'utf8');
const ex = {}; new Function('exports', ts.transpileModule(src.slice(src.indexOf('const UUID'), src.indexOf('Deno.serve')).replace(/export function/g, 'exports.rpcArgs = function'), { compilerOptions: { target: 99, module: 1 } }).outputText)(ex);
const a = ex.rpcArgs, T = '44444444-4444-4444-8444-444444444444', I = '11111111-1111-4111-8111-111111111111';
assert.deepEqual(a('lease', {}), { fn: 'instinct_outbox_lease', args: { p_limit: 10, p_lease_seconds: 300 } });
assert.equal(a('lease', { limit: 999 }).args.p_limit, 20);
assert.deepEqual(a('ack', { lease_token: T, ids: [I, 'x', 3], ok: true }), { fn: 'instinct_outbox_ack', args: { p_lease_token: T, p_ids: [I], p_ok: true, p_error: null } });
assert.equal(a('ack', { lease_token: 'nope', ids: [I], ok: true }), null); assert.equal(a('ack', { lease_token: T, ids: [], ok: true }), null);
assert.equal(a('sql', {}), null); assert.equal(a('ack', { lease_token: T, ids: [I] }).args.p_ok, false);
assert.match(src, /X-VO-Worker-Secret/); assert.match(src, /secret\.length < 32/);
console.log('PASS instinct e-mail notices: one line (name — role — Cairo time), drafts skipped, failures acked, edge function lease/ack only');
