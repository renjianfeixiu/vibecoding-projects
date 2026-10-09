# 浏览器验收素材

`portable.webm` 是本项目已有的合成验收素材（320×180、约 3.47 秒、30 FPS、无音频），约 15 KB。仅用于验证离线网页导入本地视频、逐帧定位、标注帧率与 JPEG/ZIP 导出，不用于宣称跟踪准确率。

`scripts/smoke-portable.mjs` 使用它测试真实 WebM 解码；模板与光流的流程测试使用应用内置动画。运行后的截图、工程与导出 ZIP 位于被 Git 忽略的 `artifacts/portable-smoke`，不会作为运行依赖发布。
