-- Owner 2026-11-18/19: every collection gets a sequential receipt number; every visit (one or several services) gets ONE sequential invoice
-- number, printable on the letterhead for the patient (name, service date, service lines, discounts, payments with their receipt numbers,
-- balance). Non-cash payments (card / InstaPay / wallet / bank) need the transaction number AND a photo of the machine slip / transfer
-- (mandatory on live workspaces).
--   * numbers: clinic_reception.next_doc_no(kind) → 'RC-2026-000001' / 'INV-2026-000001' (live) or 'T-…' (trial), per kind and year,
--     race-safe (row lock on clinic_reception.doc_counters).
--   * payments.receipt_no assigned on insert (trigger); proof photo: the client uploads to the private bucket payment-proofs
--     (<workspace>/<admin>/<file>), registers it with public.clinic_reception_payment_proof(workspace, reference, path), then collects;
--     the insert trigger attaches the newest unused proof of that cashier with the same transaction number, or refuses on live.
--   * visits.invoice_no assigned the first time the invoice is printed (public.clinic_reception_invoice_print).
-- Existing payments keep receipt_no NULL (numbers start with the release). Rollback: supabase/rollbacks/20261119030000_reception_invoice_receipt_numbers.rollback.sql
begin;

do $$ begin
  if to_regclass('clinic_reception.payments') is null or to_regprocedure('clinic_reception.access(uuid,text)') is null then raise exception 'مكونات الاستقبال غير موجودة'; end if;
  if to_regclass('clinic_reception.doc_counters') is not null then raise exception 'تم تطبيق هذا الملف من قبل'; end if;
end $$;

create table clinic_reception.doc_counters (kind text not null, year int not null, last bigint not null default 0, primary key (kind, year));
alter table clinic_reception.doc_counters enable row level security;
revoke all on clinic_reception.doc_counters from public, anon, authenticated;

create function clinic_reception.next_doc_no(p_kind text) returns text language plpgsql security definer set search_path = pg_catalog, public as $$
declare y int := extract(year from (now() at time zone 'Africa/Cairo'))::int; n bigint;
begin
  insert into clinic_reception.doc_counters(kind, year, last) values (p_kind, y, 1)
    on conflict (kind, year) do update set last = clinic_reception.doc_counters.last + 1 returning last into n;
  return p_kind || '-' || y || '-' || lpad(n::text, 6, '0');
end $$;
revoke all on function clinic_reception.next_doc_no(text) from public, anon, authenticated;

alter table clinic_reception.payments add column receipt_no text, add column proof_path text;
create unique index reception_payment_receipt_no on clinic_reception.payments(receipt_no) where receipt_no is not null;
alter table clinic_reception.visits add column invoice_no text;
create unique index reception_visit_invoice_no on clinic_reception.visits(invoice_no) where invoice_no is not null;

create table clinic_reception.payment_proofs (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references clinic_reception.workspaces(id),
  admin_id uuid not null references public.admins(id),
  reference text not null,
  path text not null unique,
  created_at timestamptz not null default now(),
  payment_id uuid references clinic_reception.payments(id)
);
create index payment_proofs_lookup on clinic_reception.payment_proofs(workspace_id, admin_id, reference) where payment_id is null;
alter table clinic_reception.payment_proofs enable row level security;
revoke all on clinic_reception.payment_proofs from public, anon, authenticated;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('payment-proofs', 'payment-proofs', false, 10485760, array['image/jpeg','image/png','image/webp','application/pdf'])
on conflict (id) do nothing;

-- upload: own folder of a workspace you can collect in; read: that workspace's reception staff and finance reviewers
create function public.payment_proof_allowed(p_name text, p_write boolean) returns boolean language plpgsql stable security definer set search_path = pg_catalog, public as $$
declare ws uuid; who uuid;
begin
  begin ws := split_part(p_name, '/', 1)::uuid; who := split_part(p_name, '/', 2)::uuid; exception when others then return false; end;
  if p_write and who is distinct from public.my_admin_id() then return false; end if;
  if not p_write and (public.has_role('super_admin') or public.has_role('general_manager')
     or (to_regprocedure('clinic_finance.allowed(text)') is not null and clinic_finance.allowed('review'))) then return true; end if;
  begin perform clinic_reception.access(ws, case when p_write then 'collect' else 'view' end); exception when others then return false; end;
  return true;
