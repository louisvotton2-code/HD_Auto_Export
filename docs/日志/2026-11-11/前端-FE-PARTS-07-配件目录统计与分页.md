# 前端 / FE-PARTS-07 / 配件目录统计与分页

日期 2026-11-11（Asia/Shanghai）。状态为待联调。

## 范围与版本

- 共同基线 `409529c75ac02a660a8b6d8de04bcc517f23a582`，开发在 `/private/tmp/hd-auto-provider-operations` 的 `codex/provider-operations`。前端验证使用相同基线加官网改动的隔离 standalone 构建和回环测试服务。

## 实际变更

- 配件页首屏的目录规模参考为 1,200 条，按每页 12 条计算共 100 页。所有页码用现有一组配件卡片，结果栏和收藏都按当前可见条目计数。收藏模式隐藏页码。
- 三语目录表单保留原生 GET。分页提交表单的当前值，URL 回显页码和搜索条件。搜索、筛选与排序重新从第一页浏览。页码解析处理缺失、非法值及上下限。
- 延续配件目录样式、OEM 资料和咨询入口。数据仍来自原静态配件资料库。

## 验证与交接

- `pnpm hooks:check`、官网类型检查、783 项单测、7 项模块边界和 standalone 构建通过，BUILD `LtwHauKfja7a68gfps7T_`。最终官网差异 SHA-256 为 `b562dffe04fb5a0f6e93c4f868243bc588418d7d6cf21ddc1445576ed0bbe068`。
- Chrome 157.0.8103.39 最终 17/17。覆盖三语搜索及分页的整页请求、前进和后退、320px 无 JavaScript、首末页、收藏、详情 OEM 与咨询草稿。首轮 14 项通过，3 项因页号和下一页箭头的提交值相同而定位歧义。改用可见页码定位后整组重跑，重试关闭。
- 额外 Chrome 探针确认第 51 页原生 GET 保留含西里尔字母及 `&` 的关键词、品牌、类别、最低价、最高价与排序。320、390 和 1440px 页码均为一行且无横向溢出，分页 URL 使用基础目录 canonical 和 noindex。证据在 `/private/tmp/hd-parts07-fe.XXgM0eJc/` 的 `check.log`、`browser.log` 和 `pager.log`，临时端口已释放。
- `fe_main_ci_review` 对上述官网差异独立审查通过。验收范围为静态资料的目录界面和 Chrome，实际逐页配件数据及其他浏览器尚未验证。
- 官网改动和前端文档保留在共同工作区，待 PM 联调和提交。
