# 贡献者入口

从 [接手导航](../docs/README.md) 选择角色，按 [开发与发布流程](../docs/README.md) 工作。具体测试范围、独立审查报告及推送命令只在 [测试与审查](../docs/协作/测试与审查.md) 维护。

使用仓库 `.nvmrc`、项目 pnpm 版本和共同锁文件。提交前核对实际变更和暂存范围：

```sh
git status --short
git diff --check
git diff --cached --stat
git diff --cached --check
```

本地运行见 [项目 README](../README.md)，生产配置及预检见 [运行手册](../deploy/runtime/README.md)。
