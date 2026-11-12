# 业务 API

BE-01/02 本地实现：独立 Fastify 服务、PostgreSQL、员工登录、车辆草稿与发布、媒体、首页配置及多语言内容。管理列表支持关键词与品牌/车型/动力/状态组合筛选，具体参数见唯一接口文档。实际验证和未覆盖项见[后端进度](../../docs/协作/后端.md)。官网和员工后台已通过 HTTP 消费 API，上一轮本地技术联调已完成，公开车型样例明确非库存；本轮增量及最终用户验收另行记录，不代表生产上线。

BE-INT-02 已增加最多50条的库存/下架批量接口与后台全库存品牌车型选项。`source.kind=demo` 明确表示非库存，保存未知库存/空核验时间/待询价及无实车事实；允许当前版本的三语待审内容展示，但公开始终 `reviewed=false`。真实 manual 的发布/审核门槛不变。前后台以[车辆接口第9节](../../docs/开发/车辆接口.md#9-be-int-02-三端接入增量)接入；批量200须逐行检查结果，不可只按HTTP状态标记全部成功。

BE-INT-03 增加车辆回收站／恢复、人工外部挂牌、公开关键词查询及固定240px缩略图。删除与首页清理同事务，恢复为未发布且未核验的草稿；媒体和不可变发布历史保留。具体接口、幂等历史回执与消费者接法见[车辆接口第10节](../../docs/开发/车辆接口.md)。本轮实现与验证状态以角色日志为准，运行中的3320是否升级须单独核对。

BE-I18N-01 已实现员工触发的中文源→英俄译文建议，保持已保存草稿及人工审核不变。用户后续选择使用现有阿里通用版国际站额度；服务端显式选择 `TRANSLATION_PROVIDER=aliyun`、`ALI_MT_REGION=ap-southeast-1`，仅调用固定新加坡HTTPS接入点。region另允许 `cn-hangzhou`，并保留其兼容默认值；不接受自定义阿里URL，不自动回退或切换站点。实际账号开通／权限／计费须按国际站核对，不能套用中国站免费额度。源码默认仍 disabled，密钥仅服务端；本地LibreTranslate适配保留但不能当作本轮业务质量已通过。配置与接口见[车辆接口第13节](../../docs/开发/车辆接口.md#13-be-i18n-01-单车译文建议与发布差异)，真实调用与联调按运行日志核对，不将HTTP stub当作服务成功。

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

后台可用完整邮箱或 1–32 位短账号登录。短账号由小写字母、数字、下划线和连字符组成，首位须为字母或数字；系统将它映射到保留的 `staff.hd-auto.invalid` 邮箱域。邮箱和短账号都可用于 `staff create`、`enable` 和 `disable`。创建管理员时最后一个参数为 `admin`。启用或禁用都会撤销旧会话。

使用 `staff change-login <原账号或邮箱> <新账号或邮箱>` 改登录名和密码，密码同样从标准输入读取。原员工 ID、姓名和角色保留，改密成功会撤销该员工的既有会话。更改环境账号前先核对目标数据库，部署代码与账号变更分别执行。

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

BE-ADUX10 增加迁移 0014：员工车辆公开草稿版本与按员工保存的十分钟预览确认。先备份并显式应用迁移，再切换 API；新版就绪检查要求该列／表存在。草稿 asking 金额和采购成本可空，发布时仍须完整业务资料、三语就绪及当前预览确认。BE-UX11 已用当前三语完整／非 stale 替代旧逐字段 approved 门槛，真实 machine/pending 不变。GET `publish-readiness`／`publication-preview` 与 POST `publication-preview/confirm` 的精确 schema、iframe 协议及 source 区别见[车辆接口第17节](../../docs/开发/车辆接口.md#17-be-adux10-发布检查与私有预览)。API 与 AD／FE 必须配套升级；旧成功发布回执可重放，新发布请求不能绕过确认。旧公开快照不会被迁移改写。

BE-UX11 追加迁移 0015（员工确认的翻译计划／分段结果）与 0016（离线检测补充／内部报告证据）。迁移必须显式执行；ready 检查对应表，不能只换 API 后仍接旧 schema。配置 JSON 原样输入先严格校验，再存规范对象；统一工作区同时保存正文和展示译文。先创建无外呼的计划，再明确费用与范围后执行，生成建议不会自动修改草稿；断线后只读 GET 恢复，不自动重试可能已收费的请求。旧 suggestion 新请求返回 422，历史成功 key 仍只读重放。公开报告只提供存在事实，安全原链接仅后台可用。完整契约和可导入样例见[第18节](../../docs/开发/车辆接口.md#18-be-ux11-配置多语工作区与真实历史)。前后台配套升级与真实翻译启用另行记录。

本轮隔离集成测试 `integration.test.ts`、`publication-preview.test.ts`、`publication-preview-revision.test.ts` 支持可选 `API_TEST_DATABASE_SOCKET`，但仍先验证本机 `API_TEST_DATABASE_URL` 和随机测试库；此变量仅测试读取，不改变生产配置校验。迁移维护 SQL 须保持车辆父行先于草稿、侧表、媒体与确认的锁顺序，或者停写执行。运行环境与新接口是否已切换以本轮日志为准。

回退须考虑新草稿数据：旧 API 不识别新保存的 asking 空金额，不能只回退二进制并继续连接已产生此类写入的库。切换前保存库／媒体快照；切换后如已有编辑，先评估兼容数据或前滚修复，不能无条件恢复旧快照丢弃新写入。公开快照的严格金额形状保持原样。

本机交付入口统一为 `127.0.0.1:3363`；本文件中的原生应用端口仅用于隔离开发／测试，验收后释放，不另设长期宿主入口。数据库与 API 通过内部网络访问；现有 Unix socket 测试入口可复用隔离随机库，不为测试增加数据库宿主端口。

### 外部目录隔离验证

0004 增加外部批次、挂牌、媒体、覆盖和试译账本。`EXTERNAL_CATALOG_MODE=synthetic` 仅接受 `HOST=127.0.0.1`、无连接选项的本机 `127.0.0.1/hd_ext_*` 测试库、非生产环境及 `TRANSLATION_PROVIDER=disabled`。默认关闭。先显式迁移新库，再使用独立端口与媒体根启动。导入需要管理员会话，可用 `@hd/contracts/fixtures.makeExternalImportFixture(200)` 作为 `/api/v1/admin/external/batches` 请求体。回归 `pnpm --filter @hd/api test:integration` 会创建并清理自己的随机库。接口、角色和后续依赖见[车辆接口第15节](../../docs/开发/车辆接口.md#15-be-ext-01-外部挂牌与试译干跑)。

已核验的 PA 私有样本可用 `pnpm --filter @hd/api external:sample --inspect-local <私有样本目录>` 重跑。命令只用本机 `/postgres` 维护连接，自动创建并清理独立 `hd_ext_real_*` 数据库。它导入固定试译组与对照组，测算100条并只输出汇总，不加载 `.env`、启动监听或调用外部服务。合成 HTTP 导入仍只允许合成供应商。

OpenAPI 由路由使用的 schema 生成到 `openapi/public.json` 和 `openapi/admin.json`，生成不需要数据库在线。二进制图片及原生登录协议另见车辆接口说明。生成产物可交给 FE/AD 导入工具，但不手工维护。根 `pnpm check` 已包含后端集成测试，先启动本地数据库；CI 使用隔离 PostgreSQL 服务。根 `pnpm build` 构建契约、API、OpenAPI 和官网。

## 运行边界

- 开发后台默认 `http://127.0.0.1:3318`，代理 `/api` 到 API 3320，统一使用 `127.0.0.1`，不混用 localhost。官网 SSR 通过内部 HTTP 地址访问公开接口，浏览器查询与媒体通过官网同源代理读取。
- `AUTH_BASE_URL` 填后台可见 origin，不含 `/admin`；`TRUSTED_ORIGINS` 是精确 origin 列表。生产 HTTPS、host-only Cookie、`/api` 路径、HttpOnly、SameSite=Lax；只有生产启用 Secure。管理写入必须带可信 Origin。
- 默认 `TRUST_PROXY=false`，不信任转发头；本机代理可用 `loopback`。受控 Compose 代理应固定代理 IP 并填写如 `TRUST_PROXY=172.29.0.2/32`（仅示例，须与实际网络一致），也接受逗号分隔的明确 IPv4/IPv6 地址或 CIDR。网段限 IPv4 `/24`–`/32`、IPv6 `/64`–`/128`，优先单地址 `/32` 或 `/128`；整网段仅限代理专用、没有不可信容器的网络。拒绝全网、跳数、主机名、其他别名、IPv6 zone 与 IPv4 映射 IPv6 配置（映射地址请写对应 IPv4）。API 不映射宿主公开端口，Nginx 必须覆盖客户端传入的 `X-Forwarded-*`，不得直接追加不可信链。Better Auth 的限流身份只使用 Fastify 校验后的客户端 IP，不采纳调用者提供的内部 IP 头。跨域 CORS 默认关闭。代理配置能力参见 [Fastify 官方说明](https://fastify.dev/docs/latest/Reference/Server/#trustproxy)，本地运行及恢复验证由 OPS 另记。
- 存活检查 `/health/live`；就绪检查 `/health/ready` 检查数据库及迁移后的必要表。接口、登录和图片响应均 no-store；错误只含稳定 code、字段路径及 requestId，不暴露堆栈或连接信息。
- BE-INT-03分桶增量：公开JSON、公开媒体、管理业务、健康检查各按已校验来源IP限制120次／60秒，鉴权路由30次／60秒保持。健康检查不再消耗业务桶，原图／thumb及不同媒体ID共用媒体桶；429保留真实Retry-After。完整可信访客协议见[车辆接口第11节](../../docs/开发/车辆接口.md)：入口覆盖X-HD-Visitor-IP，Web在服务端开关启用且入口封闭时构造单值X-Forwarded-For，API仅信任固定proxy/Web地址。实际3320是否已启用以BE增量日志为准，不在启动脚本中自动扩大信任范围。
- `pnpm --filter @hd/api media:cleanup` 每次处理最多 100 个过期且无引用的上传对象，并清理到期幂等记录。上传许可保留 30 分钟，完成处理后未绑定图片保留 24 小时；已发布历史或草稿引用不会被删除；车辆回收站内的媒体全部保留。恢复车辆不会延长已过期上传许可或无引用媒体保留期。命令可重复执行，可靠调度、对象存储、备份恢复及监控告警待 BE-03。
- 人工录入的外部挂牌使用 `source.kind=external`，来源、时间与每图证据按车辆接口第10节保存；不是自有库存，当前不宣称人审。第三方自动适配及 AI 工具仍未接入。员工可明确生成翻译建议，仍须采用／保存和发布；后台自动翻译 worker 留待后续。

停止服务使用该进程的正常退出信号；不要停止其他角色的进程。真实库存、服务器、外部 API 及翻译服务须分别提供资料并按对应阶段验证。

本机后台验收环境与日常开发库分开。当前入口、专属库/媒体、账号、启动/停止方法只登记在未提交的 `docs/private/本地联调访问.md`（仓库根相对路径，权限 600）；不要据此另建或重置数据库，也不要把私有内容粘贴进公共日志。

### I18N02 / FEUX04 integration

The optional `view=localized` public projection, complete-catalog ranges/facets, protected vehicle localization sidecar routes and migration `0003_vehicle_localization` are implemented. See the authoritative vehicle contract, section 14, for exact query, length, revision, publishing and compatibility rules. Existing default public DTOs stay unchanged. `generation` and `drivetrain` belong to sidecars and remain null until supplied; no legacy fact is inferred.

Before enabling this build, stop old writers, back up the authoritative database/media, apply migrations explicitly, then check readiness. Migration 0003 separates response metadata from old vehicle receipts without discarding historical results or expiry. A rollback must pause management writes and use matching consumers because older applications do not understand sidecars. Integration tests create/drop isolated random local databases; they never migrate the acceptance inventory. Runtime/provider enablement is recorded separately in the BE role log.

## 二期容量和报价命令

容量环境使用 `NODE_ENV=test`、`EXTERNAL_CATALOG_MODE=synthetic-scale`、`TRANSLATION_PROVIDER=disabled` 和专用 `hd_ext_scale_*` 数据库。仅允许本机回环或隔离 Compose 的 `postgres-scale:5432`。连接和员工密钥可各自通过绝对路径的 `DATABASE_URL_FILE`／`AUTH_SECRET_FILE` 提供。密钥文件限所有者读取，不能与对应内联变量并用。CLI 读取进程环境，启动前先配置上述测试环境。以已经单独迁移的空库执行以下命令。

```sh
pnpm --filter @hd/api external:scale-seed --count 1000
pnpm --filter @hd/api external:fx --seed a
pnpm --filter @hd/api external:fx --health
pnpm --filter @hd/api external:scale-bench usd 20 400 --warm
pnpm --filter @hd/api external:sync --seed 1
pnpm --filter @hd/api external:sync --once
```

- 正式合成容量档位为100000／500000，每档使用新库。装载命令报告固定样本、品牌／价格分布及 `usd_toyota_a`、`usd_toyota_b`，对应 Toyota 和 $8000–$17000。合成汇率 A 为 7 CNY／USD，B 为 8 CNY／USD。可切换 `external:fx --seed b` 或 `--seed expired`。同日同组可安全重跑。
- 容量场景支持 `list`、`facets`、`common`、`rare`、`mixed` 和 `usd`。并发值为20／50／100，请求总数在并发值至10000之间。每个路径分别报告成功请求 p50／p95／p99、状态分布、成功数和错误率。测试用访客身份只存在于进程内注入，没有新增对外容量通道。代理链和真实限流通过隔离 HTTPS 另验。
- `EXTERNAL_PUBLIC_CACHE` 可选 `off`、`memory`、`redis`，默认关闭。容量 Redis 使用专用主机、账号及绝对路径的 `EXTERNAL_REDIS_PASSWORD_FILE`，仅允许 `GET/SET` 对 `<namespace>:slot:*`。缓存 TTL 由 `EXTERNAL_CACHE_TTL_MS` 控制，默认5000、最多30000毫秒；`EXTERNAL_CACHE_MAX_LOADS` 默认4、上限20。容量 API 每实例最多128个版本读取，数据库连接仍由 `DB_POOL_MAX` 限制。可在隔离环境读取 `/health/catalog-cache` 的计数。
- `external:sync --run` 持续处理事件。`--seed [generation]` 写入固定33个事件，同一代重复不入队。`--once` 执行一次有限批次。独立池由 `EXTERNAL_SYNC_POOL_MAX` 控制，默认2、范围1–5。轮询空闲间隔由 `EXTERNAL_SYNC_IDLE_MS` 控制，默认1000、范围250–10000毫秒。`--health` 返回 `ready/checkpoint/enqueued_seq`，心跳窗口为30秒。
- `external:trial-fake --seed` 生成固定100条的模拟计划；`--grant <trialId> <characters>` 只写隔离模拟额度；`--run <trialId> [limit]` 使用模拟文本。`--interrupt-after-dispatch` 可用于单独验证中断留账，修复后重跑。脚本输出 `realCalls:0`，不会写公开译文。

真实参考汇率的 `external:fx --refresh` 仅在新建回环预览库 `hd_ext_fx_preview_*`、`NODE_ENV=test`、`EXTERNAL_CATALOG_MODE=synthetic` 和 `EXTERNAL_FX_NETWORK=enabled` 下显式执行。可由隔离调度器每小时尝试，数据库限制滚动24小时最多一次外呼。失败保留原快照且不会延长有效期。页面请求和容量环境均无外呼。`--health` 返回快照及最近尝试状态，`retained` 表示已超过24小时且仍在七天有效期内；不输出汇率。健康命令读到缺失或过期仍正常退出，告警应判断状态。刷新在24小时冷却时正常退出且报告未发起；本次实际刷新失败返回非零退出码。接口与署名见[车辆接口第16节](../../docs/开发/车辆接口.md#16-be-ext-02-目录容量与美元展示)。
