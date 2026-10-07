export type AnnotationSource = "manual" | "assist" | "tracked" | "interpolated";
export type ReviewStatus = "confirmed" | "pending" | "rejected";
export interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
}
export interface Annotation {
  trackId: number;
  frame: number;
  box: Box;
  source: AnnotationSource;
  review: ReviewStatus;
  score?: number;
}
export interface Label {
  id: number;
  name: string;
  color: string;
}
export interface Track {
  id: number;
  labelId: number;
  name: string;
}
export interface MediaInfo {
  kind: "demo" | "video" | "image";
  fileName: string;
  width: number;
  height: number;
  duration: number;
  // Annotation timeline FPS. sourceFps preserves the original video's FPS.
  fps: number;
  sourceFps?: number;
  fileSize?: number;
}
export interface Project {
  schemaVersion: 1;
  id: string;
  name: string;
  createdAt: string;
  media: MediaInfo;
  settings: {
    samplingFps: number;
    assistInterval: number;
    manualInterval?: number;
    keyframeStrategy?: "fixed" | "quality";
    boxWidth: number;
    boxHeight: number;
  };
  labels: Label[];
  tracks: Track[];
  annotations: Annotation[];
}
export interface MediaAsset {
  info: MediaInfo;
  url?: string;
  element?: HTMLVideoElement | HTMLImageElement;
}
export interface FrameReader {
  read: (frame: number, signal?: AbortSignal) => Promise<ImageData>;
}
export interface AssistRequest {
  project: Project;
  trackId: number;
  reader: FrameReader;
  signal: AbortSignal;
  onProgress: (current: number, total: number) => void;
}
export interface AnnotationAssistPlugin {
  id: string;
  name: string;
  description: string;
  generate: (request: AssistRequest) => Promise<Annotation[]>;
}
export interface FrameFillPlugin {
  id: string;
  name: string;
  description: string;
  fill: (request: AssistRequest) => Promise<Annotation[]>;
}
export interface ExportOptions {
  confirmedOnly: boolean;
  sampledOnly: boolean;
}
export interface ExportFile {
  path: string;
  text: string;
}
export interface ExportAdapter {
  id: string;
  name: string;
  extension: string;
  description: string;
  supportsImages: boolean;
  group?: "检测训练" | "标注软件" | "视频轨迹" | "专用数据集" | "工程与表格";
  imagePath?: (frame: number) => string;
  validate?: (project: Project, options: ExportOptions) => void;
  export: (project: Project, options: ExportOptions) => ExportFile[];
}
export interface ImportTextFile {
  path: string;
  text: string;
}
export interface ImportedBox {
  frame: number;
  label: string;
  box: Box;
  trackKey?: string;
  source?: AnnotationSource;
  review?: ReviewStatus;
  score?: number;
}
export interface AnnotationImportAdapter {
  id: string;
  name: string;
  accepts: (files: ImportTextFile[]) => boolean;
  read: (files: ImportTextFile[], media: MediaInfo) => ImportedBox[];
}
export type AuditFindingType =
  | "missing"
  | "jump"
  | "size"
  | "correlation"
  | "pending";
export type AuditFindingStatus = "open" | "checked" | "dismissed";
export interface AuditFinding {
  id: string;
  type: AuditFindingType;
  trackId: number;
  frame: number;
  endFrame?: number;
  message: string;
  detail: string;
  status: AuditFindingStatus;
}
export interface AuditReport {
  schemaVersion: 1;
  projectId: string;
  projectName: string;
  reviewedAt: string;
  engineId: string;
  media: MediaInfo;
  annotationCount: number;
  scope: "existing-track-intervals";
  findings: AuditFinding[];
}
export interface AnnotationAuditPlugin {
  id: string;
  name: string;
  description: string;
  requiresPixels: boolean;
  review: (request: Omit<AssistRequest, "trackId">) => Promise<AuditFinding[]>;
}
