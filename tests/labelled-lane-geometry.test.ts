import assert from "node:assert/strict";
import test from "node:test";
import { detectStructuralAreas, mergeDetectedAreas } from "../lib/analysis/areas";
import type { DetectedArea, PdfLine, PdfPageData } from "../lib/types";

const width = 1000, height = 700;
function line(id: string, x1: number, y1: number, x2: number, y2: number): PdfLine {
  return { id, start: { x: x1 / width, y: y1 / height }, end: { x: x2 / width, y: y2 / height } };
}
const slash = (id: string, x: number, y: number) => line(id, x - .8, y - .8, x + .8, y + .8);

function closedStrip(text: string): PdfPageData {
  return { pageNumber: 1, width, height, text, imageDataUrl: "", documentKind: "vector",
    textItems: [250, 650].map((x, index) => ({ id: `label-${index}`, text,
      bbox: { x: x / width, y: 280 / height, width: .07, height: 10 / height } })),
    lines: [line("top", 100, 200, 900, 200), line("bottom", 100, 400, 900, 400),
      line("left", 100, 200, 100, 400), line("right", 900, 200, 900, 400)] };
}

test("a slash-bounded internal dimension does not partition a repeated feeding strip", () => {
  const page = closedStrip("STÓŁ PASZOWY");
  page.lines!.push(slash("cap-top", 450, 200), line("dimension", 450, 200, 450, 400), slash("cap-bottom", 450, 400));
  const result = detectStructuralAreas([page]);
  assert.equal(result.length, 1);
  assert.deepEqual(result[0].bbox, { x: .1, y: 200 / height, width: .8, height: 200 / height });
  assert.ok(result[0].evidence.some((entry) => entry.includes("2 identische")));
});

test("a real partition survives later coincident dimension caps from another paint sequence", () => {
  const page = closedStrip("STÓŁ PASZOWY");
  page.lines!.push(line("partition", 450, 200, 450, 400));
  for (let index = 0; index < 30; index++) page.lines!.push(line(`unrelated-${index}`, 20, 20 + index, 21, 20 + index));
  page.lines!.push(slash("cap-top", 450, 200), line("dimension", 450, 200, 450, 400), slash("cap-bottom", 450, 400));
  const result = detectStructuralAreas([page]);
  assert.equal(result.length, 2);
  assert.ok(result.every((area) => area.bbox.width < .5));
  assert.ok(result.every((area) => !area.evidence.some((entry) => entry.includes("2 identische"))));
});

test("a dimensioned local cross-passage remains narrow instead of spreading into adjacent furniture", () => {
  const page = closedStrip("átjáró");
  page.textItems = [{ text: "átjáró", bbox: { x: .63, y: 280 / height, width: .05, height: 10 / height } }];
  for (const x of [600, 720]) page.lines!.push(slash(`cap-${x}-top`, x, 200),
    line(`opening-${x}`, x, 200, x, 400), slash(`cap-${x}-bottom`, x, 400));
  const result = detectStructuralAreas([page]);
  assert.equal(result.length, 1);
  assert.equal(result[0].bbox.x, .6);
  assert.ok(Math.abs(result[0].bbox.width - .12) < 1e-9);
});

function nativeRow(left: number, right: number, suffix: string): { lines: PdfLine[]; masks: NonNullable<PdfPageData["rasterImages"]> } {
  const lines = [line(`end-left-${suffix}`, left, 200, left, 320), line(`end-right-${suffix}`, right, 200, right, 320)];
  for (let x = left + 20; x < right; x += 20) for (const offset of [-.7, .7]) {
    lines.push(line(`upper-${suffix}-${x}-${offset}`, x + offset, 207, x + offset, 238),
      line(`lower-${suffix}-${x}-${offset}`, x + offset, 282, x + offset, 313));
  }
  return { lines, masks: [254, 266].flatMap((y) => [left, right].map((x) => ({
    x: (x - .2) / width, y: (y - .9) / height, width: .4 / width, height: 1.8 / height,
  }))) };
}

