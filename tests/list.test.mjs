// The list: starting up, laying events out by day, marking a status, and keeping up with the database.
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { boot, event, rsvp, crowd, KEY, plain, shown } from "./harness.mjs";

const listText = (x) => x.$("#list").textContent;
const titles = (x, el) => x.$$(".event h3", el).map((h) => h.textContent.replace(" ↗", ""));
const pressed = (x, title, nth) => x.$$(".btn.go", x.card(title, nth)).map((b) => b.getAttribute("aria-pressed") === "true");
const selects = (x, table) => x.calls.filter((c) => c.op === "select" && c.table === table);
const nameDialogOpen = (x) => x.$("#nameDlg").hasAttribute("open");
async function saveName(x, name) {
  x.type(x.$("#nName"), name);
  await x.click(x.$("#nameForm button[type=submit]"));
}

describe("starting up", () => {
  test("says it is loading until the first answer arrives, and adding waits for it", async (t) => {
    const x = await boot(t, { events: [event({ name: "Mixer" })], holding: ["techweek_events"] });
    assert.equal(listText(x), "正在加载活动…");
    assert.equal(x.$("#addBtn").disabled, true);
    x.release.techweek_events(); await x.flush();
    assert.deepEqual(titles(x), ["Mixer"]);
    assert.equal(x.$("#addBtn").disabled, false);
  });

  test("without a database configured it says the site is being set up and asks for nothing", async (t) => {
    for (const config of [null, {}, { supabaseUrl: "https://db.test" }]) {
      const x = await boot(t, { config });
      assert.match(listText(x), /网站还在设置中/);
      assert.deepEqual(x.calls, []);
      assert.equal(x.$("#addBtn").disabled, true);
    }
  });

  test("if the database library did not load it says the list cannot be read", async (t) => {
    const x = await boot(t, { client: false });
    assert.match(listText(x), /现在读不到活动列表/);
  });

  test("connects with the configured address and key, and keeps no login session", async (t) => {
    const x = await boot(t);
    assert.deepEqual(x.calls[0], { op: "connect", url: "https://db.test", anon: "anon-key", options: { auth: { persistSession: false } } });
  });

  test("if the first load fails it says so, then shows the list as soon as a later load works", async (t) => {
    for (const broken of ["techweek_events", "techweek_rsvps", "techweek_comments"]) {
      const x = await boot(t, { events: [event({ name: "Mixer" })], failing: [broken] });
      assert.match(listText(x), /现在读不到活动列表/, broken);
      x.heal(); await x.tick(20000);
      assert.deepEqual(titles(x), ["Mixer"], broken);
    }
  });

  test("the list still loads when only the questions about this browser fail", async (t) => {
    const e = event({ name: "Mixer", added_key: KEY });
    const x = await boot(t, { name: "stella", events: [e], rsvps: [rsvp(e.id, "stella", "going", KEY)], failing: ["techweek_my_rsvps", "techweek_my_added", "techweek_my_comments"] });
    assert.deepEqual(titles(x), ["Mixer"]);
    assert.deepEqual(pressed(x, "Mixer"), [false, false, false]);
    assert.equal(x.$(".del", x.card("Mixer")), null);
  });

  test("asks only for columns a visitor may read", async (t) => {
    const x = await boot(t, { events: [event()] });
    for (const c of x.calls.filter((c) => c.op === "select")) assert.doesNotMatch(c.columns, /person_key|added_key/);
    assert.equal(x.state.status, "ready");
  });
});

describe("this browser's key", () => {
  test("is made once, saved, and long enough for the database", async (t) => {
    const x = await boot(t, { key: null });
    const key = x.window.localStorage.getItem("tw.key");
    assert.ok(key.length >= 16 && key.length <= 64, key);
    assert.deepEqual(x.rpcsSent("techweek_my_rsvps"), [{ p_key: key }]);
  });

  test("a saved key is reused", async (t) => {
    const x = await boot(t);
    assert.equal(x.window.localStorage.getItem("tw.key"), KEY);
    assert.deepEqual(x.rpcsSent("techweek_my_added"), [{ p_key: KEY }]);
  });

  test("an older browser without randomUUID still gets a 32-character key", async (t) => {
    const x = await boot(t, { key: null, setup: (w) => Object.defineProperty(w.crypto, "randomUUID", { value: undefined }) });
    assert.match(x.state.key, /^[0-9a-f]{32}$/);
    assert.notEqual(x.app("newKey")(), x.app("newKey")());
  });

  test("with storage blocked the page still works for the visit", async (t) => {
    const e = event({ name: "Mixer" });
    const x = await boot(t, { key: null, events: [e], setup: (w) => Object.defineProperty(w, "localStorage", { get() { throw new Error("blocked"); } }) });
    assert.deepEqual(titles(x), ["Mixer"]);
    await x.click(x.button(x.card("Mixer"), "我会去"));
    await saveName(x, "stella");
    assert.deepEqual(pressed(x, "Mixer"), [true, false, false]);
    assert.deepEqual(shown(x.$(".going", x.card("Mixer"))), ["stella 会去"]);
  });
});

