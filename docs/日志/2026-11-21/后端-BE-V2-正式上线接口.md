# BE v2.0.0 接口与接入

工作区 `websit-worktrees/be`，分支 `codex/be-v2`，主线基线 `11fd1b1b9f0ed5bc07c3bd18b5189d6576583350`。本次仍处于本地实现和验证，生产开关由 OPS 在统一验收后处理。

## 官网事件

- `POST /api/v1/analytics/events` 的请求仍为 `{events:[...]}`，每批 1–10 条、8 KiB，保留原 202 `{data:{accepted:true},meta}`。旧 `page_view`、`vehicle_click`、`contact_click` 原样有效。新增 `filter_submit` 和 `search_zero_results` 配 `pageType:catalog`，`calculator_complete` 配 `pageType:calculator`。详情 `page_view` 必须含公开 `vehicleId`。联系可附 `vehicleId`、`channel`，联系点击只代表操作次数。
- FE 使用 `@hd/contracts/analytics`。同意本站分析后生成随机 `sessionId`，同一会话按真实操作递增 `sequence`，同批重试保留各原 `eventId`，30 分钟无操作换会话。旧事件缺会话仍计次数。选填 `device`、`source`、`campaign` 仅使用导出枚举。从同一会话内的首次来源归因，不发送自由搜索词、来源 URL 或 IP。FE 确认查询成功且结果为零之后才上报 `search_zero_results`。
- FE 应在事件入队时记录 `occurredAt`（ISO 瞬时值），并在整段会话重复附上同一个枚举值 `entry`（入场页面类型）。重试保留二者。服务端仅采用收到前 30 分钟内且未超前的时间，缺失或超范围用收件时间。这样跨午夜的一批事件仍能分别计入发生日，后到的首个事件也不会把另一页误判成入口。旧版缺字段仍可提交。
- `ANALYTICS_V2_ENABLED` 默认关闭。旧采集仍由 `ANALYTICS_ORIGINS` 控制。启用后，同源检查、事件批量限额及独立连接池仍有效。原始会话序列和幂等键按 7 天清理，去掉会话令牌映射后的报表汇总保留 90 个北京时间自然日。每日 IP 仅在可信网关接入时生效，按收件日作 HMAC 去重及合计，跨日不相加。禁止真实广告或第三方流量测试。
- OPS 在生产网关对分析路由覆盖客户端同名头。以本地 IP 库判断国家后写 `X-HD-Analytics-Country`，同时注入 `X-HD-Analytics-Gateway-Key`，网关与 API 从同一私有文件取得 64 位小写十六进制密钥，API 使用 `ANALYTICS_GATEWAY_SECRET_FILE` 配置并保留明确的 `TRUST_PROXY`。网关仍应覆盖可信 `X-Forwarded-For` 并禁止分析入口 access log 记录原 IP。未认证的网关头不参与国家或 IP 估算，未知国家标识 `ZZ`。

## 管理员经营报表

- `GET /api/v1/admin/analytics/overview?days=7|30` 严格兼容旧返回。新增 `GET /api/v1/admin/analytics/report`，员工中仅管理员可读，响应 `no-store`。AD 导入 `AnalyticsReportQuerySchema` 与 `AnalyticsReportResponseSchema`。
- 区间三选一。`days=1..90` 默认 30 且包括今天，也可用 `period=today|yesterday`，或 `startDate=YYYY-MM-DD&endDate=YYYY-MM-DD` 指定含首尾的北京时间日期，最多 90 天。`granularity=hour|day`，日趋势沿用北京时间，响应中的实际边界是带时区的瞬时值。`comparison` 始终返回今天和昨天的同一已完成分钟段，历史小时缺失时 `coverage` 标识未采集或间断。
- `locale`、`source`、`country`、`device`、`entry` 可组合，筛选条件同时用于次数、来源会话分母和排行。示例 `?period=yesterday&locale=ru&source=search&granularity=hour&metric=contactRate&page=1&pageSize=20`。未加细分限定时，兼容总览计数可包含旧版数据，国家、分渠道、时段和会话不能从旧数据补造。`legacyCollectionStartedAt` 和 `collectionStartedAt` 分别说明。`coverage` 支持 `not_collected`、`gap`、`partial`、`complete`。`dailyUniqueIpEstimates` 每日独立提供，未取得对应范围时返回 null。
- 排行指标 `detailViews`、`vehicleClicks`、`contactClicks`、`contactRate`。先筛选及聚合所有车辆，按指标排序，再稳定分页，`ranking.total` 为符合口径的车辆总数。行字段含公开车辆 ID、`stockCode`、`title`、`source`（`staff|supplier`）、`whatsappClicks`、`telegramClicks` 和会话分子分母。不能确认的历史标题或短号可为空。`contactRate` 为同车详情后联系会话数除以同车详情会话数，分母为零时为 null。
- `funnels.catalog` 为目录、点车、同车详情、同车联系四个有序阶段。`funnels.direct` 为站外落地详情与同车联系。会话按入场日，次数按发生日，跨午夜会话不会拆开，`activeSessions` 提示窗口内尚在活动的会话。`quality` 是站点采集到达数、接受数、重复、丢弃，`runtimeQuality` 是进程启动后统计入口的批次状态，限流与写入不可用分开。

