import type { Annotation, AnnotationAssistPlugin, Box } from "../core/types.ts";
import { clampBox } from "../core/project.ts";
import { plannedAICandidates } from "../core/keyframes.ts";

export function templateSamples(image: ImageData, box: Box) {
  const values: number[] = [];
  for (let gy = 0; gy < 12; gy++)
    for (let gx = 0; gx < 12; gx++) {
      // The central region limits distracting background around a loose human box.
      const x = Math.min(
        image.width - 1,
        Math.max(
          0,
          Math.round(box.x + (0.15 + ((gx + 0.5) * 0.7) / 12) * box.width),
        ),
      );
      const y = Math.min(
        image.height - 1,
        Math.max(
          0,
          Math.round(box.y + (0.15 + ((gy + 0.5) * 0.7) / 12) * box.height),
        ),
      );
      const offset = (y * image.width + x) * 4;
      values.push(
        image.data[offset],
        image.data[offset + 1],
        image.data[offset + 2],
      );
    }
  return values;
}
export function matchTemplate(
  image: ImageData,
  template: number[],
  previous: Box,
  radius: number,
) {
  const n = template.length;
  const sumT = template.reduce((sum, value) => sum + value, 0);
  const energyT =
    template.reduce((sum, value) => sum + value * value, 0) - (sumT * sumT) / n;
  if (energyT < 100)
    throw new Error("人工框内纹理过少，请缩小框或选择更有特征的目标。");
  const media = { width: image.width, height: image.height };
  let best = { box: clampBox(previous, media), score: -1 },
    bestRank = -Infinity;
  const minX = Math.max(0, previous.x - radius),
    maxX = Math.min(image.width - previous.width, previous.x + radius);
  const minY = Math.max(0, previous.y - radius),
    maxY = Math.min(image.height - previous.height, previous.y + radius);
  const scoreAt = (x: number, y: number) => {
    const box = { ...previous, x, y };
    const values = templateSamples(image, box);
    let sum = 0,
      squares = 0,
      products = 0,
      colorDifference = 0;
    for (let i = 0; i < n; i++) {
      const v = values[i];
      sum += v;
      squares += v * v;
      products += template[i] * v;
      colorDifference += Math.abs(template[i] - v);
    }
    const variance = Math.max(0, squares - (sum * sum) / n);
    const score =
      variance < 100
        ? -1
        : (products - (sumT * sum) / n) / Math.sqrt(energyT * variance);
    const displacement =
      Math.hypot(x - previous.x, y - previous.y) / Math.max(1, radius);
    const rank =
      score - (0.15 * colorDifference) / (n * 255) - 0.045 * displacement;
    if (rank > bestRank) {
      bestRank = rank;
      best = { box, score: Math.max(-1, Math.min(1, score)) };
    }
  };
  const step = Math.max(
    3,
    Math.round(Math.min(previous.width, previous.height) / 12),
  );
  scoreAt(previous.x, previous.y);
  for (let y = minY; y <= maxY; y += step)
    for (let x = minX; x <= maxX; x += step) scoreAt(x, y);
  const coarse = best.box;
  for (
    let y = Math.max(minY, coarse.y - step);
    y <= Math.min(maxY, coarse.y + step);
    y++
  )
    for (
      let x = Math.max(minX, coarse.x - step);
      x <= Math.min(maxX, coarse.x + step);
      x++
    )
      scoreAt(x, y);
  // A coarse grid can miss the true object by a few pixels and prefer a similar
  // distractor. Always refine the motion prediction as an independent candidate.
  for (
    let y = Math.max(minY, previous.y - step);
    y <= Math.min(maxY, previous.y + step);
    y++
  )
    for (
      let x = Math.max(minX, previous.x - step);
      x <= Math.min(maxX, previous.x + step);
      x++
    )
      scoreAt(x, y);
  return best;
}
export const templateMatching: AnnotationAssistPlugin = {
  id: "local-template",
  name: "本地模板匹配",
  description: "参考人工框的外观，按间隔读取视频像素生成候选。",
  async generate({ project, trackId, reader, signal, onProgress }) {
    const anchors = project.annotations
      .filter(
        (a) =>
          a.trackId === trackId &&
          a.source === "manual" &&
          a.review === "confirmed",
      )
      .sort((a, b) => a.frame - b.frame);
    if (!anchors.length) throw new Error("先为当前目标画一个人工关键帧。");
    const output: Annotation[] = [];
    const anchorIndices = new Map(anchors.map((a, i) => [a.frame, i]));
    const candidates = plannedAICandidates(project, trackId).map((point) => ({
      frame: point.frame,
      anchorIndex: anchorIndices.get(point.anchorFrame)!,
    }));
    if (candidates.length > 600)
      throw new Error("AI 关键帧超过 600，请增大关键帧间隔后重试。");
    let currentAnchor = -1,
      template: number[] = [],
      previous = anchors[0].box,
      lastFrameRead = anchors[0].frame,
      velocity = { x: 0, y: 0 };
    for (let i = 0; i < candidates.length; i++) {
      signal.throwIfAborted();
      const { frame, anchorIndex } = candidates[i];
      if (anchorIndex !== currentAnchor) {
        currentAnchor = anchorIndex;
        previous = anchors[anchorIndex].box;
        lastFrameRead = anchors[anchorIndex].frame;
        velocity = { x: 0, y: 0 };
        template = templateSamples(
          await reader.read(anchors[anchorIndex].frame, signal),
          previous,
        );
      }
      const image = await reader.read(frame, signal);
      const delta = frame - lastFrameRead;
      const predicted = clampBox(
        {
          ...previous,
          x: previous.x + velocity.x * delta,
          y: previous.y + velocity.y * delta,
        },
        project.media,
      );
      const result = matchTemplate(
        image,
        template,
        predicted,
        Math.min(240, Math.max(64, project.media.width * 0.12)),
      );
      if (result.score < 0.66) {
        // Stop this anchor's segment instead of using a lost match as velocity.
        while (
          i + 1 < candidates.length &&
          candidates[i + 1].anchorIndex === anchorIndex
        )
          i++;
        onProgress(i + 1, candidates.length);
        continue;
      }
      output.push({
        frame,
        trackId,
        box: result.box,
        source: "assist",
        review: "pending",
        score: result.score,
      });
      velocity = {
        x: (result.box.x - previous.x) / delta,
        y: (result.box.y - previous.y) / delta,
      };
      previous = result.box;
      lastFrameRead = frame;
      onProgress(i + 1, candidates.length);
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
    return output;
  },
};
