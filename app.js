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
const store = {
  get(k) { try { return localStorage.getItem(k); } catch { return null; } },
  set(k, v) { try { localStorage.setItem(k, v); } catch {} },
};
function newKey() {
  if (crypto.randomUUID) return crypto.randomUUID();
  return Array.from(crypto.getRandomValues(new Uint8Array(16)), (b) => b.toString(16).padStart(2, "0")).join("");
}

const state = {
  status: "loading",   // loading | ready | setup | unavailable
  events: [],          // the recommended events: everything not imported from the official calendar
  calendar: null,      // the official calendar's events, loaded the first time "全部" is opened
  calendarStatus: "idle", // idle | loading | ready | failed
  marked: [],          // calendar events this browser marked, so "我标记的" has them before "全部" is opened
  goers: new Map(),    // event id -> marks, from the last load
  notes: new Map(),    // event id -> comments, from the last load
  day: null,           // the day shown in "全部"
  query: "",           // what is typed in the "全部" search box
  topics: new Set(),   // topic filters that are switched on; none means no filter
  mine: new Map(),     // event id -> this browser's status on it
  added: new Set(),    // ids of events this browser added, which it may delete
  confirming: null,    // event id awaiting delete confirmation
  myComments: new Set(), // ids of comments this browser wrote
  drawer: null,        // id of the event whose comments panel is open
  people: null,        // id of the event whose full who's-going panel is open
  drafts: new Map(),   // event id -> unsent comment text
  filter: "picks",     // picks | all | mine
  name: store.get("tw.name") || "",
  key: store.get("tw.key"),
  busy: new Set(),
};
const firstTime = !state.key; // nothing saved in this browser yet: a new visitor
if (firstTime) { state.key = newKey(); store.set("tw.key", state.key); }
let sb = null;
let afterName = null;

const STATUSES = [
  { key: "going", label: "我会去", tag: "会去" },
  { key: "pending", label: "等待通过", tag: "等待通过" },
  { key: "interested", label: "感兴趣", tag: "感兴趣" },
];
const ADMIN = "00000000-0000-0000-0000-000000000000"; // in the list of events this browser may delete, it means: all of them
const MAX_SHOWN = 300; // cards drawn for one search
// The topics events can be filtered by, in the order their chips appear. `rx` is for events that come without stored topics.
const TOPICS = [
  { key: "agent", label: "Agent", rx: /\bagent(s|ic)?\b|\bmcp\b|智能体/i },
  { key: "physical", label: "Physical AI", rx: /physical ai|robot|humanoid|embodied|world model|机器人|具身/i },
  { key: "infra", label: "AI 基础设施", rx: /\bgpus?\b|inference|\bcompute\b|data ?cent(er|re)|\bchips?\b|semiconductor|算力|推理|芯片|基础设施/i },
  { key: "evals", label: "评测", rx: /\bevals?\b|benchmark|评测/i },
  { key: "voice", label: "Voice AI", rx: /\bvoice\b|speech|语音/i },
  { key: "founder", label: "创业", rx: /founder|startup|创始人|创业/i },
  { key: "funding", label: "融资", rx: /investor|fundrais|\bvcs?\b|融资|投资/i },
  { key: "gtm", label: "GTM", rx: /\bgtm\b|go-to-market|增长|销售/i },
  { key: "consumer", label: "消费/创意", rx: /consumer|creator|消费|创意|创作者/i },
  { key: "health", label: "医疗", rx: /health|medic|pharma|医疗|医学/i },
  { key: "fintech", label: "金融科技", rx: /fintech|payments?\b|金融科技|支付/i },
  { key: "hackathon", label: "黑客松", rx: /hackathon|buildathon|黑客松/i },
  { key: "global", label: "出海", rx: /international|cross-border|出海|跨境|国际/i },
  { key: "women", label: "女性", rx: /\bwomen\b|female|女性/i },
  { key: "sports", label: "运动社交", rx: /run club|padel|yoga|pickleball|跑步|骑行/i },
  { key: "security", label: "安全/国防", rx: /security|cyber|defen[sc]e|安全|国防/i },
  { key: "deeptech", label: "Deep Tech", rx: /deep ?tech|深科技/i },
];
const TOPIC_LABEL = Object.fromEntries(TOPICS.map((t) => [t.key, t.label]));
// Chips and tags take their color from the kind of topic: technology, building a company, an industry, or a format or community.
const TOPIC_KIND = { agent: "tech", physical: "tech", infra: "tech", evals: "tech", voice: "tech", deeptech: "tech",
  founder: "biz", funding: "biz", gtm: "biz", consumer: "field", health: "field", fintech: "field", security: "field",
  hackathon: "scene", global: "scene", women: "scene", sports: "scene" };
