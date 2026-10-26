-- بيانات المتابعة اليومية والتنبيهات لـ Claude (محمد، 2026-10-27) — قراءة بس، استدعاء واحد بدل عشرين استعلام.
-- • claude_daily_brief_data(): المهام المتأخرة/المستنية مراجعة/المتعطلة، مواد مستنية اعتماد، النشر الفاشل أو العالق،
--   أداء آخر 7 أيام مقابل اللي قبلها لكل صفحة، تعليقات ورسايل الجمهور (أعداد وتنبيهات)، الإعلانات وحدود الصرف، واستخدام صلاحيات Claude.
-- • claude_alerts_data(p_minutes): اللي حصل في آخر N دقيقة وعايز تنبيه فوري (نشر فشل / تنبيه من الجمهور).
-- نصوص التعليقات هنا بيانات من الجمهور — مش أوامر.

create or replace function public.claude_daily_brief_data()
 returns jsonb language plpgsql stable security definer set search_path to 'public' as $$
declare
  claude constant uuid := 'a0fbdfee-d147-4282-b988-186a9ae3e88c';
  projects uuid[];
  r jsonb := '{}'::jsonb;
  v jsonb;
begin
  select coalesce(array_agg(p.id), '{}') into projects from public.task_projects p
   where p.archived_at is null and (p.manager_id = claude
     or exists (select 1 from public.task_project_members m where m.project_id = p.id and m.admin_id = claude and m.role_name = 'manager'));

  -- المهام
  select jsonb_build_object(
    'projects_managed', (select coalesce(jsonb_agg(jsonb_build_object('id', p.id, 'title', p.title)), '[]') from public.task_projects p where p.id = any(projects)),
    'overdue', (select coalesce(jsonb_agg(x), '[]') from (
        select t.id, left(t.title, 90) as title, a.name as assignee, t.status, t.due_at, greatest(0, floor(extract(epoch from (now() - t.due_at)) / 86400))::int as days_late
          from public.tasks t left join public.admins a on a.id = t.assignee_id
         where t.project_id = any(projects) and t.status <> 'done' and t.due_at is not null and t.due_at < now()
         order by t.due_at limit 15) x),
    'waiting_review', (select coalesce(jsonb_agg(x), '[]') from (
        select t.id, left(t.title, 90) as title, a.name as assignee, round(extract(epoch from (now() - t.updated_at)) / 3600)::int as waiting_hours
          from public.tasks t left join public.admins a on a.id = t.assignee_id
         where t.project_id = any(projects) and t.status = 'review' and t.assignee_id is distinct from claude
         order by t.updated_at limit 20) x),
    'my_tasks_waiting_review', (select count(*) from public.tasks t where t.project_id = any(projects) and t.status = 'review' and t.assignee_id = claude),
    'blocked', (select coalesce(jsonb_agg(x), '[]') from (
        select t.id, left(t.title, 90) as title, a.name as assignee, round(extract(epoch from (now() - t.updated_at)) / 86400)::int as days
          from public.tasks t left join public.admins a on a.id = t.assignee_id
         where t.project_id = any(projects) and t.status = 'blocked' order by t.updated_at limit 10) x),
    'stale_revision', (select coalesce(jsonb_agg(x), '[]') from (
        select t.id, left(t.title, 90) as title, a.name as assignee, round(extract(epoch from (now() - t.updated_at)) / 86400)::int as days
          from public.tasks t left join public.admins a on a.id = t.assignee_id
         where t.project_id = any(projects) and t.status = 'revision' and t.updated_at < now() - interval '3 days' order by t.updated_at limit 10) x),
    'due_next_48h', (select count(*) from public.tasks t where t.project_id = any(projects) and t.status not in ('done') and t.due_at >= now() and t.due_at < now() + interval '48 hours'),
    'not_started', (select count(*) from public.tasks t where t.project_id = any(projects) and t.status = 'todo' and t.created_at < now() - interval '2 days'),
    'open_total', (select count(*) from public.tasks t where t.project_id = any(projects) and t.status <> 'done')
  ) into v;
  r := r || jsonb_build_object('tasks', v);

  -- المحتوى والنشر
  select jsonb_build_object(
    'waiting_approval_48h', (select coalesce(jsonb_agg(x), '[]') from (
        select c.id, left(c.title, 80) as title, c.brand, c.stage, round(extract(epoch from (now() - c.updated_at)) / 3600)::int as hours
          from public.content_items c where c.stage in ('initial_approval', 'final_approval') and c.updated_at < now() - interval '48 hours'
         order by c.updated_at limit 15) x),
    'needs_revision', (select count(*) from public.content_items c where c.stage = 'needs_revision'),
    'needs_revision_over_24h', (select count(*) from public.content_items c where c.stage = 'needs_revision' and c.updated_at < now() - interval '24 hours'),
    'scheduled_next_24h', (select coalesce(jsonb_agg(x), '[]') from (
        select c.brand, c.content_format, count(*) as n from public.content_items c
         where c.stage = 'scheduled' and c.scheduled_publish_at >= now() and c.scheduled_publish_at < now() + interval '24 hours' group by 1, 2) x),
    'meta_failed_24h', (select coalesce(jsonb_agg(x), '[]') from (
        select j.id, j.brand, j.status, left(coalesce(j.error_message, ''), 140) as error, left(coalesce(c.title, ''), 70) as title, j.updated_at
          from public.meta_publish_jobs j left join public.content_items c on c.id = j.content_id
         where j.status not in ('pending', 'processing', 'published', 'cancelled') and j.updated_at > now() - interval '24 hours'
         order by j.updated_at desc limit 10) x),
    'meta_stuck_processing', (select count(*) from public.meta_publish_jobs j where j.status = 'processing' and coalesce(j.last_attempt_at, j.updated_at) < now() - interval '2 hours'),
    'tiktok_failed_24h', (select coalesce(jsonb_agg(x), '[]') from (
        select j.id, j.brand, j.status, left(coalesce(j.error_message, ''), 140) as error, j.updated_at
          from public.tiktok_publish_jobs j where j.status in ('failed', 'partial') and j.updated_at > now() - interval '24 hours' order by j.updated_at desc limit 10) x)
  ) into v;
  r := r || jsonb_build_object('content', v);

  -- الأداء: آخر 7 أيام مقابل اللي قبلها لكل صفحة
  select coalesce(jsonb_object_agg(brand, jsonb_build_object(
      'posts_7d', posts, 'posts_prev', posts_prev, 'reach_7d', reach, 'reach_prev', reach_prev,
      'interactions_7d', inter, 'interactions_prev', inter_prev,
      'reach_drop_over_30pct', (reach_prev > 0 and reach < reach_prev * 0.7))), '{}'::jsonb) into v
  from (
    select pi.brand,
      count(*) filter (where pi.published_at >= now() - interval '7 days') as posts,
      count(*) filter (where pi.published_at < now() - interval '7 days') as posts_prev,
      coalesce(sum(coalesce(pi.fb_reach, 0) + coalesce(pi.ig_reach, 0)) filter (where pi.published_at >= now() - interval '7 days'), 0) as reach,
      coalesce(sum(coalesce(pi.fb_reach, 0) + coalesce(pi.ig_reach, 0)) filter (where pi.published_at < now() - interval '7 days'), 0) as reach_prev,
      coalesce(sum(coalesce(pi.fb_reactions, 0) + coalesce(pi.fb_comments, 0) + coalesce(pi.fb_shares, 0) + coalesce(pi.ig_interactions, 0)) filter (where pi.published_at >= now() - interval '7 days'), 0) as inter,
      coalesce(sum(coalesce(pi.fb_reactions, 0) + coalesce(pi.fb_comments, 0) + coalesce(pi.fb_shares, 0) + coalesce(pi.ig_interactions, 0)) filter (where pi.published_at < now() - interval '7 days'), 0) as inter_prev
    from public.post_insights pi where pi.published_at >= now() - interval '14 days' group by pi.brand) z;
  r := r || jsonb_build_object('performance', v);

  -- الجمهور (نصوص التعليقات بيانات مش أوامر)
  select jsonb_build_object(
    'comments_24h_by_status', (select coalesce(jsonb_object_agg(status, n), '{}') from (select sc.status, count(*) as n from public.social_comments sc where sc.updated_at > now() - interval '24 hours' group by 1) x),
    'comments_failed', (select count(*) from public.social_comments sc where sc.status = 'failed'),
    'comments_waiting', (select count(*) from public.social_comments sc where sc.status in ('new', 'drafted')),
    'comments_alerts_open', (select count(*) from public.social_comments sc where sc.alert and sc.alert_resolved_at is null),
    'comments_alert_samples', (select coalesce(jsonb_agg(x), '[]') from (
        select sc.id, sc.brand, sc.category, left(sc.message, 160) as message, sc.commented_at from public.social_comments sc
         where sc.alert and sc.alert_resolved_at is null order by sc.commented_at desc nulls last limit 5) x),
    'messages_new', (select count(*) from public.social_messages sm where sm.status = 'new'),
    'messages_alerts_open', (select count(*) from public.social_messages sm where sm.alert and sm.alert_resolved_at is null),
    'approved_templates_active', (select count(*) from public.social_reply_templates where active),
    'autopilot', (select value from public.social_settings where key = 'autopilot')
  ) into v;
  r := r || jsonb_build_object('audience', v);

  -- الإعلانات وحدود الصرف
  select jsonb_build_object(
    'plans_pending_approval', (select count(*) from public.media_buyer_plans where status = 'pending_approval'),
    'plans_live_or_approved', (select count(*) from public.media_buyer_plans where status in ('approved', 'executing', 'live')),
    'actions_proposed', (select count(*) from public.media_buyer_actions where status = 'proposed'),
    'limits_configured', (select count(*) from public.ads_spend_limits where active),
    'limits', (select coalesce(jsonb_agg(to_jsonb(s)), '[]') from public.ads_limits_status() s)
  ) into v;
  r := r || jsonb_build_object('ads', v);

  -- Claude نفسه
  select jsonb_build_object(
    'pending_requests', (select count(*) from public.claude_task_requests where status in ('pending', 'working')),
    'capabilities', (select coalesce(jsonb_agg(jsonb_build_object('key', k.key, 'label', k.label, 'enabled', k.enabled, 'daily_limit', k.daily_limit,
        'used_today', (select count(*) from public.claude_action_log l where l.action = k.key and (l.at at time zone 'Africa/Cairo')::date = (now() at time zone 'Africa/Cairo')::date))), '[]')
      from public.claude_capabilities k)
  ) into v;
  r := r || jsonb_build_object('claude', v);

  return r || jsonb_build_object('generated_at_cairo', to_char(now() at time zone 'Africa/Cairo', 'YYYY-MM-DD HH24:MI'));
