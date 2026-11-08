# 独立审查 / FE-UX-02 / 正式文案、导航测试与 SSR 限流入口

日期：2026-11-08（Asia/Shanghai）

Reviewer：`/root/fe_ux02_reference_audit`

最新状态：首轮2项P2已由原作者修复，独立源码复查通过；冷却期间关键词/facets补充也已复查。限定范围无未处置P0/P1/P2。最新用户纠偏版本的浏览器与SSR运行验收仍待执行，不能沿用纠偏前183项结果。

## 授权范围与验证边界

- 审查七个测试/测试辅助文件：`public-freshness.spec.ts`、`public-rate-limit.spec.ts`、`public-polish.spec.ts`、`home-vehicles.spec.ts`、`public-catalog.spec.ts`、`vehicle-contacts.spec.ts`、`helpers/public-fixture.ts`。
- 审查三类App SSR入口与 `PublicDetailResource`、`PublicHome` 的 `initialRetryAfter` 装配；补读资源hook、导航事件、状态组件、列表和HTTP适配器以核对行为。
- Reviewer是本轮首页四文件内容/问答/表单切片作者，**不把本报告当作这些自有实现的独立审查**；该切片由其他Reviewer审查。本报告对其测试只检查拦截边界和断言覆盖，首页普通重试入口由root实现，不属于Reviewer的四文件。
- 共同基线仍为 `61dc7414b20a395d1d09e906a49d974763b3cce7`，共享工作树未提交；下表绑定读取快照，不能把共同HEAD当作包含这些实现的提交。
- 新用户指令优先：公开页面与联系草稿采用正式措辞；取消focus/visibility/pageshow触发的数据请求，保留明确筛选、重试、Back/Forward更新。内部DTO的source、报价kind、unknown、核验时间、真实参数与金额不能因措辞变化改为伪事实。
- 本轮 `pnpm hooks:check`、`tsc --noEmit --incremental false` 实际通过；Reviewer运行了全程fetch stub的 `src/modules/vehicles/infrastructure/public-api.test.ts`，**8/8通过**。这些单元不访问HTTP。
- 未访问3317/3320或其他HTTP服务；实际API正在备份，Reviewer没有读写该服务、启动/重启、构建或生成Next类型，也未运行浏览器测试。只写本报告，不改待审实现或测试。

## 首轮发现

### P2 / SSR-RL-01：首页普通重试链接可绕过初始 SSR 429 冷却

- 首轮定位：`PublicHome`向资源hook/status传入初始Retry-After，但 `home-page.tsx` 的 `home-catalog-error` 内仍有直接指向 `/${locale}/` 的普通“重试”链接，未接收冷却状态。
- 条件：首页SSR获取车辆数据时收到429，浮动状态中的重试按钮被禁用；访客点击内容错误区的普通重试链接。
- 影响：即使有JavaScript，也能立即整页重载并再次发送SSR请求；无JS同样存在可点击入口。仅禁用status按钮不能保证页面所有重试入口遵守Retry-After。
- 修复方向：传递冷却状态/重试语义到首页错误区，等待期间不保留有效retry href，或统一使用受冷却保护的入口。到期只能恢复手动重试，不自动请求；保留正文和“—”统计，不能把限流显示为0库存。
- 覆盖要求：初始SSR429三页测试核对全部重试入口，首页统计“—”、目录不是empty、详情不是missing；冷却后显式操作只产生预期请求。
- 已交root；读取期间看到其开始修改，最终结论须以下方修复复查为准。

### P2 / TEST-COPY-02：俄文无 JS 详情测试仍要求旧演示提示

- 定位：首轮 `public-catalog.spec.ts:409`，`320px Russian source demo remains readable...` 仍使用 `toContainText(labels.ru.demo)`。
- 影响：与同文件前面的 `not.toContainText(labels[locale].demo)` 及新正式UI口径相反，产生必然不一致；不能为让它通过重新放回已取消的公开演示提示。
- 修复方向：迁移为不含该提示，同时保留真实标题、待询价、无虚构0里程/0价格、联系标识、键盘和窄屏断言；不要删除整个无JS场景或真实业务校验。
- 已交root/测试作者，待回交复查。

