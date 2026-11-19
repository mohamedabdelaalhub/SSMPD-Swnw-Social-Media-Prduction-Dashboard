-- Owner 2026-11-19 («موافق، اعمل التعديل بتاع الرسالة»): opening a reception shift failed with the generic
-- «حصلت مشكلة ومقدرناش نكمل العملية». The server error was the English unique-index violation
-- (fin_register_active / fin_cashier_active: one shift per register and per cashier until finance reviews it),
-- and the screen only shows Arabic errors. This trigger checks the same two rules first and says, in Arabic,
-- which shift blocks the new one and what to do. No rule changes: the unique indexes stay the source of truth.
-- Rollback: supabase/rollbacks/20261120090000_shift_open_clear_message.rollback.sql
begin;

do $$ begin
  if to_regclass('clinic_finance.shifts') is null then raise exception 'جدول الورديات غير موجود'; end if;
  if to_regprocedure('clinic_finance.shift_single_active_message()') is not null then raise exception 'تم تطبيق هذا الملف من قبل'; end if;
end $$;

create function clinic_finance.shift_single_active_message() returns trigger
language plpgsql security definer set search_path = pg_catalog, public as $$
declare s record; what text;
begin
  select sh.status, sh.opened_at, coalesce(a.name, 'موظف') as who, coalesce(r.name, 'الخزينة') as reg into s
    from clinic_finance.shifts sh left join public.admins a on a.id = sh.cashier_id left join clinic_finance.registers r on r.id = sh.register_id
    where sh.register_id = new.register_id and sh.status <> 'reviewed' and sh.id <> new.id
    order by sh.opened_at desc limit 1;
  if found then
    what := case when s.status = 'open' then 'لسه مفتوحة' else 'اتسلّمت ومستنية المراجعة المالية' end;
    raise exception 'الخزينة دي عليها وردية % (باسم %، اتفتحت %). %', what, s.who,
      to_char(s.opened_at at time zone 'Africa/Cairo', 'DD/MM HH24:MI'),
      case when s.status = 'open' then 'اقفلها الأول بـ«جرد وتسليم»، وبعدين افتح وردية جديدة.'
           else 'لازم المالية تراجعها الأول، وبعدين تقدر تفتح وردية جديدة على الخزينة دي.' end
      using errcode = '23505';
  end if;
  select sh.status, sh.opened_at, coalesce(r.name, 'خزينة') as reg into s
    from clinic_finance.shifts sh left join clinic_finance.registers r on r.id = sh.register_id
    where sh.cashier_id = new.cashier_id and sh.status <> 'reviewed' and sh.id <> new.id
    order by sh.opened_at desc limit 1;
  if found then
    raise exception 'عندك وردية تانية % على «%» (اتفتحت %). %',
      case when s.status = 'open' then 'لسه مفتوحة' else 'اتسلّمت ومستنية المراجعة المالية' end, s.reg,
      to_char(s.opened_at at time zone 'Africa/Cairo', 'DD/MM HH24:MI'),
      case when s.status = 'open' then 'اقفلها الأول بـ«جرد وتسليم».' else 'لازم المالية تراجعها الأول، وبعدين تقدر تفتح وردية جديدة.' end
      using errcode = '23505';
  end if;
  return new;
end $$;
revoke all on function clinic_finance.shift_single_active_message() from public, anon, authenticated;
create trigger shift_single_active_message before insert on clinic_finance.shifts
  for each row execute function clinic_finance.shift_single_active_message();

commit;
