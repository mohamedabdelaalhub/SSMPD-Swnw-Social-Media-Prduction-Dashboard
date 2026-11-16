-- بيانات الشركة والفروع (تاب «بيانات الشركة والفروع») — السجل التجاري، البطاقة الضريبية، الختم، وبيانات كل فرع
-- (تليفونات، إيميلات رسمية، حساب البنك، التراخيص والمستندات).
-- قرار المالك 2026-11-16: السوبر أدمن بس يشوف ويعدّل. فرع واحد حالياً. بيانات البنك تتكتب في الفرع وتتربط
-- اختيارياً بحساب البنك في دفتر الحسابات (clinic_finance.accounts) — مفيش قايمة حسابات بنك تانية.
-- الفروع نفسها = public.inventory_branches (نفس قايمة فروع المخزن، مش جدول جديد).
-- الملفات في bucket خاص org-legal-documents (مش public) وتتقري بلينك مؤقت بس. لا بيانات مرضى هنا.
-- Rollback: supabase/rollbacks/20261117010000_org_legal_profile.rollback.sql
begin;
do $$ begin
 if to_regclass('public.inventory_branches') is null or to_regclass('clinic_finance.accounts') is null
    or to_regprocedure('public.has_role(text)') is null or to_regprocedure('public.my_admin_id()') is null then
  raise exception 'محتاج جدول فروع المخزن ودفتر الحسابات ودوال الأدوار قبل الملف دا';
 end if;
end $$;

-- مين يوصل: السوبر أدمن (حساب نشط) بس.
create or replace function public.org_data_access() returns boolean
language sql stable security definer set search_path = public as $$
 select public.my_admin_id() is not null and public.has_role('super_admin');
$$;
revoke all on function public.org_data_access() from public, anon;
grant execute on function public.org_data_access() to authenticated;

-- ١) بيانات الشركة — صف واحد بس (id = 1)
create table if not exists public.org_company (
 id smallint primary key default 1 check (id = 1),
 legal_name_ar text not null default '' check (length(legal_name_ar) <= 200),
 legal_name_en text not null default '' check (length(legal_name_en) <= 200),
 legal_form text not null default '' check (length(legal_form) <= 120),
 address text not null default '' check (length(address) <= 500),
 cr_number text not null default '' check (length(cr_number) <= 60),
 cr_office text not null default '' check (length(cr_office) <= 120),
 cr_issue_date date,
 cr_expiry_date date,
 tax_card_number text not null default '' check (length(tax_card_number) <= 60),
 tax_office text not null default '' check (length(tax_office) <= 120),
 tax_card_expiry_date date,
 vat_number text not null default '' check (length(vat_number) <= 60),
 social_insurance_number text not null default '' check (length(social_insurance_number) <= 60),
 chamber_number text not null default '' check (length(chamber_number) <= 60),
 phones text[] not null default '{}' check (cardinality(phones) <= 20),
 emails text[] not null default '{}' check (cardinality(emails) <= 20),
 website text not null default '' check (length(website) <= 200),
 notes text not null default '' check (length(notes) <= 4000),
 updated_at timestamptz not null default now(),
 updated_by uuid references public.admins(id),
 check (cr_expiry_date is null or cr_issue_date is null or cr_expiry_date >= cr_issue_date)
);
insert into public.org_company(id) values (1) on conflict do nothing;

-- ٢) تفاصيل كل فرع (الفرع نفسه في inventory_branches)
create table if not exists public.org_branch_details (
 branch_id uuid primary key references public.inventory_branches(id) on delete restrict,
 official_name text not null default '' check (length(official_name) <= 200),
 address text not null default '' check (length(address) <= 500),
 manager_name text not null default '' check (length(manager_name) <= 120),
 phones text[] not null default '{}' check (cardinality(phones) <= 20),
 emails text[] not null default '{}' check (cardinality(emails) <= 20),
 bank_name text not null default '' check (length(bank_name) <= 120),
 bank_branch text not null default '' check (length(bank_branch) <= 120),
 bank_account_name text not null default '' check (length(bank_account_name) <= 200),
 bank_account_number text not null default '' check (length(bank_account_number) <= 40),
 iban text not null default '' check (iban = '' or iban ~ '^[A-Z]{2}[0-9]{2}[A-Z0-9]{10,30}$'),
 swift text not null default '' check (swift = '' or swift ~ '^[A-Z]{6}[A-Z0-9]{2}([A-Z0-9]{3})?$'),
 finance_account_code text references clinic_finance.accounts(code) on delete set null,
 notes text not null default '' check (length(notes) <= 4000),
 updated_at timestamptz not null default now(),
 updated_by uuid references public.admins(id)
);

