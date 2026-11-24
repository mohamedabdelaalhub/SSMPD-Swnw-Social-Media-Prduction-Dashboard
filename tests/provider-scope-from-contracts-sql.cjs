// 20261123150000: an approved (active) performed / service doctor contract gives the doctor the booking scope row for that code —
// backfill now, then automatically on contract approval and on provider doctor_key changes. Uses the real gate
// (20261114180000 has_provider_service_scope + its 20261117130000 wrapper) on a minimal schema. Sample data only.
const {PGlite}=require('@electric-sql/pglite'),fs=require('fs'),assert=require('node:assert/strict');
(async()=>{const db=new PGlite();
 await db.exec(`create role anon;create role authenticated;create table admins(id uuid primary key,role text);insert into admins values('61000000-0000-4000-8000-000000000001','super_admin');
  create schema clinic_reception;create schema clinic_finance;
  create table clinic_reception.workspaces(id uuid primary key default gen_random_uuid(),mode text);
  create table clinic_reception.providers(id uuid primary key default gen_random_uuid(),workspace_id uuid not null references clinic_reception.workspaces(id),name text not null,doctor_key text,department text not null,branch text not null default 'x',active boolean not null default true,unique(workspace_id,name));
  create table clinic_reception.services(id uuid primary key default gen_random_uuid(),workspace_id uuid not null,code text,name text,department text,active boolean default true);
  ${fs.readFileSync('supabase/migrations/20261017010341_clinic_doctor_settlements.sql','utf8').match(/create table if not exists clinic_finance\.doctor_contracts\([^;]*\);/)[0]}`);
 // the real gate: scope row + active contract (20261114180000, table + function only), basic-service wrapper (20261117130000)
 const g=fs.readFileSync('supabase/migrations/20261114180000_reception_provider_service_scopes.sql','utf8');
 await db.exec(g.slice(g.indexOf('create table clinic_reception.provider_service_scopes'),g.indexOf('do $migration$')));
 const b=fs.readFileSync('supabase/migrations/20261117130000_reception_basic_services_readiness.sql','utf8');
 await db.exec(b.slice(b.indexOf('create or replace function clinic_reception.norm_ar'),b.indexOf('-- Graded consultations')));
 const one=async(sql,a)=>(await db.query(sql,a)).rows[0];
 const ws=(await one("insert into clinic_reception.workspaces(mode) values('live') returning id")).id;
 const prov=async(name,key,active=true)=>(await one('insert into clinic_reception.providers(workspace_id,name,doctor_key,department,active) values($1,$2,$3,$4,$5) returning id',[ws,name,key,'الجلدية والتجميل',active])).id;
 const shady=await prov('د. شادي تجريبي','dr-shady'),dalia=await prov('د. داليا تجريبية','dr-dalia'),old=await prov('د. قديم تجريبي','dr-old',false),nokey=await prov('د. من غير مفتاح',null);
 for(const [c,n] of [['0001316','ليزر دايود 1000 نبضة'],['0001317','كانديلا 1000 نبضة'],['0001400','كشف جلدية']])await db.query("insert into clinic_reception.services(workspace_id,code,name,department) values($1,$2,$3,'الجلدية والتجميل')",[ws,c,n]);
 const today=(await one("select (now() at time zone 'Africa/Cairo')::date::text d")).d;
 let tk=0;const contract=(key,code,o={})=>db.query(`insert into clinic_finance.doctor_contracts(doctor_key,doctor_name,service_scope,valid_from,valid_to,rate,basis,base_scope,deduction,refund_policy,reference,status,payload,created_by,token)
   values($1,$2,$3,$4,$5,20,$6,$7,$8,'proportional_revenue','REF',$9,'{}','61000000-0000-4000-8000-000000000001',$10) returning id`,[key,key,code,o.from||'2026-11-09',o.to||'2027-12-31',o.basis||'performed',o.base||'service',o.ded||'none',o.status||'active','62000000-0000-4000-8000-'+String(++tk).padStart(12,'0')]).then(r=>r.rows[0].id);
 // before: Shady has active contracts for both laser codes but no scope rows (the live gap); Dalia has row + contract
 await contract('dr-shady','0001316');await contract('dr-shady','0001317');await contract('dr-dalia','0001316');
 await db.query("insert into clinic_reception.provider_service_scopes values($1,'0001316')",[dalia]);
 await contract('dr-shady','0009001',{basis:'collected'});await contract('dr-shady','0009002',{from:'2025-01-01',to:'2026-01-01'});await contract('dr-shady','0009003',{status:'pending'});await contract('dr-shady','0009004',{ded:'sale'});
 await contract('dr-old','0001316');
 const gate=(p,c)=>one('select clinic_reception.has_provider_service_scope($1,$2,$3::date) v',[p,c,today]).then(r=>r.v);
 assert.equal(await gate(shady,'0001316'),false,'before: refused');assert.equal(await gate(dalia,'0001316'),true);
 assert.equal(await gate(shady,'0001400'),true,'basic consult open to everyone (unchanged)');
 const M=fs.readFileSync('supabase/migrations/20261123150000_provider_scope_from_contracts.sql','utf8');
 const notices=[];db.onNotice?.(n=>notices.push(n.message));
 await db.exec(M);await assert.rejects(()=>db.exec(M),/تم تطبيق هذا الملف من قبل/);await db.exec('rollback');
 const rows=async p=>(await db.query('select service_code from clinic_reception.provider_service_scopes where provider_id=$1 order by 1',[p])).rows.map(r=>r.service_code);
 assert.deepEqual(await rows(shady),['0001316','0001317'],'backfill: only active performed/service none|cost contracts still valid');
 assert.equal(await gate(shady,'0001316'),true,'after: Shady can book 0001316');assert.equal(await gate(shady,'0001317'),true);
 assert.deepEqual(await rows(old),[],'inactive provider not filled');assert.deepEqual(await rows(nokey),[]);
 assert.equal((await one("select count(*)::int n from clinic_reception.provider_scope_autofill where source='backfill'")).n,2,'logged (Dalia\'s existing row not logged)');
 assert.equal((await one('select clinic_reception.sync_scope_from_contracts(null) n')).n,0,'idempotent');
 // never again: a newly approved contract → row at once; a pending one → nothing until approved
 const pend=await contract('dr-shady','0001318',{status:'pending'});assert(!(await rows(shady)).includes('0001318'),'pending: no row');
 await db.query("update clinic_finance.doctor_contracts set status='active' where id=$1",[pend]);assert((await rows(shady)).includes('0001318'),'approved → row');
 await contract('dr-dalia','0001317');assert.deepEqual(await rows(dalia),['0001316','0001317'],'insert active → row');
 // a provider getting its doctor_key later / re-activated → rows
 await db.query("update clinic_reception.providers set doctor_key='dr-nokey' where id=$1",[nokey]);await contract('dr-nokey','0001316');
 assert.deepEqual(await rows(nokey),['0001316']);
 await db.query('update clinic_reception.providers set active=true where id=$1',[old]);assert.deepEqual(await rows(old),['0001316'],'re-activated → row');
 // rollback removes only the auto-filled rows
 await db.exec(fs.readFileSync('supabase/rollbacks/20261123150000_provider_scope_from_contracts.rollback.sql','utf8'));
 assert.deepEqual(await rows(dalia),['0001316'],'pre-existing row kept');assert.deepEqual(await rows(shady),[],'auto rows removed');
 assert.equal((await one("select to_regclass('clinic_reception.provider_scope_autofill') r")).r,null);
 console.log('PASS provider scope from contracts: backfill (active performed/service none|cost, still valid, active provider with doctor_key) makes the real gate pass for the doctor; collected / expired / pending / sale contracts and inactive or key-less providers skipped; idempotent; approving a contract, adding an active one, setting a provider\'s doctor_key or re-activating it adds the rows at once; rollback removes only the auto-filled rows.');
})().catch(e=>{console.error(e);process.exit(1);});
