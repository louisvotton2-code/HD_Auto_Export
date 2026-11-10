# 后台 / AD-CI-01 / Linux 浏览器测试

日期：2026-11-11（Asia/Shanghai）
状态：待联调

## 范围与版本

- MAIN-BASELINE PR #1，基线 `23f849d4f3eb9fa935e41521c51f8e6420eeca7b`，共同隔离工作树 `codex/external-catalog-scale`，本轮仅涉及后台契约夹具测试及角色记录。
- GitHub verify 42858178348 / job 129976811951 原日志显示后台 78 通过、8 失败。8 处均为普通 Linux 用户无法创建 macOS 路径 `/private`。
- 本机隔离容器使用 Debian ARM64、Node 24.19.0、Chromium 156，以普通用户运行 Playwright。未对宿主发布测试端口，使用合成数据及请求拦截。

## 实际变更

- 截图及品牌检查 JSON 写入各用例的 Playwright 输出目录；保持文件名、桌面和手机视口及原断言。可选发布确认截图使用 `ADMIN_CAPTURE_PUBLISH_CONFIRMATION=1`。
- 标签辅助操作等待目标控件聚焦，让组件把窄屏标签滚动到位，再真实点击并检查选中状态。修正固定 1.5 秒超时后尝试打开折叠菜单的问题。

## 验证与限制

- `pnpm hooks:check`、Linux 后台类型检查、82 单元和构建通过。
- 隔离基线复跑 8 个 CI 失败用例，7 项复现相同路径权限错误，1 项先出现标签折叠菜单等待超时。只改证据路径时也出现标签及 320px 重载失败，后续两个标签定位方案未通过全部窄屏复测，最终采用聚焦后点击。
- 最终版测试入口类型检查通过。五个窄屏、重载及登录恢复场景各跑两次，10 项通过。开启可选发布截图后完整浏览器 86 项通过，零重试。保留 25 张 PNG、2 份品牌 JSON，重复执行的同名截图分别写入独立目录。隔离测试容器已释放。
- Reviewer `backend_foundation_review` 只读复查 6 个后台测试文件，无待修问题。测试 diff SHA-256 `6a1773a88366ee2d4f2ddd10e6f73d314c7c0ae7ebcaa2c556485ba5d71edca5`。
- 单独启用的真实 API 测试仍沿用原本机证据路径，本轮未运行。GitHub verify 需 PM 集成后验证。

## 交接

- 仅修改测试及记录，未提交、推送或部署。3363 和业务数据未改。交 PM 集成后复跑 GitHub verify。
