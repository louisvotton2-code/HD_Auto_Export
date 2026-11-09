# BE-EXT-01 第一阶段：契约与公开目录独立审查

日期：2026-11-10。审查者：`/root/contract_review`；实现者：root。共同基线与当前 HEAD：`fd16e00e23db8b8956f0c398ab1c198e82a61bc2`。对象为当前未提交的 BE API/contracts 增量；具体指纹见末节。

**最终只读复查结论：第一阶段原 2 项 P2，以及本次离线样本适配增量新发现的 2 项 P2，均已修复并定向复查关闭；当前下述受审范围无未关闭的确认阻塞。** 未发现本次范围内新的鉴权绕过、任意服务器下载或分页拼接问题。该结论限于下列实际检查，不表示完整服务、真实上游、数据迁移或生产验收通过。

## 原确认问题（已关闭，保留复现记录）

### P2-1：常见格式的完整 VIN 与联系方式可进入公开文本（已关闭）

位置：`apps/api/src/external/normalize.ts:43-47`（isPublicText），以及调用该过滤器的 sourceCopy/buildProjection。

现有 VIN 正则只匹配大写；电话只拦截连续的中国大陆手机号及部分关键词。对合法候选的 description.original 依次放入以下合成文本，调用现有 dist 的 buildProjection，三个输入均被 isPublicText 接受，并同时出现在公开 localized.en.description 和 details.original.description：

- `VIN: 1hgcm82633a004352`
- `Contact: +44 7700 900123`
- `Call +1 (202) 555-0142`

这与车辆接口“公开 DTO 不含完整 VIN、供应商联系方式”的边界冲突，不只是 schema 中有没有 vin/contact 字段。相同过滤器也用于标题、名称、图片 alt、规格和检测条目，问题不局限于 description。

建议：补充大小写归一的 VIN 识别、常见国际/分隔电话及联系指示格式处理，或采用更保守的来源字段公开策略。不要把一组正则通过当作完整脱敏保证。增加上述形式及所有公开自由文本入口的回归，确认原档仍只留管理端，公开输出和 detail.original 都不再含被阻止内容。

### P2-2：图片 alt 会重新公开已被抑制的争议事实（已关闭）

位置：`apps/api/src/external/normalize.ts:190-194`，传播至 `apps/api/src/external/catalog.ts` 的 images[].alt 与 display.mediaAlt。

离线复现：候选标记 `disputes=['modelYear','powertrain']`，图片 alt 为 `2024 hybrid vehicle`。buildProjection 正确将 modelYear 置 null、powertrain 置 unknown、标题改为中性文字，但图片 alt 仍原样保留。catalog 投影会把它写入公开图片的 alt 和 display.mediaAlt，屏幕阅读器及图片失败后的替代文字仍会陈述争议事实。

第 15 节已决定争议来源隐藏其自由文案，以免再次陈述争议事实。建议将来源图片 alt 纳入相同规则：在争议状态下清空或仅使用明确的中性替代文字，同时保留图片和后台原始证据；补上争议图片 alt 的公开投影回归。

## 已完成的实际检查

