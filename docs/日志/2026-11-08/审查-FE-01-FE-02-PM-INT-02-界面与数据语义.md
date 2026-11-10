# 独立审查 / FE-01、FE-02 / PM-INT-02 界面与数据语义

日期：2026-11-08（Asia/Shanghai）
审查者：独立 Agent `/root/fe_ui_review`
状态：独立代码审查与修复复查完成；已核对专项复测证据，所报 P2 关闭。

## 范围与版本

- 共同基线：`61dc7414b20a395d1d09e906a49d974763b3cce7`，`codex/backend-foundation` 未提交工作树。不是提交级批准，也不授权推送或部署。
- 本次审查官网 home 模块、新车辆 public UI／三语字典／展示函数、公开联系草稿与统一 demo 声明、目录装配的错误处理，以及对应浏览器／纯函数测试。运行时代理和打包另由运行时 Reviewer 检查；BE／AD／PM 的并行改动不在本报告范围。
- 主要入口：`apps/web/src/modules/home/ui/home-page.tsx`、`home-sections.tsx`；`vehicles/public-messages.ts`、`public-presentation.ts`、`ui/public-vehicle-*.tsx`；`shared/lib/vehicle-contact.ts`、`shared/config/vehicle-display.ts`；`app/[locale]/cars/page.tsx`。
- 最终审查范围快照：38 个相关文件，按路径排序后对 `SHA256(file) + 两空格 + 仓库相对路径 + 换行` 清单再取 SHA256，得到 `f9882873b3ef85033c1714ebd62664949887514d1d1f2c26da7c265524133172`。范围包括 home 全部文件、vehicles 的 `public-*.ts` 和 `ui/public-*`、下列共享／路由文件，以及已列的六份浏览器文件和隔离 fixtures/helper；不是整个工作树或编译成品的摘要。
- 本次增量复查另包含 `shared/ui/inventory-freshness.tsx`、`app/globals.css`、`app/[locale]/layout.tsx`、`app/[locale]/cars/[slug]/error.tsx`、`src/proxy.ts`、`tests/runtime-pages.spec.ts`。上述最终摘要替代本报告原有的中途 32 文件快照。新提交或上述文件变化后须重新核对，不直接沿用本报告。

## 范围文件清单

以下 JSON 是最终审查的完整 38 文件清单。按 JSON 的键（仓库相对路径）字典序输出 `SHA256值 + 两个ASCII空格 + 路径 + LF`，包含末行 LF，再对其 UTF-8 字节取 SHA256，应得到上节 `f9882873b3ef85033c1714ebd62664949887514d1d1f2c26da7c265524133172`。复算前先逐项核对文件字节 SHA256；本段补充只增加报告证据，没有修改产品文件。

