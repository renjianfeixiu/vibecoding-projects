import type {
  AnnotationAssistPlugin,
  ExportAdapter,
  FrameFillPlugin,
  AnnotationImportAdapter,
  AnnotationAuditPlugin,
} from "../core/types.ts";
import { templateMatching } from "./template-matching.ts";
import { opticalFlowTracking } from "./optical-flow.ts";
import { linearInterpolation } from "./interpolation.ts";
import { builtInExporters } from "./exporters.ts";
import { builtInImporters } from "./importers.ts";
import { qualityReview } from "./quality-review.ts";

function registry<T extends { id: string }>(plugins: T[]) {
  const entries = new Map(plugins.map((p) => [p.id, p]));
  return {
    list: () => [...entries.values()],
    get: (id: string) => {
      const item = entries.get(id);
      if (!item) throw new Error(`未知插件：${id}`);
      return item;
    },
    register: (plugin: T) => {
      if (entries.has(plugin.id)) throw new Error(`插件 ID 重复：${plugin.id}`);
      entries.set(plugin.id, plugin);
    },
  };
}
export const assistPlugins = registry<AnnotationAssistPlugin>([
  templateMatching,
]);
export const fillPlugins = registry<FrameFillPlugin>([
  opticalFlowTracking,
  linearInterpolation,
]);
export const exportPlugins = registry<ExportAdapter>(builtInExporters);
export const importPlugins =
  registry<AnnotationImportAdapter>(builtInImporters);
export const auditPlugins = registry<AnnotationAuditPlugin>([qualityReview]);
