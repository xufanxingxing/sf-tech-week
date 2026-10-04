// The name dialog, the add-event form, deleting an event, and pairing an admin browser.
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { boot, event, rsvp, comment, KEY, shown } from "./harness.mjs";

const titles = (x) => x.$$(".event h3").map((h) => h.textContent.replace(" ↗", ""));
const isOpen = (x, id) => x.$(id).hasAttribute("open");
const saveName = async (x, name) => { x.type(x.$("#nName"), name); await x.click(x.$("#nameForm button[type=submit]")); };
const inserted = (x) => x.calls.filter((c) => c.op === "insert").map((c) => c.row);
const error = (x) => (x.$("#eventErr").hidden ? null : x.$("#eventErr").textContent);
const FIELDS = { name: "#fName", link: "#fLink", date: "#fDate", start: "#fStart", end: "#fEnd", where: "#fWhere", why: "#fWhy", by: "#fBy" };
// Opens the form and fills it with a complete event; `over` changes or blanks single fields.
async function fill(x, over = {}) {
  if (!isOpen(x, "#eventDlg")) await x.click(x.$("#addBtn"));
  const v = { name: "Demo Day", link: "https://lu.ma/demo", date: "2026-10-07", start: "18:00", end: "", where: "SoMa", why: "都是熟人", by: "stella", ...over };
  for (const [k, id] of Object.entries(FIELDS)) x.type(x.$(id), v[k]);
}
const save = (x) => x.click(x.$("#eventSave"));
const dateRows = (x) => x.$$("#dates > .row").map((r) => x.$$("input", r).map((i) => i.value));

describe("my name", () => {
  test("“改名” opens the dialog with the current name, ready to edit", async (t) => {
    const x = await boot(t, { name: "stella" });
    await x.click(x.button(x.$("#me"), "改名"));
    assert.equal(isOpen(x, "#nameDlg"), true);
    assert.equal(x.$("#nName").value, "stella");
    assert.equal(x.document.activeElement, x.$("#nName"));
  });

  test("a new name is saved here and on everything I marked or wrote", async (t) => {
    const e = event({ name: "Mixer" });
    const x = await boot(t, { name: "stella", events: [e], rsvps: [rsvp(e.id, "Bo"), rsvp(e.id, "stella", "going", KEY)],
      comments: [comment(e.id, "stella", "hi", { person_key: KEY }), comment(e.id, "Bo", "yo")] });
    await x.click(x.button(x.$("#me"), "改名"));
    await saveName(x, "  Stella X  ");
    assert.equal(isOpen(x, "#nameDlg"), false);
    assert.deepEqual(x.rpcsSent("techweek_rename_me"), [{ p_key: KEY, p_name: "Stella X" }]);
    assert.equal(x.window.localStorage.getItem("tw.name"), "Stella X");
    assert.equal(x.$("#me").textContent, "你是 Stella X · 改名");
    assert.deepEqual(shown(x.$(".going", x.card("Mixer"))), ["Stella X 会去", "Bo 会去"]);
    assert.equal(x.$$(".chip.mine").length, 1);
    assert.deepEqual(x.db.techweek_comments.map((c) => c.name), ["Stella X", "Bo"]);
  });

  test("saving the same name again asks the database for nothing", async (t) => {
    const x = await boot(t, { name: "stella" });
    await x.click(x.button(x.$("#me"), "改名"));
    await saveName(x, "stella");
    assert.deepEqual(x.rpcsSent("techweek_rename_me"), []);
    assert.equal(isOpen(x, "#nameDlg"), false);
  });

  test("a blank name is not accepted", async (t) => {
    const x = await boot(t, { name: "stella" });
    await x.click(x.button(x.$("#me"), "改名"));
    await saveName(x, "   ");
    assert.equal(isOpen(x, "#nameDlg"), true);
    assert.equal(x.state.name, "stella");
    assert.deepEqual(x.rpcsSent("techweek_rename_me"), []);
    assert.equal(x.document.activeElement, x.$("#nName"));
  });

  test("cancel leaves the name as it was", async (t) => {
    const x = await boot(t, { name: "stella" });
    await x.click(x.button(x.$("#me"), "改名"));
    x.type(x.$("#nName"), "someone else");
    await x.click(x.$("#nameCancel"));
    assert.equal(isOpen(x, "#nameDlg"), false);
    assert.equal(x.$("#me").textContent, "你是 stella · 改名");
  });

  test("if the database cannot be told, it says so", async (t) => {
    const x = await boot(t, { name: "stella" });
    x.fail("techweek_rename_me");
    await x.click(x.button(x.$("#me"), "改名"));
    await saveName(x, "Stella X");
    assert.equal(x.toast(), "名字没改成功，请再试一次。");
  });

  test("the longest name the box allows is accepted by the database", async (t) => {
    const e = event({ name: "Mixer" });
    const x = await boot(t, { events: [e] });
    const longest = "名".repeat(Number(x.$("#nName").getAttribute("maxlength")));
    await x.click(x.button(x.card("Mixer"), "我会去"));
    await saveName(x, longest);
    assert.equal(x.toast(), null);
    assert.equal(x.db.techweek_rsvps[0].name, longest);
  });

  test("while the site is still being set up a name can be saved locally", async (t) => {
    const x = await boot(t, { config: null });
    await x.click(x.button(x.$("#me"), "填上你的名字"));
    await saveName(x, "stella");
    assert.equal(x.$("#me").textContent, "你是 stella · 改名");
    assert.deepEqual(x.calls, []);
  });
});