```json
{
  "apps/web/src/app/[locale]/cars/[slug]/error.tsx": "55ffc30fca563972cb678a3afbd3df517b8e975a23d3acbea5f82e58b793f8d7",
  "apps/web/src/app/[locale]/cars/[slug]/page.tsx": "e6b24ad294684c336627068c1c96c0cb3d463f195d987a77dc2cc0feaeff5a7b",
  "apps/web/src/app/[locale]/cars/page.tsx": "f986fcdb78fb6659061dd0e71c8f582513b504a89037b5c275e87c2a9d6cd4b2",
  "apps/web/src/app/[locale]/layout.tsx": "25ea1cef7ea760998ccf9207ba94fb225d2eb33e8d41ceb6b953ee241b80aabe",
  "apps/web/src/app/globals.css": "1be1dec74505cbdb1c626f21981e9a7feb5c4acd90fb80c6096a6db59d30923f",
  "apps/web/src/modules/home/content/home-content.ts": "c52e1186e48f3ebff30cfcec4121687f1bdbedb37bddae46fecc44adad7adfb6",
  "apps/web/src/modules/home/content/section-content.ts": "468d78c6b5812c4a5a058894b02de66bf5f30ce14473d4234faedd7757ffe68e",
  "apps/web/src/modules/home/index.ts": "5e5d80dc3071de2e424161e5765336a16df51fd94cd16b2836dd0463952ec094",
  "apps/web/src/modules/home/types.ts": "ce712957e26ab7c6b73d139e37be14fecf2619c410e11be364952af0b38ef620",
  "apps/web/src/modules/home/ui/hero-canvas.tsx": "71851aeeda9eb75a5407d97a06e1731a2e70587a8f97d591e603967c540d1728",
  "apps/web/src/modules/home/ui/home-page.tsx": "cc9dad24ac6cc8502c5deda4ebf470415abef7f557705ff2664c3aacd5ea411c",
  "apps/web/src/modules/home/ui/home-sections.module.css": "38898a604edc1f37b168441f9e7e389c6a9b8c94b8768bd4e9dc263bd2e6da1d",
  "apps/web/src/modules/home/ui/home-sections.tsx": "43302aa952330bb82e84867df6f0d78627748884abe8820b7928f2c61fe909bd",
  "apps/web/src/modules/home/ui/home.module.css": "8727a9efaa44ea7e10722d6ac7b64df1aecff6ea757ffc72d2ece185c57a673c",
  "apps/web/src/modules/home/ui/ripple-scene.ts": "ede4b33c6bb357cd636d38b698e2047352454f2429a2c7beb288a15b4b4c2cb3",
  "apps/web/src/modules/home/ui/use-pointer-tilt.ts": "9f56d01bdd31fe2a11227095f0f32af6f047bcb4e3b1dd1eebe8104cb7c2273d",
  "apps/web/src/modules/vehicles/public-messages.ts": "e709ea3634824b416b219079df4dab0ca571bb6956323afdce5c4c500065d7cf",
  "apps/web/src/modules/vehicles/public-presentation.test.ts": "dc0a859c6c28fb65e3b5c3f7011661d820729ee17c7e4bd5f804b7515ff1de80",
  "apps/web/src/modules/vehicles/public-presentation.ts": "5af7c862e937c5782a1147adb4901e492ea9526fd538ac7a32fa86c77c6a15b6",
  "apps/web/src/modules/vehicles/ui/public-catalog-link.tsx": "bdb4f393a1823829ef20ea2c5806cbaee414ba793890103c005e5390d7c9347a",
  "apps/web/src/modules/vehicles/ui/public-vehicle-card.tsx": "f3128d3f1e63346ff0ffc8b80f581d6cf554a3626a23cc51bcc049c0de57e47b",
  "apps/web/src/modules/vehicles/ui/public-vehicle-contacts.tsx": "6bc85c4150753df3d1ae808d15e6bad849e282b2bbd65fc1ee4b5f2d089bcc1f",
  "apps/web/src/modules/vehicles/ui/public-vehicle-detail.tsx": "20d93efc58d28b5c47a1fdc5dbeaa62ed3caffb5ef1664cebd41a7727900e34e",
  "apps/web/src/modules/vehicles/ui/public-vehicle-filters.tsx": "67c365b7356cc12d288581a7d11057251871c8c2b4a2f5d70ac0c73905ecdf1a",
  "apps/web/src/modules/vehicles/ui/public-vehicle-list.tsx": "c4db61ad34abf8cb11beabccffca0fcea639fe5e0766650c39523ccc293f50c5",
  "apps/web/src/modules/vehicles/ui/public-vehicles.module.css": "37a3ddbb24f25c94dc76c14f3c04b5457fca08641af2fa8cd78a75c7bf3424d3",
  "apps/web/src/proxy.ts": "633b8c7aa739759ea3e2f26422b1b9696269504302c08d3289c1bdd09c85ea2c",
  "apps/web/src/shared/config/vehicle-display.ts": "4a2d626eeab1e3206f9d743cf585ab67ee406aae3e95c9f874647da1e121ae0d",
  "apps/web/src/shared/lib/vehicle-contact.ts": "64db8f509d8bffa0973147bd0b8c41cc620fa262fdabc8f149bb3030e208662a",
  "apps/web/src/shared/ui/inventory-freshness.tsx": "d5b586baf428b4717d22cd63184cfd102f60aed3fb9388bd30f128ddcc8bb366",
  "apps/web/tests/details-hover.spec.ts": "96babc90f1a0585d5ef876fae1bb9e0e09527fc15354646d230f98e00e5dd58a",
  "apps/web/tests/fixtures/public-api.mjs": "90c07f33f64b0063bbb757bd35e6a1e19c088e9dab4a97ed7e51a86382305631",
  "apps/web/tests/helpers/public-fixture.ts": "e5923415d8df403cbb6082bf2f506a5af68e04e5d37eb04d5d603598dc37a3fc",
  "apps/web/tests/home-motion.spec.ts": "b1e43eb80794f1e55461ec95a64b1329bda482da7ceedb557203a5bb2e3e718b",
  "apps/web/tests/home-vehicles.spec.ts": "ea8e082ae73fac28aaf884b459876afc4b014869d92e9d2fb939f7f8625f80e0",
  "apps/web/tests/public-catalog.spec.ts": "ba8a2f0bf96e8619fdb4e1b8aba8910ea225eaa041aba807d062d93986a2cc17",
  "apps/web/tests/runtime-pages.spec.ts": "316c61cf40934228985599db4aadd217b60ee6ac385da97dc4d4c32ee4a87e7d",
  "apps/web/tests/vehicle-contacts.spec.ts": "57de882c5d033f004ced34364d9333f7e477bc963615afef20ff1cfff854b0a3"
}
```

## 发现与处置

### P2：筛选字典单独失败会隐藏成功的目录

