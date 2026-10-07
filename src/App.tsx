import { useCallback, useEffect, useRef, useState } from "react";
import {
  Check,
  ChevronRight,
  FolderOpen,
  Github,
  ShieldCheck,
  X,
} from "./components/icons.ts";
import type {
  AuditFindingStatus,
  AuditReport,
  Box,
  MediaAsset,
  Project,
} from "./core/types.ts";
import { auditIsCurrent, updateAuditFinding } from "./core/audit.ts";
import { recordMouseFrames } from "./core/dynamic.ts";
import type { MouseSample } from "./core/dynamic.ts";
import {
  applyAnnotationImport,
  prepareAnnotationImport,
  readAnnotationFiles,
} from "./core/import.ts";
import type { AnnotationImportBundle } from "./core/import.ts";
import {
  createProject,
  frameCount,
  LIMIT_FRAMES,
  parseProject,
  setAnnotations,
  timeToFrame,
} from "./core/project.ts";
import { useProject, savedProject } from "./hooks/useProject.ts";
import {
  demoAsset,
  loadAsset,
  makeFrameReader,
  releaseAsset,
  seekVideo,
} from "./media/source.ts";
import {
  assistPlugins,
  auditPlugins,
  fillPlugins,
} from "./plugins/registry.ts";
import { Brand } from "./components/Icon.tsx";
import { ImportStep } from "./components/ImportStep.tsx";
import { Workspace, manualAnnotation } from "./components/Workspace.tsx";
import { ReviewStep } from "./components/ReviewStep.tsx";
import type { ExportSettings } from "./components/ExportStep.tsx";
import {
  ExportStep,
  downloadBlob,
  safeFileName,
} from "./components/ExportStep.tsx";
import type { ToolMode } from "./components/MediaStage.tsx";

