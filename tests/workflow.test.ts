import test from "node:test";
import assert from "node:assert/strict";
import {
  createProject,
  parseProject,
  setAnnotations,
  setTaskFrameRate,
} from "../src/core/project.ts";
import { addLabel, editLabel } from "../src/core/labels.ts";
import {
  addTrack,
  editTrack,
  setTrackRange,
  trackBounds,
  scopedTrackIds,
  mergeGenerated,
  restoreAnnotation,
  manualAnnotation,
  bulkReview,
} from "../src/core/workflow.ts";
import { runAnnotationBatch } from "../src/core/batch.ts";
import { resizeBox } from "../src/core/geometry.ts";
import { keyframePlan } from "../src/core/keyframes.ts";
import { templateMatching } from "../src/plugins/template-matching.ts";
import { opticalFlowTracking } from "../src/plugins/optical-flow.ts";
import { linearInterpolation } from "../src/plugins/interpolation.ts";
import type { Annotation, Project } from "../src/core/types.ts";

const box = { x: 10, y: 10, width: 20, height: 15 };
const annotation = (
  trackId: number,
  frame: number,
  source: Annotation["source"] = "manual",
  review: Annotation["review"] = "confirmed",
): Annotation => ({ trackId, frame, source, review, box: { ...box } });
function fixture(): Project {
  const p = createProject({
    kind: "demo",
    fileName: "multi",
    width: 160,
    height: 90,
    duration: 1,
    fps: 10,
  });
  p.settings.assistInterval = 2;
  p.settings.manualInterval = 5;
  p.tracks = [
    { id: 1, labelId: 1, name: "一号" },
    { id: 2, labelId: 1, name: "二号" },
    { id: 3, labelId: 2, name: "三号" },
  ];
  p.annotations = [
    annotation(1, 0),
    annotation(1, 9),
    annotation(2, 0),
    annotation(2, 9),
    annotation(3, 0),
  ];
  return p;
}
const noPixels = {
  read: async () => {
    throw new Error("插值不应读取像素");
  },
};

test("changing an empty task's FPS preserves object time ranges and valid backups", () => {
  const p = fixture();
  p.annotations = [];
  p.tracks[0].startFrame = 2;
  p.tracks[0].endFrame = 7;
  p.tracks[1].endFrame = 9;
  const changed = setTaskFrameRate(p, 5);
  assert.deepEqual(trackBounds(changed, 1), { start: 1, end: 3 });
  assert.deepEqual(trackBounds(changed, 2), { start: 0, end: 4 });
  assert.deepEqual(parseProject(JSON.stringify(changed)), changed);
  assert.throws(() => setTaskFrameRate(fixture(), 5), /已固定/);
});

test("category edits propagate by stable ID, reject duplicate names, and preserve boxes in backups", () => {
  const p = fixture();
  const changed = editLabel(p, 1, { name: "  车辆  ", color: "#FF2200" });
  assert.equal(changed.labels[0].name, "车辆");
  assert.equal(changed.labels[0].color, "#ff2200");
  assert.equal(changed.annotations, p.annotations);
  assert.equal(changed.tracks, p.tracks);
  assert.throws(() => editLabel(p, 1, { name: "其他目标" }), /已存在/);
  assert.throws(() => addLabel(p, "  机器人  "), /已存在/);
  assert.throws(() => editLabel(p, 1, { name: "  " }), /名称/);
  assert.throws(() => editLabel(p, 1, { color: "red" }), /颜色/);
  assert.equal(addLabel(p, "行人").labels.at(-1)!.name, "行人");
  assert.deepEqual(parseProject(JSON.stringify(changed)), changed);
});

test("scopes distinguish category from object and exclude locked targets for write operations", () => {
  const p = fixture();
  p.tracks[1].locked = true;
  assert.deepEqual(scopedTrackIds(p, 1, "all"), [1, 3]);
  assert.deepEqual(scopedTrackIds(p, 1, "label"), [1]);
  assert.deepEqual(scopedTrackIds(p, 2, "track"), []);
  assert.throws(() => editTrack(p, 2, { labelId: 2 }), /解锁/);
  assert.throws(() => editTrack(p, 2, { name: "改名" }), /解锁/);
  assert.deepEqual(scopedTrackIds(p, 1, "label", true), [1, 2]);
  const added = addTrack(p, 2, 4);
  assert.equal(added.tracks.at(-1)!.labelId, 2);
  assert.deepEqual(trackBounds(added, 4), { start: 4, end: 9 });
  assert.equal(
    editTrack(p, 1, { name: "新名称", hidden: true }).tracks[0].name,
    "新名称",
  );
});

