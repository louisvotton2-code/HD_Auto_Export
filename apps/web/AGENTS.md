# 官网 Agent 入口

先读仓库根 [AGENTS](../../AGENTS.md)、[接手导航](../../docs/README.md) 和 [前端任务](../../docs/协作/前端.md)。本目录是 `@hd/web`，其 `src/`、`public/`、`tests/`、`scripts/` 均相对此应用。

当前FE-01已迁Node／standalone；首页、目录与动态详情通过独立API和公共契约获取数据，不导入其他应用源码。保留原视觉和纯计算边界；对外使用正式车源与服务文案，不输出demo／第三方／未知库存治理提示，内部source与unknown保持真实，未知事实不造零；具体本轮验证见FE角色日志。统一检查从仓库根执行 `pnpm check`，本应用检查用 `pnpm --filter @hd/web check`。具体运行见 [README](README.md)。

<!-- BEGIN:nextjs-agent-rules -->

## This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
