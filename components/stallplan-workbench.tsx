"use client";

import {
  AlertCircle,
  Check,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Clipboard,
  Download,
  FileUp,
  Loader2,
  MousePointer2,
  Plus,
  Ruler,
  Sparkles,
  X,
} from "lucide-react";
import { ChangeEvent, PointerEvent, ReactNode, useMemo, useRef, useState } from "react";

import { extractDeterministicMeasurements } from "@/lib/deterministic";
import { parsePdf } from "@/lib/pdf-client";
import { AREA_RULES, areaTypeOptions } from "@/lib/rules";
import type {
  AiAnalysisResult,
  AreaType,
  DetectedArea,
  Measurement,
  NormalizedBox,
  PdfPageData,
  PlanningHandoff,
} from "@/lib/types";

type Panel = "areas" | "details" | "measurements" | "handoff";
type BusyPhase = "reading" | "analyzing" | null;
type AnswerValue = string | number | boolean;
type AnalysisMeta = Pick<AiAnalysisResult, "documentSummary" | "warnings"> & { model: string };

type ApiResponse = {
  model: string;
  documentSummary: string;
  warnings: string[];
  areas: DetectedArea[];
  measurements: Measurement[];
  error?: string;
};

function cn(...classes: Array<string | false | null | undefined>) {
  return classes.filter(Boolean).join(" ");
}

function clamp01(value: number) {
  return Math.min(1, Math.max(0, value));
}

function center(box: NormalizedBox) {
  return {
    x: box.x + box.width / 2,
    y: box.y + box.height / 2,
  };
}

function sameMeasurement(a: Measurement, b: Measurement) {
  if (a.pageNumber !== b.pageNumber || a.unit !== b.unit) return false;
  if (Math.abs(a.value - b.value) > Math.max(0.001, Math.abs(a.value) * 0.002)) return false;

  if (a.bbox && b.bbox) {
    const ac = center(a.bbox);
    const bc = center(b.bbox);
    return Math.hypot(ac.x - bc.x, ac.y - bc.y) < 0.06;
  }

  return true;
}

function mergeMeasurements(base: Measurement[], incoming: Measurement[]) {
  const merged = [...base];

  for (const candidate of incoming) {
    const index = merged.findIndex((measurement) => sameMeasurement(measurement, candidate));

    if (index === -1) {
      merged.push(candidate);
      continue;
    }

    const current = merged[index];
    merged[index] = {
      ...current,
      label:
        candidate.label && candidate.label.toLowerCase() !== "planmaß"
          ? candidate.label
          : current.label,
      evidence:
        candidate.evidence && !current.evidence.includes(candidate.evidence)
          ? [current.evidence, candidate.evidence].filter(Boolean).join(" · ")
          : current.evidence,
      bbox: current.bbox ?? candidate.bbox,
    };
  }

  return merged;
}

function Badge({ children, tone = "neutral" }: { children: ReactNode; tone?: "neutral" | "green" | "amber" }) {
  const tones = {
    neutral: "border-[#e5e7e5] bg-[#f7f8f7] text-[#667067]",
    green: "border-[#cfe2d5] bg-[#eff7f1] text-[#17633a]",
    amber: "border-[#eddcb6] bg-[#fff8e9] text-[#875f18]",
  };

  return (
    <span className={cn("inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-medium", tones[tone])}>
      {children}
    </span>
  );
}

function Button({
  children,
  onClick,
  disabled,
  variant = "primary",
  className,
}: {
  children: ReactNode;
  onClick?: () => void;
  disabled?: boolean;
  variant?: "primary" | "secondary" | "ghost";
  className?: string;
}) {
  const variants = {
    primary: "border-[#17633a] bg-[#17633a] text-white hover:bg-[#104e2e]",
    secondary: "border-[#dedfdd] bg-white text-[#303632] hover:bg-[#f7f8f7]",
    ghost: "border-transparent bg-transparent text-[#687069] hover:bg-[#f4f5f4]",
  };

  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={cn(
        "inline-flex h-9 items-center justify-center gap-2 rounded-lg border px-3 text-sm font-medium transition disabled:cursor-not-allowed disabled:opacity-40",
        variants[variant],
        className,
      )}
    >
      {children}
    </button>
  );
}

