import assert from "node:assert/strict";
import { test } from "node:test";
import { AREA_TYPES } from "../lib/types";
import type { AnswerMap, DetectedArea, PlanningPreferences } from "../lib/types";
import { AREA_RULES, getGroupQuestions } from "../lib/rules";
import {
  countMissingPlanningAnswers, getGroupAnswers, getPlanningGroups, getPlanningProducts, isAnswerMissing,
  resolveAreaAnswers, resolveGroupAnswers,
} from "../lib/domain/planning-preferences";

const project = { animalSpecies: "Rind", projectType: "Umbau / Bestand", animalGroup: "Milchkühe", animalCount: 100 };
const preferences = (): PlanningPreferences => ({ groupAnswers: {}, areaOverrides: {}, additionalEquipment: {} });
function area(id: string, kind: DetectedArea["kind"] = "cubicles", status: DetectedArea["status"] = "confirmed"): DetectedArea {
  return { id, kind, label: id, status, source: "manual", confidence: null, pageNumber: 1, hasBbox: true,
    bbox: { x: 0.1, y: 0.1, width: 0.2, height: 0.2 }, evidence: [] };
}

test("four cubicle rows share one questionnaire, while unreviewed and rejected areas do not create groups", () => {
  const areas = [area("a"), area("b"), area("c"), area("d"), area("rejected", "gate", "rejected"), area("proposal", "drinker", "unconfirmed")];
  assert.deepEqual(getPlanningGroups(areas).map((group) => [group.kind, group.areaIds]), [["cubicles", ["a", "b", "c", "d"]]]);
  assert.equal(countMissingPlanningAnswers(areas, project), 2);
  const prefs = preferences();
  prefs.groupAnswers.cubicles = { cubicleEquipment: "Vorhandene behalten", bedding: "Wasserbett" };
  assert.equal(countMissingPlanningAnswers(areas, project, prefs), 0);
});

test("equipment wishes are groups without fabricated area IDs or geometry", () => {
  const prefs = preferences();
  prefs.additionalEquipment = { drinker: true, brush: false, gate: true };
  const groups = getPlanningGroups([], prefs);
  assert.deepEqual(groups.map((group) => [group.kind, group.areaIds, group.additional]), [["gate", [], true], ["drinker", [], true]]);
  assert.equal(getPlanningGroups([area("existing", "drinker")], prefs).filter((group) => group.kind === "drinker").length, 1);
});

test("project and group defaults propagate, while explicit per-area wishes stay distinct and auditable", () => {
  const prefs = preferences();
  prefs.groupAnswers.cubicles = { cubicleEquipment: "Neu planen", bedding: "Latexmatratze", animalGroup: "Jungvieh", animalCount: 30 };
  prefs.areaOverrides.b = { bedding: "Wasserbett", animalGroup: "Kälber", animalCount: 6 };
  const shared = resolveAreaAnswers(area("a"), project, prefs);
  const overridden = resolveAreaAnswers(area("b"), project, prefs);
  assert.equal(shared.answers.animalSpecies, "Rind");
  assert.equal(shared.answers.animalGroup, "Jungvieh");
  assert.equal(shared.answers.animalCount, 30);
  assert.equal(shared.provenance.animalSpecies.scope, "project");
  assert.equal(shared.provenance.bedding.scope, "group");
  assert.deepEqual(overridden.provenance.bedding, { source: "customer", scope: "area", groupKind: "cubicles", areaId: "b" });
  assert.equal(overridden.answers.bedding, "Wasserbett");
  prefs.groupAnswers.cubicles.bedding = "Noppen-Matratze Comfort";
  assert.equal(resolveAreaAnswers(area("a"), project, prefs).answers.bedding, "Noppen-Matratze Comfort");
  assert.equal(resolveAreaAnswers(area("b"), project, prefs).answers.bedding, "Wasserbett");
});

