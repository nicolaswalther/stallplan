import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { access, mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import type OpenAI from "openai";
import type { Response } from "openai/resources/responses/responses";
import { analyzePlan, type AnalysisRunners } from "../lib/analysis/pipeline";
import { analyzeSemanticAreas } from "../lib/ai/areas";
import { analyzeRasterMeasurements } from "../lib/ai/measurements";
import { parseAnalysisRequest } from "../lib/plan/request";

const HELP = `Usage: npx tsx scripts/benchmark-areas.ts <request.json> --out <directory>
  --source <original.pdf> | --source-sha256 <64-hex-digits>
  [--models gpt-6-luna,gpt-6.1-sol] [--repeats 3] [--variant name] [--dry-run]

Runs the real production pipeline, with at most 2 models × 5 repeats.
An AnalysisRequest JSON must contain rendered page images and native PDF data.
Keys come from OPENAI_API_KEY/.env.local; no keys or input images are exported.
--dry-run validates inputs and prints the bounded plan without any API call.
Output contains sanitized raw provider outputs, final areas and usage for evaluation.
`;

interface Options {
  request: string; out: string; source?: string; sourceSha256?: string;
  models: string[]; repeats: number; variant: string; dryRun: boolean;
}
interface CapturedResponse {
  step: "areas" | "measurements"; durationMs: number; requestHash: string;
  id?: string; model?: string; status?: string; service_tier?: string;
  output_text?: string; usage?: unknown;
  error?: { name?: string; code?: string; status?: number };
}

const hash = (value: string | Buffer) => createHash("sha256").update(value).digest("hex");
class BenchmarkInputError extends Error {}

function argumentsForRun(args: string[]): Options | null {
  if (args.includes("--help") || args.includes("-h")) return null;
  const options: Options = { request: "", out: "", models: ["gpt-6-luna"], repeats: 3, variant: "production", dryRun: false };
  const seen = new Set<string>();
  for (let index = 0; index < args.length; index++) {
    const argument = args[index];
    if (!argument.startsWith("--")) {
      if (options.request) throw new BenchmarkInputError("Exactly one AnalysisRequest JSON is required.");
      options.request = argument;
      continue;
    }
    if (seen.has(argument)) throw new BenchmarkInputError("Duplicate benchmark option. Use --help.");
    seen.add(argument);
    if (argument === "--dry-run") { options.dryRun = true; continue; }
    if (!["--out", "--source", "--source-sha256", "--models", "--repeats", "--variant"].includes(argument)) throw new BenchmarkInputError("Unknown benchmark option. Use --help.");
    const value = args[++index];
    if (!value || value.startsWith("--")) throw new BenchmarkInputError(`Missing value: ${argument}`);
    if (argument === "--out") options.out = value;
    if (argument === "--source") options.source = value;
    if (argument === "--source-sha256") options.sourceSha256 = value.toLowerCase();
    if (argument === "--models") options.models = value.split(",");
    if (argument === "--repeats") options.repeats = Number(value);
    if (argument === "--variant") options.variant = value;
  }
  if (!options.request || !options.out) throw new BenchmarkInputError("Request JSON and --out are required. Use --help for examples.");
  if (Boolean(options.source) === Boolean(options.sourceSha256)) throw new BenchmarkInputError("Use exactly one of --source or --source-sha256 to identify the original document.");
  if (options.sourceSha256 && !/^[a-f\d]{64}$/.test(options.sourceSha256)) throw new BenchmarkInputError("Source SHA-256 must have 64 hexadecimal characters.");
  if (!Number.isInteger(options.repeats) || options.repeats < 1 || options.repeats > 5) throw new BenchmarkInputError("Repeats must be an integer from 1 to 5.");
  if (options.models.length < 1 || options.models.length > 2 || new Set(options.models).size !== options.models.length || options.models.some((model) => !["gpt-6-luna", "gpt-6.1-sol"].includes(model))) throw new BenchmarkInputError("Models must be unique: gpt-6-luna and/or gpt-6.1-sol.");
  if (!/^[a-zA-Z\d][a-zA-Z\d_.-]{0,79}$/.test(options.variant)) throw new BenchmarkInputError("Variant must be a short filename-safe identifier.");
  return options;
}

/** Capture output/usage without persisting input messages, images or headers. */
function observingClient(client: OpenAI, step: CapturedResponse["step"], captured: CapturedResponse[]): OpenAI {
  return new Proxy(client, {
    get(target, property, receiver) {
      if (property !== "responses") return Reflect.get(target, property, receiver);
      return new Proxy(target.responses, {
        get(responses, method, responsesReceiver) {
          const value = Reflect.get(responses, method, responsesReceiver);
          if (method !== "create" || typeof value !== "function") return value;
          return async (...args: unknown[]) => {
            const requestHash = hash(JSON.stringify(args[0]));
            const started = performance.now();
            try {
              const response = await Reflect.apply(value, responses, args) as Response;
              captured.push({ step, requestHash, durationMs: Math.round(performance.now() - started),
                id: response.id, model: response.model, status: response.status,
                ...(response.service_tier ? { service_tier: response.service_tier } : {}),
                output_text: response.output_text, usage: response.usage });
              return response;
            } catch (error) {
              const details = error && typeof error === "object" ? error as Record<string, unknown> : {};
              captured.push({ step, requestHash, durationMs: Math.round(performance.now() - started), error: {
                ...(typeof details.name === "string" ? { name: details.name } : {}),
                ...(typeof details.code === "string" ? { code: details.code } : {}),
                ...(typeof details.status === "number" ? { status: details.status } : {}),
              } });
              throw error;
            }
          };
        },
      });
    },
  });
}

function revision() {
  try {
    return { commit: execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim(),
      dirty: Boolean(execFileSync("git", ["status", "--porcelain"], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim()) };
  } catch { return { commit: null, dirty: null }; }
}

async function sourceHashes(directory = "lib"): Promise<Array<{ path: string; sha256: string }>> {
  const entries = await readdir(directory, { withFileTypes: true });
  const groups = await Promise.all(entries.map(async (entry) => {
    const path = `${directory}/${entry.name}`;
    if (entry.isDirectory()) return sourceHashes(path);
    return entry.isFile() && /\.(?:ts|tsx)$/.test(entry.name) ? [{ path, sha256: hash(await readFile(path)) }] : [];
  }));
  return groups.flat().sort((a, b) => a.path.localeCompare(b.path));
}

async function ensureNewFile(path: string) {
  try { await access(path); } catch { return; }
  throw new BenchmarkInputError("Output already exists; select a new benchmark directory before running paid requests.");
}

async function main() {
  const options = argumentsForRun(process.argv.slice(2));
  if (!options) { console.log(HELP); return; }
  const rawInput = JSON.parse(await readFile(options.request, "utf8"));
  const payload = parseAnalysisRequest(rawInput);
  if (!payload.pages.some((page) => page.imageDataUrl)) throw new BenchmarkInputError("Area benchmark requires at least one rendered page image.");
  const sourceHash = options.sourceSha256 ?? hash(await readFile(options.source!));
  const inputHash = hash(JSON.stringify(payload));
  const pipelineRevision = revision();
  const pipelineSources = await sourceHashes();
  const sourceMethodHash = hash(JSON.stringify(pipelineSources));
  const promptSourceHash = hash(await readFile("lib/ai/areas.ts"));
  const out = resolve(options.out);
  const outputs = options.models.flatMap((model) => Array.from({ length: options.repeats }, (_, index) => `${options.variant}-${model}-${index + 1}.json`));
  const plan = {
    schemaVersion: "area-benchmark/1.0", createdAt: new Date().toISOString(), variant: options.variant,
    documentSha256: sourceHash, sourceHash, inputHash, models: options.models, repeats: options.repeats,
    pipelineRevision, pipelineSources, sourceMethodHash, promptSourceHash, analysisCount: outputs.length,
    maximumProviderRequestsIncludingFallback: outputs.length * 4,
    pages: payload.pages.map((page) => ({ pageNumber: page.pageNumber, documentKind: page.documentKind,
      width: page.width, height: page.height, textObjectCount: page.textItems.length, vectorLineCount: page.lines?.length ?? 0,
      hasPageImage: Boolean(page.imageDataUrl), semanticDetailCount: page.semanticDetails?.length ?? 0 })),
    outputs,
  };
  console.log(JSON.stringify({ ...plan, dryRun: options.dryRun }, null, 2));
  if (options.dryRun) return;
  const { loadEnvConfig } = await import("@next/env");
  loadEnvConfig(process.cwd(), false, { info: () => {}, error: () => {} });
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new BenchmarkInputError("OPENAI_API_KEY fehlt. --dry-run works without credentials.");
  await mkdir(out, { recursive: true });
  await Promise.all(["config.json", "runs.json", ...outputs].map((file) => ensureNewFile(resolve(out, file))));
  await writeFile(resolve(out, "config.json"), JSON.stringify(plan, null, 2) + "\n", { flag: "wx" });
  const runs: Array<Record<string, unknown>> = [];
  let failures = 0;
  for (const model of options.models) for (let run = 1; run <= options.repeats; run++) {
    const rawResponses: CapturedResponse[] = [];
    const runners: AnalysisRunners = {
      areas: (client, selectedModel, fileName, pages) => analyzeSemanticAreas(observingClient(client, "areas", rawResponses), selectedModel, fileName, pages),
      measurements: (client, selectedModel, fileName, pages) => analyzeRasterMeasurements(observingClient(client, "measurements", rawResponses), selectedModel, fileName, pages),
    };
    const started = performance.now();
    const result = await analyzePlan(payload, { apiKey, model }, runners);
    const areaResponses = rawResponses.filter((response) => response.step === "areas" && !response.error);
    const rawResponse = areaResponses.at(-1);
    const successful = Boolean(result.actualModels.areas && rawResponse?.status === "completed");
    if (!successful) failures++;
    let rawAreas: unknown[] = [];
    try { rawAreas = JSON.parse(rawResponse?.output_text ?? "{}").areas ?? []; } catch { /* Retain failed raw output as evidence. */ }
    const record = { ...result, variant: options.variant, run, requestedModel: model, sourceHash, documentSha256: sourceHash, inputHash,
      id: `${options.variant}-${model}-${run}`, status: successful ? "completed" : "partial", pipelineRevision,
      metadata: { sourceMethodHash, promptSourceHash, pipelineRevision },
      latencyMs: Math.round(performance.now() - started), usageRecords: result.usage,
      rawResponse, rawResponses, rawAreas,
      costIncomplete: rawResponses.some((response) => response.error || !response.usage),
    };
    const file = `${options.variant}-${model}-${run}.json`;
    await writeFile(resolve(out, file), JSON.stringify(record, null, 2) + "\n", { flag: "wx" });
    runs.push(record);
    await writeFile(resolve(out, "runs.json"), JSON.stringify({ ...plan, runs }, null, 2) + "\n");
    console.log(JSON.stringify({ file, status: record.status, model: result.model, durationMs: record.latencyMs,
      areaCount: result.areas.length, usage: result.usage, costIncomplete: record.costIncomplete }));
  }
  if (failures) process.exitCode = 1;
}

main().catch((error) => {
  // SDK/parser errors can carry whole inputs. Keep terminal failures concise.
  console.error(error instanceof BenchmarkInputError ? error.message : "Benchmark could not finish. Check --help, request validity, source hash, output directory and API configuration.");
  process.exitCode = 1;
});
