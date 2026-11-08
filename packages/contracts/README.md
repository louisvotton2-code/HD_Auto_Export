# 共享接口契约

版本 `0.1.0`。提供 JSON 兼容的 Zod 4 schema、推导 TypeScript 类型和隔离测试样例；没有数据库模型、API 实现、供应商 SDK 或网络副作用。业务含义以 [车辆接口](../../docs/开发/车辆接口.md) 为入口，实际验证证据见 [后端任务](../../docs/协作/后端.md)。契约存在不代表对应服务已实现或通过联调。

## 公共出口

| 导入 | 用途 |
| --- | --- |
| `@hd/contracts` | 金额、日期、车辆事实、价格、语言、错误、版本等公共基础类型 |
| `@hd/contracts/public` | 官网车辆、首页、筛选、查询和响应 schema；不导出管理字段 |
| `@hd/contracts/admin` | 员工身份、车辆草稿、发布/库存操作、首页配置和媒体 schema |
| `@hd/contracts/fixtures` | 合成样例，仅供开发测试，不能当作真实库存 |

schema 名称带 `Schema` 后缀，相应 DTO 使用无后缀类型。应用声明显式 `workspace:*` 依赖，从以上出口导入，不深引 `src`。包使用 ESM 编译至 `dist`，各应用构建前先构建本包。

```sh
pnpm --filter @hd/contracts build
pnpm --filter @hd/contracts typecheck
pnpm --filter @hd/contracts test
```

测试使用 Node 内置运行器并先构建。依赖由工作区集成人统一安装和更新锁文件；本包自己的清单声明 Zod 与 TypeScript 精确版本。

## 草稿和正式展示

`VehicleDraftInput` 由 `source`、`facts`、`price`、`content`、`media`、`internal` 构成。接受 `source.kind=manual|demo|external`；manual／demo 仍只传 kind，external 元数据见下文。库存状态、核验时间和发布版本属于 `AdminVehicle`，不放入草稿，避免发布描述时意外恢复库存。创建请求为 `{draft}`，保存为 `{version,draft}`；发布/下架为 `{version}`，库存为 `{version,availability,checkedAt}`。媒体完成/删除携带媒体自身版本。本轮新增契约与服务验证状态按[车辆接口第 10 节](../../docs/开发/车辆接口.md)核对。

`facts` 明确保留未知值为 `null`；年款、制造日期、首次登记互不替代。金额使用最多两位小数的非负十进制字符串，币种必须在 `SUPPORTED_CURRENCIES` 的已支持 ISO 4217 集合中；需要新币种时更新此集合与消费者验证，不接受任意三字母占位值。支持币种不代表已有换算汇率。`on_request` 必须 `money:null`，`asking/reference` 必须有金额。日期按 year/month/day 精度验证历法，时间戳必须 UTC ISO 格式。

管理字段 `internal` 保存采购成本、备注、供应商联系方式及 VIN。公开接口先按白名单构造对象，再运行 `PublicVehicleSchema`；schema 对未知字段报错，而非静默删除泄漏字段。前端显式映射正式 DTO，不复用旧 `priceUsd` 演示模型。

公开详情包含 `facts`、`price`、`content`、`images` 和即时库存状态，详情路径固定 `/{locale}/cars/{id}/`。普通响应为 `{data,meta:{requestId}}`；列表元数据另含目录、总量、可访问总量、数据时间和新鲜度。首页为 `data.sections[].vehicles`；筛选字典为 `data.{catalog,makes,models,powertrains}`，动力标签由消费者多语字典显示。

`AdminHomeSections` 为 `{version,sections:[{id,title:{zh,en,ru},vehicleIds}]}`，固定两个区块；公开响应隐藏空区块。必需的展示名称、译文和区块标题不接受纯空白。

