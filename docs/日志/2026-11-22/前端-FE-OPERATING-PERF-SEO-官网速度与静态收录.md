# FE-OPERATING-PERF-SEO 官网速度与静态收录

固定 FE 工作树 `codex/fe-operating-perf-seo`，基线为 `v2.0.1`／`af33d92e0e8349ea7fe3e34591e1acef4f1bee90`。本轮官网候选只调整计算器 CSS 的加载范围和可选的静态首批收录。生产收录、广告开关、数据库、供应商同步及生产发布均未操作。

## 官网速度

- 将只有完整计算器使用的引用样式移入计算器布局。独立成品的匿名 Chrome 对照中，首页、目录和车辆详情各少加载 14,673 B 解码后 CSS，少传 2,143 B 压缩 CSS。共同计算器组件样式和全站手机页脚规则保持在原有公共布局。桌面与手机模拟的直接访问、首页到计算器及返回首页均通过样式检查。现有默认费用、固定俄罗斯样本和多语言元信息的 3 个浏览器回归也通过。
- 首页主图已在 SSR 文档内输出响应式 preload。首次收到 HTML 之前，仍要等精选、筛选概览和热门车型三个数据分支。通过私有首页缓存渲染的请求还要校验目录与筛选版本，并在缓存网关收齐证明与 HTML。现有实时失效以及 404／429／503 语义继续有效。减少重复版本检查可以降低回源调用量，尚无采样把它确认为单次导航首屏瓶颈。[首页 SSR](../../../apps/web/src/app/%5Blocale%5D/page.tsx) · [SSR 数据读取](../../../apps/web/src/modules/vehicles/infrastructure/ssr-public-reader.ts) · [HTML 缓存](../../../deploy/runtime/production/html-cache.mjs)
- OPS 的 v2.0.1 同时段证据显示，单并发 8 条完成，四个公开 API 的完整耗时依路径为约 0.84–1.03 秒。5 并发首波五条均为 200，冷首页返回 259,411 B 的未压缩 HTML，总耗时 6.19 秒触发停止。首页缓存有一个证明未签发或未接受时直发 identity HTML 的分支，OPS 正在处理。静态分发的 JS／CSS 仍需用真实浏览器验证编码，必要时由 OPS 在指纹静态资源位置协商压缩。保留 `Vary: Accept-Encoding`、指纹缓存和 404 策略。[HTML 缓存分支](../../../deploy/runtime/production/html-cache.mjs) · [静态分发](../../../deploy/runtime/production/release-slots.py)
- 公网 Chrome 请求被自动审批按公网测试由 OPS 执行的约定拦截。这一端尚无真实公网 LCP、首屏主要内容时间或可交互证据，也没有可用的公网浏览器 P95。隔离本机浏览器验证了测量脚本，延迟不外推到生产。OPS 可在固定 FE 工作树的忽略目录 `docs/private/fe-operating-perf-2026-11-22/` 取脚本和脱敏样本。与分档压测错开，普通匿名 Chrome 串行三轮中文桌面和俄语 Pixel 7 模拟首访／同会话复访，补目录和详情。记录真实网络出口地点、导航 TTFB、标题可见、LCP、客户端接管标记和收藏按钮实际可打开。小样本只报分组中位数与范围，流量规模足够后再判 P95，俄语或设备模拟不代替俄罗斯网络。

## 搜索收录

- 原版 FE 收录开、BE 车辆收录关时，隔离成品实际输出 33 个基础语言页可索引（含首页与目录），动态 sitemap 为空。只缩小地图名单无法精确限制首批收录。完整开启的合成组合验证了 35 个地图链接，合格车辆的中英文 canonical 与双向 hreflang、`Car` 结构化数据正常。俄文不合格页保持 noindex，过期名单返回 503，缺失车辆返回真实 404。默认关闭的隔离成品保持全站禁止抓取、网页 noindex 和空地图。
- 候选的 `SITE_INDEXABLE=static` 只允许中英俄的「关于我们」和「如何购车」共 6 个文档。robots 放行这六页、所需静态资源及地图，metadata 和动态地图共用同一份路径名单，无需车辆资格接口。候选实际 13 条 HTTP 检查通过，每页自指 canonical、四组互链（含 `x-default`）及结构化数据与地图一致。首页、目录、查询和详情继续 noindex，无效详情返回 404。34 项定向单测及模块边界检查通过。既有 `false` 和 `true` 的行为保持兼容，生产配置默认仍为关闭。[官网设置](../../../apps/web/README.md) · [robots](../../../apps/web/src/app/robots.ts) · [地图](../../../apps/web/src/app/sitemap.xml/route.ts)
- 先留关闭态发布。生产门槛通过且获准后，同步设置官网构建和运行的 `SITE_INDEXABLE=static`，BE `PUBLIC_SEO_ENABLED=false`。如果生产网关已有地图指针，切换前撤下旧名单，发布后可使用六页动态地图或由 OPS 激活相同六页的静态分片。隔离 Compose 已核对蓝绿构建和运行接线，现有生产 Nginx 分片逻辑已做隔离测试。经真实域名核验 robots、六页 canonical 与 hreflang、结构化数据、地图、下架与错误状态后，才由有权限的账号提交 Google Search Console 与 Yandex Webmaster。是否入索引要看站长平台实际报告。按发布手册在开放后 0、1、6、24、48 小时记录抓取、负载、同步和错误，之后分别决定是否加入已复核国家计算器、状态稳定的首页与目录、最后加入逐语言合格车辆。[发布门槛](../../../deploy/runtime/production/v2-release.md) · [Google 抓取与收录](https://developers.google.com/search/help/crawling-index-faq) · [Yandex Webmaster](https://yandex.com/support/webmaster/en/indexing-options/tools)

## 交接状态

两个应用改动均经独立只读审查。SEO 复查补齐用于主体页面的国旗资源规则。未发起生产请求、未推送、未打标签、未部署。真实域名验证和生产时延由批准后的独立窗口完成，不能用本轮隔离通过代替。
