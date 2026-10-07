import type { Annotation, ExportOptions, Project } from "../core/types.ts";
import { exportAnnotations } from "../core/project.ts";
export const json = (data: unknown) => JSON.stringify(data, null, 2);
export const round = (v: number) => Number(v.toFixed(4));
export const escapeXml = (value: string) =>
  value.replace(
    /[<>&"']/g,
    (c) =>
      ({
        "<": "&lt;",
        ">": "&gt;",
        "&": "&amp;",
        '"': "&quot;",
        "'": "&apos;",
      })[c]!,
  );
export const csv = (value: string | number) =>
  typeof value === "string" && /[,"\r\n]/.test(value)
    ? `"${value.replace(/"/g, '""')}"`
    : String(value);
export function grouped(project: Project, options: ExportOptions) {
  const frames = new Map<number, Annotation[]>();
  for (const a of exportAnnotations(project, options))
    frames.set(a.frame, [...(frames.get(a.frame) || []), a]);
  return [...frames.entries()].sort(([a], [b]) => a - b);
}
export function labelOf(project: Project, a: Annotation) {
  return project.labels.find(
    (l) => l.id === project.tracks.find((t) => t.id === a.trackId)!.labelId,
  )!;
}
export const header = '<?xml version="1.0" encoding="UTF-8"?>\n';
