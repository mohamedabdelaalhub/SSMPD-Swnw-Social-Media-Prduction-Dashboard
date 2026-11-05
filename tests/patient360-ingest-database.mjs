import assert from "node:assert/strict";
import fs from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import { prepareEnvelope, digestUtf8 } from "../supabase/functions/patient360-ingest/contract.mjs";
const db = new PGlite();
try {
 await db.exec([
  "create role anon;","create role authenticated;","create role service_role;",
  "create table public.patient360_contacts(id uuid primary key default gen_random_uuid(),channel text not null,external_key text not null,display_name text not null default 'عميل',last_inbound_at timestamptz,last_outbound_at timestamptz,last_message_at timestamptz,updated_at timestamptz default now(),lead_id uuid,patient_id uuid,patient_link_verified_at timestamptz,unique(channel,external_key));",
  "create table public.patient360_messages(id uuid primary key default gen_random_uuid(),contact_id uuid not null references public.patient360_contacts(id),source_key text unique not null,direction text not null,body text not null,message_status text not null,source text not null,sent_at timestamptz not null,created_at timestamptz default now());",
  "create table public.patient360_audit(id bigint generated always as identity primary key,at timestamptz not null default now(),contact_id uuid,entity_type text not null,entity_id uuid,operation text not null,actor_auth_uid uuid,detail jsonb not null default '{}'::jsonb);"
 ].join("\n"));
 await db.exec(fs.readFileSync("proposals/patient360/staged_patient360_ingest.sql","utf8"));
 const scope={tenant:"synthetic-clinic",account:"synthetic-account",contactKey:"test-constant-contact-hmac-key-do-not-use-in-prod-1234"};
 const ordered=v=>Array.isArray(v)?v.map(ordered):v&&typeof v==="object"?Object.fromEntries(Object.keys(v).sort().map(k=>[k,ordered(v[k])])):v;
 const prepare=async(key,kind,extra={})=>{
   const e={tenant:scope.tenant,account:scope.account,key,kind,...extra};
   const identity_json=JSON.stringify([e.tenant,e.account,e.key]),event_json=JSON.stringify(ordered(e));
   return prepareEnvelope({schema_version:1,event_key:await digestUtf8(identity_json),digest:await digestUtf8(event_json),identity_json,event_json},scope);
 };
 const names=["p_event_key","p_digest","p_tenant","p_account","p_kind","p_meta_id","p_contact_hash","p_source_key","p_direction","p_message_type","p_structured_content","p_body","p_attempt_id","p_outcome","p_status","p_error_codes","p_occurred_at"];
 const casts=names.map((_,i)=>"$"+(i+1)+(i===10||i===15?"::jsonb":i===16?"::timestamptz":"::text")).join(",");
 const ingest=async p=>{
   const vals=names.map((n,i)=>(i===10||i===15)&&p[n]!=null?JSON.stringify(p[n]):p[n]);
   const r=await db.query("select public.patient360_ingest_event("+casts+") as ack",vals);
   return r.rows[0].ack;
 };
 const a="00000000000000000000000000000001";
 const status=await prepare("status:wamid.test:delivered:2","status",{meta_id:"wamid.test",status:"delivered",at:"2",error_codes:[]});
 await ingest(status);
 assert.equal((await db.query("select count(*)::int as n from public.patient360_messages")).rows[0].n,0,"early receipt is evidence only");
 const attempted=await prepare("attempt:"+a,"outbound_attempt",{attempt_id:a,contact:"family-shared-number",at:1.5,content:{type:"text",text:{body:"Hello"}}});
 await ingest(attempted);
 assert.equal((await db.query("select count(*)::int as n from public.patient360_messages")).rows[0].n,0,"attempt is not sent");
 const accepted=await prepare("outcome:"+a,"outbound_outcome",{attempt_id:a,contact:"family-shared-number",at:1.5,content:{type:"text",text:{body:"Hello"}},outcome:"accepted",meta_id:"wamid.test"});
 const ack=await ingest(accepted);
 assert.deepEqual(Object.keys(ack).sort(),["committed","digest","event_key"]);
 assert.equal(ack.committed,true);
 assert.equal((await db.query("select message_status from public.patient360_messages")).rows[0].message_status,"delivered","late message inherits receipt");
 const before=(await db.query("select count(*)::int as n from public.patient360_ingest_receipts")).rows[0].n;
 assert.deepEqual(await ingest(accepted),ack,"exact duplicate returns the same ack");
 assert.equal((await db.query("select count(*)::int as n from public.patient360_ingest_receipts")).rows[0].n,before);
 for(const [name,time] of [["read","3"],["sent","1"],["failed","4"]]){
  await ingest(await prepare("status:wamid.test:"+name+":"+time,"status",{meta_id:"wamid.test",status:name,at:time}));
 }
 assert.equal((await db.query("select message_status from public.patient360_messages")).rows[0].message_status,"read","late status cannot downgrade");
 await assert.rejects(()=>ingest({...accepted,p_digest:"0".repeat(64)}),/EVENT_KEY_COLLISION/);
 const altAttempt="0".repeat(31)+"2";
 const alt=await prepare("outcome:"+altAttempt,"outbound_outcome",{attempt_id:altAttempt,contact:"family-shared-number",at:4,content:{type:"text",text:{body:"DIFFERENT"}},outcome:"accepted",meta_id:"wamid.test"});
 await assert.rejects(()=>ingest(alt),/META_MESSAGE_ID_COLLISION/);
 await ingest(await prepare("in:wamid.input","inbound",{meta_id:"wamid.input",contact:"family-shared-number",at:"4",content:{type:"text",text:{body:"help"}}}));
 assert.equal((await db.query("select count(*)::int as n from public.patient360_messages")).rows[0].n,2);
 assert.equal((await db.query("select count(*)::int as n from public.patient360_contacts where patient_id is not null or lead_id is not null")).rows[0].n,0);
 const permission=await db.query("select has_function_privilege('anon','public.patient360_ingest_event(text,text,text,text,text,text,text,text,text,text,jsonb,text,text,text,text,jsonb,timestamptz)','EXECUTE') as allowed");
 assert.equal(permission.rows[0].allowed,false,"anon cannot execute");
 console.log("PASS atomic receipt dedupe, early status, non-downgrade, collision, no patient link, anon denial");
} finally { await db.close(); }
