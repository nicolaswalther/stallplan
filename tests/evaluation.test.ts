import assert from "node:assert/strict";
import { test } from "node:test";
import { evaluateMeasurements, boxIoU, type ReferenceMeasurement } from "../lib/evaluation/measurements";
import type { Measurement } from "../lib/types";

const reference = (id: string, x: number): ReferenceMeasurement => ({ id, value: 600, unit: "cm", pageNumber: 1, bbox: { x, y: 0.1, width: 0.01, height: 0.01 } });
const actual = (id: string, x: number, unit: Measurement["unit"] = "cm"): Measurement => ({ ...reference(id, x), key: id, label: "Planmaß", source: "geometry", status: "confirmed", confidence: 0.95, evidence: "test", unit });

test("repeated module values match separate locations one-to-one", () => {
  const result = evaluateMeasurements([actual("a", 0.1), actual("b", 0.2), actual("duplicate", 0.1)], [reference("r1", 0.1), reference("r2", 0.2)]);
  assert.equal(result.measurementRecall, 1);
  assert.equal(result.measurementPrecision, 2 / 3);
  assert.equal(result.falsePositives.length, 1);
});
test("unit errors remain visible and rejected candidates do not affect precision", () => {
  const result = evaluateMeasurements([actual("wrong-unit", 0.1, "mm"), { ...actual("rejected", 0.2), status: "rejected" }], [reference("r1", 0.1), reference("r2", 0.2)]);
  assert.equal(result.unitAccuracy, 0);
  assert.equal(result.measurementRecall, 0.5);
  assert.equal(result.missing[0].id, "r2");
});
test("bbox IoU compares geometry without accepting zero-area boxes", () => {
  assert.ok(Math.abs(boxIoU(reference("a", 0.1).bbox, reference("a", 0.1).bbox) - 1) < 1e-12);
  assert.equal(boxIoU({ x: 0, y: 0, width: 0, height: 0 }, { x: 0, y: 0, width: 0, height: 0 }), 0);
});
