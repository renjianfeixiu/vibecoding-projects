import type { Annotation, FrameFillPlugin } from "../core/types.ts";

export const linearInterpolation: FrameFillPlugin = {
  id: "linear",
  name: "线性插帧",
  description: "在两个已确认关键帧之间插值位置和尺寸，适合平稳运动。",
  async fill({ project, trackId, signal, onProgress }) {
    signal.throwIfAborted();
    const anchors = project.annotations
      .filter(
        (a) =>
          a.trackId === trackId &&
          a.review === "confirmed" &&
          (a.source === "manual" || a.source === "assist"),
      )
      .sort((a, b) => a.frame - b.frame);
    if (anchors.length < 2)
      throw new Error("线性插帧需要至少两个已确认关键帧。");
    const existing = new Set(
      project.annotations
        .filter(
          (a) =>
            a.trackId === trackId &&
            (a.source === "manual" || a.source === "assist"),
        )
        .map((a) => a.frame),
    );
    const barriers = project.annotations
      .filter((a) => a.trackId === trackId && a.review === "rejected")
      .map((a) => a.frame);
    const output: Annotation[] = [];
    for (let i = 1; i < anchors.length; i++) {
      signal.throwIfAborted();
      const left = anchors[i - 1],
        right = anchors[i];
      if (barriers.some((frame) => frame > left.frame && frame < right.frame))
        continue;
      for (let frame = left.frame + 1; frame < right.frame; frame++) {
        if (existing.has(frame)) continue;
        const t = (frame - left.frame) / (right.frame - left.frame);
        const lerp = (a: number, b: number) => a + (b - a) * t;
        output.push({
          trackId,
          frame,
          source: "interpolated",
          review: "pending",
          box: {
            x: lerp(left.box.x, right.box.x),
            y: lerp(left.box.y, right.box.y),
            width: lerp(left.box.width, right.box.width),
            height: lerp(left.box.height, right.box.height),
          },
        });
      }
      onProgress(i, anchors.length - 1);
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
    return output;
  },
};
