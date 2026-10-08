import type {
  Annotation,
  Box,
  MediaInfo,
  Project,
  ExportOptions,
} from "./types.ts";

export const DEMO_MEDIA: MediaInfo = {
  kind: "demo",
  fileName: "warehouse_demo · 内置动画",
  width: 960,
  height: 540,
  duration: 12,
  fps: 30,
};
export const SOURCE_NAMES = {
  manual: "人工标注",
  assist: "AI 关键帧标注",
  tracked: "视觉跟踪",
  interpolated: "线性插帧",
};
export const SOURCE_COLORS = {
  manual: "#4478ef",
  assist: "#13a896",
  tracked: "#e6a342",
  interpolated: "#ac85d8",
};
export const LIMIT_FRAMES = 18000;
export function sourceFrameRate(media: MediaInfo) {
  return media.sourceFps ?? media.fps;
}
export function sourceFrameIndex(frame: number, media: MediaInfo) {
  if (media.kind === "image") return 0;
  const fps = sourceFrameRate(media);
  return Math.max(
    0,
    Math.min(
      Math.ceil(media.duration * fps) - 1,
      Math.floor((frame * fps) / media.fps + 0.0001),
    ),
  );
}
export function frameSampleTime(frame: number, media: MediaInfo) {
  if (media.kind === "image") return 0;
  return Math.max(
    0,
    Math.min(
      media.duration - 0.00001,
      (sourceFrameIndex(frame, media) + 0.1) / sourceFrameRate(media),
    ),
  );
}
export function setTaskFrameRate(project: Project, requested: number): Project {
  const fps = Math.min(
    sourceFrameRate(project.media),
    Math.max(1, Number.isFinite(requested) ? requested : 1),
  );
  if (project.annotations.length && fps !== project.media.fps)
    throw new Error("已有标注的任务帧率已固定，请在新任务中设置帧切分。");
  const media = {
    ...project.media,
    sourceFps: sourceFrameRate(project.media),
    fps,
  };
  const last = frameCount(media) - 1;
  const ratio = fps / project.media.fps;
  return {
    ...project,
    media,
    tracks: project.tracks.map((track) => ({
      ...track,
      ...(track.startFrame === undefined
        ? {}
        : { startFrame: Math.min(last, Math.floor(track.startFrame * ratio)) }),
      ...(track.endFrame === undefined
        ? {}
        : {
            endFrame: Math.min(
              last,
              Math.max(0, Math.ceil((track.endFrame + 1) * ratio) - 1),
            ),
          }),
    })),
    settings: {
      ...project.settings,
      samplingFps: Math.min(fps, project.settings.samplingFps),
      ...(project.settings.manualInterval === undefined
        ? {}
        : {
            manualInterval: Math.min(
              LIMIT_FRAMES,
              Math.max(
                1,
                Math.round(
                  (project.settings.manualInterval * fps) / project.media.fps,
                ),
              ),
            ),
          }),
    },
  };
}
export function frameCount(media: MediaInfo) {
  return media.kind === "image"
    ? 1
    : Math.max(1, Math.ceil(media.duration * media.fps));
}
export function timeToFrame(time: number, media: MediaInfo) {
  return Math.min(
    frameCount(media) - 1,
    Math.max(0, Math.floor(time * media.fps + 0.0001)),
  );
}
export function frameName(frame: number) {
  return `frame_${String(frame).padStart(6, "0")}`;
}
export function clampBox(
  box: Box,
  media: Pick<MediaInfo, "width" | "height">,
): Box {
  const width = Math.min(media.width, Math.max(1, box.width));
  const height = Math.min(media.height, Math.max(1, box.height));
  return {
    width,
    height,
    x: Math.max(0, Math.min(media.width - width, box.x)),
    y: Math.max(0, Math.min(media.height - height, box.y)),
  };
}
export function createProject(media: MediaInfo = DEMO_MEDIA): Project {
  return {
    schemaVersion: 1,
    id: crypto.randomUUID(),
    name:
      media.kind === "demo"
        ? "仓库机器人 · 跟踪练习"
        : media.fileName.replace(/\.[^.]+$/, ""),
    createdAt: new Date().toISOString(),
    media: { ...media, sourceFps: sourceFrameRate(media) },
    settings: {
      samplingFps: Math.min(6, media.fps),
      assistInterval: Math.round(media.fps),
      manualInterval: Math.max(1, Math.round(media.fps * 3)),
      keyframeStrategy: "quality",
      boxWidth: Math.min(112, media.width),
      boxHeight: Math.min(84, media.height),
    },
    labels: [
      { id: 1, name: "机器人", color: "#4478ef" },
      { id: 2, name: "其他目标", color: "#13a896" },
    ],
    tracks: [{ id: 1, labelId: 1, name: "目标 01" }],
    annotations: [],
  };
}
export function setAnnotations(
  project: Project,
  entries: Annotation[],
  preserveManual = false,
): Project {
  const byKey = new Map(
    project.annotations.map((a) => [`${a.trackId}:${a.frame}`, a]),
  );
  for (const entry of entries) {
    const key = `${entry.trackId}:${entry.frame}`;
    const existing = byKey.get(key);
    if (preserveManual && existing?.source === "manual") continue;
    byKey.set(key, { ...entry, box: clampBox(entry.box, project.media) });
  }
  return {
    ...project,
    annotations: [...byKey.values()].sort(
      (a, b) => a.frame - b.frame || a.trackId - b.trackId,
    ),
  };
}
export function exportAnnotations(project: Project, options: ExportOptions) {
  const stride = Math.max(
    1,
    Math.round(project.media.fps / project.settings.samplingFps),
  );
  return project.annotations.filter(
    (a) =>
      a.review !== "rejected" &&
      (!options.confirmedOnly || a.review === "confirmed") &&
      (!options.sampledOnly || a.frame % stride === 0),
  );
}
export function invalidateDerived(
  project: Project,
  trackId: number,
  frame?: number,
): Project {
  const anchors = project.annotations
    .filter(
      (a) =>
        a.trackId === trackId &&
        a.review === "confirmed" &&
        (a.source === "manual" || a.source === "assist"),
    )
    .map((a) => a.frame);
  const left =
    frame === undefined
      ? -1
      : Math.max(-1, ...anchors.filter((f) => f < frame));
  const right =
    frame === undefined
      ? Infinity
      : Math.min(Infinity, ...anchors.filter((f) => f > frame));
  const annotations = project.annotations.filter(
    (a) =>
      a.trackId !== trackId ||
      a.source === "manual" ||
      a.review !== "pending" ||
      a.frame <= left ||
      a.frame >= right,
  );
  return annotations.length === project.annotations.length
    ? project
    : { ...project, annotations };
}
export function reviewAnnotation(
  project: Project,
  trackId: number,
  frame: number,
  review: "confirmed" | "rejected",
): Project {
  if (project.tracks.find((t) => t.id === trackId)?.locked)
    throw new Error("请先解锁对象。");
  const changed: Project = {
    ...project,
    annotations: project.annotations.map((a) =>
      a.trackId === trackId && a.frame === frame ? { ...a, review } : a,
    ),
  };
  return review === "rejected"
    ? invalidateDerived(changed, trackId, frame)
    : changed;
}
export function parseProject(text: string): Project {
  const p = JSON.parse(text) as Project;
  const finite = (v: unknown) => typeof v === "number" && Number.isFinite(v);
  if (
    !p ||
    p.schemaVersion !== 1 ||
    !p.media ||
    !p.settings ||
    !Array.isArray(p.annotations) ||
    !Array.isArray(p.labels) ||
    !Array.isArray(p.tracks)
  )
    throw new Error("不是有效的 FrameFlow 工程文件。");
  if (
    !["demo", "video", "image"].includes(p.media.kind) ||
    ![p.media.width, p.media.height, p.media.fps, p.media.duration].every(
      finite,
    ) ||
    p.media.width <= 0 ||
    p.media.height <= 0 ||
    p.media.width > 16384 ||
    p.media.height > 16384 ||
    p.media.fps < 1 ||
    p.media.fps > 120 ||
    (p.media.sourceFps !== undefined &&
      (!finite(p.media.sourceFps) ||
        p.media.sourceFps < p.media.fps ||
        p.media.sourceFps > 120)) ||
    p.media.duration < 0 ||
    frameCount(p.media) > LIMIT_FRAMES
  )
    throw new Error("媒体尺寸、帧率或时长不受支持。");
  if (
    typeof p.id !== "string" ||
    typeof p.name !== "string" ||
    typeof p.createdAt !== "string" ||
    !p.labels.length ||
    !p.tracks.length ||
    ![
      p.settings.samplingFps,
      p.settings.assistInterval,
      p.settings.boxWidth,
      p.settings.boxHeight,
    ].every(finite) ||
    p.settings.samplingFps < 1 ||
    p.settings.samplingFps > p.media.fps ||
    !Number.isInteger(p.settings.assistInterval) ||
    p.settings.assistInterval < 1 ||
    (p.settings.manualInterval !== undefined &&
      (!Number.isInteger(p.settings.manualInterval) ||
        p.settings.manualInterval < 1 ||
        p.settings.manualInterval > LIMIT_FRAMES)) ||
    (p.settings.keyframeStrategy !== undefined &&
      !["fixed", "quality"].includes(p.settings.keyframeStrategy)) ||
    p.settings.boxWidth <= 0 ||
    p.settings.boxHeight <= 0
  )
    throw new Error("工程参数无效。");
  const labelIds = new Set<number>();
  const trackIds = new Set<number>();
  for (const label of p.labels) {
    if (
      !Number.isInteger(label.id) ||
      label.id < 1 ||
      labelIds.has(label.id) ||
      typeof label.name !== "string" ||
      !label.name.trim() ||
      typeof label.color !== "string" ||
      !/^#[0-9a-f]{6}$/i.test(label.color)
    )
      throw new Error("类别定义无效。");
    labelIds.add(label.id);
  }
  for (const track of p.tracks) {
    if (
      !Number.isInteger(track.id) ||
      track.id < 1 ||
      trackIds.has(track.id) ||
      !labelIds.has(track.labelId) ||
      typeof track.name !== "string" ||
      (track.locked !== undefined && typeof track.locked !== "boolean") ||
      (track.hidden !== undefined && typeof track.hidden !== "boolean") ||
      (track.startFrame !== undefined &&
        (!Number.isInteger(track.startFrame) ||
          track.startFrame < 0 ||
          track.startFrame >= frameCount(p.media))) ||
      (track.endFrame !== undefined &&
        (!Number.isInteger(track.endFrame) ||
          track.endFrame < (track.startFrame ?? 0) ||
          track.endFrame >= frameCount(p.media)))
    )
      throw new Error("轨迹定义无效。");
    trackIds.add(track.id);
  }
  const keys = new Set<string>();
  if (p.keyframeReviews !== undefined) {
    if (!Array.isArray(p.keyframeReviews))
      throw new Error("关键帧复核记录无效。");
    const reviewed = new Set<number>();
    for (const r of p.keyframeReviews) {
      if (
        !r ||
        !trackIds.has(r.trackId) ||
        reviewed.has(r.trackId) ||
        [r.manualStamp, r.aiRunStamp, r.aiStamp].some(
          (s) =>
            s !== undefined &&
            (typeof s !== "string" ||
              !/^[a-f0-9]{8}:[a-f0-9]{8}:\d{1,9}$/.test(s)),
        ) ||
        (r.aiSkipped !== undefined && typeof r.aiSkipped !== "boolean")
      )
        throw new Error("关键帧复核记录无效。");
      reviewed.add(r.trackId);
    }
  }
  for (const a of p.annotations) {
    if (
      !trackIds.has(a.trackId) ||
      !Number.isInteger(a.frame) ||
      a.frame < 0 ||
      a.frame >= frameCount(p.media) ||
      !["manual", "assist", "tracked", "interpolated"].includes(a.source) ||
      !["pending", "confirmed", "rejected"].includes(a.review) ||
      !a.box ||
      ![a.box.x, a.box.y, a.box.width, a.box.height].every(finite) ||
      a.box.x < 0 ||
      a.box.y < 0 ||
      a.box.width <= 0 ||
      a.box.height <= 0 ||
      a.box.x + a.box.width > p.media.width + 0.01 ||
      a.box.y + a.box.height > p.media.height + 0.01 ||
      (a.score !== undefined &&
        (!finite(a.score) || a.score < -1 || a.score > 1))
    )
      throw new Error("标注坐标、帧或状态无效。");
    const track = p.tracks.find((t) => t.id === a.trackId)!;
    if (
      a.frame < (track.startFrame ?? 0) ||
      a.frame > (track.endFrame ?? frameCount(p.media) - 1)
    )
      throw new Error("标注帧超出对象区间。");
    const key = `${a.trackId}:${a.frame}`;
    if (keys.has(key)) throw new Error("同一轨迹同一帧存在重复框。");
    keys.add(key);
  }
  return p;
}
