# FE-UX-04：共享指针动效独立初审

日期：2026-11-08（Asia/Shanghai）

审查者：`/root/fe_ux02_reference_audit`；实现者：root。本轮仅审查共享hover子切片，不审本作者早前的统计/内联预算实现，不替代后续真实筛选契约和整合复查。

## 范围与结论

- 已重新读取AGENTS、接手导航、当前阶段、项目Skill、前端职责、动效维护和验证规范；hooks:check实际通过。共同HEAD仍`fdf6c6bc52b3a40761c4f991dde8e1f6a0fad028`，FE-UX-03与其他应用并行改动保留。
- 只读shared hook、home导入/原样式、目录list/card/CSS；纯脚本核源码搬迁等价与CSS，不访问3320/任何HTTP、不启动/重启服务、不构建、不跑浏览器或应用测试。
- 本初审未发现P0/P1/P2；两项P3为缓存边界及减少动效表现建议，已通知root。源码没有发现把倾斜当成关键业务入口、阻断链接或引入网络取数的问题。
- 本报告仅对应下表指纹。目录list之后还要接filters契约，其新版本必须增量复查；此处不批准尚未写好的筛选、后端契约、发布或新浏览器成品。

## 已核对证据

| 关注点 | 源码判断 |
| --- | --- |
| 迁移与首页 | 移除新增PointerTiltHandlers的type export并忽略文件尾空白后，shared hook运行代码与HEAD原home hook逐字一致。home改从shared导入，原vehicleSlot/vehicleCard/cardLight结构、1000px透视、0.025角度系数、1.02卡片/1.05图片和reduced规则保留，未引入业务模块对shared的反向依赖。 |
| 生命周期 | 每个PublicVehicleList只注册一个hook，不随每张卡分别注册全局监听；一帧最多一个RAF，切卡/离开/cancel/resize/wheel/blur/visibility和媒体条件关闭均reset，组件卸载取消RAF、移除全部监听和CSS vars/dataset。移动过程仅写DOM，没有逐像素React setState。 |
| 稳定参照 | cardSlot平面外层负责grid/高度；article内卡负责transform，坐标取parentElement矩形，避免读倾斜自身矩形引起原点漂移。card的min-width/height和flex/body结构保留卡片内布局，正常换active卡先reset旧卡。 |
| 键盘与点击 | focus capture仅在focus-visible时回正，不因鼠标点击链接的普通focus突然移动命中区。光层aria-hidden且pointer-events:none，收藏z-index3高于光层2，详情/标题/图片仍为原生链接、联系/收藏各自可点，无整卡大链接套内部按钮，也未新增preventDefault。 |
| 触屏与减少动效 | 只有(hover:hover)+(pointer:fine)且非reduce启用，事件还要求pointerType=mouse；触屏/粗指针回退静态。媒体change会reset；CSS末尾.card/.cardImage img的transform:none!important覆盖active规则，transition:none，避免仅靠JS门控。光层切换表现见P3。 |
| 条件重绘 | hook无车辆/查询副作用，不影响API freshness或导航；只有一个PublicVehicleCard消费者，已显式传handlers。普通相同DOM重渲染不主动覆盖imperative自定义属性；grid被条件移除但list还在时，ref可能暂留一个旧DOM，下一次reset/换目标/卸载会释放，最多已排的一帧写脱离DOM，不构成持续循环。缓存矩形变化见P3。 |
| 无JS与原业务 | SSR没有tilt-active，表单/车卡/联系和详情URL继续独立工作；新动效不改事实、金额、availability/freshness，也没有focus触发业务请求。 |

## P3建议与浏览器残余风险

1. `shared/ui/use-pointer-tilt.ts:65`–`72`只在目标node改变时缓存slot bounds。目录同id卡片因freshness段落/新DTO/新查询布局变化而保留DOM，且没有触发leave/resize/wheel时，下一次move仍可能短暂用旧矩形，视觉中心偏移；该行为继承原hook，目录条件重绘扩大了可达场景。建议新成品实测悬停期间资料/查询替换和离开后返回，必要时在明确结果代次/布局变化重置或重取平面slot矩形。本轮没有实屏证实抖动或点击失败，不夸大成P2。
2. `public-vehicles.module.css:463`的reduce末块仅处理card/img；新cardLight的opacity transition仍200ms。初始reduce时hook不激活光层，但悬停中改reduce会先由JS reset淡出，未像首页那样CSS直接隐藏。建议加reduce下.cardLight{display:none}，使两处表现一致，也给JS中断后的CSS回退。倾斜/图片变换本身已被!important禁用，不把此渐隐描述成3D仍在运行。

