# FE-UX-04 目录筛选实现独立审查

- 日期：2026-11-08，Asia/Shanghai。
- Reviewer：`/root/fe_ux02_detail_audit`；不是本轮查询扩展、筛选表单、列表接线或新增浏览器用例的作者。
- 共同基线：`fdf6c6bc52b3a40761c4f991dde8e1f6a0fad028`；本报告绑定工作树指纹，不是提交/推送许可。
- 主范围 9 文件：public-query 与相邻测试、public-presentation 本轮金额/href/配置事实增量、catalog-filter-copy、public-vehicle-filters、public-vehicle-list、public-vehicles CSS、catalog-filters E2E、public-api fixture。另只读核对 SSR/BFF/契约与 SQL 语义上下文，详见指纹表。
- 前轮本人所写收藏、卡片旧布局不作为本报告独立审查对象；共享 pointer tilt 的完整实现及车辆展示本地化由根另行分派。本报告只核对列表接线与所列 CSS 的筛选/布局部分。
- 未运行参考项目、HTTP/真实 API、浏览器、Next build/typegen、服务或安装；未修改产品代码、提交、推送、部署。只新增本独立报告。

## 结论

本范围发现的 CF-01、CF-02、CF-03 三项 P2 均由作者修复并通过独立源码复查。当前未发现未解决的源码 P0/P1/P2，**仍待修复后的新 standalone 成品执行对应浏览器回归**。旧构建的测试通过不覆盖新增修复；不把本报告的隔离单元或源码结论当作三语视觉、无 JS、真实 API 或最终成品已验收。

## 发现与修复复查

### CF-01 · P2 · 合法 model-only 条件在再次提交时丢失

触发：`/{locale}/cars/?model=beta_model` 是当前契约接受的查询。初版表单在没有 make 时禁用 model，虽然选中值通过 fallback option 还原，却不会进入原生 FormData；修改其他条件后 Apply 或无 JS GET 会静默移除 model，扩大结果。

修复：make 为空时 models 保留全部真实元数据；仅在 `!make && !model` 时禁用 model。已选 model-only 值可正常提交，换 make 仍清空其子 model/generation/trim。独立复查当前源代码及新增“JS/无 JS 各提交一次仍保持 model”用例通过。该用例运行结果待根新成品回归，不由本 Reviewer 代签。

### CF-02 · P2 · 恢复金额边界的标签发生浮点舍入

触发：Money 契约合法的 `99999999999999.99` 初版经 Number 后再格式化；本 Reviewer 纯 Node 验证其变为 `99999999999999.98`，选项标签与 URL/实际筛选边界不同。

修复：提取 `formatPublicAmount`，BigInt 处理整数部分、原字符串处理小数与语言小数点；价格展示和 range label 共用。选项排序也以 BigInt cents 比较，不把金额转浮点；option.value 与 URL 保持原字符串。独立复查实现与新增精确金额标签/再次提交用例通过，已有合约最大金额展示单元实际运行通过。浏览器用例仍待新成品运行。

### CF-03 · P2 · 空查询 URL 上重置未提交草稿无效

触发：基础 `/cars/` 上修改品牌/范围等但未成功 Apply 时，Reset 走同 URL 的 reloadCatalog；appliedKey 不变，表单不重挂载，受控 state 与原生未受控草稿依旧保留。

修复：普通点击 Reset 先调用所属 form.reset() 恢复原生默认值，再显式清空 make/model/generation/trim 和本地错误，最后导航基线路径。当前 URL 本来为空时也能清草稿；有已应用条件时继续通过 URL/key 切换恢复基础查询。修复保留修饰键原生链接行为。已独立复读当前实现和新增“未 Apply 多项、倒置范围错误→Reset→字段为空/CNY 回 USD/model 禁用”断言；实际浏览器复测仍待根。

## 贯通与业务语义核对

