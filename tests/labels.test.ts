import test from "node:test";
import assert from "node:assert/strict";
import { createProject, parseProject } from "../src/core/project.ts";
import { removeLabel } from "../src/core/labels.ts";

test("removing default or unused categories keeps every track reference valid", () => {
  const original = createProject();
  const removed = removeLabel(original, 1);
  assert.deepEqual(
    removed.labels.map((l) => l.id),
    [2],
  );
  assert.equal(removed.tracks[0].labelId, 2);
  assert.equal(original.tracks[0].labelId, 1);
  assert.deepEqual(parseProject(JSON.stringify(removed)), removed);
  assert.equal(removeLabel(original, 2).tracks[0].labelId, 1);
});

test("deleting an annotated category requires explicit migration and preserves all boxes", () => {
  const original = createProject();
  original.annotations = [
    {
      trackId: 1,
      frame: 0,
      source: "manual",
      review: "confirmed",
      box: { x: 10, y: 10, width: 20, height: 20 },
    },
  ];
  const snapshot = JSON.stringify(original);
  assert.throws(() => removeLabel(original, 1), /迁移/);
  assert.throws(() => removeLabel(original, 1, 1), /无效/);
  const removed = removeLabel(original, 1, 2);
  assert.equal(removed.annotations, original.annotations);
  assert.equal(removed.tracks[0].labelId, 2);
  assert.equal(JSON.stringify(original), snapshot);
  assert.deepEqual(parseProject(JSON.stringify(removed)), removed);
});

test("the last category and unknown categories cannot create an invalid saved project", () => {
  const p = removeLabel(createProject(), 2);
  assert.throws(() => removeLabel(p, 1), /至少保留/);
  assert.throws(() => removeLabel(p, 123), /不存在/);
});
