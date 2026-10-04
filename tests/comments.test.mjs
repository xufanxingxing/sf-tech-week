// The comments panel: reading, writing, deleting, and never losing what is being typed.
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { boot, event, comment, KEY } from "./harness.mjs";

const cbtn = (x, title) => x.$(".cbtn", x.card(title));
const open = (x, title) => x.click(cbtn(x, title));
const drawer = (x) => ({
  open: !x.$("#drawer").hidden,
  title: x.$("#dTitle").textContent,
  event: x.$("#dEvent").textContent,
  who: x.$("#dName").textContent,
  // [name, time, text, can I delete it]
  comments: x.$$("#dList .comment").map((c) => [x.$("strong", c).textContent, x.$(".ctime", c).textContent, x.$("p", c).textContent, !!x.$(".cdel", c)]),
});
const sent = (x) => x.rpcsSent("techweek_add_comment");
// One event with two comments: an older one from Bo, a newer one from this browser ("stella").
function talk(more = {}) {
  const e = event({ name: "Mixer" });
  return { name: "stella", events: [e], comments: [
    comment(e.id, "Bo", "有人一起去吗？", { created_at: "2026-10-03T18:20:00Z" }),
    comment(e.id, "stella", "我 6 点到", { created_at: "2026-10-04T02:05:00Z", person_key: KEY })], ...more };
}

describe("the comments button on a card", () => {
  test("is plain when there are no comments", async (t) => {
    const x = await boot(t, { events: [event({ name: "Quiet" })] });
    const b = cbtn(x, "Quiet");
    assert.deepEqual([b.textContent, b.getAttribute("aria-label"), b.classList.contains("has"), b.getAttribute("aria-expanded")], ["留言", "留言", false, "false"]);
  });

  test("shows the count when there are some", async (t) => {
    const x = await boot(t, talk());
    const b = cbtn(x, "Mixer");
    assert.deepEqual([b.textContent, b.getAttribute("aria-label"), b.classList.contains("has")], ["留言 2", "留言，2 条", true]);
  });
});

describe("reading comments", () => {
  test("the panel opens on that event, newest comment first, ready to type", async (t) => {
    const x = await boot(t, talk());
    await open(x, "Mixer");
    assert.deepEqual(drawer(x), { open: true, title: "留言 (2)", event: "Mixer", who: "stella", comments: [
      ["stella", "10/3 19:05", "我 6 点到", true],
      ["Bo", "10/3 11:20", "有人一起去吗？", false]] });
    assert.equal(x.document.activeElement, x.$("#dInput"));
    assert.equal(cbtn(x, "Mixer").getAttribute("aria-expanded"), "true");
    assert.equal(x.document.body.classList.contains("drawer-open"), true);
  });

  test("an event without comments says so, and a browser without a name is told", async (t) => {
    const x = await boot(t, { events: [event({ name: "Quiet" })] });
    await open(x, "Quiet");
    assert.equal(drawer(x).title, "留言 (0)");
    assert.equal(x.$("#dList").textContent, "还没有留言，写下第一条。");
    assert.equal(drawer(x).who, "还没填名字");
  });

  test("a comment is shown as text with its line breaks, never run as HTML", async (t) => {
    const e = event({ name: "Mixer" }), body = "第一行\n<img src=x onerror=alert(1)>";
    const x = await boot(t, { events: [e], comments: [comment(e.id, "<b>Bo</b>", body)] });
    await open(x, "Mixer");
    assert.deepEqual(drawer(x).comments[0].slice(0, 3), ["<b>Bo</b>", "10/3 11:20", body]);
    assert.equal(x.$$("#dList img, #dList b").length, 0);
  });

  test("closes from ×, from the card's button, and with Escape, but not while a dialog is open", async (t) => {
    const x = await boot(t, talk());
    const closed = () => x.$("#drawer").hidden && !x.document.body.classList.contains("drawer-open") && cbtn(x, "Mixer").getAttribute("aria-expanded") === "false";
    await open(x, "Mixer"); await x.click(x.$("#dClose")); assert.equal(closed(), true);
    await open(x, "Mixer"); await open(x, "Mixer"); assert.equal(closed(), true);
    await open(x, "Mixer"); x.press(x.$("#dInput"), "Escape"); assert.equal(closed(), true);
    await open(x, "Mixer");
    await x.click(x.button(x.$("#me"), "改名"));
    x.press(x.document, "Escape");
    assert.equal(closed(), false);
  });

  test("new comments from other people appear at the next refresh while the panel is open", async (t) => {
    const x = await boot(t, talk());
    await open(x, "Mixer");
    x.db.techweek_comments.push({ id: 900, ...comment(x.state.drawer, "Cy", "+1") });
    await x.tick(20000);
    assert.equal(drawer(x).title, "留言 (3)");
    assert.equal(drawer(x).comments[0][0], "Cy");
    assert.equal(cbtn(x, "Mixer").textContent, "留言 3");
  });

  test("the panel closes if its event is deleted", async (t) => {
    const x = await boot(t, talk());
    await open(x, "Mixer");
    x.db.techweek_events.length = 0;
    await x.tick(20000);
    assert.equal(drawer(x).open, false);
    assert.equal(x.state.drawer, null);
    assert.equal(x.document.body.classList.contains("drawer-open"), false);
  });
});

