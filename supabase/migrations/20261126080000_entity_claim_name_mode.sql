-- Claims: default «اسم الخدمة في المطالبة» per contracting entity — owner 2026-11-25 («طبقه» on
-- docs/ui-references/mockups/entity-service-names.html). Values: entity (the entity's own service name from its price list),
-- center (the center's name), both (entity on top, center under it). The names themselves are already in every claim
-- snapshot (price_terms.item_terms.external_name / external_code); this only stores the per-entity default for printing.
--   * clinic_finance.entity_claim_name_modes(entity_id, mode, updated_by, updated_at) — RLS on, no direct client access.
--   * public.entity_claim_name_mode(p_entity)           → {mode (default 'both'), can_save}   — finance 'view'.
--   * public.entity_claim_name_mode_save(p_entity,p_mode)→ {mode}  — same people who edit billing terms
--     (can_manage_contracting_entities() or clinic_finance.allowed('review')); audit row 'entity_claim_name_mode'.
-- anon has no execute on either. Rollback: supabase/rollbacks/20261126080000_entity_claim_name_mode.rollback.sql
begin;
do $$ begin
  if to_regclass('clinic_finance.entity_billing_terms') is null then raise exception 'مكونات مطالبات الجهات غير موجودة'; end if;
  if to_regclass('clinic_finance.entity_claim_name_modes') is not null then raise exception 'تم تطبيق هذا الملف من قبل'; end if;
end $$;

create table clinic_finance.entity_claim_name_modes(
  entity_id uuid primary key references public.contracting_entities(id) on delete cascade,
  mode text not null check (mode in ('entity','center','both')),
  updated_by uuid references public.admins(id),
  updated_at timestamptz not null default now());
alter table clinic_finance.entity_claim_name_modes enable row level security;
revoke all on clinic_finance.entity_claim_name_modes from public, anon, authenticated;

create function public.entity_claim_name_mode(p_entity uuid) returns jsonb
language plpgsql stable security definer set search_path = pg_catalog, public as $$
begin
  perform clinic_finance.require_access('view');
  return jsonb_build_object(
    'mode', coalesce((select mode from clinic_finance.entity_claim_name_modes where entity_id = p_entity), 'both'),
    'can_save', coalesce(public.can_manage_contracting_entities() or clinic_finance.allowed('review'), false));
end $$;
revoke all on function public.entity_claim_name_mode(uuid) from public, anon;
grant execute on function public.entity_claim_name_mode(uuid) to authenticated;

create function public.entity_claim_name_mode_save(p_entity uuid, p_mode text) returns jsonb
language plpgsql security definer set search_path = pg_catalog, public as $$
declare me uuid := public.my_admin_id(); before text;
begin
  if me is null or not (public.can_manage_contracting_entities() or clinic_finance.allowed('review')) then
    raise exception 'حفظ اسم الخدمة الافتراضي للجهة يحتاج مسؤول تعاقدات أو مديرًا ماليًا' using errcode = '42501'; end if;
  if p_mode is null or p_mode not in ('entity','center','both') then raise exception 'اختار: اسم الجهة أو اسم المركز أو الاتنين'; end if;
  if not exists (select 1 from public.contracting_entities where id = p_entity) then raise exception 'الجهة غير موجودة'; end if;
  select mode into before from clinic_finance.entity_claim_name_modes where entity_id = p_entity;
  insert into clinic_finance.entity_claim_name_modes(entity_id, mode, updated_by) values (p_entity, p_mode, me)
  on conflict (entity_id) do update set mode = excluded.mode, updated_by = me, updated_at = now();
  insert into clinic_finance.audit(actor, action, entity_id, detail)
  values (me, 'entity_claim_name_mode', p_entity, jsonb_build_object('before', before, 'after', p_mode));
  return jsonb_build_object('mode', p_mode);
end $$;
revoke all on function public.entity_claim_name_mode_save(uuid, text) from public, anon;
grant execute on function public.entity_claim_name_mode_save(uuid, text) to authenticated;

commit;
