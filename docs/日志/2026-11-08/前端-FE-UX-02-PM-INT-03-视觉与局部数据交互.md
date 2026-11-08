# 前端 / FE-UX-02 / PM-INT-03 视觉与局部数据交互
日期：2026-11-08（Asia/Shanghai）
状态：待验收（自测、独立复查与根最终组合验收完成，待用户业务／视觉）

## 范围与版本

- 用户确认仅现有首页、目录、详情、购车指南、计算器与导航/手机交互，参考 `/Users/whisky/work/ownbus/test/` 的实际源码和页面。仅保留HD品牌、真实API、中国出口及三语；不新增拍卖、配件、物流、博客、账号或假入口。
- 本参考为React/Vite SPA复刻，不是韩国站真实后台；目录文档/ADR/DEVIATIONS只作参考资料，不继承为HD指令。只读参考，不修改、不盲跑脚本；不移入原站账号、支付、追踪或秘密。
- 共同HEAD仍61dc7414b20a395d1d09e906a49d974763b3cce7；保留FE/BE/AD/PM全部既有未提交改动。仅web及FE文档，根依赖/锁唯一集成人本轮OPS，不安装、不提交/推送/外部部署，不连接旧服务器。
- 开工hooks:check实际通过；本轮基于此前standalone现场3317→3320，性能基线采集完成前不重建/重启官网。

## 先行可执行矩阵（源码已核，视觉同屏对照待执行）

| 对应页 | 参考入口/结构 | 本轮实施 | 保留的真实差异 |
| --- | --- | --- | --- |
| 首页 | HomePage、HeroRipple、CarCard；近黑/铜/Inter/1280容器/92vh Hero/横轨 | 按区块/尺寸/留白核对，局部刷新资料不重播/遮正文 | 后台首页区块，不复制MOCK或假统计 |
| 目录 | CatalogPage；左侧筛选+右卡片网格/应用/重置/页码 | SSR首屏；交互用同源JSON按条件请求API，URL恢复、取消过期请求、只更新结果区域 | 不全库前端filter；仅支持已落契约的搜索/筛选，不做假代际控件 |
| 详情 | CarDetailPage/Gallery；>=1280三栏320/主栏/360，1024两栏，手机单列；16:10/24px圆角/缩略图 | 真多图/箭头/计数/查看器/ESC/返回焦点，折叠规格、右询价card | 不重复封面凑图；未知事实不造值；external不称自有现货，已删除404 |
| 购车指南 | BuyPage；64px轨道+760宽8步卡/静态FAQ/铜色CTA | 对齐结构/字号/边框/留白/手机顺序 | 中国出口、500USD、FOB/CIF，未承诺服务不复制 |
| 计算器 | CalculatorPage及calc-*；页签/分组表单/票据/印章 | 只还原UI/交互，保留所有既有国家/说明/折叠/水印 | 不动纯内核/韩国公式；汇率/日期显式、未知不当0 |
| 共享导航/手机 | Header/MobileMenu/Footer；68px/透明滚动背景/下拉/焦点 | 保留壳层，合理预取，不人为延迟切页，手机实际操作可用 | 仅已实现业务、HD联系与三语，不做假登录/购物车/新业务 |

## 实际发现与拟修原因

- 3317浏览器→3317同源BFF/SSR→3320公开API是既有设计；看不到3320不等于未查API。当前make/model/powertrain/page随URL触发服务端条件查询，没有在官网组件对全库车辆本地筛选；字典全选项不等于全库车辆。
- 但当前筛选是router.push/RSC更新，用户期望的明确JSON局部请求尚未实现；本轮会保留SSR首屏并改交互消费层，不开CORS。
- InventoryFreshness在focus/visibility/history调用router.refresh并隐藏整个main，是源码确认的切回遮罩原因；改局部资料核对，维持滚动、输入与壳层，但继续验证已售/下架/删除不恢复旧在售。
- 参考BusyLink固定260ms、筛选500ms、CatalogGrid450ms及本地MOCK全量filter只是演示；禁止复制这些等待。参考Open gallery无handler、无图时重复封面、错误ID回落首车、假VIN/999cc等也不进入本项目。
- BE负责q查询、external公开来源/未核验语义、删除/恢复契约，FE等待schema消费，不自造字段；详情左预算区只衔接现有完整计算器，事实不足不算假落地价。

