-- Tech Week 去哪儿：在 Supabase 的 SQL Editor 里整段运行一次。

create table public.techweek_events (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(name) between 1 and 120),
  link text not null check (link ~* '^https?://' and char_length(link) <= 500),
  date date not null,
  start_time time not null,
  end_time time,
  extra_dates jsonb not null default '[]' check (jsonb_typeof(extra_dates) = 'array' and jsonb_array_length(extra_dates) <= 6),
  location text not null check (char_length(location) between 1 and 200),
  why text not null check (char_length(why) between 1 and 600),
  added_by text not null check (char_length(added_by) between 1 and 30),
  curated boolean not null default false,
  added_key text check (added_key is null or char_length(added_key) between 16 and 64),
  created_at timestamptz not null default now()
);

create table public.techweek_rsvps (
  id bigint generated always as identity primary key,
  event_id uuid not null references public.techweek_events(id) on delete cascade,
  person_key text not null check (char_length(person_key) between 16 and 64),
  name text not null check (char_length(name) between 1 and 30),
  status text not null default 'going' check (status in ('going', 'pending', 'interested')),
  created_at timestamptz not null default now(),
  unique (event_id, person_key)
);

alter table public.techweek_events enable row level security;
alter table public.techweek_rsvps enable row level security;

-- 访客可以看活动、加活动（不能自己标“群主推荐”），不能改；只能删自己加的（凭 added_key，别人读不到）。
revoke all on public.techweek_events from anon, authenticated;
grant insert on public.techweek_events to anon;
grant select (id, name, link, date, start_time, end_time, extra_dates, location, why, added_by, curated, created_at) on public.techweek_events to anon;
create policy "anyone reads events" on public.techweek_events for select to anon using (true);
create policy "anyone adds events" on public.techweek_events for insert to anon with check (curated = false);

-- 访客能看到谁要去，但看不到 person_key，所以不能替别人取消。
revoke all on public.techweek_rsvps from anon, authenticated;
grant select (id, event_id, name, status, created_at) on public.techweek_rsvps to anon;
create policy "anyone reads rsvps" on public.techweek_rsvps for select to anon using (true);

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

create function public.techweek_rename_me(p_key text, p_name text)
returns void language sql security definer set search_path = public as $$
  update techweek_rsvps set name = btrim(p_name) where person_key = p_key
$$;

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

revoke execute on function public.techweek_set_status, public.techweek_my_rsvps, public.techweek_rename_me, public.techweek_my_added, public.techweek_delete_event from public;
grant execute on function public.techweek_set_status, public.techweek_my_rsvps, public.techweek_rename_me, public.techweek_my_added, public.techweek_delete_event to anon;

-- 留言
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

-- 群主预选的活动
insert into public.techweek_events (name, link, date, start_time, end_time, location, why, added_by, curated) values
('Taiwan × Silicon Valley: Founders, Capital & the Next Wave of Innovation', 'https://partiful.com/e/jvRWNlc4IBvo2E1k7Rpj', '2026-10-05', '13:00', '17:00', 'San Francisco（具体地址报名通过后显示）', 'Startup Island TAIWAN 硅谷中心和 Taiwan Global Angels 主办，Google Cloud 合作。硅谷投资人、连续创业者和台湾背景创始人聊 AI、deep tech、医疗和硬件，有每家 5 分钟的 startup pitch，之后可以直接和 VC、天使投资人交流。', '小Linda', true),
('Fireworks x a16z: Official Tech Week Kickoff w/ Vercel, ElevenLabs & Stripe', 'https://partiful.com/e/Fp4oMyFGQC6HzotKXc8T', '2026-10-05', '18:00', '22:00', 'San Francisco rooftop（具体地址报名通过后显示）', 'Tech Week 官方开幕派对，Fireworks 和 a16z 主办，Vercel、ElevenLabs、Stripe 支持。露台、天际线、现场音乐，来的是创始人、工程师、投资人和 operator，是第一晚认识人的最好场合。', '小Linda', true),
('Claude Founder House', 'https://partiful.com/e/XaBTYkfWChPrquuI6uPH', '2026-10-06', '11:00', '17:00', 'San Francisco（具体地址报名通过后显示）', 'Anthropic 在 Tech Week 的大本营，周二到周四每天开放。白天是 Claude Cafe，可以和 Anthropic 团队一起干活、约 office hours、见投资人；每天 11:30–16:00 有 panel 和 workshop，话题包括 AI agents、机器人、融资、医疗 AI 和消费产品。', '小Linda', true),
('Google for Startups & NVIDIA: From Compute to Competitive Moats', 'https://partiful.com/e/MXd2fC8umpyvOwQ3KP3S', '2026-10-07', '09:30', '12:00', 'Google for Startups Hub, San Francisco（具体地址报名通过后显示）', 'Google for Startups 和 NVIDIA 合办。NVIDIA 的 Jen Hoskins 和 SandboxAQ 的 Dr. Arman Zaribafiyan 讲 Quantum-AI 和高速推理，另有 agentic AI 安全、怎么建立护城河的 session，现场有专家答疑区和 live demo。', '小Linda', true),
('3M to 100M Users: How Gamma Actually Did It', 'https://partiful.com/e/3OvkylJXptvhiEVFZ5wq', '2026-10-08', '10:00', '12:00', 'San Francisco（具体地址报名通过后显示）', 'Gamma 创始人 Grant Lee 亲自讲怎么靠 creator / influencer 营销做到 1 亿用户。先是 Wispr Flow、Gamma、Demi.ai 的 panel 聊高速增长的 AI 公司怎么做 influencer，再是 Grant Lee 的 fireside。适合想学增长打法的 AI 创始人和 operator。', '小Linda', true),
('Anthropic IPO: What Matters for Valuation', 'https://partiful.com/e/7gkEjmj2RQD6b0Tx4J0p', '2026-10-08', '10:30', '11:30', 'San Francisco（具体地址报名通过后显示）', 'Elsa Capital 管理合伙人 Sarah Fu 主讲的小范围讨论。她做过 Fidelity 机构投资、Morgan Stanley 投行和 Stripe，讲大机构买方怎么看估值、投行怎么讲 IPO 故事、头条数字之外该问什么。名额有限，逐个审批。', '小Linda', true);

