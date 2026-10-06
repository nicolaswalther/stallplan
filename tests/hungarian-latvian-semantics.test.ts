import assert from "node:assert/strict";
import test from "node:test";
import { analyzeSemanticAreas, validateSemanticAreas } from "../lib/ai/areas";
import { classifyAreaLabel, detectStructuralAreas, mergeDetectedAreas } from "../lib/analysis/areas";
import { detectProjectFacts, validateSemanticProjectFacts } from "../lib/analysis/project-facts";
import type { AreaType, DetectedArea, PdfPageData } from "../lib/types";

function page(...labels: string[]): PdfPageData {
  return {
    pageNumber: 1, width: 1000, height: 700, text: labels.join("\n"),
    imageDataUrl: "data:image/jpeg;base64,YQ==", documentKind: "vector",
    textItems: labels.map((text, index) => ({ id: `label-${index}`, text,
      bbox: { x: .3, y: .4 + index * .03, width: .08, height: .015 } })),
    lines: [
      { id: "top", start: { x: .2, y: .25 }, end: { x: .8, y: .25 } },
      { id: "bottom", start: { x: .2, y: .65 }, end: { x: .8, y: .65 } },
      { id: "left", start: { x: .2, y: .25 }, end: { x: .2, y: .65 } },
      { id: "right", start: { x: .8, y: .25 }, end: { x: .8, y: .65 } },
    ],
  };
}

test("Hungarian functional names preserve feeding, manure, resting and calving roles", () => {
  const cases: Array<[string, AreaType]> = [
    ["Etetőút", "feeding_area"], ["Trágyaút (vízöblítés nélkül)", "alley"],
    ["Felhajtóút", "alley"], ["átjáró", "alley"], ["pihenő boxok", "cubicles"],
    ["Ellető boxok", "calving"], ["Borjúnevelő boxok kifutóval", "pens"],
  ];
  for (const [label, kind] of cases) {
    assert.equal(classifyAreaLabel(label), kind, label);
    const result = detectStructuralAreas([page(label)]);
    assert.equal(result.length, 1, label);
    assert.equal(result[0].kind, kind, label);
    assert.equal(result[0].originalLabel, label);
    assert.equal(result[0].source, "geometry");
    assert.equal(result[0].status, "unconfirmed");
  }
  for (const heading of ["Ellető istálló", "Termelő istálló", "Dzemdību bloks", "Kūts plāns", "Pince", "szarvasmarha férőhely", "88db", "2X16db"]) {
    assert.equal(classifyAreaLabel(heading), null, heading);
    assert.deepEqual(detectStructuralAreas([page(heading)]), [], heading);
  }
  assert.equal(classifyAreaLabel("Etetőút / Trágyaút"), null);
});

test("literal Hungarian labels reconcile model enum drift and retain German display names", () => {
  const result = validateSemanticAreas({ documentSummary: "Istálló", warnings: [], areas: [
    { kind: "alley", label: "Etetőút", originalLabel: "Etetőút", confidence: .94,
      pageNumber: 1, hasBbox: true, bbox: { x: .2, y: .25, width: .6, height: .4 },
      evidence: ["Beschriftung Etetőút innerhalb der sichtbaren Fläche."] },
    { kind: "cubicles", label: "Ellető boxok", originalLabel: "Ellető boxok", confidence: .9,
      pageNumber: 1, hasBbox: true, bbox: { x: .1, y: .7, width: .3, height: .1 },
      evidence: ["Beschriftung Ellető boxok innerhalb der Bucht."] },
  ] }, [page("Etetőút")]);
  assert.deepEqual(result.areas.map((area) => area.kind), ["feeding_area", "calving"]);
  assert.deepEqual(result.areas.map((area) => area.label), ["Fressbereiche", "Abkalbebuchten"]);
  assert.equal(result.areas[0].originalLabel, "Etetőút");
  assert.ok(result.areas[0].originalEvidence?.some((entry) => entry.includes("KI-Typ: alley")));
});

