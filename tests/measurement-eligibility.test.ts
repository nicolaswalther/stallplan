import assert from "node:assert/strict";
import { test } from "node:test";
import { extractDeterministicMeasurements } from "../lib/deterministic";
import type { PdfLine, PdfPageData, PdfTextItem } from "../lib/types";

function text(value: string, x: number, y: number, width = 8, fontSize = 8): PdfTextItem {
  return { id: `${value}-${x}-${y}`, text: value, fontSize, orientation: 0, bbox: { x: x / 1000, y: y / 1000, width: width / 1000, height: fontSize / 1000 } };
}
function line(x1: number, y1: number, x2: number, y2: number): PdfLine {
  return { id: `${x1}-${y1}-${x2}-${y2}`, start: { x: x1 / 1000, y: y1 / 1000 }, end: { x: x2 / 1000, y: y2 / 1000 }, strokeWidth: .2 };
}
function page(textItems: PdfTextItem[], lines: PdfLine[], fullText = textItems.map((item) => item.text).join(" ")): PdfPageData {
  return { pageNumber: 1, width: 1000, height: 1000, text: fullText, textItems, lines, imageDataUrl: "", documentKind: "vector" };
}
function tickedRail(center: number, y: number, length: number) {
  const left = center - length / 2, right = center + length / 2;
  return [line(left, y, right, y), line(left, y - 4, left, y + 4), line(right, y - 4, right, y + 4)];
}

test("sub-glyph vectors do not turn bare position numbers into dimensions even with nearby crossings", () => {
  const items: PdfTextItem[] = [], vectors: PdfLine[] = [];
  for (const [index, value] of ["1", "16", "40"].entries()) {
    const center = 100 + index * 100;
    items.push(text(value, center - 4, 100, 8, 9));
    vectors.push(...tickedRail(center, 112, .72));
  }
  assert.deepEqual(extractDeterministicMeasurements([page(items, vectors)]), []);
});

test("a cubicle or wall edge meeting perpendicular corners is not a dimension delimiter", () => {
  const input = page([text("40", 110, 100, 10)], [line(100, 112, 130, 112), line(100, 80, 100, 112), line(130, 80, 130, 112)]);
  assert.deepEqual(extractDeterministicMeasurements([input]), []);
});

test("paired arrowheads support genuine unknown-unit geometry without requiring crossing ticks", () => {
  const input = page([text("40", 110, 100, 10)], [line(100, 112, 130, 112),
    line(100, 112, 104, 110), line(100, 112, 104, 114),
    line(130, 112, 126, 110), line(130, 112, 126, 114)]);
  const result = extractDeterministicMeasurements([input]);
  assert.equal(result.length, 1);
  assert.equal(result[0].value, 40);
  assert.equal(result[0].unit, "unknown");
  assert.equal(result[0].signals?.endpointSupport, 1);
});

test("a genuine short wall dimension requires independent scale and unit agreement instead of a glyph-size exception", () => {
  const items: PdfTextItem[] = [], vectors: PdfLine[] = [];
  let start = 100;
  for (let index = 0; index < 3; index++) {
    const length = 600 * 72 / 254, center = start + length / 2;
    items.push(text("600", center - 8, 100, 16));
    vectors.push(...tickedRail(center, 112, length));
    start += length;
  }
  const length = 6 * 72 / 254, short = text("6", 718, 490, 4);
  items.push(short); vectors.push(...tickedRail(720, 502, length));
  const result = extractDeterministicMeasurements([page(items, vectors, "1:100")]);
  const actual = result.find((measurement) => measurement.value === 6);
  assert.ok(actual);
  assert.equal(actual.unit, "cm");
  assert.ok(actual.signals!.scaleAgreement > .9);
  assert.deepEqual(extractDeterministicMeasurements([page([short], tickedRail(720, 502, length))]), []);
});

test("a raised area exponent overlapping the PDF advance box is excluded using its native baseline", () => {
  const base = text("Abkalbebucht - 78,90m", 100, 100, 100, 12);
  base.baseline = { x: .1, y: .112 };
  const exponent = text("2", 172, 100, 4, 8);
  exponent.baseline = { x: .172, y: .1084 };
  const vectors = tickedRail(174, 112, 40);
  assert.deepEqual(extractDeterministicMeasurements([page([base, exponent], vectors)]), []);
  const independent = { ...exponent, baseline: { x: .172, y: .112 } };
  const result = extractDeterministicMeasurements([page([base, independent], vectors)]);
  assert.equal(result.length, 1, "an ordinary same-baseline 2 is not globally banned");
  assert.equal(result[0].value, 2);
});

test("an explicit length remains readable while an incidental glyph vector is omitted from its provenance", () => {
  const input = page([text("12,5 m", 96, 100, 20)], tickedRail(106, 112, .72));
  const result = extractDeterministicMeasurements([input]);
  assert.equal(result.length, 1);
  assert.equal(result[0].value, 12.5);
  assert.equal(result[0].unit, "m");
  assert.equal(result[0].source, "pdf-text");
  assert.equal(result[0].dimensionLine, undefined);
});
