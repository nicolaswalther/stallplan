import assert from "node:assert/strict";
import { test } from "node:test";
import { applyDetectedFacts } from "../lib/domain/inferred-preferences";
import { resolveAreaAnswers, resolveGroupAnswers } from "../lib/domain/planning-preferences";
import type { AnswerProvenance, PlanningPreferences, ProjectFact, ProjectFacts } from "../lib/types";

const preferences = (): PlanningPreferences => ({ groupAnswers: {}, areaOverrides: {}, additionalEquipment: {} });
const fact = (value: ProjectFact["value"], overrides: Partial<ProjectFact> = {}): ProjectFact => ({
  value, confidence: 0.97, source: "pdf-text", scope: "project", pageNumber: 1,
  evidence: ["Explizite PDF-Beschriftung, Seite 1: „80 Milchkühe insgesamt“"], ...overrides,
});

test("explicit facts fill empty project controls without mutating inputs and keep their source", () => {
  const project = Object.freeze({});
  const prefs = preferences();
  const facts: ProjectFacts = { animalGroup: fact("Milchkühe"), animalCount: fact(80), animalSpecies: fact("Rind") };
  const result = applyDetectedFacts(project, prefs, facts);
  assert.deepEqual(result.projectAnswers, { animalSpecies: "Rind", animalGroup: "Milchkühe", animalCount: 80 });
  assert.deepEqual(project, {});
  assert.equal(result.preferences, prefs);
  assert.equal(result.projectAnswerProvenance.animalSpecies.source, "pdf-text");
  assert.equal(result.projectAnswerProvenance.animalSpecies.scope, "project");
  assert.equal(result.projectAnswerProvenance.animalSpecies.confidence, 0.97);
  assert.deepEqual(result.projectAnswerProvenance.animalSpecies.evidence, facts.animalSpecies.evidence);
  assert.notEqual(result.projectAnswerProvenance.animalSpecies.evidence, facts.animalSpecies.evidence);
});

test("late results never overwrite entered values or intentionally cleared project/group controls", () => {
  const project = { animalSpecies: "Pferd", animalCount: "" };
  const prefs = preferences();
  prefs.groupAnswers.pens = { animalGroup: "" };
  const result = applyDetectedFacts(project, prefs, {
    animalSpecies: fact("Rind"), animalCount: fact(80),
    "pens.animalGroup": fact("Kälber", { scope: "group", groupKind: "pens" }),
  }, { touchedKeys: new Set(["animalCount", "pens.animalGroup"]) });
  assert.equal(result.projectAnswers, project);
  assert.equal(result.preferences, prefs);
  assert.deepEqual(result.projectAnswerProvenance, {});
});

test("an explicit non-cattle species prevents contradictory automatic cattle-group defaults", () => {
  const result = applyDetectedFacts({ animalSpecies: "Pferd" }, preferences(), {
    animalGroup: fact("Milchkühe"), animalSpecies: fact("Rind"),
  });
  assert.deepEqual(result.projectAnswers, { animalSpecies: "Pferd" });
  assert.deepEqual(result.projectAnswerProvenance, {});
});

test("low confidence, unproved, invalid and mis-scoped candidates leave questions open", () => {
  const candidates: ProjectFacts[] = [
    { animalSpecies: fact("Rind", { confidence: 0.89 }) },
    { animalSpecies: fact("Rind", { confidence: Number.NaN }) },
    { animalSpecies: fact("Rind", { confidence: 1.1 }) },
    { animalSpecies: fact("Rind", { evidence: ["  "] }) },
    { animalSpecies: fact("Cattle") },
    { animalGroup: fact("Noch offen") },
    { animalCount: fact(0) },
    { animalCount: fact(2.5) },
    { projectType: fact("Neubau") },
    { "pens.animalGroup": fact("Kälber", { scope: "project" }) },
    { animalGroup: fact("Kälber", { scope: "group", groupKind: "pens" }) },
    { "pens.animalGroup": fact("Kälber", { scope: "group", groupKind: "cubicles" }) },
  ];
  for (const facts of candidates) {
    const project = {};
    const prefs = preferences();
    const provenance = {};
    const result = applyDetectedFacts(project, prefs, facts, { projectAnswerProvenance: provenance });
    assert.equal(result.projectAnswers, project);
    assert.equal(result.preferences, prefs);
    assert.equal(result.projectAnswerProvenance, provenance);
  }
});

