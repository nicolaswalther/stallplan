import assert from "node:assert/strict";
import test from "node:test";
import { extractDeterministicMeasurements } from "../lib/deterministic";
import { indexAxisLines } from "../lib/geometry/dimension-lines";
import type { PdfLine, PdfPageData, PdfTextItem } from "../lib/types";

function label(text: string, center: number, y: number, font = 8, width = 12): PdfTextItem {
  return { id: `${text}:${center}:${y}`, text, orientation: 0, fontSize: font,
    bbox: { x: (center - width / 2) / 1000, y: y / 1000, width: width / 1000, height: font / 1000 } };
}
function line(x1: number, y1: number, x2: number, y2: number): PdfLine {
  return { id: `${x1}:${y1}:${x2}:${y2}`, start: { x: x1 / 1000, y: y1 / 1000 }, end: { x: x2 / 1000, y: y2 / 1000 }, strokeWidth: .2 };
}
function rail(center: number, y: number, length: number) {
  const from = center - length / 2, to = center + length / 2;
  return [line(from, y, to, y), line(from, y - 4, from, y + 4), line(to, y - 4, to, y + 4)];
}
function page(textItems: PdfTextItem[], lines: PdfLine[], text = "1:100"): PdfPageData {
  return { pageNumber: 1, width: 1000, height: 1000, text, textItems, lines, imageDataUrl: "", documentKind: "vector" };
}

test("mixed metre decimals and centimetre integers obtain local scale evidence", () => {
  const items: PdfTextItem[] = [], vectors: PdfLine[] = [];
  for (let i = 0; i < 3; i++) {
    const center = 150 + i * 250;
    items.push(label("5,00", center, 100)); vectors.push(...rail(center, 112, 5 * 1000 / 100 * 72 / 25.4));
    items.push(label("20", center, 300)); vectors.push(...rail(center, 312, 20 * 10 / 100 * 72 / 25.4));
  }
  items.push(label("10", 900, 300)); vectors.push(...rail(900, 312, 10 * 10 / 100 * 72 / 25.4));
  const result = extractDeterministicMeasurements([page(items, vectors)]);
  assert.equal(result.length, 7);
  assert.ok(result.filter((m) => m.value === 5).every((m) => m.unit === "m"));
  assert.ok(result.filter((m) => m.value !== 5).every((m) => m.unit === "cm"));
  assert.ok(result.every((m) => (m.signals?.scaleAgreement ?? 0) > .99));
  assert.ok(result.every((m) => m.unitInference?.evidence.includes("diese native Vektorstrecke")));
});

test("one repeated native rail cannot supply multiple independent unit votes", () => {
  const items = Array.from({ length: 3 }, (_, i) => ({ ...label("600", 300, 100), id: `repeat-${i}` }));
  const result = extractDeterministicMeasurements([page(items, rail(300, 112, 600 * 10 / 100 * 72 / 25.4))]);
  assert.ok(result.length > 0);
  assert.ok(result.every((m) => m.unit === "unknown"));
});

test("integer-centimetre anchors cannot turn a decimal metre opening into a tiny symbol length", () => {
  const items: PdfTextItem[] = [], vectors: PdfLine[] = [];
  for (let i = 0; i < 3; i++) {
    const center = 150 + i * 250;
    items.push(label("5,00", center, 100)); vectors.push(...rail(center, 112, 5 * 1000 / 100 * 72 / 25.4));
    items.push(label("20", center, 300)); vectors.push(...rail(center, 312, 20 * 10 / 100 * 72 / 25.4));
  }
  const opening = label("4,00", 900, 500);
  items.push(opening); vectors.push(...rail(900, 512, 4 * 10 / 100 * 72 / 25.4));
  const result = extractDeterministicMeasurements([page(items, vectors)]);
  assert.equal(result.length, 6);
  assert.equal(result.find((m) => m.textObjectId === opening.id), undefined);
});

test("large consecutive axis labels are excluded while repeated scale-proven dimensions survive", () => {
  const items: PdfTextItem[] = [], vectors: PdfLine[] = [];
  for (let i = 0; i < 6; i++) {
    const center = 120 + i * 120;
    items.push(label(String(i + 1), center, 200, 16));
    items.push(label("5,00", center, 100)); vectors.push(...rail(center, 112, 5 * 1000 / 100 * 72 / 25.4));
  }
  // A long rail crossing the axis row must not classify its centred numbers as lengths.
  vectors.push(...rail(420, 222, 780));
  const result = extractDeterministicMeasurements([page(items, vectors)]);
  assert.equal(result.length, 6);
  assert.ok(result.every((m) => m.value === 5 && m.unit === "m"));
});