下一版真实浏览器至少核：目录一张/多张卡沿详情按钮边缘停留和点击、快速跨卡、离开复位、键盘focus-visible、hover中打开reduce、粗指针/触摸、wheel/blur/unmount、320px长俄文及换筛选/Back后同id复用。既有`details-hover.spec.ts`包含首页倾斜/焦点场景，但本初审未运行，旧FE-UX-03成品通过也不能代签目录新增行为。

## 本次实际纯检查

- `pnpm hooks:check`通过。
- 运行代码搬迁文本比对通过（仅新增type export/尾空白差异）；新目录CSS通过PostCSS解析，PublicVehicleCard引用的CSS类均存在。
- 指定hover相关tracked diff空白检查通过。没有跑tsc/Next typegen/build，避免与正在修改的filters契约混成整轮已通过；也未写产品或测试源码。

## 初审源码SHA-256

路径相对仓库根：

| 文件 | SHA-256 |
| --- | --- |
| apps/web/src/shared/ui/use-pointer-tilt.ts | 82aa22f21773bdcb14ede8e8336f8b8ed2909a6cfc7e5cf9eec6a6a723d4c3da |
| apps/web/src/modules/home/ui/home-page.tsx | 3db04c251feb0fd7327ca1ee5c76c16275773752495c881b83627afed9e8e82f |
| apps/web/src/modules/home/ui/home.module.css | 392606ec5ccc021d8e6fbfad47489191652392e9405684d653fa687c485601a2 |
| apps/web/src/modules/vehicles/ui/public-vehicle-list.tsx | 2d584a87d2e6d3a4471ad837761cd7b27b9930f324496a747fcb414a44a9c840 |
| apps/web/src/modules/vehicles/ui/public-vehicle-card.tsx | e316f50ee22389d61589695c3f38b554d42c3e77894fe077a203e845a6a52838 |
| apps/web/src/modules/vehicles/ui/public-vehicles.module.css | 125626d8b05a47e5266fbf94e1da92a1f201fc40bd3340bd72bc27352b7ccb97 |

原`home/ui/use-pointer-tilt.ts`为迁移删除，HEAD原件作为比对来源；不以其旧路径作为后续维护入口。共享角色摘要和主日志由root同步，本报告只记录独立审查结果。

## 初审后增量复查：两项P3源码闭合

root对初审建议作出修复后，本审查者继续只读核对实现及新增`catalog-motion.spec.ts`，不修改实现/测试，不启动应用或访问HTTP：

- 共享hook新增可选`layoutKey`及effect，在key变化时调用已有reset，取消排队RAF、清CSS vars/dataset及缓存target；下一次指针移动会重新测量稳定slot。catalog通过useMemo传`{data,phase,url}`，仅资源数据、状态或查询URL改变时重置，不因无关重渲染创建新key而持续打断hover；home传`section.vehicles`，新一批车辆会重置。原P3的目录同id条件重绘缓存风险已获得明确的资源代次重置，源码层面闭合，真实布局/时序仍待新成品验证。该版本已不再是“仅搬文件”——新增重置为有意行为变化；初审等价比对只适用于上表旧指纹。
- 目录CSS的reduce末块新增`.cardLight{display:none}`，与首页保持一致，且保留card/img的`transform:none!important`及transition:none。初审光层淡出P3在源码层面闭合；不依赖MQL回调先运行才能停止光层显示。

### 新目录动效测试的只读判断

新文件四项用例尚未执行，不将它们计为浏览器通过：

1. 正常指针用稳定slot的两端坐标驱动真实page.mouse，核active标记、DOMMatrix的旋转分量非零及X/Y双向符号变化；继续核光层存在、收藏不导航、离开回正及详情真实导航。它不是只断scale或直接给DOM加active来代替产品。
2. 详情按钮先等待倾斜，再通过真实hit test找到边界内点；停留期间核pointerleave次数为0及:hover持续，然后键盘Tab后显式focus并核回正。能捕捉原先按钮边缘闪烁类回归；显式focus不是完整键盘Tab顺序/OS焦点自动化证明，既有首页`details-hover`真实Tab场景仍需保留。
3. 独立hasTouch/isMobile与reduce两个context，核触摸/悬停后无active、旋转接近0、390px俄文无整页横溢出，finally关闭context；这属于Chrome模拟，不代表Safari真机。该测试源码不包含3320直连或消息发送调用。
4. 指针留在当前卡片，通过合成PopStateEvent触发资源刷新，等vehicles JSON200后检查active撤销且回正。可验证资源phase/data装配确会调用layoutKey重置；它是合成导航信号探针，不等价实际Back/Forward、BFCache或OS行为，也尚未构造真正改变卡片高度的响应。

