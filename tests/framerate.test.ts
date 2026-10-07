import test from "node:test";
import assert from "node:assert/strict";
import {
  createProject,
  frameCount,
  frameSampleTime,
  parseProject,
  setAnnotations,
  setTaskFrameRate,
  sourceFrameIndex,
  timeToFrame,
} from "../src/core/project.ts";
import { recordMouseFrames } from "../src/core/dynamic.ts";
import {
  applyAnnotationImport,
  prepareAnnotationImport,
} from "../src/core/import.ts";
import { builtInExporters, exportManifest } from "../src/plugins/exporters.ts";
import { linearInterpolation } from "../src/plugins/interpolation.ts";

function fixture() {
  return createProject({
    kind: "video",
    fileName: "60fps.mp4",
    width: 100,
    height: 80,
    duration: 1,
    fps: 60,
  });
}
function recorded() {
  const p = setTaskFrameRate(fixture(), 20);
  p.settings.boxWidth = 20;
  p.settings.boxHeight = 10;
  return setAnnotations(p, [
    ...recordMouseFrames(p, 1, null, { frame: 0, x: 20, y: 30 }),
    ...recordMouseFrames(
      p,
      1,
      { frame: 0, x: 20, y: 30 },
      { frame: 19, x: 60, y: 30 },
    ),
  ]);
}

test("60 to 20 FPS uses a dense 20-frame task clock and samples original frames 0,3,6", () => {
  const original = fixture(),
    p = setTaskFrameRate(original, 20);
  assert.equal(original.media.fps, 60);
  assert.equal(p.media.sourceFps, 60);
  assert.equal(p.media.fps, 20);
  assert.equal(frameCount(p.media), 20);
  assert.equal(timeToFrame(0.5, p.media), 10);
  assert.equal(timeToFrame(1, p.media), 19);
  assert.equal(p.settings.assistInterval, original.settings.assistInterval);
  const frames = Array.from({ length: 20 }, (_, n) => n);
  assert.deepEqual(
    frames.map((n) => sourceFrameIndex(n, p.media)),
    frames.map((n) => n * 3),
  );
  for (const n of frames)
    assert.equal(Math.floor(frameSampleTime(n, p.media) * 60), n * 3);
  assert.equal(setTaskFrameRate(original, 90).media.fps, 60);
  const fractional = setTaskFrameRate(
    createProject({ ...original.media, fps: 30, sourceFps: 30 }),
    20,
  );
  assert.deepEqual(
    [0, 1, 2, 3, 4, 5].map((n) => sourceFrameIndex(n, fractional.media)),
    [0, 1, 3, 4, 6, 7],
  );
});

test("mouse recording and fill operate on every selected task frame instead of 60 source frames", async () => {
  const p = recorded();
  assert.deepEqual(
    p.annotations.map((a) => a.frame),
    Array.from({ length: 20 }, (_, n) => n),
  );
  p.annotations = [p.annotations[0], p.annotations[19]];
  const filled = await linearInterpolation.fill({
    project: p,
    trackId: 1,
    signal: new AbortController().signal,
    onProgress: () => {},
    reader: {
      read: async () => {
        throw new Error("Interpolation does not read pixels");
      },
    },
  });
  assert.equal(filled.length, 18);
  assert.equal(setAnnotations(p, filled, true).annotations.length, 20);
});

test("exported frame names, MOT FPS, CSV timestamps and every format manifest round-trip at 20 FPS", () => {
  const p = recorded(),
    options = { confirmedOnly: true, sampledOnly: false };
  const coco = JSON.parse(
    builtInExporters.find((a) => a.id === "coco")!.export(p, options)[0].text,
  );
  assert.equal(coco.images.length, 20);
  assert.equal(coco.annotations.length, 20);
  assert.equal(coco.images[19].file_name, "images/frame_000019.jpg");
  const mot = builtInExporters.find((a) => a.id === "mot")!.export(p, options);
  assert.match(
    mot.find((f) => f.path.endsWith("seqinfo.ini"))!.text,
    /frameRate=20\nseqLength=20/,
  );
  const csv = builtInExporters
    .find((a) => a.id === "csv")!
    .export(p, options)[0].text;
  assert.ok(csv.trim().split("\n").at(-1)!.startsWith("19,0.95,"));
  for (const adapter of builtInExporters) {
    const bundle = prepareAnnotationImport(
      exportManifest(p, options, adapter.id),
      adapter.id,
    );
    const restored = applyAnnotationImport(bundle, fixture());
    assert.equal(restored.media.fps, 20, adapter.id);
    assert.equal(restored.media.sourceFps, 60, adapter.id);
    assert.deepEqual(restored.annotations, p.annotations, adapter.id);
  }
});

test("older project backups keep their FPS and an annotated task cannot be reindexed silently", () => {
  const old = fixture();
  delete old.media.sourceFps;
  assert.deepEqual(parseProject(JSON.stringify(old)), old);
  const p = recorded(),
    snapshot = JSON.stringify(p);
  assert.throws(() => setTaskFrameRate(p, 10), /帧率已固定/);
  assert.equal(JSON.stringify(p), snapshot);
  assert.deepEqual(parseProject(snapshot), p);
  for (const sourceFps of [19, 121, NaN]) {
    const invalid = { ...p, media: { ...p.media, sourceFps } };
    assert.throws(() => parseProject(JSON.stringify(invalid)), /帧率/);
  }
});