test("identical feeding labels remain separate across a long native partition", () => {
  const plan = page("Etetőút", "Etetőút");
  plan.textItems[1].bbox = { ...plan.textItems[0].bbox, x: .6 };
  plan.lines!.push({ id: "partition", start: { x: .5, y: .25 }, end: { x: .5, y: .65 } });
  const result = detectStructuralAreas([plan]);
  assert.equal(result.length, 2);
  assert.ok(result.every((area) => area.kind === "feeding_area"));
  assert.ok(result[0].bbox.x + result[0].bbox.width <= .5);
  assert.ok(result[1].bbox.x >= .5);
  assert.ok(result.every((area) => !area.evidence.some((entry) => entry.includes("2 identische"))));
  plan.lines![4] = { id: "short-symbol", start: { x: .5, y: .37 }, end: { x: .5, y: .44 } };
  assert.equal(detectStructuralAreas([plan]).length, 1, "a short symbol is not proof of a partition");
});

test("a combined drinker-and-passage zone is not one drinker object", () => {
  assert.equal(classifyAreaLabel("itató"), "drinker");
  assert.equal(classifyAreaLabel("itató, áthajtó"), null);
  assert.deepEqual(detectStructuralAreas([page("itató")]), []);
  const object = (evidence: string[]) => ({ kind: "drinker", label: "Tränke", confidence: .95,
    pageNumber: 1, hasBbox: true, bbox: { x: .4, y: .4, width: .015, height: .02 }, evidence });
  const result = validateSemanticAreas({ documentSummary: "Stall", warnings: [], areas: [
    object(["Legende: itató, áthajtó; blaue Querpassage"]),
    object(["Beschriftung: itató am einzelnen Gegenstand"]),
  ] }, [page("Stall")]);
  assert.equal(result.areas.length, 1);
  assert.equal(result.areas[0].confidence, .89);
});

test("Hungarian manure-lane proof excludes an overlapping model cubicle error", () => {
  const native: DetectedArea = { id: "native", kind: "alley", originalLabel: "Trágyaút", label: "Laufgang",
    source: "geometry", confidence: .91, status: "unconfirmed", pageNumber: 1, hasBbox: true,
    bbox: { x: .2, y: .3, width: .6, height: .08 }, evidence: ["PDF-Beschriftung"],
    originalEvidence: ["PDF-Beschriftung: Trágyaút"] };
  const wrong: DetectedArea = { ...native, id: "wrong", kind: "cubicles", originalLabel: "Liegeboxen",
    source: "ai", bbox: { x: .21, y: .305, width: .58, height: .07 } };
  assert.deepEqual(mergeDetectedAreas([native], [wrong]).map((area) => area.id), ["native"]);
  assert.equal(mergeDetectedAreas([{ ...native, originalLabel: "átjáró" }], [wrong]).length, 2,
    "a generic passage does not provide exclusive manure-lane proof");
});

