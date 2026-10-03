-- 群主预选的第二批活动（按报名链接去重）。
insert into public.techweek_events (name, link, date, start_time, end_time, location, why, added_by, curated)
select v.* from (values
('Law in the Age of AI', 'https://partiful.com/e/con6v0i0cwPvODNG0l2T', '2026-10-05'::date, '09:00'::time, '11:00'::time, 'San Francisco（具体地址报名通过后显示）', 'SimpleClosure 和 Carta 主办的 panel，聊 AI 怎么改变法律行业，以及给创业公司和律所带来的机会。嘉宾有 Cambrian 创始人 Rex Salisbury、DLA Piper 合伙人 Abrar Hussain、SimpleClosure CEO Dori Yona，Silicon Valley Business Journal 的 Alastair Goldfisher 也在台上。', '小Linda', true),
('YC Founders Mixer', 'https://luma.com/szg4hzay', '2026-10-05'::date, '17:00'::time, '19:30'::time, 'San Francisco（具体地址报名通过后显示）', '跨届 YC 创始人的轻松聚会，没有 panel、没有 pitch，只有酒水、小食和创始人之间的聊天。需要审批，主要面向在读批次、校友和 YC 投资的公司，报名时要填公司和 YC 批次。', '小Linda', true),
('(International) YC Founders Picnic', 'https://luma.com/vmjvw2ox', '2026-10-07'::date, '12:30'::time, '15:30'::time, 'Alamo Square Park, Hayes St, San Francisco', '在 Alamo Square 公园野餐，Tech Week 各场 panel 之间喘口气。欢迎国际创始人和有国际背景的人，YC 和国际创始人优先。由 Shor（YC S25，国际薪酬平台）和 LegalOS（YC W26，AI 移民律所）主办，适合想聊签证和海外团队的人。', '小Linda', true),
('Stripe and a16z B2B AI Supper Club', 'https://partiful.com/e/ljNVe4NFK28RZbWMcLbP', '2026-10-07'::date, '18:00'::time, '20:30'::time, 'San Francisco（具体地址报名通过后显示）', 'a16z 和 Stripe 给拿过 VC 投资的 B2B AI 创始人办的晚餐，主题是定价：当 agent 也在用你的产品时，按席位、按用量还是混合收费。有欢迎酒、panel 加问答、晚餐和交流。仅限邀请，名额很少。', '小Linda', true)
) as v(name, link, date, start_time, end_time, location, why, added_by, curated)
where not exists (select 1 from public.techweek_events e where e.link = v.link);
