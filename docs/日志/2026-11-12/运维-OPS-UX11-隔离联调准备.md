# OPS-UX11 隔离联调准备

2026-11-12（Asia/Shanghai）。本轮只接冻结合同和准备联调/回退材料，未启动候选、迁移或切换3363。

## 精确版本与本地接入

- 稳定共同基线 `codex/ux11-base` / `7d282eb7e4fed97f7dbb87644aca072df21ef0c8` 保持固定、工作区不改。
- OPS独立集成分支 `codex/ux11-ops`，持久工作区 `docs/private/ops-ux11-worktree`。
- 仅从新合同 `2e1c1913d4f26b24f27e5709e1dd24b5194ad12e` 接入18文件，本地合同提交 `0ca54bcb624c1bbc1bd5e8d182ca189bcb35abe0`；原BE父链不重复挑。raw binary patch与1bbe→2e逐字节相同，contracts树 `ab25dfd5a9e57048569148206358d60eb94ce949`。
- apps/api、apps/admin、apps/web及根包、锁、workspace、scripts、AGENTS、CI均保持7d原字节。2e只有合同/schema/fixtures/tests和三文档，不是API或迁移实现。
- 当前3363仍为ADUX10已交付组，原账号/数据维持；翻译disabled，真实翻译/供应商/报告调用0。不推送、不连接生产、不建号或改密。

## 已执行检查与独立审查

新OPS工作区hooks核对通过；离线frozen依赖准备0下载、锁不变。`pnpm --filter @hd/contracts check`通过（类型、构建、76测试/0失败/0跳过）；`pnpm check:workspace`28测试及478代码文件静态边界通过；差异空白和来源映射核对通过。未运行旧应用的整体类型、应用构建、DB或浏览器验收，跨消费者和路由实现仍待对应角色交付，不能据合同测试声称新端点可用。

独立Reviewer `/root/ops_ext_review` 已核18文件原补丁完整性、保护/锁/应用不变与上述日志，无阻断；本地提交和后续纯文档HEAD按实际索引/差异及源码不变证明绑定。原合同设计沿用BE/PM的冻结审查，不以本轮OPSintegration冒充API实现审查。

## 隔离资源与启动门禁

详细方案、非可运行的候选模板、接口运维清单及独立审查摘要在忽略目录 `docs/private/ops-ux11/`。模板readyToStart=false，三端应用SHA、FE BUILD、AD资产、API迁移/journal/OpenAPI与fake seam均待准确候选，null不作确认值。

复用现有2个依赖Docker和私有PG UDS，不建成批容器或数据库宿主端口。完整副本使用新随机 `hd_ux11_trial_<16hex>`，源动态取当前运行交付库（现15条），只读一致性快照和独立媒体，账户副本/测试认证严格隔离。默认API/FE/同源网关仅Unix socket；浏览器强制隔离重路由，无TCP回落到真实3363。若新AD原runner必须使用3319/3322，保留随机空库保护，OPS仅在受审排他窗口提供3491且固定API目标3322，结束后核库/会话/端口与精确进程身份清理。此刻资源未创建、端口未租用。

## 待候选联合验证

| 范围 | 门槛 |
| --- | --- |
| 迁移/旧数据 | 现15条精确hash→候选journal实际条数，显式迁移可重放；全原表原列、staff/auth、发布/本地化/首页/媒体保持，旧无配置公开快照不回填或追溯下架，原库只读 |
| 配置/bundle/preview | 统一200项/name100/value500/总16000 UTF-16及65536 UTF-8原JSON限制；验证与parseVehicleDraftWrite canonical存储分开，遗漏保留/空清除；公共与私有配置共用展示schema，真实语言/数字单位/ID不漂移 |
| 发布跨页 | 去逐字段approved但仍三语完整/非stale及最新预览确认，machine/pending保留，库存/权限/版本/指纹/幂等不撤销；配置/译文/换车/旧loadId/跨页返回不得复用旧证明 |
| 费用取消/未知 | 创建plan/GET status/取消/无明确确认等0fake调用；本版cost只能unknown，amount/currency/免费额度均null，不能写0或免费；acceptUnknownCost和maximumCharacters须显式匹配原计划 |
| fake执行/恢复 | 不注入真实Ali key，仅BE受控fake seam；持久预算预占/结算、并发、缓存、幂等、部分失败、outcome_unknown和分段复用；只读状态/重放不新增调用或重发POST，中断租约如实标partial |
| 历史/报告 | 0/null及false/null区分，缺陷数不作事故次数；四态与过期/源hash失配覆盖，GET不探外网。真实证据0available/19unknown，合成available不写真实业务 |

当前代理通用读取超时30s，与新generate120s聚合预算/AD150s请求需在候选按路由同组对齐，并禁代理/客户端POST重试；本轮当前配置未改。最大合法三语bundle需核实际UTF-8字节与API/Nginx/client上限，不截断；默认限流保持，用真实reset在用例/完成阶段等待。

## 数据保全与回退

UX11的源/写前回退点是届时最新冻结的当前交付库（现15条）及媒体/认证/应用配置，不是早期14库，也不是任何trial。旧14仅历史保存，不能覆盖当前15的合法新写入。

等新三端精确组合、迁移/fake预算联调及独立review通过、PM明确同组放行后，才停写排空、重新备份最新当前库/媒体/配置，恢复新交付副本并仅新库迁移，三端/合同/私图/SSR UDS和持久入口同组切。新写入前失败成组回冻结当前15；开放后（登录/会话也算）先维护停写并排空，再完整保全新库/媒体/配置及计划/分段回执/预算/幂等/审计，之后修复，不旧API接新schema、不以旧快照覆盖新写入，不延长已过期确认或声称失败未计费。

Ali恢复与AD一次确认/BE预算/新组合同组，非秘密账户站点与余额未知如实提示。未调用真实Ali、供应商账户或报告站；0资源执行与不代表运行放行的边界已写入模板。当前任务完成后继续等待候选，不为准备方案提前启服务。
