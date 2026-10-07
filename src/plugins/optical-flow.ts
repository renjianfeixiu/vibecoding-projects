import type { Annotation, Box, FrameFillPlugin } from "../core/types.ts";
import { clampBox, frameCount } from "../core/project.ts";
import { matchTemplate, templateSamples } from "./template-matching.ts";

interface Gray {
  width: number;
  height: number;
  data: Float32Array;
}
interface Point {
  x: number;
  y: number;
}
interface VisionFrame {
  image: ImageData;
  pyramid: Gray[];
  scale: number;
}

function gray(image: ImageData): Gray {
  const data = new Float32Array(image.width * image.height);
  for (let i = 0; i < data.length; i++)
    data[i] =
      image.data[i * 4] * 0.299 +
      image.data[i * 4 + 1] * 0.587 +
      image.data[i * 4 + 2] * 0.114;
  return { width: image.width, height: image.height, data };
}
function half(input: Gray): Gray {
  const width = Math.floor(input.width / 2),
    height = Math.floor(input.height / 2);
  const data = new Float32Array(width * height);
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++) {
      const i = y * 2 * input.width + x * 2;
      data[y * width + x] =
        (input.data[i] +
          input.data[i + 1] +
          input.data[i + input.width] +
          input.data[i + input.width + 1]) /
        4;
    }
  return { width, height, data };
}
function visionFrame(input: ImageData): VisionFrame {
  const scale = Math.min(1, 640 / Math.max(input.width, input.height));
  let image = input;
  if (scale < 1) {
    const width = Math.round(input.width * scale),
      height = Math.round(input.height * scale);
    const data = new Uint8ClampedArray(width * height * 4);
    for (let y = 0; y < height; y++)
      for (let x = 0; x < width; x++) {
        const source =
          (Math.min(input.height - 1, Math.round(y / scale)) * input.width +
            Math.min(input.width - 1, Math.round(x / scale))) *
          4;
        data.set(input.data.subarray(source, source + 4), (y * width + x) * 4);
      }
    image = { width, height, data, colorSpace: "srgb" } as ImageData;
  }
  const pyramid = [gray(image)];
  while (
    pyramid.length < 3 &&
    Math.min(pyramid.at(-1)!.width, pyramid.at(-1)!.height) >= 36
  )
    pyramid.push(half(pyramid.at(-1)!));
  return { image, pyramid, scale };
}
function value(image: Gray, x: number, y: number) {
  const ix = Math.floor(x),
    iy = Math.floor(y),
    fx = x - ix,
    fy = y - iy;
  const i = iy * image.width + ix;
  return (
    image.data[i] * (1 - fx) * (1 - fy) +
    image.data[i + 1] * fx * (1 - fy) +
    image.data[i + image.width] * (1 - fx) * fy +
    image.data[i + image.width + 1] * fx * fy
  );
}
function inside(image: Gray, p: Point, margin = 5) {
  return (
    p.x >= margin &&
    p.y >= margin &&
    p.x < image.width - margin &&
    p.y < image.height - margin
  );
}
function corners(image: Gray, box: Box): Point[] {
  const candidates: (Point & { score: number })[] = [];
  // Favor the object's central area so stationary background does not dominate.
  const left = Math.max(5, Math.ceil(box.x + box.width * 0.12));
  const top = Math.max(5, Math.ceil(box.y + box.height * 0.12));
  const right = Math.min(image.width - 6, Math.floor(box.x + box.width * 0.88));
  const bottom = Math.min(
    image.height - 6,
    Math.floor(box.y + box.height * 0.88),
  );
  for (let y = top; y <= bottom; y += 2)
    for (let x = left; x <= right; x += 2) {
      let xx = 0,
        xy = 0,
        yy = 0;
      for (let oy = -1; oy <= 1; oy++)
        for (let ox = -1; ox <= 1; ox++) {
          const i = (y + oy) * image.width + x + ox;
          const gx = (image.data[i + 1] - image.data[i - 1]) / 2;
          const gy =
            (image.data[i + image.width] - image.data[i - image.width]) / 2;
          xx += gx * gx;
          xy += gx * gy;
          yy += gy * gy;
        }
      const score = (xx + yy - Math.sqrt((xx - yy) ** 2 + 4 * xy * xy)) / 2;
      if (score > 35) candidates.push({ x, y, score });
    }
  candidates.sort((a, b) => b.score - a.score);
  const selected: Point[] = [];
  for (const p of candidates) {
    if (selected.every((q) => Math.hypot(p.x - q.x, p.y - q.y) >= 4))
      selected.push(p);
    if (selected.length >= 36) break;
  }
  return selected;
}

