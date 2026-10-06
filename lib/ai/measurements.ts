import type OpenAI from "openai";
import { z } from "zod";
import type { Measurement, PdfPageData } from "../types";
import { bboxSchema } from "../plan/request";
import { positionedTextContext, withPageImages } from "./context";
import { withModelFallback } from "./client";
import { recordAnalysisUsage } from "./usage";
import { extractDeterministicMeasurements } from "../deterministic";
import { hasLocatedDimensionInk } from "../geometry/text-ink";

const unitSchema = z.enum(["m", "cm", "mm", "unknown"]);
export const measurementPayloadSchema = z.object({
  unitBasis: z.object({ unit: unitSchema, confidence: z.number().min(0).max(1), evidence: z.string() }),
  warnings: z.array(z.string()).max(40),
  measurements: z.array(z.object({
    key: z.string(), label: z.string(), value: z.number().positive(), unit: unitSchema,
    confidence: z.number().min(0).max(1), pageNumber: z.number().int().positive(),
    hasBbox: z.boolean(), bbox: bboxSchema, evidence: z.string(),
  })).max(200),
});

const nativeDimensionNumber = /^\d{1,6}(?:[.,]\d{1,3})?(?:\s+\d{1,6}(?:[.,]\d{1,3})?)*(?:\s*(?:mm|cm|m))?$/i;

/** Only supplement pages whose dimension texts are unavailable as native text.
 * Outlined CAD glyphs are vector ink, so a page need not contain a raster image
 * to require image reading. Existing native numeric drawing text takes priority.
 */
export function selectRasterMeasurementPages(pages: PdfPageData[], structuralMeasurements = extractDeterministicMeasurements(pages)): PdfPageData[] {
  return pages.filter((page) => {
    if (!page.imageDataUrl) return false;
    if (page.documentKind === "raster") return true;
    const pageMeasurements = structuralMeasurements.filter((measurement) => measurement.pageNumber === page.pageNumber);
    if (page.documentKind === "mixed") return !pageMeasurements.some((measurement) => measurement.dimensionLine && measurement.sources?.includes("geometry"));
    // Conservative vector fallback: enough ink for an actual drawing, no
    // extracted measures, and no available numeric dimension text to re-read.
    return page.documentKind === "vector" && (page.lines?.length ?? 0) >= 1_000 && pageMeasurements.length === 0
      && !page.textItems.some((item) => nativeDimensionNumber.test(item.text.trim()));
  }).slice(0, 4);
}

export function validateRasterMeasurements(input: unknown, pages: PdfPageData[]): { warnings: string[]; measurements: Measurement[] } {
  const envelopeSchema = measurementPayloadSchema.omit({ measurements: true }).extend({ measurements: z.array(z.unknown()).max(200) });
  const payload = envelopeSchema.parse(input);
  const parsedMeasurements = payload.measurements.flatMap((item) => {
    const parsed = measurementPayloadSchema.shape.measurements.element.safeParse(item);
    return parsed.success ? [parsed.data] : [];
  });
  const allowedPages = new Set(selectRasterMeasurementPages(pages).map((page) => page.pageNumber));
  const valid = parsedMeasurements.filter((measurement) => allowedPages.has(measurement.pageNumber)
    && measurement.hasBbox && measurement.bbox.width > 0 && measurement.bbox.height > 0 && measurement.evidence.trim().length > 0
    && hasLocatedDimensionInk(pages.find((page) => page.pageNumber === measurement.pageNumber)!, measurement.bbox)
    && !/(?:\bDJP\b|\bszt\b|\bm(?:[²³]|[23]\b)|\bm\s*\^\s*[23]\b|\b(?:volumen|volume|flache|fläche|tieranzahl|hohenkote|höhenkote|elevation|zeichnung(?:snummer)?|raum(?:nummer)?|achsnummer|datum|date|maßstab|massstab)\b|n\.?\s*p\.?\s*m\.?|m\s*[üu]\.?\s*(?:nn|nhn)\b|1\s*:\s*\d+)/i.test(`${measurement.label} ${measurement.evidence}`)
    && !pages.find((page) => page.pageNumber === measurement.pageNumber)?.textItems.some((item) => {
      // Numeric PDF objects include combined dimension chains and identifiers.
      // None of their existing values/coordinates may be replaced by vision.
      if (!/\d/.test(item.text)) return false;
      const intersection = Math.max(0, Math.min(item.bbox.x + item.bbox.width, measurement.bbox.x + measurement.bbox.width) - Math.max(item.bbox.x, measurement.bbox.x))
        * Math.max(0, Math.min(item.bbox.y + item.bbox.height, measurement.bbox.y + measurement.bbox.height) - Math.max(item.bbox.y, measurement.bbox.y));
      const smallerArea = Math.min(item.bbox.width * item.bbox.height, measurement.bbox.width * measurement.bbox.height);
      return smallerArea > 0 && intersection / smallerArea >= 0.5;
    }));
  const warnings = payload.warnings.length ? ["Einzelne Bildmaße sind unsicher. Die Fachplanung prüft diese Werte."] : [];
  if (valid.length < payload.measurements.length) warnings.push("Nichtlineare oder nicht ausreichend lokalisierbare Maßvorschläge wurden verworfen.");
  return {
    warnings,
    measurements: valid.map((measurement) => {
      const unit = payload.unitBasis.unit === "unknown" || payload.unitBasis.confidence < 0.8 ? "unknown" : measurement.unit;
      return {
        id: crypto.randomUUID(), key: measurement.key, label: "Planmaß", value: measurement.value, unit,
        source: "ai", sources: ["vision"], status: "unconfirmed", confidence: Math.min(measurement.confidence, unit === "unknown" ? 0.69 : payload.unitBasis.confidence),
        pageNumber: measurement.pageNumber, bbox: measurement.bbox, evidence: "Schriftlicher Maßwert aus dem Planbild; Position und Einheit bitte prüfen.", originalEvidence: measurement.evidence,
        originalUnitInference: payload.unitBasis,
        unitInference: { ...payload.unitBasis, evidence: payload.unitBasis.unit === "unknown" || payload.unitBasis.confidence < 0.8
          ? "Einheit im Plan nicht ausreichend belegt." : "Einheit anhand der Zeichnungsangaben im Plan erkannt." },
      };
    }),
  };
}

