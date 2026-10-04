-- 已有数据库升级用：访问数据对所有人开放。之前 techweek_stats() 只回答管理员浏览器，现在谁打开 网站/stats.html 都能看。
-- 谁都可以看：里面只有加总后的数字、活动名、来源和搜索词，没有名字，也没有浏览器的 key。p_key 已经不用了，留着是为了不改网页的调用方式。
create or replace function public.techweek_stats(p_key text, p_days int)
returns jsonb language sql stable security definer set search_path = public as $$
  with span as (
    select (now() at time zone 'America/Los_Angeles')::date as today,
           (now() at time zone 'America/Los_Angeles')::date - (least(greatest(coalesce(p_days, 14), 1), 90) - 1) as first_day
  ),
  t as (
    select a.person_key, a.action, a.event_id, a.props,
           (a.created_at at time zone 'America/Los_Angeles')::date as day,
           extract(hour from a.created_at at time zone 'America/Los_Angeles')::int as hour
    from techweek_activity a, span
    where a.created_at >= (span.first_day::timestamp at time zone 'America/Los_Angeles')
      and not exists (select 1 from techweek_admins ad where ad.person_key = a.person_key)
  )
  select jsonb_build_object(
    'days', (select today - first_day + 1 from span),
    'since', (select min(created_at) from techweek_activity),
    'all_visitors', (select count(distinct a.person_key) from techweek_activity a
                     where not exists (select 1 from techweek_admins ad where ad.person_key = a.person_key)),
    'totals', (select jsonb_build_object(
        'visitors', count(distinct person_key),
        'new_visitors', count(distinct person_key) filter (where action = 'visit' and props->>'first' = 'true'),
        'visits', count(*) filter (where action = 'visit'),
        'engaged', count(distinct person_key) filter (where action <> 'visit'),
        'link_clickers', count(distinct person_key) filter (where action = 'open_link'),
        'link_clicks', count(*) filter (where action = 'open_link'),
        'markers', count(distinct person_key) filter (where action = 'mark' and props->>'status' <> 'none'),
        'talkers', count(distinct person_key) filter (where action in ('comment', 'add_event'))) from t),
    'returning', (select count(*) from (select person_key from t group by person_key having count(distinct day) > 1) r),
    'daily', (select jsonb_agg(j order by day) from (
        select g.day, jsonb_build_object('day', g.day,
          'visitors', count(distinct t.person_key),
          'new', count(distinct t.person_key) filter (where t.action = 'visit' and t.props->>'first' = 'true'),
          'visits', count(*) filter (where t.action = 'visit'),
          'link_clicks', count(*) filter (where t.action = 'open_link'),
          'marks', count(*) filter (where t.action = 'mark' and t.props->>'status' <> 'none')) as j
        from (select first_day + i as day from span, generate_series(0, today - first_day) i) g
        left join t on t.day = g.day group by g.day) x),
    'actions', (select coalesce(jsonb_agg(jsonb_build_object('action', action, 'times', times, 'people', people) order by people desc, times desc, action), '[]'::jsonb)
        from (select action, count(*) as times, count(distinct person_key) as people from t group by action) x),
    'tabs', (select coalesce(jsonb_agg(jsonb_build_object('tab', tab, 'opened', opened, 'clickers', clickers, 'markers', markers) order by tab), '[]'::jsonb) from (
        select props->>'tab' as tab,
          count(distinct person_key) filter (where action = 'tab') as opened,
          count(distinct person_key) filter (where action = 'open_link') as clickers,
          count(distinct person_key) filter (where action = 'mark' and props->>'status' <> 'none') as markers
        from t where action in ('tab', 'open_link', 'mark') and props->>'tab' is not null group by 1) x),
    'events', (select coalesce(jsonb_agg(j order by people desc, clicks desc, name), '[]'::jsonb) from (
        select count(distinct t.person_key) as people, count(*) filter (where t.action = 'open_link') as clicks, max(e.name) as name,
          jsonb_build_object('name', max(e.name), 'calendar', coalesce(max(to_jsonb(e)->>'source'), '') = 'calendar',
            'people', count(distinct t.person_key),
            'clickers', count(distinct t.person_key) filter (where t.action = 'open_link'),
            'markers', count(distinct t.person_key) filter (where t.action = 'mark' and t.props->>'status' <> 'none'),
            'comment_openers', count(distinct t.person_key) filter (where t.action = 'open_comments'),
            'people_openers', count(distinct t.person_key) filter (where t.action = 'open_people')) as j
        from t left join techweek_events e on e.id = t.event_id
        where t.event_id is not null group by t.event_id order by 1 desc, 2 desc, 3 limit 30) x),
    'devices', (select coalesce(jsonb_agg(jsonb_build_object('device', device, 'people', people) order by people desc, device), '[]'::jsonb) from (
        select case when props->>'wechat' = 'true' then 'wechat' else coalesce(props->>'device', 'unknown') end as device, count(distinct person_key) as people
        from t where action = 'visit' group by 1) x),
    'sources', (select coalesce(jsonb_agg(jsonb_build_object('source', source, 'people', people, 'visits', visits) order by people desc, visits desc, source), '[]'::jsonb) from (
        select coalesce(nullif(props->>'from', ''), nullif(props->>'ref', ''), '') as source, count(distinct person_key) as people, count(*) as visits
        from t where action = 'visit' group by 1 order by 2 desc, 3 desc limit 12) x),
    'searches', (select coalesce(jsonb_agg(jsonb_build_object('q', q, 'times', times, 'people', people) order by people desc, times desc, q), '[]'::jsonb) from (
        select lower(props->>'q') as q, count(*) as times, count(distinct person_key) as people
        from t where action = 'search' and props->>'q' is not null group by 1 order by 3 desc, 2 desc limit 20) x),
    'hours', (select coalesce(jsonb_agg(jsonb_build_object('hour', hour, 'visits', visits) order by hour), '[]'::jsonb) from (
        select hour, count(*) as visits from t where action = 'visit' group by hour) x)
  )
$$;
