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

const labelKey = (name: string) =>
  name.trim().normalize("NFC").toLocaleLowerCase();
export function editLabel(
  project: Project,
  id: number,
  change: { name?: string; color?: string },
): Project {
  if (!project.labels.some((l) => l.id === id)) throw new Error("类别不存在。");
  const name = change.name?.trim();
  if (name !== undefined && (!name || name.length > 80))
    throw new Error("类别名称应为 1–80 个字符。");
  if (
    name !== undefined &&
    project.labels.some(
      (l) => l.id !== id && labelKey(l.name) === labelKey(name),
    )
  )
    throw new Error("类别名称已存在，请使用不同名称。");
  if (change.color !== undefined && !/^#[0-9a-f]{6}$/i.test(change.color))
    throw new Error("类别颜色无效。");
  return {
    ...project,
    labels: project.labels.map((l) =>
      l.id === id
        ? {
            ...l,
            ...(name === undefined ? {} : { name }),
            ...(change.color === undefined
              ? {}
              : { color: change.color.toLowerCase() }),
          }
        : l,
    ),
  };
}
export function addLabel(project: Project, rawName: string): Project {
  const name = rawName.trim();
  if (!name || name.length > 80) throw new Error("类别名称应为 1–80 个字符。");
  if (project.labels.some((l) => labelKey(l.name) === labelKey(name)))
    throw new Error("类别名称已存在，请使用不同名称。");
  const colors = [
    "#4478ef",
    "#13a896",
    "#e6a342",
    "#ac85d8",
    "#df628e",
    "#568ba4",
  ];
  return {
    ...project,
    labels: [
      ...project.labels,
      {
        id: Math.max(0, ...project.labels.map((l) => l.id)) + 1,
        name,
        color: colors[project.labels.length % colors.length],
      },
    ],
  };
}