describe("laying out the list", () => {
  test("events are grouped by day, earliest first, then by start time, then by name", async (t) => {
    const x = await boot(t, { events: [
      event({ name: "Tuesday morning", date: "2026-10-06", start_time: "09:00:00" }),
      event({ name: "Monday evening B", date: "2026-10-05", start_time: "18:00:00" }),
      event({ name: "Monday morning", date: "2026-10-05", start_time: "09:30:00" }),
      event({ name: "Monday evening A", date: "2026-10-05", start_time: "18:00:00" }),
      event({ name: "Sunday", date: "2026-10-11", start_time: "08:00:00" }),
    ] });
    assert.deepEqual(x.$$(".day").map((d) => [x.$("h2", d).firstChild.textContent, x.$("h2 small", d).textContent, titles(x, d)]), [
      ["10月5日", "周一", ["Monday morning", "Monday evening A", "Monday evening B"]],
      ["10月6日", "周二", ["Tuesday morning"]],
      ["10月11日", "周日", ["Sunday"]],
    ]);
  });

  test("a card shows start and end, or just the start when there is no end", async (t) => {
    const x = await boot(t, { events: [event({ name: "Both", start_time: "18:00:00", end_time: "22:00:00" }), event({ name: "Open", start_time: "09:05:00", end_time: null })] });
    assert.equal(x.$(".time", x.card("Both")).textContent, "18:00– 22:00");
    assert.equal(x.$(".time", x.card("Open")).textContent, "09:05");
  });

  test("an event on several days gets a card under each day, with that day's hours and its place in the run", async (t) => {
    const e = event({ name: "House", date: "2026-10-06", start_time: "11:00:00", end_time: "17:00:00",
      extra_dates: [{ date: "2026-10-07", start: "12:00", end: "16:00" }, { date: "2026-10-08", start: "13:00", end: "" }] });
    const x = await boot(t, { events: [e, event({ name: "Other", date: "2026-10-07", start_time: "09:00:00" })] });
    assert.deepEqual(x.$$(".day").map((d) => titles(x, d)), [["House"], ["Other", "House"], ["House"]]);
    assert.deepEqual([0, 1, 2].map((n) => x.$(".time", x.card("House", n)).textContent),
      ["11:00– 17:00· 第 1/3 天", "12:00– 16:00· 第 2/3 天", "13:00· 第 3/3 天"]);
    assert.equal(x.$("#stats").textContent, "2 个活动");
  });

  test("extra days that are not a proper date and time are ignored", async (t) => {
    const junk = [null, 7, { date: "next week", start: "10:00" }, { date: "2026-10-07", start: "9am" }, { date: "2026-10-08", start: "11:00", end: "late" }];
    const x = await boot(t, { events: [event({ name: "House", extra_dates: junk }), event({ name: "Plain", extra_dates: null })] });
    assert.deepEqual([0, 1].map((n) => x.$(".time", x.card("House", n)).textContent), ["18:00– 20:00· 第 1/2 天", "11:00· 第 2/2 天"]);
    assert.equal(x.$$(".event").length, 3);
  });

  test("the title links to the sign-up page in a new tab", async (t) => {
    const x = await boot(t, { events: [event({ name: "Mixer", link: "https://luma.com/abc" })] });
    const a = x.$("h3 a", x.card("Mixer"));
    assert.deepEqual([a.href, a.target, a.rel], ["https://luma.com/abc", "_blank", "noopener noreferrer"]);
  });

  test("a link that is not a web address is not made clickable", async (t) => {
    const x = await boot(t, { events: [event({ name: "Trap", link: "javascript:alert(1)" }), event({ name: "Blank", link: "" })] });
    assert.equal(x.$$("#list a").length, 0);
    assert.deepEqual(titles(x), ["Blank", "Trap"]);
  });

  test("a card shows who recommended it, where it is and why, and marks the host's picks", async (t) => {
    const x = await boot(t, { events: [
      event({ name: "Pick", curated: true, added_by: "Stoody AI", location: "Alamo Square", why: "野餐" }),
      event({ name: "Mine", curated: false, added_by: "Alex" })] });
    const pick = x.card("Pick");
    assert.equal(x.$(".badge", pick).textContent, "群主推荐");
    assert.equal(x.$(".by", pick).textContent, "Stoody AI 推荐");
    assert.equal(x.$(".where", pick).textContent, "Alamo Square");
    assert.equal(x.$(".why", pick).textContent, "为什么值得去野餐");
    assert.equal(x.$(".badge", x.card("Mine")), null);
  });

  test("everything a visitor typed is shown as text, never run as HTML", async (t) => {
    const evil = '<img src=x onerror="alert(1)"><script>alert(2)</script>';
    const x = await boot(t, { events: [event({ name: evil, location: evil, why: evil, added_by: evil })] });
    assert.equal(x.$$("#list img, #list script").length, 0);
    assert.equal(x.$(".where").textContent, evil);
  });

  test("the line under the tabs counts the events in the tab on show, and says nothing about people", async (t) => {
    const a = event(), b = event();
    const x = await boot(t, { name: "Ann", events: [a, b], rsvps: [rsvp(a.id, "Ann", "going", KEY), rsvp(b.id, "Bo", "pending")] });
    assert.equal(x.$("#stats").textContent, "2 个活动");
    assert.equal(x.$(".bar").nextElementSibling, x.$("#stats"));
    await x.click(x.$("#tabMine"));
    assert.equal(x.$("#stats").textContent, "1 个活动");
    assert.doesNotMatch(x.$(".top").textContent, /个活动|已标记/);
  });

  test("an empty list invites the first event", async (t) => {
    const x = await boot(t);
    assert.match(listText(x), /还没有活动/);
    assert.equal(x.$("#stats").hidden, true);
    assert.equal(x.$("#addBtn").disabled, false);
  });

  test("each card offers the three statuses and a comments button", async (t) => {
    const x = await boot(t, { events: [event({ name: "Mixer" })] });
    assert.deepEqual(x.$$(".actions button", x.card("Mixer")).map((b) => b.textContent), ["我会去", "等待通过", "感兴趣", "留言"]);
  });
});

