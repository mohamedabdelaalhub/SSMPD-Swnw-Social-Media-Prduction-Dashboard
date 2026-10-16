-- التقرير الأسبوعي لتسويق سونو (مهمة متكررة مسندة لحساب Claude Creative). مُطبَّق على القاعدة الحية.
-- weekly_marketing_report_data(p_days): دالة تجمّع أرقام الأسبوع في JSON واحد (للـservice role فقط) — انظر pg_get_functiondef.
-- weekly_report_fallback(): لو التقرير ما اتسلّمش قبل الميعاد بحوالي ساعتين، بتضيف تعليق بأرقام الأسبوع على المهمة (من غير ذكاء اصطناعي). cron: ssmpd-weekly-report-fallback الجمعة 18:30 UTC.
create table if not exists public.weekly_reports (
  id uuid primary key default gen_random_uuid(),
  week_start date not null, week_end date not null,
  doc_url text, summary text not null default '',
  decisions jsonb not null default '[]'::jsonb, priorities jsonb not null default '[]'::jsonb, recommendations jsonb not null default '[]'::jsonb,
  source text not null default 'claude' check (source in ('claude','fallback')),
  created_at timestamptz not null default now()
);
create unique index if not exists weekly_reports_week_source on public.weekly_reports(week_end, source);
alter table public.weekly_reports enable row level security;
drop policy if exists weekly_reports_read on public.weekly_reports;
create policy weekly_reports_read on public.weekly_reports for select to authenticated using (public.my_role() in ('super_admin','general_manager'));
