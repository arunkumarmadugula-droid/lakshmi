begin;

create schema if not exists private;
revoke all on schema private from public, anon, authenticated;

create or replace function private.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create table if not exists public.vidya_profiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  display_name text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.brief_schedules (
  user_id uuid primary key references auth.users(id) on delete cascade,
  enabled boolean not null default false,
  local_time time without time zone not null default time '07:00',
  timezone text not null default 'UTC',
  research_enabled boolean not null default false,
  last_daily_at timestamptz,
  last_research_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint brief_schedules_timezone_length check (char_length(timezone) between 1 and 64)
);

-- The app sends a deliberately small snapshot for background briefs. Full files
-- remain in the encrypted local vault; only selected metadata/excerpts go here.
create table if not exists public.assistant_snapshots (
  user_id uuid primary key references auth.users(id) on delete cascade,
  open_tasks jsonb not null default '[]'::jsonb,
  unread_feed jsonb not null default '[]'::jsonb,
  library_items jsonb not null default '[]'::jsonb,
  interests text[] not null default '{}',
  activity jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint assistant_snapshots_open_tasks_array check (jsonb_typeof(open_tasks) = 'array'),
  constraint assistant_snapshots_unread_feed_array check (jsonb_typeof(unread_feed) = 'array'),
  constraint assistant_snapshots_library_items_array check (jsonb_typeof(library_items) = 'array'),
  constraint assistant_snapshots_activity_array check (jsonb_typeof(activity) = 'array')
);

create table if not exists public.ai_usage (
  id uuid primary key default gen_random_uuid(),
  request_id uuid not null,
  user_id uuid not null references auth.users(id) on delete cascade,
  principal_mode text not null check (principal_mode in ('owner', 'jwt', 'cron')),
  operation text not null,
  model text not null,
  input_tokens integer not null default 0 check (input_tokens >= 0),
  output_tokens integer not null default 0 check (output_tokens >= 0),
  total_tokens integer not null default 0 check (total_tokens >= 0),
  grounded_requests integer not null default 0 check (grounded_requests >= 0),
  estimated_usd numeric(14, 8) not null default 0 check (estimated_usd >= 0),
  success boolean not null default true,
  error_code text,
  duration_ms integer not null default 0 check (duration_ms >= 0),
  created_at timestamptz not null default now()
);

create table if not exists public.ai_briefs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  usage_id uuid references public.ai_usage(id) on delete set null,
  kind text not null check (kind in ('daily', 'tomorrow', 'research_refresh', 'manual')),
  content jsonb not null,
  sources jsonb not null default '[]'::jsonb,
  model text not null,
  status text not null default 'unread' check (status in ('unread', 'read', 'archived')),
  created_at timestamptz not null default now(),
  constraint ai_briefs_sources_array check (jsonb_typeof(sources) = 'array')
);

drop trigger if exists vidya_profiles_set_updated_at on public.vidya_profiles;
create trigger vidya_profiles_set_updated_at
before update on public.vidya_profiles
for each row execute function private.set_updated_at();

drop trigger if exists brief_schedules_set_updated_at on public.brief_schedules;
create trigger brief_schedules_set_updated_at
before update on public.brief_schedules
for each row execute function private.set_updated_at();

drop trigger if exists assistant_snapshots_set_updated_at on public.assistant_snapshots;
create trigger assistant_snapshots_set_updated_at
before update on public.assistant_snapshots
for each row execute function private.set_updated_at();

create index if not exists ai_usage_user_created_idx
  on public.ai_usage(user_id, created_at desc);
create index if not exists ai_usage_user_operation_created_idx
  on public.ai_usage(user_id, operation, created_at desc);
create unique index if not exists ai_usage_user_request_idx
  on public.ai_usage(user_id, request_id);
create index if not exists ai_briefs_user_kind_created_idx
  on public.ai_briefs(user_id, kind, created_at desc);

alter table public.vidya_profiles enable row level security;
alter table public.brief_schedules enable row level security;
alter table public.assistant_snapshots enable row level security;
alter table public.ai_usage enable row level security;
alter table public.ai_briefs enable row level security;