| 范围 | 本轮只读结论 |
| --- | --- |
| 字段与解析 | 公共 catalogFilterKeys 贯通 q/make/model/generation/trim/powertrain/drivetrain、价格/币种、里程与年款双边界；整数只接受十进制非负文本再交 schema 验证，页码仍须正数。重复字段拒绝，负值/指数/十六进制/反向范围及缺币种价格界限被拒绝 |
| 金额与 0 | priceMin/Max 保留 string，经契约/BigInt 比较；mileageMin=0 通过 undefined 判断而非 truthiness 保留。币种无边界时不缩小结果；指定价格边界时比较所选原币，不引入未约定的汇率或跨币排序 |
| 年份与缺失 | yearMin/Max 对应 modelYear，界面三语明确“年款/Model year/Модельный год”；不代替制造日。fixture 对 null/undefined 年款、里程或无价格明确排除范围匹配；只读 API SQL 比较同样不把 null 当 0。本报告未执行真实数据库验证 |
| SSR/BFF | SSR 解析相同字段并把完整 query 传 getPublicCatalog；adapter 使用 localized 投影；BFF 白名单与 parseFilterQuery 复用新字段，丢弃 page/pageSize 后用正式 filter schema 校验，非公开路径边界未扩大 |
| 分页/URL | href 遍历同一过滤 key 集合，保留零、原金额、币种、父子 ID；页面 transport view 不进入公共 URL。Apply 回 page=1，pageSize 保留；分页 href 全条件保留；原生 GET 携带同字段，客户端 useSearchParams 与 explicit History API 保持原先 Back/Forward 数据核对 |
| 元数据 | UI facets 请求有意只携带 catalog=curated、locale、q、view=localized，不随所选价/里程/年份/车型再缩小。选项计数是 q 匹配的元数据集合，不冒充当前组合结果数；真正组合 total/items/hasMore 来自列表接口。makeId/modelId 在客户端组织依赖，不从当前页卡片拼全目录选项 |
| 级联与真实选项 | 换品牌清车型/代次/配置，换车型清代次/配置；后两者要求 make+model。generation/trim/drivetrain 完全无元数据且 URL 未选时隐藏，不造固定 Base/II/AWD；有效 URL 上暂时不在字典的已选值保留“当前条件”fallback以便提交/清除，不宣称该 ID 有库存 |
| 事实展示 | 新 trim/generation/drivetrain 规格只在 DTO 有事实时添加；驱动采用正式枚举三语词汇，没有从变速箱/年份猜测代次。原币价格、未知状态和已售/预订事实边界保留 |
| 本地化 | 筛选静态消息为 zh/en/ru 同形对象，单位清楚；车型等字典使用 localized API。只读其投影上下文确认命名事实来自服务端投影，不新建前端翻译/品牌 ID 推断。本报告不代替本地化链路的专项审查 |
| CSS/交互 | 侧栏紧凑纵排，范围各列 minmax(0,1fr)、8px gap、显式上下限读屏名称；手机不恢复旧双列侧栏；无模型父级时禁用提示、focus 样式与减少动态效果保留。卡片稳定外壳由列表传入 shared tilt handlers；实际连续 hover/点击/触屏和俄语 320px 布局待浏览器实测 |
| 测试数据 | richCatalog 是独立 fixture 开关，带有多币价、已知/null 规格、配置/代次/驱动与实际分页。其 queryMatches 在完整 fixture 集合上应用条件后分页，BigInt cents 与未知排除逻辑明确，不在产品客户端伪筛一页，也不读取真实库存 |

注：表内元数据的目录参数为 `catalog=curated`，没有引入新的目录类型。正式 BE schema 新增的 optional generation/drivetrain 及字典元数据作为既定契约核对；Reviewer 未自行修改或补造契约。

## 实际独立检查

- 开工 `pnpm hooks:check` 通过。
- 2026-11-08 23:31:19（本地时间），在 CF-01/CF-02 修复后运行下列隔离单元：**Vitest 4.1.12，3 文件 / 31 项通过**。CF-03 后只涉及表单重置与 E2E，用例中的纯函数/HTTP stub 源码未变；不重复无关单元来充当 CF-03 的交互验证。

```sh
pnpm --filter @hd/web exec vitest run src/modules/vehicles/public-query.test.ts src/modules/vehicles/public-presentation.test.ts src/modules/vehicles/infrastructure/public-api.test.ts
```

- 纯 Node 金额诊断用于确认初版 CF-02；没有网络。
- 最新 `pnpm --filter @hd/web exec playwright test tests/catalog-filters.spec.ts --list` 成功列出 **10 个场景**，仅列举，不是 10 个通过。
- 读过 10 场景源码：三语 SSR/选项/响应式、全部条件全量分页/Back、非法查询与重复参数、原币/未知、无 JS、model-only、精确大金额及基础 URL 重置。未运行浏览器或 HTTP。
- 根反馈的首轮 51 浏览器通过属于修复前成品，未计入本报告对最终源码的通过项；root 的 763 单元/7 边界/构建也不是本 Reviewer 的实际执行。

