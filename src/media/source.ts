import type { FrameReader, MediaAsset, Project } from "../core/types.ts";
import {
  DEMO_MEDIA,
  frameSampleTime,
  sourceFrameIndex,
  sourceFrameRate,
} from "../core/project.ts";
import { demoImage } from "./demo.ts";

export function demoAsset(): MediaAsset {
  return { info: { ...DEMO_MEDIA } };
}
function eventReady(
  element: HTMLMediaElement | HTMLImageElement,
  name: string,
  signal?: AbortSignal,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const cleanup = () => {
      clearTimeout(timeout);
      element.removeEventListener(name, ready);
      element.removeEventListener("error", fail);
      signal?.removeEventListener("abort", abort);
    };
    const ready = () => {
      cleanup();
      resolve();
    };
    const fail = () => {
      cleanup();
      reject(
        new Error(
          "浏览器无法读取此文件，请使用兼容的 MP4 / WebM 或 PNG / JPG。",
        ),
      );
    };
    const abort = () => {
      cleanup();
      reject(new DOMException("已取消", "AbortError"));
    };
    const timeout = setTimeout(() => {
      cleanup();
      reject(new Error("读取媒体超时，请尝试较短的文件或更换编码。"));
    }, 12000);
    element.addEventListener(name, ready, { once: true });
    element.addEventListener("error", fail, { once: true });
    signal?.addEventListener("abort", abort, { once: true });
    if (signal?.aborted) abort();
  });
}
export async function loadAsset(file: File): Promise<MediaAsset> {
  const isImage =
    file.type.startsWith("image/") || /\.(png|jpe?g|webp)$/i.test(file.name);
  const isVideo =
    file.type.startsWith("video/") || /\.(mp4|webm|mov|m4v)$/i.test(file.name);
  if (!isImage && !isVideo) throw new Error("请选择图像或视频文件。");
  const url = URL.createObjectURL(file);
  try {
    if (isImage) {
      const image = new Image();
      const ready = eventReady(image, "load");
      image.src = url;
      await ready;
      return {
        url,
        element: image,
        info: {
          kind: "image",
          fileName: file.name,
          fileSize: file.size,
          width: image.naturalWidth,
          height: image.naturalHeight,
          duration: 0,
          fps: 1,
        },
      };
    }
    const video = document.createElement("video");
    video.muted = true;
    video.playsInline = true;
    video.preload = "auto";
    const ready = eventReady(video, "loadeddata");
    video.src = url;
    video.load();
    await ready;
    if (!Number.isFinite(video.duration) || video.duration <= 0)
      throw new Error("视频时长无效。");
    return {
      url,
      element: video,
      info: {
        kind: "video",
        fileName: file.name,
        fileSize: file.size,
        width: video.videoWidth,
        height: video.videoHeight,
        duration: video.duration,
        fps: 30,
      },
    };
  } catch (error) {
    URL.revokeObjectURL(url);
    throw error;
  }
}
export function releaseAsset(asset: MediaAsset | null) {
  if (asset?.element instanceof HTMLVideoElement) {
    asset.element.pause();
    asset.element.removeAttribute("src");
    asset.element.load();
  }
  if (asset?.url) URL.revokeObjectURL(asset.url);
}
export async function seekVideo(
  video: HTMLVideoElement,
  time: number,
  signal?: AbortSignal,
) {
  if (signal?.aborted) throw new DOMException("已取消", "AbortError");
  if (Math.abs(video.currentTime - time) < 0.0001 && video.readyState >= 2)
    return;
  const ready = eventReady(video, "seeked", signal);
  video.currentTime = time;
  await ready;
}
export async function makeFrameReader(
  asset: MediaAsset,
  project: Project,
  signal?: AbortSignal,
): Promise<{ reader: FrameReader; dispose: () => void }> {
  if (asset.info.kind === "demo")
    return {
      reader: {
        read: async (frame) =>
          demoImage(
            sourceFrameIndex(frame, project.media),
            sourceFrameRate(project.media),
          ),
      },
      dispose: () => {},
    };
  const canvas = document.createElement("canvas");
  canvas.width = project.media.width;
  canvas.height = project.media.height;
  const ctx = canvas.getContext("2d", { willReadFrequently: true })!;
  if (asset.info.kind === "image")
    return {
      reader: {
        read: async () => {
          ctx.drawImage(asset.element!, 0, 0);
          return ctx.getImageData(0, 0, canvas.width, canvas.height);
        },
      },
      dispose: () => {},
    };
  const video = document.createElement("video");
  video.muted = true;
  video.preload = "auto";
  const ready = eventReady(video, "loadeddata", signal);
  video.src = asset.url!;
  video.load();
  try {
    await ready;
  } catch (error) {
    video.removeAttribute("src");
    video.load();
    throw error;
  }
  return {
    reader: {
      read: async (frame, readSignal) => {
        await seekVideo(
          video,
          frameSampleTime(frame, project.media),
          readSignal,
        );
        ctx.drawImage(video, 0, 0);
        return ctx.getImageData(0, 0, canvas.width, canvas.height);
      },
    },
    dispose: () => {
      video.pause();
      video.removeAttribute("src");
      video.load();
    },
  };
}
export async function frameToJpeg(image: ImageData): Promise<Uint8Array> {
  const canvas = document.createElement("canvas");
  canvas.width = image.width;
  canvas.height = image.height;
  canvas.getContext("2d")!.putImageData(image, 0, 0);
  const blob = await new Promise<Blob>((resolve, reject) =>
    canvas.toBlob(
      (b) => (b ? resolve(b) : reject(new Error("帧图像导出失败。"))),
      "image/jpeg",
      0.9,
    ),
  );
  return new Uint8Array(await blob.arrayBuffer());
}
