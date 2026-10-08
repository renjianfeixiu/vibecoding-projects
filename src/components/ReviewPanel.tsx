import { useState } from "react";
import type { Annotation, Project } from "../core/types.ts";
import type { OperationScope } from "../core/workflow.ts";
import {
  bulkReview,
  restoreAnnotation,
  scopedTrackIds,
  SCOPE_NAMES,
} from "../core/workflow.ts";
import {
  reviewAnnotation,
  SOURCE_COLORS,
  SOURCE_NAMES,
} from "../core/project.ts";
import { Check, ChevronLeft, ChevronRight, X } from "./icons.ts";
import { Modal } from "./Modal.tsx";
import { useEffect } from "react";

type SourceFilter = "all" | "manual" | "assist" | "derived";
type StatusFilter = "visible" | "pending" | "rejected";
export function ReviewPanel({
  project,
  trackId,
  frame,
  disabled,
  update,
  select,
}: {
  project: Project;
  trackId: number;
  frame: number;
  disabled: boolean;
  update: (change: (p: Project) => Project) => void;
  select: (id: number, frame: number) => void;
}) {
  const [scope, setScope] = useState<OperationScope>("track"),
    [source, setSource] = useState<SourceFilter>("all"),
    [status, setStatus] = useState<StatusFilter>("visible"),
    [page, setPage] = useState(0),
    [confirm, setConfirm] = useState<"confirmed" | "rejected" | null>(null),
    [error, setError] = useState("");
  const ids = new Set(scopedTrackIds(project, trackId, scope, true));
  const matches = (a: Annotation) =>
    ids.has(a.trackId) &&
    (source === "all" ||
      (source === "derived"
        ? a.source === "tracked" || a.source === "interpolated"
        : a.source === source));
  const entries = project.annotations
    .filter(
      (a) =>
        matches(a) &&
        (status === "rejected"
          ? a.review === "rejected"
          : status === "pending"
            ? a.review === "pending"
            : a.review !== "rejected"),
    )
    .sort((a, b) => a.frame - b.frame || a.trackId - b.trackId);
  const pending = entries.filter(
    (a) =>
      a.review === "pending" &&
      !project.tracks.find((t) => t.id === a.trackId)?.locked,
  );
  const todo = project.annotations
    .filter((a) => ids.has(a.trackId) && a.review === "pending")
    .sort((a, b) => a.frame - b.frame || a.trackId - b.trackId);
  const maxPage = Math.max(0, Math.ceil(entries.length / 20) - 1),
    actualPage = Math.min(page, maxPage);
  useEffect(() => {
    setPage(0);
    setError("");
  }, [scope, source, status, scope === "track" ? trackId : 0, project.id]);
  const attempt = (change: (p: Project) => Project) => {
    try {
      update(change);
      setError("");
    } catch (e) {
      setError(e instanceof Error ? e.message : "操作失败。");
    }
  };
  const go = (a: Annotation) => {
    select(a.trackId, a.frame);
    const index = entries.indexOf(a);
    if (index >= 0) setPage(Math.floor(index / 20));
  };
  const next = () => {
    const a =
      todo.find(
        (a) => a.frame > frame || (a.frame === frame && a.trackId > trackId),
      ) ?? todo[0];
    if (a) go(a);
  };
  const batchReview = () => {
    attempt((p) => bulkReview(p, pending, confirm!));
    setConfirm(null);
  };
  return (
    <section className="card review-panel">
      <div className="panel-heading">
        <h2>帧复核</h2>
        <span className="status pending">{todo.length} 待确认</span>
      </div>
      <div className="review-scope">
        <select
          aria-label="复核范围"
          value={scope}
          onChange={(e) => setScope(e.target.value as OperationScope)}
          disabled={disabled}
        >
          {(["track", "label", "all"] as const).map((v) => (
            <option key={v} value={v}>
              {SCOPE_NAMES[v]}
            </option>
          ))}
        </select>
        <button
          className="text-button"
          aria-label="下一待确认标注"
          disabled={disabled || !todo.length}
          onClick={next}
        >
          下一待确认 <ChevronRight size={13} />
        </button>
      </div>
      <div className="source-tabs">
        {(["all", "manual", "assist", "derived"] as const).map((v) => (
          <button
            key={v}
            className={source === v ? "active" : ""}
            disabled={disabled}
            onClick={() => setSource(v)}
          >
            {
              {
                all: "全部",
                manual: "人工",
                assist: "AI 关键帧",
                derived: "补帧",
              }[v]
            }
          </button>
        ))}
      </div>
      <div className="review-actions">
        <select
          aria-label="标注复核状态"
          value={status}
          disabled={disabled}
          onChange={(e) => setStatus(e.target.value as StatusFilter)}
        >
          <option value="visible">有效标注</option>
          <option value="pending">待确认</option>
          <option value="rejected">已拒绝</option>
        </select>
        <button
          className="text-button"
          disabled={disabled || !pending.length}
          onClick={() => setConfirm("confirmed")}
        >
          确认 {pending.length} 项
        </button>
        <button
          className="text-button"
          disabled={disabled || !pending.length}
          onClick={() => setConfirm("rejected")}
        >
          拒绝
        </button>
      </div>
      <div className="frame-list">
        {entries.length ? (
          entries.slice(actualPage * 20, (actualPage + 1) * 20).map((a) => {
            const track = project.tracks.find((t) => t.id === a.trackId)!;
            return (
              <div
                key={`${a.trackId}:${a.frame}`}
                className={`frame-row ${a.frame === frame && a.trackId === trackId ? "current" : ""}`}
              >
                <button
                  className="frame-link"
                  disabled={disabled}
                  onClick={() => go(a)}
                  aria-label={`查看 ${track.name} 帧 ${a.frame}`}
                >
                  <i style={{ background: SOURCE_COLORS[a.source] }} />
                  <strong>
                    帧 {String(a.frame).padStart(4, "0")}{" "}
                    {scope === "track" ? "" : `· #${a.trackId}`}
                  </strong>
                  <small
                    title={`${track.name} · ${SOURCE_NAMES[a.source]}${a.score === undefined ? "" : ` · 匹配相关性 ${a.score.toFixed(2)}，不是正确率`}`}
                  >
                    {a.source === "manual"
                      ? "人工"
                      : a.source === "assist"
                        ? "AI"
                        : a.source === "tracked"
                          ? "光流"
                          : "插帧"}
                    {a.score !== undefined ? ` ${a.score.toFixed(2)}` : ""}
                  </small>
                </button>
                <div className="row-review">
                  {a.review === "confirmed" ? (
                    <Check className="green" size={15} aria-label="已确认" />
                  ) : a.review === "rejected" ? (
                    <button
                      aria-label={`恢复对象 ${a.trackId} 帧 ${a.frame}`}
                      className="text-button"
                      disabled={disabled || track.locked}
                      onClick={() =>
                        attempt((p) => restoreAnnotation(p, a.trackId, a.frame))
                      }
                    >
                      恢复
                    </button>
                  ) : (
                    <>
                      <button
                        aria-label={`确认对象 ${a.trackId} 帧 ${a.frame}`}
                        disabled={disabled || track.locked}
                        onClick={() =>
                          attempt((p) =>
                            reviewAnnotation(
                              p,
                              a.trackId,
                              a.frame,
                              "confirmed",
                            ),
                          )
                        }
                      >
                        <Check size={15} />
                      </button>
                      <button
                        aria-label={`拒绝对象 ${a.trackId} 帧 ${a.frame}`}
                        disabled={disabled || track.locked}
                        onClick={() =>
                          attempt((p) =>
                            reviewAnnotation(p, a.trackId, a.frame, "rejected"),
                          )
                        }
                      >
                        <X size={15} />
                      </button>
                    </>
                  )}
                </div>
              </div>
            );
          })
        ) : (
          <div className="empty-frames">
            {status === "rejected"
              ? "没有被拒绝的标注"
              : status === "pending"
                ? "此范围没有待确认标注"
                : "尚无对应标注"}
          </div>
        )}
      </div>
      {entries.length > 20 && (
        <div className="list-pagination">
          <button
            aria-label="上一页标注"
            disabled={disabled || actualPage === 0}
            onClick={() => setPage(actualPage - 1)}
          >
            <ChevronLeft size={15} />
          </button>
          <span>
            {actualPage + 1} / {maxPage + 1}
          </span>
          <button
            aria-label="下一页标注"
            disabled={disabled || actualPage === maxPage}
            onClick={() => setPage(actualPage + 1)}
          >
            <ChevronRight size={15} />
          </button>
        </div>
      )}
      {error && (
        <p role="alert" className="field-error">
          {error}
        </p>
      )}
      {confirm && (
        <Modal
          title={confirm === "confirmed" ? "确认候选标注" : "拒绝候选标注"}
          onClose={() => setConfirm(null)}
        >
          <p>
            将{confirm === "confirmed" ? "确认" : "拒绝"}
            {SCOPE_NAMES[scope]}中，当前筛选下的 {pending.length} 个待确认候选。
            {confirm === "rejected"
              ? "拒绝会阻断该处的自动传播，并移除相关的未确认结果。"
              : ""}
            可撤销此操作。
          </p>
          <div className="modal-actions">
            <button className="button" onClick={() => setConfirm(null)}>
              取消
            </button>
            <button className="button primary" onClick={batchReview}>
              确认{confirm === "confirmed" ? "候选" : "拒绝"}
            </button>
          </div>
        </Modal>
      )}
    </section>
  );
}
