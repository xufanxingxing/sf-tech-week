const $ = (s) => document.querySelector(s);
function h(tag, attrs, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v == null || v === false) continue;
    if (k === "class") el.className = v;
    else if (k === "text") el.textContent = v;
    else if (k.startsWith("on")) el.addEventListener(k.slice(2), v);
    else el.setAttribute(k, v === true ? "" : v);
  }
  for (const kid of kids.flat()) if (kid != null && kid !== false) el.append(kid);
  return el;
}

const state = {
  status: "loading", // loading | ready | denied | setup | unavailable
  missing: false,    // the database has no stats function yet
  loading: false,
  days: 14,
  data: null,        // what techweek_stats returned for the chosen range
};
let sb = null, key = null, asked = 0;

const RANGES = [[1, "今天"], [7, "7 天"], [14, "14 天"], [30, "30 天"], [90, "90 天"]];
// The action names app.js records, in words. One it does not know yet is shown by its name.
const ACTIONS = {
  visit: "打开网站", tab: "切换标签页", day: "在“全部”里换日期", search: "搜索", topic: "点主题筛选", open_link: "点开报名链接", mark: "标记或取消标记",
  open_comments: "打开留言", comment: "发留言", open_people: "打开已标记名单", add_open: "打开“添加活动”", add_event: "添加了活动", set_name: "第一次填名字",
};
const TABS = { picks: "推荐", all: "全部", mine: "我标记的" };
const DEVICES = { wechat: "微信里打开", mobile: "手机浏览器", desktop: "电脑", unknown: "未知" };

const share = (n, of) => (of ? Math.round((n / of) * 100) + "%" : "0%");
const monthDay = (iso) => { const [, m, d] = iso.split("-").map(Number); return `${m}/${d}`; };

// One tooltip for every chart: the value leads, the label follows. The same on hover and on keyboard focus.
// Everything a tooltip says is also on the page: in the bar's own label, or in the table under the chart.
function hover(el, title, rows) {
  const tip = $("#tip");
  const show = () => {
    tip.replaceChildren(h("div", { class: "tt", text: title }), ...rows.map(([value, label, key]) =>
      h("div", { class: "tr" }, key ? h("i", { class: "key " + key }) : null, h("strong", { text: value }), h("span", { text: label }))));
    tip.hidden = false;
    const r = el.getBoundingClientRect(), w = tip.offsetWidth, above = r.top - tip.offsetHeight - 8;
    tip.style.left = Math.max(8, Math.min(window.innerWidth - w - 8, r.left + r.width / 2 - w / 2)) + window.scrollX + "px";
    tip.style.top = (above < 8 ? r.bottom + 8 : above) + window.scrollY + "px";
  };
  el.addEventListener("pointerenter", show); el.addEventListener("focus", show);
  el.addEventListener("pointerleave", () => (tip.hidden = true)); el.addEventListener("blur", () => (tip.hidden = true));
  return el;
}

// Axis ticks on round numbers: [0, step, 2·step, …] reaching at least max.
function ticks(max) {
  let step = 1;
  for (const s of [1, 2, 5, 10, 20, 50, 100, 200, 500, 1000, 2000, 5000, 10000]) { step = s; if (s * 4 >= max) break; }
  const top = Math.max(1, Math.ceil(max / step)) * step;
  return Array.from({ length: top / step + 1 }, (_, i) => i * step);
}

// A column chart. slots: [{ x, title, rows, segs: [{ value, cls }] }], drawn left to right, each a stack from the baseline up.
// Only some slots get an x label, so labels never collide: by default about seven, counted back from the last so the newest day is always named.
function columns(slots, label, named = (i) => (slots.length - 1 - i) % Math.ceil(slots.length / 7) === 0) {
  const total = (s) => s.segs.reduce((a, g) => a + g.value, 0);
  const marks = ticks(Math.max(...slots.map(total))), top = marks.at(-1), at = (v) => `bottom:${(v / top) * 100}%`;
  const peak = slots.reduce((best, s) => (total(s) > total(best) ? s : best), slots[0]);
  const els = slots.map((s) => hover(h("div", { class: "slot", role: "img", "aria-label": `${s.title}：${s.rows.map(([v, l]) => l + " " + v).join("，")}` },
    h("div", { class: "stack" }, s.segs.filter((g) => g.value > 0).map((g) => h("span", { class: "seg " + g.cls, style: `height:${(g.value / top) * 100}%` }))),
    s === peak && total(s) > 0 ? h("span", { class: "peak", style: `bottom:calc(${(total(s) / top) * 100}% + 4px)`, text: String(total(s)) }) : null), s.title, s.rows));
  // One tab stop for the whole chart; the arrow keys walk along it.
  els.forEach((el, i) => {
    el.tabIndex = i ? -1 : 0;
    el.addEventListener("keydown", (e) => {
      const to = e.key === "ArrowRight" ? els[i + 1] : e.key === "ArrowLeft" ? els[i - 1] : null;
      if (to) { e.preventDefault(); el.tabIndex = -1; to.tabIndex = 0; to.focus(); }
    });
  });
  return h("div", { class: "cols", role: "group", "aria-label": label },
    h("div", { class: "yaxis", "aria-hidden": "true", style: `width:${String(top).length}ch` }, marks.map((v) => h("span", { style: at(v), text: String(v) }))),
    h("div", { class: "plot" },
      h("div", { class: "grid", "aria-hidden": "true" }, marks.map((v) => h("i", { style: at(v) }))),
      h("div", { class: "slots" }, els)),
    h("div", { class: "xaxis", "aria-hidden": "true" }, slots.map((s, i) => h("span", { text: named(i) ? s.x : "" }))));
}

