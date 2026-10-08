import type { Annotation, Box, Project, Track } from "./types.ts";
import {
  clampBox,
  frameCount,
  invalidateDerived,
  setAnnotations,
} from "./project.ts";

export type OperationScope = "all" | "label" | "track";
export const SCOPE_NAMES: Record<OperationScope, string> = {
  all: "全部对象",
  label: "当前类别",
  track: "当前对象",
};
export type JobMode = "assist" | "fill";

export function trackBounds(project: Project, id: number) {
  const track = project.tracks.find((t) => t.id === id);
  if (!track) throw new Error("对象不存在。");
  return {
    start: track.startFrame ?? 0,
    end: track.endFrame ?? frameCount(project.media) - 1,
  };
}
export function scopedTrackIds(
  project: Project,
  activeId: number,
  scope: OperationScope,
  includeLocked = false,
) {
  const labelId = project.tracks.find((t) => t.id === activeId)?.labelId;
  return project.tracks
    .filter(
      (t) =>
        (includeLocked || !t.locked) &&
        (scope === "all" ||
          (scope === "track" ? t.id === activeId : t.labelId === labelId)),
    )
    .map((t) => t.id);
}
export function addTrack(
  project: Project,
  labelId: number,
  start = 0,
): Project {
  if (!project.labels.some((l) => l.id === labelId))
    throw new Error("类别不存在。");
  if (
    !Number.isInteger(start) ||
    start < 0 ||
    start >= frameCount(project.media)
  )
    throw new Error("对象起始帧无效。");
  const id = Math.max(0, ...project.tracks.map((t) => t.id)) + 1;
  return {
    ...project,
    tracks: [
      ...project.tracks,
      {
        id,
        labelId,
        name: `目标 ${String(id).padStart(2, "0")}`,
        startFrame: start,
      },
    ],
  };
}
export function editTrack(
  project: Project,
  id: number,
  change: Partial<Pick<Track, "name" | "labelId" | "locked" | "hidden">>,
): Project {
  if (!project.tracks.some((t) => t.id === id)) throw new Error("对象不存在。");
  if (
    project.tracks.find((t) => t.id === id)?.locked &&
    (change.name !== undefined || change.labelId !== undefined)
  )
    throw new Error("请先解锁对象。");
  if (
    change.name !== undefined &&
    (!change.name.trim() || change.name.trim().length > 80)
  )
    throw new Error("对象名称应为 1–80 个字符。");
  if (
    change.labelId !== undefined &&
    !project.labels.some((l) => l.id === change.labelId)
  )
    throw new Error("类别不存在。");
  return {
    ...project,
    tracks: project.tracks.map((t) =>
      t.id === id
        ? {
            ...t,
            ...change,
            ...(change.name === undefined ? {} : { name: change.name.trim() }),
          }
        : t,
    ),
  };
}
export function removeTrack(project: Project, id: number): Project {
  const track = project.tracks.find((t) => t.id === id);
  if (!track) throw new Error("对象不存在。");
  if (track.locked) throw new Error("请先解锁对象。");
  if (project.tracks.length < 2)
    throw new Error("至少保留一个对象，可先添加新对象。");
  return {
    ...project,
    tracks: project.tracks.filter((t) => t.id !== id),
    annotations: project.annotations.filter((a) => a.trackId !== id),
  };
}
export function setTrackRange(
  project: Project,
  id: number,
  start: number,
  end: number,
): Project {
  const track = project.tracks.find((t) => t.id === id);
  if (!track) throw new Error("对象不存在。");
  if (track.locked) throw new Error("请先解锁对象。");
  if (
    !Number.isInteger(start) ||
    !Number.isInteger(end) ||
    start < 0 ||
    end < start ||
    end >= frameCount(project.media)
  )
    throw new Error("对象区间无效，请设置有效的开始帧与结束帧。");
  return {
    ...project,
    tracks: project.tracks.map((t) =>
      t.id === id ? { ...t, startFrame: start, endFrame: end } : t,
    ),
    annotations: project.annotations.filter(
      (a) => a.trackId !== id || (a.frame >= start && a.frame <= end),
    ),
  };
}
export function mergeGenerated(
  project: Project,
  generated: Annotation[],
  mode: JobMode,
  replacePending = false,
): Project {
  if (!generated.length) return project;
  const existing = new Map(
    project.annotations.map((a) => [`${a.trackId}:${a.frame}`, a]),
  );
  const entries = generated.filter((a) => {
    const track = project.tracks.find((t) => t.id === a.trackId);
    if (!track || track.locked) return false;
    const bounds = trackBounds(project, a.trackId);
    if (a.frame < bounds.start || a.frame > bounds.end) return false;
    const before = existing.get(`${a.trackId}:${a.frame}`);
    if (!before) return true;
    if (before.source === "manual" || before.review !== "pending") return false;
    if (mode === "fill" && before.source === "assist") return false;
    return replacePending;
  });
  return entries.length
    ? setAnnotations(
        project,
        entries.map((a) => ({ ...a, review: "pending" as const })),
        true,
      )
    : project;
}
export function restoreAnnotation(
  project: Project,
  id: number,
  frame: number,
): Project {
  if (project.tracks.find((t) => t.id === id)?.locked)
    throw new Error("请先解锁对象。");
  return {
    ...project,
    annotations: project.annotations.map((a) =>
      a.trackId === id && a.frame === frame && a.review === "rejected"
        ? { ...a, review: a.source === "manual" ? "confirmed" : "pending" }
        : a,
    ),
  };
}
export function copyFrameBox(
  project: Project,
  id: number,
  frame: number,
): Annotation | undefined {
  return project.annotations.find(
    (a) => a.trackId === id && a.frame === frame && a.review !== "rejected",
  );
}

export function manualAnnotation(
  project: Project,
  trackId: number,
  frame: number,
  box: Box,
): Project {
  const track = project.tracks.find((t) => t.id === trackId);
  if (!track) throw new Error("对象不存在。");
  if (track.locked) throw new Error("请先解锁对象。");
  if (track.hidden) throw new Error("请先显示对象再修改标注。");
  const bounds = trackBounds(project, trackId);
  if (frame < bounds.start || frame > bounds.end)
    throw new Error("当前帧不在对象区间，请先调整对象区间。");
  return setAnnotations(invalidateDerived(project, trackId, frame), [
    {
      trackId,
      frame,
      box: clampBox(box, project.media),
      source: "manual",
      review: "confirmed",
    },
  ]);
}

export function bulkReview(
  project: Project,
  selected: Annotation[],
  status: "confirmed" | "rejected",
): Project {
  const ids = new Set(
    selected
      .filter((a) => !project.tracks.find((t) => t.id === a.trackId)?.locked)
      .map((a) => `${a.trackId}:${a.frame}`),
  );
  let next: Project = {
    ...project,
    annotations: project.annotations.map((a) =>
      ids.has(`${a.trackId}:${a.frame}`) && a.review === "pending"
        ? { ...a, review: status }
        : a,
    ),
  };
  if (status === "rejected")
    for (const a of selected)
      if (ids.has(`${a.trackId}:${a.frame}`))
        next = invalidateDerived(next, a.trackId, a.frame);
  return next;
}
