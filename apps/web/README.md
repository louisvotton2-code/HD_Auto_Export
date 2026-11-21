# 官网 @hd/web

FE-UX-03：Next.js Node／standalone 官网，首页、精选目录和详情通过 HTTP 消费 `@hd/contracts/public`。计算器与购车指南保留预生成页面；七国参考算法仍在浏览器执行。旧19条 mock 仅保留开发来源资料，不进入公开目录，旧演示slug不重定向到其他车辆。

## 本地开发与构建

从仓库根执行（按根`.nvmrc`选择锁定的Node24.19.0；依赖由当轮工程集成人统一安装，不并发改锁）：

```sh
pnpm hooks:check
pnpm --filter @hd/contracts build
pnpm --filter @hd/web check
NEXT_PUBLIC_SITE_URL=http://127.0.0.1:3363 SITE_INDEXABLE=false pnpm --filter @hd/web build
HD_DEPLOYMENT_ENV=local HD_RELEASE_ID="$(git rev-parse HEAD)" HD_SSR_SERVICE_SECRET_FILE='/absolute/private/ssr-service-secret' VEHICLE_API_BASE_URL=http://127.0.0.1:3320 pnpm --filter @hd/web start --port 3317
```

开发模式用 `pnpm --filter @hd/web dev --port 3317`；3317 仅为内部端口，用户统一通过 `http://127.0.0.1:3363` 验收。同一应用的dev／typegen／build必须串行，不能共写 `.next/`。**长驻验收服务必须先将完整standalone复制至独立ignored release目录，再从该目录启动；build会替换原目录，不能让旧进程继续依赖共享.next。** PID存活或HTML200不代表静态资源版本正确，切换后逐项检查HTML引用的CSS/JS及BUILD。`preview` 与 `start` 均启动本轮生产standalone，不再读取旧 `out/`。本地启动脚本只监听127.0.0.1，不能误将后台或API端口作为官网端口。

