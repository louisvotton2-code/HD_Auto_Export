# FE-UX-04 目录筛选参考与契约差异（只读）

- 日期：2026-11-08，Asia/Shanghai。
- 审查人：`/root/fe_ux02_detail_audit`；本报告不是 FE-UX-04 产品实现的独立验收。
- 基线：HEAD `fdf6c6bc52b3a40761c4f991dde8e1f6a0fad028`，工作树保留前轮未提交改动。以下“当前”指本次实施前源码观察，后续契约/前端变更需另审。
- 任务：只读本地 `/Users/whisky/work/ownbus/test/` 的 `/catalog`，核对字段、依赖、单位、真实逻辑与布局，和本仓公开 API/DTO 对照；不修改产品源码、不运行参考脚本。
- 实际检查：开工 `pnpm hooks:check` 通过；读取源码/CSS，使用 JSON 解码器读取 mock-data 字面量以核验资料分布。没有执行参考 JavaScript、访问 3320/5173 或其他 HTTP、使用新原站浏览器任务、运行应用、构建、安装、提交或部署。只写本独立报告，不改共享角色摘要。

## 先给结论

参考的侧栏确实比当前官网多一组输入，但其中 **Generation、Engine、Trim 不能正常选择/不参与筛选**；车牌搜索是选一辆样本的假跳转；Fuel 的两个选项与实际数据不一致。它没有可选排序控件。不能把这些占位与缺陷复制到真实车辆目录。

可以还原的是侧栏顺序、紧凑下拉及双端区间、Apply/重置与 URL 恢复、真实公开事实的服务端筛选，以及用户明确要求的“和现首页一样的卡片倾斜”。当前 HTTP 契约只有 `q/make/model/powertrain/page/pageSize`，补范围条件必须由 BE/契约与 FE 同步落实，不能只对当前一页结果作前端筛选。没有 generation/drive 事实时，不应生成假代际或驱动选项。

## 参考字段矩阵

主依据：`test/src/pages/CatalogPage.tsx` 28–369 行，纯逻辑 `test/src/lib/vehicles.ts`。Catalog 内的注释提及“逐级解锁”，实际代码只有 **make 非空**这一层条件，未实现 make→model→generation→fuel→engine→trim 的完整级联。

