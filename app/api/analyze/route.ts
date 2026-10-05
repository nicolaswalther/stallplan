import OpenAI from "openai";
import { NextResponse } from "next/server";
import { z } from "zod";

import { AREA_TYPES } from "@/lib/types";

export const runtime = "nodejs";
export const maxDuration = 90;

const bboxSchema = z.object({
  x: z.number().min(0).max(1),
  y: z.number().min(0).max(1),
  width: z.number().min(0).max(1),
  height: z.number().min(0).max(1),
});

const requestSchema = z.object({
  fileName: z.string().min(1).max(240),
  pages: z
    .array(
      z.object({
        pageNumber: z.number().int().positive(),
        width: z.number().positive(),
        height: z.number().positive(),
        text: z.string(),
        textItems: z.array(
          z.object({
            text: z.string(),
            bbox: bboxSchema,
          }),
        ),
        imageDataUrl: z.string().startsWith("data:image/").optional(),
      }),
    )
    .min(1)
    .max(40),
});

const areaPayloadSchema = z.object({
  documentSummary: z.string(),
  warnings: z.array(z.string()),
  areas: z.array(
    z.object({
      kind: z.enum(AREA_TYPES),
      label: z.string(),
      confidence: z.number().min(0).max(1),
      pageNumber: z.number().int().positive(),
      hasBbox: z.boolean(),
      bbox: bboxSchema,
      evidence: z.array(z.string()),
    }),
  ),
});

const measurementPayloadSchema = z.object({
  unitBasis: z.object({
    unit: z.enum(["m", "cm", "mm", "unknown"]),
    confidence: z.number().min(0).max(1),
    evidence: z.string(),
  }),
  warnings: z.array(z.string()),
  measurements: z.array(
    z.object({
      key: z.string(),
      label: z.string(),
      value: z.number(),
      unit: z.enum(["m", "cm", "mm"]),
      confidence: z.number().min(0).max(1),
      pageNumber: z.number().int().positive(),
      hasBbox: z.boolean(),
      bbox: bboxSchema,
      evidence: z.string(),
    }),
  ),
});

const areaJsonSchema = {
  type: "object",
  properties: {
    documentSummary: { type: "string" },
    warnings: { type: "array", items: { type: "string" } },
    areas: {
      type: "array",
      items: {
        type: "object",
        properties: {
          kind: { type: "string", enum: [...AREA_TYPES] },
          label: { type: "string" },
          confidence: { type: "number", minimum: 0, maximum: 1 },
          pageNumber: { type: "integer", minimum: 1 },
          hasBbox: { type: "boolean" },
          bbox: {
            type: "object",
            properties: {
              x: { type: "number", minimum: 0, maximum: 1 },
              y: { type: "number", minimum: 0, maximum: 1 },
              width: { type: "number", minimum: 0, maximum: 1 },
              height: { type: "number", minimum: 0, maximum: 1 },
            },
            required: ["x", "y", "width", "height"],
            additionalProperties: false,
          },
          evidence: { type: "array", items: { type: "string" } },
        },
        required: ["kind", "label", "confidence", "pageNumber", "hasBbox", "bbox", "evidence"],
        additionalProperties: false,
      },
    },
  },
  required: ["documentSummary", "warnings", "areas"],
  additionalProperties: false,
} as const;

const measurementJsonSchema = {
  type: "object",
  properties: {
    unitBasis: {
      type: "object",
      properties: {
        unit: { type: "string", enum: ["m", "cm", "mm", "unknown"] },
        confidence: { type: "number", minimum: 0, maximum: 1 },
        evidence: { type: "string" },
      },
      required: ["unit", "confidence", "evidence"],
      additionalProperties: false,
    },
    warnings: { type: "array", items: { type: "string" } },
    measurements: {
      type: "array",
      items: {
        type: "object",
        properties: {
          key: { type: "string" },
          label: { type: "string" },
          value: { type: "number" },
          unit: { type: "string", enum: ["m", "cm", "mm"] },
          confidence: { type: "number", minimum: 0, maximum: 1 },
          pageNumber: { type: "integer", minimum: 1 },
          hasBbox: { type: "boolean" },
          bbox: {
            type: "object",
            properties: {
              x: { type: "number", minimum: 0, maximum: 1 },
              y: { type: "number", minimum: 0, maximum: 1 },
              width: { type: "number", minimum: 0, maximum: 1 },
              height: { type: "number", minimum: 0, maximum: 1 },
            },
            required: ["x", "y", "width", "height"],
            additionalProperties: false,
          },
          evidence: { type: "string" },
        },
        required: ["key", "label", "value", "unit", "confidence", "pageNumber", "hasBbox", "bbox", "evidence"],
        additionalProperties: false,
      },
    },
  },
  required: ["unitBasis", "warnings", "measurements"],
  additionalProperties: false,
} as const;

type RequestPages = z.infer<typeof requestSchema>["pages"];
type InputPart =
  | { type: "input_text"; text: string }
  | { type: "input_image"; image_url: string; detail: "high" };

