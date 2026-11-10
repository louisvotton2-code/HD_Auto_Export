# FE-UX-02／PM-INT-03：访客身份、限流与导航独立审查

日期：2026-11-08（Asia/Shanghai）。Reviewer：`/root/fe_ux02_detail_audit`；本表实现作者为 root，Reviewer 未修改其应用源码。此报告不审查 Reviewer 自己负责的公开车辆文案切片。

**最新源码结论：NAV-01、RL-02、RL-03 及无 JS 恢复补项均已独立源码复查闭合，本范围未发现未处置 P0／P1／P2。最终复查以第三轮 23 文件指纹、第四轮和第五轮替换指纹共同绑定；新候选的浏览器证据仍由 root 补齐，不能将源码通过当作成品／部署验收。** 以下首轮、第二轮记录保留问题发现与修复过程，不再代表当前未处置状态。

首轮结论：访客身份传递与 BFF 429 清洗未发现 P0／P1；发现 **NAV-01、RL-02 两项 P2**。NAV-01 已见源码修复，等待时序回归；RL-02 初始 SSR 限流入口尚待原作者处理／明确范围，当前不作整切片通过结论。

## 版本与主审范围

共同 HEAD：`61dc7414b20a395d1d09e906a49d974763b3cce7`。以下是本轮共享工作树的 11 文件快照，不把旧 HEAD、旧 241 清单或旧 BUILD_ID 视作包含本轮新增实现。后续改动需增补 hash 和复查。

| 文件（相对仓库根） | SHA-256 |
| --- | --- |
| `apps/web/src/modules/vehicles/infrastructure/public-request-context.ts` | `f34e2a25e280e93ba99198833181c18665d26f69f01feab8ad17ebdcb8660440` |
| `apps/web/src/modules/vehicles/infrastructure/public-request-context.test.ts` | `20cf014853077487b5a95def3947195c598816aabe40e135e8cfba39832fb21f` |
| `apps/web/src/modules/vehicles/infrastructure/public-api.ts` | `4259067880904c6843ccc99fe2bbf957313a15898a6acfb4d0a32c9dcfdaeeab` |
| `apps/web/src/modules/vehicles/infrastructure/public-proxy.ts` | `3b0a6099920f22d75afe19d51a815695717defd29e623a47c559e2afc7175315` |
| `apps/web/src/shared/lib/retry-after.ts` | `010c1c43eb942bc600c2d6970a8de932bd65cc617d27753f8a948b08dd3d9457` |
| `apps/web/src/modules/vehicles/application/use-public-resource.tsx` | `a6ad4a5946f583feba8232f410a66795611c6750ddfd8dd152181aee9a9ba6de` |
| `apps/web/src/shared/lib/public-navigation-events.ts` | `9a7835421cf2c9592e4df4180a3e98096b19e233379706d319ede97c9894870e` |
| `apps/web/src/shared/ui/public-navigation-freshness.tsx` | `fbd8c0975a329d49d6ce7489edaf189b215a587afa3a77af47329b567be82c8f` |
| `apps/web/src/app/[locale]/layout.tsx` | `aacb0b4d1d68dc6bf7ced9f5dddae2a4813ddc9cfbbb47e3d036129fa9809fc9` |
| `apps/web/src/modules/vehicles/ui/public-resource-status.tsx` | `b110db406cab1f6663f08620591eacd192488a3c77079a71bfaf0f4d4f929b55` |
| `apps/web/.env.example` | `9c5190fa88e46ccff5c2711ffdc5a76fb62129cfef9dbb593a15415fade17dc7` |

补读了 SSR 首页／目录／详情的错误装配、PublicHome/PublicDetailResource/PublicVehicleList 的调用和公共状态上下文消费者，目的是确认端到端数据路径；未因此宣称额外文件已经获得最终独立审查覆盖。

## 发现与处置

### P2／NAV-01：同 target 去重忽略更新的导航版本，可能永久 checking

