-- Hotfix for reports wave 1 (live since #603): public.admins has the column «name», not «full_name».
-- report_cash_closing and report_access_admin failed for every caller. Same logic, column name corrected.
-- No new objects, no grants change (create or replace keeps existing privileges).
begin;

create or replace function public.report_access_admin(p_action text, p_payload jsonb default '{}'::jsonb) returns jsonb
language plpgsql security definer set search_path = pg_catalog, public as $$
declare v_code text := p_payload->>'code'; v_before jsonb; v_after jsonb; v_me uuid := public.my_admin_id();
begin
  if not public.is_super() then raise exception 'صلاحيات التقارير للمالك فقط'; end if;
  if p_action = 'set' then
    if not exists (select 1 from public.report_registry where code = v_code) then raise exception 'تقرير غير معروف'; end if;
    select coalesce(jsonb_agg(jsonb_build_object('role', role, 'admin_id', admin_id)), '[]'::jsonb) into v_before
      from public.report_access where report_code = v_code;
    delete from public.report_access where report_code = v_code;
    insert into public.report_access(report_code, role, created_by)
    select distinct v_code, r, v_me from jsonb_array_elements_text(coalesce(p_payload->'roles', '[]'::jsonb)) r where btrim(r) <> '';
    insert into public.report_access(report_code, admin_id, created_by)
    select distinct v_code, a.id, v_me from jsonb_array_elements_text(coalesce(p_payload->'admin_ids', '[]'::jsonb)) x
      join public.admins a on a.id = x::uuid;
    select coalesce(jsonb_agg(jsonb_build_object('role', role, 'admin_id', admin_id)), '[]'::jsonb) into v_after
      from public.report_access where report_code = v_code;
    insert into public.report_access_audit(report_code, actor, before, after) values (v_code, v_me, v_before, v_after);
  elsif p_action <> 'list' then
    raise exception 'إجراء غير معروف';
  end if;
  return jsonb_build_object(
    'reports', (select jsonb_agg(jsonb_build_object('code', g.code, 'title', g.title, 'area', g.area, 'sensitive', g.sensitive,
                  'roles', coalesce((select jsonb_agg(a.role order by a.role) from public.report_access a where a.report_code = g.code and a.role is not null), '[]'::jsonb),
                  'admins', coalesce((select jsonb_agg(jsonb_build_object('id', ad.id, 'name', ad.name) order by ad.name)
                                        from public.report_access a join public.admins ad on ad.id = a.admin_id where a.report_code = g.code), '[]'::jsonb)) order by g.sort)
                from public.report_registry g where g.active),
    'people', (select coalesce(jsonb_agg(jsonb_build_object('id', id, 'name', name, 'role', role) order by name), '[]'::jsonb)
                 from public.admins where active));
end $$;

create or replace function public.report_cash_closing(p_from date, p_to date, p_branch uuid default null) returns jsonb
language plpgsql stable security definer set search_path = pg_catalog, public as $$
declare v jsonb;
begin
  perform public.report_require('cash_closing');
  if p_from is null or p_to is null or p_from > p_to or p_to - p_from > 366 then raise exception 'راجع الفترة'; end if;
  with s as (
    select sh.id, ws.branch_name, r.name register_name, ca.name cashier, sh.opened_at, sh.closed_at, sh.status,
           sh.expected, sh.counted, sh.difference, rv.name reviewer,
           coalesce(sum(p.amount) filter (where p.method = 'cash'), 0) cash,
           coalesce(sum(p.amount) filter (where p.method = 'pos'), 0) pos,
           coalesce(sum(p.amount) filter (where p.method in ('instapay', 'wallet')), 0) instapay,
           coalesce(sum(p.amount) filter (where p.method = 'bank'), 0) bank
      from clinic_reception.shifts sh
      join public.report_workspaces(p_branch) ws on ws.workspace_id = sh.workspace_id
      join clinic_reception.registers r on r.id = sh.register_id
      left join public.admins ca on ca.id = sh.cashier_id
      left join public.admins rv on rv.id = sh.reviewed_by
      left join clinic_reception.payments p on p.shift_id = sh.id
     where (sh.opened_at at time zone 'Africa/Cairo')::date between p_from and p_to
     group by sh.id, ws.branch_name, r.name, ca.name, rv.name)
  select jsonb_build_object(
    'rows', coalesce(jsonb_agg(jsonb_build_object('branch', branch_name, 'register', register_name, 'cashier', cashier,
              'opened_at', opened_at, 'closed_at', closed_at, 'status', status, 'cash', cash, 'pos', pos, 'instapay', instapay, 'bank', bank,
              'expected', expected, 'counted', counted, 'difference', difference, 'reviewer', reviewer) order by opened_at desc), '[]'::jsonb),
    'totals', jsonb_build_object('shifts', count(*), 'cash', coalesce(sum(cash), 0), 'pos', coalesce(sum(pos), 0), 'instapay', coalesce(sum(instapay), 0),
              'bank', coalesce(sum(bank), 0), 'expected', coalesce(sum(expected), 0), 'counted', coalesce(sum(counted), 0),
              'difference', coalesce(sum(difference), 0), 'short_shifts', count(*) filter (where difference < 0)))
    into v from s;
  return v;
end $$;

commit;
