import assert from "node:assert/strict";
import test from "node:test";
import { selectRasterMeasurementPages, validateRasterMeasurements } from "../lib/ai/measurements";
import { extractDeterministicMeasurements } from "../lib/deterministic";
import type { PdfPageData } from "../lib/types";

const bbox = { x: .4, y: .3, width: .03, height: .01 };
function outlinedPage(overrides: Partial<PdfPageData> = {}): PdfPageData {
  return {
    pageNumber: 1, width: 1684, height: 1191, documentKind: "vector", text: "", textItems: [],
    imageDataUrl: "data:image/jpeg;base64,YQ==",
    lines: Array.from({ length: 1_000 }, (_, index) => ({
      id: `outline-${index}`, start: { x: index / 2_000, y: .2 }, end: { x: index / 2_000 + .001, y: .202 },
    })), ...overrides,
  };
}
const candidate = { key: "outer-length", label: "Planmaß", value: 9006, unit: "unknown", confidence: .9, pageNumber: 1,
  hasBbox: true, bbox, evidence: "Schriftlicher Maßwert 9006 über der äußeren Maßlinie." };
const payload = { unitBasis: { unit: "unknown", confidence: .3, evidence: "Keine explizite Zeichnungseinheit." }, warnings: [], measurements: [candidate] };

test("outlined vector drawing text can use image reading without any raster objects", () => {
  const noNativeText = outlinedPage();
  const sectionLabelsOnly = outlinedPage({ text: "Pjūvis A-A Pjūvis B-B", textItems: [
    { text: "Pjūvis A-A", bbox }, { text: "Pjūvis B-B", bbox: { ...bbox, y: .5 } },
  ] });
  assert.deepEqual(selectRasterMeasurementPages([noNativeText]), [noNativeText]);
  assert.deepEqual(selectRasterMeasurementPages([sectionLabelsOnly]), [sectionLabelsOnly]);
  assert.equal(selectRasterMeasurementPages([outlinedPage({ imageDataUrl: "" })]).length, 0);
  assert.equal(selectRasterMeasurementPages([outlinedPage({ lines: noNativeText.lines!.slice(0, 999) })]).length, 0);
});

test("available native dimensions take precedence over outlined-vector fallback", () => {
  const directText = outlinedPage({ text: "600 cm", textItems: [{ id: "native-600", text: "600 cm", bbox }] });
  const measures = extractDeterministicMeasurements([directText]);
  assert.equal(measures.length, 1);
  assert.equal(measures[0].value, 600);
  assert.equal(selectRasterMeasurementPages([directText], measures).length, 0);
  // Unitless native chain numbers still have their own exact PDF coordinates.
  const nativeChains = outlinedPage({ text: "600 600", textItems: [{ text: "600 600", bbox }] });
  assert.equal(selectRasterMeasurementPages([nativeChains]).length, 0);
  // An already extracted measure also blocks re-reading if the native text
  // has been omitted from a later transport representation.
  assert.equal(selectRasterMeasurementPages([outlinedPage()], measures).length, 0);
});

test("mixed-page image candidates cannot replace combined native numbers or identifiers", () => {
  for (const text of ["600 600", "600 cm", "Pos. 600"]) {
    const mixed = outlinedPage({ documentKind: "mixed", text, textItems: [{ text, bbox }] });
    const result = validateRasterMeasurements({ ...payload, measurements: [candidate,
      { ...candidate, key: "additional", bbox: { ...bbox, x: .7 } },
    ] }, [mixed]);
    assert.equal(result.measurements.length, 1);
    assert.equal(result.measurements[0].key, "additional");
    assert.equal(result.measurements[0].unit, "unknown");
    assert.equal(result.warnings.length, 1);
  }
});

test("outlined numeric image candidates preserve unknown units and manual review", () => {
  const result = validateRasterMeasurements(payload, [outlinedPage()]);
  assert.equal(result.measurements.length, 1);
  assert.equal(result.measurements[0].value, 9006);
  assert.equal(result.measurements[0].unit, "unknown");
  assert.equal(result.measurements[0].status, "unconfirmed");
  assert.deepEqual(result.measurements[0].sources, ["vision"]);
  assert.equal(result.measurements[0].originalEvidence, candidate.evidence);
});