update public.techweek_events
set extra_dates = '[{"date":"2026-10-07","start":"11:00","end":"17:00"},{"date":"2026-10-08","start":"11:00","end":"17:00"}]'
where link = 'https://partiful.com/e/XaBTYkfWChPrquuI6uPH';
insert into public.techweek_events (name, link, date, start_time, end_time, location, why, added_by, curated)
select v.* from (values
('Law in the Age of AI', 'https://partiful.com/e/con6v0i0cwPvODNG0l2T', '2026-10-05'::date, '09:00'::time, '11:00'::time, 'San Francisco（具体地址报名通过后显示）', 'SimpleClosure 和 Carta 主办的 panel，聊 AI 怎么改变法律行业，以及给创业公司和律所带来的机会。嘉宾有 Cambrian 创始人 Rex Salisbury、DLA Piper 合伙人 Abrar Hussain、SimpleClosure CEO Dori Yona，Silicon Valley Business Journal 的 Alastair Goldfisher 也在台上。', '小Linda', true),
('YC Founders Mixer', 'https://luma.com/szg4hzay', '2026-10-05'::date, '17:00'::time, '19:30'::time, 'San Francisco（具体地址报名通过后显示）', '跨届 YC 创始人的轻松聚会，没有 panel、没有 pitch，只有酒水、小食和创始人之间的聊天。需要审批，主要面向在读批次、校友和 YC 投资的公司，报名时要填公司和 YC 批次。', '小Linda', true),
('(International) YC Founders Picnic', 'https://luma.com/vmjvw2ox', '2026-10-07'::date, '12:30'::time, '15:30'::time, 'Alamo Square Park, Hayes St, San Francisco', '在 Alamo Square 公园野餐，Tech Week 各场 panel 之间喘口气。欢迎国际创始人和有国际背景的人，YC 和国际创始人优先。由 Shor（YC S25，国际薪酬平台）和 LegalOS（YC W26，AI 移民律所）主办，适合想聊签证和海外团队的人。', '小Linda', true),
('Stripe and a16z B2B AI Supper Club', 'https://partiful.com/e/ljNVe4NFK28RZbWMcLbP', '2026-10-07'::date, '18:00'::time, '20:30'::time, 'San Francisco（具体地址报名通过后显示）', 'a16z 和 Stripe 给拿过 VC 投资的 B2B AI 创始人办的晚餐，主题是定价：当 agent 也在用你的产品时，按席位、按用量还是混合收费。有欢迎酒、panel 加问答、晚餐和交流。仅限邀请，名额很少。', '小Linda', true)
) as v(name, link, date, start_time, end_time, location, why, added_by, curated)
where not exists (select 1 from public.techweek_events e where e.link = v.link);
