import type OpenAI from "openai";
import { z } from "zod";
import { AREA_TYPES, type DetectedArea, type PdfPageData, type ProjectFacts } from "../types";
import { bboxSchema } from "../plan/request";
import { classifyUnambiguousAreaLabel } from "../analysis/areas";
import { AREA_RULES } from "../rules";
import { validateSemanticProjectFacts } from "../analysis/project-facts";
import { areaTextContext, imagePages, roomNumberContext, withAreaImages } from "./context";
import { withModelFallback } from "./client";
import { recordAnalysisUsage } from "./usage";

export const areaPayloadSchema = z.object({
  documentSummary: z.string().max(2_000), warnings: z.array(z.string()).max(40),
  areas: z.array(z.object({
    kind: z.enum(AREA_TYPES), label: z.string().max(240), originalLabel: z.string().max(240).nullable().optional(), confidence: z.number().min(0).max(1),
    pageNumber: z.number().int().positive(), hasBbox: z.boolean(), bbox: bboxSchema, evidence: z.array(z.string()).max(20),
  })).max(100),
});

const factEvidenceSchema = z.object({ confidence: z.number().min(0).max(1), pageNumber: z.number().int().positive(), sourceText: z.string().min(1).max(600) });
const projectFactsPayloadSchema = z.object({
  animalSpecies: factEvidenceSchema.extend({ value: z.enum(["Rind", "Pferd", "Schaf / Ziege", "Schwein", "Sonstige"]) }).nullable(),
  animalGroup: factEvidenceSchema.extend({ value: z.enum(["Milchkühe", "Mutterkühe", "Trockensteher", "Jungvieh", "Kälber", "Mastrinder"]) }).nullable(),
  animalCount: factEvidenceSchema.extend({ value: z.number().int().positive().max(50_000) }).nullable(),
});
// Required nullable fields comply with strict Structured Outputs. The validator
// still accepts old envelopes, so recorded analyses and partial runners survive.
export const areaResponseSchema = areaPayloadSchema.extend({
  areas: z.array(areaPayloadSchema.shape.areas.element.extend({ originalLabel: z.string().max(240).nullable() })).max(100),
  projectFacts: projectFactsPayloadSchema.nullable(),
});

/** User-facing names are independent of the document language and model wording. */
export function germanAreaLabel(kind: DetectedArea["kind"], originalLabel: string): string {
  const room = originalLabel.match(/^\s*(?:(?:raum|room|nr\.?|pomieszczenie)\s*)?(\d{1,3})\s*[.\)–—:]\s*/i)
    ?? originalLabel.match(/^\s*(?:(?:raum|room|nr\.?|pomieszczenie)\s*)?(\d{1,3})\s+-\s+/i)
    ?? originalLabel.match(/\b(?:raum|room|nr\.?|pomieszczenie)\s*(\d{1,3})\b/i)
    ?? originalLabel.match(/\s·\s*(\d{1,3})\s*$/);
  return room ? `${AREA_RULES[kind].title} · ${Number(room[1])}` : AREA_RULES[kind].title;
}

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

