-- Optional authenticated staff access for partner institutions.
alter table if exists public.contracting_partner_users
  add column if not exists auth_user_id uuid,
  add column if not exists role_key text default 'partner_staff';

create unique index if not exists contracting_partner_users_auth_uidx
  on public.contracting_partner_users(auth_user_id) where auth_user_id is not null;
create index if not exists contracting_partner_users_email_idx
  on public.contracting_partner_users(lower(email)) where email is not null;

create or replace function public.contracting_partner_claim_access()
returns jsonb
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  v_uid uuid := auth.uid();
  v_email text := lower(coalesce(auth.jwt()->>'email',''));
  v_row public.contracting_partner_users%rowtype;
begin
  if v_uid is null or v_email='' then raise exception 'Authentication required'; end if;
  select * into v_row from public.contracting_partner_users
  where active=true and lower(email)=v_email
  order by created_at asc limit 1;
  if v_row.id is null then raise exception 'This email is not authorized for a partner account'; end if;
  if v_row.auth_user_id is null then
    update public.contracting_partner_users set auth_user_id=v_uid where id=v_row.id;
    v_row.auth_user_id:=v_uid;
  elsif v_row.auth_user_id<>v_uid then
    raise exception 'Partner account is linked to another user';
  end if;
  return jsonb_build_object('entity_id',v_row.entity_id,'name',v_row.full_name,'role',v_row.role_key);
end;
$$;

create or replace function public.contracting_partner_staff_dashboard()
returns jsonb
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  v_entity uuid;
  v_entity_name text;
  v_revenue numeric := 0;
  v_incentive numeric := 0;
  v_referrals integer := 0;
  v_confirmed integer := 0;
  v_attended integer := 0;
  v_completed integer := 0;
begin
  select u.entity_id into v_entity from public.contracting_partner_users u
  where u.auth_user_id=auth.uid() and u.active=true limit 1;
  if v_entity is null then raise exception 'Partner access is not authorized'; end if;
  select name into v_entity_name from public.contracting_entities where id=v_entity;
  select count(*),count(*) filter(where status in('confirmed','attended','completed','collected')),
    count(*) filter(where status in('attended','completed','collected')),
    count(*) filter(where status in('completed','collected'))
  into v_referrals,v_confirmed,v_attended,v_completed
  from public.contracting_referrals where entity_id=v_entity;
  select coalesce(sum(eligible_amount) filter(where eligible),0) into v_revenue
  from public.contracting_partner_transactions where entity_id=v_entity;
  v_incentive:=public.contracting_progressive_incentive(v_revenue,v_entity,'standard');
  return jsonb_build_object(
    'entity_id',v_entity,'entity_name',v_entity_name,
    'referrals',v_referrals,'confirmed',v_confirmed,'attended',v_attended,'completed',v_completed,
    'eligible_revenue',v_revenue,'incentive',v_incentive,
    'recent_referrals',coalesce((select jsonb_agg(x) from (
      select id,left(coalesce(patient_name,'مريض'),1)||'***' patient,status,created_at,specialty
      from public.contracting_referrals where entity_id=v_entity order by created_at desc limit 30
    ) x),'[]'::jsonb),
    'settlements',coalesce((select jsonb_agg(x) from (
      select period_start,period_end,eligible_revenue,incentive_amount,status
      from public.contracting_settlements where entity_id=v_entity order by period_end desc limit 12
    ) x),'[]'::jsonb)
  );
end;
$$;

grant execute on function public.contracting_partner_claim_access() to authenticated;
grant execute on function public.contracting_partner_staff_dashboard() to authenticated;
