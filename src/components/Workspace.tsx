import { useState } from "react";
import {
  ArrowLeft,
  ArrowRight,
  Check,
  ChevronLeft,
  ChevronRight,
  CircleHelp,
  Download,
  Hand,
  Layers,
  MousePointer2,
  Pause,
  Play,
  Plus,
  Redo2,
  Sparkles,
  SquareDashedMousePointer,
  Trash2,
  Undo2,
  X,
} from "./icons.ts";
import type { Annotation, Box, MediaAsset, Project } from "../core/types.ts";
import {
  clampBox,
  frameCount,
  invalidateDerived,
  reviewAnnotation,
  setAnnotations,
  SOURCE_COLORS,
  SOURCE_NAMES,
} from "../core/project.ts";
import { assistPlugins, fillPlugins } from "../plugins/registry.ts";
import { MediaStage } from "./MediaStage.tsx";
import { Timeline } from "./Timeline.tsx";
import type { ToolMode } from "./MediaStage.tsx";
import { formatTime } from "./Icon.tsx";

interface Props {
  project: Project;
  asset: MediaAsset;
  frame: number;
  setFrame: (frame: number) => void;
  playing: boolean;
  togglePlay: () => void;
  speed: number;
  setSpeed: (speed: number) => void;
  tool: ToolMode;
  setTool: (mode: ToolMode) => void;
  trackId: number;
  setTrackId: (id: number) => void;
  update: (change: (project: Project) => Project) => void;
  manual: (box: Box) => void;
  onDynamic: (point: { x: number; y: number } | null) => void;
  startDynamic: () => void;
  endDynamic: () => void;
  undo: () => void;
  redo: () => void;
  canUndo: boolean;
  canRedo: boolean;
  busy: string;
  progress: number;
  assist: () => void;
  fillFrames: () => void;
  cancel: () => void;
  assistId: string;
  setAssistId: (id: string) => void;
  fillId: string;
  setFillId: (id: string) => void;
  exportStep: () => void;
  backup: () => void;
  back: () => void;
}
type Filter = "all" | "manual" | "assist" | "derived";
const matches = (a: Annotation, filter: Filter) =>
  filter === "all" ||
  (filter === "derived"
    ? a.source === "tracked" || a.source === "interpolated"
    : a.source === filter);

