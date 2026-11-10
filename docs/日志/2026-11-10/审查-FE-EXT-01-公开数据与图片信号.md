# FE-EXT-01 公开数据与图片信号独立审查

2026-11-10，Asia/Shanghai。Git 基线为 `fd16e00e23db8b8956f0c398ab1c198e82a61bc2`。审查覆盖官网公开数据接线、图片失效上报和对应测试准备。检查使用源码及隔离 stub。开工 `pnpm hooks:check` 通过。

本范围的请求流错误处理问题已修复复测。当前审查指纹无未处置 P0/P1/P2。真实后端排序、刷新队列和成品浏览器结果由对应联调记录证明。

## 公开数据与路由

- 首页、目录、详情仍从公共服务端入口获取本地化数据。目录沿用 `catalog=curated&view=localized`，浏览器保持同源 JSON 查询与完整分页参数。响应数组按 API 顺序渲染。合成用例按三语检查前 26 条员工发布流、下一页 5 条导入数据，以及 CNY 精确价格边界、年份、品牌和动力筛选。合成顺序证明前端没有重排，实际库的全局排序由 BE 联调核验。
- 本地化详情保留既有 display、requestedLocale 和车号/路径绑定检查。`external.detail` 仅由本地化详情 parser 接收，并校验原文对象的 requestedLocale。首页和目录 parser 拒绝该对象。原文回退标题仍可按 `contentLocale` 正确标注。详情的检测和关联链接使用契约 HTTPS 值与 `noopener noreferrer`，原文及资料通过普通文本节点渲染。
- sitemap 走单独的 `getPublicSitemapCatalog`，明确发送 `view=legacy`、`catalog=curated`、每页 48 条，并通过 `legacyListSchema` 拒绝含导入记录的响应。原有分页上限和错误处理保留，只写入 manual 且 available 的详情。导入详情通过既有来源规则保持 noindex。
- legacy 列表、首页和详情分别校验每辆车无 `external` 导入投影。BFF 未传 `view` 与显式 `view=legacy` 都使用该校验。原有员工发布的外部来源记录仍可使用，因为它们只有 `source.kind=external`。stub 测试向三个接口注入含原文明细的导入 DTO，均收到通用 503，且响应未带导入车号。先前依赖 BE 排除导入记录的兼容边界现已由官网校验补齐。

## 图片失效信号

- 专用路由只导出 POST，等待 Next 动态 params。严格校验 `ximg-` 加 UUID v4，校验来源和 Fetch Metadata，再接受无查询参数的 JSON 请求。Origin 可等于请求 origin 或配置的站点 origin。回环别名只接受 HTTP、同端口、`localhost` 和 `127.0.0.1`，支持 standalone 适配器转换。带非 `same-origin` 的 `Sec-Fetch-Site` 返回 403。隔离用例确认同端口回环可用，另一端口、非回环 origin 和跨站标记被拒。
- 流按实际字节计数，上限 256，严格 schema 仅接受正整数 revision。转发由已验证的 ID 拼固定 API 路径，body 重新序列化为 revision，复用既有受信网关身份规则。任意 URL、查询参数和额外 JSON 字段被拒。浏览器请求省略凭据，服务端转发头不含 Cookie 或 Authorization。缓存、跳转、超时与错误映射仍受公共 HTTP 入口约束，429 保留安全的 Retry-After。
- 列表、收藏和详情的远程图使用浏览器直连与 no-referrer。缺图或加载失败时即时进入本地占位，页面和咨询入口可继续使用。报告以 `id:revision` 记忆，最多保留 128 项，重复错误复用去重记录，改 revision 可产生新信号。报告异步执行，网络错误不会把占位改回破图。202 表示公开接口接收信号，图片刷新结果以 worker 联调为准。

## 问题及复核

`readRevision` 初版在 `reader.read()` 抛错时进入 catch，但 finally 再次等待已失败流的 `reader.cancel()`。后者覆盖原先的 null 返回，代理函数异常退出。使用 `ReadableStream.controller.error()` 和全 stub fetch 的临时用例复现。首次隔离运行 3 通过、1 失败。

作者在 cleanup 捕获取消异常。复测失败流得到 400，且未调用上游。256 字节仍可转发，257 字节拒绝。此问题已关闭。

## 测试证据

