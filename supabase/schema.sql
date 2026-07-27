-- Run this in the Supabase SQL editor (Project -> SQL Editor -> New query).
-- Minimal MVP schema matching party-shared-types entities. Extend as the
-- core platform grows; each new game module should not need to touch this file.

create table if not exists profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  display_name text not null,
  avatar_url text,
  level integer not null default 1,
  total_score integer not null default 0,
  created_at timestamptz not null default now()
);

do $$ begin
  create type friend_status as enum ('pending', 'accepted');
exception when duplicate_object then null;
end $$;

create table if not exists friends (
  user_id uuid not null references profiles(id) on delete cascade,
  friend_id uuid not null references profiles(id) on delete cascade,
  status friend_status not null default 'pending',
  requested_by uuid not null references profiles(id),
  created_at timestamptz not null default now(),
  primary key (user_id, friend_id)
);

create table if not exists rooms (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  game_type text not null,
  host_user_id uuid not null references profiles(id),
  max_players integer not null default 4,
  target_score integer not null default 30,
  status text not null default 'waiting',
  created_at timestamptz not null default now()
);

-- Safe to re-run: adds the column if this table already existed before target_score was introduced.
alter table rooms add column if not exists target_score integer not null default 30;

create table if not exists game_history (
  id uuid primary key default gen_random_uuid(),
  room_id uuid references rooms(id) on delete set null,
  game_type text not null,
  played_at timestamptz not null default now(),
  duration_seconds integer not null default 0
);

create table if not exists game_history_players (
  history_id uuid not null references game_history(id) on delete cascade,
  user_id uuid not null references profiles(id),
  display_name text not null,
  score_delta integer not null default 0,
  placement integer not null,
  primary key (history_id, user_id)
);

-- Auto-create a profile row whenever a new Supabase Auth user signs up.
create or replace function public.handle_new_user()
returns trigger as $$
begin
  insert into public.profiles (id, display_name)
  values (new.id, coalesce(new.raw_user_meta_data->>'display_name', 'Player'));
  return new;
end;
$$ language plpgsql security definer;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure public.handle_new_user();
