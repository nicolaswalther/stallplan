"use client";

import { useId, useRef, useState } from "react";
import { ArrowLeft, ArrowRight, Check, ChevronDown, MapPin } from "lucide-react";
import {
  EQUIPMENT_OPTIONS,
  countMissingPlanningAnswers,
  getGroupAnswers,
  getPlanningGroups,
  isAnswerMissing,
  resolveAreaAnswers,
} from "@/lib/domain/planning-preferences";
import {
  AREA_HERD_OVERRIDE_QUESTIONS,
  HERD_OVERRIDE_QUESTIONS,
  PROJECT_CONTEXT_QUESTIONS,
  PROJECT_QUESTIONS,
  getGroupQuestions,
} from "@/lib/rules";
import type {
  AnswerMap, AnswerValue, AreaType, DetectedArea, DomainQuestion,
  EquipmentType, PlanningGroup, PlanningPreferences,
} from "@/lib/types";

export interface InferredWishFact {
  evidence: string | string[];
  confidence?: number;
  value?: AnswerValue;
}

export interface PlanningWishesProps {
  confirmedAreas: DetectedArea[];
  projectAnswers: AnswerMap;
  onProjectAnswer: (id: string, value: AnswerValue) => void;
  preferences: PlanningPreferences;
  onGroupAnswer: (kind: AreaType, id: string, value: AnswerValue) => void;
  onAreaAnswer: (areaId: string, id: string, value: AnswerValue) => void;
  onClearAreaAnswers: (areaId: string) => void;
  onToggleEquipment: (kind: EquipmentType, enabled: boolean) => void;
  onSelectGroup: (kind: AreaType | null) => void;
  onSelectArea: (areaId: string) => void;
  onComplete: () => void;
  initialGroupKind?: AreaType | null;
  inferredProjectFacts?: Partial<Record<string, InferredWishFact>>;
}

type WishStep = { id: string; title: string; group?: PlanningGroup };