## 已核对的装配与测试语义

| 范围 | 源码核对结果 / 证据边界 |
| --- | --- |
| 首页SSR429 | `app/[locale]/page.tsx`把home查询的429解析为初始Retry-After，`PublicHome`交给 `usePublicResource` 和状态组件；HTTP适配器先规范化header，避免将任意上游文本直接传入UI。缺数据时首页统计为“—”，没有声称0库存。普通retry漏洞见SSR-RL-01。 |
| 目录SSR429 | cars/page传初始Retry-After；列表hook保留错误与empty区分，状态/重试受冷却限制。过滤字典是独立资源；fixture明确让facets/media继续可读，本报告不把不同端点可正常读取误判为全站冷却漏洞。 |
| 详情SSR429 | load区分404与暂时故障，429传retryAfter；resource/status首屏显示等待而非缺失车辆，临时故障metadata noindex。未知/下架仍走真正404，不用第一辆记录填充。 |
| 资源冷却 | hook保留retryAt，重复显式操作在剩余秒数内只更新错误状态；间隔定时器只更新倒计时，到期没有自动fetch。429保留已读资料、不当空数据成功；成功后清除冷却。 |
| 无被动数据刷新 | `PublicNavigationFreshness`只监听popstate，取消focus/visibility/pageshow数据监听。Canvas可见性/倾斜复位监听是动效生命周期，不等于数据请求。新测试在三语首页/目录/详情发送受控激活事件，断言无JSON/RSC/document、滚动/输入/壳层保留，注释没有冒称真实OS切换。 |
| Back/Forward | 测试使用page.goBack/goForward，隔离fixture修改sold/归档，再核对单个当前JSON、已售/类似车草稿、删除本地不可用与直接404，不能仅以URL恢复代替数据刷新。 |
| NAV-01 同URL新历史 | hook按URL+导航版本识别当前inflight，较新版本会取消旧请求；测试连续创建/返回同页历史，拦住首个请求，改变fixture状态，要求第二个请求和sold结果。它可以发现只按URL错误去重，不把合成历史操作称为OS事件。 |
| 正式UI与真实事实 | source/demo外观断言改为不含治理说明；API层仍断言external身份、平台/原始URL、reference价、unknown、null核验时间、未人审。联系测试仍保留stockCode/id/title/详情路径、三语平台账号、同草稿、非0金额/里程、真实23500 USD及2024参数，不因去文案而抹去事实校验。 |
| WhatsApp测试 | context级route拦截 `https://wa.me/**`，包含popup首导航并fulfill为本地测试HTML，不接触真实聊天服务；只在明确提交后允许一次外跳，检查正确账号、仅text参数、JS有电话/无JS基础草稿、无本站POST/号码泄漏和无假成功状态。没有测试真实送达或自动发送消息。 |
| hover测试 | 用真实pointer hover及elementFromPoint检查卡片顶部是否命中，验证横轨为抬升保留空间；不通过取消hover来让断言通过。像素还原/真机触摸不在此源码审查结论中。 |
| 业务覆盖迁移 | 金额/公式/税费等旧计算器用例未在本次测试迁移中删除；目录仍保留分页/URL、空与故障、公开DTO、动态发布/已售/归档、代理凭据/私有响应头隔离等场景。 |

## 隔离与操作保护

- helper、public-freshness、public-catalog保留HTTP loopback白名单、拒绝3320、拒绝凭据/额外path/query/hash；每次控制操作前核对精确health suite，未使用网站或真实API作为回退控制目标。
- 新rate suite更严格限制fixture3327、网站3100；fixture本身只监听127.0.0.1，并在函数及CLI拒绝3320，状态仅在内存。
- public-polish的SSR429/历史状态变更通过同一helper，未跳过suite确认。全部状态变化只发给隔离fixture，不向实际车辆API发布/售出/归档记录。
- 受控focus事件、DOM click与CDP触摸都只证明浏览器对应路径；不能写为真实OS切tab、真机、消息送达或生产环境验收。

