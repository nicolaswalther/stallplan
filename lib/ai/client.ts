import OpenAI from "openai";

export const DEFAULT_MODEL = "gpt-6-luna";
export const FALLBACK_MODEL = "gpt-6.1-sol";

export interface ModelRun<T> { result: T; model: string; fallback: boolean }

/** Retry only model availability/access errors, not authentication, quota, format or general 400s. */
export function isModelUnavailable(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const value = error as { status?: number; code?: string; error?: { code?: string; param?: string }; param?: string };
  const code = value.code ?? value.error?.code;
  const param = value.param ?? value.error?.param;
  return (value.status === 400 || value.status === 403 || value.status === 404)
    && (code === "model_not_found" || code === "model_not_available" || code === "unsupported_model" || (code === "permission_denied" && param === "model"));
}

export async function withModelFallback<T>(preferredModel: string, run: (model: string) => Promise<T>): Promise<ModelRun<T>> {
  try {
    return { result: await run(preferredModel), model: preferredModel, fallback: false };
  } catch (error) {
    if (preferredModel !== FALLBACK_MODEL && isModelUnavailable(error)) {
      return { result: await run(FALLBACK_MODEL), model: FALLBACK_MODEL, fallback: true };
    }
    throw error;
  }
}

export function createAnalysisClient(apiKey: string) {
  // One preferred request plus one model-only fallback stays within 120 seconds.
  return new OpenAI({ apiKey, timeout: 55_000, maxRetries: 0 });
}
