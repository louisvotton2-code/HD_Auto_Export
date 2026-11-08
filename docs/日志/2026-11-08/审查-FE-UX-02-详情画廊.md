# 独立审查 / FE-UX-02 / 详情与画廊

日期：2026-11-08（Asia/Shanghai）

Reviewer：`/root/fe_ux02_reference_audit`（不是本切片作者）

任务：PM-INT-03 / FE-UX-02

最新结论：首轮 **2 项 P2 与 root 补充的 1 项 P2 已由原作者修复，独立源码复查通过**（见文末新 hash）；最终测试增量已补齐加载完成态断言，本范围未发现未处置 P0/P1/P2。运行验收由 root 另行执行，自动化触摸/时间边界等证据限制仍保留。此结论不是浏览器、跨端、用户视觉验收或整轮推送审查。

## 版本、范围与实际检查

- 共同 HEAD：`61dc7414b20a395d1d09e906a49d974763b3cce7`。待审五文件为共享工作树中新实现，以以下 SHA-256 绑定，不把 HEAD 当作包含实现的提交。
- 原作者在本轮读取过程中完成了图库出场动画更新；下表是其明确冻结后重新读取的最终首轮快照。
- 仅审查下列五文件。为核对公开字段，补读了 `public-presentation.ts`、`shared/lib/public-media.ts` 和 `packages/contracts/src/public.ts` 的相关定义；没有扩大审查 root 仍在施工的 `PublicDetailResource`、共享 freshness hook、API/媒体服务实现或全站导航。
- 开工 `pnpm hooks:check` 实际通过。Reviewer 执行了三个 TS/TSX 的 TypeScript 内存语法解析、两份 CSS 的 PostCSS 解析，均通过；这不替代类型检查或运行测试。作者报告纯 `tsc` 通过属于作者自测，本报告不冒充 Reviewer 已重跑。
- 未修改待审代码、未构建/生成 Next 类型、未启动或重启服务、未运行浏览器或接口验收、未提交/推送/部署。唯一写入为本报告。

| 待审文件（相对仓库根） | SHA-256 |
| --- | --- |
| `apps/web/src/modules/vehicles/ui/public-vehicle-detail.tsx` | `70913dddb8d898a080b70161d9bc917a1101ac64211ec3c8a421b88ade573681` |
| `apps/web/src/modules/vehicles/ui/public-detail.module.css` | `14a6383598f8f58ed212b170b27dd338f359cdd71f4f06890db5a9422ce66bf1` |
| `apps/web/src/modules/vehicles/ui/vehicle-gallery.tsx` | `0d3425361c086f035c6943a9718fa2630821bca41df824d9e907178adb5024c4` |
| `apps/web/src/modules/vehicles/ui/vehicle-gallery.module.css` | `0d83ed4adc1be1240067b90a5cca95221b117e18dd0f77aa5be34b127d61076c` |
| `apps/web/src/modules/vehicles/detail-content.ts` | `d75c2af61e619b5f41508b73ce58e1437c02132f6b2965cb4eafebea7b19b333` |

## 发现

### P2 / GAL-01：快速往返切图会保留无法结束的加载状态

- 定位：`vehicle-gallery.tsx:74–88` 的 450ms outgoing 图片保留与无条件 `setLoadingId(image.id)`；同文件 `162–175` 按图片 id/retry 复用 `<img>`，只有 active 图片绑定 load 回调。
- 条件：A 图片已完成加载，切到 B 后，在 outgoing A 尚未卸载的 450ms 内切回 A。React 继续复用相同 key 和 src 的 A 图片节点，因此它不需要重新加载，也不会因变回 active 再发一次 load 事件；但是 `choose()` 已把 loadingId 设置为 A。
- 影响：A 已显示却持续出现“正在加载”、`aria-busy=true`；正常停留不会自动结束。快速箭头、缩略图往返或滑动均可能触发，尤其缓存命中时容易观察。
- 建议：用图片 id + 实际 URL/重试版本记录已完成状态，或在切换后读取对应 img 的 `complete/naturalWidth`；事件按具体图片归属处理，避免旧请求清除新图状态。保留出场图时不能假定 active 每次变化都会产生 load。
- 复查：加载 A 后在 450ms 内执行 A→B→A、连续左右键和缩略图往返；等待后确认图片/计数正确、loading 消失且 aria-busy 为 false；同时检查慢图、失败图、重试、弹层切换和快速乱序事件。
- 已向 root 和详情作者同步；作者已确认问题，待其统一修复。