- 首读逻辑：`use-public-resource.tsx` 在 load 开始捕获 `checkedNavigation`，对同 target 的正在进行请求直接去重返回；响应完成仍写入旧导航版本。最终 phase 又要求 `state.navigation >= 最新版本`。
- 确定的源码时序：请求 A 正在进行；同路径的 hash 历史 Back（例如离开 `#contact`），或快速 query Back／Forward 最后回到同 target，使导航版本增加；ready 通知复用旧请求；旧响应完成后仍携带旧版本，phase 就持续 checking，且 checking 状态没有重试按钮。旧状态和联系入口因此一直不能恢复。
- 已向 root 提交问题。上表 hook hash 已包含作者后续修复：inflight 去重现在同时比较 target 与 navigation 版本；新版本会中止旧请求并发起新检查，同一版本同 target 继续去重。**源码路径已闭合**，Reviewer 没有运行真实浏览器时序，不能把该源码复查当作运行验收。
- 复测：延迟目标响应，分别执行同路径 hash Back、快速 query Back／Forward、后退后迟到挂载；核对只保留最终请求的数据、phase 恢复 fresh、旧可售和联系在检查期间不可用，且 gallery／展开状态、URL 和页面壳层保留。原请求乱序完成或失败不能覆盖新请求。

### P2／RL-02：初始 SSR 429 的 Retry-After 没有进入客户端冷却

- 定位于补读的 `app/[locale]/page.tsx`、`cars/page.tsx` 的 `Promise.allSettled` 降级，以及 `cars/[slug]/page.tsx` 的 `load()` 错误分支：`PublicApiError(429, retryAfter)` 目前与普通故障一样折成 null，没有将初始 429／Retry-After 传给 PublicHome、PublicVehicleList 或详情重试页。
- 后续 hook 初始 `retryAt=0`、`retryAfter=0`。因此首次 SSR 请求被限流时，普通重试立即可用；用户再打一遍 BFF 收到 429 后才开始当前已实现的冷却。详情 SSR fallback 的原生重试链接同样不体现该时间。
- 若本轮“429 冷却期间不请求”涵盖初始 SSR，此处需保留初始限流原因和有界冷却，并补对应回归；若原作者／PM明确将本轮限定为增强 JSON 请求，则必须在验收与维护说明中记录 SSR 限制，不能声称全部入口已经覆盖。已向 root 交回，尚未收到闭环证据。
- 验证建议：隔离 fixture 让首次 SSR 首页／目录／详情返回 429＋Retry-After，然后核对初始文案、重试可用时间和冷却期间请求计数；同时区分普通 503、实际 404 和无 JS 的降级行为。

## 已核对的实现

**访客身份边界。** `VEHICLE_API_TRUST_PROXY_IP` 只有严格等于 `true` 才启用；默认 false 时不会读取 Next SSR headers。启用后只读 `X-HD-Visitor-IP`，通过 `node:net.isIP` 校验单个 IPv4／IPv6，拒绝列表、端口、zone、空白／逗号／百分号和无效值，重新构造一个 X-Forwarded-For。未读取原始 XFF、Forwarded 或 X-Real-IP。SSR 上下文和 BFF request.headers 都走该入口；Cookie、Authorization 和上游私有头没有随之转发给 API／浏览器。

该 opt-in 必须与约定部署同时成立：gateway 从连接来源覆盖专用头、web 不映射宿主公开端口、API 只信固定 web `/32`。`.env.example` 已写明这些前提。代码与单元验证不证明真实网络隔离／API trust proxy 已部署；该外部配置须由 OPS 另行核验后才启用，不能将任意浏览器输入的专用头当作可信身份。

**增强 JSON 与媒体限流。** requestPublicApi 保留上游 429，规范化 Retry-After 后交 BFF 返回 `RATE_LIMITED`、retryable 和有界 delta-seconds；不会泄漏上游 body、Set-Cookie 或内部头。`retryAfterSeconds` 接受 0–3600 秒的数字文本，非法、过大或 HTTP-date 回退 60 秒。hook 收到 429 后记录冷却时间，load 首先检查剩余时间，计时只更新界面，不主动发请求；按钮在冷却期间禁用，结束后由用户手动重试。该检查结论不消除 RL-02 的首次 SSR 缺口。

