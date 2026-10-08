import type { Project } from "../core/types.ts";
import type { TrackJobResult } from "../core/batch.ts";
import { readiness } from "../core/batch.ts";
import { assistPlugins, fillPlugins } from "../plugins/registry.ts";
import { Layers, Sparkles } from "./icons.ts";

interface Props {
  project: Project;
  ids: number[];
  mode: "assist" | "fill";
  disabled: boolean;
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
  select: (id: number) => void;
}
export function AssistPanel(props: Props) {
  const { project, ids, mode, disabled, busy } = props;
  const eligible = ids.filter(
    (id) =>
      !readiness(
        project,
        id,
        mode,
        mode === "assist" ? props.assistId : props.fillId,
      ),
  ).length;
  const skipped = props.result?.filter((r) => r.status !== "done").length ?? 0;
  return (
    <div className="assist-controls stage-generation">
      {mode === "assist" ? (
        <>
          <label>
            标注引擎
            <select
              aria-label="AI 关键帧标注引擎"
              value={props.assistId}
              disabled={disabled}
              onChange={(e) => props.setAssistId(e.target.value)}
            >
              {assistPlugins.list().map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </label>
          <div className="interval-control">
            <span>AI 间隔</span>
            <input
              aria-label="AI 关键帧间隔"
              type="number"
              min={1}
              max={18000}
              value={project.settings.assistInterval}
              disabled={disabled}
              onChange={(e) =>
                props.update((p) => ({
                  ...p,
                  settings: {
                    ...p.settings,
                    assistInterval: Math.min(
                      18000,
                      Math.max(1, Math.round(Number(e.target.value) || 1)),
                    ),
                  },
                }))
              }
            />
            <span>标注帧</span>
          </div>
        </>
      ) : (
        <label>
          补帧方式
          <select
            aria-label="补帧方式"
            value={props.fillId}
            disabled={disabled}
            onChange={(e) => props.setFillId(e.target.value)}
          >
            {fillPlugins.list().map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </label>
      )}
      <label className="overwrite-option">
        <input
          type="checkbox"
          checked={props.replacePending}
          disabled={disabled}
          onChange={(e) => props.setReplacePending(e.target.checked)}
        />
        更新未确认候选
      </label>
      {busy ? (
        <div className="job-progress" role="status">
          <div>
            <span>{busy}</span>
            <strong>{Math.round(props.progress)}%</strong>
          </div>
          <div className="progress-track">
            <i style={{ width: `${props.progress}%` }} />
          </div>
          <button className="text-button" onClick={props.cancel}>
            取消任务
          </button>
        </div>
      ) : (
        <button
          className="button full"
          disabled={disabled || !eligible}
          aria-label={mode === "assist" ? "生成 AI 关键帧" : "生成补帧"}
          onClick={mode === "assist" ? props.assist : props.fillFrames}
        >
          {mode === "assist" ? <Sparkles size={16} /> : <Layers size={16} />}
          {mode === "assist" ? "生成 AI 关键帧" : "生成补帧"}
          <small>{eligible} 个对象</small>
        </button>
      )}
      {!eligible && !busy && (
        <p className="operation-hint">
          {mode === "fill" && props.fillId === "linear"
            ? "线性插帧需要每个对象至少两个已确认关键帧。"
            : "请先完成上一步复核；缺少人工框或已锁定的对象会跳过。"}
        </p>
      )}
      <details className="engine-explanation">
        <summary>引擎原理与限制</summary>
        <p>
          当前 AI
          引擎用人工框的像素作本地模板匹配，未调用大模型，不能只按类别名发现新对象。光流逐帧估计运动并校验外观，证据不足时留空。新结果需人工复核；匹配分数不是正确率。
        </p>
      </details>
      {props.result && (
        <details className="batch-result" open={skipped > 0}>
          <summary>
            最近任务：{props.result.filter((r) => r.status === "done").length}{" "}
            个完成{skipped ? ` · ${skipped} 个需处理` : ""}
          </summary>
          {props.result.map((r) => (
            <div key={r.trackId}>
              <button
                className="text-button"
                onClick={() => props.select(r.trackId)}
                disabled={disabled}
              >
                {r.name}
              </button>
              <span>
                {r.status === "done"
                  ? `${r.count} 帧`
                  : r.status === "skipped"
                    ? "跳过"
                    : "失败"}
              </span>
              <small>{r.message}</small>
            </div>
          ))}
        </details>
      )}
    </div>
  );
}
