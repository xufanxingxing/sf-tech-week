-- 已有数据库升级用：加管理员，并把 stella 当前这台浏览器登记为管理员。
-- 管理员：登记在这张表里的浏览器可以删任何活动和留言。访客读不到也写不了这张表，只能在 Supabase 后台改。
create table public.techweek_admins (
  person_key text primary key check (char_length(person_key) between 16 and 64),
  note text,
  created_at timestamptz not null default now()
);
alter table public.techweek_admins enable row level security;
revoke all on public.techweek_admins from anon, authenticated;

create or replace function public.techweek_my_added(p_key text)
returns setof uuid language sql stable security definer set search_path = public as $$
  select id from techweek_events
  where added_key = p_key or exists (select 1 from techweek_admins a where a.person_key = p_key)
$$;

create or replace function public.techweek_delete_event(p_event uuid, p_key text)
returns boolean language plpgsql security definer set search_path = public as $$
begin
  delete from techweek_events e
  where e.id = p_event
    and (e.added_key = p_key or exists (select 1 from techweek_admins a where a.person_key = p_key));
  return found;
end $$;

create or replace function public.techweek_my_comments(p_key text)
returns setof bigint language sql stable security definer set search_path = public as $$
  select id from techweek_comments
  where person_key = p_key or exists (select 1 from techweek_admins a where a.person_key = p_key)
$$;

create or replace function public.techweek_delete_comment(p_id bigint, p_key text)
returns boolean language plpgsql security definer set search_path = public as $$
begin
  delete from techweek_comments c
  where c.id = p_id
    and (c.person_key = p_key or exists (select 1 from techweek_admins a where a.person_key = p_key));
  return found;
end $$;

-- 把名字是 stella 的那条标记所在的浏览器登记为管理员（此刻全站只有这一条标记）。
insert into public.techweek_admins (person_key, note)
select person_key, 'stella' from public.techweek_rsvps where name = 'stella' order by id limit 1;

select count(*) as admins from public.techweek_admins;
