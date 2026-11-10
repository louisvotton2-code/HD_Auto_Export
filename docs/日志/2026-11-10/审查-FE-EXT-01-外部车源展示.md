# FE-EXT-01 外部车源展示独立审查

日期 2026-11-10。共同基线 `fd16e00e23db8b8956f0c398ab1c198e82a61bc2`。审查范围为首页、车辆卡、收藏、详情、画廊与外部资料展示，对照共享公开契约。FE-UX-05 的冻结内容另行记录。上报代理、导入流程、生产域名策略与数据安全由其他审查负责。

## 发现与复查

| 编号 | 优先级 | 初审发现 | 当前源码状态 |
| --- | --- | --- | --- |
| GAL-01 | P2 | 同详情资源更新成空照片数组时，已打开的图片对话框消失。旧 effect 只依赖 `opened`，正文可能仍锁定滚动，焦点也失去落点。 | 已闭合。`hasPhoto` 加入滚动锁依赖并保护设置条件。无图切换会恢复原 `overflow`、关闭查看器、将焦点送至有可访问名称的替代图容器。新增用例用合成数据触发同 ID 详情回填，断言详情请求成功、弹窗消失、焦点与滚动恢复。见 [画廊](../../../apps/web/src/modules/vehicles/ui/vehicle-gallery.tsx#L67) 和 [用例](../../../apps/web/tests/external-catalog.spec.ts#L91)。 |
| COUNT-01 | P2 | 首页原先相加动力筛选计数。外部挂牌动力未知时，目录保留记录，筛选字典刻意排除这组，导致首页少计。 | 已闭合。合并模式从同一事务的完整筛选记录生成 `total`，契约把该字段设为可选，首页优先使用它。旧 staff-only 响应仍使用原有分组计数。合成用例验证三语目录与筛选接口总量均为 31、未知动力未进入筛选项，以及英文首页实际显示 31。见 [API](../../../apps/api/src/vehicles/service.ts#L464)、[契约](../../../packages/contracts/src/public.ts#L158)、[首页](../../../apps/web/src/modules/home/ui/home-page.tsx#L221) 和 [用例](../../../apps/web/tests/external-catalog.spec.ts#L14)。 |
| MODEL-01 | P3 | 首页车型入口原先先挑首辆匹配车辆，再查照片。同车型第一辆无图时，后续有图车辆无法成为入口代表。 | 已闭合。候选同时匹配品牌、车型和非空照片数组，再复用统一封面解析。见 [首页车型入口](../../../apps/web/src/modules/home/ui/home-page.tsx#L228)。 |

## 公开行为核对

- 首页与目录卡片、收藏缩略图均支持无封面。原图已知存在时保留实际 URL，失败时换成当地语言的替代状态。图像 ID、URL 与修订号变化可重置旧失败状态。外部图片使用 `no-referrer`。原自营图片地址仍经统一解析。
- 详情无图时首屏仍有图位、标题、已知事实和联系入口。画廊保留本地缩略图与原图链接，外部缩略入口用编号，增强前可以直接打开已知原图。无 JavaScript 时原生 `<details>`、普通链接与服务端正文可读。网络加载失败后替换状态和重试属于客户端增强，源码审查没有测量无 JavaScript 时浏览器自身的失败图样式。
- 主标题、描述、原文对照及规格条目按返回文本的 `contentLocale` 标注语言。两种文本相同时避免重复展示。争议或无效字段只显示待确认的字段名称，原文对照不展开对应值。核对上游投影时，争议值、可重述争议的自由文案及相关规格或检测描述会从公开内容移除。
- 检测报告与相关挂牌使用公共契约里的 HTTPS 链接、普通文本和 `noopener noreferrer`。没有新增内嵌 HTML 或客户端解析外部内容。服务器端主机约束与上报去重的安全复核另记。
- 外部参考价格继续使用传入的 CNY 金额及现有精确格式化，按询价状态展示空价。未知可售状态没有转成现车或补造核验时间。原自营库存状态、价格类型及联系路径沿用各自公开字段。

## 验证记录

- 本审查实际执行 `pnpm hooks:check` 和首页、车辆模块的 `git diff --check`，均通过。另核对源码、测试断言与文件指纹。没有启动服务、访问 3353、访问真实 API 或重跑构建。
- 实现者记录初版 `sSzcX1mhX58bGRyB2gD0j` 通过 765 项单元与 7 项边界检查。初轮图片切片 42 项中 40 项通过，另两项随后修正请求和可见错误定位。后续成品 `HJgUnjWNJtUV7jraaNWPL` 通过 766 项单元与 7 项边界检查。该成品的 47 项浏览器首轮中 46 项通过，失败项是画廊按钮精确名称包含既有图形字符。定位改为按钮角色加名称正则，保留后续刷新、弹窗、焦点和滚动断言。定向复验输出文件标为 `passed`，无失败用例。见 `/private/tmp/hd-auto-ext01-fixture-retest/.last-run.json`。这些为运行者证据。
- 合成用例可验证分页及原币筛选、图片失效回退、原文和译文标记、争议遮蔽、报告链接与撤回后 404。此处为断言审查，浏览器结果由运行者记录。真实导入记录验收与合成用例分开。
- 末次增量只读复查确认首页计数兼容说明与排版没有改变优先读取精确总量的行为。并行更新的两份公共契约重新核对了远程图片、语言、CNY 参考价与可选总量。文本新增 `catalog` 类型限外部导入记录，展示层仍消费实际文本语言。下列契约指纹标识复查时的工作树上下文。

## 审查快照 SHA-256

```text
bfc8713404f24ea5032d401628c996aed9152ce0106bce0739d8239e1d05de89  apps/web/src/modules/home/types.ts
52e5d3661d59fe407dd642c98616a76c1288728351e4874569100bf7118b76dd  apps/web/src/modules/home/ui/home-page.tsx
89b2366d65ff4de6bf349bd76d0db0871592e2bc56de34be47e5636dd6ee7aff  apps/web/src/modules/home/ui/home-sections.tsx
392606ec5ccc021d8e6fbfad47489191652392e9405684d653fa687c485601a2  apps/web/src/modules/home/ui/home.module.css
1ec0103558889273ea4018ad0fd120d8b8eec473df68033e3fd7f3c1edc42ddc  apps/web/src/modules/home/ui/home-sections.module.css
b79ffea50c7e279df92e04b3c9116cc261f3c47a6b542464733971e82fbcdfc9  apps/web/src/modules/vehicles/index.ts
e82ea06bdf700767054c94632fec1504fde61b5e144c7149ce5c1a2599121fbd  apps/web/src/modules/vehicles/public-presentation.ts
7cd159ede783746364f7f0340b301cad6d06b9a3a0302baae753159c7b05b3f9  apps/web/src/modules/vehicles/public-presentation.test.ts
e65485f130f373c26d315c9bc7f80daac09e11e49af5c8905781bd7824e323cd  apps/web/src/modules/vehicles/external-detail-copy.ts
411a2ce767e36e9b0b9458ef72c630810d826d80f9ebd629e71d7f20c171f8e4  apps/web/src/modules/vehicles/ui/public-vehicle-card.tsx
420e73db4cc1cf0da52f1ca5b5318481c162ac8d8df9c6c58c2819e10b3f5dd9  apps/web/src/modules/vehicles/ui/vehicle-favorites.tsx
dabbc5f6f2df3ad7dfb912cebe7666e133382d1200d6b993782f08761b73a180  apps/web/src/modules/vehicles/ui/vehicle-gallery.tsx
5b84c5156d36a79995aa854274e16d66c6a9efa1d12a6a28264e6853682e491d  apps/web/src/modules/vehicles/ui/public-vehicle-detail.tsx
64f7499455d1be8dadfeb1af9c62057aef4e8cc7d3ab1249d423fe22b4573095  apps/web/src/modules/vehicles/ui/vehicle-photo.tsx
c46ed7ef4b5c981272db42e0d990cbeab6e9202e91bfe3ec3a35596147d87b8b  apps/web/src/modules/vehicles/ui/external-vehicle-information.tsx
7a32a5d25368f71875798b690aaab28cdb9adc7005ea3b7103b8848ea17d84b7  apps/web/src/modules/vehicles/ui/public-detail.module.css
a8d7bcf5dd0be67af951b6c92a509779a488986c25d189275a0cccf0dfa1a648  apps/web/src/modules/vehicles/ui/vehicle-photo.module.css
6a7f1b84a4eff56d31cb1c95b74236cd9a88dc3c7d2598c30d43ac2375153c3d  apps/web/src/modules/vehicles/ui/vehicle-gallery.module.css
899297d19ea18ff329a2174973011de2db8814ca4abef8dbf42782a58a243344  apps/web/src/modules/vehicles/ui/public-vehicles.module.css
2ace76c658edab364b1aa5cfb4461c7b152344065c414a090836a974333d39a5  apps/web/src/modules/vehicles/ui/vehicle-favorites.module.css
da9490a20e59b7e11ff21dc5e2a4d2701184f8092cdd92e4cd2f3bd3e10e6715  packages/contracts/src/external-public.ts
c19a5a4b2783db117df9105b2393a8f6b27a891b20b1c70537c9a0512c770293  packages/contracts/src/public.ts
f02436cc163357a62d65e829444206ee45ce6f1cb2075d94768d0c6c1cf6d599  apps/web/tests/external-catalog.spec.ts
```
