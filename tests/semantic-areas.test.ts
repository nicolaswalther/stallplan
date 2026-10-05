import assert from "node:assert/strict";
import test from "node:test";
import { validateSemanticAreas } from "../lib/ai/areas";
import { classifyAreaLabel, classifyUnambiguousAreaLabel, detectStructuralAreas } from "../lib/analysis/areas";
import type { AreaType, PdfPageData } from "../lib/types";

const bbox = { x: 0.4, y: 0.4, width: 0.12, height: 0.015 };
function enclosurePage(text: string): PdfPageData {
  return {
    pageNumber: 1, width: 1000, height: 700, text,
    textItems: [{ id: "label", text, bbox }],
    imageDataUrl: "data:image/jpeg;base64,YQ==", documentKind: "vector",
    lines: [
      { id: "top", start: { x: 0.2, y: 0.25 }, end: { x: 0.8, y: 0.25 } },
      { id: "bottom", start: { x: 0.2, y: 0.65 }, end: { x: 0.8, y: 0.65 } },
      { id: "left", start: { x: 0.2, y: 0.25 }, end: { x: 0.2, y: 0.65 } },
      { id: "right", start: { x: 0.8, y: 0.25 }, end: { x: 0.8, y: 0.65 } },
    ],
  };
}
const candidate = (kind: AreaType, evidence: string[], confidence = 0.97) => ({
  kind, label: kind, confidence, pageNumber: 1, hasBbox: true,
  bbox: { x: 0.4, y: 0.4, width: 0.015, height: 0.02 }, evidence,
});

test("animal pens and isolation labels stay distinct from cubicle rows and calving", () => {
  const cases: Array<[string, AreaType]> = [
    ["Jungviehbucht", "pens"], ["Kälberboxen", "pens"], ["Rinderbuchten", "pens"],
    ["jałownik", "pens"], ["cielętnik", "pens"], ["Krankenbucht", "isolation"],
    ["izolatka", "isolation"], ["porodówka", "calving"], ["legowiska", "cubicles"],
  ];
  for (const [label, kind] of cases) {
    assert.equal(classifyAreaLabel(label), kind, label);
    const detected = detectStructuralAreas([enclosurePage(label)]);
    assert.equal(detected.length, 1, label);
    assert.equal(detected[0].kind, kind, label);
  }
  for (const annotation of ["94 DJP", "600", "1:100", "Büro", "2500 m³", "blaue Markierung"]) {
    assert.equal(classifyAreaLabel(annotation), null, annotation);
  }
});

test("equipment and gate labels never turn an enclosing room into a device or opening", () => {
  for (const label of ["Tränke", "poidło", "Kuhbürste", "szczotka", "Stalltor", "brama"]) {
    assert.ok(classifyAreaLabel(label), label);
    assert.deepEqual(detectStructuralAreas([enclosurePage(label)]), [], label);
  }
  const room = enclosurePage("Jungviehbucht");
  room.textItems.push({ text: "Tränke", bbox: { ...bbox, y: 0.48 } });
  const detected = detectStructuralAreas([room]);
  assert.equal(detected.length, 1);
  assert.equal(detected[0].kind, "pens");
});

test("a table of pen and isolation labels cannot produce physical rooms", () => {
  const schedule = enclosurePage("Jungviehbucht");
  schedule.textItems.push({ text: "Krankenbucht", bbox: { ...bbox, y: 0.48 } });
  assert.deepEqual(detectStructuralAreas([schedule]), []);
});

test("semantic taxonomy accepts new animal zones without generating product advice", () => {
  const result = validateSemanticAreas({ documentSummary: "Stall", warnings: [], areas: [
    candidate("pens", ["Beschriftung Jungviehbucht in sichtbarer Raumkontur"]),
    candidate("isolation", ["Beschriftung izolatka in sichtbarer Raumkontur"]),
    candidate("gate", ["Torzeichen an der Außenwandöffnung"]),
  ] }, [enclosurePage("Stall")]);
  assert.deepEqual(result.areas.map((area) => area.kind), ["pens", "isolation", "gate"]);
  assert.ok(result.areas.every((area) => area.source === "ai" && area.status === "unconfirmed"));
  assert.ok(result.areas.every((area) => !("products" in area) && !("measurements" in area)));
});

