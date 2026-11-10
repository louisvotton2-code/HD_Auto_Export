# 前端 / FE-UX-02 / PM-INT-03 性能对照

> 历史记录：2026-11-08后续用户要求页面激活时不进行任何数据更新。下文“激活时一次局部JSON”的对照是中间成品的历史实测，已不符合最新目标，不能继续用作当前行为验收。最新目标是focus／visibility与非BFCache pageshow不发业务JSON或RSC；浏览器Back／Forward仍按URL读取最新数据，显式URL查询与用户重试另行验证。原始失败样本、补采与限流记录仍保留，不据此宣称新成品已经通过。

日期：2026-11-08（Asia/Shanghai）
记录者：`/root/fe_ux02_perf_baseline`
状态：三轮原始采集、延迟探针及第二轮受影响首页组补采完成；有效分组指标已齐。原批次的5个失败响应原样保留，不能将它改写成三轮原始运行全部成功。

## 成品、数据和测量边界

- 基线见[性能基线](前端-FE-UX-02-性能基线.md)：3317旧成品 `tUxSErSBV6zrAhOoTG8Or`，公开目录2条展示样例；本轮成品 BUILD_ID `jxupsT7lU7eVFHhjD1W8y`，Node v24.19.0，3317 standalone → 真实公开API3320。
- 本轮环境读回／PM移交为10条公开记录、其中8条external，图片共71张，首页显示8条。**输入规模与基线不同**，不将耗时差异归因为单一前端修改，也不宣称所有导航都变快。
- Google Chrome 156.0.8078.81、Playwright 1.65.0、1440×1000与基线一致；3个独立上下文，沿用完全相同的首次／热导航、原BYD／ATTO 3／BEV筛选、pageSize1分页、focus／Back／输入与滚动操作。已运行的服务没有重启，不是服务端冷启动。
- 开工 `pnpm hooks:check` 通过。初次普通执行器连接3317遇EPERM且未发出HTTP，改经本轮授权的执行权限运行；不把该环境限制列为产品故障。
- 在PM独占读取窗口内测量，不改源码、配置、限流、数据或服务，不发布／删除车辆、发送联系消息或提交表单。结束后Chrome已关闭并立即向root释放读窗；发现异常后只分析本地文件，没有自行重开实际服务读取。
- 两轮间加入30秒冷却，未计入点击耗时；该间隔仍未避免第二轮尾部5个BFF 503。root经PM转交的BE日志核对确认：同时间4个媒体与1个首页JSON被API返回429，API没有对应503或异常；FE `public-api.ts` 将非400／404失败映射为503。**这是PM／BE日志证据，非本记录者亲自读取API日志**。当前API全局120次／分钟及回环BFF聚合列为BE／OPS容量评估项，没有降低限流。

## 确认改善与保留的异常

| 动作 | 旧成品 | 本轮有效观察 |
| --- | --- | --- |
| 目录focus控制探针 | 每轮7 RSC（1目录＋6预取），main隐藏中位39.5ms | 3轮均1目录JSON、0 RSC、0document；未见main遮罩 |
| 首页focus控制探针 | 每轮6 RSC（1首页＋5预取），main隐藏中位44.3ms | 第1／补采／第3组各1首页JSON、0 RSC、0document；原第2组JSON503排除且保留 |
| 详情真实Back到目录 | 每轮7 RSC，main隐藏中位35.2ms | 3轮均1目录JSON、0 RSC、0document；另有媒体请求1／0／1，不能将它算成重复JSON刷新 |
| 计算器focus | 0请求，价格与滚动保留 | 仍0请求，价格26001和scrollY400保留 |
| 每个同源请求增加300ms后首页focus | main隐藏332.3ms，截图正文空白 | 截图明确 `phase=checking`、`mainVisible=true`、无旧遮罩属性；正文继续显示 |
| 本地公开媒体尾斜杠 | 每图先308再200 | 三轮HAR均无媒体301／302／307／308；规范路径直接请求 |

实际headless切tab依然没有向原页发出focus／visibility事件，三轮实际tab动作均0请求，不能把上述合成focus探针称为真人切tab复现。Back由真实浏览器历史操作产生。此次没有通过隐藏main实现“无闪屏”，而是数据核对与页面壳层独立。

第二轮无效组：2026-11-08 18:03:17的 `home.before-reactivate` 有4张媒体503，18:03:20的 `home.synthetic-focus` JSON也503。错误HAR为 `/private/tmp/hd-fe-ux02-after-run2.har`；没有覆盖、删除或把失败当0ms。JSON事件监听器未记录最后一个503完成状态，完整HAR捕获到了它，所以错误判断以HAR为准。限流根因由PM／BE后续日志核对确认，不是从HAR的503猜测得出。

