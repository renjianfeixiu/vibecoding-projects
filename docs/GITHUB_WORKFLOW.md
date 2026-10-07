# GitHub 如何分类和管理这个项目

更新：2026-10-07。当前 `vibecoding-projects` 的主分支直接放帧序源码，没有复制成 Mac/Windows 两套目录。

## 几个概念分别解决什么问题

| GitHub 概念   | 通俗解释                     | 帧序怎么用                                                 |
| ------------- | ---------------------------- | ---------------------------------------------------------- |
| Repository    | 一个产品的代码和资料放在哪里 | 当前仓库承载帧序；如果以后做多个独立产品，建议各自一个仓库 |
| Issue         | 要解决的一个具体问题         | 一项缺陷或功能，一个可验证结果                             |
| Label         | 问题属于什么类型             | 区分类型、模块和优先级                                     |
| Milestone     | 哪些任务组成一个版本         | v0.5、v0.6、v0.7 的完成目标                                |
| Project       | 工作进行到了哪里             | Backlog → Ready → Doing → Review → Done                    |
| Branch        | 正在修改的独立工作空间       | 从 main 创建 codex/具体任务名                              |
| Pull Request  | 合并前检查一组改动           | 说明行为变化、检查结果和限制                               |
| Tag / Release | 哪个版本可以固定下载         | 每个经过验证的版本有标签、发布说明和已知问题               |

官方依据：[标签](https://docs.github.com/en/issues/using-labels-and-milestones-to-track-work/managing-labels)、[里程碑](https://docs.github.com/en/issues/using-labels-and-milestones-to-track-work/about-milestones)、[Release](https://docs.github.com/en/repositories/releasing-projects-on-github/about-releases)。

## 标签用三组就够

| 维度   | 建议标签                                                                           | 规则                                                    |
| ------ | ---------------------------------------------------------------------------------- | ------------------------------------------------------- |
| 类型   | bug / enhancement / documentation / question                                       | 每个 Issue 选择一个主要类型                             |
| 模块   | area:annotation / area:ai / area:data / area:export / area:quality / area:platform | 按受影响功能选择，不按“是人写的还是 AI 写的”分类        |
| 优先级 | priority:0 / priority:1 / priority:2                                               | 0：数据丢失或无法继续；1：下一版本核心任务；2：后续增强 |

Issue 示例：“第二步不能重命名类别”属于 `enhancement`、`area:annotation`、`priority:1`。若现有重命名功能把框删除了，则应记为 `bug`、`priority:0`。

本次已加入问题/功能模板和 PR 模板。模块与优先级标签、里程碑和 Project 看板是组织建议，尚未在 GitHub 中批量创建；等开始按任务开发时再建立，避免先维护一大堆空分类。

## 文件放在哪里

```text
src/
  core/          类别、轨迹、标注、帧号等数据规则
  media/         素材和帧读取
  plugins/       辅助、补帧、导入、导出、审查适配器
  components/    界面
  hooks/         工程状态、撤销重做和保存
scripts/         跨系统测试入口
tests/          行为与格式回归检查
docs/           产品、格式、插件、验收和路线图
.github/
  workflows/     自动安装、测试和构建
  ISSUE_TEMPLATE/ 问题与功能反馈模板
```

平台只在入口处分开：`启动帧序.command` 给 Mac，`启动帧序.cmd` 给 Windows。真正的应用源码、数据格式和模型接口共用。以后需要 `.app` / `.exe` 安装包时，再用同一源码生成不同平台产物。

## 分支与发布的简单规则

- `main`：能运行、检查通过的代码。不要把未验收的大改动当作稳定版本。
- `codex/label-editor` 这类短期分支：一次只解决一个问题；合并后可以删除。
- 不建立长期 `mac` / `windows` 分支，否则每次修复都要维护两份，容易不同步。
- `v0.4.0-demo` 这类标签固定一个发布快照；Demo 标成预发布，成熟后再发稳定版。
- 版本发布说明回答三件事：改了什么、怎样验证、还有什么限制。
- 需要撤销已合并代码时优先 `git revert`，保留可追溯的历史。

适合目前体量的是 [GitHub flow](https://docs.github.com/en/get-started/using-github/github-flow)。无需同时维护 develop、release、hotfix 等一整套长期分支。

## 已有本地目录如何接上 GitHub

本次只发布已验收快照，没有修改主会话正在开发的本地仓库。该本地仓库与原 GitHub 仓库起初有不同的提交历史；不要直接添加远端后强制推送覆盖本次发布。

开始下一轮远程协作时，推荐按 README 重新克隆一个目录，从 GitHub 的 main 创建功能分支。若要同步旧本地目录中的新修改，只转移相应代码差异，在新克隆目录运行检查并提交 PR，保留已有启动脚本、CI 和规划文档。

## 每次迭代的操作顺序

1. 从 [路线图](ROADMAP.md) 中选一个任务，创建 Issue 并写验收条件。
2. 准备小样例或复现步骤；涉及真实效果时准备独立验证数据。
3. 从最新 main 创建分支，让 AI 阅读代码、说明影响，再实现。
4. 看代码差异，运行测试/构建，实际完成用户流程。
5. 创建 PR；CI 全绿且操作验收通过后合并。
6. 一组相关任务完成后创建 Release，记录当前源码和验证结果。

现在就从“第二步类别编辑”开始。完成后再推进“全部目标/当前类别/当前目标的 AI 生成范围”，对应验证多个类别和多个目标，避免把“类别”与“某个具体目标”混淆。

## 多个 Vibe coding 项目怎么摆

推荐一产品一仓库：帧序、其他工具各自有 README、依赖、Issue、Release。`vibecoding-projects` 如果未来变成作品集，可以只保留一个索引 README，链接到各个产品仓库；当前先继续用现有地址，避免本次发布额外迁移。

只有多个应用确实共享代码和发布流程时，再考虑 monorepo，例如 `apps/frameflow`、`packages/shared`。暂时不要为了分类而增加目录和构建复杂度。
