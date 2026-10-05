import assert from "node:assert/strict";
import { test } from "node:test";
import { detectOutlineTextRegions, detectRoomNumberAnchors } from "../lib/geometry/semantic-regions";
import type { PdfLine, PdfPageData, PdfTextItem } from "../lib/types";

function page(lines: PdfLine[] = [], textItems: PdfTextItem[] = []): PdfPageData {
  return { pageNumber: 1, width: 1000, height: 1000, imageDataUrl: "", text: "", textItems, lines };
}
function text(id: string, value: string, x = 0.2): PdfTextItem {
  return { id, text: value, fontSize: 8, orientation: 0, bbox: { x, y: 0.3, width: 0.01, height: 0.008 } };
}
function outlinedRows(rows = 8, strokeWidth = 0): PdfLine[] {
  const result: PdfLine[] = [];
  for (let row = 0; row < rows; row++) for (let letter = 0; letter < 18; letter++) {
    const x = 200 + letter * 6, y = 200 + row * 12;
    for (const [dx1, dy1, dx2, dy2] of [[0, 0, 0, 5], [0, 0, 3, 0], [3, 0, 3, 5], [0, 5, 3, 5]]) {
      result.push({ id: `glyph-${row}-${letter}-${dx1}-${dy1}-${dx2}-${dy2}`, start: { x: (x + dx1) / 1000, y: (y + dy1) / 1000 }, end: { x: (x + dx2) / 1000, y: (y + dy2) / 1000 }, strokeWidth });
    }
  }
  return result;
}

test("native dotted room candidates preserve exact text coordinates and exclude ambiguity", () => {
  const items = [text("one", "1."), text("two-a", "2."), text("two-b", "2.", 0.4), text("dimension", "600"), text("scale", "1:100"), text("date", "02.07.2020"), text("zero", "0."), text("bad", "3.", -1)];
  const output = detectRoomNumberAnchors(page([], items));
  assert.equal(output.length, 1);
  assert.deepEqual(output[0], { number: "1", text: "1.", textItemId: "one", bbox: items[0].bbox });
  assert.equal(output[0].bbox, items[0].bbox);
  assert.equal(items[0].text, "1.");
});

test("multiple outlined text rows become a bounded reading crop with vector provenance", () => {
  const strokes = outlinedRows();
  const output = detectOutlineTextRegions(page(strokes));
  assert.equal(output.length, 1);
  assert.equal(output[0].source, "pdf-vectors");
  assert.equal(output[0].rowCount, 8);
  assert.equal(output[0].sourceLineCount, strokes.length);
  assert.ok(output[0].sourceLineIds.length <= 64);
  assert.ok(output[0].bbox.x < .2 && output[0].bbox.x + output[0].bbox.width > .305);
  assert.ok(output[0].bbox.y < .2 && output[0].bbox.y + output[0].bbox.height > .289);
  assert.ok(output[0].bbox.width < .15 && output[0].bbox.height < .15, "no whole-page fallback crop");
});

test("painted hatching, long dimension rails and a single legend row do not masquerade as outlined schedules", () => {
  assert.deepEqual(detectOutlineTextRegions(page(outlinedRows(8, 0.6))), []);
  assert.deepEqual(detectOutlineTextRegions(page(outlinedRows(1))), []);
  const dimensions: PdfLine[] = Array.from({ length: 300 }, (_, index) => ({ id: `dimension-${index}`, start: { x: .1, y: .1 + index * .002 }, end: { x: .8, y: .1 + index * .002 }, strokeWidth: 0 }));
  assert.deepEqual(detectOutlineTextRegions(page(dimensions)), []);
  const clean = detectOutlineTextRegions(page(outlinedRows()));
  const withNoise = detectOutlineTextRegions(page([...outlinedRows(), ...dimensions, ...outlinedRows(8, .6)]));
  assert.deepEqual(withNoise, clean);
});

test("empty and invalid pages fail locally without replacing exact native data", () => {
  for (const p of [page(), { ...page(outlinedRows()), width: 0 }, { ...page(outlinedRows()), height: Number.NaN }]) assert.deepEqual(detectOutlineTextRegions(p), []);
  const invalid = outlinedRows().map((line) => ({ ...line, start: { ...line.start, x: Number.NaN } }));
  assert.deepEqual(detectOutlineTextRegions(page(invalid)), []);
});
