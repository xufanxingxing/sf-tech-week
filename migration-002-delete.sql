-- 已有数据库升级用：加“删除自己添加的活动”，并删掉测试活动。
alter table public.techweek_events add column added_key text check (added_key is null or char_length(added_key) between 16 and 64);
revoke select on public.techweek_events from anon;
grant select (id, name, link, date, start_time, end_time, location, why, added_by, curated, created_at) on public.techweek_events to anon;

create function public.techweek_my_added(p_key text)
returns setof uuid language sql stable security definer set search_path = public as $$
  select id from techweek_events where added_key = p_key
$$;

create function public.techweek_delete_event(p_event uuid, p_key text)
returns boolean language plpgsql security definer set search_path = public as $$
begin
  delete from techweek_events where id = p_event and added_key = p_key;
  return found;
end $$;

revoke execute on function public.techweek_my_added, public.techweek_delete_event from public;
grant execute on function public.techweek_my_added, public.techweek_delete_event to anon;

delete from public.techweek_events where name = 'esdfswwf';
