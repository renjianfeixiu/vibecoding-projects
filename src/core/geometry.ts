import type { Box } from "./types.ts";
export type ResizeCorner = "nw" | "ne" | "sw" | "se";
export function resizeBox(
  box: Box,
  point: { x: number; y: number },
  corner: ResizeCorner,
  media: { width: number; height: number },
): Box {
  const anchor = {
    x: corner.endsWith("w") ? box.x + box.width : box.x,
    y: corner.startsWith("n") ? box.y + box.height : box.y,
  };
  const x = Math.max(0, Math.min(media.width, point.x)),
    y = Math.max(0, Math.min(media.height, point.y));
  const left = Math.min(anchor.x, x),
    top = Math.min(anchor.y, y);
  return {
    x: Math.min(media.width - 1, left),
    y: Math.min(media.height - 1, top),
    width: Math.max(1, Math.abs(x - anchor.x)),
    height: Math.max(1, Math.abs(y - anchor.y)),
  };
}
