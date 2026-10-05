import assert from "node:assert/strict";
import { test } from "node:test";
import { roomNumberContext, withAreaImages, withPageImages } from "../lib/ai/context";
import { parseAnalysisRequest } from "../lib/plan/request";
import { applyVectorRoomContours } from "../lib/analysis/area-geometry";
import type { DetectedArea, PdfDetailImage, PdfPageData } from "../lib/types";

const image = (identifier: string) => `data:image/png;base64,${Buffer.from(identifier).toString("base64")}`;
const detail = (identifier: string): PdfDetailImage => ({ kind: "outline-text", bbox: { x: .72, y: .16, width: .18, height: .3 }, imageDataUrl: image(identifier), sourceLineIds: ["glyph-1", "glyph-2"], sourceLineCount: 200, rowCount: 8 });
function page(number = 1): PdfPageData {
  return { pageNumber: number, width: 1000, height: 800, documentKind: "vector", text: "", textItems: [], imageDataUrl: image(`page-${number}`), semanticDetails: [detail(`detail-${number}-1`), detail(`detail-${number}-2`)] };
}
const payload = (input: PdfPageData) => ({ fileName: "plan.pdf", pages: [input] });

test("area reading retains whole pages and supplies bounded detail images with global source coordinates", () => {
  const pages = Array.from({ length: 6 }, (_, index) => page(index + 1));
  const parts = withAreaImages("Bereiche erkennen", pages);
  const images = parts.filter((part) => part.type === "input_image");
  assert.equal(images.length, 8, "four whole pages plus at most four semantic crops");
  assert.deepEqual(images.slice(0, 4).map((part) => part.image_url), pages.slice(0, 4).map((input) => input.imageDataUrl));
  assert.deepEqual(images.slice(4).map((part) => part.image_url), [pages[0].semanticDetails![0].imageDataUrl, pages[0].semanticDetails![1].imageDataUrl, pages[1].semanticDetails![0].imageDataUrl, pages[1].semanticDetails![1].imageDataUrl]);
  const context = parts.filter((part) => part.type === "input_text").map((part) => part.text).join("\n");
  assert.ok(context.includes(`Ursprüngliche Seitenbox=${JSON.stringify(pages[0].semanticDetails![0].bbox)}`));
  assert.match(context, /Alle Ergebnisboxen bleiben globale Koordinaten der vollständigen Seite/);
  assert.match(context, /Dies ist KEINE Stallfläche/);
  assert.ok(!context.includes("Seitenbild 5"));
  assert.ok(!images.some((part) => part.image_url === pages[4].imageDataUrl));
  assert.equal(withPageImages("Maße", pages).filter((part) => part.type === "input_image").length, 4, "semantic detail crops do not enter the measurement input");
});

test("a page without a whole-page image cannot contribute an unplaced detail crop", () => {
  const unavailable = { ...page(1), imageDataUrl: "" };
  const available = page(2);
  const parts = withAreaImages("Bereiche", [unavailable, available]);
  const images = parts.filter((part) => part.type === "input_image");
  assert.equal(images.length, 3);
  assert.ok(!images.some((part) => part.image_url === unavailable.semanticDetails![0].imageDataUrl));
  assert.ok(parts.some((part) => part.type === "input_text" && part.text.includes("Seitenbild 2")));
});