test("group facts remain local, while project totals never become the count for each area", () => {
  const prefs = preferences();
  const result = applyDetectedFacts({}, prefs, {
    animalSpecies: fact("Rind"), animalCount: fact(80),
    "pens.animalGroup": fact("Kälber", { scope: "group", groupKind: "pens", source: "ai", confidence: 0.9 }),
    "pens.animalCount": fact(12, { scope: "group", groupKind: "pens" }),
  });
  assert.deepEqual(prefs.groupAnswers, {});
  assert.deepEqual(result.preferences.groupAnswers.pens, { animalGroup: "Kälber", animalCount: 12 });
  const pen = resolveAreaAnswers({ id: "p1", kind: "pens" }, result.projectAnswers, result.preferences, result.projectAnswerProvenance);
  const cubicles = resolveAreaAnswers({ id: "c1", kind: "cubicles" }, result.projectAnswers, result.preferences, result.projectAnswerProvenance);
  assert.equal(pen.answers.animalCount, 12);
  assert.equal(pen.provenance.animalCount.scope, "group");
  assert.equal(pen.provenance.animalGroup.source, "ai");
  assert.equal(pen.provenance.animalGroup.confidence, 0.9);
  assert.equal(cubicles.answers.animalGroup, undefined);
  assert.equal(cubicles.answers.animalCount, undefined);
  assert.equal(result.projectAnswers.animalCount, 80);
});

test("inherited project evidence retains project scope in every group and area", () => {
  const result = applyDetectedFacts({}, preferences(), { animalSpecies: fact("Rind"), animalGroup: fact("Milchkühe") });
  const group = resolveGroupAnswers("cubicles", result.projectAnswers, result.preferences, result.projectAnswerProvenance);
  const area = resolveAreaAnswers({ id: "c1", kind: "cubicles" }, result.projectAnswers, result.preferences, result.projectAnswerProvenance);
  for (const resolved of [group, area]) {
    assert.deepEqual(resolved.provenance.animalSpecies, result.projectAnswerProvenance.animalSpecies);
    assert.deepEqual(resolved.provenance.animalGroup, result.projectAnswerProvenance.animalGroup);
    assert.equal(resolved.provenance.animalGroup.groupKind, undefined);
    assert.equal(resolved.provenance.animalGroup.areaId, undefined);
  }
});

test("explicit group and area changes replace inherited evidence with customer provenance", () => {
  const result = applyDetectedFacts({}, preferences(), { animalSpecies: fact("Rind"), animalGroup: fact("Milchkühe") });
  result.preferences.groupAnswers.cubicles = { animalGroup: "Jungvieh" };
  result.preferences.areaOverrides.c1 = { animalGroup: "Kälber" };
  const group = resolveGroupAnswers("cubicles", result.projectAnswers, result.preferences, result.projectAnswerProvenance);
  const area = resolveAreaAnswers({ id: "c1", kind: "cubicles" }, result.projectAnswers, result.preferences, result.projectAnswerProvenance);
  assert.deepEqual(group.provenance.animalGroup, { source: "customer", scope: "group", groupKind: "cubicles" });
  assert.deepEqual(area.provenance.animalGroup, { source: "customer", scope: "area", groupKind: "cubicles", areaId: "c1" });
  assert.equal(area.answers.animalGroup, "Kälber");
  assert.equal(area.provenance.animalSpecies.source, "pdf-text");
});

test("confirming the same inferred value still records a deliberate customer choice", () => {
  const original = applyDetectedFacts({}, preferences(), { animalSpecies: fact("Rind") });
  const customer: Record<string, AnswerProvenance> = { animalSpecies: { source: "customer", scope: "project" } };
  const result = applyDetectedFacts({ animalSpecies: "Rind" }, original.preferences, { animalSpecies: fact("Rind") }, {
    projectAnswerProvenance: customer, touchedKeys: new Set(["animalSpecies"]),
  });
  assert.equal(result.projectAnswerProvenance, customer);
  assert.equal(resolveGroupAnswers("cubicles", result.projectAnswers, result.preferences, result.projectAnswerProvenance).provenance.animalSpecies.source, "customer");
});

test("an old automatic value is not silently updated by later conflicting facts", () => {
  const original = applyDetectedFacts({}, preferences(), { animalCount: fact(80) });
  const later = applyDetectedFacts(original.projectAnswers, original.preferences, { animalCount: fact(81) }, { projectAnswerProvenance: original.projectAnswerProvenance });
  assert.equal(later.projectAnswers, original.projectAnswers);
  assert.equal(later.projectAnswerProvenance, original.projectAnswerProvenance);
  assert.equal(later.projectAnswers.animalCount, 80);
});

test("mis-scoped provenance cannot attribute a customer group override to another group", () => {
  const prefs = preferences();
  prefs.groupAnswers.pens = { animalGroup: "Kälber" };
  prefs.groupAnswerProvenance = { pens: { animalGroup: { source: "ai", scope: "group", groupKind: "cubicles" } } };
  assert.deepEqual(resolveGroupAnswers("pens", {}, prefs).provenance.animalGroup, { source: "customer", scope: "group", groupKind: "pens" });
});

