# BE-ADMISSION-MILLION 百万累计准入与回执

代码基线为生产 v2.0.25 `975fac3341316821ea036ef9d17eb4a2281c37b3`，远端 main 与标签已核对。固定后端分支 `codex/be-million-admission`。本轮使用本机合成资料和独立 PostgreSQL，生产宿主、数据库变更和发行由原 OPS 统一执行。

## 容量与运行链路

- 宿主 `heavyWorkPausePercent` 与 worker、一次性运维容器的 `FULL_SYNC_HEAVY_WORK_PAUSE_PERCENT` 使用相同显式策略。部署未设置时为 70。80 模式的原生容量决定与回放前瞻回执都必须含数字 `heavyWorkPausePercent:80`。旧回执缺字段按 70 解释。实盘或预计峰值达到配置比例即挡重任务，回放准备还核对锁内 worker 持久化策略。60% 告警、I/O 保护、备份独立写入保护与撤回和改价优先级沿用原规则。
- 迁移 0055 增加两张供应商表与索引，现有历史准入不回填或扫描。当前签版账本可运行 `dist/db/migrate.js --apply-formal-expansion` 单独登记 0055。0050 未建时仍可保持延期。完整库备份保留两张表。首方业务范围备份由 OPS 同版排除两张供应商表的数据，保留 DDL。
- 额度预留运维命令只接受明确的目标 1,000,000，经已验证的最新保留快照、同库、同 CSV SHA、现有计数/上限、worker 代号和有时效的宿主前瞻容量凭据核对。必须还处于 `verified` 且应用游标为 0，避免旧上限曾跳过清单前缀却被纳入本次承诺。变更要求管理员、worker 退出并释放锁、无备份租约、无进行中的回放。提交同时记录操作 ID、审计主体、双游标与容量回执哈希，更新上限和快照容量目标并置容量待定。两游标均不回拨。新目标的原生许可生效后才允许新身份写入。旧版本在预留期间仅凭旧准入条件无法写入新身份。
- 重试同一操作 ID 可返回初次提交的回执，输入变化会拒绝。回退仅能恢复同一预留的旧上限，且上限不得低于已用额度。回退无需再证明前瞻容量，依然需要管理员、独占锁及无备份租约，保留当前快照的有效游标。已新增的身份不会被删除。

## 私有运维入口

复用不持有供应商密钥的 `full-replay-ops`，只读取固定的私有文件。下列三个入口都不启动同步 worker。

| 命令 | 文件及用途 |
| --- | --- |
| `full-sync admission-check --plan /private/admission/plan.json` | 只读核对 DB 当前依据，返回同清单上一次容量样本的 `sourceEvidenceHash`、`sourceTargetRows`、`sampleRows`，或已提交结果。 |
| `full-sync admission-change --actor <staffId> --plan /private/admission/plan.json` | 调整额度，初次向上预留额外要求只读 `/private/admission/approval.json`。 |
| `full-sync admission-receipt --plan /private/admission/receipt.json` | 按预留 ID 和固定快照读取真正首次提交的身份及当前公开状态，限制每页 250 条。 |

变更计划字段为 `id`、`database`、`snapshotId`、`csvSha256`、`expectedAdmitted`、`expectedLimit`、`targetRows`、`workerFence` 和 `rollbackOf`。操作 UUID 用于幂等，回退填写原预留 UUID，worker 代号使用十进制字符串。前瞻回执绑定当前发布、完整请求、原生样本散列、源目标与样本量、80 策略、实盘字节、峰值及 I/O 健康。有效期取测量后 60 秒及源回执到期两者中较早者。配置的绝对字节上限和原生样本记录的绝对字节上限一并校验。

回执请求使用 `reservationId`、`snapshotId`、可选 `limit` 和 `cursor:{through,after}`。首屏确定该次遍历的已提交上界，后续页不会掺入新身份。每条记录带实际首次准入时间、来源和挂牌 ID、来源依据（CSV / 增量 / 已批准回放）及原始事件号（如有）。状态分别为公开、撤回、员工隐藏、失败、等待、已处理且未独立公开。公开状态按每页观测时间判断，跨平台别名不能直接加总成公开车辆数。因限额、撤回或失败从未入账的集合沿用清单缺口和回放逐项状态，不计作首次提交。私有收据由 OPS 保留。

## 集成边界

生产继续使用已存的 CSV，释放 worker 前核对清单仍为 `verified`、应用游标 0 和同一散列。先从旧 70% 原生裁决获取同代、同目标的来源证据，然后以 80% 重新测量百万目标峰值，再在短暂停工窗口提交预留。重启唯一 worker 后仍需从生产确认新的 80% 原生许可、I/O 和容量头寸、改价与撤回延迟、初次提交收据及公开落地。当前不启动新 CSV。若该快照已推进或不再是最新，运维预留会拒绝这次计划，用原有差集流程核实已跳过的前缀。

已用额度超出旧上限后，按原控制停止重任务与新增，既有身份和撤回继续保留。此时旧上限回退应被明确拒绝。