export function validateSemanticAreas(input: unknown, pages: PdfPageData[]): { documentSummary: string; warnings: string[]; areas: DetectedArea[]; projectFacts?: ProjectFacts; originalAnalysis?: { documentSummary: string; warnings: string[] } } {
  const envelopeSchema = areaPayloadSchema.omit({ areas: true }).extend({ areas: z.array(z.unknown()).max(100), projectFacts: z.unknown().optional() });
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
    const labelKind = classifyUnambiguousAreaLabel(area.originalLabel || area.label);
    const kind = labelKind ?? area.kind;
    return {
      area: { ...area, kind, evidence: kind === area.kind ? area.evidence : [...area.evidence, `Beschriftungsklassifikation: ${JSON.stringify(area.label)} → ${kind} (KI-Typ: ${area.kind}).`] },
      originalEvidence: area.evidence,
    };
  });
  // A generated classification note is not a new observation of equipment.
  const valid = reconciled.filter(({ area, originalEvidence }) => {
    // An opening is a local object. A floor-wide group of gates is not one
    // usable opening footprint and must not cover intervening stall functions.
    if (area.kind === "gate" && area.bbox.width * area.bbox.height > .035) return false;
    return (area.kind !== "drinker" && area.kind !== "brush") || equipmentHasDocumentEvidence(area.kind, originalEvidence);
  }).map(({ area }) => area);
  const warnings = payload.warnings.length ? ["Bei einzelnen Bereichen ist die Erkennung unsicher. Bitte Markierungen prüfen."] : [];
  if (positioned.length < payload.areas.length) warnings.push("Bereiche ohne gültige Planposition wurden verworfen.");
  if (valid.length < positioned.length) warnings.push("Tränken oder Bürsten ohne konkreten Planbeleg wurden verworfen.");
  const rawFacts = payload.projectFacts && typeof payload.projectFacts === "object" ? payload.projectFacts as Record<string, unknown> : {};
  const facts = Object.fromEntries(Object.entries(projectFactsPayloadSchema.shape).map(([key, schema]) => {
    const parsed = schema.safeParse(rawFacts[key]);
    return [key, parsed.success ? parsed.data : null];
  }));
  return {
    documentSummary: valid.length ? `${valid.length} ${valid.length === 1 ? "Stallbereich erkannt" : "Stallbereiche erkannt"}.` : "Keine eindeutig positionierten Stallbereiche erkannt.", warnings,
    originalAnalysis: { documentSummary: payload.documentSummary, warnings: payload.warnings },
    projectFacts: validateSemanticProjectFacts(facts, pages),
    areas: valid.map((area, index) => {
      const name = germanAreaLabel(area.kind, area.originalLabel || area.label);
      // Repeated unlabeled rows need a distinct application name. This number
      // is explicitly a Bereich, never an invented room number from the PDF.
      const repeated = valid.filter((other) => germanAreaLabel(other.kind, other.originalLabel || other.label) === name).length > 1;
      return ({ ...area, label: repeated ? `${name} · Bereich ${index + 1}` : name, originalLabel: area.originalLabel || area.label, originalEvidence: area.evidence,
      evidence: [`Planbereich als ${AREA_RULES[area.kind].title} erkannt.`, `Markierung auf Seite ${area.pageNumber}; die genaue Umgrenzung bitte prüfen.`, ...(area.evidence.some((item) => item.startsWith("Beschriftungsklassifikation:")) ? ["Eindeutige Planbeschriftung bestätigt die Bereichsart."] : [])],
      confidence: area.kind === "drinker" || area.kind === "brush" ? Math.min(area.confidence, 0.89) : area.confidence, id: crypto.randomUUID(), source: "ai", status: "unconfirmed" });
    }),
  };
}

