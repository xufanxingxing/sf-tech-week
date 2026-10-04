// Who's going: the row of names on each card, its two-line limit, and the panel listing everyone.
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { boot, event, rsvp, crowd, comment, KEY, visible, shown, lines } from "./harness.mjs";

const row = (x, title, nth) => x.$(".going", x.card(title, nth));
const more = (x, title) => x.$(".more", x.card(title));
const panel = (x) => ({
  open: !x.$("#people").hidden,
  title: x.$("#pTitle").textContent,
  event: x.$("#pEvent").textContent,
  groups: x.$$("#pList section").map((s) => [x.$("h3", s).textContent, x.$$(".chip", s).map((c) => c.textContent)]),
});
// 33 people on one event; this browser is "stella", who signed up last and is going.
function kickoff() {
  const e = event({ name: "Kickoff" });
  return { name: "stella", events: [e], rsvps: [...crowd(e.id, { going: 17, pending: 6, interested: 9 }), rsvp(e.id, "stella", "going", KEY)] };
}

describe("the row of names on a card", () => {
  test("a card nobody has marked has no row", async (t) => {
    const x = await boot(t, { events: [event({ name: "Quiet" })] });
    assert.equal(row(x, "Quiet"), null);
  });

  test("each name carries its status", async (t) => {
    const e = event({ name: "Mixer" });
    const x = await boot(t, { events: [e], rsvps: [rsvp(e.id, "Ann", "interested"), rsvp(e.id, "Bo", "pending"), rsvp(e.id, "Cy", "going")] });
    assert.deepEqual(shown(row(x, "Mixer")), ["Cy 会去", "Bo 等待通过", "Ann 感兴趣"]);
  });

  test("people are listed going first, then pending, then interested, in sign-up order within each", async (t) => {
    const e = event({ name: "Mixer" });
    const x = await boot(t, { events: [e], rsvps: [rsvp(e.id, "i1", "interested"), rsvp(e.id, "g1", "going"), rsvp(e.id, "p1", "pending"),
      rsvp(e.id, "g2", "going"), rsvp(e.id, "i2", "interested")] });
    assert.deepEqual(shown(row(x, "Mixer")), ["g1 会去", "g2 会去", "p1 等待通过", "i1 感兴趣", "i2 感兴趣"]);
  });

  test("one person: one name and no button, as on the live site today", async (t) => {
    const e = event({ name: "Solo" });
    const x = await boot(t, { name: "stella", events: [e], rsvps: [rsvp(e.id, "stella", "going", KEY)] });
    assert.deepEqual(shown(row(x, "Solo")), ["stella 会去"]);
    assert.equal(more(x, "Solo").hidden, true);
  });

  test("five people all show, with no button", async (t) => {
    const e = event({ name: "Five" });
    const x = await boot(t, { events: [e], rsvps: crowd(e.id, { going: 5 }) });
    assert.deepEqual(shown(row(x, "Five")), ["p1 会去", "p2 会去", "p3 会去", "p4 会去", "p5 会去"]);
  });

  test("six people: five names and a button for all six", async (t) => {
    const e = event({ name: "Six" });
    const x = await boot(t, { events: [e], rsvps: crowd(e.id, { going: 3, pending: 1, interested: 2 }) });
    assert.deepEqual(shown(row(x, "Six")), ["p1 会去", "p2 会去", "p3 会去", "p4 等待通过", "p5 感兴趣", "全部 6 人"]);
  });

  test("33 people: five names and a button, and only five names are put on the page", async (t) => {
    const x = await boot(t, kickoff());
    assert.deepEqual(shown(row(x, "Kickoff")), ["stella 会去", "p1 会去", "p2 会去", "p3 会去", "p4 会去", "全部 33 人"]);
    assert.equal(x.$$(".chip:not(.more)", row(x, "Kickoff")).length, 5);
  });

  test("the button is a real button that says whether its panel is open", async (t) => {
    const x = await boot(t, kickoff());
    const b = more(x, "Kickoff");
    assert.equal(b.tagName, "BUTTON");
    assert.equal(b.type, "button");
    assert.equal(b.getAttribute("aria-expanded"), "false");
  });

  test("an event on several days shows the same row on each day's card", async (t) => {
    const e = event({ name: "House", extra_dates: [{ date: "2026-10-06", start: "11:00", end: "17:00" }] });
    const x = await boot(t, { events: [e], rsvps: crowd(e.id, { going: 7 }) });
    assert.deepEqual(shown(row(x, "House", 0)), shown(row(x, "House", 1)));
    assert.equal(shown(row(x, "House", 1)).at(-1), "全部 7 人");
  });

  test("a name is shown as text, never run as HTML", async (t) => {
    const e = event({ name: "Mixer" }), evil = "<img src=x onerror=alert(1)>";
    const x = await boot(t, { events: [e], rsvps: [rsvp(e.id, evil, "going", "key-of-someone-000000")] });
    assert.equal(x.$(".nm", row(x, "Mixer")).textContent, evil);
    assert.equal(x.$$("img", x.card("Mixer")).length, 0);
  });

  test("a name keeps its full text as a tooltip, for when it is cut short", async (t) => {
    const e = event({ name: "Mixer" }), long = "Christopher Montgomery-Zhang";
    const x = await boot(t, { events: [e], rsvps: [rsvp(e.id, long, "going", "key-of-someone-000000")] });
    assert.equal(visible(row(x, "Mixer"))[0].title, long);
  });

  test("a row with a status the page does not know is left out, and the count matches what is listed", async (t) => {
    const e = event({ name: "Mixer" });
    const x = await boot(t, { events: [e], rsvps: [...crowd(e.id, { going: 5 }), rsvp(e.id, "odd", "maybe"), rsvp(e.id, "late", "interested")] });
    assert.equal(shown(row(x, "Mixer")).at(-1), "全部 6 人");
  });
});

