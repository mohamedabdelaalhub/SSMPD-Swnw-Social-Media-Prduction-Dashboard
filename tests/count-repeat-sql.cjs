// «امنع تكرار العد» (20261126020000): same = the entered count equals (every denomination) the cashier's previous ended collection
// shift; zero counts never "same"; another cashier refused; reviewer allowed; no amounts in the answer.
const {PGlite}=require('@electric-sql/pglite'),fs=require('fs'),assert=require('node:assert/strict');
(async()=>{const db=new PGlite();
await db.exec(`create role authenticated;create role anon;create schema clinic_finance;
create table public.admins(id uuid primary key,reviewer boolean default false);
create function public.my_admin_id() returns uuid language sql stable as $$select nullif(current_setting('t.me',true),'')::uuid$$;
create function clinic_finance.allowed(a text) returns boolean language sql stable as $$select coalesce((select reviewer from public.admins where id=public.my_admin_id()),false)$$;
create table clinic_finance.shifts(id uuid primary key,cashier_id uuid,is_main boolean default false,status text default 'open',opened_at timestamptz default now(),ended_at timestamptz,closed_at timestamptz,end_counts jsonb,denominations jsonb);`);
const M=fs.readFileSync('supabase/migrations/20261126020000_count_repeat_check.sql','utf8');await db.exec(M);
await assert.rejects(()=>db.exec(M),/تم تطبيق هذا الملف من قبل/);await db.exec('rollback');
const u=n=>'00000000-0000-0000-0000-'+String(n).padStart(12,'0'),MAR=u(1),OTH=u(2),REV=u(3);
await db.query("insert into admins values($1,false),($2,false),($3,true)",[MAR,OTH,REV]);
// 22/11 ended with 200×5, 100×1, 50×1, 20×2 ; an older shift with something else ; today open
await db.query("insert into clinic_finance.shifts(id,cashier_id,status,ended_at,end_counts) values($1,$2,'submitted','2026-11-20T18:00Z','{\"100\":\"3\"}'),($3,$2,'submitted','2026-11-22T20:00Z','{\"200\":\"5\",\"100\":\"1\",\"50\":\"1\",\"20\":\"2\",\"10\":\"0\"}')",[u(10),MAR,u(11)]);
await db.query("insert into clinic_finance.shifts(id,cashier_id) values($1,$2)",[u(12),MAR]);
const call=async(me,counts,shift=u(12))=>{await db.query("select set_config('t.me',$1,false)",[me]);return (await db.query("select public.clinic_finance_count_repeat($1,$2::jsonb) v",[shift,JSON.stringify(counts)])).rows[0].v;};
let r=await call(MAR,{'200':'5','100':'1','50':'1','20':'2','5':'0'});assert.equal(r.same,true);assert.ok(r.last_at);
assert.deepEqual(Object.keys(r).sort(),['last_at','same'],'no amounts');
r=await call(MAR,{'200':'5','100':'1','50':'1','20':'3'});assert.equal(r.same,false);assert.equal(r.last_at,null);
r=await call(MAR,{'200':'0'});assert.equal(r.same,false,'an all-zero count is never «same»');
r=await call(REV,{'200':'5','100':'1','50':'1','20':'2'});assert.equal(r.same,true,'reviewer may check');
await assert.rejects(()=>call(OTH,{'200':'5'}),/لصاحب الوردية/);
// first shift ever → nothing to compare
await db.query("insert into clinic_finance.shifts(id,cashier_id) values($1,$2)",[u(20),OTH]);r=await call(OTH,{'200':'5'},u(20));assert.equal(r.same,false);
const acl=(await db.query("select proacl::text a from pg_proc where proname='clinic_finance_count_repeat'")).rows[0].a;assert(!/anon=/.test(acl)&&/authenticated=X/.test(acl),acl);
await db.exec(fs.readFileSync('supabase/rollbacks/20261126020000_count_repeat_check.rollback.sql','utf8'));
assert.equal((await db.query("select to_regprocedure('public.clinic_finance_count_repeat(uuid,jsonb)') r")).rows[0].r,null);
console.log('PASS count repeat check SQL: same as previous shift, zero/none/different not same, other cashier refused, reviewer ok, no amounts, grants, rollback');process.exit(0);
})().catch(e=>{console.error(e);process.exit(1);});