export function Workspace(props: Props) {
  const { project, asset, frame, playing, tool, trackId, update, busy } = props;
  const [filter, setFilter] = useState<Filter>("all"),
    [pendingOnly, setPendingOnly] = useState(false),
    [page, setPage] = useState(0),
    [help, setHelp] = useState(false);
  const count = frameCount(project.media),
    temporal = project.media.kind !== "image",
    disabled = !!busy;
  const track = project.tracks.find((t) => t.id === trackId)!;
  const current = project.annotations.find(
    (a) =>
      a.frame === frame && a.trackId === trackId && a.review !== "rejected",
  );
  const annotations = project.annotations.filter(
    (a) => a.trackId === trackId && a.review !== "rejected",
  );
  const entries = annotations.filter(
    (a) => matches(a, filter) && (!pendingOnly || a.review === "pending"),
  );
  const pending = annotations.filter((a) => a.review === "pending").length;
  const anchors = annotations.filter(
    (a) =>
      a.review === "confirmed" &&
      (a.source === "manual" || a.source === "assist"),
  );
  const pageMax = Math.max(0, Math.ceil(entries.length / 25) - 1),
    actualPage = Math.min(page, pageMax);
  const review = (a: Annotation, status: "confirmed" | "rejected") =>
    update((p) => reviewAnnotation(p, a.trackId, a.frame, status));
  const confirmFiltered = () =>
    update((p) => ({
      ...p,
      annotations: p.annotations.map((a) =>
        a.trackId === trackId && matches(a, filter) && a.review === "pending"
          ? { ...a, review: "confirmed" }
          : a,
      ),
    }));
  const editBox = (key: keyof Box, value: number) => {
    if (current && Number.isFinite(value))
      props.manual(clampBox({ ...current.box, [key]: value }, project.media));
  };
  const addTrack = () => {
    const id = Math.max(...project.tracks.map((t) => t.id), 0) + 1;
    update((p) => ({
      ...p,
      tracks: [
        ...p.tracks,
        {
          id,
          labelId: p.labels[0].id,
          name: `目标 ${String(id).padStart(2, "0")}`,
        },
      ],
    }));
    props.setTrackId(id);
  };
  const mode = (next: ToolMode) => {
    props.endDynamic();
    props.setTool(next);
  };
  const boxSize = (key: "boxWidth" | "boxHeight", value: number) =>
    update((p) => ({
      ...p,
      settings: {
        ...p.settings,
        [key]: Math.max(
          1,
          Math.min(
            key === "boxWidth" ? p.media.width : p.media.height,
            value || 1,
          ),
        ),
      },
    }));
  return (
    <main className="workspace page-wide">
      <div className="workspace-heading">
        <div>
          <h1>{project.name}</h1>
          <p>
            {project.media.width} × {project.media.height} <span>·</span>{" "}
            {project.media.fps} 帧/秒 <span>·</span> {count.toLocaleString()}{" "}
            标注帧
          </p>
        </div>
        <div className="heading-actions">
          <button
            className="button icon"
            aria-label="操作说明"
            title="操作说明"
            onClick={() => setHelp(!help)}
          >
            <CircleHelp size={19} />
          </button>
          <button
            className="button icon"
            aria-label="素材设置"
            title="素材设置"
            disabled={disabled}
            onClick={props.back}
          >
            <ArrowLeft size={18} />
          </button>
          <button className="button" disabled={disabled} onClick={props.backup}>
            <Download size={16} /> 保存工程
          </button>
          <button
            className="button primary"
            disabled={
              disabled ||
              !project.annotations.some((a) => a.review !== "rejected")
            }
            onClick={props.exportStep}
          >
            导出 <ArrowRight size={16} />
          </button>
        </div>
      </div>
      {help && (
        <div className="help-strip">
          <div>
            <strong>画框</strong>
            <span>暂停后拖动画框；空格播放，方向键逐帧，⌘Z 撤销。</span>
          </div>
          <div>
            <strong>动态标注</strong>
            <span>
              在这里设置框大小，播放后按住鼠标跟随。录制覆盖每个标注帧；播放跳过的帧按鼠标轨迹补齐，离开画面暂停记录。
            </span>
          </div>
          <div>
            <strong>AI 关键帧与补帧</strong>
            <span>
              模板匹配生成间隔关键帧，确认后可选线性插帧或光流跟踪。光流逐帧查看像素并校验外观，跟丢时留空；分数是匹配相关性。
            </span>
          </div>
          <div>
            <strong>模型扩展</strong>
            <span>
              当前运行本地视觉算法。多模态模型和 SAM
              系列可通过辅助插件接入，尚未部署。
            </span>
          </div>
          <button aria-label="关闭操作说明" onClick={() => setHelp(false)}>
            <X size={17} />
          </button>
        </div>
      )}
      <div className="workbench-grid">
        <section className="card viewer-card">
          <div className="viewer-toolbar">
            <div className="tool-group">
              <button
                className={tool === "draw" ? "active" : ""}
                disabled={disabled || playing}
                onClick={() => mode("draw")}
              >
                <SquareDashedMousePointer size={17} />
                画框
              </button>
              <button
                className={tool === "move" ? "active" : ""}
                disabled={disabled || playing}
                onClick={() => mode("move")}
              >
                <Hand size={17} />
                调整
              </button>
              {temporal && (
                <button
                  className={tool === "dynamic" ? "active" : ""}
                  disabled={disabled}
                  onClick={() => mode("dynamic")}
                >
                  <MousePointer2 size={17} />
                  动态标注
                </button>
              )}
            </div>
            <div className="undo-controls">
              <button
                aria-label="撤销"
                title="撤销 ⌘Z"
                disabled={!props.canUndo || disabled || playing}
                onClick={props.undo}
              >
                <Undo2 size={17} />
              </button>
              <button
                aria-label="重做"
                title="重做 ⌘⇧Z"
                disabled={!props.canRedo || disabled || playing}
                onClick={props.redo}
              >
                <Redo2 size={17} />
              </button>
            </div>
          </div>
          <div className="canvas-options">
            <div className="target-controls">
              <select
                aria-label="当前目标"
                value={trackId}
                disabled={disabled || playing}
                onChange={(e) => props.setTrackId(Number(e.target.value))}
              >
                {project.tracks.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name} ·{" "}
                    {project.labels.find((l) => l.id === t.labelId)?.name}
                  </option>
                ))}
              </select>
              <button
                className="button icon mini"
                aria-label="添加目标"
                title="添加目标"
                disabled={disabled || playing}
                onClick={addTrack}
              >
                <Plus size={17} />
              </button>
            </div>
            {tool === "dynamic" && (
              <div className="dynamic-options">
                <span>框大小</span>
                <input
                  aria-label="动态框宽度"
                  type="number"
                  min="1"
                  max={project.media.width}
                  value={project.settings.boxWidth}
                  disabled={disabled}
                  onChange={(e) => boxSize("boxWidth", Number(e.target.value))}
                />
                <span>×</span>
                <input
                  aria-label="动态框高度"
                  type="number"
                  min="1"
                  max={project.media.height}
                  value={project.settings.boxHeight}
                  disabled={disabled}
                  onChange={(e) => boxSize("boxHeight", Number(e.target.value))}
                />
                <span>px</span>
                {current && (
                  <button
                    className="text-button"
                    disabled={disabled || playing}
                    title="取当前人工框的宽高"
                    onClick={() =>
                      update((p) => ({
                        ...p,
                        settings: {
                          ...p.settings,
                          boxWidth: current.box.width,
                          boxHeight: current.box.height,
                        },
                      }))
                    }
                  >
                    取当前框
                  </button>
                )}
                <span className="all-frames">全帧</span>
              </div>
            )}
          </div>
          <div className="stage-wrap">
            <MediaStage
              project={project}
              asset={asset}
              frame={frame}
              playing={playing}
              tool={tool}
              trackId={trackId}
              disabled={disabled}
              onBox={props.manual}
              selectTrack={props.setTrackId}
              onDynamic={props.onDynamic}
              startDynamic={props.startDynamic}
              endDynamic={props.endDynamic}
            />
          </div>
          <div className="playback-bar">
            <div className="playback-buttons">
              <button
                aria-label="上一帧"
                disabled={disabled || playing || frame === 0}
                onClick={() => props.setFrame(frame - 1)}
              >
                <ChevronLeft size={20} />
              </button>
              <button
                className="play-button"
                aria-label={playing ? "暂停" : "播放"}
                disabled={disabled || !temporal}
                onClick={props.togglePlay}
              >
                {playing ? (
                  <Pause size={17} fill="currentColor" />
                ) : (
                  <Play size={17} fill="currentColor" />
                )}
              </button>
              <button
                aria-label="下一帧"
                disabled={disabled || playing || frame >= count - 1}
                onClick={() => props.setFrame(frame + 1)}
              >
                <ChevronRight size={20} />
              </button>
            </div>
            <div className="frame-readout">
              帧{" "}
              <input
                aria-label="跳转帧号"
                type="number"
                min="0"
                max={count - 1}
                value={frame}
                disabled={playing || disabled}
                onChange={(e) => props.setFrame(Number(e.target.value) || 0)}
              />
              <span>/ {count - 1}</span>
            </div>
            <div className="playback-right">
              <span>
                {formatTime(frame / project.media.fps)} /{" "}
                {formatTime(project.media.duration)}
              </span>
              <select
                aria-label="播放速度"
                value={props.speed}
                disabled={disabled}
                onChange={(e) => props.setSpeed(Number(e.target.value))}
              >
                {[0.25, 0.5, 1, 1.5, 2].map((speed) => (
                  <option key={speed} value={speed}>
                    {speed}×
                  </option>
                ))}
              </select>
            </div>
          </div>
          <Timeline
            project={project}
            trackId={trackId}
            annotations={annotations}
            frame={frame}
            playing={playing}
            disabled={disabled}
            setFrame={props.setFrame}
            update={update}
          />
        </section>
        <aside className="review-column">
          {temporal && (
            <section className="card assist-card">
              <div className="panel-heading">
                <h2>
                  <Sparkles size={17} /> AI 关键帧标注
                </h2>
              </div>
              <div className="assist-controls">
                <label>
                  标注引擎
                  <select
                    aria-label="AI 关键帧标注引擎"
                    value={props.assistId}
                    disabled={disabled || playing}
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
                  <span>每隔</span>
                  <input
                    aria-label="AI 关键帧间隔"
                    type="number"
                    min="1"
                    max="18000"
                    disabled={disabled || playing}
                    value={project.settings.assistInterval}
                    onChange={(e) =>
                      update((p) => ({
                        ...p,
                        settings: {
                          ...p.settings,
                          assistInterval: Math.min(
                            18000,
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
                  <button
                    className="button small"
                    disabled={
                      disabled ||
                      playing ||
                      !anchors.some((a) => a.source === "manual")
                    }
                    onClick={props.assist}
                  >
                    <Sparkles size={14} /> 生成
                  </button>
                </div>
                <label>
                  补帧方式
                  <select
                    aria-label="补帧方式"
                    value={props.fillId}
                    disabled={disabled || playing}
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
                  <div className="job-progress">
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
                    className="button primary full"
                    disabled={
                      playing ||
                      anchors.length < (props.fillId === "linear" ? 2 : 1)
                    }
                    onClick={props.fillFrames}
                  >
                    <Layers size={16} /> 补齐剩余帧
                  </button>
                )}
              </div>
            </section>
          )}
          <section className="card review-panel">
            <div className="panel-heading">
              <h2>帧复核</h2>
              {pending > 0 && (
                <span className="status pending">{pending} 待确认</span>
              )}
            </div>
            <div className="source-tabs">
              {(["all", "manual", "assist", "derived"] as Filter[]).map(
                (value) => (
                  <button
                    key={value}
                    className={filter === value ? "active" : ""}
                    onClick={() => {
                      setFilter(value);
                      setPage(0);
                    }}
                  >
                    {
                      {
                        all: "全部",
                        manual: "人工",
                        assist: "AI 关键帧",
                        derived: "补帧",
                      }[value]
                    }
                  </button>
                ),
              )}
            </div>
            <div className="review-actions">
              <label>
                <input
                  type="checkbox"
                  checked={pendingOnly}
                  onChange={(e) => {
                    setPendingOnly(e.target.checked);
                    setPage(0);
                  }}
                />
                待确认
              </label>
              <button
                className="text-button"
                disabled={
                  disabled ||
                  playing ||
                  !entries.some((a) => a.review === "pending")
                }
                onClick={confirmFiltered}
              >
                全部确认
              </button>
            </div>
            <div className="frame-list">
              {entries.length ? (
                entries
                  .slice(actualPage * 25, (actualPage + 1) * 25)
                  .map((a) => (
                    <div
                      key={a.frame}
                      className={`frame-row ${a.frame === frame ? "current" : ""}`}
                    >
                      <button
                        className="frame-link"
                        disabled={disabled || playing}
                        onClick={() => props.setFrame(a.frame)}
                      >
                        <i style={{ background: SOURCE_COLORS[a.source] }} />
                        <strong>帧 {String(a.frame).padStart(4, "0")}</strong>
                        <small title={SOURCE_NAMES[a.source]}>
                          {a.source === "tracked"
                            ? "光流"
                            : a.source === "interpolated"
                              ? "插帧"
                              : a.source === "manual"
                                ? "人工"
                                : "AI"}
                          {a.score !== undefined
                            ? ` ${a.score.toFixed(2)}`
                            : ""}
                        </small>
                      </button>
                      <div className="row-review">
                        {a.review === "confirmed" ? (
                          <Check
                            size={15}
                            className="green"
                            aria-label="已确认"
                          />
                        ) : (
                          <>
                            <button
                              aria-label={`确认帧 ${a.frame}`}
                              title="确认"
                              disabled={disabled || playing}
                              onClick={() => review(a, "confirmed")}
                            >
                              <Check size={15} />
                            </button>
                            <button
                              aria-label={`拒绝帧 ${a.frame}`}
                              title="拒绝"
                              disabled={disabled || playing}
                              onClick={() => review(a, "rejected")}
                            >
                              <X size={15} />
                            </button>
                          </>
                        )}
                      </div>
                    </div>
                  ))
              ) : (
                <div className="empty-frames">
                  <SquareDashedMousePointer size={27} strokeWidth={1.4} />
                  <span>
                    {annotations.length
                      ? "暂无对应标注"
                      : "在画面上标出第一个目标"}
                  </span>
                </div>
              )}
            </div>
            {entries.length > 25 && (
              <div className="list-pagination">
                <button
                  aria-label="上一页标注"
                  disabled={actualPage === 0}
                  onClick={() => setPage(actualPage - 1)}
                >
                  <ChevronLeft size={15} />
                </button>
                <span>
                  {actualPage + 1} / {pageMax + 1}
                </span>
                <button
                  aria-label="下一页标注"
                  disabled={actualPage === pageMax}
                  onClick={() => setPage(actualPage + 1)}
                >
                  <ChevronRight size={15} />
                </button>
              </div>
            )}
            <details className="current-frame-editor">
              <summary>
                当前框坐标 <span>{current ? "可编辑" : "无标注"}</span>
              </summary>
              {current && (
                <>
                  <div className="coordinate-grid">
                    {(["x", "y", "width", "height"] as const).map((key) => (
                      <label key={key}>
                        {{ x: "X", y: "Y", width: "宽", height: "高" }[key]}
                        <input
                          aria-label={`当前框${key}`}
                          type="number"
                          value={Math.round(current.box[key] * 10) / 10}
                          disabled={disabled || playing}
                          onChange={(e) => editBox(key, Number(e.target.value))}
                        />
                      </label>
                    ))}
                  </div>
                  <button
                    className="text-button delete-frame"
                    aria-label="删除当前帧标注"
                    disabled={disabled || playing}
                    onClick={() =>
                      update((p) =>
                        reviewAnnotation(p, trackId, frame, "rejected"),
                      )
                    }
                  >
                    <Trash2 size={14} /> 删除此帧
                  </button>
                </>
              )}
            </details>
            <details className="target-settings">
              <summary>对象设置</summary>
              <label>
                当前目标类别
                <select
                  aria-label="当前目标类别"
                  value={track.labelId}
                  disabled={disabled || playing}
                  onChange={(e) =>
                    update((p) => ({
                      ...p,
                      tracks: p.tracks.map((t) =>
                        t.id === trackId
                          ? { ...t, labelId: Number(e.target.value) }
                          : t,
                      ),
                    }))
                  }
                >
                  {project.labels.map((l) => (
                    <option key={l.id} value={l.id}>
                      {l.name}
                    </option>
                  ))}
                </select>
              </label>
            </details>
          </section>
        </aside>
      </div>
    </main>
  );
}

export function manualAnnotation(
  project: Project,
  trackId: number,
  frame: number,
  box: Box,
): Project {
  return setAnnotations(invalidateDerived(project, trackId), [
    { trackId, frame, box, source: "manual", review: "confirmed" },
  ]);
}
