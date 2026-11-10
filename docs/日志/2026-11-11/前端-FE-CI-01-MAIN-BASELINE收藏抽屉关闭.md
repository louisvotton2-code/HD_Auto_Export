# 前端 / FE-CI-01 / 收藏抽屉关闭

日期 2026-11-11（Asia/Shanghai）。状态为待联调。

## 范围与版本

- PR #1 GitHub run `42852453850`、verify job `129956509151`。Linux Google Chrome 157.0.8103.50 中，上一轮三个场景已通过。官网 276 项通过，收藏抽屉用例初次与重试均在 `favorite-drawer.spec.ts:71` 读到 `overflow: hidden`。[CI 日志](https://github.com/louisvotton2-code/HD_Auto_Export/actions/runs/42852453850/job/129956509151)
- 共同基线 `82dc1cf775e77f3ede6370b7cddf5686473ed290`。独立工作区和 Linux 容器使用回环模拟 API，3363 保持原运行版本。

## 复现与修复

- 隔离 Linux Chromium 156.0.8078.79 重跑原用例 6 次，2 次在同一断言失败。Escape 和关闭按钮在启用及减少动效时均观察到 `open=false` 先发生，彼时页面仍锁定。锁稍后恢复，存在隐藏与恢复之间的短暂时差。
- `vehicle-favorites.tsx` 在显示抽屉时保存原有 `overflow`，统一关闭入口先恢复滚动，再调用原生关闭，并清理抽屉状态、还原焦点。卸载时释放滚动锁，延迟的原生 `close` 事件跳过已清理或已重开的抽屉。
- `favorite-drawer.spec.ts` 保留失效收藏项无链接的断言，先确认真实读取已发出并保持挂起，再按 Escape。捕获 `open` 属性移除时的精确 `overflow`，并验证请求由浏览器以 `ERR_ABORTED` 取消。新测试在原版成品上确定性失败，隐藏时实际值为 `hidden`。

## 验证与交接

- `pnpm hooks:check` 通过。隔离 Linux 的官网类型、782 项单测、7 项模块边界、standalone 构建通过，BUILD `g6GvNq04doTXwrqVVJCsw`。原失败场景定向重复 10/10，`favorite-drawer.spec.ts` 与 `vehicle-favorites.spec.ts` 15/15。macOS Chrome 157.0.8103.39 BUILD `4zlZx3GJaiLu1OpM7ogba`，定向 5/5。各组重试关闭。
- Linux 六组事件探针覆盖 Escape、关闭按钮、遮罩及两种动效偏好。六组均在 `open` 移除时保留原值 `auto`，焦点回到抽屉按钮。独立审查 `fe_main_ci_review` 无阻断，绑定官网差异 SHA-256 `95d8ecbaa118b22c5589570e2fdd246579ecbd3925f5f19a2e60a48472ab056d`。同一 JavaScript 任务中程序化连续关闭、重开的情况未纳入验证。
- 本机证据位于 `/private/tmp/hd-drawer-ci.Vp9JnRoe/`，包括 `baseline.log`、`red.log`、`linux-run.log`、`close-before.log` 和 `close-after.log`。完整补丁为 `/private/tmp/hd-drawer-ci.Vp9JnRoe/FE-CI-01-drawer.patch`。
- 本轮移交未提交的前端改动及文档。PM 在最终提交上重跑整仓门禁与 GitHub `verify`。隔离验证使用 Linux aarch64 Chromium，GitHub 使用 x64 Chrome。
