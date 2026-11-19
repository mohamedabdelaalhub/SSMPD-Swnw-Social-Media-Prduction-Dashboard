-- Cost-per-booking targets per campaign code, so a plan change is a data edit, not a code change.
-- Seeded from the owner-approved plan of 2026-11-13: PHY1 120, LZF1-F 45, DEN1 105 (EGP).
-- LZM1 has no numeric target in the plan (it is compared against LZF1-F), so it is not seeded.
-- Read: anyone who can manage content. Write: super admin only. Additive: no existing object is touched.

create table if not exists public.ads_roi_targets (
  code text primary key check (code ~ '^[A-Z]{2,4}[0-9](-[A-Z])?$'),
  target_cost_per_booking numeric not null check (target_cost_per_booking > 0),
  note text,
  updated_by uuid references public.admins(id) on delete set null,
  updated_at timestamptz not null default now()
);
alter table public.ads_roi_targets enable row level security;
create policy ads_roi_targets_read on public.ads_roi_targets for select to authenticated using (public.can_manage_all_content());
create policy ads_roi_targets_write on public.ads_roi_targets for all to authenticated using (public.is_super()) with check (public.is_super());
grant select, insert, update, delete on public.ads_roi_targets to authenticated;

insert into public.ads_roi_targets(code, target_cost_per_booking, note) values
  ('PHY1', 120, 'خطة 2026-11-13: علاج طبيعي ماسنجر'),
  ('LZF1-F', 45, 'خطة 2026-11-13: ليزر نسائي فورم فيسبوك'),
  ('DEN1', 105, 'خطة 2026-11-13: أسنان ماسنجر')
on conflict (code) do nothing;

notify pgrst, 'reload schema';