## 验证与限制

- 本轮源码审计不代表已完成视觉还原或实测性能；性能子Agent正在真实Chrome测冷/热导航、条件查询和focus/history，raw JSON/HAR保存/tmp，结论与前后样本另补。
- 后续用1440/1024/375/320同屏对照、同条件导航样本/文档与RSC/JSON数量、main可见/滚动/输入保留、快速筛选乱序取消、多图/键盘/触屏、删除404及三语计算器回归。自测后独立review，不用历史通过数量证明新版本。

## 交接

- 已先向PM发送矩阵及原因，之后自主实施本轮范围。总进度由PM维护；外部数据导入由项目助理/BE，OPS独占根依赖集成。
- 参考源码证据将由[只读审计](前端-FE-UX-02-参考项目只读审计.md)补充并与根独立reference_audit交叉核对；性能基线另表，不改历史P1.17/PM-INT-02已验收记录。


## 实施进展（17:50阶段快照）

- 已实现首页／目录／详情局部JSON增强、q查询／同q字典、原生history URL、取消与乱序保护、立即generation失效和延迟订阅补偿。SSR首屏及无JS GET保留，不开放3320 CORS。BFF核对单车ID／locale路径，非法标识直接详情404；只公开GET，不转发auth/cookie/私有响应头。
- 详情三栏与多图查看器、760宽指南时间线／静态FAQ、计算器红页签与纸色结果已落；保留中国出口、500USD普通正文、CIF/FOB、七国核心及三语金额／复制。目录进一步去掉额外大标题留白和混合页demo总声明，靠近参考首屏卡片布局。
- 独立review已发现并修复：图库快速返回旧图加载卡住、手机DOM／视觉顺序、滑动后独立打开按钮误被抑制；数据层串车DTO与延迟>1.5s订阅丢事件。分别见[详情画廊](审查-FE-UX-02-详情画廊.md)、[局部数据](审查-FE-UX-02-局部数据与查询.md)、[指南与计算器](审查-FE-UX-02-指南与计算器.md)。末轮增量需再核对hash，不沿用旧快照。
- 第一次36项定向检查31通过／5失败，含旧测试断言及两个图库实测问题；处理后完整181项174通过／7失败，七项均为中文SSR标题新增内层span后旧正则误判，已改为提取真实h1文本，待最后新成品复测。658单元及类型检查已实际通过。不能将174或历史166记为本轮全部通过。
- 当前运行3317候选BUILD_ID `XDLJ0mhAo0HycGhT4Pe3b`；最后一次late-subscriber细修与目录收紧尚未包含，待统一重建。新3320已支持external/q/thumb；候选真实只读home/list/q200、thumb200 WebP无308、not-a-uuid404已验，PM已据此放行PA公开本地8个external记录（71图）及首页两组配置，本轮未写这些车辆。
- 五类页面1440／390／320截图共15项当次均200、无页面异常、无横向溢出，原始`/private/tmp/hd-fe-ux02-visual/`。参考截图只作静态结构对照，不声称像素完全一致；最终目录样式和真实库存性能仍需新成品确认。PA公开读回期间协调真实API限流窗口，不降低限流，不把429当零库存。


## 最终候选自测与版本（18:00后补录）