describe("this browser's own mark", () => {
  test("comes first and is highlighted, whatever its status and however late it signed up", async (t) => {
    const e = event({ name: "House" });
    const x = await boot(t, { name: "stella", events: [e], rsvps: [...crowd(e.id, { going: 10, pending: 4, interested: 4 }), rsvp(e.id, "stella", "interested", KEY)] });
    const first = visible(row(x, "House"))[0];
    assert.deepEqual(shown(row(x, "House")).slice(0, 2), ["stella 感兴趣", "p1 会去"]);
    assert.ok(first.classList.contains("mine"));
    assert.equal(x.$$(".chip.mine", row(x, "House")).length, 1);
  });

  test("nobody is highlighted on an event this browser has not marked", async (t) => {
    const e = event({ name: "Mixer" });
    const x = await boot(t, { name: "stella", events: [e], rsvps: [rsvp(e.id, "stella", "going", "key-of-another-stella")] });
    assert.equal(x.$$(".chip.mine").length, 0);
    assert.deepEqual(shown(row(x, "Mixer")), ["stella 会去"]);
  });

  test("two people with the same name both show, and only one is highlighted", async (t) => {
    const e = event({ name: "Mixer" });
    const x = await boot(t, { name: "stella", events: [e], rsvps: [rsvp(e.id, "stella", "going", "key-of-another-stella"), rsvp(e.id, "Bo", "going"), rsvp(e.id, "stella", "going", KEY)] });
    assert.deepEqual(shown(row(x, "Mixer")), ["stella 会去", "Bo 会去", "stella 会去"]);
    assert.equal(x.$$(".chip.mine", row(x, "Mixer")).length, 1);
  });

  test("a namesake with a different status is not mistaken for this browser", async (t) => {
    const e = event({ name: "Mixer" });
    const x = await boot(t, { name: "stella", events: [e], rsvps: [rsvp(e.id, "stella", "going", "key-of-another-stella"), rsvp(e.id, "stella", "interested", KEY)] });
    assert.deepEqual(shown(row(x, "Mixer")), ["stella 感兴趣", "stella 会去"]);
    assert.deepEqual(x.$$(".chip", row(x, "Mixer")).map((c) => c.classList.contains("mine")), [true, false, false]);
  });

  test("with no name saved in this browser, nobody is highlighted and nothing breaks", async (t) => {
    const e = event({ name: "Mixer" });
    const x = await boot(t, { events: [e], rsvps: [rsvp(e.id, "stella", "going", KEY), rsvp(e.id, "Bo", "going")] });
    assert.deepEqual(shown(row(x, "Mixer")), ["stella 会去", "Bo 会去"]);
    assert.equal(x.$$(".chip.mine").length, 0);
  });

  test("marking an event puts this browser first in its row", async (t) => {
    const e = event({ name: "Six" });
    const x = await boot(t, { name: "stella", events: [e], rsvps: crowd(e.id, { going: 6 }) });
    await x.click(x.button(x.card("Six"), "等待通过"));
    assert.deepEqual(shown(row(x, "Six")), ["stella 等待通过", "p1 会去", "p2 会去", "p3 会去", "p4 会去", "全部 7 人"]);
    await x.click(x.button(x.card("Six"), "等待通过"));
    assert.deepEqual(shown(row(x, "Six")), ["p1 会去", "p2 会去", "p3 会去", "p4 会去", "p5 会去", "全部 6 人"]);
  });
});

