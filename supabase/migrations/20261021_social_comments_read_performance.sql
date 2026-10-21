-- Prevent the social-comments permission helper from being evaluated once per row.
-- The scalar subquery makes PostgreSQL build an InitPlan and evaluate access once per request.

drop policy if exists social_comments_read on public.social_comments;
create policy social_comments_read
on public.social_comments
for select
to authenticated
using ((select public.social_comments_access()));

drop policy if exists social_messages_read on public.social_messages;
create policy social_messages_read
on public.social_messages
for select
to authenticated
using ((select public.social_comments_access()));

drop policy if exists social_reply_templates_read on public.social_reply_templates;
create policy social_reply_templates_read
on public.social_reply_templates
for select
to authenticated
using ((select public.social_comments_access()));

drop policy if exists social_settings_read on public.social_settings;
create policy social_settings_read
on public.social_settings
for select
to authenticated
using ((select public.social_comments_access()));

create index if not exists social_comments_commented_at_idx
  on public.social_comments (commented_at desc);

create index if not exists social_messages_sent_at_idx
  on public.social_messages (sent_at desc);
