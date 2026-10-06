import assert from "node:assert/strict";
import { test } from "node:test";
import { hasLocatedDimensionInk } from "../lib/geometry/text-ink";
import { extractVectorLines } from "../lib/pdf/vector-extraction";
import { analysisRequestSchema, parseAnalysisRequest } from "../lib/plan/request";
import type { PdfLine, PdfPageData } from "../lib/types";

const box = { x: .1, y: .1, width: .02, height: .01 };
const filler: PdfLine[] = Array.from({ length: 1000 }, (_, index) => ({ id: `outside-${index}`, start: { x: .8, y: .8 }, end: { x: .8, y: .801 } }));
const base: PdfPageData = { pageNumber: 1, width: 1000, height: 1000, text: "", textItems: [], imageDataUrl: "", lines: filler,
  rasterImages: [], rasterGeometryComplete: true, curveInkBounds: [], vectorInkComplete: true };

test("vector text position must contain two-dimensional short-path ink, not only an axis rail", () => {
  assert.equal(hasLocatedDimensionInk(base, box), false);
  const collinear: PdfLine[] = Array.from({ length: 18 }, (_, index) => ({ id: `rail-${index}`, start: { x: .101 + index * .0008, y: .104 }, end: { x: .1015 + index * .0008, y: .104 } }));
  assert.equal(hasLocatedDimensionInk({ ...base, lines: [...filler, ...collinear] }, box), false);
  const glyphs: PdfLine[] = Array.from({ length: 20 }, (_, index) => ({ id: `glyph-${index}`, start: { x: .102 + (index % 5) * .002, y: .102 + Math.floor(index / 5) * .001 }, end: { x: .1025 + (index % 5) * .002, y: .1025 + Math.floor(index / 5) * .001 } }));
  assert.equal(hasLocatedDimensionInk({ ...base, lines: [...filler, ...glyphs] }, box), true);
});

test("raster digits and unparsed image groups are never rejected for missing native glyphs", () => {
  assert.equal(hasLocatedDimensionInk({ ...base, rasterImages: [{ x: 0, y: 0, width: 1, height: 1 }] }, box), true);
  assert.equal(hasLocatedDimensionInk({ ...base, rasterGeometryComplete: false }, box), true);
  assert.equal(hasLocatedDimensionInk({ ...base, rasterImages: undefined }, box), true);
  assert.equal(hasLocatedDimensionInk({ ...base, lines: [] }, box), true);
  assert.equal(hasLocatedDimensionInk({ ...base, rasterImages: [{ x: .8, y: .8, width: .1, height: .1 }] }, box), false, "a remote logo does not explain digits in an empty vector region");
});

test("curve ink and incomplete or legacy vector metadata cannot prove an empty text box", () => {
  assert.equal(hasLocatedDimensionInk({ ...base, curveInkBounds: [box] }, box), true);
  assert.equal(hasLocatedDimensionInk({ ...base, curveInkBounds: [{ x: .8, y: .8, width: .01, height: .01 }] }, box), false);
  assert.equal(hasLocatedDimensionInk({ ...base, vectorInkComplete: false }, box), true);
  assert.equal(hasLocatedDimensionInk({ ...base, vectorInkComplete: undefined }, box), true);
  assert.equal(hasLocatedDimensionInk({ ...base, curveInkBounds: undefined }, box), true);
});

