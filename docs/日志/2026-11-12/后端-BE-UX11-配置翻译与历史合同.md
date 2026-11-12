# 后端 / BE-UX11 / 配置翻译与历史合同
日期：2026-11-12（Asia/Shanghai）
状态：API实现、自测、独立审查完成，已准备交付配套联调；三端组合验收、3363切换另行记录。

## 范围与版本

PM核验用户在AD/FE的明确指令后统一分派。独立分支`codex/be-ux11`、工作树`docs/private/be-ux11-worktree`，起点`1bbe86c766ba15aed7ee1c7179ce94d9d0b6552a`；根dirty和旧冻结树保留。OPS共同基线`7d282eb7e4fed97f7dbb87644aca072df21ef0c8`已安全合并，merge SHA `97cc3e39e041d4b99fa05c141c694c59351c30b4`；不覆写并行API工作。运行使用本机Node24.22.1/pnpm11.25.0，未改全局Node。hooks检查通过，运行库/3363/生产不改。

## 合同变化

统一配置JSON（最终200项，原40草案作废）、strict raw parser、canonical存储与公开/预览同投影；旧遗漏保留、null清空。取消逐字段approved门槛，保留三语完整/非stale、真实来源与预览确认。多语bundle原子保存、翻译计划与一次费用确认、只读结果恢复。实际标题引用用户基础原文，不拼车型覆盖。历史/检测区分已知零与未知。用户随后改定报告交互：公开只给`report.hasReport`用于联系销售，鉴权后台才有安全原始URL；原`inspection.reportUrl`固定null、`reportAccess`不得携带available URL。关联检测记录也提供存在依据，访问unknown不作为展示门槛。精确路径和边界见[接口第18节](../../开发/车辆接口.md#18-be-ux11-配置多语工作区与真实历史)。

合同先行提交均已交AD/FE/PM/OPS：

- `2e1c1913d4f26b24f27e5709e1dd24b5194ad12e`：配置、多语工作区与结构化历史合同，76项检查。
- `56beaba64ee80c6989322e90c12a823a20c1570e`：中断纯读恢复完成态允许finishedAt:null、两个422错误枚举，77项检查；null不授权重发，也不表示未收费。
- `3a0681b5822b60b3fa8c863bf4c1bb32af2e6109`：报告存在事实／鉴权链接分离，78项检查。

以上均包含类型、构建和对应全部contracts测试；独立Reviewer `freshness_regression`分别审查PASS。它们不包含运行切换。

## API与迁移

0015保存员工确认计划与目标分段结果，0016保存离线检测补充／内部报告证据并使真实来源变化失效目录缓存。启动不自动迁移；ready无条件要求两份迁移所需表。新bundle接口在同事务核对车辆/展示版本和审计，保存失败不半更新。旧建议入口仅历史成功回执重放，新生成要求plan与明确费用确认。报告GET不外呼，员工副本按真实platform/externalId/原listingUrl唯一关联，公开读已发布source而非未发布draft。

历史语言来源需bundle显式确认；旧PATCH和独立localization PUT不得变更语言元数据，无/缺sidecar的老字段不会因私有备注保存变成中文。中文槽位派生自权威sourceText，旧英俄人改文本保留但过期。配置仅详情/预览展示，旧发布数据不回写。新SQL和源码尚未迁移业务库。

## 验证与限制

配置模块早期11项内存行为检查及单模块类型检查通过；外部结构合同9项新增测试和独立静态审查完成。首次新工作树无依赖无法构建，不记通过；OPS准备依赖后正式contracts类型检查/构建/全量测试曾74/75，失败为写入Zod transform不能默认生成JSON Schema；改成输入校验与显式canonical转换后75/75通过。独立Reviewer又发现NUL/孤立surrogate可通过配置契约却无法存JSONB，已拒绝并补回归，合法emoji仍保留。最终同工作树contracts check类型检查、构建及76/76通过。Reviewer `freshness_regression` 对全部合同/接线与三份文档独立复查PASS；A/C作者互审补充证据不替代该最终范围审查。最终合同SHA在交接时精确绑定。

专项实际结果（不可加总冒充完整suite）：旧integration/publication-preview/external-catalog初轮72/72；配置三语发布链补充后publication-preview19/19；统一工作区真实SQL/HTTP最终8/8，涵盖末尾审计故障整体回滚、completed/partial中断状态纯读、旧入口绕过拦截、历史缺sidecar与ready缺迁移；最终报告SQL15/15，含来源标记/唯一关联/旧嵌套URL清除/来源变化缓存失效及员工服务层admin、bundle、preview、三语public投影。报告这组为真实SQL和InventoryService调用，历史公开快照有明确合成种子，不冒称HTTP发布端到端。

最终同版本验证：

| 检查 | 实际结果 |
| --- | --- |
| `pnpm --filter @hd/contracts check` | 类型、构建、78/78通过 |
| `pnpm --filter @hd/api check` | 类型、188/188单元通过，0跳过 |
| 15个`test/*.test.ts`完整数据库回归 | 167/167通过，0跳过／0取消；Unix socket随机隔离库前后0→0，无遗漏或误删 |
| `pnpm --filter @hd/api build`及`openapi` | 通过；公开6条、管理38条path，公开无管理路由、采购成本、供应商联系方式、引擎和源指纹 |
| `pnpm check:workspace` | 28项及跨应用静态边界通过 |
| hooks与`git diff --check` | 通过 |

完整复跑覆盖122个API源码、测试、迁移和contracts源文件，前后指纹一致；聚合SHA256 `2dca8cdcfb808bb2854bfaf26cbbf8a6b1adefe5cfa796d9936eec41dce426e4`。迁移0015 SHA256 `3edfb835ac8c20be39c5fe112bc4c5d90d5a044053448ee4e4abbddcd9587a9a`；0016 SHA256 `57f91f71d654a82ab8c777532535cc383ce1ae2336f5ad34bc0afc6a3886a0d8`。最终实现SHA随交付消息提供，独立报告绑定同一版本。

独立审查：`freshness_regression`审全合同、B计划持久化、C来源/报告及根A/B集成；`catalog_cache_audit`独立审root报告接线与专用测试隔离入口，未自审自己实现的B。已修复并复查：重复JSON属性、JSONB不支持的NUL/孤立surrogate、失败译文缓存反复污染、旧语言入口和缺sidecar隐式确认、只有匹配检测记录却遗漏hasReport。旧单元适配保留身份、人改版本和stale保护，独立11/11复跑。新C初轮一项测试遗漏空checks/defects数组的预期已修正，随后定向检查通过；未把失败轮记录为通过。

首轮完整DB实际167项、158通过／9失败（含父测试，实际8处对比），新detail-only report使旧GET详情与mutation／历史回执的整对象比较不等；原业务字段保持。修复测试按真实详情附加report、保留不可变回执不回填，再完整复跑167/167通过。首轮15份测试指纹未变、随机测试库前后0→0，无残留或旧库误删。另一次普通权限单元检查中本机Redis mock监听被EPERM拒绝，改用已获准的临时本机测试权限复跑188/188通过，不标作业务故障，也不以失败轮声称通过。

私有证据由工作树`docs/private/be-ux11/`保存：`final-verification.json`、`all-db-result.json`、`all-db-suite.log`、`final-api-check.log`、`final-api-build.log`、`final-api-openapi.log`、`full-db-source-fingerprint.json`及`review-api.md`／`review-root-report-wiring.md`。首轮失败证据以`attempt1-*`保留。所有测试使用隔离随机库／模拟服务；不读业务凭据、不增加宿主数据库端口、不会重复导入20辆精选。公开/管理OpenAPI由实际路由生成在`apps/api/openapi/`，不是手写第二份契约。

## 限制与交接

未调用真实翻译或报告站、未迁移业务库、未推送或部署。PA此前19个报告仅返回网页外壳，仍无真实available证据；已停止正文探测。离线补充代码不等于200条运行数据已补录。单API进程的两并发/小时字符预算不代表跨副本额度或供应商免费余额。FE/AD配套集成、OPS恢复/迁移验证与3363切换按精确组合版本另记；业务和视觉由用户确认。
