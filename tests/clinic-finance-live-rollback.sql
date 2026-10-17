-- Authenticated RPC integration check, no permanent records and no role changes.
begin;
do $$
declare actor1 uuid;actor2 uuid;reg uuid;shift uuid;invoice uuid;payment uuid;req uuid;snap jsonb;d date:=(now() at time zone 'Africa/Cairo')::date;t uuid:=gen_random_uuid();expected_failure boolean:=false;
begin
 select user_id into actor1 from public.admins where role='super_admin' and active and user_id is not null order by id limit 1;
 select user_id into actor2 from public.admins where role='super_admin' and active and user_id is not null and user_id<>actor1 order by id limit 1;
 if actor1 is null or actor2 is null then raise exception 'Two existing reviewer accounts required for this rollback test';end if;
 perform set_config('request.jwt.claim.sub',actor1::text,true);execute 'set local role authenticated';
 reg:=public.clinic_finance_register('اختبار دورة الخزينة — rollback فقط',300);
 shift:=public.clinic_finance_open_shift(reg,t);
 if public.clinic_finance_open_shift(reg,t)<>shift then raise exception 'Open shift retry mismatch';end if;
 invoice:=public.clinic_finance_invoice('TEST-CASH-CONTROL-ROLLBACK','TEST-ONLY','خدمة تجريبية داخل معاملة تراجع',500,gen_random_uuid());
 payment:=public.clinic_finance_collect(invoice,shift,'cash',500,'TEST-CASH-CONTROL-RC',gen_random_uuid());
 req:=public.clinic_finance_request(jsonb_build_object('kind','expense','shift_id',shift,'amount',100,'reason','نثريات تجريبية','evidence','TEST-RECEIPT'),gen_random_uuid());
 begin perform public.clinic_finance_review_request(req,true,'اعتماد ذاتي ممنوع');exception when others then if sqlerrm like '%بنفسك%' then expected_failure:=true;else raise;end if;end;
 if not expected_failure then raise exception 'Self approval accepted';end if;
 snap:=public.clinic_finance_snapshot(d,d);
 if (select x ? 'expected' from jsonb_array_elements(snap->'shifts') x where x->>'id'=shift::text) then raise exception 'Own open shift expected cash leaked';end if;
 perform set_config('request.jwt.claim.sub',actor2::text,true);
 perform public.clinic_finance_review_request(req,true,'اعتماد مستند تجريبي');
 perform set_config('request.jwt.claim.sub',actor1::text,true);
 perform public.clinic_finance_close_shift(shift,'{"200":2}'::jsonb,'مطابقة اختبار');
 perform set_config('request.jwt.claim.sub',actor2::text,true);
 snap:=public.clinic_finance_snapshot(d,d);
 if (select (x->>'difference')::numeric from jsonb_array_elements(snap->'shifts') x where x->>'id'=shift::text)<>0 then raise exception 'Cash count mismatch';end if;
 perform public.clinic_finance_review_shift(shift,'مطابقة اختبار داخل rollback');
 execute 'reset role';
 if exists(select 1 from clinic_finance.lines l join clinic_finance.entries e on e.id=l.entry_id group by l.entry_id having sum(l.debit-l.credit)<>0) then raise exception 'Unbalanced journal';end if;
end $$;
rollback;
select jsonb_build_object('test','authenticated cash control rollback passed','remaining_test_registers',(select count(*) from clinic_finance.registers where name='اختبار دورة الخزينة — rollback فقط'),'remaining_test_invoices',(select count(*) from clinic_finance.invoices where reference='TEST-CASH-CONTROL-ROLLBACK'),'private_schema_blocked',not has_schema_privilege('authenticated','clinic_finance','usage'),'anon_snapshot_blocked',not has_function_privilege('anon','public.clinic_finance_snapshot(date,date,integer)','execute'),'rls_tables',(select count(*) from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='clinic_finance' and c.relkind='r' and c.relrowsecurity));
