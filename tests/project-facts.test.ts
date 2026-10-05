import assert from "node:assert/strict";
import test from "node:test";
import { detectProjectFacts, mergeProjectFacts, reconcileProjectFacts, validateSemanticProjectFacts } from "../lib/analysis/project-facts";
import type { DetectedArea, PdfPageData } from "../lib/types";

function page(...labels: string[]): PdfPageData {
  return {
    pageNumber: 1, width: 1000, height: 700, text: labels.join("\n"), imageDataUrl: "", documentKind: "vector",
    textItems: labels.map((text, index) => ({ text, bbox: { x: 0.1, y: 0.1 + index * 0.08, width: 0.4, height: 0.02 } })),
  };
}
function area(kind: DetectedArea["kind"], evidence: string[]): DetectedArea {
  return { id: kind, kind, label: kind, source: "ai", confidence: 0.9, status: "unconfirmed", pageNumber: 1, bbox: { x: 0.1, y: 0.1, width: 0.3, height: 0.3 }, hasBbox: true, evidence };
}

test("explicit multilingual herd descriptions produce German facts with provenance", () => {
  for (const text of ["Tierbestand: 80 Milchkühe", "Total: 80 dairy cows", "Razem: 80 krowy mleczne", "Milchkühe insgesamt: 80", "Tieranzahl insgesamt: 80 Rinder"]) {
    const facts = detectProjectFacts([page(text)]);
    assert.equal(facts.animalSpecies?.value, "Rind", text);
    assert.equal(facts.animalCount?.value, 80, text);
    if (!text.endsWith("Rinder")) assert.equal(facts.animalGroup?.value, "Milchkühe", text);
    assert.equal(facts.animalSpecies?.source, "pdf-text");
    assert.ok(facts.animalSpecies?.evidence[0].startsWith("Explizite PDF-Beschriftung, Seite 1:"));
  }
  assert.equal(detectProjectFacts([page("24 Pferde")]).animalSpecies.value, "Pferd");
  assert.equal(detectProjectFacts([page("youngstock pen")]).animalGroup.value, "Jungvieh");
  assert.equal(detectProjectFacts([page("Kälberbucht")]).animalSpecies.value, "Rind");
});

test("vision herd facts require literal animal labels or an explicit total and tolerate absent old fields", () => {
  const visualPage = { ...page("94 DJP"), imageDataUrl: "data:image/jpeg;base64,YQ==" };
  const candidate = (value: string | number, sourceText: string, confidence = 0.94) => ({ value, sourceText, confidence, pageNumber: 1 });
  const facts = validateSemanticProjectFacts({ animalSpecies: candidate("Rind", "Krowy mleczne"), animalGroup: candidate("Milchkühe", "Krowy mleczne"), animalCount: candidate(80, "Tieranzahl insgesamt: 80") }, [visualPage]);
  assert.equal(facts.animalSpecies.value, "Rind");
  assert.equal(facts.animalGroup.value, "Milchkühe");
  assert.equal(facts.animalCount.value, 80);
  assert.equal(facts.animalSpecies.source, "ai");
  assert.deepEqual(validateSemanticProjectFacts(undefined, [visualPage]), {});
  assert.deepEqual(validateSemanticProjectFacts({ animalSpecies: candidate("Rind", "legowiska"), animalGroup: candidate("Milchkühe", "krowy"), animalCount: candidate(94, "94 DJP") }, [visualPage]), {});
  assert.deepEqual(validateSemanticProjectFacts({ animalCount: candidate(80, "80 Milchkühe") }, [visualPage]), {}, "Local room numbers cannot become a project total");
  assert.deepEqual(validateSemanticProjectFacts({ animalSpecies: candidate("Rind", "Rinder", 0.89) }, [visualPage]), {});
  assert.deepEqual(validateSemanticProjectFacts({ animalSpecies: candidate("Rind", "Rinder") }, [page("94 DJP")]), {}, "An unpictured page cannot support an unseen quote");
  assert.deepEqual(validateSemanticProjectFacts({ animalSpecies: candidate("Rind", "Rinder") }, [{ ...visualPage, textItems: page("Pferde").textItems }]), {}, "Conflicting native words take priority");
});

