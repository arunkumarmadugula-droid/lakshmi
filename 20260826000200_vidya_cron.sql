begin;

create extension if not exists pg_cron with schema pg_catalog;
create extension if not exists pg_net with schema extensions;
create extension if not exists supabase_vault;

-- This function deliberately does nothing until both named Vault secrets exist.
-- The migration can therefore be deployed before secrets are configured.
create or replace function private.invoke_vidya_ai_cron(brief_kind text)
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  function_url text;
  cron_secret text;
  request_id bigint;
begin
  select decrypted_secret
    into function_url
    from vault.decrypted_secrets
   where name = 'vidya_function_url'
   order by updated_at desc
   limit 1;

  select decrypted_secret
    into cron_secret
    from vault.decrypted_secrets
   where name = 'vidya_cron_secret'
   order by updated_at desc
   limit 1;

  if function_url is null or cron_secret is null then
    return null;
  end if;

  select net.http_post(
    url := function_url,
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-vidya-cron-secret', cron_secret
    ),
    body := jsonb_build_object(
      'operation', 'brief.generate',
      'kind', brief_kind,
      'scheduled', true
    ),
    timeout_milliseconds := 120000
  ) into request_id;

  return request_id;
end;
$$;

revoke all on function private.invoke_vidya_ai_cron(text) from public, anon, authenticated;

do $$
declare
  existing_job bigint;
begin
  select jobid into existing_job from cron.job where jobname = 'vidya-daily-brief-check';
  if existing_job is not null then
    perform cron.unschedule(existing_job);
  end if;

  -- Check every 15 minutes; the Edge Function generates at most once per local day.
  perform cron.schedule(
    'vidya-daily-brief-check',
    '*/15 * * * *',
    'select private.invoke_vidya_ai_cron(''daily'');'
  );

  select jobid into existing_job from cron.job where jobname = 'vidya-research-refresh';
  if existing_job is not null then
    perform cron.unschedule(existing_job);
  end if;

  -- Research is refreshed every five hours. Existing unread briefs are retained.
  perform cron.schedule(
    'vidya-research-refresh',
    '17 */5 * * *',
    'select private.invoke_vidya_ai_cron(''research_refresh'');'
  );
end;
$$;

commit;
