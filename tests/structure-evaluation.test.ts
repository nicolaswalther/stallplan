import assert from "node:assert/strict";
import { test } from "node:test";
import { evaluateStructure, type StructureReference } from "../lib/evaluation/structure";
import type { Measurement } from "../lib/types";

const measurement = (id: string, chainId: string): Measurement => ({ id, key: id, label: "Planmaß", value: 600, unit: "cm", source: "geometry", status: "confirmed", confidence: 0.95, pageNumber: 1, bbox: null, evidence: "", chainId, kind: "plan-length" });
test("chain evaluation exposes false joins even when all raw values are correct", () => {
  const actual = ["a", "b", "c", "d"].map((id) => measurement(id, "joined"));
  const reference: StructureReference = {
    measurements: actual.map((item) => ({ id: item.id, role: "plan-dimension", page: 1 })),
    dimensionChains: [{ id: "one", measurementIds: ["a", "b"] }, { id: "two", measurementIds: ["c", "d"] }],
    document: { pages: [{ page: 1, widthPoints: 1000, heightPoints: 1000 }] },
  };
  const result = evaluateStructure(actual, reference, actual.map((item) => ({ measurementId: item.id, referenceId: item.id })));
  assert.equal(result.dimensionChainPairPrecision, 1 / 3);
  assert.equal(result.dimensionChainPairRecall, 1);
  assert.equal(result.roleAccuracy, 1);
});
test("annotated line geometry compares reversed endpoints and reports missing lines", () => {
  const actual = [{ ...measurement("a", "chain"), dimensionLine: { start: { x: 0.5, y: 0.1 }, end: { x: 0.1, y: 0.1 } } }, measurement("b", "chain")];
  const reference: StructureReference = {
    measurements: actual.map((item) => ({ id: item.id, role: "plan-dimension", page: 1, dimensionLine: { start: [0.1, 0.1], end: [0.5, 0.1] } })),
    dimensionChains: [], document: { pages: [{ page: 1, widthPoints: 1000, heightPoints: 1000 }] },
  };
  const result = evaluateStructure(actual, reference, actual.map((item) => ({ measurementId: item.id, referenceId: item.id })));
  assert.equal(result.annotatedLineCount, 2);
  assert.equal(result.matchedLineCount, 1);
  assert.equal(result.maxAnnotatedLineEndpointErrorPoints, 0);
});
