# 业务 API

BE-01/02 本地实现：独立 Fastify 服务、PostgreSQL、员工登录、车辆草稿与发布、媒体、首页配置及多语言内容。实际验证和未覆盖项见[后端进度](../../docs/协作/后端.md)。官网仍使用演示数据，员工后台尚未初始化；服务完成不等于两端已联调或已上线。

架构见[后端架构](../../docs/开发/后端架构.md)，接口唯一说明见[车辆接口](../../docs/开发/车辆接口.md)，公共 schema 与样例见 [contracts](../../packages/contracts/README.md)。

## 本地启动

使用根 `.nvmrc` 指定的 Node 24.19.0 与 pnpm 11.25.0，Docker Desktop 需运行。以下从仓库根执行：

```sh
pnpm install --frozen-lockfile
pnpm hooks:check
pnpm db:up
cp apps/api/.env.example apps/api/.env
# 将 .env 中 AUTH_SECRET 替换为本机随机值；可用 openssl rand -hex 32 生成。
pnpm --filter @hd/contracts build
pnpm --filter @hd/api db:migrate
pnpm dev:api
```

本地 API 为 `http://127.0.0.1:3320`。数据库只绑定本机 55432，默认连接池 5；迁移使用独立连接，总上限仍须计入同机预算。Compose 的固定密码仅用于隔离本地开发，不能作为生产密码。`pnpm db:down` 保留卷；不要用删除卷命令处理真实数据。

`.env`、媒体 `.data/`、数据库卷、编译产物和生成接口资料均不提交。`MEDIA_ROOT` 是 API 专用私有目录，目录权限 0700、文件 0600，不能给静态服务器直接暴露。服务只保存经处理的展示图；原始上传内容不长期存盘，原图保留和生产对象存储待 BE-03。

## 员工账号

不开放注册、模拟身份或删除员工的 HTTP 入口。账号由具有本地运维权限的人员使用受控命令建立，密码从标准输入读取，至少 12 字符，不放在命令参数或版本库中。例如在 zsh：

```sh
read -s 'HD_STAFF_PASSWORD?New staff password: '
printf '%s' "$HD_STAFF_PASSWORD" | pnpm --filter @hd/api staff create editor@example.invalid '测试编辑员' editor
unset HD_STAFF_PASSWORD
pnpm --filter @hd/api staff disable editor@example.invalid
pnpm --filter @hd/api staff enable editor@example.invalid
```

实际邮箱和姓名由管理员提供；示例地址不发送邮件。创建管理员时最后一个参数为 `admin`。启用/禁用均撤销旧会话；启用后须重新登录。后台通过 Better Auth 客户端或同一 HTTP 协议登录，不能自建 token。

## 构建、检查与迁移

```sh
pnpm --filter @hd/contracts check
pnpm --filter @hd/api check
pnpm --filter @hd/api test:integration
pnpm --filter @hd/api build
pnpm --filter @hd/api openapi
pnpm --filter @hd/api start
```

集成测试连接本机专用 PostgreSQL，创建随机 `hd_api_test_*` 数据库，结束后删除该测试库。默认维护连接是本地 Compose 的 `/postgres`；可用 `API_TEST_DATABASE_URL` 指向另一个本机测试实例。脚本拒绝非本机地址和非 `/postgres` 维护库，不接收生产库作为测试目标。

迁移位于 `migrations/`，SQL 是数据库结构的维护入口；Better Auth 的 Drizzle 映射在 `src/db/schema.ts`。通过 Drizzle migrator 和 advisory lock 显式应用已审 SQL，不在应用启动或构建时改库。不要对已有环境使用 schema push，也不要修改已发布迁移；下一变更追加 SQL 与 journal。生产应分别配置迁移身份和最小权限运行身份，本地 Compose 不代表生产权限验证。

OpenAPI 由路由使用的 schema 生成到 `openapi/public.json` 和 `openapi/admin.json`，生成不需要数据库在线。二进制图片及原生登录协议另见车辆接口说明。生成产物可交给 FE/AD 导入工具，但不手工维护。根 `pnpm check` 已包含后端集成测试，先启动本地数据库；CI 使用隔离 PostgreSQL 服务。根 `pnpm build` 构建契约、API、OpenAPI 和官网。

## 运行边界

- 开发后台默认 `http://127.0.0.1:3318`，代理 `/api` 到 API 3320，统一使用 `127.0.0.1`，不混用 localhost。官网 SSR 未来通过内部 HTTP 地址访问公开接口。
- `AUTH_BASE_URL` 填后台可见 origin，不含 `/admin`；`TRUSTED_ORIGINS` 是精确 origin 列表。生产 HTTPS、host-only Cookie、`/api` 路径、HttpOnly、SameSite=Lax；只有生产启用 Secure。管理写入必须带可信 Origin。
- 默认不信任转发头。需要本机反向代理时显式设置 `TRUST_PROXY=loopback`；Better Auth 的限流身份只使用 Fastify 校验后的客户端 IP，不采纳调用者提供的内部 IP 头。跨域 CORS 默认关闭。
- 存活检查 `/health/live`；就绪检查 `/health/ready` 检查数据库及迁移后的必要表。接口、登录和图片响应均 no-store；错误只含稳定 code、字段路径及 requestId，不暴露堆栈或连接信息。
- `pnpm --filter @hd/api media:cleanup` 每次处理最多 100 个过期且无引用的上传对象，并清理到期幂等记录。上传许可保留 30 分钟，完成处理后未绑定图片保留 24 小时；已发布历史或草稿引用不会被删除。命令可重复执行，可靠调度、对象存储、备份恢复及监控告警待 BE-03。
- 三方、自动翻译及 AI 工具尚未接入。多语言原文、译文和审核版本已落码；人工修改通过草稿和发布流程生效。

停止服务使用该进程的正常退出信号；不要停止其他角色的进程。真实库存、服务器、外部 API 及翻译服务须分别提供资料并按对应阶段验证。
