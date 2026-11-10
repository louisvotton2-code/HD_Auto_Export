# 前端 / FE-UX-05 / 公共页脚联系图标

日期：2026-11-09（Asia/Shanghai）
状态：待验收。

## 范围与版本

分支 `codex/acceptance-polish`，HEAD `fd16e00e23db8b8956f0c398ab1c198e82a61bc2`。保留前轮未提交的配件刷新改动和用户 `.vscode/`。本轮范围为共享页脚联系展示。

## 实际变更

- 对照用户本地 `test/src/components/layout/Footer.tsx` 和 `Icon.tsx` 的联系方式图标、地址标记与社媒视觉。电话和地址走共享 `Icon`，微信、Telegram、WhatsApp、Facebook、Instagram、TikTok 使用共享 `SocialIcon`。
- 页脚入口使用左侧图标和文字，窄屏保持两列。图标为内联 SVG 并对辅助技术隐藏。保留已配置的号码、平台链接、微信复制和付款参考文案。新增图形无外部资源请求或依赖安装。

## 验证与限制

- `pnpm hooks:check`、官网 `check` 及 `build` 通过，含 TypeScript、7 项边界检查和 763 项单元。最终本地 BUILD `Nawdb3bfTqIEb7yht4KM1`。
- 实际 3353 成品上的 Chrome 既有联系方式／剪贴板和页脚导航测试 2 项通过。另检查中文配件 1440px、英文购车 768px、俄文计算器 390px 及俄文配件 320px。每页 8 个联系入口的 SVG 均有可见尺寸，图标、文字和入口宽度对齐，页面无横向溢出。查看桌面和手机截图 `/private/tmp/hd-auto-footer-visual/`。[独立审查](审查-FE-UX-05-公共页脚联系图标.md) 已核对最终六个源码文件、原联系方式与既有图标兼容，未发现问题。

## 交接

3353 从独立目录运行新成品（PID 658），车辆 API 指向本机 3325。旧成品目录保留，本轮未提交、推送或公网发布。用户验收入口 `http://127.0.0.1:3353/zh/parts/#contact`。
