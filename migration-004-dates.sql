-- 已有数据库升级用：一个活动可以有多个日期（第一个日期仍在 date/start_time/end_time，其余在 extra_dates）。
alter table public.techweek_events add column extra_dates jsonb not null default '[]'
  check (jsonb_typeof(extra_dates) = 'array' and jsonb_array_length(extra_dates) <= 6);
grant select (extra_dates) on public.techweek_events to anon;

update public.techweek_events
set name = 'Claude Founder House',
    extra_dates = '[{"date":"2026-10-07","start":"11:00","end":"17:00"},{"date":"2026-10-08","start":"11:00","end":"17:00"}]'
where link = 'https://partiful.com/e/XaBTYkfWChPrquuI6uPH';
