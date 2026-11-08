# 前端 / FE-UX-02 / PM-INT-03 只读性能基线

> 历史记录：2026-11-08后续用户要求页面激活时不进行任何数据更新，并调整公开展示口径。下文仅保留旧成品当时的实测，不再作为当前激活行为的验收依据；最新目标为focus／visibility与非BFCache pageshow不触发业务JSON或RSC；浏览器Back／Forward仍按URL读取最新数据，显式筛选、分页和用户重试另行验证。新目标仍须用对应新成品复测，不能复用此处旧结果。

日期：2026-11-08（Asia/Shanghai）
状态：待联调（基线采集完成；等待实现后同条件对照，不代表优化已完成）
记录者：`/root/fe_ux02_perf_baseline`

## 范围与版本

- 只读测量现有官网3317 standalone及公开API3320；不改应用、配置、接口、数据库或其他角色数据，不安装依赖、不启动或停止服务、不运行Next/typegen/build，不发送联系消息。
- 共同HEAD：`61dc7414b20a395d1d09e906a49d974763b3cce7`，既有未提交工作树全部保留；测量时现行BUILD_ID读回为 `tUxSErSBV6zrAhOoTG8Or`。
- 采集时间：2026-11-08 17:14～17:15（Asia/Shanghai；原始JSON使用UTC）。Google Chrome 156.0.8078.81，1440×1000；三个独立浏览器上下文，各执行相同首次／热导航、过滤／分页、激活与历史动作。服务未重启，不能称为服务端冷启动；首次点击可能使用Next自动预取。
- 开工 `pnpm hooks:check` 通过。第一次测量命令因本仓根 `node_modules/.pnpm` 不存在、web Playwright软链断开而未启动浏览器，记录在 `/private/tmp/hd-fe-ux02-baseline-attempt1-module-error.log`；不记为产品失败。没有安装／修复依赖，改用参考目录已存在的Playwright 1.65.0库，仅调用浏览器自动化，不运行参考项目scripts或修改参考目录。

## SSR／BFF的实际链路

浏览器只看到3317是现有设计，不说明读取了本地mock：

1. 首次访问目录，浏览器GET `3317/en/cars/`，官网Server Component按URL解析分页／筛选。
2. `apps/web/src/app/[locale]/cars/page.tsx` 并行调用目录和facets；`vehicles/infrastructure/public-api.ts` 的 `getPublicCatalog(query)` 向服务端配置的3320发送 `/api/v1/vehicles?locale=...&catalog=curated&page=...&pageSize=...&make=...&model=...&powertrain=...`，`cache:no-store`。
3. 当前JS筛选使用 `router.push`，浏览器实际看到带相同条件的3317 RSC请求；它不是直接fetch3320，也不是在已下载全库数组上过滤。无JS走标准GET表单。
4. 媒体及显式公开JSON请求通过3317同源 `/api/v1/...` 代理；不需要为了DevTools显示3320而开放CORS、传内部地址或密钥。

三轮浏览器过滤实际请求均包含：

```text
/en/cars/?make=byd&model=atto_3&powertrain=bev&pageSize=1&page=1&_rsc=...
```

浏览器过滤后显示ATTO 3的唯一ID，JS动作没有新增document请求。另只读对比3317代理与3320四组同参数GET：page1/size1只返回SEAL，page2/size1只返回ATTO 3；make=byd＋model=atto_3＋powertrain=bev仅ATTO 3，model=seal仅SEAL。两端IDs／page／pageSize／hasMore／total全部一致。当前样例总数2，pageSize1明确返回1而不是2；不能将少量数据时默认pageSize24恰好容纳全量误判为客户端全库筛选。

这些响应和源码能证明现有真实分页／筛选行为；浏览器HAR本身不能直接观察SSR到3320的内部请求，不冒称抓到了服务端链路。当前没有独立文本搜索输入／q契约，只有make/model/powertrain；不能声称文本搜索已实现。

## 三轮导航基线

表内耗时从Playwright点击开始到目标URL及正文可见，不包含动作后固定收集窗口；TTFB从HAR的关键请求wait字段读取。单位毫秒，保留三样本，不隐藏首轮较慢样本。

| 动作 | 首次三个样本 | 首次中位数 | 热点击三个样本／中位数 | 新document／关键RSC |
| --- | --- | --- | --- | --- |
| 新上下文直开首页 | 953.3／187.1／173.2 | 187.1 | 不适用 | 1／0，另有8个自动预取RSC |
| 首页→目录 | 164.1／108.7／109.0 | 109.0 | 57.3／62.1／47.6；57.3 | 0／1 |
| 目录→详情 | 72.8／44.4／40.6 | 44.4 | 43.6／47.4／48.2；47.4 | 0／1 |
| 详情→购车指南 | 50.2／42.7／47.1 | 47.1 | 34.5／52.9／32.4；34.5 | 0／0（使用已有预取） |
| 购车指南→计算器 | 106.3／90.4／73.1 | 90.4 | 65.5／56.4／56.1；56.4 | 0／0关键请求；首次进入后另发12个国家页分段预取RSC |
| 计算器→首页 | 86.9／408.5／62.2 | 86.9 | 56.5／78.0／48.2；56.5 | 0／1 |
| 目录提交三项筛选 | 60.1／68.1／62.2 | 62.2 | 不适用 | 0／1 |
| pageSize1下一页 | 39.9／47.5／50.2 | 47.5 | 不适用 | 0／1 |

关键TTFB：直开首页636.6／29.6／23.4（中位29.6）；首次目录10.0／3.5／4.0（中位4.0）；首次详情4.3／3.0／3.1（中位3.1）；筛选2.6／4.1／2.9（中位2.9）；分页3.0／5.6／3.3（中位3.3）。部分HAR条目的receive/bodySize为-1，未把它当作零传输或零耗时。

