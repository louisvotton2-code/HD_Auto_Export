# 前端 / FE-PARTS-08 / 配件目录还原

日期为 2026-11-11（Asia/Shanghai）。状态为待验收。

## 范围与版本

- 根据用户指定的本地 React 项目调整配件目录布局、数据覆盖和浏览交互。
- 共同基线 `364ff985cc850214b1a1cc196bc139a48a85b3c9`。独立工作树 `/private/tmp/hd-parts-reference.Rzqn5saa`，分支 `codex/parts-reference`。只改官网和相关交接文档。
- macOS、Node 24.19.0、Chrome。官网 standalone 构建 `unOY-jVRuSOQKn_rPo4bx`。相对基线的 17 个官网路径内容清单 SHA-256 为 `b909766ec7571c7a164edd44d03b6e8fbe236ce6cac1779a5f315b8f4d3fc3e9`，删除路径记为 null，清单位于 `/private/tmp/hd-parts08-source-final.json`。

## 实际变更

- 逐条核对本地参考项目和已有静态库的 44 个唯一 OEM、顺序、价格、名称、原始组别、品牌与图片。目录默认显示完整 44 条。当前资料均为 Hyundai，映射到 4 类，使用现有 36 张本地参考图。
- 按参考调整双色首屏、滚动数字、13 个热门车型入口、筛选侧栏、卡片和咨询区。桌面、平板、手机保留 4／3／2 列与键盘焦点。触屏直接显示收藏按钮，中文手机标题按语义换行。车型入口跳到目录，咨询区使用 HD 的联系方式。
- 首屏和结果栏显示 48,689 的目录规模参考，结果另列实际可见范围。页码上限为 2,029，复用静态资料的匹配结果。关键词、品牌、类别、参考价区间和排序均作用于全量资料，采用原生 GET 和 URL 回显。收藏按实际数量展示。
- 数字动画与首页共用组件及纯逻辑。目录继续经配件 repository 装配，详情和联系草稿沿用同一资料身份。模块规则见 [配件目录与详情维护](../../开发/模块/配件目录.md)。

## 验证与限制

- `pnpm hooks:check` 通过。`pnpm --filter @hd/web check` 的首轮有一项断言仍预期旧页码上限。更新断言后，官网类型检查、783 项单测及 7 项模块边界全部通过。官网 standalone 构建通过。
- `tests/parts.spec.ts`、`tests/parts-layout.spec.ts`、`tests/home-stats.spec.ts` 共 30 项 Chrome 定向回归通过，重试关闭。覆盖三语查询、侧栏、排序、页码和历史，320px 无 JavaScript，详情、草稿、收藏、8 档布局，以及共用数字组件的首页回归。过程证据在 `/private/tmp/hd-parts08-{check,build,browser}-final.log`。
- 候选版 Chrome 只读探针通过，覆盖三语计数、桌面悬停及减少动画、320px 传动系统筛选、390px 中文标题、820px 触屏收藏、组合条件末页及空结果。证据为 `/private/tmp/hd-parts08-preview.OByC64yU/staged-visual.json`。
- 独立 Reviewer `fe_main_ci_review` 核对原始资料、GET 与无 JavaScript 行为、收藏、三语、模块边界、首页数字回归及最终样式。按上述 17 路径清单完成复审，本轮范围未发现 P0–P2。
- 最终构建已接入 [本机 3363 配件目录](http://127.0.0.1:3363/zh/parts/)。三语回归探针各读到 44 个唯一配件，触屏收藏等 8 组观察通过。后台入口的 HTML 校验值、匿名权限和 API 就绪检查一致，车辆目录仍读取 220 条，首页推荐仍读取 20 条。切换只替换官网进程，网关配置和 API 进程核对一致。旧官网进程、临时候选和临时测试端口已释放。记录在 `/private/tmp/hd-parts08-preview.OByC64yU/{cutover,live-visual}.json`。
- 逐页配件数据与完整车型适配待接入真实数据服务。浏览器验证范围为 Chrome，视觉验收待用户确认。

## 交接

- 本日志与官网变更保存于 `codex/parts-reference` 同一份本地提交。远端仓库与生产环境未操作。
- 本机运行交接在 `/private/tmp/hd-parts08-preview.OByC64yU/运行与回退.md`。前一官网成品已保留，可按记录回退官网进程。
- 后续配件数据接入从 repository 和分页契约开始。按真实资料总数和返回页更新统计与页码，参考规模随之退役。