上传请求必须声明 `rights:{basis:'owned'|'permission'|'unverified',note,source?}`，`note` 是非空白的来源/授权说明；可选 source 为 `{listingUrl,imageUrl,collectedAt}`，两个 URL 使用 `SafeHttpUrlSchema`。管理媒体记录保留该声明，公开媒体不返回。external 发布必须逐图有 source，listingUrl 与车辆一致；unverified 仅表示本地许可待核验，不能作为生产许可。manual／demo 发布仍只接受 owned／permission。上传许可响应为 `data.{media,method,uploadUrl,expiresAt}`，文件通过认证的 PUT 地址传输。媒体完成仅说明已通过处理，公开授权仍由 API 根据有效发布引用控制；不公开上传原文件或整个本地存储目录。

`PublicMediaQuerySchema` 只接受可选 `{variant:'thumb'}`，对应公开媒体宽度上限 240px、等比且不放大的 WebP 缩略图，竖图高度可超过 240px；其他变换参数拒绝。公开 images[].url 仍给原图地址，FE 可按 id 固定构造 `/api/v1/media/{id}?variant=thumb`，此形式通过 `MediaUrlSchema`。缩略图与原图执行相同的发布／删除可见性检查。

### 演示车辆边界

公共 `SourceSchema` 支持 manual/external/demo，消费者必须识别 demo 的演示性质，不能将其标为真实库存。demo 价格只允许 `on_request` 且 `money:null`；制造日期、首次登记、里程、所在地必须为 null，登记状态必须为 unknown，管理草稿 VIN 必须为 null。年款、动力、排量、功率、车身和变速箱可使用有来源的车型规范资料，不能据此推造实车事实。

公开 demo 的库存固定 `availability:unknown`、`availabilityCheckedAt:null`。上述字段组合由草稿和公开 schema 校验；创建后禁止切换来源类型、禁止 demo 库存操作等业务限制由服务执行，使用 `DEMO_RESTRICTION`。不要通过更新 expectedVersion 自动绕过限制。

demo 发布是明确的非人审例外：服务允许当前原文版本、非空的 pending 或 approved 文本，但拒绝 stale 和旧版本；公开标题及非空描述的 `reviewed` 始终为 false，公共 schema 拒绝 demo 的 `reviewed:true`。这不会放宽 manual 车辆的发布门槛，manual 仍要求当前版本的 approved 内容，公开投影保持 `reviewed:true`。

`makeDemoVehicleDraftFixture()`、`demoVehicleDraftFixture`、`demoPublicVehicleFixture` 和 `contractFixtures.demoDraft/demoPublic` 提供隔离的合成界面样例；不创建运营或试用记录。标题和描述的中文为 original/pending，英俄文为 machine/pending，人工编辑版本为 0；公开俄文样例为 machine 且 reviewed 为 false。复制后再修改，fixture 图片 ID 不能直接用于真实 API 上传绑定；需要创建空草稿时先将 media 置为空数组。样例采购成本为 null，备注说明合成来源。

### 外部资料边界

`ExternalVehicleSourceSchema` 为 `{kind:'external',platform:{id,name},listingUrl,externalId,collectedAt,sourceUpdatedAt}`；sourceUpdatedAt 可为 null，其余必填。平台 name 非空白且最多 120 字符，externalId 非空白且最多 300 字符，URL 为最多 2048 字符、无凭据的 HTTP(S) 地址。schema 保留 URL 原字符串，不静默归一化来源身份，也不发起远程下载。

external 允许真实观察字段，未知保持 null；价格只能 reference／on_request，公开库存 unknown／null，公开文字 reviewed=false。服务负责三语当前版本、非空、pending／approved、非 stale、original 与原文匹配，以及图片发布条件。source.kind、external platform.id／externalId 创建后不可变；服务在包含回收站的记录中保证平台＋externalId 唯一，冲突使用 SOURCE_IDENTITY_CONFLICT，外部库存／身份限制使用 EXTERNAL_RESTRICTION。