test("object bounds prune out-of-range boxes, bound human plans, and are enforced by backup validation", () => {
  const p = setTrackRange(fixture(), 1, 2, 7);
  assert.equal(p.annotations.filter((a) => a.trackId === 1).length, 0);
  assert.deepEqual(trackBounds(p, 1), { start: 2, end: 7 });
  assert.deepEqual(
    keyframePlan(p, 1).manualSuggestions.map((a) => a.frame),
    [2, 7],
  );
  assert.deepEqual(parseProject(JSON.stringify(p)), p);
  assert.throws(() => setTrackRange(p, 1, 8, 2), /区间/);
  assert.throws(
    () =>
      parseProject(
        JSON.stringify({
          ...p,
          tracks: p.tracks.map((t) =>
            t.id === 1 ? { ...t, endFrame: 11 } : t,
          ),
        }),
      ),
    /轨迹/,
  );
  const invalid = setAnnotations(p, [annotation(1, 0)]);
  assert.throws(() => parseProject(JSON.stringify(invalid)), /区间/);
});

test("generation merges preserve human, confirmed, rejected, other sources, and unrelated objects", () => {
  const p = fixture();
  p.annotations = [
    annotation(1, 0),
    annotation(1, 2, "assist"),
    annotation(1, 3, "assist", "rejected"),
    annotation(1, 4, "tracked", "pending"),
    annotation(2, 4),
  ];
  const candidates = [0, 2, 3, 4, 5].map((f) =>
    annotation(1, f, "assist", "pending"),
  );
  const fresh = mergeGenerated(p, candidates, "assist", false);
  assert.deepEqual(
    fresh.annotations.filter((a) => a.frame !== 5),
    p.annotations,
  );
  assert.equal(
    fresh.annotations.find((a) => a.trackId === 1 && a.frame === 5)!.review,
    "pending",
  );
  const refreshed = mergeGenerated(p, candidates, "assist", true);
  assert.equal(
    refreshed.annotations.find((a) => a.trackId === 1 && a.frame === 4)!.source,
    "assist",
  );
  assert.equal(
    refreshed.annotations.find((a) => a.trackId === 1 && a.frame === 3)!.review,
    "rejected",
  );
  assert.equal(
    refreshed.annotations.find((a) => a.trackId === 2 && a.frame === 4)!.source,
    "manual",
  );
  const fill = mergeGenerated(
    fresh,
    [annotation(1, 5, "tracked", "pending")],
    "fill",
    true,
  );
  assert.equal(
    fill.annotations.find((a) => a.trackId === 1 && a.frame === 5)!.source,
    "assist",
  );
  assert.equal(mergeGenerated(p, [], "assist", true), p);
});

test("real batch interpolation processes two objects across a class and skips objects lacking anchors", async () => {
  const p = fixture();
  const progress: number[] = [];
  const result = await runAnnotationBatch({
    project: p,
    trackIds: scopedTrackIds(p, 1, "all", true),
    mode: "fill",
    plugin: linearInterpolation,
    reader: noPixels,
    signal: new AbortController().signal,
    onProgress: (v) => progress.push(v),
  });
  assert.equal(result.annotations.length, 16);
  assert.deepEqual(
    result.tracks.map((t) => t.status),
    ["done", "done", "skipped"],
  );
  assert.match(result.tracks[2].message, /两个/);
  assert.ok(progress.every((v, i) => !i || v >= progress[i - 1]));
  assert.equal(progress.at(-1), 100);
  assert.equal(p.annotations.length, 5);
});

test("one failing target leaves its prior data intact and does not prevent other targets from completing", async () => {
  const p = fixture();
  const result = await runAnnotationBatch({
    project: p,
    trackIds: [1, 2],
    mode: "assist",
    plugin: {
      id: "test",
      name: "test",
      description: "test",
      generate: async ({ trackId }) => {
        if (trackId === 1) throw new Error("纹理过少");
        return [annotation(trackId, 2, "assist", "pending")];
      },
    },
    reader: noPixels,
    signal: new AbortController().signal,
    onProgress: () => {},
  });
  assert.deepEqual(
    result.tracks.map((t) => t.status),
    ["failed", "done"],
  );
  const merged = mergeGenerated(p, result.annotations, "assist");
  assert.deepEqual(
    merged.annotations.filter((a) => a.trackId === 1),
    p.annotations.filter((a) => a.trackId === 1),
  );
  assert.equal(merged.annotations.filter((a) => a.trackId === 2).length, 3);
});

