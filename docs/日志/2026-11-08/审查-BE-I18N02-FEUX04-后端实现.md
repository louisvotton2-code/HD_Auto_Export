# I18N02 + FEUX04 后端独立审查与终审复查

日期：2026-11-08（Asia/Shanghai）。Reviewer：`/root/backend_review`；公开 SQL 和回执迁移由独立子 Reviewer `/root/backend_review/db_review` 协助审查。均非本轮代码作者。

## 当前结论与范围

**后端范围终审通过：发现的 5 项 P2 已修复并复查，关联字段长度修复及旧回执兼容验证也已核对，没有剩余确认的阻塞问题。** 本结论绑定下方源码与构建指纹；不等于验收库已执行 0003、真实运行切换或生产验收完成。

受审范围为 `apps/api/src/vehicles/localization.ts`、`service.ts`、`translation.ts`、`apps/api/src/app.ts`、`apps/api/migrations/0003_vehicle_localization.sql` 和 migration journal，关联契约仅为理解调用边界而读取。公共契约的独立审查由其他 Reviewer 负责，本报告不替代其结论。

审查方实际执行了 `pnpm hooks:check` 和本地文件摘要核对，均通过；只读核对作者的测试源码、日志及隔离升级脚本/结果。没有重跑单元测试、集成测试、构建、实际 API 请求、数据库访问或付费翻译，没有修改共享源码、服务或业务数据。作者执行结果与审查方亲自执行的检查在本报告中分别记录。

## 发现与修复复查

1. **P2：首次保存 localization 的大小写车辆 UUID 不一致，已关闭。** GET 使用 PG 返回的小写 id，而 PUT 原先将路径 id 原样传入；无 sidecar 时 `price.includes` 稳定 ref 包含该 id，大写路径导致合法输入误报 409。现 `syncLocalization` 首先将车辆 id 小写，所有调用共用；作者通过的 PG46 包含首次 PUT 大写 UUID 用例。
2. **P2：历史大写图片 UUID 生成不合法 DisplayRef，已关闭。** 原草稿契约和 PG 支持大写 UUID，而 `media.<id>.alt` ref 仅允许小写，导致 GET localization 解析失败。现 source binding、ref 和公开投影 lookup 均使用小写媒体 id，原发布 JSON 不需重写。已核对 `vehicle/media UUID casing does not change display bindings or alt projection` 回归与作者 API95 通过记录。
3. **P2：新展示字段翻译超时被映射为 500，已关闭。** `generateDisplay` 原先只有 finally；25 秒 deadline 的 TimeoutError 可从 `text`/共享等待直接传出。现 catch 保留已有 ApiError，其余统一转可重试 `TRANSLATION_UPSTREAM_FAILED` 503。受控 AbortController 回归断言 status/code/retryable，并见作者 API95 通过记录。
4. **P2：漏执行 0003 时 readiness 假阳性，已关闭。** 车辆公开/管理查询已无条件使用新 sidecar 表，原 readiness 仅验证 0002 字段。现 readiness 同时验证三张 0003 必需表/字段。独立阅读的隔离升级脚本先运行旧迁移，确认新 app ready=503，再执行 0003 后确认 ready=200；作者结果记录通过。
5. **P2：旧快照品牌显示与 localized q 不一致，已关闭。** SQL 原先先 btrim 再 NFKC，而展示使用 NFKC 后去除首尾空白。现 SQL 改为 NFKC、折叠空白（含 BOM）、最后 btrim。作者 PG46 包含非目录品牌 ID 配合 `　丰田　`、尚无 publication sidecar 时 q=Toyota 的回归，英文标题不含 Toyota，不会掩盖该路径。

关联 AD 发现的字段长度 P2 也已复查：新 `getDisplayTextLimit` 按 ref 使用 120/200/500，与原公开 DTO 一致；契约拒绝超限原文及各语言译文，provider 超限返回上游错误，不截断内容。作者 PG46 验证俄文 model 120 字符在列表、详情、首页、筛选四出口均为 200，121 字符保存为 400；契约 Reviewer 已另完成 81 组长度边界断言。

## 主流程审查

- localization GET 仅派生允许公开的车型、配置、所在地、来源平台、价格包含项和图片 alt；不持久化、不调用 MT，未发现内部备注、联系方式、VIN 等字段进入翻译输入的路径。
- sourceHash 绑定 ref、父级身份、源语言与原文；品牌/车型、地区、图片身份和价格包含项组变化会推进源版本并保留旧译文为 stale。纯金额变化不重译这些展示字段。
- 保存同时检查车辆版本、localization revision、字段 sourceHash/sourceVersion 与逐语言 humanEditVersion。车辆保存、sidecar 保存、发布共用 vehicle 行锁和事务；翻译等待不持有事务，返回后重新检查版本，旧建议不直接写入源数据。
- 发布在同一事务中写不可变车辆快照、publication localization 与各语言 projection，并更新发布指针；草稿 sidecar 编辑不修改线上 projection。新 sidecar 要求当前译文；人工库存要求 approved，demo/external 的当前 pending 可以发布但不会冒充人工审核。
- 公开 localized projection 不回退输出未准备好的原名；展示来源、实际语言、缺失状态与审核性质分开，sourceHash、engineVersion、人工版本及内部原文不进入公开响应。旧接口可保持 legacy 行为。
- 结构化金额使用 numeric 且按指定原币过滤；年款是 modelYear 区间，未知/null 不当作 0；trim/generation 遵守父级筛选要求。列表、count、筛选字典共用条件，分页使用一致读快照和稳定顺序；localized q 使用相同发布投影。
- 库存、下架、软删除仍通过车辆当前状态即时控制公开资格，不依赖翻译任务完成。

