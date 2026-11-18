-- Owner 2026-11-18: «تسليم تحصيل لزميل» — a reception cashier hands collected cash to a colleague's open collection shift, either mid-shift
-- (one of two on the same shift leaves) or at the end of the shift (hand everything to the next shift). Until now the only handover was to the
-- main treasury («إنهاء الوردية» → treasury_transfers → the main custodian confirms).
-- Rules:
--   * sender: own OPEN, non-main shift. Mid-shift: amount ≤ proven cash (clinic_finance.cash_limit) minus other pending peer handovers.
--     End of shift (end_shift=true + denomination counts): the shift stops collecting (ended_at), amount = the counted total, any count
--     difference becomes a cash case for review (same as the main-treasury end flow).
--   * receiver: another person's OPEN, not-ended, non-main shift. Nothing moves until the RECEIVER confirms the counted amount («استلمت»).
--     Reject → nothing moves (an ended sender shift is reopened for a recount). The sender may cancel while pending.
--   * on accept: two entries through the transit account 1119 exactly like the main-treasury handover — treasury_transfer_out on the sender
--     shift (allowed by cash_line_guard), treasury_peer_in on the receiver shift; an ended sender shift is then submitted with count 0.
--   * a shift with a pending peer handover cannot be closed or handed to the main treasury, and vice versa.
-- Rollback: supabase/rollbacks/20261118160000_peer_cash_handover.rollback.sql
begin;

do $$ begin
  if to_regclass('clinic_finance.treasury_transfers') is null or to_regprocedure('clinic_finance.cash_limit(uuid)') is null
     or to_regprocedure('clinic_finance.booking_access(text)') is null or to_regprocedure('public.clinic_finance_shift_movements(uuid,date,date,uuid,uuid)') is null then
    raise exception 'مكونات الخزينة والورديات غير موجودة';
  end if;
  if to_regclass('clinic_finance.peer_handovers') is not null then raise exception 'تم تطبيق هذا الملف من قبل'; end if;
end $$;

create table clinic_finance.peer_handovers (
  id uuid primary key default gen_random_uuid(),
  from_shift uuid not null references clinic_finance.shifts(id),
  to_shift uuid not null references clinic_finance.shifts(id),
  amount numeric(14,2) not null check (amount > 0),
  end_of_shift boolean not null default false,
  note text not null default '' check (length(note) <= 500),
  status text not null default 'pending' check (status in ('pending','accepted','rejected','cancelled')),
  created_by uuid not null references public.admins(id),
  token uuid not null,
  created_at timestamptz not null default now(),
  decided_by uuid references public.admins(id),
  decided_at timestamptz,
  decision_note text,
  check (from_shift <> to_shift),
  unique (created_by, token)
);
create index peer_handovers_to_pending on clinic_finance.peer_handovers(to_shift) where status = 'pending';
create index peer_handovers_from_pending on clinic_finance.peer_handovers(from_shift) where status = 'pending';
alter table clinic_finance.peer_handovers enable row level security;
revoke all on clinic_finance.peer_handovers from public, anon, authenticated;

-- no close / main handover while a peer handover is pending on that shift
create function clinic_finance.peer_pending_guard() returns trigger language plpgsql security definer set search_path = pg_catalog, public as $$
begin
  if tg_table_name = 'shifts' then
    if new.status is distinct from old.status and exists (select 1 from clinic_finance.peer_handovers where status = 'pending' and (from_shift = new.id or to_shift = new.id)) then
      raise exception 'فيه تسليم لزميل معلّق على الوردية؛ استنى الاستلام أو الغيه الأول';
    end if;
  elsif exists (select 1 from clinic_finance.peer_handovers where status = 'pending' and from_shift = new.from_shift) then
    raise exception 'فيه تسليم لزميل معلّق على الوردية؛ استنى الاستلام أو الغيه الأول';
  end if;
  return new;
end $$;
revoke all on function clinic_finance.peer_pending_guard() from public, anon, authenticated;
create trigger peer_pending_shift_guard before update of status on clinic_finance.shifts for each row execute function clinic_finance.peer_pending_guard();
create trigger peer_pending_transfer_guard before insert on clinic_finance.treasury_transfers for each row execute function clinic_finance.peer_pending_guard();