test("invalid plugin output cannot cross object identities or poison the saved project", async () => {
  for (const bad of [
    [annotation(2, 2, "assist", "pending")],
    [{ ...annotation(1, 2, "assist", "pending"), box: { ...box, x: NaN } }],
    [annotation(1, 2, "manual", "confirmed")],
    [
      annotation(1, 2, "assist", "pending"),
      annotation(1, 2, "assist", "pending"),
    ],
  ]) {
    const p = fixture();
    const result = await runAnnotationBatch({
      project: p,
      trackIds: [1, 2],
      mode: "assist",
      plugin: {
        id: "invalid-test",
        name: "test",
        description: "test",
        generate: async ({ trackId }) =>
          trackId === 1 ? bad : [annotation(2, 2, "assist", "pending")],
      },
      reader: noPixels,
      signal: new AbortController().signal,
      onProgress: () => {},
    });
    assert.deepEqual(
      result.tracks.map((t) => t.status),
      ["failed", "done"],
    );
    assert.match(result.tracks[0].message, /未写入/);
    const merged = mergeGenerated(p, result.annotations, "assist");
    assert.deepEqual(
      merged.annotations.filter((a) => a.trackId === 1),
      p.annotations.filter((a) => a.trackId === 1),
    );
    assert.deepEqual(parseProject(JSON.stringify(merged)), merged);
  }
});

test("cancelled batch never returns a partial result that could replace existing annotations", async () => {
  const ctrl = new AbortController(),
    p = fixture();
  let calls = 0;
  await assert.rejects(
    () =>
      runAnnotationBatch({
        project: p,
        trackIds: [1, 2],
        mode: "assist",
        plugin: {
          id: "test",
          name: "test",
          description: "test",
          generate: async ({ trackId }) => {
            calls++;
            ctrl.abort();
            return [annotation(trackId, 2, "assist", "pending")];
          },
        },
        reader: noPixels,
        signal: ctrl.signal,
        onProgress: () => {},
      }),
    { name: "AbortError" },
  );
  assert.equal(calls, 1);
  assert.equal(p.annotations.length, 5);
});

test("rejected candidates can be restored without silently becoming confirmed model results", () => {
  const p = fixture();
  p.annotations = [
    annotation(1, 3, "assist", "rejected"),
    annotation(2, 3, "manual", "rejected"),
  ];
  const a = restoreAnnotation(p, 1, 3);
  assert.equal(a.annotations[0].review, "pending");
  assert.equal(restoreAnnotation(a, 2, 3).annotations[1].review, "confirmed");
});

test("corner resizing preserves opposite corner and clamps every drag to image bounds", () => {
  assert.deepEqual(
    resizeBox(box, { x: 40, y: 35 }, "se", { width: 160, height: 90 }),
    { x: 10, y: 10, width: 30, height: 25 },
  );
  assert.deepEqual(
    resizeBox(box, { x: -10, y: 100 }, "nw", { width: 160, height: 90 }),
    { x: 0, y: 25, width: 30, height: 65 },
  );
  for (const corner of ["nw", "ne", "sw", "se"] as const)
    for (const point of [
      { x: 0, y: 0 },
      { x: 300, y: -20 },
      { x: 12, y: 12 },
    ]) {
      const r = resizeBox(box, point, corner, { width: 160, height: 90 });
      assert.ok(
        r.x >= 0 &&
          r.y >= 0 &&
          r.x + r.width <= 160 &&
          r.y + r.height <= 90 &&
          r.width >= 1 &&
          r.height >= 1,
      );
    }
});

