import assert from "node:assert/strict";
import { test } from "node:test";

import { renderTemplate } from "./render-template.ts";

test("escapes all five HTML characters", () => {
  assert.equal(renderTemplate("{{x}}", { x: `<a href="b">&'` }), "&lt;a href=&quot;b&quot;&gt;&amp;&#39;");
});

test("reads dotted paths and renders a missing value as empty", () => {
  assert.equal(renderTemplate("[{{a.b}}|{{a.c}}|{{z}}]", { a: { b: "1" } }), "[1||]");
});

test("if follows truthiness, and an empty list is false", () => {
  const template = "{{#if x}}yes{{/if}}";
  assert.equal(renderTemplate(template, { x: true }), "yes");
  for (const x of [false, "", 0, null, undefined, []]) assert.equal(renderTemplate(template, { x }), "");
});

test("each loops with the item first and outer data behind it", () => {
  assert.equal(
    renderTemplate("{{#each l}}{{n}}{{u}},{{/each}}", { u: "r", n: "outer", l: [{ n: 1 }, { n: 2 }] }),
    "1r,2r,",
  );
  assert.equal(renderTemplate("{{#each l}}x{{/each}}", {}), "");
});

test("blocks nest, with if inside each and each inside each", () => {
  assert.equal(
    renderTemplate("{{#each a}}{{#if on}}{{#if deep}}D{{/if}}{{n}}{{/if}};{{/each}}", {
      a: [{ on: true, n: 1, deep: true }, { on: false, n: 2 }],
    }),
    "D1;;",
  );
  assert.equal(
    renderTemplate("{{#each a}}{{#each b}}{{v}}{{/each}}|{{/each}}", { a: [{ b: [{ v: 1 }, { v: 2 }] }, { b: [] }] }),
    "12||",
  );
});

test("an escaped value is not read as a template", () => {
  assert.equal(renderTemplate("{{x}}", { x: "{{y}}", y: "no" }), "{{y}}");
});

test("an unclosed block fails instead of printing broken output", () => {
  assert.throws(() => renderTemplate("{{#if x}}", { x: true }), /not closed/);
});
