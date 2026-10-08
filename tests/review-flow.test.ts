import test from "node:test";
import assert from "node:assert/strict";
import {
  createProject,
  parseProject,
  reviewAnnotation,
  setAnnotations,
} from "../src/core/project.ts";
import {
  drawManualBox,
  manualAnnotation,
  mergeGenerated,
  editTrack,
  removeTrack,
  setTrackRange,
  bulkReview,
} from "../src/core/workflow.ts";
import {
  confirmManualKeyframes,
  confirmAIKeyframes,
  recordAIAttempt,
  keyframeReviewState,
  reviewFlowState,
} from "../src/core/review-flow.ts";
import { runAnnotationBatch, readiness } from "../src/core/batch.ts";
import { linearInterpolation } from "../src/plugins/interpolation.ts";
import { builtInExporters } from "../src/plugins/exporters.ts";
import type {
  Annotation,
  AnnotationAssistPlugin,
  Project,
} from "../src/core/types.ts";
import {
  applyAnnotationImport,
  prepareAnnotationImport,
} from "../src/core/import.ts";
import { recordMouseFrames } from "../src/core/dynamic.ts";
import { availableAISuggestions, keyframePlan } from "../src/core/keyframes.ts";

const first = { x: 10, y: 12, width: 20, height: 18 };
const second = { x: 100, y: 40, width: 25, height: 18 };
const noPixels = {
  read: async () => {
    throw new Error("不应读取像素");
  },
};
function empty() {
  return createProject({
    kind: "demo",
    fileName: "same-class",
    width: 160,
    height: 90,
    duration: 1,
    fps: 10,
  });
}
function twoObjects() {
  const one = drawManualBox(empty(), 1, 0, first, 1);
  const two = drawManualBox(one.project, one.trackId, 0, second, 1);
  let p = manualAnnotation(two.project, 1, 9, { ...first, x: 25 });
  p = manualAnnotation(p, 2, 9, { ...second, x: 110 });
  return p;
}
const candidate = (trackId: number): Annotation => ({
  trackId,
  frame: 4,
  box: trackId === 1 ? { ...first, x: 16 } : { ...second, x: 104 },
  source: "assist",
  review: "pending",
});
const assist: AnnotationAssistPlugin = {
  id: "flow-fixture",
  name: "fixture",
  description: "fixture",
  generate: async ({ trackId }) => [candidate(trackId)],
};
const batch = (p: Project, mode: "assist" | "fill", trackIds = [1, 2]) =>
  runAnnotationBatch({
    project: p,
    trackIds,
    mode,
    plugin: mode === "assist" ? assist : linearInterpolation,
    reader: noPixels,
    signal: new AbortController().signal,
    onProgress: () => {},
  });
async function throughAI(p = twoObjects()) {
  const human = confirmManualKeyframes(p, [1, 2]);
  const result = await batch(human, "assist");
  const generated = recordAIAttempt(
    mergeGenerated(human, result.annotations, "assist"),
    [1, 2],
  );
  const checked = bulkReview(generated, result.annotations, "confirmed");
  return confirmAIKeyframes(checked, [1, 2]);
}

test("two consecutive drawings of the same class create independent objects, while edits and later frames preserve identity", () => {
  const blank = empty();
  const one = drawManualBox(blank, 1, 0, first, 1);
  assert.equal(one.created, false);
  const two = drawManualBox(one.project, 1, 0, second, 1);
  assert.equal(two.created, true);
  assert.equal(two.trackId, 2);
  assert.deepEqual(
    two.project.tracks.map((t) => t.labelId),
    [1, 1],
  );
  assert.deepEqual(
    two.project.annotations.map((a) => a.box),
    [first, second],
  );
  const later = drawManualBox(two.project, 2, 1, { ...second, x: 102 }, 1);
  assert.equal(later.created, false);
  assert.equal(later.trackId, 2);
  const edited = manualAnnotation(later.project, 1, 0, { ...first, width: 22 });
  assert.equal(edited.tracks.length, 2);
  assert.deepEqual(
    edited.annotations.find((a) => a.trackId === 2 && a.frame === 0)!.box,
    second,
  );
  assert.deepEqual(blank.annotations, []);
  assert.equal(one.project.tracks.length, 1); // One undo snapshot restores box and object creation together.
  assert.deepEqual(parseProject(JSON.stringify(edited)), edited);
  const coco = builtInExporters.find((e) => e.id === "coco")!;
  const exported = JSON.parse(
    coco.export(two.project, { confirmedOnly: true, sampledOnly: false })[0]
      .text,
  );
  assert.equal(exported.annotations.length, 2);
  assert.equal(
    new Set(
      exported.annotations.map((a: { category_id: number }) => a.category_id),
    ).size,
    1,
  );
});

test("choosing a class for a new box cannot reclassify an existing object's history", () => {
  const one = drawManualBox(empty(), 1, 0, first, 1);
  const otherClass = drawManualBox(one.project, 1, 0, second, 2);
  assert.deepEqual(
    otherClass.project.tracks.map((t) => t.labelId),
    [1, 2],
  );
  assert.deepEqual(
    otherClass.project.annotations[0],
    one.project.annotations[0],
  );
  const placeholder = drawManualBox(empty(), 1, 0, second, 2);
  assert.equal(placeholder.project.tracks.length, 1);
  assert.equal(placeholder.project.tracks[0].labelId, 2);
});

