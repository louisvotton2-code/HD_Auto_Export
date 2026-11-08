# BE-INT-03 Retry-After 最小增量独立审查

日期：2026-11-08。审查者 `/root/backend_review`，未参与受审实现编写。

结论：本次增量未发现可确认问题。429 响应保留限流插件给出的真实剩余等待时间，缺失时才使用 60 秒；503 保持原有 5 秒行为，请求额度未变。3 项定向回归与 API 类型检查由审查方独立执行通过。

## 范围与基线

仅审查 `apps/api/src/app.ts` 的 Retry-After 处理增量及新增 `apps/api/src/rate-limit.test.ts`。修改前 app 快照为 `/private/tmp/hd-be-retry-after-before/apps/api/src/app.ts`，其 SHA-256 与原 BE-INT-03 21 文件清单完全一致。核对原清单，其余 20 个受审文件未变，仅 app.ts 变化；更新 app 指纹并加入新测试后，形成 22 文件最终清单 `/private/tmp/hd-be-int03-reviewed-files-retry-final.json`。

Git HEAD `61dc7414b20a395d1d09e906a49d974763b3cce7` 仍为旧保存头，不是本次未提交实现的提交。前轮完整审查报告 `/private/tmp/hd-be-int03-review.md` 及原 21 文件清单保留，不覆盖历史验证证据。

## 核对结果

- 本机已安装 `@fastify/rate-limit` 11.2.2 在抛出限流错误前，将 `Math.ceil(ttl/1000)` 写入 reply 的 retry-after。原应用错误处理器统一覆写为 5 秒，确会导致客户端早于窗口恢复时间重试。
- 修复仅让 429 在 reply 未提供 Retry-After 时补 60 秒，已有值继续由插件负责；不改限流额度、窗口、IP 判定、错误结构或重试标记。503 独立保留 5 秒。
- 测试通过真实 Fastify 注入与已安装插件耗尽全局 120 次额度，验证首次 60 秒、推进 12,345ms 后为 48 秒且与 x-ratelimit-reset 一致，再等待返回的秒数后恢复 200。测试推进 Date，不实际等待一分钟。
- 认证路由测试真实验证 30 次／60 秒的 Fastify 路由额度及 53 秒剩余头。使用未暴露 auth 子路径避免数据库访问；该场景不冒充 Better Auth 独立登录规则的重新验证。
- fallback 测试仅模拟公开查询依赖抛出 429／503，仍通过真实 HTTP 错误处理器，分别验证 60／5 秒及公共错误 schema。三个场景足以覆盖本次覆写缺陷，无需重复数据库业务回归。

## 审查方实际验证

Node 24.19.0：

- `pnpm hooks:check`：通过。
- `node --import tsx --test src/rate-limit.test.ts`：3 项通过。
- `pnpm --filter @hd/api typecheck`：通过。
- 受审两文件 `git diff --check`：通过。
- 原 21 文件清单比对：20 项完全一致，只有 app.ts 为本增量；修改前 app 快照与旧指纹相同。新 22 文件清单已按当前树生成。

未访问 TCP 服务或数据库，未读取凭据、重跑 36 项 PG 测试、修改源码、提交或重启 3320。此次修复是否已构建、进入 OPS 接续窗口和运行启用由实现方另行记录；审查通过不能当成现有服务已使用新等待时间。生产部署与 FE／AD 实际联调不在本增量审查执行范围。

## 增量指纹

- `apps/api/src/app.ts`：`7b2e5420e05b2c150e1687f0a9baecd5b3b0192cb5131ce1900cb05a6719b852`
- `apps/api/src/rate-limit.test.ts`：`a51adcd8fc39f47624142aca74ce613d7f1e9c9dfd68066f2ae2a5ae4fe9eaa3`