test("project total headcount is not repeated as the population of each area or equipment group", () => {
  const prefs = preferences();
  assert.equal(getGroupAnswers("cubicles", project, prefs).animalCount, undefined);
  assert.equal(resolveAreaAnswers(area("a"), project, prefs).answers.animalCount, undefined);
  assert.equal(resolveAreaAnswers(area("a"), { ...project, planningNotes: "Beleuchtung ergänzen" }, prefs).answers.planningNotes, undefined);
  assert.equal(project.animalCount, 100);
  prefs.groupAnswers.cubicles = { animalCount: 24 };
  assert.equal(resolveAreaAnswers(area("a"), project, prefs).answers.animalCount, 24);
});

test("blank overrides restore inherited values and remove inactive branch answers from resolved handoff", () => {
  const prefs = preferences();
  prefs.groupAnswers.drinker = { frostProtection: "Ja", heatingContext: "Noch keine", heatingPreference: "Neue Umlaufheizung prüfen" };
  prefs.areaOverrides.d = { frostProtection: "Nein", heatingPreference: "" };
  const resolved = resolveAreaAnswers(area("d", "drinker"), project, prefs);
  assert.equal(resolved.answers.frostProtection, "Nein");
  assert.equal(resolved.answers.heatingContext, undefined);
  assert.equal(resolved.answers.heatingPreference, undefined);
  assert.equal(resolved.provenance.heatingPreference, undefined);
  assert.equal(prefs.groupAnswers.drinker.heatingPreference, "Neue Umlaufheizung prüfen");
  prefs.areaOverrides.d.frostProtection = "";
  assert.equal(resolveAreaAnswers(area("d", "drinker"), project, prefs).answers.frostProtection, "Ja");
});

test("frost questions distinguish installed infrastructure from desired new system and never exceed three required decisions", () => {
  const active = (answers: Record<string, string>) => getGroupQuestions("drinker", answers).filter((question) => question.required).map((question) => question.id);
  assert.deepEqual(active({ frostProtection: "Nein", heatingContext: "Noch keine" }), ["frostProtection"]);
  assert.deepEqual(active({ frostProtection: "Ja" }), ["frostProtection", "heatingContext"]);
  assert.deepEqual(active({ frostProtection: "Ja", heatingContext: "Umlaufheizung vorhanden" }), ["frostProtection", "heatingContext"]);
  assert.deepEqual(active({ frostProtection: "Ja", heatingContext: "Noch keine" }), ["frostProtection", "heatingContext", "heatingPreference"]);
  assert.equal(getGroupQuestions("brush", { brushType: "Mechanisch" }).some((question) => question.id === "brushPower"), false);
});

test("an area that activates an additional branch must answer its extra question without repeating group omissions", () => {
  const prefs = preferences();
  const areas = [area("d1", "drinker"), area("d2", "drinker")];
  prefs.groupAnswers.drinker = { frostProtection: "Nein" };
  assert.equal(countMissingPlanningAnswers(areas, project, prefs), 0);
  prefs.areaOverrides.d2 = { frostProtection: "Ja" };
  assert.equal(countMissingPlanningAnswers(areas, project, prefs), 1);
  prefs.areaOverrides.d2.heatingContext = "Noch keine";
  assert.equal(countMissingPlanningAnswers(areas, project, prefs), 1);
  prefs.areaOverrides.d2.heatingPreference = "Planungsteam entscheidet";
  assert.equal(countMissingPlanningAnswers(areas, project, prefs), 0);
});

