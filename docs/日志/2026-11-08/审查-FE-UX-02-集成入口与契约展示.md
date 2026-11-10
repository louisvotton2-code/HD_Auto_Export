# FE-UX-02／PM-INT-03：集成入口与契约展示独立增量审查

日期：2026-11-08（Asia/Shanghai）。Reviewer：`/root/fe_ux02_detail_audit`。本次十三文件由 root 集成人负责实现，不是 Reviewer 的详情／画廊实现范围；仅只读审查应用源码，唯一写入为本文。

结论：**这十三文件未发现未处置的 P0／P1／P2，可合入本轮源码审查覆盖。** 不替代整轮最终提交审查、浏览器实测、真实性能补采或用户业务／视觉验收。

## 快照与文件指纹

- 共同 HEAD／基线：`61dc7414b20a395d1d09e906a49d974763b3cce7`；待审实现仍在共享工作树，不把该 HEAD 当成包含本轮实现的提交。
- root 最终 241 文件清单：`/private/tmp/hd-fe-ux02-final-scope.json`；Reviewer 实际读取并计算 SHA-256，结果为 `2e82314c6b1a9376b19f00cf8ed2165ccb51ccae5022d4ed023cc5e7d840eab9`，与指定值相同。
- 清单 `buildId` 与磁盘 `apps/web/.next/BUILD_ID` 都为 `jxupsT7lU7eVFHhjD1W8y`。这只确认标识和文件清单一致，源码到成品的构建／测试证据仍由集成人提供，Reviewer 没有重建成品。
- 下列 **13/13** 文件的实际 SHA-256 均与该清单逐项匹配；未将另外 228 个文件默认为本报告已审。

| 待审文件（相对仓库根） | SHA-256 |
| --- | --- |
| `apps/web/src/app/[locale]/page.tsx` | `00ff924d48b9106055a80b512a974f688eb4a3d2a4c7557d743b90aed19745d0` |
| `apps/web/src/app/[locale]/cars/page.tsx` | `49f73d5898e9650b6d78399289352787e6c58e6b8f672546f984728395ef74f1` |
| `apps/web/src/app/[locale]/cars/[slug]/page.tsx` | `cb4d279efa4010204d497867aac49986ccf2af2eac4714c1c78be65c90ec57a5` |
| `apps/web/src/app/[locale]/layout.tsx` | `131f889e3e7f336003f92d22b06f1a89df7d732cea2589056a1d7fa6a43f85f1` |
| `apps/web/src/app/globals.css` | `53f766a59093e98920cf3e15bfee1c41b7809988245ee55198374ab4965ed066` |
| `apps/web/src/modules/home/index.ts` | `bb23fb53999f83570737f75bb231aab56e6f79799fba3d206ad03b8fa61bdd90` |
| `apps/web/src/modules/vehicles/index.ts` | `cdbcbef12d2629f71def0af5eb90b1b3f38c59ae4f862e772c7594254c22f898` |
| `apps/web/src/modules/vehicles/live-copy.ts` | `ac41c9d4d50d925ab12b6515f19a3fa7c67ab5e521bb4aef4682fb469b0db533` |
| `apps/web/src/modules/vehicles/public-presentation.ts` | `04316b701faeb530f77798b3ece95190d224f75bfef6d1627725b92617027687` |
| `apps/web/src/shared/config/vehicle-display.ts` | `36aa0a61cfa701044d119ff45f1bda54dfa0c9942ba9fbd5acbaa2cc486c44bd` |
| `apps/web/src/modules/vehicles/infrastructure/public-api.test.ts` | `b5bc892a8942158243232fe3ad97b40d20a1168ef7464f91211a005ba23dc4da` |
| `apps/web/tests/public-catalog.spec.ts` | `8c2b9e7091d900601f0ebf87737329a59ce6ad5ecb489906de749c57f8ef882b` |
| `apps/web/README.md` | `824e6435b30e21b3cb68f4c25fa40ff72d5ed4b7760ac404e13140ac8b3cafb5` |

## 核对结果