describe("writing a comment", () => {
  test("发送 posts the trimmed text under my name and key, then shows it on top", async (t) => {
    const x = await boot(t, talk());
    await open(x, "Mixer");
    x.type(x.$("#dInput"), "  带上名片  ");
    await x.click(x.$("#dSend"));
    assert.deepEqual(sent(x), [{ p_event: x.state.drawer, p_key: KEY, p_name: "stella", p_body: "带上名片" }]);
    assert.equal(x.$("#dInput").value, "");
    assert.equal(drawer(x).title, "留言 (3)");
    assert.deepEqual([drawer(x).comments[0][0], drawer(x).comments[0][2], drawer(x).comments[0][3]], ["stella", "带上名片", true]);
    assert.equal(cbtn(x, "Mixer").textContent, "留言 3");
    assert.equal(x.document.activeElement, x.$("#dInput"));
  });

  test("an empty or blank comment is not sent", async (t) => {
    const x = await boot(t, talk());
    await open(x, "Mixer");
    await x.click(x.$("#dSend"));
    x.type(x.$("#dInput"), "   \n ");
    await x.click(x.$("#dSend"));
    assert.deepEqual(sent(x), []);
    assert.equal(x.toast(), null);
  });

  test("Enter sends; Shift+Enter and Enter while composing Chinese do not", async (t) => {
    const x = await boot(t, talk());
    await open(x, "Mixer");
    x.type(x.$("#dInput"), "你好");
    assert.equal(x.press(x.$("#dInput"), "Enter", { shiftKey: true }).defaultPrevented, false);
    assert.equal(x.press(x.$("#dInput"), "Enter", { isComposing: true }).defaultPrevented, false);
    x.press(x.$("#dInput"), "a");
    await x.flush();
    assert.deepEqual(sent(x), []);
    assert.equal(x.press(x.$("#dInput"), "Enter").defaultPrevented, true);
    await x.flush();
    assert.equal(sent(x).length, 1);
  });

  test("pressing Enter twice in a hurry sends the comment once", async (t) => {
    const x = await boot(t, talk());
    await open(x, "Mixer");
    x.type(x.$("#dInput"), "只发一次");
    const release = x.hold("techweek_add_comment");
    x.press(x.$("#dInput"), "Enter");
    await x.flush();
    assert.equal(x.$("#dSend").disabled, true);
    x.press(x.$("#dInput"), "Enter");
    release(); await x.flush();
    assert.equal(sent(x).length, 1);
    assert.equal(x.db.techweek_comments.filter((c) => c.body === "只发一次").length, 1);
    assert.equal(x.$("#dSend").disabled, false);
  });

  test("without a name it asks first, then sends once the name is saved", async (t) => {
    const e = event({ name: "Mixer" });
    const x = await boot(t, { events: [e] });
    await open(x, "Mixer");
    x.type(x.$("#dInput"), "第一条");
    await x.click(x.$("#dSend"));
    assert.equal(x.$("#nameDlg").hasAttribute("open"), true);
    assert.deepEqual(sent(x), []);
    x.type(x.$("#nName"), "stella");
    await x.click(x.$("#nameForm button[type=submit]"));
    assert.deepEqual(sent(x), [{ p_event: e.id, p_key: KEY, p_name: "stella", p_body: "第一条" }]);
    assert.equal(drawer(x).who, "stella");
    assert.equal(drawer(x).comments.length, 1);
  });

  test("if sending fails it says so and keeps the text for another try", async (t) => {
    const x = await boot(t, talk());
    await open(x, "Mixer");
    x.type(x.$("#dInput"), "别丢");
    x.fail("techweek_add_comment");
    await x.click(x.$("#dSend"));
    assert.equal(x.toast(), "留言没发出去，请再试一次。");
    assert.equal(x.$("#dInput").value, "别丢");
    assert.equal(x.$("#dSend").disabled, false);
    x.heal();
    await x.click(x.$("#dSend"));
    assert.equal(drawer(x).comments[0][2], "别丢");
  });

  test("the longest comment the box allows is accepted by the database", async (t) => {
    const x = await boot(t, talk());
    await open(x, "Mixer");
    x.type(x.$("#dInput"), "长".repeat(Number(x.$("#dInput").getAttribute("maxlength"))));
    await x.click(x.$("#dSend"));
    assert.equal(x.toast(), null);
    assert.equal(drawer(x).title, "留言 (3)");
  });
});

