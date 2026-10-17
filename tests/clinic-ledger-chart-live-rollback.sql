begin;
do $$
declare u1 uuid;u2 uuid;ref text:='TEST-LEDGER-'||gen_random_uuid()::text;code text:='9'||floor(random()*10000000000)::bigint::text;d jsonb;ac jsonb;snap jsonb;pair jsonb;entry uuid;day date:=(now() at time zone 'Africa/Cairo')::date;
begin
select user_id into u1 from public.admins where role='super_admin' and active and user_id is not null order by id limit 1;
select user_id into u2 from public.admins where role='super_admin' and active and user_id is not null and user_id<>u1 order by id limit 1;
if u1 is null or u2 is null then raise exception 'Two existing managers required';end if;
perform set_config('request.jwt.claim.sub',u1::text,true);execute 'set local role authenticated';
ac:=public.clinic_finance_ledger_command('account_create',jsonb_build_object('code',code,'name',ref,'kind','expense'),gen_random_uuid());
ac:=public.clinic_finance_ledger_command('account_update',ac||jsonb_build_object('name',ref||' edited','kind','expense'),gen_random_uuid());
d:=public.clinic_finance_ledger_command('draft_save',jsonb_build_object('payload',jsonb_build_object('kind','correction','reference',ref,'note','Rollback test only','lines',jsonb_build_array(jsonb_build_object('account',code,'debit',10,'credit',0),jsonb_build_object('account','1112','debit',0,'credit',10)))),gen_random_uuid());
d:=public.clinic_finance_ledger_command('draft_delete',d,gen_random_uuid());d:=public.clinic_finance_ledger_command('draft_restore',d,gen_random_uuid());d:=public.clinic_finance_ledger_command('draft_submit',d,gen_random_uuid());
perform set_config('request.jwt.claim.sub',u2::text,true);perform public.clinic_finance_manual_command('review',jsonb_build_object('id',d->>'batch_id','approve',true,'note','Independent rollback review'),gen_random_uuid());
snap:=public.clinic_finance_snapshot(day,day,0);select (x->>'id')::uuid into entry from jsonb_array_elements(snap->'entries')x where x->>'manual_batch_id'=d->>'batch_id';
if entry is null or public.clinic_finance_entry_origin(entry)->>'reference'<>ref then raise exception 'Original reference missing';end if;
perform set_config('request.jwt.claim.sub',u1::text,true);
d:=public.clinic_finance_ledger_command('draft_save',jsonb_build_object('payload',jsonb_build_object('kind','replacement','entry_id',entry,'reference',ref||'-FIX','note','Rollback replacement','lines',jsonb_build_array(jsonb_build_object('account',code,'debit',15,'credit',0),jsonb_build_object('account','1112','debit',0,'credit',15)))),gen_random_uuid());
d:=public.clinic_finance_ledger_command('draft_submit',d,gen_random_uuid());snap:=public.clinic_finance_snapshot(day,day,0);select x into pair from jsonb_array_elements(snap->'journal_corrections')x where x->>'entry_id'=entry::text;
perform set_config('request.jwt.claim.sub',u2::text,true);perform public.clinic_finance_ledger_command('correction_review',jsonb_build_object('id',pair->>'id','approve',true,'note','Independent pair review'),gen_random_uuid());
execute 'reset role';
if (select sum(debit-credit) from clinic_finance.lines where account=code)<>15 then raise exception 'Wrong corrected balance';end if;
if exists(select 1 from clinic_finance.lines group by entry_id having sum(debit-credit)<>0) then raise exception 'Unbalanced ledger';end if;
end $$;
rollback;
select jsonb_build_object('test','ledger chart authenticated rollback passed','remaining_test_accounts',(select count(*) from clinic_finance.accounts where name like 'TEST-LEDGER-%'),'remaining_test_drafts',(select count(*) from clinic_finance.journal_drafts where payload->>'reference' like 'TEST-LEDGER-%'),'anonymous_rpc_blocked',not has_function_privilege('anon','public.clinic_finance_ledger_command(text,jsonb,uuid)','execute'),'private_base_blocked',not has_function_privilege('authenticated','clinic_finance.journal_manual_base(text,jsonb,uuid)','execute'));
