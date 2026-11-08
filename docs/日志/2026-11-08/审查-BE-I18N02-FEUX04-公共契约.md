# I18N02 + FEUX04 契约独立审查与修复复查

审查者：`/root/contract_review`；实现者：root。HEAD 为 `fdf6c6bc52b3a40761c4f991dde8e1f6a0fad028`，复查对象是当前未提交的 contracts 增量，源码及既有 dist 指纹列于文末。

**结论：原 3 项 P2 已修复并定向复查关闭；最终字段长度增量也复查通过，当前契约范围无已确认阻塞。** 公共出口与 UUID 引用校验建议也已修复。展示 sourceHash 语义已与新服务实现核对，合成 fixture 值有效；仅建议交接文档明确与旧 title hash 的区别。此结论不等于完整 API、数据库侧表发布、FE/AD 联调或生产验收通过。

本轮严格只读共享工作区；未构建、修改 dist、安装依赖、访问数据库或调用外部服务。唯一写入是这份临时审查报告。

## 原问题关闭证据

1. **非法金额触发 BigInt 异常：已关闭。** 比较前分别调用 Money amount 的 safeParse，仅在两边都是合法十进制字符串后转换。审查方直接对已编译的列表及筛选 schema，分别把 abc、1e3、1.234、1.2.3、负数、空串和超位数放入上下界验证，均返回失败且不抛异常；最大合法金额相邻分值的正序通过、倒序拒绝。
2. **localized demo 被旧 strict facts 误拒绝：已关闭。** demo 校验已显式容纳可选 generation/drivetrain。审查方分别验证二者为 null 和已知 generation/awd 均接受；同一数据加入 mileageKm=0 仍拒绝，实车字段限制没有放宽。
3. **DisplayText 状态矛盾：已关闭。** 已改成 status 判别联合。ready 要求非空白 text、非 null contentLocale/provenance；missing 固定 text/contentLocale/provenance=null、reviewed=false。原 ready+全null 与 missing+空白/human/reviewedtrue 两种复现都拒绝；正常 ready/missing 接受，空白和内部 sourceHash/engineVersion 仍拒绝。

公共入口现在只显式导出 Drivetrain、VehicleExtraFacts、DisplayText、VehicleDisplay 的 schema/type；运行时确认 SaveVehicleLocalization、GenerateDisplayTranslations、DisplayField 不再从 public 导出，admin 仍可用。DisplayRef 已进一步验证实际 UUID，36 个连字符拒绝，正常 media 和 price.includes UUID 引用接受。旧 PublicFilterQuery 禁 make 的测试期望已按新联动契约更新。

## 实际检查与边界

- 本轮 `pnpm hooks:check` 与 contracts 限定 `git diff --check` 通过。
- 前轮审查方执行现有 dist 的 **55 组定向断言**全部通过；本次最终长度增量另执行 **81 组边界断言**全部通过。两轮均未重复完整 check/test，也未重新编译。
- 已阅读作者 `/private/tmp/hd-i18n02-contracts.log`：最新记录 contracts 38 项全部通过；localization.test.mjs 覆盖上述修复、金额/分类范围、精确品牌别名及俄文字段长度边界。该 38 项为作者执行记录，不冒称审查方全量执行。
- 旧 manual 公开 fixture 经新 schema.parse 后深度相等，不默认注入 display/generation/drivetrain；这证明 schema 兼容，实际 HTTP opt-in 仍待服务验收。
- 当前目录 37 项，Bestune/MHero/GAC 能精确按别名匹配，未知名称不作模糊猜测，不改原人工 ID。闭合 drivetrain 枚举以 null 表示未知，后续扩枚举仍须同步消费者。

## 展示 sourceHash 的补充确认

已只读核对 `apps/api/src/vehicles/localization.ts:13,22-29,61-65`：展示 sourceHash 由服务端计算为 SHA256(JSON.stringify([ref,bindingHash,sourceLanguage,sourceText]))，bindingHash 绑定品牌/车型/国家/分组/媒体等身份，不公开给客户端。它与旧 title/description 的二元 hash 定义不同。

客户端应将展示 sourceHash 视为 opaque 标识，对比 fresh GET、发起时快照与建议回包；不能用旧 title 的二元算法自行重算。`makeVehicleLocalizationFixture()` 的 64 个 a 是没有真实绑定上下文的固定合成版本标识，可保持。审查中早先建议替换为二元 hash 是对新语义的错误假设，现已撤回，不作为遗留缺陷。

