do $$
declare
  role_password text;
begin
  select decrypted_secret
  into role_password
  from vault.decrypted_secrets
  where name = 'leadops_n8n_db_password'
  limit 1;

  if role_password is null then
    role_password := replace(gen_random_uuid()::text, '-', '')
      || replace(gen_random_uuid()::text, '-', '');

    perform vault.create_secret(
      role_password,
      'leadops_n8n_db_password',
      'Dedicated PostgreSQL login for the LeadOps AI n8n instance on Render.'
    );
  end if;

  if exists (select 1 from pg_roles where rolname = 'leadops_n8n') then
    execute format('alter role leadops_n8n login password %L', role_password);
  else
    execute format('create role leadops_n8n login password %L', role_password);
  end if;
end
$$;

grant connect on database postgres to leadops_n8n;

create schema if not exists n8n;
revoke all on schema n8n from public;
grant usage, create on schema n8n to leadops_n8n;
