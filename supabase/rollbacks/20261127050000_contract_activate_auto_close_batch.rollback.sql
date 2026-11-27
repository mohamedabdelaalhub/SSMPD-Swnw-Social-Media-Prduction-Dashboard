-- Rollback of 20261127050000: «تفعيل العقد» no longer closes the import file by itself (the list step again refuses
-- while a draft batch exists). Keeps 20261127040000. Safe to run twice.
begin;
do $rb$
declare
 fn regprocedure := to_regprocedure('public.contracting_contract_activate(uuid)');
 def text;
 old_frag constant text := $o$   if l.status in ('draft','pending') then perform clinic_prices.decide_list(l.id,'active','اعتماد مع تفعيل العقد');end if;$o$;
 new_frag constant text := $n$   if l.status in ('draft','pending') then
    -- 20261127050000: close the list's import file(s) when nothing is left to decide
    if exists(select 1 from clinic_prices.batches b2 cross join lateral jsonb_array_elements(b2.rows) r2
              where b2.list_id=l.id and b2.status='draft' and coalesce(r2->>'review_status','') not in ('deferred','proposed')
                and (not coalesce((r2->>'confirmed')::boolean,false)
                     or not exists(select 1 from clinic_prices.items i2 where i2.list_id=l.id and i2.service_id::text=r2->>'service_id'))) then
     raise exception 'فاضل % سطر في ملف الاستيراد محتاج قرار في «مراجعة أسماء الجهات»؛ كمّلهم الأول',
      (select count(*) from clinic_prices.batches b2 cross join lateral jsonb_array_elements(b2.rows) r2
        where b2.list_id=l.id and b2.status='draft' and coalesce(r2->>'review_status','') not in ('deferred','proposed')
          and (not coalesce((r2->>'confirmed')::boolean,false)
               or not exists(select 1 from clinic_prices.items i2 where i2.list_id=l.id and i2.service_id::text=r2->>'service_id')));
    end if;
    insert into clinic_prices.audit(actor_id,action,list_id,details)
     select me,'auto_close_batch',l.id,jsonb_build_object('batch_id',b2.id,'contract_id',c.id,'note','اتقفل مع تفعيل العقد',
       'rows',jsonb_array_length(b2.rows),'linked',(select count(*) from jsonb_array_elements(b2.rows) r2 where coalesce((r2->>'confirmed')::boolean,false)))
     from clinic_prices.batches b2 where b2.list_id=l.id and b2.status='draft';
    update clinic_prices.batches set status='discarded',revision=revision+1 where list_id=l.id and status='draft';
    perform clinic_prices.decide_list(l.id,'active','اعتماد مع تفعيل العقد');
   end if;$n$;
begin
 def := pg_get_functiondef(fn);
 if position(new_frag in def) = 0 then raise notice 'not patched, nothing to roll back'; return; end if;
 execute replace(def, new_frag, old_frag);
end $rb$;
revoke all on function public.contracting_contract_activate(uuid) from public, anon;
grant execute on function public.contracting_contract_activate(uuid) to authenticated;
commit;
