import { useEffect, useState } from "react";
import type {
  AuditFinding,
  AuditFindingStatus,
  AuditReport,
  MediaAsset,
  Project,
} from "../core/types.ts";
import { AUDIT_TYPE_NAMES } from "../core/audit.ts";
import { frameCount } from "../core/project.ts";
import { auditPlugins } from "../plugins/registry.ts";
import { MediaStage } from "./MediaStage.tsx";
import { Check, Download, ShieldCheck, Sparkles, X } from "./icons.ts";
import { downloadBlob, safeFileName } from "./ExportStep.tsx";
import { formatTime } from "./Icon.tsx";

interface Props {
  project: Project;
  asset: MediaAsset;
  frame: number;
  setFrame: (frame: number) => void;
  trackId: number;
  setTrackId: (id: number) => void;
  report: AuditReport | null;
  stale: boolean;
  engineId: string;
  setEngineId: (id: string) => void;
  busy: string;
  progress: number;
  run: () => void;
  cancel: () => void;
  updateFinding: (id: string, status: AuditFindingStatus) => void;
  fix: (finding: AuditFinding) => void;
  skip: () => void;
  exportStep: () => void;
}
export function ReviewStep(props: Props) {
  const { project, report, stale, busy } = props;
  const [filter, setFilter] = useState("open"),
    [page, setPage] = useState(0),
    [selectedId, setSelectedId] = useState("");
  useEffect(() => {
    const matching = report?.findings.find(
      (finding) =>
        finding.trackId === props.trackId &&
        finding.frame <= props.frame &&
        (finding.endFrame ?? finding.frame) >= props.frame,
    );
    setSelectedId(matching?.id ?? "");
    setPage(0);
    setFilter("open");
  }, [report?.reviewedAt]);
  const findings = report?.findings ?? [],
    open = findings.filter((f) => f.status === "open").length;
  const filtered = findings.filter(
    (f) =>
      filter === "all" ||
      (filter === "open" ? f.status === "open" : f.status !== "open"),
  );
  const pages = Math.max(1, Math.ceil(filtered.length / 8));
  const currentPage = Math.min(page, pages - 1);
  const selected = findings.find((f) => f.id === selectedId);
  const select = (finding: AuditFinding) => {
    setSelectedId(finding.id);
    props.setTrackId(finding.trackId);
    props.setFrame(finding.frame);
  };
  const trackName = (id: number) =>
    project.tracks.find((t) => t.id === id)?.name ?? `目标 ${id}`;
  return (
    <main className="audit-step page-wide">
      <div className="workspace-heading">
        <div>
          <h1>
            AI 标注审查 <span className="optional-badge">可跳过</span>
          </h1>
          <p>定位疑点，逐帧核对。</p>
        </div>
        <button className="button" disabled={!!busy} onClick={props.skip}>
          跳过审查，直接导出
        </button>
      </div>
      <section className="card audit-setup">
        <label>
          审查引擎
          <select
            aria-label="审查引擎"
            disabled={!!busy}
            value={props.engineId}
            onChange={(e) => props.setEngineId(e.target.value)}
          >
            {auditPlugins.list().map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </label>
        <div className="audit-stats">
          <span>
            <strong>{report && !stale ? findings.length : "—"}</strong> 疑点
          </span>
          <span>
            <strong>{report && !stale ? open : "—"}</strong> 未核对
          </span>
          <span>
            <strong>{report && !stale ? findings.length - open : "—"}</strong>{" "}
            已处理
          </span>
        </div>
        <button
          className="button primary"
          disabled={!!busy || !project.annotations.length}
          onClick={props.run}
        >
          <Sparkles size={16} />
          {report ? "重新审查" : "开始审查"}
        </button>
        {busy && (
          <button className="button" onClick={props.cancel}>
            <X size={15} />
            取消
          </button>
        )}
      </section>
      {busy && (
        <div className="audit-progress" role="status">
          {busy} · {Math.round(props.progress)}%
          <progress max="100" value={props.progress} />
        </div>
      )}
      {stale && (
        <p className="audit-notice" role="status">
          标注已有改动，请重新审查。旧报告不会随新标注导出。
        </p>
      )}
      <div className="audit-grid">
        <section className="card audit-viewer">
          <MediaStage
            project={project}
            asset={props.asset}
            frame={props.frame}
            playing={false}
            tool="move"
            trackId={props.trackId}
            disabled={true}
            onBox={() => {}}
            selectTrack={() => {}}
            onDynamic={() => {}}
            startDynamic={() => {}}
            endDynamic={() => {}}
          />
          <div className="audit-frame-bar">
            <label>
              帧{" "}
              <input
                aria-label="审查帧号"
                type="number"
                min="0"
                max={frameCount(project.media) - 1}
                value={props.frame}
                disabled={!!busy}
                onChange={(e) => {
                  setSelectedId("");
                  props.setFrame(Number(e.target.value) || 0);
                }}
              />
            </label>
            <span>
              / {frameCount(project.media) - 1} ·{" "}
              {formatTime(props.frame / project.media.fps)} ·{" "}
              {project.media.fps} 帧/秒
            </span>
          </div>
          {selected && (
            <div className="audit-selected">
              <strong>
                {AUDIT_TYPE_NAMES[selected.type]} ·{" "}
                {trackName(selected.trackId)} · 帧 {selected.frame}
                {selected.endFrame !== undefined &&
                selected.endFrame !== selected.frame
                  ? `–${selected.endFrame}`
                  : ""}
              </strong>
              <p>{selected.detail}</p>
              <div className="audit-actions">
                <button
                  className="button primary small"
                  disabled={!!busy || stale}
                  onClick={() => props.fix(selected)}
                >
                  去修正
                </button>
                <button
                  className="button small"
                  disabled={!!busy || stale || selected.status === "checked"}
                  onClick={() => props.updateFinding(selected.id, "checked")}
                >
                  <Check size={14} />
                  已核对
                </button>
                <button
                  className="button small"
                  disabled={!!busy || stale || selected.status === "dismissed"}
                  onClick={() => props.updateFinding(selected.id, "dismissed")}
                >
                  忽略提示
                </button>
              </div>
            </div>
          )}
        </section>
        <aside className="card audit-results">
          <div className="panel-heading">
            <h2>
              <ShieldCheck size={17} />
              审查结果
            </h2>
            <span>{findings.length} 项</span>
          </div>
          <div className="source-tabs">
            {[
              ["open", "未核对"],
              ["all", "全部"],
              ["handled", "已处理"],
            ].map(([id, name]) => (
              <button
                key={id}
                className={filter === id ? "active" : ""}
                onClick={() => {
                  setFilter(id);
                  setPage(0);
                }}
              >
                {name}
              </button>
            ))}
          </div>
          <div className="audit-findings">
            {filtered.slice(currentPage * 8, currentPage * 8 + 8).map((f) => (
              <button
                key={f.id}
                className={`audit-finding ${selectedId === f.id ? "selected" : ""}`}
                disabled={!!busy}
                onClick={() => select(f)}
              >
                <span>
                  <b>{AUDIT_TYPE_NAMES[f.type]}</b>
                  <small>
                    {f.status === "open"
                      ? "待核对"
                      : f.status === "checked"
                        ? "已核对"
                        : "已忽略"}
                  </small>
                </span>
                <strong>{f.message}</strong>
                <small>
                  {trackName(f.trackId)} · 帧 {f.frame}
                  {f.endFrame !== undefined && f.endFrame !== f.frame
                    ? `–${f.endFrame}`
                    : ""}
                </small>
              </button>
            ))}
            {!filtered.length && (
              <div className="audit-empty">
                <ShieldCheck size={30} />
                <strong>
                  {!report
                    ? "尚未审查"
                    : findings.length
                      ? "当前筛选没有疑点"
                      : "未发现本轮规则疑点"}
                </strong>
                <p>
                  {!report
                    ? "点击「开始审查」检查标注。"
                    : "审查提示帮助定位问题，仍需对照画面确认。"}
                </p>
              </div>
            )}
          </div>
          {pages > 1 && (
            <div className="audit-pagination">
              <button
                className="button small"
                disabled={currentPage === 0}
                onClick={() => setPage(currentPage - 1)}
              >
                上一页
              </button>
              <span>
                {currentPage + 1} / {pages}
              </span>
              <button
                className="button small"
                disabled={currentPage >= pages - 1}
                onClick={() => setPage(currentPage + 1)}
              >
                下一页
              </button>
            </div>
          )}
          <button
            className="button audit-download"
            disabled={!report || !!busy || stale}
            onClick={() =>
              report &&
              downloadBlob(
                new Blob([JSON.stringify(report, null, 2)], {
                  type: "application/json",
                }),
                `${safeFileName(project.name)}_审查报告.json`,
              )
            }
          >
            <Download size={15} />
            下载审查报告
          </button>
          <button
            className="button primary audit-download"
            disabled={!!busy}
            onClick={props.exportStep}
          >
            返回导出
          </button>
        </aside>
      </div>
      <details className="annotation-import-help audit-help">
        <summary>审查范围</summary>
        <p>
          当前引擎实际运行本地规则与轨迹一致性检查，结果是疑点提示；不会自动改框或确认标注。缺帧检查只覆盖已有轨迹的标注区间，尊重已拒绝帧。未知目标漏标、类别语义和复杂遮挡需多模态模型插件与人工复核。
        </p>
        <p>
          「已核对」与「忽略提示」只记录审查处理状态。修改标注后需重新审查；审查可跳过，不阻止导出。
        </p>
      </details>
    </main>
  );
}
