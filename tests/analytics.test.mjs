// Product analytics: what the site records about a visit, and the admin's page that shows the totals.
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { JSDOM } from "jsdom";
import { boot, event, rsvp, crowd, comment, KEY } from "./harness.mjs";

const iphoneWechat = (w) => Object.defineProperty(w.navigator, "userAgent", { configurable: true,
  value: "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 MicroMessenger/8.0.50" });
const typeSearch = (x, text) => { x.type(x.$("#search"), text); x.$("#search").dispatchEvent(new x.window.Event("input")); };
// Moves the page's clock forward without waiting.
function clock(x) {
  const D = x.app("Date"), real = D.now.bind(D);
  let ahead = 0;
  D.now = () => real() + ahead;
  return (minutes) => { ahead += minutes * 60 * 1000; };
}

describe("a visit is recorded", () => {
  test("once when the page opens, with the kind of browser and where it came from", async (t) => {
    const x = await boot(t, { name: "stella", search: "?from=%E7%BE%A4%E4%B8%80", referrer: "https://www.google.com/search?q=tech+week", innerWidth: 390, setup: iphoneWechat });
    assert.deepEqual(x.rpcsSent("techweek_track").map((a) => [a.p_key, a.p_action, a.p_event]), [[KEY, "visit", null]]);
    assert.deepEqual(x.tracked(), [["visit", null, { tab: "picks", first: false, named: true, ref: "www.google.com", from: "群一", device: "mobile", wechat: true, w: 390 }]]);
  });

  test("a computer opening the link directly is a desktop visit with no source", async (t) => {
    const x = await boot(t);
    assert.deepEqual(x.tracked(), [["visit", null, { tab: "picks", first: false, named: false, ref: "", from: "", device: "desktop", wechat: false, w: 1024 }]]);
  });

  test("a browser with nothing saved yet is a new visitor; one with a key is not", async (t) => {
    const fresh = await boot(t, { key: null }), back = await boot(t);
    assert.equal(fresh.tracked("visit")[0][2].first, true);
    assert.equal(back.tracked("visit")[0][2].first, false);
    assert.equal(fresh.rpcsSent("techweek_track")[0].p_key, fresh.window.localStorage.getItem("tw.key"));
  });

  test("utm_source works like from, a link from the site itself is not a source, and long values are cut to fit the database", async (t) => {
    const utm = await boot(t, { search: "?utm_source=newsletter", referrer: "https://techweek.test/stats.html" });
    assert.deepEqual([utm.tracked()[0][2].from, utm.tracked()[0][2].ref], ["newsletter", ""]);
    const long = await boot(t, { search: "?from=" + "群".repeat(100), referrer: `https://${"a".repeat(60)}.${"b".repeat(60)}.example.com/` });
    assert.equal(long.tracked().length, 1, "the visit must still be accepted");
    assert.deepEqual([long.tracked()[0][2].from.length, long.tracked()[0][2].ref.length], [40, 60]);
  });

  test("again only after the tab has been in the background for more than half an hour", async (t) => {
    const x = await boot(t, { name: "stella" }), later = clock(x);
    x.setHidden(true); later(29); x.setHidden(false); await x.flush();
    assert.equal(x.tracked("visit").length, 1);
    x.setHidden(true); later(31); x.setHidden(false); await x.flush();
    assert.equal(x.tracked("visit").length, 2);
    assert.equal(x.tracked("visit")[1][2].first, false);
    x.setHidden(false); await x.flush();
    assert.equal(x.tracked("visit").length, 2);
  });

  test("nothing is recorded while the site has no database", async (t) => {
    const x = await boot(t, { config: null });
    await x.click(x.$("#tabMine"));
    assert.deepEqual(x.calls, []);
  });
});