## 旧回执兼容与迁移边界

新实现把 `hasUnpublishedChanges` 从历史 AdminVehicle 回执 body 移出，保存在 `idempotency_vehicle_metadata`，并以数据库 `md5(response::text)` 绑定该份历史 body。body/metadata 在同一事务保存；命中使用 advisory lock 串行化并从 metadata 恢复新 DTO，缺 metadata 时使用 null，避免拿当前车辆状态伪造历史结果。

0003 的拆分语句仅作用于共享单车操作且已有该字段的回执：先保存拆分后 body 的摘要与原布尔值，再移除 body 字段；不删除回执，不修改请求 hash 或 expires_at。sidecar 表为增量结构，旧业务 JSON 继续保持旧严格 DTO 可读。publication localization 有不可变触发器。

此前运行回退审查保留的 receipt P2，现已在本次受审新版实现与 0003 迁移的配合范围内关闭。作者已通过 `verify-i18n02-rollback.mjs`，两个 Reviewer 只读核对脚本及结果：

- 使用随机测试库、临时媒体目录、disabled provider 和 app.inject，不指向验收数据库，不监听服务。
- 先执行 fdf 旧迁移，再用冻结 I18N01 compiled API 生成 create/publish/delete/restore 共 4 条带字段回执。
- 执行 0003 后逐行比较，只有新字段从 body 移出；actor/operation/key、request_hash、expiry 与剩余业务 body 完全保留。
- 新版再生成 4 条回执；新版按同 key 重放全部 8 条，完整结果（含原布尔值）一致；真实 fdf 旧 compiled API 按同 key 重放同样 8 条，结果等于移除新增字段后的历史 DTO。
- 全部重放前后 vehicles、vehicle_publications、audit_events 总数相同。没有换 key、删除或重建回执来规避兼容性。

“迁移前后 8 条”指两批回执的生成时间；旧 compiled API 的重放都发生在迁移完成之后。该证据不意味着尚未迁移的真实运行库已获得兼容性，也不把此前未关闭的历史审查记录改写为当时已经通过。Reviewer 未亲自执行这段数据库脚本。

## 作者自测与审查方核验

已实际读取作者日志：`/private/tmp/hd-i18n02-contracts.log` 为 contracts 38/38；`/private/tmp/hd-i18n02-api.log` 为 API 95/95；`/private/tmp/hd-i18n02-integration.log` 为隔离 PostgreSQL 46/46，均 fail/cancelled/skipped=0。已读取通过的旧 compiled 回放结果 `i18n02-rollback-result.json`，记录 8 条回执、paidCalls=0、acceptanceDatabaseAccessed=false。

作者说明的初次失败与处理：ready 的旧精确 SQL mock 未覆盖新查询，更新 mock 后 API95 重跑通过；新增 PG 用例最初位于 logout 之后产生 401，调整测试顺序后 PG46 全过；独立升级 harness 的 pool=1 无法同时满足迁移锁与事务连接，调整为 pool=2 后通过。这些不是被忽略的失败或真实库修补。作者另报告 build、OpenAPI 和 workspace28 通过；本 Reviewer 没有重跑这些检查。

## 最终版本绑定

当前 HEAD 为 `fdf6c6bc52b3a40761c4f991dde8e1f6a0fad028`，本轮改动仍未提交；不能把 HEAD 本身当作本轮实现指纹。

审查方独立重算聚合摘要（递归普通文件按 repo-relative POSIX 路径排序，将 UTF-8 路径、NUL、文件 SHA256 原始 32 字节依次馈入 SHA256）：

- `apps/api/src`：28 文件，`d9c428bb3d4e072278c0b8f786db1ae90d1305e1347ed24b729f9d4a16d57a17`。
- `packages/contracts/src`：7 文件，`3835472f023e6cc0809849bdf2ab2288bedc05fc415f3edb6149462c6bee2f3c`；公共契约完整审查另见 `/private/tmp/hd-i18n02-contract-review.md`。
- 0003 SQL：`32ffb5c812a03f0e19fd12f0d6206cad75995c9bf03f82c94006d90d54386ac7`。

四个当前 compiled 成品均与 `i18n02-consumer-build.json` 一致：app.js `d3f1cc5398787bb4f7ad758c33d35e1390d8d0eba0a3a8b98fd09211aa4b061c`；vehicles/service.js `a588b73bdf7894c435d072c42bafb0680c7461a0865bf9d7fe1155cd56220a31`；vehicles/localization.js `b25d785047cb0c52dd875b13e133f1f123f92e506f3156c3ae078d2ebda429b0`；vehicles/translation.js `1b0b594b02081cb19b1be177c99f64b6d004a4216175057c50be31d9897a43d3`。

回放所用旧 rollback artifact 的 103 个文件再次完整校验通过，冻结 I18N01 的 4 个 expectedArtifacts 也再次符合原 manifest，补足隔离脚本仅检查 manifest 的版本绑定边界。

完整逐文件清单：`/private/tmp/hd-i18n02-backend-reviewed-files.json`，含 40 个源码/测试/迁移文件、4 个 compiled 文件和 6 份验证证据；清单 SHA256 为 `0432af8fc3c4babd36e9b24e0a18a39a42c260f3e2fddc395e03ddafdb06d538`。其中源码包含前期已审基础文件，绑定用于确认版本，不能解读为本轮重新逐行审查所有不相关文件。源码、迁移或成品再次变化后需要按范围复查。

本轮没有改变运行的 3320 实例，没有在真实库执行 0003。AD 隔离闭环和 FE 合成服务集成由对应角色完成，未纳入本 Reviewer 亲测范围；真实迁移与切换仍需各自授权窗口及前后核对。
