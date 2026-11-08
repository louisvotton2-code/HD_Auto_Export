# HD Auto Export

面向海外客户的汽车出口网站，支持中文、英语和俄语。当前采用**一个 Git 仓库、按应用划分的 pnpm 工作区**。

**接手只从 [docs/README.md](docs/README.md) 开始。** Agent 先读 [AGENTS.md](AGENTS.md)，按用户分配的职责和任务找到自己的说明；当前能力与阶段结果看 [开发进度](docs/开发进度.md)。

## 目录与实际状态

| 位置 | 职责与状态 |
| --- | --- |
| `apps/web/` | 已迁移官网，仍为静态 Next 应用，19 条演示车源与参考计算器 |
| `apps/admin/` | 员工后台预留包；尚无页面、依赖或启动命令 |
| `apps/api/` | 独立 API、员工登录、PostgreSQL、车辆与图片发布；本地实现，待前后台联调 |
| `packages/contracts/` | public/admin schema、推导类型和隔离样例，供三端共同消费 |
| `packages/calculator-core/` | 纯计算包预留位置；现有核心仍在 web 内，待真实消费者需要时提取 |
| `product/` | 产品路线图、业务决定和选型 |
| `docs/` | 导航、阶段、角色任务、开发维护、日志和研究 |
| `deploy/` | 现有静态模板；多应用部署材料由 OPS 按阶段建立 |
| `scripts/` | 仓库级依赖边界检查；官网自己的工具在 `apps/web/scripts/` |

应用之间通过 API 协作，共用包只通过公共出口调用；各端独立依赖，全仓一份锁文件。后端运行与账号初始化见 [API 说明](apps/api/README.md)，前后台接入见[车辆接口](docs/开发/车辆接口.md)。员工后台和官网真实数据接入仍待各角色完成。

## 本地运行与检查

Node 版本建议见 [.nvmrc](.nvmrc)，pnpm 版本由根 `package.json` 固定。根目录不再是 Next 应用根。

```sh
pnpm install --frozen-lockfile
pnpm hooks:install
pnpm hooks:check
pnpm db:up
pnpm dev
pnpm check
pnpm build
pnpm preview --port 3100
pnpm test:e2e
```

`dev/preview/test:e2e` 仍面向官网；`dev:api` 启动后端。`check` 包含工作区、契约、API 单元/隔离 PostgreSQL 集成和官网检查；需 Docker 或明确的本机测试库。`build` 构建契约、API、OpenAPI 与官网，构建本身无需数据库。单独检查官网使用 `pnpm --filter @hd/web <命令>`。

官网开发入口通常是 `http://127.0.0.1:3000/zh/`，最新静态产物在 `apps/web/out/`；浏览器测试前先构建。不要复用旧根目录产物，不并发写同一应用的 `.next/`。

各端开工、测试、独立 review、阶段验收和交接记录见 [接手导航](docs/README.md) 与 [测试与审查](docs/协作/测试与审查.md)；Git 细则在 [.github/CONTRIBUTING.md](.github/CONTRIBUTING.md)。当前无新服务器部署，Git 推送与生产发布分别记录。

新 clone 不继承本机 Git hooks 配置；安装依赖的生命周期也可能跳过，因此开工须显式核验 hooks。当前仓库的安装器使用 Git 公共目录中的持久入口，linked worktree 共享配置，旧分支缺检查脚本时会拒绝推送。各端先自测并交独立 Reviewer，再按 [推送前检查](docs/协作/测试与审查.md#推送前检查) 生成绑定提交的验证和审查记录；`main` 通过 PR 与远端 `verify` 检查合入。
