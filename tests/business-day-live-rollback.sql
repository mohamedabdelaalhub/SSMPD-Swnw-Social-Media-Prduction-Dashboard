-- Live rollback check for 20261127340000_business_day.sql («يوم العمل», owner 2026-11-27). ONE transaction ending in ROLLBACK, run as
-- postgres. Nothing is kept: no setting, no log row. Summary table LAST.
-- (a) before: today() = the calendar Cairo day. (b) the migration body. (c) business_day() at fixed moments around 04:00; today()
-- follows it; as Mazen (reception) 'get' works and 'set' is refused; as an active super_admin 'set' 03:00 works, is logged, and the
-- working day moves; then 'set' back to 04:00.
begin;
savepoint bday_live_guard;
select set_config('bday_live.in_txn', 'yes', true);
do $$ begin
  if current_setting('bday_live.in_txn', true) is distinct from 'yes' then
    raise exception 'NOT inside begin … rollback — nothing done; run the whole file as one transaction'; end if;
end $$;
create temp table bday_live(n serial, step text, expected text, actual text, ok boolean);
insert into bday_live(step, expected, actual, ok)
select '(a) before: today() vs calendar Cairo day', 'equal (calendar)', clinic_reception.today()::text || ' / ' || (now() at time zone 'Africa/Cairo')::date::text,
       clinic_reception.today() = (now() at time zone 'Africa/Cairo')::date;
-- >>> BEGIN migration body: supabase/migrations/20261127340000_business_day.sql (without begin / commit) <<<
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
-- >>> END migration body <<<
insert into bday_live(step, expected, actual, ok) values
 ('(c) cutoff after apply', '04:00', to_char(clinic_reception.business_day_cutoff(), 'HH24:MI'), clinic_reception.business_day_cutoff() = time '04:00'),
 ('(c) 28/11 01:30 Cairo → working day', '2026-11-27', clinic_reception.business_day('2026-11-27T23:30:00Z')::text, clinic_reception.business_day('2026-11-27T23:30:00Z') = date '2026-11-27'),
 ('(c) 28/11 03:59 Cairo → working day', '2026-11-27', clinic_reception.business_day('2026-11-28T01:59:00Z')::text, clinic_reception.business_day('2026-11-28T01:59:00Z') = date '2026-11-27'),
 ('(c) 28/11 04:00 Cairo → working day', '2026-11-28', clinic_reception.business_day('2026-11-28T02:00:00Z')::text, clinic_reception.business_day('2026-11-28T02:00:00Z') = date '2026-11-28'),
 ('(c) today() follows business_day(now())', 'equal', clinic_reception.today()::text || ' (now Cairo ' || to_char(now() at time zone 'Africa/Cairo', 'YYYY-MM-DD HH24:MI') || ')',
   clinic_reception.today() = clinic_reception.business_day(now())),
 ('(c) cairo_day (calendar, bookings) unchanged', '2026-11-28', clinic_reception.cairo_day('2026-11-27T23:30:00Z')::text, clinic_reception.cairo_day('2026-11-27T23:30:00Z') = date '2026-11-28');
do $$ declare mazen uuid := 'f0891d2c-44b5-4dd8-80e0-8035f2e4b5eb'; sa uuid; r jsonb; err text;
begin
  if not exists (select 1 from public.admins where id = mazen) then
    select a.id into mazen from public.admins a where a.role = 'reception' and a.active order by a.id limit 1; end if;
  select a.id into sa from public.admins a where a.role = 'super_admin' and a.active and a.id <> mazen order by a.id limit 1;
  -- as Mazen (reception)
  perform set_config('request.jwt.claims', jsonb_build_object('sub', mazen, 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.sub', mazen::text, true);
  perform set_config('test.admin', mazen::text, true);
  begin r := public.clinic_reception_business_day('get', '{}'::jsonb); err := 'cutoff ' || (r->>'cutoff') || ', can_set ' || (r->>'can_set');
  exception when others then err := 'ERROR ' || sqlerrm; end;
  insert into bday_live(step, expected, actual, ok) values ('(c) Mazen get', 'cutoff 04:00, can_set false', err, err = 'cutoff 04:00, can_set false');
  begin perform public.clinic_reception_business_day('set', '{"cutoff":"03:00","reason":"تجربة"}'::jsonb); err := 'ACCEPTED';
  exception when others then err := sqlerrm; end;
  insert into bday_live(step, expected, actual, ok) values ('(c) Mazen set (must be refused)', 'refused: للسوبر أدمن أو المدير العام بس', err, err like '%للسوبر أدمن أو المدير العام بس%');
  -- as a super admin
  if sa is null then insert into bday_live(step, expected, actual, ok) values ('(c) super admin set', 'info', 'no active super_admin besides Mazen', true); return; end if;
  perform set_config('request.jwt.claims', jsonb_build_object('sub', sa, 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.sub', sa::text, true);
  perform set_config('test.admin', sa::text, true);
  begin r := public.clinic_reception_business_day('set', '{"cutoff":"03:00","reason":"تجربة الدراي رن"}'::jsonb); err := 'changed ' || (r->>'changed') || ' → ' || (r->>'cutoff');
  exception when others then err := 'ERROR ' || sqlerrm; end;
  insert into bday_live(step, expected, actual, ok) values ('(c) super admin set 03:00', 'changed true → 03:00', err, err = 'changed true → 03:00');
  insert into bday_live(step, expected, actual, ok) select '(c) logged (old → new, reason)', '04:00 → 03:00',
    to_char(c.cutoff_old, 'HH24:MI') || ' → ' || to_char(c.cutoff_new, 'HH24:MI') || ' · ' || c.reason, c.cutoff_old = time '04:00' and c.cutoff_new = time '03:00'
    from clinic_reception.business_day_changes c order by c.id desc limit 1;
  insert into bday_live(step, expected, actual, ok) values ('(c) 28/11 03:30 Cairo with 03:00 cutoff', '2026-11-28',
    clinic_reception.business_day('2026-11-28T01:30:00Z')::text, clinic_reception.business_day('2026-11-28T01:30:00Z') = date '2026-11-28');
  begin r := public.clinic_reception_business_day('set', '{"cutoff":"09:00","reason":"تجربة"}'::jsonb); err := 'ACCEPTED';
  exception when others then err := sqlerrm; end;
  insert into bday_live(step, expected, actual, ok) values ('(c) 09:00 refused', 'refused: من 00:00 لحد 08:00', err, err like '%من 00:00 لحد 08:00%');
  perform set_config('request.jwt.claims', '', true); perform set_config('request.jwt.claim.sub', '', true); perform set_config('test.admin', '', true);
end $$;
select step, expected, actual, ok from bday_live order by n;
rollback;
