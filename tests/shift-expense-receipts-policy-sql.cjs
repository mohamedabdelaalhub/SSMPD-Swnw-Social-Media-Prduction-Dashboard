// 20261120340000: the shift-expense receipt read policy no longer calls a private function `authenticated` cannot execute,
// so storage reads of other buckets (videos, documents) work again; uploader and finance reviewers still read receipts.
const fs=require('fs'),assert=require('node:assert/strict'),{PGlite}=require('@electric-sql/pglite');
(async()=>{const db=new PGlite(),q=(s,p)=>db.query(s,p);
 try{await db.exec(`create role authenticated;create role anon;create schema auth;create schema storage;create schema clinic_finance;
  create table cur(uid uuid,reviewer boolean);insert into cur values('00000000-0000-0000-0000-0000000000a1',false);grant select on cur to authenticated;
  create function auth.uid() returns uuid language sql security definer as $$select uid from public.cur$$;
  create function storage.foldername(n text) returns text[] language sql as $$select string_to_array(n,'/')$$;
  grant usage on schema auth, storage to authenticated;grant execute on function auth.uid(), storage.foldername(text) to authenticated;
  create function clinic_finance.allowed(p text) returns boolean language sql security definer as $$select reviewer from public.cur$$;
  revoke all on function clinic_finance.allowed(text) from public;
  create table storage.objects(bucket_id text,name text);alter table storage.objects enable row level security;grant select on storage.objects to authenticated;
  create policy videos_read on storage.objects for select to authenticated using (bucket_id='training-videos');
  insert into storage.objects values('training-videos','a.mp4'),('shift-expense-receipts','00000000-0000-0000-0000-0000000000a1/r1.jpg'),('shift-expense-receipts','00000000-0000-0000-0000-0000000000b2/r2.jpg');`);
  // the policy as first shipped
  const old=fs.readFileSync('supabase/migrations/20261120230000_reception_shift_expenses.sql','utf8').match(/drop policy if exists shift_expense_receipts_read[\s\S]*?;\s*create policy shift_expense_receipts_read[\s\S]*?;/)[0];
  await db.exec(old);
  const asUser=async()=>{await db.exec('set role authenticated');try{return (await q("select bucket_id,name from storage.objects order by 1,2")).rows;}finally{await db.exec('reset role');}};
  await assert.rejects(asUser,/permission denied for function allowed/,'reproduces the live bug');
  const M=fs.readFileSync('supabase/migrations/20261120340000_shift_expense_receipts_policy_fix.sql','utf8');
  await db.exec(M);await db.exec(M);   // idempotent
  let rows=await asUser();
  assert.deepEqual(rows.map(r=>r.name),['00000000-0000-0000-0000-0000000000a1/r1.jpg','a.mp4'],'videos readable + own receipt only');
  await q("update cur set reviewer=true");rows=await asUser();assert.equal(rows.length,3,'finance reviewer reads every receipt');
  await db.exec('set role anon');await assert.rejects(()=>q("select public.shift_expense_receipt_review_allowed()"),/permission denied/);await db.exec('reset role');
  await db.exec(fs.readFileSync('supabase/rollbacks/20261120340000_shift_expense_receipts_policy_fix.rollback.sql','utf8'));
  await q("update cur set reviewer=false");rows=await asUser();assert.equal(rows.length,2,'rollback keeps reads working');
  console.log('shift expense receipts policy fix: ok');
 }catch(e){console.error(e);process.exitCode=1;}finally{await db.close();}})();
