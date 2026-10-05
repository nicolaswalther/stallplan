import assert from "node:assert/strict";
import { test } from "node:test";
import { applyVectorRoomContours } from "../lib/analysis/area-geometry";
import type { DetectedArea, PdfPageData } from "../lib/types";
import { canAcceptAreaTogether, areaReviewReason } from "../lib/plan/area-review";

const page: PdfPageData = { pageNumber: 1, width: 400, height: 400, imageDataUrl: "", text: "7.", documentKind: "vector",
  textItems: [{ id: "room-7", text: "7.", bbox: { x: .25, y: .25, width: .01, height: .01 } }],
  lines: [[.1,.1,.4,.1],[.1,.4,.4,.4],[.1,.1,.1,.4],[.4,.1,.4,.4]].map(([x,y,x2,y2],i)=>({id:`wall-${i}`,start:{x,y},end:{x:x2,y:y2},strokeWidth:.6})) };
const area: DetectedArea = { id: "a", kind: "calving", label: "Abkalbebucht · 7", originalLabel: "7. Abkalbebucht", source: "ai", confidence: .91,
  status: "unconfirmed", pageNumber: 1, hasBbox: true, bbox: { x: .09, y: .09, width: .34, height: .34 }, evidence: ["Raumtext"] };

test("literal classified room label, exact native anchor and a closed vector component jointly identify geometry", () => {
  const [resolved] = applyVectorRoomContours([area], [page]);
  assert.ok(resolved.footprint?.parts.length);
  assert.equal(resolved.contourProvenance?.roomNumber, "7");
  assert.equal(resolved.contourProvenance?.textItemId, "room-7");
  assert.equal(resolved.confidence, area.confidence);
  assert.equal(resolved.kind, area.kind);
  assert.equal(resolved.status, "unconfirmed");
  assert.deepEqual(resolved.originalBbox, area.bbox);
  assert.ok(Math.abs(resolved.bbox.width - .3) < .01);
  assert.equal(applyVectorRoomContours([resolved], [page])[0], resolved);
  assert.equal(canAcceptAreaTogether(resolved), true);
});

test("a strong literal identifier plus native table detail resolves remote geometry but remains an explicit review exception", () => {
  const detailed: PdfPageData = { ...page, semanticDetails: [{ kind: "outline-text", bbox: { x: .7, y: .1, width: .2, height: .5 },
    imageDataUrl: "data:image/png;base64,AA==", sourceLineIds: ["text-line"], sourceLineCount: 200, rowCount: 8 }] };
  const remote = { ...area, bbox: { x: .6, y: .6, width: .2, height: .2 } };
  const [resolved] = applyVectorRoomContours([remote], [detailed]);
  assert.equal(resolved.contourProvenance?.modelBoxConflict, true);
  assert.deepEqual(resolved.originalBbox, remote.bbox);
  assert.equal(resolved.confidence, remote.confidence);
  assert.equal(canAcceptAreaTogether(resolved), false);
  assert.match(areaReviewReason(resolved)!, /Raumnummer/);
  assert.equal(applyVectorRoomContours([{ ...remote, confidence: .89 }], [detailed])[0].footprint, undefined);
  assert.equal(applyVectorRoomContours([{ ...remote, originalLabel: "7." }], [detailed])[0].footprint, undefined);
});

test("numbers alone, wrong semantic labels, adjacent devices and remote model boxes never acquire a room contour", () => {
  for (const rejected of [
    { ...area, originalLabel: "7." }, { ...area, originalLabel: "8. Abkalbebucht" },
    { ...area, kind: "alley" as const }, { ...area, kind: "gate" as const, originalLabel: "7. Tor der Abkalbebucht" },
    { ...area, bbox: { x: .6, y: .6, width: .2, height: .2 } },
    { ...area, source: "manual" as const }, { ...area, status: "rejected" as const },
  ]) assert.equal(applyVectorRoomContours([rejected], [page])[0], rejected);
  const ambiguous = { ...page, textItems: [...page.textItems, { id: "other-room", text: "8.", bbox: { x: .3, y: .3, width: .01, height: .01 } }] };
  assert.equal(applyVectorRoomContours([area], [ambiguous])[0], area);
  const conflicting = { ...area, id: "conflict", kind: "cubicles" as const, originalLabel: "7. Liegeboxen" };
  const duplicates = applyVectorRoomContours([area, conflicting], [page]);
  assert.equal(duplicates[0], area);
  assert.equal(duplicates[1], conflicting);
});
