# 前端 / FE-UX-05 / 页脚付款方式卡片

日期：2026-11-09（Asia/Shanghai）
状态：待验收。

## 范围与版本

分支 `codex/acceptance-polish`，HEAD `fd16e00e23db8b8956f0c398ab1c198e82a61bc2`。本轮只改公共页脚付款展示，保留前轮配件和联系图标改动。

## 实际变更

- 按本地 `test/src/components/layout/Footer.tsx` 和 `test/src/styles/original/components.css` 的付款区，使用两列、64px高、16px圆角及12px间距。PayPal、Visa 和 Mastercard 使用参考项目中的图形并作为静态 SVG 渲染。第四张用银行图标对应已有银行转账选项。
- `FooterPayment` 统一渲染并保留三语标题、可访问名称与付款确认提示。卡片只提供参考展示，悬停上移2px并遵循减少动效设置。

## 验证与限制

- `pnpm hooks:check`、官网 `check` 和 standalone 构建通过，含 TypeScript、7 项边界检查和 763 项单元。BUILD `DuP--pmudVK_KJfInC1q9`。
- 最终本地 3353 成品的既有付款提示、联系方式与微信剪贴板 Chrome 场景 1 项通过。临时探针首轮在俄文标题的手写预期上失败，改读项目三语消息后在同一成品复跑全过。
- 复验覆盖中文1440和320、英文768、俄文390。4张卡片均为两列且高度64px，图标与三语可访问名称齐全，无整页横溢出。桌面悬停和减少动效均通过，已查看手机截图 `/private/tmp/hd-auto-payment-visual/payment-390.png`。[独立审查](审查-FE-UX-05-页脚付款方式卡片.md)通过，报告已绑定最终四个源码文件。

## 交接

3353 从独立目录运行新成品（PID 20662），车辆 API 指向本机 3325。用户验收入口 `http://127.0.0.1:3353/zh/parts/#contact`。本轮未提交、推送或公网发布。