describe("what a visitor does is recorded", () => {
  const official = (over) => event({ source: "calendar", why: null, added_by: "Tech Week 官方日历", hosts: "a16z", ...over });
  const acts = (x) => x.tracked().filter(([a]) => a !== "visit");

  test("switching tabs, with the tab they went to", async (t) => {
    const x = await boot(t);
    await x.click(x.$("#tabAll")); await x.click(x.$("#tabMine")); await x.click(x.$("#tabPicks"));
    assert.deepEqual(acts(x), [["tab", null, { tab: "all" }], ["tab", null, { tab: "mine" }], ["tab", null, { tab: "picks" }]]);
  });

  test("picking a day in “全部”", async (t) => {
    const x = await boot(t, { events: [official({ date: "2026-10-05" }), official({ date: "2026-10-06" })] });
    await x.click(x.$("#tabAll"));
    await x.click(x.$$("#days button")[1]);
    assert.deepEqual(x.tracked("day"), [["day", null, { tab: "all", day: "2026-10-06" }]]);
  });

  test("a search, once, after they stop typing", async (t) => {
    const x = await boot(t, { events: [official({ name: "Claude Founder House" })] });
    await x.click(x.$("#tabAll"));
    typeSearch(x, "cl"); await x.tick(1000);
    typeSearch(x, "  Claude  "); await x.tick(1499);
    assert.deepEqual(x.tracked("search"), []);
    await x.tick(1);
    assert.deepEqual(x.tracked("search"), [["search", null, { tab: "all", q: "Claude" }]]);
    typeSearch(x, "   "); await x.tick(5000);
    typeSearch(x, "很".repeat(60)); await x.tick(1500);
    assert.deepEqual(x.tracked("search").map(([, , p]) => p.q.length), [6, 40]);
  });

  test("opening an event's sign-up link, with the event and the tab it was on", async (t) => {
    const e = event({ name: "Mixer" });
    const x = await boot(t, { events: [e] });
    x.document.addEventListener("click", (ev) => ev.preventDefault(), true); // jsdom cannot follow the link
    await x.click(x.$("h3 a", x.card("Mixer")));
    assert.deepEqual(acts(x), [["open_link", e.id, { tab: "picks" }]]);
  });

  test("marking, changing and clearing a status; a mark that failed to save is not counted", async (t) => {
    const e = event({ name: "Mixer" });
    const x = await boot(t, { name: "stella", events: [e] });
    await x.click(x.button(x.card("Mixer"), "我会去"));
    await x.click(x.button(x.card("Mixer"), "感兴趣"));
    await x.click(x.button(x.card("Mixer"), "感兴趣"));
    x.fail("techweek_set_status");
    await x.click(x.button(x.card("Mixer"), "我会去"));
    assert.deepEqual(acts(x), [["mark", e.id, { tab: "picks", status: "going" }], ["mark", e.id, { tab: "picks", status: "interested" }], ["mark", e.id, { tab: "picks", status: "none" }]]);
  });

  test("opening comments, sending one, and opening the full list of people; closing them is not an action", async (t) => {
    const e = event({ name: "Mixer" });
    const x = await boot(t, { name: "stella", events: [e], rsvps: crowd(e.id, { going: 8 }) });
    await x.click(x.$(".cbtn", x.card("Mixer")));
    x.type(x.$("#dInput"), "hi");
    await x.click(x.$("#dSend"));
    await x.click(x.$("#dClose"));
    await x.click(x.$(".more", x.card("Mixer")));
    await x.click(x.$("#pClose"));
    assert.deepEqual(acts(x), [["open_comments", e.id, { tab: "picks" }], ["comment", e.id, { tab: "picks" }], ["open_people", e.id, { tab: "picks" }]]);
  });

  test("a comment that failed to send is not counted", async (t) => {
    const e = event({ name: "Mixer" });
    const x = await boot(t, { name: "stella", events: [e] });
    await x.click(x.$(".cbtn", x.card("Mixer")));
    x.type(x.$("#dInput"), "hi");
    x.fail("techweek_add_comment");
    await x.click(x.$("#dSend"));
    assert.deepEqual(x.tracked("comment"), []);
  });

  test("opening the add-event form, and adding an event with its number of days", async (t) => {
    const x = await boot(t, { name: "stella" });
    await x.click(x.$("#addBtn"));
    for (const [id, v] of Object.entries({ fName: "Demo Day", fLink: "lu.ma/demo", fDate: "2026-10-07", fStart: "18:00", fWhere: "SoMa", fWhy: "熟人多", fBy: "stella" })) x.type(x.$("#" + id), v);
    await x.click(x.$("#addDate"));
    x.type(x.$$("#dates > .row")[1].querySelector("input"), "2026-10-08");
    x.fail("techweek_events");
    await x.click(x.$("#eventSave"));
    assert.deepEqual(acts(x), [["add_open", null, { tab: "picks" }]]);
    x.heal();
    await x.click(x.$("#eventSave"));
    assert.deepEqual(acts(x).at(-1), ["add_event", null, { tab: "picks", days: 2 }]);
  });

  test("filling in a name for the first time, but not changing it later", async (t) => {
    const x = await boot(t);
    const rename = async (name) => { await x.click(x.$("#me button")); x.type(x.$("#nName"), name); await x.click(x.$("#nameForm button[type=submit]")); };
    await rename("stella"); await rename("Stella X");
    assert.deepEqual(acts(x), [["set_name", null, { tab: "picks" }]]);
  });

  test("no name ever goes into the record", async (t) => {
    const e = event({ name: "Mixer" });
    const x = await boot(t, { name: "stella-the-person", events: [e], comments: [comment(e.id, "Bo", "hi")] });
    await x.click(x.button(x.card("Mixer"), "我会去"));
    await x.click(x.$(".cbtn", x.card("Mixer")));
    x.type(x.$("#dInput"), "secret words");
    await x.click(x.$("#dSend"));
    assert.ok(x.tracked().length >= 4);
    assert.doesNotMatch(JSON.stringify(x.db.techweek_activity), /stella-the-person|secret words/);
  });
});