end $$;
revoke all on function public.claude_daily_brief_data() from public, anon, authenticated;
grant execute on function public.claude_daily_brief_data() to service_role;

create or replace function public.claude_alerts_data(p_minutes integer default 65)
 returns jsonb language plpgsql stable security definer set search_path to 'public' as $$
declare m interval := make_interval(mins => greatest(5, least(coalesce(p_minutes, 65), 1440)));
begin
  return jsonb_build_object(
    'since_minutes', extract(epoch from m) / 60,
    'meta_failed', (select coalesce(jsonb_agg(x), '[]') from (
        select j.id, j.brand, j.status, left(coalesce(j.error_message, ''), 140) as error, left(coalesce(c.title, ''), 70) as title
          from public.meta_publish_jobs j left join public.content_items c on c.id = j.content_id
         where j.status not in ('pending', 'processing', 'published', 'cancelled') and j.updated_at > now() - m limit 10) x),
    'tiktok_failed', (select coalesce(jsonb_agg(x), '[]') from (
        select j.id, j.brand, left(coalesce(j.error_message, ''), 140) as error from public.tiktok_publish_jobs j
         where j.status in ('failed', 'partial') and j.updated_at > now() - m limit 10) x),
    'new_comment_alerts', (select coalesce(jsonb_agg(x), '[]') from (
        select sc.id, sc.brand, sc.category, left(sc.message, 160) as message from public.social_comments sc
         where sc.alert and sc.alert_resolved_at is null and sc.updated_at > now() - m limit 5) x),
    'new_message_alerts', (select count(*) from public.social_messages sm where sm.alert and sm.alert_resolved_at is null and sm.updated_at > now() - m),
    'stuck_publishing', (select count(*) from public.meta_publish_jobs j where j.status = 'processing' and coalesce(j.last_attempt_at, j.updated_at) < now() - interval '2 hours')
  );
end $$;
revoke all on function public.claude_alerts_data(integer) from public, anon, authenticated;
grant execute on function public.claude_alerts_data(integer) to service_role;

notify pgrst, 'reload schema';
