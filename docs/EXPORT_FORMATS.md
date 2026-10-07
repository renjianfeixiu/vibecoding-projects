# 导出格式矩阵 · 0.2

当前几何类型为原图像素坐标的矩形框。20 个适配器均生成实际格式文件；不用统一 JSON 冒充各软件格式。通用过滤排除拒绝帧，默认只导出确认结果。格式无法表达的轨迹/来源/审核信息保存在 `frameflow-manifest.json`。

| 格式                | 主文件 / 图片目录                                         | 坐标规则与范围                                                            |
| ------------------- | --------------------------------------------------------- | ------------------------------------------------------------------------- |
| COCO Detection      | annotations.json / images                                 | 原像素 x,y,w,h；0旋转矩形，不生成掩码                                     |
| Ultralytics YOLO    | labels/\*.txt、data.yaml / images                         | 0-based 类别索引；归一化中心/宽高                                         |
| Darknet YOLO        | obj.data、obj.names、train.txt / obj_train_data           | 同样的框规则，独立 Darknet 布局                                           |
| Pascal VOC          | Annotations/\*.xml / JPEGImages                           | 1-based 左上角；右下角向外取整                                            |
| Datumaro            | annotations/default.json / images/default                 | dm_format_version 1.0；0-based 类别、bbox 像素 x,y,w,h                    |
| Apple Create ML     | annotations.json / images                                 | 像素中心 x,y、宽高                                                        |
| Open Images V6      | annotations/default-annotations-bbox.csv / images/default | 归一化 xmin,xmax,ymin,ymax；含自定义类别映射和 images.meta                |
| KITTI Detection     | training/label_2/\*.txt / training/image_2                | 2D 像素边界；类别 token=label_ID，映射在 labelmap.json；3D 字段为未标注值 |
| CVAT for images 1.1 | annotations.xml / images                                  | 图像 image 节点；每帧矩形框                                               |
| CVAT for video 1.1  | annotations.xml / images                                  | track、0-based 帧；稀疏段含 outside=1，避免 CVAT 自动跨空白插值           |
| LabelMe JSON        | annotations/\*.json / images                              | rectangle 两角坐标；imagePath 相对 JSON 位置                              |
| LabelMe XML         | Annotations/default/\*.xml / Images/default               | MIT LabelMe；矩形转四角 polygon，type=bounding_box                        |
| VGG Image Annotator | via_region_data.json / 根目录帧图像                       | VIA 2 rect shape；label、track_id 区域属性                                |
| Label Studio        | tasks.json、labeling_config.xml / images                  | RectangleLabels 百分比坐标、original_width/height；图像路径需配置本地存储 |
| MOTChallenge        | gt/gt.txt、seqinfo.ini / img1                             | 1-based 帧和左上角、像素宽高；9列 ground truth                            |
| WIDER Face          | wider_face_split/\*.txt / WIDER_default/images/0--default | 整数 x,y,w,h；用于人脸任务，其他属性为默认0，原类别留在清单               |
| ICDAR 2013          | annotations/gt\_\*.txt / images                           | 四个矩形边界整数；类别名用作文本转录                                      |
| ICDAR 2015          | annotations/gt\_\*.txt / images                           | 八个四角坐标整数；类别名用作文本转录                                      |
| CSV                 | annotations.csv / images                                  | 0-based 帧、原像素坐标、轨迹、来源、审核及相关性                          |
| FrameFlow           | project.frameflow.json / images（可选）                   | 完整工程、所有来源/审核状态；不应用导出筛选                               |

## 使用约定

首步可直接选择全部 20 种帧序导出的 ZIP，配对原视频/图像后点击「浏览标注」，播放器叠加实际导出的帧和框。清单保留原始像素坐标、帧号、轨迹及来源；工程格式额外保留所有状态。可先选标注再选素材，无需解压。

第三方文件或删除清单后的 ZIP，原生解析仅支持 COCO、CVAT XML、YOLO / Darknet、VOC、LabelMe JSON、MOT、FrameFlow CSV。YOLO 标签可多选，附带 classes.txt / obj.names 读取类别名。无轨迹 ID 的图像框独立保存，不自动推断目标身份。原生 CVAT 稀疏轨迹按线性关键帧规则展开；这不是光流估计。

独立帧文件名 frame_000000 或纯数字按从 0 开始的标注帧号解释；COCO 无可读帧号时按 images 顺序配对。MOT 自身 1 起始帧号会换算。FrameFlow 清单带标注帧率与原视频帧率；其他文件须先确认该标注文件的帧率，并在第一步设置匹配的帧切分后再进入工作台。帧序 CSV 保留已携带的来源、审核和分数。原生格式无来源/审核字段时，作为已确认的可编辑框放入人工栏目，不表示已验证其生成方式或正确率。

- YOLO 的 train/val 路径是启动模板，训练前须划分独立训练/验证数据。
- 图片必须和格式内引用路径、原尺寸匹配。打包上限为1000帧及6亿总像素；超限可仅导出标注。
- 所有格式使用任务标注帧率，帧号连续从 0 编号。原视频 60 帧/秒、标注 20 帧/秒时，标注帧 0、1、2 对应原帧 0、3、6；MOT 写入 20 帧/秒、CSV 时间戳按 20 帧/秒换算。非整除比例逐帧计算原帧索引，不用一个取整步长累积时间误差。回导清单后沿用同一映射，不再次采样。
- 第四步生成的有效审查报告作为 `audit-report.json` 随 ZIP 附带，不改变标准格式字段。报告检查完整工程，标注主体仍按确认状态筛选；修改标注后旧报告不会附入新 ZIP。未运行或跳过审查时无需报告即可导出；回导标注目前不恢复报告处理状态。
- 没有遮挡/截断/可见性专门属性工具，Open Images、VOC、MOT、WIDER 等相关属性当前是默认值，不是模型判断。MOT 类别 ID 为工程 ID，自定义类别与默认基准类别可能需目标工具映射。
- KITTI 三维与姿态字段使用官方未标注占位值，不把二维框伪装成三维数据。
- 专用数据集格式需要匹配目标任务的语义：ICDAR 适用于类别名就是所需转录内容的文字任务，WIDER 用于人脸。
- Label Studio 本地存储的路径访问需在其服务中配置。导入前使用随附配置 XML，让 from_name/to_name 与输出一致。
- COCO Segmentation/Keypoints、YOLO Seg/Pose/OBB、Cityscapes、CamVid、MOTS、Mask PNG 等在对应真实几何工具实现后加入。Market-1501/VGGFace2 还需要身份/相机属性和裁剪资产管理。
- 当前验收到实际 ZIP、字段、坐标、JSON/XML 解析与图片配对。未把每个外部软件/训练器安装后全部往返导入，不能据此保证任意版本无需适配。

## 官方参考

- [CVAT 格式矩阵](https://docs.cvat.ai/docs/dataset_management/formats/)
- [Datumaro 格式规范](https://open-edge-platform.github.io/datumaro/stable/docs/data-formats/datumaro_format.html)
- [Datumaro 格式目录](https://open-edge-platform.github.io/datumaro/stable/docs/data-formats/formats/)
- [LabelMe JSON 样例](https://github.com/wkentaro/labelme/blob/main/examples/primitives/primitives.json)
- [VIA 官方资料](https://www.robots.ox.ac.uk/~vgg/software/via/)
- [Label Studio 导出](https://labelstud.io/guide/export)
- [Apple Create ML 数据源](https://developer.apple.com/documentation/createml/building-an-object-detector-data-source)