**明确前进／后退。** layout 已移除 InventoryFreshness，改挂 PublicNavigationFreshness；新组件只监听 popstate，没有 focus、visibilitychange 或 pageshow 激活刷新。导航信号记住路径与版本，并向迟到订阅者补发，避免仅依赖短暂事件窗口；检查通过局部 JSON 更换资源，没有 router.refresh、main 隐藏或强制重建图库。请求带 no-store／omit credentials，有取消及序号保护。UI 仍应通过实际时序确认 gallery 和输入保留，不能仅凭静态结构声称通过。

## 实际执行与限制

- `pnpm --filter @hd/web exec vitest run src/modules/vehicles/infrastructure/public-request-context.test.ts`：**1 文件、10 测试通过**，Vitest v4.1.12，约 18:37:30。本次 fetch／Next headers 全部由隔离单测替换，没有真实 HTTP。覆盖默认关闭、IPv4／IPv6、伪造替代头／非法值、SSR／BFF 身份、三个路径的 429 与 Retry-After、私有内容清洗及秒数边界。
- 当前工作树纯 `pnpm --filter @hd/web exec tsc --noEmit --incremental false` 通过；没有执行 typegen 或写入 `.next`。
- 未启动浏览器、HTTP 服务、Next、build 或生产操作；未修改作者源码、应用依赖或锁文件，未提交／推送／部署。导航时序、客户端冷却与首次 SSR 需要原作者补验证，不能用这 10 个网络单测代替。
- 本轮开始的 hooks 检查已通过。待原作者修复／澄清 RL-02、完成导航与冷却回归后，Reviewer 再按最终 hash 复查并更新结论。

## 第二轮源码复查：首次 SSR 与筛选服务冷却

root 完成首次 SSR 修复后交回，Reviewer 对下列新快照只读复查。**NAV-01 与三页主数据的 RL-02 源码路径已闭合**：初始 429 秒数经过 route → controller → hook，在 SSR 即输出限流提示和 disabled 倒计时；详情接受 nullable vehicle／稳定 id，普通故障没有被当成 404；JS 重试使用局部 JSON。首页、目录旧错误重试锚点在冷却时移除 href 并阻止点击。同版本同 target 去重、新版本中止旧请求的逻辑仍在。

hook 的 options 已改为 `{ navigationPath, initialRetryAfter, externalRetryAfter }`。facets 能接收主列表冷却；阻塞时把 state.url 记成新 target，因此冷却结束不会因 URL 差异自动再请求。用户显式重试会并行请求结果和失败 facets。`public-polish.spec.ts` 已有三页首次 SSR 429、同 URL 双 Back／inflight、等待后显式重试 results＋facets 的断言，Reviewer 仅核对测试源码，未运行浏览器。

root 报告首次 57 项定向 52 项通过，后续修正旧断言／相对 URL；SSR 429 三页、双 Back、激活零请求及 429 定向场景已有作者通过证据。当前新构建仍由 root 执行。以上运行结果不由 Reviewer 代签，也不将其写成 Reviewer 已验证的新成品。

### 第二轮剩余 P2／RL-03：仅筛选服务 429 时，没有共享回主请求

- `app/[locale]/cars/page.tsx` 的 initialRetryAfter 只读取主 result 的错误；首页同样只读取 home 的错误。两个入口的 filters.reason 为 429 而主请求成功时，Retry-After 仍被丢弃。
- `PublicVehicleList` 的 facets 只接收 `externalRetryAfter: resource.retryAfter`，UI 的筛选 warning／状态重试也仅接收主 resource 秒数。运行期 facets 独自限流时，facets 自己的 hook 会抑制它自己的 fetch，但主列表和 warning 链接并不共享该冷却；主 query 请求／整页重载仍可立即发生。
- 这不是仅假设的独立上游策略：补读 API 可见公开请求使用同访客 120/min 桶，边界时可能主请求是最后一笔 200，随后 filters 请求是 429。当前 `public-polish` 的 publicRateLimited 会让两者一起 429，不能覆盖这个分支。
- 已先向 root 报告。建议 SSR 双请求入口取所有 429 的最大秒数，并让运行期同访客公开资源使用共享冷却，至少保证 filters 独自 429 后不会继续发主列表请求；补 filter-only 429 隔离回归。当前尚待作者修复／明确处置。

### RL-02 无 JS 恢复补项

