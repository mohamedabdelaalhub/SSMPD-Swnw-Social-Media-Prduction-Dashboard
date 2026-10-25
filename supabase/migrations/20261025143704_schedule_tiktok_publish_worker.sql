do $$
declare source_command text;
begin
  if exists (select 1 from cron.job where jobname='tiktok-publish-tick') then
    return;
  end if;
  select command into source_command from cron.job where jobname='meta-publish-tick';
  if source_command is null then
    raise exception 'Existing Meta publish cron job was not found';
  end if;
  perform cron.schedule(
    'tiktok-publish-tick',
    '* * * * *',
    replace(source_command,'meta-publish-process','tiktok-publish-process')
  );
end $$;