test("room context cites exact unique PDF number anchors and never repurposes dimensions or duplicate indices", () => {
  const input: PdfPageData = { ...page(), textItems: [
    { id: "room-101", text: "101.", bbox: { x: .15, y: .35, width: .012, height: .01 } },
    { id: "room-7-a", text: "7.", bbox: { x: .2, y: .3, width: .01, height: .01 } },
    { id: "room-7-b", text: "7.", bbox: { x: .4, y: .5, width: .01, height: .01 } },
    { id: "dimension", text: "600", bbox: { x: .3, y: .1, width: .01, height: .01 } },
    { id: "scale", text: "1:100", bbox: { x: .9, y: .9, width: .01, height: .01 } },
  ] };
  const context = roomNumberContext([input]);
  assert.ok(context.includes('"number":"101"'));
  assert.ok(context.includes('"textItemId":"room-101"'));
  assert.ok(context.includes('"bbox":{"x":0.15,"y":0.35,"width":0.012,"height":0.01}'));
  assert.ok(!context.includes("room-7-a") && !context.includes("room-7-b"));
  assert.ok(!context.includes('"number":"600"'));
  assert.ok(!context.includes('"number":"1:100"'));
});

test("analysis requests preserve valid detail bounds and vector evidence alongside the exact native plan", () => {
  const input = page();
  const parsed = parseAnalysisRequest(payload(input));
  assert.deepEqual(parsed.pages[0].semanticDetails, input.semanticDetails);
  assert.deepEqual(parsed.pages[0].textItems, input.textItems);
  assert.equal(parsed.pages[0].imageDataUrl, input.imageDataUrl);
  const absent = { ...input, semanticDetails: undefined, imageDataUrl: undefined };
  assert.equal(parseAnalysisRequest({ fileName: "native.pdf", pages: [absent] }).pages[0].imageDataUrl, "");
});

test("remote, out-of-page, degenerate and oversized detail images are rejected at the request boundary", () => {
  const invalidDetails = [
    { ...detail("remote"), imageDataUrl: "https://example.com/image.png" },
    { ...detail("outside"), bbox: { x: .9, y: .1, width: .2, height: .4 } },
    { ...detail("negative"), bbox: { x: -.1, y: .1, width: .2, height: .4 } },
    { ...detail("empty-width"), bbox: { x: .2, y: .2, width: 0, height: .4 } },
    { ...detail("empty-height"), bbox: { x: .2, y: .2, width: .4, height: 0 } },
    { ...detail("too-large"), imageDataUrl: `data:image/png;base64,${"A".repeat(3_000_000)}` },
    { ...detail("too-many-lines"), sourceLineIds: Array.from({ length: 65 }, (_, index) => `line-${index}`) },
    { ...detail("no-source"), sourceLineCount: 0 },
  ];
  for (const invalid of invalidDetails) assert.throws(() => parseAnalysisRequest(payload({ ...page(), semanticDetails: [invalid] })));
  assert.throws(() => parseAnalysisRequest(payload({ ...page(), semanticDetails: [detail("a"), detail("b"), detail("c")] })));
  assert.throws(() => parseAnalysisRequest({ fileName: "plan.pdf", pages: [page(1), page(1)] }));
});

test("conflicting repeated semantic room identifiers cannot both claim one native contour", () => {
  const input: PdfPageData = { ...page(), textItems: [{ id: "room-7", text: "7.", bbox: { x: .25, y: .25, width: .01, height: .01 } }],
    lines: [[.1,.1,.4,.1],[.1,.4,.4,.4],[.1,.1,.1,.4],[.4,.1,.4,.4]].map(([x,y,x2,y2], index) => ({ id: `wall-${index}`, start: { x, y }, end: { x: x2, y: y2 }, strokeWidth: .6 })) };
  const area: DetectedArea = { id: "one", kind: "calving", originalLabel: "7. Abkalbebucht", label: "Abkalbebucht", hasBbox: true, bbox: { x: .1, y: .1, width: .3, height: .3 }, pageNumber: 1, source: "ai", status: "unconfirmed", confidence: .95, evidence: [] };
  const other: DetectedArea = { ...area, id: "two", kind: "cubicles", label: "Liegeboxen", originalLabel: "7. Liegeboxen" };
  const result = applyVectorRoomContours([area, other], [input]);
  assert.equal(result[0].footprint, undefined);
  assert.equal(result[1].footprint, undefined);
  assert.equal(result[0], area);
  assert.equal(result[1], other);
});
