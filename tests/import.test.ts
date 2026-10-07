import test from "node:test";
import assert from "node:assert/strict";
import { strToU8, zipSync } from "fflate";
import {
  applyAnnotationImport,
  prepareAnnotationImport,
  readAnnotationFiles,
} from "../src/core/import.ts";
import { createProject } from "../src/core/project.ts";
import { builtInExporters, exportManifest } from "../src/plugins/exporters.ts";
import type { ImportTextFile } from "../src/core/types.ts";

function fixture() {
  const p = createProject({
    kind: "video",
    fileName: "fixture.mp4",
    width: 100,
    height: 80,
    fps: 10,
    duration: 1,
  });
  p.name = "导入测试";
  p.settings.samplingFps = 2;
  p.labels = [{ id: 7, name: '车, "A"', color: "#4478ef" }];
  p.tracks = [{ id: 4, labelId: 7, name: "车 01" }];
  p.annotations = [0, 3, 5, 8].map((frame) => ({
    frame,
    trackId: 4,
    box: { x: 10 + frame, y: 20, width: 20, height: 10 },
    source: frame === 0 ? "manual" : "tracked",
    review: frame === 3 ? "pending" : frame === 8 ? "rejected" : "confirmed",
  }));
  return p;
}
const nativeFiles = (id: string): ImportTextFile[] =>
  builtInExporters
    .find((a) => a.id === id)!
    .export(fixture(), { confirmedOnly: false, sampledOnly: false })
    .map((f) => ({ path: f.path, text: f.text }));
test("all 20 real exporter ZIP bundles reimport exact frame positions and source provenance", async () => {
  const p = fixture(),
    options = { confirmedOnly: true, sampledOnly: true };
  for (const adapter of builtInExporters) {
    const effective =
      adapter.id === "project"
        ? { confirmedOnly: false, sampledOnly: false }
        : options;
    const archive: Record<string, Uint8Array> = {};
    for (const f of [
      ...adapter.export(p, options),
      ...exportManifest(p, effective, adapter.id),
    ])
      archive[f.path] = strToU8(f.text);
    archive[adapter.imagePath?.(0) ?? "images/frame_000000.jpg"] =
      new Uint8Array([255, 216, 255, 217]);
    const blob = new File(
      [zipSync(archive).slice().buffer],
      `${adapter.id}.zip`,
    );
    const bundle = prepareAnnotationImport(
        await readAnnotationFiles([blob]),
        blob.name,
      ),
      restored = applyAnnotationImport(bundle, createProject(p.media));
    assert.deepEqual(
      restored.annotations,
      adapter.id === "project"
        ? p.annotations
        : [p.annotations[0], p.annotations[2]],
      adapter.id,
    );
    assert.deepEqual(restored.tracks, p.tracks, adapter.id);
    assert.deepEqual(restored.labels, p.labels, adapter.id);
  }
});
test("native COCO resolves source frame names independently of arbitrary image IDs", () => {
  const p = fixture(),
    file = {
      path: "annotations.json",
      text: JSON.stringify({
        images: [
          { id: 400, file_name: "frame_000005.jpg", width: 100, height: 80 },
          { id: 999, file_name: "frame_000000.jpg", width: 100, height: 80 },
        ],
        categories: [{ id: 7, name: '车, "A"' }],
        annotations: [
          { id: 1, image_id: 400, category_id: 7, bbox: [15, 20, 20, 10] },
          { id: 2, image_id: 999, category_id: 7, bbox: [10, 20, 20, 10] },
        ],
      }),
    };
  const restored = applyAnnotationImport(
    prepareAnnotationImport([file], "coco.json"),
    p,
  );
  assert.deepEqual(
    restored.annotations.map((a) => [a.frame, a.box.x]),
    [
      [0, 10],
      [5, 15],
    ],
  );
  assert.equal(
    restored.tracks.length,
    2,
    "image-only boxes must not invent a shared track identity",
  );
});
test("native YOLO maps normalized boxes to video pixels and loads names file", () => {
  const restored = applyAnnotationImport(
    prepareAnnotationImport(nativeFiles("yolo"), "labels"),
    fixture(),
  );
  assert.equal(restored.labels[0].name, '车, "A"');
  assert.deepEqual(
    restored.annotations.map((a) => a.frame),
    [0, 3, 5],
  );
  const b = restored.annotations[0].box;
  assert.ok(Math.abs(b.x - 10) < 0.0001 && Math.abs(b.y - 20) < 0.0001);
  assert.equal(b.width, 20);
  assert.equal(b.height, 10);
});
test("CSV quoted categories and LabelMe group IDs retain tracks across frames", () => {
  for (const id of ["csv", "labelme"]) {
    const restored = applyAnnotationImport(
      prepareAnnotationImport(nativeFiles(id), id),
      fixture(),
    );
    assert.equal(restored.labels[0].name, '车, "A"');
    assert.equal(restored.tracks.length, 1);
    assert.deepEqual(
      restored.annotations.map((a) => [a.frame, a.box.x]),
      [
        [0, 10],
        [3, 13],
        [5, 15],
      ],
    );
    if (id === "csv")
      assert.deepEqual(
        restored.annotations.map((a) => [a.source, a.review]),
        [
          ["manual", "confirmed"],
          ["tracked", "pending"],
          ["tracked", "confirmed"],
        ],
      );
  }
});
test("MOT one-based frames and coordinates become zero-based and retain track identity", () => {
  const restored = applyAnnotationImport(
    prepareAnnotationImport(nativeFiles("mot"), "gt.txt"),
    fixture(),
  );
  assert.equal(restored.tracks.length, 1);
  assert.deepEqual(
    restored.annotations.map((a) => [a.frame, a.box.x, a.box.y]),
    [
      [0, 10, 20],
      [3, 13, 20],
      [5, 15, 20],
    ],
  );
});
test("wrong media or out-of-range imported frame fails without modifying the project", () => {
  const p = fixture(),
    saved = JSON.stringify(p),
    bundle = prepareAnnotationImport(
      exportManifest(
        p,
        { confirmedOnly: false, sampledOnly: false },
        "coco",
      ).map((f) => ({ path: f.path, text: f.text })),
      "coco.zip",
    );
  assert.throws(
    () =>
      applyAnnotationImport(bundle, {
        ...p,
        media: { ...p.media, width: 101 },
      }),
    /不一致/,
  );
  const files = [{ path: "frame_000099.txt", text: "0 0.5 0.5 0.2 0.1\n" }];
  assert.throws(
    () => applyAnnotationImport(prepareAnnotationImport(files, "labels"), p),
    /帧号/,
  );
  assert.equal(JSON.stringify(p), saved);
});
