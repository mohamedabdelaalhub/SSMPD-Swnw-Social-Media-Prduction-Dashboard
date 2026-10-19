-- Existing posting codes stay immutable. Attach their control accounts to the accountant's groups.
-- No entries, balances, original imported codes, or subledger rules are rewritten.
begin;
create temporary table chart_link_baseline on commit drop as select (select count(*) from clinic_finance.entries) entries, (select md5(coalesce(string_agg(row_to_json(l)::text,',' order by id),'')) from clinic_finance.lines l) lines_hash;
create temporary table chart_link_plan(code text primary key,parent text not null) on commit drop;
insert into chart_link_plan values ('1111','01020102'),('1112','010201'),('1114','010209'),('1115','010209'),('1119','01020102'),('1121','01020301'),('1122','01020301'),('1131','010202'),('1142','010208'),('1143','010208'),('1194','010208'),('1211','0101'),('1291','0101'),('1292','010203'),('2111','02010101'),('2120','020104'),('2131','020104'),('2141','020103'),('2142','020103'),('2143','020102'),('2144','020103'),('2150','020102'),('2151','020102'),('3199','03'),('3210','0303'),('4110','0401'),('4116','0401'),('4117','04'),('4152','0401'),('4153','0401'),('4190','0401'),('4192','0401'),('5111','05041505'),('5121','0504'),('5122','0504'),('5123','0504'),('5211','050501'),('5216','0505'),('5217','0504'),('5218','050512'),('5219','050516'),('5220','050517'),('5221','050515'),('5222','050401'),('5223','050409'),('5224','0505'),('5225','050509'),('5226','0504'),('5230','0505'),('5231','050514');
do $verify$begin
 if (select count(*) from chart_link_plan)<>50 or exists(select 1 from clinic_finance.account_config c where c.is_system and not exists(select 1 from chart_link_plan p where p.code=c.code)) then raise exception 'Operational chart inventory changed. Review links before applying.';end if;
 if exists(select 1 from chart_link_plan p left join clinic_finance.account_config c on c.code=p.parent left join clinic_finance.accounts a on a.code=p.code left join clinic_finance.accounts b on b.code=p.parent where c.code is null or c.is_postable or not c.active or c.archived or a.kind is distinct from b.kind) then raise exception 'Missing, inactive or wrong-kind parent group';end if;
end $verify$;
alter table chart_link_plan add column payload jsonb;
update chart_link_plan p set payload=jsonb_build_object('code',p.code,'name',a.name,'kind',a.kind,'parent_code',p.parent,'revision',c.revision,'is_postable',true,'active',true) from clinic_finance.accounts a join clinic_finance.account_config c using(code) where a.code=p.code and c.parent_code is distinct from p.parent;
grant select on chart_link_plan to authenticated;
do $link$declare actor uuid;r record;begin
 select user_id into actor from public.admins where role='financial_manager' and active and user_id is not null order by id limit 1;
 if actor is null then raise exception 'Active financial manager required';end if;
 perform set_config('request.jwt.claim.sub',actor::text,true);
 execute 'set local role authenticated';
 for r in select payload from pg_temp.chart_link_plan where payload is not null order by code loop
 perform public.clinic_finance_ledger_command('account_update',r.payload,gen_random_uuid());
 end loop;
 execute 'reset role';
end $link$;
do $verify$begin
 if exists(select 1 from chart_link_plan p join clinic_finance.account_config c using(code) where c.parent_code is distinct from p.parent) then raise exception 'Incomplete chart links';end if;
 if exists(select 1 from clinic_finance.account_config where clinic_finance.account_level(code)>5) then raise exception 'Chart level exceeded';end if;
 if (select count(*) from clinic_finance.entries)<>(select entries from chart_link_baseline) or (select md5(coalesce(string_agg(row_to_json(l)::text,',' order by id),'')) from clinic_finance.lines l)<>(select lines_hash from chart_link_baseline) then raise exception 'Ledger changed during chart configuration';end if;
end $verify$;
commit;
