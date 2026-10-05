import { detectStructuralAreas, mergeDetectedAreas } from "./areas";
import { extractDeterministicMeasurements } from "../deterministic";
import { analyzeSemanticAreas } from "../ai/areas";
import { analyzeRasterMeasurements, selectRasterMeasurementPages } from "../ai/measurements";
import { createAnalysisClient, DEFAULT_MODEL } from "../ai/client";
import { imagePages } from "../ai/context";
import { detectProjectFacts, reconcileProjectFacts } from "./project-facts";
import { refineAreaBoundaries } from "../geometry/area-boundaries";
import type { AnalysisRequest } from "../plan/request";

interface PipelineOptions { apiKey?: string; model?: string }
export interface AnalysisRunners {
  areas: typeof analyzeSemanticAreas;
  measurements: typeof analyzeRasterMeasurements;
}

function reportStepFailure(step: string, error: unknown) {
  const details = error && typeof error === "object" ? error as { code?: unknown; status?: unknown; name?: unknown } : {};
  console.warn(`Plan analysis step failed: ${step}`, { name: details.name, code: details.code, status: details.status });
}

/** Independent steps preserve structural results and each successful semantic result. */
export async function analyzePlan(payload: AnalysisRequest, options: PipelineOptions = {}, runners: AnalysisRunners = { areas: analyzeSemanticAreas, measurements: analyzeRasterMeasurements }) {
  const structuralAreas = detectStructuralAreas(payload.pages);
  const structuralMeasurements = extractDeterministicMeasurements(payload.pages);
  const result = {
    model: "none", actualModels: {} as { areas?: string; measurements?: string },
    documentSummary: `${payload.pages.length} ${payload.pages.length === 1 ? "Seite" : "Seiten"} · ${structuralMeasurements.length} Maße`,
    warnings: [] as string[], areas: structuralAreas, measurements: [...structuralMeasurements],
    projectFacts: detectProjectFacts(payload.pages, structuralAreas),
    originalAnalysis: undefined as { documentSummary: string; warnings: string[] } | undefined,
  };
  if (!options.apiKey) {
    result.warnings.push("KI nicht verfügbar. PDF-Analyse bleibt nutzbar.");
    return result;
  }
  const client = createAnalysisClient(options.apiKey);
  const model = options.model?.trim() || DEFAULT_MODEL;
  const rasterPages = selectRasterMeasurementPages(payload.pages, structuralMeasurements);
  const [areas, measurements] = await Promise.allSettled([
    imagePages(payload.pages).length ? runners.areas(client, model, payload.fileName, payload.pages) : Promise.resolve(null),
    rasterPages.length ? runners.measurements(client, model, payload.fileName, rasterPages) : Promise.resolve(null),
  ]);
  if (areas.status === "fulfilled" && areas.value) {
    result.areas = mergeDetectedAreas(structuralAreas, areas.value.result.areas.map((area) => refineAreaBoundaries(area, payload.pages)));
    result.documentSummary = `${payload.pages.length} ${payload.pages.length === 1 ? "Seite" : "Seiten"} · ${result.areas.length} Bereiche · ${result.measurements.length} Maße`;
    result.originalAnalysis = areas.value.result.originalAnalysis;
    result.projectFacts = reconcileProjectFacts(payload.pages, result.areas, areas.value.result.projectFacts ?? {});
    result.warnings.push(...areas.value.result.warnings);
    result.actualModels.areas = areas.value.model;
    if (areas.value.fallback) result.warnings.push("Bereichsanalyse mit Ersatzmodell ausgeführt.");
  } else if (areas.status === "rejected") {
    reportStepFailure("areas", areas.reason);
    result.warnings.push("Bereichserkennung nicht vollständig. PDF-Analyse bleibt nutzbar.");
  }
  if (measurements.status === "fulfilled" && measurements.value) {
    result.measurements.push(...measurements.value.result.measurements);
    result.warnings.push(...measurements.value.result.warnings);
    result.actualModels.measurements = measurements.value.model;
    if (measurements.value.fallback) result.warnings.push("Rastermaße mit Ersatzmodell geprüft.");
  } else if (measurements.status === "rejected") {
    reportStepFailure("raster-measurements", measurements.reason);
    result.warnings.push("Rastermaße nicht vollständig erkannt. PDF-Maße bleiben nutzbar.");
  }
  const visualCount = imagePages(payload.pages).length;
  if (payload.pages.length > visualCount) result.warnings.push(`Bereiche visuell auf ${visualCount} von ${payload.pages.length} Seiten geprüft.`);
  const rasterCount = payload.pages.filter((page) => page.imageDataUrl && (page.documentKind === "raster" || (page.documentKind === "mixed" && !structuralMeasurements.some((measurement) => measurement.pageNumber === page.pageNumber && measurement.dimensionLine && measurement.sources?.includes("geometry"))))).length;
  if (rasterCount > rasterPages.length) result.warnings.push(`Rastermaße auf ${rasterPages.length} von ${rasterCount} Seiten geprüft.`);
  const models = Object.values(result.actualModels);
  result.documentSummary = `${payload.pages.length} ${payload.pages.length === 1 ? "Seite" : "Seiten"} · ${result.areas.length} Bereiche · ${result.measurements.length} Maße`;
  result.model = models.length === 0 ? "none" : [...new Set(models)].join("; ");
  result.warnings = [...new Set(result.warnings)];
  return result;
}
