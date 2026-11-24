-- Auto booking must never put an arbitrary PROCEDURE on a booking whose service is unknown (owner bug 2026-11-24 21:20Z,
-- relayed by main chat 5: an ENT follow-up came in from «الحجز التلقائي» as «أخذ عينة من الأذن تحت مخدر موضعي — 500»).
-- Cause: clinic_reception.auto_time_service (20261122330000), used by every auto-booking path since 20261122340000, falls
-- back to (3) the doctor's MOST USED service — any kind — and then (4) the first service of his department ordered by
-- «name like '%كشف%'» then minutes then name. A department with no «كشف…» service (ENT names it «استشارة…») got the
-- shortest, alphabetically first service: «أخذ عينة…».
-- Now steps 3 and 4 only consider consultation-type services (name contains كشف / استشار / متابع), preferring «كشف», then
-- «استشارة», then «متابعة». When the department has none, the function returns NULL and the booking goes to staff review
-- 'service' («اختار خدمة الحجز للدكتور ده مرة واحدة وهتتحفظ») — the choice is saved for that doctor, as before.
-- Steps 1–2 are unchanged: a service the source NAMES (Masa / agent text) and the doctor's SAVED service are still used.
-- Existing appointments are not touched (main chat reports the open ones read-only).
-- Rollback: supabase/rollbacks/20261124210000_auto_book_consult_only.rollback.sql
begin;

do $$ begin
  if to_regprocedure('clinic_reception.auto_time_service(uuid,uuid,text)') is null then raise exception 'طبّق 20261122330000 أولاً'; end if;
  if exists (select 1 from clinic_reception.auto_time_saved_defs where name = 'auto_time_service_before_consult') then
    raise exception 'تم تطبيق هذا الملف من قبل'; end if;
  insert into clinic_reception.auto_time_saved_defs
    values ('auto_time_service_before_consult', pg_get_functiondef('clinic_reception.auto_time_service(uuid,uuid,text)'::regprocedure));
end $$;

-- consultation-type service name (normalised: أ/إ/آ→ا, ة→ه)
create function clinic_reception.is_consult_name(p_name text) returns boolean
language sql immutable set search_path = pg_catalog as $$
  select translate(coalesce(p_name, ''), 'أإآة', 'ااه') ~ '(كشف|استشار|متابع)'
$$;
create function clinic_reception.consult_rank(p_name text) returns int
language sql immutable set search_path = pg_catalog as $$
  select case when p_name like '%كشف%' then 0 when translate(p_name, 'أإآ', 'ااا') like '%استشار%' then 1 else 2 end
$$;
revoke all on function clinic_reception.is_consult_name(text), clinic_reception.consult_rank(text) from public, anon, authenticated;

create or replace function clinic_reception.auto_time_service(p_workspace uuid, p_provider uuid, p_needed text) returns uuid
language plpgsql stable security definer set search_path = pg_catalog, public as $$
declare v uuid; dept text;
begin
  select department into dept from clinic_reception.providers where id = p_provider and workspace_id = p_workspace;
  if dept is null then return null; end if;
  -- 1) the service the source names, 2) the doctor's saved service (unchanged)
  if to_regprocedure('clinic_reception.auto_book_service_for(uuid,uuid,text)') is not null then
    execute 'select clinic_reception.auto_book_service_for($1, $2, $3)' into v using p_workspace, p_provider, p_needed;
    if v is not null and exists (select 1 from clinic_reception.services where id = v and active and department = dept) then return v; end if;
  end if;
  v := clinic_reception.auto_book_service(p_workspace, p_provider);
  if v is not null and exists (select 1 from clinic_reception.services where id = v and active and department = dept) then return v; end if;
  -- 3) the doctor's most used CONSULTATION service
  select x.service_id into v from clinic_reception.appointments x join clinic_reception.services s on s.id = x.service_id
   where x.provider_id = p_provider and s.active and s.department = dept and x.status not in ('cancelled')
     and clinic_reception.is_consult_name(s.name)
   group by x.service_id order by count(*) desc, min(clinic_reception.consult_rank(s.name)) limit 1;
  if v is not null then return v; end if;
  -- 4) the department's consultation service (كشف, then استشارة, then متابعة); none → NULL = staff picks it once
  select s.id into v from clinic_reception.services s where s.workspace_id = p_workspace and s.active and s.department = dept
     and clinic_reception.is_consult_name(s.name)
   order by clinic_reception.consult_rank(s.name), s.minutes, s.name limit 1;
  return v;
end $$;
revoke all on function clinic_reception.auto_time_service(uuid, uuid, text) from public, anon, authenticated;

commit;
