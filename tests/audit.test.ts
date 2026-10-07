import test from "node:test";
import assert from "node:assert/strict";
import { createProject, setTaskFrameRate } from "../src/core/project.ts";
import { auditIsCurrent, updateAuditFinding } from "../src/core/audit.ts";
import { qualityReview } from "../src/plugins/quality-review.ts";
import type { AuditReport, Project } from "../src/core/types.ts";

function fixture() {
  const p = setTaskFrameRate(
    createProject({
      kind: "video",
      fileName: "audit.mp4",
      width: 200,
      height: 100,
      duration: 0.5,
      fps: 60,
    }),
    20,
  );
  p.annotations = Array.from({ length: 10 }, (_, frame) => ({
    frame,
    trackId: 1,
    source: "manual",
    review: "confirmed",
    box: { x: 20 + frame * 2, y: 30, width: 20, height: 10 },
  }));
  return p;
}
const run = (
  project: Project,
  signal = new AbortController().signal,
  onProgress = (_done: number, _total: number) => {},
) =>
  qualityReview.review({
    project,
    signal,
    onProgress,
    reader: {
      read: async () => {
        throw new Error(
          "A metadata audit must not claim a model or pixel call",
        );
      },
    },
  });

test("a smooth confirmed 20-FPS trajectory has no rule findings and remains unchanged", async () => {
  const p = fixture(),
    snapshot = JSON.stringify(p);
  assert.deepEqual(await run(p), []);
  assert.equal(JSON.stringify(p), snapshot);
});
test("gap findings cover only intervals between actual annotations, never invent head/tail target presence", async () => {
  const p = fixture();
  p.annotations = [p.annotations[2], p.annotations[7]];
  const findings = await run(p),
    gaps = findings.filter((f) => f.type === "missing");
  assert.equal(gaps.length, 1);
  assert.equal(gaps[0].frame, 3);
  assert.equal(gaps[0].endFrame, 6);
  assert.ok(gaps[0].detail.includes("离开画面"));
  p.annotations.push({ ...p.annotations[0], frame: 4, review: "rejected" });
  assert.deepEqual(await run(p), []);
});
test("audit locates an abrupt wrong-object jump and abrupt box-size changes", async () => {
  const p = fixture();
  p.annotations[3].box.x = 150;
  p.annotations[7].box = { x: 34, y: 10, width: 60, height: 40 };
  const findings = await run(p);
  assert.ok(findings.some((f) => f.type === "jump" && f.frame === 3));
  assert.ok(findings.some((f) => f.type === "size" && f.frame === 7));
  assert.ok(findings.every((f) => f.status === "open"));
});
test("low correlation and a pending range are separate findings and never auto-confirm candidates", async () => {
  const p = fixture();
  for (const frame of [4, 5, 6]) {
    p.annotations[frame].source = "assist";
    p.annotations[frame].review = "pending";
  }
  p.annotations[5].score = 0.65;
  const findings = await run(p),
    pending = findings.filter((f) => f.type === "pending");
  assert.equal(pending.length, 1);
  assert.equal(pending[0].frame, 4);
  assert.equal(pending[0].endFrame, 6);
  assert.ok(
    findings.some(
      (f) =>
        f.type === "correlation" &&
        f.frame === 5 &&
        f.detail.includes("不是正确率"),
    ),
  );
  assert.equal(p.annotations[5].review, "pending");
});
test("audit cancellation before start and between tracks rejects atomically", async () => {
  const p = fixture(),
    aborted = new AbortController();
  aborted.abort();
  await assert.rejects(
    () => run(p, aborted.signal),
    (error) => error instanceof DOMException && error.name === "AbortError",
  );
  p.tracks.push({ ...p.tracks[0], id: 2 });
  p.annotations.push(...p.annotations.map((a) => ({ ...a, trackId: 2 })));
  const ctrl = new AbortController(),
    snapshot = JSON.stringify(p);
  await assert.rejects(() => run(p, ctrl.signal, () => ctrl.abort()), /abort/i);
  assert.equal(JSON.stringify(p), snapshot);
});
test("handling a finding changes only the report, not the annotation or audit scope", async () => {
  const p = fixture();
  p.annotations[5].review = "pending";
  const findings = await run(p),
    report: AuditReport = {
      schemaVersion: 1,
      projectId: p.id,
      projectName: p.name,
      media: p.media,
      reviewedAt: "2026-10-07T00:00:00Z",
      engineId: qualityReview.id,
      annotationCount: p.annotations.length,
      scope: "existing-track-intervals",
      findings,
    };
  const handled = updateAuditFinding(report, findings[0].id, "checked");
  assert.equal(handled.findings[0].status, "checked");
  assert.equal(report.findings[0].status, "open");
  assert.equal(p.annotations[5].review, "pending");
  assert.throws(() => updateAuditFinding(report, "unknown", "dismissed"));
});
test("changing geometry, frame mapping or categories invalidates an audit while a tool setting does not", () => {
  const p = fixture();
  assert.equal(
    auditIsCurrent({ ...p, settings: { ...p.settings, boxWidth: 40 } }, p),
    true,
  );
  assert.equal(
    auditIsCurrent(
      {
        ...p,
        annotations: p.annotations.map((a) => ({
          ...a,
          box: { ...a.box, x: a.box.x + 1 },
        })),
      },
      p,
    ),
    false,
  );
  assert.equal(
    auditIsCurrent({ ...p, media: { ...p.media, fps: 10 } }, p),
    false,
  );
  assert.equal(
    auditIsCurrent(
      { ...p, labels: p.labels.map((l) => ({ ...l, name: "renamed" })) },
      p,
    ),
    false,
  );
});
