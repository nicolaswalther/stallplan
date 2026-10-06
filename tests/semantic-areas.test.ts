import assert from "node:assert/strict";
import test from "node:test";
import { germanAreaLabel, validateSemanticAreas } from "../lib/ai/areas";
import { classifyAreaLabel, classifyUnambiguousAreaLabel, detectStructuralAreas, mergeDetectedAreas } from "../lib/analysis/areas";
import type { AreaType, DetectedArea, PdfPageData } from "../lib/types";

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

test("a gate label mentioning its adjacent room cannot reclassify the gate as that room", () => {
  const label = "Äußeres Tor der Isolationsbucht 16";
  assert.equal(classifyUnambiguousAreaLabel(label), null);
  const result = validateSemanticAreas({ documentSummary: "Stall", warnings: [], areas: [
    { ...candidate("gate", ["Torzeichen an der Außenwandöffnung"]), label, originalLabel: label },
  ] }, [enclosurePage("Stall")]);
  assert.equal(result.areas[0].kind, "gate");
  assert.equal(classifyUnambiguousAreaLabel("Tor"), "gate");
});

test("a floor-wide collection of gate symbols cannot become one opening footprint", () => {
  const result = validateSemanticAreas({ documentSummary: "Stall", warnings: [], areas: [
    { ...candidate("gate", ["Tore und Durchgänge entlang mehrerer Stallreihen"]), bbox: { x: .14, y: .3, width: .74, height: .38 } },
    candidate("gate", ["Torzeichen an einer einzelnen Öffnung"]),
  ] }, [enclosurePage("Stall")]);
  assert.equal(result.areas.length, 1);
  assert.deepEqual(result.areas[0].bbox, candidate("gate", []).bbox);
  assert.ok(result.warnings.length);
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
  assert.equal(area.label, "Fressbereiche · 12");
  assert.equal(area.originalLabel, label);
  assert.deepEqual(area.bbox, original.bbox);
  assert.equal(area.originalEvidence?.[0], original.evidence[0]);
  assert.ok(area.originalEvidence?.[1].includes("Beschriftungsklassifikation") && area.originalEvidence?.[1].includes("KI-Typ: alley"));
  assert.ok(area.evidence.includes("Eindeutige Planbeschriftung bestätigt die Bereichsart."));
  assert.equal(classifyUnambiguousAreaLabel("Futtertisch / Fressbereich"), "feeding_area");
});

test("visible area labels are always canonical German while source labels remain in the audit", () => {
  for (const [kind, label, expected] of [
    ["cubicles", "8 – legowiska", "Liegeboxen · 8"],
    ["calving", "15. porodówka", "Abkalbebuchten · 15"],
    ["isolation", "Room 16: hospital pen", "Kranken- / Separationsbuchten · 16"],
    ["pens", "calf pen", "Tierbuchten"],
    ["cubicles", "2-reihige Liegeboxen", "Liegeboxen"],
  ] as const) {
    assert.equal(germanAreaLabel(kind, label), expected);
    const result = validateSemanticAreas({ documentSummary: "Stall", warnings: [], areas: [{ ...candidate(kind, ["Beschriftung im Plan"]), label }] }, [enclosurePage("Stall")]);
    assert.equal(result.areas[0].label, expected);
    assert.equal(result.areas[0].originalLabel, label);
  }
});

test("compound labels and adjacent-room evidence retain the original semantic decision", () => {
  assert.equal(classifyUnambiguousAreaLabel("Liegeboxen + Laufgang"), null);
  const original = { ...candidate("cubicles", ["Liegeboxen neben einem Futtertisch und Laufgang."], 0.86), label: "Liegeboxen + Laufgang" };
  const unlabeled = { ...candidate("alley", ["Der Laufgang grenzt an den Futtertisch und die Liegeboxen."], 0.82), label: "Bereich 9" };
  const result = validateSemanticAreas({ documentSummary: "Stall", warnings: [], areas: [original, unlabeled] }, [enclosurePage("Stall")]);
  assert.deepEqual(result.areas.map((area) => area.kind), ["cubicles", "alley"]);
  assert.deepEqual(result.areas[0].originalEvidence, original.evidence);
  assert.deepEqual(result.areas[1].originalEvidence, unlabeled.evidence);
  assert.deepEqual(detectStructuralAreas([enclosurePage("Liegeboxen + Laufgang")]), []);
});