// Pyramidal inverse-compositional Lucas–Kanade, with bilinear samples and an
// independently computed backward pass. No object trajectory is interpolated.
function lucasKanade(
  previous: Gray[],
  next: Gray[],
  point: Point,
): Point | null {
  let dx = 0,
    dy = 0;
  let used = false;
  for (let level = previous.length - 1; level >= 0; level--) {
    if (level < previous.length - 1) {
      dx *= 2;
      dy *= 2;
    }
    const a = previous[level],
      b = next[level];
    const p = { x: point.x / 2 ** level, y: point.y / 2 ** level };
    if (!inside(a, p)) continue;
    const patch: {
      ox: number;
      oy: number;
      v: number;
      gx: number;
      gy: number;
    }[] = [];
    let xx = 0,
      xy = 0,
      yy = 0;
    for (let oy = -3; oy <= 3; oy++)
      for (let ox = -3; ox <= 3; ox++) {
        const x = p.x + ox,
          y = p.y + oy;
        const gx = (value(a, x + 1, y) - value(a, x - 1, y)) / 2;
        const gy = (value(a, x, y + 1) - value(a, x, y - 1)) / 2;
        xx += gx * gx;
        xy += gx * gy;
        yy += gy * gy;
        patch.push({ ox, oy, v: value(a, x, y), gx, gy });
      }
    const determinant = xx * yy - xy * xy;
    if (determinant < 1 || Math.min(xx, yy) < 25) continue;
    used = true;
    for (let iteration = 0; iteration < 15; iteration++) {
      if (!inside(b, { x: p.x + dx, y: p.y + dy })) return null;
      let bx = 0,
        by = 0;
      for (const sample of patch) {
        const error =
          sample.v - value(b, p.x + dx + sample.ox, p.y + dy + sample.oy);
        bx += sample.gx * error;
        by += sample.gy * error;
      }
      const ux = (yy * bx - xy * by) / determinant;
      const uy = (xx * by - xy * bx) / determinant;
      if (!Number.isFinite(ux + uy) || Math.hypot(ux, uy) > 8) return null;
      dx += ux;
      dy += uy;
      if (ux * ux + uy * uy < 0.001) break;
    }
  }
  return used ? { x: point.x + dx, y: point.y + dy } : null;
}
const median = (values: number[]) => {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2
    ? sorted[middle]
    : (sorted[middle - 1] + sorted[middle]) / 2;
};
function scaledBox(box: Box, scale: number): Box {
  return {
    x: box.x * scale,
    y: box.y * scale,
    width: box.width * scale,
    height: box.height * scale,
  };
}

export function estimateMotion(
  previous: VisionFrame,
  next: VisionFrame,
  box: Box,
) {
  const points = corners(previous.pyramid[0], box);
  const moves: { from: Point; to: Point; dx: number; dy: number }[] = [];
  for (const point of points) {
    const forward = lucasKanade(previous.pyramid, next.pyramid, point);
    if (!forward) continue;
    const backward = lucasKanade(next.pyramid, previous.pyramid, forward);
    if (
      !backward ||
      Math.hypot(backward.x - point.x, backward.y - point.y) > 0.85
    )
      continue;
    moves.push({
      from: point,
      to: forward,
      dx: forward.x - point.x,
      dy: forward.y - point.y,
    });
  }
  if (moves.length < 3) return null;
  const dx = median(moves.map((p) => p.dx)),
    dy = median(moves.map((p) => p.dy));
  const inliers = moves.filter((p) => Math.hypot(p.dx - dx, p.dy - dy) <= 1.75);
  if (inliers.length < 3 || inliers.length < moves.length * 0.5) return null;
  const ratios: number[] = [];
  if (inliers.length >= 6)
    for (let i = 0; i < inliers.length; i++)
      for (let j = i + 1; j < inliers.length; j++) {
        const p = inliers[i],
          q = inliers[j];
        const distance = Math.hypot(p.from.x - q.from.x, p.from.y - q.from.y);
        if (distance > 12)
          ratios.push(Math.hypot(p.to.x - q.to.x, p.to.y - q.to.y) / distance);
      }
  const scale =
    ratios.length >= 8 ? Math.max(0.96, Math.min(1.04, median(ratios))) : 1;
  return {
    dx: median(inliers.map((p) => p.dx)),
    dy: median(inliers.map((p) => p.dy)),
    scale,
    support: inliers.length / Math.max(1, points.length),
  };
}