test("DJP, floor areas, capacity, dimensions and dates never become headcounts", () => {
  for (const text of ["94 DJP", "2500 m³", "Kälber 42 m²", "Rinder 300 cm", "Milchkühe 12.5 m", "Milchkühe 120 Plätze", "12 Kälberboxen", "Milchkühe: 24 cubicles", "datum 05.10.2026", "1:100", "0,00 = 136,6 m n.p.m."]) {
    assert.equal(detectProjectFacts([page(text)]).animalCount, undefined, text);
  }
  const technical = detectProjectFacts([page("Liegeboxen", "Futtertisch", "94 DJP")]);
  assert.equal(technical.animalSpecies, undefined, "Equipment alone does not prove species");
  assert.equal(technical.animalGroup, undefined, "Cubicles alone do not prove dairy cows");
});

test("mixed groups and local numbers are not added into a guessed project herd", () => {
  const mixed = detectProjectFacts([page("40 Milchkühe", "20 Kälber")]);
  assert.equal(mixed.animalSpecies.value, "Rind");
  assert.equal(mixed.animalGroup, undefined);
  assert.equal(mixed.animalCount, undefined);
  assert.equal(detectProjectFacts([page("24 Milchkühe", "18 Milchkühe")]).animalCount, undefined);
  assert.equal(detectProjectFacts([page("12 Kälber")]).animalCount, undefined, "A single local group count is not a project total");
  assert.equal(detectProjectFacts([page("24 Milchkühe", "24 Milchkühe")]).animalCount, undefined, "Equal room counts are not a project total");
  assert.equal(detectProjectFacts([page("60 Rinder", "Tieranzahl insgesamt: 60", "40 Milchkühe", "20 Kälber")]).animalCount.value, 60);
  assert.equal(detectProjectFacts([page("Tieranzahl insgesamt: 60, davon 40 Milchkühe und 20 Kälber")]).animalCount.value, 60);
  assert.equal(detectProjectFacts([page("Tieranzahl insgesamt: 60", "Tieranzahl insgesamt: 70")]).animalCount, undefined);
  assert.equal(detectProjectFacts([page("24 Pferde", "40 Rinder")]).animalSpecies, undefined);
});

test("nearby baseline fragments can form headcounts, unrelated columns cannot", () => {
  const fragmented = page("80", "Milchkühe");
  fragmented.textItems = [
    { text: "80", bbox: { x: 0.1, y: 0.2, width: 0.018, height: 0.02 } },
    { text: "Milchkühe", bbox: { x: 0.123, y: 0.2, width: 0.1, height: 0.02 } },
  ];
  assert.equal(detectProjectFacts([fragmented]).animalCount, undefined, "An adjacent count still needs explicit total context");
  fragmented.textItems[0].text = "Tierbestand:";
  fragmented.textItems[1].text = "80 Milchkühe";
  assert.equal(detectProjectFacts([fragmented]).animalCount.value, 80);
  fragmented.textItems[1].bbox.x = 0.5;
  assert.equal(detectProjectFacts([fragmented]).animalCount, undefined);
});

