import test from "node:test";
import assert from "node:assert/strict";
import {
  clampBox,
  createProject,
  exportAnnotations,
  frameCount,
  parseProject,
  reviewAnnotation,
  setAnnotations,
  timeToFrame,
} from "../src/core/project.ts";
import type { Annotation, Project } from "../src/core/types.ts";
import { linearInterpolation } from "../src/plugins/interpolation.ts";
import { templateMatching } from "../src/plugins/template-matching.ts";
import { builtInExporters } from "../src/plugins/exporters.ts";
import type { AssistRequest } from "../src/core/types.ts";

function request(project: Project): AssistRequest {
  return {
    project,
    trackId: 1,
    signal: new AbortController().signal,
    onProgress: () => {},
    reader: {
      read: async () => {
        throw new Error("Linear interpolation must not read pixels");
      },
    },
  };
}

function fixture(): Project {
  const p = createProject({
    kind: "video",
    fileName: "test.mp4",
    width: 100,
    height: 80,
    duration: 1,
    fps: 10,
  });
  p.labels[0].name = 'car & "target"';
  p.settings.assistInterval = 3;
  p.settings.samplingFps = 2;
  p.annotations = [
    {
      trackId: 1,
      frame: 0,
      source: "manual",
      review: "confirmed",
      box: { x: 10, y: 20, width: 20, height: 10 },
    },
    {
      trackId: 1,
      frame: 8,
      source: "manual",
      review: "confirmed",
      box: { x: 50, y: 28, width: 28, height: 18 },
    },
  ];
  return p;
}
test("fixed boxes keep their dimensions while clamping to media edges", () => {
  assert.deepEqual(
    clampBox(
      { x: 97, y: -12, width: 30, height: 20 },
      { width: 100, height: 80 },
    ),
    { x: 70, y: 0, width: 30, height: 20 },
  );
  assert.deepEqual(
    clampBox(
      { x: 3, y: 4, width: 300, height: 200 },
      { width: 100, height: 80 },
    ),
    { x: 0, y: 0, width: 100, height: 80 },
  );
});
test("timestamps map to bounded zero-based frames including the video end", () => {
  const media = fixture().media;
  assert.equal(frameCount(media), 10);
  assert.equal(timeToFrame(0.31, media), 3);
  assert.equal(timeToFrame(1, media), 9);
  assert.equal(timeToFrame(-1, media), 0);
});
test("interpolation fills only confirmed anchor intervals and never overwrites manual frames", async () => {
  const p = fixture();
  const output = await linearInterpolation.fill(request(p));
  assert.equal(output.length, 7);
  assert.deepEqual(output[3].box, { x: 30, y: 24, width: 24, height: 14 });
  assert.ok(
    output.every(
      (a) =>
        a.review === "pending" &&
        a.source === "interpolated" &&
        a.frame > 0 &&
        a.frame < 8,
    ),
  );
  p.annotations[1].review = "pending";
  await assert.rejects(() => linearInterpolation.fill(request(p)), /两个/);
});
test("rejected frames block an interpolation interval, including a rejected endpoint", async () => {
  const p = fixture();
  p.annotations.push({
    ...p.annotations[0],
    frame: 4,
    source: "assist",
    review: "rejected",
  });
  assert.equal((await linearInterpolation.fill(request(p))).length, 0);
});
test("candidate merge preserves human annotations and one frame per track", () => {
  const p = fixture();
  const candidate: Annotation = {
    ...p.annotations[0],
    source: "assist",
    review: "pending",
    box: { x: 22, y: 12, width: 30, height: 20 },
  };
  const result = setAnnotations(
    p,
    [candidate, { ...candidate, frame: 3 }, { ...candidate, frame: 3 }],
    true,
  );
  assert.equal(result.annotations.length, 3);
  assert.equal(result.annotations[0].source, "manual");
});
test("rejecting an interpolated frame retains a barrier and invalidates related derived frames", async () => {
  const p = fixture();
  p.annotations.push(...(await linearInterpolation.fill(request(p))));
  const rejected = reviewAnnotation(p, 1, 4, "rejected");
  assert.equal(
    rejected.annotations.find((a) => a.frame === 4)?.review,
    "rejected",
  );
  assert.equal(
    rejected.annotations.filter(
      (a) => a.source === "interpolated" && a.review !== "rejected",
    ).length,
    0,
  );
  assert.equal((await linearInterpolation.fill(request(rejected))).length, 0);
});
test("export filters exclude rejected/pending results and distinguish sampled frames", () => {
  const p = fixture();
  p.annotations.push(
    { ...p.annotations[0], frame: 5, source: "assist", review: "pending" },
    { ...p.annotations[0], frame: 6, review: "rejected" },
  );
  assert.equal(
    exportAnnotations(p, { confirmedOnly: true, sampledOnly: false }).length,
    2,
  );
  assert.deepEqual(
    exportAnnotations(p, { confirmedOnly: false, sampledOnly: true }).map(
      (a) => a.frame,
    ),
    [0, 5],
  );
});
test("project backups validate geometry, references, state and restore full provenance", () => {
  const p = fixture();
  assert.deepEqual(parseProject(JSON.stringify(p)), p);
  const invalid = structuredClone(p);
  invalid.annotations[0].box.x = 99;
  assert.throws(() => parseProject(JSON.stringify(invalid)));
  invalid.annotations[0].box.x = 0;
  invalid.annotations[0].trackId = 99;
  assert.throws(() => parseProject(JSON.stringify(invalid)));
  invalid.annotations = [p.annotations[0], p.annotations[0]];
  assert.throws(() => parseProject(JSON.stringify(invalid)));
  const badSettings = structuredClone(p);
  badSettings.settings.samplingFps = 0;
  assert.throws(() => parseProject(JSON.stringify(badSettings)));
});
test("COCO uses pixel width/height while YOLO normalizes its centers", () => {
  const p = fixture(),
    options = { confirmedOnly: true, sampledOnly: false };
  const coco = JSON.parse(
    builtInExporters.find((a) => a.id === "coco")!.export(p, options)[0].text,
  );
  assert.deepEqual(coco.annotations[0].bbox, [10, 20, 20, 10]);
  assert.equal(coco.annotations[0].image_id, 1);
  assert.equal(coco.images[0].file_name, "images/frame_000000.jpg");
  const yolo = builtInExporters
    .find((a) => a.id === "yolo")!
    .export(p, options)[0]
    .text.trim()
    .split(" ")
    .map(Number);
  assert.deepEqual(yolo, [0, 0.2, 0.3125, 0.2, 0.125]);
});
test("CVAT marks track gaps outside, escapes labels; VOC/MOT convert origin conventions", () => {
  const p = fixture(),
    options = { confirmedOnly: true, sampledOnly: false };
  const cvat = builtInExporters
    .find((a) => a.id === "cvat")!
    .export(p, options)[0].text;
  assert.ok(cvat.includes("car &amp; &quot;target&quot;"));
  assert.ok(cvat.includes('frame="1" outside="1"'));
  assert.ok(cvat.includes('frame="9" outside="1"'));
  const voc = builtInExporters
    .find((a) => a.id === "voc")!
    .export(p, options)[0].text;
  assert.ok(voc.includes("<xmin>11</xmin>"));
  assert.ok(voc.includes("<xmax>30</xmax>"));
  const mot = builtInExporters
    .find((a) => a.id === "mot")!
    .export(p, options)[0]
    .text.split("\n")[0]
    .split(",")
    .map(Number);
  assert.deepEqual(mot, [1, 1, 11, 21, 20, 10, 1, 1, 1]);
});
test("all twenty format adapters produce nonempty, distinct output paths", () => {
  const p = fixture();
  assert.equal(builtInExporters.length, 20);
  for (const adapter of builtInExporters) {
    const files = adapter.export(p, {
      confirmedOnly: true,
      sampledOnly: false,
    });
    assert.ok(files.length > 0);
    assert.equal(new Set(files.map((f) => f.path)).size, files.length);
    assert.ok(files.every((f) => f.text.length > 0 && !f.path.includes("..")));
  }
});
test("visual assistance finds a moving target from image pixels and returns unconfirmed proposals", async () => {
  const p = fixture();
  p.media = { ...p.media, width: 160, height: 80 };
  p.annotations = [
    { ...p.annotations[0], box: { x: 20, y: 22, width: 24, height: 20 } },
  ];
  const read = async (frame: number) => {
    const data = new Uint8ClampedArray(160 * 80 * 4);
    for (let y = 0; y < 80; y++)
      for (let x = 0; x < 160; x++) {
        const i = (y * 160 + x) * 4;
        const inside =
          x >= 20 + frame * 6 && x < 44 + frame * 6 && y >= 22 && y < 42;
        const stripe = x - 20 - frame * 6 < 12;
        data[i] = inside ? (stripe ? 200 : 70) : 155;
        data[i + 1] = inside ? (stripe ? 30 : 170) : 161;
        data[i + 2] = inside ? 210 : 153;
        data[i + 3] = 255;
      }
    return { data, width: 160, height: 80, colorSpace: "srgb" } as ImageData;
  };
  const progress: number[] = [];
  const output = await templateMatching.generate({
    project: p,
    trackId: 1,
    reader: { read },
    signal: new AbortController().signal,
    onProgress: (done) => progress.push(done),
  });
  assert.deepEqual(
    output.map((a) => a.frame),
    [3, 6],
  );
  for (const a of output) {
    assert.ok(Math.abs(a.box.x - (20 + a.frame * 6)) <= 1);
    assert.ok(Math.abs(a.box.y - 22) <= 1);
    assert.equal(a.review, "pending");
    assert.ok(a.score! > 0.95);
  }
  assert.deepEqual(progress, [1, 2]);
});
test("cancelling an assistance run stops before any frame reads", async () => {
  const ctrl = new AbortController();
  ctrl.abort();
  let reads = 0;
  await assert.rejects(() =>
    templateMatching.generate({
      project: fixture(),
      trackId: 1,
      reader: {
        read: async () => {
          reads++;
          throw new Error("should not be reached");
        },
      },
      signal: ctrl.signal,
      onProgress: () => {},
    }),
  );
  assert.equal(reads, 0);
});
