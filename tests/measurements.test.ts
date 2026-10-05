import assert from "node:assert/strict";
import test from "node:test";
import { extractDeterministicMeasurements } from "../lib/deterministic";
import { extractTextObjects } from "../lib/pdf/text-extraction";
import { extractVectorLines, classifyDocument } from "../lib/pdf/vector-extraction";
import type { PdfLine, PdfPageData, PdfTextItem } from "../lib/types";

function item(text: string, x: number, y: number, width = 18, fontSize = 8, orientation = 0): PdfTextItem {
  return { id: `${text}-${x}-${y}`, text, fontSize, orientation, bbox: { x: x / 1000, y: y / 1000, width: width / 1000, height: fontSize / 1000 } };
}
function line(x1: number, y1: number, x2: number, y2: number): PdfLine {
  return { id: `${x1}:${y1}:${x2}:${y2}`, start: { x: x1 / 1000, y: y1 / 1000 }, end: { x: x2 / 1000, y: y2 / 1000 }, strokeWidth: 0.2 };
}
function page(textItems: PdfTextItem[], lines: PdfLine[] = [], text = textItems.map((t) => t.text).join(" ")): PdfPageData {
  return { pageNumber: 1, width: 1000, height: 1000, textItems, text, lines, imageDataUrl: "", documentKind: "vector" };
}
function chain(values = [600, 600, 600], scale: string | null = "1:100") {
  const textItems: PdfTextItem[] = [], lines: PdfLine[] = [];
  let x = 100;
  for (const value of values) {
    const length = value * 72 / 254;
    textItems.push(item(String(value), x + length / 2 - 9, 190));
    lines.push(line(x, 200, x + length, 200), line(x, 196, x, 204), line(x + length, 196, x + length, 204));
    x += length;
  }
  if (scale) textItems.push(item(scale, 900, 900));
  return page(textItems, lines);
}

test("repeated bare values survive by position; scale and vector lengths establish cm", () => {
  const result = extractDeterministicMeasurements([chain()]);
  assert.equal(result.length, 3);
  assert.ok(result.every((m) => m.value === 600 && m.unit === "cm" && m.status === "confirmed"));
  assert.equal(new Set(result.map((m) => m.id)).size, 3);
  assert.equal(new Set(result.map((m) => m.chainId)).size, 1);
  assert.ok(result.every((m) => m.dimensionLine && (m.signals?.scaleAgreement ?? 0) > .999));
});

test("unit stays unknown without scale or explicit unit evidence, while geometry remains usable", () => {
  const result = extractDeterministicMeasurements([chain([600, 600, 600], null)]);
  assert.equal(result.length, 3);
  assert.ok(result.every((m) => m.unit === "unknown" && m.status === "unconfirmed"));
});

test("conflicting printed scales never infer a global unit", () => {
  const p = chain(); p.text += " Detail 1:20";
  const result = extractDeterministicMeasurements([p]);
  assert.equal(result.length, 3);
  assert.ok(result.every((m) => m.unit === "unknown"));
});

test("metadata, room IDs, elevation, livestock, volume and separate superscripts are excluded", () => {
  const fixtures = ["94 DJP", "2500 m3", "2500 m³", "42 m²", "1:100", "20.04.2026", "18/10", "7.", "0,00=136,6m n.p.m.", "h=2,9 m"];
  const p = page(fixtures.map((text, i) => item(text, 100, 100 + i * 50)));
  p.textItems.push(item("9 m", 700, 100, 20, 10), item("3", 721, 97, 4, 6));
  p.textItems.push(item("12 m", 700, 200, 25, 10), item("2", 726, 197, 4, 6));
  p.textItems.push(item("0,18", 500, 500), item("+", 490, 500, 4));
  assert.deepEqual(extractDeterministicMeasurements([p]), []);
});

test("explicit length remains available without a vector or inferred unit", () => {
  const result = extractDeterministicMeasurements([page([item("12,50 m", 100, 100, 36)])]);
  assert.equal(result.length, 1); assert.equal(result[0].value, 12.5); assert.equal(result[0].unit, "m");
});