### P2 / DET-02：手机视觉顺序与键盘/读屏顺序相反

- 定位：`public-vehicle-detail.tsx:72–98` 中 DOM 先放预算 aside，再放主内容；`public-detail.module.css:410–424` 在 <=1023px 用 CSS 把 mainColumn 排第一、budget 排第二。
- 条件：手机或窄平板，使用键盘 Tab 或读屏顺序浏览。
- 影响：离开顶部返回链接后，焦点会先进入视觉上位于车辆资料下方的预算国家选择/计算器链接，再跳回上方分享、图库和规格，顺序不随视觉单列顺序调整。无 JS 预算链接同样受影响。
- 建议：DOM 按手机主内容→预算→询价的阅读顺序排列，桌面用明确 grid-area/grid-column 等方式恢复左320 / 主栏 / 右360；不要通过正 tabindex 或复制交互控件修补。
- 复查：在 390/768/1023px，Tab 从返回链接开始应依次经过主内容操作/图库/规格、预算、询价；读屏标题/地标顺序一致。1280px 仍为三栏，1024–1279px 隐藏预算且无隐藏区可聚焦元素。
- 已向 root 和详情作者同步；作者已确认问题，待其统一修复。

## 已核对的实现边界（源码层面）

| 检查项 | 首轮源码观察 |
| --- | --- |
| 图片与顺序 | 从公开 `images` 拷贝排序，封面优先、其次 sortOrder；没有修改 props、重复封面凑数量或未知ID回落第一辆车 |
| 原图请求范围 | 初始只放 active 原图；切换期间额外保留刚访问的 outgoing 图，450ms 后清除；未访问图片原图只作链接。API 媒体缩略图走固定 thumb 变体，外部没有缩略图契约时显示编号，未把全部外部原图塞进 img |
| 无 JS | SSR 中主图和所有图片入口为真实原图链接；增强箭头、打开弹层按钮只在 enhanced 后出现。浏览器未运行，实际无 JS 导航仍待验收 |
| 弹层 | 使用原生 dialog/showModal；关闭按钮、原生 ESC→close、backdrop 点击关闭；close 后尝试回到 opener，节点不在时回到打开按钮。原生焦点限制及真实关闭事件须在浏览器验证 |
| 状态清理 | opened effect 记录并恢复 body 原 overflow，组件卸载会 cleanup；动画定时器与 action 状态定时器有 cleanup。多 overlay 并发不在本切片验收范围，需共享壳层集成时检查 |
| 键盘/触摸/减弱动效 | 左右键处理带 preventDefault/stopPropagation；touch pointer 阈值与方向比，cancel 清理起点；swipe 后抑制立即误开大图；CSS 遵循 reduced-motion。实际手机触摸、pinch、滚动和连续操作待实测 |
| 布局 | 源码含1280三栏、1024两栏、1023单列最终规则；图库16:10、24px圆角、42px箭头、4:3缩略图；手机顺序缺陷见 DET-02。不能以这些静态值宣称像素还原已验收 |
| 外部/演示车源 | external 明示第三方与未核实，不声称自有现货；demo 有样例说明；来源链接新窗口含安全 rel；价格继续用契约原币种与 asking/reference/on_request 展示，不造0价 |
| 车辆事实与预算 | 日期与modelYear区分；未知参数走 unknown；没有硬编码 VIN/韩牌/车况。预算只选择目的国并打开完整计算器，明确缺失费用不作0，不在详情复制韩国公式或制造完整落地价 |
| 库存freshness边界 | 本组件读取 root 公共 freshness 状态；其刷新、404、历史恢复等逻辑正在另处施工，本文不对其正确性作结论 |