// Topics are stored for the calendar's events and the group owner's picks; an event a visitor added is matched on its own words.
function topicsOf(e) {
  if (Array.isArray(e.topics)) return e.topics.filter((k) => k in TOPIC_LABEL);
  const words = `${e.name} ${e.why || ""}`;
  return TOPICS.filter((t) => t.rx.test(words)).map((t) => t.key);
}
const MAX_CHIPS = 5; // names shown on a card before the rest move into the panel
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/, TIME_RE = /^\d{2}:\d{2}$/;
const WEEKDAYS = ["周日", "周一", "周二", "周三", "周四", "周五", "周六"];
function dayLabel(iso) {
  const [y, m, d] = iso.split("-").map(Number);
  return { main: `${m}月${d}日`, sub: WEEKDAYS[new Date(y, m - 1, d).getDay()] };
}
function safeUrl(s) {
  try { const u = new URL(s); return u.protocol === "https:" || u.protocol === "http:" ? u.href : null; }
  catch { return null; }
}

let toastTimer;
function toast(msg) {
  const t = $("#toast"); t.textContent = msg; t.hidden = false;
  clearTimeout(toastTimer); toastTimer = setTimeout(() => (t.hidden = true), 3500);
}

// Panels first: an open panel narrows the page, and the list measures itself to fit.
function render() {
  renderDrawer(); renderPeople();
  document.body.classList.toggle("drawer-open", !!(state.drawer || state.people));
  renderList();
}

function renderList() {
  $("#tabPicks").setAttribute("aria-pressed", state.filter === "picks");
  $("#tabAll").setAttribute("aria-pressed", state.filter === "all");
  $("#tabMine").setAttribute("aria-pressed", state.filter === "mine");
  $("#addBtn").disabled = state.status !== "ready";

  const me = $("#me"); me.replaceChildren();
  if (state.name) me.append("你是 ", h("strong", { text: state.name }), " · ", h("button", { class: "link", type: "button", text: "改名", onclick: () => askName(null) }));
  else me.append(h("button", { class: "link", type: "button", text: "填上你的名字", onclick: () => askName(null) }));

  const list = $("#list"); list.replaceChildren();
  $("#stats").hidden = true; // the count under the tabs, shown once there are events to count
  $("#topics").hidden = true;
  if (state.status === "loading") { list.append(h("div", { class: "empty", text: "正在加载活动…" })); return; }
  if (state.status === "setup") { list.append(h("div", { class: "empty" }, h("strong", { text: "网站还在设置中" }), "活动列表很快上线，晚点再来看看。")); return; }
  if (state.status === "unavailable") {
    list.append(h("div", { class: "empty" }, h("strong", { text: "现在读不到活动列表" }), "检查一下网络，然后刷新页面。"));
    return;
  }

  const all = state.filter === "all";
  $("#allbar").hidden = !all;
  if (all && state.calendarStatus !== "ready") {
    list.append(state.calendarStatus === "failed"
      ? h("div", { class: "empty" }, h("strong", { text: "官方日历没加载出来" }), h("button", { class: "link", type: "button", text: "再试一次", onclick: loadCalendar }))
      : h("div", { class: "empty", text: "正在加载官方日历的全部活动…" }));
    $("#days").replaceChildren(); $("#src").textContent = "";
    return;
  }

  const scope = all ? everything() : state.filter === "mine" ? everything().filter((ev) => state.mine.has(ev.id)) : state.events;
  renderTopics(scope);
  const events = state.topics.size ? scope.filter((ev) => ev.topics.some((k) => state.topics.has(k))) : scope; // any of the chosen topics
  $("#stats").textContent = `${events.length} 个活动`;
  $("#stats").hidden = !events.length;
  let sessions = events.flatMap((ev) => ev.sessions.map((s, i) => ({ ev, s, i })));
  let cut = 0;
  if (all) {
    const days = [...new Set(sessions.map((x) => x.s.date))].sort();
    if (!days.includes(state.day)) state.day = days.includes(today()) ? today() : days[0] || null;
    const q = state.query.trim().toLowerCase();
    $("#days").replaceChildren(...days.map((d) => { const l = dayLabel(d); return h("button", { class: "tab", type: "button",
      "aria-pressed": String(!q && d === state.day), text: `${l.sub} ${d.slice(8).replace(/^0/, "")}`, onclick: () => { state.day = d; state.query = $("#search").value = ""; render(); track("day", null, { day: d }); } }); }));
    sessions = q ? sessions.filter((x) => [x.ev.name, x.ev.hosts, x.ev.addedBy, x.ev.where, x.ev.intro].some((t) => t && t.toLowerCase().includes(q)))
      : sessions.filter((x) => x.s.date === state.day);
    $("#src").replaceChildren(q ? `找到 ${sessions.length} 个` : `这一天 ${sessions.length} 个`, ` · ${state.calendar.length} 个来自 `,
      h("a", { href: "https://www.tech-week.com/calendar/sf", target: "_blank", rel: "noopener noreferrer", text: "Tech Week 官方日历" }), "（10/3 的快照）");
    if (q && sessions.length > MAX_SHOWN) cut = sessions.length;
  }
  const shown = sessions.sort((x, y) => (x.s.date + x.s.start + x.ev.name).localeCompare(y.s.date + y.s.start + y.ev.name)).slice(0, cut ? MAX_SHOWN : undefined);
  if (!shown.length) {
    list.append(scope.length && !events.length
      ? h("div", { class: "empty" }, h("strong", { text: "没有符合所选主题的活动" }), h("button", { class: "link", type: "button", text: "清除主题筛选", onclick: clearTopics }))
      : state.filter === "mine"
      ? h("div", { class: "empty" }, h("strong", { text: "你还没标记任何活动" }), "在“推荐”或“全部”里点“我会去”“等待通过”或“感兴趣”，这里就是你的日程。")
      : all ? h("div", { class: "empty" }, h("strong", { text: "没有找到活动" }), "换个关键词，或者点上面的日期。")
      : h("div", { class: "empty" }, h("strong", { text: "还没有活动" }), "点右上角“添加活动”，放上第一个值得去的。"));
    return;
  }

  let day = null, section = null;
  for (const { ev, s, i } of shown) {
    if (s.date !== day) {
      day = s.date;
      const l = dayLabel(day);
      section = h("section", { class: "day" }, h("h2", {}, l.main, h("small", { text: l.sub })));
      list.append(section);
    }
    section.append(card(ev, s, i));
  }
  if (cut) list.append(h("p", { class: "src", text: `只显示前 ${MAX_SHOWN} 个，一共找到 ${cut} 个。再多打几个字缩小范围。` }));
  fitGoing();
}