**路由、语言和数据装配。** 首页、目录与详情先验证三种 locale，再执行请求时读取；首页和目录以 `key={locale}` 隔开客户端初始状态，详情以 `${locale}:${vehicle.id}` 隔开语言／车辆。公开 HTTP 装配来自 `vehicles/server`，没有将 API origin、员工会话或内部错误传给客户端 props。首页与目录使用 `Promise.allSettled` 区分主数据与筛选服务故障；目录查询先经 parser 校验，不把非法分页或重复参数当正常查询。详情的临时 API 故障返回可读重试页和 noindex，实际缺失经 `notFound()`；无旧 mock slug 回落。补读的 adapter 按 id 和请求 locale 校验详情身份与 detailPath，404／400 缺失和 503 故障分开。目的国 props 从现有七国配置映射 slug，名称经显式 locale 的 Countries 翻译，不在详情复制税费规则。

**布局、样式和浏览器安全入口。** Locale layout 在既有 refinement 后导入 reference calculator CSS，再引入公共交互动效；新计算器样式已有独立作用域，未通过全局色变量改写其他页面。新增 globals 只包含资源状态提示、缺失页、浮层和禁用联系外观，没有隐藏／卸载 main 的刷新规则。持久布局只挂载无视觉输出的 InventoryFreshness；补读实现是局部失效与请求通知，没有 `router.refresh` 或 main 隐藏逻辑。两个模块 barrel 的新增展示出口没有反向导出 `server.ts`、server origin 或 HTTP adapter；旧 demo 能力保留兼容出口，实际三个公开路由已经使用公共 DTO 页面。

**公开事实与来源。** 展示金额按契约原币种和十进制文本格式化，大额整数使用 BigInt；待询价不构造 0 USD，也没有在展示层引入汇率／税率。未知制造时间、首次登记、里程、排量、功率和所在地保持待确认，modelYear 独立展示；有效的明确零里程仍可显示为零。封面按 isCover／sortOrder 选择，不改写输入数组，local media URL 经统一 helper 规范化。demo 使用非库存声明，external 总是第三方挂牌／未经 HD 核验文案，不把外部参考信息当可售自有库存。live-copy 三语当前 key 与语义一致，shared vehicle-display 的对应三语声明也一致。

**测试源码与失败路径。** public-api 单测实际覆盖参数校验、无凭据 no-store 请求、阻断 admin/auth/异常路径、404 与服务故障区分、隐藏内部错误、固定 thumb 变体白名单、禁止跟随重定向及拒绝非图片媒体。public-catalog 测试有独立 loopback fixture origin 和每次变更前的 suite health 标记，明确拒绝真实 3320；用例覆盖三语 SSR、草稿身份／未知不造零、分页／筛选 URL 恢复、空态／故障／恢复、发布／已售／下架、媒体与管理代理边界、320px 俄文无 JS。Back／Forward 用例确实断言旧可售状态消失、已售草稿改为类似车辆、下架恢复时显示缺失，以及重新请求详情返回 404；没有用“页面仍可见”替代删除校验。测试只生成聊天草稿链接，没有实际发送消息。

**维护文档。** README 已描述 Node／standalone、完整产物目录、公开 origin 与服务端 API origin 的边界、动态车辆和预生成计算器／指南的区别、最新成品与旧 out 的区别。启动脚本默认 loopback、Playwright 3100／3327 fixture 与 3317／3320 联调分离、Node24 锁定和不得并发写 `.next` 等叙述与所补读配置一致。关于 404、局部核对、待确认／外部／demo 及未知字段的说明与本轮实现相符，没有把 Git 推送或本机成品视作生产部署。

## 实际执行与未覆盖项

- 开工实际执行 `pnpm hooks:check`：通过，入口为本仓 `.git/hd-auto-hooks/pre-push`。
- 逐项读取十三文件及相关调用、比较差异、实际计算上述 SHA-256、核对清单数量与 BUILD_ID。补读代码只用于确认调用关系，不扩充本报告独立覆盖范围。
- 遵照唯一性能采样窗口要求，**未运行浏览器、HTTP 请求、Next、build、typegen、测试套件或服务操作**；未改应用、依赖、锁文件或已有成品。root 提供的 183 浏览器、658 单元和 Node24 关键 17 项通过属于集成人证据，本报告不代签或声称 Reviewer 重跑。
- 未提交／推送／部署，未接触旧服务器。最终 SHA、同成品全套测试与性能补采仍由 root／PM 核对，用户最终验收另行确认；十三文件发生变化需更新本报告的快照与复查。