function UploadScreen({ onFile, error }: { onFile: (file: File) => void; error: string | null }) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);

  return (
    <div className="flex min-h-[calc(100vh-65px)] items-center justify-center px-5 py-12">
      <div className="w-full max-w-xl text-center">
        <div className="mx-auto flex h-11 w-11 items-center justify-center rounded-xl border border-[#dfe4df] bg-white shadow-sm">
          <Sparkles size={19} className="text-[#17633a]" />
        </div>
        <h1 className="mt-5 text-3xl font-semibold tracking-[-0.04em] text-[#202421]">Stallplan hochladen</h1>
        <p className="mt-2 text-sm text-[#747b75]">Bereiche und Maße werden automatisch analysiert.</p>

        <button
          type="button"
          onClick={() => inputRef.current?.click()}
          onDragEnter={(event) => {
            event.preventDefault();
            setDragging(true);
          }}
          onDragOver={(event) => event.preventDefault()}
          onDragLeave={() => setDragging(false)}
          onDrop={(event) => {
            event.preventDefault();
            setDragging(false);
            const dropped = event.dataTransfer.files?.[0];
            if (dropped) onFile(dropped);
          }}
          className={cn(
            "mt-8 flex w-full flex-col items-center rounded-2xl border bg-white px-8 py-12 shadow-[0_12px_35px_rgba(20,30,23,0.05)] transition",
            dragging ? "border-[#5d9270] bg-[#fbfdfb]" : "border-[#e0e3e0] hover:border-[#bfcac1]",
          )}
        >
          <span className="flex h-10 w-10 items-center justify-center rounded-full bg-[#f1f6f2] text-[#17633a]">
            <FileUp size={19} />
          </span>
          <span className="mt-4 text-sm font-semibold text-[#303632]">PDF auswählen</span>
          <span className="mt-1 text-xs text-[#8b918c]">oder hier ablegen · max. 25 MB</span>
        </button>

        <input
          ref={inputRef}
          className="hidden"
          type="file"
          accept="application/pdf,.pdf"
          onChange={(event) => {
            const selected = event.target.files?.[0];
            if (selected) onFile(selected);
          }}
        />

        {error && (
          <div className="mt-4 flex items-center justify-center gap-2 text-sm text-[#a33c3c]">
            <AlertCircle size={15} />
            {error}
          </div>
        )}
      </div>
    </div>
  );
}

