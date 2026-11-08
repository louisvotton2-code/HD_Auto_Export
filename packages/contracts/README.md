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

`VehicleDraftInput` 由 `source`、`facts`、`price`、`content`、`media`、`internal` 构成。首期仅接受 `source.kind=manual`。库存状态、核验时间和发布版本属于 `AdminVehicle`，不放入草稿，避免发布描述时意外恢复库存。创建请求为 `{draft}`，保存为 `{version,draft}`；发布/下架为 `{version}`，库存为 `{version,availability,checkedAt}`。媒体完成/删除携带媒体自身版本。

`facts` 明确保留未知值为 `null`；年款、制造日期、首次登记互不替代。金额使用最多两位小数的非负十进制字符串，币种必须在 `SUPPORTED_CURRENCIES` 的已支持 ISO 4217 集合中；需要新币种时更新此集合与消费者验证，不接受任意三字母占位值。支持币种不代表已有换算汇率。`on_request` 必须 `money:null`，`asking/reference` 必须有金额。日期按 year/month/day 精度验证历法，时间戳必须 UTC ISO 格式。

管理字段 `internal` 保存采购成本、备注、供应商联系方式及 VIN。公开接口先按白名单构造对象，再运行 `PublicVehicleSchema`；schema 对未知字段报错，而非静默删除泄漏字段。前端显式映射正式 DTO，不复用旧 `priceUsd` 演示模型。

公开详情包含 `facts`、`price`、`content`、`images` 和即时库存状态，详情路径固定 `/{locale}/cars/{id}/`。普通响应为 `{data,meta:{requestId}}`；列表元数据另含目录、总量、可访问总量、数据时间和新鲜度。首页为 `data.sections[].vehicles`；筛选字典为 `data.{catalog,makes,models,powertrains}`，动力标签由消费者多语字典显示。

`AdminHomeSections` 为 `{version,sections:[{id,title:{zh,en,ru},vehicleIds}]}`，固定两个区块；公开响应隐藏空区块。必需的展示名称、译文和区块标题不接受纯空白。

上传请求必须声明 `rights:{basis:'owned'|'permission',note}`，`note` 是非空白的来源/授权说明；管理媒体记录保留该声明，公开媒体不返回。上传许可响应为 `data.{media,method,uploadUrl,expiresAt}`，文件通过认证的 PUT 地址传输。媒体完成仅说明已通过处理，公开授权仍由 API 根据有效发布引用控制；不公开原图或整个本地存储目录。

## 多语与版本

`content.title` 和 `content.description` 各是独立 `TranslatableField`：`sourceLanguage`、`sourceText`、`sourceVersion` 和 `translations.{zh,en,ru}`。来源语言允许短 BCP47 样式，如 `ko`、`zh-CN`；目标语言固定三种。

每个译文记录 `text`、`kind`（original/machine/human）、`reviewStatus`（pending/approved/stale）、`sourceVersion`、`humanEditVersion`、`engineVersion`。缺失原文/译文为 `null`。schema 可表示未翻译、待审、过期等草稿，不将它们自动升级为已审核。API 负责校验版本、计算原文 hash、保护人工编辑和执行发布门槛；浏览器类型校验不能代替这些规则。

公开文本只含 `text`、`requestedLocale`、`contentLocale`、`kind`、`reviewed`。`kind` 表示产生方式，`reviewed` 独立表示是否已人工审核；机器译文审核通过仍保留 `kind:machine`。此形状支持未来经明确批准的原文回退，但不自行授权降级；人工精选仍按三语审核门槛发布。引擎版本、源版本和详细审核过程只在管理契约。

## OpenAPI 和适配

API 从这些 schema 生成 JSON Schema，并组合路径、状态码和安全元数据，不复制手写类型。schema 可用 `z.toJSONSchema` 转为 Draft 2020-12，保持 `unrepresentable:'throw'`。日历、重复媒体等附加约束仍需执行 Zod 校验，JSON Schema 不包含全部业务检查。

查询 schema 表达规范化后的逻辑输入，分页参数为数字；HTTP 层须严格处理 URL 整数文本后再校验，不能把空白或非数值静默变成默认值。默认 `locale=ru`、`catalog=curated`、`page=1`、`pageSize=24`，最大 48；market 目录及价格排序不在首期范围。业务错误为 `ApiError`，字段路径为点路径字符串；鉴权库原生响应不套此 envelope。

兼容性变更同时更新 schema、fixtures、接口说明与受影响消费者。包内版本不表示独立部署已同步，破坏变更须由集成人安排消费者协调升级。
