import type OpenAI from "openai";
import { z } from "zod";
import { AREA_TYPES, type DetectedArea, type PdfPageData } from "../types";
import { bboxSchema } from "../plan/request";
import { areaTextContext, imagePages, withPageImages } from "./context";
import { withModelFallback } from "./client";

export const areaPayloadSchema = z.object({
  documentSummary: z.string().max(2_000), warnings: z.array(z.string()).max(40),
  areas: z.array(z.object({
    kind: z.enum(AREA_TYPES), label: z.string().max(240), confidence: z.number().min(0).max(1),
    pageNumber: z.number().int().positive(), hasBbox: z.boolean(), bbox: bboxSchema, evidence: z.array(z.string()).max(20),
  })).max(100),
});

export function validateSemanticAreas(input: unknown, pages: PdfPageData[]): { documentSummary: string; warnings: string[]; areas: DetectedArea[] } {
  const envelopeSchema = areaPayloadSchema.omit({ areas: true }).extend({ areas: z.array(z.unknown()).max(100) });
  const payload = envelopeSchema.parse(input);
  const parsedAreas = payload.areas.flatMap((item) => {
    const parsed = areaPayloadSchema.shape.areas.element.safeParse(item);
    return parsed.success ? [parsed.data] : [];
  });
  const pageNumbers = new Set(imagePages(pages).map((page) => page.pageNumber));
  const valid = parsedAreas.filter((area) => pageNumbers.has(area.pageNumber) && area.hasBbox && area.bbox.width > 0 && area.bbox.height > 0 && area.evidence.length > 0);
  const warnings = [...payload.warnings];
  if (valid.length < payload.areas.length) warnings.push("Bereiche ohne gültige Planposition wurden verworfen.");
  return {
    documentSummary: payload.documentSummary, warnings,
    areas: valid.map((area) => ({ ...area, id: crypto.randomUUID(), source: "ai", status: "unconfirmed" })),
  };
}

export async function analyzeSemanticAreas(client: OpenAI, model: string, fileName: string, pages: PdfPageData[]) {
  const prompt = `Untersuche den Stallplan ${JSON.stringify(fileName)} ausschließlich auf funktionale Bereiche.
Zulässig: feeding_area, cubicles, alley, calving, gate, unknown.
Erkenne vollständige zusammenhängende Nutzungsbereiche. Verwende Beschriftungen, Stallgeometrie und wiederkehrende Einrichtungen.
Bounding-Boxen müssen die echten Bereiche umschließen (0..1, Ursprung links oben), nicht nur Beschriftungen oder Raumtabellen.
Bei komplexen Bereichen mit Aussparungen beschreibe die geometrische Unsicherheit und senke die Confidence.
Keine Maße, Produkte, Fachfragen oder Planung erzeugen. Fehlende Daten nicht ergänzen. DJP ist Vieheinheit, keine wörtliche Kopfzahl.
Wenn Geometrie nicht belastbar bestimmbar ist: hasBbox=false. Jede Entscheidung benötigt konkrete Dokumentevidenz.
Bekannte polnische Beschriftungen: korytarz paszowy=Futtergang; legowiska=Liegeboxen; komunikacja=Laufgang; porodówka=Abkalbung. WC, Büro und Melkhalle nicht als Liegeboxen klassifizieren.
PDF-TEXTOBJEKTE (direkt ausgelesen, nicht neu schätzen):
${areaTextContext(pages)}`;
  const run = await withModelFallback(model, async (selectedModel) => {
    const response = await client.responses.create({
      model: selectedModel,
      max_output_tokens: 4_500,
      ...(selectedModel.startsWith("gpt-6") ? { reasoning: { effort: "low" as const } } : {}),
      input: [{ role: "system", content: "Klassifiziere funktionale Stallbereiche anhand belastbarer Dokumentevidenz." }, { role: "user", content: withPageImages(prompt, pages) }],
      text: { format: { type: "json_schema", name: "stallplan_areas", strict: true, schema: z.toJSONSchema(areaPayloadSchema) } },
    });
    if (!response.output_text) throw new Error("empty_area_result");
    return { ...validateSemanticAreas(JSON.parse(response.output_text), pages), actualModel: response.model };
  });
  return { ...run, model: run.result.actualModel };
}
