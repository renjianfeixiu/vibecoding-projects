import { useEffect, useRef, useState } from "react";
import type { PointerEvent } from "react";
import type { Box, MediaAsset, Project } from "../core/types.ts";
import {
  clampBox,
  frameSampleTime,
  sourceFrameIndex,
  sourceFrameRate,
  SOURCE_NAMES,
} from "../core/project.ts";
import { resizeBox } from "../core/geometry.ts";
import type { ResizeCorner } from "../core/geometry.ts";
import { trackBounds } from "../core/workflow.ts";
import { drawDemo } from "../media/demo.ts";
import { seekVideo } from "../media/source.ts";

export type ToolMode = "draw" | "move" | "dynamic";
interface Props {
  project: Project;
  asset: MediaAsset;
  frame: number;
  playing: boolean;
  tool: ToolMode;
  trackId: number;
  disabled: boolean;
  drawLabelId: number;
  onDrawBox: (box: Box, trackId: number, labelId: number) => void;
  onBox: (box: Box, trackId?: number) => void;
  selectTrack: (id: number) => void;
  onDynamic: (point: { x: number; y: number } | null) => void;
  startDynamic: () => void;
  endDynamic: () => void;
}
interface Gesture {
  start: { x: number; y: number };
  trackId: number;
  drawLabelId?: number;
  box?: Box;
  corner?: ResizeCorner;
  dynamic?: boolean;
  pan?: { x: number; y: number; clientX: number; clientY: number };
}
export function MediaStage({
  project,
  asset,
  frame,
  playing,
  tool,
  trackId,
  disabled,
  drawLabelId,
  onDrawBox,
  onBox,
  selectTrack,
  onDynamic,
  startDynamic,
  endDynamic,
}: Props) {
  const canvas = useRef<HTMLCanvasElement>(null),
    svg = useRef<SVGSVGElement>(null),
    surface = useRef<HTMLDivElement>(null);
  const [preview, setPreview] = useState<Box | null>(null),
    previewRef = useRef<Box | null>(null),
    gesture = useRef<Gesture | null>(null);
  const [position, setPosition] = useState<{ x: number; y: number } | null>(
      null,
    ),
    [mediaError, setMediaError] = useState(""),
    [seeking, setSeeking] = useState(false),
    [zoom, setZoom] = useState(1),
    [pan, setPan] = useState({ x: 0, y: 0 });
  const setDraft = (box: Box | null) => {
    previewRef.current = box;
    setPreview(box);
  };
  const stopGesture = () => {
    gesture.current = null;
    setDraft(null);
    endDynamic();
  };
  useEffect(() => {
    setZoom(1);
    setPan({ x: 0, y: 0 });
    setMediaError("");
  }, [asset, project.id]);
  useEffect(() => {
    if (!playing) {
      gesture.current = null;
      previewRef.current = null;
      setPreview(null);
      endDynamic();
    }
  }, [frame, tool, playing, endDynamic]);
  useEffect(() => {
    if (gesture.current?.trackId !== trackId) {
      gesture.current = null;
      previewRef.current = null;
      setPreview(null);
      endDynamic();
    }
  }, [trackId, endDynamic]);
  useEffect(() => {
    if (!playing && gesture.current?.dynamic) {
      gesture.current = null;
      endDynamic();
    }
  }, [playing, endDynamic]);
  useEffect(() => {
    let disposed = false;
    const draw = () => {
      if (disposed || !canvas.current) return;
      const ctx = canvas.current.getContext("2d")!;
      if (asset.info.kind === "demo")
        drawDemo(
          ctx,
          sourceFrameIndex(frame, project.media),
          sourceFrameRate(project.media),
        );
      else if (asset.element)
        ctx.drawImage(
          asset.element,
          0,
          0,
          project.media.width,
          project.media.height,
        );
      setSeeking(false);
      setMediaError("");
    };
    if (asset.element instanceof HTMLVideoElement && !playing) {
      setSeeking(true);
      seekVideo(asset.element, frameSampleTime(frame, project.media))
        .then(draw)
        .catch((e) => {
          if (!disposed) {
            setSeeking(false);
            setMediaError(e.message);
          }
        });
    } else draw();
    return () => {
      disposed = true;
    };
  }, [
    asset,
    frame,
    playing,
    project.media.fps,
    project.media.sourceFps,
    project.media.width,
    project.media.height,
  ]);
  const track = project.tracks.find((t) => t.id === trackId)!;
  const bounds = trackBounds(project, trackId);
  const editable =
    !disabled &&
    !track.locked &&
    !track.hidden &&
    frame >= bounds.start &&
    frame <= bounds.end;
  const visible = project.annotations.filter(
    (a) =>
      a.frame === frame &&
      a.review !== "rejected" &&
      !project.tracks.find((t) => t.id === a.trackId)?.hidden,
  );
  const point = (e: PointerEvent<SVGSVGElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    return {
      x: Math.max(
        0,
        Math.min(
          project.media.width,
          ((e.clientX - r.left) / r.width) * project.media.width,
        ),
      ),
      y: Math.max(
        0,
        Math.min(
          project.media.height,
          ((e.clientY - r.top) / r.height) * project.media.height,
        ),
      ),
    };
  };
  const down = (e: PointerEvent<SVGSVGElement>) => {
    if (disabled || seeking || mediaError || (e.button !== 0 && e.button !== 1))
      return;
    e.currentTarget.focus();
    const p = point(e);
    setPosition(p);
    const target = [...visible]
      .reverse()
      .find(
        (a) =>
          p.x >= a.box.x &&
          p.x <= a.box.x + a.box.width &&
          p.y >= a.box.y &&
          p.y <= a.box.y + a.box.height,
      );
    const current = visible.find((a) => a.trackId === trackId);
    const radius =
      (9 * project.media.width) / e.currentTarget.getBoundingClientRect().width;
    let corner: ResizeCorner | undefined;
    if (!playing && tool === "move" && current && editable) {
      for (const c of ["nw", "ne", "sw", "se"] as const) {
        const x = current.box.x + (c.endsWith("e") ? current.box.width : 0),
          y = current.box.y + (c.startsWith("s") ? current.box.height : 0);
        if (Math.hypot(x - p.x, y - p.y) <= radius) {
          corner = c;
          break;
        }
      }
    }
    if (
      e.button === 1 ||
      (!playing && tool === "move" && !target && !corner && zoom > 1)
    ) {
      e.preventDefault();
      gesture.current = {
        start: p,
        trackId,
        pan: { ...pan, clientX: e.clientX, clientY: e.clientY },
      };
      e.currentTarget.setPointerCapture(e.pointerId);
      return;
    }
    if (tool === "dynamic") {
      if (!playing || !editable) return;
      gesture.current = { start: p, trackId, dynamic: true };
      startDynamic();
      onDynamic(p);
      e.currentTarget.setPointerCapture(e.pointerId);
      return;
    }
    if (playing) return;
    if (tool === "move") {
      const a = corner ? current : target;
      if (!a) return;
      const targetTrack = project.tracks.find((t) => t.id === a.trackId)!;
      if (a.trackId !== trackId) selectTrack(a.trackId);
      if (targetTrack.locked) return;
      gesture.current = { start: p, trackId: a.trackId, box: a.box, corner };
    } else {
      gesture.current = { start: p, trackId, drawLabelId };
    }
    e.currentTarget.setPointerCapture(e.pointerId);
  };
  const move = (e: PointerEvent<SVGSVGElement>) => {
    const p = point(e);
    setPosition(p);
    const g = gesture.current;
    if (!g) return;
    if (g.pan) {
      const size = surface.current!.getBoundingClientRect(),
        maxX = (size.width * (zoom - 1)) / 2,
        maxY = (size.height * (zoom - 1)) / 2;
      setPan({
        x: Math.max(-maxX, Math.min(maxX, g.pan.x + e.clientX - g.pan.clientX)),
        y: Math.max(-maxY, Math.min(maxY, g.pan.y + e.clientY - g.pan.clientY)),
      });
      return;
    }
    if (g.dynamic) {
      const r = e.currentTarget.getBoundingClientRect();
      onDynamic(
        e.clientX >= r.left &&
          e.clientX <= r.right &&
          e.clientY >= r.top &&
          e.clientY <= r.bottom
          ? p
          : null,
      );
      return;
    }
    if (playing || disabled) return;
    setDraft(
      g.box
        ? g.corner
          ? resizeBox(g.box, p, g.corner, project.media)
          : clampBox(
              {
                ...g.box,
                x: g.box.x + p.x - g.start.x,
                y: g.box.y + p.y - g.start.y,
              },
              project.media,
            )
        : {
            x: Math.min(g.start.x, p.x),
            y: Math.min(g.start.y, p.y),
            width: Math.abs(p.x - g.start.x),
            height: Math.abs(p.y - g.start.y),
          },
    );
  };
  const up = (e: PointerEvent<SVGSVGElement>) => {
    const g = gesture.current;
    if (!g) return;
    if (g.dynamic) {
      onDynamic(point(e));
      endDynamic();
    } else if (
      !g.pan &&
      previewRef.current &&
      previewRef.current.width >= 3 &&
      previewRef.current.height >= 3 &&
      Math.hypot(point(e).x - g.start.x, point(e).y - g.start.y) > 0.5
    ) {
      if (g.drawLabelId !== undefined)
        onDrawBox(previewRef.current, g.trackId, g.drawLabelId);
      else onBox(previewRef.current, g.trackId);
    }
    gesture.current = null;
    setDraft(null);
    if (e.currentTarget.hasPointerCapture(e.pointerId))
      e.currentTarget.releasePointerCapture(e.pointerId);
  };
  const dynamicPreview =
    tool === "dynamic" && position && editable
      ? clampBox(
          {
            x: position.x - project.settings.boxWidth / 2,
            y: position.y - project.settings.boxHeight / 2,
            width: project.settings.boxWidth,
            height: project.settings.boxHeight,
          },
          project.media,
        )
      : null;
  const changeZoom = (value: number) => {
    stopGesture();
    setZoom(Math.max(1, Math.min(8, value)));
    setPan({ x: 0, y: 0 });
  };
  return (
    <div
      ref={surface}
      className={`media-surface tool-${tool} ${track.locked ? "locked" : ""}`}
      style={{
        aspectRatio: `${project.media.width}/${project.media.height}`,
        maxWidth: `${(50 * project.media.width) / project.media.height}vh`,
      }}
    >
      <div
        className="media-plane"
        style={{ transform: `translate(${pan.x}px,${pan.y}px) scale(${zoom})` }}
      >
        <canvas
          ref={canvas}
          width={project.media.width}
          height={project.media.height}
          aria-label="视频图像画面"
        />
        <svg
          ref={svg}
          viewBox={`0 0 ${project.media.width} ${project.media.height}`}
          role="img"
          aria-label="标注画布"
          tabIndex={0}
          data-testid="annotation-canvas"
          onPointerDown={down}
          onPointerMove={move}
          onPointerUp={up}
          onPointerCancel={stopGesture}
          onKeyDown={(e) => {
            if (e.key === "Escape") {
              stopGesture();
              e.preventDefault();
            }
          }}
          onPointerLeave={() => {
            setPosition(null);
            onDynamic(null);
          }}
        >
          {visible.map((a) => {
            const item = project.tracks.find((t) => t.id === a.trackId)!,
              label = project.labels.find((l) => l.id === item.labelId)!;
            const b = a.box,
              color = label.color;
            return (
              <g
                key={a.trackId}
                role="button"
                aria-label={`标注对象 ${item.name} 帧 ${a.frame}`}
              >
                <rect
                  x={b.x}
                  y={b.y}
                  width={b.width}
                  height={b.height}
                  fill={a.trackId === trackId ? `${color}15` : "none"}
                  stroke={color}
                  strokeWidth={a.trackId === trackId ? 2.3 : 1.5}
                  vectorEffect="non-scaling-stroke"
                  strokeDasharray={a.review === "pending" ? "5 3" : undefined}
                />
                <rect
                  x={b.x}
                  y={Math.max(0, b.y - 25)}
                  width={Math.max(105, label.name.length * 16 + 60)}
                  height={25}
                  rx={3}
                  fill={color}
                />
                <text
                  x={b.x + 7}
                  y={Math.max(0, b.y - 25) + 17}
                  fill="white"
                  fontSize={13}
                >
                  {label.name} · #{a.trackId}
                  {item.locked ? " · 锁" : ""}
                </text>
                {a.trackId === trackId &&
                  !item.locked &&
                  tool === "move" &&
                  [
                    ["nw", b.x, b.y],
                    ["ne", b.x + b.width, b.y],
                    ["sw", b.x, b.y + b.height],
                    ["se", b.x + b.width, b.y + b.height],
                  ].map(([corner, x, y]) => (
                    <rect
                      key={corner}
                      className={`resize-handle ${corner}`}
                      x={Number(x) - 4}
                      y={Number(y) - 4}
                      width={8}
                      height={8}
                      fill="white"
                      stroke={color}
                      strokeWidth={1}
                      vectorEffect="non-scaling-stroke"
                    />
                  ))}
                <title>
                  {SOURCE_NAMES[a.source]} · 第 {a.frame} 帧
                </title>
              </g>
            );
          })}
          {(preview || dynamicPreview) && (
            <rect
              x={(preview || dynamicPreview)!.x}
              y={(preview || dynamicPreview)!.y}
              width={(preview || dynamicPreview)!.width}
              height={(preview || dynamicPreview)!.height}
              fill="#4478ef12"
              stroke="#4478ef"
              strokeWidth={2}
              strokeDasharray="6 4"
              vectorEffect="non-scaling-stroke"
            />
          )}
        </svg>
      </div>
      <div className="viewer-zoom" aria-label="画面缩放">
        <button
          aria-label="缩小画面"
          disabled={disabled || playing || zoom <= 1}
          onClick={() => changeZoom(zoom / 1.25)}
        >
          −
        </button>
        <button
          aria-label="适应画面"
          disabled={disabled || playing}
          onClick={() => changeZoom(1)}
        >
          {Math.round(zoom * 100)}%
        </button>
        <button
          aria-label="放大画面"
          disabled={disabled || playing || zoom >= 8}
          onClick={() => changeZoom(zoom * 1.25)}
        >
          ＋
        </button>
      </div>
      {seeking && (
        <span className="frame-loading" role="status">
          正在定位帧…
        </span>
      )}
      {mediaError && <span className="media-error">{mediaError}</span>}
      <span className="viewer-label">
        {asset.info.kind === "demo"
          ? "示例动画"
          : asset.info.kind === "image"
            ? "本地图像"
            : "本地视频"}
      </span>
      {playing && tool === "dynamic" && (
        <span className="record-hint">按住鼠标跟随目标，松开停止录制</span>
      )}
      {zoom > 1 && !playing && (
        <span className="zoom-hint">
          中键拖动平移；调整模式可拖动画面空白处
        </span>
      )}
    </div>
  );
}
