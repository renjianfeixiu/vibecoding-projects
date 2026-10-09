# 如何参与帧序

先按 [README](README.md) 体验应用。开发前安装 Node.js ≥22.18，运行 `npm ci`、`npm start`；开发依赖由锁文件统一安装。当前重点是让矩形框视频标注闭环稳定易用，功能安排见 [迭代路线](docs/ROADMAP.md)。

## 一次改动的流程

1. 用 Issue 写清遇到的问题、复现步骤和验收条件。
2. 从最新 `main` 创建一个分支，例如 `codex/label-editor`。
3. 一次只完成一个可验收的问题；不要顺便重写不相关模块。
4. 运行 `npm test`、`npm run build`、`npm run format:check`、`npm run smoke`。首次运行离线验收需 `npx playwright install chromium --only-shell`，然后执行 `npm run smoke:portable`。提交同步生成的 `打开帧序.html`，CI 会核对它与源码一致；有界面改动时实际操作验证。
5. 创建 Pull Request，说明前后行为、验证结果和已知限制。
6. CI 通过后审阅合并；按版本整理 Release。

这是适合小项目的分支 → Pull Request → 检查 → 合并流程，参见 [GitHub flow 官方说明](https://docs.github.com/en/get-started/using-github/github-flow)。

## 修改算法时

- 保留人工标注、来源、确认/拒绝状态，不能静默覆盖人工框。
- 匹配分数不是准确率。真实效果需要独立视频和人工真值评估。
- 失败、取消、低质量结果必须有明确反馈；候选默认待确认。
- 通过插件接口接入引擎，详见 [PLUGINS](docs/PLUGINS.md)。

## 问题分类

类型、模块、优先级的建议表，以及版本与分支规则见 [GitHub 组织方式](docs/GITHUB_WORKFLOW.md)。不要为 Mac/Windows 创建两套长期源码分支。