// Bars for named things. rows: [{ label, value, unit, note, tip }]; `of` is what a full-width bar stands for.
function bars(rows, of) {
  if (!rows.length) return h("p", { class: "none", text: "这段时间还没有记录。" });
  const full = of || Math.max(1, ...rows.map((r) => r.value));
  return h("div", { class: "bars" }, rows.map((r) => hover(h("div", { class: "brow" },
    h("span", { class: "blabel", text: r.label }),
    h("span", { class: "btrack" },
      h("span", { class: "bar", style: `width:calc((100% - 9em) * ${Math.min(1, r.value / full)})` }),
      h("span", { class: "bval" }, h("b", { text: String(r.value) }), ` ${r.unit}${r.note ? " · " + r.note : ""}`))), r.label, r.tip)));
}

function table(head, rows, wide) {
  if (!rows.length) return h("p", { class: "none", text: "这段时间还没有记录。" });
  return h("div", { class: "scroll" }, h("table", { class: wide && "wide" },
    h("thead", {}, h("tr", {}, head.map((t) => h("th", { scope: "col", text: t })))),
    h("tbody", {}, rows.map((cells) => h("tr", {}, cells.map((c) => h("td", {}, c)))))));
}
const card = (title, note, ...body) => h("section", { class: "card" }, h("h2", {}, title, note ? h("small", { text: note }) : null), body);
const tile = (label, value, note) => h("div", { class: "tile" }, h("span", { text: label }), h("b", { text: String(value) }), h("span", { text: note }));

function dashboard(d) {
  const t = d.totals, v = t.visitors;
  const actions = d.actions.filter((a) => a.action !== "visit");
  const seen = d.devices.reduce((a, x) => a + x.people, 0);
  const hours = Array.from({ length: 24 }, (_, hour) => (d.hours.find((x) => x.hour === hour) || { visits: 0 }).visits);
  return [
    h("div", { class: "tiles" },
      tile("访客", v, "按浏览器算，一台算一人"),
      tile("新访客", t.new_visitors, `占访客 ${share(t.new_visitors, v)}`),
      tile("回访的人", d.returning, "不止一天来过"),
      tile("访问次数", t.visits, v ? `平均每人 ${(t.visits / v).toFixed(1)} 次` : "平均每人 0 次"),
      tile("点开报名链接的人", t.link_clickers, `一共点了 ${t.link_clicks} 次`),
      tile("标记了活动的人", t.markers, `占访客 ${share(t.markers, v)}`)),

    card("每天的访客", null,
      h("div", { class: "legend" }, h("span", {}, h("i", { class: "key s1" }), "新访客"), h("span", {}, h("i", { class: "key s2" }), "以前来过的")),
      columns(d.daily.map((x) => ({ x: monthDay(x.day), title: monthDay(x.day),
        rows: [[String(x.new), "新访客", "s1"], [String(x.visitors - x.new), "以前来过的", "s2"], [String(x.visits), "次访问"]],
        segs: [{ value: x.new, cls: "s1" }, { value: x.visitors - x.new, cls: "s2" }] })), "每天的访客"),
      h("details", {}, h("summary", { text: "看表格" }),
        table(["日期", "访客", "新访客", "访问次数", "点报名链接", "标记"], d.daily.map((x) => [monthDay(x.day), x.visitors, x.new, x.visits, x.link_clicks, x.marks].map(String)).reverse()))),

    card("访客里有多少人做了这些事", `占这段时间 ${v} 位访客的比例`,
      bars([["点过任何东西", t.engaged], ["点开过报名链接", t.link_clickers], ["标记过活动", t.markers], ["留言或添加过活动", t.talkers]]
        .map(([label, n]) => ({ label, value: n, unit: "人", note: share(n, v), tip: [[`${n} 人`, `占访客 ${share(n, v)}`]] })), v || 1)),

    card("最受关注的活动", "每一列都是人数，最多列 30 个",
      table(["活动", "关注", "点报名链接", "标记", "看留言", "看名单"], d.events.map((e) => [
        [e.name || "（已删除的活动）", e.calendar ? h("span", { class: "tag", text: "官方日历" }) : null],
        ...[e.people, e.clickers, e.markers, e.comment_openers, e.people_openers].map(String)]), true)),

    h("div", { class: "pair" },
      card("各个功能有多少人用", null, bars(actions.map((a) => ({ label: ACTIONS[a.action] || a.action, value: a.people, unit: "人", note: `${a.times} 次`,
        tip: [[`${a.people} 人`, "用过"], [`${a.times} 次`, "一共"]] })))),
      card("三个标签页", "各有多少人点进来，又有多少人在那里点报名链接、做标记", table(["标签页", "点进来", "点报名链接", "标记"],
        ["picks", "all", "mine"].map((tab) => d.tabs.find((x) => x.tab === tab)).filter(Boolean)
          .map((x) => [TABS[x.tab], x.tab === "picks" ? "默认打开" : String(x.opened), String(x.clickers), String(x.markers)])))),

    h("div", { class: "pair" },
      card("从哪里来", "分享链接时在末尾加 ?from=群名，这里就能分开看", bars(d.sources.map((s) => ({ label: s.source || "直接打开或来源不明", value: s.people, unit: "人",
        note: `${s.visits} 次访问`, tip: [[`${s.people} 人`, "访客"], [`${s.visits} 次`, "访问"]] })))),
      card("用什么打开", null, bars(d.devices.map((x) => ({ label: DEVICES[x.device] || x.device, value: x.people, unit: "人", note: share(x.people, seen),
        tip: [[`${x.people} 人`, `占 ${share(x.people, seen)}`]] }))))),

    h("div", { class: "pair" },
      card("一天里什么时候来", "访问次数，旧金山时间",
        columns(hours.map((n, hour) => ({ x: `${hour} 点`, title: `${hour} 点到 ${hour + 1} 点`, rows: [[String(n), "次访问"]], segs: [{ value: n, cls: "s1" }] })), "一天里什么时候来", (i) => i % 6 === 0)),
      card("大家搜什么", "在“全部”里的搜索", table(["搜索词", "人数", "次数"], d.searches.map((s) => [s.q, String(s.people), String(s.times)])))),
  ];
}

