-- Live rollback check for 20261128020000_payment_reference_free.sql («رقم العملية من الصورة»). ONE transaction ending in ROLLBACK, as
-- postgres. As Mazen (reception, auth sub f0891d2c…): an existing live reference comes back with -2 (or the next free), a new one comes
-- back as is, bad input is refused. Nothing is written. Summary table LAST.
begin;
savepoint rf_live_guard;
select set_config('rf_live.in_txn', 'yes', true);
do $$ begin
  if current_setting('rf_live.in_txn', true) is distinct from 'yes' then
    raise exception 'NOT inside begin … rollback — nothing done; run the whole file as one transaction'; end if;
end $$;
create temp table rf_live(n serial, step text, expected text, actual text, ok boolean);
grant select, insert on rf_live to authenticated;
grant usage, select on sequence rf_live_n_seq to authenticated;
-- >>> BEGIN migration body: supabase/migrations/20261128020000_payment_reference_free.sql (without begin / commit) <<<
-- «رقم العملية من الصورة» (owner 2026-11-28 «الله عليك. وعايز الكلام دا يتسجل اوتوماتيك بعد كدة في وسايل الدفع دي», mockup
-- docs/ui-references/mockups/receipt-ocr.html on claude/receipt-ocr-mockup). When the receipt photo has no transaction number the
-- screen suggests a reference: wallets VF-<sender mobile>-<dd-mm>, any method <letter>-<file no>-<dd-mm>. It must never repeat:
-- public.clinic_reception_reference_free(p_method, p_base) returns p_base, or p_base-2, -3 … — the first one no reception payment
-- of the same method group already uses (the same grouping as the existing unique index payments(workspace_id, bank|instapay → bank,
-- reference), checked across workspaces). Read-only; any signed-in user; no table access. The server's existing duplicate refusal
-- stays the final guard.
-- Rollback: supabase/rollbacks/20261128020000_payment_reference_free.rollback.sql
do $$ begin
  if to_regprocedure('public.clinic_reception_reference_free(text,text)') is not null then raise exception 'تم تطبيق هذا الملف من قبل'; end if;
  if to_regclass('clinic_reception.payments') is null then raise exception 'جدول التحصيلات غير موجود'; end if;
end $$;
create function public.clinic_reception_reference_free(p_method text, p_base text) returns text
language plpgsql stable security definer set search_path = pg_catalog, public as $$
declare base text := btrim(coalesce(p_base, '')); grp text := case when p_method in ('bank', 'instapay') then 'bank' else coalesce(p_method, '') end;
  cand text; n int := 1;
begin
  if public.my_admin_id() is null then raise exception 'سجّل دخولك الأول'; end if;
  if length(base) < 3 or length(base) > 55 or base !~ '^[A-Za-z0-9-]+$' then raise exception 'مرجع غير صالح'; end if;
  loop
    cand := case when n = 1 then base else base || '-' || n end;
    exit when not exists (select 1 from clinic_reception.payments p
      where (case when p.method in ('bank', 'instapay') then 'bank' else p.method end) = grp and p.reference = cand);
    n := n + 1;
    if n > 99 then raise exception 'المرجع ده متكرر كتير — اكتبه بإيدك'; end if;
  end loop;
  return cand;
end $$;
revoke all on function public.clinic_reception_reference_free(text, text) from public, anon;
grant execute on function public.clinic_reception_reference_free(text, text) to authenticated;
-- >>> END migration body <<<
do $$ declare mazen_sub uuid := 'f0891d2c-44b5-4dd8-80e0-8035f2e4b5eb'; live boolean; adm uuid; ex record; r text; err text;
begin
  live := exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'admins' and column_name = 'user_id');
  if live then execute 'select id from public.admins where user_id = $1 and active limit 1' into adm using mazen_sub;
  else select a.id into adm from public.admins a where a.role = 'reception' and a.active limit 1; mazen_sub := adm; end if;
  select p.method, p.reference into ex from clinic_reception.payments p where p.method <> 'cash' and p.reference ~ '^[A-Za-z0-9-]{3,50}$'
   order by p.created_at desc limit 1;
  perform set_config('request.jwt.claims', json_build_object('sub', mazen_sub, 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.sub', mazen_sub::text, true);
  perform set_config('test.admin', coalesce(adm::text, ''), true);
  execute 'set local role authenticated';
  if ex.reference is not null then
    begin r := public.clinic_reception_reference_free(ex.method, ex.reference); err := r; exception when others then err := 'ERROR ' || sqlerrm; end;
    insert into rf_live(step, expected, actual, ok) values ('Mazen: an existing live ' || ex.method || ' reference', ex.reference || '-2 (or next free)', err,
      err like ex.reference || '-%' and err <> ex.reference);
  else
    insert into rf_live(step, expected, actual, ok) values ('Mazen: an existing live reference', 'info', 'no non-cash payment with a plain reference yet', true);
  end if;
  begin r := public.clinic_reception_reference_free('instapay', 'IP-999999-01-01'); err := r; exception when others then err := 'ERROR ' || sqlerrm; end;
  insert into rf_live(step, expected, actual, ok) values ('Mazen: a new reference', 'IP-999999-01-01', err, err = 'IP-999999-01-01');
  begin r := public.clinic_reception_reference_free('pos', 'x'); err := 'ACCEPTED'; exception when others then err := sqlerrm; end;
  insert into rf_live(step, expected, actual, ok) values ('Mazen: bad input', 'refused: مرجع غير صالح', err, err like '%مرجع غير صالح%');
  execute 'reset role';
  perform set_config('request.jwt.claims', '', true); perform set_config('request.jwt.claim.sub', '', true); perform set_config('test.admin', '', true);
end $$;
select step, expected, actual, ok from rf_live order by n;
rollback;
