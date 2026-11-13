# 后端 / BE-REL04 / 无用代码清理

日期：2026-11-13（Asia/Shanghai）
状态：待联调（自测与独立审查通过，交 OPS 统一集成）

## 范围与版本

- 按 PM 的 REL04 分工清理 API 已证实无用的代码；OPS 唯一负责 Git 集成与发布。
- 分支 `codex/be-rel04`，共同基线及开工 fetch 后的远端 main 为 `102de594226c016f5e788e1b250001d53cb0bd17`。本轮差异为 5 个 API 源文件、本角色摘要及本日志；最终 SHA 由交接报告绑定。
- 使用独立 `docs/private/be-rel04-worktree`，保留根工作树 `codex/acceptance-polish` 的历史改动。开工 `pnpm hooks:check` 通过。
- Node 24.22.1 / pnpm 11.25.0；核对锁文件及 API/contracts 依赖清单与上一 BE 工作区一致后复用只读依赖内容，contracts 与 API 构建产物写在本工作区，没有安装或修改共享依赖。

## 实际变更

- 删除 `external/catalog.ts` 的 `listExternal` 包装函数：全仓代码仅有定义，实际查询走 `listExternalPage`。
- 删除 `vehicles/localization.ts` 的 `validateLocalizationPublication`：全仓代码仅有定义，当前发布统一走 `publication.ts` 的准备、就绪与拒绝逻辑。
- 删除历史 `translationSuggestions` / `displayTranslationSuggestions` 方法未读取的 translator 参数，同步两处路由调用；保留历史幂等回放、冲突检查和新请求必须确认翻译计划的限制。
- 删除 `VehicleDraftInputSchema`、`PublishedLocalization` 和 `locales` 未使用导入，以及参数移除后多余的类型导入。
- HTTP 契约、公共 schema、迁移、缓存策略、人工修订与翻译额度机制均无改动；不新增 CSV 同步、导入数据或付费调用。现有容量、恢复、安全及预算测试保留，不为删除数量清理仍有用途的工具。

## 验证与限制

- 清理前 `tsc --noEmit --noUnusedLocals --noUnusedParameters` 报 6 处未使用项；清理后同一命令通过。全仓源码引用检索确认两处已删除函数没有调用方。
- contracts 构建、API 构建及 OpenAPI 生成通过（公开 6 / 管理 38 路径）；`pnpm check:workspace` 静态边界检查通过。未修改接口字段或路由，FE/AD 无需适配。
- 定向现有单元测试 46/46：`auth-rate-limits`、`vehicles/localization`、`vehicles/service`、`vehicles/translation`、`vehicles/translation-plans`。
- 真实本机 PostgreSQL socket 的随机隔离库中，`test/integration.test.ts` 选定 4/4 通过：草稿保密与语言发布检查、确认翻译计划与历史回放、侧表发布完整性及不可变性、展示翻译的版本保存与人工修改保护。测试自身负责创建和删除随机库；无业务库操作。
- 本轮没有重跑全站、全量数据库或生产验收；定向检查通过不代表已部署。原始检查日志保存在本工作区忽略目录 `docs/private/be-rel04/`。
- 独立 Reviewer `/root/backend_review` 只读审查通过，未发现可确认阻塞问题；复核两处无调用函数、当前发布入口、历史翻译回放及测试范围。独立执行 hooks、严格 noUnused 类型检查与差异空白检查，核对作者 5 个源文件和 7 份日志散列一致；未重跑数据库、全站或真实服务。报告为本工作区 `docs/private/be-rel04/review.md`，最终提交后继续核对 Git 对象并生成绑定 SHA 的 `review.json`。

## 交接

- 本轮仅本地准备；提交、独立最终 SHA 核验完成后交 PM/OPS。OPS 在组合版本执行推送门禁、PR/CI 与发布，BE 不重复全站验证或自行推送合并。
- 不重跑 REL03 数据清理；现有生产数据、账号、配置及同步关闭状态保留。未开真实来源、CSV 导入或付费翻译。
