import test from "node:test";
import assert from "node:assert/strict";
import { classifyAreaLabel, detectStructuralAreas } from "../lib/analysis/areas";
import { analyzePlan } from "../lib/analysis/pipeline";
import { isModelUnavailable, withModelFallback } from "../lib/ai/client";
import { selectRasterMeasurementPages, validateRasterMeasurements } from "../lib/ai/measurements";
import { validateSemanticAreas } from "../lib/ai/areas";
import { parseAnalysisRequest } from "../lib/plan/request";
import { getAreaQuestions, PROJECT_QUESTIONS } from "../lib/rules";
import type { PdfPageData } from "../lib/types";

const box = { x: 0.4, y: 0.4, width: 0.12, height: 0.015 };
function page(overrides: Partial<PdfPageData> = {}): PdfPageData {
  return { pageNumber: 1, width: 1000, height: 700, text: "Futtertisch", textItems: [{ id: "label", text: "Futtertisch", bbox: box }], documentKind: "vector", imageDataUrl: "data:image/jpeg;base64,YQ==", ...overrides };
}
function rectanglePage(): PdfPageData {
  return page({ lines: [
    { id: "top", start: { x: 0.2, y: 0.25 }, end: { x: 0.8, y: 0.25 } },
    { id: "bottom", start: { x: 0.2, y: 0.65 }, end: { x: 0.8, y: 0.65 } },
    { id: "left", start: { x: 0.2, y: 0.25 }, end: { x: 0.2, y: 0.65 } },
    { id: "right", start: { x: 0.8, y: 0.25 }, end: { x: 0.8, y: 0.65 } },
  ] });
}
const rasterMeasurement = { key: "length", label: "Planmaß", value: 600, unit: "cm", confidence: 0.92, pageNumber: 2, hasBbox: true, bbox: box, evidence: "600 an einer Maßlinie" };
const rasterPayload = { unitBasis: { unit: "cm", confidence: 0.96, evidence: "Alle Maße in cm im Titelblock" }, warnings: [], measurements: [rasterMeasurement] };

test("German and Polish labels require a real enclosure, not a word-sized guessed box", () => {
  assert.equal(classifyAreaLabel("korytarz paszowy"), "feeding_area");
  assert.equal(classifyAreaLabel("porodówka"), "calving");
  assert.equal(classifyAreaLabel("legowiska"), "cubicles");
  assert.equal(classifyAreaLabel("94 DJP"), null);
  assert.deepEqual(detectStructuralAreas([page()]), []);
  const areas = detectStructuralAreas([rectanglePage()]);
  assert.equal(areas.length, 1);
  assert.equal(areas[0].source, "geometry");
  assert.deepEqual(areas[0].bbox, { x: 0.2, y: 0.25, width: 0.6000000000000001, height: 0.4 });
});

test("a room schedule enclosed by one table cannot become multiple physical stall areas", () => {
  const plan = rectanglePage();
  plan.textItems.push({ text: "Liegeboxen", bbox: { ...box, y: 0.48 } });
  assert.deepEqual(detectStructuralAreas([plan]), []);
});

test("request validation rejects duplicate pages and out-of-page boxes", () => {
  assert.throws(() => parseAnalysisRequest({ fileName: "x.pdf", pages: [page(), page()] }));
  assert.throws(() => parseAnalysisRequest({ fileName: "x.pdf", pages: [page({ textItems: [{ text: "600", bbox: { x: 0.98, y: 0.3, width: 0.05, height: 0.02 } }] })] }));
});

test("project facts are asked once and no domain question requests a dimension", () => {
  assert.deepEqual(PROJECT_QUESTIONS.map((q) => q.id), ["animalSpecies", "projectType"]);
  for (const kind of ["feeding_area", "cubicles", "alley", "calving", "gate", "unknown"] as const) {
    assert.ok(getAreaQuestions(kind).every((q) => !PROJECT_QUESTIONS.some((project) => project.id === q.id)));
    assert.ok(getAreaQuestions(kind).every((q) => !/breite|länge|hohe|höhe|abstand/i.test(q.label)));
  }
});

test("fallback only retries known model errors, not malformed input, auth, quota or arbitrary 403", async () => {
  assert.equal(isModelUnavailable({ status: 400, code: "invalid_request_error" }), false);
  assert.equal(isModelUnavailable({ status: 403, code: "permission_denied" }), false);
  assert.equal(isModelUnavailable({ status: 401, code: "model_not_found" }), false);
  assert.equal(isModelUnavailable({ status: 429, code: "insufficient_quota" }), false);
  assert.equal(isModelUnavailable({ status: 404, code: "model_not_found" }), true);
  const attempts: string[] = [];
  const result = await withModelFallback("gpt-6-luna", async (model) => {
    attempts.push(model);
    if (model === "gpt-6-luna") throw { status: 404, code: "model_not_found" };
    return "ok";
  });
  assert.deepEqual(attempts, ["gpt-6-luna", "gpt-6.1-sol"]);
  assert.equal(result.model, "gpt-6.1-sol");
});

test("sparse vector pages do not trigger image digit recognition; raster and mixed fallback remain compatible", () => {
  assert.deepEqual(selectRasterMeasurementPages([page()]), []);
  assert.equal(selectRasterMeasurementPages([page({ documentKind: "raster" })]).length, 1);
  assert.equal(selectRasterMeasurementPages([page({ documentKind: "mixed", textItems: Array(4).fill({ text: "Footer", bbox: box }) })]).length, 1);
  assert.equal(selectRasterMeasurementPages([page({ documentKind: "mixed", textItems: [{ text: "600 cm", bbox: box }] })]).length, 1);
});