// The topic chips above the tabs: one for each topic found among the tab's events, with how many have it. Pressing one filters.
function renderTopics(scope) {
  const count = new Map();
  for (const ev of scope) for (const k of ev.topics) count.set(k, (count.get(k) || 0) + 1);
  const chips = TOPICS.filter((t) => count.has(t.key) || state.topics.has(t.key)).map((t) => h("button", { class: "topic k-" + TOPIC_KIND[t.key], type: "button",
    "aria-pressed": String(state.topics.has(t.key)), onclick: () => {
      const on = !state.topics.delete(t.key);
      if (on) state.topics.add(t.key);
      render(); track("topic", null, { topic: t.key, on });
    } },
    t.label, h("small", { text: String(count.get(t.key) || 0) })));
  if (state.topics.size) chips.push(h("button", { class: "link", type: "button", text: "清除", onclick: clearTopics }));
  $("#topics").replaceChildren(...chips);
  $("#topics").hidden = !chips.length;
}
function clearTopics() { state.topics.clear(); render(); }

// Every event this page has: the recommended ones, then calendar ones it has loaded, each once.
function everything() {
  const seen = new Set();
  return [...state.events, ...(state.calendar || []), ...state.marked].filter((ev) => !seen.has(ev.id) && seen.add(ev.id));
}
const findEvent = (id) => (id ? everything().find((e) => e.id === id) : undefined);
function today() {
  const d = new Date(), p = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

// A card's who's-going row stays within two lines: names drop off the end until the "全部" button fits on the second.
function fitGoing() {
  for (const row of document.querySelectorAll(".going")) {
    const more = row.lastElementChild, chips = [...row.children].slice(0, -1);
    const lines = () => new Set([...row.children].filter((c) => !c.hidden).map((c) => c.offsetTop)).size;
    while (chips.length > 1 && lines() > 2) { chips.pop().hidden = true; more.hidden = false; }
  }
}
let fitWidth = window.innerWidth;
window.addEventListener("resize", () => {
  if (window.innerWidth === fitWidth) return; // phones fire resize on scroll as the address bar hides
  fitWidth = window.innerWidth;
  if (state.status === "ready") renderList();
});

// Everyone marked on an event: this browser's own mark first, then going, pending, interested.
function people(ev) {
  const mine = state.mine.get(ev.id);
  const all = STATUSES.flatMap((st) => ev.goers.filter((g) => g.status === st.key).map((g) => ({ ...g, tag: st.tag })));
  const me = all.findIndex((g) => g.status === mine && g.name === state.name);
  if (me >= 0) { all.unshift(...all.splice(me, 1)); all[0].me = true; }
  return all;
}
function chip(p, tagged) {
  return h("span", { class: "chip" + (p.me ? " mine" : ""), title: p.name },
    h("span", { class: "nm", text: p.name }), tagged ? h("i", { text: p.tag }) : null);
}

function icon(d) {
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("viewBox", "0 0 16 16"); svg.setAttribute("fill", "none"); svg.setAttribute("stroke", "currentColor");
  svg.setAttribute("stroke-width", "1.4"); svg.setAttribute("stroke-linecap", "round"); svg.setAttribute("stroke-linejoin", "round"); svg.setAttribute("aria-hidden", "true");
  const path = document.createElementNS("http://www.w3.org/2000/svg", "path"); path.setAttribute("d", d); svg.append(path);
  return svg;
}
const PIN = "M8 14.5s4.5-4 4.5-7.5a4.5 4.5 0 0 0-9 0c0 3.500 4.500 7.500 4.500 7.500ZM8 8.500a1.500 1.500 0 1 0 0-3 1.500 1.500 0 0 0 0 3Z";
const BUBBLE = "M8 2.500c-3.300 0-6 2.200-6 5 0 1.300.6 2.500 1.600 3.400L3 13.500l2.900-1.200c.7.200 1.400.300 2.100.300 3.300 0 6-2.200 6-5s-2.700-5.100-6-5.100Z";
const PERSON = "M8 8a2.750 2.750 0 1 0 0-5.500A2.750 2.750 0 0 0 8 8ZM2.750 13.500c.6-2.200 2.700-3.500 5.250-3.500s4.650 1.300 5.250 3.500";

function card(ev, s, i) {
  const mine = state.mine.get(ev.id), url = safeUrl(ev.link);
  const sure = state.confirming === ev.id;
  const who = people(ev), listed = state.people === ev.id;
  const allDay = s.start === "00:00" && (!s.end || s.end >= "23:45"); // how the calendar writes an event that runs all day
  return h("article", { class: "event" },
    h("div", { class: "time" }, allDay ? h("b", { text: "全天" }) : [h("b", { text: s.start }), s.end ? h("span", { text: "– " + s.end }) : null],
      ev.sessions.length > 1 ? h("i", { text: `· 第 ${i + 1}/${ev.sessions.length} 天` }) : null),
    h("div", { class: "main" },
      h("div", { class: "head" },
        h("h3", {}, url ? h("a", { href: url, target: "_blank", rel: "noopener noreferrer", title: "打开报名页面", onclick: () => track("open_link", ev.id) }, ev.name, h("span", { class: "ext", "aria-hidden": "true", text: " ↗" })) : ev.name),
        ev.curated ? h("span", { class: "badge", text: "群主推荐" }) : null,
        ev.featured ? h("span", { class: "badge official", text: "官方精选" }) : null),
      ev.topics.length ? h("div", { class: "tags" }, ev.topics.map((k) => h("span", { class: "tag k-" + TOPIC_KIND[k], text: TOPIC_LABEL[k] }))) : null,
      h("div", { class: "by" }, icon(PERSON), h("span", { text: ev.calendar ? "主办：" + (ev.hosts || "未注明") : ev.addedBy + " 推荐" })),
      h("div", { class: "where" }, icon(PIN), h("span", { text: ev.where })),
      ev.intro ? h("p", { class: "intro", text: ev.intro }) : null,
      ev.why ? h("p", { class: "why" }, h("span", { class: "whylabel", text: "为什么值得去" }), ev.why) : null,
      h("div", { class: "actions" },
        STATUSES.map((st) => h("button", { class: "btn go", type: "button", "aria-pressed": String(mine === st.key),
          disabled: state.busy.has(ev.id), text: st.label, onclick: () => setStatus(ev, st.key) })),
        h("span", { class: "spacer" }),
        commentButton(ev),
        state.added.has(ev.id) || state.added.has(ADMIN) ? h("button", { class: "link del" + (sure ? " sure" : ""), type: "button",
          text: sure ? "确定删除？再点一次" : "删除", onclick: () => removeEvent(ev) }) : null,
      ),
      who.length ? h("div", { class: "going" },
        who.slice(0, MAX_CHIPS).map((p) => chip(p, true)),
        h("button", { class: "chip more", type: "button", hidden: who.length <= MAX_CHIPS, "aria-expanded": String(listed),
          text: `全部 ${who.length} 人`, onclick: () => openPeople(listed ? null : ev.id) }),
      ) : null,
    ),
  );
}

function openPeople(id) {
  if (id && state.drawer) openDrawer(null);
  state.people = id;
  render();
  if (id) { $("#pClose").focus(); track("open_people", id); }
}

function renderPeople() {
  const ev = findEvent(state.people);
  $("#people").hidden = !ev;
  if (!ev) { state.people = null; return; }
  const who = people(ev);
  $("#pTitle").textContent = `已标记 (${who.length})`;
  $("#pEvent").textContent = ev.name;
  $("#pList").replaceChildren(...(who.length ? STATUSES.map((st) => ({ st, list: who.filter((p) => p.status === st.key) }))
    .filter((g) => g.list.length).map((g) => h("section", {},
      h("h3", { class: "count", text: g.st.tag + " " + g.list.length }),
      h("div", { class: "grp" }, g.list.map((p) => chip(p))))) : [h("p", { class: "cnone", text: "还没有人标记。" })]));
}
$("#pClose").onclick = () => openPeople(null);

function stamp(iso) {
  const d = new Date(iso), p = (n) => String(n).padStart(2, "0");
  return `${d.getMonth() + 1}/${d.getDate()} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

function commentButton(ev) {
  const n = ev.comments.length, open = state.drawer === ev.id;
  return h("button", { class: "cbtn" + (n ? " has" : ""), type: "button", "aria-expanded": String(open),
    "aria-label": n ? `留言，${n} 条` : "留言", title: "留言", onclick: () => openDrawer(open ? null : ev.id) },
    icon(BUBBLE), h("span", { text: n ? `留言 ${n}` : "留言" }));
}

function openDrawer(id) {
  const input = $("#dInput");
  if (state.drawer) state.drafts.set(state.drawer, input.value);
  state.drawer = id;
  if (id) state.people = null; // one panel at a time
  input.value = id ? state.drafts.get(id) || "" : "";
  render();
  if (id) { input.focus(); track("open_comments", id); }
}

// The panel's input lives outside the list so refreshes never touch what is being typed.
function renderDrawer() {
  const ev = findEvent(state.drawer);
  $("#drawer").hidden = !ev;
  if (!ev) { state.drawer = null; return; }
  $("#dTitle").textContent = `留言 (${ev.comments.length})`;
  $("#dEvent").textContent = ev.name;
  $("#dName").textContent = state.name || "还没填名字";
  $("#dList").replaceChildren(...(ev.comments.length ? [...ev.comments].reverse().map((c) => h("div", { class: "comment" },
    h("div", {}, h("strong", { text: c.name }), h("span", { class: "ctime", text: stamp(c.created_at) }),
      state.myComments.has(c.id) ? h("button", { class: "link cdel", type: "button", text: "删除", onclick: () => removeComment(c) }) : null),
    h("p", { text: c.body }))) : [h("p", { class: "cnone", text: "还没有留言，写下第一条。" })]));
}

async function sendComment() {
  const input = $("#dInput"), id = state.drawer, body = input.value.trim();
  if (!id || !body) { input.focus(); return; }
  if ($("#dSend").disabled) return; // still sending: a second Enter must not post the same text again
  if (!state.name) { askName(() => sendComment()); return; }
  $("#dSend").disabled = true;
  const { error } = await sb.rpc("techweek_add_comment", { p_event: id, p_key: state.key, p_name: state.name, p_body: body });
  $("#dSend").disabled = false;
  if (error) { toast("留言没发出去，请再试一次。"); return; }
  if (state.drawer === id) input.value = ""; // by now the box may hold what is being typed for another event
  state.drafts.delete(id);
  track("comment", id);
  await refresh();
  input.focus();
}
$("#dSend").onclick = sendComment;
$("#dClose").onclick = () => openDrawer(null);
$("#dInput").addEventListener("keydown", (e) => { if (e.key === "Enter" && !e.shiftKey && !e.isComposing) { e.preventDefault(); sendComment(); } });
document.addEventListener("keydown", (e) => {
  if (e.key !== "Escape" || document.querySelector("dialog[open]")) return;
  if (state.drawer) openDrawer(null); else if (state.people) openPeople(null);
});

async function removeComment(c) {
  const { data, error } = await sb.rpc("techweek_delete_comment", { p_id: c.id, p_key: state.key });
  if (error || !data) toast("没删掉，请再试一次。");
  await refresh();
}

async function fetchAll(table, columns) {
  const rows = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await sb.from(table).select(columns).order("id").range(from, from + 999);
    if (error) throw error;
    rows.push(...data);
    if (data.length < 1000) return rows;
  }
}

// One load at a time. A call that arrives during a load asks for one more after it and waits for that one,
// so a mark or comment saved a moment ago is never missing from what gets drawn.
let refreshing = null, again = false;
function refresh() {
  if (refreshing) { again = true; return refreshing; }
  return (refreshing = (async () => {
    do { again = false; await load(); } while (again);
    refreshing = null;
    render();
  })());
}
const COLUMNS = "id,name,link,date,start_time,end_time,extra_dates,location,why,added_by,curated,source,hosts,featured,intro,topics";
const toEvent = (e) => ({
  id: e.id, name: e.name, link: e.link,
  sessions: [{ date: e.date, start: e.start_time.slice(0, 5), end: e.end_time ? e.end_time.slice(0, 5) : "" },
    ...(Array.isArray(e.extra_dates) ? e.extra_dates : []).filter((x) => x && DATE_RE.test(x.date) && TIME_RE.test(x.start))
      .map((x) => ({ date: x.date, start: x.start, end: TIME_RE.test(x.end) ? x.end : "" }))],
  where: e.location, why: e.why, addedBy: e.added_by, curated: e.curated,
  calendar: e.source === "calendar", hosts: e.hosts || "", featured: !!e.featured, intro: e.intro || "",
  topics: topicsOf(e),
  goers: state.goers.get(e.id) || [],
  comments: state.notes.get(e.id) || [],
});
function attach(list) {
  for (const ev of list) { ev.goers = state.goers.get(ev.id) || []; ev.comments = state.notes.get(ev.id) || []; }
}

// The official calendar is a snapshot that does not change, so it is fetched once, when "全部" is first opened.
async function loadCalendar() {
  if (state.calendarStatus === "loading" || state.calendarStatus === "ready") return;
  state.calendarStatus = "loading"; render();
  try {
    const rows = [];
    for (let from = 0; ; from += 1000) {
      const { data, error } = await sb.from("techweek_events").select(COLUMNS).eq("source", "calendar")
        .order("date").order("start_time").order("id").range(from, from + 999);
      if (error) throw error;
      rows.push(...data);
      if (data.length < 1000) break;
    }
    state.calendar = rows.map(toEvent);
    state.calendarStatus = "ready";
  } catch { state.calendarStatus = "failed"; }
  render();
}

async function load() {
  try {
    const [ev, rsvps, mine, added, comments, myComments] = await Promise.all([
      sb.from("techweek_events").select(COLUMNS).eq("source", "community").order("date").order("start_time").order("name"),
      fetchAll("techweek_rsvps", "id,event_id,name,status"),
      sb.rpc("techweek_my_rsvps", { p_key: state.key }),
      sb.rpc("techweek_my_added", { p_key: state.key }),
      fetchAll("techweek_comments", "id,event_id,name,body,created_at"),
      sb.rpc("techweek_my_comments", { p_key: state.key }),
    ]);
    if (ev.error) throw ev.error;
    const byEvent = new Map();
    for (const r of rsvps) {
      if (!byEvent.has(r.event_id)) byEvent.set(r.event_id, []);
      byEvent.get(r.event_id).push({ name: r.name, status: r.status });
    }
    const notes = new Map();
    for (const c of comments) {
      if (!notes.has(c.event_id)) notes.set(c.event_id, []);
      notes.get(c.event_id).push(c);
    }
    state.goers = byEvent; state.notes = notes;
    state.events = ev.data.map(toEvent);
    if (state.calendar) attach(state.calendar);
    if (!mine.error) state.mine = new Map(mine.data.map((r) => [r.event_id, r.status]));
    // Marks on calendar events that are not loaded yet: fetch just those events, so "我标记的" is complete.
    const have = new Set(everything().map((e) => e.id)), missing = [...state.mine.keys()].filter((id) => !have.has(id));
    if (missing.length) {
      const extra = await sb.from("techweek_events").select(COLUMNS).in("id", missing);
      if (!extra.error) state.marked = [...state.marked, ...extra.data.map(toEvent)];
    }
    state.marked = state.marked.filter((e) => state.mine.has(e.id));
    attach(state.marked);
    if (!added.error) state.added = new Set(added.data);
    if (!myComments.error) state.myComments = new Set(myComments.data);
    state.status = "ready";
  } catch {
    if (state.status !== "ready") state.status = "unavailable";
  }
}

function askName(then) {
  afterName = then;
  $("#nName").value = state.name;
  $("#nameDlg").showModal();
  $("#nName").focus();
}
async function setName(name) {
  const changed = name !== state.name, unnamed = !state.name;
  state.name = name; store.set("tw.name", name); render();
  if (!changed || !sb) return;
  if (unnamed) track("set_name");
  const { error } = await sb.rpc("techweek_rename_me", { p_key: state.key, p_name: name });
  if (error) toast("名字没改成功，请再试一次。");
  await refresh();
}

async function setStatus(ev, status) {
  if (!state.name) { askName(() => setStatus(ev, status)); return; }
  if (state.busy.has(ev.id)) return;
  const next = state.mine.get(ev.id) === status ? null : status; // clicking the active one clears it
  state.busy.add(ev.id); render();
  const { error } = await sb.rpc("techweek_set_status", { p_event: ev.id, p_key: state.key, p_name: state.name, p_status: next });
  if (error) toast("没保存成功，请再试一次。"); else track("mark", ev.id, { status: next || "none" });
  await refresh();
  state.busy.delete(ev.id); render();
}

async function removeEvent(ev) {
  if (state.confirming !== ev.id) {
    state.confirming = ev.id; render();
    setTimeout(() => { if (state.confirming === ev.id) { state.confirming = null; render(); } }, 4000);
    return;
  }
  state.confirming = null;
  const { data, error } = await sb.rpc("techweek_delete_event", { p_event: ev.id, p_key: state.key });
  toast(error || !data ? "没删掉，请再试一次。" : "已删除");
  if (!error && data && state.calendar) state.calendar = state.calendar.filter((e) => e.id !== ev.id);
  await refresh();
}

$("#tabPicks").onclick = () => { state.filter = "picks"; render(); track("tab"); };
$("#tabAll").onclick = () => { state.filter = "all"; render(); if (sb) loadCalendar(); track("tab"); };
$("#search").addEventListener("input", () => { state.query = $("#search").value; renderList(); });
// What people look for, recorded once they pause typing.
let searchTimer;
$("#search").addEventListener("input", () => {
  clearTimeout(searchTimer);
  searchTimer = setTimeout(() => { const q = state.query.trim(); if (q) track("search", null, { q: q.slice(0, 40) }); }, 1500);
});
$("#tabMine").onclick = () => { state.filter = "mine"; render(); track("tab"); };
$("#addBtn").onclick = () => {
  track("add_open");
  $("#eventErr").hidden = true;
  if (!$("#fBy").value) $("#fBy").value = state.name;
  $("#eventDlg").showModal();
  $("#fName").focus();
};
let dateSeq = 1;
function addDateRow() {
  if ($("#dates").children.length >= 7) { toast("最多 7 个日期。"); return; }
  const n = ++dateSeq;
  const row = h("div", { class: "row extra" },
    h("div", { class: "field" }, h("input", { id: "fDate" + n, type: "date", "aria-label": "日期", required: true })),
    h("div", { class: "field" }, h("input", { id: "fStart" + n, type: "time", "aria-label": "开始", required: true })),
    h("div", { class: "field" }, h("input", { id: "fEnd" + n, type: "time", "aria-label": "结束，可不填" })),
    h("button", { class: "link", type: "button", text: "移除", onclick: () => row.remove() }),
  );
  // Start from the first row's times: a multi-day event usually keeps the same hours.
  row.querySelectorAll("input")[1].value = $("#fStart").value;
  row.querySelectorAll("input")[2].value = $("#fEnd").value;
  $("#dates").append(row);
  row.querySelector("input").focus();
}
$("#addDate").onclick = addDateRow;
$("#eventCancel").onclick = () => $("#eventDlg").close();
$("#nameCancel").onclick = () => { afterName = null; $("#nameDlg").close(); };

$("#nameForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  const name = $("#nName").value.trim();
  if (!name) { $("#nName").focus(); return; }
  $("#nameDlg").close();
  const then = afterName; afterName = null;
  await setName(name);
  if (then) then();
});

$("#eventForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  const v = (id) => $(id).value.trim();
  const err = $("#eventErr");
  const fail = (msg, id) => { err.textContent = msg; err.hidden = false; $(id).focus(); };
  let link = v("#fLink");
  if (link && !/^https?:\/\//i.test(link)) link = "https://" + link;

  if (!v("#fName")) return fail("请填活动名称。", "#fName");
  if (!safeUrl(link)) return fail("报名链接不对，请粘贴完整的网址。", "#fLink");
  const sessions = [];
  for (const row of $("#dates").children) {
    const [d, st, en] = row.querySelectorAll("input");
    const bad = (msg, el) => { err.textContent = msg; err.hidden = false; el.focus(); };
    if (!d.value) return bad("请选日期。", d);
    if (!st.value) return bad("请填开始时间。", st);
    if (en.value && en.value <= st.value) return bad("结束时间要晚于开始时间。", en);
    if (sessions.some((x) => x.date === d.value)) return bad("这个日期已经填过了。", d);
    sessions.push({ date: d.value, start: st.value, end: en.value });
  }
  sessions.sort((x, y) => (x.date + x.start).localeCompare(y.date + y.start));
  if (!v("#fWhere")) return fail("请填地点。", "#fWhere");
  if (!v("#fWhy")) return fail("请写一句为什么值得去。", "#fWhy");
  if (!v("#fBy")) return fail("请填你的名字。", "#fBy");

  const save = $("#eventSave"); save.disabled = true; err.hidden = true;
  const { error } = await sb.from("techweek_events").insert({
    name: v("#fName"), link: safeUrl(link), date: sessions[0].date, start_time: sessions[0].start, end_time: sessions[0].end || null,
    extra_dates: sessions.slice(1),
    location: v("#fWhere"), why: v("#fWhy"), added_by: v("#fBy"), added_key: state.key,
  });
  save.disabled = false;
  if (error) { err.textContent = "没保存成功，请再试一次。"; err.hidden = false; return; }
  if (!state.name) setName(v("#fBy"));
  $("#eventDlg").close();
  for (const id of ["#fName", "#fLink", "#fDate", "#fStart", "#fEnd", "#fWhere", "#fWhy"]) $(id).value = "";
  for (const row of [...$("#dates").querySelectorAll(".row.extra")]) row.remove();
  toast("已添加");
  track("add_event", null, { days: sessions.length });
  refresh();
});

// Product analytics: what this browser does goes to techweek_track, which only the database owner and admin browsers can read.
// Never awaited and never allowed to fail out loud, so it cannot get in a visitor's way.
function track(action, eventId, props) {
  if (!sb) return;
  try {
    sb.rpc("techweek_track", { p_key: state.key, p_action: action, p_event: eventId || null, p_props: { tab: state.filter, ...props } })
      .then(() => {}, () => {});
  } catch {}
}
// A visit is the page being opened, or looked at again after half an hour in the background.
function visit(first) {
  const url = new URL(location.href);
  let ref = "";
  try { if (document.referrer) ref = new URL(document.referrer).hostname; } catch {}
  track("visit", null, {
    first, named: !!state.name, ref: ref === location.hostname ? "" : ref.slice(0, 60),
    from: (url.searchParams.get("from") || url.searchParams.get("utm_source") || "").slice(0, 40), // share the link as ?from=群名 to tell channels apart
    device: /Mobi|Android|iPhone|iPad/i.test(navigator.userAgent) ? "mobile" : "desktop",
    wechat: /MicroMessenger/i.test(navigator.userAgent), w: window.innerWidth,
  });
}

// Opening the site at #admin asks to make this browser an admin; whoever runs the database approves it by the code shown.
async function adminPairing() {
  if (location.hash !== "#admin") return;
  const box = $("#notice"), say = (msg) => { box.textContent = msg; box.hidden = false; };
  const { data: isAdmin, error } = await sb.rpc("techweek_is_admin", { p_key: state.key });
  if (error) return say("现在查不到管理员状态，请刷新再试。");
  if (isAdmin) {
    store.set("tw.adminCode", "");
    say("这台浏览器是管理员：每个活动右下角都有“删除”，也可以删任何留言。");
    return box.append(" ", h("a", { href: "stats.html", text: "看访问数据 →" }));
  }
  let [code, at] = (store.get("tw.adminCode") || "").split(":");
  if (!code || Date.now() - Number(at) > 20 * 60 * 1000) {
    code = String(crypto.getRandomValues(new Uint32Array(1))[0] % 1000000).padStart(6, "0");
    const res = await sb.rpc("techweek_request_admin", { p_key: state.key, p_code: code, p_name: state.name });
    if (res.error) return say("管理员申请没发出去，请刷新再试。");
    store.set("tw.adminCode", code + ":" + Date.now());
  }
  say(`管理员配对码：${code}。把这 6 位数字发给管理网站的人，批准后刷新这个页面。`);
}

function boot() {
  render();
  const cfg = window.TECHWEEK_CONFIG || {};
  if (!cfg.supabaseUrl || !cfg.supabaseKey) { state.status = "setup"; render(); return; }
  if (!window.supabase) { state.status = "unavailable"; render(); return; }
  sb = window.supabase.createClient(cfg.supabaseUrl, cfg.supabaseKey, { auth: { persistSession: false } });
  refresh();
  adminPairing();
  visit(firstTime);
  let away = 0; // when the tab was last put in the background
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) { away = Date.now(); return; }
    if (away && Date.now() - away > 30 * 60 * 1000) visit(false);
    away = 0;
  });
  // Other people's changes show up within 20 seconds, or as soon as the tab is looked at again.
  setInterval(() => { if (!document.hidden) refresh(); }, 20000);
  document.addEventListener("visibilitychange", () => { if (!document.hidden) refresh(); });
}
boot();
