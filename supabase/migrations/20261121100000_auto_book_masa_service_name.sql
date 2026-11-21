-- Automatic bookings: use the service Masa already names (owner batch «صلح كل حاجة من فضلك», main chat 4, 2026-11-21, item 2).
-- A complete Masa booking (patient, age, doctor, date, service «كشف جديد», paid) still waited in «حجوزات تحتاج استكمال»
-- for «اختار خدمة الحجز» because auto_book_one ignored the Masa service text: it only used the per-doctor saved service, or
-- the doctor's department when it has exactly ONE «كشف…» service.
-- Now, before those two rules, the Masa / agent service text is matched to the doctor's own active services (his
-- department + his provider scopes): exact name after Arabic normalisation (أ/إ/آ→ا, ة→ه, ى→ي, spaces), else the
-- only service whose name starts with it. No match → the old rules, then staff review as before.
-- Not changed (owner decision 2026-11-20): a Masa booking stored day-only (00:00) still waits for staff to set the time.
-- auto_book_one is patched in place (one call replaced, anchor must occur once; old body saved). Waiting «service» reviews
-- are re-queued. Rollback: supabase/rollbacks/20261121100000_auto_book_masa_service_name.rollback.sql
begin;

do $$ begin
  if to_regprocedure('clinic_reception.auto_book_one(uuid)') is null then raise exception 'الحجز التلقائي غير موجود'; end if;
  if to_regprocedure('clinic_reception.auto_book_service_for(uuid,uuid,text)') is not null then raise exception 'تم تطبيق هذا الملف من قبل'; end if;
end $$;

create function clinic_reception.service_name_key(v text) returns text language sql immutable set search_path = pg_catalog as $$
  select regexp_replace(translate(lower(btrim(coalesce(v, ''))), 'أإآةى', 'اااهي'), '[[:space:]]+', ' ', 'g')
$$;

create function clinic_reception.auto_book_service_for(p_workspace uuid, p_provider uuid, p_needed text) returns uuid
language sql stable security definer set search_path = pg_catalog, public as $$
  with mine as (
    select s.id, clinic_reception.service_name_key(s.name) k from clinic_reception.services s
      join clinic_reception.providers pr on pr.id = p_provider
     where s.workspace_id = p_workspace and s.active
       and (s.department = pr.department
            or exists (select 1 from clinic_reception.provider_service_scopes sc where sc.provider_id = pr.id and sc.service_code = s.code))
  ), want as (select clinic_reception.service_name_key(p_needed) k)
  select coalesce(
    (select min(m.id::text)::uuid from mine m, want w where w.k <> '' and m.k = w.k having count(*) = 1),
    (select min(m.id::text)::uuid from mine m, want w where length(w.k) >= 3 and m.k like w.k || '%' having count(*) = 1),
    clinic_reception.auto_book_service(p_workspace, p_provider))
$$;
revoke all on function clinic_reception.service_name_key(text), clinic_reception.auto_book_service_for(uuid, uuid, text) from public, anon, authenticated;

create table if not exists clinic_reception.masa_service_saved_defs(name text primary key, def text not null);
revoke all on clinic_reception.masa_service_saved_defs from public, anon, authenticated;
do $$
declare d text; a constant text := 'clinic_reception.auto_book_service(ws, b.provider_id)';
begin
  d := pg_get_functiondef('clinic_reception.auto_book_one(uuid)'::regprocedure);
  if (length(d) - length(replace(d, a, ''))) / length(a) <> 1 then raise exception 'auto_book_one changed: service anchor not found once'; end if;
  insert into clinic_reception.masa_service_saved_defs values ('auto_book_one', d) on conflict (name) do update set def = excluded.def;
  execute replace(d, a, 'clinic_reception.auto_book_service_for(ws, b.provider_id, b.needed_service)');
end $$;

update clinic_reception.external_bookings set state = 'pending', review_kind = null, reason = null, updated_at = now()
 where state = 'review' and review_kind = 'service' and day >= (now() at time zone 'Africa/Cairo')::date;

commit;