describe("the two-line limit", () => {
  test("a wide card keeps all five names on one line", async (t) => {
    const x = await boot(t, { ...kickoff(), width: 2000 });
    assert.equal(lines(row(x, "Kickoff")), 1);
    assert.equal(visible(row(x, "Kickoff")).length, 6);
  });

  test("a narrow card drops names from the end until the row, button included, fits two lines", async (t) => {
    const x = await boot(t, { ...kickoff(), width: 260 });
    const r = row(x, "Kickoff");
    assert.equal(lines(r), 2);
    assert.deepEqual(shown(r), ["stella 会去", "p1 会去", "p2 会去", "p3 会去", "全部 33 人"]);
  });

  test("five people who do not fit get the button too, counting all five", async (t) => {
    const e = event({ name: "Five" });
    const x = await boot(t, { events: [e], rsvps: crowd(e.id, { going: 5 }), width: 150 });
    assert.deepEqual(shown(row(x, "Five")), ["p1 会去", "p2 会去", "全部 5 人"]);
    assert.equal(lines(row(x, "Five")), 2);
  });

  test("however narrow, one name and the button remain", async (t) => {
    const x = await boot(t, { ...kickoff(), width: 10 });
    assert.deepEqual(shown(row(x, "Kickoff")), ["stella 会去", "全部 33 人"]);
  });

  test("three short names that fit are left alone", async (t) => {
    const e = event({ name: "Three" });
    const x = await boot(t, { events: [e], rsvps: crowd(e.id, { going: 1, pending: 1, interested: 1 }), width: 200 });
    assert.equal(visible(row(x, "Three")).length, 3);
  });

  test("at every width and crowd size: at most two lines, never more names hidden than needed", async (t) => {
    const sizes = [1, 2, 3, 4, 5, 6, 7, 12, 33, 60], names = ["李", "Bo", "Mia Chen", "来自湾区的一个很长很长的群昵称", "Christopher Montgomery-Zhang"];
    const events = sizes.map((n) => event({ name: `Crowd of ${n} ` }));
    const rsvps = events.flatMap((e, i) => {
      const all = Array.from({ length: sizes[i] }, (_, k) => rsvp(e.id, `${names[(k * 7 + i) % names.length]}${k}`, ["going", "pending", "interested"][(k + i) % 3]));
      if (i % 2) all[all.length - 1] = rsvp(e.id, "stella", "pending", KEY); // on every other event, the last to sign up is this browser
      return all;
    });
    const x = await boot(t, { name: "stella", events, rsvps });
    let width = 1024;
    for (const room of [30, 90, 140, 200, 254, 309, 420, 614, 1000, Infinity]) {
      x.layout.width = room;
      x.resize(++width);
      events.forEach((e, i) => {
        const r = row(x, e.name), all = [...r.children], button = all.at(-1), names = all.slice(0, -1);
        const up = names.filter((c) => !c.hidden).length, where = `${sizes[i]} people in ${room}px`;
        assert.ok(lines(r) <= 2, `${where}: ${lines(r)} lines`);
        assert.ok(up >= 1 && up <= 5, `${where}: ${up} names`);
        assert.deepEqual(names.map((c) => c.hidden), names.map((_, k) => k >= up), `${where}: names must be hidden from the end`);
        assert.equal(button.hidden, up === sizes[i], `${where}: the button shows exactly when someone is not named`);
        assert.equal(button.textContent, `全部 ${sizes[i]} 人`);
        if (i % 2) assert.ok(names[0].classList.contains("mine") && !names[0].hidden, `${where}: this browser's name comes first`);
        if (up < names.length) { // one more name would not have fitted
          names[up].hidden = false;
          assert.ok(lines(r) > 2, `${where}: hid a name that would have fitted`);
          names[up].hidden = true;
        }
      });
    }
  });

  test("the row is fitted again when the window gets narrower or wider", async (t) => {
    const x = await boot(t, { ...kickoff(), width: 2000 });
    assert.equal(visible(row(x, "Kickoff")).length, 6);
    x.layout.width = 200; x.resize(400);
    assert.deepEqual(shown(row(x, "Kickoff")), ["stella 会去", "p1 会去", "p2 会去", "全部 33 人"]);
    x.layout.width = 2000; x.resize(1200);
    assert.equal(visible(row(x, "Kickoff")).length, 6);
  });

  test("a resize that keeps the width, as a phone does when its address bar hides, does not redraw the list", async (t) => {
    const x = await boot(t, kickoff());
    const before = x.card("Kickoff");
    x.resize(1024);
    assert.equal(x.card("Kickoff"), before);
    x.resize(1000);
    assert.notEqual(x.card("Kickoff"), before);
  });

  test("a resize before the list has loaded does nothing", async (t) => {
    const x = await boot(t, { config: null });
    x.resize(500);
    assert.match(x.$("#list").textContent, /网站还在设置中/);
  });

  test("the row is fitted to the room left once a side panel has opened, and again when it closes", async (t) => {
    const e = event({ name: "Kickoff" });
    const x = await boot(t, { events: [e], rsvps: crowd(e.id, { going: 33 }), comments: [comment(e.id, "Bo", "hi")], width: 700, panel: 560 });
    assert.equal(visible(row(x, "Kickoff")).length, 6);
    await x.click(more(x, "Kickoff"));
    assert.ok(lines(row(x, "Kickoff")) <= 2);
    assert.deepEqual(shown(row(x, "Kickoff")), ["p1 会去", "全部 33 人"]);
    await x.click(x.$("#pClose"));
    assert.equal(visible(row(x, "Kickoff")).length, 6);
    await x.click(x.$(".cbtn", x.card("Kickoff")));
    assert.deepEqual(shown(row(x, "Kickoff")), ["p1 会去", "全部 33 人"]);
    await x.click(x.$("#dClose"));
    assert.equal(visible(row(x, "Kickoff")).length, 6);
  });

  test("the row stays fitted after the list refreshes on its own", async (t) => {
    const x = await boot(t, { ...kickoff(), width: 260 });
    await x.tick(20000);
    assert.equal(lines(row(x, "Kickoff")), 2);
    assert.equal(shown(row(x, "Kickoff")).at(-1), "全部 33 人");
  });
});

