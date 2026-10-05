import assert from "node:assert/strict";
import { test } from "node:test";
import { anchoredScroll, wheelZoom } from "../lib/plan/viewport";

test("mouse wheel zooms both ways, normalizes line events and clamps limits", () => {
  assert.ok(wheelZoom(1, -100) > 1);
  assert.ok(wheelZoom(1, 100) < 1);
  assert.equal(wheelZoom(1, 1, 1), wheelZoom(1, 16));
  assert.equal(wheelZoom(4, -100), 4);
  assert.equal(wheelZoom(0.5, 100), 0.5);
  assert.equal(wheelZoom(1, NaN), 1);
});

test("cursor anchor preserves its document position after a twofold zoom", () => {
  // A point 25% across a 1000px plan is under cursor x=270, including padding.
  const scroll = anchoredScroll(0.25, 2000, 20, 270);
  assert.equal(scroll, 250);
  assert.equal(20 + 0.25 * 2000 - scroll, 270);
  assert.equal(anchoredScroll(0, 1000, 20, 100), 0);
});
