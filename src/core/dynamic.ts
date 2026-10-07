import type { Annotation, Project } from "./types.ts";
import { clampBox, frameCount } from "./project.ts";

export interface MouseSample {
  frame: number;
  x: number;
  y: number;
}

// The display can skip task frames at high playback speed. Resample the human
// pointer trajectory at EVERY annotation frame, using the task's selected FPS.
// This is mouse input resampling, never used for visual tracking of objects.
export function recordMouseFrames(
  project: Project,
  trackId: number,
  previous: MouseSample | null,
  sample: MouseSample,
): Annotation[] {
  const end = Math.min(
    frameCount(project.media) - 1,
    Math.max(0, sample.frame),
  );
  const start = previous && previous.frame < end ? previous.frame + 1 : end;
  const output: Annotation[] = [];
  for (let frame = start; frame <= end; frame++) {
    const t =
      previous && end > previous.frame
        ? (frame - previous.frame) / (end - previous.frame)
        : 1;
    const x = previous ? previous.x + (sample.x - previous.x) * t : sample.x;
    const y = previous ? previous.y + (sample.y - previous.y) * t : sample.y;
    output.push({
      trackId,
      frame,
      source: "manual",
      review: "confirmed",
      box: clampBox(
        {
          x: x - project.settings.boxWidth / 2,
          y: y - project.settings.boxHeight / 2,
          width: project.settings.boxWidth,
          height: project.settings.boxHeight,
        },
        project.media,
      ),
    });
  }
  return output;
}
