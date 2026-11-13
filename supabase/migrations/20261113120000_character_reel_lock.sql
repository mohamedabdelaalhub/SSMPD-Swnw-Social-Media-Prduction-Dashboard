-- قفل ريلات الشخصيات (2026-11-13، قرار محمد): الريل اللي content_angle = 'character_reel' بيتعمل بواسطة Claude بس.
-- الموظفين (أي دور غير المدير العام/السوبر أدمن) مايقدروش: يطلبوا «نفّذ المونتاج/التعديل»، ولا يغيّروا محتوى المادة
-- (العنوان/النص/الكابشن/الفيديو/المصمم/الغلاف)، ولا ينشئوا مادة بالعلامة دي. الاعتماد/طلب التعديل بالكومنت مش اتمنعوا
-- (guard_content_transition هو اللي بيتحكم فيهم). service_role وClaude نفسه (أو جلسة SQL بدون مستخدم) مستثنيين.
create or replace function public.guard_character_reel_lock()
 returns trigger
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare me uuid; claude constant uuid := 'a0fbdfee-d147-4282-b988-186a9ae3e88c';
begin
  if auth.role() = 'service_role' then return new; end if;
  me := public.my_admin_id();
  if me is null or me = claude or public.can_manage_all_content() then return new; end if;
  if tg_op = 'INSERT' then
    if new.content_angle = 'character_reel' then raise exception 'ريلات الشخصيات بيعملها Claude بس'; end if;
    return new;
  end if;
  if old.content_angle = 'character_reel' or new.content_angle = 'character_reel' then
    if new.title is distinct from old.title or new.body is distinct from old.body
       or new.script_text is distinct from old.script_text or new.caption_text is distinct from old.caption_text
       or new.hook_text is distinct from old.hook_text or new.video_storyboard is distinct from old.video_storyboard
       or new.design_file_url is distinct from old.design_file_url or new.cover_settings is distinct from old.cover_settings
       or new.assigned_designer is distinct from old.assigned_designer or new.design_execution is distinct from old.design_execution
       or new.content_angle is distinct from old.content_angle then
      raise exception 'ريل الشخصيات بيتعدّل عن طريق Claude بس — اكتب كومنت طلب تعديل أو كلّم المدير';
    end if;
  end if;
  return new;
end $function$;

drop trigger if exists trg_character_reel_lock on public.content_items;
create trigger trg_character_reel_lock before insert or update on public.content_items
  for each row execute function public.guard_character_reel_lock();

create or replace function public.guard_character_reel_design_request()
 returns trigger
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare me uuid;
begin
  if auth.role() = 'service_role' then return new; end if;
  me := public.my_admin_id();
  if me is null or public.can_manage_all_content() then return new; end if;
  if exists (select 1 from public.content_items c where c.id = new.content_id and c.content_angle = 'character_reel') then
    raise exception 'ريل الشخصيات بيعمله Claude بنفسه — مفيش طلب تنفيذ من الموظفين';
  end if;
  return new;
end $function$;

drop trigger if exists trg_character_reel_design_request on public.claude_design_requests;
create trigger trg_character_reel_design_request before insert on public.claude_design_requests
  for each row execute function public.guard_character_reel_design_request();
