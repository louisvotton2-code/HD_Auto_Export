# FE-UX-03 配件模块与边界独立审查

- 审查人：`/root/fe_ux02_detail_audit`，不是本轮配件实现或边界守卫的作者。
- 日期：2026-11-08，Asia/Shanghai。
- 共同基线：`fdf6c6bc52b3a40761c4f991dde8e1f6a0fad028`。
- 对象：配件模块冻结范围 62 文件，加根集成人新增的边界守卫/测试 2 文件，共 64 文件。初审清单 SHA256 为 `321fbb019de10c2458ce4eff59b7b7686c16b87829ba314400330190b75d540e`；PART-01 修复后清单 SHA256 为 `fb11c2686ba960dcb635674aefcef6cd2927bb38dd30145e04f3ec377b229e9a`。其后两份维护文档增量已复读，最终逐文件哈希见本文附表。
- 方式：只读本仓与本地 `test` React 参考；执行隔离单元、架构边界和本地数据/素材核验。未访问原站、真实 API、服务器；未启动浏览器/服务，未构建、typegen、安装、提交、推送或部署。

## 结论

本范围未发现新增 P0、P1、P2。PART-01 初版修复曾被静态复查判为闭合，但根集成人的真实成品仍复现；本 Reviewer 初轮漏掉了 Next history 内部标记绕过，初次闭合不代表产品已经通过。最新 null-state 修复已完成源码增量复查，**PART-01 成品复验仍待根在新构建上重跑**。本文没有代签作者或根集成人的浏览器结果。

本报告不覆盖汽车收藏 store/心形按钮/VehicleRail（审查人是其作者），也不覆盖内联进口预算、真实配件接口、订单、支付、账号、消息发送、货运查询或生产运维。

## PART-01 · P2 · 软导航后查询与结果不一致（最新源码已复查，待成品复验）

初审 `PartsCatalog` 仅用 `initialQuery/invalid` 初始化 React state，并只监听 popstate。用户本地筛选至一条后，再点击头部或页脚 `/parts/` 的 Next 链接时，软导航更新 URL/服务端 props，但组件可继续保留旧筛选结果。已安装 Next 的 `layout-router.js` 第 364–365 行明确为不同 search params 保留同一 state key，不能依赖查询导航自动销毁客户端状态。

作者改为订阅 `useSearchParams`，从当前 URL 重新解析 query/error；保留本地 Apply 的即时状态、原生 history 更新、Back/Forward。非法 JS Apply 现在保留已经应用的结果/URL并显示错误，避免先规范化 URL 后又把错误抹掉。修复同时保留重复 query 值给解析器校验，不通过 `Object.fromEntries` 丢掉重复信息。

已独立复读 `parts-catalog.tsx` 的 URL 同步 effect 和 Apply guard，以及新测试“本地筛选→点击头部配件入口→URL 无 q、44 条结果、搜索框为空”。该增量在源码层面闭合。新增浏览器用例未由本 Reviewer 执行；根集成人须在新成品上实际运行。

根首轮真实成品后来仍复现预期 44、实际 1，失败材料为 `/private/tmp/hd-fe-ux03-browser/parts-header-parts-navigat-3b926-hen-Next-reuses-the-catalog/error-context.md`（结果由根反馈，本 Reviewer 没有运行该浏览器）。复查安装的 `app-router.js` 277–310 行，确认把带 `__NA` 的 `window.history.state` 传入受控 replaceState 会被 Next 当作内部操作，跳过 URL 订阅通知。仅加入 useSearchParams 的初版不足以修复。

现已独立复读两个受控更新点：目录 Apply 与详情数量均改为 `history.replaceState(null, '', href)`，由 Next 自己复制内部状态并通知 URL 订阅。没有执行页面刷新或改为 router.replace，没有引入额外数据请求。扩展后的原测试同时断言 Apply 不发 query RSC/document/API、头部入口恢复 44 条、再次筛选进入详情后 Back 恢复 q 与一条结果。该测试源码与边界匹配，实际行为仍由根新构建重跑决定。

## 源码与事实核对