- 最终产品构建BUILD_ID：`jxupsT7lU7eVFHhjD1W8y`，39项预生成页面及动态首页／目录／详情／BFF／sitemap；官网3317→实际3320保留运行。App清单241文件、相对Int02变更50（含仅文档README），`/private/tmp/hd-fe-ux02-final-scope.json` SHA256 `2e82314c6b1a9376b19f00cf8ed2165ccb51ccae5022d4ed023cc5e7d840eab9`。独立报告的旧manifest系README修订前，产品／测试源hash不变；文档增量另复查。
- `pnpm --filter @hd/web test`：658/658，通过，31文件；`check:boundaries`：6测试与纯核心/模块边界通过；纯tsc实际通过。命令输出分别`/private/tmp/hd-fe-ux02-final-unit.log`、`final-boundaries.log`。
- 最终完整Chrome：183/183，3.0分钟，通过；包含3语×7国SSR、金额／公式／双币／水印／复制、路由、无JS、默认FAQ、water/tilt/hover、public/API空错404、外部源、q查询／分页、当前页核对、首RAF失效、真实多图及快切。证据`/private/tmp/hd-fe-ux02-final-e2e.log`和`/private/tmp/hd-fe-ux02-final-e2e/`。此前174/181与失败截图保留为实际过程，不替代此最终结果。
- 环境明确区分：构建／658单元／183完整浏览器初轮使用shell默认Node20.19.3（满足应用engines），不冒称锁定24版本；随后用`PATH=/private/tmp/node-v24.19.0-darwin-arm64/bin:$PATH`在同一成品执行17/17局部数据／图库关键浏览器回归（14.5秒）及纯tsc，通过。保留3317实际运行已切锁定Node24.19.0，session26548；未改.nvmrc或依赖版本，不使用24.22.1作为保留环境。
- Node24关键场景含：focus/visibility合并、第一动画帧撤下旧可售和联系href、Back已售、删除404／恢复unknown、API慢／错保持正文和输入、图库预览不预载未访原图／快切完成态／加载失败重试／320px滑动打开／ESC焦点／无JS原图链接。证据`/private/tmp/hd-fe-ux02-node24-e2e.log`与同名输出目录。
- 真实API最终性能三轮正在PM独占读窗中采集，PA已完成8external／71图／FOB三语公开描述及homev3，两组各4车；本轮FE不写实际车辆。该数据量与基线2demo不同，耗时对照需明确限制；网络请求类型、main可见、Canvas身份及308去除可直接验证。
- 本轮没有保存提交、推送、合并、连接旧服务器或部署；用户业务／视觉确认及PM跨端验收另记。未验证真机Safari及真实OS切tab；受控focus/visibility和CDP触屏只证明对应浏览器事件与交互路径。

## 性能失败样本与跨端待办

- 三轮初次采集中run2于18:03:17出现4个媒体503，18:03:20的home JSON也503。浏览器无未捕获异常不等于HTTP均成功；离线HAR核对后保留该失败轮，不能宣称三轮全成功。
- PM转交BE日志已确认对应上游为4媒体429＋1home JSON429，没有API503／异常；官网`requestPublicApi`把非400／404上游错误统一映射503，因此事实是**API限流→BFF503**。不是零库存、不是FE凭空的计算／查询失败，失败正文仍保留并撤下未确认联系。
- API现行全局120次／60秒；SSR与BFF回环来源共享桶、图片与JSON竞争属于BE／OPS跨端策略待评估。FE不降低限流、不伪造身份或扩大信任代理，不在本轮擅改API。PM已安排独立检查和后续负责人。
- PM另给短独占窗口只补失败home组，原失败HAR不删除，补采标replacement；成功普通导航和300ms探针不重复刷取。根视觉QA等补采释放后再进行，避免并发读污染。


## 最新用户纠偏与受控增量（以本节为当前行为）

