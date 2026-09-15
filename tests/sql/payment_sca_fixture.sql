-- Isolated CI database only. Never run this fixture against production.
create role anon;
create role authenticated;
create role service_role;
create schema auth;
create table auth.users (id uuid primary key);
create table public.user_security (user_id uuid primary key, updated_at timestamptz);
create table public.transactions (id uuid primary key, provider text, metadata jsonb);
