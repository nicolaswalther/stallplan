import { HERD_OVERRIDE_QUESTIONS, PROJECT_FACT_QUESTIONS } from "../rules";
import { AREA_TYPES } from "../types";
import type { AnswerMap, AnswerProvenance, PlanningPreferences, ProjectFact, ProjectFacts } from "../types";
import { isAnswerMissing } from "./planning-preferences";

export interface InferredPreferencesOptions {
  projectAnswerProvenance?: Record<string, AnswerProvenance>;
  /** Project IDs, or group keys such as `pens.animalGroup`, including cleared controls. */
  touchedKeys?: ReadonlySet<string>;
  /** A completed pipeline can withdraw an earlier fact when new evidence conflicts. */
  authoritativeSnapshot?: boolean;
}

export interface InferredPreferencesResult {
  projectAnswers: AnswerMap;
  preferences: PlanningPreferences;
  projectAnswerProvenance: Record<string, AnswerProvenance>;
}

function isReliable(fact: ProjectFact): boolean {
  return Number.isFinite(fact.confidence) && fact.confidence >= 0.9 && fact.confidence <= 1
    && ["pdf-text", "ai"].includes(fact.source)
    && fact.evidence.some((evidence) => evidence.trim().length > 0);
}

function provenance(fact: ProjectFact): AnswerProvenance {
  return {
    source: fact.source, scope: fact.scope,
    ...(fact.groupKind ? { groupKind: fact.groupKind } : {}),
    confidence: fact.confidence, evidence: [...fact.evidence],
    ...(fact.pageNumber === undefined ? {} : { pageNumber: fact.pageNumber }),
  };
}

function isEmpty(value: AnswerMap[string] | undefined): boolean {
  return value === undefined || (typeof value === "string" && !value.trim());
}

/** Late analysis fills only untouched, empty animal facts. Human decisions always win. */
export function applyDetectedFacts(
  projectAnswers: AnswerMap,
  preferences: PlanningPreferences,
  facts: ProjectFacts,
  options: InferredPreferencesOptions = {},
): InferredPreferencesResult {
  let nextProject = projectAnswers;
  let nextPreferences = preferences;
  let nextProjectProvenance = options.projectAnswerProvenance ?? {};
  const withdrawnKeys = new Set<string>();

  if (options.authoritativeSnapshot) {
    const stillSupported = (key: string, value: AnswerMap[string] | undefined, origin: AnswerProvenance) => {
      const current = facts[key];
      return current && isReliable(current) && current.value === value
        && current.scope === origin.scope && current.groupKind === origin.groupKind;
    };
    for (const [key, origin] of Object.entries(nextProjectProvenance)) {
      if (origin.source === "customer" || options.touchedKeys?.has(key) || stillSupported(key, nextProject[key], origin)) continue;
      nextProject = { ...nextProject };
      nextProjectProvenance = { ...nextProjectProvenance };
      delete nextProject[key];
      delete nextProjectProvenance[key];
      withdrawnKeys.add(key);
    }
    for (const kind of AREA_TYPES) {
      for (const [id, origin] of Object.entries(nextPreferences.groupAnswerProvenance?.[kind] ?? {})) {
        const key = `${kind}.${id}`;
        if (origin.source === "customer" || options.touchedKeys?.has(key) || stillSupported(key, nextPreferences.groupAnswers[kind]?.[id], origin)) continue;
        const answers = { ...nextPreferences.groupAnswers[kind] };
        const origins = { ...nextPreferences.groupAnswerProvenance?.[kind] };
        delete answers[id];
        delete origins[id];
        nextPreferences = { ...nextPreferences,
          groupAnswers: { ...nextPreferences.groupAnswers, [kind]: answers },
          groupAnswerProvenance: { ...nextPreferences.groupAnswerProvenance, [kind]: origins },
        };
        withdrawnKeys.add(key);
      }
    }
  }

  // Species precedes cattle groups even when the upstream object uses another order.
  const entries = Object.entries(facts).sort(([a], [b]) => Number(b === "animalSpecies") - Number(a === "animalSpecies"));
  for (const [key, fact] of entries) {
    if (options.touchedKeys?.has(key) || withdrawnKeys.has(key) || !isReliable(fact)) continue;
    if (fact.scope === "project") {
      if (fact.groupKind || !["animalSpecies", "animalGroup", "animalCount"].includes(key)) continue;
      const question = PROJECT_FACT_QUESTIONS.find((item) => item.id === key);
      if (!question || isAnswerMissing(question, fact.value) || fact.value === "Noch offen" || !isEmpty(nextProject[key])) continue;
      // The group choices in the current catalogue describe cattle. An explicit
      // different species is stronger than a delayed cattle-group suggestion.
      if (key === "animalGroup" && !isEmpty(nextProject.animalSpecies) && nextProject.animalSpecies !== "Rind") continue;
      nextProject = { ...nextProject, [key]: fact.value };
      nextProjectProvenance = { ...nextProjectProvenance, [key]: provenance(fact) };
      continue;
    }

    if (fact.scope !== "group" || !fact.groupKind || !AREA_TYPES.includes(fact.groupKind)) continue;
    const prefix = `${fact.groupKind}.`;
    if (!key.startsWith(prefix)) continue;
    const id = key.slice(prefix.length);
    const question = HERD_OVERRIDE_QUESTIONS.find((item) => item.id === id);
    const existing = nextPreferences.groupAnswers[fact.groupKind] ?? {};
    if (!question || isAnswerMissing(question, fact.value) || fact.value === "Noch offen" || !isEmpty(existing[id])) continue;
    nextPreferences = {
      ...nextPreferences,
      groupAnswers: { ...nextPreferences.groupAnswers, [fact.groupKind]: { ...existing, [id]: fact.value } },
      groupAnswerProvenance: {
        ...nextPreferences.groupAnswerProvenance,
        [fact.groupKind]: { ...nextPreferences.groupAnswerProvenance?.[fact.groupKind], [id]: provenance(fact) },
      },
    };
  }
  return { projectAnswers: nextProject, preferences: nextPreferences, projectAnswerProvenance: nextProjectProvenance };
}