export function StallplanWorkbench() {
  const [file, setFile] = useState<File | null>(null);
  const [pages, setPages] = useState<PdfPageData[]>([]);
  const [activePage, setActivePage] = useState(1);
  const [analysis, setAnalysis] = useState<AnalysisMeta | null>(null);
  const [areas, setAreas] = useState<DetectedArea[]>([]);
  const [measurements, setMeasurements] = useState<Measurement[]>([]);
  const [answers, setAnswers] = useState<Record<string, Record<string, AnswerValue>>>({});
  const [panel, setPanel] = useState<Panel>("areas");
  const [selectedAreaId, setSelectedAreaId] = useState<string | null>(null);
  const [selectedMeasurementId, setSelectedMeasurementId] = useState<string | null>(null);
  const [busy, setBusy] = useState<BusyPhase>(null);
  const [error, setError] = useState<string | null>(null);
  const [markMode, setMarkMode] = useState(false);
  const [manualKind, setManualKind] = useState<AreaType>("feeding_area");
  const [dragStart, setDragStart] = useState<{ x: number; y: number } | null>(null);
  const [draftBox, setDraftBox] = useState<NormalizedBox | null>(null);
  const [copied, setCopied] = useState(false);

  const currentPage = pages.find((page) => page.pageNumber === activePage) ?? pages[0];
  const confirmedAreas = areas.filter((area) => area.status === "confirmed");
  const openAreas = areas.filter((area) => area.status === "unconfirmed");
  const selectedArea = areas.find((area) => area.id === selectedAreaId) ?? null;
  const selectedMeasurement = measurements.find((measurement) => measurement.id === selectedMeasurementId) ?? null;
  const safeAreaCount = openAreas.filter(
    (area) => area.kind !== "unknown" && area.hasBbox && (area.confidence ?? 0) >= 0.82,
  ).length;

  const missingRequired = useMemo(() => {
    return confirmedAreas.reduce((count, area) => {
      const areaAnswers = answers[area.id] ?? {};
      return (
        count +
        AREA_RULES[area.kind].questions.filter((question) => {
          if (!question.required) return false;
          const value = areaAnswers[question.id];
          return value === undefined || value === "";
        }).length
      );
    }, 0);
  }, [answers, confirmedAreas]);

  const handoff = useMemo<PlanningHandoff | null>(() => {
    if (!file || !pages.length || !analysis) return null;

    return {
      schemaVersion: "1.1",
      createdAt: new Date().toISOString(),
      project: {
        fileName: file.name,
        pageCount: pages.length,
      },
      analysis: {
        summary: analysis.documentSummary,
        warnings: analysis.warnings,
      },
      areas: confirmedAreas.map((area) => ({
        id: area.id,
        kind: area.kind,
        label: area.label,
        pageNumber: area.pageNumber,
        bbox: area.hasBbox ? area.bbox : null,
        source: area.source,
        evidence: area.evidence,
        relevantProducts: AREA_RULES[area.kind].products,
        requiredMeasurements: AREA_RULES[area.kind].measurements,
        answers: answers[area.id] ?? {},
      })),
      measurements,
      audit: {
        aiModel: analysis.model,
        confirmedAreaCount: confirmedAreas.length,
        detectedMeasurementCount: measurements.length,
        customerCorrectedMeasurementCount: measurements.filter((measurement) => measurement.source === "customer").length,
      },
    };
  }, [analysis, answers, confirmedAreas, file, measurements, pages.length]);

  function reset() {
    setFile(null);
    setPages([]);
    setAreas([]);
    setMeasurements([]);
    setAnswers({});
    setAnalysis(null);
    setActivePage(1);
    setPanel("areas");
    setSelectedAreaId(null);
    setSelectedMeasurementId(null);
    setMarkMode(false);
    setError(null);
    setBusy(null);
  }

  async function analyzePlan(nextFile: File, parsedPages: PdfPageData[], deterministic: Measurement[]) {
    try {
      setBusy("analyzing");

      const response = await fetch("/api/analyze", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          fileName: nextFile.name,
          pages: parsedPages.map((page, index) => ({
            pageNumber: page.pageNumber,
            width: page.width,
            height: page.height,
            text: page.text,
            textItems: page.textItems,
            ...(index < 4 ? { imageDataUrl: page.imageDataUrl } : {}),
          })),
        }),
      });

      const data = (await response.json()) as ApiResponse;
      if (!response.ok) throw new Error(data.error || "KI-Analyse fehlgeschlagen.");

      setAnalysis({
        model: data.model,
        documentSummary: data.documentSummary,
        warnings: data.warnings,
      });
      setAreas(data.areas);
      setSelectedAreaId(data.areas.find((area) => area.status === "unconfirmed")?.id ?? data.areas[0]?.id ?? null);
      setMeasurements(mergeMeasurements(deterministic, data.measurements));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "KI-Analyse fehlgeschlagen.");
      setAnalysis({
        model: "nicht verfügbar",
        documentSummary: "Die PDF wurde gelesen. Die KI-Analyse konnte nicht abgeschlossen werden.",
        warnings: [],
      });
      setMeasurements(deterministic);
    } finally {
      setBusy(null);
    }
  }

  async function handleFile(nextFile: File) {
    if (nextFile.type !== "application/pdf" && !nextFile.name.toLowerCase().endsWith(".pdf")) {
      setError("Bitte eine PDF-Datei auswählen.");
      return;
    }

    if (nextFile.size > 25 * 1024 * 1024) {
      setError("Die PDF ist größer als 25 MB.");
      return;
    }

    try {
      setError(null);
      setFile(nextFile);
      setBusy("reading");
      setAnalysis(null);
      setAreas([]);
      setAnswers({});
      setMeasurements([]);
      setPanel("areas");
      setSelectedAreaId(null);
      setSelectedMeasurementId(null);

      const parsedPages = await parsePdf(nextFile);
      const deterministic = extractDeterministicMeasurements(parsedPages);

      setPages(parsedPages);
      setActivePage(1);
      setMeasurements(deterministic);
      await analyzePlan(nextFile, parsedPages, deterministic);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "PDF konnte nicht gelesen werden.");
      reset();
    }
  }

  function updateArea(id: string, patch: Partial<DetectedArea>) {
    setAreas((current) => current.map((area) => (area.id === id ? { ...area, ...patch } : area)));
  }

  function reviewArea(id: string, status: "confirmed" | "rejected") {
    const updated = areas.map((area) => (area.id === id ? { ...area, status } : area));
    setAreas(updated);

    const next = updated.find((area) => area.status === "unconfirmed");
    if (next) {
      setSelectedAreaId(next.id);
      setActivePage(next.pageNumber);
    } else if (updated.some((area) => area.status === "confirmed")) {
      setPanel("details");
    }
  }

  function confirmSafeAreas() {
    const updated = areas.map((area) =>
      area.status === "unconfirmed" &&
      area.kind !== "unknown" &&
      area.hasBbox &&
      (area.confidence ?? 0) >= 0.82
        ? { ...area, status: "confirmed" as const }
        : area,
    );

    setAreas(updated);
    const next = updated.find((area) => area.status === "unconfirmed");
    if (next) {
      setSelectedAreaId(next.id);
      setActivePage(next.pageNumber);
    } else if (updated.some((area) => area.status === "confirmed")) {
      setPanel("details");
    }
  }

  function updateMeasurement(id: string, patch: Partial<Measurement>) {
    setMeasurements((current) =>
      current.map((measurement) => (measurement.id === id ? { ...measurement, ...patch } : measurement)),
    );
  }

  function setAnswer(areaId: string, questionId: string, value: AnswerValue) {
    setAnswers((current) => {
      const next = {
        ...current,
        [areaId]: {
          ...(current[areaId] ?? {}),
          [questionId]: value,
        },
      };

      if (questionId === "animalSpecies") {
        for (const area of confirmedAreas) {
          const asksSpecies = AREA_RULES[area.kind].questions.some((question) => question.id === "animalSpecies");
          if (asksSpecies && (next[area.id]?.animalSpecies === undefined || next[area.id]?.animalSpecies === "")) {
            next[area.id] = {
              ...(next[area.id] ?? {}),
              animalSpecies: value,
            };
          }
        }
      }

      return next;
    });
  }

  function startMark(event: PointerEvent<HTMLDivElement>) {
    if (!markMode) return;
    const rect = event.currentTarget.getBoundingClientRect();
    const x = clamp01((event.clientX - rect.left) / rect.width);
    const y = clamp01((event.clientY - rect.top) / rect.height);
    event.currentTarget.setPointerCapture(event.pointerId);
    setDragStart({ x, y });
    setDraftBox({ x, y, width: 0, height: 0 });
  }

  function moveMark(event: PointerEvent<HTMLDivElement>) {
    if (!markMode || !dragStart) return;
    const rect = event.currentTarget.getBoundingClientRect();
    const x = clamp01((event.clientX - rect.left) / rect.width);
    const y = clamp01((event.clientY - rect.top) / rect.height);

    setDraftBox({
      x: Math.min(dragStart.x, x),
      y: Math.min(dragStart.y, y),
      width: Math.abs(x - dragStart.x),
      height: Math.abs(y - dragStart.y),
    });
  }

  function finishMark() {
    if (!markMode || !draftBox || !currentPage) {
      setDragStart(null);
      setDraftBox(null);
      return;
    }

    if (draftBox.width >= 0.02 && draftBox.height >= 0.02) {
      const id = crypto.randomUUID();
      const area: DetectedArea = {
        id,
        kind: manualKind,
        label: AREA_RULES[manualKind].title,
        confidence: null,
        source: "manual",
        status: "confirmed",
        pageNumber: currentPage.pageNumber,
        bbox: draftBox,
        hasBbox: true,
        evidence: ["Manuell markiert"],
      };

      setAreas((current) => [...current, area]);
      setSelectedAreaId(id);
      setPanel("areas");
    }

    setDragStart(null);
    setDraftBox(null);
    setMarkMode(false);
  }

  function downloadHandoff() {
    if (!handoff) return;
    const blob = new Blob([JSON.stringify(handoff, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = (file?.name ?? "stallplan").replace(/\.pdf$/i, "") + "-planungsanfrage.json";
    anchor.click();
    URL.revokeObjectURL(url);
  }

  async function copyHandoff() {
    if (!handoff) return;
    await navigator.clipboard.writeText(JSON.stringify(handoff, null, 2));
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1400);
  }

  const statusText =
    busy === "reading"
      ? "PDF wird gelesen"
      : busy === "analyzing"
        ? "Bereiche und Maße werden erkannt"
        : analysis
          ? "Analyse fertig"
          : "Bereit";

  return (
    <main className="min-h-screen bg-[#f7f7f5] text-[#242724]">
      <header className="flex h-16 items-center justify-between border-b border-[#e6e7e5] bg-white px-4 sm:px-6">
        <div className="flex min-w-0 items-center gap-3">
          <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-[#17633a] text-white">
            <Sparkles size={16} />
          </div>
          <div className="min-w-0">
            <div className="text-sm font-semibold tracking-[-0.01em]">PATURA Stallplan</div>
            {file && <div className="truncate text-xs text-[#8a908b]">{file.name}</div>}
          </div>
        </div>

        {file && (
          <div className="flex items-center gap-3">
            <div className="hidden items-center gap-2 text-xs text-[#777e78] sm:flex">
              {busy ? <Loader2 size={13} className="animate-spin" /> : <span className="h-2 w-2 rounded-full bg-[#3d9a5e]" />}
              {statusText}
            </div>
            <Button variant="ghost" onClick={reset}>
              Neuer Plan
            </Button>
          </div>
        )}
      </header>

      {!file && <UploadScreen onFile={handleFile} error={error} />}

      {file && currentPage && (
        <div className="grid min-h-[calc(100vh-64px)] grid-cols-1 xl:grid-cols-[minmax(0,1fr)_390px]">
          <section className="flex min-h-[560px] min-w-0 flex-col border-r border-[#e4e5e3] bg-[#f2f3f1]">
            <div className="flex min-h-12 flex-wrap items-center justify-between gap-2 border-b border-[#e1e3e0] bg-white px-3 py-2 sm:px-4">
              <div className="flex items-center gap-1">
                <button
                  type="button"
                  disabled={activePage <= 1}
                  onClick={() => setActivePage((page) => Math.max(1, page - 1))}
                  className="flex h-8 w-8 items-center justify-center rounded-md text-[#676e68] hover:bg-[#f3f4f3] disabled:opacity-30"
                  aria-label="Vorherige Seite"
                >
                  <ChevronLeft size={16} />
                </button>
                <span className="min-w-[74px] text-center text-xs text-[#737a74]">
                  {activePage} / {pages.length}
                </span>
                <button
                  type="button"
                  disabled={activePage >= pages.length}
                  onClick={() => setActivePage((page) => Math.min(pages.length, page + 1))}
                  className="flex h-8 w-8 items-center justify-center rounded-md text-[#676e68] hover:bg-[#f3f4f3] disabled:opacity-30"
                  aria-label="Nächste Seite"
                >
                  <ChevronRight size={16} />
                </button>
              </div>

              <div className="flex items-center gap-2">
                {markMode && (
                  <select
                    value={manualKind}
                    onChange={(event) => setManualKind(event.target.value as AreaType)}
                    className="h-8 rounded-md border border-[#dcdedb] bg-white px-2 text-xs outline-none focus:border-[#8eb69a]"
                  >
                    {areaTypeOptions.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                )}
                <Button
                  variant={markMode ? "primary" : "secondary"}
                  className="h-8 text-xs"
                  onClick={() => setMarkMode((active) => !active)}
                >
                  <MousePointer2 size={14} />
                  {markMode ? "Im Plan aufziehen" : "Bereich markieren"}
                </Button>
              </div>
            </div>

            <div className="flex flex-1 items-center justify-center overflow-auto p-3 sm:p-6 lg:p-8">
              <div
                className={cn(
                  "relative w-full max-w-[1180px] overflow-hidden bg-white shadow-[0_10px_35px_rgba(22,28,23,0.10)]",
                  markMode && "cursor-crosshair select-none",
                )}
                style={{ aspectRatio: String(currentPage.width) + " / " + String(currentPage.height) }}
                onPointerDown={startMark}
                onPointerMove={moveMark}
                onPointerUp={finishMark}
                onPointerCancel={finishMark}
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={currentPage.imageDataUrl}
                  alt={"Planseite " + currentPage.pageNumber}
                  draggable={false}
                  className="absolute inset-0 h-full w-full object-fill"
                />

                {areas
                  .filter((area) => area.pageNumber === activePage && area.status !== "rejected" && area.hasBbox)
                  .map((area) => {
                    const selected = selectedAreaId === area.id && panel === "areas";
                    return (
                      <button
                        key={area.id}
                        type="button"
                        disabled={markMode}
                        onClick={(event) => {
                          event.stopPropagation();
                          setSelectedAreaId(area.id);
                          setPanel("areas");
                        }}
                        className={cn(
                          "absolute border-2 transition",
                          selected
                            ? "border-[#17633a] bg-[#2f8a50]/18 shadow-[0_0_0_2px_rgba(255,255,255,0.75)]"
                            : area.status === "confirmed"
                              ? "border-[#5d9b70] bg-[#4c9d68]/10"
                              : "border-[#bf923e] bg-[#e7b95e]/12",
                        )}
                        style={{
                          left: String(area.bbox.x * 100) + "%",
                          top: String(area.bbox.y * 100) + "%",
                          width: String(area.bbox.width * 100) + "%",
                          height: String(area.bbox.height * 100) + "%",
                        }}
                        aria-label={area.label}
                      >
                        {selected && (
                          <span className="absolute -top-6 left-[-2px] whitespace-nowrap rounded-md bg-[#242724] px-1.5 py-0.5 text-[10px] font-medium text-white">
                            {AREA_RULES[area.kind].title}
                          </span>
                        )}
                      </button>
                    );
                  })}

                {panel === "measurements" &&
                  selectedMeasurement?.bbox &&
                  selectedMeasurement.pageNumber === activePage && (
                    <div
                      className="pointer-events-none absolute border-2 border-[#3978c2] bg-[#3978c2]/10 shadow-[0_0_0_2px_rgba(255,255,255,0.8)]"
                      style={{
                        left: String(selectedMeasurement.bbox.x * 100) + "%",
                        top: String(selectedMeasurement.bbox.y * 100) + "%",
                        width: String(Math.max(selectedMeasurement.bbox.width, 0.018) * 100) + "%",
                        height: String(Math.max(selectedMeasurement.bbox.height, 0.012) * 100) + "%",
                      }}
                    />
                  )}

                {draftBox && (
                  <div
                    className="pointer-events-none absolute border-2 border-dashed border-[#17633a] bg-[#17633a]/10"
                    style={{
                      left: String(draftBox.x * 100) + "%",
                      top: String(draftBox.y * 100) + "%",
                      width: String(draftBox.width * 100) + "%",
                      height: String(draftBox.height * 100) + "%",
                    }}
                  />
                )}

                {busy === "analyzing" && (
                  <div className="absolute inset-x-0 top-3 mx-auto flex w-fit items-center gap-2 rounded-full border border-black/5 bg-white/95 px-3 py-1.5 text-xs font-medium text-[#555c56] shadow-sm backdrop-blur">
                    <Loader2 size={13} className="animate-spin" />
                    Analyse läuft
                  </div>
                )}
              </div>
            </div>
          </section>

          <aside className="flex min-h-[520px] flex-col bg-white">
            <div className="border-b border-[#e7e8e6] px-4 pt-4">
              <div className="grid grid-cols-4 rounded-lg bg-[#f3f4f3] p-1">
                <PanelTab active={panel === "areas"} onClick={() => setPanel("areas")}>
                  Bereiche
                  {openAreas.length > 0 && <span className="ml-1 text-[#9a6b1c]">{openAreas.length}</span>}
                </PanelTab>
                <PanelTab active={panel === "details"} onClick={() => setPanel("details")} disabled={!confirmedAreas.length}>
                  Angaben
                  {missingRequired > 0 && <span className="ml-1 text-[#9a6b1c]">{missingRequired}</span>}
                </PanelTab>
                <PanelTab active={panel === "measurements"} onClick={() => setPanel("measurements")}>
                  Maße
                  {measurements.length > 0 && <span className="ml-1 text-[#6d746e]">{measurements.length}</span>}
                </PanelTab>
                <PanelTab active={panel === "handoff"} onClick={() => setPanel("handoff")} disabled={!confirmedAreas.length}>
                  Übergabe
                </PanelTab>
              </div>
              <div className="h-3" />
            </div>

            {error && (
              <div className="mx-4 mt-4 flex items-start gap-2 rounded-lg border border-[#efd0d0] bg-[#fff6f6] px-3 py-2 text-xs leading-5 text-[#984141]">
                <AlertCircle size={14} className="mt-0.5 shrink-0" />
                <span className="flex-1">{error}</span>
                <button type="button" onClick={() => setError(null)} aria-label="Fehler schließen">
                  <X size={13} />
                </button>
              </div>
            )}

            <div className="scrollbar-thin min-h-0 flex-1 overflow-y-auto">
              {panel === "areas" && (
                <div className="p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <h2 className="text-base font-semibold tracking-[-0.02em]">Bereiche prüfen</h2>
                      <p className="mt-1 text-xs text-[#808681]">
                        {busy === "analyzing"
                          ? "Vorschläge werden automatisch ergänzt."
                          : areas.length
                            ? String(openAreas.length) + " offen · " + String(confirmedAreas.length) + " bestätigt"
                            : "Noch keine Bereiche erkannt."}
                      </p>
                    </div>
                    {safeAreaCount > 0 && (
                      <button
                        type="button"
                        onClick={confirmSafeAreas}
                        className="text-xs font-medium text-[#17633a] hover:underline"
                      >
                        {safeAreaCount} sichere übernehmen
                      </button>
                    )}
                  </div>

                  {busy === "reading" && (
                    <LoadingBlock title="PDF wird gelesen" subtitle="Text und Planmaße werden extrahiert." />
                  )}

                  {busy === "analyzing" && areas.length === 0 && (
                    <LoadingBlock title="Plan wird analysiert" subtitle="Bereiche und Maße werden automatisch erkannt." />
                  )}

                  {areas.length > 0 && (
                    <div className="mt-4 space-y-2">
                      {areas.map((area) => (
                        <AreaRow
                          key={area.id}
                          area={area}
                          selected={selectedAreaId === area.id}
                          onSelect={() => {
                            setSelectedAreaId(area.id);
                            setActivePage(area.pageNumber);
                          }}
                          onKind={(kind) => updateArea(area.id, { kind, label: AREA_RULES[kind].title })}
                          onConfirm={() => reviewArea(area.id, "confirmed")}
                          onReject={() => reviewArea(area.id, "rejected")}
                        />
                      ))}
                    </div>
                  )}

                  {!busy && areas.length === 0 && (
                    <button
                      type="button"
                      onClick={() => setMarkMode(true)}
                      className="mt-5 flex w-full items-center justify-center gap-2 rounded-xl border border-dashed border-[#d4d8d4] px-4 py-8 text-sm text-[#6f766f] hover:bg-[#fafbfa]"
                    >
                      <Plus size={15} />
                      Bereich manuell markieren
                    </button>
                  )}

                  {analysis?.documentSummary && !busy && (
                    <div className="mt-5 border-t border-[#eceeec] pt-4 text-xs leading-5 text-[#7d837e]">
                      {analysis.documentSummary}
                    </div>
                  )}
                </div>
              )}

              {panel === "details" && (
                <div className="p-4">
                  <div className="flex items-start justify-between">
                    <div>
                      <h2 className="text-base font-semibold tracking-[-0.02em]">Angaben</h2>
                      <p className="mt-1 text-xs text-[#808681]">
                        Nur fachlicher Kontext. Maße kommen aus dem Plan.
                      </p>
                    </div>
                    {missingRequired === 0 ? (
                      <Badge tone="green">vollständig</Badge>
                    ) : (
                      <Badge tone="amber">{missingRequired} offen</Badge>
                    )}
                  </div>

                  <div className="mt-4 space-y-3">
                    {confirmedAreas.map((area) => (
                      <QuestionCard
                        key={area.id}
                        area={area}
                        answers={answers[area.id] ?? {}}
                        onAnswer={(questionId, value) => setAnswer(area.id, questionId, value)}
                        onFocus={() => {
                          setSelectedAreaId(area.id);
                          setActivePage(area.pageNumber);
                        }}
                      />
                    ))}
                  </div>

                  <Button className="mt-5 w-full" onClick={() => setPanel("handoff")}>
                    {missingRequired > 0 ? "Übergabe mit offenen Angaben" : "Übergabe erstellen"}
                  </Button>
                </div>
              )}

              {panel === "measurements" && (
                <div className="p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <h2 className="text-base font-semibold tracking-[-0.02em]">Maße</h2>
                      <p className="mt-1 text-xs text-[#808681]">Automatisch aus PDF-Text und Planbild.</p>
                    </div>
                    <Badge tone={measurements.length ? "green" : "neutral"}>{measurements.length} erkannt</Badge>
                  </div>

                  {measurements.length === 0 && busy && (
                    <LoadingBlock title="Maße werden gesucht" subtitle="PDF-Text und Bild werden abgeglichen." />
                  )}

                  {measurements.length === 0 && !busy && (
                    <div className="mt-5 rounded-xl border border-dashed border-[#d8dbd8] px-4 py-7 text-center text-xs text-[#7b827c]">
                      Keine belastbaren Planmaße erkannt.
                    </div>
                  )}

                  <div className="mt-4 space-y-2">
                    {measurements.map((measurement) => (
                      <MeasurementRow
                        key={measurement.id}
                        measurement={measurement}
                        selected={selectedMeasurementId === measurement.id}
                        onSelect={() => {
                          setSelectedMeasurementId(measurement.id);
                          if (measurement.pageNumber) setActivePage(measurement.pageNumber);
                        }}
                        onChange={(patch) => updateMeasurement(measurement.id, patch)}
                      />
                    ))}
                  </div>
                </div>
              )}

              {panel === "handoff" && (
                <div className="p-4">
                  <div className="flex h-10 w-10 items-center justify-center rounded-full bg-[#eff7f1] text-[#17633a]">
                    <CheckCircle2 size={19} />
                  </div>
                  <h2 className="mt-4 text-lg font-semibold tracking-[-0.03em]">Übergabe</h2>
                  <p className="mt-1 text-xs leading-5 text-[#7c837d]">
                    Strukturierter Datensatz für die Stallplanung.
                  </p>

                  <div className="mt-5 grid grid-cols-2 gap-2">
                    <SummaryCard label="Bereiche" value={String(confirmedAreas.length)} />
                    <SummaryCard label="Maße" value={String(measurements.length)} />
                    <SummaryCard label="Offene Angaben" value={String(missingRequired)} />
                    <SummaryCard label="Korrekturen" value={String(measurements.filter((item) => item.source === "customer").length)} />
                  </div>

                  {analysis?.warnings.length ? (
                    <div className="mt-4 rounded-lg bg-[#fff9ed] px-3 py-2 text-[11px] leading-5 text-[#806126]">
                      {analysis.warnings[0]}
                    </div>
                  ) : null}

                  <Button className="mt-5 w-full" disabled={!handoff} onClick={downloadHandoff}>
                    <Download size={15} />
                    JSON herunterladen
                  </Button>
                  <Button className="mt-2 w-full" variant="secondary" disabled={!handoff} onClick={copyHandoff}>
                    {copied ? <Check size={15} /> : <Clipboard size={15} />}
                    {copied ? "Kopiert" : "JSON kopieren"}
                  </Button>
                </div>
              )}
            </div>
          </aside>
        </div>
      )}
    </main>
  );
}

function PanelTab({
  children,
  active,
  onClick,
  disabled,
}: {
  children: ReactNode;
  active: boolean;
  onClick: () => void;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className={cn(
        "h-8 rounded-md px-1 text-[11px] font-medium transition",
        active ? "bg-white text-[#2d322e] shadow-sm" : "text-[#777e78] hover:text-[#3e443f]",
        disabled && "cursor-not-allowed opacity-35",
      )}
    >
      {children}
    </button>
  );
}

function LoadingBlock({ title, subtitle }: { title: string; subtitle: string }) {
  return (
    <div className="mt-5 flex items-center gap-3 rounded-xl border border-[#e3e5e2] bg-[#fafbfa] p-4">
      <Loader2 size={17} className="shrink-0 animate-spin text-[#17633a]" />
      <div>
        <div className="text-sm font-medium">{title}</div>
        <div className="mt-0.5 text-xs text-[#868c87]">{subtitle}</div>
      </div>
    </div>
  );
}

function AreaRow({
  area,
  selected,
  onSelect,
  onKind,
  onConfirm,
  onReject,
}: {
  area: DetectedArea;
  selected: boolean;
  onSelect: () => void;
  onKind: (kind: AreaType) => void;
  onConfirm: () => void;
  onReject: () => void;
}) {
  const confidence = area.confidence === null ? null : Math.round(area.confidence * 100);

  return (
    <div
      className={cn(
        "rounded-xl border px-3 py-3 transition",
        selected ? "border-[#a9c8b2] bg-[#f8fbf8]" : "border-[#e3e5e2] bg-white",
        area.status === "rejected" && "opacity-45",
      )}
    >
      <button
        type="button"
        onClick={onSelect}
        className="flex w-full items-center justify-between gap-3 text-left"
      >
        <div className="min-w-0">
          <div className="truncate text-sm font-medium">{AREA_RULES[area.kind].title}</div>
          <div className="mt-0.5 text-[11px] text-[#8a908b]">
            Seite {area.pageNumber}
            {confidence !== null ? " · " + String(confidence) + "%" : " · manuell"}
          </div>
        </div>
        <span
          className={cn(
            "h-2.5 w-2.5 shrink-0 rounded-full",
            area.status === "confirmed"
              ? "bg-[#43945e]"
              : area.status === "rejected"
                ? "bg-[#b6bbb7]"
                : "bg-[#d9a84e]",
          )}
        />
      </button>

      {selected && area.status !== "rejected" && (
        <div className="mt-3 border-t border-[#e8ebe8] pt-3">
          <select
            value={area.kind}
            onChange={(event) => onKind(event.target.value as AreaType)}
            className="h-8 w-full rounded-md border border-[#dcdedb] bg-white px-2 text-xs outline-none focus:border-[#8eb69a]"
          >
            {areaTypeOptions.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>

          {area.evidence[0] && (
            <p className="mt-2 line-clamp-2 text-[11px] leading-4 text-[#858b86]">{area.evidence[0]}</p>
          )}

          {area.status === "unconfirmed" && (
            <div className="mt-3 grid grid-cols-[1fr_36px] gap-2">
              <Button className="h-8 text-xs" onClick={onConfirm}>
                <Check size={13} />
                Übernehmen
              </Button>
              <Button className="h-8 px-0" variant="secondary" onClick={onReject}>
                <X size={13} />
              </Button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function QuestionCard({
  area,
  answers,
  onAnswer,
  onFocus,
}: {
  area: DetectedArea;
  answers: Record<string, AnswerValue>;
  onAnswer: (questionId: string, value: AnswerValue) => void;
  onFocus: () => void;
}) {
  const rule = AREA_RULES[area.kind];

  return (
    <section className="rounded-xl border border-[#e1e4e1] bg-white p-3.5" onFocus={onFocus}>
      <div className="flex items-center justify-between gap-2">
        <div>
          <div className="text-sm font-medium">{rule.title}</div>
          <div className="mt-0.5 text-[11px] text-[#8a908b]">Seite {area.pageNumber}</div>
        </div>
        <Badge>{rule.questions.filter((question) => question.required).length} Pflicht</Badge>
      </div>

      <div className="mt-4 space-y-3">
        {rule.questions.map((question) => (
          <label key={question.id} className="block">
            <span className="text-xs font-medium text-[#555c56]">
              {question.label}
              {question.required && <span className="ml-0.5 text-[#a44b4b]">*</span>}
            </span>

            {question.type === "select" && (
              <select
                value={String(answers[question.id] ?? "")}
                onChange={(event) => onAnswer(question.id, event.target.value)}
                className="mt-1.5 h-9 w-full rounded-lg border border-[#dedfdd] bg-white px-2.5 text-sm outline-none transition focus:border-[#8db299]"
              >
                <option value="">Auswählen</option>
                {question.options?.map((option) => (
                  <option key={option} value={option}>
                    {option}
                  </option>
                ))}
              </select>
            )}

            {question.type === "boolean" && (
              <div className="mt-1.5 grid grid-cols-2 gap-2">
                {[true, false].map((value) => (
                  <button
                    key={String(value)}
                    type="button"
                    onClick={() => onAnswer(question.id, value)}
                    className={cn(
                      "h-9 rounded-lg border text-sm transition",
                      answers[question.id] === value
                        ? "border-[#8fbaa0] bg-[#f0f7f2] text-[#17633a]"
                        : "border-[#dedfdd] bg-white text-[#666d67] hover:bg-[#f8f9f8]",
                    )}
                  >
                    {value ? "Ja" : "Nein"}
                  </button>
                ))}
              </div>
            )}

            {(question.type === "text" || question.type === "number") && (
              <input
                type={question.type === "number" ? "number" : "text"}
                value={String(answers[question.id] ?? "")}
                onChange={(event: ChangeEvent<HTMLInputElement>) =>
                  onAnswer(
                    question.id,
                    question.type === "number" && event.target.value !== ""
                      ? Number(event.target.value)
                      : event.target.value,
                  )
                }
                className="mt-1.5 h-9 w-full rounded-lg border border-[#dedfdd] bg-white px-2.5 text-sm outline-none transition focus:border-[#8db299]"
                placeholder={question.type === "number" ? "0" : "Angabe"}
              />
            )}
          </label>
        ))}
      </div>
    </section>
  );
}

function MeasurementRow({
  measurement,
  selected,
  onSelect,
  onChange,
}: {
  measurement: Measurement;
  selected: boolean;
  onSelect: () => void;
  onChange: (patch: Partial<Measurement>) => void;
}) {
  const source =
    measurement.source === "pdf-text"
      ? "PDF"
      : measurement.source === "ai"
        ? "KI"
        : "Korrigiert";

  return (
    <div
      className={cn(
        "rounded-xl border p-3 transition",
        selected ? "border-[#9bb7d7] bg-[#f8fbff]" : "border-[#e2e4e1] bg-white",
      )}
    >
      <button type="button" onClick={onSelect} className="flex w-full items-start justify-between gap-3 text-left">
        <div className="min-w-0">
          <div className="truncate text-xs font-medium text-[#525953]">{measurement.label}</div>
          <div className="mt-0.5 text-[11px] text-[#929792]">
            {source}
            {measurement.pageNumber ? " · Seite " + String(measurement.pageNumber) : ""}
          </div>
        </div>
        <div className="shrink-0 text-sm font-semibold text-[#2f3530]">
          {measurement.value.toLocaleString("de-DE", { maximumFractionDigits: 3 })} {measurement.unit}
        </div>
      </button>

      {selected && (
        <div className="mt-3 flex gap-2 border-t border-[#e7e9e7] pt-3">
          <input
            type="number"
            step="any"
            value={measurement.value}
            onChange={(event) =>
              onChange({
                value: event.target.value === "" ? 0 : Number(event.target.value),
                source: "customer",
                status: "confirmed",
                confidence: null,
              })
            }
            className="h-8 min-w-0 flex-1 rounded-md border border-[#dcdedb] px-2 text-sm outline-none focus:border-[#8db299]"
          />
          <select
            value={measurement.unit}
            onChange={(event) =>
              onChange({
                unit: event.target.value as Measurement["unit"],
                source: "customer",
                status: "confirmed",
                confidence: null,
              })
            }
            className="h-8 rounded-md border border-[#dcdedb] bg-white px-2 text-xs outline-none focus:border-[#8db299]"
          >
            <option value="m">m</option>
            <option value="cm">cm</option>
            <option value="mm">mm</option>
          </select>
        </div>
      )}
    </div>
  );
}

function SummaryCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-[#e3e5e2] bg-[#fafbfa] p-3">
      <div className="text-[10px] uppercase tracking-[0.08em] text-[#8c928d]">{label}</div>
      <div className="mt-1 text-lg font-semibold tracking-[-0.03em]">{value}</div>
    </div>
  );
}
