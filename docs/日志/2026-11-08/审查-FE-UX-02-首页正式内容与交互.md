# 独立审查 / FE-UX-02 / 首页正式内容与交互

日期：2026-11-08（Asia/Shanghai）。Reviewer：`/root/fe_ux02_perf_baseline`。首页实现作者为referenceAgent；统计中文标签由root微调，新增polish测试作者为root，均非本Reviewer。

状态：限定源码增量复查完成，POLISH-01已由root修复并复查关闭，本范围未留可确认P0／P1／P2。Reviewer尚未运行新成品浏览器，不把语法或测试发现写成行为通过；root运行证据另行登记。

## 快照与范围

共同HEAD：`61dc7414b20a395d1d09e906a49d974763b3cce7`。首轮未提交工作树的5文件清单为 `/private/tmp/hd-fe-ux02-home-formal-review-source.json`，SHA-256 `eae96f79c24c19f1650f95b4b3d3421fc0b1ff88baa6c6ae5b4d98681322f610`。修复和追加范围的当前11文件快照见文末；下表旧polish测试hash不直接套用修复后文件。

| 文件（相对 apps/web/） | SHA-256 |
| --- | --- |
| src/modules/home/content/home-content.ts | `cd49194c5af270be55708f2185da3727ab3de95e02db9eab03bdeef9bdee8a5c` |
| src/modules/home/content/section-content.ts | `3f96e9ab983c3f0dab9fd06f583cf8c664a07b0b0e2da40b8b9ae62649ab5cdb` |
| src/modules/home/ui/home-sections.tsx | `4de7dc257b08355c98d5f45571f921a40580ed585ace9256da835157c45e7995` |
| src/modules/home/ui/home-sections.module.css | `1ec0103558889273ea4018ad0fd120d8b8eec473df68033e3fd7f3c1edc42ddc` |
| tests/public-polish.spec.ts | `72c9e84789f563ff9ded57d90407031afabbca2db961c806036ed852d19ad356` |

为核对账号及关联验证，补读site配置和home-vehicles中的六个WA场景；没有将关联文件整个纳入本报告通过范围。本人fixture／freshness／rate-limit测试仍由他人审查，不在此自审。

## 首页源码核对

- **正式服务内容**：三语六类服务咨询各有两组问题和服务说明，主题为选车、车辆资料、运输、费用、文件与交付。没有虚构客户姓名、头像身份、评价分数、已读标记、日期或交付成功记录；顶部使用HD品牌与“常见问题／服务说明”等标签，不冒充真实客户评价。内部类名／data标记继续叫reviews不等于公开评价文案。
- **业务边界**：照片／检测／历史资料按实际可提供内容确认；运输按路线和合同沟通CIF／FOB，不承诺统一全包、所有车已检验或固定到车时间。计算器继续称参考，未把估算说成海关已确认结果。该审查不是贸易条款法律认证或对真实履约能力背书。
- **公开口径**：首页固定文案无demo、虚构、第三方或库存待核验治理说明；车型入口称相关车源。中文统计由“首页展示”改“精选车源”仅换标签，没有改数据计算或声明HD自有库存数量；另外两语仍称featured listings／首页条目，不表示库存所有权。
- **WhatsApp原生表单**：action取已确认的 `https://wa.me/8618215932610`，GET、target blank及noopener/noreferrer。唯一带name的成功字段是hidden `text`；电话输入没有name，所以不会多发phone参数。有JS时phone state只更新text草稿，在用户显式提交前没有导航、POST或站内保存；提交只打开草稿，不代按聊天发送。
- **无JS**：SSR hidden text为基础咨询内容，电话字段保留原生校验，noscript明确让用户进入WA后补电话；没有虚报已保存号码或已发送。表单提交确实会把text传到WA用于预填，有JS时其中含电话，不声称“号码从未传输给WA”；站内没有提交API。
- **悬停空间**：流程与咨询两条track均有padding-block 12px／margin-block -12px，卡片抬升-4px，在track内留有8px顶部余量。源码没有重新开启祖先裁剪来抵消留白；CSS语法有效。真实小屏、上边框命中和连续指针稳定性仍须浏览器验证，不以数值比较冒称全部hover已实测。

## 新polish测试审查

- 三语五页innerText及车辆草稿排除治理标签，覆盖范围与本轮用户要求相符；它不替代PM／PA对真实API正文和demo下架的读回。
- hover用真实hover后检查顶边位置与elementFromPoint命中，适合发现此前顶部裁切；不能据此单独证明所有边缘连续移动、所有尺寸或触屏效果。
- 同URL新历史导航测试对第一个请求施加阻断，要求第二次popstate发出新请求并显示更新后的已售状态，能防止把新导航错误复用到旧in-flight请求。它没有构造“已取得旧body晚于新body返回”的乱序响应，不能扩写为穷尽所有请求竞争。
- **P2 / POLISH-01：SSR429首次请求观测窗口过晚（已关闭）**。首轮三个初始SSR429场景在goto和状态断言之后才注册page request监听。若hydration期间已误发一次自动请求并收到429，监听开始前就可能结束，后续仍可看到disabled按钮而令测试通过。原作者root已把计数监听放在goto前，覆盖首次导航到用户手动retry的整个区间；手动前0业务请求、点击后1个成功请求，并增加旧disabled链接无href、首页统计“—”、目录非empty和详情非missing断言。源码复查关闭该观测缺口；此项不是曾确认产品误请求，也不替代新成品执行。Reviewer未修改待审测试。

