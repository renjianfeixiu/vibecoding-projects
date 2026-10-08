import { useEffect, useState } from "react";
import type { Project } from "../core/types.ts";
import { frameCount } from "../core/project.ts";
import {
  editTrack,
  removeTrack,
  setTrackRange,
  trackBounds,
} from "../core/workflow.ts";
import { Modal } from "./Modal.tsx";
import { Plus, Trash2 } from "./icons.ts";
interface Props {
  project: Project;
  trackId: number;
  frame: number;
  disabled: boolean;
  update: (change: (p: Project) => Project) => void;
  select: (id: number) => void;
  add: () => void;
}
export function ObjectPanel(props: Props) {
  const { project, trackId, disabled, select, add, update } = props;
  return (
    <section className="card object-panel">
      <div className="panel-heading">
        <h2>
          对象 <span className="muted">{project.tracks.length}</span>
        </h2>
        <button
          className="text-button"
          disabled={disabled}
          onClick={add}
          aria-label="添加对象"
        >
          <Plus size={14} />
          添加
        </button>
      </div>
      <div className="object-list" aria-label="对象列表">
        {project.tracks.map((track) => {
          const label = project.labels.find((l) => l.id === track.labelId)!;
          const total = project.annotations.filter(
            (a) => a.trackId === track.id && a.review !== "rejected",
          ).length;
          return (
            <div
              key={track.id}
              className={`object-row ${track.id === trackId ? "current" : ""}`}
            >
              <button
                className="object-link"
                aria-label={`选择对象 ${track.name}`}
                disabled={disabled}
                onClick={() => select(track.id)}
              >
                <i style={{ background: label.color }} />
                <span>
                  <strong>{track.name}</strong>
                  <small>
                    {label.name} · {total} 帧
                  </small>
                </span>
              </button>
              <button
                className="text-button"
                disabled={disabled}
                aria-label={`${track.hidden ? "显示" : "隐藏"}对象 ${track.name}`}
                title={track.hidden ? "显示框" : "隐藏框，仍会正常导出"}
                onClick={() =>
                  update((p) =>
                    editTrack(p, track.id, { hidden: !track.hidden }),
                  )
                }
              >
                {track.hidden ? "显示" : "隐藏"}
              </button>
              <button
                className="text-button"
                disabled={disabled}
                aria-label={`${track.locked ? "解锁" : "锁定"}对象 ${track.name}`}
                title={track.locked ? "解锁后可修改" : "锁定以保护标注"}
                onClick={() =>
                  update((p) =>
                    editTrack(p, track.id, { locked: !track.locked }),
                  )
                }
              >
                {track.locked ? "解锁" : "锁定"}
              </button>
            </div>
          );
        })}
      </div>
      <ObjectSettings key={`${project.id}:${trackId}`} {...props} />
    </section>
  );
}
function ObjectSettings({
  project,
  trackId,
  frame,
  disabled,
  update,
  select,
}: Props) {
  const track = project.tracks.find((t) => t.id === trackId)!;
  const bounds = trackBounds(project, trackId);
  const [name, setName] = useState(track.name),
    [start, setStart] = useState(bounds.start),
    [end, setEnd] = useState(bounds.end),
    [error, setError] = useState(""),
    [confirmation, setConfirmation] = useState<"range" | "delete" | null>(null);
  useEffect(() => setName(track.name), [track.name]);
  useEffect(() => {
    setStart(bounds.start);
    setEnd(bounds.end);
  }, [bounds.start, bounds.end]);
  const removed = project.annotations.filter(
    (a) => a.trackId === trackId && (a.frame < start || a.frame > end),
  ).length;
  const total = project.annotations.filter((a) => a.trackId === trackId).length;
  const attempt = (change: (p: Project) => Project) => {
    try {
      update(change);
      setError("");
      setConfirmation(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "操作失败。");
    }
  };
  return (
    <details className="object-settings">
      <summary>
        对象设置{" "}
        <span>
          #{trackId} · {bounds.start}–{bounds.end} 帧
        </span>
      </summary>
      <form
        className="object-name-form"
        onSubmit={(e) => {
          e.preventDefault();
          attempt((p) => editTrack(p, trackId, { name }));
        }}
      >
        <label>
          对象名称
          <input
            aria-label="当前对象名称"
            value={name}
            maxLength={80}
            disabled={disabled || track.locked}
            onChange={(e) => setName(e.target.value)}
          />
        </label>
        <button
          className="button small"
          type="submit"
          disabled={disabled || track.locked || name.trim() === track.name}
        >
          保存名称
        </button>
      </form>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (removed) setConfirmation("range");
          else attempt((p) => setTrackRange(p, trackId, start, end));
        }}
      >
        <div className="object-range-fields">
          <label>
            开始帧
            <input
              aria-label="对象开始帧"
              type="number"
              min={0}
              max={end}
              value={start}
              disabled={disabled || track.locked}
              onChange={(e) => setStart(Number(e.target.value))}
            />
          </label>
          <label>
            结束帧
            <input
              aria-label="对象结束帧"
              type="number"
              min={start}
              max={frameCount(project.media) - 1}
              value={end}
              disabled={disabled || track.locked}
              onChange={(e) => setEnd(Number(e.target.value))}
            />
          </label>
        </div>
        <div className="object-range-actions">
          <button
            type="button"
            className="text-button"
            disabled={disabled || track.locked}
            onClick={() => setStart(frame)}
          >
            当前帧起始
          </button>
          <button
            type="button"
            className="text-button"
            disabled={disabled || track.locked}
            onClick={() => setEnd(frame)}
          >
            当前帧结束
          </button>
          <button
            type="submit"
            className="button small"
            disabled={
              disabled ||
              track.locked ||
              (start === bounds.start && end === bounds.end)
            }
          >
            应用区间
          </button>
        </div>
      </form>
      <button
        className="text-button delete-frame"
        aria-label="删除当前对象"
        disabled={disabled || track.locked || project.tracks.length < 2}
        onClick={() => {
          if (total) setConfirmation("delete");
          else {
            attempt((p) => removeTrack(p, trackId));
            select(project.tracks.find((t) => t.id !== trackId)!.id);
          }
        }}
      >
        <Trash2 size={14} />
        删除对象
      </button>
      {error && (
        <p className="field-error" role="alert">
          {error}
        </p>
      )}
      {confirmation && (
        <Modal
          title={confirmation === "range" ? "调整对象区间" : "删除对象"}
          onClose={() => setConfirmation(null)}
        >
          <p>
            {confirmation === "range"
              ? `区间之外的 ${removed} 个框将移除。`
              : `将删除「${track.name}」及其 ${total} 个框。`}
            操作后可撤销。
          </p>
          <div className="modal-actions">
            <button className="button" onClick={() => setConfirmation(null)}>
              取消
            </button>
            <button
              className="button primary"
              onClick={() => {
                if (confirmation === "range")
                  attempt((p) => setTrackRange(p, trackId, start, end));
                else {
                  attempt((p) => removeTrack(p, trackId));
                  select(project.tracks.find((t) => t.id !== trackId)!.id);
                }
              }}
            >
              确认{confirmation === "range" ? "调整" : "删除"}
            </button>
          </div>
        </Modal>
      )}
    </details>
  );
}
