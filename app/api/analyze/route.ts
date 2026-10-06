import { NextResponse } from "next/server";
import { z } from "zod";
import { analyzePlan } from "@/lib/analysis/pipeline";
import { parseAnalysisRequest } from "@/lib/plan/request";
import { readAnalysisBody } from "@/lib/plan/request-body";
import { AnalysisBodyError } from "@/lib/plan/transport";

export const runtime = "nodejs";
export const maxDuration = 120;

export async function POST(request: Request) {
  try {
    const payload = parseAnalysisRequest(await readAnalysisBody(request));
    const result = await analyzePlan(payload, { apiKey: process.env.OPENAI_API_KEY, model: process.env.OPENAI_MODEL });
    return NextResponse.json(result);
  } catch (error) {
    if (error instanceof AnalysisBodyError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    if (error instanceof z.ZodError || error instanceof SyntaxError) {
      return NextResponse.json({ error: "Ungültige Analyse-Daten." }, { status: 400 });
    }
    // Do not expose SDK errors, request content or credentials to the browser.
    console.error("Plan analysis failed", { name: error instanceof Error ? error.name : "UnknownError" });
    return NextResponse.json({ error: "Plan konnte nicht gelesen werden." }, { status: 500 });
  }
}
