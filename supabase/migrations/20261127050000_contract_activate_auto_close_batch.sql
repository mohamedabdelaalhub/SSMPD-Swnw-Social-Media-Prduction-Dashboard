-- «تفعيل العقد» closes the entity list's import file by itself when nothing is left to decide (owner «طبّق شكل مراجعة
-- الملف», 2026-11-27, point 4 of mockup batch-review-plain.html). Builds on 20261127040000 (all-or-nothing activation).
-- Before decide_list, for the contract's linked list (draft/pending only):
--   * if any DRAFT import batch of that list still has an undecided row (not confirmed, not «مش عندنا» = deferred, not a
--     proposed new service) → refuse with «فاضل N سطر في ملف الاستيراد محتاج قرار في «مراجعة أسماء الجهات»؛ كمّلهم الأول»
--     (20261127040000 turns that into «العقد ماتفعلش ولا اتغير فيه حاجة: …»);
--   * otherwise every draft batch of that list is marked 'discarded' (exactly what «استبعاد دفعة الاستيراد بالكامل…»
--     does: rows already linked were written as list items when they were linked and stay; deferred/proposed rows only
--     leave the batch record), with one clinic_prices.audit row 'auto_close_batch' per batch.
-- Everything sits inside the list step, so a later refusal (e.g. the four-eyes source-review rule) rolls the auto-close
-- back too: nothing changes.
-- In-place anchored patch of the LIVE definition (expected: the 20261123080000 body patched by 20261127040000).
-- Refuses unless the anchor is found exactly once and 20261127040000 is applied. Running it twice is safe.
-- Rollback: supabase/rollbacks/20261127050000_contract_activate_auto_close_batch.rollback.sql
begin;
do $mig$
declare
 fn regprocedure := to_regprocedure('public.contracting_contract_activate(uuid)');
 def text; n int;
 old_frag constant text := $o$   if l.status in ('draft','pending') then perform clinic_prices.decide_list(l.id,'active','اعتماد مع تفعيل العقد');end if;$o$;
 new_frag constant text := $n$   if l.status in ('draft','pending') then
    -- 20261127050000: close the list's import file(s) when nothing is left to decide
    if exists(select 1 from clinic_prices.batches b2 cross join lateral jsonb_array_elements(b2.rows) r2
              where b2.list_id=l.id and b2.status='draft' and not coalesce((r2->>'confirmed')::boolean,false)
                and coalesce(r2->>'review_status','') not in ('deferred','proposed')) then
     raise exception 'فاضل % سطر في ملف الاستيراد محتاج قرار في «مراجعة أسماء الجهات»؛ كمّلهم الأول',
      (select count(*) from clinic_prices.batches b2 cross join lateral jsonb_array_elements(b2.rows) r2
        where b2.list_id=l.id and b2.status='draft' and not coalesce((r2->>'confirmed')::boolean,false)
          and coalesce(r2->>'review_status','') not in ('deferred','proposed'));
    end if;
    insert into clinic_prices.audit(actor_id,action,list_id,details)
     select me,'auto_close_batch',l.id,jsonb_build_object('batch_id',b2.id,'contract_id',c.id,'note','اتقفل مع تفعيل العقد',
       'rows',jsonb_array_length(b2.rows),'linked',(select count(*) from jsonb_array_elements(b2.rows) r2 where coalesce((r2->>'confirmed')::boolean,false)))
     from clinic_prices.batches b2 where b2.list_id=l.id and b2.status='draft';
    update clinic_prices.batches set status='discarded',revision=revision+1 where list_id=l.id and status='draft';
    perform clinic_prices.decide_list(l.id,'active','اعتماد مع تفعيل العقد');
   end if;$n$;
begin
 if fn is null then raise exception 'contracting_contract_activate is missing'; end if;
 def := pg_get_functiondef(fn);
 if position('-- 20261127050000:' in def) > 0 then raise notice 'already patched'; return; end if;
 if position('العقد ماتفعلش ولا اتغير فيه حاجة' in def) = 0 then raise exception 'apply 20261127040000 first (all-or-nothing activation)'; end if;
 n := (length(def) - length(replace(def, old_frag, ''))) / length(old_frag);
 if n <> 1 then raise exception 'anchor found % times (md5 %); refusing', n, (select md5(prosrc) from pg_proc where oid = fn); end if;
 execute replace(def, old_frag, new_frag);
end $mig$;
revoke all on function public.contracting_contract_activate(uuid) from public, anon;
grant execute on function public.contracting_contract_activate(uuid) to authenticated;
commit;
