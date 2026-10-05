import OpenAI from "openai";
import { NextResponse } from "next/server";
import { z } from "zod";

import { AREA_TYPES } from "@/lib/types";

export const runtime = "nodejs";
export const maxDuration = 60;

const requestSchema = z.object({
  fileName: z.string().min(1).max(240),
  pages: z
    .array(
      z.object({
        pageNumber: z.number().int().positive(),
        width: z.number().positive(),
        height: z.number().positive(),
        text: z.string(),
        imageDataUrl: z.string().startsWith("data:image/"),
      }),
    )
    .min(1)
    .max(30),
});

const aiPayloadSchema = z.object({
  documentSummary: z.string(),
  warnings: z.array(z.string()),
  areas: z.array(
    z.object({
      kind: z.enum(AREA_TYPES),
      label: z.string(),
      confidence: z.number().min(0).max(1),
      pageNumber: z.number().int().positive(),
      hasBbox: z.boolean(),
      bbox: z.object({
        x: z.number().min(0).max(1),
        y: z.number().min(0).max(1),
        width: z.number().min(0).max(1),
        height: z.number().min(0).max(1),
      }),
      evidence: z.array(z.string()),
    }),
  ),
  measurements: z.array(
    z.object({
      key: z.string(),
      label: z.string(),
      value: z.number(),
      unit: z.enum(["m", "cm", "mm"]),
      confidence: z.number().min(0).max(1),
      pageNumber: z.number().int().positive(),
      evidence: z.string(),
    }),
  ),
});

const responseJsonSchema = {
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
          evidence: { type: "string" },
        },
        required: ["key", "label", "value", "unit", "confidence", "pageNumber", "evidence"],
        additionalProperties: false,
      },
    },
  },
  required: ["documentSummary", "warnings", "areas", "measurements"],
  additionalProperties: false,
} as const;

function buildTextContext(pages: z.infer<typeof requestSchema>["pages"]) {
  const maxTotalChars = 24_000;
  let used = 0;
  const chunks: string[] = [];

  for (const page of pages) {
    if (used >= maxTotalChars) break;
    const remaining = maxTotalChars - used;
    const text = page.text.slice(0, Math.min(remaining, 8_000));
    chunks.push(`--- Seite ${page.pageNumber} ---\n${text || "[kein extrahierbarer PDF-Text]"}`);
    used += text.length;
  }

  return chunks.join("\n\n");
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
    const model = process.env.OPENAI_MODEL || "gpt-5.6";
    const visualPages = payload.pages.slice(0, 4);
    const textContext = buildTextContext(payload.pages);

    const content: Array<
      | { type: "input_text"; text: string }
      | { type: "input_image"; image_url: string; detail: "high" }
    > = [
      {
        type: "input_text",
        text: `Analysiere den Stallplan "${payload.fileName}" als semantische Erkennungsstufe einer Hybrid-Pipeline.\n\n` +
          `WICHTIGE GRENZEN:\n` +
          `- Keine verbindliche Stallplanung und keine Produktauswahl erzeugen.\n` +
          `- Fehlende Informationen niemals erraten.\n` +
          `- Maße nur ausgeben, wenn sie im Plan visuell oder im extrahierten PDF-Text tatsächlich erkennbar sind.\n` +
          `- Bereiche nur aus diesen Typen klassifizieren: feeding_area, cubicles, alley, calving, gate, unknown.\n` +
          `- Bounding-Boxen relativ zur jeweiligen Seite in 0..1 angeben (x/y links oben).\n` +
          `- Wenn ein Bereich sicher erkannt, aber nicht belastbar lokalisierbar ist, hasBbox=false und bbox={x:0,y:0,width:0,height:0}.\n` +
          `- Confidence konservativ setzen. Unter 0.6 ist ausdrücklich erlaubt.\n` +
          `- Evidence kurz und prüfbar formulieren (Beschriftung, sichtbares Muster, Maßkette).\n\n` +
          `DETERMINISTISCH EXTRAHIERTER PDF-TEXT:\n${textContext}`,
      },
    ];

    for (const page of visualPages) {
      content.push({
        type: "input_text",
        text: `Seitenbild ${page.pageNumber}:`,
      });
      content.push({
        type: "input_image",
        image_url: page.imageDataUrl,
        detail: "high",
      });
    }

    const response = await client.responses.create({
      model,
      reasoning: { effort: "low" },
      input: [
        {
          role: "system",
          content:
            "Du erkennst Stallplan-Inhalte für eine technische Vorprüfung. Du bist kein autonomer Planer. Trenne Beobachtung strikt von Schlussfolgerung und liefere nur prüfbare strukturierte Vorschläge.",
        },
        { role: "user", content },
      ],
      text: {
        format: {
          type: "json_schema",
          name: "stallplan_semantic_analysis",
          strict: true,
          schema: responseJsonSchema,
        },
      },
    });

    if (!response.output_text) {
      throw new Error("Das Modell hat keine strukturierte Ausgabe geliefert.");
    }

    const parsed = aiPayloadSchema.parse(JSON.parse(response.output_text));
    const extraWarnings =
      payload.pages.length > visualPages.length
        ? [`Visuelle KI-Analyse ist im MVP auf die ersten ${visualPages.length} Seiten begrenzt; PDF-Text wurde für weitere Seiten trotzdem berücksichtigt.`]
        : [];

    return NextResponse.json({
      model,
      documentSummary: parsed.documentSummary,
      warnings: [...parsed.warnings, ...extraWarnings],
      areas: parsed.areas.map((area) => ({
        ...area,
        id: crypto.randomUUID(),
        source: "ai" as const,
        status: "unconfirmed" as const,
      })),
      measurements: parsed.measurements.map((measurement) => ({
        ...measurement,
        id: crypto.randomUUID(),
        source: "ai" as const,
        status: "unconfirmed" as const,
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
