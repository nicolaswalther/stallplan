import assert from "node:assert/strict";
import { test } from "node:test";
import { refineAreaBoundaries } from "../lib/geometry/area-boundaries";
import type { DetectedArea, PdfLine, PdfPageData } from "../lib/types";

const line = (id: string, x1: number, y1: number, x2: number, y2: number, strokeWidth = 0.6): PdfLine => ({ id, start: { x: x1, y: y1 }, end: { x: x2, y: y2 }, strokeWidth });
const room = (): DetectedArea => ({ id: "a", kind: "calving", label: "Abkalbebucht", confidence: 0.91, source: "ai", status: "unconfirmed", pageNumber: 1, bbox: { x: 0.21, y: 0.22, width: 0.48, height: 0.34 }, hasBbox: true, evidence: ["Beschriftung"] });
const rectangle = (): PdfLine[] => [line("top", .2, .2, .7, .2), line("bottom", .2, .6, .7, .6), line("left", .2, .2, .2, .6), line("right", .7, .2, .7, .6)];
const page = (lines = rectangle()): PdfPageData => ({ pageNumber: 1, width: 1000, height: 1000, imageDataUrl: "", text: "", textItems: [], documentKind: "vector", lines });
const near = (actual: number, expected: number) => assert.ok(Math.abs(actual - expected) < 1e-8, `${actual} != ${expected}`);

test("continuous vector walls refine all sides and preserve semantic confidence and original geometry", () => {
  const original = room(), output = refineAreaBoundaries(original, [page()]);
  near(output.bbox.x, .2); near(output.bbox.y, .2); near(output.bbox.width, .5); near(output.bbox.height, .4);
  assert.equal(output.source, "ai"); assert.equal(output.confidence, original.confidence);
  assert.deepEqual(output.originalBbox, original.bbox);
  assert.deepEqual(output.boundaryRefinement?.originalBbox, original.bbox);
  assert.deepEqual(new Set(output.boundaryRefinement?.sourceLineIds), new Set(["top", "bottom", "left", "right"]));
  assert.deepEqual(new Set(output.boundaryRefinement?.snappedSides), new Set(["top", "bottom", "left", "right"]));
  assert.equal(output.status, "unconfirmed"); assert.match(output.evidence.at(-1)!, /Vektorgrenzen/);
  assert.deepEqual(original.bbox, { x: .21, y: .22, width: .48, height: .34 });
  assert.equal(refineAreaBoundaries(output, [page()]), output, "refinement is audited once");
});

test("short internal separators and repeated hatching do not become area sides", () => {
  const original = room(), bounds = rectangle().slice(0, 2);
  bounds.push(line("short", .208, .3, .208, .4));
  for (let index = 0; index < 10; index++) bounds.push(line(`hatch-${index}`, .206 + index * .008, .2, .206 + index * .008, .6));
  const result = refineAreaBoundaries(original, [page(bounds)]);
  near(result.bbox.x, original.bbox.x); near(result.bbox.width, original.bbox.width);
  assert.ok(!result.boundaryRefinement?.sourceLineIds.some((id) => id.startsWith("hatch") || id === "short"));
  near(result.bbox.y, .2); near(result.bbox.height, .4);
});

test("raster pages, absent geometry, unknown types and small equipment are left unchanged", () => {
  for (const kind of ["unknown", "drinker", "brush", "gate"] as const) {
    const original = { ...room(), kind }; assert.equal(refineAreaBoundaries(original, [page()]), original);
  }
  const original = room();
  assert.equal(refineAreaBoundaries(original, [{ ...page(), documentKind: "raster" }]), original);
  assert.equal(refineAreaBoundaries(original, [{ ...page(), lines: [] }]), original);
  assert.equal(refineAreaBoundaries(original, [{ ...page(), pageNumber: 2 }]), original);
});

test("customer geometry and rejected areas are never rewritten", () => {
  const corrected = { ...room(), geometryCorrections: [{ at: "2026-10-05", bbox: room().bbox, source: "customer" as const }] };
  for (const original of [{ ...room(), source: "manual" as const }, { ...room(), status: "rejected" as const }, corrected]) {
    assert.equal(refineAreaBoundaries(original, [page()]), original);
  }
});

test("one rail and lone unpainted construction lines cannot refine an area", () => {
  const original = room();
  assert.equal(refineAreaBoundaries(original, [page(rectangle().slice(0, 1))]), original);
  assert.equal(refineAreaBoundaries(original, [page(rectangle().map((entry) => ({ ...entry, strokeWidth: 0 })))]), original);
});

