import { NextResponse } from "next/server";
import { z } from "zod";
import { analyzePlan } from "@/lib/analysis/pipeline";
import { parseAnalysisRequest } from "@/lib/plan/request";

export const runtime = "nodejs";
export const maxDuration = 120;

export async function POST(request: Request) {
  try {
    const payload = parseAnalysisRequest(await request.json());
    const result = await analyzePlan(payload, { apiKey: process.env.OPENAI_API_KEY, model: process.env.OPENAI_MODEL });
    return NextResponse.json(result);
  } catch (error) {
    if (error instanceof z.ZodError || error instanceof SyntaxError) {
      return NextResponse.json({ error: "Ungültige Analyse-Daten." }, { status: 400 });
    }
    // Do not expose SDK errors, request content or credentials to the browser.
    console.error("Plan analysis failed", { name: error instanceof Error ? error.name : "UnknownError" });
    return NextResponse.json({ error: "Plan konnte nicht gelesen werden." }, { status: 500 });
  }
}