## SEO 与供应商同步

- FE 在公开详情的现有 localized inline 查询加 `seoView=eligible`。启用 `PUBLIC_SEO_ENABLED` 后仅明确协商的响应提供可选 `data.seo:{indexable,locales,lastModified}`，缺少资格时保持 noindex。缓存区分新版和旧版请求。OPS 在启用后使用 `GET /api/v1/seo/vehicles?limit=100&cursor=...`。生产默认仍关闭。名单按共享逐语言条件过滤，三方最多 1,000 个身份，员工自录不限该配额。分页绑定 `revision`，以 `nextCursor=null` 为结束，即使当页列表为空仍续读。409／503 应弃用整代。OPS 用回环入口生成，两个公网域都应拦截清单维护端点，访客通过静态 XML 获取已发布的一代。
- `validUntil` 是本代最早资格图的失效时间，可以为 null。生成、验收和激活时都应核对，本代过期前重新生成或撤下旧地图，旧分片缓存同样受此截止时间约束。不能继续展示已过期的一代作为故障回退。
- OPS 生成前可在明确配置的数据库运行 `node --import tsx src/seo/cli.ts --refresh-selection`。要求 `SEO_SELECTION_DATABASE` 与 `DATABASE_URL` 数据库名一致。命令只更新受控名单，不请求供应商。上线流程仍需先验 FE、地图生成和发布权限。
- OPS 自有数据备份必须复核迁移后的恢复。`seo_external_selection` 是可重建的供应商派生表，数据依赖 `external_listings`，应与 `external_full_receive_observations` 一并追加到自有备份的数据排除集合，继续保留表定义。恢复后从当前已重建供应商目录生成名单，避免尝试恢复指向已排除挂牌的外键。
- `GET /api/v1/admin/external/sync-timings` 管理员可读，旧 `sync-status` 不变。新响应 `window` 给出最近 288 个完整五分钟槽的成功、缺失和失败数，`backlog` 提供未处理及失败，并按事件种类报告时延和 5 个原始时间点。公开生效时间以数据库投影提交为准，公网或 CDN 可见时间仍要另验。已公开价格需变化且供应商详情时间能精确对应事件，才计入完成样本。数据覆盖不足、待处理、未知和已被替代的项不能当作达标。历史工作的最老年龄只能以迁移时间作为下界。

## 验证

- PostgreSQL 18.6 隔离库的 9 项统计测试通过。覆盖旧版响应、管理员权限、新版组合筛选、全库排序分页、北京日界、按发生时间入桶、同一批与跨批乱序、异车和倒序不算转化、30 分钟闲置、新旧事件去重、国家伪造头、日内 IP 估算、过期明细清理后仍可读聚合。
- SEO 隔离库 9 项通过，覆盖 1,001 个合成候选的名单上限、三语资格一致性、无关供应商变更、撤回／隐藏、图片自然到期、旧分页失效和查询超时。新同步专项隔离库 10 项通过，覆盖真实测试投影改价、同价、撤回、重挂、历史覆盖、接收失败、优先和触达缓存。原流程回归通过。最后增量复查了旧事件优先处理，以及缺少 0039 观察表时就绪检查 200 → 503 → 200。测试库及本轮独立数据库容器已清理。
- `hooks:check`、99 项契约测试、17 项定向后端单元、API 类型检查、构建、公开／管理 OpenAPI 生成及差异检查通过。验证使用 Node 24.22.3 和 PostgreSQL 18.6。公开 OpenAPI 未包含管理接口。
- 独立只读审查覆盖统计、SEO 和同步。已修复跨批入口误归因、清理吞吐、地图版本受无关同步干扰、查询池隔离、详情提示等待、时间窗误报完整、CSV 替换后事件遗留以及异常详情阻挡其他阶段。按投产规则，提交与发布仍以用户验收为准。
- 同版联调须验证 FE 实际发送 `occurredAt` 和固定 `entry`，AD 读取最终契约，OPS 网关有效鉴权并消除原始 IP 日志。地图私网边界、最早图片有效期以及自有备份恢复均须在 OPS 产物验收。约 50 万车源的容量测试、移动端时延和生产 24 小时撤回／改价时延由集成阶段量测。