- 重新读取项目协作与后端规范、本轮接口第 15 节；`pnpm hooks:check` 通过，限定 API/contracts 的 `git diff --check` 通过。
- 独立执行 `node --test packages/contracts/tests/external.test.mjs`，**3/3 通过**；直接使用已有 dist，没有运行会重建的 package scripts。
- 独立离线复现上述 2 个问题：仅合成 fixture、纯规范化函数，没有数据库或外部请求。
- 离线检查 countExternal/listExternal/externalFacetRows 的 SQL 生成：完整分类、范围、币种与 q 条件使用相同 WHERE 和参数序列；引号、百分号、下划线搜索文本仍在绑定参数中，未拼入 SQL；LIMIT/OFFSET 为独立绑定参数。这是 SQL 生成检查，未将它冒称 PostgreSQL 实际执行证明。
- 使用只在内存返回行的数据库替身调用 InventoryService.listPublic：员工数分别为 0、1、47、48、49、96，各配 105 条外部记录，逐一检查 6 页，共 **36 个分页场景通过**。结果顺序与“员工组优先、随后外部组”的预期数组一致，total/hasMore 正确，跨组边界无重复或遗漏，超出范围为空。未连接数据库。
- 旧 manual fixture 经新 PublicVehicleSchema.parse 后深度相等，没有额外字段。代码检查确认仅功能开关开启且 view=localized 时合并外部结果；外部详情默认/legacy 返回 404；首页仍走既有人工配置。
- 配置函数离线验证：默认关闭；synthetic 只允许 loopback API、127.0.0.1 的 hd_ext_* 数据库且翻译关闭；生产环境、0.0.0.0、普通数据库名、localhost 及启用翻译均拒绝。
- 安全链接离线验证：用途固定的确切合成主机通过；HTTP、凭据、查询、片段、伪造后缀主机、loopback URL、非默认端口拒绝。仅返回直链，没有发现服务器下载路径。
- 媒体失败请求 schema 拒绝 URL；reportMediaFailure 的替身调用只得到媒体 UUID 和 revision 两个参数，SQL 限当前 external_catalog、active 和版本，ON CONFLICT 去重。它只写刷新信号，不执行下载。
- 供应商标题中文伪装成英文、数字 R1 变 R2 的俄文候选均回退为明确 original。语言语义质量仍需实际样本核对，未把脚本/数字筛查等同人工审核。

## 第一轮权限与存储边界的代码核对（当时范围）

app.ts 在匹配后的 route 上做 feature gate 与 staff 会话校验，关闭时外部管理及媒体失败入口返回 404。管理员独占导入、创建干跑计划和 raw 原档；editor 可以读取候选/挂牌并维护覆盖和可见性。写请求沿用可信 Origin；新增导入、试译、公开失败报告各有独立限流桶。上述为静态代码核对，本次未向真实登录/写入端点发请求。

公开投影按白名单构造，不复制 raw、sellerPrice、source_hash、overrides 或内部审计；原档仅 raw 路由读取。外部事实、原档、人工覆盖和公开目录使用独立表，导入先检测既有员工 external 身份，没有改写旧 publication JSON。当前允许表仅 synthetic-feed 和两个合成平台，实际来源接入、刷新执行器、供应商调用都未作为已实现能力评审。

作者报告 contracts41/API96/隔离PG55 已通过；本次未重跑这三套全量检查、未连 PG，也未将作者结果记作审查方亲测。试译预算账本的完整并发/计费审查不在本报告主范围。

## 建议修复后的最小复查

1. 对 lowercase/mixed-case VIN 和常见国际电话，确认 description、detail.original、规格、检测和图片 alt 均不公开受限文本，正常车辆数字/型号不会被随意改写。
2. 对有争议但照片可用的记录，确认图片仍可显示，alt/display.mediaAlt 不再陈述争议；无争议状态维持原文及实际语言标识。
3. 重新运行作者契约/API 与对应隔离 PG 回归，并按最终源码指纹复核；上述两项现已按下节证据关闭；真实样本适配与链接白名单的后续增量须另外审查。

## 两项修复的定向复查

仅复查上述两项，未读取真实 ZIP、真实样本或环境，未访问实际 API、数据库、供应商和付费服务，未重建共享 dist。真实来源适配、确切主机与签名查询白名单的新变更不包含在本次结论中。

- isPublicText 现在先 NFKC 归一化，再检查大小写 VIN、常见国际电话分隔形式及已知联系标签。原小写 VIN 和英美电话三种输入，以及大写/混合大小写和全角 VIN 均被拒绝。对 title、description、图片 alt、规格、检测内容做合成投影验证，受限文字不再进入输出，原始候选保留。
- 图片 alt 现在在 source.disputes 非空时归为 null；争议事实保持 null/unknown，中性标题保留，图片本身仍可用，原始 alt 仍在候选中。无争议时正常 alt 保持不变。
- 直接用冻结的已有 dist 执行 **28 组定向断言，全部通过**；另独立执行源码 `src/external/normalize.test.ts`，**2/2 通过**。`pnpm hooks:check` 与两文件限定 diff check 通过。
- 正常车型/年款/金额/里程文本的代表用例仍通过。这些测试关闭已复现缺陷，不将文本正则描述为对任意混淆个人资料的完整脱敏保证。
- 作者另报告外部隔离 PG 8/8 通过；本次没有连接数据库复跑，不冒称审查方亲测。

