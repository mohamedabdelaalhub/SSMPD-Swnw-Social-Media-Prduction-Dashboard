// 20261122070000: booking confirmation / reminder text ends with «للاستفسار: 0236230005 — موبايل وواتساب: 01010686264»
// (after 20261121150000); ready messages updated once, sent ones untouched, re-run refuses nothing to patch, rollback.
const fs=require('fs'),assert=require('node:assert/strict'),{PGlite}=require('@electric-sql/pglite');
(async()=>{const db=new PGlite(),one=async(s,p)=>(await db.query(s,p)).rows[0];
 const src=fs.readFileSync('supabase/migrations/20261017013522_clinic_booking_advances.sql','utf8');
 const bodyExpr=src.match(/body:=(case when p_payload->>'kind'='reminder'[\s\S]*?'\. للاستفسار: 01010686264');/)[1];
 const LINE='للاستفسار: 0236230005 — موبايل وواتساب: 01010686264';
 try{await db.exec(`create role authenticated;create role anon;create schema clinic_finance;create schema if not exists clinic_reception;
  create table clinic_finance.booking_messages(id serial,body text,status text);
  insert into clinic_finance.booking_messages(body,status) values('تأكيد حجزك في عيادات سونو التخصصية: س. للاستفسار: 01010686264','ready'),('تأكيد حجزك في Swnw للعيادات التخصصية: ق. للاستفسار: 0236230005','manual_sent');
  create function public.booking_text(p_payload jsonb) returns text language plpgsql as $f$declare b record;begin
   select 'سارة تجريبية'::text customer_name,'2026-11-22'::date appointment_date,'10:00'::text appointment_time,'د. تجريبي'::text doctor_name,null::text specialty_name,'R1'::text booking_reference,'Q1'::text booking_request_id into b;
   return ${bodyExpr};end $f$;`);
  await db.exec(fs.readFileSync('supabase/migrations/20261121150000_booking_messages_center_text.sql','utf8'));
  await db.exec(fs.readFileSync('supabase/migrations/20261122070000_booking_messages_contact_numbers.sql','utf8'));
  for(const k of ['confirmation','reminder']){const t=(await one('select public.booking_text($1) t',[{kind:k}])).t;
   assert(t.endsWith(LINE),t);assert.equal(t.split('01010686264').length,2,'mobile once');assert.match(t,/Swnw للعيادات التخصصية/);}
  const rows=(await db.query('select body,status from clinic_finance.booking_messages order by id')).rows;
  assert(rows[0].body.endsWith(LINE),'ready message updated');assert(rows[1].body.endsWith('للاستفسار: 0236230005'),'sent message is history');
  await assert.rejects(()=>db.exec(fs.readFileSync('supabase/migrations/20261122070000_booking_messages_contact_numbers.sql','utf8')),/no function carries/,'not applied twice');
  await db.exec('rollback').catch(()=>{});
  await db.exec(fs.readFileSync('supabase/rollbacks/20261122070000_booking_messages_contact_numbers.rollback.sql','utf8'));
  const back=(await one('select public.booking_text($1) t',[{kind:'reminder'}])).t;assert(back.endsWith('للاستفسار: 0236230005'),'rollback restores the function');
  console.log('PASS booking messages contact numbers: landline + mobile/WhatsApp line, ready updated once, sent kept, rollback');
 }catch(e){console.error(e);process.exitCode=1;}finally{await db.close();}})();
