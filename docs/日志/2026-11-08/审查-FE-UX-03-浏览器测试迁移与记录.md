# FE-UX-03：浏览器测试迁移与记录独立复查

日期：2026-11-08（Asia/Shanghai）

审查者：`/root/fe_ux02_reference_audit`。本报告仅审查另一作者的测试与记录；不将本作者的HeroStats/内联预算产品实现作为独立审查对象。只读源码、Git diff和既有运行日志，没有启动应用、HTTP、构建、浏览器或重跑测试。

## 结论

本次四文件旧断言迁移与新业务口径一致，未发现P0/P1/P2测试放宽问题。新home-stats/vehicle-estimate/favorite-drawer用例的基本断言合理；下列P3属于覆盖或记录的边界，不表示对应产品已证实有缺陷。当前不能据本报告声称新全套已通过。

### 已核对的迁移

| 文件 | 只读证据与判断 |
| --- | --- |
| calculator.spec.ts、runtime-pages.spec.ts | FX正则只从“默认演示汇率”改为“默认参考汇率”，仍接受明确构建快照，保留日期及手动修改/刷新，未改金额、输入、设置展开/收起断言。原失败日志两处实际返回“默认参考汇率 · 资料日期2026-10-22”，属于标签迁移。 |
| public-polish.spec.ts | 首页主结果429但filters200时，统计改为成功全目录26；fixture的publicRateLimited只拦home/vehicles与vehicles，不拦facets，初始一展示/24普通/一reserved总26。仍核禁用重试、无空目录/缺失车辆、冷却前0业务读取、到期显式retry仅1读取及fresh。另扩parts目录/详情正式文案范围，没有缩减原页面。 |
| public-facet-rate-limit.spec.ts | expectExistingCars显式区分catalogTotalKnown：字典429未知，恢复26；首页3张/目录2张卡片仍独立核对，不拿首页子集充全目录。保留SSR429响应/Retry-After=2、hydration开始收集请求、到期不自动拉取、显式重试home+facets各1、品牌/车型恢复、晚到main不能清等待、q的最终查询、NoJS同源document重载。 |

### 新用例的真实覆盖

- home-stats：三语将统计与独立目录API meta.total比对，并明确大于首页卡片数；核660+、3及中文标签；客户端MutationObserver观测客户数实际中间值且刷新重播；三语×1440/390/320长标题检验详情按钮几何/卡片内边界/页面不横溢出，不用DOM改值替产品排版。
- vehicle-estimate：三语核制造月份缺失不补01、排量/功率已有事实、缺失时无结果；七国逐一填写后将inline本币/USD金额、清关日期与完整工具点击及刷新结果相比较；核空动力/GE方向盘与缺失月份通过seed/session/reload仍为空、不显示金额；RU320宽度、手动FX标签及91.1234传递均保留。测试中的1998/150/2021-01是显式填写的测试场景，不是产品自动补事实。金额一致性测试不证明官方税额正确，既有计算回归仍须保留并实际执行。
- favorite-drawer：三语核localStorage只保存version/id，首页→详情→刷新共享pressed状态；实际打开抽屉、去收藏、Escape关闭/焦点返回、非锁body；缺失ID不复活旧标题/价格，429禁止队列继续读取及显式重试；五宽俄文header/parts真导航；reference价与reserved状态未改成asking/available。
- 新测试均消费真实产品UI，fixture仅隔离替代后端数据/429，不在测试代码实现产品计算/排版或真实消息发送。此次新文件无聊天跳转；既有WhatsApp表单回归仍通过context.route拦截wa.me并本地fulfill，没有实发消息。

## P3与限制

