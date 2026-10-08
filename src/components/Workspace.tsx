import { useEffect, useState } from "react";
import {
  ArrowLeft,
  ArrowRight,
  ChevronLeft,
  ChevronRight,
  CircleHelp,
  Download,
  Hand,
  MousePointer2,
  Pause,
  Play,
  Plus,
  Redo2,
  SquareDashedMousePointer,
  Trash2,
  Undo2,
  X,
} from "./icons.ts";
import type { Box, MediaAsset, Project } from "../core/types.ts";
import { frameCount, reviewAnnotation } from "../core/project.ts";
import { editTrack, trackBounds } from "../core/workflow.ts";
import type { OperationScope } from "../core/workflow.ts";
import type { TrackJobResult } from "../core/batch.ts";
import { LabelManager } from "./LabelManager.tsx";
import { Modal } from "./Modal.tsx";
import { ObjectPanel } from "./ObjectPanel.tsx";
import { AssistPanel } from "./AssistPanel.tsx";
import { ReviewPanel } from "./ReviewPanel.tsx";
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
  manual: (box: Box, trackId?: number) => void;
  copyBox: () => void;
  pasteBox: () => void;
  canPaste: boolean;
  addTrack: () => void;
  scope: OperationScope;
  setScope: (scope: OperationScope) => void;
  replacePending: boolean;
  setReplacePending: (value: boolean) => void;
  jobResult: TrackJobResult[] | null;
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
export function Workspace(props: Props) {
  const { project, asset, frame, playing, tool, trackId, update, busy } = props;
  const [help, setHelp] = useState(false),
    [labelsOpen, setLabelsOpen] = useState(false);
  const count = frameCount(project.media),
    temporal = project.media.kind !== "image",
    disabled = !!busy;
  const track = project.tracks.find((t) => t.id === trackId)!;
  const bounds = trackBounds(project, trackId);
  const editable =
    !disabled &&
    !playing &&
    !track.locked &&
    !track.hidden &&
    frame >= bounds.start &&
    frame <= bounds.end;
  const current = project.annotations.find(
    (a) =>
      a.frame === frame && a.trackId === trackId && a.review !== "rejected",
  );
  const annotations = project.annotations.filter(
    (a) => a.trackId === trackId && a.review !== "rejected",
  );
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
            <span>
              暂停后拖动画框；调整模式可拖动四角。空格播放，方向键逐帧，Shift +
              方向键跳 10 帧。
            </span>
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
          <div>
            <strong>编辑快捷键</strong>
            <span>
              B 画框，V 调整，M 动态，N 新对象；⌘/Ctrl+C 复制当前框，⌘/Ctrl+V
              粘贴到当前对象与帧；Delete 删除框，⌘/Ctrl+Z 撤销，⌘/Ctrl+S
              备份。输入框中仍使用正常编辑快捷键。
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
                onClick={props.addTrack}
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
                  disabled={disabled || playing}
                  onChange={(e) => boxSize("boxWidth", Number(e.target.value))}
                />
                <span>×</span>
                <input
                  aria-label="动态框高度"
                  type="number"
                  min="1"
                  max={project.media.height}
                  value={project.settings.boxHeight}
                  disabled={disabled || playing}
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
          <div className="quick-category-bar">
            <label>
              类别{" "}
              <select
                aria-label="当前目标类别"
                value={track.labelId}
                disabled={disabled || playing || track.locked}
                onChange={(e) =>
                  update((p) =>
                    editTrack(p, trackId, { labelId: Number(e.target.value) }),
                  )
                }
              >
                {project.labels.map((l) => (
                  <option key={l.id} value={l.id}>
                    {l.name}
                  </option>
                ))}
              </select>
            </label>
            <button
              className="text-button"
              disabled={disabled || playing}
              onClick={() => setLabelsOpen(true)}
            >
              类别管理
            </button>
            <button
              className="text-button"
              disabled={disabled || playing || !current}
              onClick={props.copyBox}
              title="复制当前框 ⌘/Ctrl+C"
            >
              复制框
            </button>
            <button
              className="text-button"
              disabled={!editable || !props.canPaste}
              onClick={props.pasteBox}
              title="粘贴到当前对象与帧 ⌘/Ctrl+V"
            >
              粘贴框
            </button>
            <span>
              {track.locked
                ? "对象已锁定"
                : track.hidden
                  ? "对象已隐藏"
                  : frame < bounds.start || frame > bounds.end
                    ? "当前帧在对象区间外"
                    : ""}
            </span>
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
            <AssistPanel
              project={project}
              trackId={trackId}
              disabled={disabled || playing}
              busy={busy}
              progress={props.progress}
              scope={props.scope}
              setScope={props.setScope}
              replacePending={props.replacePending}
              setReplacePending={props.setReplacePending}
              assistId={props.assistId}
              setAssistId={props.setAssistId}
              fillId={props.fillId}
              setFillId={props.setFillId}
              assist={props.assist}
              fillFrames={props.fillFrames}
              cancel={props.cancel}
              update={update}
              result={props.jobResult}
              select={props.setTrackId}
            />
          )}
          <ObjectPanel
            project={project}
            trackId={trackId}
            frame={frame}
            disabled={disabled || playing}
            update={update}
            select={props.setTrackId}
            add={props.addTrack}
          />
          <ReviewPanel
            project={project}
            trackId={trackId}
            frame={frame}
            disabled={disabled || playing}
            update={update}
            select={(id, nextFrame) => {
              props.setTrackId(id);
              props.setFrame(nextFrame);
            }}
          />
          <section className="card coordinate-card">
            <details className="current-frame-editor">
              <summary>
                当前框坐标 <span>{current ? "可编辑" : "无标注"}</span>
              </summary>
              {current && (
                <>
                  <BoxEditor
                    key={`${trackId}:${frame}`}
                    box={current.box}
                    media={project.media}
                    disabled={!editable}
                    apply={props.manual}
                  />
                  <button
                    className="text-button delete-frame"
                    aria-label="删除当前帧标注"
                    disabled={!editable}
                    onClick={() =>
                      update((p) =>
                        reviewAnnotation(p, trackId, frame, "rejected"),
                      )
                    }
                  >
                    <Trash2 size={14} />
                    删除此帧
                  </button>
                </>
              )}
            </details>
          </section>
        </aside>
      </div>
      {labelsOpen && (
        <Modal title="类别管理" onClose={() => setLabelsOpen(false)}>
          <LabelManager project={project} update={update} disabled={disabled} />
        </Modal>
      )}
    </main>
  );
}

