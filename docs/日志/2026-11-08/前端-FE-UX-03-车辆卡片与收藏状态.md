# FE-UX-03：车辆卡片对齐与持久收藏子任务

日期：2026-11-08（Asia/Shanghai）。实现者：`/root/fe_ux02_detail_audit`。共同基线：`fdf6c6bc52b3a40761c4f991dde8e1f6a0fad028`。本日志仅记录本子任务，不改写共享角色摘要或总进度。

## 范围与实现

- 首页仅修改 `modules/home/ui/home-page.tsx` 的 VehicleRail 及所需 FavoriteButton import，旧单轨局部 saved 数组和 Heart 已移除。该文件随后释放给 root 接统计／Hero／配件入口；这些其他改动不归本子任务。`home.module.css` 只改车卡布局、标题与底部联系区，没有移动稳定 scroll-snap slot 或重写 pointer tilt。
- 首页车卡改为纵向 flex，body 填充剩余高度，price 使用 auto 顶部外边距，footer 不收缩。标题两行 clamp 且保留完整 title；目录公共卡片也保留两行标题高度／完整 title、底部对齐和不换行的详情按钮。未知与已售状态、长原币价、长俄文不会通过假占位库存文案填齐。
- 首页、公开目录与详情使用同一 `FavoriteVehicleButton`，统一三语可读标签、aria-pressed 与 API 稳定 id；详情原本单页 boolean 心形被替换。已有共享联系草稿、3D 内卡／稳定外壳和详情按钮不移动命中区的方式保留。
- 没有改业务 DTO／库存事实／税费。收藏只写身份列表，不保存标题、图片、价格、库存或旧 DTO；404／已售等实时展示由 root 的收藏抽屉按当前公开 API 处理，不能用本地收藏事实推断在售。

## 公共接口与存储

对外入口：`apps/web/src/modules/vehicles/index.ts`。

```ts
useVehicleFavorites(): {
  ids: readonly string[];
  isFavorite(id: string): boolean;
  toggle(id: string): void;
  remove(id: string): void;
  clear(): void;
}

FavoriteVehicleButton({ vehicleId, title, locale, className?, size? })
normalizeVehicleFavoriteIds(value: unknown): readonly string[]
VEHICLE_FAVORITES_STORAGE_KEY // hd-auto:vehicle-favorites:v1
MAX_VEHICLE_FAVORITES // 100
```

- Hook：`application/use-vehicle-favorites.ts`，通过 useSyncExternalStore 订阅统一 store。server snapshot 始终是同一个空数组，避免 SSR／hydration 依赖浏览器数据；浏览器提交后读取本机收藏。
- Store：`application/vehicle-favorites-store.ts`；纯格式与身份校验：`application/favorite-vehicle-ids.ts`。稳定 ID 按公共 IdSchema 校验，去重并最多保留 100 个，最新收藏在前，达到上限后新收藏挤出最早一项。上限已与 root 确认，避免坏／旧 storage 产生无界单车读取队列。
- localStorage 仅存 `{version:1, ids:[...]}`，使用 HD 专用 key；不读取参考站 km-favs，也不迁入其他站点的身份。坏 JSON／未知版本不抛异常；当前页面可以继续收藏并覆盖为有效格式。
- 同一页面多实例通过 store 通知同步；跨 tab 监听同 origin 的 localStorage event，处理 key 删除和全 storage 清空，忽略外部存储区域、无关 key 与不可读事件。每次变更前读取最新持久值，减少迟到跨 tab 事件造成的覆盖；并发写入仍以浏览器最后一次写入为准，不声称事务合并。
- 存储读取／写入被禁或 quota 错误时保留内存状态，连续操作不丢前一次变化；之后写入恢复会保存当前完整列表。无持久能力时刷新不能保留，这是浏览器存储限制，不把内存回退称为已持久化。SSR／存储／心形本身均没有网络、focus 或后台拉取。
- root 已收到 hook 的模块内路径，可从抽屉相对导入；根头部通过 app 装配 favorites action，shared 不反向依赖 vehicles。index 的收藏出口添加后已交还 root 继续追加抽屉出口，不覆盖其改动。

## 源码归属

