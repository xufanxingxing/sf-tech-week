-- 已有数据库升级用：“全部”标签页。把 Tech Week 官方日历的活动放进同一张表（source = 'calendar'），和推荐的活动分开显示。
alter table public.techweek_events
  add column source text not null default 'community' check (source in ('community', 'calendar')),
  add column tw_id uuid unique,
  add column hosts text check (hosts is null or char_length(hosts) <= 300),
  add column featured boolean not null default false,
  alter column why drop not null;
grant select (source, hosts, featured) on public.techweek_events to anon;
create index techweek_events_source_idx on public.techweek_events (source, date, start_time);

-- 访客添加的活动只能是普通推荐：必须写理由，不能冒充官方日历的条目。
drop policy "anyone adds events" on public.techweek_events;
create policy "anyone adds events" on public.techweek_events for insert to anon
  with check (curated = false and source = 'community' and tw_id is null and featured = false and why is not null);

-- 管理员不再拿到全部活动的 id（会超过一次返回的行数上限），而是拿到一个全零的标记，网页据此显示所有删除键。
create or replace function public.techweek_my_added(p_key text)
returns setof uuid language sql stable security definer set search_path = public as $$
  select '00000000-0000-0000-0000-000000000000'::uuid where exists (select 1 from techweek_admins a where a.person_key = p_key)
  union all
  select id from techweek_events where added_key = p_key
$$;

-- 已经在推荐里的活动记下它在官方日历里的编号，导入时跳过，避免重复。
update public.techweek_events
set tw_id = substring(link from '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$')::uuid
where link like 'https://www.tech-week.com/calendar/%';
update public.techweek_events set tw_id = 'affc8860-5de6-482b-97ed-7667718ab905' where link = 'https://partiful.com/e/Fp4oMyFGQC6HzotKXc8T';
update public.techweek_events set tw_id = '5b9edb5a-cbc2-437a-9610-b17c2c26bbd5' where link = 'https://partiful.com/e/XaBTYkfWChPrquuI6uPH';
update public.techweek_events set tw_id = 'ab94a1f2-6fb7-4c10-b3d6-f002cffa9165' where link = 'https://partiful.com/e/MXd2fC8umpyvOwQ3KP3S';
update public.techweek_events set tw_id = '8d512655-5b9a-47cb-a2fa-30495004337a' where link = 'https://partiful.com/e/ljNVe4NFK28RZbWMcLbP';
update public.techweek_events set tw_id = 'c82fe23b-04fe-4589-b63c-cb0d442bd5af' where link = 'https://partiful.com/e/3OvkylJXptvhiEVFZ5wq';
update public.techweek_events set tw_id = '545581d5-474e-4db2-be03-f3c501884eeb' where link = 'https://partiful.com/e/7gkEjmj2RQD6b0Tx4J0p';

select count(*) filter (where tw_id is not null) as linked, count(*) as total from public.techweek_events;