- `VEHICLE_API_BASE_URL`：**服务端**API origin，默认127.0.0.1:3320；不加NEXT_PUBLIC前缀，不带凭据／路径，不传入客户端props。SSR查询不使用员工会话。
- `HD_DEPLOYMENT_ENV` / `HD_RELEASE_ID`：所有实际Node启动显式配置。环境只允许production／local／test；正式版本只允许完整小写commit SHA（40–64位）或`sha256:`加64位摘要，本地／隔离测试可使用固定ASCII标签。缺失、非法或`unreleased`会在启动时退出，不自动生成默认版本。生产值由OPS绑定最终交付版本，不根据访客或公开构建变量生成；与正式API联调的本地环境也使用完整SHA。
- `HD_DEPLOYMENT_ID`：生产镜像构建传入最终合并提交的完整 SHA。Next 同时使用该值识别客户端版本和生成 `/_next/static/<BUILD_ID>/` 下的版本清单，使新旧清单可在网关保留。隔离构建可省略此值，使用 Next 的默认构建标识。
- `HD_SSR_SERVICE_SECRET_FILE`：与API一致、仅服务端可读的静态服务凭据文件绝对路径。普通文件、owner-only权限（例如0600）、32–256字节可打印ASCII，可含一个结尾换行；拒绝符号链接和过大文件。不要把值放入环境变量、浏览器、镜像层或Git。Node启动会核验；构建阶段不需要真实密钥。API原始socket peer白名单及公网`/internal`拒绝由OPS配置，完整协议见[车辆接口§19](../../docs/开发/车辆接口.md#19-be-rel-03-目录缓存与分页契约)。
- `NEXT_PUBLIC_SITE_URL`：公开官网origin，在构建时写入客户端草稿及metadata。实际域名或验收端口变化须重建；内部 3317 成品经 3363 提供用户验收；在其他端口隔离测试时 canonical／草稿仍指向构建时配置的 3363。
- `SITE_INDEXABLE=false` 默认禁止抓取和索引，地图为空。经批准的静态首批可在官网构建和运行均设置 `SITE_INDEXABLE=static`，只开放中英俄的关于我们与购车指南。此阶段的 sitemap 无需车辆名单，API 可保持 `PUBLIC_SEO_ENABLED=false`。完整模式使用 `SITE_INDEXABLE=true`，车辆资格与分语言名单由同版 API 提供。启用任何收录模式都须配置正式 `NEXT_PUBLIC_SITE_URL`；生产开放步骤仍由发布验收决定。

`.env.example` 是无凭据示例；真实环境文件不提交。当前不连接旧服务器或执行生产部署。

## 产物与运行

`output:standalone` 使用仓库根为outputFileTracingRoot。构建后的 `scripts/prepare-standalone.mjs` 把public和静态哈希资源复制到：

```text
apps/web/.next/standalone/
  apps/web/server.js
  apps/web/public/
  apps/web/.next/static/
  …所需运行依赖
```

完整standalone目录才是交付单元，不只复制server.js；配置上述必填服务端运行变量后，可在该目录内运行 `HOSTNAME=127.0.0.1 PORT=3317 node apps/web/server.js`。本机macOS成品已验证不代表Linux原生依赖兼容；生产镜像／目标平台构建、反向代理、TLS和恢复由OPS另行验证。本轮没有生成生产服务器配置。

静态回退：回退到已审查的历史静态版本和对应out成品；当前动态详情／API代理无法只切换output=export就工作。不可用旧out验收本轮接口，也不把历史静态部署指南当standalone部署步骤。

## 公开数据与失败处理

EXT07 目录显式使用 `projection=card` 与独立轻量 schema；首页／逐ID收藏保持详情兼容。完整图库仍按需分段，配置仅显示详情已有参数，不提供完整配置按钮或自动取全量。检测报告与价格历史通过正式公开独立有界资源明确读取；VIN、短来源编号、级别及出口状态只消费后端白名单。维护见[首页与车源](../../docs/开发/模块/首页与车源.md#fe-ext-07-展示与查询)。本轮本机只编辑，检查／Linux构建由OPS服务器隔离执行。

照片说明采用每图可选`altText`的实际语言／来源／审核信息；旧响应回退到匹配的`display.mediaAlt`或原alt，不推断人审。第四合同补片后必须重建相同合同的官网成品，不能用旧strict-schema bundle验收新API字段。

- `modules/vehicles/server.ts` 是仅供App服务端装配的公开入口；schema校验HTTP位于infrastructure。浏览器安全的 `vehicles/index.ts` 只导出展示能力，不能混入网络服务端配置。应用不导入API源码或数据库。
- 页面用request-time `connection()`，HTML外壳动态，车辆详情无需构建时枚举ID。FE-REL-03只对首页／目录／筛选／详情的匿名SSR DTO启用进程内有界缓存，HTTP仍`cache:no-store`；逐次内部版本核对、键与TTL规则见下节。metadata阻塞发送以保留真实404和demo noindex。持久布局的PublicNavigationFreshness只在用户Back／Forward时核对对应URL；focus、visibility和普通pageshow不请求数据。URL查询／明确重试走局部JSON，保留main、滚动、输入和图库；同URL新导航版本取代旧inflight请求，不能只按URL去重。
- 同源 `/api/v1/` handler只允许GET公开首页／目录／筛选／详情／媒体。目录q/品牌/车型/配置/代次/动力/驱动/原币价格/里程/年款范围及分页由服务端查询，浏览器增强使用JSON与原生history，未下载全库做本地筛选；q同时约束facets。媒体统一尾斜杠避免308，缩略图仅`?variant=thumb`，外链不改写。它不代理管理路径、不转发Cookie／Authorization／Set-Cookie或原始内部错误，媒体每次经API检查有效公开引用。
- 对外使用正式车源与服务文案。公开页面和咨询草稿不输出source类别、demo／第三方／未知库存治理提示；source和unknown仍保留契约事实，不改成可售或自有库存。历史样例已从公开数据下架，旧mock UI/查询不再从车辆公共入口导出，避免误接。未知年月／里程／所在地保持未知，待询价不造零，参考价与原币售价保留口径；完整公开描述以纯文本显示照片署名和许可。
- 无效顶层语言由轻量proxy返回完整品牌404文档，避免多root动态布局在无JS下只输出错误流；有效语言的未知车辆仍由route notFound返回404。详情API临时故障提供SSR可读重试页（页面200＋noindex，同源API保持503），不是404或成功车源。
- 已知继承缺陷FE-REL03-P2-01：有效语言的动态缺车／撤车虽然真正404且不泄旧车，无JS正文可能空白。PM仅接受它不阻塞REL03缓存候选，FE须在正式运营前修复；`tests/ssr-public-cache.spec.ts`保留单独expected-failure，关键HTTP／隐私断言在标记前执行，不把它计为通过。详见本轮FE日志。
- FE-REL-04为网关提供精确`/404/{zh|en|ru}/`完整三语错误正文（GET／HEAD 200、no-store／noindex，无API或车辆数据），与非法语言404共用`shared/lib/not-found-document.ts`。它仅是正文来源，正常200不能当作车页状态；OPS只在车辆详情HTML请求的真实上游404时取此正文并保持404，排除RSC／预取／API／员工预览和其他状态，组合验证后才记正式入口修复。直接Node的原框架限制和expected-failure保留，不加接口预查或更改SSR缓存。
- 空结果与服务故障分开显示；GET筛选／分页和SSR联系入口无JavaScript仍可使用，恢复API后可重新加载。详情提供真实多图、缩略图和可关闭查看器；无JS保留原图链接，未知／下架／删除不回落其他车辆。生产接待／真实消息发送不在本应用测试范围。

## 验证

### FE-REL-03 SSR DTO缓存

- `server.ts → infrastructure/ssr-public-api.ts`组合服务端读取；底层`public-api.ts`继续服务浏览器BFF、媒体和sitemap等no-store调用。缓存原语、版本／剩余TTL判断、受保护HTTP分别位于`ssr-dto-cache.ts`、`ssr-public-reader.ts`、`ssr-service-http.ts`，页面不实现缓存。
- 每次SSR先请求`/internal/public-catalog/version`，核验成功才读内容缓存。版本请求可传受信访客IP以执行每访客120/min；共享内容loader只用静态`X-HD-SSR-Key`，不携带Cookie、Authorization、访客IP或requestId。缓存值只含schema校验的匿名公开DTO，当前请求trace在读取后恢复。
- 全进程共用64项／16MiB（UTF-8键及JSON载荷）LRU，加载中键数也有界、同键并发合并。键含固定环境／release／API origin、规范化有效上游路径和查询、公开版本、价格视图及FX版本／到期时间。每次返回独立JSON副本。
- 最长15秒，按单调时钟扣除版本和内容读取耗时，不跨主机比较墙钟。不得超过API原始剩余TTL、FX或远图签名截止；命中不续期。版本不一致仅重试一次；未带正式stamp、错误、超时、版本检查失败和已过期结果不缓存、不回退旧值。
- HTML/RSC、BFF、媒体、POST、staff/admin及错误不进入这套缓存。整站HTML `proxy_cache`不在本方案中；哈希JS/CSS可immutable。内部GET只允许正式四类资源，公网不得代理`/internal`；真实网关、peer及API服务总30r/s＋burst40、DB/Redis故障和20并发由OPS验证。
- 目录offset上限10000（含），按实际pageSize计算，真实total不裁剪。分页省略号／末页限制在可达范围；合法超限深链接保留筛选并显示三语收窄条件入口，不报404。明显非法参数仍拒绝。API无光标offset与FE共用contracts helper。

### 2026-11-15 官网体验修订

- 本地修订：留空生产日期的六年区间、金额与汇率展示、详情英文标题、车辆识别信息排版、检测服务文案与首页目的国入口。
- 定向通过：104 项单测、TypeScript 和模块边界检查。本地 3317 的 10 项浏览器用例及隔离模拟车源的 7 项浏览器用例通过。布局检查覆盖 360、800、1100 和 1440 像素。已完成一次独立只读审查和增量复核。
- 同日复修：定位到历史逐月分支，统一详情与完整工具中的六个 1 月估算。3317 截图车源实测为 2021-01 至 2026-01，两个入口的金额一致。咨询编号卡收窄，320、390 和 1440 像素均验证了 VIN 完整显示及里程数字与单位同排，并覆盖接口允许的最高里程。复修的 87 项单测、12 项隔离浏览器用例、类型与边界检查通过，已完成独立审查。
- 附加修订：六年估算提示首句加粗并标红，年份下拉直接提供原有可选年份。首页汽车目录入口保留顶部加载进度和读屏反馈，修复附加图标及按钮变宽。27 项定向单测、类型与边界检查、2 项浏览器用例通过，3317 另核对了桌面和手机慢速目录导航及手机详情提示。独立只读审查无阻断。
- 区间结果同时列出最低和最高费用的生产月份、本币及约合 USD，明细默认折叠。已通过 37 项定向单测、类型与模块边界检查、4 项三语隔离用例和独立审查；3317 实测 320 像素可展开、费用相同时有提示。用户提供的车辆报告已返回 3 条结论和 6 条异常明细，顶层及四个分类的计数字段为 null，公开接口没有区分空值原因，保留原提示。
- 发布状态：本地验证，待 PM 集成验收和用户视觉确认。

### 执行检查

```sh
pnpm --filter @hd/web test:e2e
```

默认Playwright会启动3327内存fixture API和3100的最新生产成品，并创建权限0600的一次性服务凭据文件供两端使用、结束时清理；验证真实HTTP交互但不操作3320验收数据库。`PUBLIC_FIXTURE_API_URL` 只有专属loopback且health标记匹配才允许fixture控制；`E2E_BASE_URL` 指向外部服务时不会自动启动、生成密钥或变更它。当前缓存定向入口`tests/ssr-public-cache.spec.ts`；真实API、网关限流与故障联调结果另行记录。

当前架构／模块说明见[首页与车源](../../docs/开发/模块/首页与车源.md)。职责及实际进度见[前端任务](../../docs/协作/前端.md)，每轮证据进入集中日志；自测、独立review、PM联调和用户视觉验收分别记录。


## 访客身份与429（FE-UX-02受控增量）

`VEHICLE_API_TRUST_PROXY_IP`默认false，仅在OPS关闭web宿主直连、网关覆盖`X-HD-Visitor-IP=$remote_addr`的受控部署设为字面true。SSR/BFF只验证这个专用单IP字段，忽略浏览器原始X-Forwarded-For/Forwarded/X-Real-IP；合法IPv4/IPv6才新构造单值X-Forwarded-For给API。API只信固定web/32；空值、多值、端口或畸形值回退连接身份。不要在裸露的Next服务上开启这个开关。

公开API的429保留429和有界delta秒Retry-After，不再伪装503／零库存；非法或缺失等待值回退60秒。Home/Catalog并行SSR读取取所有429等待的最大值；首页／目录主结果与筛选字典共享同页等待截止时间，晚到的成功不能清掉另一请求新产生的等待。冷却内不发重复查询，到期不自动重试，由用户重试；首页字典失败可显式恢复车型/品牌入口，成功的同URL筛选选项在等待期间仍保留。无JS故障页保留原生重载入口，服务端仍执行限流。

首页客户沟通区提供购车服务问答。底部「联系我们」直接打开 WhatsApp，头部联系窗口用社媒图标链接打开站点配置中的相应账号。流程／咨询横轨上下预留悬停空间。计算器默认参考汇率保留来源日期、快照／手动／默认区别。

## 首页、收藏与配件（FE-UX-03）

- 首页「目录中的汽车」使用服务端取得的目录总数。配件数字与配件页共用 `src/shared/config/parts-catalog.ts` 中的目录规模，当前为 48,689。经营 23 年维护于 `src/modules/home/content/company-metrics.ts`。三项刷新后从 0 计数，减少动态效果和无 JavaScript 时直接显示终值。
- 车辆收藏为ID-only浏览器存储，统一首页、目录、详情及头部抽屉；最多100个ID，损坏／禁止存储时保留会话内存操作。打开收藏才读当前DTO；保留价格口径与已售／预订，不把收藏当实时库存。无账号、Cookie或自动消息。
- `/{locale}/parts/` 与 `/{locale}/parts/{slug}/` 由独立parts模块提供；44条静态参考资料及36本地素材集中管理，提供编号/名称、分类、品牌、价格筛选、排序、独立详情、数量咨询和本地配件收藏，不提供虚假分页／下单。未来API替换parts repository，组件不直接绑定供应商。当前配件页面noindex，参考价与适配/库存由客户咨询确认；维护见[配件目录](../../docs/开发/模块/配件目录.md)。
- 详情预算由app组合车辆公开DTO与calculator UI，车辆模块只提供budget插槽，纯calculator/index.ts继续仅导出核心。已知参数预填，制造年份不补成1月；缺失动力／登记／方向盘等保留空选择。内联使用明确标注、可修改的默认参考汇率，不在车辆请求或浏览器中新增外部FX请求。它调用同一七国核心和费用方法组件，不复制税率。
- 未指定生产月份时，独立工具和详情预算按当年和前五年各年的 1 月估算费用上下限。回溯更早的清关年份时，六年区间以该清关年份为上限。精确月份按该月测算。车源只有生产区间或年份时，详情仍展示原始车辆资料，两个计算器均按六个 1 月测算。旧计算链接和会话草稿中的生产区间不会覆盖六年场景。汇率输入聚焦时显示原始精度，失焦显示两位小数。费用显示两位小数，车辆挂牌价及约合美元取整，底层价格和汇率继续参与计算与筛选。详情与独立计算器均列出费用上下限的对应月份和双币金额，可分别展开明细。
- 详情标题与 SEO title 优先使用与车辆及其公开时间字段相符的英文公开投影，其他内容继续随当前语言。英文投影不可用时保留现有安全标题和语言标记。
- 完整工具入口使用受限版本化fragment传递编辑后的输入和所用汇率，成功读取后清除该seed、保留其余query/hash；有效显式seed优先于旧草稿，未知枚举刷新不回填成已知事实。所用快照随同国家会话草稿保存，保证Georgia等双币结果不因跳转／刷新更换口径；无seed独立进入时保留其他表单默认值和构建时快照。
- 当前验证、失败过程、独立review与版本见[FE-UX-03日志](../../docs/日志/2026-11-08/前端-FE-UX-03-首页统计收藏与配件.md)，不使用上一轮冻结或历史测试代替本轮结果。


## 目录筛选与本地化（FE-UX-04）

官网所有车辆读取显式使用`view=localized`，需要同版本API及0003迁移；不能把新版官网接入仍不识别该view的旧后端。BFF为旧调用方保留legacy省略view的兼容，但官网渲染不接受无display的旧DTO。平铺名称/位置/价格所含项/图片alt由API统一投影，品牌词典由contracts/API管理。

筛选共享`public-query.ts`解析、BFF白名单与`publicCatalogHref`；价格边界是精确十进制字符串+显式原币，不隐式换汇；0里程是有效值，年款为modelYear。代次/配置/驱动仅展示真实facets；品牌与车型变化清下游。无JS可原生GET，model-only链接不丢条件，清除也重置未提交草稿。首页/目录复用shared指针3D能力，减少动效/触屏保持平面。

验收入口为`tests/catalog-filters.spec.ts`及`tests/catalog-motion.spec.ts`；运行范围与独立review见[本轮日志](../../docs/日志/2026-11-08/前端-FE-UX-04-目录筛选与共享卡片动效.md)。源码、冻结成品、隔离API和真实车辆库的验收分别记录；临时合成资料不迁入公开车源。

### EXT09详情投影与部署版本

官网详情使用显式 `projection=detail-inline-v1` 和新严格schema，同响应有界检测说明／配置。旧无projection响应保持原结构；新旧响应不可共用缓存项，服务器先上双投影API再切官网。旧报告链接跳回详情`#inspection`。当前实现及接手约定见[首页与车源](../../docs/开发/模块/首页与车源.md#fe-ext-09-当前详情与交互)。

构建时由OPS注入 `HD_DEPLOYMENT_ID=<准确源码SHA>`，映射Next `deploymentId`；同一版本各实例必须一致。此变量不替代既有匿名DTO缓存的release identity。`?dpl=`仅用于资源cache busting，Next不据其路由；混版导航由Next检测后整页导航。OPS需保留当前／上版静态hash资源并平滑reload，不能只设置此变量就删除旧资源。无值的日常开发不制造部署编号。本轮没有变更依赖或共享锁文件。