## 交接

首轮交接时，详情作者负责修复 GAL-01、DET-02，再交五文件新 hash 给 Reviewer；其后复查结果见下节。root 集成后需跑真实浏览器多图/缓存/失败/无 JS/触摸/键盘/焦点与320px长俄文，另核对外部详情和已售/删除状态。

当前不将本报告登记为最终 SHA 的推送前 pass；没有实际待推送提交，也没有完成这些运行验收。未处置 P2 的接受人/计划须由 PM 明确记录，不能用“未发现 P1”替代处理。

## 修复后独立复查

原作者报告三项修改完成并冻结后，Reviewer 重新读取实际文件，复核如下。三项修复均落在详情切片中，没有由 Reviewer 代修。

| 项目 | 当前源码与结论 |
| --- | --- |
| GAL-01 快速返回持续 loading | `vehicle-gallery.tsx:21` 按 id + 规范化 URL 识别资源；`55–56` 缓存已载入/失败状态；`83–89` 用当前 img 的 complete/naturalWidth 处理 SSR 提前载入和复用 DOM；`99–101` 根据资源状态设置 loading；`146–167` 事件按具体资源归属更新，重试清除该资源缓存。原来的 A→B→A 无 load 事件路径现有完成状态兜底。源码复查通过，运行回归仍需检查 loading 真正结束。 |
| DET-02 手机顺序 | `public-vehicle-detail.tsx` DOM 已为 mainColumn（73）→budget（191）→side（216）；`public-detail.module.css` 明确命名 grid-area，桌面为 budget/main/side，1024–1279为main/side，<=1023为main/budget/side。移除了逆向 order 修补，手机阅读/Tab 顺序与视觉一致。源码复查通过。 |
| GAL-03 滑动后显式打开按钮被误拦（root补充） | root 在320px实际操作中发现旧 `openViewer` 的450ms误触保护也吞掉独立 Open 按钮。当前 `vehicle-gallery.tsx:106` 仅当 currentTarget.tagName 为 A 时拦截滑动后的主图链接误触；独立 button 直接进入 showModal。源码复查通过；root的原始现场观察与此处静态复查分别记录，不声称 Reviewer 亲自重现该现场。 |

### 修复快照 SHA-256

| 文件 | 新 SHA-256 |
| --- | --- |
| `public-vehicle-detail.tsx` | `46057a6a9b65b92da9f516584cb1d1e7e1490cbfa44c67965b1b5d10dbf4b5e1` |
| `public-detail.module.css` | `005d1d42e0d4a97924ade25a7d07a3671ba05cc3cee46490c7b0d5ff0e35ddb7` |
| `vehicle-gallery.tsx` | `17e004401fbf2d3919e93076cee0a3d16650710fcd2bd7702e545bd7996d98f1` |
| `vehicle-gallery.module.css` | `0d83ed4adc1be1240067b90a5cca95221b117e18dd0f77aa5be34b127d61076c`（未改） |
| `detail-content.ts` | `d75c2af61e619b5f41508b73ce58e1437c02132f6b2965cb4eafebea7b19b333`（未改） |

Reviewer 复查时重新执行两个修改 TSX 与新增测试 TS 的内存语法解析、详情 CSS 解析，以及 fixture 的 `node --check`，均通过；没有运行 Next build/typegen，也未重启任何服务。作者的纯 tsc 与 root 的浏览器运行结果需在各自日志中另记。

## 附录：库存刷新与媒体测试的只读审查

范围为 `apps/web/tests/public-freshness.spec.ts` 与 `tests/fixtures/public-api.mjs`；补读其 `helpers/public-fixture.ts` 与 Playwright 启动配置以核对隔离，未改测试、fixture 或配置，也没有重复启动正在3100/3327运行的隔离环境。

