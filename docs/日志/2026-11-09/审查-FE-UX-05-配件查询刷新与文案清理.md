# FE-UX-05 配件查询刷新与文案清理独立审查

日期：2026-11-09（Asia/Shanghai）

审查者：`/root/fe_ux02_reference_audit`。实现者：root。基线为 `fd16e00e23db8b8956f0c398ab1c198e82a61bc2`，分支 `codex/acceptance-polish`。本次审查覆盖配件模块四个文件、两个浏览器测试和相关前端文档。

## 审查结论

本次快照未发现 P0、P1 或 P2。两处查询的文档刷新、URL 条件保留、12 条静态资料和原有详情入口符合本轮范围。文案一致性与回显测试各有一项非阻塞 P3，已通知实现者。

| 核对项 | 源码结果 |
| --- | --- |
| 两处查询 | 首屏表单使用原生 GET，隐藏字段保留已应用类别等条件。目录内输入和按钮以 `form="parts-filters"` 关联侧栏 GET，提交当前关键词、类别和其他控件。删除旧的提交拦截及历史替换。服务端解析 URL 并将条件传回页面。 |
| 条件回显 | 两个关键词输入读取 `query.q`，类别单选读取 `query.category`，快速浏览对应链接显示当前类别。搜索、筛选和排序控件按已解析条件设置初始值。头部回到干净 URL 后会用对应的表单 key 还原默认值。 |
| 固定条目和详情 | 列表取资料库前 12 条，与基线原有有效条目相同。资料库 44 条。只读脚本确认前 12 条的 slug 合法且唯一，各有本地图片文件。每张卡以真实 slug 连接原详情路由。占位卡和模拟页码分支已移除，目录计数取实际显示条数。 |
| 三语清理 | 搜索占位符只描述可输入的字段。演示提示、完成提示、示例卡片及模拟总数的中英俄 key 均删除。活动模块及配件路由的源码扫描未找到旧演示分支或示例提示。 |
| 收藏与排序 | 收藏仍用全资料库有效 ID 校验和原存储键。浏览器持久存储可在刷新后恢复，存储被拒绝时保留当前文档的内存操作。排序控件借用同一 GET 表单并按 URL 回显，按本轮固定列表要求保留原条目顺序。 |
| 测试保留情况 | 两处搜索都等待实际 document 响应。用例继续检查固定条目、关键词返回恢复、三语文案、404、数量草稿、无 JS 详情、图库关闭和收藏持久性。布局测试只把条目数改为 12，列数断点、过滤区相对位置、操作区及横溢出约束保留。 |

## 非阻塞发现

1. **P3 文案与固定结果的口径差异。** `parts-content.ts` 的中文 SEO 文案仍称可按配件号、类别与参考价格筛选，俄文仍称可按这些条件搜索。三语空收藏提示也把空状态归因于筛选。当前 GET 只负责刷新与回显，列表保持固定。后续整理文案时可把 SEO 描述改成对目录资料的陈述，并直接说明当前暂无收藏。
2. **P3 回显测试范围。** `parts.spec.ts` 对首屏查询核对类别出现在文档 URL，且在 Back 时直接断言关键词输入值。排序用例核 URL 和固定顺序。目前类别 radio、快速浏览选中状态和排序下拉值由源码核对，浏览器用例还未直接断言这些控件的刷新后状态。无 JS 用例也通过已有查询 URL 进入目录，覆盖原生数量提交，但没有在该 context 点击配件搜索。

## 实际核对与证据

- 本审查者运行 `pnpm hooks:check` 和 `git diff --check`，均通过。另只读核对配件 JSON、slug、图片文件、详情路由及相关 diff。详情路由、repository 和资料 JSON 与基线一致。
- 763 项单元测试、7 个边界检查和 17 项定向 Chrome 是实现者报告的实际执行结果。实现者报告定向通过后只移除 CSS 文件末尾空行，并开始构建最终成品。本审查记录对应下表文件。实现者在最终日志补录成品与浏览器证据。
- 审查者只读处理代码和记录。预览切换与浏览器执行由实现者负责。

