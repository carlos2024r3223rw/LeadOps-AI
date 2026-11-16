-- LeadOps AI baseline schema.
-- Apply in a development Supabase project after reviewing the project settings.
-- The browser does not write these tables directly; public intake and mutations go through Fastify.

create schema if not exists private;
revoke all on schema private from public, anon, authenticated;

create type public.lead_status as enum (
  'new', 'processing', 'needs_review', 'approved', 'sending', 'sent', 'failed', 'discarded'
);
create type public.lead_priority as enum ('low', 'medium', 'high', 'urgent');
create type public.execution_status as enum ('queued', 'running', 'succeeded', 'failed', 'cancelled');
create type public.message_status as enum ('pending', 'sending', 'sent', 'failed', 'cancelled');
create type public.approval_decision as enum ('approved', 'discarded');

create table public.leads (
  id uuid primary key default gen_random_uuid(),
  reference bigint generated always as identity unique,
  status public.lead_status not null default 'new',
  name text not null check (char_length(name) between 2 and 120),
  email text not null check (char_length(email) <= 254),
  normalized_email text generated always as (lower(trim(email))) stored,
  company text check (char_length(company) <= 160),
  requested_service text not null check (requested_service in ('wordpress', 'woocommerce', 'shopify', 'other')),
  budget text not null,
  timeline text not null,
  description text not null check (char_length(description) between 20 and 4000),
  preferred_language text not null default 'es' check (preferred_language in ('es', 'en')),
  source text not null default 'public_form',
  current_assessment_id uuid,
  current_draft_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  sent_at timestamptz,
  discarded_at timestamptz
);

create table public.lead_requests (
  id uuid primary key default gen_random_uuid(),
  lead_id uuid not null references public.leads(id) on delete restrict,
  idempotency_key text not null unique check (char_length(idempotency_key) between 8 and 200),
  payload_hash text not null,
  request_ip_hash text,
  created_at timestamptz not null default now()
);

create table public.workflow_executions (
  id uuid primary key default gen_random_uuid(),
  lead_id uuid not null references public.leads(id) on delete restrict,
  root_execution_id uuid references public.workflow_executions(id) on delete restrict,
  workflow_name text not null,
  external_execution_id text,
  idempotency_key text not null unique,
  attempt integer not null default 1 check (attempt > 0),
  status public.execution_status not null default 'queued',
  model text,
  input_tokens integer not null default 0 check (input_tokens >= 0),
  output_tokens integer not null default 0 check (output_tokens >= 0),
  estimated_cost_usd numeric(12, 6) not null default 0 check (estimated_cost_usd >= 0),
  latency_ms integer check (latency_ms >= 0),
  error_code text,
  error_message text,
  error_details jsonb,
  started_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  unique (lead_id, workflow_name, attempt)
);

create table public.lead_assessments (
  id uuid primary key default gen_random_uuid(),
  lead_id uuid not null references public.leads(id) on delete restrict,
  execution_id uuid not null references public.workflow_executions(id) on delete restrict,
  version integer not null check (version > 0),
  classification text not null check (classification in ('qualified', 'nurture', 'unqualified')),
  priority public.lead_priority not null,
  detected_service text not null check (detected_service in ('wordpress', 'woocommerce', 'shopify', 'other')),
  missing_fields text[] not null default '{}',
  summary text not null,
  confidence numeric(5, 4) check (confidence between 0 and 1),
  raw_structured_output jsonb not null,
  created_at timestamptz not null default now(),
  unique (lead_id, version)
);

create table public.response_drafts (
  id uuid primary key default gen_random_uuid(),
  lead_id uuid not null references public.leads(id) on delete restrict,
  assessment_id uuid references public.lead_assessments(id) on delete restrict,
  version integer not null check (version > 0),
  subject text not null check (char_length(subject) between 3 and 180),
  body text not null check (char_length(body) between 20 and 10000),
  authored_by text not null check (authored_by in ('ai', 'human')),
  previous_draft_id uuid references public.response_drafts(id) on delete restrict,
  edited_by uuid references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  unique (lead_id, version)
);

alter table public.leads
  add constraint leads_current_assessment_fk foreign key (current_assessment_id) references public.lead_assessments(id) on delete restrict,
  add constraint leads_current_draft_fk foreign key (current_draft_id) references public.response_drafts(id) on delete restrict;

create table public.approvals (
  id uuid primary key default gen_random_uuid(),
  lead_id uuid not null references public.leads(id) on delete restrict,
  draft_id uuid not null references public.response_drafts(id) on delete restrict,
  draft_version integer not null,
  decision public.approval_decision not null,
  decided_by uuid references auth.users(id) on delete restrict,
  decided_by_label text,
  note text,
  created_at timestamptz not null default now(),
  check (decided_by is not null or decided_by_label is not null),
  unique (draft_id, decision)
);

create table public.outbound_messages (
  id uuid primary key default gen_random_uuid(),
  lead_id uuid not null references public.leads(id) on delete restrict,
  draft_id uuid not null references public.response_drafts(id) on delete restrict,
  approval_id uuid not null references public.approvals(id) on delete restrict,
  idempotency_key text not null unique,
  provider text not null default 'gmail' check (provider = 'gmail'),
  provider_message_id text unique,
  status public.message_status not null default 'pending',
  recipient_email text not null,
  subject text not null,
  body text not null,
  attempt_count integer not null default 0 check (attempt_count >= 0),
  claimed_at timestamptz,
  claimed_by text,
  last_error_code text,
  last_error_message text,
  sent_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (draft_id)
);