describe("recording never gets in a visitor's way", () => {
  async function marks(t, more) {
    const e = event({ name: "Mixer" });
    const x = await boot(t, { name: "stella", events: [e], ...more });
    return Object.assign(x, { pressed: () => x.$$(".btn.go", x.card("Mixer")).map((b) => b.getAttribute("aria-pressed") === "true") });
  }

  test("if the database refuses every record, the page works and shows no error", async (t) => {
    const x = await marks(t, { failing: ["techweek_track"] });
    await x.click(x.button(x.card("Mixer"), "我会去"));
    await x.click(x.$("#tabMine"));
    assert.deepEqual(x.pressed(), [true, false, false]);
    assert.equal(x.toast(), null);
    assert.deepEqual(x.tracked(), []);
  });

  test("if recording blows up, the click still does its job", async (t) => {
    const x = await marks(t);
    const rpc = x.client.rpc;
    x.client.rpc = (name, args) => { if (name === "techweek_track") throw new Error("boom"); return rpc(name, args); };
    await x.click(x.$(".cbtn", x.card("Mixer")));
    await x.click(x.button(x.card("Mixer"), "我会去"));
    assert.equal(x.$("#drawer").hidden, false);
    assert.deepEqual(x.pressed(), [true, false, false]);
  });

  test("a record that never gets an answer holds nothing up", async (t) => {
    const x = await marks(t, { holding: ["techweek_track"] });
    await x.click(x.button(x.card("Mixer"), "我会去"));
    assert.deepEqual(x.pressed(), [true, false, false]);
    assert.deepEqual(x.$$(".btn.go", x.card("Mixer")).map((b) => b.disabled), [false, false, false]);
  });

  test("an admin browser at #admin gets a link to the numbers", async (t) => {
    const x = await boot(t, { hash: "#admin", admins: [KEY] });
    assert.equal(x.$("#notice a").getAttribute("href"), "stats.html");
  });
});

// ---- the admin's numbers page ----