建议交接文档明确这一区别以及 fixture 的合成性质，防止未来消费者混用算法；无需在当前冻结期间修改 contracts。

## 本次契约复查未覆盖的完整服务边界

- 默认/legacy 列表、详情、首页、筛选保持旧 JSON 字段；仅 view=localized 输出新事实、display 与扩展 facets，不泄漏源 hash、原文、引擎或任务资料。
- 服务端按 ref 与 binding 上下文重算展示 sourceHash（客户端只做 opaque 比较），保存/采用建议同时核对 vehicleVersion、revision、sourceVersion、人工编辑版本；迟到建议、原文修改、媒体和 price.includes 重排不能错绑 ref 或覆盖新版本。
- 侧表保存不改旧 draft/publication JSON；未发布修改不可提前公开，发布/删除/恢复必须保证侧表与公开投影的版本一致。demo/external 新 display 的审核标识及 catalog 例外如有，应明确规则并覆盖测试。
- items、计数、分页和 facets 使用同一公开过滤集合；未知金额/里程/年份不能视为零，金额只在显式币种内比较。

## 最终长度增量复查

`getDisplayTextLimit(ref)` 与既有公开字段约束一致：make/model/trim/generation/city/platform 为 120；location.displayName 与 price.includes 为 200；media alt 为 500。DisplayField 的 superRefine 同时限制 sourceText 和中英俄三个译文，未扩大 PublicVehicle/NamedValue 的既有上限。

审查方在冻结的现有 dist 上对全部 9 类 ref 分别验证：俄文 Ж 恰好上限时原字符串保持不变；sourceText 或任一目标语言超出 1 字符时拒绝；共 81 组断言全部通过，没有截断。直接核对 translation.ts:125 使用同一 getDisplayTextLimit，在翻译返回超限时抛出上游错误，不截取内容。此处仅只读代码复核，没有发起外部翻译调用。

最新作者日志记录 contracts 38/38。作者另报告 DB46 及俄文 model 120 的 list/detail/home/facets 和 121 PUT 行为通过；本审查未连接数据库或重跑该集成流程，不将其列为审查方亲测证据。公共 DTO 的源码和 dist/public.js 指纹与上一轮一致，说明本增量未通过扩大公开字段上限绕过问题。

## 当前源码指纹 SHA256

- src/localization.ts：`312f7ae02c58443a694b3d5a10ae249ff5a84fb48dffd0942a1ccb76bd4137a6`
- src/catalog.ts：`857fbfbb8070ef567aee51efccd3ebffa84f55b95c10b9e79088ab1a490a956f`
- src/public.ts：`cdd08524e5b1adf93804d8e00a5c7aac892ffe036b72a5572553ebf5cf5cb929`
- src/admin.ts：`6e8930bdcc70b5e7e06ce3deb2a43c3b36d868a68154693fdf7ebae358a35a39`
- src/common.ts：`cfbdc352c77b6350c5a0b1cb5776350518baf4e8937bc03a8fa692d0323c8cef`
- src/fixtures.ts：`c15acde416d717a0b09e374676b04277d49b6946c7a854198154e3f959d60b69`
- tests/contracts.test.mjs：`45fad43db9baafc06e632c1dca9c93167d8b9a2f933fcd1e47db229a759b053d`
- tests/localization.test.mjs：`68d3972821459947a5375b9e127f7fd1d912960f2fe5f58204e3d8b27be95121`

## 本轮定向复查使用的既有 dist 指纹 SHA256

- localization.js：`7de211d20cf6f228cd115ed619b0beb30cd25c058768c36dfcd3b8c2b0adbd4e`
- public.js：`c4d918a8ffc6af15e29a18275436198ee92d4ee91effc385fec9acfec0bb593d`
- catalog.js：`24fc025971e59b48d00885e2947309c41fb1232e3e35dc5fb27e44b8851fbeed`
- fixtures.js：`1b429127ae624024786de33c928d08a44fd228536fa28e2804fe946f92a2d730`

附加只读代码复核：apps/api/src/vehicles/translation.ts SHA256 为 `b11590263d807cc062c1cfa4bd43e0abc09851c058d71099bc2dd203c1363fdc`，仅核对长度拒绝逻辑，不作为该文件完整服务审查。

源码或成品再次变化后，需要按变化范围复核，不能将本报告直接用于其他提交或最终推送门禁。
