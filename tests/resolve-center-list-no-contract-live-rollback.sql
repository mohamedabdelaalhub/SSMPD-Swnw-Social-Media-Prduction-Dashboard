-- LIVE ROLLBACK TEST for 20261126140000_resolve_center_list_no_contract. Run it as a whole; it ends in ROLLBACK and writes nothing.
-- Do NOT run the migration file first: the patch DO block below is copied byte-for-byte from it (tests check this), so one
-- transaction shows the bug before the patch and the fix after it.
-- Steps (all rolled back):
--  1. baseline: cash price (contract = null) of every item of the active center list with no contract, on today and on
--     2026-12-02 (after White Friday), through resolve() and resolve_before_offer();
--  2. insert a TEMPORARY contract-linked, center-kind, ACTIVE list (valid from yesterday) that prices the same services
--     at +7, linked to one contract;
--  3. BEFORE the patch: how many center lists the old lookup sees, and how many cash prices moved (informational);
--  4. apply the patch (same DO block as the migration);
--  5. AFTER the patch: assert 0 cash prices moved on both dates, and that the patched body carries `contract_id is null`.
-- Paste back every 'part' row.
begin;
create temp table rc_base(sid uuid,d date,via text,price numeric) on commit drop;
create temp table rc_out(part text,detail jsonb) on commit drop;
do $t$
declare cl uuid;lid uuid;cid uuid;
begin
 select id into cl from clinic_prices.lists where list_kind='center' and contract_id is null and deleted_at is null and status='active'
   and current_date between valid_from and valid_to order by valid_from desc,id limit 1;
 if cl is null then raise exception 'no active center list without contract';end if;
 insert into rc_base select i.service_id,d,'resolve',(clinic_prices.resolve(i.service_id,s.base_price,d,null)->>'price')::numeric
   from clinic_prices.items i join public.pricing_services s on s.id=i.service_id cross join (values(current_date),(date '2026-12-02')) v(d) where i.list_id=cl;
 insert into rc_base select i.service_id,d,'before_offer',(clinic_prices.resolve_before_offer(i.service_id,s.base_price,d,null)->>'price')::numeric
   from clinic_prices.items i join public.pricing_services s on s.id=i.service_id cross join (values(current_date),(date '2026-12-02')) v(d) where i.list_id=cl;
 select id into cid from public.contracting_entity_contracts order by id limit 1;
 if cid is null then raise exception 'no contract to link the temporary list to';end if;
 insert into clinic_prices.lists(name,version,mode,fallback,discount_percent,discount_amount,valid_from,valid_to,created_by,status,contract_id,list_kind,issue_year,application_year)
  values('اختبار لائحة عقد مفعّلة (يرجع)',1,'fixed','base',0,0,current_date-1,date '2027-12-31','bd5a528f-af8d-4ada-afe9-ce64e68b1d92','active',cid,'center',2026,2026) returning id into lid;
 insert into clinic_prices.items(list_id,service_id,fixed_price)
  select lid,b.sid,b.price+7 from rc_base b where b.d=current_date and b.via='before_offer' and b.price>0;
 insert into rc_out values('setup',jsonb_build_object('center_list',cl,'temp_contract_list',lid,'contract',cid,
   'items',(select count(*) from clinic_prices.items where list_id=lid),'baseline_rows',(select count(*) from rc_base)));
end $t$;
-- 3. before the patch (old lookup)
insert into rc_out select 'before_patch',jsonb_build_object(
 'old_lookup_sees_lists',(select count(*) from clinic_prices.lists where list_kind='center' and deleted_at is null and status='active' and current_date between valid_from and valid_to),
 'moved',(select count(*) from rc_base b join public.pricing_services s on s.id=b.sid
          where b.price is distinct from (case b.via when 'resolve' then clinic_prices.resolve(b.sid,s.base_price,b.d,null)
                                                   else clinic_prices.resolve_before_offer(b.sid,s.base_price,b.d,null) end->>'price')::numeric));
-- 4. the patch: byte-for-byte the DO block of supabase/migrations/20261126140000_resolve_center_list_no_contract.sql
do $mig$
declare
 fn regprocedure:=to_regprocedure('clinic_prices.resolve_before_offer(uuid,numeric,date,uuid)');
 src text;
 old_line constant text:='select id into lid from clinic_prices.lists where list_kind=''center'' and deleted_at is null and status=''active'' and p_date between valid_from and valid_to;';
 new_line constant text:='select id into lid from clinic_prices.lists where list_kind=''center'' and contract_id is null and deleted_at is null and status=''active'' and p_date between valid_from and valid_to order by valid_from desc,id limit 1;';
 n integer;
begin
 if fn is null then raise exception 'clinic_prices.resolve_before_offer is missing; apply 20261123160000 first';end if;
 select prosrc into src from pg_proc where oid=fn;
 if position(new_line in src)>0 then raise notice 'resolve_before_offer already patched (md5 %), nothing to do',md5(src);return;end if;
 n:=(length(src)-length(replace(src,old_line,'')))/length(old_line);
 if n<>1 then raise exception 'anchor found % times in resolve_before_offer (md5 %); refusing to patch',n,md5(src);end if;
 if md5(src)<>'08d04b4206e8f0018941edd70859b0a5' then raise notice 'resolve_before_offer md5 % differs from the repo body; anchor matched once, patching',md5(src);end if;
 execute format('create or replace function clinic_prices.resolve_before_offer(p_service uuid,p_base numeric,p_date date,p_contract uuid default null) returns jsonb language plpgsql stable security definer set search_path=pg_catalog,public as %L',replace(src,old_line,new_line));
 raise notice 'resolve_before_offer patched: % -> %',md5(src),(select md5(prosrc) from pg_proc where oid=fn);
end $mig$;
-- 5. after the patch
insert into rc_out select 'after_patch',jsonb_build_object(
 'body_has_filter',(select position('contract_id is null' in prosrc)>0 from pg_proc where oid='clinic_prices.resolve_before_offer(uuid,numeric,date,uuid)'::regprocedure),
 'body_md5',(select md5(prosrc) from pg_proc where oid='clinic_prices.resolve_before_offer(uuid,numeric,date,uuid)'::regprocedure),
 'moved',(select count(*) from rc_base b join public.pricing_services s on s.id=b.sid
          where b.price is distinct from (case b.via when 'resolve' then clinic_prices.resolve(b.sid,s.base_price,b.d,null)
                                                   else clinic_prices.resolve_before_offer(b.sid,s.base_price,b.d,null) end->>'price')::numeric),
 'checked',(select count(*) from rc_base));
do $chk$begin
 if (select (detail->>'moved')::int from rc_out where part='after_patch')<>0 then raise exception 'FAIL: cash prices moved after the patch: %',(select detail from rc_out where part='after_patch');end if;
 if not (select (detail->>'body_has_filter')::boolean from rc_out where part='after_patch') then raise exception 'FAIL: patched body lacks contract_id is null';end if;
end $chk$;
insert into rc_out values('verdict','"PASS: cash pricing ignores an active contract-linked center list"');
select part,detail from rc_out order by case part when 'setup' then 1 when 'before_patch' then 2 when 'after_patch' then 3 else 4 end;
rollback;