详情已提供 noscript 原生重载链接；首页与目录在 SSR 429 时移除原重试 href，同时 status button 为 disabled。关闭 JavaScript 后不会倒计时／重新启用，两个页面只剩浏览器刷新或外部导航，没有本页恢复链接。已建议 root 同样补 noscript 原生重载，静态 HTML 的等待说明如实区分；不要求无 JS 模拟动态倒计时，也不以它绕开 API 限流。

### 第二轮 21 文件指纹

本轮扩展只读覆盖包括首轮 11 文件，以及 SSR 三入口、对应 controllers／重试消费者、live-copy 和新增定向测试。原来 Reviewer 负责的 public vehicle card/detail/content/messages/contact 等实现不在这张独立审查表内。

| 文件（相对仓库根） | SHA-256 |
| --- | --- |
| `apps/web/src/modules/vehicles/infrastructure/public-request-context.ts` | `f34e2a25e280e93ba99198833181c18665d26f69f01feab8ad17ebdcb8660440` |
| `apps/web/src/modules/vehicles/infrastructure/public-request-context.test.ts` | `20cf014853077487b5a95def3947195c598816aabe40e135e8cfba39832fb21f` |
| `apps/web/src/modules/vehicles/infrastructure/public-api.ts` | `4259067880904c6843ccc99fe2bbf957313a15898a6acfb4d0a32c9dcfdaeeab` |
| `apps/web/src/modules/vehicles/infrastructure/public-proxy.ts` | `3b0a6099920f22d75afe19d51a815695717defd29e623a47c559e2afc7175315` |
| `apps/web/src/shared/lib/retry-after.ts` | `010c1c43eb942bc600c2d6970a8de932bd65cc617d27753f8a948b08dd3d9457` |
| `apps/web/src/modules/vehicles/application/use-public-resource.tsx` | `2c1cdad941e637a1ba90293159b811508baf644c9d2ca12f9eecdbd168965b2a` |
| `apps/web/src/shared/lib/public-navigation-events.ts` | `9a7835421cf2c9592e4df4180a3e98096b19e233379706d319ede97c9894870e` |
| `apps/web/src/shared/ui/public-navigation-freshness.tsx` | `fbd8c0975a329d49d6ce7489edaf189b215a587afa3a77af47329b567be82c8f` |
| `apps/web/src/app/[locale]/layout.tsx` | `aacb0b4d1d68dc6bf7ced9f5dddae2a4813ddc9cfbbb47e3d036129fa9809fc9` |
| `apps/web/src/modules/vehicles/ui/public-resource-status.tsx` | `b110db406cab1f6663f08620591eacd192488a3c77079a71bfaf0f4d4f929b55` |
| `apps/web/.env.example` | `9c5190fa88e46ccff5c2711ffdc5a76fb62129cfef9dbb593a15415fade17dc7` |
| `apps/web/src/app/[locale]/page.tsx` | `3d5412071bb9bb5a286867cc3857be65a889b34831c29f3e0e4ba41bcf4320ea` |
| `apps/web/src/app/[locale]/cars/page.tsx` | `052ebe9874020aac4903d291e30b6545aad8dbec61cefd7ab87f6b3199ed0b57` |
| `apps/web/src/app/[locale]/cars/[slug]/page.tsx` | `01c27c4f66958fc9fbc8d99a9d00a045cba5b9153369aa656ad5a788a65ca6a5` |
| `apps/web/src/modules/home/ui/public-home.tsx` | `1648563525f6dc2751c33fd4db0695e27ef66034f7f8bc5c146ce3fa911a8b93` |
| `apps/web/src/modules/home/ui/home-page.tsx` | `23ecb950e2a651ee887d2c2574f206834d69fd8b1046d5c33ef15a6c54599aab` |
| `apps/web/src/modules/vehicles/ui/public-detail-resource.tsx` | `37380ae26ed39f3534d29a2a88769fdc712878bbe45305d15a9c8cab156c83dd` |
| `apps/web/src/modules/vehicles/ui/public-vehicle-list.tsx` | `cf403d029361945794259a04c16e5586356f3699fd14e978bf774e5b8b50130a` |
| `apps/web/src/modules/vehicles/ui/public-vehicle-filters.tsx` | `b728b7d689a8724bc390d74f6c1ffe7481f1d0a068b4ff79984f58fdda430fb3` |
| `apps/web/tests/public-polish.spec.ts` | `2446a6f9edc412be5c314b91e611ad3301a0200b9667b1a7dad727b65a479513` |
| `apps/web/src/modules/vehicles/live-copy.ts` | `cbbf48897d0a2dbedc8962a0c79057a42ec383a7935b0ec80c3471dab8a186de` |

