import type OpenAI from "openai";
import { z } from "zod";
import { AREA_TYPES, type DetectedArea, type PdfPageData } from "../types";
import { bboxSchema } from "../plan/request";
import { classifyUnambiguousAreaLabel } from "../analysis/areas";
import { areaTextContext, imagePages, withPageImages } from "./context";
import { withModelFallback } from "./client";

export const areaPayloadSchema = z.object({
  documentSummary: z.string().max(2_000), warnings: z.array(z.string()).max(40),
  areas: z.array(z.object({
    kind: z.enum(AREA_TYPES), label: z.string().max(240), confidence: z.number().min(0).max(1),
    pageNumber: z.number().int().positive(), hasBbox: z.boolean(), bbox: bboxSchema, evidence: z.array(z.string()).max(20),
  })).max(100),
});

function equipmentHasDocumentEvidence(kind: "drinker" | "brush", evidence: string[]) {
  const text = evidence.join(" ").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/ł/g, "l");
  const labelReference = /\bbeschrift|\btext\b|\blabel\b|\blegende|\blegend|\bopis\b|\boznaczen/.test(text)
    && !/\b(?:keine?|ohne|nicht|no|without|not)\b[^.;]{0,45}(?:beschrift|\btext\b|\blabel\b|legende|legend)/.test(text);
  const namedEquipment = kind === "drinker"
    ? /tranke|poidl|poidel|drinker|waterer|drinking trough/.test(text)
    : /burste|szczotk|\bbrush\b/.test(text);
  const characteristicGeometry = (kind === "drinker"
    ? /wasseranschluss|wasserleitung|schwimmerventil|water connection|water supply|water inlet/.test(text) && /becken|trog|trough|basin|symbol|kontur|outline/.test(text)
    : /borsten|burstenkopf|burstenwalze|bristles|brush head|brush roller/.test(text))
    && !/\b(?:keine?|ohne|nicht|no|without|not)\b[^.;]{0,45}(?:wasseranschluss|wasserleitung|schwimmerventil|water connection|water supply|water inlet|borsten|burstenkopf|burstenwalze|bristles|brush head|brush roller)/.test(text);
  // "Blue rectangle" and a model-generated equipment label are insufficient.
  return (labelReference && namedEquipment) || characteristicGeometry;
}

export function validateSemanticAreas(input: unknown, pages: PdfPageData[]): { documentSummary: string; warnings: string[]; areas: DetectedArea[] } {
  const envelopeSchema = areaPayloadSchema.omit({ areas: true }).extend({ areas: z.array(z.unknown()).max(100) });
  const payload = envelopeSchema.parse(input);
  const parsedAreas = payload.areas.flatMap((item) => {
    const parsed = areaPayloadSchema.shape.areas.element.safeParse(item);
    return parsed.success ? [parsed.data] : [];
  });
  const pageNumbers = new Set(imagePages(pages).map((page) => page.pageNumber));
  const positioned = parsedAreas.filter((area) => pageNumbers.has(area.pageNumber) && area.hasBbox && area.bbox.width > 0 && area.bbox.height > 0 && area.evidence.some((item) => item.trim()));
  const reconciled = positioned.map((area) => {
    // Interpret only this area's label, not a paragraph mentioning nearby rooms.
    // The model still owns the observed label/geometry; this corrects enum drift.
    const labelKind = classifyUnambiguousAreaLabel(area.label);
    const kind = labelKind ?? area.kind;
    return {
      area: { ...area, kind, evidence: kind === area.kind ? area.evidence : [...area.evidence, `Beschriftungsklassifikation: ${JSON.stringify(area.label)} → ${kind} (KI-Typ: ${area.kind}).`] },
      originalEvidence: area.evidence,
    };
  });
  // A generated classification note is not a new observation of equipment.
  const valid = reconciled.filter(({ area, originalEvidence }) => (area.kind !== "drinker" && area.kind !== "brush") || equipmentHasDocumentEvidence(area.kind, originalEvidence)).map(({ area }) => area);
  const warnings = [...payload.warnings];
  if (positioned.length < payload.areas.length) warnings.push("Bereiche ohne gültige Planposition wurden verworfen.");
  if (valid.length < positioned.length) warnings.push("Tränken oder Bürsten ohne konkreten Planbeleg wurden verworfen.");
  return {
    documentSummary: payload.documentSummary, warnings,
    areas: valid.map((area) => ({ ...area, confidence: area.kind === "drinker" || area.kind === "brush" ? Math.min(area.confidence, 0.89) : area.confidence, id: crypto.randomUUID(), source: "ai", status: "unconfirmed" })),
  };
}