- 位置：`apps/web/src/app/[locale]/cars/page.tsx` 的 `PublicVehicleList.error`；关联 `ui/public-vehicle-list.tsx` 的 `filterUnavailable` 与错误／列表分支。
- 触发：`GET /api/v1/vehicles` 成功，但 `GET /api/v1/vehicle-filters` 失败。
- 原实际行为：装配层把两个请求失败做 OR，导致已有目录结果也进入整页错误框。已有“筛选选项暂不可用，仍可浏览当前车辆资料”分支无法进入。
- 影响：非关键筛选字典故障扩大为全部目录不可浏览；不是错误显示为零辆，但有不必要的可用性回退。
- 修复负责人：FE 集成人。已看到 `error` 只绑定目录请求失败、筛选字典缺失单独提示；提示增加保留原查询和页码的原生重新加载链接。代码复查确认修复方向有效。
- 回归：新增“filter service outage preserves a successful catalog and can recover independently”场景及隔离 fixture 的 `filtersUnavailable` 开关；warning 使用稳定 `public-filter-unavailable` testid，消除了初稿英文定位差异。
- 复查关闭：已核对当前实现、测试内容和 `/private/tmp/hd-fe-int02-close.log` 的实际运行记录。该场景在最新 standalone／3327 内存 API 组合通过：筛选字典 503 时保留第 2 页两条资料，不展示目录失败框；点击原生重试后恢复筛选选项并保持第 2 页。该日志共 5 项缺陷回归全部通过（4.9 秒）。这是作者执行证据的独立核验，不冒称 Reviewer 自己重跑。P2 关闭。

本次已审范围无未处置 P0／P1／P2；除已关闭项，未发现可确认的新增问题。

## 已核对的实现语义

- 首页只消费 API 配置的区块 ID／标题／顺序，零区块／故障有不同状态；不读取旧 19 条 mock 补齐。数量按当前展示 ID 去重，不冒充总库存。
- 车型卡来自实际筛选字典，说明其为分类且可含展示样例；不伪造单车图片、车号和报价。
- `source.kind=demo` 在首页卡、目录卡、详情和两平台草稿均显著使用同一份三语非库存声明；不会把未人审资料显示成人工翻译。标题中是否包含“测试”不参与判定。
- 待询价与带金额的售价／参考价分支分离。金额显示保留原币，整数用 BigInt 分组，避免 14 位金额精度丢失；不将 `null` 日期／里程转成零，不把年款当制造日期。
- 已售详情保留准确状态和“咨询类似车辆”语义；草稿同时保留稳定 ID、咨询编号、当前语言详情 URL。消息只预填，未自动发送。
- 车辆说明及照片署名以 React 纯文本完整输出，并保留换行／长 URL 换行；未解析不受信任 HTML。图卡详情链接与聊天链接不嵌套。
- 筛选表单有原生 GET 退路、提交回第 1 页；状态 key 随查询和页码变化，避免重置／导航后保留旧筛选值；分页继续携带服务端条件。
- 原 Canvas、水波及倾斜 hook 文件无本轮 diff；回归仍检查实际 Canvas／DOMMatrix、hover 命中和键盘，而非只判断样式类。三语、无 JS、320px 与本地电话不外发的既有场景未整份跳过。

## 实际检查与限制

- 实际执行：开工和最终复查的 `pnpm hooks:check` 均通过；核对 Git HEAD／工作树、限定范围 diff、`git diff --check -- apps/web`，阅读相关契约、实现和测试；最终复查对上述 38 文件生成范围摘要。
- 作者提供的 web 类型／653 单元、standalone 构建及首轮 9 项公开 HTTP 浏览器通过属于作者自测输入；最终核对 5 项缺陷关闭日志（facets、无 JS 详情故障、Back／Forward 库存恢复、未知路径、无 JS 品牌 404）全部通过。本报告不冒充独立执行这些测试。
- 未启动或停止 Next、未运行 typegen／build、未访问真实 API3320／后台3318／数据库、未发送真实聊天消息；完整生产成品回归与真实两条资料由集成人／PM 验证。
- 本报告不证明实际素材授权、真人翻译质量、Safari／真机或用户视觉验收；也不代表整个 FE-02 长期范围已完成。

## 最后增量复查

- 全局库存恢复组件只在本语言首页／cars 路径收到 history、页面恢复、焦点或可见性事件后调用刷新，不把定时轮询加入计算器。核对期间显示本地化状态条并临时隐藏 main，完成或卸载清理标记；未改写库存为“可售”或把失败当作零辆。Back／Forward 场景的实际作者日志已核对，未新增可确认问题。
- 已知车辆 API 临时故障由服务端直接输出可读的不可用正文、原生重试及 noindex；无 JS 也能恢复。404 继续与临时故障区分，未把缺车包装成库存记录。
- 非法语言段的 proxy 返回真实 404、品牌、三语首页链接及 no-store，正文不执行不受信任 HTML。已核对作者的无 JS 品牌 404 回归通过；此次不重复审查运行时代理的全部安全边界。

## 交接

本报告所报 P2 已关闭；本次范围可进入对应集成验收／PM 证据核对，不代表用户已经完成业务与视觉验收。集成人核对最终文件快照和待交付版本；新改动须按影响范围复查。没有提交、推送或部署。