const day = (i) => `2026-10-${String(3 + i).padStart(2, "0")}`;
const sample = (days) => ({
  days, since: "2026-10-03T20:00:00+00:00", all_visitors: 40, returning: 7,
  totals: { visitors: 25, new_visitors: 18, visits: 60, engaged: 20, link_clickers: 12, link_clicks: 30, markers: 9, talkers: 3 },
  daily: Array.from({ length: days }, (_, i) => (i === days - 1 ? { day: day(i), visitors: 12, new: 8, visits: 20, link_clicks: 9, marks: 4 }
    : { day: day(i), visitors: i % 4, new: Math.min(i % 4, 1), visits: i % 4, link_clicks: 0, marks: 0 })),
  actions: [{ action: "visit", times: 60, people: 25 }, { action: "tab", times: 22, people: 15 }, { action: "open_link", times: 30, people: 12 }, { action: "brand_new_thing", times: 2, people: 1 }],
  tabs: [{ tab: "all", opened: 15, clickers: 5, markers: 4 }, { tab: "mine", opened: 6, clickers: 1, markers: 0 }, { tab: "picks", opened: 3, clickers: 9, markers: 7 }],
  events: [
    { name: "Kickoff", calendar: false, people: 10, clickers: 8, markers: 5, comment_openers: 2, people_openers: 1 },
    { name: "<img src=x onerror=alert(1)>", calendar: true, people: 4, clickers: 4, markers: 0, comment_openers: 0, people_openers: 0 },
    { name: null, calendar: false, people: 1, clickers: 0, markers: 1, comment_openers: 0, people_openers: 0 }],
  devices: [{ device: "wechat", people: 15 }, { device: "desktop", people: 6 }, { device: "mobile", people: 4 }],
  sources: [{ source: "", people: 14, visits: 30 }, { source: "群一", people: 8, visits: 20 }, { source: "<b>x</b>.example.com", people: 3, visits: 10 }],
  searches: [{ q: "claude", times: 5, people: 4 }, { q: "<i>ai</i>", times: 1, people: 1 }],
  hours: [{ hour: 9, visits: 20 }, { hour: 21, visits: 40 }],
});
const stats = (t, more = {}) => boot(t, { page: "stats", stats: sample, ...more });
const cardOf = (x, title) => x.$$(".card").find((c) => x.$("h2", c).firstChild.textContent === title);
const rowsOf = (x, title) => x.$$("tbody tr", cardOf(x, title)).map((r) => x.$$("td", r).map((c) => c.textContent));
const barsOf = (x, title) => x.$$(".brow", cardOf(x, title)).map((r) => [x.$(".blabel", r).textContent, x.$(".bval", r).textContent]);
const range = (x) => x.$$("#range button").map((b) => b.textContent + (b.getAttribute("aria-pressed") === "true" ? "*" : ""));

describe("the numbers page: who may see it", () => {
  test("anyone: an ordinary browser gets the numbers without being an admin", async (t) => {
    const x = await stats(t);
    assert.equal(x.$$(".tile").length, 6);
    assert.deepEqual(x.rpcsSent("techweek_stats"), [{ p_key: KEY, p_days: 14 }]);
    assert.deepEqual(x.rpcsSent("techweek_is_admin"), []);
  });

  test("a browser that has never opened the site gets them too, and the page gives it no key", async (t) => {
    const x = await stats(t, { key: null });
    assert.equal(x.$$(".tile").length, 6);
    assert.deepEqual(x.rpcsSent("techweek_stats"), [{ p_key: "", p_days: 14 }]);
    assert.equal(x.window.localStorage.getItem("tw.key"), null, "the numbers page must not create a key");
  });

  test("a database that still answers only admins is named, with the migration that opens it", async (t) => {
    const x = await stats(t, { stats: null });
    assert.match(x.$("#main").textContent, /数据还没有对所有人开放.*migration-015-open-stats\.sql/);
    assert.equal(x.$$(".tile").length, 0);
  });

  test("without a database configured it says so and the range buttons are off", async (t) => {
    const x = await stats(t, { config: null });
    assert.match(x.$("#main").textContent, /网站还在设置中/);
    assert.ok(x.$$("#range button").every((b) => b.disabled));
  });

  test("if the request fails it says to check the network", async (t) => {
    const x = await stats(t, { failing: ["techweek_stats"] });
    assert.match(x.$("#main").textContent, /现在读不到数据.*检查一下网络/);
  });

  test("if the database has no stats function yet it names the migration to run", async (t) => {
    const x = await stats(t, { setup: (w) => { w.supabase = { createClient: () => ({ rpc: async () => ({ data: null, error: { code: "PGRST202", message: "not found" } }) }) }; } });
    assert.match(x.$("#main").textContent, /migration-011-analytics\.sql/);
  });

  test("it records nothing itself: looking at the numbers is not a visit", async (t) => {
    const x = await stats(t);
    assert.deepEqual(x.rpcsSent("techweek_track"), []);
  });
});

