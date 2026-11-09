# 前端 / FE-EXT-01 / 合成车源联调

日期 2026-11-10（Asia/Shanghai）。状态为合成联调通过，待真实样本联调。

## 范围与版本

- 分支 `codex/acceptance-polish`，共同基线 `fd16e00e23db8b8956f0c398ab1c198e82a61bc2`。本轮是官网外部车源切片，前轮配件与页脚另有冻结范围。`docs/协作/前端.md` 记录两个任务的状态。
- 合成联调用 Node `24.19.0`。官网 standalone 为 `HJgUnjWNJtUV7jraaNWPL`，来自本轮官网源码和当时的已编译 `@hd/contracts`，成品保存在忽略目录 `docs/private/local-acceptance/releases/fe-ext01-HJgUnjWNJtUV7jraaNWPL`，29 个符号链接均解析到该成品内。`3359` 指向 BE 的随机库合成服务 `3358`，API 入口产物 `apps/api/dist/app.js` 的 SHA-256 为 `4f104a3efd0d0f8146502393e342fd8dc2c2740fbfee51ff381bd40fb7daf052`。`3353` 保留原页脚验收版本。

## 实际变更

- 统一目录按 API 顺序渲染员工发布和外部车源。首页总数读取合并统计，包含动力未知车辆。后台配置仍决定首页车轨。旧投影及 sitemap 遍历限定原员工发布流。列表和首页只接收外部摘要。
- 详情支持同车原文与当前文本、实际语言标签、配置、检测资料及关联挂牌。争议字段单独标出。未核验的年款与独立登记信息分别处理，外部参考价保留 CNY，缺价显示待询价。
- 首页、目录、收藏与详情共用图片回退行为。坏图异步上报媒体 ID 和修订号并有界去重。画廊照片全部移除会关闭查看器、释放滚动锁和恢复焦点。维护入口见[首页与车源](../../开发/模块/首页与车源.md#fe-ext-01-统一目录与外部资料)。

## 验证结果

| 环节 | 本轮实际结果 |
| --- | --- |
| 官网本地检查与构建 | `pnpm hooks:check`、`pnpm --filter @hd/web check`、`pnpm --filter @hd/web build` 通过。TypeScript、7 项边界、766 项单元、42 页构建完成。 |
| Chrome 合成接口回归 | `HJgUnjWNJtUV7jraaNWPL` 首轮 47 项中 46 通过。唯一失败是测试精确匹配画廊按钮时漏计已有 `⛶` 字形。修正测试定位后，4 项外部车源复跑全过。最终 10 个测试文件 95 项全过，覆盖目录、筛选、卡片动效、首页、照片、收藏、车辆预算和联系入口。 |
| Chrome 加隔离 API／PostgreSQL | 14 组通过。三语共 200 条合成可见记录（1 员工发布，199 外部记录），员工车辆居首，第二页和末页互不重复。首页 200 包含动力未归类项，legacy 只有员工发布。CNY 精确边界、USD 独立、目录 SSR、原文及检测资料、俄语 320px、冲突年款与登记日期分离、无图无价、已过期不请求、撤回 404 和中文无 JS 均通过。 |
| 图片故障信号 | 浏览器只发送一次该媒体修订号，回执 202。请求无 Cookie，远程图不发 Referer。页面立即提供故障状态，重试图片不会重复发信号。同版 BFF 实测独立媒体入队 202 `queued=true`，相同修订号去重 202 `queued=false`，错误修订号 404。首轮 13 组已过，最后一组误尝试从浏览器读取主动丢弃的响应体，复测改用浏览器检查状态与请求、HTTP 客户端检查队列响应。只写两条隔离库合成媒体信号。 |

浏览器回归测试文件为 `external-catalog`、`public-freshness`、`catalog-filters`、`home-stats`、`vehicle-favorites`、`catalog-motion`、`home-vehicles`、`public-catalog`、`vehicle-contacts` 和 `vehicle-estimate`，后缀均为 `.spec.ts`。最终 Playwright 本机证据位于 `/private/tmp/hd-auto-ext01-final-chrome/`。隔离联调脚本与结果位于 `/private/tmp/hd-fe-ext01-live-check.mjs` 和 `/private/tmp/hd-fe-ext01-live-evidence/result.json`，结果 SHA-256 为 `5c08df0d87724d01a546812408bcf1de8c120d05d9f4ea507d044bf7f13190ce`。

独立审查见[展示层](审查-FE-EXT-01-外部车源展示.md)和[数据与图片信号](审查-FE-EXT-01-公开数据与图片信号.md)。浏览器和数据库联调均绑定上述成品。后续共享契约校验调整在源码增量审查中另行记录，最终整合版本需要重新构建验证。

## 交接

- 官网已停止自己的 `3359` 进程，`3358` 交还 BE。前轮 `3353` 独立验收成品继续运行。
- 真实样本已由 PM、PA 与 BE 交接。待 BE 提供独立样本窗口后核对原文、试译和原始图片。真实供应商响应、图片刷新任务、实量及计费不在本轮证据范围。未提交、推送或部署。