describe("the tabs", () => {
  async function two(t) {
    const a = event({ name: "Marked" }), b = event({ name: "Unmarked" });
    return boot(t, { name: "stella", events: [a, b], rsvps: [rsvp(a.id, "stella", "interested", KEY), rsvp(b.id, "Bo")] });
  }

  const tabs = (x) => ["#tabPicks", "#tabAll", "#tabMine"].map((id) => x.$(id).getAttribute("aria-pressed") === "true");

  test("“推荐” is chosen at first and shows every recommended event", async (t) => {
    const x = await two(t);
    assert.deepEqual(tabs(x), [true, false, false]);
    assert.deepEqual(titles(x), ["Marked", "Unmarked"]);
    assert.equal(x.$("#allbar").hidden, true);
  });

  test("“我标记的” shows only events this browser marked, and back again", async (t) => {
    const x = await two(t);
    await x.click(x.$("#tabMine"));
    assert.deepEqual(titles(x), ["Marked"]);
    assert.deepEqual(tabs(x), [false, false, true]);
    await x.click(x.$("#tabPicks"));
    assert.deepEqual(titles(x), ["Marked", "Unmarked"]);
  });

  test("taking my mark off in “我标记的” removes the card, and an empty tab explains itself", async (t) => {
    const x = await two(t);
    await x.click(x.$("#tabMine"));
    await x.click(x.button(x.card("Marked"), "感兴趣"));
    assert.equal(x.$$(".event").length, 0);
    assert.match(listText(x), /你还没标记任何活动/);
  });

  test("the tab survives the regular refresh", async (t) => {
    const x = await two(t);
    await x.click(x.$("#tabMine"));
    await x.tick(20000);
    assert.deepEqual(titles(x), ["Marked"]);
  });
});

