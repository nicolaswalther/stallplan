import { AREA_RULES, HERD_OVERRIDE_QUESTIONS, PROJECT_FACT_QUESTIONS, PROJECT_QUESTIONS, getGroupQuestions } from "../rules";
import { AREA_TYPES, EQUIPMENT_TYPES } from "../types";
import type { AnswerMap, AnswerProvenance, AnswerValue, AreaType, DetectedArea, DomainQuestion, EquipmentType, PlanningGroup, PlanningPreferences } from "../types";

export const EMPTY_PLANNING_PREFERENCES: PlanningPreferences = { groupAnswers: {}, areaOverrides: {}, additionalEquipment: {} };
export const EQUIPMENT_OPTIONS: Array<{ kind: EquipmentType; title: string }> = EQUIPMENT_TYPES.map((kind) => ({ kind, title: AREA_RULES[kind].title }));

export interface ResolvedAnswers {
  answers: AnswerMap;
  provenance: Record<string, AnswerProvenance>;
}

export function isAnswerMissing(question: DomainQuestion, value: AnswerValue | undefined): boolean {
  if (value === undefined || (typeof value === "string" && !value.trim())) return true;
  if (question.type === "number") return typeof value !== "number" || !Number.isInteger(value) || value <= 0;
  if (question.type === "boolean") return typeof value !== "boolean";
  if (question.type === "select") return typeof value !== "string" || !(question.options ?? []).includes(value);
  return typeof value !== "string";
}

/** One group per confirmed kind. Requested equipment is an unlocated wish. */
export function getPlanningGroups(areas: DetectedArea[], preferences: PlanningPreferences = EMPTY_PLANNING_PREFERENCES): PlanningGroup[] {
  return AREA_TYPES.flatMap((kind) => {
    const areaIds = areas.filter((area) => area.status === "confirmed" && area.kind === kind).map((area) => area.id);
    const additional = EQUIPMENT_TYPES.includes(kind as EquipmentType) && preferences.additionalEquipment[kind as EquipmentType] === true;
    return areaIds.length || additional ? [{ id: kind, kind, title: AREA_RULES[kind].title, areaIds, additional }] : [];
  });
}

function mergeAnswers(target: ResolvedAnswers, incoming: AnswerMap, provenance: AnswerProvenance, savedProvenance: Record<string, AnswerProvenance> = {}) {
  for (const [id, value] of Object.entries(incoming)) {
    // Blank controls restore inheritance rather than storing an empty override.
    if (typeof value === "string" && !value.trim()) continue;
    target.answers[id] = value;
    const saved = savedProvenance[id];
    // Inheritance changes the target area, not the origin of the answer.
    target.provenance[id] = saved && saved.scope === provenance.scope && saved.groupKind === provenance.groupKind
      ? saved : provenance;
  }
}

function applicableAnswers(kind: AreaType, result: ResolvedAnswers): ResolvedAnswers {
  const allowed = new Set([
    ...PROJECT_FACT_QUESTIONS.filter((question) => !["animalCount", "planningNotes"].includes(question.id)).map((question) => question.id),
    ...HERD_OVERRIDE_QUESTIONS.map((question) => question.id),
    ...getGroupQuestions(kind, result.answers).map((question) => question.id),
  ]);
  // Current herd-group choices describe cattle. Keep raw wishes for a later
  // species change, but do not export hidden cattle defaults for another species.
  const species = result.answers.animalSpecies;
  if (typeof species === "string" && species.trim() && species !== "Rind") allowed.delete("animalGroup");
  return {
    answers: Object.fromEntries(Object.entries(result.answers).filter(([id]) => allowed.has(id))),
    provenance: Object.fromEntries(Object.entries(result.provenance).filter(([id]) => allowed.has(id))),
  };
}

