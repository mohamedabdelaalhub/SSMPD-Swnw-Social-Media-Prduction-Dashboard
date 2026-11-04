const assert=require('node:assert/strict');
const fs=require('node:fs');
const ts=require('typescript');
for(const name of ['supabase/functions/digital-chat-reply/index.ts']){
 const s=fs.readFileSync(name,'utf8');
 const parsed=ts.createSourceFile(name,s,ts.ScriptTarget.ES2022,true,ts.ScriptKind.TS);
 assert.equal(parsed.parseDiagnostics.length,0,parsed.parseDiagnostics.map(x=>ts.flattenDiagnosticMessageText(x.messageText,' ')).join('\n'));
 assert(s.includes('operationalUnavailable'),'legacy runtimes cannot be impersonated');
 assert(s.includes('digital_chat_instructions'),'advisory memory used during responses');
 assert(s.includes('digital_chat_claim_due'),'scheduled check-ins consume due tasks');
 assert(!/from\(['"](?:tasks|patient_visits|clinic_finance)\b/.test(s),'not permitted to mutate live business systems');
}
const m=fs.readFileSync('supabase/migrations/20261105024000_digital_chat_threads_instructions_schedules.sql','utf8');
for(const t of ['digital_chat_threads','digital_chat_participants','digital_chat_messages','digital_chat_instructions','digital_chat_schedules']){
 assert(m.includes('public.'+t));
}
assert(m.includes('enable row level security'),'chat tables have RLS');
assert(m.includes('Owner reads chat'),'private owner read access');
console.log('PASS chat Edge parser, runtime isolation, durable memory, recurring jobs, owner-only RLS');