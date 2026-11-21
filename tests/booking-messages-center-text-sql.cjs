// 20261121150000: booking confirmation / reminder text uses «Swnw للعيادات التخصصية» and 0236230005; ready messages updated,
// sent ones untouched; the real prepare text from 20261017013522 is patched.
const fs=require('fs'),assert=require('node:assert/strict'),{PGlite}=require('@electric-sql/pglite');
(async()=>{const db=new PGlite(),one=async(s,p)=>(await db.query(s,p)).rows[0];
 const src=fs.readFileSync('supabase/migrations/20261017013522_clinic_booking_advances.sql','utf8');
 const bodyExpr=src.match(/body:=(case when p_payload->>'kind'='reminder'[\s\S]*?'\. للاستفسار: 01010686264');/)[1];
 try{await db.exec(`create role authenticated;create role anon;create schema clinic_finance;
  create table clinic_finance.booking_messages(id serial,body text,status text);
  insert into clinic_finance.booking_messages(body,status) values('تأكيد حجزك في عيادات سونو التخصصية: س. للاستفسار: 01010686264','ready'),('تأكيد حجزك في عيادات سونو التخصصية: ق. للاستفسار: 01010686264','manual_sent');
  create function public.booking_text(p_payload jsonb) returns text language plpgsql as $f$declare b record;begin
   select 'سارة تجريبية'::text customer_name,'2026-11-22'::date appointment_date,'10:00'::text appointment_time,'د. تجريبي'::text doctor_name,null::text specialty_name,'R1'::text booking_reference,'Q1'::text booking_request_id into b;
   return ${bodyExpr};end $f$;`);
  await db.exec('create schema if not exists clinic_reception');
  await db.exec(fs.readFileSync('supabase/migrations/20261121150000_booking_messages_center_text.sql','utf8'));
  for(const k of ['confirmation','reminder']){const t=(await one('select public.booking_text($1) t',[{kind:k}])).t;
   assert.match(t,/Swnw للعيادات التخصصية/);assert.match(t,/للاستفسار: 0236230005$/);assert.doesNotMatch(t,/سونو|01010686264/);}
  const rows=(await db.query('select body,status from clinic_finance.booking_messages order by id')).rows;
  assert.match(rows[0].body,/Swnw للعيادات التخصصية.*0236230005/,'ready message updated');assert.match(rows[1].body,/سونو.*01010686264/,'sent message is history');
  await db.exec(fs.readFileSync('supabase/rollbacks/20261121150000_booking_messages_center_text.rollback.sql','utf8'));
  assert.match((await one('select public.booking_text($1) t',[{kind:'reminder'}])).t,/سونو/,'rollback restores function');
  console.log('booking messages center text: ok');
 }catch(e){console.error(e);process.exitCode=1;}finally{await db.close();}})();
