import { useState } from "react";
import { zipSync, strToU8 } from "fflate";
import { ArrowLeft, CheckCircle2, Download, ShieldCheck } from "./icons.ts";
import type { AuditReport, MediaAsset, Project } from "../core/types.ts";
import { exportAnnotations, frameName } from "../core/project.ts";
import { exportManifest } from "../plugins/exporters.ts";
import { exportPlugins } from "../plugins/registry.ts";
import { frameToJpeg, makeFrameReader } from "../media/source.ts";

export function safeFileName(name: string) {
  return name.replace(/[\\/:*?"<>|\r\n]/g, "_").slice(0, 100) || "FrameFlow";
}
export function downloadBlob(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob),
    link = document.createElement("a");
  link.href = url;
  link.download = name;
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30000);
}
export interface ExportSettings {
  format: string;
  confirmedOnly: boolean;
  images: boolean;
}
interface Props {
  project: Project;
  asset: MediaAsset;
  back: () => void;
  notify: (message: string) => void;
  setBusy: (busy: boolean) => void;
  settings: ExportSettings;
  updateSettings: (change: Partial<ExportSettings>) => void;
  auditReport: AuditReport | null;
  auditStale: boolean;
  auditSkipped: boolean;
  review: () => void;
}
const groups = [
  "检测训练",
  "标注软件",
  "视频轨迹",
  "专用数据集",
  "工程与表格",
] as const;
export function ExportStep({
  project,
  asset,
  back,
  notify,
  setBusy,
  settings,
  updateSettings,
  auditReport,
  auditStale,
  auditSkipped,
  review,
}: Props) {
  const { format, confirmedOnly, images } = settings;
  const [query, setQuery] = useState(""),
    [working, setWorking] = useState(false),
    [progress, setProgress] = useState(0),
    [done, setDone] = useState("");
  const options = { confirmedOnly, sampledOnly: false },
    backupFormat = format === "project";
  const entries = backupFormat
    ? project.annotations
    : exportAnnotations(project, options);
  const frames = [...new Set(entries.map((a) => a.frame))].sort(
    (a, b) => a - b,
  );
  const pending = project.annotations.filter(
    (a) => a.review === "pending",
  ).length;
  const adapter = exportPlugins.get(format);
  const imageAllowed =
    frames.length <= 1000 &&
    frames.length * project.media.width * project.media.height <= 600000000;
  const visible = exportPlugins
    .list()
    .filter(
      (a) =>
        (project.media.kind !== "image" || a.supportsImages) &&
        `${a.name} ${a.extension} ${a.description}`
          .toLowerCase()
          .includes(query.toLowerCase()),
    );
  let validation = "";
  try {
    adapter.validate?.(project, options);
  } catch (error) {
    validation =
      error instanceof Error ? error.message : "当前数据不适合此格式。";
  }
  const exportNow = async () => {
    if (!entries.length || working || validation) return;
    setWorking(true);
    setBusy(true);
    setProgress(0);
    setDone("");
    let dispose = () => {};
    try {
      adapter.validate?.(project, options);
      const files: Record<string, Uint8Array> = {};
      for (const file of [
        ...adapter.export(project, options),
        ...exportManifest(
          project,
          backupFormat ? { confirmedOnly: false, sampledOnly: false } : options,
          format,
        ),
      ])
        files[file.path] = strToU8(file.text);
      if (auditReport)
        files["audit-report.json"] = strToU8(
          JSON.stringify(auditReport, null, 2),
        );
      if (images && imageAllowed) {
        const handle = await makeFrameReader(asset, project);
        dispose = handle.dispose;
        for (let i = 0; i < frames.length; i++) {
          const frame = frames[i],
            pixels = await handle.reader.read(frame);
          files[
            adapter.imagePath?.(frame) ?? `images/${frameName(frame)}.jpg`
          ] = await frameToJpeg(pixels);
          setProgress(((i + 1) / frames.length) * 90);
        }
      }
      await new Promise((resolve) => setTimeout(resolve, 0));
      const archive = zipSync(files, { level: 6 }),
        name = `${safeFileName(project.name)}_${format}.zip`;
      downloadBlob(
        new Blob([archive.slice().buffer as ArrayBuffer], {
          type: "application/zip",
        }),
        name,
      );
      setProgress(100);
      setDone(name);
      notify("导出文件已生成。");
    } catch (error) {
      notify(error instanceof Error ? error.message : "导出失败，请重试。");
    } finally {
      dispose();
      setWorking(false);
      setBusy(false);
    }
  };
  return (
    <main className="export-step page-width">
      <div className="export-heading">
        <h1>带走你的标注</h1>
        <p>选择格式，下载结果。</p>
      </div>
      <div className="export-grid">
        <section className="card export-formats">
          <div className="format-search">
            <input
              aria-label="搜索导出格式"
              placeholder="搜索格式，例如 COCO、CVAT、YOLO"
              value={query}
              disabled={working}
              onChange={(e) => setQuery(e.target.value)}
            />
          </div>
          {groups.map((group) => {
            const list = visible.filter((a) => a.group === group);
            return list.length ? (
              <div className="format-group" key={group}>
                <h2>{group}</h2>
                <div className="formats-grid">
                  {list.map((a) => (
                    <button
                      key={a.id}
                      disabled={working}
                      aria-pressed={format === a.id}
                      className={`format-card ${format === a.id ? "selected" : ""}`}
                      onClick={() => {
                        updateSettings({ format: a.id });
                        setDone("");
                      }}
                    >
                      <div>
                        <strong>{a.name}</strong>
                        <small>{a.description}</small>
                      </div>
                      <span className="format-ext">{a.extension}</span>
                      <span
                        className={`radio-dot ${format === a.id ? "selected" : ""}`}
                      />
                    </button>
                  ))}
                </div>
              </div>
            ) : null;
          })}
          {!visible.length && <p className="empty-export">没有匹配的格式。</p>}
          <details className="format-help">
            <summary>格式与兼容说明</summary>
            <p>
              当前支持矩形框。分割掩码、关键点和三维任务需要对应标注工具后再扩展。各格式的坐标规则、默认属性和类别映射见
              ZIP 中的说明；来源与审核状态保存在清单中。
            </p>
            <p>
              WIDER Face 用于人脸框；ICDAR
              以类别名作为文字内容，适用于文字类别即转录内容的任务。KITTI
              只提供二维框，三维字段使用未标注值。
            </p>
            <p>
              图像打包最多 1000 帧、总计 6
              亿像素。标注与导出使用同一帧率；原视频按恒定帧率
              计算，可变帧率素材需先转换为固定帧率；外部软件往返验收仍需按目标工具进行。
            </p>
            <p>
              Label Studio
              的图像路径需配置本地媒体存储。训练数据应另行划分训练与验证集。
            </p>
          </details>
        </section>
        <div className="export-right">
          <section className="card export-summary">
            <h2>{adapter.name}</h2>
            <p>
              {project.name} · {project.media.fps} 帧/秒
            </p>
            <div className="export-counts">
              <div>
                <strong>{frames.length.toLocaleString()}</strong>
                <span>标注帧</span>
              </div>
              <div>
                <strong>{entries.length.toLocaleString()}</strong>
                <span>矩形框</span>
              </div>
            </div>
            <div className="export-options">
              <label className="option-row">
                <input
                  type="checkbox"
                  checked={confirmedOnly}
                  disabled={working || backupFormat}
                  onChange={(e) => {
                    updateSettings({ confirmedOnly: e.target.checked });
                    setDone("");
                  }}
                />
                仅已确认标注
              </label>
              <label className="option-row">
                <input
                  type="checkbox"
                  checked={images && imageAllowed}
                  disabled={working || !imageAllowed}
                  onChange={(e) => {
                    updateSettings({ images: e.target.checked });
                    setDone("");
                  }}
                />
                同时打包帧图像
              </label>
              {!imageAllowed && (
                <span className="empty-export">
                  图片超过打包上限，可仅导出标注。
                </span>
              )}
            </div>
            {pending > 0 && !backupFormat && (
              <p className="pending-note">
                {confirmedOnly
                  ? `已排除 ${pending} 个待确认框`
                  : `包含 ${pending} 个待确认框`}
              </p>
            )}
            <div className="export-audit-state">
              <p>
                {auditStale
                  ? "标注有改动，旧审查报告已失效。"
                  : auditReport
                    ? `审查报告：${auditReport.findings.filter((f) => f.status === "open").length} 个疑点尚未核对，将随 ZIP 打包。`
                    : auditSkipped
                      ? "已跳过审查，可直接导出。"
                      : "第四步审查可选，可先核对疑点。"}
              </p>
              <button
                className="button full"
                disabled={working || !project.annotations.length}
                onClick={review}
              >
                <ShieldCheck size={16} />
                {auditReport || auditStale ? "前往审查" : "下一步：审查"}
              </button>
            </div>
            {validation && <p className="export-warning">{validation}</p>}
            {working && (
              <div className="job-progress">
                <div>
                  <span>打包中</span>
                  <strong>{Math.round(progress)}%</strong>
                </div>
                <div className="progress-track">
                  <i style={{ width: `${progress}%` }} />
                </div>
              </div>
            )}
            <button
              className="button primary full"
              disabled={working || !entries.length || !!validation}
              onClick={() => void exportNow()}
            >
              <Download size={17} />
              {working
                ? "正在导出…"
                : auditReport || auditSkipped
                  ? "下载 ZIP"
                  : "跳过审查，直接下载"}
            </button>
            {!entries.length && (
              <p className="empty-export">
                当前筛选无标注，请先确认或调整筛选。
              </p>
            )}
          </section>
          {done && (
            <div className="export-success" role="status">
              <CheckCircle2 size={18} />
              <span>{done}</span>
            </div>
          )}
          <button
            className="button export-back"
            disabled={working}
            onClick={back}
          >
            <ArrowLeft size={15} />
            返回标注
          </button>
        </div>
      </div>
    </main>
  );
}
