import assert from "node:assert/strict";
import test from "node:test";
import { detectCubiclePatterns } from "../lib/geometry/cubicle-patterns";
import { detectStructuralAreas, mergeDetectedAreas } from "../lib/analysis/areas";
import type { DetectedArea, PdfLine, PdfPageData } from "../lib/types";

function fixture(left = 100, right = 380): PdfPageData {
  const width = 1000, height = 700;
  const line = (id: string, x: number, from: number, to: number): PdfLine => ({ id,
    start: { x: x / width, y: from / height }, end: { x: x / width, y: to / height } });
  const lines = [line("left-end", left, 200, 320), line("right-end", right, 200, 320)];
  for (let x = left + 20; x < right; x += 20) for (const offset of [-.7, .7]) {
    lines.push(line(`upper-${x}-${offset}`, x + offset, 207, 238), line(`lower-${x}-${offset}`, x + offset, 282, 313));
  }
  return { pageNumber: 1, width, height, text: "", textItems: [], imageDataUrl: "", documentKind: "mixed", lines,
    rasterGeometryComplete: true,
    rasterImages: [254, 266].flatMap((y) => [left, right].map((x) => ({ x: (x - .2) / width, y: (y - .9) / height, width: .4 / width, height: 1.8 / height }))),
  };
}

test("paired tiny end masks and two regular divider families locate a native double row", () => {
  const page = fixture();
  const areas = detectStructuralAreas([page]);
  assert.equal(areas.length, 1);
  const area = areas[0];
  assert.deepEqual(area.bbox, { x: .1, y: 200 / 700, width: .28, height: 120 / 700 });
  assert.equal(area.source, "geometry");
  assert.equal(area.confidence, .88);
  assert.equal(area.status, "unconfirmed");
  assert.equal(area.patternProvenance?.method, "repeated-cubicle-geometry");
  assert.equal(area.patternProvenance?.dividerCount, 13);
  assert.equal(area.patternProvenance?.spacingPoints, 20);
  assert.deepEqual(area.patternProvenance?.rasterImageIndices, [0, 2, 1, 3]);
  assert.ok(area.patternProvenance?.sourceLineIds.includes("right-end"));
  assert.equal(area.originalLabel, undefined);
});

test("strokes without end masks, single-sided furniture and irregular spacing cannot invent cubicle rows", () => {
  const page = fixture();
  const cases: PdfPageData[] = [
    { ...page, rasterImages: [] }, { ...page, rasterGeometryComplete: false },
    { ...page, rasterImages: page.rasterImages!.slice(0, 2) },
    { ...page, rasterImages: page.rasterImages!.map((box) => ({ ...box, width: .2, height: .2 })) },
    { ...page, lines: page.lines!.filter((line) => !line.id.startsWith("lower")) },
    { ...page, lines: page.lines!.filter((line) => !line.id.startsWith("upper-220") && !line.id.startsWith("lower-220")) },
    { ...page, lines: page.lines!.filter((line) => line.id !== "right-end") },
    fixture(100, 200),
  ];
  for (const candidate of cases) assert.deepEqual(detectCubiclePatterns(candidate), []);
});

test("adjacent paired cap groups remain separate across their unsupported passage", () => {
  const first = fixture(), second = fixture(440, 720);
  const page = { ...first, rasterImages: [...first.rasterImages!, ...second.rasterImages!],
    lines: [...first.lines!, ...second.lines!.map((line) => ({ ...line, id: `second-${line.id}` }))] };
  const rows = detectCubiclePatterns(page);
  assert.equal(rows.length, 2);
  assert.ok(rows[0].bbox.x + rows[0].bbox.width < rows[1].bbox.x);
  assert.equal(rows[0].patternProvenance?.dividerCount, 13);
  assert.equal(rows[1].patternProvenance?.dividerCount, 13);
  const mega: DetectedArea = { ...rows[0], id: "model-all", source: "ai", patternProvenance: undefined,
    bbox: { x: .1, y: 200 / 700, width: .62, height: 120 / 700 } };
  assert.deepEqual(mergeDetectedAreas(rows, [mega]).map((area) => area.id), rows.map((area) => area.id));
  assert.equal(mergeDetectedAreas(rows, [{ ...mega, id: "model-correct", bbox: rows[0].bbox }]).length, 2);
  assert.equal(mergeDetectedAreas(rows, [{ ...mega, source: "manual" }]).length, 3);
  assert.equal(mergeDetectedAreas(rows, [{ ...mega, geometryCorrections: [{ at: "2026-10-06T00:00:00Z", source: "customer", bbox: mega.bbox }] }]).length, 3);
});

test("the named primary room function excludes subordinate furnishing patterns", () => {
  const page = fixture();
  for (const text of ["SEPARATKA - 10 LEGOWISK", "PORODÓWKA", "Jungviehbucht"]) {
    const label = { text, bbox: { x: .22, y: .35, width: .05, height: .02 } };
    assert.deepEqual(detectStructuralAreas([{ ...page, textItems: [label], text }]), []);
  }
  assert.equal(detectStructuralAreas([{ ...page, textItems: [{ text: "600", bbox: { x: .22, y: .35, width: .05, height: .02 } }] }]).length, 1);
});

test("reversed line directions, duplicate strokes and page normalization preserve the same proof", () => {
  const page = fixture();
  const expected = detectCubiclePatterns(page)[0];
  const reversed = { ...page, width: 2000, height: 1400,
    lines: [...page.lines!, ...page.lines!.map((line) => ({ ...line, id: `copy-${line.id}`, start: line.end, end: line.start }))],
    // Keep actual endpoint mask sizes small in the larger PDF coordinate space.
    rasterImages: page.rasterImages!.map((box) => ({ ...box, width: box.width / 2, height: box.height / 2 })),
  };
  const result = detectCubiclePatterns(reversed);
  assert.equal(result.length, 1);
  assert.deepEqual(result[0].bbox, expected.bbox);
  assert.equal(result[0].patternProvenance?.dividerCount, expected.patternProvenance?.dividerCount);
});

test("native lines in the extraction overscan cannot generate clamped cubicle row endpoints", () => {
  const leftOverscan = fixture(-1, 279), rightOverscan = fixture(722, 1002);
  assert.deepEqual(detectCubiclePatterns(leftOverscan), []);
  assert.deepEqual(detectCubiclePatterns(rightOverscan), []);
  assert.equal(leftOverscan.lines![0].start.x, -.001);
  assert.equal(rightOverscan.lines![1].start.x, 1.002);
});