create function clinic_finance.peer_json(h clinic_finance.peer_handovers) returns jsonb language sql stable security definer set search_path = pg_catalog, public as $$
  select to_jsonb(h) || jsonb_build_object(
    'from_name', (select coalesce(nullif(trim(a.name), ''), 'موظف') from clinic_finance.shifts s join public.admins a on a.id = s.cashier_id where s.id = h.from_shift),
    'to_name', (select coalesce(nullif(trim(a.name), ''), 'موظف') from clinic_finance.shifts s join public.admins a on a.id = s.cashier_id where s.id = h.to_shift),
    'from_register', (select r.name from clinic_finance.shifts s join clinic_finance.registers r on r.id = s.register_id where s.id = h.from_shift),
    'to_register', (select r.name from clinic_finance.shifts s join clinic_finance.registers r on r.id = s.register_id where s.id = h.to_shift))
$$;
revoke all on function clinic_finance.peer_json(clinic_finance.peer_handovers) from public, anon, authenticated;

create function public.clinic_finance_peer_handover(p_action text, p_payload jsonb, p_token uuid)
returns jsonb language plpgsql security definer set search_path = pg_catalog, public as $$
declare me uuid := public.my_admin_id(); s clinic_finance.shifts%rowtype; t clinic_finance.shifts%rowtype; h clinic_finance.peer_handovers%rowtype;
  amt numeric; reserved numeric; total numeric := 0; j record; e uuid; expected numeric; msg text;
