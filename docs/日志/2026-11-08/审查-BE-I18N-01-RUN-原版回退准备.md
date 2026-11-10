# BE 多语言升级前：旧版回退准备独立审查

审查日期：2026-11-08（Asia/Shanghai）。审查者：独立 Reviewer `/root/backend_review`，不是本轮启动器、回退产物或新版功能的作者。

## 结论

**回退材料与只读准备检查通过；尚不能宣称完整管理写入回退兼容。** 未执行 `--start`，未停止、启动或探测任何真实进程/端口，未请求实际 API、数据库或翻译服务。此次不替代 AD 新功能的独立功能审查，也不是实际回退演练。现有 3320 服务的状态仅由协调记录描述，本审查没有重新访问它。

尚未关闭的兼容问题：新版单车幂等回执带 `hasUnpublishedChanges`，旧版严格契约拒绝该字段，回退后同 key 重放可能返回 400。此项不阻止材料准备，但须由新版作者修复并复查，或由 PM 明确接受限制后的恢复边界，才能声称管理操作回退可用。

## 受审材料与指纹

- 私有启动器：`docs/private/local-acceptance/be-i18n-rollback/start-rollback.mjs`；SHA256 `ccb19b23eba2d6bd2969648e9a2c66a38656b6d32795f9f3af1dc6076ee12a94`。
- 回退产物清单：`docs/private/local-acceptance/be-i18n-rollback/artifact/manifest.json`；SHA256 `37bf07c5f392a7a8b40568425006439397ec0b7506c40dd8f729f7661074e52f`。
- 来源基线：`fdf6c6bc52b3a40761c4f991dde8e1f6a0fad028`。
- 隔离预检：`artifact/preflight.mjs`；SHA256 `f7d5fa9e6e0bb1f00771ad67f3d55238dd9a3485e9e2d22e5d2c6eda92a23b16`。
- `preparation.json` 中启动器与产物清单摘要均与上述实际文件一致；`windowAuthorized=false`、`serverOperationsPerformed=false`。回退目录与 original 目录权限 0700，启动器/准备记录权限 0600；材料位于 Git 忽略的私有路径。

独立核验了 103 个清单文件摘要；18 个依赖链接的真实路径、包名和版本通过启动器检查，旧 API 的 `@hd/contracts` 指向产物内旧包。48 个产物中的 Git 跟踪源文件与基线逐字节一致。全部 15 个生成的 API JavaScript 与此前 `int03-buckets-media-build.json` 的运行产物记录完全一致，包括 `dist/app.js` 的 `1a1857ef32dd87e9d75814e335cd7be105e0302b2c7080ed3aa461b22c3ce1f2`。

依赖仍借用本机既有固定版本包，不是可移植的离线完整依赖包；运行前需要保留这些路径并再次检查。链接路径和版本核验不等同于给整个第三方依赖目录逐字节封存。

## 启动器安全与修复复查

- 仅接受明确的 `--check` 或 `--start`，固定 Node 24.19.0；无参数不启动。`--check` 在 PID、端口与 readiness 逻辑前退出，只检查文件和摘要。
- 固定旧基线、清单摘要及所有列出的文件；拒绝越界的清单路径，核验依赖真实路径与版本以及旧 contracts 隔离。
- 内部以摘要校验保存的原环境和当前环境一致。Reviewer 未查看或输出环境值。启动路径使用保存环境值覆盖调用者同名配置，强制 `MEDIA_DELIVERY=direct`、`TRANSLATION_PROVIDER=disabled`。
- 拒绝有效的既有 PID 记录和占用的 3320 端口；不存在停止其他进程、迁移、恢复环境文件、清理媒体或业务数据写入步骤。若环境已变化，必须在另行授权的流程中处理，不由 helper 自动恢复。
- 审查发现的启动归属竞态已修复：原版只等 `spawn` 并接受端口上的任意 ready 200；最终版监听 child exit/error，并在成功前检查 child 状态、PID 存活及 `/usr/sbin/lsof` 返回的 3320 监听归属（helper 第 72–85 行）。因此不会仅凭其他进程的 ready 200 就确认该 child 恢复。此为静态修复复查；本轮没有执行真实启动或故障演练。

## 未关闭：新版持久化回执向旧版的兼容缺口

级别：P2；影响完整管理写入恢复承诺，不影响纯准备和既有数据的只读回退检查。

证据链：

1. 当前 `apps/api/src/vehicles/service.ts:28` 的 `toAdmin` 加入 `hasUnpublishedChanges`；第 75 行仍将整个结果 `JSON.stringify(result)` 保存至 `idempotency_keys.response`。
2. 旧产物 `apps/api/src/vehicles/service.ts:62` 对共享单车操作的历史命中执行 `AdminVehicleSchema.parse(response)`。旧 `packages/contracts/src/admin.ts:76` 使用严格对象，没有该字段。
3. 独立使用旧 compiled schema 和旧固定 fixture 验证：原 fixture 可解析，增加 `hasUnpublishedChanges:false` 后报 `unrecognized_keys`。无数据库或网络访问。
4. 旧 `apps/api/src/app.ts:94` 将该 ZodError 映射为 HTTP 400 `INVALID_REQUEST`。

因而新版运行后创建的、仍在有效期内的 create/publish/delete/restore 等单车回执，在旧版用相同 actor/operation/key/input 重放时可能失败；这不是新业务输入非法，也不能以“更换幂等 key”冒充原请求可安全重放。紧凑 bulk 回执不因这个新增 AdminVehicle 字段受影响。未触碰真实 receipt，未判断现存库是否已有此类新回执。

本报告记录的是准备审查当时的新源码行为。AD 后续若修改回执保存或兼容逻辑，需要另外验证并补审；本报告不自动为之后的实现背书。

## 独立执行的检查

- `pnpm hooks:check`：通过。
- Node 24.19.0 对最终 helper 的 `--check` 语法检查：通过。
- 最终 helper `--check`：通过；未进入进程、端口、数据库逻辑。
- 103 文件摘要、18 依赖链接/版本、48 基线源文件、15 历史运行 JavaScript 核对：通过。
- 隔离旧产物 `preflight.mjs`：5/5 通过，使用进程内 inject、dummy 配置、DB guard 和业务 mock；覆盖 live、公开详情、旧管理响应无新字段、direct 图片 body/no-store/无内部跳转、旧版不存在翻译建议路由。
- 预检执行后全部 103 个清单摘要仍一致。
- 旧严格契约拒绝新增回执字段的纯数据复现：符合上述风险判断。

未执行数据库迁移、实际登录/发布/幂等重放、旧版真实启动、API 停机切换、翻译供应商调用、FE/AD 真实链路验收或生产操作。