## 16:38 本地验收接线

- 在原 `hd-local12-postgres` 容器、原卷和私有 Unix 套接字上核对连接的确是 `hd_local_preview`，PostgreSQL 18.6。单独恢复原套接字桥。迁移前保存并核对私有备份目录，原迁移哈希与工作区准确匹配。应用 0033–0040 后，41 条迁移哈希全匹配，车辆／草稿／发布／媒体及供应商目录等 9 张表的迁移前后指纹一致。
- 固定 BE 工作区编译产物已保持在 `127.0.0.1:3320`。经营分析仅允许本地 3363 同源，翻译、供应商同步和公开索引在本地均关闭。网关直连 readiness、中文目录均 200，中文目录返回 191 辆。匿名报表 401，同源空事件 400，外来来源 403。未发送合成统计事件或改动车源。
- 就绪交接保存在本机 `docs/private/local-preview/gateway-3363/be-v2-api-ready.json`，供 OPS 与 PM 读取。复核 3363 官网及后台入口均为 200，样本库已有 v2 采集起点、心跳和本地事件回执。国家和每日 IP 估算仍缺本地网关鉴权。未连接生产，后台登录后的报表展示留待用户验收。

## 修订版匿名联系与页面请求

- `POST /api/v1/analytics/contact-count` 只接受 512 字节内的 `{vehicleId,channel}`，`channel=whatsapp|telegram`。成功 204，未公开车辆 404。客户端每次主动点击只发送一次，不带 Cookie／Referer，不自动重试。BE 只写车、小时、渠道、累计次数，不写事件记录或请求来源。生产需可信网关同时提供国家和内部密钥，并明确配置 `ANALYTICS_CONTACT_ALLOWED_COUNTRIES`。未知、未配置及未经可信代理证实的地区不计。仅回环测试允许 `ANALYTICS_CONTACT_LOCAL_ENABLED=true`。
- 管理员 `GET /api/v1/admin/analytics/traffic` 对应 `AnalyticsTrafficQuerySchema`／`AnalyticsTrafficResponseSchema`。`days`、`period` 或 `startDate/endDate` 三选一，最多 90 个北京时间自然日。`granularity=hour|day`，`rankBy=total|whatsapp|telegram`，`page/pageSize`。`locale/pageType` 只筛选文档请求，匿名联系没有这些维度。等长比较排除尚未结束的小时。完整覆盖只表示当前后端可观察范围完整，网关拦截或停机仍需结合 OPS 证据。旧 `overview` 和 `report` 保留，会话漏斗不会把匿名联系计数作为已授权的会话事件。
- OPS 关闭每小时后从网关导出一份 `{version:1,hour,status,rows}`，`hour` 为带时区的整点，`status=complete|partial`，行仅 `{locale,pageType,requests}`，最多 24 行。空的完整快照表示已观测零次。私有 CLI `node --import tsx src/analytics/traffic-import-cli.ts FILE` 依靠 `ANALYTICS_IMPORT_DATABASE` 明确数据库。重复导入等效内容不累加，同一小时有差异拒绝。导入、接线和栏位例子见本地共用 `docs/private/v2-analytics/be-anonymous-traffic-contract.md`。历史保留 90 天，归档超期查询主动隔离过期行。
- 0041 已在同一 `hd_local_preview` 原库备份后迁移，42 条迁移哈希、9 张业务表指纹核对一致。3320 持续运行，3363 API 就绪 200、匿名管理请求 401、同源非法正文 400、跨源 403。隔离 PostgreSQL 最新 9 项通过，实际管理员可以读取，旧统计路径回归 5 项通过。
- 19:22 北京时间在新版 3363 用真实 Chrome 新访客点击已发布样本车 WhatsApp 一次。恰好一次 POST，HTTP 204，同车 WhatsApp 0→1、Telegram 保持 0。请求体只有两个规定字段，无 Cookie、Referer、已同意会话请求或 Meta 请求。外站导航在浏览器验收中已拦截。证据保存在本机 `docs/private/be-v2/anonymous-contact-browser-proof.json`。生产未接入，旧广告配置也未用于本地验收。

