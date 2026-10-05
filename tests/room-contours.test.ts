import assert from "node:assert/strict";
import { test } from "node:test";
import { detectRoomContours } from "../lib/geometry/room-contours";
import type { PdfLine, PdfPageData, PdfTextItem, PlanPoint } from "../lib/types";

function rectangle(id: string, x: number, y: number, right: number, bottom: number, strokeWidth = .6): PdfLine[] {
  return [[x, y, right, y], [right, y, right, bottom], [right, bottom, x, bottom], [x, bottom, x, y]].map(([x1, y1, x2, y2], index) => ({ id: `${id}-${index}`, start: { x: x1, y: y1 }, end: { x: x2, y: y2 }, strokeWidth }));
}
function anchor(number: string, x: number, y: number): PdfTextItem {
  return { id: `label-${number}`, text: `${number}.`, bbox: { x, y, width: .008, height: .008 } };
}
function page(lines: PdfLine[], textItems: PdfTextItem[]): PdfPageData {
  return { pageNumber: 1, width: 1000, height: 1000, imageDataUrl: "", text: "", textItems, lines, documentKind: "vector" };
}
function inside(ring: PlanPoint[], x: number, y: number) {
  let result = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const a = ring[i], b = ring[j];
    if ((a.y > y) !== (b.y > y) && x < (b.x - a.x) * (y - a.y) / (b.y - a.y) + a.x) result = !result;
  }
  return result;
}

test("a numbered connected corridor retains its island hole and stays separate from the adjoining feed passage", () => {
  const input = page([...rectangle("outer", .1, .1, .8, .6), ...rectangle("island", .3, .3, .6, .45), ...rectangle("feed", .1, .6, .8, .85)], [anchor("9", .2, .2), anchor("10", .4, .35), anchor("11", .5, .35), anchor("12", .4, .7)]);
  const result = detectRoomContours(input), corridor = result.find((candidate) => candidate.anchor.number === "9")!;
  assert.ok(corridor);
  assert.equal(corridor.method, "vector-free-space");
  assert.equal(corridor.resolutionPoints, 1);
  assert.equal(corridor.footprint.parts.length, 1);
  const { outer, holes } = corridor.footprint.parts[0];
  assert.equal(holes.length, 1);
  assert.ok(inside(outer, .2, .2));
  assert.ok(inside(outer, .4, .35) && inside(holes[0], .4, .35), "the cubicle island is excluded by a hole");
  assert.ok(!inside(outer, .4, .7), "the adjacent feed passage cannot merge into the corridor");
  assert.ok(result.some((candidate) => candidate.anchor.number === "12"));
  assert.ok(!result.some((candidate) => ["10", "11"].includes(candidate.anchor.number)), "two numbers in one island are ambiguous");
  assert.equal(input.textItems[0].text, "9.");
  assert.ok(corridor.sourceLineIds.some((id) => id.startsWith("island")));
});

test("a painted wall and an adjacent repeated hatch remain separate physical axes", () => {
  const lines = rectangle("outer", .1, .1, .8, .6);
  lines.push({ id: "short-wall", start: { x: .3, y: .1 }, end: { x: .3, y: .2 }, strokeWidth: .6 });
  for (let index = 0; index < 4; index++) lines.push({ id: `hatch-${index}`, start: { x: .30048 + index * .008, y: .2 }, end: { x: .30048 + index * .008, y: .6 }, strokeWidth: .6 });
  const output = detectRoomContours(page(lines, [anchor("9", .2, .3)]));
  assert.equal(output.length, 1);
  assert.ok(output[0].bbox.x + output[0].bbox.width > .79, "a hatch must not become a wall across the room");
  assert.ok(!output[0].sourceLineIds.some((id) => id.startsWith("hatch")));
});

test("border leaks, unlabeled spaces and all-hairline dimension rectangles do not become room geometry", () => {
  const lines = rectangle("room", .1, .1, .6, .6);
  assert.deepEqual(detectRoomContours(page(lines.slice(0, 3), [anchor("1", .3, .3)])), []);
  assert.deepEqual(detectRoomContours(page(lines, [])), []);
  assert.deepEqual(detectRoomContours(page(rectangle("dimension", .1, .1, .6, .6, 0), [anchor("1", .3, .3)])), []);
});

test("real collinear hairline continuations can complete a painted wall without filling missing door gaps", () => {
  const walls = rectangle("room", .1, .1, .6, .6);
  walls.pop();
  walls.push({ id: "painted", start: { x: .1, y: .1 }, end: { x: .1, y: .25 }, strokeWidth: .6 });
  walls.push({ id: "native-hairline", start: { x: .1, y: .25 }, end: { x: .1, y: .6 }, strokeWidth: 0 });
  const result = detectRoomContours(page(walls, [anchor("1", .3, .3)]));
  assert.equal(result.length, 1);
  assert.ok(result[0].sourceLineIds.includes("native-hairline"));
  const missing = walls.filter((line) => line.id !== "native-hairline");
  assert.deepEqual(detectRoomContours(page(missing, [anchor("1", .3, .3)])), [], "missing segments are never invented");
});

test("invalid geometry and unsupported raster/oversized pages fail locally", () => {
  const source = page(rectangle("room", .1, .1, .6, .6), [anchor("1", .3, .3)]);
  for (const input of [{ ...source, documentKind: "raster" as const }, { ...source, width: 100_000 }, { ...source, height: Number.NaN }]) assert.deepEqual(detectRoomContours(input), []);
  const invalid = source.lines!.map((line) => ({ ...line, start: { x: -1e9, y: Number.NaN } }));
  assert.deepEqual(detectRoomContours({ ...source, lines: invalid }), []);
});

test("duplicate native indices still make a shared component ambiguous without blocking an independent uniquely numbered room", () => {
  const walls = [...rectangle("left", .1, .1, .5, .5), ...rectangle("right", .6, .1, .9, .5)];
  const shared = page(walls, [anchor("7", .2, .2), anchor("8", .3, .3), anchor("8", .4, .3)]);
  assert.deepEqual(detectRoomContours(shared), [], "duplicate 8 labels cannot disappear from the occupancy count around unique 7");
  const separate = page(walls, [anchor("7", .2, .2), anchor("8", .7, .3), anchor("8", .8, .3)]);
  const output = detectRoomContours(separate);
  assert.deepEqual(output.map((candidate) => candidate.anchor.number), ["7"]);
  const duplicateAcrossRooms = page(walls, [anchor("7", .2, .2), anchor("7", .7, .3)]);
  assert.deepEqual(detectRoomContours(duplicateAcrossRooms), [], "a duplicate number cannot identify either independent component");
});
