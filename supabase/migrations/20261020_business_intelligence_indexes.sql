-- Cover Business Intelligence foreign keys used by deletes, joins and owner analytics.

create index if not exists business_decisions_decided_by_idx
  on public.business_decisions(decided_by);
create index if not exists business_decisions_recommendation_idx
  on public.business_decisions(recommendation_id);
create index if not exists business_decisions_task_idx
  on public.business_decisions(task_id);

create index if not exists business_extraction_queue_author_idx
  on public.business_extraction_queue(author_id);
create index if not exists business_extraction_queue_project_idx
  on public.business_extraction_queue(project_id);
create index if not exists business_extraction_queue_task_idx
  on public.business_extraction_queue(task_id);

create index if not exists business_knowledge_approved_by_idx
  on public.business_knowledge_items(approved_by);
create index if not exists business_knowledge_created_by_idx
  on public.business_knowledge_items(created_by);
create index if not exists business_knowledge_source_author_idx
  on public.business_knowledge_items(source_author_id);
create index if not exists business_knowledge_source_project_idx
  on public.business_knowledge_items(source_project_id);
create index if not exists business_knowledge_source_result_idx
  on public.business_knowledge_items(source_result_id);
create index if not exists business_knowledge_superseded_by_idx
  on public.business_knowledge_items(superseded_by);

create index if not exists business_knowledge_relations_created_by_idx
  on public.business_knowledge_relations(created_by);
create index if not exists business_knowledge_relations_to_item_idx
  on public.business_knowledge_relations(to_item_id);

create index if not exists business_measurements_decision_idx
  on public.business_measurements(decision_id);
create index if not exists business_measurements_knowledge_idx
  on public.business_measurements(knowledge_item_id);
create index if not exists business_measurements_measured_by_idx
  on public.business_measurements(measured_by);
create index if not exists business_measurements_task_idx
  on public.business_measurements(task_id);

create index if not exists business_recommendations_approved_by_idx
  on public.business_recommendations(approved_by);
create index if not exists business_recommendations_operational_action_idx
  on public.business_recommendations(operational_action_id);
create index if not exists business_recommendations_proposed_by_idx
  on public.business_recommendations(proposed_by);