describe("“全部”: the official calendar", () => {
  const official = (over) => event({ source: "calendar", why: null, added_by: "Tech Week 官方日历", hosts: "a16z", ...over });
  const calendarSelects = (x) => selects(x, "techweek_events").filter((c) => c.where.source === "calendar");
  const days = (x) => x.$$("#days button").map((b) => b.textContent + (b.getAttribute("aria-pressed") === "true" ? "*" : ""));
  async function search(x, text) {
    x.type(x.$("#search"), text);
    x.$("#search").dispatchEvent(new x.window.Event("input"));
    await x.flush();
  }
  function week(t, more = {}) {
    return boot(t, { name: "stella", ...more, events: [
      event({ name: "Pick", date: "2026-10-05", start_time: "18:00:00" }),
      official({ name: "Breakfast", date: "2026-10-05", start_time: "08:00:00", hosts: "Stripe, Vercel", location: "SOMA", intro: "早午餐 + 社交，主题：AI、金融科技" }),
      official({ name: "Faire", date: "2026-10-09", start_time: "10:30:00", featured: true, location: "Jackson Square" }),
      ...(more.events || []),
    ] });
  }

  test("“推荐” leaves calendar events out and does not fetch them", async (t) => {
    const x = await week(t);
    assert.deepEqual(titles(x), ["Pick"]);
    assert.equal(x.$("#stats").textContent, "1 个活动");
    assert.equal(calendarSelects(x).length, 0);
  });

  test("opening it fetches the calendar once and shows the first day, recommended events included", async (t) => {
    const x = await week(t);
    await x.click(x.$("#tabAll"));
    assert.equal(x.$("#allbar").hidden, false);
    assert.deepEqual(days(x), ["周一 5*", "周五 9"]);
    assert.deepEqual(titles(x), ["Breakfast", "Pick"]);
    assert.equal(x.$("#stats").textContent, "3 个活动");
    assert.match(x.$("#src").textContent, /这一天 2 个 · 2 个来自 Tech Week 官方日历/);
    await x.click(x.$("#tabPicks")); await x.click(x.$("#tabAll")); await x.tick(20000);
    assert.equal(calendarSelects(x).length, 1);
  });

  test("a day button shows that day", async (t) => {
    const x = await week(t);
    await x.click(x.$("#tabAll"));
    await x.click(x.$$("#days button")[1]);
    assert.deepEqual(days(x), ["周一 5", "周五 9*"]);
    assert.deepEqual(titles(x), ["Faire"]);
  });

  test("a calendar card names its hosts and has no reason; a featured one says so", async (t) => {
    const x = await week(t);
    await x.click(x.$("#tabAll"));
    const card = x.card("Breakfast");
    assert.equal(x.$(".by", card).textContent, "主办：Stripe, Vercel");
    assert.equal(x.$(".where", card).textContent, "SOMA");
    assert.equal(x.$(".intro", card).textContent, "早午餐 + 社交，主题：AI、金融科技");
    assert.equal(x.$(".why", card), null);
    assert.equal(x.$(".badge", card), null);
    await x.click(x.$$("#days button")[1]);
    assert.equal(x.$(".badge", x.card("Faire")).textContent, "官方精选");
  });

  test("the search box looks through every day by name, host or place, and a day button ends the search", async (t) => {
    const x = await week(t);
    await x.click(x.$("#tabAll"));
    await search(x, "jackson");
    assert.deepEqual(titles(x), ["Faire"]);
    assert.deepEqual(days(x), ["周一 5", "周五 9"]);
    await search(x, "STRIPE");
    assert.deepEqual(titles(x), ["Breakfast"]);
    await search(x, "金融科技");
    assert.deepEqual(titles(x), ["Breakfast"]);
    await search(x, "nothing like this");
    assert.match(listText(x), /没有找到活动/);
    await x.click(x.$$("#days button")[0]);
    assert.equal(x.$("#search").value, "");
    assert.deepEqual(titles(x), ["Breakfast", "Pick"]);
  });

  test("an event the calendar lists from midnight to 23:45 is shown as running all day", async (t) => {
    const x = await week(t, { events: [
      official({ name: "Popup", date: "2026-10-05", start_time: "00:00:00", end_time: "23:45:00" }),
      official({ name: "Late", date: "2026-10-05", start_time: "00:00:00", end_time: "21:00:00" }),
    ] });
    await x.click(x.$("#tabAll"));
    assert.equal(x.$(".time", x.card("Popup")).textContent, "全天");
    assert.equal(x.$(".time", x.card("Late")).textContent, "00:00– 21:00");
    assert.equal(x.$(".intro", x.card("Popup")), null);
  });

  test("a search with too many results shows the first 300 and says how many there were", async (t) => {
    const x = await week(t, { events: Array.from({ length: 320 }, (_, i) => official({ name: `Mixer ${i}`, date: "2026-10-06" })) });
    await x.click(x.$("#tabAll"));
    await search(x, "mixer");
    assert.equal(x.$$(".event").length, 300);
    assert.match(listText(x), /只显示前 300 个，一共找到 320 个/);
  });

  test("a calendar event can be marked, and the mark stays through the regular refresh", async (t) => {
    const x = await week(t);
    await x.click(x.$("#tabAll"));
    await x.click(x.button(x.card("Breakfast"), "我会去"));
    assert.deepEqual(pressed(x, "Breakfast"), [true, false, false]);
    assert.deepEqual(shown(x.$(".going", x.card("Breakfast"))), ["stella 会去"]);
    await x.tick(20000);
    assert.deepEqual(pressed(x, "Breakfast"), [true, false, false]);
  });

  test("a calendar event I marked is in “我标记的” even before “全部” is opened", async (t) => {
    const faire = official({ name: "Marked faire", date: "2026-10-09" });
    const x = await week(t, { events: [faire], rsvps: [rsvp(faire.id, "stella", "going", KEY)] });
    assert.deepEqual(titles(x), ["Pick"]);
    await x.click(x.$("#tabMine"));
    assert.deepEqual(titles(x), ["Marked faire"]);
    assert.equal(calendarSelects(x).length, 0);
    assert.deepEqual(selects(x, "techweek_events").filter((c) => c.where.id).map((c) => c.where.id), [[faire.id]]);
    await x.click(x.button(x.card("Marked faire"), "我会去"));
    assert.match(listText(x), /你还没标记任何活动/);
  });

  test("the comments panel works on a calendar event", async (t) => {
    const x = await week(t);
    await x.click(x.$("#tabAll"));
    await x.click(x.$(".cbtn", x.card("Breakfast")));
    assert.equal(x.$("#drawer").hidden, false);
    assert.equal(x.$("#dEvent").textContent, "Breakfast");
  });

  test("if the calendar does not load it says so, and “再试一次” loads it", async (t) => {
    const x = await week(t);
    x.fail("techweek_events");
    await x.click(x.$("#tabAll"));
    assert.match(listText(x), /官方日历没加载出来/);
    x.heal();
    await x.click(x.button(x.$("#list"), "再试一次"));
    assert.deepEqual(titles(x), ["Breakfast", "Pick"]);
  });

  test("an admin can delete calendar events; nobody else is offered it", async (t) => {
    const x = await week(t);
    await x.click(x.$("#tabAll"));
    assert.equal(x.$(".del", x.card("Breakfast")), null);
    const y = await week(t, { admins: [KEY] });
    await x.flush();
    await y.click(y.$("#tabAll"));
    const del = y.$(".del", y.card("Breakfast"));
    await y.click(del);
    await y.click(y.$(".del", y.card("Breakfast")));
    assert.deepEqual(titles(y), ["Pick"]);
    assert.equal(y.db.techweek_events.some((e) => e.name === "Breakfast"), false);
  });

  test("a visitor cannot add an event that poses as a calendar entry", async (t) => {
    const x = await week(t);
    const row = { ...event(), id: undefined, source: "calendar" };
    const { error } = await x.client.from("techweek_events").insert(row);
    assert.match(error.message, /insert policy/);
  });
});

