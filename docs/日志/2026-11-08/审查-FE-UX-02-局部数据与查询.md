# 独立审查 / FE-UX-02 / 局部数据与查询

日期：2026-11-08（Asia/Shanghai）
审查者：`/root/fe_ux02_perf_baseline`
状态：本次源码与隔离反例复查完成；待最终生产成品的浏览器核验及 PM 集成确认。

## 版本与独立性

- 基线 HEAD：`61dc7414b20a395d1d09e906a49d974763b3cce7`。本轮审查对象为 root 编写的未提交工作树，不能把 HEAD 当作本轮交付提交，也不能据此生成待推送 SHA 的通过记录。
- 独立范围：库存事件、局部资源 hook、目录／筛选／详情／首页资源包装、公开查询解析、服务端 API／同源 BFF、媒体规范化及公开联系草稿。只读查看关联路由、卡片和 SSR／无 JS 退路。
- 本审查者此前编写 `tests/public-freshness.spec.ts` 并扩展 `tests/fixtures/public-api.mjs`；**这两个作者文件不在本次独立审查范围**，已交其他 Reviewer，不以本报告替代对它们的独立检查。
- 开工 `pnpm hooks:check` 通过。审查没有修改应用、配置、测试库或真实数据，没有安装、构建、typegen、启动／停止服务、真实消息、提交、推送或部署。仅写本报告与 `/private/tmp` 隔离反例。
- 首轮修复后源码清单：`/private/tmp/hd-fe-ux02-review-final-source.json`，清单 SHA-256 为 `27e30848c6527f0698007df023181576bc7bbbfd721ce2410e6eafad8ca8dbdd`。初次复查快照另存 `...-review-source.json`。下表是该次复查的14个主文件；最终增量与更新快照见文末，不能将旧目录文件 hash 直接套用新成品。

| 文件（均相对 apps/web/） | SHA-256 |
| --- | --- |
| src/shared/lib/inventory-events.ts | `05537d2f6a59bede2eaa77f7e2f44d3842b816f72daeb28f7362780213e3617e` |
| src/shared/ui/inventory-freshness.tsx | `b6edc2b73793ba0d7cc281ee8930c6564dd1d3a49f478f41415b5121923a8946` |
| src/modules/vehicles/application/use-public-resource.tsx | `827e25106dc4ee39ec0ce104b194342ad10e251ca35a6ab2dcae73976e22ad82` |
| src/modules/vehicles/ui/public-vehicle-list.tsx | `e91e528599ef998bd3b2f8a7130816256b012d3d3a73604c44e1ae6cddcd423d` |
| src/modules/vehicles/ui/public-vehicle-filters.tsx | `8c46174756d83abc6e959b386151e7442c9fe90ff44624f81e3ffdaa65b67057` |
| src/modules/vehicles/ui/public-detail-resource.tsx | `943ba5c037965634c13b49f46880e5b6b6cbf2b7cea4c565ecd358e2f84a5ae5` |
| src/modules/vehicles/ui/public-resource-status.tsx | `d38d36ad51a966600c1fa7e73e4d3248444f883805e5f3f22ca72fcbe29d3c5a` |
| src/modules/home/ui/public-home.tsx | `305c6d039e1e08a3f06012c6d31d74f24dd2d155e478965c390023e68d093ab6` |
| src/modules/vehicles/public-query.ts | `a2ad69df8b652410d8f4fa93d0210bb073b844f33276b0065b378f82cda70e02` |
| src/modules/vehicles/infrastructure/public-api.ts | `4a0c6ef2d39ebe75522bc07b8e51fcaefe190d60c6b6d2fbafb5471593359c0b` |
| src/modules/vehicles/infrastructure/public-proxy.ts | `258734da9008a2fe473782cec2dbaff6ce21e113d7176f9095dc9f21ffba4634` |
| src/shared/lib/public-media.ts | `d7785a27ce0076767e7dcd76cd258d3de81974d08967c68953045a43817950f0` |
| src/shared/lib/vehicle-contact.ts | `88859623ee859fa02ee8899cf0ff5aafa7a807c044e3e66625e540d544eb4df4` |
| src/modules/vehicles/ui/public-vehicle-contacts.tsx | `6993cc6f2539c9da3f26898f4b8c64e2cdc8a1afdb9b029cdc7ed58c92f14548` |

