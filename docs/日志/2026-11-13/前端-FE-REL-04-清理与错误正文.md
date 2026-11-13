# 前端 / FE-REL-04 / 现有代码清理与错误正文

日期：2026-11-13（Asia/Shanghai）。状态：FE实现／自测及独立预审通过，待最终SHA绑定和OPS真实组合验收。

## 范围与版本

- 已核读PM对话本轮人类原始要求：各端清理现有代码／逻辑及不用的临时内容，由集成人验收、PR合main及部署；CSV等账号开通后再做。本轮不实现或开启同步、不导入数据、不调用付费翻译，保留生产账号／权限／配置和业务数据。
- `git fetch origin main`实核基线`102de594226c016f5e788e1b250001d53cb0bd17`；分支`codex/web-rel04`、工作树`docs/private/fe-rel04-worktree`。根`acceptance-polish`历史脏改动不覆盖、不暂存；不改根脚本、锁、API、后台或deploy配置。hooks核验通过。
- 依赖从上一受审FE树写时克隆，仅本地build contracts；未安装或改锁。两树锁摘要均`63c074b28b5f2f85b0e3c315e8edb8970912d67232c7ed21cf8722c5ea7be392`，已告知OPS避免并发安装。

## 实际清理

- `vehicles/filter.ts`仅定义`filterVehicles`、无导入／公开出口／调用；仅它消费的旧`VehicleFilters`类型一并移除，真实API及公共契约筛选不变。`Vehicle`／燃料／车身类型和历史mock来源资料仍有用途，保留。
- 旧`ui/vehicles.module.css`402行仅被`PublicVehicleContacts`导入，实际只用7个class。提取对应联系规则、srOnly及contactAction减少动效规则至`public-vehicle-contacts.module.css`67行，改单一import；其他旧页面／卡片／筛选／网格无消费者，删除。独立审查重建旧保留规则后与新CSS逐字一致，无样式值、组合、hover／focus改动。
- 未删除缓存／权限／发布／撤车／图片／预算／恢复核心测试，未将仍有用途的mock资料当临时库存删除，也不自行清理他人分支／工作树和私有回退证据。

## 404最小协作方案

- 已知动态缺车的无JavaScript正文空白来自当前Next错误恢复；上轮metadata/page拆分已证无效，本轮不重演、不补框架内核、不升级依赖、不做重复API预查。
- FE新增纯`shared/lib/not-found-document.ts`，品牌／logo属性转义，三语固定文案及真实主页恢复链接，不含车辆、请求、会话或接口读取。现有非法顶层语言404复用该文档。
- `proxy.ts`仅对精确`/404/zh/`、`/404/en/`、`/404/ru/`提供GET／HEAD正文源200，no-store／noindex／nosniff；不支持方法405，错误语言／扩展路径仍404。其他原locale、API、预览和RSC请求继续交Next。源200不是车辆成功状态，不进sitemap。
- OPS已接受接线：只对三语单ID车辆详情的HTML文档协商且真正上游404替换正文、最终保持404；排除RSC／各类预取／非HTML／API／员工预览和原200／503／429，不携Cookie、Authorization或query给正文源，不更改限流。精确Nginx配置与真实TLS／组合验证归OPS，本轮FE不修改deploy。
- **直接Next的FE-REL03-P2-01仍保留expected-failure，不计通过；只有本版真实网关组合验证后才能记正式入口修复。** FE仅提供无数据正文，不能用三语源200或OPS模拟上游证明Next真实车辆404已修。

## 实际验证

- Node24.22.1／pnpm11.25.0／Darwin arm64。官网typecheck通过，工作区／官网边界通过（官网7项），4份定向单元31项通过（proxy、联系草稿、SSR reader），未重复计算器48或上轮149；未执行整仓verify:push。
- 官网生产构建成功，BUILD`gel22sY0FBeV9iUab0puA`。源码、完整standalone及manifest在私有交付目录冻结；这不是Linux生产构建。
- 首轮7浏览器：5项真实通过、1项直接Node继承P2 expected-failure、1项联系样式测试预期失败。原因是测试写共享默认40px，而原`public-vehicles.module.css`父级`.cardActions > div > a`一直覆盖为36px；源码／CSS未改值，只修正断言并保留首失败。随后仅复查联系单例通过，未重复已通过用例／构建／单元。
- 分轮共6项真实浏览器通过：三语320px无JS正文／恢复链接／零库存读取，原非法语言和未知静态页404，SSR逐次版本＋匿名复用控制，桌面车卡及320俄文详情联系按钮（尺寸、两平台、hover、键盘focus、减少动效、可视边界）。另1项直接Node已知失败单列；工具把预期失败计入passed，不能称7项全绿。
- 临时服务仅3327／3100隔离fixture，结束退场，不修改3363或连接生产。截图人工检查，失败日志及trace保留；真实API、RSC协商、网关状态与Linux部署仍待OPS组合。
- 独立Reviewer`/root/release_cache_review`已只读预审新proxy／纯HTML、删除可达性、CSS逐字等效和定向测试，未发现可确认未处置P0／P1／新增P2；最终审查报告绑定完整提交SHA与源／成品manifest，不复用上轮报告。

## 交接

- 最终自有提交、清单和独立报告登记见`docs/private/fe-rel04-evidence/delivery.json`；角色提交供OPS唯一集成，不自行推送／PR合并／发布。后续组合新SHA需相应门禁和审查，不把本轮定向检查冒称全仓验证。
- OPS负责与BE／AD提交组合、实际Nginx＋本版官网验证、最终PR／CI／main、Linux构建、生产备份和保留数据升级；不得重跑REL03清空车源，不启动CSV同步或回滚用户写入。