## 首轮读取快照 SHA-256

此读取后作者仍会修复发现；新快照需另补，不能将本表直接登记为最终提交pass。

| 文件（相对apps/web） | SHA-256 |
| --- | --- |
| `tests/public-freshness.spec.ts` | `809b59b6795b12620afcec0de5d3075caa403d04e5c1dfd1dd5b656aa7762422` |
| `tests/public-rate-limit.spec.ts` | `d7f9f78d1bf234fed318e566a7dc725d63a0124ed354697438e4b24503e35844` |
| `tests/public-polish.spec.ts` | `72c9e84789f563ff9ded57d90407031afabbca2db961c806036ed852d19ad356` |
| `tests/home-vehicles.spec.ts` | `9d471374b20e2597b1f041fd4c431843e23275cc4f523c4b2ed6591a3929ec7c` |
| `tests/public-catalog.spec.ts` | `4981f0b7c92ae91d70f7076e019f19a23637f875b22074369893107c50fe8ccc` |
| `tests/vehicle-contacts.spec.ts` | `c3140378f2f4fef55f3b6e443ac55cfe95d8916640c913c7fc14208655066197` |
| `tests/helpers/public-fixture.ts` | `4db37846686fdff3c602c95ad4bf9001b9749f8d5150ad29b2020edf9f8298b4` |
| `src/app/[locale]/page.tsx` | `3d5412071bb9bb5a286867cc3857be65a889b34831c29f3e0e4ba41bcf4320ea` |
| `src/app/[locale]/cars/page.tsx` | `052ebe9874020aac4903d291e30b6545aad8dbec61cefd7ab87f6b3199ed0b57` |
| `src/app/[locale]/cars/[slug]/page.tsx` | `01c27c4f66958fc9fbc8d99a9d00a045cba5b9153369aa656ad5a788a65ca6a5` |
| `src/modules/vehicles/ui/public-detail-resource.tsx` | `37380ae26ed39f3534d29a2a88769fdc712878bbe45305d15a9c8cab156c83dd` |
| `src/modules/home/ui/public-home.tsx` | `1648563525f6dc2751c33fd4db0695e27ef66034f7f8bc5c146ce3fa911a8b93` |
| `src/modules/vehicles/application/use-public-resource.tsx` | `eb6909dcdb41f03cb1733bd31ec1eda14b8b5eb3b525dbbc773f9b3967099165` |
| `src/shared/lib/public-navigation-events.ts` | `9a7835421cf2c9592e4df4180a3e98096b19e233379706d319ede97c9894870e` |
| `src/shared/ui/public-navigation-freshness.tsx` | `fbd8c0975a329d49d6ce7489edaf189b215a587afa3a77af47329b567be82c8f` |

## 交接

root/测试作者修复两处已确认P2后回交新文件hash，Reviewer只读复查。最终浏览器、SSR429实际等待和真实Back/Forward网络行为须在备份/环境协调结束后由实现者或QA验证，不能把本报告8个stub单元和纯TS检查当作运行验收。提交/推送/生产操作未发生。

## 修复与集成增量复查

Reviewer重新读取了root与测试作者的实际修复，没有修改其代码。下述结论只针对源码与测试设计，不代签未执行的浏览器结果。

### 已确认问题闭环

- **SSR-RL-01已修复**：PublicHome将 `resource.retryAfter`、`resource.reload` 传给HomePage错误区。HomePage等待期间不输出有效href、设置aria-disabled，并在点击处理中阻止导航；倒计时结束后显式点击走受hook保护的局部reload。主页其他内容不被隐藏，统计保持“—”。
- **对应测试已补**：三页初始SSR429用例在goto前收集浏览器业务请求，确认status按钮禁用，并核对页面aria-disabled链接没有href、受控点击不触发读取。首页统计“—”、目录无empty、详情无missing均有断言；冷却后显式重试要求一次JSON并恢复fresh。它验证的是JS增强路径，不能写为无JS倒计时会自行更新。
- **TEST-COPY-02已修复**：俄文320px无JS场景改为不含旧演示提示；原标题、两平台相同草稿/稳定id、键盘Tab和无横向溢出检查保留。旧数据source.kind未被删除或假改成manual。故障恢复的原生链接测试改为精确定位“Reload”，避免与返回目录链接混淆。

