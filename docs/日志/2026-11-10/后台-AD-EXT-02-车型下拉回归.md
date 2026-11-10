# 后台 AD-EXT-02 车型下拉回归

2026-11-10（Asia/Shanghai）。在二期工作区 `/private/tmp/hd-external-catalog-scale` 的 `codex/external-catalog-scale` 分支实施，起点 `7ea9556`。开工时两个 AD 文件与一期门禁 `3943b2b` 对应文件一致。

## 复现与定位

- 一期后台门禁 85 项通过、1 项失败。车型选项在事实字段下拉的自动滚动期间出视口并从 DOM 脱离。原始记录在 `/private/tmp/hd-ext01-pilot-3943b2b-gate.log` 及一期 Playwright trace。
- 二期旧版在独立端口重复 12 次，4 次通过、8 次失败，分别发生在译文和事实字段各 4 次。关闭虚拟渲染后，旧定位仍有 1 次失败，另 3 次通过。
- 用触发器 `aria-controls` 关联的列表与真实 option 定位后，桌面 12 次和 320px 6 次通过，混合场景仍出现一次点击拦截。trace 显示弹窗动画期间量得下拉宽度 13.4px，实际触发器约 67px。
- 通过 `afterOpenChange` 等待弹窗就绪后，混合 27 次、桌面 12 次通过。320px 首轮为 5 过／1 失败，trace 显示正确宽度的下拉仍会在弹窗滚动时发生位置跳动。

## 修复

- 在挂牌人工修订弹窗中，两组短字段下拉完整渲染，并挂在各自触发器的父容器内，随弹窗内容滚动。字段表单、译文输入和保存按钮等弹窗打开完成后可用。
- 浏览器测试对所属列表中的真实车型选项执行鼠标点击，检查展开和收起。测试继续验证车型事实与新车型译文不能一起提交、待保存译文仍可核对，以及最终请求包含修订的车型事实和已保存译文。

## 验证

- `pnpm hooks:check` 通过。Node 24.19.0 后台类型检查、82 项单测与构建通过，Playwright 测试 TypeScript 检查通过。
- 浏览器通过临时配置使用 `127.0.0.1:3379`、独立成品与合成响应。所有分轮日志位于 `/private/tmp/hd-ad-ext02-dropdown/`。
- 最终版 `index-_9txVeWq.js` 的 SHA-256 为 `1808c5a16c1fbcea255635dbd6965a163dd2bb02849bfb4d31bf28a105baf77b`。同版 320px 定向 12/12（35.4 秒）、外部车源混合场景 9 项连续三轮 27/27（39.3 秒）、桌面定向 12/12（34.0 秒）。三份日志为 `portal-mobile.log`、`portal-related.log`、`portal-desktop.log`。3379 已关闭。

## 交接

修复在二期工作树，交 PM 纳入 USD 组合门禁。独立只读审查者 `/root/backend_foundation_review` 复核两文件、分轮失败和最终通过证据，未发现未关闭问题。

- `listing-override-editor.tsx` SHA-256 `8ab403d33cda1db0e9cbd2a5f48c87a694d1494ae66c13981932bd74c9d0e1a2`
- `external-source-cases.ts` SHA-256 `6e9ae04e1a9db4d3c72961132ecc18951f8bcd1893ad1d7181f0b8a787122a2b`
