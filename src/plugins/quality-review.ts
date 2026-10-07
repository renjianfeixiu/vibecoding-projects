import type {
  Annotation,
  AnnotationAuditPlugin,
  AuditFinding,
  AuditFindingType,
} from "../core/types.ts";
import { MATCH_REVIEW_THRESHOLD } from "../core/keyframes.ts";

const median = (values: number[]) => {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)] ?? 0;
};
function speed(a: Annotation, b: Annotation) {
  const distance = Math.hypot(
    b.box.x + b.box.width / 2 - a.box.x - a.box.width / 2,
    b.box.y + b.box.height / 2 - a.box.y - a.box.height / 2,
  );
  return (
    distance /
    Math.max(1, Math.hypot(a.box.width, a.box.height)) /
    Math.max(1, b.frame - a.frame)
  );
}
export const qualityReview: AnnotationAuditPlugin = {
  id: "local-quality",
  name: "本地一致性检查",
  description: "检查轨迹内部缺帧、位置与尺寸跳变、低匹配分数和待确认标注。",
  requiresPixels: false,
  async review({ project, signal, onProgress }) {
    signal.throwIfAborted();
    const findings: AuditFinding[] = [];
    const add = (
      type: AuditFindingType,
      a: Annotation,
      message: string,
      detail: string,
      endFrame?: number,
    ) =>
      findings.push({
        id: `${type}:${a.trackId}:${a.frame}:${endFrame ?? a.frame}`,
        type,
        trackId: a.trackId,
        frame: a.frame,
        endFrame,
        message,
        detail,
        status: "open",
      });
    for (let ti = 0; ti < project.tracks.length; ti++) {
      signal.throwIfAborted();
      const track = project.tracks[ti];
      const entries = project.annotations
        .filter((a) => a.trackId === track.id)
        .sort((a, b) => a.frame - b.frame);
      const visible = entries.filter((a) => a.review !== "rejected");
      const barriers = entries
        .filter((a) => a.review === "rejected")
        .map((a) => a.frame);
      const typicalSpeed = median(
        visible.slice(1).map((a, i) => speed(visible[i], a)),
      );
      let pendingStart: Annotation | undefined,
        pendingEnd: Annotation | undefined;
      const flushPending = () => {
        if (pendingStart && pendingEnd)
          add(
            "pending",
            pendingStart,
            "候选标注尚未确认",
            "这些候选仍处于待确认状态，默认导出会排除它们。请回到标注页逐帧确认或拒绝。",
            pendingEnd.frame,
          );
        pendingStart = pendingEnd = undefined;
      };
      for (let i = 0; i < visible.length; i++) {
        if (i % 256 === 0) {
          signal.throwIfAborted();
          await new Promise<void>((resolve) => setTimeout(resolve, 0));
        }
        const a = visible[i],
          previous = visible[i - 1];
        if (a.review === "pending") {
          if (pendingEnd && a.frame !== pendingEnd.frame + 1) flushPending();
          pendingStart ??= a;
          pendingEnd = a;
        } else flushPending();
        if (
          a.source !== "manual" &&
          a.score !== undefined &&
          a.score < MATCH_REVIEW_THRESHOLD
        )
          add(
            "correlation",
            a,
            "匹配相关性偏低",
            `匹配相关性 ${a.score.toFixed(2)}，低于本轮阈值 ${MATCH_REVIEW_THRESHOLD}；这不是正确率，请对照原画面核对。`,
          );
        if (
          !previous ||
          barriers.some((f) => f > previous.frame && f < a.frame)
        )
          continue;
        const gap = a.frame - previous.frame;
        if (gap > 1)
          add(
            "missing",
            { ...a, frame: previous.frame + 1 },
            `轨迹内部有 ${gap - 1} 个未标注帧`,
            "对象可能漏标，也可能暂时离开画面。此检查只覆盖已有标注之间的空缺，不推断目标必然存在。",
            a.frame - 1,
          );
        if (speed(previous, a) > Math.max(0.75, typicalSpeed * 6))
          add(
            "jump",
            a,
            "目标位置突然跳动",
            "与前一标注相比位置变化较大，可能跟错了对象。快速运动也可能触发，请对照相邻帧。",
          );
        const ratio =
          (a.box.width * a.box.height) /
          (previous.box.width * previous.box.height);
        if (
          gap <= Math.max(1, project.media.fps) &&
          (ratio > 2.5 || ratio < 0.4)
        )
          add(
            "size",
            a,
            "框尺寸突然变化",
            `相邻框面积比 ${ratio.toFixed(2)}，可能框偏离或尺寸设置异常；真实缩放也会触发。`,
          );
      }
      flushPending();
      onProgress(ti + 1, project.tracks.length);
    }
    signal.throwIfAborted();
    return findings.sort(
      (a, b) =>
        a.frame - b.frame ||
        a.trackId - b.trackId ||
        a.type.localeCompare(b.type),
    );
  },
};