test("scale-consistent consecutive integer dimensions remain legitimate lengths", () => {
  const items: PdfTextItem[] = [], vectors: PdfLine[] = [];
  for (let i = 0; i < 4; i++) {
    const value = i + 1, center = 120 + i * 200;
    items.push(label(String(value), center, 100, 12)); vectors.push(...rail(center, 112, value * 1000 / 100 * 72 / 25.4));
  }
  items.push(label("5,00", 300, 400, 8)); vectors.push(...rail(300, 412, 5 * 1000 / 100 * 72 / 25.4));
  const result = extractDeterministicMeasurements([page(items, vectors)]);
  assert.equal(result.length, 5);
  assert.deepEqual(result.map((m) => m.value), [1, 2, 3, 4, 5]);
  assert.ok(result.every((m) => m.unit === "m"));
});

test("a stacked room ID and name with native area exponent do not become a length", () => {
  const identifier = label("04", 300, 100);
  const name = label("BETREUERRAUM", 300, 112, 8, 80);
  const area = label("21,07 m²", 300, 136, 8, 40);
  const bare = extractDeterministicMeasurements([page([identifier, name, area], rail(300, 112, 40), "Maße in cm 1:100")]);
  assert.deepEqual(bare, []);
  const explicit = { ...identifier, text: "04 cm" };
  const result = extractDeterministicMeasurements([page([explicit, name, area], rail(300, 112, 40), "Maße in cm 1:100")]);
  assert.equal(result.length, 1);
  assert.equal(result[0].value, 4);
  assert.equal(result[0].unit, "cm");
});

test("CAD end strokes recover exact native spans without crossing a shared chain tick", () => {
  const vectors = [line(102.5, 112, 267.5, 112), line(100, 112, 102.5, 112), line(267.5, 112, 270, 112),
    line(270, 112, 272.5, 112), line(100, 108, 100, 116), line(270, 108, 270, 116)];
  const input = page([label("600", 185, 100)], vectors);
  const original = indexAxisLines(input).find((l) => l.source.id === vectors[0].id)!;
  const assembled = indexAxisLines(input).find((l) => l.sourceLineIds?.[0] === vectors[0].id)!;
  assert.equal(original.length, 165);
  assert.equal(assembled.from, 100);
  assert.equal(assembled.to, 270);
  assert.equal(assembled.sourceLineIds?.length, 3);
  assert.equal(vectors[0].end.x, .2675, "native source objects remain intact");
});

test("disconnected CAD strokes never fill an unproved gap", () => {
  const vectors = [line(102.5, 112, 267.5, 112), line(100, 112, 102, 112)];
  assert.equal(indexAxisLines(page([], vectors)).filter((l) => l.sourceLineIds).length, 0);
});

test("slightly rotated long total rails retain native endpoints and unit agreement", () => {
  const width = 10000, height = 10000;
  const length = 228.96 * 1000 / 100 * 72 / 25.4;
  const dx = Math.cos(.1 * Math.PI / 180) * length, dy = Math.sin(.1 * Math.PI / 180) * length;
  const x = 1000, y = 2000;
  const vector: PdfLine = { id: "rotated-total", start: { x: x / width, y: y / height }, end: { x: (x + dx) / width, y: (y + dy) / height } };
  const input: PdfPageData = { pageNumber: 1, width, height, imageDataUrl: "", documentKind: "vector", text: "Maße in m 1:100",
    textItems: [{ id: "total", text: "228,96", fontSize: 8, orientation: .1,
      bbox: { x: (x + dx / 2 - 15) / width, y: (y + dy / 2 - 10) / height, width: 30 / width, height: 8 / height } }], lines: [vector] };
  const result = extractDeterministicMeasurements([input]);
  assert.equal(result.length, 1);
  assert.equal(result[0].unit, "m");
  assert.ok((result[0].signals?.scaleAgreement ?? 0) > .99);
  assert.deepEqual(result[0].dimensionLine, { start: vector.start, end: vector.end });
});

test("Latvian dimension units do not inherit metres from the separate elevation note", () => {
  const text = "Rasējumos dotās mērķēdes norādītas milimetros (mm), augstuma atzīmes norādītas metros (m). 1:100";
  const items = [label("3000", 300, 100), label("+0,200", 600, 100)];
  const result = extractDeterministicMeasurements([page(items, rail(300, 112, 3000 / 100 * 72 / 25.4), text)]);
  assert.equal(result.length, 1);
  assert.equal(result[0].value, 3000);
  assert.equal(result[0].unit, "mm");
  assert.ok(result[0].unitInference?.evidence.includes("milimetros"));
});

test("declared dimensions retain native numbers but omit contradictory geometric references", () => {
  const input = page([label("3000", 300, 100)], rail(300, 112, 7.32), "Maße in mm 1:100");
  const result = extractDeterministicMeasurements([input]);
  assert.equal(result.length, 1);
  assert.equal(result[0].value, 3000);
  assert.equal(result[0].unit, "mm");
  assert.equal(result[0].source, "pdf-text");
  assert.equal(result[0].dimensionLine, undefined);
  assert.equal(result[0].startReference, undefined);
  assert.equal(result[0].status, "unconfirmed");
});
