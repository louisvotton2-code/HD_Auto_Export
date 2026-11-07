# HD Auto Export

面向海外客户的汽车出口网站，支持中文、英语和俄语。当前采用**一个 Git 仓库、按应用划分的 pnpm 工作区**。

**接手只从 [docs/README.md](docs/README.md) 开始。** Agent 先读 [AGENTS.md](AGENTS.md)，按用户分配的职责和任务找到自己的说明；当前能力与阶段结果看 [开发进度](docs/开发进度.md)。

## 目录与实际状态

| 位置 | 职责与状态 |
| --- | --- |
| `apps/web/` | 已迁移官网，仍为静态 Next 应用，19 条演示车源与参考计算器 |
| `apps/admin/` | 员工后台预留包；尚无页面、依赖或启动命令 |
| `apps/api/` | 独立后端预留包；尚无 API、鉴权或数据库 |
| `packages/contracts/` | 接口契约预留包，等待 BE-01 落码 |
| `packages/calculator-core/` | 纯计算包预留位置；现有核心仍在 web 内，待真实消费者需要时提取 |
| `product/` | 产品路线图、业务决定和选型 |
| `docs/` | 导航、阶段、角色任务、开发维护、日志和研究 |
| `deploy/` | 现有静态模板；多应用部署材料由 OPS 按阶段建立 |
| `scripts/` | 仓库级依赖边界检查；官网自己的工具在 `apps/web/scripts/` |

应用之间通过 API 协作，共用包只通过公共出口调用；各端独立依赖，全仓一份锁文件。目录建立不等于后台和 API 已实现。

## 本地运行与检查

Node 版本建议见 [.nvmrc](.nvmrc)，pnpm 版本由根 `package.json` 固定。根目录不再是 Next 应用根。

```sh
pnpm install --frozen-lockfile
pnpm dev
pnpm check
pnpm build
pnpm preview --port 3100
pnpm test:e2e
```

`dev/build/preview/test/typecheck/test:e2e` 默认转发官网；`pnpm check` 先检查工作区依赖边界，再检查官网。也可用 `pnpm --filter @hd/web <命令>`。其他包尚无对应运行命令，不将跳过的包记为已验证功能。

官网开发入口通常是 `http://127.0.0.1:3000/zh/`，最新静态产物在 `apps/web/out/`；浏览器测试前先构建。不要复用旧根目录产物，不并发写同一应用的 `.next/`。

各端开工、测试、独立 review、阶段验收和交接记录见 [接手导航](docs/README.md) 与 [测试与审查](docs/协作/测试与审查.md)；Git 细则在 [.github/CONTRIBUTING.md](.github/CONTRIBUTING.md)。当前无新服务器部署，Git 推送与生产发布分别记录。
