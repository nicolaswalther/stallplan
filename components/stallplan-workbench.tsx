"use client";

import {
  AlertTriangle,
  ArrowRight,
  Bot,
  BoxSelect,
  Check,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Clipboard,
  Download,
  FileSearch,
  FileText,
  Layers3,
  LoaderCircle,
  MousePointer2,
  Plus,
  Ruler,
  ShieldCheck,
  Sparkles,
  Trash2,
  UploadCloud,
  X,
} from "lucide-react";
import { ChangeEvent, PointerEvent, useMemo, useRef, useState } from "react";

import { extractDeterministicMeasurements, findPlanTerms } from "@/lib/deterministic";
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

type AnalysisMeta = Pick<AiAnalysisResult, "documentSummary" | "warnings"> & { model: string };
type AnswerValue = string | number | boolean;

type ApiResponse = {
  model: string;
  documentSummary: string;
  warnings: string[];
  areas: DetectedArea[];
  measurements: Measurement[];
  error?: string;
};

const steps = [
  { id: 1, title: "Plan", subtitle: "PDF hochladen", icon: UploadCloud },
  { id: 2, title: "Analyse", subtitle: "Text + Vision", icon: FileSearch },
  { id: 3, title: "Bereiche", subtitle: "prüfen & markieren", icon: BoxSelect },
  { id: 4, title: "Angaben", subtitle: "Fragen & Maße", icon: Ruler },
  { id: 5, title: "Übergabe", subtitle: "Planungsdatensatz", icon: Clipboard },
];

function cn(...classes: Array<string | false | null | undefined>) {
  return classes.filter(Boolean).join(" ");
}

function clamp01(value: number) {
  return Math.min(1, Math.max(0, value));
}

function sourceLabel(source: DetectedArea["source"] | Measurement["source"]) {
  if (source === "ai") return "KI";
  if (source === "manual") return "Manuell";
  if (source === "customer") return "Kunde";
  return "PDF-Text";
}

function confidenceLabel(confidence: number | null) {
  if (confidence === null) return "–";
  return `${Math.round(confidence * 100)} %`;
}

function statusTone(status: DetectedArea["status"]) {
  if (status === "confirmed") return "border-emerald-200 bg-emerald-50 text-emerald-800";
  if (status === "rejected") return "border-red-200 bg-red-50 text-red-700";
  return "border-amber-200 bg-amber-50 text-amber-800";
}

function sourceTone(source: string) {
  if (source === "ai") return "border-violet-200 bg-violet-50 text-violet-700";
  if (source === "customer" || source === "manual") return "border-emerald-200 bg-emerald-50 text-emerald-700";
  return "border-slate-200 bg-slate-50 text-slate-700";
}

function Badge({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <span className={cn("inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-semibold", className)}>
      {children}
    </span>
  );
}

function Button({
  children,
  variant = "primary",
  className,
  disabled,
  onClick,
  type = "button",
}: {
  children: React.ReactNode;
  variant?: "primary" | "secondary" | "ghost" | "danger";
  className?: string;
  disabled?: boolean;
  onClick?: () => void;
  type?: "button" | "submit";
}) {
  const styles = {
    primary: "bg-[#17633a] text-white hover:bg-[#104b2b] border-[#17633a]",
    secondary: "bg-white text-[#243028] hover:bg-[#f4f7f4] border-[#d8e0d9]",
    ghost: "bg-transparent text-[#536159] hover:bg-[#edf2ee] border-transparent",
    danger: "bg-white text-red-700 hover:bg-red-50 border-red-200",
  };

  return (
    <button
      type={type}
      disabled={disabled}
      onClick={onClick}
      className={cn(
        "inline-flex h-9 items-center justify-center gap-2 rounded-lg border px-3.5 text-sm font-semibold transition disabled:cursor-not-allowed disabled:opacity-45",
        styles[variant],
        className,
      )}
    >
      {children}
    </button>
  );
}