| 顺序/控件 | 参考值与单位 | 依赖及提交方式 | 实际作用/缺陷 | 当前官网与契约差异 |
| --- | --- | --- | --- | --- |
| 独立车号输入 + Search | 文案 Search by car number；placeholder `12314567`，实际只接受 2–3 数字+韩文+4 数字 | 与 Show/其余字段独立；输入 ref，点按钮 | `PLATE_RE` 后用最后一个字符码 `% cars.length` 选择样本。没有牌照事实或检索；placeholder 本身不符合正则；假 “Car found” 提示与 500ms 跳转 | 当前 q 实际检索 HD stockCode、当前语言标题、品牌/车型 name。可沿用真实关键词结果；不能随机跳车、声称车牌已查到，也不能扩到内部 VIN |
| Manufacturer | 样本中唯一 brand，字符串字典序 | 始终可选；写 draft.make，Show 后应用 | 精确匹配 car.brand。换品牌不清旧 model/fuel，可能留下不兼容值 | 有 make 稳定 ID 字典/查询；当前换品牌清 model，优于参考，保留 |
| Model | 品牌下不同的完整 car.title，非稳定车型 ID | make 为空 disabled；只按 make 收窄；写 draft.model | 精确匹配完整 title，同一车型不同文本会被当不同“车型” | 有 model 稳定 ID 与 makeId；应保留真实 ID/依赖，不从一页卡片 title 提取全目录字典 |
| Generation | 固定 `1st generation` / `2nd generation` | 只依赖 make 非空 | `<select value="">`，没有 onChange，也没有 CatalogFilters 字段；固定占位，无有效筛选 | 当前 DTO/查询/字典没有 generation。必须有正式资料/契约才可生效，不能按年份或车型名推断 |
| Fuel & drive | 固定 Gasoline / Diesel / Hybrid / LPG | 只依赖 make 非空；写 draft.fuel；Show 应用 | 只精确比较 car.fuel，没有 drive。Hybrid/LPG 字面与样本不一致，会得到 0；Electric 没有选项 | 当前 powertrain 枚举更完整且稳定，包含 petrol/diesel/hev/phev/erev/bev/lpg/other/unknown。保留准确枚举，不退回错误字符串 |
| Engine | 固定 `2WD` / `AWD`；placeholder 还是 Select fuel and drive | 只依赖 make 非空 | 标签叫 Engine，值却是驱动；固定 value 空，无 onChange/查询字段，完全不生效 | DTO 有 engineCc，单位 cc；无 drive。不得把 2WD/AWD 当发动机，也不得从 transmission 推断 drive。若本轮做排量应由 BE 明确 cc 参数与字典 |
| Trim | 固定 Base / Mid / High | 只依赖 make 非空 | 固定 value 空，无 onChange；完全不生效 | DTO 有 nullable trim `{id,name}`，但当前公开查询/字典未支持；补真正 trim 查询及字典需要 BE，不复制虚构三级配置 |
| Price From/To | 两边均用同一标签数组：under 10,000,000；10,000,000–20,000,000；20,000,000–30,000,000；over 30,000,000 | 不依赖品牌；存 draft.priceFrom/To；Show 应用 | 比较的是 **KRW** car.krw，非 USD。From 只取解析 min，To 只取 max；From 选 under 不设下界，To 选 over 不设上界。未校验反向区间 | DTO 原币 money+asking/reference/on_request；无价格范围/排序参数。中国出口不得直接用千万韩元标签改标 USD。应先明确比较币种、金额精度、价格性质与跨币策略，缺价不算 0 |
| Mileage From/To | under 30,000 km；30,000–60,000 km；60,000–100,000 km；over 100,000 km，两边同数组 | 不依赖品牌；存 draft.kmFrom/To；Show 应用 | 比较 car.mileage（km）。与 Price 同样有单端标签不产生该端边界的问题；未校验 from>to | DTO 有 mileageKm nullable，无范围参数。真正范围由 API 对全目录 AND 比较，明确未知值处理，不能把未知当 0 |
| Year From/To | `car.year`（记录为 YYYYMM）取前 4 位、唯一、降序 | 不依赖品牌；存 draft.yearFrom/To；Show 应用 | 按字符串年度比较，不是月份精确比较；空年会进入选项。仅上界时空字符串可通过，属于缺失事实处理不一致 | DTO 明确区分 modelYear、manufacturedAt、firstRegistration；需要确定本轮筛选是年款还是制造年。不能用年款补制造日期/车龄 |
| Show | 36px 宽满侧栏按钮 | draft 与 applied 分开；点后设 busy，500ms 后应用，并把 p 重置为 1 | 对全量本地 100 样本筛选，不请求服务；固定等候模拟请求。正在 applying 时 disabled | 当前真实 form GET/客户端增强请求公开 API，回 page=1；保留真实 pending、429/错误/无 JS，不照搬固定 500ms 等候 |
| 排序 | 没有排序 select/按钮/查询字段 | 页面初始复制样本后固定排序 | 固定 `year` 字符串降序，随后 numeric id 升序；不是发布时间/价格排序 | 当前 API 固定 publishedAt DESC、id 稳定排序。新增可选 sort 是产品增强而不是漏抄参考，必须服务端契约化，不能客户端单页排序 |

### 参考区间解析的精确含义

`parseRange` 的 under 仅产生 max、over 仅产生 min、中间区间同时产生 min/max；应用时 **From 永远只读取 min，To 永远只读取 max**。例如 From=under 10,000,000 且 To 空，实际上不限制价格；To=over 30,000,000 且 From 空也不限制价格。里程相同。新实现可以保留双下拉外观，值应是明确的单端数值边界；不以参考文本解析器作为正式 API 参数。

### 样本分布核验（不是真实官网库存）

通过 JSON 解码而非执行脚本读取了本地 `window.MOCK` 字面量：100 个 car、62 个唯一 title；品牌为 Hyundai 43、Kia 44、KG Mobility 5、Genesis 3、Chevrolet 3、Renault Korea(Samsung) 2。它们只是观察参考逻辑的数据，不导入本次真实 API。