- **职责分层**：路由只经 parts 公共 UI 入口和独立 server facade 装配；repository 与静态资料隔离，UI 不读取原始 JSON 或竞品接口。共享层不反向依赖 parts，车辆 API 与七国计算器未被该模块调用或复制。当前浏览器本地筛选只用于明确的 44 条静态配件资料，文档要求未来分页 API 接入时先改变查询契约。
- **参考依据**：只读本地 `PartsPage.tsx`、`PartDetailPage.tsx`、卡片/样式和 `public/js/mock-data.js`，将其作为参考数据，没有执行脚本。保留黑铜配色、双层搜索、侧栏、目录卡片、两栏详情、数量与联系区域的结构方向；没有复刻未知 OEM 回退首条、装饰性排序、购物车、假询价成功或来源库存总数。
- **资料与价格**：原始 44 条配件 JSON 与本地参考的 `window.MOCK.parts` 完全一致，采用 JSON 解码而非执行 JavaScript。展示映射按真实 OEM 建稳定 slug；名称三语有值，移除未经核实的原厂正品保证。原始 Engine 组包含 ABS/连接器，展示归为通用部件，不推断发动机适配。价格为已捕获的 USD 参考价，缺失为 null，不填零，不称库存或最终到手价。
- **素材**：36 个 JPEG、1,282,187 字节；44 条记录引用的图片均存在，无闲置图片；逐张 SHA 与来源清单一致，JPEG 文件头正确。来源 snapshot SHA 与本地 mock-data.js 相同。没有通过竞品域名加载图片；原始每条只有一张图片，未重复封面制造多图。这里核验文件身份、引用及文件头，没有代替浏览器或人工逐图视觉检查。
- **查询**：OEM/当前语言名称/英文名称/品牌字面搜索、类别/品牌/价格叠加、价格及名称排序均对完整静态集合操作，排序不修改源数组。非法价格不被解读为零。查询相关表单具备原生 GET，外部 q/sort 控件显式关联筛选表单；无 JS 收藏增强隐藏，不阻断目录。
- **身份、SEO 与 404**：异步 params/searchParams、locale 校验与 request locale 明确；未知 OEM 不回退其他商品；metadata 的 canonical/hreflang 采用本地化小写稳定 slug，目录及详情均 noindex/nofollow。该范围没有添加假现货、事故或适配数据。
- **数量与咨询**：1–999 整数校验，详情价格不冒充含运费/税费的总价；非法 JS 数量撤销两条草稿 href。原生 GET 可更新数量后生成对应草稿。helper 校验 slug/OEM 一致，使用统一 HD Telegram/WhatsApp，草稿包含名称、编号、数量、已知 USD 单价及本车件详情 URL；没有自动发送，也不使用参考站账号。
- **配件偏好**：独立版本化存储只保留已知 OEM ID，最多 100 个；目录/详情共享 store、同页订阅及 storage 同步，SSR 稳定空快照，坏 JSON/旧版本为空，存储访问或写入失败保留当前页面内存操作。配件不混入汽车收藏抽屉。不将已存 ID 作为库存或报价事实。
- **图库与布局源码**：原生大图链接、可增强的 native dialog、关闭后焦点返回、Escape、键盘多图切换、滚动锁均有实现；当前真实资料只有一图。样式为局部 CSS Module，最新断点为手机 2 列、768px 起 3 列、1280px 起 4 列，详情两栏转单栏；文本与控件有换行/最小宽处理和 focus/reduced-motion 样式。实际尺寸、触摸、焦点及动态效果须由新成品浏览器确认。
- **边界守卫**：parts 加入 home/vehicles 同类 facade 规则；跨模块不能深导入 parts 内部，只有 app 装配可用 parts/server。新增辨别性测试同时验证 app 合法公共入口与 server 入口，以及 home 深导入/shared server 导入两种非法路径；没有放宽旧计算核心或车辆约束。
- **文档**：模块维护说明明确 44 条资料与 36 张参考图、Node 官网现状、未实现业务和未来 API 入口；作者日志区分作者自测与独立/成品验收，PART-01 修复有记录。源码和文档没有把本轮列举的 E2E 写成本 Reviewer 已运行。

## 本地 React 断点增量复查

初版与本地 React 的 1440/1280 容器、手机单列/两列、侧栏断点差异已反馈给根。作者随后按本地 `pages.css` 969、1134、1244 行修改：1280px 容器，默认 16px 留白、640px 起 24px；目录默认 2 列、768px 起 3 列、1280px 起 4 列；仅 1024px 起 260px sticky 侧栏，以下为全宽筛选。已逐条对照最新 CSS，旧的 max-width 覆盖没有再把手机恢复成单列。手机正文 14px padding、14px/1.4 两行名称、可断行 OEM/价格、32px 不收缩联系按钮以及原正方形图片比例保留。最新 CSS 哈希见附表；旧成品不含这些改动，仍需新的俄文 320px/390px 与桌面视觉验收，不能把 CSS 对照写成实屏已验。