本次修复复查指纹（SHA256）：

- apps/api/src/external/normalize.ts：`6ade52ec081bea43293bcfec5b14765531b1df37564efc14e8bf4de9a56e7f81`
- apps/api/src/external/normalize.test.ts：`795f89bccb2cb0680ff81b90b617a4f345a4f2f146aea6732b6f49b8c1faf37e`
- apps/api/dist/external/normalize.js：`092f0bba8c141f749d5788cb49b7673f403664ed0dcdce197bf300d1cfdc659a`

## 第一轮记录的受审源码 SHA256

- `packages/contracts/src/external-public.ts`：`78ed4f5f5df87fcb8eb6fcaee2dc28d49077f81c9c63400b02730af7e5a5813d`
- `packages/contracts/src/external-admin.ts`：`7900751f8b359af98ccf1cda23289e5e50acefb60a2d1b955280f0931c3ea826`
- `packages/contracts/src/external-fixtures.ts`：`7c5def112a8e622a57698cb4072faf62d471aa03261658f88201f6346a97fc3d`
- `packages/contracts/src/public.ts`：`c19a5a4b2783db117df9105b2393a8f6b27a891b20b1c70537c9a0512c770293`
- `packages/contracts/src/admin.ts`：`83c652e24060d8024758409219f5183ea30ba3fa03ff99a294b9d5aa4ae6286b`
- `packages/contracts/src/fixtures.ts`：`d1441c4fb729df716c3277ef0b91055cc7b0645641a150a86d65f6bcc8869464`
- `packages/contracts/src/localization.ts`：`672849de10db669f2e7d994891d8069ca67d7a10751e3f582a451bd644ce1dab`
- `packages/contracts/tests/external.test.mjs`：`8a15a40ba1d9bb94d8b83115d8c449dd039d18a83162a39a99ef8cb677c71da0`
- `apps/api/src/external/normalize.ts`：`6ade52ec081bea43293bcfec5b14765531b1df37564efc14e8bf4de9a56e7f81`
- `apps/api/src/external/catalog.ts`：`2d2831c7b8c4282b1530f2921f3c711a5aa8b1955b2973298d73ffba89cfa50c`
- `apps/api/src/external/routes.ts`：`9a25b8dfc95a7f14c563a7f3df3b2a8ddedb0af8137a8acf16aaf342f994d9c6`
- `apps/api/src/external/store.ts`：`486e1d9fb6748de9b003c9491b1e1ce10613976e1ceed800afb2771b476fc0a2`
- `apps/api/src/app.ts`：`6498250825b75cc5077ca17238e5d3e5d4b51a61deff650e7316cbed28d13f72`
- `apps/api/src/vehicles/service.ts`：`a0917be79ca3d5894897a3336c7845d2279abdb85125ea01c3a12ce929218109`
- `apps/api/src/config.ts`：`ae6955ae8bd974e989e7a2334c3998e1d307a1cea9702ea36b67b92b11628ff8`
- `apps/api/migrations/0004_external_catalog.sql`：`009ea705b1f14a72aabd004d7f795ea4fa37880b711f5eaac90e4527a2a5f906`
- `apps/api/test/external-catalog.test.ts`：`bcac8d02a19886df26e985e2d1d6f7a560810ce4b9c6d4605e83bac94909ce94`

本次无实现修改、无共享 dist 重建、无依赖安装、无真实环境/外部服务/付费调用。工作区后续变化须按变更范围复查，以上报告不能直接套用于其他提交或运行成品。


## 离线样本适配增量：最终独立复查