describe("the panel listing everyone", () => {
  test("is closed to begin with", async (t) => {
    const x = await boot(t, kickoff());
    assert.equal(x.$("#people").hidden, true);
    assert.equal(x.document.body.classList.contains("drawer-open"), false);
  });

  test("opens from the button and lists every person under their status, with counts", async (t) => {
    const x = await boot(t, kickoff());
    await x.click(more(x, "Kickoff"));
    const p = panel(x);
    assert.equal(p.open, true);
    assert.equal(p.title, "已标记 (33)");
    assert.equal(p.event, "Kickoff");
    assert.deepEqual(p.groups.map(([head, names]) => [head, names.length]), [["会去 18", 18], ["等待通过 6", 6], ["感兴趣 9", 9]]);
    assert.deepEqual(p.groups[0][1].slice(0, 3), ["stella", "p1", "p2"]);
    assert.deepEqual(p.groups[1][1], ["p18", "p19", "p20", "p21", "p22", "p23"]);
    assert.equal(p.groups[2][1].at(-1), "p32");
  });

  test("highlights this browser's name in its own group only", async (t) => {
    const e = event({ name: "House" });
    const x = await boot(t, { name: "stella", events: [e], rsvps: [...crowd(e.id, { going: 6, pending: 2 }), rsvp(e.id, "stella", "pending", KEY)] });
    await x.click(more(x, "House"));
    assert.deepEqual(x.$$("#pList .chip.mine").map((c) => c.textContent), ["stella"]);
    assert.deepEqual(panel(x).groups[1], ["等待通过 3", ["stella", "p7", "p8"]]);
  });

  test("leaves out a status nobody chose", async (t) => {
    const e = event({ name: "Mixer" });
    const x = await boot(t, { events: [e], rsvps: crowd(e.id, { going: 4, interested: 3 }) });
    await x.click(more(x, "Mixer"));
    assert.deepEqual(panel(x).groups.map(([head]) => head), ["会去 4", "感兴趣 3"]);
  });

  test("marks its button as open, moves focus to the close button, and makes room on wide screens", async (t) => {
    const e2 = event({ name: "Other" }), k = kickoff();
    const x = await boot(t, { ...k, events: [...k.events, e2], rsvps: [...k.rsvps, ...crowd(e2.id, { going: 8 })] });
    await x.click(more(x, "Kickoff"));
    assert.equal(more(x, "Kickoff").getAttribute("aria-expanded"), "true");
    assert.equal(more(x, "Other").getAttribute("aria-expanded"), "false");
    assert.equal(x.document.activeElement, x.$("#pClose"));
    assert.equal(x.document.body.classList.contains("drawer-open"), true);
  });

  test("closes from its button on the card, from ×, and with Escape", async (t) => {
    const x = await boot(t, kickoff());
    const closed = () => x.$("#people").hidden && !x.document.body.classList.contains("drawer-open") && x.state.people === null
      && more(x, "Kickoff").getAttribute("aria-expanded") === "false";
    await x.click(more(x, "Kickoff")); assert.equal(closed(), false);
    await x.click(more(x, "Kickoff")); assert.equal(closed(), true);
    await x.click(more(x, "Kickoff")); await x.click(x.$("#pClose")); assert.equal(closed(), true);
    await x.click(more(x, "Kickoff")); x.press(x.document, "Escape"); assert.equal(closed(), true);
  });

  test("ignores other keys, and Escape while a dialog is open", async (t) => {
    const x = await boot(t, kickoff());
    await x.click(more(x, "Kickoff"));
    x.press(x.document, "Enter");
    assert.equal(panel(x).open, true);
    await x.click(x.button(x.$("#me"), "改名"));
    x.press(x.document, "Escape");
    assert.equal(panel(x).open, true);
  });

  test("moves to another event when that event's button is pressed", async (t) => {
    const e2 = event({ name: "Other" }), k = kickoff();
    const x = await boot(t, { ...k, events: [...k.events, e2], rsvps: [...k.rsvps, ...crowd(e2.id, { interested: 8 }, "q")] });
    await x.click(more(x, "Kickoff"));
    await x.click(more(x, "Other"));
    assert.deepEqual([panel(x).title, panel(x).event], ["已标记 (8)", "Other"]);
    assert.deepEqual(panel(x).groups.map(([head]) => head), ["感兴趣 8"]);
    assert.equal(more(x, "Kickoff").getAttribute("aria-expanded"), "false");
  });

  test("shows a long name in full as a tooltip and as text, not HTML", async (t) => {
    const e = event({ name: "Mixer" }), evil = "<b>来自湾区的一个很长很长的群昵称</b>";
    const x = await boot(t, { events: [e], rsvps: [...crowd(e.id, { going: 6 }), rsvp(e.id, evil, "interested", "key-of-someone-000000")] });
    await x.click(more(x, "Mixer"));
    const last = x.$$("#pList .chip").at(-1);
    assert.equal(last.textContent, evil);
    assert.equal(last.title, evil);
    assert.equal(x.$$("#pList b").length, 0);
  });
});

