# FE-UX-03 独立审查：车辆收藏、图卡与预算组合

- 日期：2026-11-08，Asia/Shanghai；基线`fdf6c6bc52b3a40761c4f991dde8e1f6a0fad028`。
- Reviewer：配件实施子任务Agent。本报告仅审查另一作者的车辆收藏/图卡与根集成、另一作者的内联计算器；不审本人parts模块/素材/测试，不把作者自测当独立审查。
- 方法：只读源码、对照契约和既有公共入口、独立运行不访问HTTP的相邻单元；没有build/typegen/服务操作/真实API读取/浏览器或消息发送。
- 33文件源码清单：`/private/tmp/hd-fe-ux03-vehicle-review-scope.json`，SHA256 `7764bd47e389c6e39013767aabe5d2fa0c887a6a6bcade7f2715df4b3147786e`。该清单逐文件记录完整SHA；后续修复须增量复查并重新绑定，不直接继承此时的哈希。

## 结论与问题

初审未发现P0/P1；发现的P2 FX-01已在下述最终增量复查中关闭，目前本审查范围无未处置P0/P1/P2。原问题为内联计算器手动修改汇率后，`inline-fx-status`仍无条件按initialRates显示“默认参考汇率/快照”，与实际手填值不一致；作者已修复，不以源码通过替代浏览器验收。

## 审查覆盖

### 车辆收藏和图卡

读取`favorite-vehicle-ids`、store/hook、当前DTO读取、收藏按钮、抽屉及三语内容/CSS；另外查看主页车轨和公开目录卡片的接线/布局、详情操作和layout/header公共组合。

- 版本化浏览器数据只存合法稳定ID，去重且100上限；没有保存旧车价/库存/DTO。SSR空快照与浏览器状态分开，快照引用稳定。坏JSON/不支持版本不导致崩溃；读写禁止/配额失败保留内存变化，后续toggle不丢先前项；跨标签有效变更与clear同步，损坏事件不清掉最后可用内存。
- 同页各车轨/目录/详情按钮消费同一store，按钮不嵌套在整卡链接内；汽车收藏仍明确属于汽车，未将配件混入。语义按钮、aria-pressed、可见焦点与触屏入口保留。
- 抽屉在用户打开时按ID读取当前公开DTO，校验响应schema、ID和locale详情路径；404/网络错误/429分开，不从浏览器数据伪造可售信息。逐项请求遇429停止后续读取，等待后只能显式重试；关抽屉/变更收藏会abort，8秒超时和credentials omit/no-store/redirect error边界保留。没有自动发送咨询。
- 已售/预留准确显示；unknown不改成available。抽屉显示原币价格和reference/sale含义，没有内部治理标签。标题两行/图片防收缩、价格margin-top:auto和固定footer布局的源码可解释对齐；长俄文/长价格实际几何仍需浏览器确认。

### 根预算slot和内联计算器

读取`PublicDetailResource`的renderBudget/最新DTO调用、`PublicVehicleDetail`的ReactNode slot、app层VehicleDetailPage与详情route消息/日期/快照装配；读取内联UI/CSS、车辆事实映射、seed解析和完整Calculator消费/保存变更。

- 业务模块没有彼此导入内部store；跨车辆/计算器组合放app层。车辆模块只持预算slot，内联计算器消费公开DTO并调用既有calculateImportEstimate，未另造税率或复制简化算法。
- 事实映射不把车型年/首次登记当制造月份；year-only保持空。未知动力/方向/登记状态保留待选择，未知价格不填0；kW→metric hp显示换算说明，原币价格按显式快照换USD，不支持币种留空。运输空值保留现有核心的假设/排除项。
- 事实/价格身份变化时在render阶段阻止旧结果/seed，并随后重置；资源checking/error时disabled使输入、结果和带参seed不可用，正文/一般完整工具入口保留。最新PublicVehicle经slot传入，未固定闭包首次SSR车辆。
- seed使用fragment且严格key/version/长度/ID/枚举/数字/日期/完整汇率快照校验，错国家/坏编码/重复seed不消费；消费后只删除有效seed，保留其他hash/query。完整工具保存相同国家的快照和手动率，刷新不恢复默认虚构事实。三语Fees/FeeMethods等命名空间由局部provider传递。
- 复用FeeLine/FeeMethod，默认收起、单项/全部展开，本币与USD、非完整落地价和排除费用说明保留。暂未运行新成品，不能据源码宣称视觉/响应式/浏览器手递和Back竞争均已通过。

## 实际执行证据

| 独立执行命令 | 结果 |
| --- | --- |
| `pnpm --filter @hd/web exec vitest run src/modules/vehicles/application/vehicle-favorites-store.test.ts src/modules/vehicles/application/read-favorite-vehicle.test.ts` | 21:54:04运行2文件17项全通过；纯stub，无HTTP |
| `pnpm --filter @hd/web exec vitest run src/modules/calculator/application/vehicle-estimate.test.ts src/modules/calculator/application/estimate-seed.test.ts` | 21:54:17运行2文件32项全通过；无HTTP/真实数据变更 |

