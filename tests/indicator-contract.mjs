import assert from 'node:assert/strict';
import {signature,verified,checkedEnvelope} from '../supabase/functions/operations-ingest/contract.mjs';
const secret='test-only-bridge-secret-that-is-over-32-characters',stamp=String(Date.now()),body='{"test":1}',sig=await signature(secret,stamp+'.'+body);
assert(await verified(secret,stamp,body,sig));assert(!await verified(secret,stamp,body+' ',sig));assert(!await verified(secret,stamp,body,'0'.repeat(64)));assert(!await verified(secret,stamp,body,sig,Date.now()+600000));assert(!await verified('',stamp,body,sig));
const v={source:'raocrmssjqsozibniujc',approved_by:'00000000-0000-4000-8000-000000000001',approved_at:new Date().toISOString(),snapshot:{schema_version:1,fingerprint:'a'.repeat(64),branch:'حدائق الأهرام',scope:'الحجوزات',title:'تقرير',period_from:'2026-09-01',period_to:'2026-09-30',kpis:{revenue:100},risks:[],recommendations:[],plan:[]}};
assert(checkedEnvelope(v));assert.throws(()=>checkedEnvelope({...v,source:'other'}));assert.throws(()=>checkedEnvelope({...v,snapshot:{...v.snapshot,patient_rows:[]}}));assert.throws(()=>checkedEnvelope({...v,snapshot:{...v.snapshot,kpis:{revenue:'100'}}}));assert.throws(()=>checkedEnvelope({...v,snapshot:{...v.snapshot,period_to:'2026-01-01'}}));
console.log('PASS HMAC/timestamp/tampering and report contract/privacy boundary');
