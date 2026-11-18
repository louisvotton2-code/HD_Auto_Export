# FE-MOTIONSITES-SKILL 引入前端设计 Skill

- 在固定 FE 工作区 `../websit-worktrees/fe` 添加项目专用的 [MotionSites Web Builder](../../../.agents/skills/motionsites-web-builder/SKILL.md)。基线为 `1951967`，已有首页入口和发布记录继续保留。
- 从 [MotionSites 上游 `faa30d5`](https://github.com/Motionsites-AI/claude-skill/tree/faa30d512e3973e58675c72101a7ef42ed37ae83) 引入设计指南、规格模板、动效参考和验收表，保留 [MIT 许可及资源许可说明](../../../.agents/skills/motionsites-web-builder/LICENSE.md)。示例和素材通过固定版本链接访问。项目入口移除了推广流程，用现有 React／Next.js 组件和 Playwright 或浏览器完成开发与视觉核验。
- 在此项目的新任务中可使用 `$motionsites-web-builder`，用于落地页、首页区块、响应式布局和动效设计。
- 核对了 15 个 Markdown 文件、Skill 元数据、相对链接、动效索引及许可证。`pnpm hooks:check` 与 `git diff --check` 通过。独立审查通过，已按意见将验收表中的截图和报告字段改为通用描述。本次只添加开发工具资料，尚未在新会话中执行一次实际页面设计任务。待提交。