1. `home-stats.spec.ts:47`–`86`的动画用例只收集clients数。用例名说前两个计数，但未观测catalog中间值；reduce分支只等最终660，无法单凭该断言证明没有先动画再到660。可追加两个指标的采样与reduce最初帧/无中间值、focus后不重播断言；当前报告只认可客户数进场与最终值，不代签两个指标的完整减弱动效行为。
2. `favorite-drawer.spec.ts:107`–`110`在429显式重试后只核首车恢复链接与2次调用，未断言第二个ID重新读取并出现；不能由此声称完整队列恢复已被该用例覆盖。可增加第二车请求及链接可见断言。
3. 共享主日志`前端-FE-UX-03-首页统计收藏与配件.md:17`仍写本轮检查/构建/浏览器/独立审查“尚未执行”，滞后现状。root已在进行新成品复跑，最终交接前应如实登记首轮233/7、已修项及新build/完整结果；本审查者不改共享主日志。

上述P3已告知root；不因测试建议修改产品或代签root正在执行的浏览器结果。PART-01产品修复及车辆作者cardtestsetup另由其他reviewer复查，不包含本轮独立批准。

## 运行证据与隔离

- 只读原始`/private/tmp/hd-fe-ux03-browser.log`：240项、233 passed、7 failed、5.6m。五处旧断言分别实际收到新FX标签（两处）、facets429的“—”（两处）、主429/字典200的26（一处）；另有PART-01预期44实1及作者长标题fixture未生效。日志SHA-256：`ed2d937b02e0ca3d1b57fe078e2c7bdaa093070a6d82812c19069dc54f34c395`。这是root执行的首轮，不是本审查者执行，且不代表下表最新测试已通过。
- helpers/public-fixture仍要求loopback、无凭据/路径/query/hash、拒绝3320，控制接口先GET健康suite并校验`hd-web-public-catalog-v1`再PUT/POST。facet专门测试仍严格3327和官网3100。
- Playwright配置仍单worker、不复用现成服务，默认测试API3327/官网3100；外部baseURL不自行启动fixture。审查未削弱或执行任何控制接口。

## 审查快照SHA-256

路径相对`apps/web/`：

| 文件 | SHA-256 |
| --- | --- |
| tests/calculator.spec.ts | efaf39f200279e798ced78a02261bf793cd99e06ad8bb9b554bf87ba161eb3d4 |
| tests/runtime-pages.spec.ts | 8bc01127d9bc69f75204b5c0797a94d696f874abebdb50095d592174c6a697b3 |
| tests/public-polish.spec.ts | 3d087a69f3efd31b5ba0afe563eaa8cc38692fa180be03b4a03a1ce8f5e1862f |
| tests/public-facet-rate-limit.spec.ts | ac100574ebc7321ab0299621f5f7dd8020ddfab519652a257c0603c5c5695d02 |
| tests/home-stats.spec.ts | ce094deab9f486b9b8802252d88e9fe6a4bc31f9bdcaa477c82184bf631aded0 |
| tests/vehicle-estimate.spec.ts | b2613a09f42d7ef6793a0b8d7052d4c687e18c8b3493c0948217ebf232921e73 |
| tests/favorite-drawer.spec.ts | 74f61e9c28590d6512ed83f89b35451fbc15a7ad66a432722342a53c75aab9ed |
| tests/helpers/public-fixture.ts | 4db37846686fdff3c602c95ad4bf9001b9749f8d5150ad29b2020edf9f8298b4 |
| tests/fixtures/public-api.mjs | 3bbd7ef5098e64ff60fd9f42fe5c41060b7960a2285eb92ff9109ae713840914 |
| playwright.config.ts | 52721b109b42f4eaa68e19e6f510ee462397ed31aa25bcd2e64eb1ac53d845b6 |

主日志审查时SHA：`b6fc18a13128402c9cd4afefa5ac3b03d7ebea0e843089c9f831ee338178af21`。后续测试或记录修改应另行复查/追加指纹，不能把本快照挪用为最终同版通过证据。

## 第二次只读增量复查

root按前述P3补强测试后，审查者只读再次核对，没有执行浏览器/应用/HTTP：

