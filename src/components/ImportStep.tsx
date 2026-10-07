import { useEffect, useRef, useState } from "react";
import {
  ArrowRight,
  Check,
  FileCheck2,
  FileVideo,
  Image,
  Play,
  Plus,
  RotateCcw,
  Upload,
  X,
} from "./icons.ts";
import type { MediaAsset, Project } from "../core/types.ts";
import {
  frameCount,
  LIMIT_FRAMES,
  setTaskFrameRate,
  sourceFrameRate,
} from "../core/project.ts";
import { Field, formatTime } from "./Icon.tsx";
import type { AnnotationImportBundle } from "../core/import.ts";
import { removeLabel } from "../core/labels.ts";

interface Props {
  project: Project | null;
  asset: MediaAsset | null;
  saved: Project | null;
  loading: boolean;
  load: (file: File) => void;
  useDemo: () => void;
  restore: (project: Project) => void;
  update: (change: (project: Project) => Project) => void;
  begin: () => void;
  annotationImport: AnnotationImportBundle | null;
  loadAnnotations: (files: File[]) => void;
  clearAnnotations: () => void;
}
export function ImportStep({
  project,
  asset,
  saved,
  loading,
  load,
  useDemo,
  restore,
  update,
  begin,
  annotationImport,
  loadAnnotations,
  clearAnnotations,
}: Props) {
  const input = useRef<HTMLInputElement>(null);
  const annotationsInput = useRef<HTMLInputElement>(null);
  const [drag, setDrag] = useState(false),
    [newLabel, setNewLabel] = useState(""),
    [deletingLabel, setDeletingLabel] = useState<number | null>(null),
    [replacementId, setReplacementId] = useState(0);
  const taskMedia = annotationImport?.project?.media ?? project?.media;
  useEffect(() => setDeletingLabel(null), [project?.id]);
  const frameRateLocked =
    !!project?.annotations.length || !!annotationImport?.project;
  const addLabel = () => {
    const name = newLabel.trim();
    if (
      !name ||
      !project ||
      project.labels.some((label) => label.name === name)
    )
      return;
    update((p) => ({
      ...p,
      labels: [
        ...p.labels,
        {
          id: Math.max(...p.labels.map((l) => l.id)) + 1,
          name,
          color: ["#4478ef", "#13a896", "#e6a342", "#ac85d8"][
            p.labels.length % 4
          ],
        },
      ],
    }));
    setNewLabel("");
  };
  const requestRemove = (id: number) => {
    if (!project || project.labels.length < 2) return;
    const affected = new Set(
      project.tracks.filter((t) => t.labelId === id).map((t) => t.id),
    );
    if (project.annotations.some((a) => affected.has(a.trackId))) {
      setDeletingLabel(id);
      setReplacementId(project.labels.find((l) => l.id !== id)!.id);
    } else update((p) => removeLabel(p, id));
  };
  const selectedLabel = project?.labels.find((l) => l.id === deletingLabel);
  return (
    <main className={`import-step ${project ? "has-material" : ""}`}>
      <div className="hero">
        <span className="hero-kicker">帧序 · 视频标注工作台</span>
        <h1>从一段素材开始</h1>
        <p>导入素材，让标注自然发生。</p>
      </div>
      <div className="import-content">
        <input
          ref={input}
          data-testid="media-input"
          type="file"
          accept="video/*,image/png,image/jpeg,image/webp,.mp4,.webm,.mov"
          hidden
          onChange={(e) => {
            if (e.target.files?.[0]) load(e.target.files[0]);
            e.target.value = "";
          }}
        />
        <button
          className={`drop-zone ${drag ? "dragging" : ""} ${project ? "has-file" : ""}`}
          disabled={loading}
          onClick={() => input.current?.click()}
          onDragOver={(e) => {
            e.preventDefault();
            setDrag(true);
          }}
          onDragLeave={() => setDrag(false)}
          onDrop={(e) => {
            e.preventDefault();
            setDrag(false);
            if (e.dataTransfer.files[0]) load(e.dataTransfer.files[0]);
          }}
        >
          {project ? (
            <>
              <span className="upload-icon">
                {project.media.kind === "image" ? (
                  <Image size={28} />
                ) : (
                  <FileVideo size={28} />
                )}
              </span>
              <strong>{project.media.fileName}</strong>
              <span>
                {project.media.width} × {project.media.height}
                {project.media.kind !== "image" &&
                  ` · ${formatTime(project.media.duration)} · ${frameCount(taskMedia!)} 标注帧`}
              </span>
              <span className="file-state">
                {asset ? (
                  <>
                    <Check size={14} /> 已导入 · 点击更换
                  </>
                ) : (
                  "点击重新关联原文件"
                )}
              </span>
            </>
          ) : (
            <>
              <span className="upload-icon">
                <Upload size={30} strokeWidth={1.6} />
              </span>
              <strong>{loading ? "正在读取素材…" : "拖入视频或图像"}</strong>
              <span>或点击选择文件</span>
              <small>MP4 / WebM / MOV · JPG / PNG / WebP</small>
            </>
          )}
        </button>
        <div className="quick-actions">
          <input
            ref={annotationsInput}
            data-testid="annotation-input"
            type="file"
            accept=".zip,.json,.xml,.txt,.csv,.names"
            multiple
            hidden
            onChange={(e) => {
              if (e.target.files?.length) loadAnnotations([...e.target.files]);
              e.target.value = "";
            }}
          />
          <button
            className="button pill"
            disabled={loading}
            onClick={() => annotationsInput.current?.click()}
          >
            <FileCheck2 size={16} />{" "}
            {annotationImport ? "更换标注文件" : "选择标注文件"}
          </button>
          <button className="button pill" disabled={loading} onClick={useDemo}>
            <Play size={16} /> 试用示例视频
          </button>
          {saved && !project && (
            <button
              className="button pill"
              disabled={loading}
              onClick={() => restore(saved)}
            >
              <RotateCcw size={16} /> 继续上次标注
            </button>
          )}
        </div>
        {annotationImport && (
          <div className="annotation-file" role="status">
            <FileCheck2 size={20} />
            <div>
              <strong>{annotationImport.name}</strong>
              <span>
                {annotationImport.format}
                {annotationImport.project
                  ? ` · ${annotationImport.project.annotations.length} 个框`
                  : " · 待关联素材"}
              </span>
            </div>
            <button
              className="button icon"
              aria-label="清除标注文件选择"
              disabled={loading}
              onClick={clearAnnotations}
            >
              <X size={16} />
            </button>
          </div>
        )}
        <details className="annotation-import-help">
          <summary>标注文件支持哪些格式？</summary>
          <p>
            可直接选择帧序导出的全部 20 种 ZIP、工程 JSON，或 COCO、CVAT
            XML、YOLO / Darknet、VOC、LabelMe JSON、MOT、帧序
            CSV。多帧标签可多选；YOLO 类别名可一起选择 classes.txt 或
            obj.names。
          </p>
          <p>
            需要选择对应原素材。独立图像标签用 frame_000000 或从 0
            开始的数字文件名表示帧号；COCO 无此命名时按 images
            列表顺序对应视频。无轨迹 ID 的格式保留独立框，不推断目标身份。CVAT
            稀疏轨迹按文件的关键帧规则做线性展开。
          </p>
        </details>
        {project && (
          <section className="import-settings">
            <div className="basic-settings">
              <Field label="任务名称">
                <input
                  aria-label="任务名称"
                  value={project.name}
                  onChange={(e) =>
                    update((p) => ({ ...p, name: e.target.value }))
                  }
                />
              </Field>
              {project.media.kind !== "image" && (
                <Field label="帧切分">
                  <div className="input-unit">
                    <input
                      aria-label="标注帧率"
                      type="number"
                      min="1"
                      max={sourceFrameRate(taskMedia!)}
                      step="0.01"
                      title={
                        frameRateLocked
                          ? "已有标注时帧率固定；新任务可设置帧切分"
                          : "标注与导出共同使用的帧率"
                      }
                      disabled={frameRateLocked}
                      value={taskMedia!.fps}
                      onChange={(e) =>
                        update((p) =>
                          setTaskFrameRate(p, Number(e.target.value)),
                        )
                      }
                    />
                    <span>帧/秒</span>
                  </div>
                </Field>
              )}
            </div>
            {project.media.kind !== "image" && (
              <details className="label-settings source-settings">
                <summary>
                  原视频参数 <span>{sourceFrameRate(taskMedia!)} 帧/秒</span>
                </summary>
                <Field label="原视频帧率">
                  <div className="input-unit">
                    <input
                      aria-label="原视频帧率"
                      type="number"
                      min="1"
                      max="120"
                      step="0.01"
                      disabled={frameRateLocked}
                      value={sourceFrameRate(taskMedia!)}
                      onChange={(e) => {
                        const fps = Math.min(
                          120,
                          Math.max(1, Number(e.target.value) || 1),
                        );
                        update((p) => {
                          const taskFps =
                            p.media.fps === sourceFrameRate(p.media)
                              ? fps
                              : Math.min(fps, p.media.fps);
                          return setTaskFrameRate(
                            {
                              ...p,
                              media: { ...p.media, sourceFps: fps },
                            },
                            taskFps,
                          );
                        });
                      }}
                    />
                    <span>帧/秒</span>
                  </div>
                </Field>
                <p>请按素材信息确认原视频帧率。标注帧率可低于原视频帧率。</p>
              </details>
            )}
            <details className="label-settings">
              <summary>
                标注类别{" "}
                <span>{project.labels.map((l) => l.name).join(" · ")}</span>
              </summary>
              <div className="label-chips">
                {project.labels.map((l) => (
                  <span key={l.id}>
                    <i style={{ background: l.color }} />
                    {l.name}
                    <button
                      className="label-remove"
                      aria-label={`删除类别 ${l.name}`}
                      title={
                        project.labels.length < 2
                          ? "至少保留一个类别，可先添加新类别再删除"
                          : `删除 ${l.name}`
                      }
                      disabled={
                        loading || project.labels.length < 2 || !!selectedLabel
                      }
                      onClick={() => requestRemove(l.id)}
                    >
                      <X size={13} />
                    </button>
                  </span>
                ))}
              </div>
              {project.labels.length === 1 && (
                <p className="label-minimum">
                  至少保留一个类别；可先添加新类别再删除。
                </p>
              )}
              {selectedLabel && (
                <div
                  className="label-migration"
                  role="group"
                  aria-label="类别迁移"
                >
                  <p>「{selectedLabel.name}」已有标注，迁移目标后删除类别。</p>
                  <div>
                    <select
                      aria-label="迁移到的类别"
                      value={replacementId}
                      disabled={loading}
                      onChange={(e) => setReplacementId(Number(e.target.value))}
                    >
                      {project.labels
                        .filter((l) => l.id !== deletingLabel)
                        .map((l) => (
                          <option key={l.id} value={l.id}>
                            {l.name}
                          </option>
                        ))}
                    </select>
                    <button
                      className="button small"
                      disabled={loading}
                      onClick={() => setDeletingLabel(null)}
                    >
                      取消
                    </button>
                    <button
                      className="button primary small"
                      disabled={loading}
                      onClick={() => {
                        update((p) =>
                          removeLabel(p, selectedLabel.id, replacementId),
                        );
                        setDeletingLabel(null);
                      }}
                    >
                      迁移并删除
                    </button>
                  </div>
                </div>
              )}
              <div className="add-label">
                <input
                  aria-label="新类别名称"
                  placeholder="添加类别"
                  value={newLabel}
                  onChange={(e) => setNewLabel(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      addLabel();
                    }
                  }}
                />
                <button
                  className="button icon"
                  title="添加类别"
                  aria-label="添加类别"
                  disabled={!newLabel.trim()}
                  onClick={addLabel}
                >
                  <Plus size={17} />
                </button>
              </div>
            </details>
            <button
              className="button primary large enter-workspace"
              disabled={
                !asset ||
                loading ||
                frameCount(project.media) > LIMIT_FRAMES ||
                !project.name.trim()
              }
              onClick={begin}
            >
              {annotationImport || project.annotations.length
                ? "浏览标注"
                : "开始标注"}{" "}
              <ArrowRight size={18} />
            </button>
          </section>
        )}
      </div>
    </main>
  );
}