begin
  if me is null or not exists (select 1 from public.admins where id = me and active) then raise exception 'سجل الدخول' using errcode = '42501'; end if;
  p_payload := coalesce(p_payload, '{}'::jsonb);

  if p_action = 'inbox' then   -- cheap poll: pending handovers to my open shift + my own pending ones
    return jsonb_build_object(
      'incoming', coalesce((select jsonb_agg(clinic_finance.peer_json(x) order by x.created_at) from clinic_finance.peer_handovers x join clinic_finance.shifts sh on sh.id = x.to_shift
                            where x.status = 'pending' and sh.cashier_id = me), '[]'::jsonb),
      'outgoing', coalesce((select jsonb_agg(clinic_finance.peer_json(x) order by x.created_at) from clinic_finance.peer_handovers x join clinic_finance.shifts sh on sh.id = x.from_shift
                            where x.status = 'pending' and sh.cashier_id = me), '[]'::jsonb));
  end if;

  perform clinic_finance.booking_access('create');
  perform clinic_finance.lock_day();

  if p_action = 'options' then
    select * into s from clinic_finance.shifts where cashier_id = me and status = 'open' and not is_main and ended_at is null order by opened_at desc limit 1;
    if not found then return jsonb_build_object('shift', null, 'colleagues', '[]'::jsonb); end if;
    select coalesce(sum(amount), 0) into reserved from clinic_finance.peer_handovers where from_shift = s.id and status = 'pending';
    return jsonb_build_object('shift', jsonb_build_object('id', s.id, 'register', (select name from clinic_finance.registers where id = s.register_id),
        'cash', clinic_finance.shift_cash(s.id), 'available', greatest(0, clinic_finance.cash_limit(s.id) - reserved)),
      'colleagues', coalesce((select jsonb_agg(jsonb_build_object('shift_id', x.id, 'name', coalesce(nullif(trim(a.name), ''), 'موظف'), 'register', r.name, 'opened_at', x.opened_at) order by a.name)
        from clinic_finance.shifts x join public.admins a on a.id = x.cashier_id and a.active join clinic_finance.registers r on r.id = x.register_id
        where x.status = 'open' and not x.is_main and x.ended_at is null and x.cashier_id <> me), '[]'::jsonb));

  elsif p_action = 'request' then
    if p_token is null then raise exception 'مفتاح العملية مطلوب'; end if;
    select * into h from clinic_finance.peer_handovers where created_by = me and token = p_token;
    if found then return clinic_finance.peer_json(h); end if;
    select * into s from clinic_finance.shifts where id = (p_payload->>'from_shift')::uuid for update;
    if not found or s.cashier_id <> me or s.status <> 'open' or s.is_main or s.ended_at is not null then raise exception 'اختار ورديتك المفتوحة'; end if;
    select * into t from clinic_finance.shifts where id = (p_payload->>'to_shift')::uuid for update;
    if not found or t.cashier_id = me or t.status <> 'open' or t.is_main or t.ended_at is not null then raise exception 'الزميل لازم يكون فاتح ورديته'; end if;
    if exists (select 1 from clinic_finance.treasury_transfers where from_shift = s.id and status = 'pending') then raise exception 'فيه تسليم للخزينة الرئيسية معلّق على ورديتك'; end if;
    msg := left(trim(coalesce(p_payload->>'note', '')), 500);
    if coalesce((p_payload->>'end_shift')::boolean, false) then
      if exists (select 1 from clinic_finance.peer_handovers where from_shift = s.id and status = 'pending') then raise exception 'فيه تسليم معلّق؛ استنى الاستلام أو الغيه الأول'; end if;
      if clinic_finance.has_pending_shift(s.id) then raise exception 'راجع طلبات الوردية المعلقة أولًا'; end if;
      if jsonb_typeof(p_payload->'counts') is distinct from 'object' or p_payload->'counts' = '{}'::jsonb then raise exception 'أدخل جرد الفئات النقدية'; end if;
      for j in select key, value from jsonb_each_text(p_payload->'counts') loop
        if j.key not in ('200','100','50','20','10','5','1','0.5','0.25') or j.value is null or j.value !~ '^[0-9]{1,7}$' then raise exception 'فئات أو أعداد غير صالحة'; end if;
        total := total + j.key::numeric * j.value::numeric;
      end loop;
      if total <= 0 then raise exception 'مفيش كاش تسلّمه؛ اقفل الوردية عادي'; end if;
      expected := clinic_finance.shift_cash(s.id);
      update clinic_finance.shifts set ended_at = now(), end_counted = total, end_expected = expected, end_counts = p_payload->'counts', note = coalesce(nullif(msg, ''), note) where id = s.id;
      insert into clinic_finance.peer_handovers(from_shift, to_shift, amount, end_of_shift, note, created_by, token) values (s.id, t.id, total, true, msg, me, p_token) returning * into h;
    else
      amt := nullif(p_payload->>'amount', '')::numeric;
      select coalesce(sum(amount), 0) into reserved from clinic_finance.peer_handovers where from_shift = s.id and status = 'pending';
      if amt is null or amt <= 0 or amt <> round(amt, 2) or amt::text in ('NaN','Infinity','-Infinity') then raise exception 'اكتب المبلغ صح'; end if;
      if amt + reserved > clinic_finance.cash_limit(s.id) then raise exception 'المبلغ أكبر من الكاش اللي في ورديتك (المتاح %)', greatest(0, clinic_finance.cash_limit(s.id) - reserved); end if;
      insert into clinic_finance.peer_handovers(from_shift, to_shift, amount, note, created_by, token) values (s.id, t.id, amt, msg, me, p_token) returning * into h;
    end if;
    insert into clinic_finance.audit(actor, action, entity_id, detail) values (me, 'peer_handover_request', h.id, clinic_finance.peer_json(h));
    return clinic_finance.peer_json(h);

  elsif p_action in ('accept', 'reject', 'cancel') then
    select * into h from clinic_finance.peer_handovers where id = (p_payload->>'id')::uuid for update;
    if not found then raise exception 'التسليم غير موجود'; end if;
    if h.status <> 'pending' then return clinic_finance.peer_json(h); end if;   -- already decided (replay)
    select * into s from clinic_finance.shifts where id = h.from_shift for update;
    select * into t from clinic_finance.shifts where id = h.to_shift for update;
    msg := left(trim(coalesce(p_payload->>'note', '')), 500);
    if p_action = 'cancel' then
      if s.cashier_id <> me then raise exception 'اللي سلّم بس يقدر يلغي'; end if;
    elsif t.cashier_id <> me then raise exception 'التسليم ده مش ليك' using errcode = '42501';
    end if;
    if p_action = 'accept' then
      amt := nullif(p_payload->>'counted', '')::numeric;
      if amt is distinct from h.amount then raise exception 'المبلغ اللي عدّيته (%) مش زي المبلغ المسلَّم (%)؛ لو فيه فرق ارفض واكتب السبب', coalesce(amt::text, '—'), h.amount; end if;
      if t.status <> 'open' or t.ended_at is not null then raise exception 'افتح ورديتك الأول علشان تستلم'; end if;
      if s.status <> 'open' then raise exception 'وردية الزميل اتقفلت؛ التسليم ده مش متاح'; end if;
      if not h.end_of_shift and h.amount > clinic_finance.cash_limit(s.id) then raise exception 'الكاش في وردية الزميل بقى أقل من المبلغ؛ ارفض واطلب منه يسلّم تاني'; end if;
      update clinic_finance.peer_handovers set status = 'accepted', decided_by = me, decided_at = now(), decision_note = nullif(msg, '') where id = h.id returning * into h;
      insert into clinic_finance.entries(source, source_id, description, shift_id, created_by) values ('treasury_transfer_out', h.id, 'تسليم تحصيل لزميل', s.id, me) returning id into e;
      insert into clinic_finance.lines(entry_id, account, debit, credit) values (e, '1119', h.amount, 0), (e, '1111', 0, h.amount);
      insert into clinic_finance.entries(source, source_id, description, shift_id, created_by) values ('treasury_peer_in', h.id, 'استلام تحصيل من زميل', t.id, me) returning id into e;
      insert into clinic_finance.lines(entry_id, account, debit, credit) values (e, '1111', h.amount, 0), (e, '1119', 0, h.amount);
      if h.end_of_shift then
        update clinic_finance.shifts set status = 'submitted', closed_at = now(), counted = 0, denominations = '{"1":0}',
          close_event_no = (select coalesce(max(event_no), 0) from clinic_finance.entries) where id = s.id;
        if s.end_counted <> s.end_expected then insert into clinic_finance.cash_cases(shift_id, difference) values (s.id, s.end_counted - s.end_expected) on conflict (shift_id) do nothing; end if;
      end if;
    else
      if p_action = 'reject' and length(msg) < 3 then raise exception 'اكتب سبب الرفض'; end if;
      update clinic_finance.peer_handovers set status = case when p_action = 'reject' then 'rejected' else 'cancelled' end, decided_by = me, decided_at = now(), decision_note = nullif(msg, '')
        where id = h.id returning * into h;
      if h.end_of_shift then   -- the sender counts again and chooses again
        update clinic_finance.shifts set ended_at = null, end_counted = null, end_expected = null, end_counts = null where id = s.id;
      end if;
    end if;
    insert into clinic_finance.audit(actor, action, entity_id, detail) values (me, 'peer_handover_' || p_action, h.id, clinic_finance.peer_json(h));
    return clinic_finance.peer_json(h);
  end if;
  raise exception 'إجراء غير معروف';