describe("topics", () => {
  const chips = (x) => x.$$("#topics .topic").map((b) => b.textContent + (b.getAttribute("aria-pressed") === "true" ? "*" : ""));
  const chip = (x, label) => x.$$("#topics .topic").find((b) => b.textContent.startsWith(label));
  const tags = (x, title) => x.$$(".tag", x.card(title)).map((s) => s.textContent);
  function four(t, more = {}) {
    return boot(t, { ...more, events: [
      event({ name: "Alpha", topics: ["agent", "founder"] }),
      event({ name: "Beta", topics: ["founder"] }),
      event({ name: "Gamma", topics: ["hackathon"] }),
      event({ name: "Plain", topics: [] }),
      ...(more.events || []),
    ] });
  }

  test("above the tabs sits a chip for each topic the tab's events have, in a fixed order, with how many", async (t) => {
    const x = await four(t);
    assert.deepEqual(chips(x), ["Agent1", "创业2", "黑客松1"]);
    assert.equal(x.$("#topics").nextElementSibling, x.$(".bar"));
    assert.deepEqual(titles(x), ["Alpha", "Beta", "Gamma", "Plain"]);
  });

  test("pressing a chip shows only events with that topic, and pressing it again shows everything", async (t) => {
    const x = await four(t);
    await x.click(chip(x, "创业"));
    assert.deepEqual(chips(x), ["Agent1", "创业2*", "黑客松1"]);
    assert.deepEqual(titles(x), ["Alpha", "Beta"]);
    assert.equal(x.$("#stats").textContent, "2 个活动");
    await x.click(chip(x, "创业"));
    assert.deepEqual(titles(x), ["Alpha", "Beta", "Gamma", "Plain"]);
    assert.equal(x.$("#stats").textContent, "4 个活动");
  });

  test("with several chips on, an event with any of those topics shows", async (t) => {
    const x = await four(t);
    await x.click(chip(x, "Agent"));
    await x.click(chip(x, "黑客松"));
    assert.deepEqual(chips(x), ["Agent1*", "创业2", "黑客松1*"]);
    assert.deepEqual(titles(x), ["Alpha", "Gamma"]);
    assert.deepEqual(x.tracked("topic").map((c) => c[2]), [{ tab: "picks", topic: "agent", on: true }, { tab: "picks", topic: "hackathon", on: true }]);
  });

  test("“清除” appears once a chip is on and switches them all off", async (t) => {
    const x = await four(t);
    assert.equal(x.button(x.$("#topics"), "清除"), undefined);
    await x.click(chip(x, "Agent"));
    await x.click(x.button(x.$("#topics"), "清除"));
    assert.deepEqual(chips(x), ["Agent1", "创业2", "黑客松1"]);
    assert.equal(x.$$(".event").length, 4);
  });

  test("a card lists its topics by name, and an event without any has no row for them", async (t) => {
    const x = await four(t);
    assert.deepEqual(tags(x, "Alpha"), ["Agent", "创业"]);
    assert.equal(x.$(".tags", x.card("Plain")), null);
  });

  test("an event without stored topics is matched on its name and reason; stored topics nobody knows are dropped", async (t) => {
    const x = await four(t, { events: [
      event({ name: "Robot night", why: "和做机器人的创始人聊聊", topics: null }),
      event({ name: "Odd", topics: ["agent", "no-such-topic"] }),
    ] });
    assert.deepEqual(tags(x, "Robot night"), ["Physical AI", "创业"]);
    assert.deepEqual(tags(x, "Odd"), ["Agent"]);
  });

  test("the choice carries over to “我标记的”, where a chosen topic nobody has stays at 0 so it can be switched off", async (t) => {
    const mine = event({ name: "Mine", topics: ["founder"] });
    const x = await four(t, { name: "stella", events: [mine], rsvps: [rsvp(mine.id, "stella", "going", KEY)] });
    await x.click(chip(x, "黑客松"));
    await x.click(x.$("#tabMine"));
    assert.deepEqual(chips(x), ["创业1", "黑客松0*"]);
    assert.match(listText(x), /没有符合所选主题的活动/);
    await x.click(x.button(x.$("#list"), "清除主题筛选"));
    assert.deepEqual(titles(x), ["Mine"]);
  });

  test("the filter stays on through the regular refresh", async (t) => {
    const x = await four(t);
    await x.click(chip(x, "黑客松"));
    await x.tick(20000);
    assert.deepEqual(titles(x), ["Gamma"]);
  });

  test("in “全部” the chips count the calendar too and work together with the day and the search", async (t) => {
    const cal = (over) => event({ source: "calendar", why: null, hosts: "a16z", ...over });
    const x = await four(t, { events: [
      cal({ name: "Agent breakfast", date: "2026-10-05", topics: ["agent"] }),
      cal({ name: "Agent faire", date: "2026-10-09", topics: ["agent", "funding"] }),
    ] });
    assert.deepEqual(chips(x), ["Agent1", "创业2", "黑客松1"]);
    await x.click(x.$("#tabAll"));
    assert.deepEqual(chips(x), ["Agent3", "创业2", "融资1", "黑客松1"]);
    await x.click(chip(x, "Agent"));
    assert.equal(x.$("#stats").textContent, "3 个活动");
    assert.deepEqual(titles(x), ["Agent breakfast", "Alpha"]);
    await x.click(x.$$("#days button")[1]);
    assert.deepEqual(titles(x), ["Agent faire"]);
    x.type(x.$("#search"), "breakfast"); x.$("#search").dispatchEvent(new x.window.Event("input")); await x.flush();
    assert.deepEqual(titles(x), ["Agent breakfast"]);
  });

  test("the chips are hidden until there is something to count", async (t) => {
    const x = await boot(t, { events: [event({ name: "Later", topics: ["agent"] })], holding: ["techweek_events"] });
    assert.equal(x.$("#topics").hidden, true);
    x.release.techweek_events(); await x.flush();
    assert.equal(x.$("#topics").hidden, false);
    const y = await boot(t);
    assert.equal(y.$("#topics").hidden, true);
  });
});