## 发现、原作者修复与复查

### P2-01：详情 BFF 接受结构合法但身份不匹配的 DTO — 已关闭

初版 BFF 在 `public-proxy.ts` 最后仅用 `PublicVehicleResponseSchema` 校验详情，没有复用 SSR `getPublicVehicle` 的 ID／locale detailPath 一致性检查。上游若意外串车，`/cars/A/` 的客户端核对可能接受 B 的有效公开 DTO，继而展示 B 的价格与咨询草稿；草稿只检查 DTO 内部自洽，不能替代请求身份检查。

负责人 root 已将 detail 分支改为 `getPublicVehicle(parts[1], locale)`，成功时重新构造公开响应，异常身份按503处理。独立 mock 分别返回“其他有效车辆”及“同 ID、另一语言 detailPath”，两者均503且不公开错误车号；正确 DTO 200、同源输入 Cookie／Authorization 及上游私有响应头均不转发。三项通过，关闭。

### P2-02：历史恢复超过1.5秒后可能永久停在 checking — 已关闭

generation 修复的初版 `subscribeInventory` 只重放1.5秒内的事件，但 `inventoryGeneration(path)` 不会过期。若页面慢于1.5秒挂载，hook 渲染因旧 generation 进入 checking，订阅却收不到 fetch 信号；URL 与 initial 没变化，不会自动恢复，需下一次 focus。影响是联系入口持续不可用，不是放开旧库存。

独立假时钟反例：invalidate＋notify，前进1600ms，再订阅。第一次结果为0次回调，反例失败；已即时回报 root。原作者去掉重放时限，按路径保留待核对的 fetch 信号；同一反例收到正确 generation，复测通过。未访问任何 HTTP 服务，关闭。

### C1：40ms合并请求之前的旧状态首帧窗口 — 设计已修复，浏览器确认待最终成品

初版只在40ms定时器到期后将资源改成 checking，恢复的旧树可能先显示 fresh。此项先作为静态时序候选回报，没有冒称抓到真人或浏览器错误帧。原作者已拆为事件发生时立即 invalidate generation、40ms仅合并网络；hook 通过 `useSyncExternalStore` 比较已确认 generation，渲染时使旧数据失去联系 href 和 available 声明。源码复查确认此机制存在；最终成品还须结合 Back／focus 的浏览器即时观察，不能仅凭延迟结束后的 checking 断言排除首帧问题。

## 其余路径核对

- 请求竞争：每次 load 取消前请求、递增 request id；响应及失败均核对 id，卸载取消并推进 id。URL 变化在渲染阶段按 checking 处理，旧结果保留阅读但联系失效；新 SSR initial 另同步，避免用旧请求覆盖新 props。本次未发现可确认的跨请求覆盖问题，最终竞态场景仍需浏览器验证。
- 失败／404：JSON／网络失败保留上次阅读内容并进入 error，重试仍针对当前资源；404 清掉详情数据并显示 missing，而不是继续展示旧车；初次 SSR 的未知／下架详情仍由路由返回真实404。客户端已打开文档的局部 missing 不可能回改原文档HTTP状态，不将它冒称新404响应。
- 无 JS：表单保留 GET action 和页码；分页、详情、图片及联系仍有原生链接；首次 API 失败有可阅读的 SSR 重试链接。局部重试按钮是增强能力，没有取代全部无 JS 退路。
- 查询：SSR／客户端历史／BFF共用公开 query schema；q 经过trim、长度与NUL校验，分页拒绝非正整数字符串／重复支持字段；BFF另校验允许参数及重复键。查询不是客户端全库过滤。接口 SQL literal 搜索语义由 BE 负责，本次未重新审查数据库实现。
- 公共边界：BFF只允许目录、facets、首页、单车和受限媒体；不在allowlist中的路径404，允许路径的非法query400。配置 origin 仅服务端读取；上游只收受限 Accept，重定向拒绝，JSON／媒体尺寸与类型受限；浏览器读取使用 credentials omit。此次未发现认证／后台路径穿透或凭据转发。
- 联系与来源：三语草稿使用公共稳定ID／公开价格语义／对应详情路径，外部源增加平台及原始挂牌链接，不声明自有库存；链接仍指向配置的 Telegram／WhatsApp并编码草稿。未发送真实消息。媒体规范化只改本地允许路径，thumb仅固定variant，不构造任意远端代理。