test("semantic observations require cited source words and preserve group scope", () => {
  const calf = area("pens", ["PDF-Beschriftung: Kälberbucht"]);
  const dairy = area("cubicles", ["Raumaufstellung nennt diesen Bereich „Milchkühe“. "]);
  const facts = detectProjectFacts([page("94 DJP")], [calf, dairy]);
  assert.equal(facts.animalSpecies.value, "Rind");
  assert.equal(facts.animalGroup, undefined);
  assert.equal(facts["pens.animalGroup"].value, "Kälber");
  assert.equal(facts["pens.animalGroup"].scope, "group");
  assert.equal(facts["pens.animalGroup"].groupKind, "pens");
  assert.equal(facts["cubicles.animalGroup"].value, "Milchkühe");
  assert.equal(facts.animalCount, undefined);
  const unsupported = detectProjectFacts([page("94 DJP")], [area("cubicles", ["Die Liegeboxen sind für Milchkühe geeignet."])]);
  assert.equal(unsupported.animalGroup, undefined, "A model's suitability inference is not a source label");
  calf.status = "rejected";
  assert.equal(detectProjectFacts([], [calf]).animalSpecies, undefined);
});

test("native and semantic agreement combines sources and contradictory facts stay open", () => {
  const native = detectProjectFacts([page("Tierbestand: 80 Milchkühe")]);
  const visual = validateSemanticProjectFacts({ animalSpecies: { value: "Rind", sourceText: "dairy cows", confidence: 0.94, pageNumber: 1 } }, [{ ...page(""), imageDataUrl: "data:image/jpeg;base64,YQ==" }]);
  const agreed = mergeProjectFacts(native, visual);
  assert.equal(agreed.animalSpecies.value, "Rind");
  assert.equal(agreed.animalSpecies.source, "pdf-text");
  assert.equal(agreed.animalSpecies.evidence.length, 2);
  const conflicting = mergeProjectFacts(native, { animalSpecies: { ...visual.animalSpecies, value: "Pferd" } });
  assert.equal(conflicting.animalSpecies, undefined);
  const structural = area("pens", ["PDF-Beschriftung: Kälberbucht"]);
  structural.source = "geometry";
  assert.equal(detectProjectFacts([], [structural]).animalSpecies.source, "pdf-text");
});

test("a single semantic candidate cannot resurrect a contradictory combined global fact", () => {
  const native = page("Rinder");
  const horseArea = area("pens", ["Beschriftung: „Pferde“"]);
  const semanticRind = validateSemanticProjectFacts({ animalSpecies: { value: "Rind", sourceText: "Rinder", confidence: 0.94, pageNumber: 1 } }, [native]);
  assert.equal(detectProjectFacts([native], [horseArea]).animalSpecies, undefined);
  assert.equal(reconcileProjectFacts([native], [horseArea], semanticRind).animalSpecies, undefined);

  const calf = area("pens", ["PDF-Beschriftung: Kälberbucht"]);
  const dairy = area("cubicles", ["Raumaufstellung: „Milchkühe“"]);
  const semanticDairy = validateSemanticProjectFacts({ animalGroup: { value: "Milchkühe", sourceText: "Milchkühe", confidence: 0.94, pageNumber: 1 } }, [{ ...page(""), imageDataUrl: "data:image/jpeg;base64,YQ==" }]);
  const reconciled = reconcileProjectFacts([], [calf, dairy], semanticDairy);
  assert.equal(reconciled.animalGroup, undefined);
  assert.equal(reconciled.animalSpecies.value, "Rind");
  assert.equal(reconciled["pens.animalGroup"].value, "Kälber");
  assert.equal(reconciled["cubicles.animalGroup"].value, "Milchkühe");
});

test("conflicting explicit totals remain unresolved even when a semantic result picks one", () => {
  const pages = [page("Tieranzahl insgesamt: 60", "Tieranzahl insgesamt: 70")];
  const semantic = { animalCount: { value: 60, confidence: 0.94, source: "ai" as const, scope: "project" as const, pageNumber: 1, evidence: ["Explizite Planbeschriftung, Seite 1: „Tieranzahl insgesamt: 60“"] } };
  assert.equal(reconcileProjectFacts(pages, [], semantic).animalCount, undefined);
  const agreed = reconcileProjectFacts([page("Tieranzahl insgesamt: 60")], [], semantic);
  assert.equal(agreed.animalCount.value, 60);
  assert.equal(agreed.animalCount.source, "pdf-text");
});
