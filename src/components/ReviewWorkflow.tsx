import { useEffect, useState } from "react";
import type { Project } from "../core/types.ts";
import type { TrackJobResult } from "../core/batch.ts";
import type { OperationScope } from "../core/workflow.ts";
import { scopedTrackIds, SCOPE_NAMES } from "../core/workflow.ts";
import {
  confirmAIKeyframes,
  confirmManualKeyframes,
  keyframeReviewState,
  reviewFlowState,
} from "../core/review-flow.ts";
import type { ReviewStage } from "../core/review-flow.ts";
import { AssistPanel } from "./AssistPanel.tsx";
import { ReviewPanel } from "./ReviewPanel.tsx";
import { ArrowRight, Check } from "./icons.ts";

interface Props {
  project: Project;
  trackId: number;
  frame: number;
  disabled: boolean;
  scope: OperationScope;
  setScope: (scope: OperationScope) => void;
  busy: string;
  progress: number;
  replacePending: boolean;
  setReplacePending: (value: boolean) => void;
  assistId: string;
  setAssistId: (id: string) => void;
  fillId: string;
  setFillId: (id: string) => void;
  assist: () => void;
  fillFrames: () => void;
  cancel: () => void;
  update: (change: (p: Project) => Project) => void;
  result: TrackJobResult[] | null;
  resultMode: "assist" | "fill" | null;
  select: (id: number, frame?: number) => void;
}
const STAGES: ReviewStage[] = ["manual", "assist", "derived"];
const TITLES = {
  manual: "人工关键帧复核",
  assist: "AI 关键帧复核",
  derived: "补帧与复核",
};
export function ReviewWorkflow(props: Props) {
  const { project, trackId, scope, disabled } = props;
  const ids = scopedTrackIds(project, trackId, scope, true);
  const flow = reviewFlowState(project, ids);
  const temporal = project.media.kind !== "image";
  const [stage, setStage] = useState<ReviewStage>(flow.stage),
    [error, setError] = useState("");
  const allowed = (s: ReviewStage) =>
    s === "manual" || (s === "assist" ? flow.manualDone : flow.aiDone);
  const currentStage = !temporal
    ? "manual"
    : allowed(stage)
      ? stage
      : flow.stage;
  const context = `${project.id}:${scope}:${scope === "all" ? "all" : scope === "track" ? trackId : project.tracks.find((t) => t.id === trackId)?.labelId}`;
  useEffect(() => {
    setStage(flow.stage);
    setError("");
  }, [context, flow.stage]);
  const states = flow.targets.map((id) => keyframeReviewState(project, id));
  const canConfirmAI =
    flow.manualDone && states.every((s) => s.aiAttempted && !s.aiPending);
  const canSkipAI =
    flow.manualDone &&
    !project.annotations.some(
      (a) =>
        flow.targets.includes(a.trackId) &&
        a.source === "assist" &&
        a.review !== "rejected",
    );
  const complete = (next: ReviewStage, change: (p: Project) => Project) => {
    try {
      props.update(change);
      setStage(next);
      setError("");
    } catch (e) {
      setError(e instanceof Error ? e.message : "复核未完成。");
    }
  };
  const derived = project.annotations.filter(
    (a) =>
      flow.targets.includes(a.trackId) &&
      (a.source === "tracked" || a.source === "interpolated") &&
      a.review !== "rejected",
  );
  const fillReviewed =
    derived.length > 0 &&
    derived.every((a) => a.review === "confirmed") &&
    flow.aiDone;
  return (
    <section className="card review-workflow" aria-label="顺序复核流程">
      <div className="workflow-progress-header">
        <div className="panel-heading">
          <h2>帧复核流程</h2>
          <span className="engine-badge">{flow.targets.length} 个对象</span>
        </div>
        <ol className="review-steps" aria-label="帧复核步骤">
          {(temporal ? STAGES : (["manual"] as ReviewStage[])).map(
            (s, index) => {
              const done =
                s === "manual"
                  ? flow.manualDone
                  : s === "assist"
                    ? flow.aiDone
                    : fillReviewed;
              return (
                <li key={s}>
                  <button
                    aria-label={`${index + 1} ${TITLES[s]}`}
                    aria-current={currentStage === s ? "step" : undefined}
                    className={`${currentStage === s ? "active" : ""} ${done ? "complete" : ""}`}
                    disabled={disabled || !allowed(s)}
                    onClick={() => {
                      setStage(s);
                      setError("");
                    }}
                  >
                    <i>{done ? <Check size={13} /> : index + 1}</i>
                    <span>
                      {s === "manual"
                        ? "人工"
                        : s === "assist"
                          ? "AI 关键帧"
                          : "补帧"}
                    </span>
                    <small>
                      {done
                        ? s === "assist" && states.every((v) => v.aiSkipped)
                          ? "已跳过"
                          : "已完成"
                        : allowed(s)
                          ? "待完成"
                          : "待上一步"}
                    </small>
                  </button>
                </li>
              );
            },
          )}
        </ol>
      </div>
      <label className="workflow-scope">
        处理与复核范围
        <select
          aria-label="处理与复核范围"
          value={scope}
          disabled={disabled}
          onChange={(e) => props.setScope(e.target.value as OperationScope)}
        >
          {(["all", "label", "track"] as const).map((v) => (
            <option key={v} value={v}>
              {SCOPE_NAMES[v]}
              {v === "label"
                ? ` · ${project.labels.find((l) => l.id === project.tracks.find((t) => t.id === trackId)?.labelId)?.name ?? ""}`
                : ""}
            </option>
          ))}
        </select>
      </label>
      {flow.skipped > 0 && (
        <p className="operation-hint">
          {flow.skipped} 个对象已锁定或尚无人工框，暂不参与自动处理。
        </p>
      )}
      <div className="review-stage-heading">
        <h3>
          {STAGES.indexOf(currentStage) + 1}. {TITLES[currentStage]}
        </h3>
        <p>
          {currentStage === "manual"
            ? "查看人工框，确认后进入 AI 标注。"
            : currentStage === "assist"
              ? "确认或拒绝 AI 候选，复核完再补帧。"
              : "选好算法生成剩余帧，再查看并确认结果。"}
        </p>
      </div>
      {currentStage !== "manual" && (
        <AssistPanel
          {...props}
          ids={ids}
          mode={currentStage === "assist" ? "assist" : "fill"}
          result={
            props.resultMode === (currentStage === "assist" ? "assist" : "fill")
              ? props.result
              : null
          }
          select={(id) => props.select(id)}
        />
      )}
      <ReviewPanel
        key={currentStage}
        project={project}
        trackId={trackId}
        frame={props.frame}
        disabled={disabled}
        update={props.update}
        source={currentStage}
        scope={scope}
        stageConfirmed={
          currentStage === "manual"
            ? flow.manualDone
            : currentStage === "assist"
              ? flow.aiDone
              : fillReviewed
        }
        select={(id, frame) => props.select(id, frame)}
      />
      {currentStage === "manual" && (
        <button
          className="button primary full workflow-next"
          aria-label="确认人工关键帧并继续"
          disabled={disabled || !flow.targets.length}
          onClick={() =>
            complete(temporal ? "assist" : "manual", (p) =>
              confirmManualKeyframes(p, ids),
            )
          }
        >
          {flow.manualDone ? "人工已复核" : "确认人工关键帧"}
          {temporal && (
            <>
              <span>进入 AI</span>
              <ArrowRight size={15} />
            </>
          )}
        </button>
      )}
      {currentStage === "assist" && (
        <>
          <button
            className="button primary full workflow-next"
            aria-label="完成 AI 复核并进入补帧"
            disabled={disabled || !canConfirmAI}
            onClick={() =>
              complete("derived", (p) => confirmAIKeyframes(p, ids))
            }
          >
            完成 AI 复核<span>进入补帧</span>
            <ArrowRight size={15} />
          </button>
          {!canConfirmAI && states.some((s) => s.aiPending > 0) && (
            <p className="operation-hint">还有 AI 候选待确认或拒绝。</p>
          )}
          {canSkipAI && (
            <button
              className="text-button skip-ai"
              disabled={disabled}
              onClick={() =>
                complete("derived", (p) => confirmAIKeyframes(p, ids, true))
              }
            >
              只用人工帧，跳过 AI
            </button>
          )}
        </>
      )}
      {currentStage === "derived" && (
        <div className="workflow-result" role="status">
          {fillReviewed
            ? "补帧已复核，可前往导出。"
            : derived.length
              ? `${derived.filter((a) => a.review === "pending").length} 个补帧候选待复核`
              : "人工与 AI 关键帧已完成复核，可以生成补帧。"}
        </div>
      )}
      {error && (
        <p role="alert" className="field-error">
          {error}
        </p>
      )}
    </section>
  );
}