燃料字符串是 Gasoline 51、Diesel 21、Gasoline+Electric 16、LPG (일반인 구입) 9、Electric 3。所以参考 Hybrid/LPG 会筛出 0，BEV 无对应可选项。100 条中 **40 条 year 为空**；yearOptions 为 2026、2025、2024、2023、2022、2021、2020、2019、2018、2016、2015、2014、2012、2011 和空字符串。

参考 KRW 价格范围 3,940,000–67,100,000，另有独立捕获 USD 3,003–51,135；里程 5,178–289,973 km。不存在用本次实际汇率动态转换这两个价格字段的逻辑。

## 分页、URL、加载与无 JS

| 行为 | 本地 React 参考 | 当前官网/实施边界 |
| --- | --- | --- |
| 分页 | 本地样本每页 20，初始 100 条即 5 页；URL 只保存 `p` | API page/pageSize，默认 24、最大 48，total/hasMore 全目录同条件；不能改为下载全库 |
| 页码边界 | p 只 clamp 到 1–6682，未 clamp 到筛选后的 pages；超范围可空列表/错误页数；末页按钮可能重复 | 按 API 返回与 hasMore/真实 total；不要复制 6682、133,633 或样本页数 |
| 筛选 URL | make/model/fuel/range 只在内存 draft/applied，未写 URL；刷新不能恢复 | 当前 q/make/model/powertrain/page/pageSize URL 可恢复；新字段必须在 SSR、客户端、分页、Back、reset 一致保留 |
| 骨架 | CatalogGrid 以 page 为 key，重挂载后固定 450ms 6 张 skeleton；不是网络状态 | 按实际公开请求状态呈现，不新增固定延迟或遮掉整 main；数据失败不当 0 辆 |
| 数量 | DOM count 有 hidden，文字混合样本数与原站宣传总量 | 当前列表后有真实 exact 总数/unknown 语义；保留真实数量，不复制宣传总量 |
| 无 JS | 参考依赖 window.MOCK 与 React handler，无原生筛选提交 | 当前 GET 表单和分页链接可用；新增字段继续保留无 JS，增强失败不挡住基本内容 |

## 布局与卡片矩阵

依据 `original/components.css` 717–987、1089–1308 和 `original/pages.css` 885–903。以下是源码对照，不是本轮浏览器像素/动效验收。

| 项目 | 本地参考 | 当前官网 | FE-UX-04 接线注意 |
| --- | --- | --- | --- |
| 容器 | max-width 80rem（1280px），上下32px；默认 gutter，>=640 留白24px | shell1280，24px/手机16px，上32px | 已基本一致，保留固定头部偏移与 main/H1 语义 |
| 主布局 | <1024 单列；>=1024 左3fr右9fr；gap24px | 同断点，左 minmax(220px,3fr)/右9fr | 参考 sidebar 无 sticky；不要未经依据改为覆盖页面的弹层 |
| 侧栏 | padding16，flex-column gap4；label14/600，上下8/6px | padding24，grid gap20；手机筛选两列 | 补齐字段后可按参考纵向紧凑组织。手机参考仍是整列，不是当前两列表单 |
| 下拉/范围 | select高36px、圆角6px；左右range gap8px、各flex1/min-width0；range下方28px再有2px分隔线 | 现仅普通 select/input | 保留显式可访问 label/单位、下界/上界读屏名称、错误提示，不复制参考缺少 label 的问题 |
| 车辆网格 | <640单列，>=640两列，gap20；min-height80vh；align-items:start | 同列数/gap，卡片有两行标题与底部对齐 | 需要 equal-height 稳定外壳，不能为倾斜让卡片布局/按钮命中区域跳动 |
| 媒体/卡片 | 图16:10；铜色淡背景与细边，圆角；图hover scale1.05 | 图16:10；hover translateY(-4)/scale1.035 | 本地参考 CarCard 无 JS rotateX/rotateY/tilt。用户本轮要求“同现首页”优先，复用现首页3D而非降级为参考纯缩放 |
| 动作 | TG/WA两个44px按钮+Details44px，原CSS按钮hover上移2px | 两联系36px+Details36px，已有避免闪烁处理 | 保留真实 HD 草稿、独立锚点与焦点；不要重引入按钮位移导致边缘闪烁 |
| 已售 | 样本 sold 标记、灰图、历史 KRW 价、仅TG类似车 | 真实DTO状态、价格性质、TG/WA、联系禁用遵循freshness | 不把 unknown 变已售/可售，不复制“已含韩国停车费”等本站未确认价格说明 |
| 分页外观 | 左对齐44px方钮，当前/下一页/最后页/箭头/页数 | 居中、previous/current/next，真实hasMore | 可以调整视觉，但页号与按钮必须根据真实契约，不写假尾页 |