## 未覆盖与验收交接

需根在含三项修复的最新 standalone 成品实际执行新 10 项与相关 hover/联系/收藏/429/导航回归；核对三语、320/390px、no JS、真实 API 全目录查询与元数据。视觉与用户业务确认、真实零公里资料、Safari/手机真机、最终提交/镜像绑定不在本次只读审查的已验范围。若新成品仍失败，按实际失败重新打开对应项，不能沿用静态闭合当最终通过。

## 最终指纹

主范围 9 文件及只读联通/契约上下文逐文件 SHA256 如下。上下文列举不代表本 Reviewer 对 BE/本地化全实现代签；文件变化后需按新内容增量复查。

| 范围 | 文件 | SHA256 |
| --- | --- | --- |
| 主范围 | `apps/web/src/modules/vehicles/public-query.ts` | `419312be194bb6223485abc02471908c22ad05ba1ce6232d1d78f6ef77d9253a` |
| 主范围 | `apps/web/src/modules/vehicles/public-query.test.ts` | `46b0ea43ba55a42f885a2e15a52345762d9f23b447b3178b0bfe449d4c797561` |
| 主范围 | `apps/web/src/modules/vehicles/public-presentation.ts` | `05c8c7350e2f341767407e34079aa64e3a73a3b1a8df9c1ec6b539218ed3facb` |
| 主范围 | `apps/web/src/modules/vehicles/catalog-filter-copy.ts` | `41a5e7a83b33e48c80154da148bb1176838b1e7926f51b4b5b5310daeee1baec` |
| 主范围 | `apps/web/src/modules/vehicles/ui/public-vehicle-filters.tsx` | `c30a1882c0fc76999f3f58c0d160d711b03205e1e46fe197e11588684e191a75` |
| 主范围 | `apps/web/src/modules/vehicles/ui/public-vehicle-list.tsx` | `3658b816e090eab9670c121b085cbc362e0f78b28ee2d7150eb7984e8f05cf93` |
| 主范围 | `apps/web/src/modules/vehicles/ui/public-vehicles.module.css` | `590fb6e9ca1568be480c4dd8a778b65dc8cf380d0e4f2de8b426fa73c44e4d0d` |
| 主范围 | `apps/web/tests/catalog-filters.spec.ts` | `12967d8d126ac60a7f4238d06da5bfdc9f0cdcf63149308eb22efc0e4ee363a7` |
| 主范围 | `apps/web/tests/fixtures/public-api.mjs` | `fd52bea94d6c26dc48ce7eed8a6823cd57467f1d84adb3ba54a61b69cf0e1bc8` |
| 只读上下文 | `apps/web/src/modules/vehicles/infrastructure/public-api.ts` | `76768c567a7d595e897c201c1d45cbb27e936a000e1de03d3e3f14248e7160b9` |
| 只读上下文 | `apps/web/src/modules/vehicles/infrastructure/public-proxy.ts` | `6676e4d9f41444b61861f354cec0f2aa98ae7ac4038a530689d98f613b4b42a8` |
| 只读上下文 | `apps/web/src/app/[locale]/cars/page.tsx` | `96bd500ec5d6cc165b75093aed58584aefaca5c9408dc4ec537885942995659e` |
| 只读上下文 | `apps/web/src/modules/vehicles/public-presentation.test.ts` | `42f3bcbd9f7e7698fa37bc86a419595916ef304312a4245dbddd1dd82ef0c07c` |
| 只读上下文 | `apps/web/src/modules/vehicles/localized-projection.ts` | `d8206fc62a76e87bcfc38c7efe5fd570b5ccf38836c1af7ab6b378b566e30218` |
| 只读上下文 | `packages/contracts/src/public.ts` | `cdd08524e5b1adf93804d8e00a5c7aac892ffe036b72a5572553ebf5cf5cb929` |
| 只读上下文 | `packages/contracts/src/common.ts` | `cfbdc352c77b6350c5a0b1cb5776350518baf4e8937bc03a8fa692d0323c8cef` |
| 只读上下文 | `packages/contracts/src/localization.ts` | `312f7ae02c58443a694b3d5a10ae249ff5a84fb48dffd0942a1ccb76bd4137a6` |
| 只读上下文 | `apps/api/src/vehicles/service.ts` | `d2f97b1f6fc2677a5f11efc29d50dc0ffe70d353ab7b9c13b91fed151c9d385d` |