export default function App() {
  const state = useProject();
  const { project, current, initialize, update, checkpoint } = state;
  const [asset, setAsset] = useState<MediaAsset | null>(null),
    [step, setStep] = useState(1),
    [saved] = useState(savedProject);
  const assetRef = useRef<MediaAsset | null>(null);
  const [frame, setFrameState] = useState(0),
    frameRef = useRef(0);
  const [playing, setPlaying] = useState(false),
    playingRef = useRef(false);
  const [speed, setSpeed] = useState(1),
    [tool, setTool] = useState<ToolMode>("draw"),
    [trackId, setTrackId] = useState(1);
  const activeTrackId = project?.tracks.some((t) => t.id === trackId)
    ? trackId
    : (project?.tracks[0].id ?? 1);
  const [assistId, setAssistId] = useState("local-template");
  const [annotationImport, setAnnotationImport] =
    useState<AnnotationImportBundle | null>(null);
  const appliedImport = useRef<{
    bundle: AnnotationImportBundle;
    asset: MediaAsset;
  } | null>(null);
  const [fillId, setFillId] = useState("pyramidal-lk");
  const [auditId, setAuditId] = useState("local-quality");
  const [audit, setAudit] = useState<{
    report: AuditReport;
    basis: Project;
  } | null>(null);
  const [auditSkipped, setAuditSkipped] = useState(false);
  const [exportSettings, setExportSettings] = useState<ExportSettings>({
    format: "coco",
    confirmedOnly: true,
    images: false,
  });
  const auditFresh = !!(
    project &&
    audit &&
    auditIsCurrent(project, audit.basis)
  );
  useEffect(() => {
    setAudit(null);
    setAuditSkipped(false);
    setExportSettings({ format: "coco", confirmedOnly: true, images: false });
  }, [project?.id]);
  const [loading, setLoading] = useState(false),
    [busy, setBusy] = useState(""),
    [exportBusy, setExportBusy] = useState(false),
    [progress, setProgress] = useState(0);
  const [toast, setToast] = useState(""),
    toastTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);
  const restoreInput = useRef<HTMLInputElement>(null),
    controller = useRef<AbortController | null>(null);
  const recording = useRef(false),
    pointer = useRef<{ x: number; y: number } | null>(null),
    lastSample = useRef<MouseSample | null>(null);
  const playbackClock = useRef<{
    origin: number;
    startTime: number;
    speed: number;
  } | null>(null);
  const dynamicSampler = useRef<(frame: number) => void>(() => {});
  const taskFrameNow = useCallback(() => {
    const p = current.current,
      media = assetRef.current?.element,
      clock = playbackClock.current;
    if (!p) return frameRef.current;
    if (media instanceof HTMLVideoElement)
      return timeToFrame(media.currentTime, p.media);
    return clock
      ? timeToFrame(
          clock.startTime +
            ((performance.now() - clock.origin) / 1000) * clock.speed,
          p.media,
        )
      : frameRef.current;
  }, [current]);
  const allBusy = !!busy || exportBusy || loading;
  const notify = useCallback((message: string) => {
    setToast(message);
    if (toastTimeout.current) clearTimeout(toastTimeout.current);
    toastTimeout.current = setTimeout(() => setToast(""), 6500);
  }, []);
  const endDynamic = useCallback(() => {
    recording.current = false;
    pointer.current = null;
    lastSample.current = null;
  }, []);
  const pause = useCallback(() => {
    if (playingRef.current) dynamicSampler.current(taskFrameNow());
    playingRef.current = false;
    setPlaying(false);
    endDynamic();
    playbackClock.current = null;
    if (assetRef.current?.element instanceof HTMLVideoElement)
      assetRef.current.element.pause();
  }, [endDynamic, taskFrameNow]);
  const setFrame = useCallback(
    (value: number) => {
      pause();
      const p = current.current;
      if (!p) return;
      const next = Math.max(
        0,
        Math.min(frameCount(p.media) - 1, Math.round(value)),
      );
      frameRef.current = next;
      setFrameState(next);
    },
    [pause, current],
  );
  const replaceAsset = (next: MediaAsset) => {
    pause();
    releaseAsset(assetRef.current);
    assetRef.current = next;
    setAsset(next);
  };
  const load = async (file: File) => {
    if (allBusy) return;
    pause();
    setLoading(true);
    try {
      const next = await loadAsset(file);
      if (
        next.info.width > 16384 ||
        next.info.height > 16384 ||
        next.info.width * next.info.height > 24000000
      ) {
        releaseAsset(next);
        throw new Error(
          "素材过大，请选取较短的视频或不超过 2400 万像素的图像。",
        );
      }
      const existing = current.current;
      const canRestore =
        !assetRef.current &&
        existing &&
        existing.media.kind === next.info.kind &&
        existing.media.fileName === next.info.fileName &&
        existing.media.width === next.info.width &&
        existing.media.height === next.info.height &&
        Math.abs(existing.media.duration - next.info.duration) < 0.1 &&
        (existing.media.fileSize === undefined ||
          existing.media.fileSize === file.size);
      replaceAsset(next);
      if (canRestore) notify("原素材已重新关联，标注已恢复。");
      else {
        initialize(createProject(next.info));
        setTrackId(1);
      }
      frameRef.current = 0;
      setFrameState(0);
      setTool("draw");
      setStep(1);
      if (next.info.kind === "video" && !canRestore)
        notify("视频已读取。请设置标注帧率，并确认原视频帧率。");
    } catch (error) {
      notify(error instanceof Error ? error.message : "导入失败。");
    } finally {
      setLoading(false);
    }
  };
  const useDemo = () => {
    replaceAsset(demoAsset());
    initialize(createProject());
    setTrackId(1);
    frameRef.current = 0;
    setFrameState(0);
    setTool("draw");
    setStep(1);
  };
  const restore = (p: Project) => {
    pause();
    setAnnotationImport(null);
    releaseAsset(assetRef.current);
    assetRef.current = null;
    setAsset(null);
    initialize(p);
    setTrackId(p.tracks[0].id);
    frameRef.current = 0;
    setFrameState(0);
    if (p.media.kind === "demo") {
      const next = demoAsset();
      assetRef.current = next;
      setAsset(next);
      setStep(2);
      notify("工程已恢复。");
    } else {
      setStep(1);
      notify(`工程已恢复，请重新选择原素材：${p.media.fileName}`);
    }
  };
  const restoreFile = async (file: File) => {
    try {
      restore(parseProject(await file.text()));
    } catch (error) {
      notify(error instanceof Error ? error.message : "工程文件读取失败。");
    }
  };
  const loadAnnotations = async (files: File[]) => {
    if (allBusy) return;
    pause();
    setLoading(true);
    try {
      const bundle = prepareAnnotationImport(
        await readAnnotationFiles(files),
        files.length === 1 ? files[0].name : `${files.length} 个标注文件`,
      );
      setAnnotationImport(bundle);
      notify("标注文件已读取，选择对应素材后即可浏览。");
    } catch (error) {
      notify(error instanceof Error ? error.message : "标注文件读取失败。");
    } finally {
      setLoading(false);
    }
  };
  const begin = () => {
    if (!current.current || !assetRef.current || allBusy) return;
    try {
      if (
        annotationImport &&
        (appliedImport.current?.bundle !== annotationImport ||
          appliedImport.current.asset !== assetRef.current)
      ) {
        const next = applyAnnotationImport(annotationImport, current.current);
        update(() => next);
        appliedImport.current = {
          bundle: annotationImport,
          asset: assetRef.current,
        };
        setTrackId(next.tracks[0].id);
        frameRef.current = 0;
        setFrameState(0);
        setTool("move");
      }
      if (frameCount(current.current.media) > LIMIT_FRAMES)
        throw new Error("任务超过 18,000 个标注帧，请降低帧切分帧率后再进入。");
      changeStep(2);
    } catch (error) {
      notify(error instanceof Error ? error.message : "无法关联此标注文件。");
    }
  };
  const manual = (box: Box) => {
    update((p) => manualAnnotation(p, activeTrackId, frameRef.current, box));
  };
  const sampleDynamic = useCallback(
    (nextFrame: number) => {
      const p = current.current,
        point = pointer.current;
      if (!p || !point || !recording.current || !playingRef.current) return;
      const sample = { frame: nextFrame, ...point };
      if (
        lastSample.current?.frame === nextFrame &&
        lastSample.current.x === point.x &&
        lastSample.current.y === point.y
      )
        return;
      const entries = recordMouseFrames(
        p,
        activeTrackId,
        lastSample.current,
        sample,
      );
      lastSample.current = sample;
      update((prev) => setAnnotations(prev, entries), false);
    },
    [current, activeTrackId, update],
  );
  dynamicSampler.current = sampleDynamic;
  const startDynamic = () => {
    if (!playingRef.current) return;
    checkpoint();
    update(
      (p) => ({
        ...p,
        annotations: p.annotations.filter(
          (a) => a.trackId !== activeTrackId || a.source === "manual",
        ),
      }),
      false,
    );
    recording.current = true;
    lastSample.current = null;
  };
  const onDynamic = (value: { x: number; y: number } | null) => {
    pointer.current = value;
    if (value) sampleDynamic(taskFrameNow());
    else lastSample.current = null;
  };
  const togglePlay = async () => {
    const p = current.current;
    if (!p || !assetRef.current || allBusy || p.media.kind === "image") return;
    if (playingRef.current) {
      pause();
      return;
    }
    if (frameRef.current >= frameCount(p.media) - 1) {
      frameRef.current = 0;
      setFrameState(0);
      if (assetRef.current.element instanceof HTMLVideoElement)
        assetRef.current.element.currentTime = 0;
    }
    try {
      if (assetRef.current.element instanceof HTMLVideoElement) {
        const video = assetRef.current.element;
        await seekVideo(video, frameRef.current / p.media.fps);
        video.playbackRate = speed;
        await video.play();
      }
      playingRef.current = true;
      setPlaying(true);
    } catch {
      notify("播放失败，请确认浏览器支持此视频编码。");
    }
  };
  useEffect(() => {
    if (asset?.element instanceof HTMLVideoElement)
      asset.element.playbackRate = speed;
  }, [asset, speed]);
  useEffect(() => {
    if (!playing || !project || !asset) return;
    const origin = performance.now(),
      startTime = frameRef.current / project.media.fps;
    playbackClock.current = { origin, startTime, speed };
    let raf = 0;
    const tick = (now: number) => {
      if (!playingRef.current) return;
      const time =
        asset.element instanceof HTMLVideoElement
          ? asset.element.currentTime
          : startTime + ((now - origin) / 1000) * speed;
      const nextFrame = timeToFrame(time, project.media);
      if (nextFrame !== frameRef.current) {
        frameRef.current = nextFrame;
        setFrameState(nextFrame);
      }
      sampleDynamic(nextFrame);
      if (
        time >= project.media.duration ||
        (asset.element instanceof HTMLVideoElement && asset.element.ended)
      ) {
        pause();
        return;
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [
    playing,
    asset,
    project?.media.fps,
    project?.media.duration,
    speed,
    sampleDynamic,
    pause,
  ]);
  // Keyboard shortcuts only operate the workspace and never intercept form editing.
  useEffect(() => {
    const handle = (event: KeyboardEvent) => {
      if (
        step !== 2 ||
        allBusy ||
        !project ||
        (event.target instanceof HTMLElement &&
          (["INPUT", "SELECT", "TEXTAREA", "BUTTON"].includes(
            event.target.tagName,
          ) ||
            event.target.isContentEditable))
      )
        return;
      if (event.code === "Space") {
        event.preventDefault();
        void togglePlay();
      }
      if (!playing && event.key === "ArrowLeft") {
        event.preventDefault();
        setFrame(frameRef.current - 1);
      }
      if (!playing && event.key === "ArrowRight") {
        event.preventDefault();
        setFrame(frameRef.current + 1);
      }
      if (
        !playing &&
        (event.metaKey || event.ctrlKey) &&
        event.key.toLowerCase() === "z"
      ) {
        event.preventDefault();
        event.shiftKey ? state.redo() : state.undo();
      }
    };
    window.addEventListener("keydown", handle);
    return () => window.removeEventListener("keydown", handle);
  });
  useEffect(() => {
    const stop = () => pause();
    window.addEventListener("blur", stop);
    document.addEventListener("visibilitychange", stop);
    return () => {
      window.removeEventListener("blur", stop);
      document.removeEventListener("visibilitychange", stop);
    };
  }, [pause]);
  useEffect(
    () => () => {
      releaseAsset(assetRef.current);
      controller.current?.abort();
    },
    [],
  );
  const auditAnnotations = async () => {
    if (!project || !asset || allBusy) return;
    pause();
    setBusy("审查标注");
    setProgress(0);
    const ctrl = new AbortController();
    controller.current = ctrl;
    const plugin = auditPlugins.get(auditId);
    let dispose = () => {};
    try {
      const handle = plugin.requiresPixels
        ? await makeFrameReader(asset, project, ctrl.signal)
        : null;
      if (handle) dispose = handle.dispose;
      const findings = await plugin.review({
        project,
        signal: ctrl.signal,
        reader: handle?.reader ?? {
          read: async () => {
            throw new Error("当前审查引擎未请求像素读取。");
          },
        },
        onProgress: (done, total) =>
          setProgress(total ? (done / total) * 100 : 100),
      });
      ctrl.signal.throwIfAborted();
      const report: AuditReport = {
        schemaVersion: 1,
        projectId: project.id,
        projectName: project.name,
        reviewedAt: new Date().toISOString(),
        engineId: auditId,
        media: { ...project.media },
        annotationCount: project.annotations.length,
        scope: "existing-track-intervals",
        findings,
      };
      setAudit({ report, basis: project });
      setAuditSkipped(false);
      if (findings[0]) {
        setTrackId(findings[0].trackId);
        setFrame(findings[0].frame);
      }
      notify(
        findings.length
          ? `发现 ${findings.length} 个疑点，请逐帧核对。`
          : "未发现本轮规则疑点，仍可对照画面抽查。",
      );
    } catch (error) {
      notify(
        error instanceof DOMException && error.name === "AbortError"
          ? "审查已取消。"
          : error instanceof Error
            ? error.message
            : "审查失败。",
      );
    } finally {
      dispose();
      controller.current = null;
      setBusy("");
    }
  };
  const markAuditFinding = (id: string, status: AuditFindingStatus) => {
    if (!auditFresh || allBusy) return;
    setAudit((previous) =>
      previous
        ? {
            ...previous,
            report: updateAuditFinding(previous.report, id, status),
          }
        : null,
    );
  };
  const assist = async () => {
    if (!project || !asset || allBusy) return;
    pause();
    setBusy("生成 AI 关键帧");
    setProgress(0);
    const ctrl = new AbortController();
    controller.current = ctrl;
    let dispose = () => {};
    try {
      const handle = await makeFrameReader(asset, project, ctrl.signal);
      dispose = handle.dispose;
      const results = await assistPlugins.get(assistId).generate({
        project,
        trackId: activeTrackId,
        reader: handle.reader,
        signal: ctrl.signal,
        onProgress: (done, total) => setProgress((done / total) * 100),
      });
      ctrl.signal.throwIfAborted();
      update((p) =>
        setAnnotations(
          {
            ...p,
            annotations: p.annotations.filter(
              (a) =>
                a.trackId !== activeTrackId ||
                a.source === "manual" ||
                a.review === "rejected",
            ),
          },
          results,
          true,
        ),
      );
      notify(
        results.length
          ? `已生成 ${results.length} 个 AI 关键帧，请查看并确认。`
          : "未生成新的 AI 关键帧，请核对建议人工点或调整间隔。",
      );
    } catch (error) {
      notify(
        error instanceof DOMException && error.name === "AbortError"
          ? "AI 关键帧标注已取消。"
          : error instanceof Error
            ? error.message
            : "AI 关键帧标注失败。",
      );
    } finally {
      dispose();
      controller.current = null;
      setBusy("");
    }
  };
  const fillFrames = async () => {
    if (!project || !asset || allBusy) return;
    pause();
    const plugin = fillPlugins.get(fillId);
    setBusy(plugin.name);
    setProgress(0);
    const ctrl = new AbortController();
    controller.current = ctrl;
    let dispose = () => {};
    try {
      const handle = await makeFrameReader(asset, project, ctrl.signal);
      dispose = handle.dispose;
      const results = await plugin.fill({
        project,
        trackId: activeTrackId,
        reader: handle.reader,
        signal: ctrl.signal,
        onProgress: (done, total) => setProgress((done / total) * 100),
      });
      ctrl.signal.throwIfAborted();
      update((p) =>
        setAnnotations(
          {
            ...p,
            annotations: p.annotations.filter(
              (a) =>
                a.trackId !== activeTrackId ||
                (a.source !== "interpolated" && a.source !== "tracked") ||
                a.review === "rejected",
            ),
          },
          results,
          true,
        ),
      );
      notify(
        results.length
          ? `${plugin.name}完成，新增 ${results.length} 帧，请复核。`
          : "未生成新帧。可增加人工关键帧后重试。",
      );
    } catch (error) {
      notify(
        error instanceof DOMException && error.name === "AbortError"
          ? "补帧任务已取消。"
          : error instanceof Error
            ? error.message
            : "补帧失败。",
      );
    } finally {
      dispose();
      controller.current = null;
      setBusy("");
    }
  };
  const backup = () => {
    if (project) {
      downloadBlob(
        new Blob([JSON.stringify(project, null, 2)], {
          type: "application/json",
        }),
        `${safeFileName(project.name)}.frameflow.json`,
      );
      notify("工程备份已生成，原素材需单独保留。");
    }
  };
  const changeStep = (next: number) => {
    if (allBusy || (next > 1 && (!project || !asset))) return;
    pause();
    setStep(next);
  };
  return (
    <div className="app-shell">
      <header className="app-header">
        <Brand />
        <nav className="step-nav" aria-label="标注工作流">
          {["导入", "标注", "导出", "审查"].map((label, index) => (
            <div key={label}>
              <button
                className={`${step === index + 1 ? "active" : ""} ${step > index + 1 ? "complete" : ""}`}
                disabled={
                  allBusy ||
                  (index > 0 && (!project || !asset)) ||
                  (index === 2 && step === 1 && !!annotationImport) ||
                  (index === 2 &&
                    !project?.annotations.some(
                      (a) => a.review !== "rejected",
                    )) ||
                  (index === 3 &&
                    (!project?.annotations.length ||
                      (step === 1 && !!annotationImport)))
                }
                onClick={() =>
                  index === 1 && step === 1 ? begin() : changeStep(index + 1)
                }
              >
                <span className="step-number">
                  {step > index + 1 ? <Check size={12} /> : index + 1}
                </span>
                {label}
              </button>
              {index < 3 && <ChevronRight size={13} />}
            </div>
          ))}
        </nav>
        <div className="header-right">
          {project && (
            <span className="save-state">
              <span className="dot" />
              {state.saveStatus}
            </span>
          )}
          <button
            className="button small"
            disabled={allBusy}
            onClick={() => restoreInput.current?.click()}
          >
            <FolderOpen size={14} /> 打开工程
          </button>
          <input
            ref={restoreInput}
            data-testid="project-input"
            type="file"
            accept=".json"
            hidden
            onChange={(e) => {
              if (e.target.files?.[0]) void restoreFile(e.target.files[0]);
              e.target.value = "";
            }}
          />
        </div>
      </header>
      {step === 1 && (
        <ImportStep
          project={project}
          asset={asset}
          saved={saved}
          loading={loading}
          load={(file) => void load(file)}
          useDemo={useDemo}
          restore={restore}
          update={update}
          begin={begin}
          annotationImport={annotationImport}
          loadAnnotations={(files) => void loadAnnotations(files)}
          clearAnnotations={() => setAnnotationImport(null)}
        />
      )}
      {step === 2 && project && asset && (
        <Workspace
          project={project}
          asset={asset}
          frame={frame}
          setFrame={setFrame}
          playing={playing}
          togglePlay={() => void togglePlay()}
          speed={speed}
          setSpeed={setSpeed}
          tool={tool}
          setTool={setTool}
          trackId={activeTrackId}
          setTrackId={setTrackId}
          update={update}
          manual={manual}
          onDynamic={onDynamic}
          startDynamic={startDynamic}
          endDynamic={endDynamic}
          undo={state.undo}
          redo={state.redo}
          canUndo={state.canUndo}
          canRedo={state.canRedo}
          busy={busy}
          progress={progress}
          assistId={assistId}
          setAssistId={setAssistId}
          assist={() => void assist()}
          fillFrames={() => void fillFrames()}
          fillId={fillId}
          setFillId={setFillId}
          cancel={() => controller.current?.abort()}
          exportStep={() => changeStep(3)}
          backup={backup}
          back={() => changeStep(1)}
        />
      )}
      {step === 3 && project && asset && (
        <ExportStep
          project={project}
          asset={asset}
          back={() => changeStep(2)}
          notify={notify}
          setBusy={setExportBusy}
          settings={exportSettings}
          updateSettings={(change) =>
            setExportSettings((previous) => ({ ...previous, ...change }))
          }
          auditReport={auditFresh ? audit!.report : null}
          auditStale={!!audit && !auditFresh}
          auditSkipped={auditSkipped}
          review={() => changeStep(4)}
        />
      )}
      {step === 4 && project && asset && (
        <ReviewStep
          project={project}
          asset={asset}
          frame={frame}
          setFrame={setFrame}
          trackId={activeTrackId}
          setTrackId={setTrackId}
          report={audit?.report ?? null}
          stale={!!audit && !auditFresh}
          engineId={auditId}
          setEngineId={setAuditId}
          busy={busy}
          progress={progress}
          run={() => void auditAnnotations()}
          cancel={() => controller.current?.abort()}
          updateFinding={markAuditFinding}
          fix={(finding) => {
            setTrackId(finding.trackId);
            setFrame(finding.frame);
            changeStep(2);
          }}
          skip={() => {
            setAuditSkipped(true);
            changeStep(3);
          }}
          exportStep={() => changeStep(3)}
        />
      )}
      <footer className="app-footer">
        <span>
          <ShieldCheck size={13} /> 本地保存
        </span>
        <span>
          <Github size={13} /> v0.4.0
        </span>
      </footer>
      {toast && (
        <div className="toast" role="status">
          <span>{toast}</span>
          <button aria-label="关闭提示" onClick={() => setToast("")}>
            <X size={16} />
          </button>
        </div>
      )}
    </div>
  );
}
