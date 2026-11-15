-- Contract marketing: full automatic welcome-post flow on the LIVE database, then ROLLBACK.
-- Owner request 2026-11-15: «تجريب فقط بدون نشر». Nothing survives this script:
--  * a test profile is created for one doctor whose contract is active and who has NO contract-marketing profile yet;
--  * the worker RPC claims, records an idea, and finishes exactly like the real worker (content item + design version +
--    scheduled publish job are created), and every result is checked;
--  * the final ROLLBACK removes all of it. Publish jobs, notifications and any queued HTTP calls only exist inside
--    this uncommitted transaction, so nothing can be published. No real doctor's one-time announcement is used up.
-- Keep the transaction short: the worker RPC takes an advisory lock that live workers also wait on.
begin;
set local statement_timeout='60s';
do $$
declare doc text;owner uuid;prof uuid;r jsonb;job uuid;lease uuid;out_url text;cid uuid;n int;slot timestamptz;
begin
 -- 1) An eligible doctor without any existing profile, so no real announcement is touched.
 select d.doctor_key into doc from (select distinct doctor_key from clinic_finance.doctor_contracts) d
  where coalesce((contract_marketing.source('doctor',d.doctor_key)->>'eligible')::boolean,false)
    and not exists(select 1 from contract_marketing.profiles p where p.kind='doctor' and p.source_key=d.doctor_key)
  order by d.doctor_key limit 1;
 if doc is null then raise exception 'ROLLBACK TEST: no eligible doctor without a profile';end if;
 select id into owner from public.admins where role='super_admin' and active order by created_at limit 1;
 -- No other claimable job may exist, otherwise claim could pick a real one.
 if exists(select 1 from contract_marketing.jobs where status in ('queued','failed','processing')) then
  raise exception 'ROLLBACK TEST: real jobs are pending; run later';end if;
 insert into contract_marketing.profiles(kind,source_key,created_by,facts,website_enabled,auto_announce,platforms)
  values('doctor',doc,owner,'{"prefix":"الدكتور","title":"اختبار تراجع فقط","days":"السبت","time_from":"10:00","time_to":"14:00"}',false,true,'["facebook","instagram"]')
  returning id into prof;
 update contract_marketing.profiles set asset_path=prof::text||'/rollback-test.png' where id=prof;
 insert into storage.objects(bucket_id,name) values('contract-marketing',prof::text||'/rollback-test.png');
 -- 2) Act as the worker (service_role), like the edge function does.
 perform set_config('request.jwt.claim.role','service_role',true);
 perform set_config('request.jwt.claims','{"role":"service_role"}',true);
 r:=public.contract_marketing_worker('claim','{}');
 if r is null or (r->'job'->>'profile_id')::uuid<>prof then raise exception 'ROLLBACK TEST: claim did not return the test job: %',r;end if;
 job:=(r->'job'->>'id')::uuid;lease:=(r->'job'->>'lease')::uuid;
 perform public.contract_marketing_worker('begin_generation',jsonb_build_object('id',job,'lease',lease));
 perform public.contract_marketing_worker('idea',jsonb_build_object('id',job,'lease',lease,'idea',jsonb_build_object('title','اختبار تراجع','idea','لا يُنشر','caption','لا يُنشر')));
 -- 3) A design link on the old cloud project must be refused; the self-hosted one accepted.
 begin
  perform public.contract_marketing_worker('finish',jsonb_build_object('id',job,'lease',lease,'output_url','https://uuijfbpgvtdxgaosqpxo.supabase.co/storage/v1/object/authenticated/content-designs/'||job||'/x/output.png'));
  raise exception 'ROLLBACK TEST: old-project link was accepted';
 exception when others then if sqlerrm not like '%ملف التصميم غير صالح%' then raise;end if;end;
 out_url:='https://api.swnwclinics.com/storage/v1/object/authenticated/content-designs/'||job||'/'||gen_random_uuid()||'/output.png';
 insert into storage.objects(bucket_id,name) values('content-designs',split_part(out_url,'/content-designs/',2));
 r:=public.contract_marketing_worker('finish',jsonb_build_object('id',job,'lease',lease,'output_url',out_url,'settings','{"template":"sono-doctor-v1"}'));
 cid:=(r->>'content_id')::uuid;slot:=(r->>'scheduled_at')::timestamptz;
 -- 4) Check what the real flow would have produced.
 select count(*) into n from public.content_items where id=cid and stage='scheduled' and design_file_url=out_url;if n<>1 then raise exception 'ROLLBACK TEST: content item missing';end if;
 select count(*) into n from public.design_versions where content_id=cid and output_file_url=out_url;if n<>1 then raise exception 'ROLLBACK TEST: design version missing';end if;
 select count(*) into n from public.meta_publish_jobs where content_id=cid and status='pending' and scheduled_at=slot;if n<>1 then raise exception 'ROLLBACK TEST: publish job missing';end if;
 if slot<now()+interval '4 minutes' then raise exception 'ROLLBACK TEST: slot too early';end if;
 select count(*) into n from contract_marketing.jobs where id=job and status='scheduled' and content_id=cid;if n<>1 then raise exception 'ROLLBACK TEST: job not scheduled';end if;
 raise notice 'PASS contract-marketing live flow (rolled back): doctor %, job %, scheduled slot % — nothing kept, nothing published',doc,job,slot;
end $$;
rollback;
