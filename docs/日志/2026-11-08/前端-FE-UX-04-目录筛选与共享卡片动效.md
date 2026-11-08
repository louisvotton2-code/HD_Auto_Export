# 前端 / FE-UX-04 / 目录筛选与共享卡片动效
日期：2026-11-08（Asia/Shanghai）
状态：实现、自测、独立review、隔离API集成与真实预览恢复验证通过；待用户业务／视觉验收

## 范围与版本

- 用户要求目录页参考本地React项目 `/Users/whisky/work/ownbus/test/` 的 `/catalog`，补齐筛选条件并将车辆卡片hover统一为现首页3D效果；需要后端支持时明确说明。用户所指 `http://localhost:5173/catalog` 已确认存在本地Vite监听，只读对照，不修改参考项目。
- 官网实际路由仍为`/{locale}/cars/`；基线HEAD fdf6c6b＋未提交FE-UX-03工作树（331文件快照943556…）。保护其他AD/BE/OPS改动和用户.vscode，本轮不自行提交／推送／公网部署。用户经PM新确认各端完成后由PM集成最新同版部署，已取代原fdf固定首发；本角色先完成可审结果和精确证据。开工hooks:check通过。
- BE已完成AD-I18N01冻结切换并释放旧3320只读窗口，但该运行副本不含本轮新view与筛选；本轮不向其发送新参数。FE先用3327独立fixture验证，待BE提供I18N02/FE04新服务窗口联调。3317原Rnlev进程待协调切换，新构建后不再将旧进程视作同版成品证据。

## 实际变更与接口依赖

- 参考实际条件：车号独立搜索、品牌／车型、代际、Fuel、Engine（选项实为2WD/AWD）、配置、价格／公里／年份上下界及Show，无排序控件。参考代际／驱动／配置固定空value，无真实处理；车牌随机选车、500ms假等待等不进入官网。
- BE正式契约已落地：trim/generation稳定ID、drivetrain枚举、priceMin/Max原币金额字符串+显式priceCurrency、mileageMin/Max整数、yearMin/Max年款，包含上下界验证，范围限制排除未知。后端真实全库筛选／分页／count由BE实现；FE不下载一页后冒充全目录筛选。q-only facets取得完整字典，FE仅按makeId/modelId级联元数据。priceCurrency无界限不限制原币，mileageMin=0有效。服务联调尚待BE新窗口。
- 已提取首页指针倾斜为shared UI能力，目录采用稳定外壳＋3D内层、同一旋转/光泽/图片反馈，并保留键盘、触屏、减少动效和卸载清理。layoutKey变化重置缓存边界，reduce隐藏光泽。独立源码增量review已关闭初审两个P3；最终浏览器证据另列。
- 筛选表单对应参考单列sidebar、独立搜索按钮、品牌/车型/代次/动力/驱动/配置及价格/里程/年款双列上下界；驱动不再误称排量。USD默认、CNY可选，保留API其他原币选项；无真实代次/配置/驱动选项时收起对应字段。品牌切换清车型/配置/代次，车型切换清下游；所有真实字段串通查询解析、BFF白名单、SSR、原生GET、history和分页URL，零下界不丢失。
- 按PM/BE统一I18N02接线，SSR/首页/目录/详情/收藏显式view=localized，严格要求display及requestedLocale匹配；同源BFF保留未传view的legacy兼容。使用后端投影的名称、所含项、位置和alt，不新建FE品牌字典，缺译不伪装已译。

## 验证与限制

- 已执行本轮官网check：763单元／7边界／类型生成与TypeScript通过；这是新增20项查询往返与本地化边界测试后的结果。生产构建通过（NEXT_PUBLIC_SITE_URL=https://cars.hongdingauto.com），尚不等于部署。
- 新增隔离richCatalog测试数据，覆盖不同原币/里程/年款/配置/代次/驱动；状态修改只发带health标记的3327，不访问真实库。第一轮51项Playwright通过后，review修复CF01/02/03并补回归，最终新成品104项全部通过（2.7m）：目录筛选10、目录动效4，以及home/home-motion、收藏抽屉/跨页收藏、公开目录/查询/限流/文案、详情七国内联预算。不是重跑全仓所有E2E，不用首轮结果替代修复后结果。
- 独立review三项P2均已修复并实测：model-only合法URL再次提交保留条件；超大金额小数不用浮点改变标签；根URL清除未Apply草稿同时重置受控/原生字段、币种和错误。本地化校验另补描述requestedLocale和详情路径语言；测试曾对null description错误准备，已改为构造非空反例后检查，最终check通过。
- 独立报告：[参考契约审查](审查-FE-UX-04-目录筛选参考与契约差异.md)、[共享动效审查](审查-FE-UX-04-共享指针动效初审.md)、[目录实现审查](审查-FE-UX-04-目录筛选实现.md)、[本地化公开接线审查](审查-FE-UX-04-本地化与公开查询接线.md)。目录/本地化当前无未处置P0/P1/P2，目录独立31定向单元、本地化34定向单元及6隔离观察由各Reviewer实际执行；两份机器审查清单与当前源码零差异。浏览器104由实现者执行，不冒称Reviewer运行。

## 同版API与域名集成

