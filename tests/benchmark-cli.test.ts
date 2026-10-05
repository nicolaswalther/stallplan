import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { createServer } from "node:http";
import { mkdtemp, readFile, rm, writeFile, access } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { promisify } from "node:util";
import { test } from "node:test";

const execute = promisify(execFile);
const script = resolve("scripts/benchmark-areas.ts");
const sourceHash = "a".repeat(64);
const image = "data:image/jpeg;base64,QU5PTklNQUdF";
const request = { fileName: "benchmark.pdf", pages: [{ pageNumber: 1, width: 100, height: 100,
  text: "", textItems: [], lines: [], documentKind: "vector", imageDataUrl: image }] };

async function fixture() {
  const directory = await mkdtemp(resolve(tmpdir(), "stallplan-benchmark-cli-"));
  const input = resolve(directory, "request.json");
  const out = resolve(directory, "runs");
  await writeFile(input, JSON.stringify(request));
  return { directory, input, out, args: [input, "--source-sha256", sourceHash, "--out", out] };
}

test("benchmark dry-run hashes inputs and bounds requests without exporting images or creating results", async () => {
  const files = await fixture();
  try {
    const result = await execute(process.execPath, ["--import", "tsx", script, ...files.args,
      "--models", "gpt-6-luna,gpt-6.1-sol", "--repeats", "3", "--dry-run"]);
    const plan = JSON.parse(result.stdout);
    assert.equal(plan.analysisCount, 6);
    assert.equal(plan.sourceHash, sourceHash);
    assert.match(plan.inputHash, /^[a-f\d]{64}$/);
    assert.match(plan.sourceMethodHash, /^[a-f\d]{64}$/);
    assert.ok(plan.pipelineSources.some((file: { path: string }) => file.path === "lib/geometry/room-contours.ts"));
    assert.equal(plan.dryRun, true);
    assert.equal(result.stdout.includes(image), false);
    await assert.rejects(access(files.out));
  } finally { await rm(files.directory, { recursive: true, force: true }); }
});

test("benchmark rejects excessive repeats and unbounded models before reading input or contacting a provider", async () => {
  const args = ["missing-input.json", "--source-sha256", sourceHash, "--out", "unused"];
  await assert.rejects(execute(process.execPath, ["--import", "tsx", script, ...args, "--repeats", "6"]),
    (error: unknown) => Boolean(error && typeof error === "object" && "stderr" in error && String(error.stderr).includes("1 to 5")));
  await assert.rejects(execute(process.execPath, ["--import", "tsx", script, ...args, "--models", "anything"]),
    (error: unknown) => Boolean(error && typeof error === "object" && "stderr" in error && String(error.stderr).includes("Models must be unique")));
});

test("benchmark runs the production pipeline against a local provider fixture and keeps keys/images out of exports", async () => {
  const files = await fixture();
  let calls = 0;
  const output = { documentSummary: "Plan", warnings: [], projectFacts: null,
    areas: [{ kind: "feeding_area", label: "Fressbereich", originalLabel: "korytarz paszowy", confidence: .9,
      pageNumber: 1, hasBbox: true, bbox: { x: .1, y: .1, width: .2, height: .2 }, evidence: ["Beschriftung korytarz paszowy"] }] };
  const server = createServer((incoming, response) => {
    calls++;
    incoming.resume();
    response.setHeader("content-type", "application/json");
    response.end(JSON.stringify({ id: "resp-local-test", object: "response", created_at: 1,
      model: "gpt-6-luna", status: "completed", service_tier: "default",
      output: [{ type: "message", id: "msg-local-test", role: "assistant", status: "completed",
        content: [{ type: "output_text", text: JSON.stringify(output), annotations: [] }] }],
      usage: { input_tokens: 100, input_tokens_details: { cached_tokens: 0, cache_write_tokens: 0 },
        output_tokens: 100, output_tokens_details: { reasoning_tokens: 0 }, total_tokens: 200 } }));
  });
  await new Promise<void>((done) => server.listen(0, "127.0.0.1", done));
  const address = server.address();
  assert.ok(address && typeof address === "object");
  try {
    const result = await execute(process.execPath, ["--import", "tsx", script, ...files.args, "--repeats", "1"],
      { env: { ...process.env, OPENAI_API_KEY: "benchmark-fixture-token", OPENAI_BASE_URL: `http://127.0.0.1:${address.port}/v1` } });
    assert.equal(calls, 1);
    const json = await readFile(resolve(files.out, "runs.json"), "utf8");
    const manifest = JSON.parse(json);
    assert.equal(manifest.runs[0].areas[0].kind, "feeding_area");
    assert.equal(manifest.runs[0].status, "completed");
    assert.equal(manifest.runs[0].rawResponse.id, "resp-local-test");
    assert.equal(manifest.runs[0].usage[0].inputTokens, 100);
    assert.match(manifest.runs[0].rawResponses[0].requestHash, /^[a-f\d]{64}$/);
    for (const text of [result.stdout, json]) {
      assert.equal(text.includes("benchmark-fixture-token"), false);
      assert.equal(text.includes(image), false);
      assert.equal(text.includes("imageDataUrl"), false);
    }
  } finally { server.close(); await rm(files.directory, { recursive: true, force: true }); }
});
