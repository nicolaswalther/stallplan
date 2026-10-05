import assert from "node:assert/strict";
import { test } from "node:test";
import { buildPlanningSummaryHtml } from "../lib/plan/summary";
import type { PlanningHandoff } from "../lib/types";

function brief(): PlanningHandoff {
  return {
    schemaVersion: "1.3", createdAt: "2026-10-05T12:00:00Z",
    project: { fileName: "kundenplan.pdf", pageCount: 1, answers: { animalSpecies: "Rind", projectType: "Neubau" } },
    analysis: { summary: "", warnings: [] }, measurements: [],
    areas: [0, 1].map((index) => ({ id: `a${index}`, kind: "cubicles", label: `Liegeboxen ${index + 1}`, pageNumber: 1,
      bbox: { x: 0.1, y: 0.1 + index * 0.2, width: 0.5, height: 0.1 }, source: "manual", evidence: [],
      relevantProducts: [], requiredMeasurements: [], answers: { bedding: index ? "Wasserbett" : "Latexmatratze" },
      answerProvenance: { bedding: { source: "customer", scope: index ? "area" : "group", groupKind: "cubicles", ...(index ? { areaId: "a1" } : {}) } } })),
    planningGroups: [{ id: "cubicles", kind: "cubicles", title: "Liegeboxen", areaIds: ["a0", "a1"], additional: false,
      answers: { bedding: "Latexmatratze", animalSpecies: "Rind" },
      answerProvenance: { bedding: { source: "customer", scope: "group", groupKind: "cubicles" }, animalSpecies: { source: "customer", scope: "project" } } }],
    review: { openAreaCount: 0, unresolvedMeasurementCount: 2, missingAnswerCount: 0, ready: false },
    audit: { aiModel: "none", rulesVersion: "test", confirmedAreaCount: 2, detectedMeasurementCount: 0, customerCorrectedMeasurementCount: 0 },
  };
}

test("farmer brief lists shared wishes once, exceptions separately, and retains technical open points", () => {
  const html = buildPlanningSummaryHtml(brief());
  assert.ok(html.includes("Wünsche erfasst"));
  assert.equal(html.match(/Latexmatratze/g)?.length, 1);
  assert.ok(html.includes("Abweichung: Bereich 2"));
  assert.ok(html.includes("Wasserbett"));
  assert.ok(html.includes("2 technische Maßangaben noch prüfen"));
  assert.ok(html.includes("Bereich 1 · Seite 1 / Bereich 2 · Seite 1"));
  assert.ok(!html.includes("<script"));
});

test("unpositioned extra equipment is a wish, never a fabricated plan object", () => {
  const handoff = brief();
  handoff.planningGroups?.push({ id: "drinker", kind: "drinker", title: "Tränken", areaIds: [], additional: true,
    answers: {}, answerProvenance: {} });
  const html = buildPlanningSummaryHtml(handoff);
  assert.ok(html.includes("Ergänzungswunsch · Position noch festzulegen"));
  assert.equal(handoff.areas.length, 2);
});

test("downloaded brief escapes user text and refuses remote or injected image URLs", () => {
  const handoff = brief();
  handoff.project.fileName = '<script>alert("x")</script>.pdf';
  handoff.analysis.warnings = ['<img src=x onerror="evil()">'];
  const html = buildPlanningSummaryHtml(handoff, [{ pageNumber: 1, imageDataUrl: 'https://tracker.invalid/a' },
    { pageNumber: 2, imageDataUrl: 'data:image/png;base64,xxx" onerror="evil()' }]);
  assert.ok(html.includes("&lt;script&gt;"));
  assert.ok(html.includes("&lt;img src=x onerror=&quot;evil()&quot;&gt;"));
  assert.ok(!html.includes("<script"));
  assert.ok(!html.includes("tracker.invalid"));
  assert.ok(!html.includes("<img"));
});

test("unfinished analysis remains explicit in a printable brief with real numbered positions", () => {
  const handoff = brief();
  handoff.review!.pendingAnalysis = true;
  const html = buildPlanningSummaryHtml(handoff, [{ pageNumber: 1, imageDataUrl: "data:image/png;base64,AA==" }]);
  assert.ok(html.includes("Entwurf · offene Angaben enthalten"));
  assert.ok(html.includes("Analyse war beim Export noch nicht abgeschlossen"));
  assert.ok(html.includes("alt=\"Planseite 1\""));
  assert.ok(html.includes("left:10%"));
  assert.ok(html.includes("<span>2</span>"));
});

test("printable plan retains polygon islands instead of filling the full enclosing rectangle", () => {
  const handoff = brief();
  handoff.areas[0].footprint = { parts: [{ outer: [{ x: .1, y: .1 }, { x: .6, y: .1 }, { x: .6, y: .2 }, { x: .1, y: .2 }],
    holes: [[{ x: .2, y: .13 }, { x: .4, y: .13 }, { x: .4, y: .18 }, { x: .2, y: .18 }]] }] };
  const html = buildPlanningSummaryHtml(handoff, [{ pageNumber: 1, imageDataUrl: "data:image/png;base64,AA==" }]);
  assert.ok(html.includes('class="area polygon"'));
  assert.ok(html.includes('fill-rule="evenodd"'));
  assert.ok(html.includes('M0.2,0.3 L0.6,0.3 L0.6,0.8 L0.2,0.8 Z'));
  // Invalid coordinates are never interpolated into SVG attributes.
  handoff.areas[0].footprint.parts[0].outer[0].x = NaN;
  const fallback = buildPlanningSummaryHtml(handoff, [{ pageNumber: 1, imageDataUrl: "data:image/png;base64,AA==" }]);
  assert.ok(!fallback.includes('class="area polygon"'));
  assert.ok(!fallback.includes('NaN'));
});
