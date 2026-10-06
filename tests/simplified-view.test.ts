import assert from "node:assert/strict";
import { test } from "node:test";
import { buildSimplifiedPlan, hiddenVectorLayerReason } from "../lib/pdf/simplified-view";
import type { PdfLine, PdfPageData } from "../lib/types";

function page(lines: PdfLine[], width = 1000, height = 800): PdfPageData {
  return { pageNumber: 1, width, height, text: "", textItems: [], imageDataUrl: "", lines, documentKind: "vector" };
}

test("simplified paths use original PDF coordinates and preserve source geometry", () => {
  const input = page([
    { id: "wall", start: { x: .13, y: .22 }, end: { x: .86, y: .22 } },
    { id: "short", start: { x: .4, y: .6 }, end: { x: .401, y: .602 } },
  ], 1683.78, 1190.55);
  const before = JSON.stringify(input);
  const result = buildSimplifiedPlan(input);
  assert.equal(result.available, true);
  assert.equal(result.width, input.width);
  assert.equal(result.height, input.height);
  assert.equal(result.paths.find((path) => path.kind === "structure")?.d, "M218.8914 261.921L1448.0508 261.921");
  assert.deepEqual(result.paths.find((path) => path.kind === "detail")?.sourceLineIds, ["short"]);
  assert.equal(JSON.stringify(input), before);
});

test("only proven pure hatch and annotation layers are hidden", () => {
  assert.equal(hiddenVectorLayerReason("GEA_Kreskowanie_ruszta"), "named-hatching");
  assert.equal(hiddenVectorLayerReason("GEA_Kreskowanie_sloma"), "named-hatching");
  assert.equal(hiddenVectorLayerReason("A-Detl-Patt"), "named-hatching");
  assert.equal(hiddenVectorLayerReason("TitleblockText"), "named-annotation");
  assert.equal(hiddenVectorLayerReason("S-Grid-Iden"), "named-annotation");
  assert.equal(hiddenVectorLayerReason("GEA_Opisy"), "named-annotation");
  for (const layer of ["A-Wall", "A-Door", "GEA-Bramki", "Wall_Text", "Dimension_Hatch", "Equipment_Hatching", "Hatchery", "0"])
    assert.equal(hiddenVectorLayerReason(layer), null, layer);
  const input = page(["hatch", "annotation", "door"].map((id) => ({ id, start: { x: .1, y: .2 }, end: { x: .101, y: .2 } })));
  const result = buildSimplifiedPlan(input, { lineLayerNames: { hatch: "GEA_Kreskowanie_ruszta", annotation: "Titleblock", door: "A-Door" } });
  assert.deepEqual(result.hidden, [
    { reason: "named-hatching", sourceLineIds: ["hatch"] },
    { reason: "named-annotation", sourceLineIds: ["annotation"] },
  ]);
  assert.deepEqual(result.paths[0].sourceLineIds, ["door"]);
  assert.equal(result.paths[0].kind, "structure", "small native door geometry is retained");
});

test("regular cubicle and unknown dense parallel geometry is retained without hatch inference", () => {
  const input = page(Array.from({ length: 100 }, (_, index) => ({ id: `divider-${index}`,
    start: { x: .2 + index / 1000, y: .3 }, end: { x: .2 + index / 1000, y: .34 } })));
  const result = buildSimplifiedPlan(input);
  assert.equal(result.stats.structuralLines, 100);
  assert.equal(result.stats.hiddenHatchingLines, 0);
  assert.equal(result.paths.flatMap((path) => path.sourceLineIds).length, 100);
});

test("large drawings are batched and coincident segments retain all audit IDs", () => {
  const lines: PdfLine[] = Array.from({ length: 180_000 }, (_, index) => ({ id: `native-${index}`,
    start: { x: index / 180_001, y: .1 }, end: { x: index / 180_001, y: .2 } }));
  lines.push({ ...lines[0], id: "coincident", start: lines[0].end, end: lines[0].start });
  const result = buildSimplifiedPlan(page(lines));
  assert.equal(result.stats.nativeLines, 180_001);
  assert.equal(result.stats.renderedSegments, 180_000);
  assert.equal(result.paths.length, 23, "bounded path chunks replace 180k DOM elements");
  const sourceIds = result.paths.flatMap((path) => path.sourceLineIds);
  assert.equal(sourceIds.length, 180_001);
  assert.equal(new Set(sourceIds).size, 180_001);
  assert.ok(sourceIds.includes("coincident"));
  assert.ok(result.paths[0].sourceLineIds.includes("coincident"), "coincident provenance remains with its own segment chunk");
});

test("no vector availability is advertised for a scan, invalid page or invalid segments", () => {
  assert.equal(buildSimplifiedPlan({ ...page([]), documentKind: "raster", imageCount: 1 }).available, false);
  assert.equal(buildSimplifiedPlan(page([], 0)).available, false);
  const result = buildSimplifiedPlan(page([
    { id: "bad", start: { x: Number.NaN, y: .1 }, end: { x: .1, y: .2 } },
    { id: "off-page", start: { x: 1.2, y: .1 }, end: { x: 1.3, y: .2 } },
    { id: "empty", start: { x: .1, y: .1 }, end: { x: .1, y: .1 } },
  ]));
  assert.equal(result.available, false);
  assert.equal(result.stats.invalidLines, 3);
  assert.deepEqual(result.paths, []);
});

test("scans with native borders and unlocated or large raster drawings retain the original", () => {
  const input = page([{ id: "native-axis", start: { x: .1, y: .2 }, end: { x: .9, y: .2 } }]);
  assert.equal(buildSimplifiedPlan({ ...input, documentKind: "raster", imageCount: 1 }).available, false);
  assert.equal(buildSimplifiedPlan({ ...input, documentKind: "mixed", imageCount: 1, rasterGeometryComplete: false }).available, false);
  assert.equal(buildSimplifiedPlan({ ...input, documentKind: "mixed", imageCount: 1, rasterGeometryComplete: true,
    rasterImages: [{ x: .25, y: .25, width: .5, height: .5 }] }).available, false);
  assert.equal(buildSimplifiedPlan({ ...input, documentKind: "mixed", imageCount: 22, rasterGeometryComplete: true,
    rasterImages: Array.from({ length: 22 }, (_, index) => ({ x: .1 + index / 100, y: .3, width: .005, height: .005 })) }).available, true,
  "small, mapped equipment symbols do not suppress a usable native vector drawing");
});