function openLane(): PdfPageData {
  const first = nativeRow(100, 380, "first"), second = nativeRow(440, 720, "second");
  const text = "GANEK GNOJOWY";
  return { pageNumber: 1, width, height, text, imageDataUrl: "", documentKind: "mixed",
    rasterGeometryComplete: true, rasterImages: [...first.masks, ...second.masks],
    textItems: [220, 570].map((x, index) => ({ id: `label-${index}`, text,
      bbox: { x: x / width, y: 360 / height, width: .065, height: 10 / height } })),
    lines: [...first.lines, ...second.lines, line("upper-first", 100, 320, 380, 320),
      line("upper-second", 440, 320, 760, 320), line("lower", 100, 410, 760, 410),
      line("outer-wall", 760, 320, 760, 410),
      ...Array.from({ length: 53 }, (_, index) => line(`floor-${index}`, 100 + index * 12.6, 320, 100 + index * 12.6, 410))] };
}

test("repeated labels and native row boundaries recover the complete lane across a proven crossing", () => {
  const page = openLane();
  const areas = detectStructuralAreas([page]);
  const alleys = areas.filter((area) => area.kind === "alley");
  assert.equal(areas.filter((area) => area.kind === "cubicles").length, 2);
  assert.equal(alleys.length, 1);
  const expected = { x: .1, y: 320 / height, width: .66, height: 90 / height };
  for (const coordinate of ["x", "y", "width", "height"] as const) assert.ok(Math.abs(alleys[0].bbox[coordinate] - expected[coordinate]) < 1e-9);
  assert.equal(alleys[0].source, "geometry");
  assert.equal(alleys[0].status, "unconfirmed");
  assert.equal(alleys[0].confidence, .89);
  assert.deepEqual(alleys[0].boundaryAssessment?.supportedSides, ["top", "bottom"]);
  assert.ok(alleys[0].boundaryAssessment?.sourceLineIds.includes("upper-first"));
  assert.equal(alleys[0].stripProvenance?.method, "labelled-cubicle-adjacent-band");
  assert.deepEqual(alleys[0].stripProvenance?.textItemIds, ["label-0", "label-1"]);
  assert.ok(alleys[0].evidence.some((entry) => entry.includes("offenes Gangende")));
});

test("a same-label AI fragment or overhang cannot replace or duplicate a complete native lane", () => {
  const native = detectStructuralAreas([openLane()]).find((area) => area.kind === "alley")!;
  const fragment: DetectedArea = { ...native, id: "model-fragment", source: "ai", stripProvenance: undefined,
    bbox: { ...native.bbox, x: .22, width: .15 }, confidence: .99 };
  const overhang: DetectedArea = { ...fragment, id: "model-overhang", bbox: { ...native.bbox, x: .05, width: .8 } };
  assert.deepEqual(mergeDetectedAreas([native], [fragment, overhang]), [native]);
  for (const reviewed of [
    { ...fragment, source: "manual" as const }, { ...fragment, status: "confirmed" as const },
    { ...fragment, geometryCorrections: [{ at: "2026-10-06", bbox: fragment.bbox, source: "customer" as const }] },
    { ...fragment, originalLabel: "Korytarz spacerowy" },
  ]) assert.equal(mergeDetectedAreas([native], [reviewed]).length, 2);
  const weak: DetectedArea = { ...native, stripProvenance: undefined, confidence: .82 };
  assert.equal(mergeDetectedAreas([weak], [fragment]).length, 2, "an ordinary small enclosure is not proof of a whole lane");
});

test("an unsupported gap, missing native row proof or a conflicting function cannot produce a full lane", () => {
  const page = openLane();
  const cases: PdfPageData[] = [
    { ...page, rasterGeometryComplete: false },
    { ...page, rasterImages: page.rasterImages!.slice(0, 4) },
    { ...page, lines: page.lines!.filter((segment) => segment.id !== "upper-first") },
    { ...page, textItems: [...page.textItems, { text: "PORODÓWKA", bbox: { x: .45, y: 360 / height, width: .04, height: 10 / height } }] },
    { ...page, textItems: page.textItems.slice(0, 1) },
  ];
  for (const candidate of cases) assert.ok(detectStructuralAreas([candidate]).filter((area) => area.kind === "alley")
    .every((area) => area.bbox.width < .6), "weak evidence must not invent a whole-row envelope");
});

test("hatch suppression preserves distant genuine side walls outside the periodic run", () => {
  const page = closedStrip("GANEK GNOJOWY");
  for (let index = 0; index < 40; index++) page.lines!.push(line(`floor-${index}`, 230 + index * 13, 200, 230 + index * 13, 400));
  const result = detectStructuralAreas([page]);
  assert.equal(result.length, 1);
  assert.equal(result[0].bbox.x, .1);
  assert.equal(result[0].bbox.width, .8);
});
