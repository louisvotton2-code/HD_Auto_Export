# 前端 / FE-EXT-06 / 正式车源与详情分段

日期：2026-11-13（Asia/Shanghai）。状态：FE实现、自测及独立源码复查完成，待最终SHA登记与真实API同版联调；本日志的fixture不代表正式300数据已导入。

## 范围与基线

- 已核读PM对话人类原始`PLEASE IMPLEMENT`完整计划和`docs/private/pm-ext06/task.md`；FE负责真实详情、全照片／配置有界分段、三语原文回退及USD／cache契约兼容。固定约300正式名单及一次导入由PA／OPS执行，不导本地旧样本，不开启持续调度，不发起翻译计费或报告原站请求。
- `git fetch origin main`实核`8523c851fe7cc64a4c32ea428ea7a293d6501510`，独立分支`codex/web-ext06`／`docs/private/fe-ext06-worktree`。根`acceptance-polish`历史脏树和其他角色代码不覆盖。
- 已读AGENTS／导航／角色规范及实际Next本地fetch文档；hooks通过。FE先从同锁上轮树写时克隆，OPS随后统一完成离线frozen安装（共享dependencies-status记录），均未改锁；锁摘要`63c074b28b5f2f85b0e3c315e8edb8970912d67232c7ed21cf8722c5ea7be392`一致。本树contracts基线及新切片build完成，不跨用旧应用成品。

## 已核对入口与依赖

- SSR经`vehicles/server.ts`及`ssr-public-api.ts`，浏览器经允许列表BFF；现有详情与列表共用localized校验，列表不得返回大配置／报告。缓存逐次版本检查、匿名身份边界和原TTL／FX／签名图截止均保留。
- 开工发现公开schema图片30、外部规格500及员工配置200等不同界限，先向BE反馈首屏meta丢弃、跨页一致性及两种配置来源问题，没有猜接口。采用BE独立审查／86自测通过切片`272380280d4d3cd2f9f96c5206e77231de5bae61`，本地等价`d069220`；唯一公共schema及详细合同§20，不复制DTO。新段从第一页替换首屏，故无需伪造或额外透出首屏meta版本。
- 独立只读子任务分别核对gallery生命周期／解码和配置／回退／USD／隐私，不修改公共契约。正式接口确定后再实施；实际源码与检查持续补入本日志。
- 报告只提供联系销售提示；公开HTML／JSON／SSR／分页不能泄源报告、VIN、卖家、员工或原始私有响应。字段缺失、0、false及未知日期精度保持，争议字段与标题／筛选由BE规范化，前端不造事实。

## 实际实现

- 正式`gallery`／`configuration`公开GET，只传locale／limit50／cursor。BFF精确资源／参数允许列表、schema／车／语言核验、no-store／超时／体积／凭据过滤；无新内部SSR alias、无缓存特权。既有SSR版本核验／64条16MiB／原TTL／FX／媒体截止策略未改。
- `public-segments.ts`核验正式页、重复身份、空游标与数量；第一页替换seed，后续同revision／车／语言／total才合并，稳定重叠去重，变化重复／循环游标／不完整尾页拒绝，不把旧30／200／500界限当完整存储上限。
- 公开专用hook每集合一个在途请求，车／语言／新详情对象／fresh变化使旧任务取消、迟到结果失效；409清整栈等明确restart，404经resource.markMissing撤除整车／预算／联系，429同页共享等待截止且到期不自动请求。首次失败可保留明确的首屏预览，409以后重读期间不会闪回旧seed；没有激活／可见性自动取数。
- 公共图库包装共享展示图库，只加可选onOpen／计数／viewerFooter；打开完整图库取第一页，后续明确加载，不暗取全量。保持最多当前＋上一原图、缩略懒加载、原图无JS链接、键盘／触摸／焦点／滚动及解码逻辑。员工预览不消费公开wrapper／hook，私有decode规则和零公开读取保留。
- 配置首屏保持单一manual或external来源，正式页替换后复用DisplayText组件，不再重新套首屏200限制；0、false、单位和实际lang不改，真实空0与未知总数区分。导入车辆真实原文标题保留实际语言；后端catalog占位／争议仍走安全事实回退，员工原中文规则保留。
- USD继续消费后端投影、缺有效换算不造价且保留已知原币。Exchange Rate API来源链接已有目录／详情／收藏组件，三语／窄屏实际可见性定向验证；FE不公开全量汇率、不自行请求或刷新FX。报告仍仅hasReport=true联系销售，不恢复源URL／VIN／卖家／员工。

## 实际检查、失败与限制

- Node24.22.1／pnpm11.25.0／Darwin arm64。初轮37单元通过；扩展后9份定向73项通过（分段／BFF／原校验／标题／配置／检测联系／SSR reader），工作区／官网边界通过（官网7项）。不重复税费48、整站或上轮149。首次新增测试的DisplayText union字面量类型错误已修正为明确ready对象；随后官网typecheck及最终tsc noEmit／incrementalfalse通过，未伪称初次无失败。
- 独立审查发现409 envelope用了非正式CONFLICT，已改VERSION_CONFLICT并用ApiErrorSchema核验，7项transport定向复查通过。空nextCursor在构建前已明确拒绝、merge只认null末页，补反例后12项纯分段复查通过。上述是73范围内定向复查，不相加成92或80新覆盖。
- 生产构建BUILD`60KNv6XFhYv05Kc-9Mf2w`成功。首轮14浏览器13真通过／1测试预期失败：attribution选择首个桌面隐藏的移动副本；按既有USD测试相同方式筛可见链接，未改产品或放宽来源要求。仅复查该一项，扩展1440／390／320三语截图和无横溢出后通过；共14真实通过（8新＋6关联），不声称最终一次全量重跑。
- 8新案例含65照片的第一页替换／尾页、525配置及重叠去重／0／false／单位、409清栈／明确重启、实际撤回404整车、429等到期无自动请求及503重试、真实同文档Back取消／旧响应不追加、BFF参数／身份／隐私、三语原文／来源链接／无FX／轻列表。Back测试保留document marker、零document导航、旧请求requestfailed、刷新seed替换50旧项并越过旧响应时限，再从无cursor首页重读；不是仅靠page.goto自行取消。
- 6关联案例为三语公开／员工配置同投影、离屏图不整批下载、查看器独立解码及SSR逐次版本／匿名复用控制；保留预览publicReads=[]验证。无源报告／VIN／卖家／员工泄漏的schema及fixture反例通过，但不把合成DTO测试代替实际300字段抽查。
- 三语新控件截图人工核对；失败trace和日志保留于`docs/private/fe-ext06-evidence`。临时3100／3327仅隔离fixture，结束退场；3363和生产未变。没有请求供应商、采集密钥、导入数据、付费翻译或访问源报告。
- Reviewer`/root/release_cache_review`独立只读审查实现／生命周期／契约／fixture及原始证据，409问题修复、空游标边界复核闭合，最终报告另绑定完整SHA／源和成品manifest。真实BE端点、300供应商数据、员工双账号／审计、Linux／生产及整仓verify:push由BE／PA／OPS组合验证，FE未执行、不记通过。

## 交接

- 准确自有提交、依赖合同、冻结源／成品清单、独立报告及剩余限制统一写`docs/private/pm-ext06/FE-handoff.md`和`docs/private/fe-ext06-evidence/delivery.json`；正式300名单／raw与public计数以PA／OPS实际结果为准。
- 中途只协助／阻塞／完成时沟通，OPS唯一集成、最终verify:push／PR／CI／main及上线；FE不自行推送／合并／部署或读取供应商密钥。固定300验证后持续同步关闭，不触发全量。
