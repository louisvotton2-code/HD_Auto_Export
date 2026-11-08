# 前端 / FE-UX-02 / 激活静默与显式查询测试迁移

日期：2026-11-08。记录者：`/root/fe_ux02_perf_baseline`。状态：测试源码迁移完成，待root统一构建、隔离浏览器运行与其他Reviewer审查；不是新行为已通过验收。

## 最新范围

用户后续纠偏取代此前“激活时局部核对”的目标：focus、visibility及非BFCache pageshow不得触发数据更新。用户明确保留浏览器Back／Forward读取URL对应最新结果；筛选、分页和用户手动重试是显式操作。公开UI／咨询草稿不再输出demo、第三方或库存待核验治理文案，内部DTO来源与价格安全约束继续保留。实际公开下架由PM处理，本切片不连接真实API或修改库存。

## 本切片改动

- `tests/public-rate-limit.spec.ts`：4项。三语目录以提交筛选触发429；等待期再次改变动力筛选、提交或点击重试均不再发业务请求；保留上一组可读结果，等待结束后用户手动重试恢复。另一项核对BFF保留429及Retry-After、非法输入返回400而非空库存、媒体仍200。三个语言场景不再使用focus触发请求。
- `tests/public-freshness.spec.ts`：由17项缩为10项。删除激活自动核对及激活首帧撤销旧状态等冲突案例；恢复真实Back／Forward核对已售和下架的独立场景，导航期间局部撤下联系href，最终每次只发1业务JSON。查询变化的Back也断言仅1个目录JSON，防导航信号与URL变化重复请求。另新增一项在三语首页／目录／详情共9个页面，派发focus、visibility与非BFCache pageshow，断言0业务JSON／0RSC／0document，正文、滚动、联系入口及未提交目录输入保持。此处是受控生命周期事件输入，不冒称OS切换窗口或真实BFCache验收。
- 保留真实JSON筛选／分页、跨查询URL Back、literal查询、图库桌面／键盘／弹层／失败重试／320px触摸／无JS。外部DTO继续校验ID、source结构、reference价格、unknown内部库存及未人审事实，但不要求公开来源治理说明；客户草稿只检查正确车辆身份、目标账号与路径，并排除旧治理提示。
- 两份旧性能文档顶部增加历史标记，旧“激活一次JSON”结果不得复用为当前验收；失败HAR、补采和限流历史原样保留。

新429 fixture仍为 `publicRateLimited:boolean`、固定 `Retry-After: 2`，作用于合法home／list／detail；媒体／facets及旧mode兼容，未修改suite标记和真实3320保护。新限流测试硬限定官网3100和fixture3327。

## 实际检查与限制

`pnpm hooks:check`通过；`pnpm --filter @hd/web exec playwright test tests/public-rate-limit.spec.ts tests/public-freshness.spec.ts --list`发现14项，加载／语法无异常。检查不是14项浏览器通过。本次没有build、typegen、启动／停止服务、读取真实3317／3320、发送客户消息、Git提交、推送或部署。

旧生产成品及旧183项结果属于已被纠偏的实现，不能证明本次迁移通过。下一步由root完成新成品后运行这14项及其协调的其他受影响测试；测试作者的自测不能替代独立Reviewer。角色与总进度由root／PM统一更新，避免多Agent覆盖共享摘要。

## 追加：仅facets限流的最小回归

PM确认该P2边界后，本切片仅扩展fixture并新增 `tests/public-facet-rate-limit.spec.ts`，不修改应用实现。`filtersRateLimited:boolean`默认false，仅合法vehicle-filters返回429及固定Retry-After2；旧publicRateLimited、media与mode行为保留。

新增4项分别覆盖首页SSR主数据200／facets429、目录相同组合、运行时hold主目录直到facets429后才返回200、无JS首页与目录的原生重载恢复。SSR先安装请求监听，保留真实车辆及非0数量，不自动JSON；运行时验证较晚主200不能清掉新冷却，下一次q变更／Warning重试在等待期不请求，到期仍不自动请求，由用户显式恢复最新q的结果和facets。无JS只用明确的noscript重载入口，不拿头部首页链接代替。

已执行 `node --check apps/web/tests/fixtures/public-api.mjs` 和 `pnpm --filter @hd/web exec playwright test tests/public-facet-rate-limit.spec.ts --list`，4项加载／语法通过，尚未实际运行。root负责新成品共享冷却、Warning局部重试及noscript恢复入口；该4项是验收约束，不表示这些应用边界已通过。执行护栏限定官网3100与健康标记fixture3327，未HTTP／服务／Next操作，未触及真实3320。

随后独立Reviewer发现首页主数据成功但SSR字典失败时，冷却结束后可能失去重试入口；root负责修复Home双方资源与合并状态。本切片仅在原Home SSR用例追加：到期仍显示可点击的error重试、等待期及到期均0自动请求；点击后首页与facets各1个JSON，恢复2张车型入口，原3条车辆保留。再次 `--list` 为4项通过，不代表这4项已运行；新成品执行由root登记，测试增量交另一Reviewer复查。