export async function analyzeRasterMeasurements(client: OpenAI, model: string, fileName: string, pages: PdfPageData[]) {
  const selectedPages = selectRasterMeasurementPages(pages);
  const prompt = `Extrahiere aus den ausgewählten Planbildern des technischen Plans ${JSON.stringify(fileName)} ausschließlich schriftliche lineare Maßwerte.
Die gesamte Ausgabe ist immer Deutsch, auch bei fremdsprachigen Plänen. Originaltext ausschließlich als deutlich gekennzeichnetes Dokumentzitat in evidence.
Dies ist die ergänzende Bildanalyse für Scans sowie Misch- und Vektorseiten, deren Maßziffern als Vektorpfade statt als PDF-Text vorliegen. Vorhandene Zahlen und Koordinaten aus PDF-Text niemals ersetzen.
Zahlen mit vorhandenen PDF-Textkoordinaten niemals aus dem Bild neu lesen. Diese werden separat direkt aus dem PDF übernommen. Nur zusätzliche schriftliche Maßtexte ohne entsprechendes PDF-Textobjekt extrahieren.
Lies Maßtexte mit ihren Positionen. Niemals Längen aus Pixelabständen schätzen. Unklare Ziffern weglassen.
Prüfe Einheiten separat. Teilmaß+Gesamtmaß belegen eine Kette, aber allein keine Einheit. Nur Titelblock/eindeutige Einheit/maßstäblich konsistente Evidenz kann eine Einheit begründen. Wenn der Titelblock mehrere mögliche Einheiten nennt (z. B. Meter ODER Zentimeter), ist dies keine eindeutige globale Einheit: unitBasis=unknown.
Wenn die Einheit nicht sicher ist: unknown, Zahl unverändert. Keine Umrechnung oder blindes Raten.
Keine Tierzahlen (DJP), Raum-/Positions-/Achsnummern, Datumswerte, Zeichnungsnummern, Höhenkoten, Flächen oder Volumen. 1:100 ist Maßstab, kein Maß. 0,00=136,6m n.p.m. ist Höhe, keine Länge.
Bounding-Box markiert ausschließlich den Maßtext (0..1, Ursprung links oben). Nur sichtbare Werte mit konkreter Evidenz ausgeben; label=Planmaß, wenn die Bauteilzuordnung unklar ist.
Vorhandener PDF-Text:
${positionedTextContext(selectedPages)}`;
  const run = await withModelFallback(model, async (selectedModel) => {
    const started = performance.now();
    const response = await client.responses.create({
      model: selectedModel,
      max_output_tokens: 6_000,
      ...(selectedModel.startsWith("gpt-6") ? { reasoning: { effort: "low" as const } } : {}),
      input: [{ role: "system", content: "Extrahiere belegte schriftliche lineare Bemaßungen aus Planbildern konservativ." }, { role: "user", content: withPageImages(prompt, selectedPages) }],
      text: { format: { type: "json_schema", name: "stallplan_raster_measurements", strict: true, schema: z.toJSONSchema(measurementPayloadSchema) } },
    });
    if (!response.output_text) throw new Error("empty_measurement_result");
    const usage = recordAnalysisUsage("measurements", response, performance.now() - started);
    return { ...validateRasterMeasurements(JSON.parse(response.output_text), selectedPages), actualModel: response.model,
      ...(usage ? { usage } : {}) };
  });
  return { ...run, model: run.result.actualModel };
}
