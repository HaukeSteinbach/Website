create extension if not exists pgcrypto;

do $$ begin
    create type service_type as enum ('mixing', 'mastering', 'production', 'other');
exception
    when duplicate_object then null;
end $$;

do $$ begin
    create type job_status as enum ('draft', 'uploaded', 'in_progress', 'delivered', 'revision_requested', 'closed', 'expired_deleted');
exception
    when duplicate_object then null;
end $$;

do $$ begin
    create type file_kind as enum ('source', 'delivery', 'revision_attachment');
exception
    when duplicate_object then null;
end $$;

do $$ begin
    create type token_type as enum ('delivery_download', 'revision_request', 'admin_action');
exception
    when duplicate_object then null;
end $$;

do $$ begin
    create type event_type as enum ('uploaded', 'admin_downloaded', 'in_progress_sent', 'delivered', 'client_downloaded', 'revision_requested', 'expired_deleted');
exception
    when duplicate_object then null;
end $$;

create table if not exists clients (
    id uuid primary key default gen_random_uuid(),
    first_name text not null,
    last_name text not null,
    email text not null,
    street_1 text not null,
    street_2 text,
    postal_code text not null,
    city text not null,
    region text,
    country text not null,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
);

create table if not exists jobs (
    id uuid primary key default gen_random_uuid(),
    public_reference text not null unique,
    client_id uuid not null references clients(id),
    service service_type not null,
    status job_status not null default 'draft',
    project_notes text,
    consent_privacy_at timestamptz not null,
    consent_policy_version text not null,
    upload_completed_at timestamptz,
    in_progress_sent_at timestamptz,
    delivered_at timestamptz,
    delivery_expires_at timestamptz,
    revision_requested_at timestamptz,
    expired_deleted_at timestamptz,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
);

create table if not exists files (
    id uuid primary key default gen_random_uuid(),
    job_id uuid not null references jobs(id) on delete cascade,
    kind file_kind not null,
    storage_key text not null unique,
    original_filename text not null,
    mime_type text not null,
    size_bytes bigint not null,
    checksum_sha256 text,
    upload_state text not null default 'completed',
    uploaded_by text not null,
    deleted_at timestamptz,
    created_at timestamptz not null default now()
);

create table if not exists deliveries (
    id uuid primary key default gen_random_uuid(),
    job_id uuid not null references jobs(id) on delete cascade,
    version_number integer not null,
    client_message text,
    expires_at timestamptz not null,
    created_by_admin_id uuid,
    created_at timestamptz not null default now(),
    unique(job_id, version_number)
);

create table if not exists delivery_files (
    delivery_id uuid not null references deliveries(id) on delete cascade,
    file_id uuid not null references files(id) on delete cascade,
    primary key (delivery_id, file_id)
);

create table if not exists revision_requests (
    id uuid primary key default gen_random_uuid(),
    job_id uuid not null references jobs(id) on delete cascade,
    delivery_id uuid not null references deliveries(id) on delete cascade,
    message text not null,
    attachment_file_id uuid references files(id),
    submitted_at timestamptz not null default now(),
    is_one_time boolean not null default true
);

create table if not exists access_tokens (
    id uuid primary key default gen_random_uuid(),
    job_id uuid not null references jobs(id) on delete cascade,
    delivery_id uuid references deliveries(id) on delete cascade,
    type token_type not null,
    token_hash text not null unique,
    expires_at timestamptz not null,
    used_at timestamptz,
    max_uses integer,
    use_count integer not null default 0,
    created_at timestamptz not null default now()
);

create table if not exists events (
    id bigserial primary key,
    job_id uuid not null references jobs(id) on delete cascade,
    type event_type not null,
    actor_type text not null,
    actor_id text,
    metadata jsonb not null default '{}'::jsonb,
    created_at timestamptz not null default now()
);

create table if not exists admin_users (
    id uuid primary key default gen_random_uuid(),
    email text not null unique,
    password_hash text not null,
    role text not null default 'admin',
    mfa_enabled boolean not null default false,
    created_at timestamptz not null default now()
);

create index if not exists idx_clients_email on clients(email);
create index if not exists idx_jobs_status on jobs(status);
create index if not exists idx_jobs_client_id on jobs(client_id);
create index if not exists idx_jobs_service on jobs(service);
create index if not exists idx_files_job_id on files(job_id);
create index if not exists idx_files_kind on files(kind);
create index if not exists idx_deliveries_job_id on deliveries(job_id);
create index if not exists idx_deliveries_expires_at on deliveries(expires_at);
create index if not exists idx_revision_requests_job_id on revision_requests(job_id);
create index if not exists idx_access_tokens_job_id on access_tokens(job_id);
create index if not exists idx_access_tokens_delivery_id on access_tokens(delivery_id);
create index if not exists idx_access_tokens_expires_at on access_tokens(expires_at);
create index if not exists idx_events_job_id on events(job_id);
create index if not exists idx_events_type on events(type);
create index if not exists idx_events_created_at on events(created_at);