test("blue marks and generic shapes cannot be promoted into drinkers or brushes", () => {
  const result = validateSemanticAreas({ documentSummary: "Stall", warnings: [], areas: [
    candidate("drinker", ["Blaues Rechteck neben der Wand"]),
    candidate("drinker", ["Tränkesymbol in Blau"]),
    candidate("brush", ["Ein Kreis im Laufgang"]),
    candidate("brush", ["Bürstensymbol in Blau"]),
    candidate("drinker", ["Unbeschriftetes Tränkesymbol, blaues Rechteck"]),
    candidate("drinker", ["Keine lesbare Beschriftung; blaues Tränkesymbol"]),
    candidate("brush", ["Bürstensymbol ohne erkennbare Borsten"]),
  ] }, [enclosurePage("Stall")]);
  assert.deepEqual(result.areas, []);
  assert.ok(result.warnings.some((warning) => warning.includes("konkreten Planbeleg")));
});

test("legends and concrete equipment geometry create reviewable suggestions", () => {
  const result = validateSemanticAreas({ documentSummary: "Stall", warnings: [], areas: [
    candidate("drinker", ["Legende: poidło, Symbol an der Stallwand"]),
    candidate("drinker", ["Trogkontur mit Wasseranschluss an der Rückseite"]),
    candidate("brush", ["Beschriftung Kuhbürste am sichtbaren Gegenstand"]),
    candidate("brush", ["Erkennbarer Bürstenkopf mit Borsten am Tragarm"]),
  ] }, [enclosurePage("Stall")]);
  assert.equal(result.areas.length, 4);
  assert.ok(result.areas.every((area) => area.confidence === 0.89 && area.status === "unconfirmed"));
});

test("explicit feeding labels reconcile a mistaken alley type with traceable provenance", () => {
  const label = "12 – korytarz paszowy (Futtergang)";
  const original = { ...candidate("alley", ["Raumaufstellung bezeichnet Bereich 12 als korytarz paszowy."], 0.9), label };
  const result = validateSemanticAreas({ documentSummary: "Stall", warnings: [], areas: [original] }, [enclosurePage("Stall")]);
  assert.equal(result.areas.length, 1);
  const area = result.areas[0];
  assert.equal(area.kind, "feeding_area");
  assert.equal(area.source, "ai");
  assert.equal(area.confidence, 0.9);
  assert.deepEqual(area.bbox, original.bbox);
  assert.equal(area.evidence[0], original.evidence[0]);
  assert.ok(area.evidence[1].includes("Beschriftungsklassifikation") && area.evidence[1].includes("KI-Typ: alley"));
  assert.equal(classifyUnambiguousAreaLabel("Futtertisch / Fressbereich"), "feeding_area");
});

test("compound labels and adjacent-room evidence retain the original semantic decision", () => {
  assert.equal(classifyUnambiguousAreaLabel("Liegeboxen + Laufgang"), null);
  const original = { ...candidate("cubicles", ["Liegeboxen neben einem Futtertisch und Laufgang."], 0.86), label: "Liegeboxen + Laufgang" };
  const unlabeled = { ...candidate("alley", ["Der Laufgang grenzt an den Futtertisch und die Liegeboxen."], 0.82), label: "Bereich 9" };
  const result = validateSemanticAreas({ documentSummary: "Stall", warnings: [], areas: [original, unlabeled] }, [enclosurePage("Stall")]);
  assert.deepEqual(result.areas.map((area) => area.kind), ["cubicles", "alley"]);
  assert.deepEqual(result.areas[0].evidence, original.evidence);
  assert.deepEqual(result.areas[1].evidence, unlabeled.evidence);
  assert.deepEqual(detectStructuralAreas([enclosurePage("Liegeboxen + Laufgang")]), []);
});

test("equipment label reconciliation cannot manufacture its own document evidence", () => {
  const result = validateSemanticAreas({ documentSummary: "Stall", warnings: [], areas: [
    { ...candidate("unknown", ["Blaues Rechteck in der Zeichnung"]), label: "Tränke" },
    { ...candidate("unknown", ["Ein Kreis im Laufgang"]), label: "Kuhbürste" },
  ] }, [enclosurePage("Stall")]);
  assert.deepEqual(result.areas, []);
  assert.ok(result.warnings.some((warning) => warning.includes("konkreten Planbeleg")));
});
