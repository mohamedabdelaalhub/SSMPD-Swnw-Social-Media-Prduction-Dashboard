// 20261122150000: booking confirmation / reminder text says «مركز عيادات سونو التخصصية» (after 150000 + 070000); contact
// line unchanged; ready messages updated, sent kept; second run refused; rollback restores.
const fs=require('fs'),assert=require('node:assert/strict'),{PGlite}=require('@electric-sql/pglite');
(async()=>{const db=new PGlite(),one=async(s,p)=>(await db.query(s,p)).rows[0];
 const src=fs.readFileSync('supabase/migrations/20261017013522_clinic_booking_advances.sql','utf8');
 const bodyExpr=src.match(/body:=(case when p_payload->>'kind'='reminder'[\s\S]*?'\. للاستفسار: 01010686264');/)[1];
 const N='مركز عيادات سونو التخصصية',LINE='للاستفسار: 0236230005 — موبايل وواتساب: 01010686264';
 try{await db.exec(`create role authenticated;create role anon;create schema clinic_finance;create schema if not exists clinic_reception;
  create table clinic_finance.booking_messages(id serial,body text,status text);
  insert into clinic_finance.booking_messages(body,status) values('تأكيد حجزك في عيادات سونو التخصصية: س. للاستفسار: 01010686264','ready'),('تأكيد حجزك في Swnw للعيادات التخصصية: ق. للاستفسار: 0236230005','manual_sent');
  create function public.booking_text(p_payload jsonb) returns text language plpgsql as $f$declare b record;begin
   select 'سارة تجريبية'::text customer_name,'2026-11-22'::date appointment_date,'10:00'::text appointment_time,'د. تجريبي'::text doctor_name,null::text specialty_name,'R1'::text booking_reference,'Q1'::text booking_request_id into b;
   return ${bodyExpr};end $f$;`);
  for(const m of ['20261121150000_booking_messages_center_text','20261122070000_booking_messages_contact_numbers','20261122150000_center_name_sono'])await db.exec(fs.readFileSync('supabase/migrations/'+m+'.sql','utf8'));
  for(const k of ['confirmation','reminder']){const t=(await one('select public.booking_text($1) t',[{kind:k}])).t;
   assert(t.includes(N),t);assert(!/Swnw/.test(t));assert(t.endsWith(LINE),'contact line unchanged');assert.equal(t.split(N).length,2);}
  const rows=(await db.query('select body from clinic_finance.booking_messages order by id')).rows;
  assert(rows[0].body.includes(N),'ready message updated');assert(/Swnw للعيادات/.test(rows[1].body),'sent message is history');
  await assert.rejects(()=>db.exec(fs.readFileSync('supabase/migrations/20261122150000_center_name_sono.sql','utf8')),/no function carries/);await db.exec('rollback').catch(()=>{});
  await db.exec(fs.readFileSync('supabase/rollbacks/20261122150000_center_name_sono.rollback.sql','utf8'));
  assert(/Swnw للعيادات/.test((await one('select public.booking_text($1) t',[{kind:'reminder'}])).t),'rollback restores');
  console.log('PASS center name: booking texts say «مركز عيادات سونو التخصصية», contact line kept, ready updated, sent kept, rollback');
 }catch(e){console.error(e);process.exitCode=1;}finally{await db.close();}})();