describe("the add-event form", () => {
  test("opens ready to type, with my name already in", async (t) => {
    const x = await boot(t, { name: "stella" });
    await x.click(x.$("#addBtn"));
    assert.equal(isOpen(x, "#eventDlg"), true);
    assert.equal(x.document.activeElement, x.$("#fName"));
    assert.equal(x.$("#fBy").value, "stella");
    assert.equal(error(x), null);
  });

  test("a complete form saves exactly what was typed, under my key, and the event appears as mine", async (t) => {
    const x = await boot(t, { name: "stella" });
    await fill(x, { name: "  Demo Day  ", end: "21:30", where: " SoMa ", why: " 都是熟人 " });
    await save(x);
    assert.deepEqual(inserted(x), [{ name: "Demo Day", link: "https://lu.ma/demo", date: "2026-10-07", start_time: "18:00", end_time: "21:30",
      extra_dates: [], location: "SoMa", why: "都是熟人", added_by: "stella", added_key: KEY }]);
    assert.equal(isOpen(x, "#eventDlg"), false);
    assert.equal(x.toast(), "已添加");
    assert.deepEqual(titles(x), ["Demo Day"]);
    assert.equal(x.$(".time").textContent, "18:00– 21:30");
    assert.equal(x.$(".del", x.card("Demo Day")).textContent, "删除");
    assert.equal(x.$(".badge"), null);
  });

  test("no end time is saved as none", async (t) => {
    const x = await boot(t, { name: "stella" });
    await fill(x);
    await save(x);
    assert.equal(inserted(x)[0].end_time, null);
    assert.equal(x.$(".time").textContent, "18:00");
  });

  test("a link typed without https:// gets it", async (t) => {
    const x = await boot(t, { name: "stella" });
    await fill(x, { link: "lu.ma/demo" });
    await save(x);
    assert.equal(inserted(x)[0].link, "https://lu.ma/demo");
  });

  test("each missing or wrong field is pointed out in turn, and nothing is saved", async (t) => {
    const x = await boot(t, { name: "stella" });
    const cases = [
      [{ name: "  " }, "请填活动名称。", "#fName"],
      [{ link: "" }, "报名链接不对，请粘贴完整的网址。", "#fLink"],
      [{ link: "not a link" }, "报名链接不对，请粘贴完整的网址。", "#fLink"],
      [{ link: "javascript:alert(1)" }, "报名链接不对，请粘贴完整的网址。", "#fLink"],
      [{ date: "" }, "请选日期。", "#fDate"],
      [{ start: "" }, "请填开始时间。", "#fStart"],
      [{ end: "17:00" }, "结束时间要晚于开始时间。", "#fEnd"],
      [{ end: "18:00" }, "结束时间要晚于开始时间。", "#fEnd"],
      [{ where: " " }, "请填地点。", "#fWhere"],
      [{ why: "" }, "请写一句为什么值得去。", "#fWhy"],
      [{ by: "" }, "请填你的名字。", "#fBy"],
    ];
    for (const [over, message, field] of cases) {
      await fill(x, over);
      await save(x);
      assert.equal(error(x), message, JSON.stringify(over));
      assert.equal(x.document.activeElement, x.$(field), JSON.stringify(over));
    }
    assert.deepEqual(inserted(x), []);
    assert.equal(isOpen(x, "#eventDlg"), true);
    await fill(x);
    await save(x);
    assert.equal(error(x), null);
    assert.equal(inserted(x).length, 1);
  });

  test("if saving fails the form stays open with everything still in it", async (t) => {
    const x = await boot(t, { name: "stella" });
    x.fail("techweek_events");
    await fill(x);
    await save(x);
    assert.equal(error(x), "没保存成功，请再试一次。");
    assert.equal(isOpen(x, "#eventDlg"), true);
    assert.equal(x.$("#fName").value, "Demo Day");
    assert.equal(x.$("#eventSave").disabled, false);
  });

  test("the save button is off while saving, so the event cannot be added twice", async (t) => {
    const x = await boot(t, { name: "stella" });
    await fill(x);
    const release = x.hold("techweek_events");
    await save(x);
    assert.equal(x.$("#eventSave").disabled, true);
    await save(x);
    release(); await x.flush();
    assert.equal(inserted(x).length, 1);
    assert.equal(x.$("#eventSave").disabled, false);
  });

  test("after saving, the form is empty for the next event but remembers who I am", async (t) => {
    const x = await boot(t, { name: "stella" });
    await fill(x, { end: "20:00" });
    await x.click(x.$("#addDate"));
    x.type(x.$$("#dates > .row")[1].querySelector("input"), "2026-10-08");
    await save(x);
    await x.click(x.$("#addBtn"));
    assert.deepEqual(["name", "link", "date", "start", "end", "where", "why"].map((k) => x.$(FIELDS[k]).value), ["", "", "", "", "", "", ""]);
    assert.equal(x.$("#fBy").value, "stella");
    assert.equal(dateRows(x).length, 1);
  });

  test("cancel closes the form without saving, and an old error is gone when it opens again", async (t) => {
    const x = await boot(t, { name: "stella" });
    await fill(x, { name: "" });
    await save(x);
    await x.click(x.$("#eventCancel"));
    assert.equal(isOpen(x, "#eventDlg"), false);
    await x.click(x.$("#addBtn"));
    assert.equal(error(x), null);
    assert.deepEqual(inserted(x), []);
  });

  test("a visitor without a name becomes the name typed in the form", async (t) => {
    const x = await boot(t);
    await fill(x, { by: "Alex" });
    await save(x);
    assert.equal(x.window.localStorage.getItem("tw.name"), "Alex");
    assert.equal(x.$("#me").textContent, "你是 Alex · 改名");
    assert.deepEqual(titles(x), ["Demo Day"]);
  });

  test("a visitor with a name keeps it even when another is typed in the form", async (t) => {
    const x = await boot(t, { name: "stella" });
    await fill(x, { by: "Team Stoody" });
    await save(x);
    assert.equal(x.state.name, "stella");
    assert.equal(x.$(".by").textContent, "Team Stoody 推荐");
  });

  test("the longest text each box allows is accepted by the database", async (t) => {
    const x = await boot(t, { name: "stella" });
    const max = (id) => Number(x.$(id).getAttribute("maxlength"));
    await fill(x, { name: "名".repeat(max("#fName")), where: "地".repeat(max("#fWhere")), why: "因".repeat(max("#fWhy")), by: "我".repeat(max("#fBy")),
      link: "https://lu.ma/" + "a".repeat(max("#fLink") - 14) });
    await save(x);
    assert.equal(error(x), null);
    assert.equal(x.$$(".event").length, 1);
  });
});

