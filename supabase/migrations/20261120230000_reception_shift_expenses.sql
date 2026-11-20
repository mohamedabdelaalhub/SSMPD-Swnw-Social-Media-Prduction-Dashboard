-- «مصروفات الوردية» (owner 2026-11-20: «في كل وردية هامش للصرف اسمه مصروفات الوردية، وكل عملية صرف تتحط بتفاصيلها
-- بسببها بالمبلغ بتاعها بالايصال»; mockup docs/ui-references/mockups/reception-petty-cash.html; design delegated to us,
-- finance path agreed with main chat 4).
--   * registers.shift_expense_allowance (per shift, default 500) and shift_expense_max (per expense, default 300).
--     0 = off. Set by finance reviewers (clinic_finance_shift_expense 'set_limits').
--   * public.clinic_finance_shift_expense('spend'): the cashier's OWN open shift, a fixed item list, a receipt photo in the
--     private bucket 'shift-expense-receipts' (path <auth uid>/…, must exist), amount ≤ per-expense max, ≤ what is left of
--     the shift allowance, ≤ the shift's proven cash. Creates clinic_finance.requests(kind 'expense', status 'approved' by
--     POLICY — payload.source = 'shift_allowance', no person approves their own) and posts at once:
--     Dr 5216 مصروفات نثرية / 5219 كهرباء / 5220 مياه / 5224 عمومية أخرى (internet) — Cr the register cash (source 'shift_expense').
--     The reception register stays receive-only for everything else: cash_line_guard allows exactly source 'shift_expense'.
--   * Finance post-review is mandatory: 'review' marks ok / rejected with a note (not by the spender). A rejection is listed
--     for follow-up; no reversal and no salary deduction.
-- Rollback: supabase/rollbacks/20261120230000_reception_shift_expenses.rollback.sql
begin;

do $$ begin
  if to_regclass('clinic_finance.registers') is null or to_regclass('clinic_finance.requests') is null
     or to_regprocedure('clinic_finance.cash_line_guard()') is null or to_regprocedure('clinic_finance.post(text,uuid,text,uuid,text,text,numeric)') is null then
    raise exception 'مكونات الخزينة غير موجودة';
  end if;
  if to_regprocedure('public.clinic_finance_shift_expense(text,jsonb)') is not null then raise exception 'تم تطبيق هذا الملف من قبل'; end if;
end $$;

alter table clinic_finance.registers
  add column if not exists shift_expense_allowance numeric(14,2) not null default 500 check (shift_expense_allowance >= 0),
  add column if not exists shift_expense_max numeric(14,2) not null default 300 check (shift_expense_max >= 0);
alter table clinic_finance.requests
  add column if not exists post_review text check (post_review in ('pending', 'ok', 'rejected')),
  add column if not exists post_reviewed_by uuid references public.admins(id),
  add column if not exists post_reviewed_at timestamptz,
  add column if not exists post_review_note text;
create index if not exists requests_shift_allowance_idx on clinic_finance.requests(shift_id) where payload->>'source' = 'shift_allowance';

insert into storage.buckets(id, name, public, file_size_limit, allowed_mime_types)
  values ('shift-expense-receipts', 'shift-expense-receipts', false, 8388608, array['image/jpeg','image/png','image/webp','image/heic','application/pdf'])
  on conflict (id) do nothing;
drop policy if exists shift_expense_receipts_insert on storage.objects;
create policy shift_expense_receipts_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'shift-expense-receipts' and (storage.foldername(name))[1] = auth.uid()::text);
drop policy if exists shift_expense_receipts_read on storage.objects;
create policy shift_expense_receipts_read on storage.objects for select to authenticated
  using (bucket_id = 'shift-expense-receipts' and ((storage.foldername(name))[1] = auth.uid()::text or clinic_finance.allowed('review')));

-- the one cash-out a collection register may make
do $$
declare def text; a constant text := $s$and e.source<>'treasury_transfer_out'$s$;
begin
  def := pg_get_functiondef('clinic_finance.cash_line_guard()'::regprocedure);
  if (length(def) - length(replace(def, a, ''))) / length(a) <> 1 then raise exception 'نقطة الربط في cash_line_guard مش موجودة مرة واحدة (md5 %)', md5(def); end if;
  create table if not exists clinic_finance.shift_expense_saved_defs(name text primary key, def text not null);
  insert into clinic_finance.shift_expense_saved_defs values ('cash_line_guard', def) on conflict (name) do update set def = excluded.def;
  execute replace(def, a, a || $s$ and e.source<>'shift_expense'$s$);
end $$;