## 滚动 60 分钟官网访问量

- 网关成功送达的公开 HTML 文档经私有异步 relay 进入 `POST /internal/analytics/ip-visits`。只接受可信直连和独立密钥，公开网关拒绝此路径。IP 归一后只在进程内用于计算 HMAC，应用和 relay 日志不记录源地址或标识，报表只返回聚合。临时去重键与独立的北京时间小时累计同事务落库，连接池上限 2。去重 60 分钟从上次计入起算，重复不延期。送达窗口 2 分钟，去重键过期时间为上次计入后 62 分钟。每分钟有界清理，小时聚合保留最近 90 个北京时间自然日。页面响应不等待入库。
- 管理员 `GET /api/v1/admin/analytics/traffic?include=unique-ip-visits` 在总量、趋势及等长对比中返回 `uniqueIpVisits` 和 `visitCoverage`，并以 `quality.visits` 提供采集状况。缺历史采集返回 `null`。完整归档且确实零次才返回 `0`，已知的正数可附部分覆盖提示。完整小时需要将独立 PV 审计和 relay 成功上送核对。旧接口响应、旧小时快照、文档请求量、匿名联系及旧会话口径保持兼容。联调载荷例子在主工作区私有 `docs/private/v2-analytics/be-ip-visits-contract.md`。
- 原 `hd_local_preview` 实例备份并核对目录后应用 0042，43 条迁移哈希一致，9 张业务表指纹迁移前后一致。3363 就绪 200，公开内部路径及直连未鉴权请求 404，已鉴权错误载荷 400，匿名管理请求 401。实际登陆后台的分日／分小时报表均 200。20:34 北京时间，真实浏览器先后打开中文及俄文页面均为 200，同一来源计入一次、去重一次，报表增加一次，浏览器没有发会话统计请求。证据保存在主工作区私有 `docs/private/v2-analytics/ip-visits-local/browser-evidence.json`。
- 隔离 PostgreSQL 16 项、配置与公开缓存 36 项通过，类型检查、构建、OpenAPI 生成及独立审查复查通过。覆盖 `10:59`／`11:01`／`11:59`、多连接竞争、重新连接、过期重放、部分覆盖、留存、非法来源、管理员权限、统计库故障下旧流量接口与官网可用。清理复查后仅重启 BE 的 3320，3363 就绪 200。生产默认关闭。生产启用前还要验证网关套接字访问、备份仅排除去重表数据及 PG 日志与 WAL 保留设置。

## 50 万隔离目录，回源与冷缓存

- OPS 初次复现的失败是回源拒绝。冷档 8／20，集中在英文稀有品牌和中文组合筛选的列表与筛选；并行同步 23／2,000，集中在俄文默认目录及中文组合筛选；Redis 断开 23／240，集中在稀有品牌和组合筛选。未观测到 PostgreSQL 连接获取超时或 3 秒截止超时。初测隔离档最多 4 路回源且零排队，正式运行已有 16 个等候名额。
- 新隔离环境可显式使用 `EXTERNAL_CACHE_MAX_QUEUED_LOADS=16` 对齐正式口径。正式 4 路回源、16 个排队上限及 3 秒截止时间维持。相同版本和请求键的并发调用共用一次有界 Redis 读取，缓存命中返回独立对象，版本、图片与汇率到期检查保持。后端配置和缓存 36 项定向测试、类型检查、独立复核通过。
- OPS `queue-matrix` 的 20 并发定向结果为冷缓存 20／20、同步 2,000／2,000、Redis 断开 240／240 返回 200。列表／筛选 P95 分别为 2,114／2,095 ms、57.7／60.3 ms、298.5／700.9 ms。冷档错误率通过，时延仍未通过 800 ms。复测使用了合并 Redis 读取的早期快照，之后修复了等待者共享返回对象的问题并定向复验。同步与 Redis 故障时延按所定列表／筛选分组判定。
- 同镜像冷档零排队 A/B 仅 10／20 成功。8 个真实回源的顺序探测分别耗 15–294 ms，均成功。这个结果说明应区分单 SQL 工作量和同波次资源竞争与等待，尚无依据提高回源并发或放宽请求超时。复测原始证据在主工作区 `docs/private/ops-v2-capacity/queue-matrix/`。
- 独立副本另对比 2 路和 4 路活动回源，都是 20 并发、16 等候、3 秒截止、500,023 辆。两组均 20／20 返回 200。列表／筛选 P95 分别为 1,543／1,527 ms 与 1,217／1,197 ms。两组最慢的均是中文纯电、2020 年起、6–12 万 CNY 的列表与概览筛选。无回源拒绝或 PostgreSQL 连接获取超时。每组重启隔离 PostgreSQL 和 Redis，宿主文件缓存未清空。当前单轮证据不足以变更正式并发上限，冷档仍不得记为达标。原始证据 `docs/private/be-v2/cold-origin-limits/evidence.json`，隔离副本和临时进程已清理。