describe("who I am", () => {
  test("with a name saved the bar shows it and offers to change it", async (t) => {
    const x = await boot(t, { name: "stella" });
    assert.equal(x.$("#me").textContent, "你是 stella · 改名");
  });

  test("without one the bar asks for it", async (t) => {
    const x = await boot(t);
    assert.equal(x.$("#me").textContent, "填上你的名字");
    await x.click(x.button(x.$("#me"), "填上你的名字"));
    assert.equal(nameDialogOpen(x), true);
    assert.equal(x.document.activeElement, x.$("#nName"));
  });
});

describe("marking a status", () => {
  const one = (t, more = {}) => { const e = event({ name: "Mixer" }); return boot(t, { name: "stella", events: [e], ...more }).then((x) => Object.assign(x, { e })); };

  test("sends my key, name and status, and lights up that button only", async (t) => {
    const x = await one(t);
    await x.click(x.button(x.card("Mixer"), "我会去"));
    assert.deepEqual(x.rpcsSent("techweek_set_status"), [{ p_event: x.e.id, p_key: KEY, p_name: "stella", p_status: "going" }]);
    assert.deepEqual(pressed(x, "Mixer"), [true, false, false]);
  });

  test("pressing the lit button again clears my mark", async (t) => {
    const x = await one(t);
    await x.click(x.button(x.card("Mixer"), "等待通过"));
    await x.click(x.button(x.card("Mixer"), "等待通过"));
    assert.equal(x.rpcsSent("techweek_set_status")[1].p_status, null);
    assert.deepEqual(pressed(x, "Mixer"), [false, false, false]);
    assert.equal(x.db.techweek_rsvps.length, 0);
    assert.equal(x.$(".going", x.card("Mixer")), null);
  });

  test("pressing another status moves my mark instead of adding a second one", async (t) => {
    const x = await one(t);
    await x.click(x.button(x.card("Mixer"), "我会去"));
    await x.click(x.button(x.card("Mixer"), "感兴趣"));
    assert.deepEqual(pressed(x, "Mixer"), [false, false, true]);
    assert.deepEqual(x.db.techweek_rsvps.map((r) => r.status), ["interested"]);
    assert.deepEqual(shown(x.$(".going", x.card("Mixer"))), ["stella 感兴趣"]);
  });

  test("without a name it asks first, then carries on with the mark once the name is saved", async (t) => {
    const e = event({ name: "Mixer" });
    const x = await boot(t, { events: [e] });
    await x.click(x.button(x.card("Mixer"), "我会去"));
    assert.equal(nameDialogOpen(x), true);
    assert.deepEqual(x.rpcsSent("techweek_set_status"), []);
    await saveName(x, "  stella  ");
    assert.equal(nameDialogOpen(x), false);
    assert.deepEqual(x.rpcsSent("techweek_set_status"), [{ p_event: e.id, p_key: KEY, p_name: "stella", p_status: "going" }]);
    assert.equal(x.window.localStorage.getItem("tw.name"), "stella");
    assert.equal(x.$("#me").textContent, "你是 stella · 改名");
    assert.deepEqual(pressed(x, "Mixer"), [true, false, false]);
  });

  test("cancelling the name question drops the mark for good", async (t) => {
    const x = await boot(t, { events: [event({ name: "Mixer" })] });
    await x.click(x.button(x.card("Mixer"), "我会去"));
    await x.click(x.$("#nameCancel"));
    assert.equal(nameDialogOpen(x), false);
    await x.click(x.button(x.$("#me"), "填上你的名字"));
    await saveName(x, "stella");
    assert.deepEqual(x.rpcsSent("techweek_set_status"), []);
    assert.deepEqual(pressed(x, "Mixer"), [false, false, false]);
  });

  test("while a mark is being saved that card's buttons are off, other cards' stay on, and a second request is not sent", async (t) => {
    const other = event({ name: "Other" });
    const x = await one(t, {});
    x.db.techweek_events.push(other); await x.tick(20000);
    const release = x.hold("techweek_set_status");
    await x.click(x.button(x.card("Mixer"), "我会去"));
    assert.deepEqual(x.$$(".btn.go", x.card("Mixer")).map((b) => b.disabled), [true, true, true]);
    assert.deepEqual(x.$$(".btn.go", x.card("Other")).map((b) => b.disabled), [false, false, false]);
    x.app("setStatus")(x.state.events.find((e) => e.name === "Mixer"), "pending");
    release(); await x.flush();
    assert.equal(x.rpcsSent("techweek_set_status").length, 1);
    assert.deepEqual(x.$$(".btn.go", x.card("Mixer")).map((b) => b.disabled), [false, false, false]);
    assert.deepEqual(pressed(x, "Mixer"), [true, false, false]);
  });

  test("if saving fails it says so and leaves things as they were", async (t) => {
    const x = await one(t);
    x.fail("techweek_set_status");
    await x.click(x.button(x.card("Mixer"), "我会去"));
    assert.equal(x.toast(), "没保存成功，请再试一次。");
    assert.deepEqual(pressed(x, "Mixer"), [false, false, false]);
    assert.deepEqual(x.$$(".btn.go", x.card("Mixer")).map((b) => b.disabled), [false, false, false]);
  });

  test("a mark made while the list is refreshing in the background still shows once things settle", async (t) => {
    const x = await one(t);
    const release = x.hold("techweek_rsvps"); // the 20-second refresh has asked who is going and is waiting for the answer
    await x.tick(20000);
    await x.click(x.button(x.card("Mixer"), "我会去"));
    release(); await x.flush();
    assert.deepEqual(pressed(x, "Mixer"), [true, false, false]);
    assert.deepEqual(shown(x.$(".going", x.card("Mixer"))), ["stella 会去"]);
    assert.deepEqual(x.$$(".btn.go", x.card("Mixer")).map((b) => b.disabled), [false, false, false]);
  });

  test("an event on several days lights the button on every one of its cards", async (t) => {
    const e = event({ name: "House", extra_dates: [{ date: "2026-10-06", start: "11:00", end: "17:00" }] });
    const x = await boot(t, { name: "stella", events: [e] });
    await x.click(x.button(x.card("House", 1), "我会去"));
    assert.deepEqual([pressed(x, "House", 0), pressed(x, "House", 1)], [[true, false, false], [true, false, false]]);
  });

  test("the toast goes away after a few seconds, and a newer one gets its full time", async (t) => {
    const x = await one(t);
    x.fail("techweek_set_status");
    await x.click(x.button(x.card("Mixer"), "我会去"));
    await x.tick(3000);
    await x.click(x.button(x.card("Mixer"), "感兴趣"));
    await x.tick(3000);
    assert.equal(x.toast(), "没保存成功，请再试一次。");
    await x.tick(500);
    assert.equal(x.toast(), null);
  });
});

