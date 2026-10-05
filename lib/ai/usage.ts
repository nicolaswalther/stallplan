/** Standard USD token prices published on the model pages, checked 2026-10-05.
 * Keep this versioned snapshot explicit; the API usage is measured, cost is an estimate.
 */
const PRICES = {
  "gpt-6-luna": { input: .10, cached: .01, write: .125, output: .50 },
  "gpt-6.1-sol": { input: 2, cached: .10, write: 2.50, output: 10 },
} as const;
const PRICING_DATE = "2026-10-05";
interface ApiUsage {
  input_tokens?: number;
  output_tokens?: number;
  total_tokens?: number;
  input_tokens_details?: { cached_tokens?: number; cache_write_tokens?: number };
  output_tokens_details?: { reasoning_tokens?: number };
}
export interface AnalysisUsage {
  step: "areas" | "measurements";
  model: string;
  inputTokens: number;
  cachedInputTokens: number;
  cacheWriteTokens: number;
  outputTokens: number;
  reasoningTokens: number;
  totalTokens: number;
  durationMs: number;
  serviceTier?: string;
  estimatedCostUsd?: number;
  pricingDate?: string;
  pricingSource?: string;
}
const count = (value: unknown): value is number => Number.isSafeInteger(value) && Number(value) >= 0;

export function recordAnalysisUsage(step: AnalysisUsage["step"], response: { model: string; usage?: ApiUsage | null; service_tier?: string | null }, durationMs: number): AnalysisUsage | undefined {
  const usage = response.usage;
  if (!usage || !count(usage.input_tokens) || !count(usage.output_tokens)) return;
  const cached = usage.input_tokens_details?.cached_tokens ?? 0;
  const write = usage.input_tokens_details?.cache_write_tokens ?? 0;
  const reasoning = usage.output_tokens_details?.reasoning_tokens ?? 0;
  if (![cached, write, reasoning].every(count) || cached + write > usage.input_tokens || reasoning > usage.output_tokens) return;
  const result: AnalysisUsage = {
    step, model: response.model, inputTokens: usage.input_tokens, cachedInputTokens: cached, cacheWriteTokens: write,
    outputTokens: usage.output_tokens, reasoningTokens: reasoning,
    totalTokens: usage.input_tokens + usage.output_tokens, durationMs: Math.max(0, Math.round(durationMs)),
    ...(response.service_tier ? { serviceTier: response.service_tier } : {}),
  };
  const model = Object.keys(PRICES).find((id) => response.model === id || response.model.startsWith(id) && /^-\d{4}-\d{2}-\d{2}$/.test(response.model.slice(id.length))) as keyof typeof PRICES | undefined;
  // Other tiers and unknown models require their own published pricing evidence.
  if (!model || response.service_tier && response.service_tier !== "default") return result;
  const rates = PRICES[model];
  const long = usage.input_tokens > 272_000;
  result.estimatedCostUsd = ((usage.input_tokens - cached - write) * rates.input + cached * rates.cached + write * rates.write) * (long ? 2 : 1) / 1_000_000
    + usage.output_tokens * rates.output * (long ? 1.5 : 1) / 1_000_000;
  result.pricingDate = PRICING_DATE;
  result.pricingSource = `https://platform.openai.com/docs/models/${model}`;
  return result;
}
