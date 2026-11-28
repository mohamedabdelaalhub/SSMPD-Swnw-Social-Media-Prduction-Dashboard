-- «يوم العمل» (owner 2026-11-27): «اليوم عندي بيخلص بعد الساعة ١٢ ف طبيعي انه يبقي في شغل لليوم التالي ودا محتاج يتظبط» →
-- «موافق، ساعة القفل 4 الفجر ولكن عايز يبقي عندي اوبشن اغيرها بعدين».
-- ONE setting: clinic_reception.settings.business_day_cutoff (time, default 04:00, allowed 00:00–08:00). Anything before the cutoff
-- (Cairo time) belongs to the PREVIOUS working day.
--   * clinic_reception.business_day(ts default now()) = ((ts at time zone 'Africa/Cairo') - cutoff)::date — the one helper.
--   * clinic_reception.today() (the central "today" of the reception functions, 26 files) now = business_day(now()); its old body is
--     saved in clinic_reception.business_day_saved_defs for the rollback.
--   * public.clinic_reception_business_day('get') → {cutoff, today} for every signed-in user (the screens read it once);
--     ('set', {cutoff, reason}) → super_admin / general_manager only, reason ≥ 3 chars, logged in clinic_reception.business_day_changes
--     (old → new, who, when, why). No client table access.
-- NOT changed: clinic_reception.cairo_day(ts) (the CALENDAR day of a booking time — slots / capacity), booking times themselves, the
-- shift «stale» rule (16 hours after opening, not day based). Phase 2 moves the remaining bare current_date «today» sites per module.
-- Rollback: supabase/rollbacks/20261127340000_business_day.rollback.sql
do $$ begin
  if to_regclass('clinic_reception.business_day_saved_defs') is not null then raise exception 'تم تطبيق هذا الملف من قبل'; end if;
  if to_regprocedure('clinic_reception.today()') is null or to_regclass('clinic_reception.settings') is null then
    raise exception 'مكونات الاستقبال غير موجودة'; end if;
end $$;
begin;
create table clinic_reception.business_day_saved_defs(sig text primary key, def text not null, saved_at timestamptz not null default now());
alter table clinic_reception.business_day_saved_defs enable row level security;
revoke all on clinic_reception.business_day_saved_defs from public, anon, authenticated;
insert into clinic_reception.business_day_saved_defs(sig, def) values ('clinic_reception.today()', pg_get_functiondef('clinic_reception.today()'::regprocedure));

alter table clinic_reception.settings add column business_day_cutoff time not null default '04:00'
  check (business_day_cutoff between time '00:00' and time '08:00');

create table clinic_reception.business_day_changes(
  id bigint generated always as identity primary key,
  cutoff_old time not null, cutoff_new time not null,
  reason text not null check (length(btrim(reason)) >= 3),
  changed_by uuid not null references public.admins(id), changed_at timestamptz not null default now());
alter table clinic_reception.business_day_changes enable row level security;
revoke all on clinic_reception.business_day_changes from public, anon, authenticated;

create function clinic_reception.business_day_cutoff() returns time language sql stable security definer set search_path = pg_catalog, public as $$
  select coalesce((select business_day_cutoff from clinic_reception.settings where id), time '04:00')
$$;
create function clinic_reception.business_day(p_at timestamptz default now()) returns date
language sql stable security definer set search_path = pg_catalog, public as $$
  select ((p_at at time zone 'Africa/Cairo') - (clinic_reception.business_day_cutoff() - time '00:00'))::date
$$;
create or replace function clinic_reception.today() returns date language sql stable set search_path = pg_catalog as $f$
  select clinic_reception.business_day(now())
$f$;
revoke all on function clinic_reception.business_day_cutoff(), clinic_reception.business_day(timestamptz) from public, anon;
grant execute on function clinic_reception.business_day_cutoff(), clinic_reception.business_day(timestamptz) to authenticated;

create function public.clinic_reception_business_day(p_action text default 'get', p_payload jsonb default '{}'::jsonb) returns jsonb
language plpgsql security definer set search_path = pg_catalog, public as $$
declare me uuid := public.my_admin_id(); old time; new_cut time; why text;
begin
  if me is null then raise exception 'سجّل دخولك الأول'; end if;
  if coalesce(p_action, 'get') = 'get' then
    return jsonb_build_object('cutoff', to_char(clinic_reception.business_day_cutoff(), 'HH24:MI'), 'today', clinic_reception.business_day(now()),
      'can_set', public.has_role('super_admin') or public.has_role('general_manager'),
      'history', case when public.has_role('super_admin') or public.has_role('general_manager') then coalesce((select jsonb_agg(jsonb_build_object(
        'old', to_char(c.cutoff_old, 'HH24:MI'), 'new', to_char(c.cutoff_new, 'HH24:MI'), 'reason', c.reason, 'at', c.changed_at,
        'by', (select a.name from public.admins a where a.id = c.changed_by)) order by c.changed_at desc)
        from (select * from clinic_reception.business_day_changes order by changed_at desc limit 20) c), '[]'::jsonb) end);
  elsif p_action = 'set' then
    if not (public.has_role('super_admin') or public.has_role('general_manager')) then
      raise exception 'تغيير ساعة قفل اليوم للسوبر أدمن أو المدير العام بس'; end if;
    begin new_cut := (p_payload->>'cutoff')::time; exception when others then raise exception 'اكتب الساعة صح (مثلاً 04:00)'; end;
    if new_cut is null or new_cut < time '00:00' or new_cut > time '08:00' then raise exception 'ساعة القفل لازم تبقى من 00:00 لحد 08:00 الصبح'; end if;
    why := btrim(coalesce(p_payload->>'reason', ''));
    if length(why) < 3 then raise exception 'اكتب سبب التغيير'; end if;
    old := clinic_reception.business_day_cutoff();
    if old = new_cut then return jsonb_build_object('cutoff', to_char(old, 'HH24:MI'), 'changed', false); end if;
    update clinic_reception.settings set business_day_cutoff = new_cut where id;
    insert into clinic_reception.business_day_changes(cutoff_old, cutoff_new, reason, changed_by) values (old, new_cut, left(why, 300), me);
    return jsonb_build_object('cutoff', to_char(new_cut, 'HH24:MI'), 'changed', true, 'today', clinic_reception.business_day(now()));
  end if;
  raise exception 'إجراء غير معروف';
end $$;
revoke all on function public.clinic_reception_business_day(text, jsonb) from public, anon;
grant execute on function public.clinic_reception_business_day(text, jsonb) to authenticated;
commit;
