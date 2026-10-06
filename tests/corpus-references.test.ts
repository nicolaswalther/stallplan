import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { z } from "zod";

const directory = fileURLToPath(new URL("./fixtures/corpus/", import.meta.url));
const normalized = z.number().finite().min(0).max(1);
const point = z.object({ x: normalized, y: normalized });
const bbox = z.object({ x: normalized, y: normalized, width: normalized.positive(), height: normalized.positive() })
  .refine((value) => value.x + value.width <= 1.00001 && value.y + value.height <= 1.00001);
const boxArray = z.tuple([normalized, normalized, normalized.positive(), normalized.positive()])
  .refine(([x, y, width, height]) => x + width <= 1.00001 && y + height <= 1.00001);
const documentSchema = z.object({ filename: z.string().min(1), sha256: z.string().regex(/^[a-f0-9]{64}$/),
  pages: z.array(z.object({ page: z.number().int().positive(), widthPoints: z.number().positive(), heightPoints: z.number().positive(), rotation: z.number() })).min(1) });
const area = z.object({ id: z.string().min(1), kind: z.string().min(1), pageNumber: z.number().int().positive(), bbox,
  footprint: z.object({ parts: z.array(z.object({ outer: z.array(point).min(3), holes: z.array(z.array(point).min(3)).optional() })).min(1) }).optional() });
const areaSchema = z.object({ schemaVersion: z.literal("area-reference/1.0"), document: documentSchema,
  review: z.object({ method: z.string().min(1), scope: z.string().min(1), limitations: z.array(z.string()).min(1) }),
  areas: z.array(area).min(1), excludedAreas: z.array(area).optional(), unscoredKinds: z.array(z.string()) });
const measurementSchema = z.object({ schemaVersion: z.literal("1.0"), document: documentSchema,
  review: z.object({ method: z.string().min(1), measurementCoverage: z.string().min(1) }),
  measurements: z.array(z.object({ id: z.string().min(1), page: z.number().int().positive(),
    value: z.number().positive(), unit: z.enum(["m", "cm", "mm", "unknown"]), bbox: boxArray, reviewed: z.literal(true) })).min(1) });
const areaReference = z.object({ path: z.string().min(1), coverage: z.literal("partial"), geometryQuality: z.literal("coarse"),
  granularity: z.string().min(1), scope: z.string().min(1) });
const manifestSchema = z.object({ schemaVersion: z.literal("plan-corpus-reference/1.0"),
  documents: z.array(z.object({ id: z.string().regex(/^[a-z0-9-]+$/), filename: z.string().min(1), sha256: z.string().regex(/^[a-f0-9]{64}$/),
    areaReference, alternativeAreaReferences: z.array(areaReference).optional(),
    measurementReference: z.object({ path: z.string().min(1), coverage: z.literal("partial"), scope: z.string().min(1) }).optional(),
  })).min(1),
});

async function fixture(path: string) {
  assert.equal(path, basename(path), "References must remain relative to the corpus directory.");
  assert.equal(dirname(join(directory, path)), directory.replace(/\/$/, ""));
  const text = await readFile(join(directory, path), "utf8");
  assert.doesNotMatch(text, /\/tmp\/|\/workspace\/|\/home\/|data:image\/|"imageDataUrl"/,
    "The reference corpus contains annotations, not private files or rendered images.");
  return JSON.parse(text);
}

test("corpus references preserve document identity, explicit partial scopes and normalized geometry", async () => {
  const manifest = manifestSchema.parse(await fixture("manifest.json"));
  assert.equal(new Set(manifest.documents.map((item) => item.id)).size, manifest.documents.length);
  assert.equal(new Set(manifest.documents.map((item) => item.sha256)).size, manifest.documents.length);
  for (const entry of manifest.documents) {
    for (const reference of [entry.areaReference, ...(entry.alternativeAreaReferences ?? [])]) {
      const data = areaSchema.parse(await fixture(reference.path));
      assert.equal(data.document.filename, entry.filename);
      assert.equal(data.document.sha256, entry.sha256);
      const pages = new Set(data.document.pages.map((page) => page.page));
      const regions = [...data.areas, ...(data.excludedAreas ?? [])];
      assert.equal(new Set(regions.map((item) => item.id)).size, regions.length);
      assert.ok(regions.every((region) => pages.has(region.pageNumber)));
    }
    if (entry.measurementReference) {
      const data = measurementSchema.parse(await fixture(entry.measurementReference.path));
      assert.equal(data.document.filename, entry.filename);
      assert.equal(data.document.sha256, entry.sha256);
      const pages = new Set(data.document.pages.map((page) => page.page));
      assert.equal(new Set(data.measurements.map((item) => item.id)).size, data.measurements.length);
      assert.ok(data.measurements.every((measurement) => pages.has(measurement.page)));
    }
  }
});

test("every corpus artifact is a manifest-linked JSON annotation", async () => {
  const manifest = manifestSchema.parse(await fixture("manifest.json"));
  const paths = manifest.documents.flatMap((entry) => [entry.areaReference.path,
    ...(entry.alternativeAreaReferences ?? []).map((reference) => reference.path),
    ...(entry.measurementReference ? [entry.measurementReference.path] : []),
  ]);
  assert.equal(new Set(paths).size, paths.length);
  assert.deepEqual((await readdir(directory)).sort(), ["manifest.json", ...paths].sort());
  assert.ok(paths.every((path) => path.endsWith(".json")));
});