test("short non-dimensional questionnaires allow honest uncertainty and reject invalid explicit selections or counts", () => {
  const scenarios: AnswerMap[] = [{}, { frostProtection: "Ja", heatingContext: "Unbekannt", brushType: "Elektrisch", gateLocation: "Innen und außen" }];
  for (const kind of AREA_TYPES) for (const answers of scenarios) {
    const questions = getGroupQuestions(kind, answers);
    assert.ok(questions.filter((question) => question.required).length <= 3, kind);
    assert.ok(questions.every((question) => !/breite|länge|höhe|abstand/i.test(question.label)), kind);
  }
  assert.equal(isAnswerMissing(AREA_RULES.cubicles.questions[0], "Invented model answer"), true);
  const count = { id: "animalCount", label: "Tieranzahl", type: "number" as const, required: false };
  assert.equal(isAnswerMissing(count, -1), true);
  assert.equal(isAnswerMissing(count, 2.5), true);
  assert.equal(isAnswerMissing(count, 2), false);
  const prefs = preferences();
  prefs.groupAnswers.cubicles = { cubicleEquipment: "Noch offen", bedding: "Planungsteam entscheidet" };
  assert.equal(countMissingPlanningAnswers([area("a")], project, prefs), 0);
});

test("published system families are filtered deterministically by wishes without returning product articles", () => {
  assert.deepEqual(getPlanningProducts("feeding_area", { feedingRestraint: "Nein" }), ["Futtertischabtrennungen", "Schrägfressgitter"]);
  assert.deepEqual(getPlanningProducts("feeding_area", { feedingRestraint: "Ja" }), ["Selbstfang-Fressgitter", "Sicherheits-Selbstfang-Fressgitter"]);
  assert.ok(getPlanningProducts("cubicles", { bedding: "Wasserbett" }).includes("Wasserbetten"));
  assert.ok(!getPlanningProducts("cubicles", { bedding: "Wasserbett" }).includes("Latexmatratzen"));
  assert.ok(!getPlanningProducts("cubicles", { bedding: "Vorhandene Liegefläche behalten" }).includes("Wasserbetten"));
  assert.deepEqual(getPlanningProducts("brush", { brushType: "Mechanisch" }), ["Mechanische Schwingbürsten"]);
  assert.ok(!getPlanningProducts("drinker", { frostProtection: "Nein" }).includes("24-V-Transformatoren"));
  assert.ok(!getPlanningProducts("drinker", { frostProtection: "Ja", heatingContext: "Einzelheizung / Transformator vorhanden" }).includes("Umlaufheizsysteme"));
  assert.ok(!getPlanningProducts("drinker", { frostProtection: "Ja", heatingContext: "Noch keine", heatingPreference: "Neue Umlaufheizung prüfen" }).includes("24-V-Transformatoren"));
  assert.ok(!getPlanningProducts("pens", { animalGroup: "Jungvieh" }).some((name) => name.startsWith("Kälber-")));
  assert.ok(AREA_TYPES.filter((kind) => kind !== "unknown").every((kind) => AREA_RULES[kind].sources?.every((source) => source.url.startsWith("https://www.patura.com/"))));
  assert.equal(resolveGroupAnswers("brush", project, preferences()).provenance.animalGroup.scope, "project");
});

test("clearing optional project facts keeps them optional, while nonblank invalid counts need correction", () => {
  assert.equal(countMissingPlanningAnswers([], { ...project, animalGroup: "", animalCount: "" }), 0);
  for (const animalCount of [0, -1, 1.5]) {
    assert.equal(countMissingPlanningAnswers([], { ...project, animalCount }), 1);
  }
});

test("fully answered per-area overrides do not require unused shared defaults", () => {
  const prefs = preferences();
  prefs.areaOverrides.a = { cubicleEquipment: "Neu planen", bedding: "Latexmatratze" };
  prefs.areaOverrides.b = { cubicleEquipment: "Vorhandene behalten", bedding: "Wasserbett" };
  assert.equal(countMissingPlanningAnswers([area("a"), area("b")], project, prefs), 0);
  prefs.additionalEquipment.drinker = true;
  prefs.areaOverrides.d = { frostProtection: "Nein" };
  assert.equal(countMissingPlanningAnswers([area("a"), area("b"), area("d", "drinker")], project, prefs), 1);
});
