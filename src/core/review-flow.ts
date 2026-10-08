import type { Annotation, KeyframeReview, Project } from "./types.ts";
import { frameCount } from "./project.ts";

export type ReviewStage = "manual" | "assist" | "derived";

// A compact content stamp, not a security signature. Keeping the approval with
// its input makes edits, undo/redo and restored projects obey the same gates.
function stamp(value: unknown) {
  const text = JSON.stringify(value);
  let first = 2166136261,
    second = 5381;
  for (let i = 0; i < text.length; i++) {
    first = Math.imul(first ^ text.charCodeAt(i), 16777619);
    second = Math.imul(second, 33) ^ text.charCodeAt(i);
  }
  return `${(first >>> 0).toString(16).padStart(8, "0")}:${(second >>> 0).toString(16).padStart(8, "0")}:${text.length}`;
}
function annotationInput(a: Annotation) {
  return [a.frame, a.review, a.box.x, a.box.y, a.box.width, a.box.height];
}
export function keyframeReviewState(project: Project, trackId: number) {
  const track = project.tracks.find((t) => t.id === trackId);
  if (!track) throw new Error("对象不存在。");
  const entries = project.annotations
    .filter((a) => a.trackId === trackId)
    .sort((a, b) => a.frame - b.frame);
  const manual = entries.filter((a) => a.source === "manual");
  const ai = entries.filter((a) => a.source === "assist");
  const manualStamp = stamp([
    project.media.width,
    project.media.height,
    project.media.fps,
    project.media.duration,
    track.labelId,
    project.labels.find((l) => l.id === track.labelId)?.name,
    track.startFrame ?? 0,
    track.endFrame ?? frameCount(project.media) - 1,
    manual.map(annotationInput),
  ]);
  const aiInputStamp = stamp([manualStamp, project.settings.assistInterval]);
  const aiStamp = stamp([aiInputStamp, ai.map(annotationInput)]);
  const receipt = project.keyframeReviews?.find((r) => r.trackId === trackId);
  const hasManual = manual.some((a) => a.review !== "rejected");
  const manualDone = hasManual && receipt?.manualStamp === manualStamp;
  const aiPending = ai.filter((a) => a.review === "pending").length;
  const aiAttempted = receipt?.aiRunStamp === aiInputStamp || ai.length > 0;
  const aiDone = manualDone && receipt?.aiStamp === aiStamp && aiPending === 0;
  return {
    hasManual,
    manualDone,
    aiDone,
    aiPending,
    aiAttempted,
    aiSkipped: aiDone && !!receipt?.aiSkipped,
    manualStamp,
    aiInputStamp,
    aiStamp,
  };
}
export function reviewTargets(project: Project, ids: number[]) {
  return ids.filter((id) => {
    const track = project.tracks.find((t) => t.id === id);
    return track && !track.locked && keyframeReviewState(project, id).hasManual;
  });
}
export function reviewFlowState(project: Project, ids: number[]) {
  const targets = reviewTargets(project, ids);
  const states = targets.map((id) => keyframeReviewState(project, id));
  const manualDone = states.length > 0 && states.every((s) => s.manualDone);
  const aiDone = manualDone && states.every((s) => s.aiDone);
  return {
    targets,
    skipped: ids.length - targets.length,
    manualDone,
    aiDone,
    manualRemaining: states.filter((s) => !s.manualDone).length,
    aiRemaining: states.filter((s) => !s.aiDone).length,
    stage: (!manualDone
      ? "manual"
      : !aiDone
        ? "assist"
        : "derived") as ReviewStage,
  };
}
function receipts(project: Project, changes: KeyframeReview[]): Project {
  const byId = new Map(project.keyframeReviews?.map((r) => [r.trackId, r]));
  for (const change of changes) byId.set(change.trackId, change);
  return {
    ...project,
    keyframeReviews: [...byId.values()].filter((r) =>
      project.tracks.some((t) => t.id === r.trackId),
    ),
  };
}
export function confirmManualKeyframes(
  project: Project,
  ids: number[],
): Project {
  const targets = reviewTargets(project, ids);
  if (!targets.length) throw new Error("请先画人工参考框，再确认人工关键帧。");
  const next: Project = {
    ...project,
    annotations: project.annotations.map((a) =>
      targets.includes(a.trackId) &&
      a.source === "manual" &&
      a.review === "pending"
        ? { ...a, review: "confirmed" }
        : a,
    ),
  };
  return receipts(
    next,
    targets.map((trackId) => {
      const old = project.keyframeReviews?.find((r) => r.trackId === trackId);
      const state = keyframeReviewState(next, trackId);
      return { ...old, trackId, manualStamp: state.manualStamp };
    }),
  );
}
export function recordAIAttempt(project: Project, ids: number[]): Project {
  return receipts(
    project,
    ids.map((trackId) => {
      const state = keyframeReviewState(project, trackId);
      if (!state.manualDone) throw new Error("请先完成人工关键帧复核。");
      const old = project.keyframeReviews?.find((r) => r.trackId === trackId);
      return {
        ...old,
        trackId,
        aiRunStamp: state.aiInputStamp,
        aiStamp: undefined,
        aiSkipped: false,
      };
    }),
  );
}
export function confirmAIKeyframes(
  project: Project,
  ids: number[],
  skip = false,
): Project {
  const targets = reviewTargets(project, ids);
  if (!targets.length) throw new Error("请先画人工参考框。");
  return receipts(
    project,
    targets.map((trackId) => {
      const state = keyframeReviewState(project, trackId);
      if (!state.manualDone) throw new Error("请先完成人工关键帧复核。");
      const ai = project.annotations.filter(
        (a) => a.trackId === trackId && a.source === "assist",
      );
      if (skip && ai.some((a) => a.review !== "rejected"))
        throw new Error("已有 AI 标注，请先确认或拒绝候选。");
      if (!skip && !state.aiAttempted)
        throw new Error("请先生成 AI 关键帧，或选择仅用人工帧。");
      if (state.aiPending)
        throw new Error("请先确认或拒绝所有 AI 关键帧候选。");
      const old = project.keyframeReviews?.find((r) => r.trackId === trackId);
      return { ...old, trackId, aiStamp: state.aiStamp, aiSkipped: skip };
    }),
  );
}
