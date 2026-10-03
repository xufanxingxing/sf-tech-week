-- 已有数据库升级用：每个活动的留言。
create table public.techweek_comments (
  id bigint generated always as identity primary key,
  event_id uuid not null references public.techweek_events(id) on delete cascade,
  person_key text not null check (char_length(person_key) between 16 and 64),
  name text not null check (char_length(name) between 1 and 30),
  body text not null check (char_length(body) between 1 and 300),
  created_at timestamptz not null default now()
);

alter table public.techweek_comments enable row level security;

-- 访客能看留言，但看不到 person_key；发和删都走下面的函数，只能删自己的。
revoke all on public.techweek_comments from anon, authenticated;
grant select (id, event_id, name, body, created_at) on public.techweek_comments to anon;
create policy "anyone reads comments" on public.techweek_comments for select to anon using (true);

create function public.techweek_add_comment(p_event uuid, p_key text, p_name text, p_body text)
returns void language sql security definer set search_path = public as $$
  insert into techweek_comments (event_id, person_key, name, body) values (p_event, p_key, btrim(p_name), btrim(p_body))
$$;

create function public.techweek_delete_comment(p_id bigint, p_key text)
returns boolean language plpgsql security definer set search_path = public as $$
begin
  delete from techweek_comments where id = p_id and person_key = p_key;
  return found;
end $$;

create function public.techweek_my_comments(p_key text)
returns setof bigint language sql stable security definer set search_path = public as $$
  select id from techweek_comments where person_key = p_key
$$;

create or replace function public.techweek_rename_me(p_key text, p_name text)
returns void language sql security definer set search_path = public as $$
  update techweek_rsvps set name = btrim(p_name) where person_key = p_key;
  update techweek_comments set name = btrim(p_name) where person_key = p_key
$$;

revoke execute on function public.techweek_add_comment, public.techweek_delete_comment, public.techweek_my_comments from public;
grant execute on function public.techweek_add_comment, public.techweek_delete_comment, public.techweek_my_comments to anon;
