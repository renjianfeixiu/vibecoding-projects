import type { Project } from "../core/types.ts";
import type { TrackJobResult } from "../core/batch.ts";
import { readiness } from "../core/batch.ts";
import { scopedTrackIds, SCOPE_NAMES } from "../core/workflow.ts";
import type { OperationScope } from "../core/workflow.ts";
import { assistPlugins, fillPlugins } from "../plugins/registry.ts";
import { Layers, Sparkles } from "./icons.ts";
interface Props {
  project: Project;
  trackId: number;
  disabled: boolean;
  busy: string;
  progress: number;
  scope: OperationScope;
  setScope: (scope: OperationScope) => void;
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
  const { project, trackId, scope, disabled, busy } = props;
  const ids = scopedTrackIds(project, trackId, scope, true);
  const assistEligible = ids.filter(
    (id) => !readiness(project, id, "assist", props.assistId),
  ).length;
  const fillEligible = ids.filter(
    (id) => !readiness(project, id, "fill", props.fillId),
  ).length;
  const skipped = props.result?.filter((r) => r.status !== "done").length ?? 0;
  return (
    <section className="card assist-card">
      <div className="panel-heading">
        <h2>
          <Sparkles size={17} />
          AI 关键帧标注
        </h2>
        <span className="engine-badge">本地</span>
      </div>
      <div className="assist-controls">
        <label>
          处理范围
          <select
            aria-label="自动标注范围"
            value={scope}
            disabled={disabled}
            onChange={(e) => props.setScope(e.target.value as OperationScope)}
          >
            {(["all", "label", "track"] as const).map((v) => (
              <option key={v} value={v}>
                {SCOPE_NAMES[v]}
              </option>
            ))}
          </select>
        </label>
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
        <label className="overwrite-option">
          <input
            type="checkbox"
            checked={props.replacePending}
            disabled={disabled}
            onChange={(e) => props.setReplacePending(e.target.checked)}
          />
          更新未确认候选
        </label>
        {!busy && (
          <>
            <button
              className="button full"
              aria-label="生成 AI 关键帧"
              disabled={disabled || !assistEligible}
              title={
                assistEligible
                  ? `处理 ${assistEligible} 个对象；锁定或缺少人工框的对象会跳过`
                  : "请先为处理范围内的对象画人工参考框"
              }
              onClick={props.assist}
            >
              <Sparkles size={15} />
              生成关键帧 <small>{assistEligible} 个对象</small>
            </button>
            {!assistEligible && (
              <p className="operation-hint">
                先为对象画人工参考框；锁定的对象需先解锁。
              </p>
            )}
          </>
        )}
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
          <>
            <button
              className="button primary full"
              disabled={disabled || !fillEligible}
              title={
                fillEligible
                  ? `处理 ${fillEligible} 个对象的剩余帧`
                  : "光流需要一个已确认关键帧，插值需要两个"
              }
              onClick={props.fillFrames}
            >
              <Layers size={16} />
              补齐剩余帧 <small>{fillEligible} 个对象</small>
            </button>
            {!fillEligible && (
              <p className="operation-hint">
                {props.fillId === "linear"
                  ? "每个对象需两个已确认关键帧。"
                  : "每个对象需一个已确认人工框或 AI 框。"}
              </p>
            )}
          </>
        )}
        <details className="engine-explanation">
          <summary>引擎原理与限制</summary>
          <p>
            本地模板匹配参考每个对象的人工框，在后续画面寻找相似外观，没有调用大模型或训练后的检测模型。适合外观稳定、遮挡少的目标；不会根据类别名称发现新对象。光流逐帧估计运动，匹配证据不足时停止。所有新结果需复核，匹配分数不是正确率。
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
    </section>
  );
}
