"use client";

import {
  AlertCircle, ArrowRight, Check, ChevronLeft, ChevronRight, Clipboard, Download, Settings2,
  FileUp, Loader2, Maximize2, Minus, MousePointer2, Plus, Ruler, Trash2, X,
} from "lucide-react";
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { PointerEvent, ReactNode } from "react";

import { detectStructuralAreas } from "@/lib/analysis/areas";
import { extractDeterministicMeasurements } from "@/lib/deterministic";
import { parsePdf } from "@/lib/pdf-client";
import {
  applyAreaGeometryCorrection, applyMeasurementCorrection, mergeAreas, mergeMeasurements, needsMeasurementReview, prepareArea, transformAreaBox, removeArea, restoreArea,
} from "@/lib/plan/review";
import type { AreaGeometryGesture } from "@/lib/plan/review";
import { AREA_RULES, DOMAIN_RULES_VERSION, PROJECT_QUESTIONS, HERD_OVERRIDE_QUESTIONS, areaTypeOptions, getGroupQuestions } from "@/lib/rules";
import { EMPTY_PLANNING_PREFERENCES, countMissingPlanningAnswers, getPlanningGroups, getGroupAnswers, getPlanningProducts, isAnswerMissing, resolveAreaAnswers, resolveGroupAnswers } from "@/lib/domain/planning-preferences";
import { buildPlanningSummaryHtml } from "@/lib/plan/summary";
import { anchoredScroll, wheelZoom } from "@/lib/plan/viewport";
import { assessAreaBoundary } from "@/lib/geometry/area-boundaries";
import { areaReviewReason, canAcceptAreaTogether } from "@/lib/plan/area-review";
import { detectProjectFacts } from "@/lib/analysis/project-facts";
import { applyDetectedFacts } from "@/lib/domain/inferred-preferences";
import { PlanningWishes } from "./planning-wishes";
import type {
  AreaType, AnswerProvenance, DetectedArea, DomainQuestion, Measurement, NormalizedBox, PdfPageData, PlanningHandoff, PlanningPreferences, ProjectFacts,
} from "@/lib/types";

type Panel = "areas" | "details" | "measurements" | "handoff";
type AnswerValue = string | number | boolean;
type AnalysisMeta = { model: string; actualModels?: { areas?: string; measurements?: string }; documentSummary: string; warnings: string[]; originalAnalysis?: { documentSummary: string; warnings: string[] } };
type ApiResponse = AnalysisMeta & { areas: DetectedArea[]; measurements: Measurement[]; projectFacts?: ProjectFacts; error?: string };

const PRIMARY_STEPS: Array<{ panel: Panel; label: string }> = [
  { panel: "areas", label: "Plan prüfen" }, { panel: "details", label: "Wünsche" }, { panel: "handoff", label: "Übersicht" },
];
const KIND_LABELS = { vector: "Vektor-PDF", raster: "Scan", mixed: "Gemischte PDF" };

function cn(...classes: Array<string | false | null | undefined>) { return classes.filter(Boolean).join(" "); }
function clamp01(value: number) { return Math.min(1, Math.max(0, value)); }
function formatValue(value: number) { return value.toLocaleString("de-DE", { maximumFractionDigits: 3 }); }
function emptyAnswer(question: DomainQuestion, value?: AnswerValue) {
  return isAnswerMissing(question, value);
}

function sourceLabel(source: Measurement["source"] | DetectedArea["source"]) {
  return source === "ai" ? "KI" : source === "manual" ? "Manuell" : source === "customer" ? "Korrigiert" : source === "geometry" ? "PDF · Geometrie" : "PDF";
}
function boxStyle(box: NormalizedBox) {
  return { left: `${box.x * 100}%`, top: `${box.y * 100}%`, width: `${box.width * 100}%`, height: `${box.height * 100}%` };
}

function Button({ children, onClick, disabled, variant = "primary", className, label }: {
  children: ReactNode; onClick?: () => void; disabled?: boolean;
  variant?: "primary" | "secondary" | "ghost"; className?: string; label?: string;
}) {
  return <button type="button" onClick={onClick} disabled={disabled} aria-label={label} title={label}
    className={cn("inline-flex items-center justify-center gap-2 rounded-md border text-xs font-medium transition disabled:cursor-not-allowed disabled:opacity-35", !className?.match(/\bh-/) && "h-11", !className?.match(/\bpx-/) && "px-3",
      variant === "primary" ? "border-[#17633a] bg-[#17633a] text-white hover:bg-[#104e2e]"
        : variant === "secondary" ? "border-[#7a877c] bg-white text-[#303632] hover:bg-[#f7f8f7]"
          : "border-transparent text-[#687069] hover:bg-[#f3f4f3]", className)}>{children}</button>;
}

function UploadScreen({ onFile, error }: { onFile: (file: File) => void; error: string | null }) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);
  return <div className="flex min-h-[calc(100dvh-60px)] items-center justify-center px-5 py-12">
    <div className="w-full max-w-lg">
      <h1 className="text-[36px] leading-tight font-semibold tracking-[-0.045em] text-[#202421]">Stallplan hochladen</h1>
      <p className="mt-3 text-sm text-[var(--text-muted)]">Plan prüfen, Wünsche angeben, Planung vorbereiten.</p>
      <button type="button" onClick={() => inputRef.current?.click()}
        onDragEnter={(event) => { event.preventDefault(); setDragging(true); }}
        onDragOver={(event) => event.preventDefault()} onDragLeave={() => setDragging(false)}
        onDrop={(event) => { event.preventDefault(); setDragging(false); const file = event.dataTransfer.files[0]; if (file) onFile(file); }}
        className={cn("mt-8 flex w-full flex-col items-center rounded-xl border bg-white px-6 py-12 transition",
          dragging ? "border-[#17633a] bg-[#f8fbf8]" : "border-[#dce1dc] hover:border-[#91ad99] hover:bg-[#fdfefd]")}>
        <FileUp size={26} strokeWidth={1.5} className="text-[#17633a]" />
        <span className="mt-4 text-sm font-medium">Stallplan auswählen</span>
        <span className="mt-1 text-xs text-[var(--text-muted)]">PDF hier ablegen · bis 25 MB</span>
      </button>
      <div className="mt-6 flex items-center justify-between gap-2 text-[11px] text-[var(--text-muted)]" aria-label="Ablauf">
        <span>1 Plan prüfen</span><ChevronRight size={12} /><span>2 Wünsche</span><ChevronRight size={12} /><span>3 Übersicht</span>
      </div>
      <input ref={inputRef} className="hidden" type="file" accept="application/pdf,.pdf" aria-label="Stallplan hochladen"
        onChange={(event) => { const file = event.target.files?.[0]; if (file) onFile(file); event.target.value = ""; }} />
      {error && <div role="alert" className="mt-4 flex items-start gap-2 text-sm text-[#a33c3c]"><AlertCircle size={15} className="mt-0.5 shrink-0" />{error}</div>}
    </div>
  </div>;
}