drop policy if exists "profiles_select_own" on public.vidya_profiles;
create policy "profiles_select_own" on public.vidya_profiles
for select to authenticated using ((select auth.uid()) = user_id);
drop policy if exists "profiles_insert_own" on public.vidya_profiles;
create policy "profiles_insert_own" on public.vidya_profiles
for insert to authenticated with check ((select auth.uid()) = user_id);
drop policy if exists "profiles_update_own" on public.vidya_profiles;
create policy "profiles_update_own" on public.vidya_profiles
for update to authenticated
using ((select auth.uid()) = user_id)
with check ((select auth.uid()) = user_id);

drop policy if exists "schedules_select_own" on public.brief_schedules;
create policy "schedules_select_own" on public.brief_schedules
for select to authenticated using ((select auth.uid()) = user_id);
drop policy if exists "schedules_insert_own" on public.brief_schedules;
create policy "schedules_insert_own" on public.brief_schedules
for insert to authenticated with check ((select auth.uid()) = user_id);
drop policy if exists "schedules_update_own" on public.brief_schedules;
create policy "schedules_update_own" on public.brief_schedules
for update to authenticated
using ((select auth.uid()) = user_id)
with check ((select auth.uid()) = user_id);
drop policy if exists "schedules_delete_own" on public.brief_schedules;
create policy "schedules_delete_own" on public.brief_schedules
for delete to authenticated using ((select auth.uid()) = user_id);

drop policy if exists "snapshots_select_own" on public.assistant_snapshots;
create policy "snapshots_select_own" on public.assistant_snapshots
for select to authenticated using ((select auth.uid()) = user_id);
drop policy if exists "snapshots_insert_own" on public.assistant_snapshots;
create policy "snapshots_insert_own" on public.assistant_snapshots
for insert to authenticated with check ((select auth.uid()) = user_id);
drop policy if exists "snapshots_update_own" on public.assistant_snapshots;
create policy "snapshots_update_own" on public.assistant_snapshots
for update to authenticated
using ((select auth.uid()) = user_id)
with check ((select auth.uid()) = user_id);
drop policy if exists "snapshots_delete_own" on public.assistant_snapshots;
create policy "snapshots_delete_own" on public.assistant_snapshots
for delete to authenticated using ((select auth.uid()) = user_id);

drop policy if exists "usage_select_own" on public.ai_usage;
create policy "usage_select_own" on public.ai_usage
for select to authenticated using ((select auth.uid()) = user_id);

drop policy if exists "briefs_select_own" on public.ai_briefs;
create policy "briefs_select_own" on public.ai_briefs
for select to authenticated using ((select auth.uid()) = user_id);
drop policy if exists "briefs_update_own" on public.ai_briefs;
create policy "briefs_update_own" on public.ai_briefs
for update to authenticated
using ((select auth.uid()) = user_id)
with check ((select auth.uid()) = user_id);

revoke all on table public.vidya_profiles from anon;
revoke all on table public.brief_schedules from anon;
revoke all on table public.assistant_snapshots from anon;
revoke all on table public.ai_usage from anon;
revoke all on table public.ai_briefs from anon;

grant select, insert, update on table public.vidya_profiles to authenticated;
grant select, insert, update, delete on table public.brief_schedules to authenticated;
grant select, insert, update, delete on table public.assistant_snapshots to authenticated;
grant select on table public.ai_usage to authenticated;
grant select on table public.ai_briefs to authenticated;
grant update(status) on table public.ai_briefs to authenticated;

create or replace view public.ai_cost_daily
with (security_invoker = true)
as
select
  user_id,
  (created_at at time zone 'UTC')::date as usage_date,
  operation,
  model,
  count(*) filter (where success) as successful_requests,
  count(*) filter (where not success) as failed_requests,
  sum(input_tokens) as input_tokens,
  sum(output_tokens) as output_tokens,
  sum(grounded_requests) as grounded_requests,
  sum(estimated_usd) as estimated_usd
from public.ai_usage
group by user_id, (created_at at time zone 'UTC')::date, operation, model;

revoke all on public.ai_cost_daily from anon;
grant select on public.ai_cost_daily to authenticated;

commit;