create function clinic_finance.shift_expense_items() returns jsonb language sql immutable as $$
  select '[{"key":"cleaning","label":"مناديل ومستلزمات نظافة","account":"5216"},{"key":"bathroom","label":"مستلزمات حمام","account":"5216"},
    {"key":"electricity","label":"شحن كارت الكهرباء","account":"5219"},{"key":"water","label":"فاتورة المية","account":"5220"},
    {"key":"internet","label":"الإنترنت","account":"5224"},{"key":"hospitality","label":"ضيافة ومياه شرب","account":"5216"},
    {"key":"stationery","label":"أدوات مكتبية وطباعة","account":"5216"},{"key":"delivery","label":"توصيل ومواصلات","account":"5216"},
    {"key":"other","label":"بند تاني","account":"5216"}]'::jsonb
$$;

create function clinic_finance.shift_expense_spent(p_shift uuid) returns numeric language sql stable security definer set search_path = pg_catalog, public as $$
  select coalesce(sum(amount), 0) from clinic_finance.requests where shift_id = p_shift and payload->>'source' = 'shift_allowance' and status = 'approved'
$$;
revoke all on function clinic_finance.shift_expense_spent(uuid) from public, anon, authenticated;

create function public.clinic_finance_shift_expense(p_action text, p jsonb default '{}') returns jsonb
language plpgsql security definer set search_path = pg_catalog, public as $$
declare me uuid := public.my_admin_id(); sh record; it jsonb; amt numeric; left_ numeric; cash numeric; ev text; v uuid; r clinic_finance.requests%rowtype;
  why text; f date; t date;
