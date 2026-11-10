# FE-UX-03 配件目录与详情实施

- 日期：2026-11-08，Asia/Shanghai。
- 实施者：FE配件子任务Agent；作者自测不冒充独立审查。
- 共同基线：`fdf6c6bc52b3a40761c4f991dde8e1f6a0fad028`；共享工作树另有其他Agent的并行改动，不覆盖、不提交。
- 范围：新增parts模块、目录/详情路由、36张本地素材、相邻单元与专属浏览器测试、[模块维护说明](../../开发/模块/配件目录.md)。共享导航/sitemap/摘要由根集成。
- 状态：实施和静态/单元自测完成，待独立审查及新成品浏览器/视觉验收；未build/typegen/启动停止服务、未读真实API、未发送消息、未提交/推送/部署。

## 实现及事实边界

按本地test的PartsPage/PartDetailPage/PartCard与original样式建立黑铜色目录和两栏详情。最终CSS以本地pn断点为准：1280容器、手机2列/768起3列/1280起4列，筛选仅1024起260侧栏，否则顶部全宽；不再沿用初版公开参考观察的手机单列。后续仅参考本地React源码，不需要继续爬取公开参考站。

集中保存44条配件资料与36张参考图片，异步repository和显式展示类型隔离数据源。OEM唯一、未知详情404；本地关键词/类别/品牌/价格/排序覆盖整个静态集合，无分页。参考价只用USD，不将未知值当0。图片不称实拍；无实有规格不补造。移除竞品库存量、正品保证、固定运费/时效、假购物/发送成功。

详情有多图契约/原生图片链接/弹层键盘能力；当前每条来源仅1张，不造多图。1–999数量和本页OEM/名称/详情URL进入HD Telegram/WhatsApp草稿，仅由客户确认发送。原生GET支持无JS筛选和数量更新。

配件收藏独立版本化localStorage，仅当前已知OEM/稳定ID、100上限，目录/详情及其他标签同步；损坏/旧JSON为空，存储禁止/写失败回退内存。目录有已收藏切换，不混入汽车抽屉。按根复查建议，排序选择即应用当前表单，不要求另点Apply。

## 实际验证

| 检查 | 结果/范围 |
| --- | --- |
| `pnpm hooks:check` | 开工通过；未改hooks/锁文件 |
| `pnpm --filter @hd/web exec vitest run src/modules/parts/parts.test.ts src/modules/parts/favorites-store.test.ts` | 21:50运行10/10通过，2文件；覆盖身份、三语草稿、本地查询/数量、收藏上限/白名单/坏JSON/内存回退 |
| `pnpm --filter @hd/web check:boundaries` | 6脚本测试及实际边界检查通过；新增模块经公共入口装配 |
| `pnpm --filter @hd/web exec playwright test tests/parts.spec.ts --list` | 初次7场景可列出；PART-01后增加header清筛选回归为8项，尚未运行浏览器，不写成浏览器通过 |
| `tsc --noEmit --incremental false` | 配件主体首次全官网通过；21:44并行版本出现车辆budget prop接线错误，已通知根，不属于配件文件；21:50最终重跑退出0通过 |
| 本地素材清单校验 | 44记录/44唯一OEM/36图片/1,282,187字节；缺失0、无引用素材0、36SHA不一致0 |
| `git diff --check` | 当前工作树检查通过；不代表其他作者切片已经审查 |

## 验收交接

独立Reviewer发现PART-01：目录只读取useState初值，Next复用组件时header/footer清query可能留下旧筛选。作者已改为订阅Next useSearchParams并恢复本地query/error，保留apply原生history与Back/Forward；补header入口清query恢复44条回归。修复后TSC退出0、Playwright可列出8项。Reviewer已反馈源码层面闭合，具体独立记录由Reviewer维护；浏览器仍待根串行执行。

根在初次真实成品运行中发现PART-01仍失败（预期44、实际1；`/private/tmp/hd-fe-ux03-browser/parts-header-parts-navigat-3b926-hen-Next-reuses-the-catalog/error-context.md`）。前版静态复查没有完整发现Next history标记绕过，不能作为最终浏览器通过：传入`window.history.state`带`__NA`使安装的app-router.js 277/305绕过URL通知。作者按Next本地Native History API文档改目录/数量受控更新为`replaceState(null, '', href)`；扩原回归检查Apply零RSC/document/API、header重置和详情Back恢复筛选。CSS断点新改与此行为修复都必须进入根的新成品后重跑，旧JAWAW成品不含新CSS；本作者未自行build或运行浏览器。

建议根在新构建上执行专属浏览器场景，并独立看桌面/390/320俄文及图卡长度、gallery焦点、无JS草稿、收藏跨页/刷新、未知slug真404。单元/类型/边界不能证明视觉还原或生产可用。独立Reviewer另出报告，本作者不审自己的parts实现。根协调全官网回归与共享路由入口。

未来接入正式配件API时先定契约，再替换repository及查询方式；不要直接让组件请求竞品或把静态参考价格写成最终报价。维护入口、来源与限制已写入模块说明，后续Agent应按共同开发规范补测试与日志。