test("drawing beside a locked, hidden or out-of-range object creates a separate editable object; redrawing a removed box keeps its identity", () => {
  const one = drawManualBox(empty(), 1, 0, first, 1).project;
  for (const p of [
    editTrack(one, 1, { locked: true }),
    editTrack(one, 1, { hidden: true }),
    setTrackRange(one, 1, 0, 0),
  ]) {
    const drawn = drawManualBox(p, 1, 1, second, 1);
    assert.equal(drawn.trackId, 2);
    assert.deepEqual(
      drawn.project.annotations.find((a) => a.trackId === 1),
      p.annotations[0],
    );
  }
  const removed = reviewAnnotation(one, 1, 0, "rejected");
  assert.equal(drawManualBox(removed, 1, 0, first, 1).created, false);
  assert.throws(() => drawManualBox(one, 1, 10, second, 1), /起始帧|区间/);
});

test("a real batch cannot run AI before human review, or fill before every AI candidate is resolved and the stage is completed", async () => {
  const p = twoObjects();
  await assert.rejects(batch(p, "assist"), /先确认.*人工/);
  const human = confirmManualKeyframes(p, [1, 2]);
  assert.equal(reviewFlowState(human, [1, 2]).stage, "assist");
  assert.throws(() => confirmAIKeyframes(human, [1, 2]), /先生成/);
  await assert.rejects(batch(human, "fill"), /AI.*复核/);
  const result = await batch(human, "assist");
  const generated = recordAIAttempt(
    mergeGenerated(human, result.annotations, "assist"),
    [1, 2],
  );
  assert.throws(() => confirmAIKeyframes(generated, [1, 2]), /所有 AI/);
  assert.throws(() => confirmAIKeyframes(generated, [1, 2], true), /已有 AI/);
  await assert.rejects(batch(generated, "fill"), /AI.*复核/);
  const oneReviewed = reviewAnnotation(generated, 1, 4, "confirmed");
  assert.throws(() => confirmAIKeyframes(oneReviewed, [1, 2]), /所有 AI/);
  const checked = reviewAnnotation(oneReviewed, 2, 4, "confirmed");
  await assert.rejects(batch(checked, "fill"), /AI.*复核/);
  const complete = confirmAIKeyframes(checked, [1, 2]);
  const fill = await batch(complete, "fill");
  assert.equal(fill.annotations.length, 14);
  assert.ok(
    fill.annotations.every(
      (a) => a.review === "pending" && a.source === "interpolated",
    ),
  );
});

test("editing a human frame resets that object's two approvals, keeps another object's progress, and undo/backup restore the matching stage", async () => {
  const complete = await throughAI();
  const changed = manualAnnotation(complete, 1, 0, { ...first, x: 11 });
  assert.equal(keyframeReviewState(changed, 1).manualDone, false);
  assert.equal(keyframeReviewState(changed, 1).aiDone, false);
  assert.equal(keyframeReviewState(changed, 2).aiDone, true);
  assert.equal(reviewFlowState(changed, [1, 2]).stage, "manual");
  await assert.rejects(batch(changed, "fill"), /人工/);
  const humanAgain = confirmManualKeyframes(changed, [1]);
  assert.equal(keyframeReviewState(humanAgain, 1).aiDone, false);
  assert.equal(reviewFlowState(humanAgain, [1, 2]).stage, "assist");
  assert.equal(reviewFlowState(complete, [1, 2]).stage, "derived");
  const restored = parseProject(JSON.stringify(complete));
  assert.equal(reviewFlowState(restored, [1, 2]).stage, "derived");
  const deleted = removeTrack(restored, 1);
  assert.deepEqual(
    deleted.keyframeReviews!.map((r) => r.trackId),
    [2],
  );
  assert.deepEqual(parseProject(JSON.stringify(deleted)), deleted);
});

test("rejecting/restoring AI or changing its interval returns to AI review; presentation-only changes keep approvals", async () => {
  const complete = await throughAI();
  const rejected = reviewAnnotation(complete, 1, 4, "rejected");
  assert.equal(keyframeReviewState(rejected, 1).manualDone, true);
  assert.equal(keyframeReviewState(rejected, 1).aiDone, false);
  assert.equal(reviewFlowState(rejected, [1]).stage, "assist");
  const interval = {
    ...complete,
    settings: { ...complete.settings, assistInterval: 3 },
  };
  assert.equal(keyframeReviewState(interval, 1).manualDone, true);
  assert.equal(keyframeReviewState(interval, 1).aiDone, false);
  const presented = editTrack(complete, 1, { name: "车辆 A", hidden: true });
  assert.equal(keyframeReviewState(presented, 1).aiDone, true);
  const reclassed = editTrack(complete, 1, { labelId: 2 });
  assert.equal(keyframeReviewState(reclassed, 1).manualDone, false);
});