PM另外给予短独占窗口，充分冷却后在18:11:45起仅重做 `home.before-reactivate` → `home.real-tab-reactivate` → `home.synthetic-focus`。补采JSON／HAR单独保存，含 `replacementFor` 原报告、第2轮及三个动作名称；37条HTTP逐条status齐全、HAR无错误，首页JSON200。有效首页focus三样本按“原第1组／补采组／原第3组”取值。补采使用新context直接打开首页，不重复此前导航，故其直开首页405.4ms不替换原第2轮冷首页或导航指标；此处只补重新激活组。结束后立即向root发送“补采读窗释放”，未继续读取服务。

三轮未捕获页面异常均为0；这一事实不等于HTTP全部成功。第1／3轮及300ms探针HAR未发现HTTP错误，第二轮5个503明确保留。

## 普通导航耗时

单位ms，样本及中位数同时保留。第二轮异常发生在以下首次／热导航组之后，该组本身未见HTTP错误。普通跨页面导航本来就通过RSC，不会因为局部刷新优化而变成全站0 RSC；计算器初次进入后的12个预取RSC仍存在。

| 动作 | 旧中位数 | 本轮三个样本 | 本轮中位数 |
| --- | --- | --- | --- |
| 新上下文直开首页 | 187.1 | 523.0／275.1／274.0 | 275.1 |
| 首页→目录，首次 | 109.0 | 134.3／121.0／119.9 | 121.0 |
| 目录→详情，首次 | 44.4 | 86.4／103.4／102.0 | 102.0 |
| 详情→指南，首次 | 47.1 | 39.3／32.6／39.0 | 39.0 |
| 指南→计算器，首次 | 90.4 | 114.6／94.7／83.5 | 94.7 |
| 计算器→首页，首次 | 86.9 | 67.0／74.2／97.0 | 74.2 |
| 首页→目录，热点击 | 57.3 | 76.1／85.5／87.5 | 85.5 |
| 目录→详情，热点击 | 47.4 | 52.9／51.8／68.0 | 52.9 |
| 详情→指南，热点击 | 34.5 | 48.1／47.7／40.6 | 47.7 |
| 指南→计算器，热点击 | 56.4 | 76.0／69.1／48.0 | 69.1 |
| 计算器→首页，热点击 | 56.5 | 88.2／85.4／59.6 | 85.4 |

另核对关键请求的HAR响应头wait：

| 关键请求 | 三个样本（ms） | 中位数（ms） | 完整性 |
| --- | --- | --- | --- |
| 冷上下文首页HTML | 255.7／92.9／83.9 | 92.9 | 三个完整200 |
| 首次目录RSC | 5.2／3.8／7.1 | 5.2 | 三个未标记abort |
| 首次详情RSC | 6.3／4.8／3.2 | 4.8 | 第1个在收到200头后标记abort，另两个未标记abort |

普通导航部分RSC在HAR已记录200和响应头wait，但浏览器随后标记 `net::ERR_ABORTED`、receive=-1；不能把这类不完整条目的time当完整数据接收耗时，也不对它计算“完整请求完成中位数”。以上点击到目标正文可见的观察仍保留，**主要可确认结果是缩小刷新范围与消除main遮罩，不是全面时延加速或公网速度保证**。

## 筛选、分页与结果完成口径

原协议点击耗时在“URL已更新＋任一车辆卡片存在”时停止。改用局部数据后，旧卡片可以继续可读，因此筛选35.1／35.8／44.2ms、分页45.5／21.4／12.3ms仅反映交互／URL响应，不能当作新结果完成时间，也不拿它们与旧RSC提交耗时直接算提速百分比。

- 三轮筛选都发出1个目录JSON，参数包含 `locale=en&catalog=curated&page=1&pageSize=1&make=byd&model=atto_3&powertrain=bev`；0 RSC／0document，并最终显示 `1bbb35f8-77f9-44fc-847f-fecc496a9692`。由于本协议没有改q，facets URL没变化，不额外拉facets。
- 三轮下一页都发出1个目录JSON，`page=2&pageSize=1`；0 RSC／0document，最终显示 `5f0828d3-031d-4c81-ba5c-e39969ee0298`，不是在客户端已下载全库上换页。
- 独立只读对比3317同源与3320直读的4组原查询：page1／2、ATTO 3／SEAL，两端page、pageSize、total、hasMore和IDs一致。目录总数10，pageSize1只返回1；按车型筛选各total1且hasMore=false。
- 数据请求时长已用HAR和request timing交叉核对，见下表。请求完成不自动等于React最终绘制完成，本轮旧协议没有单独记录新结果提交帧，不能补造这一指标。