describe("an event on several days", () => {
  test("“添加日期” adds a row that starts from the first row's hours", async (t) => {
    const x = await boot(t, { name: "stella" });
    await fill(x, { start: "11:00", end: "17:00" });
    await x.click(x.$("#addDate"));
    assert.deepEqual(dateRows(x), [["2026-10-07", "11:00", "17:00"], ["", "11:00", "17:00"]]);
    assert.equal(x.document.activeElement, x.$$("#dates > .row")[1].querySelector("input"));
  });

  test("days are saved in date order whatever order they were typed in", async (t) => {
    const x = await boot(t, { name: "stella" });
    await fill(x, { date: "2026-10-08", start: "11:00", end: "17:00" });
    await x.click(x.$("#addDate")); await x.click(x.$("#addDate"));
    const [, second, third] = x.$$("#dates > .row").map((r) => x.$$("input", r));
    x.type(second[0], "2026-10-06"); x.type(second[1], "12:00"); x.type(second[2], "");
    x.type(third[0], "2026-10-07");
    await save(x);
    const row = inserted(x)[0];
    assert.deepEqual([row.date, row.start_time, row.end_time], ["2026-10-06", "12:00", null]);
    assert.deepEqual(row.extra_dates, [{ date: "2026-10-07", start: "11:00", end: "17:00" }, { date: "2026-10-08", start: "11:00", end: "17:00" }]);
    assert.deepEqual(x.$$(".time").map((el) => el.textContent), ["12:00· 第 1/3 天", "11:00– 17:00· 第 2/3 天", "11:00– 17:00· 第 3/3 天"]);
  });

  test("an added row is checked like the first: its date, its hours, and no day twice", async (t) => {
    const x = await boot(t, { name: "stella" });
    await fill(x, { start: "11:00", end: "17:00" });
    await x.click(x.$("#addDate"));
    const [d, st, en] = x.$$("input", x.$$("#dates > .row")[1]);
    await save(x); assert.equal(error(x), "请选日期。"); assert.equal(x.document.activeElement, d);
    x.type(d, "2026-10-07");
    await save(x); assert.equal(error(x), "这个日期已经填过了。"); assert.equal(x.document.activeElement, d);
    x.type(d, "2026-10-08"); x.type(st, "");
    await save(x); assert.equal(error(x), "请填开始时间。"); assert.equal(x.document.activeElement, st);
    x.type(st, "18:00");
    await save(x); assert.equal(error(x), "结束时间要晚于开始时间。"); assert.equal(x.document.activeElement, en);
    assert.deepEqual(inserted(x), []);
  });

  test("“移除” takes a row away", async (t) => {
    const x = await boot(t, { name: "stella" });
    await fill(x);
    await x.click(x.$("#addDate")); await x.click(x.$("#addDate"));
    x.type(x.$$("#dates > .row")[2].querySelector("input"), "2026-10-09");
    await x.click(x.button(x.$$("#dates > .row")[1], "移除"));
    assert.deepEqual(dateRows(x).map((r) => r[0]), ["2026-10-07", "2026-10-09"]);
    await save(x);
    assert.deepEqual(inserted(x)[0].extra_dates.map((s) => s.date), ["2026-10-09"]);
  });

  test("seven days is the most, which is also the most the database takes", async (t) => {
    const x = await boot(t, { name: "stella" });
    await fill(x, { date: "2026-10-05" });
    for (let i = 0; i < 6; i++) await x.click(x.$("#addDate"));
    assert.equal(x.toast(), null);
    await x.click(x.$("#addDate"));
    assert.equal(x.toast(), "最多 7 个日期。");
    assert.equal(dateRows(x).length, 7);
    x.$$("#dates > .row").slice(1).forEach((r, i) => x.type(r.querySelector("input"), `2026-10-${String(6 + i).padStart(2, "0")}`));
    await save(x);
    assert.equal(error(x), null);
    assert.equal(x.$$(".event").length, 7);
  });
});

