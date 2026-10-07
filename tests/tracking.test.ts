import test from "node:test";
import assert from "node:assert/strict";
import { recordMouseFrames } from "../src/core/dynamic.ts";
import { createProject, setAnnotations } from "../src/core/project.ts";
import { opticalFlowTracking } from "../src/plugins/optical-flow.ts";
import { linearInterpolation } from "../src/plugins/interpolation.ts";
import {
  matchTemplate,
  templateSamples,
} from "../src/plugins/template-matching.ts";
import type { AssistRequest, FrameReader, Project } from "../src/core/types.ts";

function project(): Project {
  const p = createProject({
    kind: "video",
    fileName: "curve.mp4",
    width: 220,
    height: 130,
    duration: 1,
    fps: 30,
  });
  p.annotations = [
    {
      frame: 0,
      trackId: 1,
      box: position(0),
      source: "manual",
      review: "confirmed",
    },
  ];
  return p;
}
function position(frame: number) {
  return {
    x: Math.round(20 + frame * 3),
    y: Math.round(50 + Math.sin(frame * 0.24) * 24),
    width: 30,
    height: 26,
  };
}
function pixels(frame: number, hidden = false): ImageData {
  const width = 220,
    height = 130,
    data = new Uint8ClampedArray(width * height * 4),
    box = position(frame);
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4,
        ox = x - box.x,
        oy = y - box.y;
      const target =
        !hidden && ox >= 0 && ox < box.width && oy >= 0 && oy < box.height;
      // Stable, textured background and a uniquely textured target. Distractor
      // remains stationary nearby, so a constant velocity or nearest-color guess fails.
      const distractor = x >= 146 && x < 176 && y >= 44 && y < 70;
      const feature = (Math.floor(ox / 4) + Math.floor(oy / 4)) % 2 === 0;
      data[i] = target
        ? feature
          ? 196
          : 83
        : distractor
          ? 110
          : 160 + (x % 7);
      data[i + 1] = target
        ? feature
          ? 50
          : 129
        : distractor
          ? 195
          : 171 + (y % 5);
      data[i + 2] = target ? (feature ? 223 : 61) : distractor ? 89 : 179;
      data[i + 3] = 255;
    }
  return { width, height, data, colorSpace: "srgb" } as ImageData;
}
function request(
  p: Project,
  reader: FrameReader = { read: async (frame) => pixels(frame) },
): AssistRequest {
  return {
    project: p,
    trackId: 1,
    reader,
    signal: new AbortController().signal,
    onProgress: () => {},
  };
}
test("mouse recording covers every frame even when display skips frames and export FPS is low", () => {
  const p = project();
  p.settings.samplingFps = 1;
  p.settings.boxWidth = 30;
  p.settings.boxHeight = 20;
  const initial = recordMouseFrames(p, 1, null, { frame: 3, x: 40, y: 40 });
  const batch = recordMouseFrames(
    p,
    1,
    { frame: 3, x: 40, y: 40 },
    { frame: 10, x: 75, y: 61 },
  );
  const recorded = setAnnotations({ ...p, annotations: [] }, [
    ...initial,
    ...batch,
  ]);
  assert.deepEqual(
    recorded.annotations.map((a) => a.frame),
    [3, 4, 5, 6, 7, 8, 9, 10],
  );
  assert.ok(
    recorded.annotations.every(
      (a) =>
        a.box.width === 30 && a.box.height === 20 && a.review === "confirmed",
    ),
  );
  assert.deepEqual(recorded.annotations[3].box, {
    x: 40,
    y: 39,
    width: 30,
    height: 20,
  });
  assert.equal(
    recordMouseFrames(p, 1, null, { frame: 20, x: 150, y: 90 }).length,
    1,
  );
});
test("optical tracking follows curved pixel motion substantially better than linear interpolation", async () => {
  const p = project();
  p.annotations.push({ ...p.annotations[0], frame: 29, box: position(29) });
  const tracked = await opticalFlowTracking.fill(request(p)),
    linear = await linearInterpolation.fill(request(p));
  assert.equal(tracked.length, 28);
  const meanError = (entries: typeof tracked) =>
    entries.reduce(
      (sum, a) =>
        sum +
        Math.hypot(
          a.box.x - position(a.frame).x,
          a.box.y - position(a.frame).y,
        ),
      0,
    ) / entries.length;
  assert.ok(meanError(tracked) < 1.5, `tracking error ${meanError(tracked)}`);
  assert.ok(meanError(tracked) < meanError(linear) / 5);
  assert.ok(
    tracked.every((a) => a.source === "tracked" && a.review === "pending"),
  );
  assert.ok(tracked.every((a) => a.frame > 0 && a.frame < 29));
});
test("tracking stops after appearance loss rather than filling an occlusion with imagined boxes", async () => {
  const output = await opticalFlowTracking.fill(
    request(project(), { read: async (frame) => pixels(frame, frame >= 8) }),
  );
  assert.equal(output.length, 7);
  assert.ok(output.every((a) => a.frame < 8));
});
test("rejected barriers stop tracking and human anchors are never overwritten", async () => {
  const p = project();
  p.annotations.push({
    ...p.annotations[0],
    frame: 8,
    source: "assist",
    review: "rejected",
  });
  const output = await opticalFlowTracking.fill(request(p));
  assert.equal(output.length, 7);
  const merged = setAnnotations(p, output, true);
  assert.deepEqual(merged.annotations[0], p.annotations[0]);
  assert.equal(merged.annotations.at(-1)!.review, "rejected");
});
test("tracking cancellation occurs before reading pixels and cannot write partial results", async () => {
  const ctrl = new AbortController();
  ctrl.abort();
  let reads = 0;
  await assert.rejects(
    () =>
      opticalFlowTracking.fill({
        ...request(project(), {
          read: async () => {
            reads++;
            return pixels(0);
          },
        }),
        signal: ctrl.signal,
      }),
    { name: "AbortError" },
  );
  assert.equal(reads, 0);
});

test("template search refines the motion prediction even when coarse search prefers a similar distractor", () => {
  const make = (
    objects: { x: number; y: number; noise: number }[],
  ): ImageData => {
    const width = 320,
      height = 150,
      data = new Uint8ClampedArray(width * height * 4);
    for (let y = 0; y < height; y++)
      for (let x = 0; x < width; x++) {
        const object = objects.find(
          (o) => x >= o.x && x < o.x + 90 && y >= o.y && y < o.y + 60,
        );
        const i = (y * width + x) * 4;
        const texture = object
          ? (Math.floor((x - object.x) / 2) + Math.floor((y - object.y) / 3)) %
            4
          : 0;
        const palette = [
          [210, 60, 210],
          [65, 150, 115],
          [240, 235, 210],
          [40, 70, 130],
        ];
        for (let c = 0; c < 3; c++)
          data[i + c] = object ? palette[texture][c] + object.noise : 172;
        data[i + 3] = 255;
      }
    return { width, height, data, colorSpace: "srgb" } as ImageData;
  };
  const seed = { x: 20.2, y: 20.1, width: 90, height: 60 };
  const template = templateSamples(
    make([{ x: seed.x, y: seed.y, noise: 0 }]),
    seed,
  );
  const target = { x: 73.2, y: 43.1, noise: 0 };
  const result = matchTemplate(
    make([target, { x: 170.2, y: 45.1, noise: 4 }]),
    template,
    { ...seed, x: 75.2, y: 45.1 },
    100,
  );
  assert.ok(
    Math.hypot(result.box.x - target.x, result.box.y - target.y) < 1.5,
    JSON.stringify(result),
  );
  assert.ok(result.score > 0.95);
});
