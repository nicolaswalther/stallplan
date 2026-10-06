import assert from "node:assert/strict";
import { test } from "node:test";
import { extractVectorLines } from "../lib/pdf/vector-extraction";

const ops = { constructPath: 1, stroke: 2, save: 3, restore: 4,
  beginMarkedContent: 5, beginMarkedContentProps: 6, endMarkedContent: 7, transform: 8 };
const viewport = { width: 1000, height: 1000, transform: [1, 0, 0, -1, 0, 1000] };
const path = [ops.stroke, [new Float32Array([0, 100, 200, 1, 300, 200])]];
const layers = new Map([["hatch", "GEA_Kreskowanie_ruszta"], ["wall", "A-Wall"]]);
type Event = [number, unknown[]];
const draw: Event = [ops.constructPath, path];

function extract(events: Event[], names = layers) {
  return extractVectorLines({ fnArray: events.map(([op]) => op), argsArray: events.map(([, args]) => args) },
    ops, viewport, 1, names);
}

test("single native optional-content groups tag lines without changing extracted geometry", () => {
  const events: Event[] = [draw, [ops.beginMarkedContentProps, ["OC", { type: "OCG", id: "hatch" }]],
    draw, [ops.endMarkedContent, []], [ops.beginMarkedContentProps, ["OC", { type: "OCG", id: "wall" }]],
    draw, [ops.endMarkedContent, []], draw];
  const tagged = extract(events);
  assert.deepEqual(tagged.lines.map((line) => line.layerName), [undefined, "GEA_Kreskowanie_ruszta", "A-Wall", undefined]);
  const withoutLayerNames = tagged.lines.map(({ layerName, ...line }) => { void layerName; return line; });
  assert.deepEqual(withoutLayerNames, extract(events, new Map()).lines);
  assert.deepEqual(tagged.lines[1].start, { x: .1, y: .8 });
  assert.deepEqual(tagged.lines[1].end, { x: .3, y: .8 });
  assert.equal(tagged.vectorInkComplete, true);
  assert.equal(layers.size, 2, "source metadata stays unchanged");
});

test("plain nested marked content retains its enclosing native layer", () => {
  const events: Event[] = [[ops.beginMarkedContentProps, ["OC", { type: "OCG", id: "wall" }]],
    [ops.beginMarkedContent, ["Span"]], draw, [ops.endMarkedContent, []],
    [ops.beginMarkedContentProps, ["Span", { MCID: 4 }]], draw, [ops.endMarkedContent, []],
    draw, [ops.endMarkedContent, []], draw];
  assert.deepEqual(extract(events).lines.map((line) => line.layerName), ["A-Wall", "A-Wall", "A-Wall", undefined]);
});

test("unknown optional content and membership expressions receive no invented layer", () => {
  const events: Event[] = [[ops.beginMarkedContentProps, ["OC", { type: "OCG", id: "hatch" }]],
    [ops.beginMarkedContentProps, ["OC", { type: "OCG", id: "missing" }]], draw,
    [ops.endMarkedContent, []], draw,
    [ops.beginMarkedContentProps, ["OC", { type: "OCMD", ids: ["wall", "hatch"], policy: "AnyOn" }]], draw,
    [ops.endMarkedContent, []], draw, [ops.endMarkedContent, []]];
  assert.deepEqual(extract(events).lines.map((line) => line.layerName), [undefined, "GEA_Kreskowanie_ruszta", undefined, "GEA_Kreskowanie_ruszta"]);
});

test("graphics-state restore does not change marked-content nesting", () => {
  const events: Event[] = [[ops.save, []], [ops.beginMarkedContentProps, ["OC", { type: "OCG", id: "wall" }]],
    [ops.restore, []], draw, [ops.endMarkedContent, []], draw,
    [ops.beginMarkedContentProps, ["OC", { type: "OCG", id: "hatch" }]], [ops.save, []],
    [ops.endMarkedContent, []], [ops.restore, []], draw, [ops.endMarkedContent, []], draw];
  assert.deepEqual(extract(events).lines.map((line) => line.layerName), ["A-Wall", undefined, undefined, undefined]);
});