export function resolveGroupAnswers(kind: AreaType, projectAnswers: AnswerMap, preferences: PlanningPreferences = EMPTY_PLANNING_PREFERENCES, projectAnswerProvenance: Record<string, AnswerProvenance> = {}): ResolvedAnswers {
  const result: ResolvedAnswers = { answers: {}, provenance: {} };
  mergeAnswers(result, Object.fromEntries(Object.entries(projectAnswers).filter(([id]) => !["animalCount", "planningNotes"].includes(id))), { source: "customer", scope: "project" }, projectAnswerProvenance);
  mergeAnswers(result, preferences.groupAnswers[kind] ?? {}, { source: "customer", scope: "group", groupKind: kind }, preferences.groupAnswerProvenance?.[kind]);
  return applicableAnswers(kind, result);
}

export function getGroupAnswers(kind: AreaType, projectAnswers: AnswerMap, preferences: PlanningPreferences = EMPTY_PLANNING_PREFERENCES, projectAnswerProvenance: Record<string, AnswerProvenance> = {}): AnswerMap {
  return resolveGroupAnswers(kind, projectAnswers, preferences, projectAnswerProvenance).answers;
}

export function resolveAreaAnswers(area: Pick<DetectedArea, "id" | "kind">, projectAnswers: AnswerMap, preferences: PlanningPreferences = EMPTY_PLANNING_PREFERENCES, projectAnswerProvenance: Record<string, AnswerProvenance> = {}): ResolvedAnswers {
  // Resolve the branch after overrides, so an area may activate a question hidden
  // for its group. Raw group wishes must remain available during that resolution.
  const result: ResolvedAnswers = { answers: {}, provenance: {} };
  mergeAnswers(result, Object.fromEntries(Object.entries(projectAnswers).filter(([id]) => !["animalCount", "planningNotes"].includes(id))), { source: "customer", scope: "project" }, projectAnswerProvenance);
  mergeAnswers(result, preferences.groupAnswers[area.kind] ?? {}, { source: "customer", scope: "group", groupKind: area.kind }, preferences.groupAnswerProvenance?.[area.kind]);
  mergeAnswers(result, preferences.areaOverrides[area.id] ?? {}, { source: "customer", scope: "area", groupKind: area.kind, areaId: area.id });
  return applicableAnswers(area.kind, result);
}

function missingQuestions(questions: DomainQuestion[], answers: AnswerMap) {
  return questions.filter((question) => {
    const value = answers[question.id];
    const explicitlyAnswered = value !== undefined && !(typeof value === "string" && !value.trim());
    return (question.required || explicitlyAnswered) && isAnswerMissing(question, value);
  });
}

/** A shared omission is counted once, even for four cubicle rows. */
export function countMissingPlanningAnswers(areas: DetectedArea[], projectAnswers: AnswerMap, preferences: PlanningPreferences = EMPTY_PLANNING_PREFERENCES): number {
  let missing = missingQuestions(PROJECT_FACT_QUESTIONS, projectAnswers).length;
  for (const group of getPlanningGroups(areas, preferences)) {
    const shared = getGroupAnswers(group.kind, projectAnswers, preferences);
    const groupMissing = new Set(missingQuestions([...getGroupQuestions(group.kind, shared), ...HERD_OVERRIDE_QUESTIONS], shared)
      .filter((question) => {
        if (group.additional || !group.areaIds.length || !question.required) return true;
        // A default is optional when every real area has a complete override.
        return group.areaIds.some((areaId) => {
          const effective = resolveAreaAnswers({ id: areaId, kind: group.kind }, projectAnswers, preferences).answers;
          return getGroupQuestions(group.kind, effective).some((active) => active.id === question.id)
            && isAnswerMissing(question, effective[question.id]);
        });
      }).map((question) => question.id));
    missing += groupMissing.size;
    for (const areaId of group.areaIds) {
      if (!Object.keys(preferences.areaOverrides[areaId] ?? {}).length) continue;
      const effective = resolveAreaAnswers({ id: areaId, kind: group.kind }, projectAnswers, preferences).answers;
      missing += missingQuestions([...getGroupQuestions(group.kind, effective), ...HERD_OVERRIDE_QUESTIONS], effective).filter((question) => !groupMissing.has(question.id)).length;
    }
  }
  return missing;
}

