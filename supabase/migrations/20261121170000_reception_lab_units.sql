-- «المعمل» bookable without a doctor (owner bug 2026-11-21: «معمل» → «مفيش قسم بالاسم ده»; lab bookings need no doctor).
-- Like «التمريض المنزلي», the lab is a provider row (no doctor_key). Two generic additions make that work:
--   * providers.capacity (default 1 = today's behaviour): how many patients the provider takes at the same time.
--     The booking overlap check allows overlap while fewer than `capacity` live bookings overlap; the gap rule
--     (minutes between bookings of the same doctor) applies only to capacity 1.
--   * providers.booking_gap (default true): false = no gap between this provider's bookings (the lab takes a sample
--     every 5 minutes: capacity 1, 5-minute lab services, no gap).
--   * clinic_reception.provider_departments: extra departments a provider serves as its own (the lab row sits in
--     «التحاليل» and also serves «باقي التحاليل»). This is the department rule, not the doctor-scope rule, so no
--     doctor contract is needed. has_provider_service_scope() (used by the booking, order and execution gates) also
--     answers true for an active service of an extra department, and for a unit provider (doctor_key NULL, so no
--     contract) its provider_service_scopes rows alone (in-center «التمريض»: the nurse services of «الطوارئ» only,
--     not the doctor ones). The snapshot lists those codes in
--     provider_service_scopes so the booking modal offers the provider.
-- The «المعمل» row, its departments, capacity and weekly hours are data: docs/ops/2026-11-21-lab-provider.sql.
-- In-place patch uses an exact text anchor (must occur exactly once). Rollback: supabase/rollbacks/20261121170000_reception_lab_units.rollback.sql
begin;

do $$ begin
  if to_regprocedure('clinic_reception.has_provider_service_scope(uuid,text,date)') is null
     or to_regprocedure('public.clinic_reception_snapshot(uuid,date,date)') is null then
    raise exception 'مكونات الحجز غير موجودة';
  end if;
  if to_regclass('clinic_reception.provider_departments') is not null then raise exception 'تم تطبيق هذا الملف من قبل'; end if;
end $$;

alter table clinic_reception.providers add column if not exists capacity integer not null default 1 check (capacity between 1 and 50),
  add column if not exists booking_gap boolean not null default true;

create table clinic_reception.provider_departments (
  provider_id uuid not null references clinic_reception.providers(id) on delete cascade,
  department text not null check (length(btrim(department)) >= 2),
  created_at timestamptz not null default now(),
  primary key (provider_id, department)
);
alter table clinic_reception.provider_departments enable row level security;
revoke all on clinic_reception.provider_departments from public, anon, authenticated;

create table clinic_reception.lab_units_saved_defs (name text primary key, def text not null);

-- scope = contracted doctor scope (unchanged) OR an active service of one of the provider's extra departments
alter function clinic_reception.has_provider_service_scope(uuid,text,date) rename to has_provider_service_scope_base;
create function clinic_reception.has_provider_service_scope(p_provider uuid, p_code text, p_day date)
returns boolean language sql stable set search_path = pg_catalog, public as $$
  select clinic_reception.has_provider_service_scope_base(p_provider, p_code, p_day)
      -- a unit (no doctor_key: «المعمل», «التمريض») has no contract; its scope rows alone allow the service
      or exists (select 1 from clinic_reception.provider_service_scopes sc
                   join clinic_reception.providers p on p.id = sc.provider_id and p.active and p.doctor_key is null
                  where sc.provider_id = p_provider and sc.service_code = p_code)
      or exists (select 1 from clinic_reception.provider_departments pd
                   join clinic_reception.providers p on p.id = pd.provider_id and p.active
                   join clinic_reception.services s on s.workspace_id = p.workspace_id and s.active and s.code = p_code and s.department = pd.department
                  where pd.provider_id = p_provider)
$$;
revoke all on function clinic_reception.has_provider_service_scope(uuid,text,date) from public, anon, authenticated;
revoke all on function clinic_reception.has_provider_service_scope_base(uuid,text,date) from public, anon, authenticated;

