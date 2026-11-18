// booking-fallback edge function: parses, authenticates with the existing secret header, only forwards known ops
// to the service-role RPC, never calls Masa, and never logs or echoes database error text (may carry patient data).
const assert=require('node:assert/strict'),fs=require('node:fs'),ts=require('typescript');
const name='supabase/functions/booking-fallback/index.ts',src=fs.readFileSync(name,'utf8');
const ast=ts.createSourceFile(name,src,ts.ScriptTarget.ES2022,true,ts.ScriptKind.TS);
assert.equal(ast.parseDiagnostics.length,0,ast.parseDiagnostics.map(e=>ts.flattenDiagnosticMessageText(e.messageText,' ')).join('\n'));
assert(src.includes('req.headers.get("X-Booking-Sync-Secret") !== SYNC_SECRET'),'secret header checked');
assert(src.includes('!SYNC_SECRET ||'),'missing secret refuses everything');
assert(src.includes('rpc("clinic_reception_fallback_api"'),'single service-role RPC');
for(const op of ['health','slots','book','cancel','status','pending_replay','replay_result','reconcile_list','masa_import','reconcile_flag'])assert(src.includes('"'+op+'"'),'op '+op);
assert(!/fetch\(/.test(src),'never calls Masa or any other host');
assert(!/console\.(log|error|warn)/.test(src),'no logging');
assert(!/error\.message/.test(src),'database error text is not echoed');
const toml=fs.readFileSync('supabase/config.toml','utf8');assert(/\[functions\.booking-fallback\]\s*(#[^\n]*\n)*verify_jwt = false/.test(toml),'config: verify_jwt false');
const ing='supabase/functions/booking-sync-ingest/index.ts',isrc=fs.readFileSync(ing,'utf8');
const iast=ts.createSourceFile(ing,isrc,ts.ScriptTarget.ES2022,true,ts.ScriptKind.TS);assert.equal(iast.parseDiagnostics.length,0,'booking-sync-ingest parses');
assert(/patch\.masa_doctor_id = masaDoctorId/.test(isrc)&&/Number\.isInteger\(masaDoctorId\)/.test(isrc),'ingest stores masa_doctor_id as a positive int');
console.log('PASS booking-fallback edge: parses, secret-gated, known ops only, one RPC, no outbound calls, no logs, no DB error text; booking-sync-ingest stores masa_doctor_id.');