测试门禁继续复用既有隔离helper（loopback/拒绝3320、suite健康身份后才控制fixture），默认Playwright配置3327/3100未改。测试源码未实现产品动效或修改CSS达到断言。当前光层用例仅确认渐变层存在，未分别断言其位置跟随/不拦点击的每个像素；悬停中切换reduce、wheel/blur/unmount及真正布局变更仍属于后续真实新成品覆盖项，不由源码复查代签。

### 增量检查与指纹

- 此增量只做指定tracked diff空白检查与更新CSS的PostCSS解析，均通过；没有运行tsc/Next typegen/build/浏览器/服务。先前hooks检查仍为本轮实际已执行记录。
- list/CSS已同时出现仍在制作的筛选/localized接线；本追加只审其hover布局key和相关CSS，不认为parser/BFF/filters/localized字段已交付定稿。后续集成需重新固定指纹并增量审查。

| 文件（相对仓库根） | 增量SHA-256 |
| --- | --- |
| apps/web/src/shared/ui/use-pointer-tilt.ts | 8b63e71bf5d0f4f67cb0614b9fec3533c683fd986740869d9d2c05a8b15489b1 |
| apps/web/src/modules/home/ui/home-page.tsx | a92b3e7bda212117d9e5d4315afb28f6b1c5872e5766a0b53eb5570221b81a3e |
| apps/web/src/modules/home/ui/home.module.css（未变） | 392606ec5ccc021d8e6fbfad47489191652392e9405684d653fa687c485601a2 |
| apps/web/src/modules/vehicles/ui/public-vehicle-list.tsx | 58e2fb220b805b9da609b8e42eb22131d3c7bb3a348f8fbb72bf147adc2d91e8 |
| apps/web/src/modules/vehicles/ui/public-vehicle-card.tsx（未变） | e316f50ee22389d61589695c3f38b554d42c3e77894fe077a203e845a6a52838 |
| apps/web/src/modules/vehicles/ui/public-vehicles.module.css | a891cf5ba25ad2fdf5fc16d9c2b35d580ebd29916a6cb0440f96dcb46117d58e |
| apps/web/tests/catalog-motion.spec.ts | 616748ffe6e8d40f8323c37bdf16e7d0563699db9ab2ac9b2aad0e44c513bd00 |

增量结论：上述hover修复未发现新增P0/P1/P2，初审两P3源码闭合；真实浏览器和最终筛选集成不在本结论内。

## 最终成品后的只读复核

root报告新成品`o4zmY_V23uq7baAP_vlQo`完成104项浏览器检查（其中目录动效4项、既有首页动效6项）。本审查者未运行这些浏览器场景；本追加只核当前源码/指纹、既有集成JSON及生成它的临时检查脚本，不操作服务或HTTP。

### 最终源码判断

- shared hook、home-page、home.module.css和PublicVehicleCard与上次复查SHA相同，layoutKey reset、稳定slot、MQL/监听/RAF清理、键盘focus-visible和鼠标点击处理均无后续语义变动。
- PublicVehicleList后续变化主要是localized schema/view装配、删除unused类型导入和排版；hover仍以memo化`{data,phase,url}`作为key，一list一hook，逐卡传相同handlers，没有改为随每次render抖动的新对象。
- 目录CSS已排版并加入筛选样式；本切片的平面cardSlot、1000px透视/0.025系数、1.02卡片/1.05图片、光层pointer-events:none及reduce的display:none/transform:none!important均保持。最终CSS再次经PostCSS解析，指定tracked diff空白检查通过。
- catalog-motion最终只把详情链接文案定位适配为`/View details/`，仍在当前卡片范围内选择链接；旋转符号、hit-test边缘零leave、收藏不导航、回正、触摸/减少动效与资源更新重置断言未放宽。合成popstate/显式focus的既述边界仍成立。
- 本次7个动效源码/测试文件的当前SHA均与`/private/tmp/hd-fe-ux04-final-scope.json`对应条目一致；清单337文件，清单SHA为`36532d43bba5c71a03db67629e06dd3afd77e94459b893f4b1bfdd1b2ffd59d9`。该比对只绑定本报告7文件，不扩大为审查全337文件。

### 合成集成记录的只读核对