function EmptyUpload({ onFile }: { onFile: (file: File) => void }) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);

  return (
    <div className="flex min-h-[560px] items-center justify-center p-8">
      <div className="w-full max-w-2xl">
        <div className="mb-8 text-center">
          <Badge className="mb-4 border-[#bfd8c7] bg-[#eaf5ed] text-[#17633a]">PDF MVP · Hybridanalyse</Badge>
          <h1 className="text-3xl font-bold tracking-[-0.03em] text-[#172019]">Stallplan vorbereiten, nicht erraten.</h1>
          <p className="mx-auto mt-3 max-w-xl text-sm leading-6 text-[#657168]">
            Der Plan wird zuerst klassisch ausgelesen. Die KI schlägt anschließend nur semantische Bereiche vor. Jede relevante Angabe bleibt bestätigungspflichtig.
          </p>
        </div>

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
            "group flex w-full flex-col items-center rounded-2xl border-2 border-dashed bg-white px-8 py-16 text-center shadow-[0_18px_50px_rgba(29,48,35,0.06)] transition",
            dragging ? "border-[#17633a] bg-[#f3faf5]" : "border-[#cdd7cf] hover:border-[#7dad8c] hover:bg-[#fbfdfb]",
          )}
        >
          <span className="mb-5 flex h-14 w-14 items-center justify-center rounded-2xl bg-[#e9f4ec] text-[#17633a] transition group-hover:scale-105">
            <UploadCloud size={28} />
          </span>
          <span className="text-base font-bold text-[#1e2922]">PDF hier ablegen oder auswählen</span>
          <span className="mt-2 text-sm text-[#768078]">Empfohlen: Vektor-PDF mit Text- und Maßinformationen · max. 25 MB</span>
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

        <div className="mt-5 grid grid-cols-3 gap-3 text-left">
          {[
            [Layers3, "Deterministisch", "Text, Seiten und Maße werden separat extrahiert."],
            [Sparkles, "Semantisch", "Vision erkennt nur Kandidaten und liefert Confidence."],
            [ShieldCheck, "Nachvollziehbar", "Quelle und Bestätigungsstatus bleiben erhalten."],
          ].map(([Icon, title, text]) => {
            const IconComponent = Icon as typeof Layers3;
            return (
              <div key={String(title)} className="rounded-xl border border-[#dde4de] bg-white/70 p-4">
                <IconComponent size={17} className="mb-2 text-[#17633a]" />
                <div className="text-xs font-bold text-[#243028]">{String(title)}</div>
                <div className="mt-1 text-[11px] leading-4 text-[#758078]">{String(text)}</div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

export function StallplanWorkbench() {
  const [file, setFile] = useState<File | null>(null);
  const [pages, setPages] = useState<PdfPageData[]>([]);
  const [activePage, setActivePage] = useState(1);
  const [workflowStep, setWorkflowStep] = useState(1);
  const [analysis, setAnalysis] = useState<AnalysisMeta | null>(null);
  const [areas, setAreas] = useState<DetectedArea[]>([]);
  const [measurements, setMeasurements] = useState<Measurement[]>([]);
  const [answers, setAnswers] = useState<Record<string, Record<string, AnswerValue>>>({});
  const [selectedAreaId, setSelectedAreaId] = useState<string | null>(null);
  const [busy, setBusy] = useState<"parsing" | "analyzing" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [markMode, setMarkMode] = useState(false);
  const [manualKind, setManualKind] = useState<AreaType>("feeding_area");
  const [dragStart, setDragStart] = useState<{ x: number; y: number } | null>(null);
  const [draftBox, setDraftBox] = useState<NormalizedBox | null>(null);
  const [copied, setCopied] = useState(false);

  const terms = useMemo(() => findPlanTerms(pages), [pages]);
  const currentPage = pages.find((page) => page.pageNumber === activePage) ?? pages[0];
  const confirmedAreas = areas.filter((area) => area.status === "confirmed");
  const selectedArea = areas.find((area) => area.id === selectedAreaId) ?? null;

  const unlockedStep = useMemo(() => {
    if (!pages.length) return 1;
    if (!analysis) return 2;
    if (!confirmedAreas.length) return 3;
    return 5;
  }, [pages.length, analysis, confirmedAreas.length]);

  const handoff = useMemo<PlanningHandoff | null>(() => {
    if (!file || !pages.length || !analysis) return null;
    return {
      schemaVersion: "1.0",
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
        confirmedMeasurementCount: measurements.filter((measurement) => measurement.status === "confirmed").length,
      },
    };
  }, [analysis, answers, confirmedAreas, file, measurements, pages.length]);

  async function handleFile(nextFile: File) {
    if (nextFile.type !== "application/pdf" && !nextFile.name.toLowerCase().endsWith(".pdf")) {
      setError("Für den MVP wird ausschließlich PDF unterstützt.");
      return;
    }
    if (nextFile.size > 25 * 1024 * 1024) {
      setError("Die PDF ist größer als 25 MB. Bitte zunächst eine kleinere Planversion verwenden.");
      return;
    }

    try {
      setBusy("parsing");
      setError(null);
      setFile(nextFile);
      const parsedPages = await parsePdf(nextFile);
      setPages(parsedPages);
      setActivePage(1);
      setAnalysis(null);
      setAreas([]);
      setAnswers({});
      setSelectedAreaId(null);
      setMeasurements(extractDeterministicMeasurements(parsedPages));
      setWorkflowStep(2);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "PDF konnte nicht gelesen werden.");
      setFile(null);
      setPages([]);
      setWorkflowStep(1);
    } finally {
      setBusy(null);
    }
  }

  async function runAnalysis() {
    if (!file || !pages.length) return;

    try {
      setBusy("analyzing");
      setError(null);
      const response = await fetch("/api/analyze", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ fileName: file.name, pages }),
      });
      const data = (await response.json()) as ApiResponse;
      if (!response.ok) throw new Error(data.error || "KI-Analyse fehlgeschlagen.");

      setAnalysis({
        model: data.model,
        documentSummary: data.documentSummary,
        warnings: data.warnings,
      });
      setAreas(data.areas);
      setSelectedAreaId(data.areas[0]?.id ?? null);
      setMeasurements((existing) => {
        const merged = [...existing];
        for (const candidate of data.measurements) {
          const duplicate = merged.some(
            (measurement) =>
              measurement.pageNumber === candidate.pageNumber &&
              measurement.unit === candidate.unit &&
              Math.abs(measurement.value - candidate.value) < 0.001,
          );
          if (!duplicate) merged.push(candidate);
        }
        return merged;
      });
      setWorkflowStep(3);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "KI-Analyse fehlgeschlagen.");
    } finally {
      setBusy(null);
    }
  }

  function updateArea(id: string, patch: Partial<DetectedArea>) {
    setAreas((current) => current.map((area) => (area.id === id ? { ...area, ...patch } : area)));
  }

  function updateMeasurement(id: string, patch: Partial<Measurement>) {
    setMeasurements((current) =>
      current.map((measurement) => (measurement.id === id ? { ...measurement, ...patch } : measurement)),
    );
  }

  function setAnswer(areaId: string, questionId: string, value: AnswerValue) {
    setAnswers((current) => ({
      ...current,
      [areaId]: {
        ...(current[areaId] ?? {}),
        [questionId]: value,
      },
    }));
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
        label: `${AREA_RULES[manualKind].title} (manuell)`,
        confidence: null,
        source: "manual",
        status: "confirmed",
        pageNumber: currentPage.pageNumber,
        bbox: draftBox,
        hasBbox: true,
        evidence: ["Vom Benutzer im Plan markiert."],
      };
      setAreas((current) => [...current, area]);
      setSelectedAreaId(id);
    }

    setDragStart(null);
    setDraftBox(null);
  }

  function downloadHandoff() {
    if (!handoff) return;
    const blob = new Blob([JSON.stringify(handoff, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `${(file?.name ?? "stallplan").replace(/\.pdf$/i, "")}-planungsanfrage.json`;
    anchor.click();
    URL.revokeObjectURL(url);
  }

  async function copyHandoff() {
    if (!handoff) return;
    await navigator.clipboard.writeText(JSON.stringify(handoff, null, 2));
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1500);
  }

  if (busy === "parsing" && !pages.length) {
    return (
      <main className="flex min-h-screen items-center justify-center">
        <div className="rounded-2xl border border-[#dbe3dc] bg-white px-8 py-7 text-center shadow-xl shadow-black/5">
          <LoaderCircle className="mx-auto animate-spin text-[#17633a]" size={30} />
          <div className="mt-4 font-bold">PDF wird deterministisch ausgelesen</div>
          <div className="mt-1 text-sm text-[#6d786f]">Seiten rendern, Text extrahieren und Maße erfassen.</div>
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-screen p-3 lg:p-5">
      <div className="mx-auto flex min-h-[calc(100vh-40px)] max-w-[1800px] overflow-hidden rounded-[22px] border border-[#d8e0d9] bg-[#f9fbf9] shadow-[0_24px_80px_rgba(21,39,27,0.10)]">
        <aside className="hidden w-[248px] shrink-0 border-r border-[#dce3dd] bg-[#f2f6f2] p-5 xl:flex xl:flex-col">
          <div className="flex items-center gap-3 border-b border-[#dce3dd] pb-5">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-[#17633a] text-white shadow-sm">
              <Layers3 size={21} />
            </div>
            <div>
              <div className="text-sm font-extrabold tracking-[-0.02em]">PATURA</div>
              <div className="text-xs text-[#657168]">Stallplan Assistant</div>
            </div>
          </div>

          <nav className="mt-6 space-y-2">
            {steps.map((step) => {
              const Icon = step.icon;
              const active = workflowStep === step.id;
              const unlocked = step.id <= unlockedStep;
              return (
                <button
                  key={step.id}
                  type="button"
                  disabled={!unlocked}
                  onClick={() => unlocked && setWorkflowStep(step.id)}
                  className={cn(
                    "flex w-full items-center gap-3 rounded-xl px-3 py-3 text-left transition",
                    active ? "bg-white shadow-sm ring-1 ring-[#dce4dd]" : "hover:bg-white/70",
                    !unlocked && "cursor-not-allowed opacity-40",
                  )}
                >
                  <span
                    className={cn(
                      "flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border",
                      active
                        ? "border-[#17633a] bg-[#17633a] text-white"
                        : unlocked
                          ? "border-[#cad6cc] bg-white text-[#46604d]"
                          : "border-[#d8dfd9] bg-[#eef1ee] text-[#9aa39c]",
                    )}
                  >
                    <Icon size={16} />
                  </span>
                  <span>
                    <span className="block text-xs font-bold text-[#263029]">{step.title}</span>
                    <span className="block text-[11px] text-[#7a857c]">{step.subtitle}</span>
                  </span>
                </button>
              );
            })}
          </nav>

          <div className="mt-auto rounded-xl border border-[#d8e2d9] bg-white/70 p-3.5">
            <div className="flex items-center gap-2 text-xs font-bold text-[#334039]">
              <ShieldCheck size={15} className="text-[#17633a]" /> Kontrollierte KI
            </div>
            <p className="mt-2 text-[11px] leading-4 text-[#748078]">
              KI-Ergebnisse bleiben Vorschläge. Fachregeln, Quelle und Bestätigung werden separat gespeichert.
            </p>
          </div>
        </aside>

        <section className="flex min-w-0 flex-1 flex-col">
          <header className="flex min-h-[72px] items-center justify-between border-b border-[#dce3dd] bg-white/85 px-5 backdrop-blur lg:px-7">
            <div className="min-w-0">
              <div className="flex items-center gap-2 text-xs font-semibold text-[#758078]">
                <span>Planungsassistent</span>
                {file && <span className="text-[#abb3ad]">/</span>}
                {file && <span className="truncate text-[#3e4b42]">{file.name}</span>}
              </div>
              <h1 className="mt-1 truncate text-lg font-extrabold tracking-[-0.02em] text-[#1d2720]">
                {steps.find((step) => step.id === workflowStep)?.title ?? "Stallplan"}
              </h1>
            </div>
            <div className="flex items-center gap-2">
              {analysis && (
                <Badge className="hidden border-violet-200 bg-violet-50 text-violet-700 sm:inline-flex">
                  <Bot size={11} className="mr-1" /> {analysis.model}
                </Badge>
              )}
              {file && (
                <Button variant="secondary" onClick={() => setWorkflowStep(1)}>
                  <Plus size={15} /> Neuer Plan
                </Button>
              )}
            </div>
          </header>

          {error && (
            <div className="mx-5 mt-4 flex items-start gap-3 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800 lg:mx-7">
              <AlertTriangle size={18} className="mt-0.5 shrink-0" />
              <div className="flex-1">{error}</div>
              <button type="button" onClick={() => setError(null)} className="text-red-500 hover:text-red-800">
                <X size={16} />
              </button>
            </div>
          )}

          {workflowStep === 1 && (
            <div className="flex-1">
              <EmptyUpload onFile={handleFile} />
            </div>
          )}

          {workflowStep > 1 && currentPage && (
            <div className="flex min-h-0 flex-1 flex-col 2xl:flex-row">
              <div className="flex min-w-0 flex-1 flex-col border-r border-[#dce3dd]">
                <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[#dce3dd] bg-[#f7f9f7] px-4 py-3 lg:px-5">
                  <div className="flex items-center gap-2">
                    <Button
                      variant="secondary"
                      className="h-8 px-2.5"
                      disabled={activePage <= 1}
                      onClick={() => setActivePage((page) => Math.max(1, page - 1))}
                    >
                      <ChevronLeft size={15} />
                    </Button>
                    <div className="min-w-[94px] text-center text-xs font-bold text-[#536159]">
                      Seite {activePage} / {pages.length}
                    </div>
                    <Button
                      variant="secondary"
                      className="h-8 px-2.5"
                      disabled={activePage >= pages.length}
                      onClick={() => setActivePage((page) => Math.min(pages.length, page + 1))}
                    >
                      <ChevronRight size={15} />
                    </Button>
                  </div>

                  {analysis && workflowStep >= 3 && (
                    <div className="flex items-center gap-2">
                      <select
                        value={manualKind}
                        onChange={(event) => setManualKind(event.target.value as AreaType)}
                        className="h-8 rounded-lg border border-[#d6dfd8] bg-white px-2 text-xs font-semibold outline-none focus:border-[#75a383]"
                      >
                        {areaTypeOptions.map((option) => (
                          <option key={option.value} value={option.value}>
                            {option.label}
                          </option>
                        ))}
                      </select>
                      <Button
                        variant={markMode ? "primary" : "secondary"}
                        className="h-8"
                        onClick={() => setMarkMode((active) => !active)}
                      >
                        <MousePointer2 size={14} /> {markMode ? "Markieren aktiv" : "Bereich markieren"}
                      </Button>
                    </div>
                  )}
                </div>

                <div className="plan-grid flex min-h-[520px] flex-1 items-center justify-center overflow-auto bg-[#e8ece8] p-5 lg:p-7">
                  <div
                    className={cn(
                      "relative w-full max-w-[1120px] overflow-hidden rounded-sm bg-white shadow-[0_12px_40px_rgba(30,42,33,0.16)]",
                      markMode && "cursor-crosshair select-none",
                    )}
                    style={{ aspectRatio: `${currentPage.width} / ${currentPage.height}` }}
                    onPointerDown={startMark}
                    onPointerMove={moveMark}
                    onPointerUp={finishMark}
                    onPointerCancel={finishMark}
                  >
                    {/* PDF preview generated locally in the browser. */}
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={currentPage.imageDataUrl}
                      alt={`Planseite ${currentPage.pageNumber}`}
                      draggable={false}
                      className="absolute inset-0 h-full w-full object-fill"
                    />

                    {areas
                      .filter((area) => area.pageNumber === activePage && area.status !== "rejected" && area.hasBbox)
                      .map((area) => {
                        const active = selectedAreaId === area.id;
                        return (
                          <button
                            key={area.id}
                            type="button"
                            disabled={markMode}
                            onClick={(event) => {
                              event.stopPropagation();
                              setSelectedAreaId(area.id);
                            }}
                            className={cn(
                              "absolute border-2 text-left transition",
                              active
                                ? "border-[#0f6b39] bg-[#1e8e4b]/20 shadow-[0_0_0_2px_rgba(255,255,255,0.75)]"
                                : area.source === "manual"
                                  ? "border-sky-500 bg-sky-300/15 hover:bg-sky-300/25"
                                  : "border-amber-500 bg-amber-300/15 hover:bg-amber-300/25",
                            )}
                            style={{
                              left: `${area.bbox.x * 100}%`,
                              top: `${area.bbox.y * 100}%`,
                              width: `${area.bbox.width * 100}%`,
                              height: `${area.bbox.height * 100}%`,
                            }}
                          >
                            <span className="absolute -top-6 left-[-2px] whitespace-nowrap rounded bg-[#18231c]/90 px-1.5 py-0.5 text-[10px] font-bold text-white">
                              {AREA_RULES[area.kind].title}
                            </span>
                          </button>
                        );
                      })}

                    {draftBox && (
                      <div
                        className="pointer-events-none absolute border-2 border-dashed border-[#17633a] bg-[#17633a]/15"
                        style={{
                          left: `${draftBox.x * 100}%`,
                          top: `${draftBox.y * 100}%`,
                          width: `${draftBox.width * 100}%`,
                          height: `${draftBox.height * 100}%`,
                        }}
                      />
                    )}
                  </div>
                </div>

                <div className="flex items-center justify-between gap-4 border-t border-[#dce3dd] bg-white px-5 py-2.5 text-[11px] text-[#6e7971]">
                  <div className="flex items-center gap-4">
                    <span className="flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-sm border border-amber-500 bg-amber-200/70" /> KI-Vorschlag</span>
                    <span className="flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-sm border border-sky-500 bg-sky-200/70" /> manuell</span>
                  </div>
                  <span>{Math.round(currentPage.width)} × {Math.round(currentPage.height)} pt</span>
                </div>
              </div>

              <aside className="scrollbar-thin w-full shrink-0 overflow-y-auto bg-white 2xl:max-h-[calc(100vh-114px)] 2xl:w-[430px]">
                {workflowStep === 2 && (
                  <div className="p-5 lg:p-6">
                    <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-[#eaf4ed] text-[#17633a]">
                      <FileSearch size={22} />
                    </div>
                    <h2 className="mt-4 text-xl font-extrabold tracking-[-0.02em]">Deterministische Voranalyse fertig</h2>
                    <p className="mt-2 text-sm leading-6 text-[#6a766e]">
                      Der Browser hat das PDF bereits gerendert und Text sowie eindeutig geschriebene Maße ausgelesen. Erst jetzt kommt Vision hinzu.
                    </p>

                    <div className="mt-5 grid grid-cols-2 gap-3">
                      <Metric label="Seiten" value={String(pages.length)} />
                      <Metric label="PDF-Text" value={`${pages.reduce((sum, page) => sum + page.text.length, 0).toLocaleString("de-DE")} Zeichen`} />
                      <Metric label="Maßkandidaten" value={String(measurements.length)} />
                      <Metric label="Fachbegriffe" value={String(terms.length)} />
                    </div>

                    {terms.length > 0 && (
                      <div className="mt-5 rounded-xl border border-[#dce4dd] bg-[#f7f9f7] p-4">
                        <div className="text-xs font-bold text-[#364139]">Gefundene Begriffe</div>
                        <div className="mt-2 flex flex-wrap gap-1.5">
                          {terms.slice(0, 16).map((item, index) => (
                            <Badge key={`${item.term}-${item.pageNumber}-${index}`} className="border-slate-200 bg-white text-slate-700">
                              {item.term} · S. {item.pageNumber}
                            </Badge>
                          ))}
                        </div>
                      </div>
                    )}

                    <div className="mt-6 rounded-xl border border-violet-200 bg-violet-50 p-4">
                      <div className="flex items-center gap-2 text-sm font-bold text-violet-900">
                        <Sparkles size={16} /> KI-Schritt
                      </div>
                      <p className="mt-2 text-xs leading-5 text-violet-800/80">
                        GPT analysiert Seitenbilder plus bereits extrahierten Text und gibt ausschließlich strukturierte Bereichs- und Maßvorschläge zurück. Keine Produktauswahl.
                      </p>
                    </div>

                    <Button className="mt-5 w-full" disabled={busy === "analyzing"} onClick={runAnalysis}>
                      {busy === "analyzing" ? <LoaderCircle size={16} className="animate-spin" /> : <Bot size={16} />}
                      {busy === "analyzing" ? "Plan wird semantisch analysiert …" : "KI-Analyse starten"}
                    </Button>
                  </div>
                )}

                {workflowStep === 3 && analysis && (
                  <div className="p-5 lg:p-6">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <Badge className="border-violet-200 bg-violet-50 text-violet-700">{areas.length} Bereichsvorschläge</Badge>
                        <h2 className="mt-3 text-xl font-extrabold tracking-[-0.02em]">Bereiche bestätigen</h2>
                      </div>
                      <Button variant="secondary" className="h-8" onClick={() => setMarkMode(true)}>
                        <Plus size={14} /> Manuell
                      </Button>
                    </div>
                    <p className="mt-2 text-sm leading-6 text-[#6a766e]">{analysis.documentSummary}</p>

                    {analysis.warnings.length > 0 && (
                      <div className="mt-4 space-y-2">
                        {analysis.warnings.map((warning) => (
                          <div key={warning} className="flex gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs leading-5 text-amber-900">
                            <AlertTriangle size={14} className="mt-0.5 shrink-0" /> {warning}
                          </div>
                        ))}
                      </div>
                    )}

                    <div className="mt-5 space-y-3">
                      {areas.length === 0 && (
                        <div className="rounded-xl border border-dashed border-[#cdd8cf] bg-[#f9fbf9] p-5 text-center text-sm text-[#6f7a72]">
                          Keine belastbaren Bereiche erkannt. Nutze „Bereich markieren“ direkt im Plan.
                        </div>
                      )}
                      {areas.map((area) => (
                        <AreaReviewCard
                          key={area.id}
                          area={area}
                          selected={selectedAreaId === area.id}
                          onSelect={() => {
                            setSelectedAreaId(area.id);
                            setActivePage(area.pageNumber);
                          }}
                          onChange={(patch) => updateArea(area.id, patch)}
                          onDelete={() => {
                            setAreas((current) => current.filter((item) => item.id !== area.id));
                            if (selectedAreaId === area.id) setSelectedAreaId(null);
                          }}
                        />
                      ))}
                    </div>

                    {selectedArea && selectedArea.status !== "rejected" && (
                      <div className="mt-5 rounded-xl border border-[#dbe3dc] bg-[#f7faf7] p-4">
                        <div className="text-xs font-bold text-[#39463d]">PATURA-Fachlogik für {AREA_RULES[selectedArea.kind].title}</div>
                        <div className="mt-3 text-[11px] font-bold uppercase tracking-wide text-[#849087]">Relevante Systeme</div>
                        <div className="mt-1.5 flex flex-wrap gap-1.5">
                          {AREA_RULES[selectedArea.kind].products.length ? (
                            AREA_RULES[selectedArea.kind].products.map((product) => (
                              <Badge key={product} className="border-[#cfe0d3] bg-white text-[#3f5c48]">{product}</Badge>
                            ))
                          ) : (
                            <span className="text-xs text-[#7c867e]">Erst nach Klassifizierung verfügbar.</span>
                          )}
                        </div>
                      </div>
                    )}

                    <Button
                      className="mt-5 w-full"
                      disabled={!confirmedAreas.length}
                      onClick={() => setWorkflowStep(4)}
                    >
                      Weiter zu Fragen & Maßen <ArrowRight size={16} />
                    </Button>
                  </div>
                )}

                {workflowStep === 4 && analysis && (
                  <div className="p-5 lg:p-6">
                    <Badge className="border-emerald-200 bg-emerald-50 text-emerald-800">{confirmedAreas.length} bestätigte Bereiche</Badge>
                    <h2 className="mt-3 text-xl font-extrabold tracking-[-0.02em]">Fachfragen & Maße</h2>
                    <p className="mt-2 text-sm leading-6 text-[#6a766e]">
                      Fragen werden ausschließlich aus der Regelbasis des bestätigten Bereichstyps erzeugt.
                    </p>

                    <div className="mt-5 space-y-4">
                      {confirmedAreas.map((area) => (
                        <QuestionPanel
                          key={area.id}
                          area={area}
                          answers={answers[area.id] ?? {}}
                          onAnswer={(questionId, value) => setAnswer(area.id, questionId, value)}
                        />
                      ))}
                    </div>

                    <div className="mt-7 flex items-center justify-between">
                      <div>
                        <h3 className="text-sm font-extrabold">Erkannte Maße</h3>
                        <p className="mt-1 text-xs text-[#79847c]">Quelle und Bestätigung bleiben separat erhalten.</p>
                      </div>
                      <Badge className="border-slate-200 bg-slate-50 text-slate-700">{measurements.length}</Badge>
                    </div>

                    <div className="mt-3 space-y-2.5">
                      {measurements.length === 0 && (
                        <div className="rounded-xl border border-dashed border-[#d5ddd6] p-4 text-xs text-[#78837b]">
                          Keine eindeutigen Maße erkannt. Fehlende Maße können später als Kundenangabe ergänzt werden.
                        </div>
                      )}
                      {measurements.map((measurement) => (
                        <MeasurementRow key={measurement.id} measurement={measurement} onChange={(patch) => updateMeasurement(measurement.id, patch)} />
                      ))}
                    </div>

                    <Button className="mt-6 w-full" onClick={() => setWorkflowStep(5)}>
                      Planungsdatensatz erstellen <ArrowRight size={16} />
                    </Button>
                  </div>
                )}

                {workflowStep === 5 && handoff && (
                  <div className="p-5 lg:p-6">
                    <Badge className="border-emerald-200 bg-emerald-50 text-emerald-800"><CheckCircle2 size={12} className="mr-1" /> Übergabebereit</Badge>
                    <h2 className="mt-3 text-xl font-extrabold tracking-[-0.02em]">Strukturierte Planungsanfrage</h2>
                    <p className="mt-2 text-sm leading-6 text-[#6a766e]">
                      Das Ergebnis enthält nur bestätigte Bereiche; erkannte Maße bleiben inklusive Quelle und Status vollständig nachvollziehbar.
                    </p>

                    <div className="mt-5 grid grid-cols-2 gap-3">
                      <Metric label="Bestätigte Bereiche" value={String(handoff.audit.confirmedAreaCount)} />
                      <Metric label="Bestätigte Maße" value={String(handoff.audit.confirmedMeasurementCount)} />
                    </div>

                    <div className="mt-5 flex gap-2">
                      <Button className="flex-1" onClick={downloadHandoff}><Download size={15} /> JSON herunterladen</Button>
                      <Button variant="secondary" onClick={copyHandoff}>{copied ? <Check size={15} /> : <Clipboard size={15} />}</Button>
                    </div>

                    <div className="mt-5 overflow-hidden rounded-xl border border-[#d6dfd8] bg-[#172019]">
                      <div className="flex items-center justify-between border-b border-white/10 px-3 py-2 text-[11px] font-bold text-white/60">
                        <span>planning-request.json</span>
                        <span>Schema v{handoff.schemaVersion}</span>
                      </div>
                      <pre className="scrollbar-thin max-h-[520px] overflow-auto p-3 text-[10px] leading-4 text-[#d9e7dc]">
                        {JSON.stringify(handoff, null, 2)}
                      </pre>
                    </div>

                    <div className="mt-5 rounded-xl border border-[#cfe0d3] bg-[#eef7f0] p-4 text-xs leading-5 text-[#355841]">
                      <strong>Nächster Integrationspunkt:</strong> Dieses Objekt kann direkt an ein internes Stallplanungs-Backend, CRM oder einen späteren Dataset-Builder für historische Kundenplan/PATURA-Plan-Paare übergeben werden.
                    </div>
                  </div>
                )}
              </aside>
            </div>
          )}
        </section>
      </div>
    </main>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-[#dfe6e0] bg-[#f9fbf9] p-3.5">
      <div className="text-[10px] font-bold uppercase tracking-[0.08em] text-[#849087]">{label}</div>
      <div className="mt-1.5 text-base font-extrabold tracking-[-0.02em] text-[#263129]">{value}</div>
    </div>
  );
}

function AreaReviewCard({
  area,
  selected,
  onSelect,
  onChange,
  onDelete,
}: {
  area: DetectedArea;
  selected: boolean;
  onSelect: () => void;
  onChange: (patch: Partial<DetectedArea>) => void;
  onDelete: () => void;
}) {
  return (
    <div className={cn("rounded-xl border p-3.5 transition", selected ? "border-[#8bb298] bg-[#f6faf7] ring-1 ring-[#cbe0d1]" : "border-[#dce3dd] bg-white")}>
      <button type="button" onClick={onSelect} className="w-full text-left">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="truncate text-sm font-extrabold text-[#28332b]">{area.label}</div>
            <div className="mt-1 flex flex-wrap gap-1.5">
              <Badge className={sourceTone(area.source)}>{sourceLabel(area.source)}</Badge>
              <Badge className={statusTone(area.status)}>{area.status === "confirmed" ? "bestätigt" : area.status === "rejected" ? "verworfen" : "offen"}</Badge>
              <Badge className="border-slate-200 bg-slate-50 text-slate-600">S. {area.pageNumber}</Badge>
            </div>
          </div>
          {area.confidence !== null && <span className="text-xs font-bold text-[#707c74]">{confidenceLabel(area.confidence)}</span>}
        </div>
      </button>

      <select
        value={area.kind}
        onChange={(event) => {
          const kind = event.target.value as AreaType;
          onChange({ kind, label: AREA_RULES[kind].title });
        }}
        className="mt-3 h-9 w-full rounded-lg border border-[#d5ddd6] bg-white px-2.5 text-xs font-semibold outline-none focus:border-[#75a383]"
      >
        {areaTypeOptions.map((option) => (
          <option key={option.value} value={option.value}>{option.label}</option>
        ))}
      </select>

      {area.evidence.length > 0 && (
        <p className="mt-2 line-clamp-2 text-[11px] leading-4 text-[#778279]">{area.evidence.join(" · ")}</p>
      )}

      <div className="mt-3 flex gap-2">
        <Button
          variant={area.status === "confirmed" ? "primary" : "secondary"}
          className="h-8 flex-1 text-xs"
          onClick={() => onChange({ status: "confirmed" })}
        >
          <Check size={13} /> Bestätigen
        </Button>
        <Button
          variant={area.status === "rejected" ? "danger" : "secondary"}
          className="h-8 px-2.5"
          onClick={() => onChange({ status: "rejected" })}
        >
          <X size={13} />
        </Button>
        {area.source === "manual" && (
          <Button variant="ghost" className="h-8 px-2.5" onClick={onDelete}><Trash2 size={13} /></Button>
        )}
      </div>
    </div>
  );
}

function QuestionPanel({
  area,
  answers,
  onAnswer,
}: {
  area: DetectedArea;
  answers: Record<string, AnswerValue>;
  onAnswer: (questionId: string, value: AnswerValue) => void;
}) {
  const rule = AREA_RULES[area.kind];
  return (
    <section className="rounded-xl border border-[#dce3dd] bg-[#fbfcfb] p-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="text-sm font-extrabold text-[#28332b]">{rule.title}</div>
          <div className="mt-0.5 text-[11px] text-[#7a857d]">Seite {area.pageNumber} · {area.label}</div>
        </div>
        <Badge className="border-[#cfe0d3] bg-[#edf6ef] text-[#3d6849]">{rule.questions.length} Fragen</Badge>
      </div>

      <div className="mt-4 space-y-3.5">
        {rule.questions.map((question) => (
          <label key={question.id} className="block">
            <span className="flex items-center gap-1 text-xs font-bold text-[#465149]">
              {question.label}
              {question.required && <span className="text-red-500">*</span>}
              {question.unit && <span className="font-normal text-[#8a948d]">({question.unit})</span>}
            </span>
            {question.help && <span className="mt-1 block text-[11px] text-[#828d85]">{question.help}</span>}

            {question.type === "select" && (
              <select
                value={String(answers[question.id] ?? "")}
                onChange={(event) => onAnswer(question.id, event.target.value)}
                className="mt-1.5 h-9 w-full rounded-lg border border-[#d5ddd6] bg-white px-2.5 text-xs outline-none focus:border-[#75a383]"
              >
                <option value="">Bitte wählen</option>
                {question.options?.map((option) => <option key={option} value={option}>{option}</option>)}
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
                      "h-9 rounded-lg border text-xs font-bold transition",
                      answers[question.id] === value
                        ? "border-[#17633a] bg-[#eaf5ed] text-[#17633a]"
                        : "border-[#d5ddd6] bg-white text-[#647068] hover:bg-[#f5f8f5]",
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
                  onAnswer(question.id, question.type === "number" && event.target.value !== "" ? Number(event.target.value) : event.target.value)
                }
                className="mt-1.5 h-9 w-full rounded-lg border border-[#d5ddd6] bg-white px-2.5 text-xs outline-none focus:border-[#75a383]"
                placeholder={question.type === "number" ? "0" : "Angabe eintragen"}
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
  onChange,
}: {
  measurement: Measurement;
  onChange: (patch: Partial<Measurement>) => void;
}) {
  return (
    <div className="rounded-xl border border-[#dce3dd] bg-white p-3.5">
      <div className="flex items-start justify-between gap-2">
        <div>
          <div className="text-xs font-bold text-[#3e4942]">{measurement.label}</div>
          <div className="mt-1 flex gap-1.5">
            <Badge className={sourceTone(measurement.source)}>{sourceLabel(measurement.source)}</Badge>
            <Badge className={statusTone(measurement.status)}>{measurement.status === "confirmed" ? "bestätigt" : "offen"}</Badge>
            {measurement.pageNumber && <Badge className="border-slate-200 bg-slate-50 text-slate-600">S. {measurement.pageNumber}</Badge>}
          </div>
        </div>
        {measurement.confidence !== null && measurement.source === "ai" && (
          <span className="text-[11px] font-bold text-[#7a857d]">{confidenceLabel(measurement.confidence)}</span>
        )}
      </div>

      <div className="mt-3 flex items-center gap-2">
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
          className="h-9 min-w-0 flex-1 rounded-lg border border-[#d5ddd6] px-2.5 text-sm font-bold outline-none focus:border-[#75a383]"
        />
        <select
          value={measurement.unit}
          onChange={(event) => onChange({ unit: event.target.value as Measurement["unit"], source: "customer", status: "confirmed", confidence: null })}
          className="h-9 rounded-lg border border-[#d5ddd6] bg-white px-2 text-xs font-bold outline-none focus:border-[#75a383]"
        >
          <option value="m">m</option>
          <option value="cm">cm</option>
          <option value="mm">mm</option>
        </select>
        <Button
          variant={measurement.status === "confirmed" ? "primary" : "secondary"}
          className="h-9 px-2.5"
          onClick={() => onChange({ status: measurement.status === "confirmed" ? "unconfirmed" : "confirmed" })}
        >
          <Check size={14} />
        </Button>
      </div>
      {measurement.evidence && <div className="mt-2 line-clamp-2 text-[10px] leading-4 text-[#8a948d]">{measurement.evidence}</div>}
    </div>
  );
}
