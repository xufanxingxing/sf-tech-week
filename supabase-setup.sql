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

insert into public.techweek_events (name, link, date, start_time, end_time, location, why, added_by, curated)
select v.* from (values
('The Future of Video Intelligence', 'https://www.tech-week.com/calendar/sf/events/the-future-of-video-intelligence-8d663af9-3ba9-40dd-98a1-485c396a3e55', '2026-10-05'::date, '16:00'::time, '19:00'::time, 'Downtown, San Francisco（具体地址报名通过后显示）', 'Naver Ventures 主办的炉边谈话，主题是视频理解 AI。嘉宾：NEA 合伙人 Tiffany Luck、Twelve Labs 联合创始人兼 CEO Jae Lee、Poshmark CEO 兼 Naver Ventures 管理合伙人 Namsun Kim，Cooley 合伙人主持。30 分钟对谈加 15 分钟问答，之后自由交流。适合做多模态、视频方向的创始人，现场能同时见到投资人。', 'stella', true),
('Eon x Shaun Maguire Fireside', 'https://www.tech-week.com/calendar/sf/events/eon-x-shaun-maguire-fireside-a58c487e-53dc-43d8-94cf-737b913a5e28', '2026-10-05'::date, '17:00'::time, '19:00'::time, 'Dawn Club, SOMA, San Francisco', 'Sequoia 合伙人 Shaun Maguire 和 Eon 的 CTO Ron Kimchi 对谈，主题是怎么为 AI agent 做基础设施。Eon 主办，场子不大。适合想近距离听投资人怎么看 agent 基础设施的创始人和工程师。', 'stella', true),
('Google for Startups: Engineering 10x with Dr. Astro Teller and Google DeepMind', 'https://www.tech-week.com/calendar/sf/events/google-for-startups-engineering-10x-with-dr-astro-teller-and-google-deepmind-b8ad61d1-0cb8-4d07-bf6b-8aacafcb8c60', '2026-10-06'::date, '09:30'::time, '12:00'::time, 'Google for Startups Hub, SOMA, San Francisco（具体地址报名通过后显示）', 'Google X 的 Astro Teller（Captain of Moonshots）和 Bevy / Startup Grind 的 Derek Andersen 讲怎么在登月式想法和落地之间取平衡。之后 Google DeepMind 的 Paige Bailey 主持 Pupper、Surge AI 两位创始人的对谈，讲用 Google 的前沿模型把 AI 带进物理世界。场外有专家答疑区和现场 demo。Tech Week 官方精选；有 Google 的推荐码更容易通过。', 'stella', true),
('Capturing the Value of Intelligence', 'https://www.tech-week.com/calendar/sf/events/capturing-the-value-of-intelligence-sftech-week-a73bb032-f79e-45aa-9340-dc6d6a8c30b6', '2026-10-06'::date, '16:00'::time, '18:00'::time, 'Telegraph Hill, San Francisco（具体地址报名通过后显示）', 'HSBC Innovation Banking 和 a16z 合办的 panel，讨论支撑下一波 AI 的基础设施，以及怎么把它做成规模化的生意。嘉宾：a16z GP Matt Bornstein、Arena CEO Anastasios Angelopoulos、Tessera Labs CTO Anirudh Sriram、HSBC 董事总经理 Alex Choy。投资人和一线创始人同台，适合做 AI 基础设施或想了解钱往哪投的人。Tech Week 官方精选。', 'stella', true),
('The Investment Game: In Pursuit of Series A [LIVE with a16z!]', 'https://www.tech-week.com/calendar/sf/events/the-investment-game-in-pursuit-of-series-a-live-with-a16z-8859ff09-b6a2-4065-85ee-8f55e965ee73', '2026-10-06'::date, '16:00'::time, '19:00'::time, 'SOMA, San Francisco（具体地址报名通过后显示）', 'HubSpot 主办、仿相亲节目的现场秀：三位种子轮创始人轮流回答尖锐的投资问题，争取 a16z 合伙人 Emily Bennett 的（假想）Series A 投资。她每一轮都会点评哪里打动她、哪里是危险信号，最后选出一位。能直接看到顶级投资人怎么做判断，适合准备融 A 轮的创始人。Tech Week 官方精选。', 'stella', true),
('State of Models by OpenRouter', 'https://www.tech-week.com/calendar/sf/events/state-of-models-by-openrouter-fcb5966d-45b9-47c3-96a2-f8129a4ae84c', '2026-10-06'::date, '17:30'::time, '20:30'::time, 'FiDi, San Francisco（具体地址报名通过后显示）', 'OpenRouter 新旗舰系列的第一期：用平台上的真实调用数据讲哪些模型在涨、开发者怎么在成本和质量之间取舍、开源和闭源各自赢在哪。OpenRouter 的 Peter Walker 先讲数据，再和 Artificial Analysis 联合创始人 George Cameron 对谈，CapitalG 合伙人 Jane Alexander 主持。18:15 开讲，19:25 之后是交流时间。适合要选模型的产品和工程团队。Tech Week 官方精选。', 'stella', true),
('Camp AI: Production-Ready Agents', 'https://www.tech-week.com/calendar/sf/events/camp-ai-production-ready-agents-fa378e29-57e0-4583-aa85-56f4e4015894', '2026-10-06'::date, '17:30'::time, '20:30'::time, 'Embarcadero, San Francisco（具体地址报名通过后显示）', 'Auth0 主办，讲 agent 从 demo 到上生产需要什么：安全、自动化和规模化。嘉宾：Auth0 CPO Gareth Davies、MCP 核心维护者兼 Anthropic 技术成员 Den Delimarsky、Cloudflare 产品 VP Rita Kozlov、Browserbase 创始人兼 CEO Paul Klein IV，另有 CircleCI CTO 等现场 demo。agent 方向嘉宾最硬核的一场，适合正在做 agent 的工程师和创始人。Tech Week 官方精选。', 'stella', true),
('Pioneer: A summit for CX Leaders', 'https://www.tech-week.com/calendar/sf/events/pioneer-a-summit-for-cx-leaders-9d5e892d-ff22-410f-98fc-979bee3c1de5', '2026-10-07'::date, '08:45'::time, '16:45'::time, 'Lower Nob Hill, San Francisco（具体地址报名通过后显示）', 'Fin 主办的全天峰会，主题是 AI 时代的客户体验。重头戏是 Fin 创始人兼 CEO Eoghan McCabe 和 Box 创始人兼 CEO Aaron Levie 的炉边谈话，讲怎么带公司走过 AI 转型；Anthropic、Clay、Kalshi、Gamma 等公司的客户体验负责人也会分享。适合做客服、支持类 AI 产品，或者负责客户体验的人。Tech Week 官方精选。', 'stella', true),
('Fireside Chat With Henry Ward, CEO of Carta', 'https://www.tech-week.com/calendar/sf/events/fireside-chat-with-henry-ward-ceo-of-carta-2af5b5d3-33b9-4568-be3c-14ea942961fe', '2026-10-07'::date, '17:30'::time, null::time, 'Rincon Hill, San Francisco（具体地址报名通过后显示）', 'Carta 联合创始人兼 CEO Henry Ward 的炉边谈话，讲今天怎么创办和做大一家公司：创始人路径的变化、做 Carta 的经验、AI 怎么改变建公司的方式，以及创业生态往哪走。Georgian Innovation Hub 主办，Silicon Foundry 的 Benjamin Brand 主持。适合早期创始人。结束时间未公布。', 'stella', true),
('AI Supper Club', 'https://www.tech-week.com/calendar/sf/events/ai-supper-club-4e35408a-b9a6-481e-ac08-b437bb1e0fb9', '2026-10-07'::date, '18:00'::time, null::time, 'San Francisco（具体地址报名通过后显示）', 'Collaborative Fund、Stripe 和 OpenAI 合办的小型晚餐，来的是做消费 AI、垂直 AI、前沿模型、数据和芯片的创始人与 operator，氛围轻松。Collaborative Fund 从种子轮投到成长期、覆盖整个 AI 技术栈，是直接认识投资人和同行创始人的机会。名额少，需申请；结束时间未公布。', 'stella', true),
('Growth Engineering @ Perplexity', 'https://www.tech-week.com/calendar/sf/events/growth-engineering-perplexity-d49bb010-b202-4264-81e8-6e0bab63530b', '2026-10-07'::date, '18:00'::time, '20:00'::time, 'Downtown, San Francisco（具体地址报名通过后显示）', 'Perplexity 增长团队的开放夜。联合创始人 Johnny Ho、产品 VP Raman Malik、增长工程负责人 Sophia Feng 等先做炉边谈话，讲他们怎么做实验、怎么做 AI 产品的增长，以及正在上线的项目；之后和整个增长团队自由交流。适合想学增长打法的人，也适合在看 Perplexity 工作机会的工程师。', 'stella', true),
('Benchmark AI Dinner', 'https://www.tech-week.com/calendar/sf/events/benchmark-ai-dinner-ba499313-e472-48c8-96ea-20a9b6e95704', '2026-10-07'::date, '19:00'::time, null::time, 'FiDi, San Francisco（具体地址报名通过后显示）', 'Vercel 和 Benchmark 合办的晚餐，面向做 AI 评测（evals）和 benchmark 的创始人与研究者。Vercel CEO Guillermo Rauch 和 Jack Altman 边吃边对谈。规模小、需申请，适合正在做评测工具或模型评估方向的人。Tech Week 官方精选。结束时间未公布。', 'stella', true),
('CxO Roundtable: How Enterprise Really Buys AI', 'https://www.tech-week.com/calendar/sf/events/cxo-roundtable-how-enterprise-really-buys-ai-8b52cd7a-ec16-4488-aa5a-a8c0707e6ffd', '2026-10-08'::date, '09:00'::time, '11:30'::time, 'Jackson Square, San Francisco（具体地址报名通过后显示）', 'a16z speedrun 主办的 panel，请几位大公司的技术高管讲企业到底怎么采购 AI、AI 转型怎么做，以及技术负责人怎么和创业公司打交道。嘉宾包括 2K（NBA 2K、《文明》的发行商）的 CTO Nivi Baral 等。面向早期技术创始人，做 B2B、想卖进大企业的值得听。Tech Week 官方精选。', 'stella', true),
('The Founder Reset: Zero to Unicorn with Bolt.new CEO', 'https://www.tech-week.com/calendar/sf/events/the-founder-reset-zero-to-unicorn-with-bolt-new-ceo-37a3b9c5-f774-4aff-8925-30a1531d715f', '2026-10-08'::date, '13:00'::time, '14:30'::time, 'Russian Hill, San Francisco（具体地址报名通过后显示）', 'Bolt.new CEO Eric Simons 的现场炉边谈话，讲从一个想法和早期小团队做到十亿美元公司的过程：关键决策、转折点和犯过的错。Mantis Venture Capital 合伙人 Gaurav Bhogale 对谈，Unicorner 和 SimpleClosure 主办，现场有咖啡吧和放松区。适合想听一手增长故事的创始人。Tech Week 官方精选。', 'stella', true),
('Fenwick × Databricks × a16z: Founders & Investors Happy Hour', 'https://www.tech-week.com/calendar/sf/events/fenwick-databricks-a16z-founders-and-investors-happy-hour-eb1357e8-0695-4a80-ad8c-20b80c4f1793', '2026-10-08'::date, '16:00'::time, '18:00'::time, 'FiDi, San Francisco（具体地址报名通过后显示）', 'Fenwick、Databricks 和 a16z 合办的 happy hour，专门给在做或在投数据和 AI 的创始人与投资人。没有舞台、没有 pitch，就是喝东西，聊现在什么管用、什么不管用。想在轻松场合认识投资人和同行的创始人适合来。Tech Week 官方精选。', 'stella', true),
('What''s Next for DX', 'https://www.tech-week.com/calendar/sf/events/what-s-next-for-dx-a4f74608-ba44-4a32-a739-080f4f447595', '2026-10-08'::date, '18:00'::time, '20:00'::time, 'SOMA, San Francisco（具体地址报名通过后显示）', '讨论 agent 承担大量编码工作之后，开发者体验（DX）该怎么重做。台上：MongoDB 开发者效率 VP Tara Hernandez、Uber Principal Engineer Ty Smith、OpenAI 技术成员 Corey Ching、Plaid 架构负责人 Zander Hill；到场的还有 Stripe、NVIDIA、LinkedIn、Perplexity 等公司的 DX 负责人。Trunk 和 EngFlow 主办。适合工程负责人和做开发者工具的人。', 'stella', true),
('Who Will Own the Future?', 'https://www.tech-week.com/calendar/sf/events/who-will-own-the-future-7df29c71-1e55-44ef-8828-a9dfc26aa119', '2026-10-08'::date, '18:00'::time, '22:00'::time, 'Marina, San Francisco（具体地址报名通过后显示）', 'ARK Invest 主办。ARK 创始人兼 CEO Cathie Wood、四届 NBA 总冠军兼 Mastry 联合创始人 Andre Iguodala、Robinhood Ventures 负责人 Sarah Pinto 等对谈：AI 和新技术怎么重塑市场和财富创造，为什么体育这类稀缺资产会更值钱。18:00 入场，有酒水、食物和交流，19:15 正式开始。全周名气最大的嘉宾阵容之一。Tech Week 官方精选。', 'stella', true),
('a16z speedrun AI Faire', 'https://www.tech-week.com/calendar/sf/events/a16z-speedrun-ai-faire-70750ac4-237e-42a9-9b03-f9589abdae34', '2026-10-09'::date, '10:30'::time, '17:00'::time, 'Jackson Square, San Francisco（具体地址报名通过后显示）', 'a16z speedrun 历届项目里的 AI B2B 公司集中展示：几十位创始人现场 demo 自己的产品，没有台上环节，自己逛、直接和创始人聊。面向想在公司里引入新 AI 工具的高管和 operator，也适合想一次看完一批早期项目的人。分时段入场，申请时要选时间。Tech Week 官方精选。', 'stella', true),
('a16z x Unicorner x Notion: The Official Afterparty', 'https://www.tech-week.com/calendar/sf/events/a16z-x-unicorner-x-notion-the-official-afterparty-44a2ec96-9824-4b06-9fdd-ad01e195887b', '2026-10-09'::date, '20:00'::time, null::time, 'Lower Nob Hill, San Francisco（具体地址报名通过后显示）', 'SF Tech Week 的官方收官派对，Unicorner、a16z 和 Notion 合办，是这一周最后一次集中社交的机会。需要在 Partiful 上通过审批，入场查政府签发的身份证件，不能带 +1，建议穿 cocktail attire。Tech Week 官方精选。结束时间未公布。', 'stella', true),
('Talk to Users Hackathon', 'https://www.tech-week.com/calendar/sf/events/talk-to-users-hackathon-2ea9ffb9-d4c2-410f-b45c-94eab588be96', '2026-10-10'::date, '09:00'::time, '22:00'::time, 'SOMA, San Francisco（具体地址报名通过后显示）', 'Stripe、Base44、Cognition、Sense AI、MongoDB、Clerk 等合办的一日黑客松。20 支队伍，全部是技术型 builder，12 小时做出一个真正有用的功能。特别之处：Sense AI 给每支队伍匹配真实的目标用户，边做边测、听反馈再改。奖金 1 万美元以上，另有大量 credits 和一对一 office hours。适合想动手并拿到真实用户反馈的工程师。Tech Week 官方精选。', 'stella', true),
('SpeedHacks: The Official speedrun Hackathon', 'https://www.tech-week.com/calendar/sf/events/speedhacks-the-official-speedrun-hackathon-30c239a4-638a-4bd6-8d51-e15259668f51', '2026-10-11'::date, '09:00'::time, '21:00'::time, 'Jackson Square, San Francisco（具体地址报名通过后显示）', 'SF Hack Week 的官方收官黑客松，a16z speedrun 主办。一天 12 小时，从零开始做。题目是“把时间还给人”：做一个能消除工作、学习或获取服务中某个瓶颈的东西。可以用 speedrun 各家公司的工具，每家会颁一个“最佳使用”奖。可以带队报名，也可以现场组队。Tech Week 官方精选。', 'stella', true)
) as v(name, link, date, start_time, end_time, location, why, added_by, curated)
where not exists (select 1 from public.techweek_events e where e.link = v.link);

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
-- 登记管理员：让那台浏览器先在网站上用一个名字标记任意活动，然后运行：
-- insert into public.techweek_admins (person_key, note) select person_key, name from public.techweek_rsvps where name = '那个名字' limit 1;
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


-- 群主后来撤下的两个活动
delete from public.techweek_events
where link in ('https://partiful.com/e/con6v0i0cwPvODNG0l2T', 'https://partiful.com/e/jvRWNlc4IBvo2E1k7Rpj');

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