- home-stats新增独立catalog MutationObserver数组，首次进入及刷新均要求存在`0 < value < catalogTarget`的实际中间值；原“只观察clients”覆盖缺口已补。reduce分支在重新加载后检查clients全部观察值均660，强化了原先仅等待最终值的断言；此分支未另断言catalog的reduce序列，不把clients观察扩大成两者均独立验证。
- favorite-drawer在首ID重试2次后，继续等第二ID出现2个真实链接，并明确对应读取恰好1次；原“仅验证首ID、不知队列是否恢复”缺口已补。限流前/到期未显式点击的第二ID0次断言保留。
- 此快照home-stats的增强等待`canvas?.width !== 300`在canvas为null时也为真，且`every([])`为空集真；已建议root显式要求canvas存在/宽已更新及采样数组非空，再以最终hash闭合这个轻量测试健壮性点。该建议不涉及产品改动。
- 共享主日志尚处于旧“尚未执行”快照，原记录待更新项保留；root告知正在新成品定向验收，本审查者未读取或代签其进行中结果，也未重用首轮233/7充作新断言通过。

此次变化的两文件SHA-256：

| 文件 | SHA-256 |
| --- | --- |
| tests/home-stats.spec.ts | 5d78092b60890afa5f11693fb345822cce591d0a44d576decce5a7b066d889a7 |
| tests/favorite-drawer.spec.ts | ca2f5eddbcf46f8707eec182a1f861b14506d1010be1cf00572f5c07e8803049 |

## 第三次只读增量复查：建议闭合

- home-stats最终等待已明确`!!canvas && canvas.width !== 300`；实际客户端增强前或canvas不存在时不会直接通过。clients采样先要求`length > 0`再`every(value === 660)`，不再以空集真替代观察。结合前一增量的catalog普通/刷新中间值采样，原动画测试覆盖建议及防空健壮性建议在这里明确的范围内闭合；未增加catalog独立reduce序列或focus不重播断言，不声称已覆盖这些额外场景。
- favorite-drawer的第二ID恢复2个链接/恰好1次读取断言保持，队列恢复建议闭合。
- 主日志已删除“本轮检查/构建/浏览器/独立审查尚未执行”，更新实际743单元、首轮233通过/7失败、五处旧断言/一个card setup/真实PART-01分类及其遗漏原因，保留原始失败日志，并列出新成品`RnlevuifLB1O2vmGls4Nj`。原记录失真建议闭合；审查快照仍写定向复验进行中，最终135/1通过及截图由root在交接前补充。
- 本审查者额外只读各既有日志结尾：`hd-fe-ux03-final-browser.log`确有135 passed（2.5m）；`hd-fe-ux03-final-unit.log`确有40文件743 passed；`hd-fe-ux03-final-counter.log`最新防空增强用例1 passed（9.0s）。它们均由root实际运行，本审查者没有执行或代签浏览器，也不把135定向通过称为新完整240全量通过。

最终复查指纹：

| 文件/证据 | SHA-256 |
| --- | --- |
| tests/home-stats.spec.ts | a8f6b0cb08da9993aae0ff772d7e043683dc9cb538e5afe908896f4fa226e213 |
| tests/favorite-drawer.spec.ts | ca2f5eddbcf46f8707eec182a1f861b14506d1010be1cf00572f5c07e8803049 |
| 共享FE-UX-03主日志 | b7a2785e07c910dbdc9cfc39aecab72f8f538a64b3b08e4134369ebe62123205 |
| /private/tmp/hd-fe-ux03-final-browser.log | 8f2091770afa4f3b134d4576bea60fc05197b488b51a19091d9c589071cf7d1b |
| /private/tmp/hd-fe-ux03-final-unit.log | f3d1a0eadf0e6dbc29e1881cc916c3ea53dd57fd2a754d7d5af92205600d83d8 |
| /private/tmp/hd-fe-ux03-final-counter.log | a265edf8e0150de3e6b9f70f6c7f49b538bc7472a647ed3d1277c19804dadda4 |

本次仅更新自己的独立报告，产品与测试源码未改，没有应用/HTTP/构建/服务/浏览器操作。首轮审查指纹保留为历史，后续快照以本追加表对应文件为准。
