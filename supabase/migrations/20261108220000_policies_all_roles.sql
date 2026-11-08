-- البند 8 من فحص الداشبورد (موافقة المالك 2026-11-08): قواعد الصلاحية تبص على كل أدوار الشخص (الأساسي + الإضافية في admin_extra_roles)
-- بدل my_role() اللي بترجع الدور الأساسي بس. نفس الشروط بالظبط، والتغيير الوحيد: my_role() = X  ->  has_role(X) / has_any_role(ARRAY[..]).
-- 26 سياسة في public. سياسة storage.objects (رفع شعارات البراند للسوبر أدمن) متسابة لأنها ملك سكيمة storage.
-- التراجع: supabase/rollbacks/20261108220000_policies_all_roles.rollback.sql

create or replace function public.has_any_role(p_roles text[])
 returns boolean language sql stable security definer set search_path to 'public' as $$
  select exists (select 1 from public.admins where user_id = auth.uid() and active and role = any(p_roles))
      or exists (select 1 from public.admin_extra_roles r join public.admins a on a.id = r.admin_id
                 where a.user_id = auth.uid() and a.active and r.role = any(p_roles));
$$;
grant execute on function public.has_any_role(text[]) to authenticated, service_role;

alter policy "ai_clip_jobs_read" on public.ai_clip_jobs using ((has_any_role(ARRAY['super_admin'::text, 'general_manager'::text, 'designer'::text, 'page_manager'::text])));
alter policy "ai_clip_prices_read" on public.ai_clip_prices using ((has_any_role(ARRAY['super_admin'::text, 'general_manager'::text, 'designer'::text, 'page_manager'::text])));
alter policy "ai_clip_settings_read" on public.ai_clip_settings using ((has_any_role(ARRAY['super_admin'::text, 'general_manager'::text, 'designer'::text, 'page_manager'::text])));
alter policy "content_learnings_read" on public.content_learnings using ((has_any_role(ARRAY['page_manager'::text, 'designer'::text, 'approver'::text, 'general_manager'::text, 'super_admin'::text])));
alter policy "content_learnings_toggle" on public.content_learnings using ((has_any_role(ARRAY['super_admin'::text, 'general_manager'::text]))) with check ((has_any_role(ARRAY['super_admin'::text, 'general_manager'::text])));
alter policy "content_ratings_read" on public.content_ratings using ((has_any_role(ARRAY['page_manager'::text, 'approver'::text, 'general_manager'::text, 'super_admin'::text])));
alter policy "content_ratings_update" on public.content_ratings using ((has_any_role(ARRAY['page_manager'::text, 'approver'::text, 'general_manager'::text, 'super_admin'::text]))) with check ((rated_by = my_admin_id()));
alter policy "content_ratings_write" on public.content_ratings with check (((has_any_role(ARRAY['page_manager'::text, 'approver'::text, 'general_manager'::text, 'super_admin'::text])) AND (rated_by = my_admin_id())));
alter policy "kpi_defs_read" on public.kpi_defs using ((has_any_role(ARRAY['super_admin'::text, 'general_manager'::text])));
alter policy "kpi_targets_read" on public.kpi_targets using ((has_any_role(ARRAY['super_admin'::text, 'general_manager'::text])));
alter policy "kpi_targets_write" on public.kpi_targets using ((has_role('super_admin'::text))) with check ((has_role('super_admin'::text)));
alter policy "approver writes meta_ad_performance_lifetime" on public.meta_ad_performance_lifetime using ((has_any_role(ARRAY['approver'::text, 'general_manager'::text, 'super_admin'::text]))) with check ((has_any_role(ARRAY['approver'::text, 'general_manager'::text, 'super_admin'::text])));
alter policy "approver writes meta_ads" on public.meta_ads using ((has_any_role(ARRAY['approver'::text, 'general_manager'::text, 'super_admin'::text]))) with check ((has_any_role(ARRAY['approver'::text, 'general_manager'::text, 'super_admin'::text])));
alter policy "approver writes meta_adsets" on public.meta_adsets using ((has_any_role(ARRAY['approver'::text, 'general_manager'::text, 'super_admin'::text]))) with check ((has_any_role(ARRAY['approver'::text, 'general_manager'::text, 'super_admin'::text])));
alter policy "approver writes meta_campaigns" on public.meta_campaigns using ((has_any_role(ARRAY['approver'::text, 'general_manager'::text, 'super_admin'::text]))) with check ((has_any_role(ARRAY['approver'::text, 'general_manager'::text, 'super_admin'::text])));
alter policy "approver writes meta_creatives" on public.meta_creatives using ((has_any_role(ARRAY['approver'::text, 'general_manager'::text, 'super_admin'::text]))) with check ((has_any_role(ARRAY['approver'::text, 'general_manager'::text, 'super_admin'::text])));
alter policy "pda insert" on public.patient_doctor_assignments with check ((((has_role('nursing'::text)) OR has_archive_access() OR can_manage_all_content()) AND (assigned_by = my_admin_id()) AND is_active_sono_doctor(doctor_id)));
alter policy "pda select" on public.patient_doctor_assignments using (((doctor_id = my_admin_id()) OR has_archive_access() OR has_archive_review_access() OR (has_role('nursing'::text)) OR can_manage_all_content()));
alter policy "staff_alerts_ack" on public.staff_kpi_alerts using ((has_any_role(ARRAY['super_admin'::text, 'general_manager'::text]))) with check ((has_any_role(ARRAY['super_admin'::text, 'general_manager'::text])));
alter policy "staff_alerts_read" on public.staff_kpi_alerts using ((has_any_role(ARRAY['super_admin'::text, 'general_manager'::text])));
alter policy "staff_kpi_settings_write" on public.staff_kpi_settings using ((has_role('super_admin'::text))) with check ((has_role('super_admin'::text)));
alter policy "staff_summaries_read" on public.staff_monthly_summaries using ((has_any_role(ARRAY['super_admin'::text, 'general_manager'::text])));
alter policy "staff_reviews_read" on public.staff_reviews using ((has_any_role(ARRAY['super_admin'::text, 'general_manager'::text])));
alter policy "staff_reviews_update" on public.staff_reviews using ((has_any_role(ARRAY['super_admin'::text, 'general_manager'::text]))) with check ((reviewed_by = my_admin_id()));
alter policy "staff_reviews_write" on public.staff_reviews with check (((has_any_role(ARRAY['super_admin'::text, 'general_manager'::text])) AND (reviewed_by = my_admin_id())));
alter policy "weekly_reports_read" on public.weekly_reports using ((has_any_role(ARRAY['super_admin'::text, 'general_manager'::text])));