公开 `SourceSchema` 只返回 external 的 kind／platform／listingUrl，不返回 externalId、采集内部字段或图片依据。公开 fetchedAt 对应 collectedAt，sourceUpdatedAt 对应上游时间。`makeExternalVehicleDraftFixture()`、`makePublicExternalVehicleFixture()` 和 `contractFixtures.externalDraft/externalPublic` 是 example.invalid 合成样例；三语状态及来源与 demo fixture 同样明确，不是运营数据或外部接入证据。

### 回收站与历史回执

`AdminVehicle.deletedAt` 为 UTC 时间或 null；缺失字段解析为 null，以兼容旧幂等回执。列表 `deleted=exclude|only` 默认 exclude；详情 `AdminVehicleDetailQuerySchema.includeDeleted` 只接受字符串 false／true，默认 false。`DeleteVehicleRequestSchema`、`RestoreVehicleRequestSchema` 均为 `{version}`，请求必填幂等 key，响应复用 `AdminVehicleResponseSchema`。

删除后的普通访问均为 404，员工只能通过上述回收站查询读取；删除清除首页引用且保留历史和媒体。恢复为草稿、无发布指针／时间、库存 unknown／null，版本增加但不自动回首页。服务负责事务、权限、版本和 24 小时幂等；旧回执只重放历史结果，不恢复当前状态，客户端成功后须重读。`contractFixtures.deleted` 仅用于隔离界面开发。

## 多语与版本

`content.title` 和 `content.description` 各是独立 `TranslatableField`：`sourceLanguage`、`sourceText`、`sourceVersion` 和 `translations.{zh,en,ru}`。来源语言允许短 BCP47 样式，如 `ko`、`zh-CN`；目标语言固定三种。`original` 要求基础语言匹配且与原文字串完全一致；例如 zh-CN 原文可在 zh 栏审核，公开 `contentLocale` 保留 zh-CN。员工改写或转换字形应使用 human。

每个译文记录 `text`、`kind`（original/machine/human）、`reviewStatus`（pending/approved/stale）、`sourceVersion`、`humanEditVersion`、`engineVersion`。缺失原文/译文为 `null`。schema 可表示未翻译、待审、过期等草稿，不将它们自动升级为已审核。API 负责校验版本、计算原文 hash、保护人工编辑和执行发布门槛；浏览器类型校验不能代替这些规则。

公开文本只含 `text`、`requestedLocale`、`contentLocale`、`kind`、`reviewed`。`kind` 表示产生方式，`reviewed` 独立表示是否已人工审核；manual 的机器译文审核通过仍保留 `kind:machine`，demo／external 按上述例外始终不声明人审。此形状支持未来经明确批准的原文回退，但不自行授权降级；manual 车辆仍按三语审核门槛发布。引擎版本、源版本和详细审核过程只在管理契约。

### 多语言固定样例

从 `@hd/contracts/fixtures` 导入 `contractFixtures`。以下均为合成情景，外部来源/翻译任务尚未运行；需要修改样例时先 `structuredClone`。

| 情景 | 样例 | 预期消费行为 |
| --- | --- | --- |
| 单语来源 | `untranslatedKorean` | 标题保留韩语原文，三语标题为 null；描述沿用基础样例，当前不满足精选发布条件 |
| 混合审核状态 | `pendingTranslation` | 中文原文标题/英文人工标题已审核，俄语机器标题待审；不能把机器来源显示成人工译文 |
| 翻译中（后续任务模拟） | `untranslatedKorean` | 原文标题已入库，等待译文时仍保持相同草稿，不伪造目标标题 |
| 翻译失败（后续任务模拟） | `untranslatedKorean` | 保存结果与等待时相同，失败不清除原文标题、不改变库存；不能仅凭 null 译文判断任务失败 |
| 原文更新 | `staleTranslation` | 标题原文版本提高，旧标题译文不满足当前版本发布门槛，需复核 |

