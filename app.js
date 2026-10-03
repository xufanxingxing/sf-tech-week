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
  events: [],
  mine: new Map(),     // event id -> this browser's status on it
  added: new Set(),    // ids of events this browser added, which it may delete
  confirming: null,    // event id awaiting delete confirmation
  filter: "all",
  name: store.get("tw.name") || "",
  key: store.get("tw.key"),
  busy: new Set(),
};
if (!state.key) { state.key = newKey(); store.set("tw.key", state.key); }
let sb = null;
let afterName = null;

const STATUSES = [
  { key: "going", label: "我会去" },
  { key: "pending", label: "等待通过" },
  { key: "interested", label: "感兴趣" },
];
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

function render() {
  $("#tabAll").setAttribute("aria-pressed", state.filter === "all");
  $("#tabMine").setAttribute("aria-pressed", state.filter === "mine");
  $("#addBtn").disabled = state.status !== "ready";

  const me = $("#me"); me.replaceChildren();
  if (state.name) me.append("你是 ", h("strong", { text: state.name }), " · ", h("button", { class: "link", type: "button", text: "改名", onclick: () => askName(null) }));
  else me.append(h("button", { class: "link", type: "button", text: "填上你的名字", onclick: () => askName(null) }));

  const list = $("#list"); list.replaceChildren();
  if (state.status === "loading") { list.append(h("div", { class: "empty", text: "正在加载活动…" })); return; }
  if (state.status === "setup") { list.append(h("div", { class: "empty" }, h("strong", { text: "网站还在设置中" }), "活动列表很快上线，晚点再来看看。")); return; }
  if (state.status === "unavailable") {
    list.append(h("div", { class: "empty" }, h("strong", { text: "现在读不到活动列表" }), "检查一下网络，然后刷新页面。"));
    return;
  }

  const people = new Set();
  for (const ev of state.events) for (const g of ev.goers) people.add(g.name);
  $("#stats").textContent = state.events.length
    ? `${state.events.length} 个活动 · ${people.size} 人已标记`
    : "SF Tech Week 值得去的活动，和群里谁会去。";

  const shown = state.events
    .filter((ev) => state.filter === "all" || state.mine.has(ev.id))
    .flatMap((ev) => ev.sessions.map((s, i) => ({ ev, s, i })))
    .sort((x, y) => (x.s.date + x.s.start + x.ev.name).localeCompare(y.s.date + y.s.start + y.ev.name));
  if (!shown.length) {
    list.append(state.filter === "mine"
      ? h("div", { class: "empty" }, h("strong", { text: "你还没标记任何活动" }), "在“全部”里点“我会去”“等待通过”或“感兴趣”，这里就是你的日程。")
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
}

function icon(d) {
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("viewBox", "0 0 16 16"); svg.setAttribute("fill", "none"); svg.setAttribute("stroke", "currentColor");
  svg.setAttribute("stroke-width", "1.4"); svg.setAttribute("stroke-linecap", "round"); svg.setAttribute("stroke-linejoin", "round"); svg.setAttribute("aria-hidden", "true");
  const path = document.createElementNS("http://www.w3.org/2000/svg", "path"); path.setAttribute("d", d); svg.append(path);
  return svg;
}
const PIN = "M8 14.5s4.5-4 4.5-7.5a4.5 4.5 0 0 0-9 0c0 3.500 4.500 7.500 4.500 7.500ZM8 8.500a1.500 1.500 0 1 0 0-3 1.500 1.500 0 0 0 0 3Z";
const PERSON = "M8 8a2.750 2.750 0 1 0 0-5.500A2.750 2.750 0 0 0 8 8ZM2.750 13.500c.6-2.200 2.700-3.500 5.250-3.500s4.650 1.300 5.250 3.500";

function card(ev, s, i) {
  const mine = state.mine.get(ev.id), url = safeUrl(ev.link);
  const sure = state.confirming === ev.id;
  let marked = false; // highlight one chip as "me"
  const groups = STATUSES.map((st) => ({ ...st, people: ev.goers.filter((g) => g.status === st.key) })).filter((g) => g.people.length);
  return h("article", { class: "event" },
    h("div", { class: "time" }, h("b", { text: s.start }), s.end ? h("span", { text: "– " + s.end }) : null,
      ev.sessions.length > 1 ? h("i", { text: `· 第 ${i + 1}/${ev.sessions.length} 天` }) : null),
    h("div", { class: "main" },
      h("div", { class: "head" },
        h("h3", {}, url ? h("a", { href: url, target: "_blank", rel: "noopener noreferrer", title: "打开报名页面" }, ev.name, h("span", { class: "ext", "aria-hidden": "true", text: " ↗" })) : ev.name),
        ev.curated ? h("span", { class: "badge", text: "群主推荐" }) : null),
      h("div", { class: "by" }, icon(PERSON), h("span", { text: ev.addedBy + " 推荐" })),
      h("div", { class: "where" }, icon(PIN), h("span", { text: ev.where })),
      h("p", { class: "why", text: ev.why }),
      h("div", { class: "actions" },
        STATUSES.map((st) => h("button", { class: "btn go", type: "button", "aria-pressed": String(mine === st.key),
          disabled: state.busy.has(ev.id), text: st.label, onclick: () => setStatus(ev, st.key) })),
        h("span", { class: "spacer" }),
        state.added.has(ev.id) ? h("button", { class: "link del" + (sure ? " sure" : ""), type: "button",
          text: sure ? "确定删除？再点一次" : "删除", onclick: () => removeEvent(ev) }) : null,
      ),
      groups.length ? h("div", { class: "going" }, groups.map((g) => h("div", { class: "grp" },
        h("span", { class: "count", text: g.label + " " + g.people.length }),
        g.people.map((person) => {
          const isMe = mine === g.key && !marked && person.name === state.name;
          if (isMe) marked = true;
          return h("span", { class: "chip" + (isMe ? " mine" : ""), text: person.name });
        }),
      ))) : null,
    ),
  );
}

async function fetchAllRsvps() {
  const rows = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await sb.from("techweek_rsvps").select("id,event_id,name,status").order("id").range(from, from + 999);
    if (error) throw error;
    rows.push(...data);
    if (data.length < 1000) return rows;
  }
}

let refreshing = false;
async function refresh() {
  if (refreshing) return;
  refreshing = true;
  try {
    const [ev, rsvps, mine, added] = await Promise.all([
      sb.from("techweek_events").select("id,name,link,date,start_time,end_time,extra_dates,location,why,added_by,curated").order("date").order("start_time").order("name"),
      fetchAllRsvps(),
      sb.rpc("techweek_my_rsvps", { p_key: state.key }),
      sb.rpc("techweek_my_added", { p_key: state.key }),
    ]);
    if (ev.error) throw ev.error;
    const byEvent = new Map();
    for (const r of rsvps) {
      if (!byEvent.has(r.event_id)) byEvent.set(r.event_id, []);
      byEvent.get(r.event_id).push({ name: r.name, status: r.status });
    }
    state.events = ev.data.map((e) => ({
      id: e.id, name: e.name, link: e.link,
      sessions: [{ date: e.date, start: e.start_time.slice(0, 5), end: e.end_time ? e.end_time.slice(0, 5) : "" },
        ...(Array.isArray(e.extra_dates) ? e.extra_dates : []).filter((x) => x && DATE_RE.test(x.date) && TIME_RE.test(x.start))
          .map((x) => ({ date: x.date, start: x.start, end: TIME_RE.test(x.end) ? x.end : "" }))],
      where: e.location, why: e.why, addedBy: e.added_by, curated: e.curated,
      goers: byEvent.get(e.id) || [],
    }));
    if (!mine.error) state.mine = new Map(mine.data.map((r) => [r.event_id, r.status]));
    if (!added.error) state.added = new Set(added.data);
    state.status = "ready";
  } catch {
    if (state.status !== "ready") state.status = "unavailable";
  }
  refreshing = false;
  render();
}

function askName(then) {
  afterName = then;
  $("#nName").value = state.name;
  $("#nameDlg").showModal();
  $("#nName").focus();
}
async function setName(name) {
  const changed = name !== state.name;
  state.name = name; store.set("tw.name", name); render();
  if (!changed || !sb || !state.mine.size) return;
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
  if (error) toast("没保存成功，请再试一次。");
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
  await refresh();
}

$("#tabAll").onclick = () => { state.filter = "all"; render(); };
$("#tabMine").onclick = () => { state.filter = "mine"; render(); };
$("#addBtn").onclick = () => {
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
  refresh();
});

function boot() {
  render();
  const cfg = window.TECHWEEK_CONFIG || {};
  if (!cfg.supabaseUrl || !cfg.supabaseKey) { state.status = "setup"; render(); return; }
  if (!window.supabase) { state.status = "unavailable"; render(); return; }
  sb = window.supabase.createClient(cfg.supabaseUrl, cfg.supabaseKey, { auth: { persistSession: false } });
  refresh();
  // Other people's changes show up within 20 seconds, or as soon as the tab is looked at again.
  setInterval(() => { if (!document.hidden) refresh(); }, 20000);
  document.addEventListener("visibilitychange", () => { if (!document.hidden) refresh(); });
}
boot();