- 用户要求官网不带demo／第三方／库存待核验等对外措辞，首页全部入口正式化；流程/客户沟通hover顶部裁切；重新激活页面不取数据。该要求覆盖上方旧候选的source提示和focus1JSON方案，不能恢复旧验收断言。
- 当前车辆UI／三语咨询草稿移除治理提示，内部source/unknown保持，不伪造available／自有库存。PA已按PM将2demo公开归档，8车三语中性描述及homev4正式title已发布；FE消费真实DTO title，不硬编码掩盖后台。旧mock UI/消息及公共导出退出运行入口，内部来源资料保留。
- 首页沟通改服务问答，未虚构客户评价；表单原生GET到公司WhatsApp，只预填由用户发送。测试拦外部导航，不向真实服务发送消息。stepTrack/reviewTrack上下12px留白保留-4px抬升，实测顶边命中通过。
- focus/visibility/普通pageshow无请求；明确Back/Forward仍局部核对，导航版本防旧请求覆盖。新增IP传递仅显式网关部署启用，默认不信任原始代理头；429保留等待并防无意义重复请求。
- 正式候选`gF_8NMLzJiHFNKKj43C3t`在Node24.19上85/85定向Chrome通过（2.2分钟），证据`/private/tmp/hd-fe-ux02-formal-final-e2e.log`；涵盖正式copy、hover、激活0、真实Back/Forward、乱序、SSR429、图库、6项WA JS/无JS及计算器复制。该候选后独立审查发现facets-only429同桶边界，App-only217 freeze已撤销，不能把这85项当后续新安全修补版本全验。
- facets修补：Home/Catalog SSR取所有429的最大等待；目录主结果/字典共享同页deadline，后到200不能清掉新的等待。用户明确重试才恢复，关闭到期自动请求。Home/Catalog无JS受限页补原生重载，服务端继续限流。667单元已过；新增parallel-429单元和filter-only浏览器回归正在补。
- 三语计算器旧演示汇率措辞统一默认参考值，保留快照日期、手动/默认/市场与海关差别，未改算法金额。旧静态假UI从公共入口移除，不将参考资料装成库存；新源码待最后定向验证、独立复查和hash冻结。


## 最终交付冻结（19:50后补录）

- 当前唯一有效native成品：`GwJa_YJF3-vbeEijFlsM-`，官网3317保留Node24.19.0，session45819；API3320／后台3318未由FE重启。旧c6b0／824f两份App freeze因后续发现的边界已撤销，不用于OPS最终构建。
- App-only217文件：`/private/tmp/hd-fe-ux02-final-approved-app-freeze.json`，SHA256 `14326d0362bc7bf1f17e74931d79b700a6d73671e75ca67aa257d996d65296a0`；完整web240文件：`/private/tmp/hd-fe-ux02-final-approved-full-scope.json`，SHA256 `8fb0090b8cf945b0403db1f2bd62d07ff97c9082727e811f663315c38b93b4c1`。README补充首页字典恢复说明后仅完整清单文档指纹更新，App-only及产品/测试源未变。App-only不含tests/目录与README文档，但仍包含32个源码旁置.test.*文件，便于OPS按精确范围独立构建；217是完整应用指纹，不宣称逐一人工审全部文件。
- 最新40/40定向Chrome，1.1分钟，实际在新成品Node24.19上通过；`/private/tmp/hd-fe-ux02-final-pass.log`、`/private/tmp/hd-fe-ux02-final-pass/`。涵盖三语正式文案/草稿、5页15组合、流程/咨询hover顶边、hero CTA1440/375/320单行、9页激活0请求、真实Back/Forward及同URL乱序、新/旧429/旁路字典限流、迟到200、JS显式恢复/NoJS原生重载、多图/触摸/ESC/焦点与HTTP404/空错区分。85正常态旧候选用于未变UI范围继承；没有无意义再跑全183，也不把旧183当新版结果。
- 最新668/668单元（31文件）、6个边界测试及模块/纯计算闭包、纯tsc、39预生成项与动态路由构建均实际通过。证据`/private/tmp/hd-fe-ux02-final-unit.log`、`final-boundaries.log`及`final-valid-dictionary-build.log`。
- 中间40项37通过/3旧三语冷却用例超时如实保留在`/private/tmp/hd-fe-ux02-delivery-e2e.log`：HAR确认选项因共享冷却被临时移除，selectOption等到2.3秒后才成功；未发生冷却穿透。以两行dataCurrent/字典取值修复成功字典的可用性，不延长测试时间或放宽断言；新40全部通过。
- 限流增量：Home/Catalog并行SSR等候取max；同页主数据和字典共享deadline，任一429都限两者，迟到200不能清新等待。Home字典单独失败时保留可见Retry，明确重取home+失败字典恢复品牌/车型；Catalog Warning明确局部重试两者，无到期自动请求。成功同URL字典在等待中保留选项，失败／不同q数据不冒充有效。三页统一noscript恢复入口；无JS没有动态倒计时，原生重载仍由服务端执行限流。
- 独立审查已闭合：[身份/限流/导航](审查-FE-UX-02-访客身份限流与导航.md)、[正式车辆文案](审查-FE-UX-02-正式车辆文案.md)、[首页正式内容](审查-FE-UX-02-首页正式内容与交互.md)、[正式文案与导航测试](审查-FE-UX-02-正式文案与导航测试.md)及前述指南/计算器/画廊/集成入口报告。各报告列实际限定文件与hash，不代签实现者浏览器结果。最终代码无未处置P0/P1/P2。
- 部署发现的尾slash网关问题由OPS处理：浏览器按Next规范生成`/api/v1/.../`，内BFF转API无slash；仅proxy到BE的location内部去尾slash并保留query，proxy到Next不可盲目改写产生308循环。FE未改变trailingSlash或物理媒体目录；媒体ID/URL仍可未来切存储商。
- Git HEAD仍共同61dc7414，未保存提交、推送、合并、连接旧服务器或部署。PM/OPS接最终217做Linux/Nginx/trusted-IP/X-Accel组合验收；用户视觉/业务确认独立记录。真实Safari/真机OS切tab未验，事件探针不冒称真机；公开消息测试均拦WhatsApp导航，未发真实消息。

