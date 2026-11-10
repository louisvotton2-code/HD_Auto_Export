# FE-UX-05 页脚付款方式卡片独立审查

日期：2026-11-09（Asia/Shanghai）

审查者：`/root/fe_ux02_reference_audit`。基线为 `fd16e00e23db8b8956f0c398ab1c198e82a61bc2`。本轮审查 `FooterPayment`、`SiteFooter` 接线、银行图标及付款区样式。前轮的联系图标和配件改动各有独立审查记录。

## 审查结果

本快照未发现 P0 至 P3。四张卡片与本地参考的布局一致，付款确认提示继续来自本站三语文案。

- 参考 `test/src/components/layout/Footer.tsx` 和 `test/src/styles/original/components.css`。付款区是宽度上限 260px、12px 间距、卡高 64px 的两列网格，容器较窄时列宽随容器收缩。桌面和手机截图都显示完整的两行卡片与确认提示。
- PayPal 和 Visa 使用与参考逐字相同的 SVG `path` 数据。Mastercard 继续使用重叠双色圆和橙色交叠图形。银行转账使用共享 `Icon` 的 28px 银行图标。组件通过 React SVG 元素和静态属性渲染图形，翻译作为普通文本渲染。
- 卡片使用四项原生列表，显式 `role="list"` 保留无列表标记时的语义。每项有屏幕阅读器可读名称，SVG 均为装饰并设置 `aria-hidden`。卡片以静态 `li` 呈现，只有展示语义。页面继续请访客向销售确认付款选项。
- 悬停位移限定于支持悬停、使用精细指针且允许动效的媒体条件。触屏及启用减少动效的环境保持静止布局。

## 证据与执行归属

- 本审查者执行 `pnpm hooks:check`、相关文件的 `git diff --check`、PostCSS 解析及 PayPal/Visa 原路径比对，均通过。另只读核对三语的标题、银行转账名称与确认提示，并查看实现者保存的两张截图。
- 实现者报告官网检查 763 项单元及 7 项边界通过，standalone 成品 `DuP--pmudVK_KJfInC1q9` 构建通过，3353 的付款／联系方式 Chrome 回归 1 项通过。实现者另运行三语四宽的临时付款区探针。首轮探针硬编码了错误的俄语标题，改为读取本站三语文案后，在同一成品全部通过。浏览器与构建证据由实现者执行，本结论来自对源码、截图和记录的独立复核。

| 文件或截图 | SHA-256 |
| --- | --- |
| `apps/web/src/shared/ui/footer-payment.tsx` | `b618c66594079f339a7759a6237c8cb5905d984a2205d4f30e9346a6472a6c23` |
| `apps/web/src/shared/ui/site-footer.tsx` | `6253a0767ebaf8a81398aa9cbd4448cdc910c369c24eea00b795508a2f4d32fd` |
| `apps/web/src/shared/ui/icon.tsx` | `384757c3e99b5fe207dcfa7220ea9da4b518e7a9b9f8b67118dcfb57b6a24058` |
| `apps/web/src/shared/ui/site-shell.module.css` | `4080c0cb9c7dfb74c37d4d21669e6f8c920f73a2a24adb49beccd1e1b000e82c` |
| `/private/tmp/hd-auto-payment-visual/payment-1440.png` | `84a545efc7fe1dbf5d71b01463872e14c6c1e30d4cacdead8df1480f6601c1ad` |
| `/private/tmp/hd-auto-payment-visual/payment-390.png` | `022c0a8c837f240f7425e1f3db02a701cac1ae88126c62c73170f52a30287ac1` |

审查结论绑定表中的四个代码文件。