describe("the people panel and the comments panel share one place", () => {
  const both = (x) => [!x.$("#people").hidden, !x.$("#drawer").hidden];

  test("opening comments closes the people panel, and the other way round", async (t) => {
    const x = await boot(t, kickoff());
    await x.click(more(x, "Kickoff"));
    assert.deepEqual(both(x), [true, false]);
    await x.click(x.$(".cbtn", x.card("Kickoff")));
    assert.deepEqual(both(x), [false, true]);
    assert.equal(more(x, "Kickoff").getAttribute("aria-expanded"), "false");
    await x.click(more(x, "Kickoff"));
    assert.deepEqual(both(x), [true, false]);
    assert.equal(x.$(".cbtn", x.card("Kickoff")).getAttribute("aria-expanded"), "false");
    assert.equal(x.document.body.classList.contains("drawer-open"), true);
  });

  test("a half-written comment is kept when the people panel takes over", async (t) => {
    const x = await boot(t, kickoff());
    await x.click(x.$(".cbtn", x.card("Kickoff")));
    x.type(x.$("#dInput"), "写到一半");
    await x.click(more(x, "Kickoff"));
    await x.click(x.$(".cbtn", x.card("Kickoff")));
    assert.equal(x.$("#dInput").value, "写到一半");
  });

  test("Escape closes whichever panel is open, one at a time", async (t) => {
    const x = await boot(t, kickoff());
    await x.click(x.$(".cbtn", x.card("Kickoff")));
    x.press(x.document, "Escape");
    assert.deepEqual(both(x), [false, false]);
    assert.equal(x.document.body.classList.contains("drawer-open"), false);
  });
});