describe("keeping up with other people", () => {
  test("their changes show up at the next 20-second refresh", async (t) => {
    const e = event({ name: "Mixer" });
    const x = await boot(t, { events: [e] });
    x.db.techweek_rsvps.push({ id: 1, ...rsvp(e.id, "Bo", "pending") });
    x.db.techweek_events.push(event({ name: "Newcomer" }));
    await x.tick(19999);
    assert.deepEqual(titles(x), ["Mixer"]);
    await x.tick(1);
    assert.deepEqual(titles(x), ["Mixer", "Newcomer"]);
    assert.deepEqual(shown(x.$(".going", x.card("Mixer"))), ["Bo 等待通过"]);
  });

  test("a tab nobody is looking at stops asking, and asks at once when it is looked at again", async (t) => {
    const x = await boot(t, { events: [event()] });
    const asked = () => selects(x, "techweek_events").length;
    x.setHidden(true);
    await x.tick(60000);
    assert.equal(asked(), 1);
    x.setHidden(false); await x.flush();
    assert.equal(asked(), 2);
  });

  test("more than a thousand marks are read page by page until none are left", async (t) => {
    const e = event({ name: "Huge" });
    const x = await boot(t, { events: [e], rsvps: crowd(e.id, { going: 2300 }) });
    assert.deepEqual(selects(x, "techweek_rsvps").map((c) => c.range), [[0, 999], [1000, 1999], [2000, 2999]]);
    assert.equal(x.$(".more", x.card("Huge")).textContent, "全部 2300 人");
  });

  test("exactly a thousand marks take one more, empty, page", async (t) => {
    const e = event({ name: "Huge" });
    const x = await boot(t, { events: [e], rsvps: crowd(e.id, { interested: 1000 }) });
    assert.deepEqual(selects(x, "techweek_rsvps").map((c) => c.range), [[0, 999], [1000, 1999]]);
    assert.equal(x.$(".more", x.card("Huge")).textContent, "全部 1000 人");
  });

  test("a failed refresh keeps the list on screen and the next one catches up", async (t) => {
    const x = await boot(t, { events: [event({ name: "Mixer" })] });
    x.fail("techweek_events");
    x.db.techweek_events.push(event({ name: "Newcomer" }));
    await x.tick(20000);
    assert.deepEqual(titles(x), ["Mixer"]);
    x.heal(); await x.tick(20000);
    assert.deepEqual(titles(x), ["Mixer", "Newcomer"]);
  });

  test("requests do not pile up: asking again during a load leads to exactly one more load", async (t) => {
    const x = await boot(t, { events: [event()] });
    const release = x.hold("techweek_events");
    for (let i = 0; i < 4; i++) { x.setHidden(true); x.setHidden(false); }
    await x.flush();
    assert.equal(selects(x, "techweek_events").length, 2);
    release(); await x.flush();
    assert.equal(selects(x, "techweek_events").length, 3);
  });
});