export const opticalFlowTracking: FrameFillPlugin = {
  id: "pyramidal-lk",
  name: "双向光流 + 外观校验",
  description:
    "逐帧金字塔 LK 光流，前后向检查、鲁棒位移和模板校准；跟丢时停止。",
  async fill({ project, trackId, reader, signal, onProgress }) {
    signal.throwIfAborted();
    const anchors = project.annotations
      .filter(
        (a) =>
          a.trackId === trackId &&
          (a.source === "manual" || a.source === "assist") &&
          a.review === "confirmed",
      )
      .sort((a, b) => a.frame - b.frame);
    if (!anchors.length) throw new Error("请先确认一个人工框或 AI 关键帧。");
    const barriers = new Set(
      project.annotations
        .filter((a) => a.trackId === trackId && a.review === "rejected")
        .map((a) => a.frame),
    );
    const occupied = new Set(
      project.annotations
        .filter(
          (a) =>
            a.trackId === trackId &&
            (a.source === "manual" || a.source === "assist"),
        )
        .map((a) => a.frame),
    );
    const output = new Map<number, Annotation>();
    const total = Math.max(1, frameCount(project.media) * 2);
    let done = 0;
    const trace = async (anchor: Annotation, end: number) => {
      const direction = end > anchor.frame ? 1 : -1;
      const result = new Map<number, Annotation>();
      signal.throwIfAborted();
      let previous = visionFrame(await reader.read(anchor.frame, signal));
      let box = scaledBox(anchor.box, previous.scale);
      const template = templateSamples(previous.image, box);
      for (
        let frame = anchor.frame + direction;
        direction > 0 ? frame <= end : frame >= end;
        frame += direction
      ) {
        signal.throwIfAborted();
        if (barriers.has(frame)) break;
        const next = visionFrame(await reader.read(frame, signal));
        const motion = estimateMotion(previous, next, box);
        const predicted = motion
          ? {
              x: box.x + motion.dx - (box.width * (motion.scale - 1)) / 2,
              y: box.y + motion.dy - (box.height * (motion.scale - 1)) / 2,
              width: box.width * motion.scale,
              height: box.height * motion.scale,
            }
          : box;
        const appearance = matchTemplate(
          next.image,
          template,
          clampBox(predicted, next.image),
          motion ? 5 : 16,
        );
        done++;
        onProgress(done, total);
        // Low correlation is a loss of visual evidence. Never invent a straight
        // trajectory through an occlusion or a rejected frame.
        if (appearance.score < 0.66) break;
        box = appearance.box;
        result.set(frame, {
          frame,
          trackId,
          source: "tracked",
          review: "pending",
          score: appearance.score,
          box: clampBox(scaledBox(box, 1 / next.scale), project.media),
        });
        previous = next;
        if (done % 3 === 0)
          await new Promise((resolve) => setTimeout(resolve, 0));
      }
      return result;
    };
    if (anchors[0].frame > 0)
      for (const [frame, a] of await trace(anchors[0], 0)) output.set(frame, a);
    for (let i = 0; i < anchors.length - 1; i++) {
      const left = anchors[i],
        right = anchors[i + 1];
      if (right.frame - left.frame < 2) continue;
      const forward = await trace(left, right.frame - 1);
      const backward = await trace(right, left.frame + 1);
      for (let frame = left.frame + 1; frame < right.frame; frame++) {
        const a = forward.get(frame),
          b = backward.get(frame);
        if (!a && !b) continue;
        if (a && b) {
          const distance = Math.hypot(
            a.box.x + a.box.width / 2 - b.box.x - b.box.width / 2,
            a.box.y + a.box.height / 2 - b.box.y - b.box.height / 2,
          );
          if (
            distance > Math.max(4, Math.min(a.box.width, a.box.height) * 0.25)
          )
            continue;
          const weight =
            (a.score ?? 0) / Math.max(0.001, (a.score ?? 0) + (b.score ?? 0));
          output.set(frame, {
            ...a,
            score: Math.min(a.score!, b.score!),
            box: {
              x: a.box.x * weight + b.box.x * (1 - weight),
              y: a.box.y * weight + b.box.y * (1 - weight),
              width: a.box.width * weight + b.box.width * (1 - weight),
              height: a.box.height * weight + b.box.height * (1 - weight),
            },
          });
        } else output.set(frame, (a ?? b)!);
      }
    }
    const last = anchors.at(-1)!;
    if (last.frame < frameCount(project.media) - 1)
      for (const [frame, a] of await trace(last, frameCount(project.media) - 1))
        output.set(frame, a);
    onProgress(total, total);
    return [...output.values()]
      .filter((a) => !occupied.has(a.frame) && !barriers.has(a.frame))
      .sort((a, b) => a.frame - b.frame);
  },
};
