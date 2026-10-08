import type {
  Annotation,
  AnnotationAssistPlugin,
  FrameFillPlugin,
  FrameReader,
  Project,
} from "./types.ts";
import { trackBounds } from "./workflow.ts";
import type { JobMode } from "./workflow.ts";
import { plannedAICandidates } from "./keyframes.ts";

export interface TrackJobResult {
  trackId: number;
  name: string;
  status: "done" | "skipped" | "failed";
  count: number;
  message: string;
}
export interface BatchResult {
  annotations: Annotation[];
  tracks: TrackJobResult[];
}
function validateCandidates(
  project: Project,
  trackId: number,
  mode: JobMode,
  annotations: Annotation[],
) {
  const bounds = trackBounds(project, trackId),
    seen = new Set<number>();
  for (const a of annotations) {
    if (
      a.trackId !== trackId ||
      !Number.isInteger(a.frame) ||
      a.frame < bounds.start ||
      a.frame > bounds.end ||
      seen.has(a.frame)
    )
      throw new Error(
        "引擎返回了错误的对象、帧号或重复候选，本对象结果未写入。",
      );
    const b = a.box;
    if (
      !b ||
      ![b.x, b.y, b.width, b.height].every(Number.isFinite) ||
      b.x < 0 ||
      b.y < 0 ||
      b.width < 1 ||
      b.height < 1 ||
      b.x + b.width > project.media.width + 0.0001 ||
      b.y + b.height > project.media.height + 0.0001 ||
      (a.score !== undefined &&
        (!Number.isFinite(a.score) || a.score < 0 || a.score > 1))
    )
      throw new Error("引擎返回了无效坐标或分数，本对象结果未写入。");
    if (
      mode === "assist"
        ? a.source !== "assist"
        : !["tracked", "interpolated"].includes(a.source)
    )
      throw new Error("引擎返回的标注来源与任务不符，本对象结果未写入。");
    seen.add(a.frame);
  }
}
export function readiness(
  project: Project,
  id: number,
  mode: JobMode,
  pluginId: string,
): string {
  const track = project.tracks.find((t) => t.id === id);
  if (!track) return "对象不存在";
  if (track.locked) return "对象已锁定";
  const anchors = project.annotations.filter(
    (a) =>
      a.trackId === id &&
      a.review === "confirmed" &&
      (a.source === "manual" || (mode === "fill" && a.source === "assist")),
  );
  if (anchors.length < (mode === "fill" && pluginId === "linear" ? 2 : 1))
    return mode === "assist"
      ? "尚无人工参考框"
      : pluginId === "linear"
        ? "需要两个已确认关键帧"
        : "需要一个已确认关键帧";
  return "";
}
export async function runAnnotationBatch(request: {
  project: Project;
  trackIds: number[];
  mode: JobMode;
  plugin: AnnotationAssistPlugin | FrameFillPlugin;
  reader: FrameReader;
  signal: AbortSignal;
  replacePending?: boolean;
  onProgress: (percent: number, track?: string) => void;
}): Promise<BatchResult> {
  const {
    project,
    trackIds,
    mode,
    plugin,
    reader,
    signal,
    onProgress,
    replacePending,
  } = request;
  signal.throwIfAborted();
  const output: BatchResult = { annotations: [], tracks: [] };
  const cache = new Map<number, ImageData>();
  let bytes = 0;
  const cachedReader: FrameReader = {
    read: async (frame, abort) => {
      abort?.throwIfAborted();
      const stored = cache.get(frame);
      if (stored) return stored;
      const image = await reader.read(frame, abort);
      const size = image.data.byteLength;
      if (size <= 16 * 1024 * 1024) {
        while (bytes + size > 16 * 1024 * 1024 && cache.size) {
          const first = cache.keys().next().value!;
          bytes -= cache.get(first)!.data.byteLength;
          cache.delete(first);
        }
        cache.set(frame, image);
        bytes += size;
      }
      return image;
    },
  };
  let lastProgress = 0;
  const reportProgress = (percent: number, name?: string) => {
    lastProgress = Math.max(lastProgress, Math.min(100, percent));
    onProgress(lastProgress, name);
  };
  for (let i = 0; i < trackIds.length; i++) {
    signal.throwIfAborted();
    const trackId = trackIds[i];
    const name =
      project.tracks.find((t) => t.id === trackId)?.name ?? `对象 #${trackId}`;
    const reason = readiness(project, trackId, mode, plugin.id);
    if (reason) {
      output.tracks.push({
        trackId,
        name,
        status: "skipped",
        count: 0,
        message: reason,
      });
      reportProgress(((i + 1) / trackIds.length) * 100, name);
      continue;
    }
    reportProgress((i / trackIds.length) * 100, name);
    try {
      const input = {
        project,
        trackId,
        reader: cachedReader,
        signal,
        replacePending,
        onProgress: (done: number, total: number) =>
          reportProgress(
            ((i + (total ? done / total : 1)) / trackIds.length) * 100,
            name,
          ),
      };
      const results =
        mode === "assist"
          ? await (plugin as AnnotationAssistPlugin).generate(input)
          : await (plugin as FrameFillPlugin).fill(input);
      signal.throwIfAborted();
      validateCandidates(project, trackId, mode, results);
      output.annotations.push(...results);
      output.tracks.push({
        trackId,
        name,
        status: "done",
        count: results.length,
        message: results.length
          ? "已生成候选"
          : mode === "assist" &&
              !plannedAICandidates(project, trackId, replacePending ?? false)
                .length
            ? "计划点已标注或受到保护，无需重复生成"
            : "未找到新的可靠候选；请核对人工参考点",
      });
    } catch (error) {
      signal.throwIfAborted();
      output.tracks.push({
        trackId,
        name,
        status: "failed",
        count: 0,
        message: error instanceof Error ? error.message : "处理失败",
      });
    }
    reportProgress(((i + 1) / trackIds.length) * 100, name);
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
  signal.throwIfAborted();
  reportProgress(100);
  return output;
}
