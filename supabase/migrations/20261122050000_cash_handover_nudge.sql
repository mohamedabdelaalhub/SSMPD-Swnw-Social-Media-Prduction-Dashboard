-- «سلّم الكاش» nudge (owner 2026-11-21): from «خزن التحصيل المفتوحة» the finance reviewer asks a cashier to hand over; the cashier gets a
-- popup whose button opens the handover modal directly (main treasury preselected). A NUDGE ONLY: it moves no money, counts nothing and
-- never acts for the cashier — the cashier still counts and sends, and the main custodian still approves (existing rules).
--   clinic_finance.handover_nudges            one row per request (RLS on, no grants: reached only through the functions below)
--   public.clinic_finance_handover_nudge(shift, note)   review right; target = an open collection shift (not main, not ended); one open nudge per shift
--   public.clinic_finance_my_handover_nudges()          the caller's open nudges (shift still open and not ended)
--   public.clinic_finance_handover_nudge_seen(id)       the cashier dismisses («بعدين») or opens the handover
-- Rollback: supabase/rollbacks/20261122050000_cash_handover_nudge.rollback.sql
begin;

do $$ begin
  if to_regprocedure('public.clinic_finance_open_drawers()') is null then raise exception 'طبّق ملف 20261122010000 (خزن التحصيل المفتوحة) أولًا'; end if;
  if to_regclass('clinic_finance.handover_nudges') is not null then raise exception 'تم تطبيق هذا الملف من قبل'; end if;
end $$;

create table clinic_finance.handover_nudges (
  id uuid primary key default gen_random_uuid(),
  shift_id uuid not null references clinic_finance.shifts(id) on delete cascade,
  to_admin uuid not null references public.admins(id),
  from_admin uuid not null references public.admins(id),
  note text not null default '' check (length(note) <= 300),
  created_at timestamptz not null default now(),
  seen_at timestamptz
);
create unique index handover_nudges_one_open on clinic_finance.handover_nudges (shift_id) where seen_at is null;
alter table clinic_finance.handover_nudges enable row level security;
revoke all on clinic_finance.handover_nudges from public, anon, authenticated;

create function public.clinic_finance_handover_nudge(p_shift uuid, p_note text) returns jsonb language plpgsql security definer set search_path = pg_catalog, public as $$
declare me uuid; s clinic_finance.shifts%rowtype; n clinic_finance.handover_nudges%rowtype;
begin
  me := clinic_finance.require_access('review');
  select * into s from clinic_finance.shifts where id = p_shift;
  if not found or s.status <> 'open' or s.is_main or s.ended_at is not null then raise exception 'الوردية دي مش مفتوحة للتحصيل دلوقتي'; end if;
  if s.cashier_id = me then raise exception 'دي ورديتك أنت'; end if;
  select * into n from clinic_finance.handover_nudges where shift_id = s.id and seen_at is null;
  if found then return jsonb_build_object('id', n.id, 'replayed', true); end if;
  insert into clinic_finance.handover_nudges(shift_id, to_admin, from_admin, note) values (s.id, s.cashier_id, me, left(btrim(coalesce(p_note, '')), 300)) returning * into n;
  insert into clinic_finance.audit(actor, action, entity_id, detail) values (me, 'handover_nudge', s.id, jsonb_build_object('nudge', n.id, 'to', s.cashier_id));
  return jsonb_build_object('id', n.id, 'replayed', false);
end $$;

create function public.clinic_finance_my_handover_nudges() returns jsonb language plpgsql stable security definer set search_path = pg_catalog, public as $$
declare me uuid := public.my_admin_id();
begin
  if me is null then return '[]'::jsonb; end if;
  return coalesce((select jsonb_agg(jsonb_build_object('id', n.id, 'shift_id', n.shift_id, 'register', r.name, 'from_name', coalesce(nullif(trim(a.name), ''), 'المسؤول'),
      'note', n.note, 'created_at', n.created_at) order by n.created_at)
    from clinic_finance.handover_nudges n join clinic_finance.shifts s on s.id = n.shift_id join clinic_finance.registers r on r.id = s.register_id
    left join public.admins a on a.id = n.from_admin
    where n.to_admin = me and n.seen_at is null and s.status = 'open' and s.ended_at is null), '[]'::jsonb);
end $$;

create function public.clinic_finance_handover_nudge_seen(p_id uuid) returns void language plpgsql security definer set search_path = pg_catalog, public as $$
begin
  update clinic_finance.handover_nudges set seen_at = now() where id = p_id and to_admin = public.my_admin_id() and seen_at is null;
end $$;

revoke all on function public.clinic_finance_handover_nudge(uuid, text), public.clinic_finance_my_handover_nudges(), public.clinic_finance_handover_nudge_seen(uuid) from public, anon;
grant execute on function public.clinic_finance_handover_nudge(uuid, text), public.clinic_finance_my_handover_nudges(), public.clinic_finance_handover_nudge_seen(uuid) to authenticated;

commit;