describe("the numbers page: what an admin sees", () => {
  test("the headline numbers", async (t) => {
    const x = await stats(t);
    assert.deepEqual(x.$$(".tile").map((el) => x.$$("span, b", el).map((n) => n.textContent)), [
      ["访客", "25", "按浏览器算，一台算一人"],
      ["新访客", "18", "占访客 72%"],
      ["回访的人", "7", "不止一天来过"],
      ["访问次数", "60", "平均每人 2.4 次"],
      ["点开报名链接的人", "12", "一共点了 30 次"],
      ["标记了活动的人", "9", "占访客 36%"]]);
    assert.equal(x.$("#meta").textContent, "从 10/3 开始记录 · 累计 40 位访客 · 不含管理员的浏览器 · 日期按旧金山时间");
  });

  test("visitors by day: a column per day split into new and returning, a legend, the busiest day labelled, and the same numbers as a table", async (t) => {
    const x = await stats(t), c = cardOf(x, "每天的访客");
    assert.deepEqual(x.$$(".legend span", c).map((s) => s.textContent), ["新访客", "以前来过的"]);
    assert.equal(x.$$(".slot", c).length, 14);
    const last = x.$$(".slot", c).at(-1);
    assert.equal(last.getAttribute("aria-label"), "10/16：新访客 8，以前来过的 4，次访问 20");
    assert.deepEqual(x.$$(".seg", last).map((s) => [s.className, s.style.height]), [["seg s1", `${(8 / 15) * 100}%`], ["seg s2", `${(4 / 15) * 100}%`]]);
    assert.deepEqual(x.$$(".peak", c).map((p) => p.textContent), ["12"]);
    assert.deepEqual(x.$$(".yaxis span", c).map((s) => s.textContent), ["0", "5", "10", "15"]);
    assert.deepEqual(x.$$(".xaxis span", c).map((s) => s.textContent).filter(Boolean), ["10/4", "10/6", "10/8", "10/10", "10/12", "10/14", "10/16"]);
    assert.deepEqual(rowsOf(x, "每天的访客")[0], ["10/16", "12", "8", "20", "9", "4"]);
    assert.equal(rowsOf(x, "每天的访客").length, 14);
  });

  test("a day nobody came has an empty column, not a stub", async (t) => {
    const x = await stats(t);
    assert.equal(x.$$(".seg", x.$$(".slot", cardOf(x, "每天的访客"))[0]).length, 0);
  });

  test("how many visitors did each thing, as a share of all visitors", async (t) => {
    const x = await stats(t);
    assert.deepEqual(barsOf(x, "访客里有多少人做了这些事"), [
      ["点过任何东西", "20 人 · 80%"], ["点开过报名链接", "12 人 · 48%"], ["标记过活动", "9 人 · 36%"], ["留言或添加过活动", "3 人 · 12%"]]);
    // each bar is that share of the room left beside its label
    assert.deepEqual(x.$$(".bar", cardOf(x, "访客里有多少人做了这些事")).map((b) => Number(b.style.width.replace("(100% - 9em)", "").replace(/[^\d.]/g, ""))), [0.8, 0.48, 0.36, 0.12]);
  });

  test("the events table, with a deleted event and a calendar event told apart", async (t) => {
    const x = await stats(t);
    assert.deepEqual(rowsOf(x, "最受关注的活动"), [
      ["Kickoff", "10", "8", "5", "2", "1"],
      ["<img src=x onerror=alert(1)>官方日历", "4", "4", "0", "0", "0"],
      ["（已删除的活动）", "1", "0", "1", "0", "0"]]);
  });

  test("feature use in plain words, leaving out the visit itself; an action the page does not know keeps its own name", async (t) => {
    const x = await stats(t);
    assert.deepEqual(barsOf(x, "各个功能有多少人用"), [["切换标签页", "15 人 · 22 次"], ["点开报名链接", "12 人 · 30 次"], ["brand_new_thing", "1 人 · 2 次"]]);
  });

  test("the three tabs in the order they appear on the site", async (t) => {
    const x = await stats(t);
    assert.deepEqual(rowsOf(x, "三个标签页"), [["推荐", "默认打开", "9", "7"], ["全部", "15", "5", "4"], ["我标记的", "6", "1", "0"]]);
  });

  test("where visitors came from and what they opened it with", async (t) => {
    const x = await stats(t);
    assert.deepEqual(barsOf(x, "从哪里来"), [["直接打开或来源不明", "14 人 · 30 次访问"], ["群一", "8 人 · 20 次访问"], ["<b>x</b>.example.com", "3 人 · 10 次访问"]]);
    assert.deepEqual(barsOf(x, "用什么打开"), [["微信里打开", "15 人 · 60%"], ["电脑", "6 人 · 24%"], ["手机浏览器", "4 人 · 16%"]]);
  });

  test("the hours of the day, all 24, and what people searched for", async (t) => {
    const x = await stats(t), c = cardOf(x, "一天里什么时候来");
    assert.equal(x.$$(".slot", c).length, 24);
    assert.equal(x.$$(".slot", c)[21].getAttribute("aria-label"), "21 点到 22 点：次访问 40");
    assert.deepEqual(x.$$(".xaxis span", c).map((s) => s.textContent).filter(Boolean), ["0 点", "6 点", "12 点", "18 点"]);
    assert.deepEqual(rowsOf(x, "大家搜什么"), [["claude", "4", "5"], ["<i>ai</i>", "1", "1"]]);
  });

  test("nothing from the database is run as HTML", async (t) => {
    const x = await stats(t);
    assert.equal(x.$$("#main img, #main b:not(.tile b):not(.bval b), #main i:not(.key):not(.grid i)").length, 0);
  });

  test("with no visits yet every number is zero and every list says it is empty", async (t) => {
    const none = (days) => ({ days, since: null, all_visitors: 0, returning: 0,
      totals: { visitors: 0, new_visitors: 0, visits: 0, engaged: 0, link_clickers: 0, link_clicks: 0, markers: 0, talkers: 0 },
      daily: Array.from({ length: days }, (_, i) => ({ day: day(i), visitors: 0, new: 0, visits: 0, link_clicks: 0, marks: 0 })),
      actions: [], tabs: [], events: [], devices: [], sources: [], searches: [], hours: [] });
    const x = await stats(t, { stats: none });
    assert.deepEqual(x.$$(".tile b").map((b) => b.textContent), ["0", "0", "0", "0", "0", "0"]);
    assert.equal(x.$("#meta").textContent, "还没有任何记录：从现在起有人打开网站就会记下来。");
    assert.equal(x.$$(".none").length, 6);
    assert.equal(x.$$(".seg, .peak").length, 0);
    assert.doesNotMatch(x.$("#main").textContent, /NaN|undefined|Infinity|null/);
  });
});

