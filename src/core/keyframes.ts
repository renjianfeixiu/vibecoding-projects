import type { Annotation, Project } from "./types.ts";
import { frameCount, LIMIT_FRAMES } from "./project.ts";

export const MATCH_REVIEW_THRESHOLD = 0.72;
export type SuggestionReason =
  | "start"
  | "end"
  | "interval"
  | "low-correlation"
  | "rejected";
export const SUGGESTION_REASONS: Record<SuggestionReason, string> = {
  start: "起始人工参考",
  end: "末帧人工参考",
  interval: "人工最大间隔兜底",
  "low-correlation": "候选匹配分数偏低，优先人工核对",
  rejected: "候选已被拒绝，优先人工重新定位",
};
export interface ManualSuggestion {
  frame: number;
  reason: SuggestionReason;
}
export interface AIPlanPoint {
  frame: number;
  anchorFrame: number;
  completed: boolean;
  ready: boolean;
}
export interface KeyframePlan {
  manualInterval: number;
  manualAnchors: number[];
  manualSuggestions: ManualSuggestion[];
  aiPoints: AIPlanPoint[];
}
export function manualInterval(project: Project) {
  return Math.min(
    LIMIT_FRAMES,
    Math.max(
      1,
      Math.round(project.settings.manualInterval ?? project.media.fps * 3),
    ),
  );
}
export function keyframePlan(project: Project, trackId: number): KeyframePlan {
  const last = frameCount(project.media) - 1;
  const interval = manualInterval(project);
  const aiInterval = project.settings.assistInterval;
  const entries = project.annotations.filter((a) => a.trackId === trackId);
  const byFrame = new Map(entries.map((a) => [a.frame, a]));
  const anchors = entries
    .filter((a) => a.source === "manual" && a.review === "confirmed")
    .map((a) => a.frame)
    .sort((a, b) => a - b);
  const actualManual = new Set(anchors);
  const points = new Map<number, SuggestionReason>([
    [0, "start"],
    [last, "end"],
  ]);
  for (const frame of anchors) points.set(frame, "interval");

  if (project.settings.keyframeStrategy !== "fixed") {
    const risk = new Map<number, Annotation>();
    for (const a of entries) {
      if (
        a.source === "manual" ||
        (a.review !== "rejected" &&
          (a.score === undefined || a.score >= MATCH_REVIEW_THRESHOLD))
      )
        continue;
      const window = Math.floor(a.frame / aiInterval),
        previous = risk.get(window);
      if (
        !previous ||
        (a.review === "rejected" && previous.review !== "rejected") ||
        ((a.review === "rejected") === (previous.review === "rejected") &&
          ((a.score ?? 1) < (previous.score ?? 1) ||
            ((a.score ?? 1) === (previous.score ?? 1) &&
              a.frame < previous.frame)))
      )
        risk.set(window, a);
    }
    for (const a of risk.values()) {
      if (!actualManual.has(a.frame))
        points.set(
          a.frame,
          a.review === "rejected" ? "rejected" : "low-correlation",
        );
    }
  }
  const seeds = [...points.keys()].sort((a, b) => a - b);
  for (let i = 1; i < seeds.length; i++) {
    const left = seeds[i - 1],
      distance = seeds[i] - left;
    const parts = Math.ceil(distance / interval);
    for (let part = 1; part < parts; part++)
      points.set(left + Math.floor((distance * part) / parts), "interval");
  }
  const manualFrames = [...points.keys()].sort((a, b) => a - b);
  const manualSuggestions = manualFrames
    .filter((frame) => !actualManual.has(frame))
    .map((frame) => ({ frame, reason: points.get(frame)! }));
  const aiPoints: AIPlanPoint[] = [];
  let anchorIndex = -1;
  const barriers = entries
    .filter((a) => a.review === "rejected")
    .map((a) => a.frame)
    .sort((a, b) => a - b);
  let barrierIndex = 0;
  for (let i = 1; i < manualFrames.length; i++) {
    const left = manualFrames[i - 1],
      right = manualFrames[i];
    for (let frame = left + aiInterval; frame < right; frame += aiInterval) {
      const existing = byFrame.get(frame);
      // Execution references the latest actual human box; a planned dot is not an annotation.
      while (
        anchorIndex + 1 < anchors.length &&
        anchors[anchorIndex + 1] < frame
      )
        anchorIndex++;
      const anchorFrame = anchors[anchorIndex];
      while (
        barrierIndex < barriers.length &&
        barriers[barrierIndex] <= (anchorFrame ?? -1)
      )
        barrierIndex++;
      aiPoints.push({
        frame,
        anchorFrame: anchorFrame ?? -1,
        ready:
          anchorFrame !== undefined &&
          (barriers[barrierIndex] === undefined ||
            barriers[barrierIndex] > frame),
        completed:
          existing?.source === "assist" && existing.review !== "rejected",
      });
    }
  }
  return {
    manualInterval: interval,
    manualAnchors: anchors,
    manualSuggestions,
    aiPoints,
  };
}

export function plannedAICandidates(project: Project, trackId: number) {
  return keyframePlan(project, trackId).aiPoints.filter((point) => point.ready);
}
