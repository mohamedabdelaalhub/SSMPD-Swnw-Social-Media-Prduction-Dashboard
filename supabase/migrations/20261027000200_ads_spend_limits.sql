-- حدود الصرف الإعلاني بفترات (يومي / أسبوعي / شهري / إجمالي بتاريخ) — محمد، 2026-10-27
--
-- • ads_spend_limits: حد بالجنيه لكل فترة، لكل الصفحات أو لصفحة بعينها.
-- • الحد بيتفحص وقت اعتماد خطة حملة (media_buyer_plans → approved/executing/live) وعند تعديل ميزانيتها أو تواريخها:
--   لو المخطط الصرف (خطط معتمدة + دي) بيعدّي أي حد في أي فترة ⇒ الاعتماد بيتمنع برسالة واضحة.
-- • مفيش حدود مفعّلة ⇒ مفيش فحص على اعتماد محمد (زي ما هو)، لكن Claude مبيقدرش يقترح خطة بفلوس من غير حد مفعّل.
-- • إجراءات التنفيذ (إنشاء حملة/مجموعة/إعلان/زيادة ميزانية) لازم تتربط بخطة معتمدة، وزيادة الميزانية مش بتعدّي ميزانية الخطة.
-- • الأسبوع بيبدأ السبت (الأسبوع المصري).
-- Claude بيقترح بس: claude_propose_ad_plan بتحط الخطة pending_approval، ومحمد هو اللي يعتمد من «مركز مدير الإعلانات».