end $$;
revoke all on function public.payment_proof_allowed(text, boolean) from public, anon;
grant execute on function public.payment_proof_allowed(text, boolean) to authenticated;
drop policy if exists payment_proofs_insert on storage.objects;
drop policy if exists payment_proofs_select on storage.objects;
create policy payment_proofs_insert on storage.objects for insert to authenticated with check (bucket_id = 'payment-proofs' and public.payment_proof_allowed(name, true));
create policy payment_proofs_select on storage.objects for select to authenticated using (bucket_id = 'payment-proofs' and public.payment_proof_allowed(name, false));

create function public.clinic_reception_payment_proof(p_workspace uuid, p_reference text, p_path text) returns jsonb language plpgsql security definer set search_path = pg_catalog, public as $$
declare me uuid := clinic_reception.access(p_workspace, 'collect'); ref text := trim(coalesce(p_reference, '')); v uuid;
begin
  if length(ref) < 3 then raise exception 'اكتب رقم العملية من إيصال الماكينة أو رسالة التحويل'; end if;
  if p_path is null or split_part(p_path, '/', 1) <> p_workspace::text or split_part(p_path, '/', 2) <> me::text or p_path ~ '\.\.' then raise exception 'مسار الصورة غير صحيح'; end if;
  insert into clinic_reception.payment_proofs(workspace_id, admin_id, reference, path) values (p_workspace, me, ref, p_path)
    on conflict (path) do update set reference = excluded.reference returning id into v;
  return jsonb_build_object('id', v, 'path', p_path);
end $$;
revoke all on function public.clinic_reception_payment_proof(uuid, text, text) from public, anon;
grant execute on function public.clinic_reception_payment_proof(uuid, text, text) to authenticated;

create function clinic_reception.payment_numbering() returns trigger language plpgsql security definer set search_path = pg_catalog, public as $$
declare live boolean; pf clinic_reception.payment_proofs%rowtype;
begin
  select mode = 'live' into live from clinic_reception.workspaces where id = new.workspace_id;
  new.receipt_no := clinic_reception.next_doc_no(case when live then 'RC' else 'T-RC' end);
  if new.method <> 'cash' and new.proof_path is null then
    select * into pf from clinic_reception.payment_proofs
     where workspace_id = new.workspace_id and admin_id = new.created_by and reference = trim(new.reference) and payment_id is null and created_at > now() - interval '12 hours'
     order by created_at desc limit 1 for update;
    if found then
      new.proof_path := pf.path;
    elsif live then
      raise exception 'ارفع صورة إيصال الماكينة أو التحويل واكتب رقم العملية قبل الحفظ';
    end if;
  end if;
  return new;
end $$;
revoke all on function clinic_reception.payment_numbering() from public, anon, authenticated;
create trigger payment_numbering before insert on clinic_reception.payments for each row execute function clinic_reception.payment_numbering();
create function clinic_reception.payment_proof_used() returns trigger language plpgsql security definer set search_path = pg_catalog, public as $$
begin
  if new.proof_path is not null then update clinic_reception.payment_proofs set payment_id = new.id where path = new.proof_path and payment_id is null; end if;
  return new;
end $$;
revoke all on function clinic_reception.payment_proof_used() from public, anon, authenticated;
create trigger payment_proof_used after insert on clinic_reception.payments for each row execute function clinic_reception.payment_proof_used();

