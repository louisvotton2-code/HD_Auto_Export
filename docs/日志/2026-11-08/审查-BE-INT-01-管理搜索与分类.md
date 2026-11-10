# 管理列表搜索与分类筛选独立审查

日期：2026-11-08。审查者 `/root/backend_review`，SQL／分页只读子审查 `/root/backend_review/db_review`。两者均非本轮受审代码作者。

结论：最新受审工作树未发现未处置的可确认阻塞问题。首次 API 类型检查暴露新增测试中异构查询数组与 URLSearchParams 类型不兼容；实现者已显式声明 Record<string,string>[]，审查方重新执行类型检查通过。

范围：相对 HEAD `61dc7414b20a395d1d09e906a49d974763b3cce7` 的下列未提交增量：

- `packages/contracts/src/admin.ts`
- `packages/contracts/tests/contracts.test.mjs`
- `packages/contracts/README.md`
- `apps/api/src/vehicles/service.ts`
- `apps/api/test/integration.test.ts`
- `docs/开发/车辆接口.md`

不包含同时进行的 AD 界面、共享根文件或其他协作／日志改动，未执行提交、建分支或推送。

已核对：

- 管理 q 在 trim 后限制 100 字符、拒绝 NUL、允许空串；品牌/车型复用规范 ID，动力复用公共枚举；额外查询字段仍拒绝，公开查询没有增加 q。
- 搜索仅覆盖稳定车号、当前草稿品牌名/车型名和标题原文，不包含 VIN、内部备注、联系方式或译文。车号格式与 DTO 一致。
- SQL 使用参数绑定及 lower/strpos 字面子串匹配，百分号、下划线、反斜线和引号没有额外通配含义。
- 分类与状态条件为 AND；q 的四个公开用途字段为 OR。列表与 total 共用 JOIN、where 和参数，并在同一 REPEATABLE READ 事务内查询；过滤先于分页，空搜索等同未传入。
- 文档准确区分管理列表基于当前草稿、公开列表基于发布快照；不暗示已实现公开关键词搜索。

审查方实际验证（Node 24.19.0）：

- `pnpm hooks:check`：通过。
- 受审文件 `git diff --check`：通过。
- `pnpm --filter @hd/contracts check`：typecheck、build、17 项测试通过。
- `pnpm --filter @hd/api typecheck`：测试类型声明修正后通过。
- 现有隔离集成测试中 `admin search filters` 专项：1/1 通过；实际创建并清理本机随机测试数据库。覆盖分页前搜索、组合条件、大小写与首尾空白、特殊字符、内部字段排除、标题更新、清空、非法 NUL／枚举、未登录及公开 q 拒绝。

未读取私有账号文件或试用凭据，未连接试用业务数据库，没有官网接入、生产或远端 CI 验证。本报告是契约与 API 增量审查，不代替 AD 界面联调；后续源码若变化需按变化复核。
