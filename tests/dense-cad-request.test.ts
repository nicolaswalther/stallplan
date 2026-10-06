import assert from "node:assert/strict";
import test from "node:test";
import { parseAnalysisRequest } from "../lib/plan/request";
import { encodeAnalysisBody } from "../lib/plan/transport";
import { readAnalysisBody } from "../lib/plan/request-body";

const page = { pageNumber: 1, width: 1684, height: 1191, text: "", textItems: [], documentKind: "vector" as const,
  imageDataUrl: "data:image/jpeg;base64,YQ==" };
const tile = { bbox: { x: .1, y: .2, width: .25, height: .4 }, imageDataUrl: "data:image/jpeg;base64,YQ==", pixelWidth: 1200, pixelHeight: 800 };

test("a 180145-segment CAD drawing survives compressed transport and request validation intact", async () => {
  const lines = Array.from({ length: 180_145 }, (_, index) => {
    const x = (index % 601) / 602, y = Math.floor(index / 601) / 301;
    return { id: `p1-line-${index}`, start: { x, y },
      end: { x: x + .00034892349817234, y: y + .0002349234892349 }, strokeWidth: .48 };
  });
  const encoded = await encodeAnalysisBody({ fileName: "Rzut.pdf", pages: [{ ...page, lines }] });
  assert.equal(encoded.headers["Content-Encoding"], "gzip");
  const decoded = await readAnalysisBody(new Request("http://localhost/api/analyze", { method: "POST", ...encoded }));
  const accepted = parseAnalysisRequest(decoded);
  assert.equal(accepted.pages[0].lines!.length, lines.length);
  for (const index of [0, 150_000, 180_144]) assert.deepEqual(accepted.pages[0].lines![index], lines[index]);
});

test("area crops retain explicit page mapping and bounded image dimensions", () => {
  const accepted = parseAnalysisRequest({ fileName: "Plan.pdf", pages: [{ ...page, areaDetailImages: [tile] }] });
  assert.deepEqual(accepted.pages[0].areaDetailImages, [tile]);
  for (const invalid of [
    { ...tile, bbox: { ...tile.bbox, x: .9 } },
    { ...tile, bbox: { ...tile.bbox, width: 0 } },
    { ...tile, pixelWidth: 1801 },
    { ...tile, pixelWidth: 1800, pixelHeight: 1800 },
    { ...tile, pixelHeight: 10.5 },
    { ...tile, imageDataUrl: "data:image/jpeg;base64," + "A".repeat(3_000_000) },
  ]) assert.throws(() => parseAnalysisRequest({ fileName: "Plan.pdf", pages: [{ ...page, areaDetailImages: [invalid] }] }));
});

test("area crop count is bounded across the entire request", () => {
  assert.doesNotThrow(() => parseAnalysisRequest({ fileName: "Plan.pdf", pages: [
    { ...page, areaDetailImages: [tile, tile] }, { ...page, pageNumber: 2, areaDetailImages: [tile, tile] },
  ] }));
  assert.throws(() => parseAnalysisRequest({ fileName: "Plan.pdf", pages: [{ ...page, areaDetailImages: [tile, tile, tile, tile, tile] }] }));
  assert.throws(() => parseAnalysisRequest({ fileName: "Plan.pdf", pages: [
    { ...page, areaDetailImages: [tile, tile, tile] }, { ...page, pageNumber: 2, areaDetailImages: [tile, tile] },
  ] }));
});
