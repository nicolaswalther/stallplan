import assert from "node:assert/strict";
import { test } from "node:test";
import { applyAreaGeometryCorrection, applyMeasurementCorrection, mergeAreas, mergeMeasurements, needsMeasurementReview, prepareArea, transformAreaBox } from "../lib/plan/review";
import type { DetectedArea, Measurement } from "../lib/types";

function dimension(patch: Partial<Measurement> = {}): Measurement {
  return { id: "m-1", key: "length", label: "Planmaß", value: 600, unit: "cm", source: "geometry", status: "unconfirmed",
    confidence: 0.86, pageNumber: 1, bbox: { x: 0.2, y: 0.1, width: 0.02, height: 0.01 }, evidence: "PDF-Maßlinie", ...patch };
}
function area(patch: Partial<DetectedArea> = {}): DetectedArea {
  return { id: "a-1", kind: "feeding_area", label: "Fressbereich", source: "geometry", status: "unconfirmed", confidence: 0.96,
    pageNumber: 1, bbox: { x: 0.2, y: 0.3, width: 0.3, height: 0.1 }, hasBbox: true, evidence: ["Beschriftung und Umriss"], ...patch };
}

test("measurement corrections retain original value/unit and a chronological audit", () => {
  const originalInference = { unit: "cm" as const, confidence: 0.96, evidence: "Gedruckter Maßstab passt zur Vektorstrecke." };
  const first = applyMeasurementCorrection(dimension({ unitInference: originalInference }), 601.5, "cm");
  const second = applyMeasurementCorrection(first, 6.02, "m");
  assert.equal(second.originalValue, 600);
  assert.equal(second.originalUnit, "cm");
  assert.deepEqual(second.originalUnitInference, originalInference);
  assert.equal(second.unitInference?.unit, "m");
  assert.equal(second.unitInference?.evidence, "Vom Nutzer korrigiert.");
  assert.equal(second.source, "customer");
  assert.equal(second.corrections?.length, 2);
  assert.equal(second.corrections?.[0].value, 601.5);
  assert.equal(second.corrections?.[1].unit, "m");
  assert.ok(second.sources?.includes("geometry"));
  assert.equal(applyMeasurementCorrection(second, -3, "m"), second);
});

test("late analysis cannot replace corrections or revive excluded dimensions", () => {
  const correction = applyMeasurementCorrection(dimension(), 601.5, "cm");
  const excluded = dimension({ id: "excluded", status: "rejected", bbox: { x: 0.8, y: 0.1, width: 0.02, height: 0.01 } });
  const incoming = [dimension({ id: "ai-1", source: "ai" }), { ...excluded, source: "ai" as const, status: "unconfirmed" as const }];
  const result = mergeMeasurements([correction, excluded], incoming);
  assert.equal(result.length, 2);
  assert.equal(result[0].value, 601.5);
  assert.equal(result[1].status, "rejected");
});

test("repeated modules and distinct text objects remain independent", () => {
  const first = dimension({ textObjectId: "text-1" });
  const nearby = dimension({ id: "m-2", textObjectId: "text-2", bbox: { x: 0.205, y: 0.1, width: 0.02, height: 0.01 } });
  assert.equal(mergeMeasurements([first], [nearby]).length, 2);
});

test("only unresolved exceptions need review; a confirmed unknown unit still does", () => {
  assert.equal(needsMeasurementReview(dimension()), true);
  assert.equal(needsMeasurementReview(dimension({ status: "confirmed" })), false);
  assert.equal(needsMeasurementReview(dimension({ unit: "unknown", status: "confirmed" })), true);
  assert.equal(needsMeasurementReview(dimension({ unit: "unknown", status: "rejected" })), false);
});

test("automatic area acceptance requires high confidence, a kind, and geometry", () => {
  assert.equal(prepareArea(area()).status, "confirmed");
  assert.equal(prepareArea(area({ confidence: 0.92 })).status, "unconfirmed");
  assert.equal(prepareArea(area({ hasBbox: false })).status, "unconfirmed");
  assert.equal(prepareArea(area({ kind: "unknown" })).status, "unconfirmed");
  assert.equal(prepareArea(area({ source: "ai", confidence: 0.99 })).status, "unconfirmed");
});

test("late semantic suggestions preserve manual and rejected area reviews", () => {
  const manual = area({ source: "manual", status: "confirmed", confidence: null });
  const rejected = area({ id: "a-2", kind: "gate", status: "rejected" });
  const fused = mergeAreas([manual, rejected], [area({ id: "ai-1" }), area({ id: "ai-2", kind: "gate" })]);
  assert.equal(fused.length, 2);
  assert.equal(fused[0].source, "manual");
  assert.equal(fused[1].status, "rejected");
});

test("moving an area clamps against the page without shrinking it", () => {
  const box = { x: 0.2, y: 0.3, width: 0.4, height: 0.2 };
  assert.deepEqual(transformAreaBox(box, "move", -0.5, 1), { x: 0, y: 0.8, width: 0.4, height: 0.2 });
  assert.deepEqual(transformAreaBox(box, "move", 1, -1), { x: 0.6, y: 0, width: 0.4, height: 0.2 });
});

test("all four resize handles anchor their opposite corner, never invert, and keep 0.01 minimum size", () => {
  const box = { x: 0.2, y: 0.3, width: 0.4, height: 0.2 };
  for (const corner of ["nw", "ne", "sw", "se"] as const) {
    const result = transformAreaBox(box, corner, corner.endsWith("w") ? 2 : -2, corner.startsWith("n") ? 2 : -2);
    assert.ok(Math.abs(result.width - 0.01) < 1e-9);
    assert.ok(Math.abs(result.height - 0.01) < 1e-9);
    assert.ok(result.x >= 0 && result.y >= 0 && result.x + result.width <= 1 && result.y + result.height <= 1);
    assert.ok(Math.abs((corner.endsWith("w") ? result.x + result.width : result.x) - (corner.endsWith("w") ? 0.6 : 0.2)) < 1e-9);
    assert.ok(Math.abs((corner.startsWith("n") ? result.y + result.height : result.y) - (corner.startsWith("n") ? 0.5 : 0.3)) < 1e-9);
  }
  const full = transformAreaBox(box, "se", 2, 2);
  assert.equal(full.x + full.width, 1);
  assert.equal(full.y + full.height, 1);
});

test("geometry corrections preserve model origin and one audit entry per committed gesture without silently accepting a proposal", () => {
  const original = area({ source: "ai", confidence: 0.92 });
  const first = applyAreaGeometryCorrection(original, transformAreaBox(original.bbox, "se", 0.1, 0));
  const second = applyAreaGeometryCorrection(first, transformAreaBox(first.bbox, "move", 0.01, 0.02));
  assert.deepEqual(second.originalBbox, original.bbox);
  assert.equal(second.originalSource, "ai");
  assert.equal(second.originalConfidence, 0.92);
  assert.equal(second.source, "manual");
  assert.equal(second.confidence, null);
  assert.equal(second.status, "unconfirmed");
  assert.equal(second.geometryCorrections?.length, 2);
  assert.equal(second.geometryCorrections?.[0].source, "customer");
  assert.equal(applyAreaGeometryCorrection(second, second.bbox), second);
  assert.equal(applyAreaGeometryCorrection(second, { x: -0.1, y: 0.2, width: 0.4, height: 0.3 }), second);
});
