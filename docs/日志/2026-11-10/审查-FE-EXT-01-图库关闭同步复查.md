# FE-EXT-01 图库关闭同步独立复查

日期 2026-11-10。只读基线为 `7ea9556634e0314c58dc3d5c7dfc4ec3b7677fe1`。本次复查只包含两文件图库增量，承接 [外部车源展示审查](审查-FE-EXT-01-外部车源展示.md)。最终候选成品 `73CIRqH73bvZsyBLvjxCV`。

## 源码结论

- Escape 的原生 `cancel` 事件阻止默认关闭，与关闭按钮、背景点击汇合到 `closeViewer`。函数先恢复 `body.style.overflow` 原值，再关闭原生对话框，并当次完成状态与焦点回收。原值为 `''`、`auto` 或 `scroll` 均保留。
- `onClose` 处理未经过共用入口的原生关闭。显式关闭已清除 opener，随后到达的事件不会重复回焦。对话框已重开时，晚到事件因 `open` 为真而跳过。增量初审发现重开可能以旧的 `hidden` 覆盖原滚动值。最终候选使用 `??=` 保留首次锁存值，此项 P3 已按源码复查关闭。
- 详情更新后失去全部照片时，布局 effect 清理先释放滚动锁，随后关闭打开状态并把焦点移至无图容器。组件卸载也复用同一清理。普通关闭保留原触发控件的焦点，触发控件已移除时回到图库按钮。
- 变更未触及图像 URL、请求参数、预览和原图选择、报告上报或数据读取。旧回归仍检查四张预览带 `variant=thumb`、首屏只请求当前一张原图，以及键盘切图和焦点回收。新增用例先把原 `overflow` 设为 `auto`，分别用真实按键和按钮关闭，在移除 `open` 属性的首个观察回调读取 `overflow` 并核对焦点。

复查未发现剩余需要修复的问题。关闭路径见 [画廊](../../../apps/web/src/modules/vehicles/ui/vehicle-gallery.tsx#L116) 与 [事件绑定](../../../apps/web/src/modules/vehicles/ui/vehicle-gallery.tsx#L339)，观察断言见 [浏览器用例](../../../apps/web/tests/public-freshness.spec.ts#L410)。

## 验证归属

- 本审查执行了 `pnpm hooks:check`、两文件 `git diff --check` 和冻结基线的 `git apply --check`，均通过。补丁与冻结基线至工作树的两文件差异逐字一致，原工作树与独立候选的两文件指纹相符。未访问真实或隔离预览，未重跑共享构建和浏览器。
- 实现者的时序探针在冻结成品上执行 24 次。对话框首次观测已关闭时 24 次仍锁定滚动，已有焦点检查后还有 8 次未释放，从 Escape 到解锁最长 157.5 毫秒。新增原子断言在冻结版失败。修复初版 `_ws2ET4QQ542mylmjTkG3` 的 24 次中两类残留均为 0，最长 3.6 毫秒，定向浏览器 16 项与重复 18 项通过。已只读核对保存的时序与状态文件 `/private/tmp/hd-fe-ext01-gallery-{frozen,fixed}.json` 及浏览器结果目录。
- 实现者记录最终候选通过 766 项单元检查、7 项边界检查和 42 页构建。已只读核对最终运行输出，24 次时序探针两类残留均为 0，最长 2.7 毫秒。生命周期记录包含背景关闭、原生关闭、关闭后立即重开及同页下架卸载四项通过。最终定向浏览器套件状态为 `passed`，详见实现者日志与 `/private/tmp/hd-fe-ext01-gallery-final.json`、`/private/tmp/hd-fe-ext01-gallery-lifecycle.json`、`/private/tmp/hd-fe-ext01-gallery-final-related/.last-run.json`。

## SHA-256

```text
49adc7f57337e395e4765d3438fa1b0317941a6043888bbf69f4e70fd8739c1b  apps/web/src/modules/vehicles/ui/vehicle-gallery.tsx
45e84326c5db69328231aad07731b46c145306ac34d85867474e279c957c583f  apps/web/tests/public-freshness.spec.ts
fac11181e2598c238b8eb1f93ce4e3fc5630be2d0e37f467de181c4938873c3a  /private/tmp/hd-fe-ext01-gallery-7ea9556.patch
```
