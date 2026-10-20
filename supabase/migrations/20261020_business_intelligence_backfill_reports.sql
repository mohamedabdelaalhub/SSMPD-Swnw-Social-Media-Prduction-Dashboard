-- Backfill the latest approved work result for tasks already completed before the BI trigger existed.
-- The unique source_result_id constraint keeps this idempotent.

insert into public.business_extraction_queue(source_result_id,task_id,project_id,author_id)
select latest.id,latest.task_id,t.project_id,latest.author_id
from (
  select distinct on (w.task_id) w.id,w.task_id,w.author_id,w.created_at
  from public.task_work_results w
  join public.tasks tx on tx.id=w.task_id
  where w.status='review' and tx.status='done'
  order by w.task_id,w.created_at desc
) latest
join public.tasks t on t.id=latest.task_id
on conflict(source_result_id) do nothing;
