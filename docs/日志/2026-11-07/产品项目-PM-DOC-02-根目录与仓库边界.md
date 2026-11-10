# 产品项目 / PM-DOC-02 / 根目录整理与仓库边界

日期：2026-11-07（Asia/Shanghai）
状态：待用户验收

## 范围与版本

- 用户要求继续整理根目录文档，并明确当前是否需要多个仓库。
- 当前分支 `codex/domain-https`，HEAD `06b1c4a`；工作树仍含既有未提交前端与上一轮文档改动。本轮未保存共同 Git 基线，未提交、推送或部署。
- 当前仍为 P1.17.3 静态 export，没有实施 G0 或新建后端／后台模块。

## 实际变更

- 根目录仅保留 README（项目说明与启动）和 AGENTS（Agent 入口）两份 Markdown。贡献规范移到 `.github/CONTRIBUTING.md`，入口、Skill 与历史文档中的可点击引用同步修复；没有保留重复正文。
- `.github` 是 GitHub 支持的贡献规范位置，保留平台发现能力；没有为整理文档移动 Next、TypeScript、pnpm 配置。[GitHub 官方说明](https://docs.github.com/en/communities/setting-up-your-project-for-healthy-contributions/setting-guidelines-for-repository-contributors)
- 旧 `二手车官网-开发交接包.zip` 从根目录原样移到 `docs/private/archives/`；未解压、未删除，移动前后 SHA-256 一致，原文件 37,457 字节。该附件原已被 Git 忽略，新位置仍忽略。
- 将单仓／多仓判断归入 [模块维护的仓库边界](../../开发/模块维护.md#仓库与目录边界)，在导航、路线图和实际架构中链接；没有另建一份架构方案。
- 当前沿用一个仓库、一个应用，按业务模块与职责分目录。以后先根据独立发布／进程／扩容需求评估同仓多应用；源码权限、独立产品或长期团队边界才构成进一步评估多仓的理由。未创建规划中的空模块或 `apps/` 目录。
- 核对当前 `pnpm-workspace.yaml` 只有安装配置，无多应用包声明；未来工具能力只参考 [pnpm 官方说明](https://pnpm.io/workspaces/)，未升级或改包管理设置。

## 验证与限制

- 独立只读审查确认单仓建议与现有路线图、后端任务及实际静态模式一致；没有执行模拟开发或测试。
- 37 份公开 Markdown 的 330 条本地引用、文内锚点、代码围栏与行尾空白检查通过；从接手导航可到达全部公开 docs 文档。范围包括迁移后的 `.github/CONTRIBUTING.md` 和项目 Skill。
- 官方 Skill `quick_validate.py` 与 `git diff --check` 通过。Skill 仅修复贡献规范路径，使用已有临时 PyYAML 验证依赖，未改项目依赖。
- 根目录 Markdown 实查仅剩 README、AGENTS；贡献规范对照迁移前副本，除相对链接外正文一致。AGENTS 的 Next 自动生成区块保持原样。
- 对照本轮修改前 207 个源码、资源、测试、脚本、部署模板、CI 与根配置文件的 SHA-256，全部一致。旧交接 ZIP 的大小、哈希、未跟踪及新位置忽略状态检查通过；没有改变忽略规则。
- 本轮没有运行构建、业务单元或浏览器测试；没有修改业务功能、依赖、运行配置或服务器。

## 交接

- 新 Agent 继续由 AGENTS → 接手导航 → 当前进度 → 本角色任务接手；开发与提交细则统一读取 `.github/CONTRIBUTING.md`。
- 后续产品开发仍从 G0／BE-01 开始；仓库数量不阻塞当前本地基础。各实施角色按任务分支和独立工作目录协作，再集成到同一主线。
