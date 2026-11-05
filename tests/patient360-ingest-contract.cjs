const assert = require("node:assert/strict");
const fs = require("node:fs");
const ts = require("typescript");

(async () => {
 const { prepareEnvelope, digestUtf8, constantTimeHex, ContractError } =
   await import("../supabase/functions/patient360-ingest/contract.mjs");
 const scope = { tenant: "synthetic-clinic", account: "synthetic-account", contactKey: "test-constant-contact-hmac-key-do-not-use-in-prod-1234" };
 const cases = [
  ["5a29875bb65c50dd8b472156a63408bc5d88fad7de56179a89c958c7c72afb0c","9375cb5b6e566218ed8a7ae84a74cc377b1dabdafc5518804c36da64daff4c4f", '["synthetic-clinic","synthetic-account","in:wamid.synthetic-in"]', '{"account":"synthetic-account","at":"1","contact":"synthetic-contact","content":{"text":{"body":"synthetic text"},"type":"text"},"key":"in:wamid.synthetic-in","kind":"inbound","meta_id":"wamid.synthetic-in","tenant":"synthetic-clinic"}'],
  ["1ddb8c7323dd185ed44b7ee2ed187cd0ce8274733b2fce120cd3a077661c2d1b","7bfec96a31c6b6f65c468fcc2512ca2d688b4037f110bd80616f6d8a4b936f5b",'["synthetic-clinic","synthetic-account","attempt:00000000000000000000000000000001"]','{"account":"synthetic-account","at":1.5,"attempt_id":"00000000000000000000000000000001","contact":"synthetic-contact","content":{"text":{"body":"synthetic reply"},"type":"text"},"key":"attempt:00000000000000000000000000000001","kind":"outbound_attempt","tenant":"synthetic-clinic"}'],
  ["598866bfd816c2e2e6c921fabde9313696c3c4b7a62b1bb3142958dc7b6c6935","e9c27e7f8bf8dd4976ac7114accdc5b42ad0ef37ee8b87b3a3a82a0a1a134ff3",'["synthetic-clinic","synthetic-account","outcome:00000000000000000000000000000001"]','{"account":"synthetic-account","at":1.5,"attempt_id":"00000000000000000000000000000001","contact":"synthetic-contact","content":{"text":{"body":"synthetic reply"},"type":"text"},"key":"outcome:00000000000000000000000000000001","kind":"outbound_outcome","meta_id":"wamid.synthetic-out","outcome":"accepted","tenant":"synthetic-clinic"}'],
  ["95174f7b04ff8289e8bc813084f2e7d82840621eb93afb2c84aa9645f773da8d","44127e7480096f5dec8d2aae41d16285e7f3fdcb9c729f4dcbab37c4448977b7",'["synthetic-clinic","synthetic-account","status:wamid.synthetic-out:delivered:2"]','{"account":"synthetic-account","at":"2","error_codes":[],"key":"status:wamid.synthetic-out:delivered:2","kind":"status","meta_id":"wamid.synthetic-out","status":"delivered","tenant":"synthetic-clinic"}']
 ];
 const result = [];
 for (const [event_key,digest,identity_json,event_json] of cases) {
   const envelope={schema_version:1,event_key,digest,identity_json,event_json};
   assert.equal(await digestUtf8(identity_json),event_key,"Python identity SHA-256 byte fixture matches JS");
   assert.equal(await digestUtf8(event_json),digest,"Python event SHA-256 byte fixture matches JS");
   result.push(await prepareEnvelope(envelope,scope));
 }
 assert.equal(result[0].p_direction,"inbound");
 assert.equal(result[0].p_body,"synthetic text");
 assert.equal(result[1].p_source_key,null);
 assert.equal(result[2].p_direction,"outbound");
 assert.equal(result[3].p_status,"delivered");
 assert.equal(result[3].p_contact_hash,null);
 assert.equal(result[0].p_event_key,cases[0][0]);
 assert.equal(result[0].p_source_key,
   "p360:v1:"+await digestUtf8(JSON.stringify([scope.tenant,scope.account,"inbound","wamid.synthetic-in"])));
 assert(constantTimeHex(cases[0][0],cases[0][0]));
 assert(!constantTimeHex(cases[0][0],cases[1][0]));
 const original={schema_version:1,event_key:cases[0][0],digest:cases[0][1],identity_json:cases[0][2],event_json:cases[0][3]};
 async function rejected(payload, expected, asScope=scope) {
  await assert.rejects(()=>prepareEnvelope(payload,asScope), e=>e instanceof ContractError&&e.code===expected);
 }
 await rejected({...original,event_json:original.event_json.replace("synthetic text","modified text")},"INVALID_EVENT_DIGEST");
 await rejected(original,"SCOPE_DENIED",{tenant:"different",account:scope.account});
 await rejected({...original,digest:"0".repeat(64)},"INVALID_EVENT_DIGEST");
 await rejected({...original,schema_version:2},"UNSUPPORTED_VERSION");
 const bad={...original,event_json:original.event_json.replace('"kind":"inbound"','"kind":"status"')};
 bad.digest=await digestUtf8(bad.event_json);
 await rejected(bad,"INVALID_STATUS");
 // The Edge runtime must not leak raw text or silently normalize event_json.
 const source=fs.readFileSync("supabase/functions/patient360-ingest/index.ts","utf8");
 const transpile=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022},reportDiagnostics:true});
 const fatal=(transpile.diagnostics||[]).filter(d=>d.category===ts.DiagnosticCategory.Error);
 assert.equal(fatal.length,0,"Edge TS parse");
 assert(source.includes('admin.rpc("patient360_ingest_event", args)'));
 assert(source.includes("P360_INGEST_SCOPES_JSON"));
 assert(!/meta\.send|journey_message_claim|booking_create/.test(source),"no sending or booking");
 const sql=fs.readFileSync("proposals/patient360/staged_patient360_ingest.sql","utf8");
 assert(sql.includes("pg_advisory_xact_lock"),"transactional concurrency");
 assert(sql.includes("EVENT_KEY_COLLISION"),"identity conflict");
 assert(sql.includes("META_MESSAGE_ID_COLLISION"),"provider ID conflict");
 assert(sql.includes("message_status='failed'"),"failed receipt stored as evidence");
 assert(sql.includes("revoke all on function public.patient360_ingest_event"),"deny browser users");
 console.log("PASS: 4 Python byte fixtures, exact hashes, 5 negative cases, TS parse, SQL security invariants");
})().catch(e=>{console.error(e);process.exit(1);});