## 实际独立执行

2026-11-08 21:59（本地时间）：

```sh
pnpm --filter @hd/web exec vitest run src/modules/parts/parts.test.ts src/modules/parts/favorites-store.test.ts
pnpm --filter @hd/web check:boundaries
```

- Vitest `4.1.12`：**2 文件 / 10 项通过**。涵盖资料身份/未知路由、查询、数量与区间、三语草稿、收藏白名单/上限/恢复/存储异常。
- 边界守卫：**7 个脚本测试通过，实际源码扫描通过**。
- 纯本地 Python 校验：初审 62 文件全部符合初始指纹；修复后 62 文件全部符合新清单；44 条参考 JSON 与本地 literal 相等；36 素材引用/文件头/SHA 零异常。JSON 解析不执行参考脚本。
- 8 个配件 E2E 场景只读过测试源码，未运行浏览器。未执行 Next build/typegen 或 HTTP 检查；新增 URL 同步需根集成人新成品验证。
- 成品首轮反馈后的增量：再次执行 `pnpm hooks:check` 通过；只读复查 catalog/detail/CSS、完整 8 场景测试及两份维护文档，重新核对 62 文件清单全部匹配 `86e78819a49a9de597f9f9a002a01b3f0bc324f2f24882a310b4feed1d2f00f7`。此前 10 个隔离单元涉及的源码未变，不将它们当成新 URL 同步或 CSS 的浏览器证据。

## 最终源码 SHA256

最终配件 62 文件清单 SHA256：`86e78819a49a9de597f9f9a002a01b3f0bc324f2f24882a310b4feed1d2f00f7`；下表同时追加 2 个边界守卫文件。

