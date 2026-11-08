# FE-UX-03 统计与公共布局收藏抽屉独立审查

- 审查人：`/root/fe_ux02_detail_audit`，独立于下列统计、抽屉及公共布局实现作者。
- 日期：2026-11-08。
- 共同基线：`fdf6c6bc52b3a40761c4f991dde8e1f6a0fad028`。
- 对象：本轮工作树中的冻结源码，逐文件 SHA256 见下表；不是已提交版本的整仓审查。
- 工作方式：只读当前源码、差异与测试；执行隔离单元测试。未访问参考原站、真实 API、旧服务器，未启动浏览器或服务，未执行构建、typegen、安装、提交、推送或部署。

## 结论与边界

本范围未发现未解决的 P0、P1 或 P2。初读确认的 FAV-01 已由作者修改，随后按最新源码独立复查闭合。结论仅覆盖下述实现与最终哈希，不替代集成人的成品浏览器、三语视觉、手机布局及业务验收。

本审查不包含审查人自己实现的收藏 ID store、hook、公共心形按钮、车辆卡片/画廊、卡片 CSS 或 `tests/vehicle-favorites.spec.ts`。`home-page.tsx` 是共享文件：这里只审查其他作者新增的 `HeroStats` 接线、目录总量来源与配件入口，不审查本人修改的 `VehicleRail` 区域。`home-stats.spec.ts` 的长标题用例只审查测试断言，不将其作为本人卡片实现的独立审查。详情预算、计算器种子与详情路由装配由另一名 Reviewer 覆盖。

## 发现与复查

### FAV-01 · P2 · 收藏抽屉丢失价格性质与已知售卖状态（已关闭）

初读时，`SavedCar` 只显示 `formatPublicVehiclePrice` 的金额/原币，未保留 `reference` 与 `asking` 的价格性质。原本标记为参考价格的车辆进入收藏后，会失去该语义；同时已知 `sold` / `reserved` 事实没有显示。

作者现已在 `vehicle-favorites.tsx` 中：

- 对 `reference` / `asking` 使用现有三语 `priceLabels`，`on_request` 保留格式化函数的询价文字。
- 仅对真实 `sold` / `reserved` 使用既有 `publicAvailabilityLabel`；未知库存不输出状态，不把未知伪装成可售。
- 为价格性质与真实状态增加抽屉内局部样式，没有改变 DTO、金额或来源契约。

独立复读当前 `SavedCar` 及对应样式，以上两点已闭合。作者后续格式化该组件与样式，并在 `favorite-drawer.spec.ts` 新增参考价格/预订状态断言；已逐段复查这三处增量。最终源码哈希为 `c1ae952462a6fa826b295725b3553b7793ff6e8b4038451c8d42af99ee7512cc`，CSS 哈希为 `2ace76c658edab364b1aa5cfb4461c7b152344065c414a090836a974333d39a5`。本轮未代签新增浏览器用例的运行结果；报价/询价与已售状态仍可随集成验收补充覆盖。

## 核对要点

- **统计事实**：公司数字集中于 `company-metrics.ts`，使用用户确认的 `660+` 位满意客户、`3` 年。目录数来自无关键词的公开筛选字典中互斥动力类型的计数之和，包含 unknown 动力类型；不是首页推荐栏的条数。结合现有 API 分组实现核对了此口径；字典缺失显示 `—`，确认空目录显示 `0`。
- **数字动画**：可注入时钟的单次 cubic ease-out；取消后旧回调不再更新，后台时间跳跃可直接结束，非负安全整数校验。SSR 先输出真实最终值；浏览器在 layout effect 开始动画。减少动态效果时直接显示最终值，偏好中途改变会取消动画。读屏获得稳定最终数字，避免每帧播报。
- **抽屉数据边界**：仅在打开抽屉时按已存 ID 读取当前单车 DTO；顺序读取，关闭/移除/语言变化取消旧请求，不抓取全目录，不在 focus、visibility 或激活时取数。当前 DTO 仅留在组件内存，收藏持久化仍只存 ID。
- **错误与限流**：读 helper 校验 ID、响应 schema、响应 ID 和当前语言详情路径；404 是不可用行，没有旧标题、旧价格或详情链接回退；临时失败不误判 404。429 保留有界 Retry-After，停止后续队列；冷却到期不自动请求，必须显式重试。请求经过同源公开边界，omit credentials、no-store、禁止跳转。
- **公共布局边界**：语言 layout 从业务模块公共入口装配 `VehicleFavorites`，通过 ReactNode 槽传入 `SiteHeader`；shared header 不反向导入车辆模块。新增配件导航与首页快捷入口均为真实本地化链接；关于我们/联系我们未增加激活状态。头部断点调整至 1280px，极窄屏只收起品牌中的次要文字，品牌链接完整可访问名称仍保留。
- **抽屉交互源码**：原生 modal dialog、标题关联、关闭按钮、Escape/native close、关闭后归还触发器焦点、开启时背景滚动锁、长文换行、正文独立滚动、减少动态效果样式均有实现。实际焦点圈、手机手势、尺寸与跨路由行为仍需集成人浏览器验证。
- **翻译与接线**：抽屉三语 key 通过同一类型约束；统计三语标签、年限后缀完整。`getVehicleCalculatorMessages` 只装配既有消息，不含凭据或服务器实现。这里只核对该 helper 的序列化形状，预算业务不在本范围。
- **测试源码**：根作者的 `favorite-drawer.spec.ts` 覆盖三语跨路由持久化/移除/焦点、404、关闭中断、429 顺序队列与五个宽度的俄语头部；`home-stats.spec.ts` 覆盖全目录口径、刷新动画、减少动态效果、无 JS 最终数字、三语长标题几何断言。既有 home-vehicles 测试已将配件占位弹窗改为真实路由断言。这些 E2E 在本审查中仅阅读，未运行。