| 检查 | 实际结果 |
| --- | --- |
| `pnpm hooks:check` | 通过 |
| `pnpm --filter @hd/web exec vitest run src/modules/vehicles/infrastructure/public-media-report.test.ts src/modules/vehicles/localized-projection.test.ts` | 00:05:40 实际 2 文件 8 项通过 |
| `/private/tmp/hd-fe-ext01-review/review.test.ts` 专属 Vitest 配置 | 00:05:40 实际 6 项通过。覆盖回环和跨站、失败流、详情原文及保序、legacy sitemap、字节边界和429、128项去重。所有 fetch 使用 stub |
| 上述专属配置末次增量 | 00:29:44 实际 8 项通过。新增两个 legacy BFF 参数分支、员工外部记录兼容、sitemap 拒绝导入的反例 |
| 上述仓内定向测试加 `src/modules/vehicles/infrastructure/public-api.test.ts` | 00:29:44 实际 3 文件 16 项通过 |
| 相关已跟踪文件 `git diff --check` | 通过 |

合成浏览器测试从 health 标记的 loopback fixture 控制数据。远程图片由 `photos.example.invalid` 拦截模拟 410。测试检查占位、三语原文、检测链接、一次 POST、下架 404 和原币。增量覆盖三语 facets 总数 31 和首页 31，fixture 不把导入记录的未知动力写成筛选项。首页优先读 API 的 `total`，旧 API 缺该字段时沿用原动力计数。画廊回归使用具体 `Open gallery` 按钮，模拟详情数据核对后图片全部移除，检查弹层消失、滚动恢复和焦点回到图库占位。freshness 改动保留 JSON 数、document、筛选查询 RSC 及页面外壳断言，仅从这项查询场景排除无 q/page 的后台导航预取。

作者最新报告 766 单元、7 边界和 `HJgUnjWNJtUV7jraaNWPL` 构建，早期构建为 `sSzcX1mhX58bGRyB2gD0j`。该证据归作者运行。此次独立检查的执行范围是纯测试和源码，正式 API、数据库、刷新任务和新成品浏览器证据由联调负责人登记。

## 源码指纹

`/private/tmp/hd-fe-ext01-review-scope.json` 记录 12 个直接审查文件和 17 个只读上下文文件。最终清单 SHA256 为 `0cb433be53424b0719423f2214f61efd26045888f23b1ad4f782053a3da83ccc`。末次纯测试使用只读契约 `external-public.ts` 的 `f4f1b971220981647395d6f583f4cd974580c1364dfd779bb1549932f46c3de6` 版本，确认本次依赖的信号 revision 与身份校验仍通过。

| 相对 apps/web 的文件 | SHA256 |
| --- | --- |
| `src/modules/vehicles/localized-projection.ts` | `ecbc556a7766ac9298150186205dcb672b5de62eb9710626ee9d5a69b953845b` |
| `src/modules/vehicles/server.ts` | `845b83690ad685e3b602caebfc94afd49dee7d2c7714193fca80a035dd22d460` |
| `src/modules/vehicles/infrastructure/public-api.ts` | `99fb20269a5546f26369f8ce785c3fb36e88bd25d40092063ca7ca3d194b8cf2` |
| `src/modules/vehicles/infrastructure/public-proxy.ts` | `ae500734768afbb3138922501d1a562ccd5b58198d075ecaaf014d26124f86c6` |
| `src/modules/vehicles/infrastructure/public-media-report.ts` | `6ba1cc13c86012ce2d1bb55584ebcd381cd2129b10f66bd26fb89303d4afc715` |
| `src/modules/vehicles/infrastructure/public-media-report.test.ts` | `d635e5d5861ab02a1bd2d5b66084b671edab4748da7b04f76236aa598c09998c` |
| `src/modules/vehicles/application/report-external-photo-failure.ts` | `41bd7cc5ef68d43d7b56a743941bef5b27c7ed6982cb1644cd2c5742ae5bf955` |
| `src/app/api/v1/external-media/[id]/failure/route.ts` | `149e879a9796367356e02bde51f6dd87be37254463435ed6a434416fcc6d1c5d` |
| `src/app/sitemap.ts` | `8b68b8a4a9df0bf8dcba8153dea2dddd522150e6bec63aaec8e15981be87f891` |
| `tests/fixtures/public-api.mjs` | `35cfb6cedf385fd08d40c6e0bca584c93cdc6439a58669edd56b3960bcb0bb51` |
| `tests/external-catalog.spec.ts` | `f02436cc163357a62d65e829444206ee45ce6f1cb2075d94768d0c6c1cf6d599` |
| `tests/public-freshness.spec.ts` | `2adc18a94145374da6b251ae9ff503065c657cfe16a91cb0110701734712a124` |