create table if not exists public.ads_spend_limits (
  id uuid primary key default gen_random_uuid(),
  label text not null,
  brand text check (brand is null or brand in ('sono','dr_dina')),
  period text not null check (period in ('day','week','month','custom')),
  amount numeric not null check (amount >= 0),
  currency text not null default 'EGP' check (currency = 'EGP'),
  starts_on date,
  ends_on date,
  active boolean not null default true,
  note text,
  created_by uuid references public.admins(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint ads_spend_limits_custom_dates check (period <> 'custom' or (starts_on is not null and ends_on is not null and ends_on >= starts_on))
);
alter table public.ads_spend_limits enable row level security;
create policy ads_spend_limits_read on public.ads_spend_limits for select to authenticated using (public.can_manage_all_content());
create policy ads_spend_limits_write on public.ads_spend_limits for all to authenticated using (public.is_super()) with check (public.is_super());
grant select, insert, update, delete on public.ads_spend_limits to authenticated;

-- بداية ونهاية ومعدل الصرف اليومي للخطة
create or replace function public.ads_plan_span(p public.media_buyer_plans, out s date, out e date, out rate numeric)
 language plpgsql stable set search_path to 'public' as $$
declare days integer; total numeric;
begin
  s := coalesce(p.start_date, current_date);
  e := coalesce(p.end_date, s + 29);
  if e < s then e := s; end if;
  days := (e - s) + 1;
  if p.total_budget is not null and p.total_budget > 0 then
    total := least(coalesce(p.daily_budget * days, p.total_budget), p.total_budget);
    rate := total / days;
  else
    rate := coalesce(p.daily_budget, 0);
  end if;
end $$;

-- صرف الخطة المتوقع جوه نافذة [ws, we]
create or replace function public.ads_plan_spend_in(p public.media_buyer_plans, ws date, we date)
 returns numeric language plpgsql stable set search_path to 'public' as $$
declare sp record;
begin
  select * into sp from public.ads_plan_span(p);
  return sp.rate * greatest(0, least(sp.e, we) - greatest(sp.s, ws) + 1);
end $$;

-- الحدود اللي الخطة بتعدّيها (لو فيه). الخطة المرشّحة بتتحسب كأنها معتمدة.
create or replace function public.ads_plan_violations(p public.media_buyer_plans)
 returns table(limit_label text, period text, period_start date, period_end date, projected numeric, limit_amount numeric, this_plan numeric)
 language plpgsql stable security definer set search_path to 'public' as $$
declare l public.ads_spend_limits%rowtype; sp record; lo date; hi date; d date; ws date; we date; tot numeric; mine numeric; q public.media_buyer_plans; guard integer;
begin
  select * into sp from public.ads_plan_span(p);
  for l in select * from public.ads_spend_limits x where x.active and (x.brand is null or x.brand = p.brand) order by x.created_at loop
    lo := greatest(sp.s, coalesce(l.starts_on, sp.s));
    hi := least(sp.e, coalesce(l.ends_on, sp.e));
    if hi < lo then continue; end if;
    d := lo; guard := 0;
    while d <= hi and guard < 400 loop
      guard := guard + 1;
      if l.period = 'custom' then ws := l.starts_on; we := l.ends_on;
      elsif l.period = 'day' then ws := d; we := d;
      elsif l.period = 'week' then ws := d - ((extract(dow from d)::int + 1) % 7); we := ws + 6;
      else ws := date_trunc('month', d)::date; we := (date_trunc('month', d) + interval '1 month - 1 day')::date;
      end if;
      mine := public.ads_plan_spend_in(p, ws, we);
      tot := mine;
      for q in select * from public.media_buyer_plans z
               where z.status in ('approved','executing','live') and z.id is distinct from p.id
                 and (l.brand is null or z.brand = l.brand) loop
        tot := tot + public.ads_plan_spend_in(q, ws, we);
      end loop;
      if tot > l.amount + 0.005 then
        limit_label := l.label; period := l.period; period_start := ws; period_end := we;
        projected := round(tot, 2); limit_amount := l.amount; this_plan := round(mine, 2);
        return next;
      end if;
      d := we + 1;
    end loop;
  end loop;
end $$;

create or replace function public.ads_period_ar(p text) returns text language sql immutable as $$
  select case p when 'day' then 'يومي' when 'week' then 'أسبوعي' when 'month' then 'شهري' else 'إجمالي للفترة' end;
$$;

-- حارس اعتماد الخطة
create or replace function public.ads_plan_limits_guard() returns trigger
 language plpgsql security definer set search_path to 'public' as $$
declare v record;
begin
  if new.status not in ('approved','executing','live') then return new; end if;
  if tg_op = 'UPDATE' then
    if old.status in ('approved','executing','live')
       and old.daily_budget is not distinct from new.daily_budget and old.total_budget is not distinct from new.total_budget
       and old.start_date is not distinct from new.start_date and old.end_date is not distinct from new.end_date
       and old.brand is not distinct from new.brand then
      return new;
    end if;
  end if;
  if not exists (select 1 from public.ads_spend_limits where active) then return new; end if;
  if coalesce(new.currency, 'EGP') <> 'EGP' then raise exception 'حدود الصرف بالجنيه بس — عملة الخطة %', new.currency; end if;
  if new.daily_budget is null and new.total_budget is null then
    raise exception 'حدّد ميزانية يومية أو إجمالية للخطة قبل الاعتماد (فيه حدود صرف مفعّلة)';
  end if;
  select * into v from public.ads_plan_violations(new) vv order by (vv.projected - vv.limit_amount) desc limit 1;
  if found then
    raise exception 'الخطة بتتخطى حد «%» (%): المخطط % ج من حد % ج في الفترة % ← % — قلّل الميزانية أو ارفع الحد الأول',
      v.limit_label, public.ads_period_ar(v.period), v.projected, v.limit_amount, v.period_start, v.period_end;
  end if;
  return new;
end $$;
create trigger ads_plan_limits_guard_trg before insert or update on public.media_buyer_plans
  for each row execute function public.ads_plan_limits_guard();

-- حارس إجراءات الصرف: لازم تتربط بخطة معتمدة، وزيادة الميزانية مش بتعدّي ميزانية الخطة
create or replace function public.ads_action_limits_guard() returns trigger
 language plpgsql security definer set search_path to 'public' as $$
declare pl public.media_buyer_plans%rowtype; nb numeric;
begin
  if new.status is distinct from 'approved' or old.status is not distinct from 'approved' then return new; end if;
  if new.action_type is null or new.action_type not in ('create_campaign','create_adset','create_ad','increase_budget') then return new; end if;
  if not exists (select 1 from public.ads_spend_limits where active) then return new; end if;
  select * into pl from public.media_buyer_plans where id = new.plan_id;
  if not found or pl.status not in ('approved','executing','live') then
    raise exception 'إجراء الصرف ده لازم يتربط بخطة حملة معتمدة (فيه حدود صرف مفعّلة)';
  end if;
  if new.action_type = 'increase_budget' then
    nb := coalesce(nullif(new.proposed_payload->>'daily_budget','')::numeric, nullif(new.proposed_payload->>'new_daily_budget','')::numeric);
    if nb is not null and pl.daily_budget is not null and nb > pl.daily_budget then
      raise exception 'زيادة الميزانية (% ج) أكبر من ميزانية الخطة المعتمدة (% ج) — عدّل الخطة واعتمدها الأول', nb, pl.daily_budget;
    end if;
  end if;
  return new;
end $$;
create trigger ads_action_limits_guard_trg before update on public.media_buyer_actions
  for each row execute function public.ads_action_limits_guard();

-- حالة الحدود للفترة الحالية (للوحة التحكم وللمتابعة اليومية)
create or replace function public.ads_limits_status()
 returns table(id uuid, label text, brand text, period text, amount numeric, window_start date, window_end date, committed numeric, remaining numeric, pct integer)
 language plpgsql stable security definer set search_path to 'public' as $$
declare l public.ads_spend_limits%rowtype; ws date; we date; tot numeric; q public.media_buyer_plans; today date := (now() at time zone 'Africa/Cairo')::date;
begin
  for l in select * from public.ads_spend_limits x where x.active order by x.created_at loop
    if l.period = 'custom' then ws := l.starts_on; we := l.ends_on;
    elsif l.period = 'day' then ws := today; we := today;
    elsif l.period = 'week' then ws := today - ((extract(dow from today)::int + 1) % 7); we := ws + 6;
    else ws := date_trunc('month', today)::date; we := (date_trunc('month', today) + interval '1 month - 1 day')::date;
    end if;
    tot := 0;
    for q in select * from public.media_buyer_plans z where z.status in ('approved','executing','live') and (l.brand is null or z.brand = l.brand) loop
      tot := tot + public.ads_plan_spend_in(q, ws, we);
    end loop;
    id := l.id; label := l.label; brand := l.brand; period := l.period; amount := l.amount;
    window_start := ws; window_end := we; committed := round(tot, 2); remaining := round(l.amount - tot, 2);
    pct := case when l.amount > 0 then round(100 * tot / l.amount)::int else 100 end;
    return next;
  end loop;
end $$;
revoke all on function public.ads_limits_status() from public, anon;
grant execute on function public.ads_limits_status() to authenticated, service_role;

-- Claude بيقترح خطة (مش بيعتمدها ولا بيصرف): pending_approval + فحص الحدود قبل ما تتسجّل
create or replace function public.claude_propose_ad_plan(
  p_title text, p_brand text, p_objective text, p_daily_budget numeric, p_total_budget numeric,
  p_start date, p_end date, p_targeting text, p_strategy text, p_rationale text, p_content_item uuid default null
) returns uuid language plpgsql security definer set search_path to 'public' as $$
declare claude constant uuid := 'a0fbdfee-d147-4282-b988-186a9ae3e88c'; v public.media_buyer_plans; x record; headroom numeric; v_id uuid := gen_random_uuid();
begin
  if p_brand not in ('sono','dr_dina') then raise exception 'الصفحة لازم تكون sono أو dr_dina'; end if;
  if length(trim(coalesce(p_title,''))) < 5 then raise exception 'عنوان الخطة قصير'; end if;
  if length(trim(coalesce(p_objective,''))) < 2 then raise exception 'حدّد هدف الحملة (messages / leads / traffic ...)'; end if;
  if p_daily_budget is null and p_total_budget is null then raise exception 'حدّد ميزانية يومية أو إجمالية'; end if;
  if coalesce(p_daily_budget, 1) <= 0 or coalesce(p_total_budget, 1) <= 0 then raise exception 'الميزانية لازم تكون أكبر من صفر'; end if;
  if p_start is null or p_end is null or p_end < p_start or p_start < (now() at time zone 'Africa/Cairo')::date or p_end - p_start > 90 then
    raise exception 'التواريخ لازم تبدأ من النهارده أو بعده وماتزيدش عن 90 يوم';
  end if;
  if length(trim(coalesce(p_strategy,''))) < 20 or length(trim(coalesce(p_rationale,''))) < 20 then
    raise exception 'اكتب الاستراتيجية والسبب بوضوح (بالأرقام اللي بتدعمها)';
  end if;
  if not exists (select 1 from public.ads_spend_limits where active) then
    raise exception 'مفيش حدود صرف مفعّلة — محمد لازم يحدد حد صرف الأول قبل ما Claude يقترح خطة بفلوس';
  end if;
  perform public.claude_cap_use('ads_propose', jsonb_build_object('title', left(p_title, 80), 'brand', p_brand));
  v.id := v_id; v.brand := p_brand; v.status := 'approved'; v.currency := 'EGP';
  v.daily_budget := p_daily_budget; v.total_budget := p_total_budget; v.start_date := p_start; v.end_date := p_end;
  select * into x from public.ads_plan_violations(v) vv order by (vv.projected - vv.limit_amount) desc limit 1;
  if found then
    headroom := greatest(0, x.limit_amount - (x.projected - x.this_plan));
    raise exception 'الميزانية دي بتتخطى حد «%» (%): المتاح % ج بس في الفترة % ← % — قلّل الميزانية أو اقترح فترة تانية',
      x.limit_label, public.ads_period_ar(x.period), round(headroom, 2), x.period_start, x.period_end;
  end if;
  insert into public.media_buyer_plans(id, title, brand, objective, content_item_id, daily_budget, total_budget, currency, start_date, end_date,
      targeting_summary, strategy_summary, rationale, agent_confidence, status, proposed_by, created_by)
    values (v_id, trim(p_title), p_brand, trim(p_objective), p_content_item, p_daily_budget, p_total_budget, 'EGP', p_start, p_end,
      p_targeting, p_strategy, p_rationale, 'medium', 'pending_approval', 'claude_creative', claude);
  return v_id;
end $$;
revoke all on function public.claude_propose_ad_plan(text, text, text, numeric, numeric, date, date, text, text, text, uuid) from public, anon, authenticated;
grant execute on function public.claude_propose_ad_plan(text, text, text, numeric, numeric, date, date, text, text, text, uuid) to service_role;

notify pgrst, 'reload schema';