test("visible cubic and quadratic digits survive the real vector-parser to ink-guard path", () => {
  const ops = { constructPath: 1, stroke: 2, save: 3, transform: 4, paintImageXObject: 5, restore: 6 };
  const fnArray = Array<number>(1000).fill(1);
  const argsArray: unknown[][] = Array.from({ length: 1000 }, () => [2, [new Float32Array([0, 800, 800, 1, 801, 800])]]);
  fnArray.push(1, 1, 3, 4, 5, 6);
  argsArray.push([2, [new Float32Array([0, 105, 102, 2, 100, 102, 100, 108, 105, 108, 2, 110, 108, 110, 102, 105, 102, 4])]],
    [2, [new Float32Array([0, 205, 202, 3, 200, 205, 205, 208, 1, 210, 208])]], [], [10, 0, 0, 10, 800, 800], ["remote-logo"], []);
  const geometry = extractVectorLines({ fnArray, argsArray }, ops, { width: 1000, height: 1000, transform: [1, 0, 0, 1, 0, 0] }, 1);
  assert.equal(geometry.vectorInkComplete, true);
  assert.equal(geometry.rasterGeometryComplete, true);
  assert.equal(geometry.curveInkBounds.length, 2, "all segments of a painted path share conservative bounds");
  assert.equal(geometry.lines.length, 1001, "curves are not invented straight dimension lines");
  assert.deepEqual(geometry.lines.at(-1)?.start, { x: .205, y: .208 }, "quadratic endpoint starts the next real line");
  const page = { ...base, ...geometry };
  assert.equal(hasLocatedDimensionInk(page, box), true);
  assert.equal(hasLocatedDimensionInk(page, { x: .2, y: .2, width: .02, height: .01 }), true);
  assert.equal(hasLocatedDimensionInk(page, { x: .3, y: .3, width: .02, height: .01 }), false, "empty positions still reject");
});

test("curve bounds contain control hulls under native typed Form matrices and restore", () => {
  const ops = { paintFormXObjectBegin: 1, constructPath: 2, stroke: 3, paintFormXObjectEnd: 4, setLineWidth: 5 };
  const curve = new Float32Array([0, 10, 20, 2, 30, 90, 70, -10, 80, 30]);
  const result = extractVectorLines({ fnArray: [5, 1, 2, 4, 2], argsArray: [[0], [new Float32Array([0, 2, -3, 0, 400, 100])],
    [3, [curve]], [], [3, [new Float32Array([0, 10, 20, 3, 20, 30, 40, 50])]]] }, ops,
  { width: 1000, height: 500, transform: [1, 0, 0, -1, 0, 500] }, 1);
  assert.equal(result.vectorInkComplete, true);
  assert.equal(result.lines.length, 0);
  const first = result.curveInkBounds[0];
  for (let i = 0; i <= 100; i++) {
    const t = i / 100, u = 1 - t;
    const px = u ** 3 * 10 + 3 * u ** 2 * t * 30 + 3 * u * t ** 2 * 70 + t ** 3 * 80;
    const py = u ** 3 * 20 + 3 * u ** 2 * t * 90 + 3 * u * t ** 2 * -10 + t ** 3 * 30;
    const x = (400 - 3 * py) / 1000, y = (500 - (100 + 2 * px)) / 500;
    assert.ok(x >= first.x && x <= first.x + first.width && y >= first.y && y <= first.y + first.height);
  }
  assert.ok(first.x < .13 && first.x + first.width > .43, "all transformed controls, not only curve endpoints");
  const restored = result.curveInkBounds[1];
  assert.ok(restored.x < .01 && restored.x + restored.width > .04);
  assert.ok(restored.y < .9 && restored.y + restored.height > .96, "Form end restores the previous transform");
});