| 文件 | 读取快照 SHA-256 |
| --- | --- |
| `tests/public-freshness.spec.ts` | `cc63101b58c5842ada97437e50331c3726d8716045c8ddf3e75fc09f6008de1d` |
| `tests/fixtures/public-api.mjs` | `5df44a713906e155ad86911285f0909debf73fd36ccc2ad7f60aed5d29b0ffc7` |
| `tests/helpers/public-fixture.ts` | `e5923415d8df403cbb6082bf2f506a5af68e04e5d37eb04d5d603598dc37a3fc` |
| `playwright.config.ts` | `52721b109b42f4eaa68e19e6f510ee462397ed31aa25bcd2e64eb1ac53d845b6` |

- **隔离检查通过（源码层面）**：spec/helper 的控制目标只接受 HTTP loopback、拒绝3320、认证信息及额外 path/query/hash；执行 reset/state 前核对 health 的精确 suite。fixture 启动函数及 CLI 再次拒绝3320、固定绑定127.0.0.1，状态只在内存；无数据库、业务应用内部源码或真实账号依赖。Playwright 默认3100官网→3327 fixture，reuseExistingServer为false；外部只读运行未指定fixture时跳过可变状态suite，控制请求不会回退到实际API。
- **实际产品断言**：通过页面原有表单/选择/分页、BFF JSON请求、URL/返回、正文/壳层DOM稳定、联系入口失效/恢复、已售/归档/unknown、来源身份、图库键盘/弹层/无JS/媒体响应头观察产品行为。测试没有向产品注入“实现本应存在的功能”的代码；page.route仅用于阻断/失败注入。fixture 在本地数组执行查询是隔离服务器模拟，不能以它证明真实数据库 SQL 或真实供应商接入已通过。
- **模拟边界有明确说明**：`focusAndVisible` 明写通过 dispatchEvent 探测事件处理器和请求合并，不能称真实OS切换窗口/浏览器标签验收。320px用CDP touch事件，是Chromium自动化触摸输入，不是iOS/Android真机、真实手势或真实移动网络。无JS上下文是真实禁脚本配置，但目前只核对原图链接属性，未实际打开原图新标签。
- **P3 / TST-01 覆盖建议（已通知 root）**：图库快速左右返回用例当前只断言 selected-image，未断言 data-loading=false 或“Loading photo”消失，因此首轮 GAL-01 也可能通过该场景；建议补充这个完成态断言。320px滑动后Open用例正确使用独立按钮，但若各步骤耗时已超过450ms，它不能单独证明误触窗口内的 GAL-03 回归，需要以明确受控时间的handler用例或root现场证据补足。不要把无时间限定的测试通过写成已验证450ms内操作。
- **运行状态不代签**：root 表示完整181项在隔离环境跑；本 Reviewer 未执行该测试运行，本文不记录181项通过或将此前31/36等中间样本升级为最终成功。运行结果应绑定实际成品与测试快照，待 root 的真实报告补齐。

本次复查在限定五文件未新增未处置 P0/P1/P2；P3覆盖建议交测试作者/root处理或由PM登记接受依据。最终新提交若内容变化，仍需核对本报告 hash 对应关系。

## 最终测试增量独立复查

本节覆盖 root 交回的最终测试增量，不改前文历史读取快照。Reviewer 只读核对，未执行或干预正在3100/3327运行的183项浏览器测试，也没有启动/重启服务。

### 版本对应

- 最终 manifest：`/private/tmp/hd-fe-ux02-final-scope.json`，SHA-256 `5cca5acc59ec96c64f0853c0086421d920f6c1005024d5c9977b31c466128cde`；baseline仍为 `61dc7414b20a395d1d09e906a49d974763b3cce7`。
- manifest包含241个文件；本 Reviewer 仅核对本报告的五个详情文件及下列五个测试/fixture的实际SHA与manifest相符，**不是对241个文件逐一代码审查**。
- manifest标注 BUILD_ID `jxupsT7lU7eVFHhjD1W8y`，读取当前 `apps/web/.next/BUILD_ID` 与其一致；这只核对本地成品标识，不据此声称测试已通过或已审查运行中的进程。
- 五个详情文件维持修复快照hash不变；最终测试/fixture如下。