describe("what is being typed is not lost", () => {
  async function two(t) {
    const a = event({ name: "Alpha" }), b = event({ name: "Beta" });
    return boot(t, { name: "stella", events: [a, b] });
  }

  test("each event keeps its own unsent text when moving between them or closing the panel", async (t) => {
    const x = await two(t);
    await open(x, "Alpha"); x.type(x.$("#dInput"), "给 Alpha 的");
    await open(x, "Beta");
    assert.equal(x.$("#dInput").value, "");
    x.type(x.$("#dInput"), "给 Beta 的");
    await x.click(x.$("#dClose"));
    await open(x, "Alpha"); assert.equal(x.$("#dInput").value, "给 Alpha 的");
    await open(x, "Beta"); assert.equal(x.$("#dInput").value, "给 Beta 的");
  });

  test("a refresh in the background leaves the box alone", async (t) => {
    const x = await two(t);
    await open(x, "Alpha");
    const box = x.$("#dInput");
    x.type(box, "写到一半");
    await x.tick(40000);
    assert.equal(x.$("#dInput"), box);
    assert.equal(box.value, "写到一半");
  });

  test("once sent, the text does not come back", async (t) => {
    const x = await two(t);
    await open(x, "Alpha"); x.type(x.$("#dInput"), "发出去了");
    await x.click(x.$("#dSend"));
    await open(x, "Beta"); await open(x, "Alpha");
    assert.equal(x.$("#dInput").value, "");
  });

  test("a comment still on its way does not wipe what I started typing on another event", async (t) => {
    const x = await two(t);
    await open(x, "Alpha"); x.type(x.$("#dInput"), "给 Alpha 的");
    const release = x.hold("techweek_add_comment");
    await x.click(x.$("#dSend"));
    await open(x, "Beta"); x.type(x.$("#dInput"), "给 Beta 的");
    release(); await x.flush();
    assert.equal(x.$("#dInput").value, "给 Beta 的");
    await open(x, "Alpha");
    assert.equal(x.$("#dInput").value, "");
    assert.equal(drawer(x).comments[0][2], "给 Alpha 的");
  });
});

describe("deleting a comment", () => {
  test("only my own comments can be deleted, and deleting removes it everywhere", async (t) => {
    const x = await boot(t, talk());
    await open(x, "Mixer");
    const mine = x.db.techweek_comments.find((c) => c.person_key === KEY).id;
    await x.click(x.$(".cdel"));
    assert.deepEqual(x.rpcsSent("techweek_delete_comment"), [{ p_id: mine, p_key: KEY }]);
    assert.deepEqual(drawer(x).comments, [["Bo", "10/3 11:20", "有人一起去吗？", false]]);
    assert.equal(cbtn(x, "Mixer").textContent, "留言 1");
    assert.equal(x.toast(), null);
  });

  test("if the request fails it says so and the comment stays", async (t) => {
    const x = await boot(t, talk());
    await open(x, "Mixer");
    x.fail("techweek_delete_comment");
    await x.click(x.$(".cdel"));
    assert.equal(x.toast(), "没删掉，请再试一次。");
    assert.equal(drawer(x).comments.length, 2);
  });

  test("if the database refuses, it says so", async (t) => {
    const x = await boot(t, talk());
    await open(x, "Mixer");
    x.db.techweek_comments.find((c) => c.person_key === KEY).person_key = "key-of-someone-else-00";
    await x.click(x.$(".cdel"));
    assert.equal(x.toast(), "没删掉，请再试一次。");
    assert.deepEqual(drawer(x).comments.map((c) => c[3]), [false, false]);
  });

  test("an admin browser can delete anyone's comment", async (t) => {
    const x = await boot(t, talk({ admins: [KEY] }));
    await open(x, "Mixer");
    assert.deepEqual(drawer(x).comments.map((c) => c[3]), [true, true]);
    await x.click(x.$$(".cdel")[1]);
    assert.deepEqual(drawer(x).comments.map((c) => c[0]), ["stella"]);
  });
});