### 卡片倾斜的工程落点

现首页 `home/ui/use-pointer-tilt.ts` 已具备细指针/减弱动效判断、稳定 parent bounds、每帧一次 DOM 写入、离开/取消/滚动意图/失焦清理；overlay 不截获点击。当前 PublicVehicleCard 没有该 hook/稳定外壳，仅 CSS lift/zoom。跨业务模块不应直接深导入 home 内部：根集成人可将纯展示 hook/共用规则移至 shared，首页与车辆目录分别接线。

需要在新成品验证：卡片中部与四角倾斜、详情按钮四边慢移/点击无闪烁、两个联系人与心形各自可操作、键盘 :focus-visible 回平、mouse leave/blur/resize 回正、触屏/粗指针与 reduced motion 不倾斜、长俄文与价格保持等高且不横溢。不把源码复用或单元通过当成连续帧已验。

## 当前 HTTP/事实差异与必须协同的入口

1. **已有事实、缺查询**：`mileageKm`、`modelYear`、`manufacturedAt`、`firstRegistration`、`engineCc`、`trim`、`transmission` 都在 nullable facts 中，但不代表当前列表支持这些筛选。先明确年份口径和上下界的包含性，未知值保持 null，不算 0。
2. **事实本身缺失**：DTO 没有 generation 或 drive；transmission 是变速箱，不等于驱动；powertrain 不是驱动。若产品要求这两项实际生效，应由 PM/BE 先定义数据与录入/公开契约，不能根据 title 关键字、年款或品牌猜出。
3. **价格口径未约定**：正式 DTO 保留 asking/reference/on_request 与原币 money；当前无跨币统一比较键。需明确筛选/排序按指定原币还是可靠换算后的统一币种，并明确快照/精度/缺价处理，不能把 USD 标签与 KRW/CNY 数值混用。
4. **全目录由服务端处理**：`InventoryService.listPublic` 当前对 q/make/model/powertrain 做 AND，在同一事务条件下 count 与分页，固定 published_at DESC/id。新条件/排序必须同步该全量 SQL、schema、过滤字典及隔离验证，不对 items 做局部过滤后冒充全目录。
5. **官网全链路**：不仅增加 form 控件；还需同步 `public-query.ts` 输入白名单与类型转换、`publicCatalogHref` 显式序列化、form submit/native GET、PublicVehicleList 资源 key 与 facets URL、API adapter 参数、BFF allowlist 与 schema 校验、SSR route 装配及查询 key。现 facets 只按 locale/q 查询，make/model依赖由现有真实字典的 makeId 表示；扩展字典维度需要明确新契约。
6. **URL/网络生命周期**：保持 page=1、当前页、Apply/reset、Back/Forward 与原生 GET 一致；使用 Next 原生 History API 的 null state 约定，避免再把 __NA 传回绕过 URL 订阅。取消 focus/visibility 被动请求、同页共享 429 冷却、请求去重/取消及不恢复已删除旧车的边界不能随筛选扩展丢失。
7. **未知参数不等于已支持**：当前 SSR parseCatalogQuery 只读取旧字段，未知范围字段可能被忽略；浏览器 BFF 则会拒绝其未知参数。仅拼一个新 URL 或渲染控件，不证明条件已经送达 API。跨端契约是本轮的实际依赖。

本报告没有授权修改 BE/公共包，也不替 PM 决定不存在的代际/驱动资料；由根集成人根据真实能力划定当轮范围并和 BE 协调。正式实现完成后需另做独立审查、新 standalone 成品和对应 API/无 JS/三语集成验收。

## 观察文件指纹