-- booking overlap check: up to `capacity` overlapping live bookings
do $$
declare r record; n int := 0; d text;
  a text := $a$if exists(select 1 from clinic_reception.appointments where workspace_id=p_workspace and provider_id=pr.id and status not in ('cancelled','no_show') and starts_at<e and ends_at>t and id is distinct from a.id) then raise exception 'الموعد يتداخل مع حجز قائم';end if;$a$;
  b text := $b$if (select count(*) from clinic_reception.appointments where workspace_id=p_workspace and provider_id=pr.id and status not in ('cancelled','no_show') and starts_at<e and ends_at>t and id is distinct from a.id)>=greatest(coalesce(pr.capacity,1),1) then raise exception 'الموعد يتداخل مع حجز قائم';end if;$b$;
begin
  for r in select p.oid, p.oid::regprocedure::text sig from pg_proc p join pg_namespace s on s.oid = p.pronamespace
            where s.nspname in ('public','clinic_reception') and p.prosrc like '%' || a || '%' loop
    d := pg_get_functiondef(r.oid);
    if (length(d) - length(replace(d, a, ''))) / length(a) <> 1 then raise exception 'نقطة الربط (التداخل) مش موجودة مرة واحدة في %', r.sig; end if;
    insert into clinic_reception.lab_units_saved_defs values (r.sig, d);
    execute replace(d, a, b); n := n + 1;
  end loop;
  if n <> 1 then raise exception 'نقطة الربط (التداخل) موجودة في % دالة بدل ١', n; end if;
end $$;

-- gap rule (minutes between two bookings of the same doctor) only for capacity 1 with booking_gap on
do $$
declare d text; a text := $a$if new.overbook then return new; end if;$a$;
begin
  if to_regprocedure('clinic_reception.appointments_respect_gap()') is null then return; end if;
  d := pg_get_functiondef('clinic_reception.appointments_respect_gap()'::regprocedure);
  if (length(d) - length(replace(d, a, ''))) / length(a) <> 1 then raise exception 'نقطة الربط (الفاصل) مش موجودة مرة واحدة'; end if;
  insert into clinic_reception.lab_units_saved_defs values ('clinic_reception.appointments_respect_gap()', d);
  execute replace(d, a, a || ' if exists (select 1 from clinic_reception.providers where id = new.provider_id and (capacity > 1 or not booking_gap)) then return new; end if;');
end $$;

-- snapshot: extra-department services count as the provider's scope; provider_departments listed for the UI
alter function public.clinic_reception_snapshot(uuid,date,date) rename to snapshot_before_lab_units;
alter function public.snapshot_before_lab_units(uuid,date,date) set schema clinic_reception;
revoke all on function clinic_reception.snapshot_before_lab_units(uuid,date,date) from public, anon, authenticated;
create function public.clinic_reception_snapshot(p_workspace uuid, p_from date default current_date, p_to date default current_date)
returns jsonb language plpgsql security definer set search_path = pg_catalog, public as $$
declare result jsonb; extra jsonb; depts jsonb; cur jsonb; k text; v jsonb;
begin
  result := clinic_reception.snapshot_before_lab_units(p_workspace, p_from, p_to);
  select coalesce(jsonb_object_agg(provider_id, ds), '{}'::jsonb) into depts from (
    select pd.provider_id, jsonb_agg(pd.department order by pd.department) ds
      from clinic_reception.provider_departments pd
      join clinic_reception.providers p on p.id = pd.provider_id and p.workspace_id = p_workspace
     group by pd.provider_id) q;
  if depts = '{}'::jsonb then return result; end if;
  select coalesce(jsonb_object_agg(provider_id, codes), '{}'::jsonb) into extra from (
    select pd.provider_id, jsonb_agg(distinct s.code) codes
      from clinic_reception.provider_departments pd
      join clinic_reception.providers p on p.id = pd.provider_id and p.workspace_id = p_workspace and p.active
      join clinic_reception.services s on s.workspace_id = p_workspace and s.active and s.department = pd.department
     group by pd.provider_id) q;
  cur := coalesce(result->'provider_service_scopes', '{}'::jsonb);
  for k, v in select * from jsonb_each(extra) loop
    cur := jsonb_set(cur, array[k], coalesce(cur->k, '[]'::jsonb) || v);
  end loop;
  return result || jsonb_build_object('provider_service_scopes', cur, 'provider_departments', depts);
end $$;
revoke all on function public.clinic_reception_snapshot(uuid,date,date) from public, anon;
grant execute on function public.clinic_reception_snapshot(uuid,date,date) to authenticated;

commit;
