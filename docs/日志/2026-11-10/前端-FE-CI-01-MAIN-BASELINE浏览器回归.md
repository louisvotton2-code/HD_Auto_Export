# 前端 / FE-CI-01 / MAIN-BASELINE 浏览器回归

日期 2026-11-10（Asia/Shanghai）。状态为待联调。

## 范围与版本

- PR #1 的 GitHub `verify` 任务 `129918847188` 使用 Google Chrome 157.0.8103.50。官网 274 项通过，配件收藏、320px 触摸图库和同 URL 后退竞争三项初跑与重试均失败。
- 基线 `6f49689804fb497c11d2ecb437c1a704a5613f62`。在 `/private/tmp/hd-main-baseline-fe.escmkCo8` 独立构建，使用回环模拟 API。官网交付入口为既有 3363，本轮测试使用临时端口。

## 实际变更

- `parts.spec.ts` 等收藏筛选可用再操作排序，核对 12 张商品卡的信息和顺序。完整保留保存、本地持久化、刷新后筛选、详情取消收藏和返回目录为空的断言。
- `vehicle-gallery.tsx` 由触摸结束事件区分横滑和照片轻触，只消化本次已处理手势的默认动作。键盘与鼠标仍走点击，无脚本时保留原图链接。查看器接管后标记 `aria-haspopup="dialog"`。`public-freshness.spec.ts` 等标记再从照片内横滑，紧接一次真实点按打开大图。保留切图、关闭、单行缩略图及无横溢出的断言。
- `public-navigation-freshness.tsx` 在安装 `popstate` 监听后标记就绪，卸载时清理。`public-polish.spec.ts` 等该标记再执行两次原生 `history.back()`，分别验证 URL 恢复、请求计数、首请求在途时新请求完成并显示售出。

## 验证与限制

- macOS Chrome 157.0.8103.39 上原版 3 场景各 3 次均通过。原版成品受控阻塞客户端脚本时，12 个收藏心形在水合后才加入，商品正文一致。客户端监听就绪前后，同 URL 后退请求数分别为 0 和 1。320px 照片宽度的 85% 起点命中下一张箭头，72% 命中照片链接，照片内滑动后立刻点按可打开原版查看器。
- Linux aarch64 容器使用 Node 24.19.0、Debian 12 Chromium 156.0.8078.79，容器内使用锁定依赖及独立 standalone。原版三个场景各跑 3 次均以与 GitHub 相同的断言失败。第一轮只补就绪检查和触点，配件与后退各 8 次通过，图库 8 次仍失败。
- Linux 真实事件显示横滑后首次轻触仍收到新指针的 `pointerdown/up` 和 `touchstart/end`，但 Chromium 不发 `click`，同一 CDP 会话也如此。旧图库还会在滑动后的 450ms 拦住 Enter。加入触摸结束处理后，两端各自通过三个相关文件的 30 项回归。
- 独立审查 `fe_main_ci_review` 提出保留浏览器接管滚动时的 `pointercancel`。补回后复查通过，无阻断。Linux 六组事件探针验证首触、横滑后首次触摸、同一 CDP 会话、Enter、纯竖滑和竖滑中途转横，后两组实际滚动、收到取消事件，未切图或打开大图。
- 最终官网差异 SHA-256 为 `66e6b43ceee2b08da99c04deda33ea3510cf25ff3d53908d9637a27736da8d79`。官网类型检查、782 项单测、7 项模块边界和 standalone 在两端通过。macOS BUILD `icvZL6nbP3f4sa0NcveYw`，定向重复 15/15。Linux BUILD `DPtsZRpSiDek-t2khrTxX`，定向重复 24/24、图库与导航回归 6/6。重试均关闭。

## 交接

- 本机证据在 `/private/tmp/hd-main-fe-linux.Z44qZk42/` 的 `baseline.log`、`delivery-run.log` 和 `inspect-touch-delivery.log`。Mac 最终定向日志为 `/private/tmp/hd-main-fe-mac-delivery.log`。完整工作树补丁为 `/private/tmp/hd-main-fe-linux.Z44qZk42/FE-CI-01.patch`。
- 本轮仅移交工作树改动，Git 提交、推送和 3363 发布由各自授权流程处理。PM 在最终提交重跑完整门禁和 GitHub `verify`。本轮独立 Linux Chromium 环境为 aarch64，GitHub 使用 x64 Google Chrome。