export async function analyzeSemanticAreas(client: OpenAI, model: string, fileName: string, pages: PdfPageData[]) {
  const prompt = `Untersuche den Stallplan ${JSON.stringify(fileName)} ausschließlich auf funktionale Bereiche und eindeutig eingezeichnete Einrichtungen.
Zulässige Typen: ${AREA_TYPES.join(", ")}.
feeding_area=Fressbereich/Futtertisch; cubicles=Liegeboxenreihen; alley=Lauf-/Treibgang; calving=Abkalbebucht; pens=Gruppenbuchten für Rinder, Jungvieh oder Kälber; isolation=Kranken-/Separationsbucht; gate=Tor oder eindeutig dargestellter Durchgang; drinker=Tränke; brush=Vieh-/Kuhbürste; unknown=unklare Stallnutzung.
Erkenne vollständige zusammenhängende Nutzungsbereiche. Verwende Beschriftungen, Stallgeometrie und wiederkehrende Einrichtungen.
Bounding-Boxen müssen die echten Bereiche umschließen (0..1, Ursprung links oben), nicht nur Beschriftungen oder Raumtabellen.
Bei komplexen Bereichen mit Aussparungen beschreibe die geometrische Unsicherheit und senke die Confidence.
Keine Maße, Produkte, Fachfragen oder Planung erzeugen. Fehlende Daten nicht ergänzen. DJP ist Vieheinheit, keine wörtliche Kopfzahl.
Jungvieh/Kälber nicht pauschal als Liegeboxen einstufen: einzelne Liegeboxen=cubicles, offene Gruppenbuchten=pens. Abkalbung und Isolation getrennt halten.
gate umfasst innere Tierdurchgänge und äußere Stallöffnungen: verlange sichtbare Öffnungsgeometrie mit Tor-/Türzeichen oder ausdrücklicher Durchgangsbeschriftung. Eine Wandlücke allein belegt weder ein Tor noch einen gewünschten Einbau. Nur die Öffnung markieren, nicht den angrenzenden Raum.
drinker/brush nur bei konkretem Text-/Legendenbeleg oder charakteristischer Symbolgeometrie. Für Tränken z.B. Becken-/Trogkontur mit erkennbarem Wasseranschluss, für Bürsten Borsten-/Bürstenkopf-Geometrie. Blaue Farbe, ein beliebiges Rechteck oder ein Kreis allein reichen nicht. Den tatsächlich sichtbaren kleinen Gegenstand markieren, nie den ganzen Raum. Konkreten Beleg in evidence nennen; Confidence höchstens 0.89. Nicht eingezeichnete Wünsche sind keine erkannten Objekte.
Wenn Geometrie nicht belastbar bestimmbar ist: hasBbox=false. Jede Entscheidung benötigt konkrete Dokumentevidenz.
Bekannte polnische Beschriftungen: korytarz paszowy=Futtergang/feeding_area, ausdrücklich kein alley; legowiska=Liegeboxen; komunikacja=Laufgang/alley; porodówka=Abkalbung; izolatka=Isolation; jałownik=Jungviehbereich; cielętnik=Kälberbereich; poidło=Tränke; szczotka=Bürste. WC, Büro und Melkhalle nicht als Liegeboxen klassifizieren.
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
