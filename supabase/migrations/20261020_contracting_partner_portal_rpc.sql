-- Public partner portal surface. Returns only non-clinical partnership data.
create or replace function public.contracting_partner_public_profile(p_code text)
returns jsonb
language sql
security definer
set search_path = public
as $$
  select jsonb_build_object(
    'id',e.id,
    'name',e.name,
    'partner_code',e.partner_code,
    'enabled',coalesce(e.portal_enabled,false),
    'discount',coalesce(e.default_member_discount,20),
    'category',e.category,
    'services',coalesce((
      select to_jsonb(c.services)
      from public.contracting_entity_contracts c
      where c.entity_id=e.id and c.status='active'
      order by c.start_date desc limit 1
    ),'null'::jsonb)
  )
  from public.contracting_entities e
  where e.partner_code=p_code
  limit 1;
$$;

create or replace function public.contracting_partner_submit_referral(
  p_code text,
  p_patient_name text,
  p_patient_phone text,
  p_specialty text default null,
  p_service_name text default null,
  p_preferred_at timestamptz default null,
  p_notes text default null
) returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_entity_id uuid;
  v_id uuid;
begin
  select id into v_entity_id
  from public.contracting_entities
  where partner_code=p_code and coalesce(portal_enabled,false)=true;

  if v_entity_id is null then
    raise exception 'Partner portal is not enabled';
  end if;
  if nullif(trim(coalesce(p_patient_name,'')),'') is null
     and nullif(trim(coalesce(p_patient_phone,'')),'') is null then
    raise exception 'Patient name or phone is required';
  end if;

  insert into public.contracting_referrals(
    entity_id,patient_name,patient_phone,specialty,service_name,preferred_at,notes,source,status
  ) values(
    v_entity_id,nullif(trim(p_patient_name),''),nullif(trim(p_patient_phone),''),
    nullif(trim(p_specialty),''),nullif(trim(p_service_name),''),p_preferred_at,
    nullif(trim(p_notes),''),'partner_link','new'
  ) returning id into v_id;

  insert into public.contracting_activity_log(entity_id,action_key,summary,metadata)
  values(v_entity_id,'referral_created','تم استلام إحالة جديدة من رابط الشريك',jsonb_build_object('referral_id',v_id));

  return v_id;
end;
$$;

grant execute on function public.contracting_partner_public_profile(text) to anon, authenticated;
grant execute on function public.contracting_partner_submit_referral(text,text,text,text,text,timestamptz,text) to anon, authenticated;
