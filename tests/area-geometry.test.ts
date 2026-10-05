import assert from "node:assert/strict";
import { test } from "node:test";
import { footprintPathInBox, isValidAreaFootprint, transformAreaFootprint, type AreaFootprint } from "../lib/plan/area-geometry";

const box = { x: .1, y: .2, width: .8, height: .6 };
const ring = (x: number, y: number, width: number, height: number) => [{ x, y }, { x: x + width, y }, { x: x + width, y: y + height }, { x, y: y + height }];
const footprint: AreaFootprint = { parts: [
  { outer: ring(.1, .2, .6, .6), holes: [ring(.3, .4, .2, .2)] },
  { outer: ring(.8, .6, .1, .2) },
] };

test("moving a polygon translates every part and hole without changing the saved geometry", () => {
  const transformed = transformAreaFootprint(footprint, box, { ...box, x: .2, y: .1 });
  assert.deepEqual(transformed.parts[0].outer[0], { x: .2, y: .1 });
  assert.ok(Math.abs(transformed.parts[0].holes![0][0].x - .4) < 1e-12);
  assert.ok(Math.abs(transformed.parts[0].holes![0][0].y - .3) < 1e-12);
  assert.ok(Math.abs(transformed.parts[1].outer[0].x - .9) < 1e-12);
  assert.deepEqual(footprint.parts[0].holes![0][0], { x: .3, y: .4 });
});

test("resizing preserves ring topology and yields the same local clip geometry", () => {
  const resized = { x: .05, y: .1, width: .4, height: .9 };
  const transformed = transformAreaFootprint(footprint, box, resized);
  assert.equal(transformed.parts.length, 2);
  assert.equal(transformed.parts[0].holes?.length, 1);
  assert.equal(footprintPathInBox(transformed, resized), footprintPathInBox(footprint, box));
  assert.equal(footprintPathInBox(footprint, box).match(/ Z/g)?.length, 3);
});

test("invalid or degenerate geometry falls back safely, and unchanged geometry keeps its identity", () => {
  assert.equal(transformAreaFootprint(footprint, box, box), footprint);
  assert.equal(transformAreaFootprint(footprint, box, { ...box, width: 0 }), footprint);
  assert.equal(footprintPathInBox(footprint, { ...box, height: 0 }), "");
  assert.equal(isValidAreaFootprint({ parts: [{ outer: [{ x: NaN, y: 0 }, { x: 0, y: 1 }, { x: 1, y: 0 }] }] }), false);
  assert.equal(isValidAreaFootprint({ parts: [{ outer: ring(0, 0, 1, 1), holes: [[{ x: 0, y: 0 }]] }] }), false);
  assert.equal(isValidAreaFootprint({ parts: [{ outer: [{ x: 0, y: 0 }, { x: .5, y: .5 }, { x: 1, y: 1 }] }] }), false);
  assert.equal(isValidAreaFootprint({ parts: [] }), false);
});