- `/private/tmp/hd-fe-ux04-integration/result.json`记录上述buildId、API3342/Web3343、syntheticOnly=true、paidCalls=0及15条观察。没有连接原生3320或当前真实业务库；本审查者没有重新运行该集成。
- 浏览器观察记录light active=true，x约69.99999%、y约29.999998%、opacity为1，errors为空；生成脚本确实断言光层坐标/opacity，随后动态切换reduce，再断言active清除且光层checkVisibility=false。因此先前仅有“渐变层存在”单一测试的局限得到额外合成集成证据补充，不只依赖JSON中的布尔标志。
- 记录中首页/目录/一详情的实际引用CSS/JS分别15/13/16个，assetsAll200=true；脚本逐个GET并断言200后才写结果。没有把未请求的猜测chunk名作为故障，也不据此宣称公网资源或所有未来路由均通过。
- result及脚本中的联系草稿只检查参数，记录verified, not sent，不等于发送成功；三语筛选/投影部分由其他独立报告负责。本报告不重审税费公式、后端DB、筛选契约或所有本地化字段。

### 最终指纹与结论

| 文件/证据 | SHA-256 |
| --- | --- |
| apps/web/src/shared/ui/use-pointer-tilt.ts | 8b63e71bf5d0f4f67cb0614b9fec3533c683fd986740869d9d2c05a8b15489b1 |
| apps/web/src/modules/home/ui/home-page.tsx | a92b3e7bda212117d9e5d4315afb28f6b1c5872e5766a0b53eb5570221b81a3e |
| apps/web/src/modules/home/ui/home.module.css | 392606ec5ccc021d8e6fbfad47489191652392e9405684d653fa687c485601a2 |
| apps/web/src/modules/vehicles/ui/public-vehicle-list.tsx | 3658b816e090eab9670c121b085cbc362e0f78b28ee2d7150eb7984e8f05cf93 |
| apps/web/src/modules/vehicles/ui/public-vehicle-card.tsx | e316f50ee22389d61589695c3f38b554d42c3e77894fe077a203e845a6a52838 |
| apps/web/src/modules/vehicles/ui/public-vehicles.module.css | 590fb6e9ca1568be480c4dd8a778b65dc8cf380d0e4f2de8b426fa73c44e4d0d |
| apps/web/tests/catalog-motion.spec.ts | 937b433dde04352d4afbf9ecf9157f683fc89dd448bbf354275aefd02206b587 |
| /private/tmp/hd-fe-ux04-integration/result.json | 1aeadfe1fa25f398d0617a97a95fdd9bbc31568748b98766255f233d5ed2c951 |
| /private/tmp/hd-fe-ux04-integrate.mjs（只读，不执行） | 7a910a9d70faf6a76d390e73a95fec300c54ee0518c24cef6e1003eed1dfff75 |

最终动效子范围未发现新增P0/P1/P2，原两P3继续闭合。root的104项通过为其实际运行报告，本审查者没有读到独立保存的该轮完整终端日志，未据此冒称自己执行或独立重跑；15观察及相关脚本已按上文只读核对。Chrome模拟/本地合成证据不等于用户视觉验收、Safari真机、生产部署或全站全部功能验收。共享主日志由root同步最终同版结果；本审查者仅更新自己的独立报告。

## README收尾后的纯文档/清单核对

root仅补官网README的筛选/localized依赖与独立release运行纪律后，本审查者只读核对README、FE角色摘要、模块《首页与车源》及FE-UX-04主日志：

- 新337份app清单SHA为`5b6885d7c5a0de3eab329aa4f9738740b812b11dc5665b5beb3e75491647442d`，逐条重算当前文件全部匹配，无哈希差异。该动作是文件清单检查，不是运行应用或批准其他未审代码。
- 本报告7个已审动效源码/测试的SHA与上次最终表完全相同，README文档更新没有改变其运行语义；不因此重建或把另一成品的测试结果移用。
- README明确view=localized需要同版API与`0003_vehicle_localization.sql`，BFF legacy只面向省略view的调用方，官网不得悄悄接受无display旧DTO；长驻验收须复制完整standalone至独立ignored release，不依赖共享.next或只看PID/HTML200。迁移文件实际存在。
- 四文档共39个相对Markdown链接目标文件均存在（未发HTTP，未验证远程URL或所有fragment锚点）。FE-UX-04角色行及主日志明确3317临时503、待BE备份/迁移和受审API窗口后再同版恢复，没有把3342/3343合成验收或暂存release说成3317已恢复；本审查者没有请求3317或验证真实库迁移。
- 角色摘要中FE-UX-03“3317保留Node24.19”是历史阶段行；本次服务状态以更新的FE-UX-04行和主日志503为准，不据旧行发布验收链接。

