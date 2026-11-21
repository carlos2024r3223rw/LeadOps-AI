create table if not exists public.gmail_integrations (
  id uuid primary key default gen_random_uuid(),
  owner_user_id uuid not null unique references auth.users(id) on delete cascade,
  account_email text,
  encrypted_access_token text,
  encrypted_refresh_token text,
  access_token_expires_at timestamptz,
  scopes text[] not null default '{}',
  pending_state_hash text unique,
  pending_state_expires_at timestamptz,
  connected_at timestamptz,
  revoked_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists gmail_integrations_owner_idx on public.gmail_integrations (owner_user_id);

drop trigger if exists gmail_integrations_set_updated_at on public.gmail_integrations;
create trigger gmail_integrations_set_updated_at before update on public.gmail_integrations
for each row execute function private.set_updated_at();

alter table public.gmail_integrations enable row level security;
revoke all on table public.gmail_integrations from anon, authenticated, public;
grant all on table public.gmail_integrations to service_role;

drop policy if exists "clients cannot access Gmail credentials" on public.gmail_integrations;
create policy "clients cannot access Gmail credentials" on public.gmail_integrations
for all to anon, authenticated
using (false)
with check (false);

comment on table public.gmail_integrations is 'Server-only encrypted Gmail OAuth credentials and short-lived authorization state.';
