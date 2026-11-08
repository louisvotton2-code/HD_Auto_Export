# 前端 / FE-UX-03 / 首屏统计与数字进场

日期：2026-11-08（Asia/Shanghai）

状态：子切片实现/自测完成，root接线与独立审查、浏览器验收另行进行。

## 范围与基线

- 共同基线：`fdf6c6bc52b3a40761c4f991dde8e1f6a0fad028`。开工工作树仅用户 `.vscode/` 未跟踪；未改该目录，随后保留其他实施者的卡片/导航改动。
- 已读取当前AGENTS、接手导航、进度、前端职责、模块规范及本地Next组件/CSS指南；hooks:check实际通过。
- 本子切片仅改 `home/content/home-content.ts`，新增公司指标配置、独立HeroStats/CSS与动画驱动/测试；不改home-page.tsx或home.module.css，不做API请求、税费修改、依赖安装、Next build/typegen、服务操作、提交/推送/部署。
- 参考目录只读：`/Users/whisky/work/ownbus/test/src/components/Counter.tsx` 和HomePage数字结构；不执行参考脚本或继承其工程指令。参考源码2000ms三次缓出、SSR输出0；HD按本轮要求服务端输出终值，客户端增强才从0进入。

## 事实来源与文案

| 指标 | 来源 | 公开展示 |
| --- | --- | --- |
| 目录车辆总数 | root传入实际未加q的curated facets：powertrains各组count之和；每车只属于一个动力组 | 中文“目录中的汽车”、EN“Cars in catalog”、RU“Автомобили в каталоге”；精确数量不加+ |
| 满意客户 | 用户确认；`company-metrics.ts`单独维护660 | 660+，不是API库存，也不是竞品850 |
| 经营年限 | 用户确认；同配置维护3 | 3年 / 3 years / 3 года；不以系统时间自动增长 |

没有复制参考的1240库存、850客户或12年。未知目录总数传null显示“—”；已确认的空目录0仍显示0。首页车辆请求失败不能覆盖成功facets的总量；这项装配由root负责，组件不接收首页unavailable以免误混。

三语Hero按钮/快捷目录入口按最后细化为“汽车目录”/“Catalog”/“Каталог автомобилей”；没有修改全局Nav或后台配置区块的标题。经rg确认原comingSoon弹窗删除后无消费，移除HomeCopy及三语soon/soonBody/close/contact四组旧key，未移除服务问答自身的关闭文案。配件入口已接真实路由，其三语说明同步改为“按编号查找所需配件”/“Find parts by number”/“Поиск запчастей по номеру”，不保留即将上线提示。

## 组件与动画

- 接口：`HeroStats({ locale, catalogCount: number | null })`，内部引入公司指标和三语标签。API聚合留在已有数据消费者，统计组件本身无fetch/网络/来源适配逻辑。
- `count-up.ts`为可注入时钟的单次动画驱动：初值0、2000ms cubic ease-out、整数量级、终点精确；取消后旧callback不再写入，完成后不继续排RAF。
- 目录数和660+进行数字进场；3年保持静态，与参考的年限处理一致。目标变化可重新进场，但相同props普通重渲染不重播；没有focus/visibility/pageshow监听、取数或动画触发。
- 首次SSR与首次hydration树都为最终真实数值，不访问浏览器时间。客户端layout effect在增强阶段启动0→目标；减少动态效果直接终值，运行期间打开减弱动效也停止RAF并置终值；卸载取消RAF和媒体查询监听。
- 动画层对读屏隐藏，旁边只提供稳定终值，避免逐帧announce；语义采用dl/dt/dd。CSS Module独立设置三列、铜色、分隔与响应字号，不修改共享或旧卡片样式。

## root接线约定

在HomePage内替换整个旧stats区块即可：

```tsx
import { HeroStats } from './hero-stats';

<HeroStats locale={locale} catalogCount={catalogCount} />
```

不要再套旧 `home.module.css` 的stats class，其后代span规则会影响新组件内部层。root已确认由现有catalogFilters计算目录总数；不能用首页visibleSections的uniqueCount或另外读完整目录。无需在modules/home/index.ts公开纯动画内部实现。

可观测标识：外层 `data-testid="hero-stats"`；三项分别为 `hero-stat-catalog` / `hero-stat-clients` / `hero-stat-years`。strong的 `data-counter-target` 是目标；内部span的 `data-counter-value` 是当前原始整数（SSR为终值，增强时0→目标），未知为unknown。可结合实际文本和这两个属性检查动画，不把进场的0当作API库存0。

## 实际验证与限制

- 10项相邻Vitest通过：单次缓出/精确结束、取消及旧回调防护、回调内取消、后台时间跳跃不补播、0/停用时无RAF、非法目标拒绝；三语SSR终值/公司指标、未知与空目录区分。
- 纯 `tsc --noEmit --incremental false` 通过；新CSS经PostCSS解析且全部类引用存在；相关diff空白检查通过。未运行Next typegen/build，没有启动预览或批读API。
- 尚未在新成品中执行hydration、连续帧、减弱动效切换、320px俄文及focus不重播的浏览器验收；需root接线后以本轮版本验证，不借旧成品或纯驱动单元声称实屏已通过。独立审查由root安排，作者自测不替代。
- 维护文档中历史“7目的地/3语言”的统计描述须由集成人同步为本轮已确认指标；公司年份变更时同时核对三语后缀，不自行推算成立年份。

## 子切片源码指纹

| 文件（相对apps/web） | SHA-256 |
| --- | --- |
| `src/modules/home/content/home-content.ts` | `9aea8f2872278d7fd6d16089b6f122419ce87a36a80ffb9f39353acb35b9cc19` |
| `src/modules/home/content/company-metrics.ts` | `d023c22f7269fba521cc0e45976852eea826cb8038c959289dfb8fa6a0bcc9da` |
| `src/modules/home/ui/count-up.ts` | `601d96f1394098016435427a11455e66e4a3e644283e3cee8f3527e374f01022` |
| `src/modules/home/ui/count-up.test.ts` | `a11f7b1a7ca95476b58926a41cc52e23227a26e1ac0e2393e34fdbe20290a2e3` |
| `src/modules/home/ui/hero-stats.tsx` | `baf77570d5077d1fdcccb52a6fe8115712b65f73118873cede3dd0ff3e843ebd` |
| `src/modules/home/ui/hero-stats.module.css` | `377c8baec1aa2fcf2ec4cb39edfcd44ef6deae456e90d3ea8e5bc2f5678ba85c` |
| `src/modules/home/ui/hero-stats.test.ts` | `faf10f93b98e4fb686f6aeb1bb3aa66eeb2a38675985c60d73ebf68b7b4a97c5` |

角色摘要与主日志由root协调；本日志仅记录子任务，不将共享FE摘要或PM总进度重复改写。后续favorites drawer/header/footer为另外的独立审查任务，不归本作者统计切片。