/** UI progress for the active shared questionnaire, excluding optional facts. */
export function getGroupQuestionProgress(kind: AreaType, answers: AnswerMap) {
  const questions = getGroupQuestions(kind, answers).filter((question) => question.required);
  return { answered: questions.filter((question) => !isAnswerMissing(question, answers[question.id])).length, total: questions.length };
}

/** Product families are constrained by published rules, never model output. */
export function getPlanningProducts(kind: AreaType, answers: AnswerMap): string[] {
  let products = [...AREA_RULES[kind].products];
  if (kind === "cubicles" && answers.bedding && answers.bedding !== "Planungsteam entscheidet") {
    const selected = answers.bedding === "Latexmatratze" ? "Latexmatratzen"
      : answers.bedding === "Wasserbett" ? "Wasserbetten"
      : answers.bedding === "Noppen-Matratze Comfort" ? "Noppen-Matratze Comfort" : null;
    products = products.filter((product) => !["Latexmatratzen", "Wasserbetten", "Noppen-Matratze Comfort"].includes(product) || product === selected);
  }
  if (kind === "feeding_area" && answers.feedingRestraint === "Nein") products = ["Futtertischabtrennungen", "Schrägfressgitter"];
  if (kind === "feeding_area" && answers.feedingRestraint === "Ja") products = products.filter((product) => !["Futtertischabtrennungen", "Schrägfressgitter"].includes(product));
  if (kind === "pens" && answers.animalGroup && answers.animalGroup !== "Kälber" && answers.animalGroup !== "Noch offen" && answers.animalGroup !== "Gemischte Gruppen") {
    products = products.filter((product) => !product.startsWith("Kälber-"));
  }
  if (kind === "gate" && answers.gateLocation === "Im Stall") products = products.filter((product) => ["Stalltore", "Personenschlupf"].includes(product));
  if (kind === "gate" && answers.gateLocation === "An Außenöffnungen") products = products.filter((product) => ["Schnelllauftore", "Agrartore", "Windschutzvorhänge"].includes(product));
  if (kind === "gate" && answers.personAccess === "Nein") products = products.filter((product) => product !== "Personenschlupf");
  if (kind === "alley" && answers.floorPreference === "Vorhandenen Boden behalten") products = products.filter((product) => product !== "Rillenboden Active Duo");
  if (kind === "alley" && answers.separation === "Nein") products = products.filter((product) => !["Abtrennungen", "Tore"].includes(product));
  if (kind === "brush" && answers.brushType === "Mechanisch") products = ["Mechanische Schwingbürsten"];
  if (kind === "brush" && answers.brushType === "Elektrisch") products = ["Elektrische Pendelbürsten", "Elektrische Doppelbürsten"];
  if (kind === "drinker") {
    if (answers.frostProtection === "Nein") products = products.filter((product) => !["Heizbare Tränken", "Umlaufheizsysteme", "24-V-Transformatoren"].includes(product));
    if (answers.frostProtection === "Ja" && (answers.heatingContext === "Einzelheizung / Transformator vorhanden" || answers.heatingPreference === "Einzelheizung mit Transformator")) products = products.filter((product) => product !== "Umlaufheizsysteme");
    if (answers.frostProtection === "Ja" && (answers.heatingContext === "Umlaufheizung vorhanden" || answers.heatingPreference === "Neue Umlaufheizung prüfen")) products = products.filter((product) => product !== "24-V-Transformatoren");
    if (answers.drinkingType === "Trogtränke") products = products.filter((product) => product !== "Tränkebecken");
    if (answers.drinkingType === "Tränkebecken") products = products.filter((product) => product !== "Trogtränken");
  }
  return products;
}

// Kept separate for consumers that need only the two mandatory project facts.
export { PROJECT_QUESTIONS };