本轮复查没有新增浏览器／HTTP／构建／服务操作；等待 RL-03 和无 JS 恢复补项的作者处置后再登记最终结论与新 hash。

## 第三轮最终源码复查：共享 deadline 与统一无 JS 恢复

作者再次交回冻结源码后，Reviewer 核对新实现及对应测试。RL-03 与无 JS 补项已闭合，没有新增本范围源码缺陷；本轮是网络／导航／限流恢复的增量审查，不重复签署 HomePage 等文件中无关动效的视觉验收。

- **并行 SSR max**：新增 `publicRetryAfter(...settled)` 只收集 `PublicApiError(429)`，对有界秒数取最大值。首页和目录都把主请求与 filters 的 settled 结果交给它，包含主成功、filters 独自 429 的情况。新增单元覆盖单独 facets 429、两个 429 取长值以及普通 503 不生成限流等待。
- **共享 deadline 与竞态**：Catalog 用一个稳定 `useRef` deadline 传给结果、facets 两个 hook。任一端收到 429 仅用 `Math.max` 延长 deadline；共享模式下成功响应和普通 initial 更新不会清掉它。两个 hook 同处父组件，任一端状态更新后都会重新读取共享 ref 推导有效秒数，所以迟到的主请求成功不能提前解除 facets 引起的冷却。timer 读取同一 ref，延长后的 deadline 不被旧计时闭包截短。
- **冷却期间与到期**：load 在创建 fetch／controller 前读取共享 deadline 并阻断请求，同时记录当前 target URL，避免冷却到期后形成待执行的 URL 请求。计时只更新状态，不发网络；warning／status 的显式重试走 `reloadCatalog`，按当前 query 重试结果及失败 facets。NAV-01 的 target＋navigation 去重和新版本取消保护仍保留。
- **无 JS 恢复**：PublicResourceStatus 的 `fallbackHref` 在限流时统一输出 noscript 原生重载；Home／Catalog／Detail 都传本站当前路由，Catalog 保留筛选查询。主数据成功但 filters 限流时状态也为冷却，因此同样有恢复入口。详情普通故障的 noscript 重载只在无冷却时输出，避免与统一限流链接重复。JS 仍禁用冷却按钮并拦截旧错误／warning 锚点；无 JS 不假装会动态倒计时，实际限流仍由 API 执行。
- **测试源码**：新增 `public-facet-rate-limit.spec.ts` 有四个隔离场景：首页 facets-only SSR、目录 facets-only SSR、晚到主成功不能解除 facets 冷却并在显式重试后读取双方最新 query、无 JS 首页／目录恢复。fixture 限定到 loopback 3327、官网 3100，并在写入前经既有 health 标记确认；不操作运行中的 3320 数据。Reviewer 未启动该浏览器套件。

### 第三轮实际检查

- 独立重跑 `pnpm --filter @hd/web exec vitest run src/modules/vehicles/infrastructure/public-request-context.test.ts`：**1 文件、11 测试通过**，Vitest v4.1.12，约 19:24:34。fetch／Next headers 被隔离替换，没有真实 HTTP；相较首轮增加了 SSR 并行限流 max 的有效回归。
- root 提供的纯 tsc、668 单元和新构建信息属于作者证据。Reviewer 本轮未运行 Next／typegen／build、浏览器、HTTP、服务操作或真实 API 验收；此前本报告的纯 tsc 记录不冒充当前新成品检查。
- 下面的指纹为第三轮实际读取值，不沿用旧 217／241 freeze 或第二轮 hash。作者若再改动，需重新核对；root 新候选通过浏览器后应在本轮主日志补成品位置、BUILD_ID 和测试证据。

### 第三轮 23 文件指纹

