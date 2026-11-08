-- تراجع 20261108220000: يرجّع الشروط القديمة (my_role) ويشيل has_any_role.

alter policy "ai_clip_jobs_read" on public.ai_clip_jobs using ((my_role() = ANY (ARRAY['super_admin'::text, 'general_manager'::text, 'designer'::text, 'page_manager'::text])));
alter policy "ai_clip_prices_read" on public.ai_clip_prices using ((my_role() = ANY (ARRAY['super_admin'::text, 'general_manager'::text, 'designer'::text, 'page_manager'::text])));
alter policy "ai_clip_settings_read" on public.ai_clip_settings using ((my_role() = ANY (ARRAY['super_admin'::text, 'general_manager'::text, 'designer'::text, 'page_manager'::text])));
alter policy "content_learnings_read" on public.content_learnings using ((my_role() = ANY (ARRAY['page_manager'::text, 'designer'::text, 'approver'::text, 'general_manager'::text, 'super_admin'::text])));
alter policy "content_learnings_toggle" on public.content_learnings using ((my_role() = ANY (ARRAY['super_admin'::text, 'general_manager'::text]))) with check ((my_role() = ANY (ARRAY['super_admin'::text, 'general_manager'::text])));
alter policy "content_ratings_read" on public.content_ratings using ((my_role() = ANY (ARRAY['page_manager'::text, 'approver'::text, 'general_manager'::text, 'super_admin'::text])));
alter policy "content_ratings_update" on public.content_ratings using ((my_role() = ANY (ARRAY['page_manager'::text, 'approver'::text, 'general_manager'::text, 'super_admin'::text]))) with check ((rated_by = my_admin_id()));
alter policy "content_ratings_write" on public.content_ratings with check (((my_role() = ANY (ARRAY['page_manager'::text, 'approver'::text, 'general_manager'::text, 'super_admin'::text])) AND (rated_by = my_admin_id())));
alter policy "kpi_defs_read" on public.kpi_defs using ((my_role() = ANY (ARRAY['super_admin'::text, 'general_manager'::text])));
alter policy "kpi_targets_read" on public.kpi_targets using ((my_role() = ANY (ARRAY['super_admin'::text, 'general_manager'::text])));
alter policy "kpi_targets_write" on public.kpi_targets using ((my_role() = 'super_admin'::text)) with check ((my_role() = 'super_admin'::text));
alter policy "approver writes meta_ad_performance_lifetime" on public.meta_ad_performance_lifetime using ((my_role() = ANY (ARRAY['approver'::text, 'general_manager'::text, 'super_admin'::text]))) with check ((my_role() = ANY (ARRAY['approver'::text, 'general_manager'::text, 'super_admin'::text])));
alter policy "approver writes meta_ads" on public.meta_ads using ((my_role() = ANY (ARRAY['approver'::text, 'general_manager'::text, 'super_admin'::text]))) with check ((my_role() = ANY (ARRAY['approver'::text, 'general_manager'::text, 'super_admin'::text])));
alter policy "approver writes meta_adsets" on public.meta_adsets using ((my_role() = ANY (ARRAY['approver'::text, 'general_manager'::text, 'super_admin'::text]))) with check ((my_role() = ANY (ARRAY['approver'::text, 'general_manager'::text, 'super_admin'::text])));
alter policy "approver writes meta_campaigns" on public.meta_campaigns using ((my_role() = ANY (ARRAY['approver'::text, 'general_manager'::text, 'super_admin'::text]))) with check ((my_role() = ANY (ARRAY['approver'::text, 'general_manager'::text, 'super_admin'::text])));
alter policy "approver writes meta_creatives" on public.meta_creatives using ((my_role() = ANY (ARRAY['approver'::text, 'general_manager'::text, 'super_admin'::text]))) with check ((my_role() = ANY (ARRAY['approver'::text, 'general_manager'::text, 'super_admin'::text])));
alter policy "pda insert" on public.patient_doctor_assignments with check ((((my_role() = 'nursing'::text) OR has_archive_access() OR can_manage_all_content()) AND (assigned_by = my_admin_id()) AND is_active_sono_doctor(doctor_id)));
alter policy "pda select" on public.patient_doctor_assignments using (((doctor_id = my_admin_id()) OR has_archive_access() OR has_archive_review_access() OR (my_role() = 'nursing'::text) OR can_manage_all_content()));
alter policy "staff_alerts_ack" on public.staff_kpi_alerts using ((my_role() = ANY (ARRAY['super_admin'::text, 'general_manager'::text]))) with check ((my_role() = ANY (ARRAY['super_admin'::text, 'general_manager'::text])));
alter policy "staff_alerts_read" on public.staff_kpi_alerts using ((my_role() = ANY (ARRAY['super_admin'::text, 'general_manager'::text])));
alter policy "staff_kpi_settings_write" on public.staff_kpi_settings using ((my_role() = 'super_admin'::text)) with check ((my_role() = 'super_admin'::text));
alter policy "staff_summaries_read" on public.staff_monthly_summaries using ((my_role() = ANY (ARRAY['super_admin'::text, 'general_manager'::text])));
alter policy "staff_reviews_read" on public.staff_reviews using ((my_role() = ANY (ARRAY['super_admin'::text, 'general_manager'::text])));
alter policy "staff_reviews_update" on public.staff_reviews using ((my_role() = ANY (ARRAY['super_admin'::text, 'general_manager'::text]))) with check ((reviewed_by = my_admin_id()));
alter policy "staff_reviews_write" on public.staff_reviews with check (((my_role() = ANY (ARRAY['super_admin'::text, 'general_manager'::text])) AND (reviewed_by = my_admin_id())));
alter policy "weekly_reports_read" on public.weekly_reports using ((my_role() = ANY (ARRAY['super_admin'::text, 'general_manager'::text])));
drop function if exists public.has_any_role(text[]);