export { manualAnnotation } from "../core/workflow.ts";

const BOX_KEYS = ["x", "y", "width", "height"] as const;
function boxDraft(box: Box) {
  return Object.fromEntries(
    BOX_KEYS.map((key) => [key, String(Math.round(box[key] * 10) / 10)]),
  ) as Record<keyof Box, string>;
}
function BoxEditor({
  box,
  media,
  disabled,
  apply,
}: {
  box: Box;
  media: Pick<Project["media"], "width" | "height">;
  disabled: boolean;
  apply: (box: Box) => void;
}) {
  const [draft, setDraft] = useState(() => boxDraft(box)),
    [error, setError] = useState("");
  const reset = () => {
    setDraft(boxDraft(box));
    setError("");
  };
  useEffect(() => {
    setDraft(boxDraft(box));
    setError("");
  }, [box.x, box.y, box.width, box.height]);
  const changed = BOX_KEYS.some((key) => draft[key] !== boxDraft(box)[key]);
  return (
    <form
      noValidate
      onSubmit={(event) => {
        event.preventDefault();
        if (disabled) return;
        const next = Object.fromEntries(
          BOX_KEYS.map((key) => [key, Number(draft[key])]),
        ) as unknown as Box;
        if (
          BOX_KEYS.some(
            (key) => !draft[key].trim() || !Number.isFinite(next[key]),
          ) ||
          next.x < 0 ||
          next.y < 0 ||
          next.width < 1 ||
          next.height < 1 ||
          next.x + next.width > media.width ||
          next.y + next.height > media.height
        ) {
          setError(
            `请输入画面范围内的坐标，宽高至少 1 像素（${media.width} × ${media.height}）。`,
          );
          return;
        }
        apply(next);
      }}
    >
      <div className="coordinate-grid">
        {BOX_KEYS.map((key) => (
          <label key={key}>
            {{ x: "X", y: "Y", width: "宽", height: "高" }[key]}
            <input
              aria-label={`当前框${key}`}
              type="number"
              step="any"
              value={draft[key]}
              disabled={disabled}
              onChange={(e) => {
                setDraft((previous) => ({
                  ...previous,
                  [key]: e.target.value,
                }));
                setError("");
              }}
            />
          </label>
        ))}
      </div>
      <div className="coordinate-actions">
        <button
          type="submit"
          className="button small"
          disabled={disabled || !changed}
        >
          应用坐标
        </button>
        <button
          type="button"
          className="text-button"
          disabled={disabled || !changed}
          onClick={reset}
        >
          还原
        </button>
      </div>
      {error && (
        <p role="alert" className="field-error">
          {error}
        </p>
      )}
    </form>
  );
}