end $$;
revoke all on function public.clinic_finance_peer_handover(text, jsonb, uuid) from public, anon;
grant execute on function public.clinic_finance_peer_handover(text, jsonb, uuid) to authenticated;

-- «حركة الوردية»: show the colleague handover coming IN (money out is already listed by the cash-account fix of 20261118140000)
do $$
declare def text; patched text;
  anchor constant text := $s$ allrows as (select * from r_in union all select * from f_in union all select * from r_out union all select * from f_out union all select * from fixes)$s$;
begin
  def := pg_get_functiondef('public.clinic_finance_shift_movements(uuid,date,date,uuid,uuid)'::regprocedure);
  if position(anchor in def) = 0 then raise exception 'Missing patch target in clinic_finance_shift_movements (md5 %)', md5(def); end if;
  patched := replace(def, anchor, $s$ p_in as (
   select e.created_at,f.id,f.cashier_name,f.register_name,'in','handover','استلام تحصيل من زميل',e.description,'cash','',l.debit,null::jsonb,e.id
   from clinic_finance.entries e join fsh f on f.id=e.shift_id join clinic_finance.lines l on l.entry_id=e.id and clinic_finance.is_cash_account(l.account) and l.debit>0
   where e.source='treasury_peer_in'),
 allrows as (select * from r_in union all select * from f_in union all select * from r_out union all select * from f_out union all select * from fixes union all select * from p_in)$s$);
  execute patched;
  raise notice 'clinic_finance_shift_movements patched (before md5 %, after md5 %)', md5(def), md5(patched);
end $$;

commit;
