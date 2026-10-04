-- 群主加的精选活动：Tech Week 前一天的 personal agent 黑客松。可重复运行。
insert into public.techweek_events (name, link, date, start_time, end_time, location, why, why_en, added_by, curated, topics)
select 'Build Personal Agents Hack | $280k Prize Pool', 'https://luma.com/build-agents', '2026-10-04'::date, '09:00'::time, '19:00'::time,
  'Terra Gallery, 511 Harrison Street, San Francisco',
  'Tech Week 前一天的热身黑客松，200 人到场，主题是做一个属于自己的 personal agent：管邮箱、控制智能家居、处理日常事务。Neon 主办，Mastra、Exa、Fly.io、Kernel、Executor、Assistant UI、AgentMail 在现场支持，他们的工具可以用，也可以不用。个人参加或最多 5 人组队。奖池号称 28 万美元，主要是各家的 credits：第一名有 10 万美元 Neon credits 和 5 万美元 Fly.io credits 等。需要申请通过。',
  'A warm-up hackathon the day before Tech Week: 200 hackers building their own personal agent to manage an inbox, control a smart home or handle day-to-day tasks. Hosted by Neon, with Mastra, Exa, Fly.io, Kernel, Executor, Assistant UI and AgentMail on site; their tools are available but not required. Hack solo or in a team of up to five. The $280k prize pool is mostly credits: first place gets $100k in Neon credits and $50k in Fly.io credits, among others. Approval required.',
  'stella', true, '["agent", "hackathon"]'::jsonb
where not exists (select 1 from public.techweek_events where link = 'https://luma.com/build-agents');

select count(*) filter (where source = 'community') as picks, count(*) as total from public.techweek_events;