-- ٣) المستندات والصور (للشركة أو لفرع) — الملف نفسه في storage، هنا الوصف بس
create table if not exists public.org_documents (
 id uuid primary key default gen_random_uuid(),
 branch_id uuid references public.inventory_branches(id) on delete restrict, -- null = مستند الشركة
 doc_type text not null check (doc_type in ('commercial_register','tax_card','stamp','license','bank','contract','insurance','other')),
 title text not null check (length(trim(title)) between 2 and 200),
 doc_number text not null default '' check (length(doc_number) <= 80),
 issuer text not null default '' check (length(issuer) <= 160),
 issue_date date,
 expiry_date date,
 storage_path text not null unique check (storage_path ~ '^(company|[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}[.](pdf|jpg|png|webp)$'),
 mime_type text not null check (mime_type in ('application/pdf','image/jpeg','image/png','image/webp')),
 size_bytes integer not null check (size_bytes > 0 and size_bytes <= 15728640),
 notes text not null default '' check (length(notes) <= 2000),
 uploaded_by uuid references public.admins(id),
 created_at timestamptz not null default now(),
 check (expiry_date is null or issue_date is null or expiry_date >= issue_date),
 -- مسار الملف لازم يطابق صاحبه: company/… للشركة، <branch_id>/… للفرع
 check ((branch_id is null and storage_path like 'company/%') or (branch_id is not null and storage_path like branch_id::text || '/%'))
);
create index if not exists org_documents_branch on public.org_documents(branch_id, doc_type);
create index if not exists org_documents_expiry on public.org_documents(expiry_date) where expiry_date is not null;

-- ٤) سجل التعديلات — بيتكتب بتريجر بس
create table if not exists public.org_audit (
 id bigint generated always as identity primary key,
 actor_id uuid references public.admins(id),
 table_name text not null,
 action text not null,
 record_id text not null,
 before_data jsonb,
 after_data jsonb,
 created_at timestamptz not null default now()
);

create or replace function public.org_touch_and_audit() returns trigger
language plpgsql security definer set search_path = public as $$
declare me uuid := public.my_admin_id(); rid text;
begin
 if tg_op in ('INSERT','UPDATE') and tg_table_name in ('org_company','org_branch_details') then
  new.updated_at := now(); new.updated_by := me;
 end if;
 if tg_op = 'INSERT' and tg_table_name = 'org_documents' then new.uploaded_by := me; new.created_at := now(); end if;
 if tg_op = 'UPDATE' and tg_table_name = 'org_documents' then
  -- الملف نفسه ثابت: لتغيير الملف ارفع مستند جديد
  if new.storage_path <> old.storage_path or new.mime_type <> old.mime_type or new.size_bytes <> old.size_bytes
     or new.branch_id is distinct from old.branch_id or new.uploaded_by is distinct from old.uploaded_by or new.created_at <> old.created_at then
   raise exception 'مينفعش تغيّر ملف المستند — ارفع مستند جديد';
  end if;
 end if;
 rid := coalesce(to_jsonb(case when tg_op = 'DELETE' then old else new end)->>'id', to_jsonb(case when tg_op = 'DELETE' then old else new end)->>'branch_id');
 insert into public.org_audit(actor_id, table_name, action, record_id, before_data, after_data)
 values (me, tg_table_name, lower(tg_op), rid,
         case when tg_op <> 'INSERT' then to_jsonb(old) end,
         case when tg_op <> 'DELETE' then to_jsonb(new) end);
 return case when tg_op = 'DELETE' then old else new end;
end $$;
revoke all on function public.org_touch_and_audit() from public, anon, authenticated;

drop trigger if exists org_company_audit on public.org_company;
create trigger org_company_audit before insert or update on public.org_company for each row execute function public.org_touch_and_audit();
drop trigger if exists org_branch_details_audit on public.org_branch_details;
create trigger org_branch_details_audit before insert or update or delete on public.org_branch_details for each row execute function public.org_touch_and_audit();
drop trigger if exists org_documents_audit on public.org_documents;
create trigger org_documents_audit before insert or update or delete on public.org_documents for each row execute function public.org_touch_and_audit();

