import assert from "node:assert/strict";
import { test } from "node:test";
import { recordAnalysisUsage } from "../lib/ai/usage";

test("measured input accounts separately for cache reads and writes, reasoning is not charged twice", () => {
  const recorded = recordAnalysisUsage("areas", { model: "gpt-6.1-sol", usage: { input_tokens: 10_000, output_tokens: 2_000,
    input_tokens_details: { cached_tokens: 3_000, cache_write_tokens: 1_000 }, output_tokens_details: { reasoning_tokens: 500 } } }, 100.4)!;
  assert.equal(recorded.totalTokens, 12_000);
  assert.equal(recorded.reasoningTokens, 500);
  assert.equal(recorded.durationMs, 100);
  assert.ok(Math.abs(recorded.estimatedCostUsd! - .0348) < 1e-12);
  assert.equal(recorded.pricingDate, "2026-10-05");
});

test("unknown models/tiers and missing or invalid usage cannot manufacture a cost", () => {
  const usage = { input_tokens: 1000, output_tokens: 100 };
  assert.equal(recordAnalysisUsage("areas", { model: "other", usage }, 1)?.estimatedCostUsd, undefined);
  assert.equal(recordAnalysisUsage("areas", { model: "gpt-6-luna", usage, service_tier: "priority" }, 1)?.estimatedCostUsd, undefined);
  assert.equal(recordAnalysisUsage("areas", { model: "gpt-6-luna" }, 1), undefined);
  assert.equal(recordAnalysisUsage("areas", { model: "gpt-6-luna", usage: { ...usage, input_tokens_details: { cached_tokens: 2000 } } }, 1), undefined);
});

test("Sol long-context pricing and dated model IDs use explicit documented rates", () => {
  const result = recordAnalysisUsage("areas", { model: "gpt-6.1-sol-2026-09-01", usage: { input_tokens: 300_000, output_tokens: 1000 } }, 0)!;
  assert.ok(Math.abs(result.estimatedCostUsd! - 1.215) < 1e-12);
  assert.ok(Math.abs(recordAnalysisUsage("areas", { model: "gpt-6-luna", usage: { input_tokens: 1000, output_tokens: 100 } }, 0)!.estimatedCostUsd! - .00015) < 1e-12);
});
