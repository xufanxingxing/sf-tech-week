// Runs the real index.html and app.js in jsdom, against a fake Supabase that keeps the rules of supabase-setup.sql,
// with a clock the test advances by hand and a stand-in for the browser's line wrapping (jsdom lays nothing out).
import { JSDOM } from "jsdom";
import { readFileSync } from "node:fs";
import vm from "node:vm";

process.env.TZ = "America/Los_Angeles"; // comment times print in local time

const root = new URL("../", import.meta.url);
export const HTML = readFileSync(new URL("index.html", root), "utf8");
export const SOURCE = readFileSync(new URL("app.js", root), "utf8");
const PAGE = HTML.replace(/<script\b[^>]*\bsrc=[^>]*><\/script>/g, "");
const APP = new vm.Script(SOURCE, { filename: "app.js" });

export const KEY = "key-of-this-browser";
export const flush = async () => { for (let i = 0; i < 3; i++) await new Promise((r) => setImmediate(r)); };

let seq = 0;
export function event(over = {}) {
  const n = ++seq;
  return { id: `ev-${n}`, name: `Event ${n}`, link: `https://example.com/e/${n}`, date: "2026-10-05", start_time: "18:00:00", end_time: "20:00:00",
    extra_dates: [], location: "San Francisco", why: "值得去", added_by: "群主", curated: false, added_key: null, ...over };
}
export const rsvp = (event_id, name, status = "going", person_key = `key-of-${name}-0000000000`) => ({ event_id, name, status, person_key });
export const comment = (event_id, name, body, over = {}) =>
  ({ event_id, name, body, person_key: `key-of-${name}-0000000000`, created_at: "2026-10-03T18:20:00Z", ...over });
// counts = { going: 3, pending: 1 } → people named p1, p2, … in that order
export function crowd(event_id, counts, prefix = "p") {
  let n = 0;
  return Object.entries(counts).flatMap(([status, count]) => Array.from({ length: count }, () => rsvp(event_id, prefix + ++n, status)));
}

const len = (s, min, max) => typeof s === "string" && [...s].length >= min && [...s].length <= max;

