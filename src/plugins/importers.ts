import type {
  AnnotationImportAdapter,
  ImportedBox,
  ImportTextFile,
  AnnotationSource,
  ReviewStatus,
} from "../core/types.ts";
import { frameCount } from "../core/project.ts";

const jsonFiles = (files: ImportTextFile[]) =>
  files
    .filter((f) => /\.json$/i.test(f.path))
    .map((f) => ({ file: f, value: JSON.parse(f.text) }));
export function frameFromFile(path: string, fallback?: number): number {
  const stem = path
      .split(/[\\/]/)
      .pop()!
      .replace(/\.[^.]+$/, ""),
    match = /(?:^|_)frame_(\d+)$/.exec(stem) ?? /^(\d+)$/.exec(stem);
  if (match) return Number(match[1]);
  if (fallback !== undefined) return fallback;
  throw new Error(
    `无法确定 ${path} 的帧号，请使用 frame_000000 这样的文件名。`,
  );
}
export function csvRows(text: string): string[][] {
  const rows: string[][] = [],
    row: string[] = [];
  let field = "",
    quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (c === '"') {
      if (quoted && text[i + 1] === '"') {
        field += '"';
        i++;
      } else quoted = !quoted;
    } else if (!quoted && (c === "," || c === "\n")) {
      row.push(field.replace(/\r$/, ""));
      field = "";
      if (c === "\n") {
        if (row.some((v) => v.trim())) rows.push([...row]);
        row.length = 0;
      }
    } else field += c;
  }
  if (quoted) throw new Error("CSV 引号没有闭合。");
  row.push(field.replace(/\r$/, ""));
  if (row.some((v) => v.trim())) rows.push(row);
  return rows;
}
function xml(text: string) {
  const doc = new DOMParser().parseFromString(text, "application/xml");
  if (doc.querySelector("parsererror")) throw new Error("XML 文件无法解析。");
  return doc;
}
const num = (node: Element, attr: string) => Number(node.getAttribute(attr));
const text = (node: Document | Element, selector: string) =>
  node.querySelector(selector)?.textContent?.trim() ?? "";
function xyxy(node: Element) {
  const x = num(node, "xtl"),
    y = num(node, "ytl");
  return { x, y, width: num(node, "xbr") - x, height: num(node, "ybr") - y };
}
const filesOf = (files: ImportTextFile[], extension: string) =>
  files.filter((f) => f.path.toLowerCase().endsWith(extension));

