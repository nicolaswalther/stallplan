import assert from "node:assert/strict";
import { gzipSync } from "node:zlib";
import { test } from "node:test";
import { encodeAnalysisBody, AnalysisBodyError } from "../lib/plan/transport";
import { readAnalysisBody } from "../lib/plan/request-body";

test("dense CAD transport preserves every vector and Unicode label", async () => {
  const payload = { fileName: "Burdelak.pdf", pages: [{ text: "GANEK GNOJOWY · KRÓW · Maße", lines: Array.from({ length: 25_000 }, (_, index) => ({
    id: `p1-line-${index}`, start: { x: index / 25_000, y: 0.34892349817234 }, end: { x: 0.7498237849182374, y: 0.4782374892349 }, strokeWidth: 0.48,
  })) }] };
  const encoded = await encodeAnalysisBody(payload);
  assert.equal(encoded.headers["Content-Encoding"], "gzip");
  assert.ok(encoded.body.size < new Blob([JSON.stringify(payload)]).size / 8);
  const request = new Request("http://localhost/api/analyze", { method: "POST", ...encoded });
  assert.deepEqual(await readAnalysisBody(request), payload);
});

test("small and legacy uncompressed requests remain compatible", async () => {
  const payload = { fileName: "Plan.pdf", pages: [] };
  const encoded = await encodeAnalysisBody(payload);
  assert.equal(encoded.headers["Content-Encoding"], undefined);
  assert.deepEqual(await readAnalysisBody(new Request("http://localhost", { method: "POST", ...encoded })), payload);
});

test("compressed request size is bounded even without Content-Length", async () => {
  const bytes = gzipSync(JSON.stringify({ text: "a".repeat(100) }));
  const request = new Request("http://localhost", { method: "POST", headers: { "Content-Encoding": "gzip" }, body: bytes });
  await assert.rejects(readAnalysisBody(request, { compressed: 10, decoded: 1000 }), (error: unknown) => error instanceof AnalysisBodyError && error.status === 413);
});

test("decompression has a separate output limit", async () => {
  const request = new Request("http://localhost", { method: "POST", headers: { "Content-Encoding": "gzip" }, body: gzipSync(JSON.stringify({ text: "a".repeat(10_000) })) });
  await assert.rejects(readAnalysisBody(request, { compressed: 1000, decoded: 100 }), (error: unknown) => error instanceof AnalysisBodyError && error.status === 413);
});

test("malformed gzip and unsupported encodings return actionable client errors", async () => {
  for (const [encoding, status] of [["gzip", 400], ["br", 415]] as const) {
    const request = new Request("http://localhost", { method: "POST", headers: { "Content-Encoding": encoding }, body: "not gzip" });
    await assert.rejects(readAnalysisBody(request), (error: unknown) => error instanceof AnalysisBodyError && error.status === status);
  }
  await assert.rejects(readAnalysisBody(new Request("http://localhost", { method: "POST", body: "<html>Bad gateway</html>" })), SyntaxError);
});