## 实际验证与限制

已执行：

```sh
pnpm hooks:check
pnpm --filter @hd/web exec vitest run --config /private/tmp/hd-fe-ux02-review.config.mjs
pnpm --filter @hd/web exec vitest run src/modules/vehicles/infrastructure/public-api.test.ts src/modules/vehicles/public-presentation.test.ts src/shared/lib/public-vehicle-contact.test.ts
```

- 隔离反例文件：`/private/tmp/hd-fe-ux02-review.test.ts`。第一次3通过／1失败，原作者修复后4／4通过。
- 现有三份相关单元：3文件、21／21通过。它们与本次独立反例均不启动官网或真实API，不改 `.next`。
- 本轮只做源码和隔离单元审查。未将其他 Agent 的31项Chrome结果列为本人执行；未对最终 standalone 成品重新跑浏览器、性能、视觉、无 JS、移动端或真实 API 写闭环。
- 本范围现有可确认 P0／P1 为0；两个确认的P2已修复并复查。最终浏览器核验、其他 Reviewer 对本人的测试文件检查及用户业务／视觉验收仍须完成。此结论不覆盖税费规则、后台、数据库迁移、部署或全仓任意文件。

源码修改后先比对上方快照，重跑受影响检查；最终 Git SHA、测试成品与源码一致性及总进度由 root／PM 集成记录。

## 最终候选增量复查

复查日期仍为2026-11-08；root 提供候选 BUILD_ID `jxupsT7lU7eVFHhjD1W8y` 及241文件的 `/private/tmp/hd-fe-ux02-final-scope.json`，相对 Int02 为49文件变更。本文不自称独立审完这49文件，也不把候选的在跑浏览器结果提前记为成功。

### 增量结论

本次增量范围未发现新的可确认 P0／P1／P2：

- 目录去掉视觉大标题和全局“含任一样例即整页声明”，SSR仍有三语 h1；`srOnly` 使用1px裁剪，不是 `display:none` 或 `aria-hidden`。各demo卡片仍输出非实际库存声明；external在已核对状态显示第三方、库存未经HD核验，checking／error时可售声明变成待重新确认，联系href撤下。
- 数量条移到卡片列表后，保留 exact／unknown total 分支、页码和原生分页链接；铜色实心按钮与价格属于展示变化，没有复制价格／税费公式、改变币种或放开旧状态联系。未执行最终成品的像素／对比度验收，用户视觉确认仍是独立步骤。
- 首页车型代表图只从已请求 `visibleSections` 按make ID与model ID同时匹配，再使用公开封面选择器；无匹配则不生成该车型图卡，没有新请求全库、品牌通用图或虚构图片。车型图卡三语继续说明“分类、包含样例、并非具体在库车辆”，数量称公开记录，而非库存承诺。
- 首页统计分别为去重后的首页展示ID数、7个可估算目的地及3种语言；中文“可估算目的地”、英文“Estimate destinations”、俄文“Направления для расчёта”语义一致。本次只核对当前七国配置均有referenceAvailable，不宣称全部动力／年份／法律情形已官方覆盖，也没有把它改成已交付国家数。
- 新 `inventory-events.test.ts` 把late subscriber反例固定为8000ms后挂载，覆盖立即失效、后续fetch及另一条路径generation为0，断言方向与本报告反例一致。新增媒体测试限制为本地规范路径／固定thumb，不改远端URL。
- SSR标题断言改为先提取h1内部内容、去除子标签后检验非空，能容纳国家名称着色span，仍要求服务端存在可阅读标题。它不是语言翻译完整性或SEO认证测试。

