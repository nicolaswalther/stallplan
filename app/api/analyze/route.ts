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
      bbox: bboxSchema,
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
      hasBbox: z.boolean(),
      bbox: bboxSchema,
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
  required: ["documentSummary", "warnings", "areas", "measurements"],
  additionalProperties: false,
} as const;

type RequestPages = z.infer<typeof requestSchema>["pages"];

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
  const maxChars = 36_000;

  for (const page of pages) {
    const prioritized = [...page.textItems]
      .filter((item) => item.text.trim().length > 0)
      .sort((a, b) => {
        const aPriority = /\d/.test(a.text) ? 0 : 1;
        const bPriority = /\d/.test(b.text) ? 0 : 1;
        return aPriority - bPriority;
      })
      .slice(0, 700);

    for (const item of prioritized) {
      const line = `S${page.pageNumber} x=${item.bbox.x.toFixed(3)} y=${item.bbox.y.toFixed(3)} w=${item.bbox.width.toFixed(3)} h=${item.bbox.height.toFixed(3)} :: ${item.text.replace(/\s+/g, " ").slice(0, 120)}`;
      if (chars + line.length > maxChars) return lines.join("\n");
      lines.push(line);
      chars += line.length;
    }
  }

  return lines.join("\n");
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
    const model = process.env.OPENAI_MODEL || "gpt-6.1-sol";
    const visualPages = payload.pages.filter((page) => page.imageDataUrl).slice(0, 4);
    const plainText = buildPlainTextContext(payload.pages);
    const positionedText = buildPositionedTextContext(payload.pages);

    const content: Array<
      | { type: "input_text"; text: string }
      | { type: "input_image"; image_url: string; detail: "high" }
    > = [
      {
        type: "input_text",
        text:
          `Analysiere den Stallplan "${payload.fileName}" als technische Vorprüfung.\n\n` +
          `AUFGABE 1 – BEREICHE\n` +
          `Erkenne nur feeding_area, cubicles, alley, calving, gate oder unknown. Liefere möglichst genaue Bounding-Boxen relativ zur Seite (0..1, Ursprung links oben). Keine Produktauswahl und keine fertige Planung.\n\n` +
          `AUFGABE 2 – MASSE (hohe Priorität)\n` +
          `Extrahiere sämtliche belastbar lesbaren Planmaße. Nutze dafür zuerst die positionsbezogenen PDF-Textobjekte unten und gleiche sie mit dem Seitenbild ab. Kleine Maßtexte sollen nicht allein wegen schlechter visueller Lesbarkeit verloren gehen.\n` +
          `- Ein Maß nur ausgeben, wenn der Wert tatsächlich im Plan steht.\n` +
          `- Niemals eine Länge aus gezeichneter Geometrie, Pixeln oder Maßstab schätzen.\n` +
          `- Bei fehlender Einheit nur dann übernehmen, wenn die Zeichnung die verwendete Einheit eindeutig global festlegt. Sonst weglassen.\n` +
          `- Semantische Bezeichnung nur vergeben, wenn die Zuordnung klar ist; sonst label="Planmaß".\n` +
          `- Die bbox eines Maßes soll auf den zugehörigen Maßtext zeigen.\n` +
          `- Wiederholte gleiche Werte an unterschiedlichen Stellen dürfen getrennt vorkommen.\n\n` +
          `ALLGEMEIN\n` +
          `Fehlende Angaben niemals erfinden. Confidence konservativ setzen. Evidence kurz und konkret halten.\n\n` +
          `PDF-TEXT:\n${plainText}\n\nPOSITIONIERTE PDF-TEXTOBJEKTE:\n${positionedText}`,
      },
    ];

    for (const page of visualPages) {
      content.push({ type: "input_text", text: `Seitenbild ${page.pageNumber}:` });
      content.push({
        type: "input_image",
        image_url: page.imageDataUrl!,
        detail: "high",
      });
    }

    const response = await client.responses.create({
      model,
      reasoning: { effort: "medium" },
      input: [
        {
          role: "system",
          content:
            "Du analysierst technische Stallpläne. Beobachtung und Schlussfolgerung müssen getrennt bleiben. Die Ausgabe ist ein überprüfbarer Datensatz, keine autonome Planung.",
        },
        { role: "user", content },
      ],
      text: {
        format: {
          type: "json_schema",
          name: "stallplan_analysis",
          strict: true,
          schema: responseJsonSchema,
        },
      },
    });

    if (!response.output_text) {
      throw new Error("Das Modell hat keine strukturierte Ausgabe geliefert.");
    }

    const parsed = aiPayloadSchema.parse(JSON.parse(response.output_text));
    const warnings = [...parsed.warnings];

    if (payload.pages.length > visualPages.length) {
      warnings.push(
        `Visuell wurden die ersten ${visualPages.length} Seiten analysiert; positionsbezogener PDF-Text wurde für alle Seiten berücksichtigt.`,
      );
    }

    return NextResponse.json({
      model,
      documentSummary: parsed.documentSummary,
      warnings,
      areas: parsed.areas.map((area) => ({
        ...area,
        id: crypto.randomUUID(),
        source: "ai" as const,
        status: "unconfirmed" as const,
      })),
      measurements: parsed.measurements.map((measurement) => ({
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
        evidence: measurement.evidence,
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
