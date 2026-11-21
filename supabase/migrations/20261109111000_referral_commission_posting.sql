-- REFERRAL COMMISSION POSTING — *** NEEDS THE OWNER'S EXPLICIT APPROVAL. DO NOT APPLY TOGETHER WITH 20261109110000. Apply separately, after the report-only phase was reviewed. ***
-- When an external lab/radiology order reaches status 'done' (public.clinic_reception_so_set_status), the referring doctor's commission is posted to his balance:
--   Dr 5111 / Cr 2120 through clinic_reception.post with dimensions {provider_id (the providers row whose doctor_key = the referring doctor), order_id, visit_id, department}
--   => clinic_finance.doctor_balance(doctor_key) (which sums 2120 lines by provider.doctor_key on live workspaces) includes it, so it is paid through the normal payout screen.
-- Amount is RECOMPUTED at completion: greatest(0, net - provider_payable [- supplies = orders.cost at completion]) x the rate frozen in order_ext.priced at booking. External mode only.
-- Idempotent: one row per order in clinic_reception.referral_postings (state posted | zero | no_provider). 'no_provider' = the referring doctor has no active providers row: nothing posted, the row is the report.
-- Additive: 1 table, 1 internal function, set_status moved to clinic_reception.so_set_status_before_referral and wrapped (same signature, same grants). Never posts retroactively for orders already 'done'.
-- Pinned: public.clinic_reception_so_set_status md5 9c04b910847c67e63603e71cb04df91f (production 2026-11-09). Rollback refuses while posted rows exist (reverse them by journal first).
begin;
do $mig$
declare d text;
begin
  if to_regprocedure('clinic_reception.so_set_status_before_referral(uuid,uuid,text)') is not null or to_regclass('clinic_reception.referral_postings') is not null then raise exception 'تم تطبيق هذا الملف من قبل'; end if;
  if to_regprocedure('clinic_reception.post(uuid,text,uuid,text,text,text,numeric,jsonb)') is null then raise exception 'clinic_reception.post غير موجودة'; end if;
  d := pg_get_functiondef('public.clinic_reception_so_attach(uuid,uuid,jsonb)'::regprocedure);
  if position('refbase' in d) = 0 then raise exception 'طبّق ملف 20261109110000_referral_commission_external أولًا'; end if;
  d := pg_get_functiondef('public.clinic_reception_so_set_status(uuid,uuid,text)'::regprocedure);
  if md5(d) <> '9c04b910847c67e63603e71cb04df91f' and (position('update clinic_reception.order_ext x set status=p_to' in d) = 0 or position('report_uploaded' in d) = 0) then
    raise exception 'clinic_reception_so_set_status تغيّرت عن نص الإنتاج المتوقع؛ راجع الفرق قبل التطبيق';
  end if;
end $mig$;

create table clinic_reception.referral_postings (
  order_id uuid primary key references clinic_reception.orders(id),
  workspace_id uuid not null,
  referring_doctor_key text not null,
  base numeric(14,2) not null check (base >= 0),
  percent numeric(7,3) not null check (percent between 0 and 100),
  amount numeric(14,2) not null check (amount >= 0),
  state text not null check (state in ('posted', 'zero', 'no_provider')),
  journal_id uuid,
  created_at timestamptz not null default now()
);
alter table clinic_reception.referral_postings enable row level security;
revoke all on clinic_reception.referral_postings from public, anon, authenticated;

create function clinic_reception.referral_post(p_workspace uuid, p_order uuid) returns void language plpgsql security definer set search_path = pg_catalog, public as $$
declare o clinic_reception.orders%rowtype; x clinic_reception.order_ext%rowtype; prov uuid; v_net numeric; v_pay numeric; v_rec numeric; v_rate numeric; v_base numeric; v_amt numeric; v_state text; v_j uuid;
begin
  select * into x from clinic_reception.order_ext where order_id = p_order;
  if not found or x.mode <> 'external' or x.kind not in ('lab', 'radiology') or x.referring_doctor_key is null then return; end if;
  if exists (select 1 from clinic_reception.referral_postings where order_id = p_order) then return; end if;
  select * into o from clinic_reception.orders where id = p_order and workspace_id = p_workspace;
  if not found then return; end if;
  v_net := coalesce((x.priced->>'net')::numeric, 0); v_pay := coalesce((x.priced->>'provider_payable')::numeric, 0);
  v_rec := coalesce((x.priced->>'center_receivable')::numeric, 0); v_rate := coalesce((x.priced->>'referral_rate')::numeric, 0);
  v_base := round(greatest(0, case when x.billing_party = 'provider' then v_rec else v_net - v_pay end - coalesce(o.cost, 0)), 2);
  v_amt := round(v_base * v_rate / 100, 2);
  if v_amt <= 0 then
    insert into clinic_reception.referral_postings(order_id, workspace_id, referring_doctor_key, base, percent, amount, state) values (p_order, p_workspace, x.referring_doctor_key, v_base, v_rate, 0, 'zero');
    return;
  end if;
  select id into prov from clinic_reception.providers where workspace_id = p_workspace and doctor_key = x.referring_doctor_key and active order by name limit 1;
  if prov is null then
    insert into clinic_reception.referral_postings(order_id, workspace_id, referring_doctor_key, base, percent, amount, state) values (p_order, p_workspace, x.referring_doctor_key, v_base, v_rate, v_amt, 'no_provider');
    return;
  end if;
  v_j := clinic_reception.post(p_workspace, 'referral_commission', p_order, 'عمولة تحويل لطبيب محوِّل', '5111', '2120', v_amt,
           jsonb_build_object('provider_id', prov, 'order_id', p_order, 'visit_id', o.visit_id, 'department', o.snapshot->>'department'));
  insert into clinic_reception.referral_postings(order_id, workspace_id, referring_doctor_key, base, percent, amount, state, journal_id) values (p_order, p_workspace, x.referring_doctor_key, v_base, v_rate, v_amt, 'posted', v_j);
end $$;
revoke all on function clinic_reception.referral_post(uuid, uuid) from public, anon, authenticated, service_role;

alter function public.clinic_reception_so_set_status(uuid, uuid, text) set schema clinic_reception;
alter function clinic_reception.clinic_reception_so_set_status(uuid, uuid, text) rename to so_set_status_before_referral;
create function public.clinic_reception_so_set_status(p_workspace uuid, p_order uuid, p_to text) returns jsonb language plpgsql security definer set search_path = pg_catalog, public as $$
declare r jsonb;
begin
  r := clinic_reception.so_set_status_before_referral(p_workspace, p_order, p_to);
  if p_to = 'done' then perform clinic_reception.referral_post(p_workspace, p_order); end if;
  return r;
end $$;
do $$ declare r record; begin
  revoke all on function public.clinic_reception_so_set_status(uuid, uuid, text) from public, anon, authenticated, service_role;
  for r in select a.grantee, a.privilege_type from pg_proc p, aclexplode(p.proacl) a where p.oid = 'clinic_reception.so_set_status_before_referral(uuid,uuid,text)'::regprocedure and a.grantee <> p.proowner loop
    execute format('grant %s on function public.clinic_reception_so_set_status(uuid,uuid,text) to %s', r.privilege_type, case when r.grantee = 0 then 'public' else quote_ident(pg_get_userbyid(r.grantee)) end);
  end loop;
end $$;
revoke all on function clinic_reception.so_set_status_before_referral(uuid, uuid, text) from public, anon, authenticated, service_role;
commit;