-- the patient invoice of one visit (assigns its number the first time)
create function public.clinic_reception_invoice_print(p_workspace uuid, p_visit uuid) returns jsonb language plpgsql security definer set search_path = pg_catalog, public as $$
declare me uuid := clinic_reception.access(p_workspace, 'view'); v clinic_reception.visits%rowtype; live boolean; pt record; lines jsonb; pays jsonb; tot record;
begin
  select * into v from clinic_reception.visits where id = p_visit and workspace_id = p_workspace for update;
  if not found then raise exception 'الزيارة غير موجودة'; end if;
  if not exists (select 1 from clinic_reception.invoices where visit_id = v.id) then raise exception 'مفيش خدمات متنفذة في الزيارة دي لسه'; end if;
  if v.invoice_no is null then
    select mode = 'live' into live from clinic_reception.workspaces where id = p_workspace;
    update clinic_reception.visits set invoice_no = clinic_reception.next_doc_no(case when live then 'INV' else 'T-INV' end) where id = v.id returning * into v;
  end if;
  select p.name, p.file_no, p.phone into pt from clinic_reception.patients p where p.id = v.patient_id;
  select coalesce(jsonb_agg(jsonb_build_object('no', x.n, 'service', x.description, 'doctor', x.doctor, 'department', x.department,
           'price', x.amount + x.discount, 'discount', x.discount, 'net', x.amount, 'insurer', x.payer_amount) order by x.n), '[]'::jsonb)
    into lines from (
      select row_number() over (order by i.created_at, i.invoice_no) n, i.description, i.amount, i.payer_amount,
             coalesce(round(o.price * o.quantity * o.discount / 100, 2), 0) discount, pr.name doctor, o.snapshot->>'department' department
      from clinic_reception.invoices i left join clinic_reception.orders o on o.id = i.order_id left join clinic_reception.providers pr on pr.id = o.provider_id
      where i.visit_id = v.id) x;
  select coalesce(jsonb_agg(jsonb_build_object('receipt_no', y.receipt_no, 'method', y.method, 'reference', case when y.method = 'cash' then null else trim(y.reference) end,
           'amount', y.amount, 'at', y.created_at, 'proof', y.proof_path is not null) order by y.created_at), '[]'::jsonb)
    into pays from (
      select p.receipt_no, p.method, p.reference, p.proof_path, p.created_at, sum(a.amount) amount
      from clinic_reception.allocations a join clinic_reception.invoices i on i.id = a.invoice_id and i.visit_id = v.id
      join clinic_reception.payments p on p.id = a.payment_id
      group by p.id, p.receipt_no, p.method, p.reference, p.proof_path, p.created_at) y;
  select coalesce(sum(i.amount), 0) amount, coalesce(sum(i.payer_amount), 0) insurer, coalesce(sum(clinic_reception.due(i.id)), 0) due,
         coalesce(sum((select coalesce(sum(a.amount), 0) from clinic_reception.allocations a where a.invoice_id = i.id)), 0) paid
    into tot from clinic_reception.invoices i where i.visit_id = v.id;
  return jsonb_build_object('invoice_no', v.invoice_no, 'visit_id', v.id, 'service_date', (v.opened_at at time zone 'Africa/Cairo')::date,
    'patient', jsonb_build_object('name', pt.name, 'file_no', pt.file_no, 'phone', pt.phone),
    'lines', lines, 'payments', pays,
    'totals', jsonb_build_object('net', tot.amount, 'insurer', tot.insurer, 'paid', tot.paid, 'due', tot.due),
    'printed_by', (select coalesce(nullif(trim(a.name), ''), 'موظف') from public.admins a where a.id = me), 'printed_at', now());
end $$;
revoke all on function public.clinic_reception_invoice_print(uuid, uuid) from public, anon;
grant execute on function public.clinic_reception_invoice_print(uuid, uuid) to authenticated;

-- patient file / finance shared records: show the receipt number on payments and let each invoice print its visit invoice
alter function public.clinic_reception_shared_records(text,uuid,date,date,integer) rename to shared_before_invoice_numbers;
alter function public.shared_before_invoice_numbers(text,uuid,date,date,integer) set schema clinic_reception;
revoke all on function clinic_reception.shared_before_invoice_numbers(text,uuid,date,date,integer) from public, anon, authenticated;
create function public.clinic_reception_shared_records(p_context text, p_id uuid default null, p_from date default null, p_to date default null, p_offset integer default 0)
returns jsonb language plpgsql stable security definer set search_path = pg_catalog, public as $$
declare v jsonb := clinic_reception.shared_before_invoice_numbers(p_context, p_id, p_from, p_to, p_offset);
begin
  if jsonb_typeof(v->'invoices') = 'array' then
    v := jsonb_set(v, '{invoices}', (select coalesce(jsonb_agg(i || jsonb_build_object('visit_id', x.visit_id, 'visit_invoice_no', vv.invoice_no) order by n), '[]'::jsonb)
      from jsonb_array_elements(v->'invoices') with ordinality e(i, n) left join clinic_reception.invoices x on x.id = (i->>'id')::uuid left join clinic_reception.visits vv on vv.id = x.visit_id));
  end if;
  if jsonb_typeof(v->'payments') = 'array' then
    v := jsonb_set(v, '{payments}', (select coalesce(jsonb_agg(p || jsonb_build_object('receipt_no', y.receipt_no, 'has_proof', y.proof_path is not null) order by n), '[]'::jsonb)
      from jsonb_array_elements(v->'payments') with ordinality e(p, n) left join clinic_reception.payments y on y.id = (p->>'id')::uuid));
  end if;
  return v;
end $$;
revoke all on function public.clinic_reception_shared_records(text,uuid,date,date,integer) from public, anon, authenticated;
grant execute on function public.clinic_reception_shared_records(text,uuid,date,date,integer) to authenticated;

commit;