create table public.activity_events (
  id uuid primary key default gen_random_uuid(),
  lead_id uuid not null references public.leads(id) on delete restrict,
  execution_id uuid references public.workflow_executions(id) on delete restrict,
  actor_user_id uuid references auth.users(id) on delete restrict,
  event_type text not null,
  title text not null,
  detail text,
  metadata jsonb not null default '{}',
  created_at timestamptz not null default now()
);

-- Short-lived, fictitious portfolio demo state. Keeping this state in Postgres
-- makes isolated demo sessions reliable across serverless API instances.
create table public.demo_sessions (
  id uuid primary key,
  state jsonb not null,
  expires_at timestamptz not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index leads_status_created_idx on public.leads (status, created_at desc);
create index leads_email_idx on public.leads (normalized_email, created_at desc);
create index executions_lead_created_idx on public.workflow_executions (lead_id, created_at desc);
create index events_lead_created_idx on public.activity_events (lead_id, created_at desc);
create index outbound_pending_idx on public.outbound_messages (status, created_at) where status in ('pending', 'failed');
create index activity_events_actor_idx on public.activity_events (actor_user_id);
create index activity_events_execution_idx on public.activity_events (execution_id);
create index approvals_decided_by_idx on public.approvals (decided_by);
create index approvals_lead_idx on public.approvals (lead_id);
create index assessments_execution_idx on public.lead_assessments (execution_id);
create index lead_requests_lead_idx on public.lead_requests (lead_id);
create index leads_current_assessment_idx on public.leads (current_assessment_id);
create index leads_current_draft_idx on public.leads (current_draft_id);
create index outbound_approval_idx on public.outbound_messages (approval_id);
create index outbound_lead_idx on public.outbound_messages (lead_id);
create index response_drafts_assessment_idx on public.response_drafts (assessment_id);
create index response_drafts_edited_by_idx on public.response_drafts (edited_by);
create index response_drafts_previous_idx on public.response_drafts (previous_draft_id);
create index workflow_executions_root_idx on public.workflow_executions (root_execution_id);
create index demo_sessions_expires_idx on public.demo_sessions (expires_at);

create function private.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger leads_set_updated_at before update on public.leads
for each row execute function private.set_updated_at();
create trigger outbound_messages_set_updated_at before update on public.outbound_messages
for each row execute function private.set_updated_at();
create trigger demo_sessions_set_updated_at before update on public.demo_sessions
for each row execute function private.set_updated_at();

-- Read-only health check used by the external scheduled monitor. It performs a
-- real user database query without exposing tables or privileged data.
create function public.keepalive_ping()
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $$
  select jsonb_build_object('ok', true, 'checked_at', current_timestamp);
$$;

revoke all on function public.keepalive_ping() from public;
grant execute on function public.keepalive_ping() to anon, authenticated;

-- Defense in depth: every exposed table uses RLS and has default grants removed.
alter table public.leads enable row level security;
alter table public.lead_requests enable row level security;
alter table public.workflow_executions enable row level security;
alter table public.lead_assessments enable row level security;
alter table public.response_drafts enable row level security;
alter table public.approvals enable row level security;
alter table public.outbound_messages enable row level security;
alter table public.activity_events enable row level security;
alter table public.demo_sessions enable row level security;

revoke all on table public.leads, public.lead_requests, public.workflow_executions,
  public.lead_assessments, public.response_drafts, public.approvals,
  public.outbound_messages, public.activity_events, public.demo_sessions from anon, authenticated;

-- Signed-in dashboard users may read operational data only when the trusted
-- app_metadata role is assigned. All writes still go through Fastify/service_role.
grant select on table public.leads, public.workflow_executions, public.lead_assessments,
  public.response_drafts, public.approvals, public.outbound_messages,
  public.activity_events to authenticated;

create policy "clients cannot access intake envelopes" on public.lead_requests
for all to anon, authenticated
using (false)
with check (false);

create policy "clients cannot access demo sessions" on public.demo_sessions
for all to anon, authenticated
using (false)
with check (false);

create policy "operations team reads leads" on public.leads for select to authenticated
using (((select auth.jwt()) -> 'app_metadata' ->> 'role') in ('portfolio_admin', 'lead_operator'));
create policy "operations team reads executions" on public.workflow_executions for select to authenticated
using (((select auth.jwt()) -> 'app_metadata' ->> 'role') in ('portfolio_admin', 'lead_operator'));
create policy "operations team reads assessments" on public.lead_assessments for select to authenticated
using (((select auth.jwt()) -> 'app_metadata' ->> 'role') in ('portfolio_admin', 'lead_operator'));
create policy "operations team reads drafts" on public.response_drafts for select to authenticated
using (((select auth.jwt()) -> 'app_metadata' ->> 'role') in ('portfolio_admin', 'lead_operator'));
create policy "operations team reads approvals" on public.approvals for select to authenticated
using (((select auth.jwt()) -> 'app_metadata' ->> 'role') in ('portfolio_admin', 'lead_operator'));
create policy "operations team reads messages" on public.outbound_messages for select to authenticated
using (((select auth.jwt()) -> 'app_metadata' ->> 'role') in ('portfolio_admin', 'lead_operator'));
create policy "operations team reads events" on public.activity_events for select to authenticated
using (((select auth.jwt()) -> 'app_metadata' ->> 'role') in ('portfolio_admin', 'lead_operator'));

comment on table public.lead_requests is 'Idempotent intake envelope; service-side access only.';
comment on table public.approvals is 'Immutable human decisions tied to an exact response draft version.';
comment on table public.outbound_messages is 'Email outbox and database-level duplicate-send barrier.';
comment on function public.keepalive_ping() is 'Minimal read-only database health check for external uptime monitoring.';
comment on table public.demo_sessions is 'Expiring, fictitious demo state used by the server-side portfolio sandbox.';