export const builtInImporters: AnnotationImportAdapter[] = [
  {
    id: "coco",
    name: "COCO Detection",
    accepts: (files) =>
      jsonFiles(files).some(
        ({ value: v }) =>
          Array.isArray(v.images) &&
          Array.isArray(v.categories) &&
          Array.isArray(v.annotations),
      ),
    read(files, media) {
      const v = jsonFiles(files).find(
        ({ value: v }) =>
          Array.isArray(v.images) &&
          Array.isArray(v.categories) &&
          Array.isArray(v.annotations),
      )!.value;
      const images = new Map<number, number>(
        v.images.map(
          (
            im: {
              id: number;
              file_name: string;
              width: number;
              height: number;
            },
            i: number,
          ) => {
            if (im.width !== media.width || im.height !== media.height)
              throw new Error("COCO 图像尺寸与素材不一致。");
            return [im.id, frameFromFile(im.file_name, i)];
          },
        ),
      );
      const labels = new Map<number, string>(
        v.categories.map((c: { id: number; name: string }) => [c.id, c.name]),
      );
      return v.annotations.map(
        (a: {
          id: number;
          image_id: number;
          category_id: number;
          bbox: number[];
          track_id?: number;
        }) => {
          if (
            !Array.isArray(a.bbox) ||
            a.bbox.length !== 4 ||
            !images.has(a.image_id) ||
            !labels.has(a.category_id)
          )
            throw new Error("COCO 标注缺少矩形框、图像或类别。");
          const [x, y, width, height] = a.bbox;
          return {
            frame: images.get(a.image_id)!,
            label: labels.get(a.category_id)!,
            box: { x, y, width, height },
            trackKey:
              a.track_id === undefined ? undefined : `coco:${a.track_id}`,
          };
        },
      );
    },
  },
  {
    id: "labelme",
    name: "LabelMe JSON",
    accepts: (files) =>
      jsonFiles(files).some(
        ({ value: v }) =>
          Array.isArray(v.shapes) && typeof v.imagePath === "string",
      ),
    read(files, media) {
      return jsonFiles(files)
        .filter(({ value: v }) => Array.isArray(v.shapes))
        .flatMap(({ value: v, file }) => {
          if (v.imageWidth !== media.width || v.imageHeight !== media.height)
            throw new Error("LabelMe 图像尺寸与素材不一致。");
          const frame = frameFromFile(
            v.imagePath || file.path,
            media.kind === "image" ? 0 : undefined,
          );
          return v.shapes.map(
            (s: {
              label: string;
              shape_type: string;
              points: number[][];
              group_id?: number | null;
            }) => {
              if (s.shape_type !== "rectangle" || s.points?.length !== 2)
                throw new Error("目前只支持 LabelMe rectangle 矩形框。");
              const [a, b] = s.points,
                x = Math.min(a[0], b[0]),
                y = Math.min(a[1], b[1]);
              return {
                frame,
                label: s.label,
                box: {
                  x,
                  y,
                  width: Math.abs(b[0] - a[0]),
                  height: Math.abs(b[1] - a[1]),
                },
                trackKey:
                  s.group_id == null ? undefined : `labelme:${s.group_id}`,
              };
            },
          );
        });
    },
  },
  {
    id: "cvat",
    name: "CVAT XML",
    accepts: (files) =>
      filesOf(files, ".xml").some((f) => /<annotations[\s>]/.test(f.text)),
    read(files, media) {
      const result: ImportedBox[] = [];
      for (const file of filesOf(files, ".xml")) {
        const doc = xml(file.text);
        for (const image of doc.querySelectorAll("annotations > image")) {
          if (
            num(image, "width") !== media.width ||
            num(image, "height") !== media.height
          )
            throw new Error("CVAT 图像尺寸与素材不一致。");
          const frame = frameFromFile(
            image.getAttribute("name") ?? "",
            num(image, "id"),
          );
          for (const box of image.querySelectorAll(":scope > box"))
            result.push({
              frame,
              label: box.getAttribute("label") ?? "目标",
              box: xyxy(box),
            });
        }
        const w = Number(text(doc, "original_size > width")),
          h = Number(text(doc, "original_size > height"));
        if (w && h && (w !== media.width || h !== media.height))
          throw new Error("CVAT 视频尺寸与素材不一致。");
        for (const track of doc.querySelectorAll("annotations > track")) {
          const boxes = [...track.querySelectorAll(":scope > box")].sort(
              (a, b) => num(a, "frame") - num(b, "frame"),
            ),
            label = track.getAttribute("label") ?? "目标",
            trackKey = `cvat:${track.getAttribute("id")}`;
          for (let i = 0; i < boxes.length; i++) {
            const node = boxes[i];
            if (node.getAttribute("outside") === "1") continue;
            const frame = num(node, "frame"),
              a = xyxy(node),
              next = boxes[i + 1],
              b = next ? xyxy(next) : a;
            const end = next ? num(next, "frame") : frameCount(media);
            if (end <= frame || end > frameCount(media))
              throw new Error("CVAT 轨迹帧号超出素材范围。");
            for (let f = frame; f < end; f++) {
              const t = next ? (f - frame) / (end - frame) : 0;
              result.push({
                frame: f,
                label,
                trackKey,
                box: {
                  x: a.x + (b.x - a.x) * t,
                  y: a.y + (b.y - a.y) * t,
                  width: a.width + (b.width - a.width) * t,
                  height: a.height + (b.height - a.height) * t,
                },
              });
            }
          }
        }
      }
      return result;
    },
  },
  {
    id: "voc",
    name: "Pascal VOC XML",
    accepts: (files) =>
      filesOf(files, ".xml").some(
        (f) => /<annotation[\s>]/.test(f.text) && /<bndbox>/.test(f.text),
      ),
    read(files, media) {
      return filesOf(files, ".xml").flatMap((file) => {
        const doc = xml(file.text);
        if (
          Number(text(doc, "size > width")) !== media.width ||
          Number(text(doc, "size > height")) !== media.height
        )
          throw new Error("VOC 图像尺寸与素材不一致。");
        const frame = frameFromFile(
          text(doc, "filename") || file.path,
          media.kind === "image" ? 0 : undefined,
        );
        return [...doc.querySelectorAll("object")].map((node) => {
          const x = Number(text(node, "xmin")) - 1,
            y = Number(text(node, "ymin")) - 1;
          return {
            frame,
            label: text(node, "name"),
            box: {
              x,
              y,
              width: Number(text(node, "xmax")) - x,
              height: Number(text(node, "ymax")) - y,
            },
          };
        });
      });
    },
  },
  {
    id: "csv",
    name: "FrameFlow CSV",
    accepts: (files) =>
      filesOf(files, ".csv").some((f) =>
        f.text.startsWith("frame_0based,time_seconds,track_id,label,"),
      ),
    read(files) {
      return filesOf(files, ".csv")
        .filter((f) =>
          f.text.startsWith("frame_0based,time_seconds,track_id,label,"),
        )
        .flatMap((file) =>
          csvRows(file.text)
            .slice(1)
            .map((row) => ({
              frame: Number(row[0]),
              label: row[3],
              trackKey: `csv:${row[2]}`,
              box: {
                x: Number(row[4]),
                y: Number(row[5]),
                width: Number(row[6]),
                height: Number(row[7]),
              },
              source: row[8] as AnnotationSource,
              review: row[9] as ReviewStatus,
              score: row[10] ? Number(row[10]) : undefined,
            })),
        );
    },
  },
  {
    id: "mot",
    name: "MOTChallenge",
    accepts: (files) =>
      filesOf(files, ".txt").some((f) => /^\d+,\s*\d+,/.test(f.text.trim())),
    read(files) {
      return filesOf(files, ".txt")
        .filter((f) => /^\d+,\s*\d+,/.test(f.text.trim()))
        .flatMap((file) =>
          csvRows(file.text)
            .map((row) => {
              if (row.length < 7)
                throw new Error(
                  "MOT 至少需要帧号、轨迹、矩形框和置信度 7 列。",
                );
              const [frame, id, x, y, width, height, confidence, category] =
                row.map(Number);
              if (confidence <= 0) return null;
              return {
                frame: frame - 1,
                label: `类别 ${Number.isFinite(category) ? category : 1}`,
                trackKey: `mot:${id}`,
                box: { x: x - 1, y: y - 1, width, height },
              };
            })
            .filter((a) => a !== null),
        );
    },
  },
  {
    id: "yolo",
    name: "YOLO / Darknet",
    accepts: (files) =>
      filesOf(files, ".txt").some((f) =>
        /^\d+\s+(?:[\d.eE+-]+\s+){3}[\d.eE+-]+\s*$/m.test(f.text),
      ),
    read(files, media) {
      const classes = files
        .find((f) => /(?:^|\/)(?:classes\.txt|obj\.names)$/i.test(f.path))
        ?.text.trim()
        .split(/\r?\n/);
      return filesOf(files, ".txt")
        .filter((f) =>
          /^\d+\s+(?:[\d.eE+-]+\s+){3}[\d.eE+-]+\s*$/m.test(f.text),
        )
        .flatMap((file) => {
          const frame = frameFromFile(
            file.path,
            media.kind === "image" ? 0 : undefined,
          );
          return file.text
            .trim()
            .split(/\r?\n/)
            .filter(Boolean)
            .map((line) => {
              const values = line.trim().split(/\s+/).map(Number);
              if (
                values.length !== 5 ||
                values.some((v) => !Number.isFinite(v))
              )
                throw new Error("目前只支持 YOLO 5 列目标检测矩形框。");
              const [id, cx, cy, w, h] = values;
              if (
                !Number.isInteger(id) ||
                id < 0 ||
                [cx, cy, w, h].some((v) => v < 0 || v > 1)
              )
                throw new Error("YOLO 类别或归一化坐标无效。");
              return {
                frame,
                label: classes?.[id] ?? `类别 ${id}`,
                box: {
                  x: (cx - w / 2) * media.width,
                  y: (cy - h / 2) * media.height,
                  width: w * media.width,
                  height: h * media.height,
                },
              };
            });
        });
    },
  },
];
