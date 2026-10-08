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
  reviewAnnotation,
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
import { Workspace } from "./components/Workspace.tsx";
import { Modal } from "./components/Modal.tsx";
import {
  addTrack,
  copyFrameBox,
  manualAnnotation,
  mergeGenerated,
  scopedTrackIds,
  trackBounds,
  SCOPE_NAMES,
} from "./core/workflow.ts";
import type { OperationScope } from "./core/workflow.ts";
import { runAnnotationBatch } from "./core/batch.ts";
import type { TrackJobResult } from "./core/batch.ts";
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
  const [scope, setScope] = useState<OperationScope>("all"),
    [replacePending, setReplacePending] = useState(false);
  const [jobResult, setJobResult] = useState<TrackJobResult[] | null>(null);
  const [copiedBox, setCopiedBox] = useState<Box | null>(null);
  const [replacement, setReplacement] = useState<{
    message: string;
    run: () => void;
    dispose?: () => void;
  } | null>(null);
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
    setJobResult(null);
    setScope("all");
    setReplacePending(false);
    setCopiedBox(null);
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
  const playbackAttempt = useRef(0);
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
  const allBusy = !!busy || exportBusy || loading || !!replacement;
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
    playbackAttempt.current++;
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
        Math.min(
          frameCount(p.media) - 1,
          Number.isFinite(value) ? Math.round(value) : frameRef.current,
        ),
      );
      frameRef.current = next;
      setFrameState(next);
    },
    [pause, current],
  );
  const requestReplacement = (
    message: string,
    run: () => void,
    dispose?: () => void,
  ) => {
    if (current.current?.annotations.length)
      setReplacement({ message, run, dispose });
    else run();
  };
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
      const apply = () => {
        replaceAsset(next);
        if (canRestore) notify("原素材已重新关联，标注已恢复。");
        else {
          initialize(createProject(next.info));
          if (appliedImport.current?.bundle === annotationImport)
            setAnnotationImport(null);
          appliedImport.current = null;
          setTrackId(1);
        }
        frameRef.current = 0;
        setFrameState(0);
        setTool("draw");
        setStep(1);
        if (next.info.kind === "video" && !canRestore)
          notify("视频已读取。请设置标注帧率，并确认原视频帧率。");
      };
      if (canRestore) apply();
      else
        requestReplacement(
          `更换为「${next.info.fileName}」会进入新的标注任务。`,
          apply,
          () => releaseAsset(next),
        );
    } catch (error) {
      notify(error instanceof Error ? error.message : "导入失败。");
    } finally {
      setLoading(false);
    }
  };
  const useDemo = () =>
    requestReplacement("试用示例视频会进入新的标注任务。", () => {
      replaceAsset(demoAsset());
      initialize(createProject());
      if (appliedImport.current?.bundle === annotationImport)
        setAnnotationImport(null);
      appliedImport.current = null;
      setTrackId(1);
      frameRef.current = 0;
      setFrameState(0);
      setTool("draw");
      setStep(1);
    });
  const applyRestore = (p: Project) => {
    pause();
    setAnnotationImport(null);
    appliedImport.current = null;
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
  const restore = (p: Project) => {
    requestReplacement(`打开「${p.name}」会替换当前工作台。`, () =>
      applyRestore(p),
    );
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
      if (!current.current.name.trim()) throw new Error("请先设置任务名称。");
      if (frameCount(current.current.media) > LIMIT_FRAMES)
        throw new Error("任务超过 18,000 个标注帧，请降低帧切分帧率后再进入。");
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
  const manual = (box: Box, id = activeTrackId) => {
    try {
      update((p) => manualAnnotation(p, id, frameRef.current, box));
    } catch (error) {
      notify(error instanceof Error ? error.message : "无法修改此标注。");
    }
  };
  const copyBox = () => {
    if (!current.current) return;
    const selected = copyFrameBox(
      current.current,
      activeTrackId,
      frameRef.current,
    );
    if (!selected) return;
    setCopiedBox({ ...selected.box });
    notify("当前框已复制，可切换帧或对象后粘贴。");
  };
  const pasteBox = () => {
    if (copiedBox) manual(copiedBox);
  };
  const createTrack = () => {
    if (!current.current || allBusy || playingRef.current) return;
    const labelId =
      current.current.tracks.find((t) => t.id === activeTrackId)?.labelId ??
      current.current.labels[0].id;
    const next = addTrack(current.current, labelId, frameRef.current);
    update(() => next);
    setTrackId(next.tracks.at(-1)!.id);
    setTool("draw");
    notify("新对象已创建，请在画面上画框。");
  };
  const sampleDynamic = useCallback(
    (nextFrame: number) => {
      const p = current.current,
        point = pointer.current;
      if (!p || !point || !recording.current || !playingRef.current) return;
      const track = p.tracks.find((t) => t.id === activeTrackId);
      const bounds = trackBounds(p, activeTrackId);
      if (
        track?.locked ||
        track?.hidden ||
        nextFrame < bounds.start ||
        nextFrame > bounds.end
      )
        return;
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
    const p = current.current;
    if (!p || p.tracks.find((t) => t.id === activeTrackId)?.locked) return;
    checkpoint();
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
    const attempt = ++playbackAttempt.current;
    try {
      if (assetRef.current.element instanceof HTMLVideoElement) {
        const video = assetRef.current.element;
        await seekVideo(video, frameRef.current / p.media.fps);
        video.playbackRate = speed;
        await video.play();
        if (attempt !== playbackAttempt.current) {
          video.pause();
          return;
        }
      }
      if (attempt !== playbackAttempt.current) return;
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
  // Form controls and dialogs retain their normal editing behavior.
  useEffect(() => {
    const handle = (event: KeyboardEvent) => {
      if (
        allBusy ||
        !project ||
        document.querySelector("dialog[open]") ||
        (event.target instanceof HTMLElement &&
          (["INPUT", "SELECT", "TEXTAREA"].includes(event.target.tagName) ||
            event.target.isContentEditable))
      )
        return;
      const command = event.metaKey || event.ctrlKey,
        key = event.key.toLowerCase();
      if (command && key === "s") {
        event.preventDefault();
        backup();
        return;
      }
      if (!playing && command && (key === "z" || key === "y")) {
        event.preventDefault();
        key === "y" || event.shiftKey ? state.redo() : state.undo();
        return;
      }
      if (step !== 2) return;
      if (event.key === "Escape") {
        pause();
        return;
      }
      if (
        event.code === "Space" &&
        !(event.target instanceof HTMLButtonElement)
      ) {
        event.preventDefault();
        void togglePlay();
        return;
      }
      if (playing) return;
      if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
        event.preventDefault();
        setFrame(
          frameRef.current +
            (event.key === "ArrowLeft" ? -1 : 1) * (event.shiftKey ? 10 : 1),
        );
        return;
      }
      const selected = copyFrameBox(project, activeTrackId, frameRef.current);
      if (command && key === "c" && selected) {
        event.preventDefault();
        copyBox();
        return;
      }
      if (command && key === "v" && copiedBox) {
        event.preventDefault();
        pasteBox();
        return;
      }
      if (command) return;
      if (key === "b") setTool("draw");
      if (key === "v") setTool("move");
      if (key === "m") setTool("dynamic");
      if (key === "n") createTrack();
      if ((event.key === "Delete" || event.key === "Backspace") && selected) {
        event.preventDefault();
        try {
          update((p) =>
            reviewAnnotation(p, activeTrackId, frameRef.current, "rejected"),
          );
        } catch (e) {
          notify(e instanceof Error ? e.message : "无法删除。");
        }
      }
      if (
        key === "enter" &&
        selected?.review === "pending" &&
        !(event.target instanceof HTMLButtonElement)
      ) {
        try {
          event.preventDefault();
          update((p) =>
            reviewAnnotation(p, activeTrackId, frameRef.current, "confirmed"),
          );
        } catch (e) {
          notify(e instanceof Error ? e.message : "无法确认。");
        }
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
  const runJob = async (mode: "assist" | "fill") => {
    if (!project || !asset || allBusy) return;
    pause();
    const plugin =
      mode === "assist" ? assistPlugins.get(assistId) : fillPlugins.get(fillId);
    const title = mode === "assist" ? "生成 AI 关键帧" : plugin.name;
    setBusy(title);
    setProgress(0);
    const ctrl = new AbortController();
    controller.current = ctrl;
    let dispose = () => {};
    try {
      const handle =
        mode === "fill" && plugin.id === "linear"
          ? null
          : await makeFrameReader(asset, project, ctrl.signal);
      if (handle) dispose = handle.dispose;
      const result = await runAnnotationBatch({
        project,
        trackIds: scopedTrackIds(project, activeTrackId, scope, true),
        mode,
        plugin,
        replacePending,
        reader: handle?.reader ?? {
          read: async () => {
            throw new Error("此算法无需读取像素。");
          },
        },
        signal: ctrl.signal,
        onProgress: (value, name) => {
          setProgress(value);
          setBusy(name ? `${title} · ${name}` : title);
        },
      });
      ctrl.signal.throwIfAborted();
      const before = new Map(
        project.annotations.map((a) => [`${a.trackId}:${a.frame}`, a]),
      );
      const next = mergeGenerated(
        project,
        result.annotations,
        mode,
        replacePending,
      );
      const changed = next.annotations.filter(
        (a) => before.get(`${a.trackId}:${a.frame}`) !== a,
      );
      update(() => next);
      setJobResult(
        result.tracks.map((t) => ({
          ...t,
          count: changed.filter((a) => a.trackId === t.trackId).length,
        })),
      );
      const incomplete = result.tracks.filter(
        (t) => t.status !== "done",
      ).length;
      notify(
        `${SCOPE_NAMES[scope]}：已写入 ${changed.length} 个待确认框${incomplete ? `，${incomplete} 个对象需处理，原因见任务明细` : "，请复核"}。`,
      );
    } catch (error) {
      notify(
        error instanceof DOMException && error.name === "AbortError"
          ? "任务已取消，本次结果未写入。"
          : error instanceof Error
            ? error.message
            : "处理失败。",
      );
    } finally {
      dispose();
      controller.current = null;
      setBusy("");
    }
  };
  const assist = () => runJob("assist");
  const fillFrames = () => runJob("fill");
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
          copyBox={copyBox}
          pasteBox={pasteBox}
          canPaste={!!copiedBox}
          addTrack={createTrack}
          scope={scope}
          setScope={setScope}
          replacePending={replacePending}
          setReplacePending={setReplacePending}
          jobResult={jobResult}
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
      {replacement && (
        <Modal
          title="替换当前任务"
          onClose={() => {
            replacement.dispose?.();
            setReplacement(null);
          }}
        >
          <p>{replacement.message}</p>
          <p>
            当前任务「{project?.name}」有 {project?.annotations.length}{" "}
            个框。可先下载工程备份；原素材需单独保留。
          </p>
          <div className="modal-actions">
            <button
              className="button"
              onClick={() => {
                replacement.dispose?.();
                setReplacement(null);
              }}
            >
              取消
            </button>
            <button
              className="button"
              onClick={() => {
                const action = replacement;
                setReplacement(null);
                action.run();
              }}
            >
              继续替换
            </button>
            <button
              className="button primary"
              onClick={() => {
                backup();
                const action = replacement;
                setReplacement(null);
                action.run();
              }}
            >
              备份并继续
            </button>
          </div>
        </Modal>
      )}
      <footer className="app-footer">
        <span>
          <ShieldCheck size={13} /> 本地保存
        </span>
        <span>
          <Github size={13} /> v0.5.0
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