| 文件（相对仓库根） | SHA-256 |
| --- | --- |
| `apps/web/src/modules/vehicles/infrastructure/public-request-context.ts` | `f34e2a25e280e93ba99198833181c18665d26f69f01feab8ad17ebdcb8660440` |
| `apps/web/src/modules/vehicles/infrastructure/public-request-context.test.ts` | `ff97e03a39ec07722767205f1e63ab0365bb9e324ab19f394f7a6481b16ffb6d` |
| `apps/web/src/modules/vehicles/infrastructure/public-api.ts` | `e2564e5a1c1ce8dd53f4416e7b9e136ced9d348cb6b55945b6143767c73c5104` |
| `apps/web/src/modules/vehicles/infrastructure/public-proxy.ts` | `3b0a6099920f22d75afe19d51a815695717defd29e623a47c559e2afc7175315` |
| `apps/web/src/shared/lib/retry-after.ts` | `010c1c43eb942bc600c2d6970a8de932bd65cc617d27753f8a948b08dd3d9457` |
| `apps/web/src/modules/vehicles/application/use-public-resource.tsx` | `21cc6ccec70cb98468d9c348513e1a900a23692e571ae18b8df9f29c8d9d0ba5` |
| `apps/web/src/shared/lib/public-navigation-events.ts` | `9a7835421cf2c9592e4df4180a3e98096b19e233379706d319ede97c9894870e` |
| `apps/web/src/shared/ui/public-navigation-freshness.tsx` | `fbd8c0975a329d49d6ce7489edaf189b215a587afa3a77af47329b567be82c8f` |
| `apps/web/src/app/[locale]/layout.tsx` | `aacb0b4d1d68dc6bf7ced9f5dddae2a4813ddc9cfbbb47e3d036129fa9809fc9` |
| `apps/web/src/modules/vehicles/ui/public-resource-status.tsx` | `7adfdae1bae87a75c578c983699c5b6281d4bef1b1f60dc74f06bc1b8147d102` |
| `apps/web/.env.example` | `9c5190fa88e46ccff5c2711ffdc5a76fb62129cfef9dbb593a15415fade17dc7` |
| `apps/web/src/app/[locale]/page.tsx` | `389b7f9a34f00863ea2b1849251e443bec211b370c2b947817c8243f5820e6c7` |
| `apps/web/src/app/[locale]/cars/page.tsx` | `96bd500ec5d6cc165b75093aed58584aefaca5c9408dc4ec537885942995659e` |
| `apps/web/src/app/[locale]/cars/[slug]/page.tsx` | `01c27c4f66958fc9fbc8d99a9d00a045cba5b9153369aa656ad5a788a65ca6a5` |
| `apps/web/src/modules/home/ui/public-home.tsx` | `fd95387dd1e6178c8399cc1c625a44f789086276f4ac42fb4ec6739930193bb4` |
| `apps/web/src/modules/home/ui/home-page.tsx` | `e24003e2ea3cc09229b82984384e047c73d8388e1aebe6b8baaf9300f4b8aca2` |
| `apps/web/src/modules/vehicles/ui/public-detail-resource.tsx` | `233cd084c7689326f4bec6bd4ae0a0fd9d6a1a0d615de6f6716cefce7096c1f8` |
| `apps/web/src/modules/vehicles/ui/public-vehicle-list.tsx` | `df1b42ec56c1fabb74cc4ac3425f8e48d7821f5e3deff5b80f215ec427801533` |
| `apps/web/src/modules/vehicles/ui/public-vehicle-filters.tsx` | `2c30d01fae335f84b1556a3258c9b17f8279e23631cfef9f809890778200fbd0` |
| `apps/web/tests/public-polish.spec.ts` | `2446a6f9edc412be5c314b91e611ad3301a0200b9667b1a7dad727b65a479513` |
| `apps/web/src/modules/vehicles/live-copy.ts` | `cbbf48897d0a2dbedc8962a0c79057a42ec383a7935b0ec80c3471dab8a186de` |
| `apps/web/src/modules/vehicles/server.ts` | `b092499fe2a63f181e811d739bf2979a63b621babaf99b6ba710c8c61d9ecaa7` |
| `apps/web/tests/public-facet-rate-limit.spec.ts` | `e2344fb16cc17e13f2785707bbd750500677024f175a0f6d11047346a07c82a9` |

## 第四轮两文件增量复查：保留已成功的当前查询字典