## 实际执行的验证

2026-11-08 21:53（本地时间），运行：

```sh
pnpm --filter @hd/web exec vitest run src/modules/home/ui/count-up.test.ts src/modules/home/ui/hero-stats.test.ts src/modules/vehicles/application/read-favorite-vehicle.test.ts
```

结果：Vitest `4.1.12`，**3 个文件 / 16 项测试通过**。这些测试仅使用可控时钟、服务端静态渲染和注入 fetcher，未访问真实 HTTP。

本轮开始时已按项目规则执行 `pnpm hooks:check` 并通过。此前实现者自测、其他模块的测试及根集成人未来的构建/浏览器结果，均不计入本独立报告的实际执行项。

## 最终源码 SHA256

以下 21 个文件绑定本次审查；共享文件的审查范围以本文边界为准。

| 文件 | SHA256 |
| --- | --- |
| `apps/web/src/modules/home/content/home-content.ts` | `9aea8f2872278d7fd6d16089b6f122419ce87a36a80ffb9f39353acb35b9cc19` |
| `apps/web/src/modules/home/content/company-metrics.ts` | `d023c22f7269fba521cc0e45976852eea826cb8038c959289dfb8fa6a0bcc9da` |
| `apps/web/src/modules/home/ui/count-up.ts` | `601d96f1394098016435427a11455e66e4a3e644283e3cee8f3527e374f01022` |
| `apps/web/src/modules/home/ui/count-up.test.ts` | `a11f7b1a7ca95476b58926a41cc52e23227a26e1ac0e2393e34fdbe20290a2e3` |
| `apps/web/src/modules/home/ui/hero-stats.tsx` | `baf77570d5077d1fdcccb52a6fe8115712b65f73118873cede3dd0ff3e843ebd` |
| `apps/web/src/modules/home/ui/hero-stats.module.css` | `377c8baec1aa2fcf2ec4cb39edfcd44ef6deae456e90d3ea8e5bc2f5678ba85c` |
| `apps/web/src/modules/home/ui/hero-stats.test.ts` | `faf10f93b98e4fb686f6aeb1bb3aa66eeb2a38675985c60d73ebf68b7b4a97c5` |
| `apps/web/src/modules/home/ui/home-page.tsx` | `765da126866ed71cbc7f940131fe409742c35e941524be56e45df2c4d66e9616` |
| `apps/web/src/app/[locale]/layout.tsx` | `f4d387252e3c22ca0c7ae711b89254049a6e1d76f86446b8bd8e0784da01d275` |
| `apps/web/src/i18n/client-messages.ts` | `54ef0fbe1ef8f97ea41821245784618713b4a3946a5c874ece94952716dd85ad` |
| `apps/web/src/shared/ui/site-header.tsx` | `89b909d800ba416c6cc04749331890964ee1ea155df86a048471cb01ed1b46a9` |
| `apps/web/src/shared/ui/site-footer.tsx` | `5bc477fbb8a2090b50c6dbc018ad9484c0bf1e0bf4cd6347bf71a8eeb93fa14b` |
| `apps/web/src/shared/ui/site-shell.module.css` | `b6e2fa43675b3daef240dbe091ab1aabe80259f075e4ae419ce12714735a2450` |
| `apps/web/src/modules/vehicles/favorites-content.ts` | `2ef1183fb8808d56661e1f19b0f0b8024063957f486fc1ba29a334d0422f31d5` |
| `apps/web/src/modules/vehicles/ui/vehicle-favorites.tsx` | `c1ae952462a6fa826b295725b3553b7793ff6e8b4038451c8d42af99ee7512cc` |
| `apps/web/src/modules/vehicles/ui/vehicle-favorites.module.css` | `2ace76c658edab364b1aa5cfb4461c7b152344065c414a090836a974333d39a5` |
| `apps/web/src/modules/vehicles/application/read-favorite-vehicle.ts` | `8bbe46ba10badf971a30fc9bf03d1f9d3965ed286c03c855c110bd5bcd966544` |
| `apps/web/src/modules/vehicles/application/read-favorite-vehicle.test.ts` | `f7b1087bd041ced9cd3e520879b0301ba29d0d8597893a560f6f8006612e2730` |
| `apps/web/tests/favorite-drawer.spec.ts` | `91d7b9661c5bbf86f7323dfe1ce8f8ca9503d03986883d51d73edbb4fdb2b2df` |
| `apps/web/tests/home-stats.spec.ts` | `ce094deab9f486b9b8802252d88e9fe6a4bc31f9bdcaa477c82184bf631aded0` |
| `apps/web/tests/home-vehicles.spec.ts` | `d7f3d9e6494135ba54d352b77990c9300b7f95a2bb0e05788f1fb1bb75cf1b85` |

如果这些文件继续改动，最终提交不能直接沿用本文哈希，需增量复查并登记新指纹。
