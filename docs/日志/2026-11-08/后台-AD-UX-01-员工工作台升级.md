# 后台 / AD-UX-01 / 员工工作台升级
日期：2026-11-08（Asia/Shanghai）
状态：待验收（实现、自测、真实隔离联调与独立复查通过，代码冻结）

## 范围与版本
- PM-INT-02明确授权AD升级成熟UI库、完整工作台、批量库存／下架与首页区块配置；同步消费BE的筛选字典、版本感知批量与demo契约。展示样例不是实际库存；真实素材由PM核验。
- 共享工作树 `codex/backend-foundation`，HEAD `61dc7414b20a395d1d09e906a49d974763b3cce7`。保留全部现有改动；不提交／推送／部署，不修改PM总进度或导航。
- AD独占根脚本／锁与安装；仅为FE添加 `apps/web/package.json` 的 `@hd/contracts:workspace:*`，不修改其它FE配置。新增根 `dev:web` 固定本地3317，FE运行时实现由FE负责。

## 技术决定与安装状态
- 采用 Ant Design 6.7.0、图标6.3.4，官方6.x支持React19且无需v5补丁；见[官方迁移说明](https://ant.design/docs/react/migration-v6/)。原生Table/Form/Layout/Modal足够本轮，不增加ProComponents框架依赖。
- 依赖安装已完成：`pnpm install --no-frozen-lockfile` exit0（9.8s），新增65包，hooks prepare通过；antd6.7.0/icons6.3.4和FE的contracts workspace依赖均已链接，统一锁文件已串行更新。
- 根提供ConfigProvider、App上下文与主题；确认弹窗使用组件库Modal，保留原版本／幂等／未保存输入保护。

## 实施拆分
- 编辑器：基础、价格内部资料、图片与三语发布分组；品牌车型按字典选择或仅输入名称新增，不暴露规范ID；demo明确选择并保持待询价／库存未知。
- 媒体／译文／发布：图片管理卡、上传恢复、审核来源和发布门槛一致呈现；回收及历史保护保留；消除原生confirm。
- 工作台：缩略图、车型／车号／价格、库存与发布、更新时间、行操作、分页搜索与分类；真实版本批量操作逐项报告。
- 首页配置：两组标题、候选车辆选择排序与真实保存，demo可展示并明确标记。

## 验证与交接
- 开工hooks检查通过。本轮实际类型／模型／浏览器／截图／独立review证据已在后文“最终交付”及其冻结清单登记，不把旧轮次数当本轮结果。
- 3318后台和3320API保持本地试用，联调账号留私有说明。测试只操作自己新建记录，不操作其他角色车辆或IAB标签页。

## 本轮实际修复与中间验证
- 编辑、媒体、译文、库存发布、首页和公开核验均已采用Ant组件，普通员工仅按名称选择／新增品牌车型；所有window.confirm已移除。
- 字典实际消费 `/api/v1/admin/vehicle-filters`，批量消费 `/api/v1/admin/vehicles/bulk`，带Idempotency-Key与每项expectedVersion。原选中版本保留，列表刷新或再选其它行不能静默升级。
- 首页真实GET/PUT两组与公开三语核验已实现；共享验收库首页由PM持有，写测试仅随机隔离库。
- 根集成已与FE standalone脚本对齐：根 `dev` 转 `dev:web`（先build contracts再3317），`build/preview/test:e2e`继续调用FE包脚本，FE包内已封装运行时成品；CI步骤描述由static pages改为applications，未并发运行官网构建／typegen。
- `pnpm --filter @hd/admin check` 类型和7文件44单测通过；构建通过。Ant/React Router的use-client指令提示为客户端打包警告。`pnpm check:workspace` 28测试和实际边界扫描通过。
- 独立Reviewer发现并交作者修复：已有记录改来源必422且先清本地内容；首页取消慢重载后迟到GET覆盖编辑；刷新再勾选会静默升级原已选版本；批量结果核对期间其它操作未锁；旧员工离开后迟到GET仍弹出车辆信息。均已修复，最终QA与独立复查已完成，见后文“最终交付”。
- 根用独立Chrome只读查看3318桌面／390宽；后来只读查看PM新demo HD-000006/000007，未改任何车辆或首页，未操作IAB标签。截图临时目录 `/private/tmp/hd-ad-ux-preview/`。最终截图由QA另存证据。

## 最终交付
- 所有UI、业务交互与测试已冻结。44单测、20最终UI回归、最终真实demo／字典／首页／批量大流程通过；基础／manual真实流程此前分别通过，未声称同轮三项全过。
- 代码review5项P2和QA2项窄屏P2已修复复测；剩余P3为320首页卡头计数标签轻微裁切，AD后续处理，不影响操作。原文来源不可变、版本幂等、409保留、demo非库存与pending非人审均保持。
- 最终运行统一Node24.19.0。AD自身3318服务已正常重启到标准runtime，Vite dev保留运行；API3320由BE保留。写自动化仅3319/3322随机隔离库，不操作PM两demo或全局首页。截图只读。
- 根dev/dev:web、FE公共依赖和CI应用成品描述已对齐FE standalone，未并行运行Next构建/typegen。未提交、切分支、推送或部署。
- 最新测试命令、日志、产物SHA、独立结论与50文件冻结指纹详见[独立复查与冻结清单](后台-AD-UX-01-独立复查与冻结清单.md)，是本轮最终证据入口。

PM已报告实际3317→3320的20项只读检查、3318的6场景与首页320只读复查通过；详见[PM-INT-02](产品项目-PM-INT-02-官网接入与后台体验升级.md)，本记录不冒称AD亲自执行FE验收。