以下哈希固定本次只读观察对象，**不是 FE-UX-04 待提交实现的批准清单**。本仓文件继续由各实现者维护时，矩阵应按新版本复核；本地参考始终不修改。

| 观察文件 | SHA256 |
| --- | --- |
| `/Users/whisky/work/ownbus/test/src/pages/CatalogPage.tsx` | `8ada5f8102cad6c871f22aeebad5f42542dc5e86bda20fef19755f6494e444d4` |
| `/Users/whisky/work/ownbus/test/src/lib/vehicles.ts` | `6f041e9837c8b5c2b5e5156dcdca95666bee1d7468295b26ab883c3d0999dc29` |
| `/Users/whisky/work/ownbus/test/src/data/types.ts` | `66795719f801e6bd8ba774fd4e2037ea3b0875d0c657bfb471d205837793dfa9` |
| `/Users/whisky/work/ownbus/test/src/data/index.ts` | `29973633fe97daade9531ab7fd664052ac96f4f6842cca14eedfcc3c3429297b` |
| `/Users/whisky/work/ownbus/test/src/components/cards/CarCard.tsx` | `d1ce21f1e8364846591d259d79504c3b7dd27abbafb63b79e224fbd2f5af5897` |
| `/Users/whisky/work/ownbus/test/src/styles/original/components.css` | `037167f1b92a2aee81ac7a40ffbd54a4cfae36cca4469ce386883f8d4ef3b938` |
| `/Users/whisky/work/ownbus/test/src/styles/original/pages.css` | `1b47caab8cae0f3a1019e5e04f9240c6ee62050c497cc03bf2bbca6c8599b35a` |
| `/Users/whisky/work/ownbus/test/public/js/mock-data.js` | `f1c09f484dd131c68d2e03ca812a6964a848000425dae09e816a296283fc506e` |
| `apps/web/src/modules/vehicles/ui/public-vehicle-filters.tsx` | `2c30d01fae335f84b1556a3258c9b17f8279e23631cfef9f809890778200fbd0` |
| `apps/web/src/modules/vehicles/ui/public-vehicle-list.tsx` | `66f85f60dbc83690bae39ad03169c0a486de956481f8f6b5da654121f732b4e9` |
| `apps/web/src/modules/vehicles/ui/public-vehicle-card.tsx` | `8f1b326f1f7ce92ffa042f7af2943601181c3be411b6e7fff5c66ce1ebc17fde` |
| `apps/web/src/modules/vehicles/ui/public-vehicles.module.css` | `ff2dcad87448609f86dbe1e1b0e6d74e70182689f50654cda884343d15299571` |
| `apps/web/src/modules/vehicles/public-query.ts` | `a2ad69df8b652410d8f4fa93d0210bb073b844f33276b0065b378f82cda70e02` |
| `apps/web/src/modules/vehicles/public-presentation.ts` | `a0493fb73f461cf6bc291005d08188f00fe91fe196fc4855de3121f0527a124f` |
| `apps/web/src/modules/vehicles/infrastructure/public-api.ts` | `e2564e5a1c1ce8dd53f4416e7b9e136ced9d348cb6b55945b6143767c73c5104` |
| `apps/web/src/modules/vehicles/infrastructure/public-proxy.ts` | `3b0a6099920f22d75afe19d51a815695717defd29e623a47c559e2afc7175315` |
| `apps/web/src/modules/home/ui/use-pointer-tilt.ts` | `9f56d01bdd31fe2a11227095f0f32af6f047bcb4e3b1dd1eebe8104cb7c2273d` |
| `apps/web/src/app/[locale]/cars/page.tsx` | `96bd500ec5d6cc165b75093aed58584aefaca5c9408dc4ec537885942995659e` |
| `packages/contracts/src/public.ts` | `9cf82e7d0ea7fd06d95dea05d76fd06c1e2b120dd724d402b424694903f6a8af` |
| `packages/contracts/src/common.ts` | `cfbdc352c77b6350c5a0b1cb5776350518baf4e8937bc03a8fa692d0323c8cef` |
| `apps/api/src/vehicles/service.ts` | `3e9a4d30e5d9b6d907608c88d75b45b03c51285a4cc688e7189593cfa429f922` |
