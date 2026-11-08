# 业务 API

BE-01/02 本地实现：独立 Fastify 服务、PostgreSQL、员工登录、车辆草稿与发布、媒体、首页配置及多语言内容。管理列表支持关键词与品牌/车型/动力/状态组合筛选，具体参数见唯一接口文档。实际验证和未覆盖项见[后端进度](../../docs/协作/后端.md)。官网和员工后台已通过 HTTP 消费 API，上一轮本地技术联调已完成，公开车型样例明确非库存；本轮增量及最终用户验收另行记录，不代表生产上线。

BE-INT-02 已增加最多50条的库存/下架批量接口与后台全库存品牌车型选项。`source.kind=demo` 明确表示非库存，保存未知库存/空核验时间/待询价及无实车事实；允许当前版本的三语待审内容展示，但公开始终 `reviewed=false`。真实 manual 的发布/审核门槛不变。前后台以[车辆接口第9节](../../docs/开发/车辆接口.md#9-be-int-02-三端接入增量)接入；批量200须逐行检查结果，不可只按HTTP状态标记全部成功。

BE-INT-03 增加车辆回收站／恢复、人工外部挂牌、公开关键词查询及固定240px缩略图。删除与首页清理同事务，恢复为未发布且未核验的草稿；媒体和不可变发布历史保留。具体接口、幂等历史回执与消费者接法见[车辆接口第10节](../../docs/开发/车辆接口.md)。本轮实现与验证状态以角色日志为准，运行中的3320是否升级须单独核对。

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

`.env`、媒体 `.data/`、数据库卷、编译产物和生成接口资料均不提交。`MEDIA_ROOT` 是专用私有持久化目录，目录权限 0700、文件 0600。`MEDIA_DELIVERY=direct`（默认）由 API 发图；首期服务器使用显式 `nginx` 模式，API 授权后给固定内部跳转，由同 UID、只读挂载的 Nginx 发图。目录不能无条件公开；部署协议见[车辆接口第12节](../../docs/开发/车辆接口.md)。只保存经处理的展示图，原始上传内容不长期存盘；对象存储随实际规模后续接入。

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

- 开发后台默认 `http://127.0.0.1:3318`，代理 `/api` 到 API 3320，统一使用 `127.0.0.1`，不混用 localhost。官网 SSR 通过内部 HTTP 地址访问公开接口，浏览器查询与媒体通过官网同源代理读取。
- `AUTH_BASE_URL` 填后台可见 origin，不含 `/admin`；`TRUSTED_ORIGINS` 是精确 origin 列表。生产 HTTPS、host-only Cookie、`/api` 路径、HttpOnly、SameSite=Lax；只有生产启用 Secure。管理写入必须带可信 Origin。
- 默认 `TRUST_PROXY=false`，不信任转发头；本机代理可用 `loopback`。受控 Compose 代理应固定代理 IP 并填写如 `TRUST_PROXY=172.29.0.2/32`（仅示例，须与实际网络一致），也接受逗号分隔的明确 IPv4/IPv6 地址或 CIDR。网段限 IPv4 `/24`–`/32`、IPv6 `/64`–`/128`，优先单地址 `/32` 或 `/128`；整网段仅限代理专用、没有不可信容器的网络。拒绝全网、跳数、主机名、其他别名、IPv6 zone 与 IPv4 映射 IPv6 配置（映射地址请写对应 IPv4）。API 不映射宿主公开端口，Nginx 必须覆盖客户端传入的 `X-Forwarded-*`，不得直接追加不可信链。Better Auth 的限流身份只使用 Fastify 校验后的客户端 IP，不采纳调用者提供的内部 IP 头。跨域 CORS 默认关闭。代理配置能力参见 [Fastify 官方说明](https://fastify.dev/docs/latest/Reference/Server/#trustproxy)，本地运行及恢复验证由 OPS 另记。
- 存活检查 `/health/live`；就绪检查 `/health/ready` 检查数据库及迁移后的必要表。接口、登录和图片响应均 no-store；错误只含稳定 code、字段路径及 requestId，不暴露堆栈或连接信息。
- BE-INT-03分桶增量：公开JSON、公开媒体、管理业务、健康检查各按已校验来源IP限制120次／60秒，鉴权路由30次／60秒保持。健康检查不再消耗业务桶，原图／thumb及不同媒体ID共用媒体桶；429保留真实Retry-After。完整可信访客协议见[车辆接口第11节](../../docs/开发/车辆接口.md)：入口覆盖X-HD-Visitor-IP，Web在服务端开关启用且入口封闭时构造单值X-Forwarded-For，API仅信任固定proxy/Web地址。实际3320是否已启用以BE增量日志为准，不在启动脚本中自动扩大信任范围。
- `pnpm --filter @hd/api media:cleanup` 每次处理最多 100 个过期且无引用的上传对象，并清理到期幂等记录。上传许可保留 30 分钟，完成处理后未绑定图片保留 24 小时；已发布历史或草稿引用不会被删除；车辆回收站内的媒体全部保留。恢复车辆不会延长已过期上传许可或无引用媒体保留期。命令可重复执行，可靠调度、对象存储、备份恢复及监控告警待 BE-03。
- 人工录入的外部挂牌使用 `source.kind=external`，来源、时间与每图证据按车辆接口第10节保存；不是自有库存，当前不宣称人审。第三方自动适配、自动翻译及 AI 工具仍未接入。人工修改通过草稿和发布流程生效。

停止服务使用该进程的正常退出信号；不要停止其他角色的进程。真实库存、服务器、外部 API 及翻译服务须分别提供资料并按对应阶段验证。

本机后台验收环境与日常开发库分开。当前入口、专属库/媒体、账号、启动/停止方法只登记在未提交的 `docs/private/本地联调访问.md`（仓库根相对路径，权限 600）；不要据此另建或重置数据库，也不要把私有内容粘贴进公共日志。