### 关键词与字典冷却补充

原字典端点是独立可读资源，fixture继续让facets/media在主车辆端点限流时返回正常数据；这一点本身不是缺陷。root进一步统一了用户已进入主查询冷却时的交互：

1. `usePublicResource`改为options对象，三个SSR消费者仍正确传 `initialRetryAfter`，导航资源仍有明确path。
2. 目录给facets传 `externalRetryAfter: resource.retryAfter`。等待期间若关键词使facets URL变化，guard把该URL登记为error而不发请求，避免计时到0时因为旧URL未同步而隐性发起查询。
3. `reloadCatalog`只在访客明确重试且冷却已结束时重试主结果和错误facets；过滤字典故障的链接也在等待期间去掉href。到期只改变可操作状态，不自动补网络请求。
4. 新 `public-polish`关键词场景核对：初始明确查询产生结果+字典2请求；冷却内再次提交新q不增加请求，字典重试无href；到期仍为2；明确重试后为4，结果/字典各2。这覆盖了仅改powertrain无法触发facets URL变化的缺口。

NAV-01仍按导航版本区分同URL请求；较新的history版本会替换旧inflight，而不是因为URL相同就吞掉核对。focus/visibility/pageshow数据请求取消未被上述补充重新引入。

### 修复读取快照

以下覆盖首轮表中变化项，并补充实际修复触及的首页/字典组件；首轮表其他已列文件hash实读保持不变。它们仍是工作树快照，不是待推送提交SHA。

| 文件（相对apps/web） | 当前 SHA-256 |
| --- | --- |
| `tests/public-polish.spec.ts` | `2446a6f9edc412be5c314b91e611ad3301a0200b9667b1a7dad727b65a479513` |
| `tests/public-catalog.spec.ts` | `35e61ae385b0143203590e7fa0e9f96e84f2c0f5611f8f478ed72aa3af00b88a` |
| `src/modules/vehicles/application/use-public-resource.tsx` | `2c1cdad941e637a1ba90293159b811508baf644c9d2ca12f9eecdbd168965b2a` |
| `src/modules/vehicles/ui/public-vehicle-list.tsx` | `cf403d029361945794259a04c16e5586356f3699fd14e978bf774e5b8b50130a` |
| `src/modules/home/ui/home-page.tsx` | `23ecb950e2a651ee887d2c2574f206834d69fd8b1046d5c33ef15a6c54599aab` |
| `src/modules/vehicles/ui/public-vehicle-filters.tsx` | `b728b7d689a8724bc390d74f6c1ffe7481f1d0a068b4ff79984f58fdda430fb3` |

修复后Reviewer再次执行纯 `tsc --noEmit --incremental false`，通过；相关实现/测试 `git diff --check`通过。8个stub单元属于本轮先前已执行的独立检查，不因本节源码复查改写为新浏览器通过。

当前限定审查没有未处置P0/P1/P2。由root后续核对新构建、完整浏览器、隔离SSR429和实际导航运行结果，再交PM与用户验收；此前183项/Node24关键17项属于旧纠偏前版本，不自动适用于本节新hash。Reviewer未访问备份中的API、未启动服务、未提交或推送。

## 字典单独限流切片独立补审

本节补审 perf 作者新增 `tests/public-facet-rate-limit.spec.ts`、fixture的 `filtersRateLimited` 分支，以及root的共享冷却、Status无JS入口和Home恢复装配。它们不是Reviewer首页四文件实现，属于独立只读审查。

### 检查结论