function buildPlainTextContext(pages: RequestPages) {
  const maxTotalChars = 20_000;
  let used = 0;
  const chunks: string[] = [];

  for (const page of pages) {
    if (used >= maxTotalChars) break;
    const remaining = maxTotalChars - used;
    const text = page.text.slice(0, Math.min(remaining, 6_000));
    chunks.push(`--- Seite ${page.pageNumber} ---\n${text || "[kein PDF-Text]"}`);
    used += text.length;
  }

  return chunks.join("\n\n");
}

function buildPositionedTextContext(pages: RequestPages) {
  const lines: string[] = [];
  let chars = 0;
  const maxChars = 42_000;

  for (const page of pages) {
    const prioritized = [...page.textItems]
      .filter((item) => item.text.trim().length > 0)
      .sort((a, b) => {
        const aPriority = /\d/.test(a.text) ? 0 : 1;
        const bPriority = /\d/.test(b.text) ? 0 : 1;
        return aPriority - bPriority;
      })
      .slice(0, 850);

    for (const item of prioritized) {
      const line = `S${page.pageNumber} x=${item.bbox.x.toFixed(3)} y=${item.bbox.y.toFixed(3)} w=${item.bbox.width.toFixed(3)} h=${item.bbox.height.toFixed(3)} :: ${item.text.replace(/\s+/g, " ").slice(0, 120)}`;
      if (chars + line.length > maxChars) return lines.join("\n");
      lines.push(line);
      chars += line.length;
    }
  }

  return lines.join("\n");
}

function appendImages(content: InputPart[], pages: RequestPages) {
  for (const page of pages.filter((item) => item.imageDataUrl).slice(0, 4)) {
    content.push({ type: "input_text", text: `Seitenbild ${page.pageNumber}:` });
    content.push({
      type: "input_image",
      image_url: page.imageDataUrl!,
      detail: "high",
    });
  }
  return content;
}

function shouldUseFallback(error: unknown) {
  if (!error || typeof error !== "object" || !("status" in error)) return false;
  const status = Number((error as { status?: number }).status);
  return status === 400 || status === 403 || status === 404;
}

async function withModelFallback<T>(
  preferredModel: string,
  run: (model: string) => Promise<T>,
): Promise<{ result: T; model: string; fallback: boolean }> {
  try {
    return {
      result: await run(preferredModel),
      model: preferredModel,
      fallback: false,
    };
  } catch (error) {
    if (preferredModel === "gpt-6-luna" && shouldUseFallback(error)) {
      const fallbackModel = "gpt-6.1-sol";
      return {
        result: await run(fallbackModel),
        model: fallbackModel,
        fallback: true,
      };
    }
    throw error;
  }
}