/** A section keeps its identity when late results or added equipment change the step order. */
export function PlanningWishes({
  confirmedAreas, projectAnswers, onProjectAnswer, preferences, onGroupAnswer,
  onAreaAnswer, onClearAreaAnswers, onToggleEquipment, onSelectGroup,
  onSelectArea, onComplete, initialGroupKind, inferredProjectFacts,
}: PlanningWishesProps) {
  const [stepId, setStepId] = useState<string>(() => initialGroupKind ?? "project");
  const [overrideAreaId, setOverrideAreaId] = useState<string | null>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const groups = getPlanningGroups(confirmedAreas, preferences);
  const steps: WishStep[] = [
    { id: "project", title: "Stall & Tiere" },
    ...groups.filter((group) => group.areaIds.length).map((group) => ({ id: group.id, title: group.title, group })),
    { id: "equipment", title: "Weitere Ausstattung" },
    ...groups.filter((group) => !group.areaIds.length).map((group) => ({ id: group.id, title: group.title, group })),
  ];
  const currentIndex = Math.max(0, steps.findIndex((step) => step.id === stepId));
  const step = steps[currentIndex];
  const group = step.group;
  const groupAreas = group ? confirmedAreas.filter((area) => group.areaIds.includes(area.id)) : [];
  const cattleProject = projectAnswers.animalSpecies === "Rind";
  const overrideArea = groupAreas.find((area) => area.id === overrideAreaId) ?? groupAreas[0];
  const answers = group ? getGroupAnswers(group.kind, projectAnswers, preferences) : projectAnswers;
  const questions = group ? getGroupQuestions(group.kind, answers) : PROJECT_QUESTIONS;
  // Reuse the handoff's counter, including follow-ups activated by one area.
  const openQuestions = group
    ? countMissingPlanningAnswers(groupAreas, projectAnswers, {
      ...preferences, additionalEquipment: group.additional ? { [group.kind]: true } : {},
    }) - countMissingPlanningAnswers([], projectAnswers)
    : countMissingPlanningAnswers([], projectAnswers);

  function navigate(next: WishStep) {
    setStepId(next.id);
    setOverrideAreaId(null);
    onSelectGroup(next.group?.kind ?? null);
    requestAnimationFrame(() => {
      headingRef.current?.focus({ preventScroll: true });
      headingRef.current?.scrollIntoView({ block: "nearest", behavior: "smooth" });
    });
  }

  return <div className="wishes-questionnaire mx-auto flex w-full max-w-2xl flex-col px-5 py-6 sm:px-8 sm:py-8" data-wishes-step={step.id}>
    <div className="mb-8 flex items-start justify-between gap-4">
      <div><p className="text-xs font-medium text-[#17633a]">Ihre Wünsche</p><p className="mt-1 text-xs text-[#8a918b]">Ein Abschnitt nach dem anderen.</p></div>
      <label className="relative block min-w-0 max-w-[58%] text-xs text-[#788077]">
        <span className="sr-only">Abschnitt der Wünsche</span>
        <select aria-label="Abschnitt der Wünsche" value={step.id} onChange={(event) => {
          const next = steps.find((item) => item.id === event.target.value);
          if (next) navigate(next);
        }} className="max-w-full appearance-none rounded-md border border-[#e3e7df] bg-white py-2 pl-3 pr-7 text-xs">
          {steps.map((item, index) => <option key={item.id} value={item.id}>{index + 1}. {item.title}</option>)}
        </select><ChevronDown size={12} className="pointer-events-none absolute right-2.5 top-3" />
      </label>
    </div>

    <div className="mb-7">
      <p className="mb-2 text-[11px] tabular-nums text-[#8a918b]">Schritt {currentIndex + 1} von {steps.length}</p>
      <h2 ref={headingRef} tabIndex={-1} className="text-2xl font-semibold tracking-tight outline-none">{step.title}</h2>
      <p className="mt-2 text-sm leading-6 text-[#788077]">{step.id === "project" ? "Diese Angaben gelten für den ganzen Stall."
        : step.id === "equipment" ? "Was soll das Planungsteam zusätzlich berücksichtigen?"
          : groupAreas.length ? `Eine Vorgabe für ${groupAreas.length === 1 ? "diesen Bereich" : `alle ${groupAreas.length} Bereiche`}.`
            : "Zusätzlicher Wunsch. Den Aufstellort klärt das Planungsteam."}</p>
    </div>

    {step.id === "project" && <div className="space-y-6">
      <div className="grid gap-6 sm:grid-cols-2">
        {[...PROJECT_QUESTIONS, ...PROJECT_CONTEXT_QUESTIONS.filter((question) => question.id === "animalCount" || question.id === "animalGroup" && cattleProject)].map((question) =>
          <WishQuestion key={question.id} question={question} value={projectAnswers[question.id]} onAnswer={onProjectAnswer} fact={inferredProjectFacts?.[question.id]} />)}
      </div>
      <details className="border-t border-[#edf0ea] pt-5 text-sm text-[#788077]">
        <summary className="cursor-pointer">Weitere Wünsche notieren</summary>
        <div className="mt-4"><WishFields questions={PROJECT_CONTEXT_QUESTIONS.filter((question) => question.id === "planningNotes")} answers={projectAnswers} onAnswer={onProjectAnswer} showOptional /></div>
      </details>
    </div>}

    {group && <section data-planning-group={group.kind} className="space-y-6" aria-label={`Vorgaben ${group.title}`}>
      {cattleProject && answers.animalGroup && <p className="text-xs text-[#788077]">Tiergruppe: <span className="text-[#566057]">{String(answers.animalGroup)}</span>
        <span className="ml-2 text-[11px] text-[#959d95]">{preferences.groupAnswers[group.kind]?.animalGroup ? "Für diese Gruppe" : "Gilt im ganzen Stall"}</span></p>}
      <WishFields questions={questions} answers={answers} onAnswer={(id, value) => onGroupAnswer(group.kind, id, value)} />

      <details className="border-t border-[#edf0ea] pt-5 text-sm text-[#788077]">
        <summary className="cursor-pointer">{cattleProject ? "Andere Tiergruppe oder Tieranzahl" : "Tieranzahl dieser Gruppe"}</summary>
        <div className="mt-5"><WishFields questions={HERD_OVERRIDE_QUESTIONS.filter((question) => question.id !== "animalGroup" || cattleProject)} answers={preferences.groupAnswers[group.kind] ?? {}} onAnswer={(id, value) => onGroupAnswer(group.kind, id, value)} showOptional /></div>
      </details>

      {overrideArea && <details key={group.kind} className="border-t border-[#edf0ea] pt-5 text-sm text-[#788077]">
        <summary className="cursor-pointer">Einzelnen Bereich anders einstellen</summary>
        <div className="mt-5 space-y-5">
          <div className="flex items-center gap-3">
            <select aria-label="Bereich mit abweichenden Wünschen" className="field min-w-0 flex-1" value={overrideArea.id} onChange={(event) => {
              setOverrideAreaId(event.target.value); onSelectArea(event.target.value);
            }}>{groupAreas.map((area) => <option key={area.id} value={area.id}>{area.label} · Seite {area.pageNumber}</option>)}</select>
            <button type="button" onClick={() => onSelectArea(overrideArea.id)} aria-label="Bereich im Plan zeigen" title="Im Plan zeigen" className="rounded-md p-2 text-[#17633a] hover:bg-[#f1f7f1]"><MapPin size={17} /></button>
          </div>
          <p className="text-xs leading-5">Übernimmt die gemeinsamen Vorgaben. Änderungen gelten nur für diesen Bereich.</p>
          <WishFields questions={getGroupQuestions(group.kind, resolveAreaAnswers(overrideArea, projectAnswers, preferences).answers)}
            answers={resolveAreaAnswers(overrideArea, projectAnswers, preferences).answers} onAnswer={(id, value) => onAreaAnswer(overrideArea.id, id, value)} overrideAnswers={preferences.areaOverrides[overrideArea.id]} />
          <details className="text-xs"><summary className="cursor-pointer">{cattleProject ? "Tiergruppe dieses Bereichs" : "Tieranzahl dieses Bereichs"}</summary>
            <div className="mt-4"><WishFields questions={AREA_HERD_OVERRIDE_QUESTIONS.filter((question) => question.id !== "animalGroup" || cattleProject)} answers={preferences.areaOverrides[overrideArea.id] ?? {}} onAnswer={(id, value) => onAreaAnswer(overrideArea.id, id, value)} overrideAnswers={preferences.areaOverrides[overrideArea.id]} showOptional /></div>
          </details>
          {Object.values(preferences.areaOverrides[overrideArea.id] ?? {}).some((value) => value !== "") && <button type="button" className="text-xs font-medium text-[#17633a]" onClick={() => onClearAreaAnswers(overrideArea.id)}>Gemeinsame Vorgaben verwenden</button>}
        </div>
      </details>}
    </section>}

    {step.id === "equipment" && <div className="space-y-3">
      {EQUIPMENT_OPTIONS.map((option) => {
        const detected = groups.some((item) => item.kind === option.kind && item.areaIds.length > 0);
        const selected = detected || preferences.additionalEquipment[option.kind] === true;
        return <button key={option.kind} type="button" aria-label={`${option.title} ergänzen`} aria-pressed={selected} disabled={detected}
          onClick={() => onToggleEquipment(option.kind, !selected)} className={`flex w-full items-center justify-between gap-4 rounded-lg border px-4 py-4 text-left transition-colors ${selected ? "border-[#a4bfa8] bg-[#f5f9f4]" : "border-[#e1e6dd] bg-white hover:border-[#b7c9b4]"}`}>
          <span><span className="block text-sm font-medium">{option.title}</span><span className="mt-1 block text-xs text-[#8a918b]">{detected ? "Bereits im Plan berücksichtigt" : option.kind === "drinker" ? "Tränkestellen und Frostschutz" : option.kind === "brush" ? "Komfort für die Tiere" : "Absperrungen und Außenöffnungen"}</span></span>
          <span className={`flex h-5 w-5 shrink-0 items-center justify-center rounded border ${selected ? "border-[#17633a] bg-[#17633a] text-white" : "border-[#cfd6ca]"}`}>{selected && <Check size={13} />}</span>
        </button>;
      })}
      <p className="pt-2 text-xs leading-5 text-[#8a918b]">Ausgewählte Ausstattung folgt als nächster Abschnitt.</p>
    </div>}

    <div className="mt-9 border-t border-[#e5e9e1] pt-5">
      {openQuestions > 0 && step.id !== "equipment" && <p className="mb-4 text-xs text-[#8a918b]">{openQuestions} {openQuestions === 1 ? "Angabe noch offen" : "Angaben noch offen"}. Sie können trotzdem weitergehen.</p>}
      <div className="flex items-center justify-between gap-3">
        <button type="button" className="inline-flex h-10 items-center gap-2 rounded-md px-3 text-sm text-[#788077] hover:bg-[#f5f7f2] disabled:opacity-0" disabled={currentIndex === 0} onClick={() => navigate(steps[currentIndex - 1])}><ArrowLeft size={14} />Zurück</button>
        <button type="button" className="inline-flex h-10 items-center gap-2 rounded-md bg-[#17633a] px-5 text-sm font-medium text-white hover:bg-[#12532f]" onClick={() => currentIndex < steps.length - 1 ? navigate(steps[currentIndex + 1]) : onComplete()}>
          {currentIndex < steps.length - 1 ? "Weiter" : "Zur Übersicht"}<ArrowRight size={14} />
        </button>
      </div>
    </div>
  </div>;
}