test("foreign model descriptions remain in the audit and public summaries and warnings stay German", () => {
  const result = validateSemanticAreas({ documentSummary: "The barn contains cubicles.", warnings: ["The room boundary is uncertain."], areas: [{ ...candidate("cubicles", ["A row of cubicles is visible."]), label: "8 – legowiska" }] }, [enclosurePage("Stall")]);
  assert.equal(result.documentSummary, "1 Stallbereich erkannt.");
  assert.deepEqual(result.warnings, ["Bei einzelnen Bereichen ist die Erkennung unsicher. Bitte Markierungen prüfen."]);
  assert.equal(result.originalAnalysis?.documentSummary, "The barn contains cubicles.");
  assert.deepEqual(result.areas[0].originalEvidence, ["A row of cubicles is visible."]);
  assert.ok(result.areas[0].evidence.every((item) => !item.includes("cubicles")));
});

test("repeated unlabeled cubicle rows have distinct application names without inventing PDF room numbers", () => {
  const result = validateSemanticAreas({ documentSummary: "Stall", warnings: [], areas: [
    { ...candidate("cubicles", ["Liegeboxenreihe sichtbar"]), label: "Liegeboxen", originalLabel: "legowiska 18 DJP" },
    { ...candidate("cubicles", ["Liegeboxenreihe sichtbar"]), label: "Liegeboxen", originalLabel: "legowiska 18 DJP" },
  ] }, [enclosurePage("Stall")]);
  assert.deepEqual(result.areas.map((area) => area.label), ["Liegeboxen · Bereich 1", "Liegeboxen · Bereich 2"]);
  assert.equal(result.areas[0].originalLabel, "legowiska 18 DJP");
});

test("equipment label reconciliation cannot manufacture its own document evidence", () => {
  const result = validateSemanticAreas({ documentSummary: "Stall", warnings: [], areas: [
    { ...candidate("unknown", ["Blaues Rechteck in der Zeichnung"]), label: "Tränke" },
    { ...candidate("unknown", ["Ein Kreis im Laufgang"]), label: "Kuhbürste" },
  ] }, [enclosurePage("Stall")]);
  assert.deepEqual(result.areas, []);
  assert.ok(result.warnings.some((warning) => warning.includes("konkreten Planbeleg")));
});

test("Polish manure lanes and counted furnishings preserve the explicit primary room function", () => {
  for (const label of ["GANEK GNOJOWY - GRUPA 106 KRÓW", "Korytarz gnojowy", "ganek spacerowy"]) assert.equal(classifyAreaLabel(label), "alley");
  for (const label of ["SEPARATKA - 10 LEGOWISK", "  SEPARATKA - 10 LEGOWISK ", "16 – SEPARATKA - 10 LEGOWISK", "Isolationsbucht mit 10 Liegeboxen"]) assert.equal(classifyAreaLabel(label), "isolation", label);
  assert.equal(classifyAreaLabel("PORODÓWKA - 2 LEGOWISKA"), "calving");
  assert.equal(classifyAreaLabel("10 LEGOWISK"), "cubicles");
  for (const label of ["SEPARATKA + LEGOWISKA", "Tor der SEPARATKA - 10 LEGOWISK", "SEPARATKA neben 10 LEGOWISK", "GANEK GNOJOWY + STÓŁ PASZOWY"]) assert.equal(classifyUnambiguousAreaLabel(label), null, label);
  const parsed = validateSemanticAreas({ documentSummary: "Stall", warnings: [], areas: [{ ...candidate("cubicles", ["Beschriftung SEPARATKA - 10 LEGOWISK"]), originalLabel: "SEPARATKA - 10 LEGOWISK" }] }, [enclosurePage("Stall")]);
  assert.equal(parsed.areas[0].kind, "isolation");
});

test("identical spaced labels on the same feeding strip share one enclosure while stacked schedules stay excluded", () => {
  const strip = enclosurePage("STÓŁ PASZOWY");
  strip.textItems = [{ text: "STÓŁ PASZOWY", bbox: { ...bbox, x: .3, width: .08 } }, { text: "STÓŁ PASZOWY", bbox: { ...bbox, x: .6, width: .08 } }];
  const detected = detectStructuralAreas([strip]);
  assert.equal(detected.length, 1); assert.equal(detected[0].kind, "feeding_area");
  assert.equal(detected[0].originalLabel, "STÓŁ PASZOWY");
  assert.ok(detected[0].evidence.some((entry) => entry.includes("2 identische")));
  strip.textItems[1].bbox.y = .5;
  assert.deepEqual(detectStructuralAreas([strip]), [], "two schedule rows must not become a physical strip");
});