test("human correction preserves confirmed results and other objects while invalidating only adjacent pending candidates", () => {
  const p = fixture();
  p.annotations = [
    annotation(1, 0),
    annotation(1, 9),
    annotation(1, 4, "assist"),
    annotation(1, 3, "tracked", "pending"),
    annotation(1, 7, "tracked", "pending"),
    annotation(1, 6, "tracked"),
    annotation(2, 3, "assist", "pending"),
  ];
  const fixed = manualAnnotation(p, 1, 2, { ...box, x: 20 });
  assert.ok(!fixed.annotations.some((a) => a.trackId === 1 && a.frame === 3));
  assert.ok(fixed.annotations.some((a) => a.trackId === 1 && a.frame === 7));
  assert.equal(
    fixed.annotations.find((a) => a.trackId === 1 && a.frame === 4)!.review,
    "confirmed",
  );
  assert.equal(
    fixed.annotations.find((a) => a.trackId === 1 && a.frame === 6)!.review,
    "confirmed",
  );
  assert.ok(fixed.annotations.some((a) => a.trackId === 2 && a.frame === 3));
  p.tracks[0].locked = true;
  assert.throws(() => manualAnnotation(p, 1, 2, box), /解锁/);
});
test("batch rejection first records every selected barrier then invalidates dependent unconfirmed frames", () => {
  const p = fixture();
  p.annotations.push(
    annotation(1, 2, "assist", "pending"),
    annotation(1, 3, "assist", "pending"),
    annotation(1, 4, "tracked", "pending"),
    annotation(2, 2, "assist", "pending"),
  );
  p.tracks[1].locked = true;
  const rejected = bulkReview(
    p,
    p.annotations.filter((a) => a.review === "pending"),
    "rejected",
  );
  for (const frame of [2, 3, 4])
    assert.equal(
      rejected.annotations.find((a) => a.trackId === 1 && a.frame === frame)!
        .review,
      "rejected",
    );
  assert.equal(
    rejected.annotations.find((a) => a.trackId === 2 && a.frame === 2)!.review,
    "pending",
  );
});
test("real pixel assistance runs independently for objects in two categories, preserves identities, and only proposes unconfirmed boxes", async () => {
  const p = fixture();
  p.media = { ...p.media, width: 400, height: 120 };
  p.tracks = p.tracks.slice(0, 2);
  p.tracks[1].labelId = 2;
  p.annotations = [
    { ...annotation(1, 0), box: { x: 20, y: 25, width: 30, height: 24 } },
    { ...annotation(1, 9), box: { x: 38, y: 25, width: 30, height: 24 } },
    { ...annotation(2, 0), box: { x: 230, y: 60, width: 30, height: 24 } },
    { ...annotation(2, 9), box: { x: 257, y: 60, width: 30, height: 24 } },
  ];
  const reader = {
    read: async (frame: number) => {
      const data = new Uint8ClampedArray(400 * 120 * 4);
      for (let y = 0; y < 120; y++)
        for (let x = 0; x < 400; x++) {
          const i = (y * 400 + x) * 4;
          let color = [155, 161, 153];
          const a =
            x >= 20 + frame * 2 && x < 50 + frame * 2 && y >= 25 && y < 49;
          const b =
            x >= 230 + frame * 3 && x < 260 + frame * 3 && y >= 60 && y < 84;
          if (a)
            color = x - (20 + frame * 2) < 15 ? [200, 30, 210] : [70, 170, 210];
          if (b)
            color = x - (230 + frame * 3) < 15 ? [50, 210, 90] : [210, 150, 50];
          data.set([...color, 255], i);
        }
      return { data, width: 400, height: 120, colorSpace: "srgb" } as ImageData;
    },
  };
  const result = await runAnnotationBatch({
    project: p,
    trackIds: scopedTrackIds(p, 1, "all"),
    mode: "assist",
    plugin: templateMatching,
    reader,
    signal: new AbortController().signal,
    onProgress: () => {},
  });
  assert.deepEqual(
    result.tracks.map((t) => t.status),
    ["done", "done"],
  );
  for (const id of [1, 2]) {
    const annotations = result.annotations.filter((a) => a.trackId === id);
    assert.deepEqual(
      annotations.map((a) => a.frame),
      [2, 6, 8],
    );
    for (const a of annotations) {
      assert.equal(a.review, "pending");
      assert.ok(
        Math.abs(
          a.box.x - ((id === 1 ? 20 : 230) + a.frame * (id === 1 ? 2 : 3)),
        ) <= 1,
      );
    }
  }
  const merged = mergeGenerated(p, result.annotations, "assist");
  assert.deepEqual(parseProject(JSON.stringify(merged)), merged);
  const repeated = await runAnnotationBatch({
    project: merged,
    trackIds: [1, 2],
    mode: "assist",
    plugin: templateMatching,
    reader,
    signal: new AbortController().signal,
    onProgress: () => {},
  });
  assert.deepEqual(repeated.annotations, []);
  assert.equal(mergeGenerated(merged, repeated.annotations, "assist"), merged);
});
test("optical flow never extrapolates before or after an explicitly bounded object interval", async () => {
  const p = setTrackRange(fixture(), 1, 2, 7);
  p.annotations = [
    { ...annotation(1, 4), box: { x: 30, y: 25, width: 24, height: 20 } },
  ];
  const batch = await runAnnotationBatch({
    project: p,
    trackIds: [1],
    mode: "fill",
    plugin: opticalFlowTracking,
    signal: new AbortController().signal,
    onProgress: () => {},
    reader: {
      read: async (frame) => {
        assert.ok(frame >= 2 && frame <= 7);
        const data = new Uint8ClampedArray(160 * 90 * 4);
        for (let y = 0; y < 90; y++)
          for (let x = 0; x < 160; x++) {
            const i = (y * 160 + x) * 4,
              inside = x >= 26 + frame && x < 50 + frame && y >= 25 && y < 45;
            data.set(
              inside
                ? x - (26 + frame) < 12
                  ? [200, 30, 210, 255]
                  : [70, 170, 210, 255]
                : [155, 161, 153, 255],
              i,
            );
          }
        return {
          data,
          width: 160,
          height: 90,
          colorSpace: "srgb",
        } as ImageData;
      },
    },
  });
  assert.equal(batch.tracks[0].status, "done", batch.tracks[0].message);
  const output = batch.annotations;
  assert.ok(output.length > 0);
  assert.ok(output.every((a) => a.frame >= 2 && a.frame <= 7));
});