describe("small helpers", () => {
  test("safeUrl accepts only web addresses", async (t) => {
    const x = await boot(t), safeUrl = x.app("safeUrl");
    assert.equal(safeUrl("https://lu.ma/x?y=1"), "https://lu.ma/x?y=1");
    assert.equal(safeUrl("http://example.com"), "http://example.com/");
    for (const bad of ["javascript:alert(1)", "data:text/html,hi", "ftp://example.com", "lu.ma/x", "", null, undefined]) assert.equal(safeUrl(bad), null, String(bad));
  });

  test("dayLabel gives the Chinese date and weekday", async (t) => {
    const x = await boot(t), dayLabel = x.app("dayLabel");
    assert.deepEqual(plain(dayLabel("2026-10-05")), { main: "10月5日", sub: "周一" });
    assert.deepEqual(plain(dayLabel("2026-01-04")), { main: "1月4日", sub: "周日" });
    assert.deepEqual(plain(dayLabel("2026-10-10")), { main: "10月10日", sub: "周六" });
  });

  test("stamp prints month/day and a zero-padded local time", async (t) => {
    const x = await boot(t), stamp = x.app("stamp");
    assert.equal(stamp("2026-10-03T18:20:00Z"), "10/3 11:20");
    assert.equal(stamp("2026-01-09T16:05:00Z"), "1/9 08:05");
  });
});
