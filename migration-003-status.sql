-- 已有数据库升级用：每个人对每个活动有三种状态（我会去 / 等待通过 / 感兴趣）。
alter table public.techweek_rsvps add column status text not null default 'going' check (status in ('going', 'pending', 'interested'));
grant select (status) on public.techweek_rsvps to anon;

create function public.techweek_set_status(p_event uuid, p_key text, p_name text, p_status text)
returns void language plpgsql security definer set search_path = public as $$
begin
  if p_status is null then
    delete from techweek_rsvps where event_id = p_event and person_key = p_key;
  else
    insert into techweek_rsvps (event_id, person_key, name, status) values (p_event, p_key, btrim(p_name), p_status)
    on conflict (event_id, person_key) do update set name = excluded.name, status = excluded.status;
  end if;
end $$;

create function public.techweek_my_rsvps(p_key text)
returns table (event_id uuid, status text) language sql stable security definer set search_path = public as $$
  select r.event_id, r.status from techweek_rsvps r where r.person_key = p_key
$$;

revoke execute on function public.techweek_set_status, public.techweek_my_rsvps from public;
grant execute on function public.techweek_set_status, public.techweek_my_rsvps to anon;