### v2 封版复测

- 同一台 500,023 辆隔离 PostgreSQL 副本，按既有八路请求做 20 并发，每轮重启 PostgreSQL 并新建应用内存缓存。宿主文件缓存未清空。冷档复现中列表／筛选 P95 为 1,510／1,491 ms，20／20 返回 200。执行计划显示中文纯电、2020 年起、6–12 万 CNY 命中 21,402 辆三方车，精确计数与概览仍通过旧索引扫描大量无关项。
- 0044 新索引将动力、语言掩码、价格和年份一起过滤，覆盖精确计数与概览的必要字段。定向计划计数 41.8→6.3 ms，概览 23.3→9.8 ms，原有顺序取页仍约 7 ms。组合列表／筛选两轮 P95 为 180／221 ms 和 323／294 ms。各轮公开结果与原候选一致。整体 P95 分别为 550／492 ms 和 1,109／966 ms，第二轮俄语常见品牌仍超过 800 ms，整体门槛尚未稳定达标。实际网关、Redis 和同步负载交 OPS 同版验证。
- 0044 需要在生产迁移事务之外并发预建。OPS 收到确切 SQL。迁移比较同名索引的定义、父表及有效状态，较大库缺索引会失败退出。500,023 辆验证了缺预建和错误同名索引均拒绝，正确索引迁移前后 OID 相同。样本索引约 77.4 MiB。实验使用的合成库与输出均位于 BE 私有目录。
- 在目录列表及筛选的只读事务内限制每条 SQL 只使用一个 PostgreSQL 工作进程，避免四路冷回源各自启动并行查询。全局数据库和其他业务不受此事务设置影响。最终编译产物两轮冷档以 20 并发执行，每轮 20／20 返回 200，列表／筛选 P95 分别为 729.5／533.8 ms 和 403.3／454.6 ms。每轮公开内容和精确计数与基线相同。本机两轮通过 800 ms。使用独立应用内存缓存，正式网关、Redis 和同步负载需另按 OPS 同版证据确认。
- 封版回归通过共享契约 99 项、API 单测 300 项和 PostgreSQL 集成 61 项，以及 API 类型检查、构建、OpenAPI 和 hooks。SEO 专项验证旧详情、只请求 Pixel 的详情和新 SEO 请求在同一热缓存互不混用。证据在固定 BE 私有 `docs/private/be-v2/cold-query-release/`。

### 上线后 24 小时观测

- 管理接口 `/api/v1/admin/external/sync-timings` 可以采集撤回与改价从来源、收件、处理、详情到公开投影的阶段数据。滚动 24 小时目标应同时记录样本数量、未完成、失败、未被观测和覆盖槽。成功覆盖 288 个五分钟槽且采集起点足够早时，才标 `complete`。
- `publicEffectiveAt` 是数据库投影事务中的时间戳。公网真实生效须另在官网域名从现有已知车源观察详情访问、库存撤回和价格时间，保留响应时间与采样区间。OPS 原 SQL 的 `receipt_to_apply` 仅描述收到到处理阶段。HTTP 请求时延可根据 API `route/statusCode/elapsedMs` 和网关 `family/status/request_seconds` 做聚合，采集时核查日志轮转后的窗口完整性。生产观察窗未运行，SEO 开关另按门槛验收。
- 上线前独立审查还要求按生产同步事件及工作表的实际规模核定 0039 迁移时限，并确保所用逻辑备份不含 `analytics_ip_visit_keys` 数据。OPS 第一方备份候选已排除该表数据，完整逻辑备份的对应路径单独核对。