| 文件 | SHA256 |
| --- | --- |
| `apps/web/public/parts/083a544cd0a0b01b.jpg` | `d3198828dc02f33dd5f1e24de3d48fce55ad131827e4ef1d235a8a88873ea7c2` |
| `apps/web/public/parts/1013fd2517c764bd.jpg` | `61171b4cbb0193462a76c518222c018c0f3f859facc70e7fb0bd45990d1ffa8b` |
| `apps/web/public/parts/118d58ac16dbeb94.jpg` | `6a3776610d43119ee99fbfdb939d290218f2cee7757d7501d093bc65cf6f3159` |
| `apps/web/public/parts/245fe1b98ae98f47.jpg` | `faaf7f982cc63c7548815bd5a18c5299a8aa6bbdb72500feadbe697c8cdd2609` |
| `apps/web/public/parts/25f105d54a77984c.jpg` | `3d4736574e035b67102dbf3b4ce2b4101ed6cc04c045521d84233855da10742a` |
| `apps/web/public/parts/2c7fc2a2c683da48.jpg` | `07cac66ba9549d08480c88891f90a5eb60740525ce78f351003531f51684c094` |
| `apps/web/public/parts/3d1c6d712e4104e9.jpg` | `b846d4549130dde6b98940f4d1d4d7305f07ac666e8d85a88549fe3b7f006867` |
| `apps/web/public/parts/44436ce457d77af6.jpg` | `4da2e0da80096911ed485ba3d0bf30c8743f42e6cdf9fbace5313003c238731f` |
| `apps/web/public/parts/4a74757b2b29312b.jpg` | `dff1d229fd277fb28814f77d9f079bf6e1c8468c8a7a0c3b7a2ea6cb954e6c71` |
| `apps/web/public/parts/4f54bbf9215150ae.jpg` | `d08faa5d115842efe99ddc1a11845e7c993d91b4af2f687b56c863183108aa80` |
| `apps/web/public/parts/52b7923986dfcc88.jpg` | `eca7607af8fe251005b348cd450790df4ede63d55c0aab9c0969b630a5ce0cfa` |
| `apps/web/public/parts/63d03e5cfc4c49d7.jpg` | `4df045479bf3806bb5f091cac4f0f19684d6f981f370dc72759dec79fa61d1b4` |
| `apps/web/public/parts/66263e72a3f8fe66.jpg` | `e615409ebd8fb39b94d253d898a6243cddf4826f1cce1993cead005ff976d7d5` |
| `apps/web/public/parts/72ac5b6b1c4f600c.jpg` | `146a144b52bfc5355f2ebc5b4ec724cc8e945a779101ec28a6ddf27ed310a2c1` |
| `apps/web/public/parts/738fa85a25bf4b25.jpg` | `68a68a389a22c641787c5ee8ee5aefa6a5c4186302a77b0bf937517f244a5dee` |
| `apps/web/public/parts/74f30c898502657a.jpg` | `5456af7d393ad46c6622e00f932a991ef84a13d8dc060b47a443debf6160e54d` |
| `apps/web/public/parts/8045f2abe01fcaa8.jpg` | `ba8f9b59690e0e9cf4ef074d5e73fd089738db9a8ba425435d66cadbbfc803bf` |
| `apps/web/public/parts/84710aa74b231da7.jpg` | `fa69e5c3659a57ea742dee4479b7880c909fbeb1e747788cbe0b1915d3b713ec` |
| `apps/web/public/parts/852ddb9c5c186f9e.jpg` | `3773ccce285d90251562a72dc380f2c450edb4822bc73b4345580c46ef9b3660` |
| `apps/web/public/parts/8c3cfcd785f790f5.jpg` | `0323d933b3e0114dff85a83d178186bb3cce8b2257b98c271e97525efcbfde61` |
| `apps/web/public/parts/949b7116d0c52f95.jpg` | `11247fe06d60d509a577cedefbeb8714d8c451bd176eb85504bec8e786631880` |
| `apps/web/public/parts/974e1d2c87be8531.jpg` | `bc95adb09da03a5caa5c7a2b9302c050f714b426b4b87be02bc3779af21587f6` |
| `apps/web/public/parts/a591d349abe263e4.jpg` | `4e09de102cc645761133bde9706a0317b6b8d74af887faadbe92ce2e622c7b87` |
| `apps/web/public/parts/a5e58391e09d9955.jpg` | `59124617c615428e3179df685ac330fba8ce2bca16daafcd0e77d9228a0242aa` |
| `apps/web/public/parts/a898263d884677e8.jpg` | `bbc381fd8f9e994bfc2cae7291f8ac6f6c83b3d7ade3b542f153316b919864e3` |
| `apps/web/public/parts/a8ee1fd992c564c6.jpg` | `4e8bf31109dbb03081ca98dff78b06612645dedf78030a318387c518f308b57d` |
| `apps/web/public/parts/c6dee8d4b9430f03.jpg` | `3507e3706eac44981c586bd9846553e16f1aa4a70ce3da0a794d1f92ee52ef91` |
| `apps/web/public/parts/d0cb278fb219b3f7.jpg` | `296f436f416dfe2e44f95f268c5e713eb75194742e4a6d467128c249d4d9140e` |
| `apps/web/public/parts/d235613589edcd07.jpg` | `9ffb9cc2149138578758765447719ca29da67b238ddd5ccf0fc047a1bcd5eac3` |
| `apps/web/public/parts/d24562a9ae161a34.jpg` | `897c97c48014f67936de6982def1d83bb95b284cc98d62b910e76e390688a017` |
| `apps/web/public/parts/d4fb6e28b4880e8b.jpg` | `4da2e0da80096911ed485ba3d0bf30c8743f42e6cdf9fbace5313003c238731f` |
| `apps/web/public/parts/d93a6b9d773d25de.jpg` | `fe1df061625e9a742ff87908ab441169cda64ecde181fcb1c7c0b678f30518aa` |
| `apps/web/public/parts/e31510df1a0422a4.jpg` | `d8537f324641f3ffe27bbcd96d04bb780ae7b997bdb2edf4407afce478aa3470` |
| `apps/web/public/parts/e661a51203f0d062.jpg` | `9267739b559f638b419c4d5148d76cc41822adf9c2580290c09637e84791a506` |
| `apps/web/public/parts/e793d4d1bcec641f.jpg` | `0dca92fab1af2c26b53582b53ae2a02a01435a5247cc034caf685b4d311ff534` |
| `apps/web/public/parts/e968028667c81c25.jpg` | `e4627bfd50f7627fc2da80b4597d83162f08871956fe69928c6cdc3e07f6169a` |
| `apps/web/src/app/[locale]/parts/[slug]/page.tsx` | `5fad817a6dc585899b01ec735b7f8fbdcc3db37ec38f185f5de66862e6b5fa5e` |
| `apps/web/src/app/[locale]/parts/page.tsx` | `955170c2bea4f4f022c7c8adaa455e50d1e6ac184acb7b70cacdb2725bb3dcf4` |
| `apps/web/src/modules/parts/contact.ts` | `287625319155261d2bb69f01691567fe6eab408c1e944c9a24944eef2e5dc5d0` |
| `apps/web/src/modules/parts/content/parts-content.ts` | `da6171c29e250e0c3a3b7654968a2018bf81fa13f82b492118880a9c37c4dbfc` |
| `apps/web/src/modules/parts/data/name-translations.ts` | `0f04a161b9a9e537da36a1ca096199952f6ea96c5b38bb306ee31cca1930767a` |
| `apps/web/src/modules/parts/data/parts-data.ts` | `7c11becfce1dee391d92700ca3baa469fe620cb5985ccca27a62a5440d3cce3e` |
| `apps/web/src/modules/parts/data/reference-parts.json` | `0c635dd493c60ecfe391c60a72596b965139c880105e164a97cd1246726d4a43` |
| `apps/web/src/modules/parts/data/source-manifest.json` | `01b512be3aa819582b26b3aca5c8030e47565913a65a800add2a498c1d909e8c` |
| `apps/web/src/modules/parts/favorites-store.test.ts` | `bbb9cb12a079c343ca899ff5717a04693ea2c780548462cb650f62423a5013f3` |
| `apps/web/src/modules/parts/favorites-store.ts` | `71a7690a40e9d983ff1e49f15de32c2d1ca35576dca42c88478fee1c233776f5` |
| `apps/web/src/modules/parts/index.ts` | `6f8d800792a81a2b415e099a1cd98af5a0f5b29ec9c9d4cf32908ec5106b3c01` |
| `apps/web/src/modules/parts/parts.test.ts` | `6d3996ab3a453218e69b8bcb35fe79228fb7486c12e3667b503c9e274873ee49` |
| `apps/web/src/modules/parts/query.ts` | `01bca199f93e4299d1b3e0d39b48ae47205a8c4fbbb9e959b0fdc0f61cb685cb` |
| `apps/web/src/modules/parts/repository.ts` | `61659b5ebc92d9d5590944863d230a55066d94fa156ecbb04f08cc84aabbf935` |
| `apps/web/src/modules/parts/server.ts` | `83742c2d97b980cc350d7250b3fd9bc5f8e28c5545ad1ffacce28a75f1b9bada` |
| `apps/web/src/modules/parts/types.ts` | `b0c694c7d395fa24fd809335f81b867b843a0852dd3614e6043e278d74bc07bd` |
| `apps/web/src/modules/parts/ui/part-card.tsx` | `0eba13887395cfa09ea85ef7cff60b723858db991ae61259cdd125939a7d6660` |
| `apps/web/src/modules/parts/ui/part-detail.tsx` | `19d591aff384f9f8dabc1b16dfd3c5cf18698ea2c8593bc1c49c5599ae5bbd03` |
| `apps/web/src/modules/parts/ui/part-gallery.tsx` | `5d946c0a5453c5c4b0c4ad57e6ee0cdb3e1785ef5a1b46871d6412d1ac313e47` |
| `apps/web/src/modules/parts/ui/part-save-button.tsx` | `ea0c1f5b096901b1740c671507dc3ebbc63d7e51d4d43c32eb0ec6680a949219` |
| `apps/web/src/modules/parts/ui/parts-catalog.tsx` | `3190c6dfaee2da5404f5450692675065db48d088defc21e2c78adfb7635ed0f4` |
| `apps/web/src/modules/parts/ui/parts.module.css` | `d1e0f9be40fdee9314f341c46b2d088fced751698d64281eb50520f724820cc6` |
| `apps/web/src/modules/parts/use-part-favorites.ts` | `fd24c8961a47b6eb375b2b8a15ca60e679aa0cd5db735341c9efb3aa7e3d04ef` |
| `apps/web/tests/parts.spec.ts` | `e42ba258ca719f6b5b6fe66c558e72ef21c33735010c1585e5e1c2d7e86cc288` |
| `docs/开发/模块/配件目录.md` | `8b053a55b47d430455df2fd7ac486c064510ce57d4c775f733efefcf7921cf94` |
| `docs/日志/2026-11-08/前端-FE-UX-03-配件目录与详情.md` | `5c6aa0b85bc4122eaddae3ea8817ec84d2c1d8dcb3308887ca9712a8c062a8df` |
| `apps/web/scripts/check-boundaries.mjs` | `2936f411d872ec2e7f69f745444ccf3cc78444e6b103a8c43a93608d0343bf04` |
| `apps/web/scripts/check-boundaries.test.mjs` | `16c7f45af3e6c3b0eee09b1100cb9fd36a5cb4021784d3ec5d5a973d6c7ec479` |

变更后需对新指纹增量复查，不能把本文直接当作后续提交、构建或部署的已验记录。
