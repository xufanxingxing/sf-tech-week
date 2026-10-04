// Language: Chinese unless the address says ?lang=en; the globe button at the top right switches and rewrites the address.
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { boot, event, rsvp, comment, KEY, SOURCE } from "./harness.mjs";

const CJK = /[一-鿿]/;
const texts = (x, sel, el) => x.$$(sel, el).map((n) => n.textContent);
const pick = (over = {}) => event({ name: "Supper", curated: true, date: "2026-10-05", start_time: "18:00:00", end_time: "20:00:00",
  location: "FiDi, San Francisco（具体地址报名通过后显示）", why: "一场小型晚餐。", why_en: "A small dinner.", added_by: "stella", topics: ["founder", "hackathon"], ...over });
const official = (over = {}) => event({ name: "Breakfast", source: "calendar", why: null, added_by: "Tech Week 官方日历", hosts: "a16z", date: "2026-10-05",
  start_time: "00:00:00", end_time: "23:45:00", location: "线上", intro: "晚餐 + 社交，主题：AI、融资与投资", topics: ["funding"], featured: true, ...over });
const address = (x) => x.window.location.search + x.window.location.hash;

describe("language", () => {
  test("the page opens in Chinese, and the button at the top right offers English", async (t) => {
    const x = await boot(t, { name: "stella", events: [pick()] });
    assert.equal(x.$("#langTo").textContent, "EN");
    assert.equal(x.$("#langBtn").getAttribute("aria-label"), "Switch to English");
    assert.equal(x.$(".top #langBtn") !== null, true);
    assert.deepEqual(texts(x, ".tabs .tab"), ["推荐", "全部", "我标记的"]);
    assert.equal(x.$(".why", x.card("Supper")).textContent, "为什么值得去一场小型晚餐。");
    assert.equal(x.document.documentElement.lang, "zh-Hans");
    assert.equal(address(x), "");
  });

  test("pressing it turns the whole page English, offers Chinese as the way back, and puts the choice in the address", async (t) => {
    const e = pick(), extra = pick({ name: "House", extra_dates: [{ date: "2026-10-06", start: "11:00", end: "17:00" }], topics: [] });
    const x = await boot(t, { name: "stella", events: [e, extra], rsvps: [rsvp(e.id, "stella", "pending", KEY), rsvp(e.id, "Bo")], comments: [comment(e.id, "Bo", "see you")] });
    await x.click(x.$("#langBtn"));
    assert.equal(x.$("#langTo").textContent, "CN");
    assert.equal(x.$("#langBtn").getAttribute("aria-label"), "切换到中文");
    assert.equal(address(x), "?lang=en");
    assert.equal(x.document.documentElement.lang, "en");
    assert.equal(x.document.title, "Stoody AI: Where to Go at Tech Week");
    assert.equal(x.$("h1").textContent, "Stoody AI: Where to Go at Tech Week");
    assert.deepEqual(texts(x, ".tabs .tab"), ["Picks", "All", "My marks"]);
    assert.equal(x.$("#addBtn").textContent, "＋ Add event");
    assert.equal(x.$("#me").textContent, "You are stella · Rename");
    assert.equal(x.$("#stats").textContent, "2 events");
    assert.deepEqual(texts(x, "#topics .topic"), ["Founders1", "Hackathon1"]);
    assert.deepEqual(texts(x, ".day h2"), ["Oct 5Mon", "Oct 6Tue"]);
    const card = x.card("Supper");
    assert.equal(x.$(".badge", card).textContent, "Host pick");
    assert.deepEqual(texts(x, ".tag", card), ["Founders", "Hackathon"]);
    assert.equal(x.$(".by", card).textContent, "stella recommends");
    assert.equal(x.$(".where", card).textContent, "FiDi, San Francisco (exact address shown once you're approved)");
    assert.equal(x.$(".why", card).textContent, "Why goA small dinner.");
    assert.deepEqual(texts(x, ".btn.go", card), ["Going", "Waiting", "Interested"]);
    assert.equal(x.$(".cbtn", card).textContent, "Comments 1");
    assert.deepEqual(texts(x, ".going .chip", card).slice(0, 2), ["stellaWaiting", "BoGoing"]);
    assert.equal(x.$(".time", x.card("House", 1)).textContent, "11:00– 17:00· Day 2 of 2");
    assert.equal(x.$("#search").getAttribute("placeholder"), "Search by event, host or place");
    assert.equal(x.$("#fWhy").getAttribute("placeholder"), "Who hosts it, who will be there, what you get out of it");
    assert.doesNotMatch(x.document.body.textContent, CJK, "nothing on the page is left in Chinese");
    for (const el of x.$$("[placeholder], [aria-label]")) {
      for (const a of ["placeholder", "aria-label"]) if (el !== x.$("#langBtn")) assert.doesNotMatch(el.getAttribute(a) || "", CJK);
    }
  });

  test("pressing it again brings the Chinese back and takes the choice out of the address", async (t) => {
    const x = await boot(t, { name: "stella", events: [pick()] });
    const before = x.document.body.textContent;
    await x.click(x.$("#langBtn"));
    await x.click(x.$("#langBtn"));
    assert.equal(x.$("#langTo").textContent, "EN");
    assert.equal(address(x), "");
    assert.equal(x.document.body.textContent, before);
    assert.equal(x.$("#search").getAttribute("placeholder"), "搜索活动名、主办方或地点");
    assert.equal(x.document.title, "Stoody AI: Tech Week 去哪儿");
  });

  test("a link with ?lang=en opens in English", async (t) => {
    const x = await boot(t, { hash: "?lang=en", events: [pick()] });
    assert.equal(x.$("#langTo").textContent, "CN");
    assert.deepEqual(texts(x, ".tabs .tab"), ["Picks", "All", "My marks"]);
    assert.equal(x.$(".why", x.card("Supper")).textContent, "Why goA small dinner.");
    assert.equal(address(x), "?lang=en");
  });

  test("any other language in the address means Chinese", async (t) => {
    const x = await boot(t, { hash: "?lang=fr", events: [pick()] });
    assert.deepEqual(texts(x, ".tabs .tab"), ["推荐", "全部", "我标记的"]);
  });

  test("switching keeps the rest of the address", async (t) => {
    const x = await boot(t, { hash: "?from=wechat#top", events: [pick()] });
    await x.click(x.$("#langBtn"));
    assert.equal(address(x), "?from=wechat&lang=en#top");
    await x.click(x.$("#langBtn"));
    assert.equal(address(x), "?from=wechat#top");
  });

  test("a reason nobody translated is shown as it was written", async (t) => {
    const x = await boot(t, { hash: "?lang=en", events: [pick({ why_en: null })] });
    assert.equal(x.$(".why", x.card("Supper")).textContent, "Why go一场小型晚餐。");
  });

  test("in “All”, a calendar card's intro, place and hours are in English too, and the search finds the English words", async (t) => {
    const x = await boot(t, { hash: "?lang=en", events: [pick(), official()] });
    await x.click(x.$("#tabAll"));
    const card = x.card("Breakfast");
    assert.equal(x.$(".time", card).textContent, "All day");
    assert.equal(x.$(".by", card).textContent, "Hosted by a16z");
    assert.equal(x.$(".where", card).textContent, "Virtual");
    assert.equal(x.$(".intro", card).textContent, "Dinner + Networking · Topics: AI, Fundraising & Investing");
    assert.equal(x.$(".badge.official", card).textContent, "Featured");
    assert.deepEqual(texts(x, "#days button"), ["Mon 5"]);
    assert.match(x.$("#src").textContent, /^2 this day · 1 from the official Tech Week calendar \(snapshot of Oct 3\)$/);
    x.type(x.$("#search"), "networking"); x.$("#search").dispatchEvent(new x.window.Event("input")); await x.flush();
    assert.deepEqual(x.$$(".event h3").map((h) => h.textContent.replace(" ↗", "")), ["Breakfast"]);
  });

  test("messages that come up later are in the chosen language", async (t) => {
    const x = await boot(t, { hash: "?lang=en", name: "stella", events: [pick()] });
    x.fail("techweek_set_status");
    await x.click(x.button(x.card("Supper"), "Going"));
    assert.equal(x.toast(), "Couldn't save. Please try again.");
    await x.click(x.$("#addBtn"));
    await x.click(x.$("#eventSave"));
    assert.equal(x.$("#eventErr").textContent, "Enter the event name.");
  });

  test("one event reads “1 event”", async (t) => {
    const x = await boot(t, { hash: "?lang=en", events: [pick()] });
    assert.equal(x.$("#stats").textContent, "1 event");
  });

  test("switching is recorded with the language chosen", async (t) => {
    const x = await boot(t, { events: [pick()] });
    await x.click(x.$("#langBtn"));
    assert.deepEqual(x.tracked("lang"), [["lang", null, { tab: "picks", to: "en" }]]);
  });

  test("every piece of text the script shows has an English version", async (t) => {
    const x = await boot(t);
    const known = new Set(JSON.parse(x.app("JSON.stringify(Object.keys(EN))")));
    const used = [...SOURCE.matchAll(/\btr\("((?:[^"\\]|\\.)*)"/g)].map((m) => JSON.parse(`"${m[1]}"`));
    assert.ok(used.length > 60);
    assert.deepEqual(used.filter((k) => !known.has(k)), []);
    const topics = JSON.parse(x.app("JSON.stringify(TOPICS.map((t) => [t.label, t.en]))"));
    assert.deepEqual(topics.filter(([, en]) => !en || CJK.test(en)), []);
  });
});
