-- OPTION د variant of 05 (section «التغذية والتخسيس» moved into «العلاج الطبيعي»). Center list «سونو / دار النقاهة» — fix section names, reopen the merged batch, prepare the master review.
-- Session runs as the DB owner (no role switch: clinic_prices is not granted to authenticated); the JWT claim makes
-- my_admin_id() resolve to the owner so the SECURITY DEFINER RPCs see the owner as actor.
-- Runs ONLY after mig 20261123090000 and the owner's «انشر». Acts AS THE OWNER (list creator, super_admin) through the
-- same RPCs the dashboard uses; every call writes clinic_prices.audit. Idempotent: each step is skipped when already done.
-- Final 'review' (activation) is NOT here: محمود عبدالعال or Dr. Dina Hosni must click «اعتماد» themselves.
select set_config('request.jwt.claims','{"sub":"21a0b295-f4ca-472d-b48b-7be456cf0c64","role":"authenticated"}',true);
do $$
declare lid constant uuid:='12289346-917a-40e6-bd74-9b9696f844f4';rev int;sec uuid;repl uuid;b clinic_prices.batches%rowtype;
begin
 if public.my_admin_id() is distinct from 'bd5a528f-af8d-4ada-afe9-ce64e68b1d92'::uuid then raise exception 'wrong actor: expected the owner admin';end if;
 -- 1) «الطواري» -> «الطوارئ»
 select id into sec from clinic_prices.sections where list_id=lid and name='الطواري';
 if sec is not null then select revision into rev from clinic_prices.lists where id=lid;
  perform public.price_import_command('section',jsonb_build_object('list_id',lid,'list_revision',rev,'id',sec,'name','الطوارئ'));end if;
 -- 2) «المخ والاعصاب» -> «المخ والأعصاب»
 select id into sec from clinic_prices.sections where list_id=lid and name='المخ والاعصاب';
 if sec is not null then select revision into rev from clinic_prices.lists where id=lid;
  perform public.price_import_command('section',jsonb_build_object('list_id',lid,'list_revision',rev,'id',sec,'name','المخ والأعصاب'));end if;
 -- 3) «التغذية والتخسيس» -> moved into «العلاج الطبيعي» (owner option د)
 select id into sec from clinic_prices.sections where list_id=lid and name='التغذية والتخسيس';
 select id into repl from clinic_prices.sections where list_id=lid and name='العلاج الطبيعي';
 if sec is not null then
  if repl is null then raise exception 'قسم العلاج الطبيعي غير موجود في اللائحة';end if;
  select revision into rev from clinic_prices.lists where id=lid;
  perform public.price_import_command('section_delete',jsonb_build_object('list_id',lid,'list_revision',rev,'id',sec,'replacement_section_id',repl));end if;
 -- 4) reopen the merged المسالك batch (owner option أ)
 for b in select * from clinic_prices.batches where list_id=lid and status='applied' loop
  select revision into rev from clinic_prices.lists where id=lid;
  perform public.price_master_reopen_batch(jsonb_build_object('list_id',lid,'list_revision',rev,'batch_id',b.id,'batch_revision',b.revision,
    'reason','إرجاع دفعة المسالك المضمومة يوم 24-10 لتدخل مع مرجع المركز كاملًا (قرار المالك 23-11)'));
 end loop;
 -- 5) prepare the master review (the reviewer approves later from the dashboard)
 select revision into rev from clinic_prices.lists where id=lid;
 perform public.price_master_command('prepare',jsonb_build_object('list_id',lid,'revision',rev));
end $$;