- 新官网build `o4zmY_V23uq7baAP_vlQo`，`NEXT_PUBLIC_SITE_URL=https://cars.hongdingauto.com`。完整standalone/静态文件复制至ignored `docs/private/fe-ux04-web-o4zmY_V23uq7baAP_vlQo`独立目录，1770文件manifest SHA256 `6584664a92a60d4593f5594551704ac8a5ace3e9384fdf331c9c298a3ed3bdea`。后续构建不再覆盖该物料。
- 官网源文件最终337份清单 `/private/tmp/hd-fe-ux04-final-scope.json`，SHA256 `5b6885d7c5a0de3eab329aa4f9738740b812b11dc5665b5beb3e75491647442d`；仅web范围，不能代替其他端审查或最终提交SHA。
- BE新API3342独立随机测试库/全合成四车，翻译provider disabled；FE独立冻结官网3343指向该API只读集成。15项结果观察保存在 `/private/tmp/hd-fe-ux04-integration/result.json`，已通过三语home2+2/list4/detail/facets、品牌catalog及配置/代次/驱动、USD/CNY不混币、已知零价/零里程、未知排除、年款、完整组合、draft404/坏参400/legacy兼容、JS真实查询与无JS、媒体原图/缩略图decode、canonical/hreflang/草稿域名。没有原库写入、翻译收费调用或真实消息发送。
- 第一遍集成在图片完成加载前同步检查naturalWidth误失败；单独await decode确认媒体可解码后，修正检查时机，同一成品完整复验通过。临时探针不是已纳入CI的永久套件。
- 实际指针光泽x≈70%/y≈30%、opacity1，动态切换reduce后光层隐藏且active清除。Chrome1440桌面/390俄文截图已人工查看，无横向溢出；截图在上述临时目录。Chrome触屏模拟不代表真机/Safari/所有浏览器实测。
- 实际取回英文首页/目录/详情HTML引用的15/13/16个CSS/JS全部200。正式canonical、hreflang和联系草稿使用cars子域；关于我们仍是公司主域。该本地验收构建索引开关关闭，sitemap为空且无localhost；生产启用索引需OPS使用正式域名和索引配置重新构建并检查，不能把本轮空sitemap当成生产完整索引测试。
- 3343已停止，3342只读窗口已交还BE清理独立测试库；合成数据不进入公开预览。

## 交接

- FE角色表和本日志持续更新；总进度由PM维护。前端文件自测后交独立只读Reviewer，真实API窗口和契约由PM/BE协调。


## 本地预览回归与修正

本轮首次build前未将旧3317运行目录隔离，是实现者遗漏。按PM要求最小检查发现旧Rnlev HTML200但引用的4个左右CSS/JS返回500，共享.next已覆盖，旧PID存活不等于成品有效。没有将其记录为通过，也没有直接把localized新版接旧3320。已停止拥有的旧PID68154，并按PM指示在3317提供简单503维护响应（无旧业务数据）；3318/3320及权威车辆库未改。新物料已独立冻结、3342/3343同版验证通过。真实3320的备份/新迁移/切换由PM安排BE窗口，待API受审新版本启动后，FE再从独立目录恢复3317并核对HTML、CSS/JS、BUILD和真实详情；此前不提供3317验收链接。

Git仍为fdf6c6b加各端工作树；本角色未提交、推送或部署。最终提交/推送检查与目标linux构建由PM/OPS在最新集成版本执行，不能沿用局部文件清单冒称最终SHA已验证。

收尾仅补apps/web/README的新筛选/本地化依赖及独立运行目录纪律，337文件清单因README更新为上述摘要；运行源码和全部独立审查文件未变，未因此重建或沿用不同代码测试。


## 真实预览恢复（最终状态，覆盖上面的临时503）

BE在PM窗口完成停写/备份/0003迁移与已审独立API切换，23:53:31报告新3320 PID94773可只读。FE随后停止自己拥有的3317维护PID71867，从独立冻结官网目录启动新3317，PID96943（session89158），BUILD仍`o4zmY_V23uq7baAP_vlQo`，API目标为原3320；没有重新构建或更改运行源码。

实际最小只读检查通过12项观察，结果 `/private/tmp/hd-fe-ux04-real-preview-result.json`：三语各9条同版localized车源，真实首页/目录/一个当前详情HTML均200，全部引用CSS/JS逐个200；三语各以当前车号明确提交筛选，结果唯一对应同车并成功进入详情，canonical保持正式cars子域，浏览器pageerror为空。此验证使用现有车辆数据，不发fixture控制、写库、翻译或真实消息。3317已恢复并保持运行，可进入`http://127.0.0.1:3317/zh/cars/`验收。

BE报告现有车辆generation/drivetrain全null，公开facets相应为空；界面会隐藏无实际选项的条件，后续后台录入并发布后自然出现。现有旧车model展示译文尚缺失，使用API明确的缺译投影，未自动翻译或改写事实；品牌由统一catalog按三语显示。这是存量资料状态，不是查询功能丢失。

README、FE角色与本日志已同步最终结果；模块维护文档同时纠正旧‘新服务器未提供／预算只链接／FE03尚实现中’三处历史措辞。Git/公网发布仍由PM按最终集成提交办理，本轮没有自行提交、推送或部署。