本人的fixture／freshness spec仍不作自审：其中root新增的快速切图与首个RAF场景一并交另一Reviewer看测试整体，本报告仅说明它们须在最终成品中实跑，不以阅读代码确认浏览器已经通过。

### 增量实际检查与覆盖衔接

- 再次执行 `pnpm hooks:check`：通过。
- `pnpm --filter @hd/web exec vitest run src/shared/lib/inventory-events.test.ts src/modules/vehicles/infrastructure/public-api.test.ts src/modules/vehicles/public-presentation.test.ts src/shared/lib/public-vehicle-contact.test.ts`：4文件22／22通过。
- 另执行 `pnpm --filter @hd/web exec vitest run src/shared/lib/public-media.test.ts`：1文件2／2通过。未重复运行全仓或启动任何服务。
- 详情／图库原作者之外的源码审查见[详情画廊报告](审查-FE-UX-02-详情画廊.md)；指南／计算器见[指南与计算器报告](审查-FE-UX-02-指南与计算器.md)。这些是其他Reviewer的证据，范围、修复hash及未运行项以各自报告为准，不能视为本人执行的检查。指南FOB文案若后续改动，须由其负责人另核对对应快照。
- root 正在跑最终183项Chrome，本审查者没有代签结果；性能复测也等待PM提供独占读取窗口。本报告新增内容不与当前成品争用接口或更改测试状态。

### 更新源码快照

当前25文件合并清单为 `/private/tmp/hd-fe-ux02-review-incremental-source.json`，SHA-256：`479c029d04d1c4e181e42a6650fed0e74b59a42364e36f69cee974e1e7e4174b`。该25文件与root候选241文件逐项hash一致；父清单当时hash为 `5cca5acc59ec96c64f0853c0086421d920f6c1005024d5c9977b31c466128cde`。首轮14文件中仅目录列表发生增量，其他13个保留上表hash；更新列表及11个新增纳入范围的文件如下。

| 文件（相对 apps/web/） | 更新 SHA-256 |
| --- | --- |
| src/modules/vehicles/ui/public-vehicle-list.tsx | `c2311738245753199edd78acae4c8afbca35007c333c9ce59f6d6f16be151c1d` |
| src/modules/vehicles/ui/public-vehicle-card.tsx | `898f286ca75a3b6dcb907cc2a102d09f7ffa062dec1a1b20767c99e080d84b80` |
| src/modules/vehicles/ui/public-vehicles.module.css | `b62300f1f83ff25f3670ff8d66f55e14dde7619273c52a55fa816f5c20eafdba` |
| src/modules/home/types.ts | `2fac8fa2f91ef1293c16db9d9ce33f5ed770f33d7b0c4749872a764b5f7eabe3` |
| src/modules/home/content/home-content.ts | `a914de04d3b42c847cd8e29f6456716937f68a8e4d90a6f4c439055fcdb75390` |
| src/modules/home/content/section-content.ts | `468d78c6b5812c4a5a058894b02de66bf5f30ce14473d4234faedd7757ffe68e` |
| src/modules/home/ui/home-page.tsx | `64a98e1c53597b3641ec0cd6536a12f5ba02a7f5667b36dcd36443d9a9a15300` |
| src/modules/home/ui/home-sections.tsx | `a622f5f32d901a7e73da400898d57001c7947f4b007b4e3fd325d19615d72ac4` |
| src/modules/home/ui/home-sections.module.css | `38898a604edc1f37b168441f9e7e389c6a9b8c94b8768bd4e9dc263bd2e6da1d` |
| src/shared/lib/inventory-events.test.ts | `bdc655d760dfcb836406d4ff9df8ed345e6e1e1fb32477e733a5a6ab9eedf9f8` |
| src/shared/lib/public-media.test.ts | `fc03609def68c549b9e39a6d1bcb606ea56d57d76419cbe40a3aea3ab4216561` |
| tests/runtime-pages.spec.ts | `0614947d3fce9b84ebd42a7f08244fdbc32008d65a7edf7aff2e0696dfaffb57` |

以上是已阅读范围的独立增量审查记录；未绑定未来Git提交，不授权推送或部署。
