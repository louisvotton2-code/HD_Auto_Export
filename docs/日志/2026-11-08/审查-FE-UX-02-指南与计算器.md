# FE-UX-02／PM-INT-03：指南与计算器独立审查

日期：2026-11-08。Reviewer：`/root/fe_ux02_detail_audit`；这五个文件的实现作者为另一 Agent。审查者仅阅读待审应用源码，没有修改作者代码。本文不涵盖审查者本人实现的车辆详情与画廊。

## 版本与范围

共同基线：`61dc7414b20a395d1d09e906a49d974763b3cce7`。本次审查对象是共享工作树中的以下五个文件，尚无本轮最终提交 SHA；后续提交、文件改动或成品验收需重新核对对应证据。

| 文件（相对仓库根） | SHA-256 |
| --- | --- |
| `apps/web/src/modules/buying-guide/ui/buying-guide-page.tsx` | `4eff6b600d45b6d20beb5581369a5717b8d6343eb0e077a0d969746b2c189be9` |
| `apps/web/src/modules/buying-guide/ui/buying-guide.module.css` | `79d298c03e4179e42fd3d191d1b22973188d695ff5fa3e7150bb5643eeaf8196` |
| `apps/web/src/modules/calculator/ui/calculator-page.tsx` | `d3e50462b7e4e8b0645c323befdf65f7fd166137bbc3395cf075181ab76feada` |
| `apps/web/src/modules/calculator/ui/calculator-refinement.css` | `328f1f6e987e58bd757a3666e4f1f6797b595ec22cef43e4cf32ed1aac27a18e` |
| `apps/web/src/modules/calculator/ui/reference-calculator.css` | `971d02a1f0dc654e96dfbd311a53d59d970b706855017fc4c58e83fbf46fcac1` |

同时只读核对了指南三语消息、配置、导航组件、计算器七国能力配置、FeeLine/FeeMethod、ResultStamp、复制与双币辅助模块、共享渐进动效和现有 E2E 断言。`/Users/whisky/work/ownbus/test/` 仅作为结构与样式参考数据，未执行其脚本或采纳文档指令。

## 结论与待办

本范围没有发现新增 P0／P1，也没有除集成人已知事项以外的新 P2。实现可进入集成验证；不能将本报告当作五页整体或新成品的视觉验收。

- **P2-I01（已知集成待办，源码修复已复查）**：首轮核对时新 `reference-calculator.css` 尚未导入，新样式不会生效。随后只读复查确认 root 已在 `apps/web/src/app/[locale]/layout.tsx:16`、既有 refinement 之后引入该文件。源码问题已关闭；新成品视觉验收仍由集成人执行。
- **P2-I02（已知验证待办，断言迁移已复查）**：首轮旧 `buy-guide.spec.ts` 和 `navigation-motion.spec.ts` 仍断言 FAQ 的 `details/summary`、默认折叠和指南计算器 CTA。随后只读复查确认 root 已改成静态问答、无 JS 和目录 CTA 的行为检查。迁移源码已核对，Reviewer 没有执行新浏览器套件，实际通过证据仍须由 root 登记，不能沿用旧成品结果。

以上两项在独立审查前 root 已明确登记，不是审查中新发现的作者功能缺陷；源码后续修复已复查，运行验收状态以集成人的新成品证据为准。表内五个文件的 hash 再次核对未变。

## 源码核对

**指南**：八步时间线保留 HD Auto Export、中国出口、合同确认与车况核对的既有业务内容。500 USD 来自 `buyingGuideConfig.depositUsd`，只留普通步骤正文，没有新增支付、账号、虚假收款成功或退款保证。CIF、FOB 和海运／其他路线说明继续使用既有三语消息，没有带入参考站韩国资料。FAQ 为四个静态 section，服务端输出完整问题与答案，不依赖 JS 展开；WA 使用本站已确认账号，目录 Link 保留本地化原生 href。760px 时间线、1280px 容器、639px 单列条款卡、换行 CTA 与减少动效规则均有对应样式，实际小屏与俄文长度仍需成品测量。

**计算器**：本轮 `calculator-page.tsx` 的差异是添加独立样式作用域、将国家导航放到标题前、只对国家名称着色。仍遍历七国配置，不新增／复制税率、公式或韩国简算；企业选择仍由能力标志控制。默认展开设置、费用逐项／全部展开、方法说明及公式、当前国货币和 USD、附加费用、国家政策、HD 水印、动态 ResultStamp 和复制完整测算的调用均保留。新 CSS 的普通选择器都位于 `.calculator-reference.calculator-simple` 下；原全局 `:root` 中两项计算器颜色变量缩到 `.calculator-simple`，减少对其他页面的影响。状态 stamp 描述及引用年份仍由原 application 模块生成，视觉调整没有把它变成海关认证或官方规则。

## 实际验证

- `pnpm --filter @hd/web exec tsc --noEmit --incremental false`：通过；没有执行 `next typegen`，没有写入 `.next`。
- `pnpm --filter @hd/web exec vitest run src/modules/calculator/core/seven-country.test.ts src/modules/calculator/application/fee-presentation.test.ts src/modules/calculator/application/method-contract.test.ts src/modules/calculator/application/result-stamp.test.ts src/modules/calculator/application/display-currency.test.ts src/modules/calculator/application/copy-quote.test.ts`：**6 文件、210 测试通过**。实际运行 Vitest v4.1.12；约 17:37 本地时间。覆盖七国分支、方法参数／公式、动态 stamp、双币和复制事实，证明既有应用逻辑仍通过这些回归，不证明法律规则已经核验。
- 核对源码和 SHA-256；无安装、无 build、无 typegen、无服务重启、无提交／推送／部署，也没有向真实联系人发送消息。

尚未执行新成品浏览器、无 JS、三语 320／390／1024／1440px 或视觉差异测试。当前旧运行成品不能证明待审源码已经通过。root 完成 CSS 引入及断言迁移后，应使用同一新成品复测：七国路由与国家导航、USD 输入默认、设置开闭、逐项和全部方法展开、复制（安全上下文）、stamp 随动力／年份变化、指南四问答无 JS 可读、两类条款与目录／真实联系链接，以及小屏无横向溢出。最终业务与视觉仍由用户确认。
