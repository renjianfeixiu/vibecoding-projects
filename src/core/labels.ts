import type { Project } from "./types.ts";

export function removeLabel(
  project: Project,
  labelId: number,
  replacementId?: number,
): Project {
  if (!project.labels.some((label) => label.id === labelId))
    throw new Error("类别不存在。");
  const remaining = project.labels.filter((label) => label.id !== labelId);
  if (!remaining.length)
    throw new Error("至少保留一个类别，可先添加新类别再删除。");
  const affected = new Set(
    project.tracks.filter((t) => t.labelId === labelId).map((t) => t.id),
  );
  const hasAnnotations = project.annotations.some((a) =>
    affected.has(a.trackId),
  );
  if (hasAnnotations && replacementId === undefined)
    throw new Error("该类别已有标注，请先选择迁移到的类别。");
  const replacement = replacementId ?? remaining[0].id;
  if (!remaining.some((label) => label.id === replacement))
    throw new Error("迁移类别无效。");
  return {
    ...project,
    labels: remaining,
    tracks: project.tracks.map((track) =>
      affected.has(track.id) ? { ...track, labelId: replacement } : track,
    ),
  };
}