翻译中与翻译失败复用同一份已保存内容，说明任务状态与车辆内容分离。BE-04/BE-I18N-01 接入 worker 时另交内部任务状态样例和接口；本期不虚构正在运行的任务、供应商错误或公开失败详情。

## OpenAPI 和适配

API 从这些 schema 生成 JSON Schema，并组合路径、状态码和安全元数据，不复制手写类型。schema 可用 `z.toJSONSchema` 转为 Draft 2020-12，保持 `unrepresentable:'throw'`。日历、重复媒体等附加约束仍需执行 Zod 校验，JSON Schema 不包含全部业务检查。

查询 schema 表达规范化后的逻辑输入，分页参数为数字；HTTP 层须严格处理 URL 整数文本后再校验，不能把空白或非数值静默变成默认值。公开查询默认 `locale=ru`、`catalog=curated`、`page=1`、`pageSize=24`，最大 48；market 目录及价格排序不在首期范围。业务错误为 `ApiError`，字段路径为点路径字符串；鉴权库原生响应不套此 envelope。

管理列表使用 `AdminVehicleQuerySchema` 和推导类型 `AdminVehicleQuery`，保留 `publicationState`、`availability`、`page`、`pageSize`，支持可选 `q`、`make`、`model`、`powertrain` 和上述 deleted；不接收 `locale` 或 `catalog`。`q` 去除首尾空白后最多 100 个字符，拒绝 NUL；空字符串或纯空白规范化为 `''`，服务忽略空搜索并保持原列表行为。非空搜索匹配稳定车号、当前草稿的品牌/车型名称及原文标题，采用不区分大小写的字面子串，`%`、`_`、反斜线不作通配符。分类筛选也针对当前草稿，`make/model` 复用规范 ID，`powertrain` 复用动力枚举，和状态筛选共同生效。

公开列表和筛选字典的 `PublicVehicleQuerySchema`／`PublicFilterQuerySchema` 同样接受 q，复用 `SearchTextSchema` 边界。服务只搜索 stockCode、已发布的当前 locale 标题、品牌／车型 name，不搜索草稿、内部或其他语言；字典携带同一 locale／q 后按相同公开集合统计。列表已有分类条件与 q 按 AND 组合，计数与分页采用同一条件。

### 管理筛选字典与批量操作

`GET /api/v1/admin/vehicle-filters` 使用 `AdminVehicleFiltersQuerySchema` 和 `AdminVehicleFiltersResponseSchema`。响应 `data.scope=all_inventory`，按当前草稿统计所有未删除记录，包括草稿、已发布与下架车辆；返回 makes/models/powertrains 及非负整数 count。可选查询 make 仅限制 models，makes 和 powertrains 仍统计所有未删除记录，不随当前分页、关键词或库存筛选缩小。

`POST /api/v1/admin/vehicles/bulk` 使用 `BulkVehicleMutationRequestSchema`，必填 `Idempotency-Key`。每批 items 为 1–50 个 `{id:UUID,expectedVersion}`，UUID 不区分大小写识别重复；重复或请求形状非法时整批拒绝。operation 为 availability 时另带 availability 和 UTC checkedAt；archive 不能携带库存字段。

`BulkVehicleMutationResponseSchema` 返回 operation、逐项 results 和 summary。成功项带新 version、发布与库存状态及核验时间；失败项仅含 NOT_FOUND、VERSION_CONFLICT、DEMO_RESTRICTION 或 EXTERNAL_RESTRICTION 和 `retryable:false`。summary 与结果数量和成功/失败状态一致，不能把部分成功显示为整批成功。精确原请求在 24 小时幂等保留期内重试返回原结果；失败项不会自动改用新版本重试。员工须重新读取并处理冲突，再明确发起新的操作。

兼容性变更同时更新 schema、fixtures、接口说明与受影响消费者。包内版本不表示独立部署已同步，破坏变更须由集成人安排消费者协调升级。