test("two paired sides of filled narrow PDF walls qualify without a stroke", () => {
  const lines = [line("top-a", .2, .2, .7, .2, 0), line("top-b", .2, .2015, .7, .2015, 0), line("bottom-a", .2, .6, .7, .6, 0), line("bottom-b", .2, .6015, .7, .6015, 0)];
  const result = refineAreaBoundaries(room(), [page(lines)]);
  assert.ok(result.boundaryRefinement); near(result.bbox.y, .2015); near(result.bbox.height, .3985);
});

test("large unsupported expansions and invalid geometry remain unchanged", () => {
  const original = { ...room(), bbox: { x: .21, y: .25, width: .48, height: .1 } };
  const lines = [line("top", .2, .2, .7, .2), line("bottom", .2, .4, .7, .4)];
  assert.equal(refineAreaBoundaries(original, [page(lines)]), original);
  const invalid = { ...room(), bbox: { ...room().bbox, width: Number.NaN } };
  assert.equal(refineAreaBoundaries(invalid, [page()]), invalid);
});

test("source line provenance remains compact for heavily fragmented vector borders", () => {
  const lines: PdfLine[] = [];
  for (const y of [.2, .6]) for (let index = 0; index < 100; index++) lines.push(line(`${y}-${index}`, .2 + index * .005, y, .2 + (index + 1) * .005, y));
  const result = refineAreaBoundaries(room(), [page(lines)]);
  assert.ok(result.boundaryRefinement); assert.ok(result.boundaryRefinement.sourceLineIds.length <= 128);
});

test("a rectangular overhang is cropped only with all four corroborating vector sides", () => {
  const original = { ...room(), kind: "alley" as const, bbox: { x: .1, y: .21, width: .7, height: .2 } };
  const lines = [line("top", .1, .2, .8, .2), line("bottom", .1, .4, .6, .4), line("left", .1, .2, .1, .4), line("inner-right", .6, .2, .6, .4), line("outer-right", .8, .2, .8, .41)];
  const result = refineAreaBoundaries(original, [page(lines)]);
  near(result.bbox.x, .1); near(result.bbox.y, .2); near(result.bbox.width, .5); near(result.bbox.height, .2);
  assert.ok(result.boundaryRefinement?.sourceLineIds.includes("inner-right"));
  assert.equal(result.confidence, original.confidence);
  const incomplete = refineAreaBoundaries(original, [page(lines.filter((entry) => entry.id !== "inner-right"))]);
  near(incomplete.bbox.width, .7);
});

test("an enclosed cubicle island must not replace a nonrectangular circulation area", () => {
  const original = { ...room(), kind: "alley" as const, bbox: { x: .1, y: .2, width: .6, height: .2 } };
  const lines = [line("outer-top", .1, .2, .7, .2), line("outer-left", .1, .2, .1, .4), line("outer-right", .7, .2, .7, .4), line("island-bottom", .2, .36, .6, .36), line("island-left", .2, .2, .2, .36), line("island-right", .6, .2, .6, .36)];
  assert.equal(refineAreaBoundaries(original, [page(lines)]), original);
});

test("closed overhang correction also works for a vertically oriented area", () => {
  const original = { ...room(), kind: "alley" as const, bbox: { x: .21, y: .1, width: .2, height: .7 } };
  const lines = [line("left", .2, .1, .2, .8), line("right", .4, .1, .4, .6), line("top", .2, .1, .4, .1), line("inner-bottom", .2, .6, .4, .6), line("outer-bottom", .2, .8, .41, .8)];
  const result = refineAreaBoundaries(original, [page(lines)]);
  near(result.bbox.x, .2); near(result.bbox.y, .1); near(result.bbox.width, .2); near(result.bbox.height, .5);
});

test("aspect-aware search reaches a genuinely supported side wall of a narrow pen", () => {
  const original = { ...room(), kind: "isolation" as const, bbox: { x: .602, y: .31, width: .076, height: .12 } };
  const lines = [line("top", .6, .3, .7, .3), line("bottom", .6, .45, .7, .45), line("left", .6, .3, .6, .45), line("right", .7, .3, .7, .45)];
  const result = refineAreaBoundaries(original, [page(lines)]);
  near(result.bbox.x, .6); near(result.bbox.width, .1);
  near(result.bbox.y, .3); near(result.bbox.height, .15);
  assert.ok(result.boundaryRefinement?.sourceLineIds.includes("right"));
  assert.equal(result.confidence, original.confidence);
});