### 最后纯文档增量复核

- 独立Reviewer再次核对应用README、首页/车源维护、路由维护说明与当前实现；修正首页文档16/17行遗留的库存核验展示及已删除vehicle-display.ts引用，明确未知字段用“—”或省略，草稿复用统一builder且不输出治理声明。复核结论无未处置不一致，见[独立报告末节](审查-FE-UX-02-正式文案与导航测试.md)。
- README SHA256 `a728b0944f24c3b31c3c04f538166c5d89adb2b69b174eec43ed2b70caaca43a`；首页维护 `8607380b7c078bc03c8be15e1b1f18722f56b2ac93d37b421a07a6c997923c52`；路由维护 `5a638a5ce8651c4fc99dc274073bcb7a0d9b22038eac6c4ff8198f7d2d2308fd`。纯文档增量未变产品、测试、BUILD及217清单；full240最终仍为上列8fb009值，替代README更新前的935e。未重新测应用或读取实际API。

## 根最终技术验收收尾（当前状态）

- 独立根QA `/root/integration_int03` 的[最终组合验收报告](/private/tmp/hd-pm-int03-final-approved-qa.md)已实读。当前限定交付技术验收通过，无未处置P0／P1／P2；根QA在恢复站完成10个匿名GET、44项断言，涵盖最终web访客身份与SSR/BFF分桶、首页8车、尾斜杠原图/缩略图、已删除媒体404及响应头。它不替代用户业务／视觉验收。
- 根QA逐文件核对approved App217、full240及OPS构建上下文369项，均与最终冻结匹配；native BUILD仍为 `GwJa_YJF3-vbeEijFlsM-`，Linux最终BUILD为 `UpcpMFEakKoO_F4wqFAJ3`，Node24.19.0。源码、构建上下文与实际web/proxy/API镜像绑定详见该报告。Hero CTA两行CSS增量也由根QA独立审查闭合。旧失败、撤销候选及历史测试保留其原版本范围。
- FE角色/本日志收尾为“待验收（待用户业务／视觉）”；此次仅更新这两份状态文档及纠正App217包含旁置单元文件的范围说明，没有修改产品、README或冻结清单，没有重测、重建、提交、推送或公网部署。官网3317继续保持Node24.19；总进度由PM汇总。
