# FE-DETAIL-TOUCH-DESTINATION 详情目的国触屏

- 固定 FE 工作区 `../websit-worktrees/fe`，基线 `c16d0af5f0d455e18a19ddcc42d2b0f19939cf90`。当前工作区的首页入口修复、品牌搜索及先前文件编辑独立保留。
- 使用用户给出的线上车辆详情复现。iPhone 13 触屏模式 WebKit 的指针落在 KZ 按钮上。随后选择器先发生 `relatedTarget=null` 的失焦，原处理立即关闭菜单，选项收不到 click，目的国仍是 RU。同期 Chrome 触屏模式将焦点移到按钮，可选择 KZ。
- 详情费用计算器只在焦点移到已知外部元素时由失焦关闭菜单。点击外部仍由指针事件关闭，选择国家和按 Escape 仍保留关闭及焦点恢复。计算规则、车辆参数和目的国数据读取沿用现有路径。
- 隔离官网生产构建、TypeScript、4 项计算器单测、3 项 Chrome 浏览器测试及 1 项 iPhone 模式 WebKit 自然点选通过。验证 KZ 切换、KZT 金额、外部触碰和桌面断点。独立审查 `rel103_facets_review` 通过。
- 用户授权与品牌搜索一同上线。本次前端候选基线为 `v1.0.12`，由 OPS 运行发布门禁和生产切换。
- 2026-11-18 13:40:30（北京时间）生产切换至 `v1.0.13`，合并提交 `19519671617e329f1d21e21160e1feb73af4dbf9`。前端用 iPhone 13 模式 WebKit 复查用户给出的生产车辆页面，点选哈萨克斯坦后选项生效，费用显示 KZT。实体 iPhone 未测试。[发布 PR](https://github.com/louisvotton2-code/HD_Auto_Export/pull/33) · [CI](https://github.com/louisvotton2-code/HD_Auto_Export/actions/runs/44245388550)