test("no API key preserves structural analysis with no fabricated model attribution", async () => {
  const result = await analyzePlan({ fileName: "x.pdf", pages: [rectanglePage()] });
  assert.equal(result.areas.length, 1);
  assert.equal(result.model, "none");
  assert.deepEqual(result.actualModels, {});
  assert.ok(result.warnings.length);
  assert.ok(result.warnings.every((warning) => !warning.includes("OPENAI_API_KEY")));
});

test("area failure does not discard raster measures or vector area geometry", async () => {
  const rasterPage = page({ pageNumber: 2, documentKind: "raster", text: "", textItems: [] });
  const result = await analyzePlan({ fileName: "x.pdf", pages: [rectanglePage(), rasterPage] }, { apiKey: "mock-only" }, {
    areas: async () => { throw new Error("mock_timeout"); },
    measurements: async () => ({ result: { ...validateRasterMeasurements(rasterPayload, [rasterPage]), actualModel: "mock-raster" }, model: "mock-raster", fallback: false }),
  });
  assert.equal(result.areas.length, 1);
  assert.ok(result.measurements.some((measurement) => measurement.value === 600 && measurement.source === "ai"));
  assert.deepEqual(result.actualModels, { measurements: "mock-raster" });
  assert.ok(result.warnings.some((warning) => warning.includes("Bereichserkennung")));
});

test("vision results reject false positions, non-lengths and unsupported unit certainty", () => {
  const rasterPage = page({ pageNumber: 2, documentKind: "raster", textItems: [] });
  const valid = validateRasterMeasurements({ ...rasterPayload, measurements: [rasterMeasurement, { ...rasterMeasurement, label: "94 DJP" }, { ...rasterMeasurement, pageNumber: 99 }, { ...rasterMeasurement, evidence: "2500 m3" }] }, [rasterPage]);
  assert.equal(valid.measurements.length, 1);
  const uncertain = validateRasterMeasurements({ ...rasterPayload, unitBasis: { unit: "unknown", confidence: 0.4, evidence: "nicht erkennbar" } }, [rasterPage]);
  assert.equal(uncertain.measurements[0].unit, "unknown");
  assert.equal(uncertain.measurements[0].status, "unconfirmed");
  assert.equal(validateRasterMeasurements({ ...rasterPayload, measurements: [{ ...rasterMeasurement, value: -3 }] }, [rasterPage]).measurements.length, 0);
  const areas = validateSemanticAreas({ documentSummary: "x", warnings: [], areas: [{ kind: "alley", label: "Laufgang", confidence: 0.9, pageNumber: 99, hasBbox: true, bbox: box, evidence: ["Raumkontur"] }] }, [page()]);
  assert.equal(areas.areas.length, 0);
});

test("one malformed model candidate cannot discard valid siblings", () => {
  const validArea = { kind: "feeding_area", label: "Futtertisch", confidence: 0.91, pageNumber: 1, hasBbox: true, bbox: box, evidence: ["Raumkontur"] };
  const areas = validateSemanticAreas({ documentSummary: "x", warnings: [], areas: [validArea, { ...validArea, bbox: { ...box, x: 0.95 } }] }, [page()]);
  assert.equal(areas.areas.length, 1);
  assert.equal(areas.warnings.length, 1);
  const rasterPage = page({ pageNumber: 2, documentKind: "raster", textItems: [] });
  const measurements = validateRasterMeasurements({ ...rasterPayload, measurements: [rasterMeasurement, { ...rasterMeasurement, value: -3 }, { ...rasterMeasurement, bbox: { ...box, x: 0.99 } }] }, [rasterPage]);
  assert.equal(measurements.measurements.length, 1);
  assert.equal(measurements.warnings.length, 1);
});

test("raster fallback never re-reads an existing PDF number and filters elevation/date/scale", () => {
  const mixedPage = page({ pageNumber: 2, documentKind: "mixed", textItems: [{ text: "600 cm", bbox: box }] });
  assert.equal(validateRasterMeasurements(rasterPayload, [mixedPage]).measurements.length, 0);
  const rasterPage = page({ pageNumber: 2, documentKind: "raster", textItems: [] });
  for (const evidence of ["0,00 = 136,6 m n.p.m.", "Datum 05.10.2026", "Maßstab 1:100", "94 DJP", "2500 m³"]) {
    assert.equal(validateRasterMeasurements({ ...rasterPayload, measurements: [{ ...rasterMeasurement, evidence }] }, [rasterPage]).measurements.length, 0);
  }
});

test("semantic boxes on unpictured pages are discarded and multi-page coverage is explicit", async () => {
  const candidate = { kind: "alley", label: "Laufgang", confidence: 0.8, pageNumber: 12, hasBbox: true, bbox: box, evidence: ["Raumkontur"] };
  const pages = Array.from({ length: 12 }, (_, index) => page({ pageNumber: index + 1, imageDataUrl: index < 4 ? "data:image/jpeg;base64,YQ==" : "" }));
  const validated = validateSemanticAreas({ documentSummary: "x", warnings: [], areas: [candidate] }, pages);
  assert.equal(validated.areas.length, 0);
  const result = await analyzePlan({ fileName: "x.pdf", pages }, { apiKey: "mock-only" }, {
    areas: async () => ({ result: { ...validated, actualModel: "mock" }, model: "mock", fallback: false }),
    measurements: async () => { throw new Error("must_not_run_for_vector"); },
  });
  assert.ok(result.warnings.some((warning) => warning.includes("4 von 12")));
});