describe("deleting an event", () => {
  async function two(t, more = {}) {
    const mine = event({ name: "Mine", added_key: KEY }), theirs = event({ name: "Theirs", added_key: "key-of-someone-else-00" });
    return boot(t, { name: "stella", events: [mine, theirs], rsvps: [rsvp(mine.id, "Bo")], comments: [comment(mine.id, "Bo", "hi")], ...more });
  }
  const del = (x, title) => x.$(".del", x.card(title));

  test("only events this browser added can be deleted", async (t) => {
    const x = await two(t);
    assert.equal(del(x, "Mine").textContent, "删除");
    assert.equal(del(x, "Theirs"), null);
  });

  test("the first press only asks to press again", async (t) => {
    const x = await two(t);
    await x.click(del(x, "Mine"));
    assert.equal(del(x, "Mine").textContent, "确定删除？再点一次");
    assert.ok(del(x, "Mine").classList.contains("sure"));
    assert.deepEqual(x.rpcsSent("techweek_delete_event"), []);
    assert.deepEqual(titles(x), ["Mine", "Theirs"]);
  });

  test("the question goes away by itself after four seconds", async (t) => {
    const x = await two(t);
    await x.click(del(x, "Mine"));
    await x.tick(3999);
    assert.equal(del(x, "Mine").textContent, "确定删除？再点一次");
    await x.tick(1);
    assert.equal(del(x, "Mine").textContent, "删除");
    await x.click(del(x, "Mine"));
    assert.deepEqual(x.rpcsSent("techweek_delete_event"), []);
  });

  test("the question survives the list refreshing in the background", async (t) => {
    const x = await two(t);
    await x.tick(19000);
    await x.click(del(x, "Mine"));
    await x.tick(1000);
    assert.equal(del(x, "Mine").textContent, "确定删除？再点一次");
  });

  test("the second press deletes the event with its marks and comments", async (t) => {
    const x = await two(t);
    const id = x.state.events.find((e) => e.name === "Mine").id;
    await x.click(del(x, "Mine"));
    await x.click(del(x, "Mine"));
    assert.deepEqual(x.rpcsSent("techweek_delete_event"), [{ p_event: id, p_key: KEY }]);
    assert.equal(x.toast(), "已删除");
    assert.deepEqual(titles(x), ["Theirs"]);
    assert.equal(x.$("#stats").textContent, "1 个活动 · 0 人已标记");
  });

  test("if the request fails, or the database refuses, it says so and the event stays", async (t) => {
    const x = await two(t);
    x.fail("techweek_delete_event");
    await x.click(del(x, "Mine")); await x.click(del(x, "Mine"));
    assert.equal(x.toast(), "没删掉，请再试一次。");
    assert.deepEqual(titles(x), ["Mine", "Theirs"]);
    x.heal();
    x.db.techweek_events[0].added_key = "key-of-someone-else-00";
    await x.click(del(x, "Mine")); await x.click(del(x, "Mine"));
    assert.equal(x.toast(), "没删掉，请再试一次。");
    assert.equal(del(x, "Mine"), null);
  });

  test("an admin browser can delete any event", async (t) => {
    const x = await two(t, { admins: [KEY] });
    await x.click(del(x, "Theirs")); await x.click(del(x, "Theirs"));
    assert.equal(x.toast(), "已删除");
    assert.deepEqual(titles(x), ["Mine"]);
  });

  test("asking about one event and then another deletes neither", async (t) => {
    const x = await two(t, { admins: [KEY] });
    await x.click(del(x, "Mine"));
    await x.click(del(x, "Theirs"));
    assert.deepEqual([del(x, "Mine").textContent, del(x, "Theirs").textContent], ["删除", "确定删除？再点一次"]);
    assert.deepEqual(x.rpcsSent("techweek_delete_event"), []);
  });
});