describe("the numbers page: range and reading values", () => {
  test("14 days to begin with; another range asks again and redraws", async (t) => {
    const x = await stats(t);
    assert.deepEqual(range(x), ["今天", "7 天", "14 天*", "30 天", "90 天"]);
    await x.click(x.button(x.$("#range"), "30 天"));
    assert.deepEqual(x.rpcsSent("techweek_stats").map((a) => a.p_days), [14, 30]);
    assert.deepEqual(range(x), ["今天", "7 天", "14 天", "30 天*", "90 天"]);
    assert.equal(x.$$(".slot", cardOf(x, "每天的访客")).length, 30);
  });

  test("while the new range loads the old numbers stay on screen, dimmed", async (t) => {
    const x = await stats(t);
    const release = x.hold("techweek_stats");
    await x.click(x.button(x.$("#range"), "今天"));
    assert.ok(x.$("#main").classList.contains("stale"));
    assert.equal(x.$$(".slot", cardOf(x, "每天的访客")).length, 14);
    release(); await x.flush();
    assert.equal(x.$("#main").classList.contains("stale"), false);
    assert.equal(x.$$(".slot", cardOf(x, "每天的访客")).length, 1);
  });

  test("a column shows its numbers on focus, and the arrow keys walk along the chart from a single tab stop", async (t) => {
    const x = await stats(t), slots = x.$$(".slot", cardOf(x, "每天的访客")), tip = x.$("#tip");
    assert.deepEqual([slots[0].tabIndex, slots[1].tabIndex, slots.filter((s) => s.tabIndex === 0).length], [0, -1, 1]);
    assert.equal(tip.hidden, true);
    slots[0].focus();
    assert.equal(tip.hidden, false);
    assert.equal(x.$(".tt", tip).textContent, "10/3");
    x.press(slots[0], "ArrowRight");
    assert.equal(x.document.activeElement, slots[1]);
    assert.deepEqual(x.$$(".tr", tip).map((r) => r.textContent), ["1新访客", "0以前来过的", "1次访问"]);
    x.press(slots[1], "ArrowLeft"); x.press(slots[0], "ArrowLeft");
    assert.equal(x.document.activeElement, slots[0]);
    slots[0].blur();
    assert.equal(tip.hidden, true);
  });

  test("axis ticks land on round numbers that reach the tallest column", async (t) => {
    const x = await stats(t), ticks = (n) => [...x.app("ticks")(n)];
    assert.deepEqual([0, 1, 4, 5, 11, 41, 100, 730].map(ticks),
      [[0, 1], [0, 1], [0, 1, 2, 3, 4], [0, 2, 4, 6], [0, 5, 10, 15], [0, 20, 40, 60], [0, 50, 100], [0, 200, 400, 600, 800]]);
  });
});

