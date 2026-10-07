import test from "node:test";
import assert from "node:assert/strict";
import { createProject } from "../src/core/project.ts";
import { builtInExporters, exportManifest } from "../src/plugins/exporters.ts";
const options = { confirmedOnly: false, sampledOnly: false };
function fixture() {
  const p = createProject({
    kind: "video",
    fileName: "unit.mp4",
    width: 100,
    height: 80,
    duration: 1,
    fps: 10,
  });
  p.labels = [
    { id: 7, name: '车辆 & "A"', color: "#4478ef" },
    { id: 12, name: "person", color: "#13a896" },
  ];
  p.tracks = [
    { id: 4, labelId: 7, name: "object1" },
    { id: 9, labelId: 12, name: "object2" },
  ];
  p.annotations = [
    {
      frame: 0,
      trackId: 4,
      source: "manual",
      review: "confirmed",
      box: { x: 10, y: 20, width: 20, height: 10 },
    },
    {
      frame: 3,
      trackId: 9,
      source: "tracked",
      review: "pending",
      score: 0.8,
      box: { x: 40, y: 10, width: 25, height: 30 },
    },
  ];
  return p;
}
const adapter = (id: string) => builtInExporters.find((a) => a.id === id)!;
test("Datumaro uses zero-based label indices, pixel bbox and height-width size", () => {
  const data = JSON.parse(
    adapter("datumaro").export(fixture(), options)[0].text,
  );
  assert.equal(data.dm_format_version, "1.0");
  assert.deepEqual(data.items[0].image.size, [80, 100]);
  assert.equal(data.items[0].annotations[0].label_id, 0);
  assert.equal(data.items[1].annotations[0].label_id, 1);
  assert.deepEqual(data.items[0].annotations[0].bbox, [10, 20, 20, 10]);
  assert.equal(data.items[1].annotations[0].attributes.review, "pending");
});
test("Label Studio converts to percent while Create ML uses pixel centers", () => {
  const files = adapter("label-studio").export(fixture(), options),
    task = JSON.parse(files[0].text)[0];
  const result = task.annotations[0].result[0];
  assert.deepEqual(result.value, {
    x: 10,
    y: 25,
    width: 20,
    height: 12.5,
    rotation: 0,
    rectanglelabels: ['车辆 & "A"'],
  });
  assert.equal(result.original_width, 100);
  assert.equal(result.original_height, 80);
  assert.match(files[1].text, /车辆 &amp; &quot;A&quot;/);
  const ml = JSON.parse(
    adapter("create-ml").export(fixture(), options)[0].text,
  );
  assert.deepEqual(ml[0].annotations[0].coordinates, {
    x: 20,
    y: 25,
    width: 20,
    height: 10,
  });
});
test("Open Images normalizes boundaries and includes class/size metadata", () => {
  const files = adapter("open-images").export(fixture(), options),
    values = files[0].text.split("\n")[1].split(",");
  assert.deepEqual(values.slice(2, 8), [
    "/frameflow/7",
    "1",
    "0.1",
    "0.3",
    "0.25",
    "0.375",
  ]);
  assert.match(files[1].text, /"车辆 & ""A"""/);
  assert.match(files[2].text, /frame_000000 80 100/);
});
test("KITTI preserves all 15 columns, unknown 3D fields and original label mapping", () => {
  const files = adapter("kitti").export(fixture(), options),
    columns = files[0].text.trim().split(" ");
  assert.equal(columns.length, 15);
  assert.equal(columns[0], "label_7");
  assert.deepEqual(columns.slice(4, 8).map(Number), [10, 20, 30, 30]);
  assert.deepEqual(
    columns.slice(8).map(Number),
    [-1, -1, -1, -1000, -1000, -1000, -10],
  );
  assert.equal(JSON.parse(files[2].text).label_7, '车辆 & "A"');
});
test("CVAT image and MIT LabelMe XML escape labels and distinguish unconfirmed boxes", () => {
  const p = fixture(),
    cvat = adapter("cvat-images").export(p, options)[0].text;
  assert.match(cvat, /<image id="1" name="images\/frame_000003.jpg"/);
  assert.match(cvat, /source="auto"/);
  const xml = adapter("labelme-xml").export(p, options);
  assert.match(xml[0].text, /车辆 &amp; &quot;A&quot;/);
  assert.match(xml[1].text, /<verified>0<\/verified>/);
});
test("format-specific image paths and manifests agree, and full backup includes rejected frames", () => {
  const p = fixture();
  assert.equal(
    adapter("darknet").imagePath!(0),
    "obj_train_data/frame_000000.jpg",
  );
  assert.equal(adapter("via").imagePath!(0), "frame_000000.jpg");
  assert.equal(
    adapter("labelme-xml").imagePath!(0),
    "Images/default/frame_000000.jpg",
  );
  assert.equal(
    adapter("kitti").imagePath!(0),
    "training/image_2/frame_000000.jpg",
  );
  const manifest = exportManifest(p, options, "darknet");
  assert.ok(manifest[1].text.includes(adapter("darknet").imagePath!(0)));
  for (const a of builtInExporters) {
    for (const file of a.export(p, options))
      if (file.path.endsWith(".json"))
        assert.doesNotThrow(() => JSON.parse(file.text));
  }
  p.annotations[1].review = "rejected";
  const backup = JSON.parse(
    adapter("project").export(p, { confirmedOnly: true, sampledOnly: true })[0]
      .text,
  );
  assert.equal(backup.annotations.length, 2);
});