| 数据请求 | TTFB三个有效样本／中位数（ms） | 请求发送→正文接收完成三个样本／中位数（ms） | HAR原始time三个样本／中位数（ms） |
| --- | --- | --- | --- |
| 筛选目录JSON，原1／2／3轮 | 29.5／14.2／28.6；28.6 | 30.6／15.0／29.7；29.7 | 32.5／16.6／31.4；31.4 |
| 下一页目录JSON，原1／2／3轮 | 28.8／16.7／19.6；19.6 | 29.6／17.4／20.1；20.1 | 29.6／17.4／20.1；20.1 |
| 首页focus JSON，原1／补采／原3组 | 61.0／28.7／38.5；38.5 | 62.3／29.8／43.7；43.7 | 62.3／31.9／43.7；43.7 |

TTFB用HAR `timings.wait`，与raw `responseStart-requestStart` 相差不超过0.001ms；正文完成用raw `responseEnd-requestStart`。部分HAR原始time额外包含连接／时序字段，与raw并不相同，因此原值另列，不冒称UI端到端耗时。六次筛选／分页JSON均完整200；各另有一张媒体和一个图标请求，不将它们混算为第二次业务数据刷新。

## 壳层、滚动、输入和动效

- 目录focus前三轮实际scrollY均为338（脚本请求400，但新布局的页面高度上限为338），focus后338不变；未提交make=byd保留。首页focus三个有效组scrollY200不变，计算器400及价格26001不变。
- Back后目录scrollY为0，未提交make按URL恢复为空；旧基线为400。布局和卡片位置变化，点击目标前Playwright会使链接进入视口，本协议没记录离开目录的最终滚动位置，不能把不同绝对坐标当作已证明的恢复回归或保留400。未提交的表单草稿没有跨详情路由保存，不能声称已实现。
- 首页有效focus前后header／Canvas节点token相同，Canvas插入／移除计数不变，CSS动画时间继续增加；未观察到Canvas重建或动画从0重播。基线也没有该重播证据，所以不把它写成新修复的已复现故障。
- 300ms探针明确保留旧正文，在底部显示核对状态。截图沿用历史文件名 `/private/tmp/hd-fe-ux02-after-main-hidden.png`，**文件名不代表实际隐藏**；已实际查看截图，画面中的main可读。探针截图后等所有 `data-resource-url` 的freshness不再checking再关闭上下文，避免截断新JSON请求。

## 复测与交接材料

- 原脚本：`/private/tmp/hd-fe-ux02-baseline-measure.cjs`。本轮驱动：`/private/tmp/hd-fe-ux02-after-measure.cjs`，只增加轮间冷却、记录Node版本及延迟截图phase、等待局部核对完成；所有旧动作与输入保留。
- 原始JSON：`/private/tmp/hd-fe-ux02-after.json`；日志：`/private/tmp/hd-fe-ux02-after-run.log`。
- 三轮HAR：`/private/tmp/hd-fe-ux02-after-run1.har`、`run2.har`、`run3.har`；延迟探针：`/private/tmp/hd-fe-ux02-after-delay.har`；均保留匿名GET、不保存响应正文。
- 仅补第二轮首页受影响组的驱动 `/private/tmp/hd-fe-ux02-after-home-retest.cjs` 已执行；独立材料为 `/private/tmp/hd-fe-ux02-after-home-retest.json`、`.har`、`.log`。新增response事件记录确保每条请求status齐全，没有覆盖原始失败样本。
- 原始文件的独立离线校对：`/private/tmp/hd-fe-ux02-after-offline-check.json`，由子任务 `offline_har_check` 只读本地JSON／HAR生成，核对JSON时长、错误时间、请求分类与滚动／Canvas。它没有访问服务或代替本人的浏览器采集，也不是整轮产品独立审查。

```sh
PERF_OUTPUT_PREFIX=/private/tmp/hd-fe-ux02-after \
PERF_RUNS=3 \
/private/tmp/node-v24.19.0-darwin-arm64/bin/node /private/tmp/hd-fe-ux02-after-measure.cjs
```

当前以上命令不是直接重跑建议：密集三轮已证实可能触发限流，应先由PM协调读窗与BE评估节奏，不以增大限额掩盖问题。本轮没有修改产品或运行服务，没有Git提交、推送和部署。