test("unrelated numbers and distant collinear rails cannot create a dimension chain", () => {
  const p = chain([600, 600, 600]);
  const last = p.textItems[2]; last.bbox.x += 0.1;
  p.lines = p.lines!.map((l, i) => i >= 6 ? { ...l, start: { x: l.start.x + 0.1, y: l.start.y }, end: { x: l.end.x + 0.1, y: l.end.y } } : l);
  p.textItems.push(item("25", 600, 600));
  const result = extractDeterministicMeasurements([p]);
  assert.equal(result.length, 3); assert.ok(result[0].chainId); assert.equal(result[2].chainId, undefined);
});

test("two connected partial dimensions link to the mathematically matching total", () => {
  const p = chain([2994, 1230, 600]);
  // Third independent segment provides unit evidence without being part of the two-member chain.
  p.textItems[2].bbox.y += 0.05;
  p.lines = p.lines!.map((l, i) => i >= 6 ? { ...l, start: { ...l.start, y: l.start.y + 0.05 }, end: { ...l.end, y: l.end.y + 0.05 } } : l);
  const length = 4224 * 72 / 254;
  p.textItems.push(item("4224", 100 + length / 2 - 12, 170, 24));
  p.lines!.push(line(100, 180, 100 + length, 180), line(100, 176, 100, 184), line(100 + length, 176, 100 + length, 184));
  // Preserve PDF-point distances on a wider drawing page.
  p.width = 2000;
  for (const text of p.textItems) { text.bbox.x /= 2; text.bbox.width /= 2; }
  for (const l of p.lines) { l.start.x /= 2; l.end.x /= 2; }
  const result = extractDeterministicMeasurements([p]);
  const parts = result.filter((m) => m.value === 2994 || m.value === 1230), total = result.find((m) => m.value === 4224)!;
  assert.equal(parts.length, 2); assert.ok(parts.every((m) => m.chainId && m.parentMeasurementId === total.id));
  assert.equal(parts[0].chainId, parts[1].chainId);
});

test("paired opening height is a label, never a fabricated in-plane dimension", () => {
  const p = chain();
  p.textItems.push(item("100", 650, 600, 12, 6), item("205", 650, 607.2, 12, 6));
  const length = 100 * 72 / 254;
  p.lines!.push(line(640, 500, 640, 607.6 - length / 2), line(640, 607.6 + length / 2, 640, 700));
  const result = extractDeterministicMeasurements([p]);
  const width = result.find((m) => m.kind === "opening-width"), height = result.find((m) => m.kind === "opening-height");
  assert.equal(width?.value, 100); assert.equal(height?.value, 205); assert.equal(height?.dimensionLine, undefined);
  assert.equal(height?.status, "unconfirmed"); assert.equal(height?.pairedMeasurementId, width?.id);
});

test("rotated text uses all corners and glyph direction instead of a horizontal box", () => {
  const items = extractTextObjects([{ str: "600", transform: [8, 0, 0, 8, 200, 500], width: 13, height: 8, fontName: "f" }], { f: { ascent: 1, descent: 0 } }, { width: 1000, height: 600, transform: [0, -1, -1, 0, 1000, 600] }, 1);
  assert.equal(items[0].orientation, -90); assert.equal(items[0].fontSize, 8);
  assert.ok(Math.abs(items[0].bbox.width - .008) < 1e-9); assert.ok(Math.abs(items[0].bbox.height - 13 / 600) < 1e-9);
  assert.deepEqual(items[0].baseline, { x: .5, y: 400 / 600 });
});

test("typed PDF.js paths apply graphics transforms and ignore unpainted clip paths", () => {
  const ops = { save: 10, restore: 11, transform: 12, setLineWidth: 2, constructPath: 91, stroke: 20 };
  const paths = { fnArray: [10, 12, 91, 91, 11], argsArray: [[], [2, 0, 0, 2, 100, 100], [20, [new Float32Array([0, 0, 0, 1, 10, 0])], [0, 0, 10, 0]], [28, [new Float32Array([0, 0, 0, 1, 999, 0])], [0, 0, 999, 0]], []] };
  const extracted = extractVectorLines(paths, ops, { width: 1000, height: 1000, transform: [1, 0, 0, 1, 0, 0] }, 1);
  assert.equal(extracted.lines.length, 1); assert.deepEqual(extracted.lines[0].start, { x: .1, y: .1 });
  assert.deepEqual(extracted.lines[0].end, { x: .12, y: .1 });
  assert.equal(classifyDocument(0, 0, 1), "raster"); assert.equal(classifyDocument(30, 100, 0), "vector"); assert.equal(classifyDocument(30, 100, 1), "mixed");
});