- 新测试只接受fixture3327、网站3100的HTTP loopback，拒绝真实3317/3320；状态控制仍经helper逐次health suite校验。fixture增加独立boolean开关/默认false，仅使合法filters GET返回429、Retry-After=2；未更改服务绑定、3320拒绝、真实数据库或凭据边界。
- Home/Catalog SSR并行读取通过 `publicRetryAfter(main, filters)` 取最大429等待，不因主结果200而漏掉filters429。新测试保留home3条/catalog2条实际车辆、非空/非故障页面、真实首页数量3，没有把字典限流当成0库存或删除。
- Catalog两资源共享stable deadline ref；429采用max延长，成功响应在共享模式不清deadline。因此先发主请求晚到200不能抹去较新的facets429。测试实际拦住主请求、先等字典429，再释放主200，要求状态仍限流/按钮禁用。
- 冷却中换q、Warning及status受控click不发请求；到期仅启用交互，不自动fetch。显式Warning通过 `onRetry=reloadCatalog` 同源局部重取最新q的结果和字典，测试要求总请求2→4、每端点2及beta选项/新结果恢复，避免单靠URL或错误提示消失声称成功。
- Status统一 `fallbackHref` 的noscript入口，无JS可原生重载同源当前页面、保留目录pageSize并恢复车辆与字典。这里是由服务器重判限流的原生恢复方式，不承诺无JS会动态更新倒计时；JS重试仍遵守冷却。新无JS测试没有用脚本代替页面功能，也没有操作真实服务。

### P2 / FACET-HOME-03：Home字典限流到期后丢失恢复入口（已修复）

补审曾确认：旧PublicHome只消费固定SSR filters prop，filters-only429时main状态原本fresh，倒计时结束后status隐藏；未取回字典，品牌/车型区持续缺失，也没有可见的JS重试入口。首版新增Home场景只检查安静到期和原车辆保留，未覆盖这一恢复步骤。Reviewer已先交root与测试作者，未代修。

root现已添加Home客户端facets资源，与车辆资源共用stable cooldown；HomePage消费facets.data而非冻结SSR props；联合checking/error状态确保字典仍失败时保留可见Retry。明确重试会取回home及失败facets，且没有增加focus/visibility数据监听。

测试作者随后在Home分支补充：到期后status仍可见、Retry已启用、车型区尚不存在；点击后仅home JSON和facets JSON各一次，两个车型卡恢复、status隐藏、原三条车辆保留。Reviewer实读此增量及产品装配，FACET-HOME-03源码与测试设计复查闭合；实际四个浏览器场景尚未由Reviewer执行。

### 本切片版本与实际检查

| 文件（相对apps/web） | SHA-256 |
| --- | --- |
| `tests/public-facet-rate-limit.spec.ts` | `e0760dc9e348af987e553652d82f3b1856ed002007e4c4bf99173d91f15784c0` |
| `tests/fixtures/public-api.mjs` | `47be3f831667609da18bb944a4d564866c27ea7d9db64382f409cae70ba5a3b0` |
| `src/modules/home/ui/public-home.tsx` | `2c9d689946dfb9726ab132468a1db0e0a32c57d38eb65c00e2c76239a8af8659` |
| `src/modules/vehicles/application/use-public-resource.tsx` | `21cc6ccec70cb98468d9c348513e1a900a23692e571ae18b8df9f29c8d9d0ba5` |
| `src/modules/vehicles/ui/public-resource-status.tsx` | `7adfdae1bae87a75c578c983699c5b6281d4bef1b1f60dc74f06bc1b8147d102` |
| `src/modules/vehicles/ui/public-vehicle-filters.tsx` | `2c30d01fae335f84b1556a3258c9b17f8279e23631cfef9f809890778200fbd0` |
| `src/modules/vehicles/ui/public-vehicle-list.tsx` | `df1b42ec56c1fabb74cc4ac3425f8e48d7821f5e3deff5b80f215ec427801533` |
| `src/app/[locale]/page.tsx` | `389b7f9a34f00863ea2b1849251e443bec211b370c2b947817c8243f5820e6c7` |
| `src/app/[locale]/cars/page.tsx` | `96bd500ec5d6cc165b75093aed58584aefaca5c9408dc4ec537885942995659e` |
| `src/modules/vehicles/infrastructure/public-api.ts` | `e2564e5a1c1ce8dd53f4416e7b9e136ced9d348cb6b55945b6143767c73c5104` |
| `src/modules/vehicles/infrastructure/public-request-context.test.ts` | `ff97e03a39ec07722767205f1e63ab0365bb9e324ab19f394f7a6481b16ffb6d` |