## 实际检查与限制

- `pnpm hooks:check`：通过。
- TypeScript内存AST解析4文件、PostCSS解析1文件：通过，不emit、不写Next状态。
- `pnpm --filter @hd/web exec playwright test tests/public-polish.spec.ts --list`：发现8项、加载通过，**没有运行8项浏览器**。
- 只读核对关联home-vehicles中三语×JS开关共六个WA场景：使用context.route拦截wa.me后检查唯一text参数、有JS电话／无JS基础草稿和显式提交；不会真实访问WA。这是读取测试代码，不是本人已运行六项。
- 未HTTP读取官网、真实API或聊天服务；未安装、build、typegen、启停服务、修改应用／待审测试、提交、推送或部署。P2修复复查见后节，最终新成品／测试结果及PM／用户业务视觉验收另记。

## 修复后增量与汇率文案轻量复查

- 再读polish：请求监听在goto前；相对咨询href用 `new URL(href, page.url())` 解析，不会把合法相对链接误判成InvalidURL。新增第9项覆盖冷却中改变q时结果与facets都不再请求，到期后用户显式重试各请求一次；当前 `--list`为9项加载成功，不是8项或9项浏览器通过。
- `HomePage` 新增retryAfter／onRetry：等待期旧error重载入口没有href，并阻止默认导航；等待结束且有callback时仅调局部reload，未提供callback时保留普通href退路。`PublicHome` 将SSR initialRetryAfter传hook，并把retryAfter／reload转传HomePage和公共状态组件。失败首屏统计仍是“—”，不是0车；此次中文统计标签换成“精选车源”没有改unique-ID数量计算。
- 只读查询确认旧首页CSS `.demoNotice`／`.demo` 已无引用；其未用样式删除不是增加库存或交互能力。没有据此扩大为整个home.module.css的独立审查。
- 轻量对比3份messages JSON与copy-messages：每种语言仅 `Calculator.rateHelp`、`faq4A`、`ratesReference` 三个值变化；JSON键集、值类型和占位符不变。`copyQuoteMessages` 每语言仅fallbackFx措辞变化。仍明确构建时市场汇率快照、数据日期、无法取得快照时默认参考值、手动修改以及市场／海关计税汇率可能不同，没有将fallback说成实时市场或官方海关汇率。
- 四个text文件没有算法、金额、税率、日期回退分支或schema变更。独立执行 `pnpm --filter @hd/web exec vitest run src/modules/calculator/application/copy-quote.test.ts src/modules/calculator/application/display-currency.test.ts`，2文件34／34通过。没有为纯copy扩大七国算法全测。
- root转述新成品第一轮首页、服务FAQ、六个JS／无JS WA拦截及hover上边缘已运行通过；该运行由root负责，日志另补，Reviewer没有代跑或代签这组结果。

### 当前快照

11文件合并清单 `/private/tmp/hd-fe-ux02-home-final-review-source.json`，SHA-256 `e902241f9135c967e09d51642b965e74e512e6792a9de6190702f6f5cceae388`。首轮4个首页文件hash未变；更新的polish及追加6文件如下。

| 文件（相对 apps/web/） | 当前 SHA-256 |
| --- | --- |
| tests/public-polish.spec.ts | `2446a6f9edc412be5c314b91e611ad3301a0200b9667b1a7dad727b65a479513` |
| src/modules/home/ui/home-page.tsx | `23ecb950e2a651ee887d2c2574f206834d69fd8b1046d5c33ef15a6c54599aab` |
| src/modules/home/ui/public-home.tsx | `1648563525f6dc2751c33fd4db0695e27ef66034f7f8bc5c146ce3fa911a8b93` |
| src/messages/zh.json | `ebb1bb2627f5fc32722fab29d1e851606e7b81c30cd87f90752a2405f1785469` |
| src/messages/en.json | `1922d5771314b952ec3dadd3012dac0973a3d894316ac28fb08ee68581556e98` |
| src/messages/ru.json | `c464239e511155c3f99286f023106b992d3f5e6522ff4b11a96250d663d73ffa` |
| src/modules/calculator/application/copy-messages.ts | `e42c4a42bfffb22999fda5c6c161d1ceb44bb16ef7ac9e71c8d3ba325b9eb84a` |

最终成品及提交若继续变化，需核对新旧差异和对应检查；本报告不授权推送或部署。