本子任务新增：favorite-vehicle-ids、vehicle-favorites-store、use-vehicle-favorites、store 相邻单测、FavoriteVehicleButton 及 CSS、`tests/vehicle-favorites.spec.ts`。已有文件修改：VehicleRail／home 车卡 CSS、公共 vehicle card／CSS、详情对 VehicleDetailActions 的 id 装配、VehicleDetailActions 收藏接线／旧 heart CSS、detail-content 旧局部收藏文案清理、模块收藏公共出口。

root 同时新增的 `read-favorite-vehicle`、抽屉／头部、HeroStats、配件入口与文案属于其他子任务，不把它们计为本实现者已验证功能。

## 实际验证

- `pnpm hooks:check`：通过，本仓 hooks 入口正常。
- `pnpm --filter @hd/web exec tsc --noEmit --incremental false`：本子任务源码与新增 E2E 最终通过；没有执行 next typegen。
- `pnpm --filter @hd/web check:boundaries`：6 个边界脚本测试和实际模块边界检查通过。
- `pnpm --filter @hd/web exec vitest run src/modules/vehicles/application/vehicle-favorites-store.test.ts src/modules/vehicles/public-presentation.test.ts src/shared/lib/public-vehicle-contact.test.ts`：最终 **3 文件／24 测试通过**（Vitest v4.1.12，约 21:40:47）。其中新增 store 11 项：校验／去重／上限、只存 id 与重建恢复、稳定 snapshot、同页多实例、跨 tab 清空／损坏、迟到事件前读取最新值、初读坏数据后订阅前修复、写入失败连续变更与恢复、禁用／坏 JSON 回退、SSR 不读 storage、不可读 storageArea。
- `git diff --check`：实际执行通过；新文件已用仓库现有缓存 Prettier 格式化。正在由 root 使用的 home-page／home.module.css／index 没有被本子任务整文件格式化覆盖。
- 新增 4 个 Playwright 场景源码：刷新／跨语页面／双 tab、预存值 hydration 与坏 JSON、存储禁用、多种宽度下长俄文标题／未知状态／长价格 footer 对齐。长标题通过隔离 fixture 的同源 JSON 增强响应送入实际组件，不改运行 API 数据。**本子任务没有运行这些浏览器场景。**

## 交接与未验项

状态：实现与源码自测完成，等待独立 Reviewer 和 root 最新 standalone 成品集成验证；用户视觉验收另计。root 应针对新成品运行 `tests/vehicle-favorites.spec.ts`、既有 details-hover／home-motion／vehicle-contacts 及其头部抽屉用例；复核 1440／390／320px、真实同车跨入口心形、冷却／404 收藏抽屉与键盘关闭。

没有启动／重启服务、HTTP 批读、构建、typegen、安装、修改锁文件、Git 提交／推送或部署；没有改其他应用、真实库存与照片数据，未向任何真实联系人发消息。后续源文件变化需绑定新指纹与相应复查，不能把本日志的单元数量当新成品浏览器已通过。

## 成品首轮后的测试准备修正

根集成人首轮成品反馈：长俄文场景仍显示原来的俄语标题，尚未进入 footer 几何断言。原测试在初次页面后立即合成 hash push/back，不能稳定保证公开数据核对监听已挂载；同时默认首页 3 条中仅 2 条 manual，拦截器按 manual 过滤后要求至少 3 条与 fixture 不符。该结果没有证明产品布局失败，也不能把未进入的几何断言记为通过。

本实现者仅修改 `tests/vehicle-favorites.spec.ts` 的准备步骤：

- 等待首页 canvas 经 effect/ResizeObserver 设置真实 width，再点击真实站内详情链接，等待详情可见后执行 `page.goBack()`，通过既有明确 Back 导航机制核对首页数据。
- manual 数量校验改为至少 2 条；两张卡可比较同排底部与高度。保持长俄文、真实 sold/unknown 区分、长原币价格输入，以及 1440/390/320px 的全部 footer 等高、按钮 fits 与页面横溢断言。
- 不改产品组件、样式、API 事实或 fixture 服务来制造测试通过。

实际执行 `pnpm hooks:check`、`git diff --check -- apps/web/tests/vehicle-favorites.spec.ts` 通过；Playwright `--list` 能列出该文件 4 个场景。修改后测试 SHA256：`49dbff3226f4db23d56c8839c0d104b9664c2d50c373cbbf245477399631acab`。已交配件作者作独立只读增量复查；新成品实际浏览器重跑仍由根集成人串行执行，本实现者未代签。
