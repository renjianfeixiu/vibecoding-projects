import test from "node:test";
import assert from "node:assert/strict";
import {
  createProject,
  frameCount,
  invalidateDerived,
  parseProject,
  setTaskFrameRate,
} from "../src/core/project.ts";
import {
  keyframePlan,
  manualInterval,
  plannedAICandidates,
} from "../src/core/keyframes.ts";
import { templateMatching } from "../src/plugins/template-matching.ts";
import {
  applyAnnotationImport,
  prepareAnnotationImport,
} from "../src/core/import.ts";
import { exportManifest } from "../src/plugins/exporters.ts";
import type { Annotation, Project } from "../src/core/types.ts";

const annotation = (frame: number): Annotation => ({
  frame,
  trackId: 1,
  source: "manual",
  review: "confirmed",
  box: { x: 20, y: 20, width: 20, height: 20 },
});
function project(duration = 5) {
  const p = createProject({
    kind: "video",
    fileName: "plan.mp4",
    width: 100,
    height: 80,
    duration,
    fps: 10,
  });
  p.settings.assistInterval = 10;
  p.settings.keyframeStrategy = "fixed";
  p.annotations = [annotation(0)];
  return p;
}
function verifyCoverage(p: Project) {
  const plan = keyframePlan(p, 1),
    human = [
      ...plan.manualAnchors,
      ...plan.manualSuggestions.map((s) => s.frame),
    ].sort((a, b) => a - b);
  assert.equal(human[0], 0);
  assert.equal(human.at(-1), frameCount(p.media) - 1);
  assert.equal(new Set(human).size, human.length);
  for (let i = 1; i < human.length; i++)
    assert.ok(human[i] - human[i - 1] <= plan.manualInterval);
  assert.ok(plan.aiPoints.every((point) => !human.includes(point.frame)));
  return plan;
}
test("irregular human anchors and short or long intervals always cover the whole task within the maximum human gap", () => {
  for (const total of [1, 2, 19, 67, 103])
    for (const gap of [1, 2, 7, 30, 200]) {
      const p = project(total / 10);
      p.settings.manualInterval = gap;
      p.annotations = [
        ...new Set([
          0,
          Math.floor((total - 1) * 0.23),
          Math.floor((total - 1) * 0.76),
        ]),
      ].map(annotation);
      const snapshot = JSON.stringify(p);
      verifyCoverage(p);
      assert.equal(JSON.stringify(p), snapshot);
    }
});
test("AI or filled frames cannot complete a required human point; an actual human annotation does", () => {
  const p = project();
  const frame = keyframePlan(p, 1).manualSuggestions[0].frame;
  for (const source of ["assist", "tracked", "interpolated"] as const) {
    p.annotations = [annotation(0), { ...annotation(frame), source }];
    assert.ok(
      keyframePlan(p, 1).manualSuggestions.some((s) => s.frame === frame),
    );
  }
  p.annotations = [annotation(0), annotation(frame)];
  assert.ok(
    !keyframePlan(p, 1).manualSuggestions.some((s) => s.frame === frame),
  );
  verifyCoverage(p);
});
test("quality hints use actual low scores or rejected candidates, group nearby hints and remain deterministic", () => {
  const p = project();
  p.annotations.push(
    ...[
      { ...annotation(5), source: "tracked" as const, score: 0.7 },
      { ...annotation(7), source: "assist" as const, score: 0.67 },
      {
        ...annotation(14),
        source: "assist" as const,
        review: "rejected" as const,
        score: 0.95,
      },
      { ...annotation(18), source: "tracked" as const, score: 0.66 },
      { ...annotation(32), source: "interpolated" as const },
    ],
  );
  const fixed = keyframePlan(p, 1);
  assert.ok(
    !fixed.manualSuggestions.some((s) => s.frame === 7 || s.frame === 14),
  );
  p.settings.keyframeStrategy = "quality";
  const quality = verifyCoverage(p);
  assert.equal(
    quality.manualSuggestions.find((s) => s.frame === 7)?.reason,
    "low-correlation",
  );
  assert.equal(
    quality.manualSuggestions.find((s) => s.frame === 14)?.reason,
    "rejected",
  );
  assert.ok(
    !quality.manualSuggestions.some(
      (s) => s.frame === 5 || s.frame === 18 || s.frame === 32,
    ),
  );
  const shuffled = { ...p, annotations: [...p.annotations].reverse() };
  assert.deepEqual(keyframePlan(shuffled, 1), quality);
});
test("suggestions belong to the selected track and dense manual recording leaves no artificial todo points", () => {
  const p = project();
  p.annotations.push({
    ...annotation(15),
    trackId: 2,
    source: "assist",
    score: 0.1,
  });
  p.settings.keyframeStrategy = "quality";
  assert.ok(!keyframePlan(p, 1).manualSuggestions.some((s) => s.frame === 15));
  p.annotations = Array.from({ length: 50 }, (_, n) => annotation(n));
  assert.deepEqual(keyframePlan(p, 1).manualSuggestions, []);
  assert.deepEqual(keyframePlan(p, 1).aiPoints, []);
});
test("real AI execution uses the displayed planned frames and never writes a reserved human point", async () => {
  const p = project(1);
  p.settings.assistInterval = 3;
  const image: ImageData = {
    width: 100,
    height: 80,
    colorSpace: "srgb",
    data: new Uint8ClampedArray(100 * 80 * 4),
  } as ImageData;
  for (let y = 20; y < 40; y++)
    for (let x = 20; x < 40; x++) {
      const offset = (y * 100 + x) * 4;
      image.data.set(
        x < 30 ? [200, 30, 210, 255] : [70, 170, 210, 255],
        offset,
      );
    }
  const plan = keyframePlan(p, 1),
    expected = plannedAICandidates(p, 1).map((point) => point.frame);
  assert.deepEqual(expected, [3, 6]);
  const output = await templateMatching.generate({
    project: p,
    trackId: 1,
    reader: { read: async () => image },
    signal: new AbortController().signal,
    onProgress: () => {},
  });
  assert.deepEqual(
    output.map((a) => a.frame),
    expected,
  );
  assert.ok(
    output.every(
      (a) =>
        !plan.manualSuggestions.some((s) => s.frame === a.frame) &&
        a.review === "pending",
    ),
  );
  assert.deepEqual(p.annotations, [annotation(0)]);
});
test("a rejected candidate blocks AI propagation until a later actual human anchor and survives unrelated human correction", () => {
  const p = project(10);
  p.annotations.push(
    { ...annotation(30), source: "assist", review: "rejected" },
    annotation(70),
  );
  const candidates = plannedAICandidates(p, 1);
  assert.ok(candidates.some((point) => point.frame > 0 && point.frame < 30));
  assert.ok(!candidates.some((point) => point.frame >= 30 && point.frame < 70));
  assert.ok(
    candidates.some((point) => point.frame > 70 && point.anchorFrame === 70),
  );
  assert.ok(
    invalidateDerived(p, 1).annotations.some(
      (a) => a.frame === 30 && a.review === "rejected",
    ),
  );
});
test("planning settings round-trip through backups and exports; older projects still work and invalid settings fail", () => {
  const p = project();
  p.settings.manualInterval = 17;
  p.settings.keyframeStrategy = "quality";
  const loaded = parseProject(JSON.stringify(p));
  assert.deepEqual(keyframePlan(loaded, 1), keyframePlan(p, 1));
  const bundle = prepareAnnotationImport(
    exportManifest(p, { confirmedOnly: true, sampledOnly: false }, "coco"),
    "roundtrip",
  );
  assert.equal(
    applyAnnotationImport(bundle, createProject(p.media)).settings
      .manualInterval,
    17,
  );
  const old = project();
  delete old.settings.manualInterval;
  delete old.settings.keyframeStrategy;
  assert.equal(manualInterval(parseProject(JSON.stringify(old))), 30);
  for (const value of [0, 1.5, 18001, "bad"])
    assert.throws(() =>
      parseProject(
        JSON.stringify({
          ...p,
          settings: { ...p.settings, manualInterval: value },
        }),
      ),
    );
  assert.throws(() =>
    parseProject(
      JSON.stringify({
        ...p,
        settings: { ...p.settings, keyframeStrategy: "imaginary-model" },
      }),
    ),
  );
  const changed = setTaskFrameRate(
    createProject({ ...p.media, fps: 60, sourceFps: 60 }),
    20,
  );
  assert.equal(manualInterval(changed), 60);
});

test("frame-rate conversion keeps even an extreme manual interval within the saved-project limit", () => {
  const p = createProject({
    kind: "video",
    fileName: "120fps.mp4",
    width: 100,
    height: 80,
    duration: 5,
    fps: 20,
    sourceFps: 120,
  });
  p.settings.manualInterval = 18000;
  const higher = setTaskFrameRate(p, 120);
  assert.equal(higher.settings.manualInterval, 18000);
  assert.deepEqual(parseProject(JSON.stringify(higher)), higher);
  p.settings.manualInterval = 1;
  const lower = setTaskFrameRate(p, 1);
  assert.equal(lower.settings.manualInterval, 1);
  assert.deepEqual(parseProject(JSON.stringify(lower)), lower);
});
