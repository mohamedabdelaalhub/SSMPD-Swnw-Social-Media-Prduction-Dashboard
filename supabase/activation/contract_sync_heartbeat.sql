create table if not exists contract_marketing.runtime(id int primary key check(id=1),last_snapshot_at timestamptz not null); alter table contract_marketing.runtime enable row level security; revoke all on contract_marketing.runtime from public,anon,authenticated;
create or replace function public.contract_marketing_worker(p_action text,p_data jsonb default '{}') returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
declare p contract_marketing.profiles%rowtype;j contract_marketing.jobs%rowtype;v jsonb;slot timestamptz;c uuid;out_url text;
begin
 if coalesce(auth.role(),'')<>'service_role' then raise exception 'Worker only';end if;
 perform pg_advisory_xact_lock(7823041);
 perform contract_marketing.refresh();
 if p_action='snapshot' then
  insert into contract_marketing.runtime(id,last_snapshot_at) values(1,now()) on conflict(id) do update set last_snapshot_at=excluded.last_snapshot_at;
  return coalesce((select jsonb_agg(jsonb_build_object('id',pr.id,'kind',pr.kind,'revision',pr.revision,'facts',pr.facts,'asset_path',pr.asset_path,'name',contract_marketing.source(pr.kind,pr.source_key)->>'name','visible',pr.website_enabled and pr.publication_state='active' and coalesce((contract_marketing.source(pr.kind,pr.source_key)->>'eligible')::boolean,false))) from contract_marketing.profiles pr),'[]');
 end if;
 if p_action='claim' then
  select * into j from contract_marketing.jobs where (status in ('queued','failed') and next_attempt_at<=now() and attempts<5) or (status='processing' and lease_until<now() and attempts<5) order by updated_at for update skip locked limit 1;
  if not found then return null;end if;
  select * into p from contract_marketing.profiles where id=j.profile_id;
  update contract_marketing.jobs set status='processing',lease=gen_random_uuid(),lease_until=now()+interval '10 minutes',revision=p.revision,attempts=attempts+1,updated_at=now() where id=j.id returning * into j;
  return jsonb_build_object('job',to_jsonb(j),'profile',to_jsonb(p),'source',contract_marketing.source(p.kind,p.source_key));
 end if;
 select * into j from contract_marketing.jobs where id=(p_data->>'id')::uuid and lease=(p_data->>'lease')::uuid and lease_until>now() and status='processing' for update;
 if not found then raise exception 'انتهت صلاحية الطلب';end if;
 select * into p from contract_marketing.profiles where id=j.profile_id;
 if p.revision<>j.revision then raise exception 'تغيرت بيانات التعاقد';end if;
 if p_action='get' then return jsonb_build_object('job',to_jsonb(j),'profile',to_jsonb(p),'source',contract_marketing.source(p.kind,p.source_key));end if;
 if p_action='begin_generation' then
  if j.idea is not null then return jsonb_build_object('idea',j.idea);end if;
  if j.generation_started then raise exception 'نتيجة توليد سابقة غير مؤكدة؛ راجع الطلب قبل إعادة المحاولة';end if;
  update contract_marketing.jobs set generation_started=true where id=j.id;return '{}'::jsonb;
 elsif p_action='idea' then
  if j.idea is null then update contract_marketing.jobs set idea=p_data->'idea' where id=j.id;end if;return '{}'::jsonb;
 elsif p_action='fail' then
  update contract_marketing.jobs set status=case when p_data->>'code'='TEMPLATE_NOT_READY' then 'waiting_template' else 'failed' end,last_error=left(p_data->>'error',500),lease=null,lease_until=null,next_attempt_at=now()+interval '15 minutes',updated_at=now() where id=j.id;return '{}'::jsonb;
 elsif p_action='finish' then
  if j.idea is null then raise exception 'المحتوى غير مكتمل';end if;
  -- Only a file uploaded by the worker under this exact job can be published.
  out_url:=p_data->>'output_url';
  if out_url not like 'https://uuijfbpgvtdxgaosqpxo.supabase.co/storage/v1/object/authenticated/content-designs/'||j.id::text||'/%/output.png' then raise exception 'ملف التصميم غير صالح';end if;
  if not exists(select 1 from storage.objects where bucket_id='content-designs' and name=split_part(out_url,'/content-designs/',2)) then raise exception 'ملف التصميم غير موجود';end if;
  slot:=date_trunc('minute',now())+interval '5 minutes';
  while exists(select 1 from public.meta_publish_jobs where brand='sono' and status in ('pending','processing','published','partial') and scheduled_at between slot-interval '2 hours' and slot+interval '2 hours') loop slot:=slot+interval '5 minutes';end loop;
  insert into public.content_items(id,title,body,caption_text,stage,created_by,brand,content_format,publish_platforms,agent_raw_output,design_file_url,scheduled_publish_at,scheduled_by)
   values(j.id,j.idea->>'title',j.idea->>'idea',j.idea->>'caption','scheduled',p.created_by,'sono','image_post',p.platforms,(j.idea||jsonb_build_object('contract_marketing_profile',p.id))::text,out_url,slot,p.created_by) returning id into c;
  insert into public.design_versions(content_id,created_by,output_file_url,settings) values(c,p.created_by,out_url,p_data->'settings');
  insert into public.meta_publish_jobs(content_id,brand,scheduled_at,publish_facebook,publish_instagram,created_by) values(c,'sono',slot,p.platforms?'facebook',p.platforms?'instagram',p.created_by);
  update contract_marketing.jobs set status='scheduled',content_id=c,lease=null,lease_until=null,last_error=null,updated_at=now() where id=j.id;
  return jsonb_build_object('content_id',c,'scheduled_at',slot);
 end if;
 raise exception 'Unknown action';
end $$;

