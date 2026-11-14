# 业务 API

BE-01/02 本地实现：独立 Fastify 服务、PostgreSQL、员工登录、车辆草稿与发布、媒体、首页配置及多语言内容。管理列表支持关键词与品牌/车型/动力/状态组合筛选，具体参数见唯一接口文档。实际验证和未覆盖项见[后端进度](../../docs/协作/后端.md)。官网和员工后台已通过 HTTP 消费 API，上一轮本地技术联调已完成，公开车型样例明确非库存；本轮增量及最终用户验收另行记录，不代表生产上线。

BE-INT-02 已增加最多50条的库存/下架批量接口与后台全库存品牌车型选项。`source.kind=demo` 明确表示非库存，保存未知库存/空核验时间/待询价及无实车事实；允许当前版本的三语待审内容展示，但公开始终 `reviewed=false`。真实 manual 的发布/审核门槛不变。前后台以[车辆接口第9节](../../docs/开发/车辆接口.md#9-be-int-02-三端接入增量)接入；批量200须逐行检查结果，不可只按HTTP状态标记全部成功。

BE-INT-03 增加车辆回收站／恢复、人工外部挂牌、公开关键词查询及固定240px缩略图。删除与首页清理同事务，恢复为未发布且未核验的草稿；媒体和不可变发布历史保留。具体接口、幂等历史回执与消费者接法见[车辆接口第10节](../../docs/开发/车辆接口.md)。本轮实现与验证状态以角色日志为准，运行中的3320是否升级须单独核对。

BE-I18N-01 已实现员工触发的中文源→英俄译文建议，保持已保存草稿及人工审核不变。用户后续选择使用现有阿里通用版国际站额度；服务端显式选择 `TRANSLATION_PROVIDER=aliyun`、`ALI_MT_REGION=ap-southeast-1`，仅调用固定新加坡HTTPS接入点。region另允许 `cn-hangzhou`，并保留其兼容默认值；不接受自定义阿里URL，不自动回退或切换站点。实际账号开通／权限／计费须按国际站核对，不能套用中国站免费额度。源码默认仍 disabled，密钥仅服务端；本地LibreTranslate适配保留但不能当作本轮业务质量已通过。配置与接口见[车辆接口第13节](../../docs/开发/车辆接口.md#13-be-i18n-01-单车译文建议与发布差异)，真实调用与联调按运行日志核对，不将HTTP stub当作服务成功。

架构见[后端架构](../../docs/开发/后端架构.md)，接口唯一说明见[车辆接口](../../docs/开发/车辆接口.md)，公共 schema 与样例见 [contracts](../../packages/contracts/README.md)。

## 本地启动

日常由 BE 自行启动 `pnpm dev:api`，源码变化自动重启，不交 OPS 逐次构建部署。按 [统一本地开发分工](../../docs/README.md#本地开发与部署分工) 复用已准备的开发库／媒体；下面是首次配置示例，已有环境不要重复复制 `.env`、创建库或初始化。仅新迁移需要在开发库执行，不能指向生产数据。

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

本地开发允许独立端口，BE 可保持 API 开发服务运行并向 FE／AD 告知实际地址，最终交付清单列明端口和用途；不再强制通过 3363。API 只监听回环地址或受控私网，数据库／缓存不公开暴露；隔离自动化测试仍使用自己的随机库和临时资源，结束后释放，不改动用户预览数据。

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

## REL03 正式读取、SSR回源与额度

REL03增量不改变UX11冻结运行环境。实际main启动必须显式提供`HD_DEPLOYMENT_ENV=production|local|test`和`HD_RELEASE_ID`（40至64位小写commit，或`sha256:`镜像摘要）；缺失报配置错误。只有明确test且缓存关闭的纯测试可以使用稳定未发布默认值。发布身份参与不透明公共版本，恢复库后仍必须按旧流程轮换公共epoch，不能沿用旧缓存命名空间解释旧数据。

正式运行保持`EXTERNAL_CATALOG_MODE=disabled`，以`CATALOG_READ_MODE=staff|combined`单独选择只读员工车或合并既有外部目录，默认staff。`EXTERNAL_SYNC_MODE=off`是唯一允许值，正式模式拒绝批次导入POST；不启动worker、不拉供应商、不导入数据。既有synthetic/synthetic-scale的隔离数据库、网络和翻译关闭护栏保留，不能混用正式PUBLIC_*缓存选项。

`PUBLIC_CATALOG_CACHE=off|memory|redis`默认off。正式TTL默认/上限15000ms，`PUBLIC_CACHE_MAX_LOADS`默认/上限4；L1最多64项、16MiB，单值1MiB。Redis使用固定内部alias`redis`（原生隔离运行可127.0.0.1）、`PUBLIC_REDIS_PORT`默认6379、`PUBLIC_REDIS_USER`和绝对`PUBLIC_REDIS_PASSWORD_FILE`；`PUBLIC_CACHE_NAMESPACE`默认`hd:catalog:production`，可按环境显式设置。Redis服务由OPS设`maxmemory 128mb`和`allkeys-lru`，应用ACL只需GET/SET `<namespace>:slot:*`，不授予CONFIG权限。即使off也进行有界、回源前后DB版本核验并返回stamp，只是不保存DTO。DB断开不返回旧数据；Redis失败最多4路回源，正式模式最多16个等待key，共享原请求3秒期限，满/超时503且过期等待不发起回源；连接/超时/项大小继续有界。

FE/API以私有文件`HD_SSR_SERVICE_SECRET_FILE`共享32–256位可打印ASCII密钥；API同时配置`HD_SSR_SERVICE_PEERS`实际FE socket IP/CIDR，并在`TRUST_PROXY`中只信实际转发链。内部`/internal/public-catalog/`只提供公开GET/版本，公网代理必须拒绝整个前缀，API不能有公网端口。静态`X-HD-SSR-Key`不进入浏览器/日志/缓存；外部公开请求带同名头没有特权。内部数据桶30r/s、burst40、无排队，底层回源4；每SSR请求的version读取仍按可信访客public-json120/min，命中不豁免。多进程扩容前需重新制定共享入口/并发预算，当前服务桶按单API进程。完整路径、TTL与FE用法见车辆接口第19节。

迁移新增`0017_translation_budget.sql`，ready同时核对公共版本与额度单例和新表。须先停旧写入者，再显式迁移、启动新API；不能让旧内存额度进程并行写入。每次provider调用前在PG短事务锁定全局额度、以数据库时间累计过去一小时UTF-16预留并提交；失败、超时、未知结果均不退回，进程重启/engine切换不清零，DB失败则不发外呼。过去25小时以前记录仅在下一次成功预留时清理，不提前释放小时额度。新迁移对过去一小时旧计划的潜在调用分段保守按5000字符预留一小时（明确未尝试/额度拒绝除外），可能暂时阻止新翻译，不能手动清空账本绕过。

同计划/同幂等key恢复继续读持久分段和完成回执，不自动重发未知结果；新计划仍需员工费用确认，账户免费余额/实际费用未知不填0。本轮测试使用fake provider及随机隔离库，包含子进程被SIGKILL后重启，未调用真实Ali、未导入真实车源或部署。迁移后不可直接回退旧内存额度API；先停翻译写入并由OPS按保留数据方案处理。

## EXT06 固定名单正式导入与员工追溯

当前实现支持固定最多300个canonical车源、最多1000个关联来源身份的一次导入和显式追平。没有定时器、daemon或API触发导入按钮。首个canonical代表绑定后不因新任务字典排序改变；来源重新关联须人工核查，人工覆盖仍在原稳定挂牌上。不能把合成测试、历史本地20+200样例迁移成这次正式名单。

迁移顺序为0018审计快照/不可变历史 → 0019持久任务/lease/checkpoint → 0020完整来源/共享原档/媒体分段 → 0021固定canonical代表。先停旧写入器、备份和验证恢复，再显式迁移；启动不会自动迁移。新审计追加触发器会拒绝修改/删除已有历史，旧姓名和diff不回填猜测值。回退二进制前须评估新表和新媒体数量，保留新员工写入，不直接恢复旧备份覆盖新增操作。

`external:ingest` 对应 `node dist/external/ingestion/cli.js`（生产编译产物），支持prepare/catch-up/once/status/recover。使用私有DATABASE_URL_FILE和受限API密钥文件，不把密钥写命令行内容。服务身份是禁用且无登录凭据/会话的chinacarapi-ingestion-worker；触发人须是现有启用管理员，独立保存。部署worker容器初始限制0.5 CPU/512MiB，内部连接池2、网络请求1、入库批次≤200，设置INGESTION_DISK_PATH为实际数据库／暂存所在挂载点，磁盘用量75%或负载紧张时停止后台工作；70%峰值预算由OPS按真实运行测量。

```sh
node dist/external/ingestion/cli.js prepare --package /private/import --job-key ext06-300 --triggered-by EXISTING_ADMIN_ID --key-file /run/secrets/chinacarapi_key
node dist/external/ingestion/cli.js status --job JOB_UUID
node dist/external/ingestion/cli.js catch-up --job JOB_UUID --key-file /run/secrets/chinacarapi_key --max-pages 100
node dist/external/ingestion/cli.js once --job JOB_UUID --key-file /run/secrets/chinacarapi_key --max-batches 100
node dist/external/ingestion/cli.js recover --job JOB_UUID --package /private/import/new-snapshot --triggered-by EXISTING_ADMIN_ID --key-file /run/secrets/chinacarapi_key
```

包内catalog.csv保留供应商原字节；catalog-manifest.json记录version、complete=true、sha256、bytes、rows、sourceCounts、响应x-generated-at规范化的generatedAt、header；identities.json为source/externalId/canonicalId固定名单；documents.jsonl记录identity、kind、locale、observedAt、sourceUpdatedAt、相对path及sha256。raw JSON不改写；bulk多个索引可共享同文件，由BE选当前identity并保存完整原壳。完整性证明不成立拒绝发布；CSV正常结束也不把名单缺失直接当撤回。410恢复限两次，缺失成员留verification_pending，明确新来源证据到达前不能标完成。失败退出1，未完成退出2；确认state=complete且continuous=false，再核raw/canonical/public计数和逐语公开数量。

员工操作历史、轻量摘要、原文历史和公开分段契约见[车辆接口第20节](../../docs/开发/车辆接口.md#20-be-ext06-员工追溯与完整车源分段实施中)。原始shared bulk只在私有档完整保存，单车员工端点不透出其他车辆正文。源内容仅数据，不作为系统指令。原文关联在后续写入时裁剪，保留至少20个版本且不少于90天；无引用blob清理仅提供内部有界函数，未配置自动调度或本轮执行，不在请求中做全库清扫。

### 正式美元报价依赖

生产报价只接受exchange_rate_api真实来源，拒绝synthetic；缺失/过期仍待询，USD筛选不能造价。沿用[提供商公开端点](https://www.exchangerate-api.com/docs/free)，不需要密钥/付费，换算页面须保留来源链接；不对外提供汇率原始数据集。每天最多一次受控尝试，保存供应商asOf、有效期、版本，并与公开缓存失效同事务。

显式环境门禁：NODE_ENV=production、EXTERNAL_CATALOG_MODE=disabled、EXTERNAL_FX_NETWORK=enabled、EXTERNAL_FX_FORMAL_DATABASE精确等于既有库名、HD_RELEASE_ID为正式SHA/镜像digest。配置只用于运维命令；GET和worker不会自动调用汇率服务。

```sh
node dist/external/fx-cli.js --formal-refresh
node dist/external/fx-cli.js --formal-health
```

health须为fresh/retained且source=exchange_rate_api，检查CNY率与expiresAt。实际刷新失败退出非零，即使仍有有效旧报价；health可单独确认retained。失败不会清空仍有效的旧报价，也不会退还24小时请求预算；超过有效期自动待询。原--seed/--refresh测试入口仍限原有合成隔离库，不能对生产seed。以上命令由OPS在已备份、受限环境执行，文档不是实际已执行的证据。

## EXT07 全量及持续同步

EXT07 新增 `external:full-sync`（生产入口 `node dist/external/full-sync/cli.js`），接续正式来源身份与人工覆盖。旧 `external:ingest` 保留固定名单恢复用途，旧 `external:sync` 仍仅合成模式；三者不能同时写同一正式来源。先应用0022任务表、0023压缩原档/公开证据及0024固定容量样本索引迁移；API readiness检查必要表与列，0024索引另由迁移流程确认。新进程不会自行迁移数据库。

```sh
node dist/external/full-sync/cli.js configure --mode continuous --actor EXISTING_ADMIN_ID
node dist/external/full-sync/cli.js status
node dist/external/full-sync/cli.js run --max-ticks 1
node dist/external/full-sync/cli.js serve
node dist/external/full-sync/cli.js control --action pause --version CURRENT_VERSION --actor EXISTING_ADMIN_ID --key IDEMPOTENCY_UUID
```

`configure --mode full` 执行一次全量；`continuous` 在首次全量后继续5分钟增量、每日完整CSV对账、每日账户/字典和7天详情轮巡。`run`有界执行后退出，`serve`持续调度，单进程持有数据库锁78291333；冲突退出75，命令失败1，run未完成2，成功/状态读取0。退出0不是全量完成的证明：须核状态、失败和待补齐计数。管理接口的暂停仅暂停重任务；读取和明确撤回继续工作，恢复不创建任意来源任务。

必要环境：`DATABASE_URL_FILE`、`CHINACARAPI_KEY_FILE` 指向只读私有凭据文件；`FULL_SYNC_ARCHIVE_ROOT` 是新数据盘内的绝对持久目录，不是系统临时目录。进程内部连接池2、网络并发1、总速率至多2请求/秒并持久遵守Retry-After；部署另限制0.5 CPU/512MiB。bulk从500开始，超时/响应过大递归减半，成功分批即入库。原文先压缩共享存档，事件/工作只保存引用；整页持久后才推进接收游标，实际应用独立计数。CSV先流式校验完整性，单次缺行只触发核查；明确撤回优先处理，有效备用来源可接替代表，稳定挂牌ID和人工覆盖不搬移。

容量检查区分CSV暂存与业务详情样本：下载/暂存始终受70%磁盘硬限制；首批最多1万条的三语详情与报告实际完成后才能申请扩量。样本满额等待报告/判定时停止推进CSV快照和获取新身份详情，继续撤回及被增量事件更新的已有样本补齐。进入 `capacity_pending` 后，仅允许SQL筛选为已有样本的详情/报告任务（至多500详情及20报告/轮）及所需当日账户额度刷新；匹配裁决通过后的下一轮恢复新增身份和快照。此路径仍受管理员暂停、70%硬限制及供应商配额约束，不把报告未查当无报告。

`external_full_sync.capacity_estimate` 仅供内部测量与裁决绑定，不进入公开API。`snapshotId/targetRows` 取最新已完整验证的CSV；`sampleRows/detailSampleRows` 是首批固定样本数，首次放行后新增身份不再加入，撤回不补替身。门槛为CSV目标与1万的较小值。`detailSampleRows=activeDetailSampleRows+withdrawnSampleRows`；撤回单列终态，不计入 `threeLocaleCompleted/reportCompleted/confirmedNoReport`，重新挂牌须重新补齐三语及报告。`distinctProcessed` 是全库取得过详情的身份数，供后续增长时计算真实业务均值，不能一直用1万除增长后的全库大小。

`businessBytes` 是业务关系含索引/TOAST/压缩原文的实占，排除完整SQL暂存关系；`sqlStagingBytes` 单列该暂存表、索引/TOAST。`archiveDirectoryBytes/walBytes` 为观测值，`fixedBytes` 只是三项之和；`csvBytes` 是导出原始大小元数据，不重复加入文件实占。`capacity_baseline.detailSample` 只保存全体非撤回、三语与报告完整的固定样本实测，带成员/状态摘要和来源快照。相同样本后续撤回可复用该历史证据；新CSV须重新裁决，不要求重复采集已完成的同一组样本。`actualBytesPerDetail=businessBytes/distinctProcessed`，`projectedBytesPerDetail` 取当前业务均值与可信历史均值的较大者，`historicalBytesPerDetail` 给出后者。三者仅为实测单价观测，不是整盘峰值；没有128KiB默认值或6倍系数。没有完整样本或有效历史时 `sampleEvidenceSufficient=false`、预测为null。

峰值模型只有OPS的 `hd-ext07-peak-v1` 一套，逐项计当前实占、剩余增长、历史、暂存、WAL、媒体及备份/密文峰值，避免重复固定项。BE 的 `estimatedBytes` 只回显合法且匹配裁决的 `projectedPeakBytes`，不能用BE观测的 `fixedBytes` 再加一次。`FULL_SYNC_CAPACITY_APPROVED_BYTES` 如设置，仅为最终整盘峰值的额外上限，0表示不额外设限；它不能替代裁决或放行样本不足。60%告警由部署监控负责。

### 容量裁决文件与证据绑定

OPS每60秒有锁测量并原子替换宿主 `/srv/hd-auto/data/full-sync-capacity/decision.json`；整个目录只读挂载至worker的 `/private/capacity`，设置 `FULL_SYNC_CAPACITY_DECISION_FILE=/private/capacity/decision.json`。worker只读，不创建/修改裁决。文件须为私有普通文件（建议0600或0640，禁止组写/其他用户权限和符号链接），不超过64KiB。原子替换目录挂载可让每次读取看到完整的新/旧文件；不能挂载单个被替换的inode。

JSON严格字段：`schemaVersion:1`、`model:"hd-ext07-peak-v1"`、`snapshotId`（UUID）、`targetRows/sampleRows`、`evidenceHash`（64位小写SHA-256）、UTC `measuredAt/expiresAt`、`decision:"allow"|"wait"|"blocked"`、`reason`、`projectedPeakBytes`（证据不足可为null）、`diskTotalBytes/currentUsedBytes`、`components`。所有字节/数量是非负安全整数，磁盘总量必须为正且与worker实际盘相同；非null峰值不得小于当前实占。`reason` 严格采用OPS控制器四个大写固定枚举：allow对应 `SYNC_CAPACITY_VERIFIED`，blocked对应 `SYNC_CAPACITY_LIMIT`，wait对应 `SYNC_CAPACITY_INSUFFICIENT_SAMPLE` 或 `SYNC_CAPACITY_WAITING_MEASUREMENT`；未知码、大小写变化和状态不匹配均拒绝。`components` 为至多64项的平面键值，键至多64字符且字母开头，值只接受非负安全整数或至多64字符的小写字母开头的字母/数字/下划线/连字符模型代码，不接收正文、车辆信息、URL或凭据。JSON不接受额外字段。

BE唯一生成 `evidenceHash`，OPS原样回写。SQL按 `source,external_id COLLATE "C"` 取固定样本，最多10001行（多一行用于拒绝超量）。每个身份 `[source,external_id]` 与状态 `[source,external_id,canonical_id,state,event_order,desired_generation,applied_generation,sortedLocales,report_state,lastDetailEpoch,reportCheckedEpoch]` 分别用PostgreSQL的JSONB文本、UTF-8、SHA-256转成64位小写摘要；代次/事件序号和非null时间使用文本，语言按C排序。依身份C顺序拼接定长摘要后分别SHA-256，形成 `cohortHash/stateHash`，无成员身份离开SQL。外层对 `{model:"hd-ext07-evidence-v1",snapshotId,targetRows,cohortHash,stateHash,history}` 使用仓库 `jsonHash`：对象key递归按字典序，数组保序，UTF-8无空白JSON；`history` 是有效基线的model、cohortHash、stateHash、sampleRows、来源snapshotId/targetRows及bytesPerDetail，或null。轮询时间、基线at、易变磁盘/WAL字节不进入绑定。相同状态不重写历史单价，新增非样本身份不改绑定；快照、样本成员/代次/语言/报告/撤回/重新挂牌改变会使旧绑定失效。

裁决最长有效10分钟，未来时差最多60秒；每次重任务前重新读取核对时效、快照和样本绑定，不永久缓存allow。下一每日CSV尚未完整验证时仍绑定上一已验证快照，相关暂存峰值由OPS预留；新CSV验证后立即重新绑定，未取得新裁决不推进业务扩量。只有合法匹配的allow且 `projectedPeakBytes < diskTotalBytes*0.7`、当前真实磁盘占用<70%、未人工暂停且额度可用时才放行。

错误区分：样本/历史不足为 `SYNC_CAPACITY_INSUFFICIENT_SAMPLE`；缺文件、非法JSON、过期、错批次/hash或wait/blocked为 `SYNC_CAPACITY_AWAITING_DECISION`；真实预测或当前磁盘达到70%为 `SYNC_CAPACITY_LIMIT`；额外峰值上限不足为 `SYNC_CAPACITY_BUDGET_CAP`。已有pending阻断一般重任务为 `SYNC_CAPACITY_PENDING`，人工暂停/当前磁盘守卫仍可能返回 `SYNC_HEAVY_PAUSED`。新的匹配allow能自动恢复，无需重启或修改环境。等待期间仍保持上述受控样本修复与撤回。

组合回归 `test/full-sync-capacity-ops.test.ts` 必须在包含BE与OPS控制器的集成版本、提供Python 3的隔离检查环境执行。它直接导入仓库 `deploy/runtime/production/capacity-decision.py` 的纯判定/原子写文件函数，用合成测量生成真实控制器输出，再交BE读取；覆盖allow、70%限制、样本不足和测量失败，不调用生产main/测量器或外部来源。不复制控制器/输出样例，也不在缺少控制器时跳过。测量失败的空绑定/零磁盘结果按等待处理，不能沿用旧allow。

### 原文保留与公开资料

0023替代EXT06的长期原文保留规则：保留当前原文和最近一版历史，历史最多7天；待处理引用、备份点及员工审计证据受保护。已有未压缩内容可读，后台有界压缩，公开请求不解压整份来源。备份必须先保护blob和document引用及CSV归档快照，保留点删除后再释放；归档、数据库与配置须一并恢复。准确备份操作及服务器实测结果由本轮OPS交付，不能以文档视为已执行。

公开API增加卡片投影、排序/出口状态、实际语言名称、完整有效VIN、生产日期依据、直接马力、分页检测与原币价格历史，见[接口第21节](../../docs/开发/车辆接口.md#21-ext07-全量同步与公开资料)。俄语返回英文时如实标contentLocale=en；供应商只给登记天数/over180Days不推断出口资格，缺少明确status保持unknown。AI仍只读取同一公开白名单，不读取原档或数据库连接。

备份引用命令（仅数据库，不调用供应商；reference限160字符的字母、数字、点、下划线、冒号、连字符）：

```sh
node dist/external/full-sync/cli.js archive-pin --reference BACKUP_NAME
node dist/external/full-sync/cli.js archive-release --reference BACKUP_NAME
```

pin保护来源document/blob和未清理CSV快照，与CSV清理共用归档锁；须在备份开始前执行。release只解除指定reference，不删除数据。备份读取与恢复仍由OPS流程执行。

批次运行日志使用 `event=external.full_sync.bulk_attempt`：只含 `source/locale/requestedCount/elapsedMs/responseBytes/resultCode/splitCode`。计时从实际发送开始，不含限速和额度等待；成功字节数取实际响应流，传输失败为null；拆批前失败与成功子批分别记录。日志不含车辆ID、URL、凭据、正文或供应商异常消息，记录失败不会触发重打请求。OPS结合容器内存峰值和持久容量样本判断500及拆批效果，无需额外探测供应商。