export async function analyzeSemanticAreas(client: OpenAI, model: string, fileName: string, pages: PdfPageData[]) {
  const prompt = `Untersuche den Stallplan ${JSON.stringify(fileName)} ausschließlich auf funktionale Bereiche und eindeutig eingezeichnete Einrichtungen.
Die gesamte Ausgabe ist immer Deutsch, unabhängig von der Sprache im Plan: label, documentSummary, warnings und evidence. Originalbeschriftungen nur als klar gekennzeichnete Zitate in evidence erhalten. Bereichsnamen deutsch benennen, vorhandene Raumnummern beibehalten. Keine zweisprachigen Bereichsnamen.
originalLabel enthält ausschließlich die tatsächlich gelesene Originalbeschriftung einschließlich einer vorhandenen Raumnummer; bei fehlender Beschriftung null. Keine Übersetzung und keine neu erfundene Raumbezeichnung in originalLabel.
Lies außerdem eindeutige Tierangaben in projectFacts: Tierart, Tiergruppe und gesamte tatsächliche Tieranzahl. Jeder Kandidat benötigt sourceText als wortgetreues Originalzitat und pageNumber; value ist deutsch. Fehlende, indirekt abgeleitete oder widersprüchliche Angaben=null. Liegeboxen/Fressgitter allein belegen weder Rind noch Milchkühe. Kuh/krowa/cow belegt Rind, aber ohne Milch-/dairy-/mleczne-Bezeichnung keine Milchkuh. Verschiedene Tiergruppen nicht auf eine Projektgruppe reduzieren. animalCount nur als ausdrücklich bezeichnete gesamte Tieranzahl/Tierbestand, niemals DJP/GVE/Vieheinheiten, Boxen-/Platzanzahl oder Summe lokaler Bereichszahlen. Eine Raumnutzung oder Modellwissen sind keine Quelle. sourceText darf ausschließlich den gelesenen Dokumenttext zitieren, keine eigene Erklärung.
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
Bekannte polnische Beschriftungen: korytarz paszowy=Futtergang/feeding_area, ausdrücklich kein alley; legowiska=Liegeboxen; komunikacja=Laufgang/alley; ganek gnojowy=Entmistungs-/Laufgang/alley, ausdrücklich kein feeding_area; porodówka=Abkalbung; izolatka/separatka=Isolation. SEPARATKA - 10 LEGOWISK bezeichnet eine Separationsbucht/isolation mit zehn Liegeplätzen, keine reguläre cubicles-Reihe. Eine Anzahl von Liegeplätzen ändert die ausdrücklich bezeichnete Hauptnutzung nicht; getrennte benachbarte Nutzungen trotzdem getrennt erkennen; jałownik=Jungviehbereich; cielętnik=Kälberbereich; poidło=Tränke; szczotka=Bürste. WC, Büro und Melkhalle nicht als Liegeboxen klassifizieren.
Vergrößerte Beschriftungsausschnitte können Raumtabellen enthalten. Lies deren tatsächliche Bezeichnungen und ordne ausschließlich wirklich gelesene Raumnummern den direkten PDF-Raumkennzeichen im Grundriss zu. Eine eindeutige Raumtabellen-Bezeichnung hat Vorrang vor einer bloßen optischen Ähnlichkeit. Pro Nutzungsfläche genau ein Bereich; WC/Büro/Technik/Melkräume nicht als Stall-Nutzungsbereiche ausgeben. originalLabel enthält bei gelesener Nummer die wortgetreue Nummer und Bezeichnung. Die Ergebnisbox muss den zugehörigen PDF-Raumanker enthalten. Tabellen sind keine Planbereiche. Gänge können mehrere Arme und Aussparungen haben: keine fremden Räume als Gang markieren, einen vorhandenen Gang auch nicht auf den Bereich unmittelbar um seine Nummer verkürzen.
${roomNumberContext(pages)}
PDF-TEXTOBJEKTE (direkt ausgelesen, nicht neu schätzen):
${areaTextContext(pages)}`;
  const run = await withModelFallback(model, async (selectedModel) => {
    const started = performance.now();
    const response = await client.responses.create({
      model: selectedModel,
      max_output_tokens: 4_500,
      ...(selectedModel.startsWith("gpt-6") ? { reasoning: { effort: "low" as const } } : {}),
      input: [{ role: "system", content: "Klassifiziere funktionale Stallbereiche anhand belastbarer Dokumentevidenz. Antworte ausschließlich auf Deutsch. Originaltext aus dem Plan darf nur als Dokumentzitat erscheinen." }, { role: "user", content: withAreaImages(prompt, pages) }],
      text: { format: { type: "json_schema", name: "stallplan_areas", strict: true, schema: z.toJSONSchema(areaResponseSchema) } },
    });
    if (!response.output_text) throw new Error("empty_area_result");
    const usage = recordAnalysisUsage("areas", response, performance.now() - started);
    return { ...validateSemanticAreas(JSON.parse(response.output_text), pages), actualModel: response.model,
      ...(usage ? { usage } : {}) };
  });
  return { ...run, model: run.result.actualModel };
}