function backend(seed) {
  let id = 0;
  const db = {
    techweek_events: (seed.events || []).map((e) => ({ ...e })),
    techweek_rsvps: (seed.rsvps || []).map((r) => ({ id: ++id, ...r })),
    techweek_comments: (seed.comments || []).map((c) => ({ id: ++id, ...c })),
  };
  const calls = [];          // every request the app sent, in order
  const failing = new Set(); // table or function names that answer with an error
  const held = new Map();    // name -> promise; answers wait for it

  // The server works out its answer when the request arrives; only the delivery can be delayed.
  function reply(name, call, compute) {
    calls.push(call);
    let result;
    if (failing.has(name)) result = { data: null, error: { message: "request failed" } };
    else {
      try { result = { data: compute() ?? null, error: null }; }
      catch (e) { result = { data: null, error: { message: e.message } }; }
    }
    return (held.get(name) || Promise.resolve()).then(() => result);
  }
  const check = (ok, what) => { if (!ok) throw new Error("violates " + what); };
  const mineOf = (rows, key) => rows.filter((r) => r.person_key === key);

  const rpcs = {
    techweek_my_rsvps: ({ p_key }) => mineOf(db.techweek_rsvps, p_key).map((r) => ({ event_id: r.event_id, status: r.status })),
    techweek_my_added: ({ p_key }) => db.techweek_events.filter((e) => e.added_key === p_key).map((e) => e.id),
    techweek_my_comments: ({ p_key }) => mineOf(db.techweek_comments, p_key).map((c) => c.id),
    techweek_set_status({ p_event, p_key, p_name, p_status }) {
      const rows = db.techweek_rsvps, at = rows.findIndex((r) => r.event_id === p_event && r.person_key === p_key);
      if (p_status == null) { if (at >= 0) rows.splice(at, 1); return; }
      check(db.techweek_events.some((e) => e.id === p_event), "rsvps.event_id");
      check(len(p_key, 16, 64), "rsvps.person_key");
      check(len(p_name.trim(), 1, 30), "rsvps.name");
      check(["going", "pending", "interested"].includes(p_status), "rsvps.status");
      if (at >= 0) Object.assign(rows[at], { name: p_name.trim(), status: p_status });
      else rows.push({ id: ++id, event_id: p_event, person_key: p_key, name: p_name.trim(), status: p_status });
    },
    techweek_rename_me({ p_key, p_name }) {
      check(len(p_name.trim(), 1, 30), "name");
      for (const r of [...mineOf(db.techweek_rsvps, p_key), ...mineOf(db.techweek_comments, p_key)]) r.name = p_name.trim();
    },
    techweek_add_comment({ p_event, p_key, p_name, p_body }) {
      check(db.techweek_events.some((e) => e.id === p_event), "comments.event_id");
      check(len(p_key, 16, 64), "comments.person_key");
      check(len(p_name.trim(), 1, 30), "comments.name");
      check(len(p_body.trim(), 1, 300), "comments.body");
      db.techweek_comments.push({ id: ++id, event_id: p_event, person_key: p_key, name: p_name.trim(), body: p_body.trim(), created_at: new Date().toISOString() });
    },
    techweek_delete_comment({ p_id, p_key }) {
      const at = db.techweek_comments.findIndex((c) => c.id === p_id && c.person_key === p_key);
      if (at >= 0) db.techweek_comments.splice(at, 1);
      return at >= 0;
    },
    techweek_delete_event({ p_event, p_key }) {
      const at = db.techweek_events.findIndex((e) => e.id === p_event && e.added_key === p_key);
      if (at < 0) return false;
      db.techweek_events.splice(at, 1);
      for (const t of ["techweek_rsvps", "techweek_comments"]) db[t] = db[t].filter((r) => r.event_id !== p_event);
      return true;
    },
  };
  function insertEvent(row) {
    check(len(row.name, 1, 120), "events.name");
    check(/^https?:\/\//i.test(row.link) && row.link.length <= 500, "events.link");
    check(/^\d{4}-\d{2}-\d{2}$/.test(row.date), "events.date");
    check(/^\d{2}:\d{2}/.test(row.start_time), "events.start_time");
    check(row.end_time === null || /^\d{2}:\d{2}/.test(row.end_time), "events.end_time");
    check(Array.isArray(row.extra_dates) && row.extra_dates.length <= 6, "events.extra_dates");
    check(len(row.location, 1, 200), "events.location");
    check(len(row.why, 1, 600), "events.why");
    check(len(row.added_by, 1, 30), "events.added_by");
    check(!row.curated, "the insert policy (curated = false)");
    check(row.added_key == null || len(row.added_key, 16, 64), "events.added_key");
    db.techweek_events.push({ curated: false, ...row, id: `ev-new-${++id}`, start_time: row.start_time.slice(0, 5) + ":00",
      end_time: row.end_time && row.end_time.slice(0, 5) + ":00" });
  }
  const SECRET = new Set(["person_key", "added_key"]); // columns anon may not read
  const client = {
    from: (table) => ({
      select(columns) {
        let range = null;
        const q = {
          order: () => q,
          range(a, b) { range = [a, b]; return q; },
          then: (res, rej) => reply(table, { op: "select", table, columns, range }, () => {
            const cols = columns.split(",");
            check(!cols.some((c) => SECRET.has(c)), "column privileges");
            const rows = range ? db[table].slice(range[0], range[1] + 1) : db[table];
            return rows.map((r) => Object.fromEntries(cols.map((c) => [c, r[c]])));
          }).then(res, rej),
        };
        return q;
      },
      insert: (row) => reply(table, { op: "insert", table, row }, () => { check(table === "techweek_events", "insert privileges"); insertEvent(row); }),
    }),
    rpc: (name, args) => reply(name, { op: "rpc", name, args }, () => rpcs[name](args)),
  };
  return {
    db, calls, client,
    fail: (...names) => { for (const n of names) failing.add(n); },
    heal: () => failing.clear(),
    // hold("techweek_rsvps") keeps answers to that table or function back until the returned function is called
    hold(name) { let release; held.set(name, new Promise((r) => (release = r))); return () => { held.delete(name); release(); }; },
    rpcsSent: (name) => calls.filter((c) => c.op === "rpc" && c.name === name).map((c) => c.args),
  };
}

// boot(t, { name, events, rsvps, comments, ... }) loads the page and waits for the first refresh. The window closes when test t ends.
export async function boot(t, { name = "", key = KEY, config = { supabaseUrl: "https://db.test", supabaseKey: "anon-key" },
  client = true, width = Infinity, panel = 0, innerWidth = 1024, ...seed } = {}) {
  const dom = new JSDOM(PAGE, { runScripts: "outside-only", url: "https://techweek.test/", pretendToBeVisual: true });
  const { window } = dom, { document } = window, ctx = dom.getInternalVMContext();
  t.after(() => window.close());
  const api = backend(seed);

  // The app's timers run only when the test says so.
  const timers = []; let now = 0, tid = 0;
  window.setTimeout = (fn, ms = 0) => { timers.push({ id: ++tid, at: now + ms, fn }); return tid; };
  window.setInterval = (fn, ms) => { timers.push({ id: ++tid, at: now + ms, fn, every: ms }); return tid; };
  window.clearTimeout = window.clearInterval = (id) => { const i = timers.findIndex((x) => x.id === id); if (i >= 0) timers.splice(i, 1); };
  async function tick(ms) {
    const end = now + ms;
    for (;;) {
      const next = timers.filter((x) => x.at <= end).sort((a, b) => a.at - b.at)[0];
      if (!next) break;
      now = next.at;
      if (next.every) next.at += next.every; else timers.splice(timers.indexOf(next), 1);
      next.fn();
      await flush();
    }
    now = end;
  }

  // jsdom has no <dialog> methods.
  const dialog = window.HTMLDialogElement.prototype;
  dialog.showModal = function () { this.setAttribute("open", ""); };
  dialog.close = function () { this.removeAttribute("open"); };

  // Stand-in for flex-wrap in a who's-going row: children sit left to right with a 6px gap and wrap when out of room.
  // An open side panel takes `panel` pixels away from the row, the way body.drawer-open does at some window widths.
  const layout = { width, panel, chip: (el) => 20 + 12 * [...el.textContent].length };
  Object.defineProperty(window.HTMLElement.prototype, "offsetTop", { configurable: true, get() {
    const row = this.parentElement;
    if (!row || !row.classList.contains("going")) return 0;
    const room = layout.width - (document.body.classList.contains("drawer-open") ? layout.panel : 0);
    let x = 0, line = 0;
    for (const kid of row.children) {
      if (kid.hidden) continue;
      const w = layout.chip(kid);
      if (x && x + w > room) { line++; x = 0; }
      if (kid === this) break;
      x += w + 6;
    }
    return line * 31;
  } });

  let hidden = false;
  Object.defineProperty(document, "hidden", { configurable: true, get: () => hidden });
  window.innerWidth = innerWidth;
  if (name) window.localStorage.setItem("tw.name", name);
  if (key) window.localStorage.setItem("tw.key", key);
  if (config) window.TECHWEEK_CONFIG = config;
  if (client) window.supabase = { createClient: (url, anon, options) => { api.calls.push({ op: "connect", url, anon, options }); return api.client; } };

  APP.runInContext(ctx);
  await flush();

  const $ = (s, el = document) => el.querySelector(s), $$ = (s, el = document) => [...el.querySelectorAll(s)];
  const press = (target, key, more = {}) => {
    const e = new window.KeyboardEvent("keydown", { key, bubbles: true, cancelable: true, ...more });
    target.dispatchEvent(e);
    return e;
  };
  return {
    ...api, window, document, $, $$, flush, tick, layout, press,
    state: vm.runInContext("state", ctx),
    app: (code) => vm.runInContext(code, ctx),
    // the card of an event, by event name; with several sessions, the nth card
    card: (title, nth = 0) => $$(".event").filter((c) => $("h3", c).textContent.startsWith(title))[nth],
    button: (el, text) => $$("button", el).find((b) => b.textContent === text),
    click: async (el) => { el.click(); await flush(); },
    type: (el, value) => { el.value = value; },
    setHidden: (v) => { hidden = v; document.dispatchEvent(new window.Event("visibilitychange")); },
    resize: (w) => { window.innerWidth = w; window.dispatchEvent(new window.Event("resize")); },
    toast: () => ($("#toast").hidden ? null : $("#toast").textContent),
    pendingTimers: () => timers.length,
  };
}

// What a who's-going row shows: ["stella 会去", …, "全部 33 人"], hidden children left out.
export const visible = (row) => [...row.children].filter((c) => !c.hidden);
export const label = (el) => (el.children.length ? [...el.children].map((c) => c.textContent).join(" ") : el.textContent);
export const shown = (row) => visible(row).map(label);
export const lines = (row) => new Set(visible(row).map((c) => c.offsetTop)).size;