本地这些点击没有完整文档重载，没有证据把一般导航归因于长退出动画。首轮首页HTTP等待636.6ms是实际样本，尚未分离进程唤醒、编译/JIT、SQL与CPU影响；不能仅凭它断言某一原因或用本地回环数据保证公网速度。三个上下文均未收到未捕获页面异常。

## 重新激活与历史恢复

真实headless `newPage/bringToFront` 在本次环境没有向原页发出focus/visibility事件，三轮均0网络／0遮罩。为验证代码路径，另显式派发一次focus事件；以下标清为**合成事件控制探针**，不冒充真人切tab复现。

| 动作 | 三轮RSC总数 | 其中当前路由／附带预取 | 全main隐藏毫秒（三轮） |
| --- | --- | --- | --- |
| 目录focus探针 | 7／7／7 | 当前目录1＋6个其他分段／页面预取 | 106.6／36.4／39.5（中位39.5） |
| 详情真实浏览器Back到目录 | 7／7／7 | 当前目录1＋6个其他分段／页面预取 | 44.1／35.2／34.2（中位35.2） |
| 首页focus探针 | 6／6／6 | 当前首页1＋5个分段／页面预取 | 50.3／34.8／44.3（中位44.3） |
| 计算器focus探针 | 0／0／0 | 未刷新 | 0／0／0 |

- 已确认代码原因：`InventoryFreshness`对popstate／pageshow／focus／visibility调用 `router.refresh()`；`globals.css` 的 `html[data-inventory-refreshing='true'] main` 设置 `visibility:hidden`。请求为RSC，不是document，但正文被整块隐藏，视觉上就是整页闪空。
- 每次router刷新后，已有壳层链接对应的相同URL分段预取再次出现。记录中包含首页／目录、计算器的三个不同_rsc分段及购车指南，不将不同分段简单说成相同请求的服务端重复执行；附带刷新重取的请求量仍是可优化依据。
- 目录focus前后scrollY400→400、未提交make选择byd→byd，header DOM token不变；计算器focus后价格26001及滚动400保留。Back回目录恢复滚动400，但未提交make选择从byd变空（URL本身没有make）；优化后若要求保留未提交筛选，也需覆盖这一情况。
- 首页focus前后scrollY200→200，header／canvas DOM token保持相同，canvas插入／移除数量不变，CSS动画currentTime连续增加，**未实测到Canvas被重建或动画从0重播**。不能用“遮罩”替代动效重播证据。
- 额外仅在测量浏览器对每个3317请求增加300ms延迟，单次首页focus造成main隐藏332.3ms；已截到整页正文空白、仅剩头部与“Checking latest vehicle information…”状态条。该受控探针不修改服务，证明网络延迟会放大整块遮罩；不是公网速度样本。

## 可操作的优化点与后续对照

1. 用当前页面公开数据的局部核验替代全壳 `router.refresh`／main遮罩，保留首屏SSR正文及已售／下架重新验证。合并focus＋visibility／历史事件，避免反复触发；不以永不刷新换性能。
2. 仅在需要的时机和页面做适量预取，核对当前页面刷新是否让壳层自动重拉6～7个RSC。计算器12个分段预取是实测请求量，需要结合收益／流量决定，不无条件禁用所有预取。
3. 首页两张媒体每张都先308到尾斜杠再200，三轮均为4个API请求；可规范化同源媒体路径消除一跳，不需放宽公开访问或媒体下架校验。
4. 改后用同一脚本、浏览器版本、窗口和页面序列再测。优先目标是focus／Back不隐藏整个main、不重播／重建壳、只请求当前必要公开数据，过滤／分页仍有真实按条件请求而不是全库客户端过滤。时延也保留三样本及首轮，不只报SPA理论或单个最佳值。

## 原始材料与复测命令

- 脚本：`/private/tmp/hd-fe-ux02-baseline-measure.cjs`。
- 原始JSON：`/private/tmp/hd-fe-ux02-baseline.json`；控制台日志 `...-run.log`。
- 三轮HAR：`/private/tmp/hd-fe-ux02-baseline-run1.har`、`run2.har`、`run3.har`；受控延迟 `...-delay.har`（content omit，不保存响应正文；全程匿名，未提供登录凭据）。
- 汇总：`/private/tmp/hd-fe-ux02-baseline-summary.json`、`...-network-summary.json`。
- 已实际查看截图：`/private/tmp/hd-fe-ux02-baseline-main-hidden.png`。

```sh
PERF_BASE_URL=http://127.0.0.1:3317 \
PERF_OUTPUT_PREFIX=/private/tmp/hd-fe-ux02-after \
PERF_RUNS=3 \
node /private/tmp/hd-fe-ux02-baseline-measure.cjs
```

脚本可通过 `PERF_PLAYWRIGHT_PATH` 指向已安装Playwright目录。默认复用参考目录现成库；不安装。最后的遮罩探针最多等待200ms观察mask，不要求修复后仍出现旧遮罩，因此可用于改后对照。若UI选择器随参考还原改变，仅更新测量脚本的选择器并说明差异；不把选择器错误写成产品故障。只读GET两端查询、所有浏览器导航均未触发管理/业务写请求或真实消息。

## 交接

仅新增本专属日志；应用和参考目录未修改，没有提交、推送、部署或遗留浏览器／测量服务。基线及脚本已交FE集成人；总进度与角色摘要由集成人／PM按本轮进展汇总。实现、源码独立review、优化后性能对照与用户业务／视觉验收尚未发生，不能用这份基线记为已优化。
