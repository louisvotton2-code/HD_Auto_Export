# HD Auto Export

面向海外客户的汽车出口网站，支持中文、英语和俄语。当前采用**一个 Git 仓库、按应用划分的 pnpm 工作区**。

**接手只从 [docs/README.md](docs/README.md) 开始。** Agent 的 [AGENTS.md](AGENTS.md) 也指向同一入口；按用户分配的职责和任务找到自己的说明，当前能力与阶段结果看 [开发进度](docs/开发进度.md)。

生产官网为 [hongdingauto.com](https://hongdingauto.com/)，www 保留路径跳转到主域名。员工使用[管理后台](https://admin.hongdingauto.com/)。

## 目录与实际状态

| 位置 | 职责与状态 |
| --- | --- |
| `apps/web/` | Next Node／standalone 官网，消费公开 API；参考计算器与购车指南保留，验收状态见 FE 摘要 |
| `apps/admin/` | 独立 React/Vite 员工后台；登录、车辆管理及当前联调范围见 AD 摘要 |
| `apps/api/` | 独立 API、员工登录、PostgreSQL、车辆与图片发布；提供官网与后台公共契约 |
| `packages/contracts/` | public/admin schema、推导类型和隔离样例，供三端共同消费 |
| `packages/calculator-core/` | 纯计算包预留位置；现有核心仍在 web 内，待真实消费者需要时提取 |
| `product/` | 产品路线图、业务决定和选型 |
| `docs/` | 导航、阶段、角色任务、开发维护、日志和研究 |
| `deploy/` | `runtime/` 为当前多应用运行材料；根静态模板保留历史用途 |
| `scripts/` | 仓库级依赖边界检查；官网自己的工具在 `apps/web/scripts/` |

应用之间通过 API 协作，共用包只通过公共出口调用；各端独立依赖，全仓一份锁文件。后端运行与账号初始化见 [API 说明](apps/api/README.md)，前后台接入见[车辆接口](docs/开发/车辆接口.md)，官网运行见 [Web 说明](apps/web/README.md)。本轮三端联调与用户验收状态看角色记录。后台启动与检查见 [AD 说明](apps/admin/README.md)。

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

`dev/preview` 面向官网；`dev:api` 启动后端，`dev:admin` 启动后台。`check` 包含工作区、契约、API 单元/隔离 PostgreSQL 集成、后台和官网检查；需 Docker 或明确的本机测试库。`build` 构建契约、API、OpenAPI、后台与官网，构建本身无需数据库。`test:e2e` 依次跑官网和后台界面场景，真实后台/API联调另执行 AD 的 `test:e2e:live`。单独检查官网使用 `pnpm --filter @hd/web <命令>`。

根 `pnpm dev` 与 `pnpm dev:web` 均使用官网内部端口 3317，后台 3318、API 3320 同样仅供内部开发。用户验收统一通过 `http://127.0.0.1:3363`，由同源代理连接对应服务；实际接线和版本须核验。官网构建产物为完整 `apps/web/.next/standalone/`，入口为 `apps/web/.next/standalone/apps/web/server.js`；应用构建脚本已复制 public／静态资源，preview 启动该 Node 成品。浏览器测试前先构建，不再以旧 `out/` 验收；不并发写同一应用的 `.next/`。接口地址等环境变量按 Web README 配置，实际保留运行地址见当前进度。

日常协作、验收、版本和上线顺序见[开发与发布流程](docs/README.md)。测试范围与 Git 门禁命令见[测试与审查](docs/协作/测试与审查.md)，实际部署状态看[开发进度](docs/开发进度.md)。
