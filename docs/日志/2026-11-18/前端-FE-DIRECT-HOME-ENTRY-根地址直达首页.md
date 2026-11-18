# FE-DIRECT-HOME-ENTRY 根地址直达首页

- 固定 FE 工作区 `../websit-worktrees/fe`，分支 `codex/fe-direct-home-entry`，基线 `c16d0af5f0d455e18a19ddcc42d2b0f19939cf90` 与线上标签 `v1.0.12` 一致。保留既有生成文件编辑和 11 月 16 日日志。
- 线上根地址返回 HTTP 200，正文是俄语「正在打开首页」。浏览器脚本执行 `window.location.replace('/ru/')` 后才进入俄语首页。直接访问 `/zh/` 或 `/ru/` 返回首页正文。
- 根入口改为由 Next 服务端按 `routing.defaultLocale` 直接返回 HTTP 307。默认仍是 `/ru/`，删除已无调用的客户端过渡组件，并将无 JavaScript 测试改为验证直接跳转。显式的中、英、俄首页地址各自打开对应首页。
- 隔离生产构建、TypeScript、模块边界、钩子和差异检查通过。三项 Chrome 覆盖原始 HTTP 307 与 Location、三语首页直达、无 JavaScript、计算器入口及品牌 404。独立增量审查 `cache_api_review` 通过。
- 本地 3363 一度因为 FE 的共享契约生成物仍是旧版本返回 500。重新构建本工作区的契约后，根地址 307 指向 `/ru/`，`/zh/` 与 `/ru/` 均返回 200。
- 待验收。本轮修复尚未提交或上线。