begin
  if me is null then raise exception 'سجل الدخول'; end if;
  if p_action = 'status' then
    select s.id, s.register_id, x.name, x.shift_expense_allowance a, x.shift_expense_max m into sh
      from clinic_finance.shifts s join clinic_finance.registers x on x.id = s.register_id
      where s.cashier_id = me and s.status = 'open' order by s.opened_at desc limit 1;
    if not found then return jsonb_build_object('open', false); end if;
    return jsonb_build_object('open', true, 'shift_id', sh.id, 'register', sh.name, 'allowance', sh.a, 'max', sh.m,
      'spent', clinic_finance.shift_expense_spent(sh.id), 'cash', clinic_finance.shift_cash(sh.id), 'items', clinic_finance.shift_expense_items(),
      'expenses', coalesce((select jsonb_agg(jsonb_build_object('id', q.id, 'at', q.created_at, 'amount', q.amount, 'item', q.payload->>'item_label',
          'reason', q.reason, 'vendor', q.payload->>'vendor', 'post_review', q.post_review) order by q.created_at desc)
        from clinic_finance.requests q where q.shift_id = sh.id and q.payload->>'source' = 'shift_allowance'), '[]'));
  elsif p_action = 'spend' then
    perform clinic_finance.lock_day();
    select * into r from clinic_finance.requests q where q.created_by = me and q.token = nullif(p->>'token', '')::uuid;
    if found then return jsonb_build_object('id', r.id, 'amount', r.amount, 'duplicate', true); end if;
    select s.id, s.register_id, x.shift_expense_allowance a, x.shift_expense_max m into sh
      from clinic_finance.shifts s join clinic_finance.registers x on x.id = s.register_id
      where s.id = nullif(p->>'shift_id', '')::uuid and s.cashier_id = me and s.status = 'open' for update of s;
    if not found then raise exception 'اختار ورديتك المفتوحة'; end if;
    if sh.a <= 0 or sh.m <= 0 then raise exception 'مصروفات الوردية مش مفعّلة للخزنة دي — كلّم الحسابات'; end if;
    select e into it from jsonb_array_elements(clinic_finance.shift_expense_items()) e where e->>'key' = p->>'item';
    if it is null then raise exception 'اختار البند'; end if;
    amt := round(coalesce(nullif(p->>'amount', '')::numeric, 0), 2);
    why := btrim(coalesce(p->>'reason', ''));
    if amt <= 0 then raise exception 'اكتب المبلغ'; end if;
    if length(why) < 3 then raise exception 'اكتب السبب / التفاصيل'; end if;
    if amt > sh.m then raise exception 'المبلغ أكبر من حد المصروف الواحد (% جنيه) — اطلبه من الحسابات', sh.m using hint = 'over_max'; end if;
    left_ := sh.a - clinic_finance.shift_expense_spent(sh.id);
    if amt > left_ then raise exception 'المبلغ أكبر من الباقي من مصروفات الوردية (% جنيه) — اطلبه من الحسابات', greatest(left_, 0) using hint = 'over_allowance'; end if;
    cash := clinic_finance.shift_cash(sh.id);
    if amt > cash then raise exception 'النقدية اللي في الوردية (% جنيه) أقل من المبلغ', cash using hint = 'over_cash'; end if;
    ev := btrim(coalesce(p->>'receipt_path', ''));
    if ev = '' or split_part(ev, '/', 1) <> auth.uid()::text
       or not exists (select 1 from storage.objects o where o.bucket_id = 'shift-expense-receipts' and o.name = ev) then
      raise exception 'صوّر الإيصال وارفعه الأول';
    end if;
    insert into clinic_finance.requests(kind, shift_id, amount, reason, evidence, payload, created_by, token, status, reviewed_at, review_note, post_review)
      values ('expense', sh.id, amt, left(it->>'label' || ' — ' || why, 1000), left(ev, 200),
        jsonb_build_object('source', 'shift_allowance', 'item', it->>'key', 'item_label', it->>'label', 'account', it->>'account',
          'vendor', left(btrim(coalesce(p->>'vendor', '')), 120)),
        me, coalesce(nullif(p->>'token', '')::uuid, gen_random_uuid()), 'approved', now(), 'اعتماد تلقائي — في حدود مصروفات الوردية', 'pending')
      returning id into v;
    perform clinic_finance.post('shift_expense', v, 'مصروفات الوردية — ' || (it->>'label'), sh.id, it->>'account', '1111', amt);
    insert into clinic_finance.audit(actor, action, entity_id, detail) values (me, 'shift_expense', v, jsonb_build_object('amount', amt, 'item', it->>'key', 'shift', sh.id));
    return jsonb_build_object('id', v, 'amount', amt, 'left', left_ - amt);
  elsif p_action = 'list' then
    if not clinic_finance.allowed('view') then raise exception 'للحسابات بس' using errcode = '42501'; end if;
    f := coalesce(nullif(p->>'from', '')::date, date_trunc('month', now() at time zone 'Africa/Cairo')::date);
    t := coalesce(nullif(p->>'to', '')::date, (now() at time zone 'Africa/Cairo')::date);
    return jsonb_build_object('from', f, 'to', t, 'can_review', clinic_finance.allowed('review'), 'items', clinic_finance.shift_expense_items(),
      'registers', coalesce((select jsonb_agg(jsonb_build_object('id', x.id, 'name', x.name, 'kind', x.treasury_kind, 'allowance', x.shift_expense_allowance, 'max', x.shift_expense_max) order by x.name)
        from clinic_finance.registers x), '[]'),
      'expenses', coalesce((select jsonb_agg(jsonb_build_object('id', q.id, 'at', q.created_at, 'amount', q.amount, 'item', q.payload->>'item_label',
          'reason', q.reason, 'vendor', q.payload->>'vendor', 'receipt', q.evidence, 'by', ad.name, 'register', x.name, 'post_review', q.post_review,
          'reviewed_by', rv.name, 'review_note', q.post_review_note, 'own', q.created_by = me) order by q.created_at desc)
        from clinic_finance.requests q join clinic_finance.shifts s on s.id = q.shift_id join clinic_finance.registers x on x.id = s.register_id
        left join public.admins ad on ad.id = q.created_by left join public.admins rv on rv.id = q.post_reviewed_by
        where q.payload->>'source' = 'shift_allowance' and (q.created_at at time zone 'Africa/Cairo')::date between f and t), '[]'));
  elsif p_action = 'review' then
    if not clinic_finance.allowed('review') then raise exception 'مراجعة مصروفات الورديات للحسابات بس' using errcode = '42501'; end if;
    select * into r from clinic_finance.requests where id = nullif(p->>'id', '')::uuid and payload->>'source' = 'shift_allowance' for update;
    if not found then raise exception 'المصروف مش موجود'; end if;
    if r.created_by = me then raise exception 'مينفعش تراجع مصروف صرفته بنفسك'; end if;
    if coalesce((p->>'ok')::boolean, true) = false and length(btrim(coalesce(p->>'note', ''))) < 3 then raise exception 'اكتب سبب الرفض'; end if;
    update clinic_finance.requests set post_review = case when coalesce((p->>'ok')::boolean, true) then 'ok' else 'rejected' end,
      post_reviewed_by = me, post_reviewed_at = now(), post_review_note = nullif(btrim(coalesce(p->>'note', '')), '') where id = r.id;
    insert into clinic_finance.audit(actor, action, entity_id, detail) values (me, 'shift_expense_review', r.id, p);
    return jsonb_build_object('ok', true);
  elsif p_action = 'set_limits' then
    if not clinic_finance.allowed('review') then raise exception 'تعديل الحدود للحسابات بس' using errcode = '42501'; end if;
    if coalesce(nullif(p->>'allowance', '')::numeric, -1) < 0 or coalesce(nullif(p->>'max', '')::numeric, -1) < 0 then raise exception 'اكتب الهامش والحد بالجنيه'; end if;
    update clinic_finance.registers set shift_expense_allowance = (p->>'allowance')::numeric, shift_expense_max = (p->>'max')::numeric
      where id = nullif(p->>'register_id', '')::uuid;
    if not found then raise exception 'الخزنة مش موجودة'; end if;
    insert into clinic_finance.audit(actor, action, entity_id, detail) values (me, 'shift_expense_limits', (p->>'register_id')::uuid, p);
    return jsonb_build_object('ok', true);
  end if;
  raise exception 'إجراء غير معروف';
end $$;
revoke all on function public.clinic_finance_shift_expense(text, jsonb) from public, anon;
grant execute on function public.clinic_finance_shift_expense(text, jsonb) to authenticated;

commit;