test("a final conflicting snapshot withdraws earlier automatic facts from answers and provenance", () => {
  const initial = applyDetectedFacts({}, preferences(), { animalSpecies: fact("Rind"), animalGroup: fact("Milchkühe"), animalCount: fact(80),
    "pens.animalGroup": fact("Kälber", { scope: "group", groupKind: "pens" }),
  });
  const final = applyDetectedFacts(initial.projectAnswers, initial.preferences, { animalSpecies: fact("Rind") }, {
    projectAnswerProvenance: initial.projectAnswerProvenance, authoritativeSnapshot: true,
  });
  assert.deepEqual(final.projectAnswers, { animalSpecies: "Rind" });
  assert.deepEqual(Object.keys(final.projectAnswerProvenance), ["animalSpecies"]);
  assert.equal(final.preferences.groupAnswers.pens?.animalGroup, undefined);
  assert.equal(final.preferences.groupAnswerProvenance?.pens?.animalGroup, undefined);
  assert.equal(initial.projectAnswers.animalCount, 80);
  assert.equal(initial.preferences.groupAnswers.pens?.animalGroup, "Kälber");
});

test("a changed final fact removes the old automatic value and leaves the conflict open", () => {
  const initial = applyDetectedFacts({}, preferences(), { animalCount: fact(80) });
  const final = applyDetectedFacts(initial.projectAnswers, initial.preferences, { animalCount: fact(81) }, {
    projectAnswerProvenance: initial.projectAnswerProvenance, authoritativeSnapshot: true,
  });
  assert.equal(final.projectAnswers.animalCount, undefined);
  assert.equal(final.projectAnswerProvenance.animalCount, undefined);
});

test("an authoritative result preserves intervening customer edits and deliberately cleared controls", () => {
  const initial = applyDetectedFacts({}, preferences(), { animalSpecies: fact("Rind"), animalCount: fact(80) });
  const final = applyDetectedFacts({ ...initial.projectAnswers, animalCount: 82 }, initial.preferences, {}, {
    projectAnswerProvenance: { ...initial.projectAnswerProvenance, animalCount: { source: "customer", scope: "project" } },
    touchedKeys: new Set(["animalCount"]), authoritativeSnapshot: true,
  });
  assert.deepEqual(final.projectAnswers, { animalCount: 82 });
  assert.deepEqual(final.projectAnswerProvenance.animalCount, { source: "customer", scope: "project" });
  const cleared = applyDetectedFacts({ animalCount: "" }, preferences(), { animalCount: fact(81) }, {
    projectAnswerProvenance: { animalCount: { source: "customer", scope: "project" } },
    touchedKeys: new Set(["animalCount"]), authoritativeSnapshot: true,
  });
  assert.equal(cleared.projectAnswers.animalCount, "");
});

test("a supported authoritative snapshot keeps identities, and non-authoritative partial results retain earlier facts", () => {
  const facts = { animalCount: fact(80) };
  const initial = applyDetectedFacts({}, preferences(), facts);
  for (const [latest, authoritativeSnapshot] of [[facts, true], [{}, false]] as const) {
    const result = applyDetectedFacts(initial.projectAnswers, initial.preferences, latest, {
      projectAnswerProvenance: initial.projectAnswerProvenance, authoritativeSnapshot,
    });
    assert.equal(result.projectAnswers, initial.projectAnswers);
    assert.equal(result.preferences, initial.preferences);
    assert.equal(result.projectAnswerProvenance, initial.projectAnswerProvenance);
  }
});

test("non-cattle projects hide saved cattle group defaults and restore their source when switched back", () => {
  const prefs = preferences();
  prefs.groupAnswers.pens = { animalGroup: "Jungvieh", animalCount: 12 };
  prefs.areaOverrides.p1 = { animalGroup: "Kälber" };
  const otherSpecies = { animalSpecies: "Pferd" };
  for (const resolved of [resolveGroupAnswers("pens", otherSpecies, prefs), resolveAreaAnswers({ id: "p1", kind: "pens" }, otherSpecies, prefs)]) {
    assert.equal(resolved.answers.animalGroup, undefined);
    assert.equal(resolved.provenance.animalGroup, undefined);
    assert.equal(resolved.answers.animalCount, 12);
  }
  assert.equal(prefs.groupAnswers.pens.animalGroup, "Jungvieh");
  assert.equal(prefs.areaOverrides.p1.animalGroup, "Kälber");
  const group = resolveGroupAnswers("pens", { animalSpecies: "Rind" }, prefs);
  const area = resolveAreaAnswers({ id: "p1", kind: "pens" }, { animalSpecies: "Rind" }, prefs);
  assert.equal(group.answers.animalGroup, "Jungvieh");
  assert.deepEqual(group.provenance.animalGroup, { source: "customer", scope: "group", groupKind: "pens" });
  assert.equal(area.answers.animalGroup, "Kälber");
  assert.deepEqual(area.provenance.animalGroup, { source: "customer", scope: "area", groupKind: "pens", areaId: "p1" });
});