| 文件 | 最终 SHA-256 |
| --- | --- |
| `tests/public-freshness.spec.ts` | `468260ba98fc10b409c753811a45de9715fbcb0a27ee3f4c3d71897bdf57e3f8` |
| `tests/fixtures/public-api.mjs` | `5df44a713906e155ad86911285f0909debf73fd36ccc2ad7f60aed5d29b0ffc7`（未改） |
| `tests/runtime-pages.spec.ts` | `0614947d3fce9b84ebd42a7f08244fdbc32008d65a7edf7aff2e0696dfaffb57` |
| `tests/buy-guide.spec.ts` | `4ebf30bf6543370372231a5a2a026e444931b7ab288b004180039047e372c53f` |
| `tests/navigation-motion.spec.ts` | `eefc9d5f594aceda0551c0003c8b437afaecf55da1a6a097905871044e21f3d9` |

### 实际审查结论

| 增量 | 只读核对结果 |
| --- | --- |
| 快速 A→B→A | `public-freshness.spec.ts:463–479` 先等待 active 图片 naturalWidth>0，再用明确注明的受控 DOM click 迅速往返，最后断言选中A与 data-loading=false；原图库弹层左右返回场景也在456补了完成态断言。原 TST-01 的“只检查选中id，无法发现持续加载”缺口已关闭。该用例验证处理器/过渡竞态，不冒充真实鼠标或触屏操作；极端调度暂停仍不构成450ms严格时间测量。 |
| focus后首帧状态失效 | `482–518` 拦住实际详情JSON响应，再发送focus，紧邻首个requestAnimationFrame读取联系href数量、available标记数量和main visibility，期望0/0/visible。它检查产品首帧DOM，不用测试代码代替产品清理状态；合成focus仍是受控事件测试，不是OS切换。可用状态最终恢复由其他场景覆盖。 |
| 原图选择器 | 失败重试等待只针对 `[data-outgoing="false"]`，避免出场动画的旧图与新图并存时严格locator多匹配；没有通过移除图片加载断言规避失败。 |
| 严格公开路径 | 不在BFF allowlist的非法路径期待404，允许路径的非法query期待400；仍保留thumb成功及set-cookie不泄漏断言，与实际路由边界相符。 |
| SSR h1嵌套span | runtime-pages从真实SSR `<h1>` 提取并剥离内部标签后检查有文本，适应国家名accent span，不再要求h1中没有子标签。这里是SSR标题非空检查，不能单凭它证明每种语言标题翻译正确；其他语言/SEO验收仍需保留。 |
| 指南静态FAQ与目录CTA | buy-guide与navigation-motion明确检查4个静态答案可见、无旧details/summary，三语和无JS目录CTA为真实链接；符合已经确认的界面结构变更，并未删除仍存在的交互来迎合失败。定金、CIF/FOB、三语SEO与无JS内容检查仍保留。 |
| Next运行时导航请求 | navigation-motion阻断真正的 `/zh/buy/?_rsc=…` 请求，替换历史静态 `.txt` 匹配，保留inline等待和正文可用断言；属于运行方式同步，不是放宽产品行为。 |

本节新增/修改四份TS测试经Reviewer内存语法解析通过；fixture未变。未新增本增量 P0/P1/P2，也未发现注入假产品实现或绕过3320隔离保护。显式Open按钮的450ms自动化时间界限仍作为证据限制保留，不能把耗时不受控的触摸用例结果写为精确时间证明。

183项的最终成功/失败、成品运行对象与日志由 root 登记。本报告不把此前31/36、181项执行中或本次语法检查换算为完整浏览器通过；最终提交后仍需核对文件hash和提交SHA的对应关系。

## 最终接手文档增量复查与新版 scope