### 文档P3待纠正

模块《首页与车源》仍有三处旧文字，已通知root，不改共享文件：第7行“新服务器另行提供”滞后于已提供新香港服务器的最新部署决定；第26行“预算栏只链接七国完整计算器”与已实现的真实内联预算及同文第37行矛盾；第33行仍将FE-UX-03称为实现/验证阶段，宜明确实现验证完成、待用户业务/视觉验收。均为文档事实/接手准确性问题，不影响337份app清单或原动效源码结论；修复后需追加模块文档新指纹。

| 文档 | 此次只读SHA-256 |
| --- | --- |
| apps/web/README.md | 18233ae7af95e88486efc0fa23b5323e87666039a3fde0d807dfcca6ee7c4cc0 |
| docs/协作/前端.md | 1529111d4565448c3e23b149e790fbccb691d1d814e4e65eb99d4aefbe2d37f6 |
| docs/开发/模块/首页与车源.md | 3b59f3c3d7f2440163b3214a048aed0db168c76349e91723b1a92ac913d4b562 |
| docs/日志/2026-11-08/前端-FE-UX-04-目录筛选与共享卡片动效.md | 87268b5256df398b1f1725089e5362f54f63a3bdc2785ae1cf5f58620817926b |

本追加未执行HTTP/应用检查/构建/服务/数据库操作，仅改自己的独立报告。真实API备份迁移由BE执行且尚未完成，不把文档审查作为其完成证据。

## 文档P3闭合与真实预览最终记录

本节记录后续新阶段，覆盖前一节当时“3317仍503／BE迁移未完成”的临时状态；不抹去原先检查时事实，也不将本审查者写成服务操作或浏览器执行者。

- 模块文档三处已实际纠正：明确用户已提供新香港服务器、预算栏已提供七国内联测算及完整工具、FE-UX-03实现/自测/review/限定集成已完成且待用户验收。前述文档P3闭合，没有为修文字修改产品或重建。
- FE-UX-04主日志新增独立“真实预览恢复（最终状态，覆盖上面的临时503）”时序节，说明BE先完成停写/备份/0003迁移和新3320释放，root再停止自己拥有的维护响应，从独立冻结目录恢复3317。角色摘要同步为真实预览验证通过、待用户验收；旧503段保留为历史过程，未与最终状态混写。
- root告知维护PID71867已停止、新官网PID96943保持同一build`o4zmY_V23uq7baAP_vlQo`，目标新3320。本审查者没有查询PID或发送HTTP，只按明确的执行者记录和下面JSON核对文档；不据此代签BE数据库备份/迁移过程。
- 只读`/private/tmp/hd-fe-ux04-real-preview-result.json`：buildId匹配，web3317/api3320/readOnly=true，12条观察；9条三语首页/目录/同一当前详情记录均HTML200、引用资源15/13/16且全部200；另3条三语记录均visibleTotal=9、explicitQueryAndDetail=true、pageErrors为空。该结果由root实际运行，审查者仅核JSON内容及文档对应关系，没有重跑真实浏览器/车号筛选或联系消息。
- 当前README及337清单SHA仍未变；再次重算337条当前文件全部匹配，7个已审动效源码/测试继续零变。不把真实预览恢复等同公网部署、Git提交或用户已验收。

| 最终文档/证据 | SHA-256 |
| --- | --- |
| apps/web/README.md（未变） | 18233ae7af95e88486efc0fa23b5323e87666039a3fde0d807dfcca6ee7c4cc0 |
| docs/开发/模块/首页与车源.md | b14d57dd113b1ef97390ba1e20dfa485d507712eec147cb2928b2c80b7405914 |
| docs/协作/前端.md | 01d7ffe9e445679dc5e58948d24a692d4734e1d232eaa94b13a1b2139816c69f |
| docs/日志/2026-11-08/前端-FE-UX-04-目录筛选与共享卡片动效.md | aca562912ae2bfb73a8b086024a79604cbdbe37810e22eda9713434b18d1e79c |
| /private/tmp/hd-fe-ux04-real-preview-result.json | ccabe52c074d7a56700bfe39ccaf929572066fc3dc8ffa6aa1ab2ce0c9ad7d59 |
| /private/tmp/hd-fe-ux04-final-scope.json（337条，未变） | 5b6885d7c5a0de3eab329aa4f9738740b812b11dc5665b5beb3e75491647442d |

本末次增量没有未闭合的文档建议；原动效审查结论维持。只更新本独立报告，没有产品/测试/共享主日志修改或运行操作。
