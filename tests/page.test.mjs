// index.html and app.js have to agree: these checks read the two files as text.
import { test } from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import { HTML, SOURCE } from "./harness.mjs";

const { document } = new JSDOM(HTML).window;
const css = document.querySelector("style").textContent;
const rule = (selector) => css.match(new RegExp(`(^|\\})\\s*${selector.replace(/[.[\]]/g, "\\$&")}\\s*\\{([^}]*)\\}`, "m"))?.[2] ?? "";

test("every element the script looks up by id is on the page", () => {
  const ids = [...new Set([...SOURCE.matchAll(/\$\("#([A-Za-z][\w-]*)"\)/g)].map((m) => m[1]))];
  assert.ok(ids.length > 30, "expected to find the script's lookups");
  assert.deepEqual(ids.filter((id) => !document.getElementById(id)), []);
});

test("no id is used twice", () => {
  const ids = [...document.querySelectorAll("[id]")].map((el) => el.id);
  assert.deepEqual(ids.filter((id, i) => ids.indexOf(id) !== i), []);
});

test("scripts load in order: the database library, the config, the app, and config and app share a cache version", () => {
  const src = [...document.querySelectorAll("script[src]")].map((s) => s.getAttribute("src"));
  assert.equal(src.length, 3);
  assert.match(src[0], /supabase-js/);
  assert.match(src[1], /^config\.js\?v=\d+$/);
  assert.match(src[2], /^app\.js\?v=\d+$/);
  assert.equal(src[1].split("=")[1], src[2].split("=")[1]);
});

test("the script never builds HTML from text", () => {
  assert.doesNotMatch(SOURCE, /innerHTML|outerHTML|insertAdjacentHTML|document\.write|\beval\(/);
});

test("each box is no longer than its database column", () => {
  const max = (id) => Number(document.getElementById(id).getAttribute("maxlength"));
  assert.deepEqual({ fName: max("fName"), fLink: max("fLink"), fWhere: max("fWhere"), fWhy: max("fWhy"), fBy: max("fBy"), nName: max("nName"), dInput: max("dInput") },
    { fName: 120, fLink: 500, fWhere: 200, fWhy: 600, fBy: 30, nName: 30, dInput: 300 });
});

test("the forms are checked by the script, not by the browser's own pop-ups", () => {
  for (const id of ["eventForm", "nameForm"]) assert.ok(document.getElementById(id).noValidate, id);
});

test("the styles the two-line limit relies on are in place", () => {
  assert.match(rule("[hidden]"), /display:\s*none\s*!important/, "a hidden name must leave the row");
  assert.match(rule(".going"), /display:\s*flex/);
  assert.match(rule(".going"), /flex-wrap:\s*wrap/, "names must wrap, so lines can be counted");
  assert.match(rule(".chip"), /height:\s*\d+px/, "names and the button share one height, so each line has one top edge");
  assert.match(rule(".chip"), /white-space:\s*nowrap/, "a name must not wrap inside itself");
  assert.match(rule(".chip .nm"), /text-overflow:\s*ellipsis/);
});

test("both side panels share the drawer styles and start closed", () => {
  for (const id of ["drawer", "people"]) {
    const el = document.getElementById(id);
    assert.ok(el.classList.contains("drawer") && el.hidden, id);
  }
  assert.match(rule(".drawer"), /position:\s*fixed/);
});