function render() {
  $("#range").replaceChildren(...RANGES.map(([n, label]) => h("button", { class: "tab", type: "button", "aria-pressed": String(state.days === n),
    disabled: !sb, text: label, onclick: () => { state.days = n; load(); } })));
  const main = $("#main");
  main.classList.toggle("stale", state.loading);
  $("#tip").hidden = true;
  const note = (title, ...body) => main.replaceChildren(h("div", { class: "empty" }, h("strong", { text: title }), body));
  if (state.status === "loading") { if (!state.data) note("正在加载…"); return; }
  if (state.status === "setup") return note("网站还在设置中", "数据库还没接上，没有数据可看。");
  if (state.status === "denied") return note("这台浏览器不是管理员", "访问数据只给管理员看。先打开 ", h("a", { href: "./#admin", text: "管理员配对页面" }), "，批准以后再回来。");
  if (state.status === "unavailable") return note("现在读不到数据", state.missing ? "数据库里还没有统计功能：先在 Supabase 的 SQL Editor 里运行 migration-011-analytics.sql。" : "检查一下网络，然后刷新页面。");
  const d = state.data;
  $("#meta").textContent = d.since
    ? `从 ${new Date(d.since).toLocaleDateString("zh-CN", { timeZone: "America/Los_Angeles", month: "numeric", day: "numeric" })} 开始记录 · 累计 ${d.all_visitors} 位访客 · 不含管理员的浏览器 · 日期按旧金山时间`
    : "还没有任何记录：从现在起有人打开网站就会记下来。";
  main.replaceChildren(...dashboard(d));
}

async function load() {
  const mine = ++asked;
  state.loading = true; render();
  const { data, error } = await sb.rpc("techweek_stats", { p_key: key, p_days: state.days });
  if (mine !== asked) return; // a newer range was chosen meanwhile
  state.loading = false;
  if (error) { state.status = "unavailable"; state.missing = error.code === "PGRST202"; }
  else if (!data) state.status = "denied";
  else { state.status = "ready"; state.data = data; }
  render();
}

function boot() {
  const cfg = window.TECHWEEK_CONFIG || {};
  try { key = localStorage.getItem("tw.key"); } catch {}
  if (!cfg.supabaseUrl || !cfg.supabaseKey) { state.status = "setup"; render(); return; }
  if (!window.supabase) { state.status = "unavailable"; render(); return; }
  if (!key) { state.status = "denied"; render(); return; } // a browser that has never opened the site cannot be an admin
  sb = window.supabase.createClient(cfg.supabaseUrl, cfg.supabaseKey, { auth: { persistSession: false } });
  load();
}
boot();