describe("the panel follows what other people do", () => {
  test("it stays open across the regular refresh and picks up a new person", async (t) => {
    const x = await boot(t, kickoff());
    await x.click(more(x, "Kickoff"));
    x.db.techweek_rsvps.push({ id: 9001, ...rsvp(x.state.people, "新来的", "pending") });
    await x.tick(20000);
    assert.equal(panel(x).title, "已标记 (34)");
    assert.equal(panel(x).groups[1][0], "等待通过 7");
    assert.equal(panel(x).groups[1][1].at(-1), "新来的");
    assert.equal(more(x, "Kickoff").textContent, "全部 34 人");
    assert.equal(more(x, "Kickoff").getAttribute("aria-expanded"), "true");
  });

  test("changing my own status moves me to the other group while the panel is open", async (t) => {
    const x = await boot(t, kickoff());
    await x.click(more(x, "Kickoff"));
    await x.click(x.button(x.card("Kickoff"), "感兴趣"));
    assert.deepEqual(panel(x).groups.map(([head]) => head), ["会去 17", "等待通过 6", "感兴趣 10"]);
    assert.equal(panel(x).groups[2][1][0], "stella");
    assert.equal(panel(x).open, true);
  });

  test("it closes, and gives the room back, when the event is deleted", async (t) => {
    const x = await boot(t, kickoff());
    await x.click(more(x, "Kickoff"));
    x.db.techweek_events.length = 0;
    await x.tick(20000);
    assert.equal(panel(x).open, false);
    assert.equal(x.state.people, null);
    assert.equal(x.document.body.classList.contains("drawer-open"), false);
  });

  test("it says so when everyone has left", async (t) => {
    const e = event({ name: "Mixer" });
    const x = await boot(t, { events: [e], rsvps: crowd(e.id, { going: 6 }) });
    await x.click(more(x, "Mixer"));
    x.db.techweek_rsvps.length = 0;
    await x.tick(20000);
    assert.equal(panel(x).title, "已标记 (0)");
    assert.equal(x.$("#pList").textContent, "还没有人标记。");
    assert.equal(row(x, "Mixer"), null);
  });

  test("it stays on its event when the list is filtered to my own", async (t) => {
    const x = await boot(t, kickoff());
    await x.click(more(x, "Kickoff"));
    await x.click(x.$("#tabMine"));
    assert.equal(panel(x).title, "已标记 (33)");
    assert.equal(more(x, "Kickoff").getAttribute("aria-expanded"), "true");
  });
});