export function StallplanWorkbench() {
  const [file, setFile] = useState<File | null>(null);
  const [pages, setPages] = useState<PdfPageData[]>([]);
  const [activePage, setActivePage] = useState(1);
  const [analysis, setAnalysis] = useState<AnalysisMeta | null>(null);
  const [areas, setAreas] = useState<DetectedArea[]>([]);
  const [measurements, setMeasurements] = useState<Measurement[]>([]);
  const [projectAnswers, setProjectAnswers] = useState<Record<string, AnswerValue>>({});
  const [projectFacts, setProjectFacts] = useState<ProjectFacts>({});
  const [projectAnswerProvenance, setProjectAnswerProvenance] = useState<Record<string, AnswerProvenance>>({});
  const [preferences, setPreferences] = useState<PlanningPreferences>(EMPTY_PLANNING_PREFERENCES);
  const [selectedGroupId, setSelectedGroupId] = useState<AreaType | null>(null);
  const [initialWishGroup, setInitialWishGroup] = useState<AreaType | null>(null);
  const [lastRemovedId, setLastRemovedId] = useState<string | null>(null);
  const [technicalOpen, setTechnicalOpen] = useState(false);
  const [mobilePlanOpen, setMobilePlanOpen] = useState(false);
  const [panel, setPanel] = useState<Panel>("areas");
  const [selectedAreaId, setSelectedAreaId] = useState<string | null>(null);
  const [selectedMeasurementId, setSelectedMeasurementId] = useState<string | null>(null);
  const [busy, setBusy] = useState<"reading" | "analyzing" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [markMode, setMarkMode] = useState(false);
  const [manualKind, setManualKind] = useState<AreaType>("feeding_area");
  const [areaDraft, setAreaDraft] = useState<{ id: string; bbox: NormalizedBox } | null>(null);
  const [draftBox, setDraftBox] = useState<NormalizedBox | null>(null);
  const [areaFilter, setAreaFilter] = useState<"all" | "review">("all");
  const [measurementFilter, setMeasurementFilter] = useState<"all" | "review">("all");
  const [measurementSearch, setMeasurementSearch] = useState("");
  const [zoom, setZoom] = useState(1);
  const [viewportSize, setViewportSize] = useState({ width: 1000, height: 700 });
  const [copied, setCopied] = useState(false);
  const runRef = useRef(0);
  const selectionTouchedRef = useRef(false);
  const abortRef = useRef<AbortController | null>(null);
  const dragStartRef = useRef<{ x: number; y: number } | null>(null);
  const areaGestureRef = useRef<{ areaId: string; pageNumber: number; original: NormalizedBox; gesture: AreaGeometryGesture;
    start: { x: number; y: number }; rect: DOMRect; target: HTMLButtonElement; pointerId: number } | null>(null);
  const planCanvasRef = useRef<HTMLDivElement>(null);
  const viewportRef = useRef<HTMLDivElement>(null);
  const contextRef = useRef<HTMLDivElement>(null);
  const navigationRef = useRef<HTMLElement>(null);
  const selectedHighlightRef = useRef<HTMLDivElement>(null);
  const copiedTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const zoomRef = useRef(zoom);
  const zoomAnchorRef = useRef<{ x: number; y: number; cursorX: number; cursorY: number } | null>(null);
  const touchedFactsRef = useRef(new Set<string>());
  const answersRef = useRef(projectAnswers);
  const preferencesRef = useRef(preferences);
  const answerProvenanceRef = useRef(projectAnswerProvenance);
  const visibleProjectFacts = Object.fromEntries(Object.entries(projectFacts).filter(([id]) =>
    projectAnswerProvenance[id]?.source === "pdf-text" || projectAnswerProvenance[id]?.source === "ai"));

  const currentPage = pages.find((page) => page.pageNumber === activePage) ?? pages[0];
  const confirmedAreas = useMemo(() => areas.filter((area) => area.status === "confirmed"), [areas]);
  const openAreas = areas.filter((area) => area.status === "unconfirmed");
  const selectedMeasurement = measurements.find((measurement) => measurement.id === selectedMeasurementId) ?? null;
  const planningGroups = useMemo(() => getPlanningGroups(confirmedAreas, preferences), [confirmedAreas, preferences]);
  const selectedGroup = planningGroups.find((group) => group.id === selectedGroupId);
  const reviewMeasurements = measurements.filter(needsMeasurementReview);
  const usableMeasurements = measurements.filter((item) => item.status !== "rejected");
  const activeAreas = areas.filter((area) => area.status !== "rejected");
  const visibleAreas = areaFilter === "review" ? openAreas : activeAreas;
  const visibleMeasurements = measurements.filter((item) => (measurementFilter !== "review" || needsMeasurementReview(item))
    && (!measurementSearch || `${item.value} ${item.unit} ${item.label}`.toLowerCase().includes(measurementSearch.toLowerCase().replace(",", "."))));
  const missingRequired = countMissingPlanningAnswers(confirmedAreas, projectAnswers, preferences);
  const ready = !busy && confirmedAreas.length > 0 && !openAreas.length && !reviewMeasurements.length && !missingRequired;
  const wishesReady = !busy && planningGroups.length > 0 && !missingRequired;
  const bulkAreas = openAreas.filter(canAcceptAreaTogether);
  const planWidth = currentPage ? Math.max(180, Math.min(viewportSize.width - 40, (viewportSize.height - 40) * currentPage.width / currentPage.height)) * zoom : 0;

  useLayoutEffect(() => {
    answersRef.current = projectAnswers; preferencesRef.current = preferences; answerProvenanceRef.current = projectAnswerProvenance;
  }, [projectAnswers, preferences, projectAnswerProvenance]);

  useEffect(() => {
    return () => { runRef.current += 1; abortRef.current?.abort(); if (copiedTimerRef.current) clearTimeout(copiedTimerRef.current); };
  }, []);
  useEffect(() => {
    function cancelWithEscape(event: KeyboardEvent) {
      if (event.key !== "Escape" || !areaGestureRef.current) return;
      const gesture = areaGestureRef.current;
      areaGestureRef.current = null; setAreaDraft(null);
      if (gesture.target.hasPointerCapture(gesture.pointerId)) gesture.target.releasePointerCapture(gesture.pointerId);
      event.preventDefault();
    }
    document.addEventListener("keydown", cancelWithEscape);
    return () => document.removeEventListener("keydown", cancelWithEscape);
  }, []);
  useEffect(() => {
    const gesture = areaGestureRef.current;
    if (!gesture || (gesture.pageNumber === activePage && panel === "areas" && !markMode && selectedAreaId === gesture.areaId)) return;
    areaGestureRef.current = null; setAreaDraft(null);
    if (gesture.target.hasPointerCapture(gesture.pointerId)) gesture.target.releasePointerCapture(gesture.pointerId);
  }, [activePage, panel, markMode, selectedAreaId]);
  useEffect(() => {
    const node = viewportRef.current;
    if (!node) return;
    const observer = new ResizeObserver(([entry]) => setViewportSize({ width: entry.contentRect.width, height: entry.contentRect.height }));
    observer.observe(node);
    return () => observer.disconnect();
  }, [pages.length]);
  useEffect(() => {
    const viewport = viewportRef.current;
    if (!viewport) return;
    function onWheel(event: WheelEvent) {
      // Shift-wheel retains native horizontal/vertical panning.
      if (event.shiftKey) return;
      const canvas = planCanvasRef.current;
      if (!canvas || !viewport || !event.deltaY) return;
      event.preventDefault();
      const next = wheelZoom(zoomRef.current, event.deltaY, event.deltaMode, viewport.clientHeight);
      if (next === zoomRef.current) return;
      const plan = canvas.getBoundingClientRect(), bounds = viewport.getBoundingClientRect();
      zoomAnchorRef.current = { x: (event.clientX - plan.left) / plan.width, y: (event.clientY - plan.top) / plan.height,
        cursorX: event.clientX - bounds.left, cursorY: event.clientY - bounds.top };
      // Changing scale during a gesture cancels its preview, never saves a jump.
      const gesture = areaGestureRef.current;
      areaGestureRef.current = null; setAreaDraft(null); dragStartRef.current = null; setDraftBox(null);
      if (gesture?.target.hasPointerCapture(gesture.pointerId)) gesture.target.releasePointerCapture(gesture.pointerId);
      zoomRef.current = next; setZoom(next);
    }
    viewport.addEventListener("wheel", onWheel, { passive: false });
    return () => viewport.removeEventListener("wheel", onWheel);
  }, [pages.length]);
  useLayoutEffect(() => {
    zoomRef.current = zoom;
    const viewport = viewportRef.current, canvas = planCanvasRef.current, anchor = zoomAnchorRef.current;
    if (!viewport || !canvas || !anchor) return;
    const plan = canvas.getBoundingClientRect(), bounds = viewport.getBoundingClientRect();
    viewport.scrollLeft = anchoredScroll(anchor.x, plan.width, plan.left - bounds.left + viewport.scrollLeft, anchor.cursorX);
    viewport.scrollTop = anchoredScroll(anchor.y, plan.height, plan.top - bounds.top + viewport.scrollTop, anchor.cursorY);
    zoomAnchorRef.current = null;
  }, [zoom]);
  useEffect(() => {
    contextRef.current?.scrollTo({ top: 0 });
    if (window.matchMedia("(max-width: 1023px)").matches) navigationRef.current?.scrollIntoView({ block: "start" });
  }, [panel]);
  useEffect(() => {
    if (panel !== "areas") return;
    contextRef.current?.querySelector('[data-area-selected="true"]')?.scrollIntoView({ block: "nearest" });
  }, [selectedAreaId, panel]);
  useEffect(() => {
    if (!selectedMeasurementId || panel !== "measurements") return;
    const frame = requestAnimationFrame(() => {
      const viewport = viewportRef.current, highlight = selectedHighlightRef.current;
      if (!viewport || !highlight) return;
      const target = highlight.getBoundingClientRect(), bounds = viewport.getBoundingClientRect();
      viewport.scrollTo({ left: viewport.scrollLeft + target.x + target.width / 2 - bounds.x - bounds.width / 2,
        top: viewport.scrollTop + target.y + target.height / 2 - bounds.y - bounds.height / 2, behavior: "smooth" });
    });
    return () => cancelAnimationFrame(frame);
  }, [activePage, selectedMeasurementId, panel]);

  const handoff = useMemo<PlanningHandoff | null>(() => {
    if (!file || !pages.length || !analysis) return null;
    return {
      schemaVersion: "1.4", createdAt: new Date().toISOString(),
      preferences,
      planningGroups: planningGroups.map((group) => ({ ...group, answers: resolveGroupAnswers(group.kind, projectAnswers, preferences, projectAnswerProvenance).answers,
        answerProvenance: resolveGroupAnswers(group.kind, projectAnswers, preferences, projectAnswerProvenance).provenance })),
      project: { fileName: file.name, pageCount: pages.length, answers: projectAnswers, answerProvenance: projectAnswerProvenance, detectedFacts: projectFacts },
      analysis: { summary: analysis.documentSummary, warnings: analysis.warnings, originalAnalysis: analysis.originalAnalysis },
      documents: [{ fileName: file.name, pages: pages.map((page) => ({ pageNumber: page.pageNumber, width: page.width, height: page.height,
        documentKind: page.documentKind, textObjects: page.textItems, geometryObjects: page.lines ?? [], extractionWarnings: page.extractionWarnings })) }],
      areas: confirmedAreas.map((area) => ({ id: area.id, kind: area.kind, label: area.label, pageNumber: area.pageNumber,
        bbox: area.hasBbox ? area.bbox : null, source: area.source, confidence: area.confidence, evidence: area.evidence,
        originalLabel: area.originalLabel, originalEvidence: area.originalEvidence, boundaryRefinement: area.boundaryRefinement, boundaryAssessment: area.boundaryAssessment,
        relevantProducts: getPlanningProducts(area.kind, resolveAreaAnswers(area, projectAnswers, preferences).answers), requiredMeasurements: AREA_RULES[area.kind].measurements,
        answers: resolveAreaAnswers(area, projectAnswers, preferences).answers,
        answerProvenance: resolveAreaAnswers(area, projectAnswers, preferences, projectAnswerProvenance).provenance })),
      measurements,
      areaReviews: areas,
      review: { openAreaCount: openAreas.length, unresolvedMeasurementCount: reviewMeasurements.length, missingAnswerCount: missingRequired, pendingAnalysis: Boolean(busy), ready },
      audit: { aiModel: analysis.model, actualModels: analysis.actualModels, rulesVersion: DOMAIN_RULES_VERSION, confirmedAreaCount: confirmedAreas.length, detectedMeasurementCount: measurements.length,
        customerCorrectedMeasurementCount: measurements.filter((measurement) => measurement.source === "customer").length },
    };
  }, [file, pages, analysis, projectAnswers, projectAnswerProvenance, projectFacts, confirmedAreas, preferences, planningGroups, measurements, areas, openAreas.length, reviewMeasurements.length, missingRequired, ready, busy]);

  function reset() {
    runRef.current += 1;
    abortRef.current?.abort();
    abortRef.current = null;
    if (copiedTimerRef.current) clearTimeout(copiedTimerRef.current);
    setFile(null); setPages([]); setAreas([]); setMeasurements([]); setPreferences(EMPTY_PLANNING_PREFERENCES); setSelectedGroupId(null); setInitialWishGroup(null); setLastRemovedId(null); setProjectFacts({}); setTechnicalOpen(false); setProjectAnswers({}); setAnalysis(null);
    setActivePage(1); setPanel("areas"); setSelectedAreaId(null); setSelectedMeasurementId(null); setMarkMode(false);
    setDraftBox(null); dragStartRef.current = null; areaGestureRef.current = null; setAreaDraft(null); setError(null); setBusy(null); setCopied(false);
    setAreaFilter("all"); setMeasurementFilter("all"); setMeasurementSearch(""); zoomRef.current = 1; zoomAnchorRef.current = null; setZoom(1);
    selectionTouchedRef.current = false;
    touchedFactsRef.current.clear(); answersRef.current = {}; preferencesRef.current = EMPTY_PLANNING_PREFERENCES; answerProvenanceRef.current = {}; setProjectAnswerProvenance({});
  }

  async function analyzePlan(nextFile: File, parsedPages: PdfPageData[], generation: number) {
    const controller = new AbortController();
    abortRef.current = controller;
    try {
      setBusy("analyzing");
      const response = await fetch("/api/analyze", { method: "POST", signal: controller.signal, headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ purpose: "automatic", fileName: nextFile.name, pages: parsedPages.map((page, index) => ({
          pageNumber: page.pageNumber, width: page.width, height: page.height, text: page.text, textItems: page.textItems,
          lines: page.lines, documentKind: page.documentKind, imageCount: page.imageCount, extractionWarnings: page.extractionWarnings,
          ...(index < 4 ? { imageDataUrl: page.imageDataUrl } : {}),
        })) }) });
      const data = await response.json() as ApiResponse;
      if (runRef.current !== generation) return;
      if (!response.ok) throw new Error(data.error || "Bereichsanalyse nicht verfügbar.");
      setAnalysis({ model: data.model, actualModels: data.actualModels, documentSummary: data.documentSummary, warnings: data.warnings, originalAnalysis: data.originalAnalysis });
      const assessed = data.areas.map((area) => ({ ...area, boundaryAssessment: assessAreaBoundary(area, parsedPages) }));
      setAreas((current) => mergeAreas(current, assessed));
      setMeasurements((current) => mergeMeasurements(current, data.measurements));
      adoptFacts(data.projectFacts ?? detectProjectFacts(parsedPages, data.areas), true);
      // Optional analysis must not take selection away from someone already reviewing the plan.
      if (!selectionTouchedRef.current) setSelectedAreaId((current) => current ?? data.areas.find((area) => area.status === "unconfirmed")?.id ?? data.areas[0]?.id ?? null);
    } catch (cause) {
      if (runRef.current !== generation || controller.signal.aborted) return;
      setAnalysis((current) => current && { ...current, warnings: [...current.warnings,
        cause instanceof Error ? cause.message : "Bereichsanalyse nicht verfügbar."] });
    } finally {
      if (runRef.current === generation) { setBusy(null); abortRef.current = null; }
    }
  }

  async function handleFile(nextFile: File) {
    if (nextFile.type !== "application/pdf" && !nextFile.name.toLowerCase().endsWith(".pdf")) { setError("Bitte eine PDF auswählen."); return; }
    if (nextFile.size > 25 * 1024 * 1024) { setError("Die PDF ist größer als 25 MB."); return; }
    reset(); setMobilePlanOpen(false);
    const generation = runRef.current;
    setFile(nextFile); setBusy("reading");
    try {
      const parsedPages = await parsePdf(nextFile);
      if (runRef.current !== generation) return;
      if (!parsedPages.length) throw new Error("Die PDF enthält keine lesbaren Seiten.");
      const deterministic = extractDeterministicMeasurements(parsedPages);
      const structural = detectStructuralAreas(parsedPages).map(prepareArea);
      setPages(parsedPages); setActivePage(1); setMeasurements(deterministic); setAreas(structural);
      adoptFacts(detectProjectFacts(parsedPages, structural));
      setSelectedAreaId(structural.find((area) => area.status === "unconfirmed")?.id ?? structural[0]?.id ?? null);
      setAnalysis({ model: "PDF", documentSummary: "PDF strukturell analysiert.",
        warnings: [...new Set(parsedPages.flatMap((page) => page.extractionWarnings ?? []))] });
      await analyzePlan(nextFile, parsedPages, generation);
    } catch {
      if (runRef.current !== generation) return;
      reset();
      setError("PDF konnte nicht gelesen werden. Bitte Datei prüfen.");
    }
  }

  function updateArea(id: string, patch: Partial<DetectedArea>) { setAreas((current) => current.map((area) => area.id === id ? { ...area, ...patch } : area)); }
  function reviewArea(id: string, status: "confirmed" | "rejected") {
    selectionTouchedRef.current = true;
    const next = areas.find((area) => area.id !== id && area.status === "unconfirmed")
      ?? areas.find((area) => area.id !== id && area.status === "confirmed");
    if (status === "rejected") {
      setAreas((current) => current.map((area) => area.id === id ? removeArea(area) : area));
      setLastRemovedId(id);
    } else updateArea(id, { status });
    setSelectedAreaId(next?.id ?? null);
    if (next) setActivePage(next.pageNumber);
  }
  function undoRemoval() {
    const removed = areas.find((area) => area.id === lastRemovedId);
    if (!removed) return;
    setAreas((current) => current.map((area) => area.id === removed.id ? restoreArea(area) : area));
    selectArea(removed); setLastRemovedId(null);
  }
  function updateMeasurement(id: string, value: number, unit: Measurement["unit"]) {
    setMeasurements((current) => current.map((measurement) => measurement.id === id ? applyMeasurementCorrection(measurement, value, unit) : measurement));
  }
  function adoptFacts(facts: ProjectFacts, authoritativeSnapshot = false) {
    setProjectFacts(facts);
    const next = applyDetectedFacts(answersRef.current, preferencesRef.current, facts, {
      projectAnswerProvenance: answerProvenanceRef.current, touchedKeys: touchedFactsRef.current, authoritativeSnapshot,
    });
    answersRef.current = next.projectAnswers; preferencesRef.current = next.preferences; answerProvenanceRef.current = next.projectAnswerProvenance;
    setProjectAnswers(next.projectAnswers); setPreferences(next.preferences); setProjectAnswerProvenance(next.projectAnswerProvenance);
  }
  function setProjectAnswer(id: string, value: AnswerValue) {
    touchedFactsRef.current.add(id);
    answersRef.current = { ...answersRef.current, [id]: value };
    answerProvenanceRef.current = { ...answerProvenanceRef.current, [id]: { source: "customer", scope: "project" } };
    if (id === "animalSpecies" && value !== "Rind") {
      touchedFactsRef.current.add("animalGroup");
      answersRef.current = { ...answersRef.current, animalGroup: "" };
      answerProvenanceRef.current = { ...answerProvenanceRef.current, animalGroup: { source: "customer", scope: "project" } };
    }
    setProjectAnswers(answersRef.current); setProjectAnswerProvenance(answerProvenanceRef.current);
  }
  function setGroupAnswer(kind: AreaType, questionId: string, value: AnswerValue) {
    touchedFactsRef.current.add(`${kind}.${questionId}`);
    const current = preferencesRef.current;
    preferencesRef.current = { ...current, groupAnswers: { ...current.groupAnswers,
      [kind]: { ...(current.groupAnswers[kind] ?? {}), [questionId]: value } },
      groupAnswerProvenance: { ...current.groupAnswerProvenance, [kind]: { ...current.groupAnswerProvenance?.[kind], [questionId]: { source: "customer", scope: "group", groupKind: kind } } } };
    setPreferences(preferencesRef.current);
  }
  function setAreaAnswer(areaId: string, questionId: string, value: AnswerValue) {
    updatePreferences((current) => ({ ...current, areaOverrides: { ...current.areaOverrides,
      [areaId]: { ...(current.areaOverrides[areaId] ?? {}), [questionId]: value } } }));
  }
  function updatePreferences(update: (current: PlanningPreferences) => PlanningPreferences) {
    preferencesRef.current = update(preferencesRef.current);
    setPreferences(preferencesRef.current);
  }
  function clearAreaAnswers(areaId: string) {
    updatePreferences((current) => ({ ...current, areaOverrides: Object.fromEntries(Object.entries(current.areaOverrides).filter(([id]) => id !== areaId)) }));
  }
  function groupUsesIndividualAnswers(kind: AreaType, areaIds: string[], additional: boolean) {
    const shared = getGroupAnswers(kind, projectAnswers, preferences);
    const missing = getGroupQuestions(kind, shared).some((question) => question.required && emptyAnswer(question, shared[question.id]));
    return missing && !additional && areaIds.length > 0 && areaIds.every((id) => {
      const effective = resolveAreaAnswers({ id, kind }, projectAnswers, preferences).answers;
      return getGroupQuestions(kind, effective).every((question) => !question.required || !emptyAnswer(question, effective[question.id]));
    });
  }
  function selectGroup(kind: AreaType | null) {
    selectionTouchedRef.current = true;
    setSelectedGroupId(kind);
    const first = confirmedAreas.find((area) => area.kind === kind);
    if (first) selectArea(first);
    else setSelectedAreaId(null);
  }
  function enterWishes(kind: AreaType | null = null) {
    zoomAnchorRef.current = null; setZoom(1);
    setMarkMode(false); dragStartRef.current = null; setDraftBox(null);
    setInitialWishGroup(kind); selectGroup(kind); setPanel("details"); setTechnicalOpen(false);
  }
  function confirmSuggestions() {
    const ids = new Set(bulkAreas.map((area) => area.id));
    setAreas((current) => current.map((area) => ids.has(area.id) ? { ...area, status: "confirmed" } : area));
    const next = openAreas.find((area) => !ids.has(area.id));
    if (next) { selectArea(next); setAreaFilter("review"); }
  }
  function magnifyArea(area: DetectedArea) {
    selectArea(area);
    const viewport = viewportRef.current;
    if (!viewport || !currentPage) return;
    const baseWidth = planWidth / zoom;
    const nextZoom = Math.max(1, Math.min(4, (viewport.clientWidth - 80) / (baseWidth * area.bbox.width),
      (viewport.clientHeight - 80) / (baseWidth * currentPage.height / currentPage.width * area.bbox.height)));
    zoomAnchorRef.current = { x: area.bbox.x + area.bbox.width / 2, y: area.bbox.y + area.bbox.height / 2,
      cursorX: viewport.clientWidth / 2, cursorY: viewport.clientHeight / 2 };
    setZoom(nextZoom);
    // Recenter even when a second area needs the same zoom factor.
    requestAnimationFrame(() => {
      const canvas = planCanvasRef.current;
      if (!canvas) return;
      const box = canvas.getBoundingClientRect(), bounds = viewport.getBoundingClientRect();
      viewport.scrollLeft += box.left + box.width * (area.bbox.x + area.bbox.width / 2) - bounds.left - viewport.clientWidth / 2;
      viewport.scrollTop += box.top + box.height * (area.bbox.y + area.bbox.height / 2) - bounds.top - viewport.clientHeight / 2;
      zoomAnchorRef.current = null;
    });
  }
  function downloadOverview() {
    if (!handoff) return;
    const html = buildPlanningSummaryHtml(handoff, pages.map((page) => ({ pageNumber: page.pageNumber, imageDataUrl: page.imageDataUrl })));
    const url = URL.createObjectURL(new Blob([html], { type: "text/html;charset=utf-8" }));
    const anchor = document.createElement("a"); anchor.href = url;
    anchor.download = (file?.name ?? "stallplan").replace(/\.pdf$/i, "") + "-planungsübersicht.html";
    document.body.append(anchor); anchor.click(); anchor.remove(); window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  function selectArea(area: DetectedArea) { selectionTouchedRef.current = true; setSelectedAreaId(area.id); setActivePage(area.pageNumber); }
  function startAreaGesture(event: PointerEvent<HTMLButtonElement>, area: DetectedArea, gesture: AreaGeometryGesture) {
    if (markMode || panel !== "areas" || selectedAreaId !== area.id || event.button !== 0 || !planCanvasRef.current) return;
    event.preventDefault(); event.stopPropagation();
    selectionTouchedRef.current = true;
    event.currentTarget.setPointerCapture(event.pointerId);
    areaGestureRef.current = { areaId: area.id, pageNumber: area.pageNumber, original: area.bbox, gesture, start: { x: event.clientX, y: event.clientY },
      rect: planCanvasRef.current.getBoundingClientRect(), target: event.currentTarget, pointerId: event.pointerId };
    setAreaDraft({ id: area.id, bbox: area.bbox });
  }
  function moveAreaGesture(event: PointerEvent<HTMLButtonElement>) {
    const gesture = areaGestureRef.current;
    if (!gesture || gesture.pointerId !== event.pointerId) return;
    event.stopPropagation();
    setAreaDraft({ id: gesture.areaId, bbox: transformAreaBox(gesture.original, gesture.gesture,
      (event.clientX - gesture.start.x) / gesture.rect.width, (event.clientY - gesture.start.y) / gesture.rect.height) });
  }
  function finishAreaGesture(event?: PointerEvent<HTMLButtonElement>, cancel = false) {
    const gesture = areaGestureRef.current;
    if (!gesture || (event && gesture.pointerId !== event.pointerId)) return;
    event?.stopPropagation();
    if (!cancel && event) {
      const bbox = transformAreaBox(gesture.original, gesture.gesture,
        (event.clientX - gesture.start.x) / gesture.rect.width, (event.clientY - gesture.start.y) / gesture.rect.height);
      setAreas((current) => current.map((area) => area.id === gesture.areaId ? applyAreaGeometryCorrection(area, bbox) : area));
    }
    areaGestureRef.current = null; setAreaDraft(null);
    if (gesture.target.hasPointerCapture(gesture.pointerId)) gesture.target.releasePointerCapture(gesture.pointerId);
  }
  function startMark(event: PointerEvent<HTMLDivElement>) {
    if (!markMode || panel !== "areas" || event.button !== 0) return;
    const rect = event.currentTarget.getBoundingClientRect();
    const point = { x: clamp01((event.clientX - rect.left) / rect.width), y: clamp01((event.clientY - rect.top) / rect.height) };
    event.currentTarget.setPointerCapture(event.pointerId);
    dragStartRef.current = point; setDraftBox({ ...point, width: 0, height: 0 });
  }
  function moveMark(event: PointerEvent<HTMLDivElement>) {
    const start = dragStartRef.current;
    if (!markMode || !start) return;
    const rect = event.currentTarget.getBoundingClientRect();
    const x = clamp01((event.clientX - rect.left) / rect.width), y = clamp01((event.clientY - rect.top) / rect.height);
    setDraftBox({ x: Math.min(start.x, x), y: Math.min(start.y, y), width: Math.abs(x - start.x), height: Math.abs(y - start.y) });
  }
  function finishMark(cancel = false) {
    if (!cancel && markMode && draftBox && currentPage && draftBox.width >= 0.01 && draftBox.height >= 0.01) {
      const area: DetectedArea = { id: crypto.randomUUID(), kind: manualKind, label: `${AREA_RULES[manualKind].title} · Bereich ${areas.length + 1}`, confidence: null,
        source: "manual", status: "confirmed", pageNumber: currentPage.pageNumber, bbox: draftBox, hasBbox: true, evidence: ["Manuell markiert"] };
      selectionTouchedRef.current = true;
      setAreas((current) => [...current, area]); setSelectedAreaId(area.id); setAreaFilter("all"); setPanel("areas"); setMarkMode(false);
    }
    dragStartRef.current = null; setDraftBox(null);
  }
  function toggleMark() {
    finishMark(true);
    if (panel !== "areas") { setPanel("areas"); setTechnicalOpen(false); setMarkMode(true); }
    else setMarkMode((current) => !current);
  }
  function downloadHandoff() {
    if (!handoff) return;
    const url = URL.createObjectURL(new Blob([JSON.stringify(handoff, null, 2)], { type: "application/json" }));
    const anchor = document.createElement("a"); anchor.href = url;
    anchor.download = (file?.name ?? "stallplan").replace(/\.pdf$/i, "") + "-planungsanfrage.json";
    document.body.append(anchor); anchor.click(); anchor.remove(); window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  async function copyHandoff() {
    if (!handoff) return;
    try {
      await navigator.clipboard.writeText(JSON.stringify(handoff, null, 2)); setCopied(true);
      if (copiedTimerRef.current) clearTimeout(copiedTimerRef.current);
      copiedTimerRef.current = setTimeout(() => setCopied(false), 1400);
    } catch { setError("Kopieren nicht möglich. Bitte JSON herunterladen."); }
  }

  const statusText = busy === "reading" ? "PDF wird gelesen" : "Bereiche werden erkannt";
  const warnings = analysis?.warnings ?? [];

  return <main className="min-h-dvh bg-[#f7f8f6] text-[#242724]">
    <header className="flex h-[60px] items-center justify-between gap-4 border-b border-[#e4e7e2] bg-white px-4 sm:px-5">
      <div className="flex min-w-0 items-center gap-4">
        <div className="shrink-0 text-[18px] font-bold tracking-[0.04em] text-[#17633a]">PATURA<span className="ml-2 text-[13px] font-medium tracking-normal text-[#3c443e]">Stallplan</span></div>
        {file && <span className="hidden truncate border-l border-[#e3e6e2] pl-4 text-xs text-[var(--text-muted)] md:block" title={file.name}>{file.name}</span>}
      </div>
      {file && <div className="flex shrink-0 items-center gap-3">
        {busy && <div role="status" aria-live="polite" className="hidden items-center gap-1.5 text-[11px] text-[var(--text-muted)] sm:flex">
          <Loader2 size={12} className="animate-spin" />{statusText}
        </div>}
        <Button variant="ghost" onClick={reset}>Neuer Plan</Button>
      </div>}
    </header>
    {!file && <UploadScreen onFile={handleFile} error={error} />}
    {file && !currentPage && <div className="flex min-h-[calc(100dvh-60px)] flex-col items-center justify-center gap-3">
      <Loader2 size={24} strokeWidth={1.5} className="animate-spin text-[#17633a]" /><p role="status" className="text-sm text-[#687069]">PDF wird gelesen</p>
      <p className="max-w-[70vw] truncate text-xs text-[var(--text-muted)]">{file.name}</p>
    </div>}
    {file && currentPage && <div className={cn("workbench-layout grid grid-cols-1", mobilePlanOpen && "workbench-plan-open", panel === "details" ? "workbench-wishes lg:grid-cols-[minmax(300px,0.38fr)_minmax(500px,0.62fr)]" : "lg:grid-cols-[minmax(0,1fr)_380px]")}>
      <section className="flex min-h-0 min-w-0 flex-col bg-[#eef0ed] lg:border-r lg:border-[#dfe3dc]" aria-label="Planansicht">
        {panel === "details" && <button type="button" aria-expanded={mobilePlanOpen} onClick={() => setMobilePlanOpen((open) => !open)} className="flex h-11 items-center justify-center gap-2 border-b border-[#cbd3cb] bg-[#f1f5f1] text-sm font-medium text-[#17633a] lg:hidden"><Maximize2 size={15} />{mobilePlanOpen ? "Plan ausblenden" : "Plan anzeigen"}</button>}
        <div className="plan-toolbar flex min-h-[52px] flex-wrap items-center justify-between gap-2 border-b border-[#dfe3dc] bg-[#fafbf9] px-3 py-2">
          <div className="flex items-center gap-1">
            {pages.length > 1 && <Button variant="ghost" className="h-9 w-9 px-0" label="Vorherige Seite" disabled={activePage <= 1} onClick={() => setActivePage((page) => Math.max(1, page - 1))}><ChevronLeft size={15} /></Button>}
            <span className="min-w-20 text-center text-[11px] text-[#69726b]">Seite {activePage} / {pages.length}</span>
            {pages.length > 1 && <Button variant="ghost" className="h-9 w-9 px-0" label="Nächste Seite" disabled={activePage >= pages.length} onClick={() => setActivePage((page) => Math.min(pages.length, page + 1))}><ChevronRight size={15} /></Button>}
            <span className="mx-1.5 hidden h-4 w-px bg-[#dfe3dc] sm:block" />
            <Button variant="ghost" className="h-9 w-9 px-0" label="Verkleinern" disabled={zoom <= 0.5} onClick={() => setZoom((value) => Math.max(0.5, value - 0.5))}><Minus size={14} /></Button>
            <span className="min-w-10 text-center text-[11px] tabular-nums text-[#69726b]">{Math.round(zoom * 100)}%</span>
            <Button variant="ghost" className="h-9 w-9 px-0" label="Vergrößern" disabled={zoom >= 4} onClick={() => setZoom((value) => Math.min(4, value + 0.5))}><Plus size={14} /></Button>
            <Button variant="ghost" className="h-9 w-9 px-0" label="Seite einpassen" onClick={() => setZoom(1)}><Maximize2 size={13} /></Button>
          </div>
          <Button variant={markMode ? "primary" : "ghost"} className="h-9 px-2" onClick={toggleMark}><MousePointer2 size={13} />{markMode ? "Markieren beenden" : "Bereich markieren"}</Button>
        </div>
        {markMode && <div className="plan-mark-controls flex items-center gap-2 border-b border-[#dfe3dc] bg-white px-4 py-2 text-xs">
          <select aria-label="Bereichstyp für Markierung" value={manualKind} onChange={(event) => setManualKind(event.target.value as AreaType)} className="field h-8 max-w-44 text-xs">
            {areaTypeOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
          </select><span className="text-[var(--text-muted)]">Rechteck im Plan aufziehen</span>
        </div>}
        <div ref={viewportRef} data-testid="plan-viewport" title="Mausrad: zoomen · Umschalt + Mausrad: verschieben" className="plan-viewport scrollbar-thin relative min-h-0 flex-1 overflow-auto overscroll-contain">
          <div className="flex min-h-full min-w-full items-center justify-center p-5" style={{ width: Math.max(viewportSize.width, planWidth + 40), height: Math.max(viewportSize.height, planWidth * currentPage.height / currentPage.width + 40) }}>
            <div ref={planCanvasRef} data-testid="plan-canvas" className={cn("relative shrink-0 bg-white shadow-[0_3px_18px_rgba(25,34,27,0.12)]", markMode && "cursor-crosshair touch-none select-none")}
              style={{ width: planWidth, aspectRatio: `${currentPage.width} / ${currentPage.height}` }}
              onPointerDown={startMark} onPointerMove={moveMark} onPointerUp={() => finishMark()} onPointerCancel={() => finishMark(true)}>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={currentPage.imageDataUrl} alt={`Planseite ${currentPage.pageNumber}`} draggable={false} className="pointer-events-none absolute inset-0 h-full w-full" />
              {panel !== "measurements" && areas.filter((area) => area.pageNumber === activePage && area.status !== "rejected" && area.hasBbox).map((area) => {
                const selected = selectedAreaId === area.id;
                const grouped = panel === "details" && selectedGroup?.kind === area.kind;
                const editable = selected && panel === "areas" && !markMode;
                const bbox = areaDraft?.id === area.id ? areaDraft.bbox : area.bbox;
                return <div key={area.id} className={cn("absolute", selected && "z-10", markMode && "pointer-events-none")} style={boxStyle(bbox)}>
                  <button type="button" disabled={markMode} onClick={(event) => { event.stopPropagation(); selectArea(area); if (panel !== "details") setPanel("areas"); }}
                    onPointerDown={(event) => startAreaGesture(event, area, "move")} onPointerMove={moveAreaGesture}
                    onPointerUp={(event) => finishAreaGesture(event)} onPointerCancel={(event) => finishAreaGesture(event, true)}
                    onLostPointerCapture={() => finishAreaGesture(undefined, true)}
                    aria-label={`${AREA_RULES[area.kind].title}, ${area.status === "confirmed" ? "übernommen" : "prüfen"}`}
                    data-testid={`area-overlay-${area.id}`}
                    className={cn("absolute inset-0 h-full w-full border", editable && "cursor-move touch-none",
                      selected ? "border-2 border-[#17633a] bg-[#17633a]/14"
                        : grouped ? "border-[#17633a]/70 bg-[#17633a]/7" : area.status === "confirmed" ? "border-[#51966a]/60 bg-[#51966a]/4 hover:bg-[#51966a]/10" : "border-dashed border-[#ad812e]/80 bg-[#d9ad55]/6")}>
                    {selected && <span title={area.label} className={cn("pointer-events-none absolute -top-6 max-w-60 truncate rounded bg-[#17633a] px-1.5 py-0.5 text-[10px] font-medium text-white", area.bbox.x > 0.5 ? "right-[-2px]" : "left-[-2px]")}>{area.label}</span>}
                  </button>
                  {editable && (["nw", "ne", "sw", "se"] as const).map((corner) => <button key={corner} type="button"
                    aria-label={`Bereich skalieren: ${corner === "nw" ? "oben links" : corner === "ne" ? "oben rechts" : corner === "sw" ? "unten links" : "unten rechts"}`}
                    data-testid={`area-resize-${corner}`}
                    onPointerDown={(event) => startAreaGesture(event, area, corner)} onPointerMove={moveAreaGesture}
                    onPointerUp={(event) => finishAreaGesture(event)} onPointerCancel={(event) => finishAreaGesture(event, true)}
                    onLostPointerCapture={() => finishAreaGesture(undefined, true)} onClick={(event) => event.stopPropagation()}
                    className={cn("absolute z-20 h-4 w-4 touch-none rounded-full border-2 border-[#17633a] bg-white shadow-sm",
                      corner.startsWith("n") ? "-top-2" : "-bottom-2", corner.endsWith("w") ? "-left-2" : "-right-2",
                      corner === "nw" || corner === "se" ? "cursor-nwse-resize" : "cursor-nesw-resize")} />)}
                </div>;
              })}
              {panel === "measurements" && selectedMeasurement?.pageNumber === activePage && <>
                {selectedMeasurement.dimensionLine && <svg aria-label="Zugeordnete Maßlinie" className="pointer-events-none absolute inset-0 h-full w-full overflow-visible" viewBox="0 0 1000 1000" preserveAspectRatio="none">
                  <line x1={selectedMeasurement.dimensionLine.start.x * 1000} y1={selectedMeasurement.dimensionLine.start.y * 1000}
                    x2={selectedMeasurement.dimensionLine.end.x * 1000} y2={selectedMeasurement.dimensionLine.end.y * 1000}
                    stroke="#3978c2" strokeWidth="3" vectorEffect="non-scaling-stroke" />
                  {[selectedMeasurement.dimensionLine.start, selectedMeasurement.dimensionLine.end].map((point, index) => <circle key={index} cx={point.x * 1000} cy={point.y * 1000} r="3" fill="#3978c2" />)}
                </svg>}
                {selectedMeasurement.bbox && <div ref={selectedHighlightRef} data-testid="measurement-highlight" className="pointer-events-none absolute z-20 min-h-2 min-w-2 border-2 border-[#3978c2] bg-[#3978c2]/15 shadow-[0_0_0_3px_rgba(255,255,255,0.8)]" style={boxStyle(selectedMeasurement.bbox)} />}
              </>}
              {draftBox && <div className="pointer-events-none absolute z-30 border-2 border-dashed border-[#17633a] bg-[#17633a]/10" style={boxStyle(draftBox)} />}
            </div>
          </div>
        </div>
      </section>
      <aside className="workbench-context flex min-h-0 flex-col bg-white" aria-label="Planungskontext">
        <nav ref={navigationRef} aria-label="Planungsschritte" className="grid h-[60px] shrink-0 grid-cols-3 border-b border-[#e4e7e2] px-3">
          {PRIMARY_STEPS.map((step, index) => {
            const complete = step.panel === "areas" ? confirmedAreas.length > 0 && !openAreas.length && !busy : step.panel === "details" ? wishesReady : false;
            return <button key={step.panel} type="button" onClick={() => {
              if (step.panel === "details" && panel !== "details") enterWishes();
              else { setPanel(step.panel); setTechnicalOpen(false); if (step.panel !== "areas") { setMarkMode(false); dragStartRef.current = null; setDraftBox(null); } }
            }} aria-current={panel === step.panel ? "step" : undefined}
              className={cn("relative flex items-center justify-center gap-1.5 text-xs font-medium transition", panel === step.panel ? "bg-[#edf5ef] text-[#17633a] after:absolute after:inset-x-2 after:bottom-0 after:h-0.5 after:bg-[#17633a]" : "text-[var(--text-muted)] hover:text-[#343d35]")}>
              <span className={cn("flex h-5 w-5 items-center justify-center rounded-full text-[11px]", panel === step.panel || complete ? "bg-[#17633a] text-white" : "bg-[#f0f2ef] text-[var(--text-muted)]")}>{complete ? <Check size={10} /> : index + 1}</span>{step.label}
            </button>;
          })}
        </nav>
        {error && <div role="alert" className="mx-4 mt-3 flex items-start gap-2 rounded-md bg-[#fff4f3] p-2.5 text-xs leading-5 text-[#a33c3c]">
          <AlertCircle size={13} className="mt-1 shrink-0" /><span className="flex-1">{error}</span><button type="button" aria-label="Fehler schließen" onClick={() => setError(null)}><X size={13} /></button>
        </div>}
        <div ref={contextRef} className="scrollbar-thin min-h-0 flex-1 overflow-y-auto">
          {panel === "areas" && <div className="px-4 py-5">
            <PanelHeading title="Stimmt der Plan?" subtitle={openAreas.length ? `${openAreas.length} Vorschläge · ${confirmedAreas.length} übernommen` : `${confirmedAreas.length} Bereiche übernommen`} />
            {bulkAreas.length > 0 && !busy && <Button className="mt-4 w-full" onClick={confirmSuggestions}><Check size={15} />{bulkAreas.length} {bulkAreas.length === 1 ? "Vorschlag" : "Vorschläge"} übernehmen</Button>}
            {busy && <div role="status" className="mt-4 flex items-center gap-2 text-xs text-[var(--text-muted)]"><Loader2 size={13} className="animate-spin" />Bereiche werden ergänzt</div>}
            {lastRemovedId && <div role="status" className="mt-4 flex items-center justify-between gap-2 text-[11px] text-[var(--text-muted)]">
              <span>Bereich entfernt</span><button type="button" onClick={undoRemoval} className="font-medium text-[#17633a]">Rückgängig</button>
            </div>}
            {activeAreas.length > 0 && <><FilterToggle value={areaFilter} onChange={setAreaFilter} count={openAreas.length} />
              <div className="mt-3 -mx-4 border-t border-[#eff1ed]">{visibleAreas.map((area) => <AreaRow key={area.id} area={area} selected={selectedAreaId === area.id}
                onSelect={() => selectArea(area)} onKind={(kind) => {
                  if (kind === area.kind) return;
                  updateArea(area.id, { kind, label: AREA_RULES[kind].title + (area.label.match(/ · (?:Bereich )?\d+$/)?.[0] ?? ` · Bereich ${areas.indexOf(area) + 1}`), source: "manual", confidence: null, status: "confirmed",
                    evidence: [...area.evidence, `Typ korrigiert: ${AREA_RULES[area.kind].title} → ${AREA_RULES[kind].title} (ursprünglich ${sourceLabel(area.source)}${area.confidence !== null ? `, ${Math.round(area.confidence * 100)}%` : ""}).`] });
                }}
                onZoom={() => magnifyArea(area)} onConfirm={() => reviewArea(area.id, "confirmed")} onReject={() => reviewArea(area.id, "rejected")} />)}</div>
              {!visibleAreas.length && <EmptyState>Alle Bereiche sind übernommen.</EmptyState>}
            </>}
            {!busy && !activeAreas.length && <EmptyState>{areas.length ? "Keine Bereiche ausgewählt." : "Keine sicheren Bereiche erkannt."}<br /><button type="button" onClick={() => setMarkMode(true)} className="mt-3 font-medium text-[#17633a]">Bereich im Plan markieren <ArrowRight size={12} className="inline" /></button></EmptyState>}
          </div>}
          {panel === "details" && <PlanningWishes
            confirmedAreas={confirmedAreas} projectAnswers={projectAnswers} preferences={preferences}
            inferredProjectFacts={visibleProjectFacts} initialGroupKind={initialWishGroup}
            onProjectAnswer={setProjectAnswer} onGroupAnswer={setGroupAnswer} onAreaAnswer={setAreaAnswer}
            onClearAreaAnswers={clearAreaAnswers} onToggleEquipment={(kind, enabled) => updatePreferences((current) => ({
              ...current, additionalEquipment: { ...current.additionalEquipment, [kind]: enabled },
            }))}
            onSelectGroup={selectGroup} onSelectArea={(id) => { const area = confirmedAreas.find((area) => area.id === id); if (area) { selectArea(area); setMobilePlanOpen(true); } }}
            onComplete={() => { setPanel("handoff"); setTechnicalOpen(false); }} />}
          {panel === "measurements" && <div className="px-4 py-5">
            <PanelHeading title="Maße" subtitle={`${usableMeasurements.length} erkannt${reviewMeasurements.length ? ` · ${reviewMeasurements.length} prüfen` : " · keine Prüfung nötig"}`} />
            <div className="relative mt-4"><Ruler size={13} className="pointer-events-none absolute top-3 left-2.5 text-[var(--text-muted)]" /><input aria-label="Maße suchen" className="field h-9 pl-8 text-xs" placeholder="Wert oder Bezeichnung suchen" value={measurementSearch} onChange={(event) => setMeasurementSearch(event.target.value)} /></div>
            <FilterToggle value={measurementFilter} onChange={setMeasurementFilter} count={reviewMeasurements.length} />
            <div className="mt-3 -mx-4 border-t border-[#eff1ed]">{visibleMeasurements.map((measurement) => <MeasurementRow key={measurement.id} measurement={measurement} selected={selectedMeasurementId === measurement.id}
              onSelect={() => { setSelectedMeasurementId(measurement.id); if (measurement.pageNumber) setActivePage(measurement.pageNumber); }}
              onChange={(value, unit) => updateMeasurement(measurement.id, value, unit)}
              onAccept={() => setMeasurements((current) => current.map((item) => item.id === measurement.id ? { ...item, status: "confirmed", sources: [...new Set([...(item.sources ?? [item.source]), "customer-review"])] } : item))} onExclude={() => setMeasurements((current) => current.map((item) => item.id === measurement.id ? { ...item, status: item.status === "rejected" ? "unconfirmed" : "rejected" } : item))} />)}</div>
            {!visibleMeasurements.length && <EmptyState>{measurementFilter === "review" ? "Keine unsicheren Maße." : measurementSearch ? "Keine passenden Maße." : "Keine belastbaren Maße erkannt."}</EmptyState>}
          </div>}
          {panel === "handoff" && <div className="px-4 py-5">
            <PanelHeading title="Ihre Planungsübersicht" subtitle={busy ? "Analyse läuft noch" : wishesReady ? "Wünsche sind vollständig" : `${missingRequired} Angaben noch offen`} />
            <div className="mt-5 flex gap-2 text-xs text-[#657166]">{PROJECT_QUESTIONS.map((question) => projectAnswers[question.id] !== undefined && projectAnswers[question.id] !== "" && <span key={question.id} className="rounded bg-[#f3f5f1] px-2 py-1">{String(projectAnswers[question.id])}</span>)}</div>
            {typeof projectAnswers.animalCount === "number" && projectAnswers.animalCount > 0 && <p className="mt-3 text-[11px] text-[var(--text-muted)]">{formatValue(projectAnswers.animalCount)} Tiere insgesamt</p>}
            {typeof projectAnswers.planningNotes === "string" && projectAnswers.planningNotes.trim() && <details className="mt-3 text-[11px] text-[var(--text-muted)]"><summary className="cursor-pointer">Weitere Wünsche</summary><p className="mt-2 whitespace-pre-wrap break-words leading-5">{projectAnswers.planningNotes}</p></details>}
            <div className="mt-4 divide-y divide-[#edf0ea]">{planningGroups.map((group) => {
              const groupAnswers = getGroupAnswers(group.kind, projectAnswers, preferences);
              const individual = groupUsesIndividualAnswers(group.kind, group.areaIds, group.additional);
              const overrides = confirmedAreas.filter((area) => group.areaIds.includes(area.id)).map((area) => ({ area, resolved: resolveAreaAnswers(area, projectAnswers, preferences) }))
                .filter(({ resolved }) => Object.values(resolved.provenance).some((provenance) => provenance.scope === "area"));
              return <section key={group.id} className="py-4">
                <button type="button" className="flex w-full items-center justify-between text-left" onClick={() => enterWishes(group.kind)}>
                  <h3 className="text-[13px] font-medium">{group.title}<span className="ml-2 text-[10px] font-normal text-[var(--text-muted)]">{group.areaIds.length ? `${group.areaIds.length} ${group.areaIds.length === 1 ? "Bereich" : "Bereiche"}` : "Zusätzlich"}</span></h3><span className="text-[11px] text-[#17633a]">Ändern</span>
                </button>
                {groupAnswers.animalGroup && !individual && <p className="mt-2 text-xs text-[var(--text-muted)]">{String(groupAnswers.animalGroup)}</p>}
                {individual ? <p className="mt-3 text-[11px] text-[#69766b]">Individuelle Vorgaben für alle Bereiche</p> : <dl className="mt-3 space-y-2">{getGroupQuestions(group.kind, groupAnswers).filter((question) => question.required || !emptyAnswer(question, groupAnswers[question.id])).map((question) => <div key={question.id} className="flex justify-between gap-4 text-[11px]">
                  <dt className="text-[var(--text-muted)]">{question.label}</dt><dd className="max-w-[60%] text-right text-[#566057]">{emptyAnswer(question, groupAnswers[question.id]) ? "Offen" : typeof groupAnswers[question.id] === "boolean" ? groupAnswers[question.id] ? "Ja" : "Nein" : String(groupAnswers[question.id])}</dd>
                </div>)}</dl>}
                {overrides.length > 0 && <details className="mt-3 text-[11px] text-[var(--text-muted)]"><summary className="cursor-pointer">{overrides.length} {overrides.length === 1 ? "individuelle Vorgabe" : "individuelle Vorgaben"}</summary>
                  <div className="mt-3 space-y-3">{overrides.map(({ area, resolved }) => <div key={area.id} className="border-l-2 border-[#d5e1d4] pl-3">
                    <div className="mb-2 font-medium text-[#687669]">{area.label}</div>
                    <dl className="space-y-1.5">{[...getGroupQuestions(area.kind, resolved.answers), ...HERD_OVERRIDE_QUESTIONS].filter((question) => resolved.provenance[question.id]?.scope === "area").map((question) => <div key={question.id} className="flex justify-between gap-3">
                      <dt>{question.id === "animalCount" ? "Tieranzahl dieses Bereichs" : question.label}</dt><dd className="max-w-[60%] text-right text-[#566057]">{String(resolved.answers[question.id])}</dd>
                    </div>)}</dl>
                  </div>)}</div>
                </details>}
              </section>;
            })}</div>
            {!planningGroups.length && <EmptyState>Noch keine Bereiche oder Ausstattung ausgewählt.</EmptyState>}
            {(openAreas.length > 0 || missingRequired > 0 || busy) && <div className="mt-3 border-t border-[#edf0ea] pt-4 text-[11px] leading-5 text-[var(--text-muted)]">
              {openAreas.length > 0 && <button type="button" onClick={() => setPanel("areas")} className="block text-[#754b12]">{openAreas.length} Bereiche noch offen</button>}
              {missingRequired > 0 && <button type="button" onClick={() => enterWishes()} className="block text-[#754b12]">{missingRequired} Wünsche noch offen</button>}
              <p className="mt-1">Die Übersicht kann bereits als Entwurf gespeichert werden.</p>
            </div>}
            <p className="mt-4 text-[11px] leading-5 text-[var(--text-muted)]">Die Fachplanung prüft Maße und wählt passende Systeme. Es wird noch keine Anfrage versendet.</p>
          </div>}
        </div>
        <div className="shrink-0 border-t border-[#e4e7e2] px-4 py-3">
          {panel === "areas" && <Button className="w-full" disabled={!confirmedAreas.length && !planningGroups.length} onClick={() => enterWishes()}>Weiter zu Wünschen <ArrowRight size={13} /></Button>}
          {panel === "handoff" && <Button className="w-full" disabled={!handoff} onClick={downloadOverview}><Download size={14} />Planungsübersicht herunterladen</Button>}
          {panel === "measurements" && <Button variant="secondary" className="w-full" onClick={() => { setPanel("handoff"); setTechnicalOpen(false); }}>Zurück zur Übersicht</Button>}
          <button type="button" aria-expanded={technicalOpen} onClick={() => setTechnicalOpen((current) => !current)} className="mt-3 flex w-full items-center justify-center gap-1.5 py-1 text-xs text-[var(--text-muted)]"><Settings2 size={11} />Technische Details</button>
          {technicalOpen && <div className="scrollbar-thin mt-2 max-h-64 overflow-y-auto border-t border-[#edf0ea] pt-3 text-[11px] text-[var(--text-muted)]">
            <div className="mb-3 flex justify-between"><span>{usableMeasurements.length} Maße erkannt</span><button type="button" className="font-medium text-[#17633a]" onClick={() => { setPanel("measurements"); setTechnicalOpen(false); }}>Maße ansehen</button></div>
            {reviewMeasurements.length > 0 && <p className="mb-3 text-[10px]">{reviewMeasurements.length} Maße werden von der Fachplanung geprüft.</p>}
            <div className="flex gap-2"><Button variant="secondary" className="h-8 flex-1 px-2" disabled={!handoff} onClick={downloadHandoff}><Download size={11} />JSON herunterladen</Button><Button variant="ghost" className="h-8 px-2" disabled={!handoff} onClick={copyHandoff}>{copied ? <Check size={11} /> : <Clipboard size={11} />}{copied ? "Kopiert" : "Kopieren"}</Button></div>
            <details className="mt-3"><summary className="cursor-pointer">Analyse und Quellen</summary><p className="mt-2 leading-5">{currentPage.documentKind ? KIND_LABELS[currentPage.documentKind] : "PDF"} · {analysis?.actualModels?.areas ?? analysis?.model ?? "PDF"}</p>
              {warnings.length > 0 && <ul className="mt-2 space-y-2 leading-5">{warnings.map((warning, index) => <li key={index}>{warning}</li>)}</ul>}
              <p className="mt-2 leading-5">{ready ? "Technische Prüfung abgeschlossen." : "Offene Prüfungen sind im Datensatz enthalten."}</p>
            </details>
          </div>}
        </div>
      </aside>
    </div>}
  </main>;
}

function PanelHeading({ title, subtitle }: { title: string; subtitle: string }) {
  return <div><h2 className="text-[17px] font-semibold tracking-[-0.025em]">{title}</h2><p className="mt-1 text-xs leading-5 text-[var(--text-muted)]">{subtitle}</p></div>;
}
function EmptyState({ children }: { children: ReactNode }) {
  return <p className="py-10 text-center text-xs leading-6 text-[var(--text-muted)]">{children}</p>;
}
function FilterToggle({ value, onChange, count }: { value: "all" | "review"; onChange: (value: "all" | "review") => void; count: number }) {
  return <div className="mt-4 flex gap-4 text-[11px]">
    <button type="button" onClick={() => onChange("all")} aria-pressed={value === "all"} className={cn("py-1 font-medium", value === "all" ? "text-[#303a32]" : "text-[var(--text-muted)]")}>Alle</button>
    <button type="button" onClick={() => onChange("review")} aria-pressed={value === "review"} className={cn("py-1 font-medium", value === "review" ? "text-[#17633a]" : "text-[var(--text-muted)]")}>Nur prüfen <span className="ml-1 tabular-nums">{count}</span></button>
  </div>;
}
function AreaRow({ area, selected, onSelect, onKind, onConfirm, onReject, onZoom }: {
  area: DetectedArea; selected: boolean; onSelect: () => void; onKind: (kind: AreaType) => void;
  onConfirm: () => void; onReject: () => void; onZoom: () => void;
}) {
  return <div data-area-selected={selected} className={cn("border-b border-[#edf0ea] px-4 py-3", selected && "bg-[#edf5ef] shadow-[inset_3px_0_0_#17633a]", area.status === "rejected" && "opacity-50")}>
    <button type="button" onClick={onSelect} className="flex w-full items-start justify-between gap-3 text-left">
      <div className="min-w-0"><div className="truncate text-sm font-medium">{area.label}</div><div className="mt-1 text-xs text-[var(--text-muted)]">Seite {area.pageNumber}</div></div>
      {area.status === "confirmed" ? <Check size={14} className="mt-0.5 shrink-0 text-[#3c8755]" /> : <span className={cn("mt-1 text-[10px]", area.status === "rejected" ? "text-[var(--text-muted)]" : "text-[#754b12]")}>{area.status === "rejected" ? "Ausgeschlossen" : "Prüfen"}</span>}
    </button>
    {selected && <div className="mt-3">
      <>
        {areaReviewReason(area) && <p className="mb-3 border-l-2 border-[#8c5b12] pl-2 text-xs leading-5 text-[#754b12]">{areaReviewReason(area)}</p>}
        {area.hasBbox && <button type="button" onClick={onZoom} className="mb-3 inline-flex min-h-9 items-center gap-2 text-xs font-medium text-[#17633a]"><Maximize2 size={14} />Bereich vergrößern</button>}
        <select aria-label="Bereichstyp" className="field h-8 text-xs" value={area.kind} onChange={(event) => onKind(event.target.value as AreaType)}>{areaTypeOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select>
        {area.evidence.length > 0 && <details className="mt-2 text-[11px] leading-5 text-[var(--text-muted)]"><summary className="cursor-pointer">Quelle anzeigen</summary><p className="mt-1">{sourceLabel(area.source)}{area.confidence !== null && ` · ${Math.round(area.confidence * 100)}%`} · {area.evidence.join(" · ")}</p></details>}
        <div className="mt-3 flex items-center justify-between gap-2">
          {area.status === "unconfirmed" && <Button className="h-8 flex-1" onClick={onConfirm}><Check size={13} />Übernehmen</Button>}
          <Button variant="ghost" className="h-8" onClick={onReject}><Trash2 size={12} />{area.status === "unconfirmed" ? "Verwerfen" : "Löschen"}</Button>
        </div>
      </>
    </div>}
  </div>;
}
function MeasurementRow({ measurement, selected, onSelect, onChange, onAccept, onExclude }: { measurement: Measurement; selected: boolean; onSelect: () => void; onChange: (value: number, unit: Measurement["unit"]) => void; onAccept: () => void; onExclude: () => void }) {
  const [editing, setEditing] = useState(false);
  const [draftValue, setDraftValue] = useState(String(measurement.value));
  const [draftUnit, setDraftUnit] = useState(measurement.unit);
  const [draftError, setDraftError] = useState<string | null>(null);
  const uncertain = needsMeasurementReview(measurement);
  function startEdit() { setDraftValue(String(measurement.value)); setDraftUnit(measurement.unit); setDraftError(null); setEditing(true); }
  function save() {
    const value = Number(draftValue.replace(",", "."));
    if (!Number.isFinite(value) || value <= 0) { setDraftError("Positiven Maßwert eingeben."); return; }
    onChange(value, draftUnit); setEditing(false); setDraftError(null);
  }
  return <div className={cn("border-b border-[#edf0ea] px-4 py-3", selected && "bg-[#f5f8fc]", measurement.status === "rejected" && "opacity-45")}>
    <button type="button" onClick={onSelect} className="flex w-full items-start justify-between gap-2 text-left">
      <div className="min-w-0"><div className="text-[13px] font-medium tabular-nums">{formatValue(measurement.value)}{measurement.unit === "unknown" ? <span className="ml-2 text-[10px] font-normal text-[#754b12]">Einheit offen</span> : ` ${measurement.unit}`}</div>
        <div className="mt-1 text-xs text-[var(--text-muted)]">{sourceLabel(measurement.source)}{measurement.pageNumber ? ` · Seite ${measurement.pageNumber}` : ""}{measurement.status === "rejected" && " · ausgeschlossen"}</div>
      </div>
      {uncertain && measurement.unit !== "unknown" && <span className="mt-0.5 text-[10px] text-[#754b12]">Prüfen</span>}
    </button>
    {selected && <div className="mt-3">
      {measurement.label !== "Planmaß" && <p className="mb-2 text-[11px] text-[#6f7c73]">{measurement.label}</p>}
      {editing ? <div>
        <div className="flex gap-2"><input aria-label="Maßwert korrigieren" inputMode="decimal" value={draftValue} onChange={(event) => setDraftValue(event.target.value)} className="field h-8 min-w-0 flex-1 text-xs" autoFocus />
          <select aria-label="Maßeinheit korrigieren" value={draftUnit} onChange={(event) => setDraftUnit(event.target.value as Measurement["unit"])} className="field h-8 w-24 text-xs"><option value="unknown">Offen</option><option value="m">m</option><option value="cm">cm</option><option value="mm">mm</option></select>
        </div>
        {draftError && <p role="alert" className="mt-2 text-[11px] text-[#a33c3c]">{draftError}</p>}
        <div className="mt-2 flex gap-2"><Button className="h-8" onClick={save}>Speichern</Button><Button variant="ghost" className="h-8" onClick={() => setEditing(false)}>Abbrechen</Button></div>
      </div> : <div className="flex items-center justify-between gap-2">
        {uncertain && measurement.unit !== "unknown" && <button type="button" onClick={onAccept} className="text-xs font-medium text-[#17633a]">Passt</button>}
        <button type="button" onClick={startEdit} className="text-xs font-medium text-[#3978c2]">Korrigieren</button>
        <button type="button" onClick={onExclude} className="text-[11px] text-[var(--text-muted)]">{measurement.status === "rejected" ? "Wiederherstellen" : "Ausschließen"}</button>
      </div>}
      <details className="mt-3 text-[11px] leading-5 text-[var(--text-muted)]"><summary className="cursor-pointer">Quelle anzeigen</summary><p className="mt-1">{measurement.evidence}</p>
        {measurement.unitInference && <p className="mt-1">Einheit: {measurement.unitInference.evidence}</p>}
        {measurement.originalValue !== undefined && <p className="mt-1">Original: {formatValue(measurement.originalValue)} {measurement.originalUnit === "unknown" ? "(Einheit offen)" : measurement.originalUnit}</p>}
      </details>
    </div>}
  </div>;
}
