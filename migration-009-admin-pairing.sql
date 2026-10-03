-- 已有数据库升级用：管理员配对。浏览器打开 网站/#admin 会发出申请并显示 6 位配对码，在 Supabase 后台按配对码批准。
create table public.techweek_admin_requests (
  id bigint generated always as identity primary key,
  person_key text not null check (char_length(person_key) between 16 and 64),
  code text not null check (code ~ '^[0-9]{6}$'),
  name text check (name is null or char_length(name) <= 30),
  created_at timestamptz not null default now()
);
alter table public.techweek_admin_requests enable row level security;
revoke all on public.techweek_admin_requests from anon, authenticated;

create function public.techweek_is_admin(p_key text)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from techweek_admins where person_key = p_key)
$$;

create function public.techweek_request_admin(p_key text, p_code text, p_name text)
returns void language sql security definer set search_path = public as $$
  insert into techweek_admin_requests (person_key, code, name) values (p_key, p_code, nullif(btrim(p_name), ''))
$$;

revoke execute on function public.techweek_is_admin, public.techweek_request_admin from public;
grant execute on function public.techweek_is_admin, public.techweek_request_admin to anon;

-- 批准（把 000000 换成对方屏幕上的配对码，30 分钟内有效）：
-- insert into public.techweek_admins (person_key, note)
-- select person_key, 'paired ' || coalesce(name, '') from public.techweek_admin_requests
-- where code = '000000' and created_at > now() - interval '30 minutes' on conflict do nothing;