function WishFields({ questions, answers, onAnswer, showOptional = false, overrideAnswers }: {
  questions: DomainQuestion[]; answers: AnswerMap;
  onAnswer: (id: string, value: AnswerValue) => void; showOptional?: boolean; overrideAnswers?: AnswerMap;
}) {
  const visible = questions.filter((question) => showOptional || question.required);
  const optional = questions.filter((question) => !showOptional && !question.required);
  const field = (question: DomainQuestion) => <div key={question.id}>
    <WishQuestion question={question} value={answers[question.id]} onAnswer={onAnswer} />
    {overrideAnswers?.[question.id] !== undefined && overrideAnswers[question.id] !== "" && <button type="button" aria-label={`${question.label}: Gemeinsame Vorgabe verwenden`} className="mt-2 text-xs font-medium text-[#17633a]" onClick={() => onAnswer(question.id, "")}>Gemeinsame Vorgabe verwenden</button>}
  </div>;
  return <div className="space-y-6">{visible.map(field)}
    {optional.length > 0 && <details className="text-sm text-[#788077]"><summary className="cursor-pointer">Weitere Angaben</summary><div className="mt-5 space-y-6">{optional.map(field)}</div></details>}
  </div>;
}

function WishQuestion({ question, value, onAnswer, fact }: {
  question: DomainQuestion; value?: AnswerValue;
  onAnswer: (id: string, value: AnswerValue) => void; fact?: InferredWishFact;
}) {
  const fieldId = useId();
  const invalidNumber = question.type === "number" && value !== undefined && value !== "" && isAnswerMissing(question, value);
  const fromPlan = fact && (fact.value === undefined || fact.value === value);
  const factEvidence = fact ? Array.isArray(fact.evidence) ? fact.evidence.join(" · ") : fact.evidence : "";
  const shortChoices = question.type === "select" && (question.options?.length ?? 0) <= 3;
  const label = <span className="block text-sm font-medium text-[#566057]">{question.label}{!question.required && <span className="ml-2 text-[10px] font-normal text-[#8a918b]">Optional</span>}{fromPlan && <span className="ml-2 whitespace-nowrap text-[10px] font-normal text-[#17633a]" title={factEvidence}>Aus dem Plan</span>}</span>;
  if (shortChoices || question.type === "boolean") {
    const options: AnswerValue[] = question.type === "boolean" ? [true, false] : question.options ?? [];
    return <fieldset><legend className="mb-2">{label}</legend><div className="flex flex-wrap gap-2">{options.map((option) => {
      const caption = typeof option === "boolean" ? option ? "Ja" : "Nein" : String(option);
      return <button key={String(option)} type="button" aria-label={`${question.label}: ${caption}`} aria-pressed={value === option} onClick={() => onAnswer(question.id, option)}
        className={`min-h-10 flex-1 rounded-md border px-3 py-2 text-sm transition-colors ${value === option ? "border-[#7dad8d] bg-[#f1f7f1] text-[#17633a]" : "border-[#dfe4db] bg-white text-[#788077] hover:border-[#b8c8b4]"}`}>{caption}</button>;
    })}</div></fieldset>;
  }
  return <div><label htmlFor={fieldId} className="block">{label}</label>
    {question.type === "select" && <select id={fieldId} aria-label={question.label} className="field mt-2 h-11" value={String(value ?? "")} onChange={(event) => onAnswer(question.id, event.target.value)}><option value="">{question.required ? "Auswählen" : "Noch nicht angegeben"}</option>{question.options?.map((option) => <option key={option} value={option}>{option}</option>)}</select>}
    {question.id === "planningNotes" && <textarea id={fieldId} aria-label={question.label} rows={3} value={String(value ?? "")} className="field mt-2 h-auto min-h-24 resize-y py-3 leading-6" placeholder="Was soll das Planungsteam noch berücksichtigen?" onChange={(event) => onAnswer(question.id, event.target.value)} />}
    {question.id !== "planningNotes" && (question.type === "text" || question.type === "number") && <input id={fieldId} aria-label={question.label} aria-invalid={invalidNumber || undefined} aria-describedby={invalidNumber ? `${fieldId}-error` : undefined} type={question.type} min={question.type === "number" ? 1 : undefined} step={question.type === "number" ? 1 : undefined} value={String(value ?? "")} className="field mt-2 h-11" placeholder={!question.required ? "Optional" : undefined} onChange={(event) => onAnswer(question.id, question.type === "number" && event.target.value !== "" ? Number(event.target.value) : event.target.value)} />}
    {invalidNumber && <span id={`${fieldId}-error`} className="mt-2 block text-xs text-[#a33c3c]">Ganze Zahl größer als 0 eingeben.</span>}
    {fromPlan && <details className="mt-2 text-[11px] text-[#8a918b]"><summary className="cursor-pointer">Erkannte Angabe</summary><span className="mt-1 block leading-5">{factEvidence}</span></details>}
  </div>;
}