test("dense identical floor strokes cannot create small room sides around the native label", () => {
  const plan = enclosurePage("GANEK GNOJOWY");
  for (let index = 0; index < 50; index++) plan.lines!.push({ id: `floor-${index}`, start: { x: .35 + index * .005, y: .25 }, end: { x: .35 + index * .005, y: .65 } });
  const result = detectStructuralAreas([plan]);
  assert.equal(result.length, 1);
  assert.deepEqual(result[0].bbox, { x: .2, y: .25, width: .6000000000000001, height: .4 });
});

function mergeArea(kind: AreaType, id: string, bbox: DetectedArea["bbox"], source: DetectedArea["source"], originalLabel: string, confidence = .95): DetectedArea {
  return { id, kind, label: kind, originalLabel, confidence, bbox, source, status: "unconfirmed", pageNumber: 1, hasBbox: true, evidence: ["Planbeleg"], originalEvidence: [`PDF-Beschriftung: ${originalLabel}`] };
}

test("a fuller semantic envelope replaces a contained native fragment only with exact document-label identity", () => {
  const native = mergeArea("feeding_area", "native", { x: .2, y: .3, width: .2, height: .1 }, "geometry", "STÓŁ PASZOWY", .82);
  const semantic = mergeArea("feeding_area", "vision", { x: .1, y: .29, width: .7, height: .12 }, "ai", "STÓŁ PASZOWY", .97);
  const result = mergeDetectedAreas([native], [semantic]);
  assert.equal(result.length, 1); assert.equal(result[0].source, "ai"); assert.equal(result[0].id, native.id); assert.deepEqual(result[0].bbox, semantic.bbox);
  assert.equal(result[0].confidence, .82); assert.ok(result[0].evidence.some((entry) => entry.includes("PDF-Beschriftung bestätigt")));
  assert.equal(result[0].status, "unconfirmed");
  assert.equal(mergeDetectedAreas([native], [{ ...semantic, originalLabel: "Futtertisch Neubau" }]).length, 2, "containing another same-type region is insufficient");
});

test("native manure-lane proof removes a coincident AI cubicle row after larger envelopes are merged", () => {
  const native = mergeArea("alley", "native", { x: .3, y: .3, width: .3, height: .08 }, "geometry", "GANEK GNOJOWY - GRUPA 106 KRÓW", .91);
  const full = mergeArea("alley", "lane", { x: .15, y: .295, width: .7, height: .09 }, "ai", native.originalLabel!, .95);
  const wrong = mergeArea("cubicles", "wrong", { x: .16, y: .3, width: .65, height: .075 }, "ai", "Liegeboxenreihe");
  const real = mergeArea("cubicles", "real", { x: .16, y: .5, width: .65, height: .075 }, "ai", "Liegeboxenreihe");
  const gate = mergeArea("gate", "gate", { x: .3, y: .32, width: .02, height: .02 }, "ai", "Tor");
  const customer = { ...wrong, id: "customer", source: "manual" as const };
  const corrected = { ...wrong, id: "corrected", geometryCorrections: [{ at: "2026-10-06", bbox: wrong.bbox, source: "customer" as const }] };
  const result = mergeDetectedAreas([native], [wrong, real, gate, customer, corrected, full]);
  assert.deepEqual(new Set(result.map((area) => area.id)), new Set(["native", "real", "gate", "customer", "corrected"]));
  assert.equal(mergeDetectedAreas([{ ...native, originalLabel: "KOMUNIKACJA" }], [wrong, { ...full, originalLabel: "KOMUNIKACJA" }]).length, 2, "generic circulation text is not exclusive manure-lane proof");
});

test("an AI cubicle candidate partly crossing a proven lane is retained below the exclusive-overlap threshold", () => {
  const native = mergeArea("alley", "native", { x: .2, y: .3, width: .6, height: .08 }, "geometry", "GANEK GNOJOWY");
  const crossing = mergeArea("cubicles", "crossing", { x: .2, y: .3, width: .6, height: .12 }, "ai", "Liegeboxenreihe");
  assert.equal(mergeDetectedAreas([native], [crossing]).length, 2);
});