test("unreadable curve geometry disables rejection; dense valid geometry remains bounded and complete", () => {
  const ops = { constructPath: 1, stroke: 2, beginGroup: 3 };
  const viewport = { width: 1000, height: 1000, transform: [1, 0, 0, 1, 0, 0] };
  for (const args of [[2, [new Float32Array([0, 100, 100, 99])]], [2, [new Float32Array([0, 100, 100, 2, 101])]],
    [2, [new Float32Array([0, 100, 100, 1, Infinity, 101])]], [2, [null]]]) {
    const result = extractVectorLines({ fnArray: [1], argsArray: [args] }, ops, viewport, 1);
    assert.equal(result.vectorInkComplete, false);
    assert.equal(hasLocatedDimensionInk({ ...base, ...result }, box), true);
  }
  const empty = extractVectorLines({ fnArray: [1], argsArray: [[2, [null], null]] }, ops, viewport, 1);
  assert.equal(empty.vectorInkComplete, true);
  const group = extractVectorLines({ fnArray: [3], argsArray: [[{ matrix: [2, 0, 0, 2, 0, 0] }]] }, ops, viewport, 1);
  assert.equal(group.vectorInkComplete, false);
  const commands = [0, 100, 100];
  for (let i = 0; i < 10_001; i++) commands.push(3, 105, 105, 110, 110);
  const oneDensePath = extractVectorLines({ fnArray: [1], argsArray: [[2, [new Float32Array(commands)]]] }, ops, viewport, 1);
  assert.equal(oneDensePath.vectorInkComplete, true, "path-wise bounds retain many curves without discarding ink");
  assert.equal(oneDensePath.curveInkBounds.length, 1);
  const overflow = extractVectorLines({ fnArray: Array<number>(10_001).fill(1),
    argsArray: Array.from({ length: 10_001 }, () => [2, [new Float32Array([0, 100, 100, 3, 105, 105, 110, 110])]]) }, ops, viewport, 1);
  assert.ok(overflow.curveInkBounds.length <= 10_000);
  assert.equal(overflow.vectorInkComplete, true, "budget coarsening retains all possible ink");
  assert.equal(overflow.warnings.length, 0);
  assert.equal(hasLocatedDimensionInk({ ...base, ...overflow }, box), true, "coarsening must preserve the original glyph region");
  for (const x of [.0995, .105, .1105]) for (const y of [.0995, .105, .1105]) {
    assert.ok(overflow.curveInkBounds.some((bound) => bound.x <= x && bound.x + bound.width >= x
      && bound.y <= y && bound.y + bound.height >= y), "all original padded hull corners remain covered");
  }
});

test("curve metadata is bounded, normalized and optional in analysis requests", () => {
  const payload = { fileName: "Plan.pdf", pages: [{ pageNumber: 1, width: 1000, height: 1000, text: "", textItems: [],
    curveInkBounds: [box], vectorInkComplete: true }] };
  assert.deepEqual(parseAnalysisRequest(payload).pages[0].curveInkBounds, [box]);
  assert.equal(parseAnalysisRequest(payload).pages[0].vectorInkComplete, true);
  const invalid = (bounds: unknown) => ({ ...payload, pages: [{ ...payload.pages[0], curveInkBounds: bounds }] });
  assert.equal(analysisRequestSchema.safeParse(invalid([{ x: .99, y: .1, width: .1, height: .01 }])).success, false);
  assert.equal(analysisRequestSchema.safeParse(invalid(Array(10_001).fill(box))).success, false);
  assert.equal(analysisRequestSchema.safeParse({ fileName: "Legacy.pdf", pages: [{ pageNumber: 1, width: 1000, height: 1000, text: "", textItems: [] }] }).success, true);
});

test("native image extents respect CTM, page rotation and graphics-state restore", () => {
  const ops = { save: 1, transform: 2, paintImageXObject: 3, restore: 4, paintImageXObjectRepeat: 5 };
  const list = { fnArray: [1, 2, 3, 4, 1, 2, 3, 4], argsArray: [[], [200, 0, 0, 100, 100, 200], ["logo"], [], [], [0, 200, -100, 0, 700, 300], ["rotated"], []] };
  const result = extractVectorLines(list, ops, { width: 1000, height: 1000, transform: [1, 0, 0, 1, 0, 0] }, 1);
  assert.equal(result.imageCount, 2);
  assert.equal(result.rasterGeometryComplete, true);
  assert.deepEqual(result.rasterImages, [{ x: .1, y: .2, width: .19999999999999998, height: .09999999999999998 }, { x: .6, y: .3, width: .09999999999999998, height: .2 }]);
  const grouped = extractVectorLines({ fnArray: [5], argsArray: [["repeated", 1, 1, [0, 0]]] }, ops, { width: 1000, height: 1000, transform: [1, 0, 0, 1, 0, 0] }, 1);
  assert.equal(grouped.rasterGeometryComplete, false);
});