export async function POST(request: Request) {
  try {
    if (!process.env.OPENAI_API_KEY) {
      return NextResponse.json(
        { error: "OPENAI_API_KEY fehlt. Bitte in .env.local konfigurieren." },
        { status: 503 },
      );
    }

    const payload = requestSchema.parse(await request.json());
    const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
    const preferredModel = process.env.OPENAI_MODEL?.trim() || "gpt-6-luna";
    const plainText = buildPlainTextContext(payload.pages);
    const positionedText = buildPositionedTextContext(payload.pages);
    const visualPageCount = payload.pages.filter((page) => page.imageDataUrl).slice(0, 4).length;

    const areaContent = appendImages(
      [
        {
          type: "input_text",
          text:
            `Analysiere den Stallplan "${payload.fileName}" ausschließlich auf funktionale Stallbereiche.\n\n` +
            `Zulässige Typen: feeding_area, cubicles, alley, calving, gate, unknown.\n` +
            `Erkenne möglichst vollständige zusammenhängende Bereiche und liefere präzise Bounding-Boxen relativ zur Seite (0..1, Ursprung links oben).\n` +
            `Nutze Beschriftungen, typische Stallgeometrie und wiederkehrende Einrichtungsstrukturen.\n` +
            `Keine Produkte auswählen. Keine fertige Planung. Keine Maße erzeugen. Keine fehlenden Informationen erfinden.\n` +
            `Confidence konservativ setzen; unknown verwenden, wenn die Funktion nicht belastbar bestimmbar ist.\n\n` +
            `PDF-TEXT:\n${plainText}\n\nPOSITIONIERTE PDF-TEXTOBJEKTE:\n${positionedText}`,
        },
      ],
      payload.pages,
    );

    const measurementContent = appendImages(
      [
        {
          type: "input_text",
          text:
            `Extrahiere aus dem technischen Plan "${payload.fileName}" ausschließlich belastbare Bemaßungen. Das ist eine spezialisierte Maßprüfung.\n\n` +
            `WICHTIG:\n` +
            `- Viele Architektur-/Stallpläne schreiben an Maßketten nur Zahlen ohne "cm" oder "mm". Solche Werte NICHT pauschal verwerfen.\n` +
            `- Ermittle zuerst die dominante Zeichnungseinheit. Nutze dafür Titelblock, Maßketten, wiederholte Achsraster, Gesamtmaße und Plausibilität der Gebäudeabmessungen.\n` +
            `- Eine Einheit darf aus einer konsistenten Maßkette abgeleitet werden, wenn die Evidenz stark ist. Wiederholte Modulwerte plus passendes Gesamtmaß sind starke Evidenz.\n` +
            `- Niemals Längen aus Pixelabständen oder dem Darstellungsmaßstab des Bildes messen. Nur tatsächlich geschriebene Maßwerte übernehmen.\n` +
            `- Zahlen aus Raumnummern, Positionsnummern, Datum, Zeichnungsnummer, Tierbestand, Höhenkoten, Flächen, Volumen und Titelblock nicht als Längenmaß übernehmen.\n` +
            `- Wiederholte gleiche Maße an unterschiedlichen Positionen dürfen getrennt ausgegeben werden.\n` +
            `- bbox soll den zugehörigen Maßtext markieren.\n` +
            `- label nur semantisch benennen, wenn die Zuordnung klar ist; sonst "Planmaß".\n` +
            `- Wenn die Einheit nicht belastbar bestimmbar ist, unitBasis=unknown und unitlose Werte weglassen.\n\n` +
            `PDF-TEXT:\n${plainText}\n\nPOSITIONIERTE PDF-TEXTOBJEKTE (besonders wichtig):\n${positionedText}`,
        },
      ],
      payload.pages,
    );

    const [areaRun, measurementRun] = await Promise.all([
      withModelFallback(preferredModel, async (model) => {
        const response = await client.responses.create({
          model,
          input: [
            {
              role: "system",
              content:
                "Du erkennst Funktionsbereiche in technischen Stallplänen. Antworte ausschließlich mit dem geforderten strukturierten Datensatz.",
            },
            { role: "user", content: areaContent },
          ],
          text: {
            format: {
              type: "json_schema",
              name: "stallplan_areas",
              strict: true,
              schema: areaJsonSchema,
            },
          },
        });

        if (!response.output_text) throw new Error("Keine strukturierte Bereichsanalyse erhalten.");
        return areaPayloadSchema.parse(JSON.parse(response.output_text));
      }),
      withModelFallback(preferredModel, async (model) => {
        const response = await client.responses.create({
          model,
          input: [
            {
              role: "system",
              content:
                "Du bist auf die Extraktion technischer Bemaßungen spezialisiert. Unterscheide Maßketten strikt von sonstigen Zahlen im Plan.",
            },
            { role: "user", content: measurementContent },
          ],
          text: {
            format: {
              type: "json_schema",
              name: "stallplan_measurements",
              strict: true,
              schema: measurementJsonSchema,
            },
          },
        });

        if (!response.output_text) throw new Error("Keine strukturierte Maßanalyse erhalten.");
        return measurementPayloadSchema.parse(JSON.parse(response.output_text));
      }),
    ]);

    const warnings = [
      ...areaRun.result.warnings,
      ...measurementRun.result.warnings,
    ];

    if (payload.pages.length > visualPageCount) {
      warnings.push(
        `Visuell wurden die ersten ${visualPageCount} Seiten analysiert; positionsbezogener PDF-Text wurde für alle Seiten berücksichtigt.`,
      );
    }

    if (areaRun.fallback || measurementRun.fallback) {
      warnings.push("GPT-6 Luna war für mindestens einen Analyseschritt nicht verfügbar; dieser Schritt wurde automatisch mit GPT-6.1 Sol ausgeführt.");
    }

    const model =
      areaRun.model === measurementRun.model
        ? areaRun.model
        : `areas:${areaRun.model};measurements:${measurementRun.model}`;

    return NextResponse.json({
      model,
      documentSummary: areaRun.result.documentSummary,
      warnings,
      areas: areaRun.result.areas.map((area) => ({
        ...area,
        id: crypto.randomUUID(),
        source: "ai" as const,
        status: "unconfirmed" as const,
      })),
      measurements: measurementRun.result.measurements.map((measurement) => ({
        id: crypto.randomUUID(),
        key: measurement.key,
        label: measurement.label,
        value: measurement.value,
        unit: measurement.unit,
        source: "ai" as const,
        status: "unconfirmed" as const,
        confidence: measurement.confidence,
        pageNumber: measurement.pageNumber,
        bbox: measurement.hasBbox ? measurement.bbox : null,
        evidence:
          measurementRun.result.unitBasis.unit !== "unknown" &&
          measurementRun.result.unitBasis.confidence >= 0.7
            ? `${measurement.evidence} · Einheit: ${measurementRun.result.unitBasis.unit} (${measurementRun.result.unitBasis.evidence})`
            : measurement.evidence,
      })),
    });
  } catch (error) {
    console.error(error);

    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { error: "Ungültige Analyse-Daten.", details: error.issues },
        { status: 400 },
      );
    }

    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Analyse fehlgeschlagen." },
      { status: 500 },
    );
  }
}
