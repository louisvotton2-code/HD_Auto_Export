# 共享接口契约 Agent 入口

继承根 [AGENTS](../../AGENTS.md) 和项目 Skill。通过 [接手导航](../../docs/README.md) 读取当前进度及 [后端任务](../../docs/协作/后端.md)，本目录状态与下一步见 [README](README.md)。

只执行用户分配任务；不得跨应用引用内部源码。公共出口分为 `@hd/contracts/public`、`@hd/contracts/admin` 与 `@hd/contracts/fixtures`；根出口只提供公共基础类型。具体能力与命令见本目录 README，实际验证状态见后端角色进度及本轮日志。