test("strong independently labelled native feeding geometry excludes only mostly contained unreviewed AI cubicles", () => {
  const native: DetectedArea = { id: "native-feed", kind: "feeding_area", originalLabel: "Etetőút", label: "Fressbereiche",
    source: "geometry", confidence: .91, status: "unconfirmed", pageNumber: 1, hasBbox: true,
    bbox: { x: .2, y: .3, width: .6, height: .08 }, evidence: ["PDF-Beschriftung und Vektorkanten"] };
  const wrong: DetectedArea = { ...native, id: "wrong-cubicles", kind: "cubicles", originalLabel: "Liegeboxen",
    source: "ai", bbox: { x: .21, y: .305, width: .58, height: .07 } };
  assert.deepEqual(mergeDetectedAreas([native], [wrong]).map((area) => area.id), [native.id]);
  const full = { ...native, id: "semantic-feed", source: "ai" as const, bbox: { x: .18, y: .295, width: .64, height: .09 } };
  const result = mergeDetectedAreas([native], [wrong, full]);
  assert.equal(result.length, 1, "native provenance survives merging a fuller same-labelled feeding envelope");
  assert.equal(result[0].id, native.id);
  assert.equal(result[0].source, "ai");
  for (const weakNative of [
    { ...native, confidence: .89 }, { ...native, source: "ai" as const },
    { ...native, originalLabel: "Etetőút + Trágyaút" },
    { ...native, geometryCorrections: [{ at: "2026-10-06", bbox: native.bbox, source: "customer" as const }] },
  ]) assert.equal(mergeDetectedAreas([weakNative], [wrong]).length, 2);
  for (const protectedArea of [
    { ...wrong, source: "manual" as const }, { ...wrong, status: "confirmed" as const },
    { ...wrong, geometryCorrections: [{ at: "2026-10-06", bbox: wrong.bbox, source: "customer" as const }] },
    { ...wrong, bbox: { ...wrong.bbox, height: .12 } },
    { ...wrong, bbox: { x: .19, y: .29, width: .62, height: .1 }, footprint: { parts: [{
      outer: [{ x: .19, y: .29 }, { x: .81, y: .29 }, { x: .81, y: .39 }, { x: .19, y: .39 }],
      holes: [[{ x: .2, y: .3 }, { x: .8, y: .3 }, { x: .8, y: .38 }, { x: .2, y: .38 }]],
    }] } },
    { ...wrong, kind: "gate" as const }, { ...wrong, kind: "drinker" as const }, { ...wrong, kind: "brush" as const },
  ]) assert.equal(mergeDetectedAreas([native], [protectedArea]).length, 2);
});

test("explicit Hungarian and Latvian animal nouns identify species without inventing herd facts", () => {
  for (const text of ["szarvasmarha férőhely", "S Z A R V A S M A R H A  T A R T Ó", "Borjúnevelő boxok kifutóval", "teļu dzemdību blokam", "liellopu novietne", "govis"]) {
    const result = detectProjectFacts([page(text)]);
    assert.equal(result.animalSpecies?.value, "Rind", text);
    assert.equal(result.animalSpecies?.source, "pdf-text", text);
    assert.equal(result.animalGroup, undefined, text);
    assert.equal(result.animalCount, undefined, text);
  }
  for (const text of ["pihenő boxok", "Ellető boxok", "Dzemdību bloks", "Tel: +371 26125642", "88db", "2X16db"]) {
    assert.deepEqual(detectProjectFacts([page(text)]), {}, text);
  }
  const native = page("szarvasmarha férőhely", "88db", "2X16db");
  assert.equal(detectProjectFacts([native]).animalCount, undefined);
  assert.deepEqual(validateSemanticProjectFacts({ animalCount: {
    value: 88, confidence: .99, pageNumber: 1, sourceText: "88db szarvasmarha férőhely",
  } }, [native]), {});
});

test("multiple area detail views allow a complete structured area response without expanding ordinary requests", async () => {
  const requests: Array<{ max_output_tokens: number; input: unknown }> = [];
  const client = { responses: { create: async (request: { max_output_tokens: number; input: unknown }) => {
    requests.push(request);
    return { model: "gpt-6-luna", output_text: JSON.stringify({ documentSummary: "Stall", warnings: [], areas: [], projectFacts: null }) };
  } } } as unknown as Parameters<typeof analyzeSemanticAreas>[0];
  const ordinary = page("Stall");
  await analyzeSemanticAreas(client, "gpt-6-luna", "plan.pdf", [ordinary]);
  const detailed: PdfPageData = { ...ordinary, areaDetailImages: [.1, .5].map((x) => ({
    bbox: { x, y: .2, width: .3, height: .5 }, imageDataUrl: ordinary.imageDataUrl,
    pixelWidth: 1200, pixelHeight: 1500,
  })) };
  await analyzeSemanticAreas(client, "gpt-6-luna", "plan.pdf", [detailed]);
  assert.deepEqual(requests.map((request) => request.max_output_tokens), [4500, 8000]);
  const content = JSON.stringify(requests[1].input);
  assert.ok(content.includes("Tierbuchten"));
  assert.ok(content.includes("Tore sind ergänzende lokale Objekte"));
  assert.ok(content.includes("Bereichsdetail 2"));
});