test("explicit AI skipping uses reviewed human anchors, and old confirmed files cannot silently bypass the review sequence", async () => {
  const old = parseProject(JSON.stringify(twoObjects()));
  assert.equal(reviewFlowState(old, [1, 2]).stage, "manual");
  assert.throws(() => confirmAIKeyframes(old, [1, 2], true), /人工.*复核/);
  const human = confirmManualKeyframes(old, [1, 2]);
  const skipped = confirmAIKeyframes(human, [1, 2], true);
  assert.equal(keyframeReviewState(skipped, 1).aiSkipped, true);
  assert.equal(readiness(skipped, 1, "fill", "linear"), "");
  assert.equal((await batch(skipped, "fill")).annotations.length, 16);
});

test("a completed AI attempt with no candidates can finish review, while failed/unrun targets remain gated", () => {
  const human = confirmManualKeyframes(twoObjects(), [1, 2]);
  const triedOne = recordAIAttempt(human, [1]);
  assert.throws(() => confirmAIKeyframes(triedOne, [1, 2]), /先生成/);
  const triedBoth = recordAIAttempt(triedOne, [2]);
  assert.equal(
    reviewFlowState(confirmAIKeyframes(triedBoth, [1, 2]), [1, 2]).stage,
    "derived",
  );
  const rerun = recordAIAttempt(confirmAIKeyframes(triedBoth, [1, 2]), [1]);
  assert.equal(keyframeReviewState(rerun, 1).aiDone, false);
});

test("new same-class objects reset a shared scope, while locked/unseeded objects do not block unrelated reviewed targets", async () => {
  const complete = await throughAI();
  const third = drawManualBox(complete, 2, 0, { ...second, y: 65 }, 1).project;
  assert.equal(keyframeReviewState(third, 1).aiDone, true);
  assert.equal(reviewFlowState(third, [1, 2, 3]).stage, "manual");
  assert.equal(
    reviewFlowState(editTrack(third, 3, { locked: true }), [1, 2, 3]).stage,
    "derived",
  );
  assert.equal(reviewFlowState(third, [1, 2]).stage, "derived");
});

test("imported pending manual frames need explicit review and forged/malformed review metadata is validated", () => {
  const p = setAnnotations(empty(), [
    { trackId: 1, frame: 0, box: first, source: "manual", review: "pending" },
  ]);
  const reviewed = confirmManualKeyframes(p, [1]);
  assert.equal(reviewed.annotations[0].review, "confirmed");
  assert.equal(keyframeReviewState(reviewed, 1).manualDone, true);
  for (const keyframeReviews of [
    [{ trackId: 50 }],
    [{ trackId: 1, manualStamp: "bad" }],
    [{ trackId: 1 }, { trackId: 1 }],
  ])
    assert.throws(
      () => parseProject(JSON.stringify({ ...reviewed, keyframeReviews })),
      /复核记录/,
    );
});

test("native annotation replacement clears review receipts from the previous task", async () => {
  const previous = await throughAI();
  const files = builtInExporters
    .find((e) => e.id === "coco")!
    .export(twoObjects(), { confirmedOnly: true, sampledOnly: false });
  const imported = applyAnnotationImport(
    prepareAnnotationImport(files, "annotations.json"),
    previous,
  );
  assert.deepEqual(imported.keyframeReviews, []);
  assert.equal(
    reviewFlowState(
      imported,
      imported.tracks.map((t) => t.id),
    ).stage,
    "manual",
  );
  assert.deepEqual(parseProject(JSON.stringify(imported)), imported);
});

test("continuous mouse recording returns its object to human review without resetting another object's approval", async () => {
  const complete = await throughAI();
  const recorded = recordMouseFrames(
    complete,
    1,
    { frame: 1, x: 20, y: 20 },
    { frame: 5, x: 30, y: 20 },
  );
  const changed = setAnnotations(complete, recorded);
  assert.deepEqual(
    recorded.map((a) => a.frame),
    [2, 3, 4, 5],
  );
  assert.equal(keyframeReviewState(changed, 1).manualDone, false);
  assert.equal(keyframeReviewState(changed, 2).aiDone, true);
  assert.equal(reviewFlowState(complete, [1, 2]).stage, "derived");
});

test("quality signals after filling cannot suggest AI again on already annotated frames or confuse classes", async () => {
  const complete = await throughAI();
  const fill = await batch(complete, "fill");
  const filled = mergeGenerated(complete, fill.annotations, "fill");
  assert.equal(availableAISuggestions(filled, 1).length, 0);
  assert.equal(availableAISuggestions(filled, 2).length, 0);
  const withRisk = {
    ...filled,
    annotations: filled.annotations.map((a) =>
      a.trackId === 1 && a.frame === 6 ? { ...a, score: 0.4 } : a,
    ),
  };
  withRisk.settings = {
    ...withRisk.settings,
    assistInterval: 2,
    manualInterval: 5,
    keyframeStrategy: "quality",
  };
  assert.ok(
    keyframePlan(withRisk, 1).manualSuggestions.some(
      (p) => p.reason === "low-correlation",
    ),
  );
  assert.equal(availableAISuggestions(withRisk, 1).length, 0);
});