root 在最终测试结束后仅修正接手说明：`apps/web/README.md` 去掉旧“核对时隐藏main”，同步局部JSON/generation失效、q/facets、external、thumb和锁定Node24.19.0；指南、首页与路由维护文档同步当前实现。Reviewer 只读核对这些文档与相关代码，没有改产品、测试或参考项目。

- **新版 scope 取代前节旧manifest指纹作为最终候选定位**：`/private/tmp/hd-fe-ux02-final-scope.json`，SHA-256 **`2e82314c6b1a9376b19f00cf8ed2165ccb51ccae5022d4ed023cc5e7d840eab9`**。实读241文件、50项变化；比前节增加的是README文档变化。BUILD_ID仍为 `jxupsT7lU7eVFHhjD1W8y`，与当前 `.next/BUILD_ID` 一致。
- 实际重新核对README及前节五个测试/fixture、五个详情文件共11个hash与新版manifest相符；产品和测试hash维持不变，未以文档修改冒充重新构建产品。
- README的当前JSON更新、立即移除旧可售/联系href、保留main/输入/滚动/Canvas、40ms请求合并和不调用router.refresh，与数据资源hook/generation实现相符；q约束facets、external未核实来源与thumb变体说明，与当前展示/公开契约/媒体helper一致。`.nvmrc`实际为24.19.0。历史静态部署明确为回退材料，没有把out当成当前运行成品。
- 指南已与现行760px八步、64px轨道/44px圆徽、静态FAQ、目录主CTA和CIF/FOB相符。本次发现并交原作者修正的文档遗留已复读确认：主题为深色铜色；三语各70个字符串key，但 `{deposit}` 仅在 `steps.deposit.body` 与 `steps.balance.body` 两处，标题/SEO/FAQ问题不再重复金额。该核对使用消息AST读取，不改金额或消息实现。
- 首页/路由文档把旧阶段标为历史，并用FE-UX-02章节说明真实API、局部核对、三栏与原图/预览、首帧失效、计算器作用域样式；与本轮实现边界一致，未把真实OS切tab、真机Safari或像素级还原写成已验收。
- 上述四份文档的 `git diff --check` 实际通过。本次文档快速复查没有新增未处置 P0/P1/P2。

| 文档 | 最终 SHA-256 |
| --- | --- |
| `apps/web/README.md` | `824e6435b30e21b3cb68f4c25fa40ff72d5ed4b7760ac404e13140ac8b3cafb5` |
| `docs/开发/模块/购车指南.md` | `d565c537dfcc26df0be7860691b84c79680252b7aa5abf92658398e07831ec2b` |
| `docs/开发/模块/首页与车源.md` | `fbf033a5cf26b31b58ec89d9fb9e59ac8e16c29d54815988a3624612767ac6a9` |
| `docs/开发/模块/路由与动效.md` | `65deb2a3ab310c651dbb78a8170946faedd88bb629854218b3c6fb5164cf3a9b` |

### root 运行证据读回（非 Reviewer 执行）

Reviewer 读取[本轮FE主日志](前端-FE-UX-02-PM-INT-03-视觉与局部数据交互.md)最终候选章节及以下原始日志最后5行：

- `/private/tmp/hd-fe-ux02-final-e2e.log`：实际末行 `183 passed (3.0m)`。
- `/private/tmp/hd-fe-ux02-node24-e2e.log`：实际末行 `17 passed (14.5s)`。

这两轮由 root 执行；环境与成品归属依其执行日志：完整183项使用Node20.19.3，随后同成品在Node24.19.0补跑17项局部数据/图库关键回归，3317保留服务已切Node24.19.0。不能写成“Node24已跑完183项”，也不能把Reviewer读回日志当作Reviewer亲自运行。658单元、边界、类型与真实API性能仍以root和对应任务各自证据为准。

本报告仅闭合受分配的详情、测试增量与文档审查；用户业务/视觉确认、PM跨端验收、最终提交SHA核对和外部推送/部署仍分别处理。