Reviewer实际执行：开工hooks检查通过；新facet测试语法解析与fixture的 `node --check` 通过；`public-request-context.test.ts` 全部mock请求的11/11单元通过（含并行仅facets429、最大Retry-After、受限响应无data）；Home补修后再次纯 `tsc --noEmit --incremental false` 通过；相关实现的diff空白检查通过。没有HTTP、Next build/typegen或服务操作。

本切片独立源码审查无未处置P0/P1/P2；不把test list/语法检查或11个stub单元当作4项浏览器实际执行。新构建、运行与最终提交对应仍由root及PM核对。

## PM末轮纯文档增量复核

本轮只读核对README补充、首页/路由当前维护说明及对应源码片段，没有重跑应用类型/单元/浏览器/构建检查，没有HTTP或服务操作。开工仅核对仓库hooks配置；唯一写入是本独立报告。

- README“首页/目录主结果与字典共享同页等待截止时间、晚到成功不能清掉新等待”与stable cooldown ref、429取max、共享模式成功不清deadline相符。
- 首页字典显式恢复与PublicHome双资源/联合状态、重取失败facets相符；同URL成功筛选选项的保留与列表使用 `facets.dataCurrent`、hook按内部成功状态及URL判断相符，未把由其他请求限流产生的外部error当成已成功字典失效。
- 首页与路由的最新节明确覆盖旧激活方案：focus/visibility/普通pageshow静默，Back/Forward/URL/明确重试取数；倒计时到期不自动请求。历史阶段内容已标历史或由后续最新节覆盖，不将其当作当前验收口径。
- 本次文档复核指出的旧首页说明已由root修正并实读确认：第16行改为未知“—”/省略、不展示库存核验提示；第17行删除已不存在的vehicle-display引用和非库存声明输出描述，改为复用联系builder、稳定标识、已知参数与真实已售语义。与公开呈现/草稿源码一致，没有修改产品或业务事实。
- 三份文档的 `git diff --check` 实际无诊断。限定文档增量现无未处置不一致或P0/P1/P2；应用运行结论仍以冻结成品的独立运行证据为准，本次未重测。

| 文档 | 本次最终 SHA-256 |
| --- | --- |
| `apps/web/README.md` | `a728b0944f24c3b31c3c04f538166c5d89adb2b69b174eec43ed2b70caaca43a` |
| `docs/开发/模块/首页与车源.md` | `8607380b7c078bc03c8be15e1b1f18722f56b2ac93d37b421a07a6c997923c52` |
| `docs/开发/模块/路由与动效.md` | `5a638a5ce8651c4fc99dc274073bcb7a0d9b22038eac6c4ff8198f7d2d2308fd` |

只读清单定位也已复核：App-only217清单 `/private/tmp/hd-fe-ux02-final-approved-app-freeze.json` SHA-256为 `14326d0362bc7bf1f17e74931d79b700a6d73671e75ca67aa257d996d65296a0`；完整240清单 `/private/tmp/hd-fe-ux02-final-approved-full-scope.json` 为 `8fb0090b8cf945b0403db1f2bd62d07ff97c9082727e811f663315c38b93b4c1`，其README条目与上表一致。两份清单BUILD_ID均为 `GwJa_YJF3-vbeEijFlsM-`。这是清单/文档标识复核，不声称本次重新测试或重新审查全部217/240文件；文档修订未改变这两份已读清单指纹。