本次增量范围：`external/{profiles,china-car-sample,sample-cli,normalize,store}.ts`、`external-public/admin` 契约的 URL/日期变更，以及必要的 catalog 到期投影与新增合成测试。HEAD 仍为 `fd16e00e23db8b8956f0c398ab1c198e82a61bc2`，审查针对共享工作树中本节指纹对应的源码及现有 dist，不是对未提交文件宣称已有提交 SHA。

**结论：以下新增两项 P2 已关闭。本节范围未发现剩余确认阻塞。** 本人没有读取真实样本、真实配置或凭据，没有运行 `sample-cli`、连接 PostgreSQL、调用真实接口、下载图片、请求翻译或重建共享 dist。

### 新 P2-A：同时间戳但事实不同的语言捕获会被配对（已关闭）

原位置为 `china-car-sample.ts` 的 sameObservation。原签名仅检查身份、更新时间、年款、里程、CNY、model.id 与 trim.id；合成 base 为 Petrol，ru 捕获在相同时间和身份下把 fuel/specs.energyType 改为 Electric/Pure Electric，标题为 `Электрический S1 2024`。旧 dist 仍输出 ru supplier 标题，同时结构化动力为 petrol 且 disputes 为空。

当前签名覆盖状态、品牌/车型/配置官方 ID、CNY 和标准化结构事实、能源冲突标记。可翻译名称与城市文字不用于直接跨语言比较；明确的动力、注册/制造日期、里程、年款、驱动、变速、排量和车身差异不再被配对。与原文相同的合法捕获仍可使用；这不是对供应商翻译全部语义的人工认可，公开 reviewed 继续 false。

### 新 P2-B：过期封面挡住同资产的新签名链接（已关闭）

原 photos 按 CDN 资产路径生成稳定 ID 后采用首个链接。合成 row.image 的 x-expires=1000000000，而 photos 中同资产 x-expires=2000000000；旧 dist 只保留 2001 年已过期链接，公开过滤后无图。

当前 Map 维持资产 ID 与首次顺序，在相同资产下选择较晚已知到期链接；已允许的无到期链接按无已知到期处理。达到 30 张上限后仍可刷新已有资产的链接，不引入新资产超过上限。已到期图在 catalog 读取时仍隐藏；它没有通过服务器请求 URL 判断可用性。

### 审查方实际执行

- `pnpm hooks:check` 通过；限定 external 源码与两个 contracts 文件的 `git diff --check` 通过。
- 独立运行 Node 24.19.0 的 `--import tsx --test src/external/china-car-sample.test.ts`：**2/2 通过**，包含作者新增的两项原触发回归；所有输入均为合成。
- 对源码和现有 dist 分别进行差异事实配对、合法配对、同资产新旧链接的顺序、稳定 ID 和 30 张上限后刷新检查：**45 条断言通过**；同输入的 source/dist 候选结果深度相等。
- 对现有 dist 进行 **37 条合成断言**：允许的确切 CDN/报告主机与参数通过；HTTP、凭据、后缀伪装主机、非默认端口、片段、未知参数、重复参数及编码重复参数、错误过期格式被拒；报告限定路径/参数值；时间允许年 0001 至 9999 的整毫秒边界、拒绝年 0000/不可能日期/亚毫秒；私有 seller/VIN/联系文本不进入候选白名单或公开投影。用内存替身调用 getExternalPublic，在已知过期点前 1ms、恰好到期及后 1ms，图片数分别为 1、0、0；没有真实数据库连接。
- 源码静态确认：URL schema 只负责 HTTPS/凭据/端口/片段等传输语法；具体主机、用途和签名参数仍由服务拥有的 profile 限制。媒体失败请求依旧只带 ID/revision，不携带下载 URL，未增加服务器下载路径。
- 源码静态确认：真实样本 profile 只由离线 CLI 显式注入；HTTP 导入仍固定 synthetic profile，用户不能通过 provider 字符串启用真实来源。CLI 只读本地已解包文件，校验文件范围、大小、摘要、固定身份列表、捕获身份/请求语言与版本；随机创建并清理 127.0.0.1 的隔离数据库，翻译禁用且试译仅干跑。配置错误进入统一脱敏错误输出。以上是代码检查，不是运行真实 CLI 的证明。
- PII 边界仍是原档保留、候选字段白名单与公开文本过滤；不把有限正则描述为对任意混淆个人信息的完整保证。供应商 actual language 标签、数字检查和同版本事实校验也不冒充人工翻译验收。

