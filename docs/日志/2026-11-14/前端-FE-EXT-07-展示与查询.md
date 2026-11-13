# FE-EXT-07 展示与查询

日期：2026-11-14（Asia/Shanghai）。状态：源码实现，待服务器受影响检查与PM指定唯一独立审查。

## 范围与版本

用户确认的EXT07执行方案；远端main起点`b19f9c76578ec8a5bebfb1c561c2fb30de2b2951`，分支`codex/web-ext07`，独立工作区`docs/private/fe-ext07-worktree`。根历史脏树未改。采用BE冻结合同`096c8aca96c05f9a45d9f29ef2644f40a7ad0ff5`（本地`7b6a0d0`），不修改contracts／锁／共享根脚本。第一次fetch已成功核到该基线；并发返回前多发的一次独立SSH重试因host key verification失败，未绕过验证、未改变远端。hooks检查通过。

## 已实施

轻量列表与严格schema，原详情／首页／收藏兼容；短询价编号和来源、稳定旧链接；出口条件／服务端排序；合法VIN／级别／出口事实；独立有界报告四状态及历史原币时间，保留原文语言，复用撤车／版本／429生命周期。配置只渲染已有seed，隐藏空值，保留0／false，删除完整配置按钮且不自动读取。未知机器字段不以无名数字展示。

日期精确月优先，否则逐月覆盖来源范围（最多2400月），任何月份不完整不出部分报价；最低／最高整套场景保留费用、公式及另计项。直接hp，不从kW换算；后端USD优先，缺投影保留已知原币。范围保留到详情／完整页／深链／草稿／复制／手机合计，手动精确月切单情形，移除旧年款一月推断。

即时局部busy保留车卡布局、链接pending固定空间、校验后Suspense、详情归顶／错误重试／减少动效；无祖先loading软404风险，库存自动预取预算0。具体维护入口见[首页与车源](../../开发/模块/首页与车源.md#fe-ext-07-展示与查询)。

## 验证与交接

本机只执行hooks核验、源码检查与`git diff --check`；未运行应用测试、类型、构建、浏览器或压测，未安装依赖、未启动服务。未将相邻旧结果算作本轮通过。三位实现子Agent分离计算器、导航、详情文件，未另建Reviewer；唯一独审由PM统一安排。

OPS服务器针对准确提交串行执行既有门禁；以下是受影响检查定位，不要求先定向跑一遍后再重复完整门禁：官网类型／边界，calculator的manufacture-range、vehicle-estimate、estimate-seed、draft、inline SSR，vehicles的ext07-public、public-query、public-segments、localized-projection、public-presentation、equipment及公共contact相邻单元；Linux官网build；浏览器`catalog-navigation.spec.ts`、`vehicle-records.spec.ts`、`vehicle-segments.spec.ts`和`vehicle-estimate.spec.ts`（direct hp／range／RU深链及两列断点）。配置／报告既有相关断言已同步迁移，保留完整gallery和private preview保护。

完成源码SHA由共享`docs/private/pm-ext07/FE-handoff.md`登记；服务器真实结果与失败修正追加本记录，不新建重复证据包。独审／联合验收／PR／CI／部署／全量同步由PM／OPS统一安排，当前均未在本前端交付中记为通过或已完成。

### 首轮服务器类型失败修正

OPS对联合候选`ad948fc7b3b9ccf20af3974ff54f39faddde45c0`执行门禁，API／AD检查已过，官网类型检查实际失败两处：分页组件仍要求完整详情列表DTO、联系草稿的状态映射残留旧`PublicVehicle`类型名。分页改为只依赖轻量列表的分页／meta结构，仍兼容相同元信息的旧详情响应；草稿状态改从现有`PublicVehicleSummary`取类型。不添加cast或降低schema校验。尚未执行官网unit／build／browser，补片仅做本机hooks及diff核验，交OPS续跑官网类型及后续未执行检查，不要求重跑已过的API／AD。

### 服务器工程边界失败修正

PM回传联合`ee6d05d17a9c94d556cd9335c5ddf32600865283`官网类型已过，边界检查实际拒绝公共计算入口导入`application/manufacture-range`。纯范围实现移至`core/manufacture-range.ts`，相对依赖仅调整为同层core；公共入口直接导出core，application保留内部导入兼容转发，既有UI／草稿／测试不必迁移。已逐文本确认全部计算实现与原版本相同，仅依赖路径变化；未放宽边界工具、未改税费公式或扩功能。本机仅hooks与diff检查，工程边界／应用检查仍交PM指定唯一OPS执行者在服务器续跑；不新增Reviewer或向其他对话重复派发。

### 服务器无JS首屏回归修正

PM回传联合`e2abe2a57ace222b25c333e4f3dafc0a1d5988ba`完整门禁的真实E2E失败：既有catalog-filters原生GET／禁用JS案例连续两次30秒只显示新增Loading vehicles骨架，真实表单未出现。新手写Suspense把必需内容留给客户端揭示，破坏SSR渐进增强。列表与同构详情装配均改为服务端await完再返回完整首屏，去掉无消费者的路由骨架组件／样式／公开导出；不加新框架，原链接pending／局部busy／取消／重试／归顶／减弱动效保持。原失败测试及断言／超时不改；另加详情无JS回归保护相同边界，交服务器与原失败案例定向复验。本机仍只hooks／源码及diff核验，不宣称该修复已通过应用／浏览器检查。

同轮补报的buy-guide:114在禁用JS下最后从三语购车指南跳到`/ru/cars/`并等待h1；catalog-filters:192也使用相同目录SSR入口。静态核对购车指南／语言链接未引入新骨架，归入同一目录首屏修复，未改这些测试或共享语言导航。服务器继续按既有case复验，若失败步骤不同，以实际日志进一步定位。
