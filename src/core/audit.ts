import type { AuditFindingStatus, AuditReport, Project } from "./types.ts";

export const AUDIT_TYPE_NAMES = {
  missing: "可能缺帧",
  jump: "位置跳变",
  size: "尺寸突变",
  correlation: "低匹配分数",
  pending: "尚未确认",
};
export function auditIsCurrent(project: Project, basis: Project) {
  return (
    project.id === basis.id &&
    project.media === basis.media &&
    project.annotations === basis.annotations &&
    project.labels === basis.labels &&
    project.tracks === basis.tracks
  );
}
export function updateAuditFinding(
  report: AuditReport,
  id: string,
  status: AuditFindingStatus,
): AuditReport {
  if (!report.findings.some((f) => f.id === id))
    throw new Error("未知审查项。");
  return {
    ...report,
    findings: report.findings.map((f) => (f.id === id ? { ...f, status } : f)),
  };
}
