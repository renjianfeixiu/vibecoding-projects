import type { ExportAdapter } from "../core/types.ts";
import { exportAnnotations, frameCount, frameName } from "../core/project.ts";
import {
  csv,
  escapeXml,
  grouped,
  header,
  json,
  labelOf,
  round,
} from "./export-utils.ts";

export const additionalExporters: ExportAdapter[] = [
  {
    id: "cvat-images",
    name: "CVAT for images",
    extension: "XML 1.1",
    description: "逐帧图像标注",
    supportsImages: true,
    group: "标注软件",
    export: (p, options) => [
      {
        path: "annotations.xml",
        text:
          header +
          `<annotations><version>1.1</version><meta><task><id>0</id><name>${escapeXml(p.name)}</name><size>${grouped(p, options).length}</size><mode>annotation</mode><overlap>0</overlap><bugtracker/><created>${p.createdAt}</created><updated>${p.createdAt}</updated><subset>default</subset><start_frame>0</start_frame><stop_frame>${frameCount(p.media) - 1}</stop_frame><frame_filter/><segments/><owner><username>local</username><email/></owner><labels>${p.labels.map((l) => `<label><name>${escapeXml(l.name)}</name><color>${l.color}</color><type>rectangle</type><attributes/></label>`).join("")}</labels></task><dumped>${p.createdAt}</dumped></meta>${grouped(
            p,
            options,
          )
            .map(
              ([frame, items], i) =>
                `<image id="${i}" name="images/${frameName(frame)}.jpg" width="${p.media.width}" height="${p.media.height}">${items.map((a) => `<box label="${escapeXml(labelOf(p, a).name)}" source="${a.source === "manual" ? "manual" : "auto"}" occluded="0" xtl="${round(a.box.x)}" ytl="${round(a.box.y)}" xbr="${round(a.box.x + a.box.width)}" ybr="${round(a.box.y + a.box.height)}" z_order="0"/>`).join("")}</image>`,
            )
            .join("")}</annotations>`,
      },
    ],
  },
  {
    id: "darknet",
    name: "Darknet YOLO",
    extension: "TXT",
    description: "obj.data / obj.names",
    supportsImages: true,
    group: "检测训练",
    imagePath: (frame) => `obj_train_data/${frameName(frame)}.jpg`,
    export: (p, options) => [
      ...grouped(p, options).map(([frame, items]) => ({
        path: `obj_train_data/${frameName(frame)}.txt`,
        text:
          items
            .map((a) =>
              [
                p.labels.findIndex((l) => l.id === labelOf(p, a).id),
                ((a.box.x + a.box.width / 2) / p.media.width).toFixed(6),
                ((a.box.y + a.box.height / 2) / p.media.height).toFixed(6),
                (a.box.width / p.media.width).toFixed(6),
                (a.box.height / p.media.height).toFixed(6),
              ].join(" "),
            )
            .join("\n") + "\n",
      })),
      {
        path: "obj.names",
        text: p.labels.map((l) => l.name).join("\n") + "\n",
      },
      {
        path: "obj.data",
        text: `classes = ${p.labels.length}\ntrain = train.txt\nnames = obj.names\nbackup = backup/\n`,
      },
      {
        path: "train.txt",
        text:
          grouped(p, options)
            .map(([frame]) => `obj_train_data/${frameName(frame)}.jpg`)
            .join("\n") + "\n",
      },
    ],
  },
  {
    id: "datumaro",
    name: "Datumaro",
    extension: "JSON",
    description: "通用数据集交换",
    supportsImages: true,
    group: "检测训练",
    imagePath: (frame) => `images/default/${frameName(frame)}.jpg`,
    export: (p, options) => [
      {
        path: "annotations/default.json",
        text: json({
          dm_format_version: "1.0",
          info: { name: p.name },
          categories: {
            label: {
              labels: p.labels.map((l) => ({
                name: l.name,
                parent: "",
                attributes: [],
              })),
              attributes: [],
              label_groups: [],
            },
          },
          items: grouped(p, options).map(([frame, items]) => ({
            id: frameName(frame),
            image: {
              path: `${frameName(frame)}.jpg`,
              size: [p.media.height, p.media.width],
            },
            annotations: items.map((a, i) => ({
              id: i,
              type: "bbox",
              attributes: {
                track_id: a.trackId,
                source: a.source,
                review: a.review,
              },
              group: a.trackId,
              label_id: p.labels.findIndex((l) => l.id === labelOf(p, a).id),
              z_order: 0,
              bbox: [a.box.x, a.box.y, a.box.width, a.box.height].map(round),
            })),
          })),
        }),
      },
    ],
  },
  {
    id: "labelme-xml",
    name: "LabelMe XML",
    extension: "XML",
    description: "MIT / CVAT LabelMe",
    supportsImages: true,
    group: "标注软件",
    imagePath: (frame) => `Images/default/${frameName(frame)}.jpg`,
    export: (p, options) =>
      grouped(p, options).map(([frame, items]) => ({
        path: `Annotations/default/${frameName(frame)}.xml`,
        text:
          header +
          `<annotation><filename>${frameName(frame)}.jpg</filename><folder>default</folder><source><sourceImage>local</sourceImage><sourceAnnotation>FrameFlow</sourceAnnotation></source><imagesize><nrows>${p.media.height}</nrows><ncols>${p.media.width}</ncols></imagesize>${items
            .map(
              (a, i) =>
                `<object><name>${escapeXml(labelOf(p, a).name)}</name><deleted>0</deleted><verified>${a.review === "confirmed" ? 1 : 0}</verified><occluded>no</occluded><attributes/><parts><hasparts/><ispartof/></parts><id>${i}</id><type>bounding_box</type><polygon><username>local</username>${[
                  [a.box.x, a.box.y],
                  [a.box.x + a.box.width, a.box.y],
                  [a.box.x + a.box.width, a.box.y + a.box.height],
                  [a.box.x, a.box.y + a.box.height],
                ]
                  .map(
                    ([x, y]) => `<pt><x>${round(x)}</x><y>${round(y)}</y></pt>`,
                  )
                  .join("")}</polygon></object>`,
            )
            .join("")}</annotation>`,
      })),
  },
  {
    id: "via",
    name: "VGG Image Annotator",
    extension: "JSON",
    description: "VIA 2 · 矩形区域",
    supportsImages: true,
    group: "标注软件",
    // VIA v2 resolves file names at the project root.
    imagePath: (frame) => `${frameName(frame)}.jpg`,
    export: (p, options) => [
      {
        path: "via_region_data.json",
        text: json(
          Object.fromEntries(
            grouped(p, options).map(([frame, items]) => [
              `${frameName(frame)}.jpg`,
              {
                filename: `${frameName(frame)}.jpg`,
                size: -1,
                regions: items.map((a) => ({
                  shape_attributes: {
                    name: "rect",
                    x: round(a.box.x),
                    y: round(a.box.y),
                    width: round(a.box.width),
                    height: round(a.box.height),
                  },
                  region_attributes: {
                    label: labelOf(p, a).name,
                    track_id: String(a.trackId),
                  },
                })),
                file_attributes: {},
              },
            ]),
          ),
        ),
      },
    ],
  },
  {
    id: "label-studio",
    name: "Label Studio",
    extension: "JSON",
    description: "含矩形配置文件",
    supportsImages: true,
    group: "标注软件",
    export: (p, options) => [
      {
        path: "tasks.json",
        text: json(
          grouped(p, options).map(([frame, items]) => ({
            id: frame + 1,
            data: { image: `images/${frameName(frame)}.jpg` },
            annotations: [
              {
                id: frame + 1,
                result: items.map((a) => ({
                  id: `track-${a.trackId}`,
                  from_name: "box",
                  to_name: "image",
                  type: "rectanglelabels",
                  original_width: p.media.width,
                  original_height: p.media.height,
                  image_rotation: 0,
                  value: {
                    x: round((a.box.x / p.media.width) * 100),
                    y: round((a.box.y / p.media.height) * 100),
                    width: round((a.box.width / p.media.width) * 100),
                    height: round((a.box.height / p.media.height) * 100),
                    rotation: 0,
                    rectanglelabels: [labelOf(p, a).name],
                  },
                })),
                was_cancelled: false,
                ground_truth: false,
                lead_time: 0,
              },
            ],
          })),
        ),
      },
      {
        path: "labeling_config.xml",
        text: `<View><Image name="image" value="$image"/><RectangleLabels name="box" toName="image">${p.labels.map((l) => `<Label value="${escapeXml(l.name)}" background="${l.color}"/>`).join("")}</RectangleLabels></View>`,
      },
    ],
  },
  {
    id: "create-ml",
    name: "Apple Create ML",
    extension: "JSON",
    description: "中心坐标与像素尺寸",
    supportsImages: true,
    group: "检测训练",
    export: (p, options) => [
      {
        path: "annotations.json",
        text: json(
          grouped(p, options).map(([frame, items]) => ({
            image: `images/${frameName(frame)}.jpg`,
            annotations: items.map((a) => ({
              label: labelOf(p, a).name,
              coordinates: {
                x: round(a.box.x + a.box.width / 2),
                y: round(a.box.y + a.box.height / 2),
                width: round(a.box.width),
                height: round(a.box.height),
              },
            })),
          })),
        ),
      },
    ],
  },
  {
    id: "open-images",
    name: "Open Images V6",
    extension: "CSV",
    description: "归一化边界坐标",
    supportsImages: true,
    group: "检测训练",
    imagePath: (frame) => `images/default/${frameName(frame)}.jpg`,
    export: (p, options) => [
      {
        path: "annotations/default-annotations-bbox.csv",
        text:
          "ImageID,Source,LabelName,Confidence,XMin,XMax,YMin,YMax,IsOccluded,IsTruncated,IsGroupOf,IsDepiction,IsInside\n" +
          exportAnnotations(p, options)
            .map((a) =>
              [
                frameName(a.frame),
                "freeform",
                `/frameflow/${labelOf(p, a).id}`,
                1,
                round(a.box.x / p.media.width),
                round((a.box.x + a.box.width) / p.media.width),
                round(a.box.y / p.media.height),
                round((a.box.y + a.box.height) / p.media.height),
                0,
                0,
                0,
                0,
                0,
              ]
                .map(csv)
                .join(","),
            )
            .join("\n") +
          "\n",
      },
      {
        path: "annotations/oidv6-class-descriptions.csv",
        text:
          p.labels
            .map((l) => [`/frameflow/${l.id}`, l.name].map(csv).join(","))
            .join("\n") + "\n",
      },
      {
        path: "annotations/images.meta",
        text:
          grouped(p, options)
            .map(
              ([frame]) =>
                `${frameName(frame)} ${p.media.height} ${p.media.width}`,
            )
            .join("\n") + "\n",
      },
    ],
  },
  {
    id: "kitti",
    name: "KITTI Detection",
    extension: "TXT",
    description: "2D 检测 · 3D 字段留空值",
    supportsImages: true,
    group: "检测训练",
    imagePath: (frame) => `training/image_2/${frameName(frame)}.jpg`,
    export: (p, options) => [
      ...grouped(p, options).map(([frame, items]) => ({
        path: `training/label_2/${frameName(frame)}.txt`,
        text:
          items
            .map((a) =>
              [
                `label_${labelOf(p, a).id}`,
                -1,
                3,
                -10,
                ...[
                  a.box.x,
                  a.box.y,
                  a.box.x + a.box.width,
                  a.box.y + a.box.height,
                ].map(round),
                -1,
                -1,
                -1,
                -1000,
                -1000,
                -1000,
                -10,
              ].join(" "),
            )
            .join("\n") + "\n",
      })),
      {
        path: "labelmap.json",
        text: json(
          Object.fromEntries(p.labels.map((l) => [`label_${l.id}`, l.name])),
        ),
      },
      {
        path: "dataset_meta.json",
        text: json({ labels: p.labels.map((l) => `label_${l.id}`) }),
      },
    ],
  },
  {
    id: "wider-face",
    name: "WIDER Face",
    extension: "TXT",
    description: "人脸检测数据集布局",
    supportsImages: true,
    group: "专用数据集",
    imagePath: (frame) =>
      `WIDER_default/images/0--default/${frameName(frame)}.jpg`,
    export: (p, options) => [
      {
        path: "wider_face_split/wider_face_default_bbx_gt.txt",
        text:
          grouped(p, options)
            .map(
              ([frame, items]) =>
                `0--default/${frameName(frame)}.jpg\n${items.length}\n${items.map((a) => [...[a.box.x, a.box.y, a.box.width, a.box.height].map(Math.round), 0, 0, 0, 0, 0, 0].join(" ")).join("\n")}`,
            )
            .join("\n") + "\n",
      },
    ],
  },
  {
    id: "icdar13",
    name: "ICDAR 2013",
    extension: "TXT",
    description: "文字定位 · 矩形",
    supportsImages: true,
    group: "专用数据集",
    imagePath: (frame) => `images/${frameName(frame)}.jpg`,
    export: (p, options) =>
      grouped(p, options).map(([frame, items]) => ({
        path: `annotations/gt_${frameName(frame)}.txt`,
        text:
          items
            .map(
              (a) =>
                `${Math.round(a.box.x)} ${Math.round(a.box.y)} ${Math.round(a.box.x + a.box.width)} ${Math.round(a.box.y + a.box.height)} "${labelOf(p, a).name.replace(/["\r\n]/g, " ")}"`,
            )
            .join("\n") + "\n",
      })),
  },
  {
    id: "icdar15",
    name: "ICDAR 2015",
    extension: "TXT",
    description: "文字定位 · 四角坐标",
    supportsImages: true,
    group: "专用数据集",
    export: (p, options) =>
      grouped(p, options).map(([frame, items]) => ({
        path: `annotations/gt_${frameName(frame)}.txt`,
        text:
          items
            .map((a) =>
              [
                ...[
                  a.box.x,
                  a.box.y,
                  a.box.x + a.box.width,
                  a.box.y,
                  a.box.x + a.box.width,
                  a.box.y + a.box.height,
                  a.box.x,
                  a.box.y + a.box.height,
                ].map(Math.round),
                labelOf(p, a).name.replace(/[\r\n]/g, " "),
              ].join(","),
            )
            .join("\n") + "\n",
      })),
  },
];
