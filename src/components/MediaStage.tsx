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
  onBox: (box: Box) => void;
  selectTrack: (id: number) => void;
  onDynamic: (point: { x: number; y: number } | null) => void;
  startDynamic: () => void;
  endDynamic: () => void;
}
export function MediaStage({
  project,
  asset,
  frame,
  playing,
  tool,
  trackId,
  disabled,
  onBox,
  selectTrack,
  onDynamic,
  startDynamic,
  endDynamic,
}: Props) {
  const canvas = useRef<HTMLCanvasElement>(null),
    svg = useRef<SVGSVGElement>(null);
  const [preview, setPreview] = useState<Box | null>(null);
  const gesture = useRef<{
    start: { x: number; y: number };
    box?: Box;
    dynamic?: boolean;
  } | null>(null);
  const [position, setPosition] = useState<{ x: number; y: number } | null>(
    null,
  );
  const [mediaError, setMediaError] = useState("");
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
    };
    if (asset.element instanceof HTMLVideoElement && !playing) {
      seekVideo(asset.element, frameSampleTime(frame, project.media))
        .then(draw)
        .catch((e) => {
          if (!disposed) setMediaError(e.message);
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
  const point = (e: PointerEvent<SVGSVGElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    return {
      x: Math.max(
        0,
        Math.min(
          project.media.width,
          ((e.clientX - rect.left) / rect.width) * project.media.width,
        ),
      ),
      y: Math.max(
        0,
        Math.min(
          project.media.height,
          ((e.clientY - rect.top) / rect.height) * project.media.height,
        ),
      ),
    };
  };
  const down = (e: PointerEvent<SVGSVGElement>) => {
    if (disabled || e.button !== 0) return;
    const p = point(e);
    setPosition(p);
    if (tool === "dynamic") {
      if (!playing) return;
      gesture.current = { start: p, dynamic: true };
      startDynamic();
      onDynamic(p);
      e.currentTarget.setPointerCapture(e.pointerId);
      return;
    }
    if (playing) return;
    const selected = project.annotations.find(
      (a) =>
        a.frame === frame && a.trackId === trackId && a.review !== "rejected",
    );
    const target = project.annotations
      .filter((a) => a.frame === frame && a.review !== "rejected")
      .reverse()
      .find(
        (a) =>
          p.x >= a.box.x &&
          p.x <= a.box.x + a.box.width &&
          p.y >= a.box.y &&
          p.y <= a.box.y + a.box.height,
      );
    if (tool === "move" && target && target.trackId !== trackId) {
      selectTrack(target.trackId);
      return;
    }
    if (tool === "move" && !selected) return;
    gesture.current = {
      start: p,
      box: tool === "move" ? selected?.box : undefined,
    };
    e.currentTarget.setPointerCapture(e.pointerId);
  };
  const move = (e: PointerEvent<SVGSVGElement>) => {
    const p = point(e);
    setPosition(p);
    if (gesture.current?.dynamic) {
      const rect = e.currentTarget.getBoundingClientRect();
      const inside =
        e.clientX >= rect.left &&
        e.clientX <= rect.right &&
        e.clientY >= rect.top &&
        e.clientY <= rect.bottom;
      onDynamic(inside ? p : null);
      return;
    }
    if (!gesture.current || playing || disabled) return;
    const { start, box } = gesture.current;
    setPreview(
      box
        ? clampBox(
            { ...box, x: box.x + p.x - start.x, y: box.y + p.y - start.y },
            project.media,
          )
        : {
            x: Math.min(start.x, p.x),
            y: Math.min(start.y, p.y),
            width: Math.abs(p.x - start.x),
            height: Math.abs(p.y - start.y),
          },
    );
  };
  const up = (e: PointerEvent<SVGSVGElement>) => {
    if (!gesture.current) return;
    if (gesture.current.dynamic) {
      onDynamic(point(e));
      endDynamic();
    } else if (preview && preview.width >= 3 && preview.height >= 3)
      onBox(preview);
    gesture.current = null;
    setPreview(null);
    if (e.currentTarget.hasPointerCapture(e.pointerId))
      e.currentTarget.releasePointerCapture(e.pointerId);
  };
  const visible = project.annotations.filter(
    (a) => a.frame === frame && a.review !== "rejected",
  );
  const dynamicPreview =
    tool === "dynamic" && position
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
  return (
    <div
      className={`media-surface tool-${tool}`}
      style={{
        aspectRatio: `${project.media.width} / ${project.media.height}`,
        maxWidth: `${(50 * project.media.width) / project.media.height}vh`,
      }}
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
        data-testid="annotation-canvas"
        onPointerDown={down}
        onPointerMove={move}
        onPointerUp={up}
        onPointerCancel={up}
        onPointerLeave={() => {
          setPosition(null);
          onDynamic(null);
        }}
      >
        {visible.map((a) => {
          const label = project.labels.find(
            (l) =>
              l.id === project.tracks.find((t) => t.id === a.trackId)?.labelId,
          )!;
          const b = a.box,
            color = label?.color ?? "#4478ef";
          return (
            <g key={a.trackId}>
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
                width={Math.max(105, (label?.name.length ?? 3) * 16 + 60)}
                height="25"
                rx="3"
                fill={color}
              />
              <text
                x={b.x + 7}
                y={Math.max(0, b.y - 25) + 17}
                fill="white"
                fontSize="13"
              >
                {label?.name} · #{a.trackId}
              </text>
              {a.trackId === trackId &&
                [
                  [b.x, b.y],
                  [b.x + b.width, b.y],
                  [b.x, b.y + b.height],
                  [b.x + b.width, b.y + b.height],
                ].map(([x, y], index) => (
                  <rect
                    key={index}
                    x={x - 3}
                    y={y - 3}
                    width="6"
                    height="6"
                    fill="white"
                    stroke={color}
                    strokeWidth="1"
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
            strokeWidth="2"
            strokeDasharray="6 4"
            vectorEffect="non-scaling-stroke"
          />
        )}
      </svg>
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
    </div>
  );
}