-- RLS: السوبر أدمن بس. مفيش anon خالص. الشركة صف واحد: مفيش insert/delete من العميل.
alter table public.org_company enable row level security;
alter table public.org_branch_details enable row level security;
alter table public.org_documents enable row level security;
alter table public.org_audit enable row level security;
revoke all on public.org_company, public.org_branch_details, public.org_documents, public.org_audit from anon, public;
revoke all on public.org_company, public.org_branch_details, public.org_documents, public.org_audit from authenticated;
grant select, update on public.org_company to authenticated;
grant select, insert, update, delete on public.org_branch_details to authenticated;
grant select, insert, update, delete on public.org_documents to authenticated;
grant select on public.org_audit to authenticated;

drop policy if exists org_company_rw on public.org_company;
create policy org_company_rw on public.org_company for all to authenticated using (public.org_data_access()) with check (public.org_data_access());
drop policy if exists org_branch_details_rw on public.org_branch_details;
create policy org_branch_details_rw on public.org_branch_details for all to authenticated using (public.org_data_access()) with check (public.org_data_access());
drop policy if exists org_documents_rw on public.org_documents;
create policy org_documents_rw on public.org_documents for all to authenticated using (public.org_data_access()) with check (public.org_data_access());
drop policy if exists org_audit_read on public.org_audit;
create policy org_audit_read on public.org_audit for select to authenticated using (public.org_data_access());

-- الفروع: قايمة فروع المخزن + حسابات البنك من الدفتر (للاختيار بس). دوال قراءة/إضافة بصلاحية السوبر أدمن.
create or replace function public.org_branches() returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
 if not public.org_data_access() then raise exception 'البيانات دي للسوبر أدمن بس'; end if;
 return jsonb_build_object(
  'branches', (select coalesce(jsonb_agg(jsonb_build_object('id', b.id, 'name', b.name, 'active', b.active) order by b.created_at, b.name), '[]') from public.inventory_branches b),
  'bank_accounts', (select coalesce(jsonb_agg(jsonb_build_object('code', a.code, 'name', a.name) order by a.code), '[]') from clinic_finance.accounts a where a.code = '1112' or a.code like '1112%'));
end $$;
revoke all on function public.org_branches() from public, anon;
grant execute on function public.org_branches() to authenticated;

create or replace function public.org_branch_create(p_name text) returns uuid
language plpgsql security definer set search_path = public as $$
declare v uuid;
begin
 if not public.org_data_access() then raise exception 'البيانات دي للسوبر أدمن بس'; end if;
 if length(trim(coalesce(p_name, ''))) not between 2 and 120 then raise exception 'اكتب اسم الفرع (من 2 لـ 120 حرف)'; end if;
 if exists (select 1 from public.inventory_branches where name = trim(p_name)) then raise exception 'فيه فرع بنفس الاسم'; end if;
 insert into public.inventory_branches(name) values (trim(p_name)) returning id into v;
 insert into public.org_branch_details(branch_id) values (v);
 return v;
end $$;
revoke all on function public.org_branch_create(text) from public, anon;
grant execute on function public.org_branch_create(text) to authenticated;

-- الملفات: bucket خاص، 15MB، PDF/صور. القراءة بلينك مؤقت (createSignedUrl) للسوبر أدمن بس. مفيش تعديل للملف.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('org-legal-documents', 'org-legal-documents', false, 15728640, array['application/pdf','image/jpeg','image/png','image/webp']::text[])
on conflict (id) do update set public = false, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "org legal documents read" on storage.objects;
create policy "org legal documents read" on storage.objects for select to authenticated
 using (bucket_id = 'org-legal-documents' and public.org_data_access());
drop policy if exists "org legal documents upload" on storage.objects;
create policy "org legal documents upload" on storage.objects for insert to authenticated
 with check (bucket_id = 'org-legal-documents' and public.org_data_access()
  and name ~ '^(company|[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}[.](pdf|jpg|png|webp)$');
drop policy if exists "org legal documents delete" on storage.objects;
create policy "org legal documents delete" on storage.objects for delete to authenticated
 using (bucket_id = 'org-legal-documents' and public.org_data_access());

-- الفرع الحالي (فرع حدائق الأهرام) يبدأ بصف تفاصيل فاضي
insert into public.org_branch_details(branch_id) select id from public.inventory_branches on conflict do nothing;

commit;