| 文件 | SHA-256 |
| --- | --- |
| `apps/web/src/modules/parts/content/parts-content.ts` | `32490ad55c71b0ac0af0a8fe2e0bec59815154b7d68fc92cef5bfc5d2a15bf05` |
| `apps/web/src/modules/parts/ui/part-card.tsx` | `0eba13887395cfa09ea85ef7cff60b723858db991ae61259cdd125939a7d6660` |
| `apps/web/src/modules/parts/ui/parts-catalog.tsx` | `d2e6bff18a66cc0fcb2dce491f336cc1231fdb4d446d39fe2f1eba6fcc8144f9` |
| `apps/web/src/modules/parts/ui/parts.module.css` | `c2709adc9a9ba6bac02d1f3ec4e94553a3f9e7db5bf5c90104d2fe6dbfea0e1e` |
| `apps/web/tests/parts.spec.ts` | `2342bc38875285bc81148fa861361741f05b9e9481dd96b140ca4e210c5dd5c8` |
| `apps/web/tests/parts-layout.spec.ts` | `a6147a93fe59e023495033d72582d4ceff7e7de5a94d2690c5219d52095f2d71` |
| `docs/协作/前端.md` | `efd3b94c781692e90c7c04c7a54bed91e0e296dd09414871806d64956c324ac1` |
| `docs/开发/模块/配件目录.md` | `749f182f2a0dc1446b1b0e0cb0942956f8eb679aed18beff804eb856b82d78f0` |
| `docs/日志/2026-11-09/前端-FE-UX-05-配件查询刷新与文案清理.md` | `0cc491f8a8674541c1575ad1169a5a2580d041454e6410a10de43aec0a570805` |

## 两项 P3 最终复查

- 三语 SEO 描述已改为配件资料、编号、参考价和适配咨询。空收藏直接提示暂无收藏，空态链接指向全部配件。文案一致性问题闭合。
- 搜索用例现直接检查类别单选已选和快速浏览当前入口。排序用例核刷新后下拉值及原条目顺序。俄语无 JavaScript 用例实际填写并提交查询，再核 URL、类别及 12 个条目。回显覆盖问题闭合。
- 首轮补强有 4 项失败。实现者排查发现类别选择器同时命中首屏隐藏字段和侧栏单选，修正为 `input[type=radio]`，保留 `toBeChecked()`。实现者报告在 3353 的最终成品 `624315c6szlcDA36xvH5K` 执行 `parts.spec.ts`，8 项全部通过。该数字对应此文件的末轮复验，前述 17 项属于先前定向运行。本审查者复核源码并执行 `git diff --check`，浏览器证据归实际执行的实现者。

| 最终代码及测试 | SHA-256 |
| --- | --- |
| `apps/web/src/modules/parts/content/parts-content.ts` | `434e6d91133b7c9eed26968c2a84edd61d301e248e20945cb19f9b0db6554b8a` |
| `apps/web/src/modules/parts/ui/part-card.tsx` | `0eba13887395cfa09ea85ef7cff60b723858db991ae61259cdd125939a7d6660` |
| `apps/web/src/modules/parts/ui/parts-catalog.tsx` | `9751e3fe7aded697f6b775783eb834a6367877fd6b87d147f0c6e1636dffec14` |
| `apps/web/src/modules/parts/ui/parts.module.css` | `c2709adc9a9ba6bac02d1f3ec4e94553a3f9e7db5bf5c90104d2fe6dbfea0e1e` |
| `apps/web/tests/parts.spec.ts` | `0a05bae15618b0d7e8e9b07bcdc6857b2c78a0b88a07c1c90fc116fd7ccce310` |
| `apps/web/tests/parts-layout.spec.ts` | `a6147a93fe59e023495033d72582d4ceff7e7de5a94d2690c5219d52095f2d71` |

以上最终快照内两项 P3 均闭合，未发现新增 P0、P1 或 P2。