describe("the numbers page and its script agree", () => {
  const html = readFileSync(new URL("../stats.html", import.meta.url), "utf8"), source = readFileSync(new URL("../stats.js", import.meta.url), "utf8");
  const { document } = new JSDOM(html).window;

  test("every element the script looks up is on the page, and scripts load in order", () => {
    const ids = [...new Set([...source.matchAll(/\$\("#([A-Za-z][\w-]*)"\)/g)].map((m) => m[1]))];
    assert.deepEqual(ids.sort(), ["main", "meta", "range", "tip"]);
    assert.deepEqual(ids.filter((id) => !document.getElementById(id)), []);
    const src = [...document.querySelectorAll("script[src]")].map((s) => s.getAttribute("src"));
    assert.match(src[0], /supabase-js/);
    assert.match(src[1], /^config\.js\?v=\d+$/);
    assert.match(src[2], /^stats\.js\?v=\d+$/);
  });

  test("the script never builds HTML from text, and search engines are asked to stay away", () => {
    assert.doesNotMatch(source, /innerHTML|outerHTML|insertAdjacentHTML|document\.write|\beval\(/);
    assert.equal(document.querySelector('meta[name="robots"]').content, "noindex");
  });

  test("both chart colors are set for light and for dark", () => {
    const css = document.querySelector("style").textContent;
    assert.equal((css.match(/--series-1:/g) || []).length, 3);
    assert.equal((css.match(/--series-2:/g) || []).length, 3);
  });

  test("every action the site records has words on the numbers page", () => {
    const app = readFileSync(new URL("../app.js", import.meta.url), "utf8");
    const recorded = [...new Set([...app.matchAll(/track\("([a-z_]+)"/g)].map((m) => m[1]))];
    const named = source.match(/const ACTIONS = \{([\s\S]*?)\};/)[1];
    assert.ok(recorded.length >= 12);
    assert.deepEqual(recorded.filter((a) => !new RegExp(`\\b${a}:`).test(named)), []);
  });
});