test("a printed unit has priority over conflicting geometry on a resized PDF", () => {
  const p = chain(); p.text = "Maße in mm 1:100";
  p.textItems[0].text = "600 mm";
  const result = extractDeterministicMeasurements([p]);
  assert.equal(result.length, 3);
  assert.ok(result.every((m) => m.unit === "mm"));
  assert.ok(result.slice(1).every((m) => m.unitInference?.evidence.includes("Zeichnungsangabe")));
});

test("contradictory unit declarations remain unknown", () => {
  const p = chain(); p.text = "Maße in mm; Maße in cm 1:100";
  assert.ok(extractDeterministicMeasurements([p]).every((m) => m.unit === "unknown"));
});

test("an explicit opposite unit does not vote for a geometrically inferred unit", () => {
  const p = chain(); for (const t of p.textItems.slice(0, 3)) t.text += " mm";
  const result = extractDeterministicMeasurements([p]);
  assert.ok(result.every((m) => m.unit === "mm"));
  assert.ok(result.every((m) => m.unitInference?.unit === "mm"));
});

test("separate inline numeric and unit objects recover an explicit length", () => {
  const p = page([item("12,50", 100, 100, 20), item("m", 122, 100, 5)]);
  const result = extractDeterministicMeasurements([p]);
  assert.equal(result.length, 1); assert.equal(result[0].value, 12.5); assert.equal(result[0].unit, "m");
  assert.ok(result[0].sources?.includes("unit-text")); assert.equal(result[0].textObjectId, p.textItems[0].id);
});

test("a split unit and superscript remain a volume instead of an inline length", () => {
  const p = page([item("9", 100, 100, 6, 10), item("m", 108, 100, 6, 10), item("3", 115, 97, 4, 6)]);
  assert.deepEqual(extractDeterministicMeasurements([p]), []);
});

test("a rotated numeric and unit object join in their actual reading direction", () => {
  const number = item("125", 100, 100, 8, 8, -90); number.bbox.height = .016;
  const unit = item("cm", 100, 90, 8, 8, -90); unit.bbox.height = .008;
  const result = extractDeterministicMeasurements([page([number, unit])]);
  assert.equal(result.length, 1); assert.equal(result[0].value, 125); assert.equal(result[0].unit, "cm");
});

test("invisible text outside the CropBox is omitted; visible clipped text has no off-page baseline", () => {
  const style = { f: { ascent: 1, descent: 0 } }, viewport = { width: 1000, height: 600, transform: [1, 0, 0, -1, 0, 600] };
  const items = extractTextObjects([
    { str: "invisible", transform: [8, 0, 0, 8, -100, 200], width: 20, height: 8, fontName: "f" },
    { str: "partially visible", transform: [8, 0, 0, 8, -5, 200], width: 20, height: 8, fontName: "f" },
  ], style, viewport, 1);
  assert.equal(items.length, 1); assert.equal(items[0].text, "partially visible");
  assert.equal(items[0].baseline, undefined); assert.equal(items[0].bbox.x, 0);
});

test("multiple numeric tokens follow the reading direction of 180-degree text", () => {
  const p = chain();
  const text = item("100 200", 600, 500, 42, 8, 180);
  p.textItems.push(text);
  const firstCenter = 600 + 42 * (1 - 3 / 7 / 2), secondCenter = 600 + 42 * 3 / 7 / 2;
  for (const [center, value] of [[firstCenter, 100], [secondCenter, 200]]) {
    const length = value * 72 / 254;
    p.lines!.push(line(center - length / 2, 512, center + length / 2, 512));
  }
  const result = extractDeterministicMeasurements([p]);
  const first = result.find((m) => m.value === 100)!, second = result.find((m) => m.value === 200)!;
  assert.ok(first.bbox!.x > second.bbox!.x); assert.ok(first.sources?.includes("text-layout"));
  assert.equal(first.textObjectId, text.id); assert.equal(second.textObjectId, text.id);
});
