import { strFromU8, unzipSync } from "fflate";
import type { ImportTextFile, Project } from "./types.ts";
import {
  createProject,
  frameCount,
  parseProject,
  sourceFrameRate,
} from "./project.ts";
import { importPlugins } from "../plugins/registry.ts";

export interface AnnotationImportBundle {
  name: string;
  format: string;
  adapterId?: string;
  files: ImportTextFile[];
  project?: Project;
}
const MAX_BYTES = 50 * 1024 * 1024,
  MAX_FILES = 20000;
export async function readAnnotationFiles(
  files: File[],
): Promise<ImportTextFile[]> {
  if (!files.length) throw new Error("请选择标注文件。");
  if (files.reduce((n, f) => n + f.size, 0) > MAX_BYTES)
    throw new Error("标注文件超过 50 MB，请拆分后导入。");
  const result: ImportTextFile[] = [];
  let total = 0;
  for (const file of files) {
    if (/\.zip$/i.test(file.name)) {
      const archive = unzipSync(new Uint8Array(await file.arrayBuffer()), {
        filter: (entry) => {
          if (!/\.(json|xml|csv|txt|names)$/i.test(entry.name)) return false;
          total += entry.originalSize;
          if (total > MAX_BYTES)
            throw new Error("ZIP 中的标注文件超过 50 MB。");
          return true;
        },
      });
      for (const [path, data] of Object.entries(archive))
        result.push({ path, text: strFromU8(data) });
    } else {
      total += file.size;
      result.push({
        path: file.webkitRelativePath || file.name,
        text: await file.text(),
      });
    }
    if (result.length > MAX_FILES || total > MAX_BYTES)
      throw new Error("标注文件数量或大小超过导入上限。");
  }
  return result;
}
export function prepareAnnotationImport(
  files: ImportTextFile[],
  name: string,
): AnnotationImportBundle {
  for (const file of files.filter((f) => /\.json$/i.test(f.path))) {
    const value = JSON.parse(file.text);
    if (
      value.schemaVersion === 1 &&
      value.media &&
      Array.isArray(value.annotations) &&
      Array.isArray(value.tracks)
    ) {
      const project = parseProject(
        JSON.stringify(
          value.id ? value : { ...createProject(value.media), ...value },
        ),
      );
      return {
        name,
        format: value.format ? `FrameFlow · ${value.format}` : "FrameFlow 工程",
        files: [],
        project,
      };
    }
  }
  const adapter = importPlugins.list().find((p) => p.accepts(files));
  if (!adapter)
    throw new Error(
      "未识别的标注格式。可选本软件导出的 ZIP，或 COCO、CVAT、YOLO、VOC、LabelMe、MOT、CSV 文件。",
    );
  return { name, format: adapter.name, files, adapterId: adapter.id };
}
export function applyAnnotationImport(
  bundle: AnnotationImportBundle,
  base: Project,
): Project {
  if (bundle.project) {
    const p = bundle.project;
    if (
      p.media.width !== base.media.width ||
      p.media.height !== base.media.height ||
      Math.abs(p.media.duration - base.media.duration) >
        Math.max(0.15, 1 / p.media.fps)
    )
      throw new Error(
        "标注记录的素材尺寸或时长与当前文件不一致，请选择对应原视频或图像。",
      );
    const next = {
      ...p,
      media: {
        ...base.media,
        fps: p.media.fps,
        sourceFps: sourceFrameRate(p.media),
      },
    };
    return parseProject(JSON.stringify(next));
  }
  const boxes = importPlugins
    .get(bundle.adapterId!)
    .read(bundle.files, base.media);
  if (!boxes.length) throw new Error("文件中没有可显示的矩形框。");
  if (boxes.length > 100000) throw new Error("一次最多导入 10 万个矩形框。");
  const next: Project = { ...base, labels: [], tracks: [], annotations: [] },
    labels = new Map<string, number>(),
    tracks = new Map<string, number>(),
    keys = new Set<string>();
  for (let i = 0; i < boxes.length; i++) {
    const a = boxes[i],
      b = a.box;
    if (
      !Number.isInteger(a.frame) ||
      a.frame < 0 ||
      a.frame >= frameCount(base.media) ||
      ![b.x, b.y, b.width, b.height].every(Number.isFinite) ||
      b.width <= 0 ||
      b.height <= 0 ||
      !a.label?.trim()
    )
      throw new Error(
        "标注的帧号、类别或矩形坐标无效，请检查标注帧率和文件内容。",
      );
    const x = Math.max(0, b.x),
      y = Math.max(0, b.y),
      width = Math.min(base.media.width, b.x + b.width) - x,
      height = Math.min(base.media.height, b.y + b.height) - y;
    if (width <= 0 || height <= 0)
      throw new Error("标注框完全位于图像范围之外。");
    if (!labels.has(a.label)) {
      const id = labels.size + 1;
      labels.set(a.label, id);
      next.labels.push({
        id,
        name: a.label,
        color: ["#4478ef", "#13a896", "#e6a342", "#ac85d8"][(id - 1) % 4],
      });
    }
    const labelId = labels.get(a.label)!,
      trackKey = a.trackKey ?? `shape:${i}`;
    if (!tracks.has(trackKey)) {
      const id = tracks.size + 1;
      tracks.set(trackKey, id);
      next.tracks.push({
        id,
        labelId,
        name: `${a.label} · ${String(id).padStart(2, "0")}`,
      });
    }
    const trackId = tracks.get(trackKey)!,
      key = `${trackId}:${a.frame}`;
    if (next.tracks[trackId - 1].labelId !== labelId || keys.has(key))
      throw new Error("同一轨迹的类别不一致，或同一帧存在重复框。");
    keys.add(key);
    next.annotations.push({
      trackId,
      frame: a.frame,
      box: { x, y, width, height },
      source: a.source ?? "manual",
      review: a.review ?? "confirmed",
      score: a.score,
    });
  }
  next.annotations.sort((a, b) => a.frame - b.frame || a.trackId - b.trackId);
  return parseProject(JSON.stringify(next));
}