作者报告 contracts41/API100/隔离PG55、真实 200 条离线导入和固定 100 条干跑/三语投影通过；这些不是本审查方亲测。本轮修复后的作者重测由主 Agent 单独登记，本报告不以未拿到的最终计数代替证据。不包含生产部署、外部采集、付费翻译或真实数据内容质量验收。

### 最终受审指纹

以下每项为 SHA256；集合指纹按排序后的 `path + NUL + sha256 + LF` 拼接再做 SHA256：`81c87419e6f282cd9aebb331a07e43ef95c575d1462d0811552f563e3946b822`。

- `apps/api/dist/external/catalog.js`：`e3d91935e435bd19804c82cce4dd91ab965740ce31963a9970888646cb6fa333`
- `apps/api/dist/external/china-car-sample.js`：`2cc67fb3e99036b909dec86d3ba10d8599a76253628dcb0a0c5036036fe99eb0`
- `apps/api/dist/external/normalize.js`：`a2d37ead231b025625954413beb70127a238ab8648bfa32e045ad495db5b5b24`
- `apps/api/dist/external/profiles.js`：`716e856e5f5766b4362a340b149396ca5a7e539b4f27c09105b0717fb6a9c95e`
- `apps/api/dist/external/sample-cli.js`：`95f1c471e0e0156c248d7a88c8c02dba7e224475ce492649c2789da8ff51b478`
- `apps/api/dist/external/store.js`：`44c46dd5b3d369c7904d962211e5c5515c2d89a09ad7cbb035a00eea426fdc8e`
- `apps/api/src/external/catalog.ts`：`2d2831c7b8c4282b1530f2921f3c711a5aa8b1955b2973298d73ffba89cfa50c`
- `apps/api/src/external/china-car-sample.test.ts`：`c55beea7a6f24d060ca0717c3389dca7a851fec658876941299fa4650dd4c824`
- `apps/api/src/external/china-car-sample.ts`：`a234c76f7ee2eaf37c6a9c39f4d9dfa6a85200c96a01ca8b75d6228389c0bfe1`
- `apps/api/src/external/normalize.ts`：`c4d1a6ae088bc172139a5b2b0d969bed5e6a4efa1f1aab8caebf504debc504e0`
- `apps/api/src/external/profiles.ts`：`64880a4899019abcd02e56d132aa627152d8690320865bf49da6d6ae70dcea00`
- `apps/api/src/external/sample-cli.ts`：`3de04121482be5d0c7524441cf82f89291cc881d7895d4415cf0268acdf9d805`
- `apps/api/src/external/store.ts`：`f51e1edc1e3eeda71c28a263c13215c0b49f8ddd57baf57c7499dcc0955b3486`
- `packages/contracts/dist/external-admin.d.ts`：`a3beb5bf9d5d3ec3bd253a5988ed51e00720e79a9eb8aa01fc302a56a4e81be2`
- `packages/contracts/dist/external-admin.js`：`7f12d0331ee691cce49f618c67f5ba22bb545b551d35980f3864b94883fc51c0`
- `packages/contracts/dist/external-public.d.ts`：`bb7d7850cf24a2758088503d0850b66f04404c9751bd3b7f672d3e40f91ad126`
- `packages/contracts/dist/external-public.js`：`91ed5ecdae7e8b17de64af584cc683c4c37c51225e8aec096c880f48f752027a`
- `packages/contracts/src/external-admin.ts`：`4d9765c0f85f75bcfb6dc4e18bda783aab1d747c1f7c5c8994561ac06a786497`
- `packages/contracts/src/external-public.ts`：`7ce1e5a9946f3a4f2391f54af252bb88648dbfa92bcd19169bce6fde189a60f7`

仅更新本临时报告，无实现/共享产物/依赖/真实环境修改。若上述文件继续变化，应按实际变更复查，不能直接复用本节作为其他版本的通过证明。
