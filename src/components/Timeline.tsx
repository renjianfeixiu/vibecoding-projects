import { useMemo } from "react";
import type { Annotation, Project } from "../core/types.ts";
import {
  frameCount,
  LIMIT_FRAMES,
  SOURCE_COLORS,
  SOURCE_NAMES,
} from "../core/project.ts";
import { keyframePlan, SUGGESTION_REASONS } from "../core/keyframes.ts";
import { ChevronRight } from "./icons.ts";

interface Props {
  project: Project;
  trackId: number;
  annotations: Annotation[];
  frame: number;
  playing: boolean;
  disabled: boolean;
  setFrame: (frame: number) => void;
  update: (change: (project: Project) => Project) => void;
}
function compact<T extends { frame: number }>(points: T[], count: number) {
  const groups = new Map<number, { point: T; count: number }>();
  for (const point of points) {
    const bucket = Math.floor((point.frame / Math.max(1, count - 1)) * 160);
    const previous = groups.get(bucket);
    if (previous) previous.count++;
    else groups.set(bucket, { point, count: 1 });
  }
  return [...groups.values()];
}
export function Timeline({
  project,
  trackId,
  annotations,
  frame,
  playing,
  disabled,
  setFrame,
  update,
}: Props) {
  const count = frameCount(project.media),
    temporal = project.media.kind !== "image";
  const plan = useMemo(
    () => keyframePlan(project, trackId),
    [project, trackId],
  );
  const aiTodo = plan.aiPoints.filter((point) => !point.completed);
  const manual = plan.manualSuggestions.find((point) => point.frame === frame);
  const ai = aiTodo.find((point) => point.frame === frame);
  const next = (points: { frame: number }[]) => {
    const point = points.find((p) => p.frame > frame) ?? points[0];
    if (point) setFrame(point.frame);
  };
  return (
    <div className="timeline-card">
      <div className="timeline-heading">
        <span>
          {annotations.length} / {count} 帧
        </span>
        <div className="source-legend">
          <span>
            <i style={{ background: SOURCE_COLORS.manual }} />
            人工
          </span>
          <span>
            <i style={{ background: SOURCE_COLORS.assist }} />
            AI 关键帧
          </span>
          <span>
            <i style={{ background: SOURCE_COLORS.tracked }} />
            补帧
          </span>
        </div>
      </div>
      <div
        className={`timeline-track ${plan.manualSuggestions.length || aiTodo.length ? "has-suggestions" : ""}`}
      >
        <div className="timeline-markers">
          {annotations.map((a) => (
            <i
              key={a.frame}
              title={`帧 ${a.frame} · ${SOURCE_NAMES[a.source]}`}
              style={{
                left: `${(a.frame / Math.max(1, count - 1)) * 100}%`,
                background: SOURCE_COLORS[a.source],
                opacity: a.review === "pending" ? 0.55 : 1,
              }}
            />
          ))}
        </div>
        <input
          aria-label="帧时间线"
          type="range"
          min="0"
          max={count - 1}
          value={frame}
          disabled={disabled || playing || !temporal}
          onChange={(e) => setFrame(Number(e.target.value))}
        />
        <div className="timeline-suggestions">
          {compact(plan.manualSuggestions, count).map(
            ({ point, count: groupCount }) => (
              <button
                key={`manual-${point.frame}`}
                className={`suggestion-marker manual ${point.frame === frame ? "active" : ""}`}
                aria-label={`建议人工标注 帧 ${point.frame}`}
                title={`${SUGGESTION_REASONS[point.reason]}${groupCount > 1 ? ` · 附近 ${groupCount} 个待人工点` : ""}`}
                disabled={disabled || playing}
                style={{
                  left: `${(point.frame / Math.max(1, count - 1)) * 100}%`,
                }}
                onClick={() => setFrame(point.frame)}
              >
                <i />
              </button>
            ),
          )}
          {compact(aiTodo, count).map(({ point, count: groupCount }) => (
            <button
              key={`ai-${point.frame}`}
              className={`suggestion-marker ai ${point.frame === frame ? "active" : ""}`}
              aria-label={`建议 AI 标注 帧 ${point.frame}`}
              title={`AI 关键帧建议${!point.ready ? " · 请先补人工参考框" : ` · 参考人工帧 ${point.anchorFrame}`}${groupCount > 1 ? ` · 附近 ${groupCount} 个 AI 点` : ""}`}
              disabled={disabled || playing}
              style={{
                left: `${(point.frame / Math.max(1, count - 1)) * 100}%`,
              }}
              onClick={() => setFrame(point.frame)}
            >
              <i />
            </button>
          ))}
        </div>
      </div>
      <div className="timeline-ticks">
        {[0, 0.25, 0.5, 0.75, 1].map((t) => (
          <span key={t}>{Math.round((count - 1) * t)}</span>
        ))}
      </div>
      {temporal && (
        <>
          <div className="suggestion-bar">
            <div className="suggestion-legend">
              <span>
                <i className="manual" />
                待人工 {plan.manualSuggestions.length}
              </span>
              <span>
                <i className="ai" />待 AI {aiTodo.length}
              </span>
            </div>
            <div>
              <button
                className="text-button"
                aria-label="下一建议人工点"
                disabled={disabled || playing || !plan.manualSuggestions.length}
                onClick={() => next(plan.manualSuggestions)}
              >
                下一人工点 <ChevronRight size={12} />
              </button>
              <button
                className="text-button"
                aria-label="下一建议 AI 点"
                disabled={disabled || playing || !aiTodo.length}
                onClick={() => next(aiTodo)}
              >
                下一 AI 点 <ChevronRight size={12} />
              </button>
            </div>
          </div>
          {(manual || ai) && (
            <p className="suggestion-current" role="status">
              {manual
                ? `建议人工 · ${SUGGESTION_REASONS[manual.reason]}`
                : "建议 AI · 用人工参考框生成候选"}
            </p>
          )}
          <details className="keyframe-settings">
            <summary>
              关键帧计划{" "}
              <span>
                人工 ≤ {plan.manualInterval} 帧 · AI 间隔{" "}
                {project.settings.assistInterval} 帧
              </span>
            </summary>
            <div className="keyframe-settings-fields">
              <label>
                人工点最大间隔
                <div className="input-unit">
                  <input
                    aria-label="人工点最大间隔"
                    type="number"
                    min="1"
                    max={LIMIT_FRAMES}
                    value={plan.manualInterval}
                    disabled={disabled || playing}
                    onChange={(e) =>
                      update((p) => ({
                        ...p,
                        settings: {
                          ...p.settings,
                          manualInterval: Math.min(
                            LIMIT_FRAMES,
                            Math.max(
                              1,
                              Math.round(Number(e.target.value) || 1),
                            ),
                          ),
                        },
                      }))
                    }
                  />
                  <span>帧</span>
                </div>
              </label>
              <label>
                建议方式
                <select
                  aria-label="关键帧建议方式"
                  value={project.settings.keyframeStrategy ?? "quality"}
                  disabled={disabled || playing}
                  onChange={(e) =>
                    update((p) => ({
                      ...p,
                      settings: {
                        ...p.settings,
                        keyframeStrategy: e.target.value as "fixed" | "quality",
                      },
                    }))
                  }
                >
                  <option value="fixed">均匀间隔</option>
                  <option value="quality">已有质量信号优先</option>
                </select>
              </label>
            </div>
            <p>
              间隔按标注帧计算，约{" "}
              {(plan.manualInterval / project.media.fps).toFixed(1)}{" "}
              秒。空心点是待完成建议，不是已有框；人工画框才完成对应人工点。质量信号只参考已有候选的低匹配分数或拒绝记录，不能判断未知目标。密集点合并显示，可用「下一人工点」逐个跳转。
            </p>
          </details>
        </>
      )}
    </div>
  );
}