describe("pairing an admin browser at #admin", () => {
  const notice = (x) => (x.$("#notice").hidden ? null : x.$("#notice").textContent);
  const requests = (x) => x.rpcsSent("techweek_request_admin");

  test("the ordinary address asks nothing about admins and shows no notice", async (t) => {
    const x = await boot(t, { name: "stella" });
    assert.equal(notice(x), null);
    assert.deepEqual([x.rpcsSent("techweek_is_admin"), requests(x)], [[], []]);
  });

  test("a browser that is not an admin sends a six-digit code and shows it", async (t) => {
    const x = await boot(t, { name: "stella", hash: "#admin" });
    assert.equal(requests(x).length, 1);
    const { p_key, p_code, p_name } = requests(x)[0];
    assert.deepEqual([p_key, p_name], [KEY, "stella"]);
    assert.match(p_code, /^\d{6}$/);
    assert.equal(notice(x), `管理员配对码：${p_code}。把这 6 位数字发给管理网站的人，批准后刷新这个页面。`);
    assert.equal(x.db.techweek_admin_requests[0].code, p_code);
    assert.match(x.window.localStorage.getItem("tw.adminCode"), new RegExp(`^${p_code}:\\d+$`));
  });

  test("a browser with no name yet can still ask", async (t) => {
    const x = await boot(t, { hash: "#admin" });
    assert.equal(requests(x)[0].p_name, "");
    assert.match(notice(x), /管理员配对码：\d{6}。/);
  });

  test("coming back within twenty minutes shows the same code without asking again", async (t) => {
    const x = await boot(t, { hash: "#admin", setup: (w) => w.localStorage.setItem("tw.adminCode", `012345:${Date.now() - 19 * 60 * 1000}`) });
    assert.deepEqual(requests(x), []);
    assert.match(notice(x), /管理员配对码：012345。/);
  });

  test("an older code is replaced by a new request", async (t) => {
    const x = await boot(t, { hash: "#admin", setup: (w) => w.localStorage.setItem("tw.adminCode", `012345:${Date.now() - 21 * 60 * 1000}`) });
    assert.equal(requests(x).length, 1);
    assert.match(x.window.localStorage.getItem("tw.adminCode"), new RegExp(`^${requests(x)[0].p_code}:`));
  });

  test("an approved browser is told so, asks for nothing more, and forgets its code", async (t) => {
    const x = await boot(t, { hash: "#admin", admins: [KEY], setup: (w) => w.localStorage.setItem("tw.adminCode", `012345:${Date.now()}`) });
    assert.match(notice(x), /^这台浏览器是管理员/);
    assert.deepEqual(requests(x), []);
    assert.equal(x.window.localStorage.getItem("tw.adminCode"), "");
  });

  test("if the admin check or the request fails, it says to refresh and shows no code", async (t) => {
    const a = await boot(t, { hash: "#admin", failing: ["techweek_is_admin"] });
    assert.equal(notice(a), "现在查不到管理员状态，请刷新再试。");
    assert.deepEqual(requests(a), []);
    const b = await boot(t, { hash: "#admin", failing: ["techweek_request_admin"] });
    assert.equal(notice(b), "管理员申请没发出去，请刷新再试。");
    assert.equal(b.window.localStorage.getItem("tw.adminCode"), null);
  });
});