根需在统一构建上执行车辆收藏/对齐及七国内联→完整工具→刷新、错误/Back边界和320/390俄文；本报告不会代签作者或根的运行结果。没有覆盖本作者parts文件、API/后台、部署、首页统计动画的完整独立审查。

## 22:01最终增量复查

最终37文件清单仍为`/private/tmp/hd-fe-ux03-vehicle-review-scope.json`，SHA256更新为`9096117c75e4f0947301f71b9205644a5831ba0051fd2fcf1479b3ffab70a641`，补入实际阅读的draft/SSR增强测试及两套浏览器测试文件。与初审相比重点复读以下最终源码：

| 文件 | SHA256 |
| --- | --- |
| `calculator/ui/vehicle-import-estimate.tsx` | `9d5e3440346774a51729304da4bc0a284aff25e170084a92a6c647d802baf181` |
| `calculator/application/estimate-seed.ts` | `bf27817cd2215e740fab8594eeb1350560547d8437b564c86e97c94b9e0f7a96` |
| `calculator/ui/calculator-page.tsx` | `f0b9f4e7bf9a2b158500d53f0b684d0612b8453a022f4ebf440aebd8383a99cd` |
| `calculator/application/draft.ts` | `84fb90ba58be75abfa52d24cda5d293de38a08f61cd0e23e29d02df1c58e1929` |

- FX-01关闭：三项汇率任一编辑使manualRates为true并显示既有三语ratesManual；国家/币种重新派生以及DTO/日期/快照身份变化重置。equal DTO对象不触发错误重置，默认快照日期仍作补充。
- 显式空动力/方向/登记状态经当前草稿restore保留，不在刷新时回填旧默认事实；legacy非法enum仍按既有兼容规则处理。
- 完整工具pendingSeedRef在首次保存状态前保留有效seed，开发StrictMode effect重放不会因hash已移除而恢复旧session草稿；这项为静态时序复核，未声称独立运行开发浏览器StrictMode。
- 自定义完整汇率快照与输入同存，country匹配后恢复；GE等USD展示继续使用同一snapshot，手动customs rates保持。错误shape/额外key/版本/日期/错国家/重复和过长fragment均拒绝。
- 提出并复查纯parser健壮性改进：字段typeof/length检查提前到String枚举转换前，含恶意toString对象的JSON返回null，直接parser不抛TypeError。fragment外层catch仍保留。
- 22:01:28独立执行`vitest run`的vehicle-estimate/estimate-seed/draft/SSR增强边界4文件63项全部通过；此前收藏17项通过仍属未改范围。没有新build或浏览器读取，实际E2E由根执行。

## 最终测试准备方式增量复查

只读复查另一作者`apps/web/tests/vehicle-favorites.spec.ts`最终SHA256 `49dbff3226f4db23d56c8839c0d104b9664c2d50c373cbbf245477399631acab`。本次没有运行HTTP、构建或任何测试，也未改产品。

原用例在进入几何断言前仍拿到旧标题，测试准备未确保React资源生命周期完成。本增量等待hero Canvas由effect/ResizeObserver设置有效width，随后通过页面真实详情链接进入详情、确认详情main、再page.goBack，明确触发用户允许的Back核对；不再在同一个evaluate中连做hash push/back。SSR Canvas没有width属性，新的等待确实区分增强就绪，而不是等原生默认canvas尺寸。

拦截home JSON后的manual最低数由3改2，与默认fixture首页前三项中1条demo+2条manual的实际准备一致；后续仍设置第1辆长俄文/已售/极长KGS参考价，第2辆unknown，足够覆盖可变高度组合。没有把全部返回DTO误认成manual，也没有改固定资料或真实API。

逐行对照前版，1440/390/320视口、footer y差<=1、卡高差<=1、每项详情按钮scrollWidth<=clientWidth且有label、整页横溢<=1的断言均未放宽；标题必须已变更和title属性一致的断言保留。选择器使用真实车轨详情入口而非直接JS构造导航，因此准备方式与待验证生命周期更一致。未发现本测试增量新的P0/P1/P2。

37文件scope比对发现只有该测试SHA变化，其余已审源码全部未变；现`/private/tmp/hd-fe-ux03-vehicle-review-scope.json`的最终SHA256为`d63455c592ad622bd2275cc804f53e03ae93d063aa0d43a39a2024e54119670c`。根另报告新Rnlev成品135/135实际通过（包含本case），以及此前9个longTitles布局场景；这些属于根运行证据，本Reviewer没有独立重跑或代签，实际结果应引用根日志。