作者报告新候选 40 项定向中 37 项通过，三个旧三语用例在共享冷却期间等待已移除的 BEV 选项，随后交回本次调整。Reviewer 只读复查结论：**这两处改动未引入新的 P0／P1／P2，仍可进入同成品复测。** 40 项的运行结果归作者，修改后旧三语与 facets／导航回归仍由 root 执行，Reviewer 没有运行浏览器或 HTTP。

- hook 新增 `dataCurrent = state.url === url && state.phase === 'fresh'`。它表达底层数据成功且属于当前资源 URL，区别于被共享 cooldown 临时覆盖的 UI phase；没有将错误响应或别的查询数据标成当前成功。
- 目录只用 `facets.dataCurrent` 决定是否提供已加载的字典选项。相同 q 的成功字典在别的请求限流时继续可选；facets 自己失败、正在加载或不同 q 时仍传 null。若 data 为 null，现有可选访问回退也仍传 null。库存／联系仍消费公开 freshness 上下文，没有用该字典标志绕过检查。
- Reviewer 在内存移除新增返回字段／注释并还原目录条件，恢复的两个完整文件 SHA 恰好等于第三轮的 `21cc6cce…`／`df1b42ec…`。因此确认本次没有改共享 deadline、倒计时、fetch 阻断、URL 记账、版本去重或失败处理，不只依赖作者“两行修改”的描述。没有写回这两个文件。
- 此处只核对网络／筛选恢复。作者另报的 Hero nowrap CSS 与三个宽度单行检查不在本报告范围，不据此签署该视觉修改。

以下两项替换第三轮同路径 hash。全表核对随后发现另外三项新增变更，已在第五轮单独复查并登记；不能依据本节推定它们没有变化。

| 文件（相对仓库根） | SHA-256 |
| --- | --- |
| `apps/web/src/modules/vehicles/application/use-public-resource.tsx` | `a6102351073cea8aa1ef576277c7a5cffaf6bc45b2dca3b7616f368fc7373284` |
| `apps/web/src/modules/vehicles/ui/public-vehicle-list.tsx` | `66f85f60dbc83690bae39ad03169c0a486de956481f8f6b5da654121f732b4e9` |

## 第五轮三文件增量复查：首页筛选显式恢复

Reviewer 在第四轮后再次实际计算 23 文件指纹，发现 PublicHome 与两个定向测试已发生额外变更，因此没有将旧表未变作为默认结论；继续只读核对了这三个 root 文件。**本次未发现新增 P0／P1／P2。**

- PublicHome 为同一全局查询字典补充独立 facets resource，与 home resource 共用稳定 cooldown ref；SSR 成功车辆内容仍保留。状态区合并两个 resource 的 phase，避免 home 读取成功后掩盖仍失败的字典。显式重试同时重试 home 与失败 facets；只改挂载资源／回调，没有新增激活、定时或隐式到期 fetch。
- 三页 initial 429 的 public-polish 仍检查首次浏览器读取前的禁用／冷却与无激活请求。facets 定向用例额外检查：仅首页字典失败时保留现有车辆，冷却到期仍不请求，错误提示继续可见；用户明确点击后恰有 home、vehicle-filters 各一次 JSON，车型入口恢复。测试源码保留隔离 fixture 与请求计数，并不据此声称 Reviewer 已运行测试。
- 这次复查保留了第四轮字典 dataCurrent 的适用边界；首页全局字典 URI 不含目录 q，目录仍按当前 URL＋成功状态决定选项可用性。

以下三项替换第三轮同路径 hash。与第四轮的两个替换一起，23 文件当前有效指纹已全部逐项核对磁盘；Reviewer 未运行新的浏览器／HTTP／构建或服务操作。

| 文件（相对仓库根） | SHA-256 |
| --- | --- |
| `apps/web/src/modules/home/ui/public-home.tsx` | `2c9d689946dfb9726ab132468a1db0e0a32c57d38eb65c00e2c76239a8af8659` |
| `apps/web/tests/public-polish.spec.ts` | `1667e40843274913a33e1344ef7e04eca2587850f60592c5ba28ca959390e4a5` |
| `apps/web/tests/public-facet-rate-limit.spec.ts` | `e0760dc9e348af987e553652d82f3b1856ed002007e4c4bf99173d91f15784c0` |
