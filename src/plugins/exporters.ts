import type {
  Annotation,
  ExportAdapter,
  ExportFile,
  ExportOptions,
  Project,
} from "../core/types.ts";
import {
  exportAnnotations,
  frameCount,
  frameName,
  sourceFrameRate,
} from "../core/project.ts";
import {
  json,
  round,
  escapeXml,
  csv,
  grouped,
  labelOf,
  header,
} from "./export-utils.ts";
import { additionalExporters } from "./exporters-extra.ts";
export { escapeXml } from "./export-utils.ts";

export const builtInExporters: ExportAdapter[] = [
  {
    id: "project",
    name: "FrameFlow",
    extension: "JSON",
    description: "完整工程备份 · 可恢复编辑",
    supportsImages: true,
    group: "工程与表格",
    export: (project) => [
      { path: "project.frameflow.json", text: json(project) },
    ],
  },
  {
    id: "coco",
    name: "COCO Detection",
    extension: "JSON",
    description: "通用目标检测数据集",
    supportsImages: true,
    group: "检测训练",
    export: (project, options) => [
      {
        path: "annotations.json",
        text: json({
          info: {
            description: project.name,
            version: "1.0",
            year: new Date(project.createdAt).getFullYear(),
          },
          licenses: [],
          images: grouped(project, options).map(([frame]) => ({
            id: frame + 1,
            file_name: `images/${frameName(frame)}.jpg`,
            width: project.media.width,
            height: project.media.height,
          })),
          categories: project.labels.map((l) => ({
            id: l.id,
            name: l.name,
            supercategory: "object",
          })),
          annotations: exportAnnotations(project, options).map((a, index) => ({
            id: index + 1,
            image_id: a.frame + 1,
            category_id: labelOf(project, a).id,
            bbox: [a.box.x, a.box.y, a.box.width, a.box.height].map(round),
            area: round(a.box.width * a.box.height),
            iscrowd: 0,
            segmentation: [],
          })),
        }),
      },
    ],
  },
  {
    id: "yolo",
    name: "Ultralytics YOLO",
    extension: "TXT",
    description: "归一化矩形框 · 每帧标签",
    supportsImages: true,
    group: "检测训练",
    export: (project, options) => [
      ...grouped(project, options).map(([frame, annotations]) => ({
        path: `labels/${frameName(frame)}.txt`,
        text:
          annotations
            .map((a) =>
              [
                project.labels.findIndex(
                  (l) => l.id === labelOf(project, a).id,
                ),
                ((a.box.x + a.box.width / 2) / project.media.width).toFixed(6),
                ((a.box.y + a.box.height / 2) / project.media.height).toFixed(
                  6,
                ),
                (a.box.width / project.media.width).toFixed(6),
                (a.box.height / project.media.height).toFixed(6),
              ].join(" "),
            )
            .join("\n") + "\n",
      })),
      {
        path: "classes.txt",
        text: project.labels.map((l) => l.name).join("\n") + "\n",
      },
      {
        path: "data.yaml",
        text: `# 请按实际训练/验证划分修改路径\npath: .\ntrain: images\nval: images\nnames:\n${project.labels.map((l, index) => `  ${index}: ${JSON.stringify(l.name)}`).join("\n")}\n`,
      },
    ],
  },
  {
    id: "voc",
    name: "Pascal VOC",
    extension: "XML",
    description: "经典目标检测格式",
    supportsImages: true,
    group: "检测训练",
    imagePath: (frame) => `JPEGImages/${frameName(frame)}.jpg`,
    export: (project, options) =>
      grouped(project, options).map(([frame, annotations]) => ({
        path: `Annotations/${frameName(frame)}.xml`,
        text:
          header +
          `<annotation><folder>JPEGImages</folder><filename>${frameName(frame)}.jpg</filename><size><width>${project.media.width}</width><height>${project.media.height}</height><depth>3</depth></size><segmented>0</segmented>${annotations.map((a) => `<object><name>${escapeXml(labelOf(project, a).name)}</name><pose>Unspecified</pose><truncated>0</truncated><difficult>0</difficult><bndbox><xmin>${Math.floor(a.box.x) + 1}</xmin><ymin>${Math.floor(a.box.y) + 1}</ymin><xmax>${Math.ceil(a.box.x + a.box.width)}</xmax><ymax>${Math.ceil(a.box.y + a.box.height)}</ymax></bndbox></object>`).join("")}</annotation>`,
      })),
  },
  {
    id: "cvat",
    name: "CVAT for video",
    extension: "XML 1.1",
    description: "矩形框 · 保留视频轨迹",
    supportsImages: false,
    group: "视频轨迹",
    export(project, options) {
      const labels = project.labels
        .map(
          (l) =>
            `<label><name>${escapeXml(l.name)}</name><color>${l.color}</color><type>rectangle</type><attributes /></label>`,
        )
        .join("");
      const stop = frameCount(project.media) - 1;
      const mode =
        project.media.kind === "image" ? "annotation" : "interpolation";
      const meta = `<meta><task><id>0</id><name>${escapeXml(project.name)}</name><size>${stop + 1}</size><mode>${mode}</mode><overlap>0</overlap><bugtracker /><created>${project.createdAt}</created><updated>${project.createdAt}</updated><subset>default</subset><start_frame>0</start_frame><stop_frame>${stop}</stop_frame><frame_filter /><segments><segment><id>0</id><start>0</start><stop>${stop}</stop><url /></segment></segments><owner><username>local</username><email /></owner><labels>${labels}</labels><original_size><width>${project.media.width}</width><height>${project.media.height}</height></original_size></task><dumped>${project.createdAt}</dumped></meta>`;
      const annotations = exportAnnotations(project, options);
      const shape = (
        a: Annotation,
        outside = 0,
        frame = a.frame,
        isImage = false,
      ) =>
        `<box ${isImage ? `label="${escapeXml(labelOf(project, a).name)}" source="manual"` : `frame="${frame}" outside="${outside}" keyframe="1"`} occluded="0" xtl="${round(a.box.x)}" ytl="${round(a.box.y)}" xbr="${round(a.box.x + a.box.width)}" ybr="${round(a.box.y + a.box.height)}" z_order="0" />`;
      const content =
        mode === "annotation"
          ? `<image id="0" name="images/${frameName(0)}.jpg" width="${project.media.width}" height="${project.media.height}">${annotations.map((a) => shape(a, 0, 0, true)).join("")}</image>`
          : project.tracks
              .map((track) => {
                const items = annotations
                  .filter((a) => a.trackId === track.id)
                  .sort((a, b) => a.frame - b.frame);
                if (!items.length) return "";
                const label = project.labels.find(
                  (l) => l.id === track.labelId,
                )!;
                return `<track id="${track.id - 1}" label="${escapeXml(label.name)}" source="manual">${items.map((a, i) => shape(a) + ((items[i + 1]?.frame ?? stop + 1) > a.frame + 1 && a.frame < stop ? shape(a, 1, a.frame + 1) : "")).join("")}</track>`;
              })
              .join("");
      return [
        {
          path: "annotations.xml",
          text:
            header +
            `<annotations><version>1.1</version>${meta}${content}</annotations>`,
        },
      ];
    },
  },
  {
    id: "labelme",
    name: "LabelMe JSON",
    extension: "JSON",
    description: "每帧双点 rectangle",
    supportsImages: true,
    group: "标注软件",
    export: (project, options) =>
      grouped(project, options).map(([frame, annotations]) => ({
        path: `annotations/${frameName(frame)}.json`,
        text: json({
          version: "5.0.1",
          flags: {},
          shapes: annotations.map((a) => ({
            label: labelOf(project, a).name,
            points: [
              [a.box.x, a.box.y],
              [a.box.x + a.box.width, a.box.y + a.box.height],
            ].map((point) => point.map(round)),
            group_id: a.trackId,
            description: "",
            shape_type: "rectangle",
            flags: {},
          })),
          imagePath: `../images/${frameName(frame)}.jpg`,
          imageData: null,
          imageHeight: project.media.height,
          imageWidth: project.media.width,
        }),
      })),
  },
  {
    id: "mot",
    name: "MOTChallenge",
    extension: "TXT",
    description: "多目标轨迹 · 1 起始帧号",
    supportsImages: false,
    group: "视频轨迹",
    imagePath: (frame) => `img1/${String(frame + 1).padStart(6, "0")}.jpg`,
    export: (project, options) => [
      {
        path: "gt/gt.txt",
        text:
          exportAnnotations(project, options)
            .map((a) =>
              [
                a.frame + 1,
                a.trackId,
                a.box.x + 1,
                a.box.y + 1,
                a.box.width,
                a.box.height,
                1,
                labelOf(project, a).id,
                1,
              ]
                .map(round)
                .join(","),
            )
            .join("\n") + "\n",
      },
      {
        path: "gt/labels.txt",
        text: project.labels.map((l) => l.name).join("\n") + "\n",
      },
      {
        path: "seqinfo.ini",
        text: `[Sequence]\nname=${project.name.replace(/[\r\n]/g, " ")}\nimDir=img1\nframeRate=${project.media.fps}\nseqLength=${frameCount(project.media)}\nimWidth=${project.media.width}\nimHeight=${project.media.height}\nimExt=.jpg\n`,
      },
    ],
  },
  {
    id: "csv",
    name: "CSV",
    extension: "CSV",
    description: "便于分析 · 含来源和审核",
    supportsImages: true,
    group: "工程与表格",
    export: (project, options) => [
      {
        path: "annotations.csv",
        text:
          "frame_0based,time_seconds,track_id,label,x,y,width,height,source,review,match_correlation\n" +
          exportAnnotations(project, options)
            .map((a) =>
              [
                a.frame,
                round(a.frame / project.media.fps),
                a.trackId,
                labelOf(project, a).name,
                ...[a.box.x, a.box.y, a.box.width, a.box.height].map(round),
                a.source,
                a.review,
                a.score ?? "",
              ]
                .map(csv)
                .join(","),
            )
            .join("\n") +
          "\n",
      },
    ],
  },
  ...additionalExporters,
];
export function exportManifest(
  project: Project,
  options: ExportOptions,
  formatId: string,
): ExportFile[] {
  const adapter = builtInExporters.find((a) => a.id === formatId);
  const imageExample = adapter?.imagePath?.(0) ?? "images/frame_000000.jpg";
  return [
    {
      path: "frameflow-manifest.json",
      text: json({
        schemaVersion: 1,
        format: formatId,
        name: project.name,
        media: project.media,
        settings: project.settings,
        options,
        labels: project.labels,
        tracks: project.tracks,
        annotations: exportAnnotations(project, options),
      }),
    },
    {
      path: "README.txt",
      text: `FrameFlow 0.6.1 矩形框导出\n格式：${adapter?.name ?? formatId}\n原媒体：${project.media.fileName}\n尺寸：${project.media.width}×${project.media.height}，原视频帧率：${sourceFrameRate(project.media)}，标注/导出帧率：${project.media.fps}\n内部帧号从0开始；MOT帧号/左上坐标从1开始，VOC左上坐标从1开始。YOLO为归一化中心/宽高；Label Studio为百分比坐标；Create ML为像素中心/宽高。\n图片路径示例：${imageExample}；未选择打包时请自行配对原尺寸图像。\nKITTI仅含二维框，三维字段为未标注占位值；类别名称映射在labelmap.json。\n遮挡、截断、可见性等专用属性目前使用默认值；WIDER Face用于人脸，ICDAR以类别名作为文字转录。\nYOLO训练/验证路径需要按实际数据划分修改。Label Studio需配置本地媒体存储。\nFrameFlow工程保留全部来源/审核状态，不应用筛选，不含原素材。请保留frameflow-manifest.json，它保存标准格式不能表达的来源、审核与类别映射。\n浏览标注效果：在第一步选择对应原视频或图像，再选择此 ZIP，点击“浏览标注”。20 种导出包均可使用清单精确恢复已导出的帧和框。清单缺失时只支持原生 COCO、CVAT XML、YOLO、VOC、LabelMe JSON、MOT、FrameFlow CSV；没有轨迹 ID 的文件不会推断跨帧身份。\n标注、动态录制、补帧与导出共用第一步的标注帧率。第n个标注帧取原视频floor(n×原视频帧率/标注帧率)帧，帧号从0连续编号。例如60→20帧/秒，取原帧0、3、6…；MOT记录20帧/秒，CSV时间戳按20帧/秒换算。清单保留原视频与标注帧率，回导时不再采样。浏览器按恒定帧率定位源图像，可变帧率需后端精确抽帧。\n当前实现矩形框子集。已检查文件结构、坐标与可解析性，尚未对每个外部软件进行全部往返验收。\n`,
    },
  ];
}
