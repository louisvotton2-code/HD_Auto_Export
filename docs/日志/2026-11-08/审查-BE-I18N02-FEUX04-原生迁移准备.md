# I18N02 原生 3320 恢复窗口：独立运行准备审查

日期：2026-11-08（Asia/Shanghai）。Reviewer：`/root/backend_review`；发布包完整性由独立子 Reviewer `/root/backend_review/db_review` 协助核验。两者均非受审运行辅助脚本作者。

**结论：最终离线复核通过，没有剩余确认的阻塞问题。** 本结论仅覆盖 PM 已授权本地窗口的发布材料与运行辅助准备，不代表备份、0003 迁移、进程切换或真实只读验收已经完成。Reviewer 没有执行上述实际操作。

## 最终受审指纹

| 材料 | SHA256 |
|---|---|
| release `be-i18n02-d9c428bb-20261108` 的 manifest | `16197fe621783757c5ab19f56f64e7229ad4f2c7f0cd98a52b467c701fd49bfe` |
| `start-frozen-i18n02-api.mjs` | `12c2d35f7298569a11b9e0b12fc5ae2db5be780961fce8f39c74fe3e22b5a2c7` |
| `migrate-i18n02-native.mjs` | `288e268300c6ab729efb38b8bfdcc34a967d21094f655932ac6113c7d0f00764` |
| `smoke-i18n02-native.mjs` | `2103858b986875d84b4aa729737c5f570b6800fd56399e6e7da048043a9278b6` |

三份 helper 均位于 `docs/private/local-acceptance/`，权限 0600。源码终审及逐文件清单另见 `/private/tmp/hd-i18n02-backend-review.md` 与 `/private/tmp/hd-i18n02-backend-reviewed-files.json`。

## 冻结发布包

- 19,582 个普通文件、479,725,610 bytes，逐项 SHA256 与清单匹配；目录覆盖一致，没有额外未登记运行文件。
- 276 个符号链接均与记录一致，最终目标留在 release 内，无悬空；普通文件及 manifest 的 nlink=1，没有与工作区共享硬链接。
- API 的 contracts 与运行依赖均解析到包内，不使用可变工作区依赖。未发现环境命名文件；本轮未查看任何真实环境内容。
- API 28 文件聚合为 `d9c428bb3d4e072278c0b8f786db1ae90d1305e1347ed24b729f9d4a16d57a17`；contracts 7 文件聚合为 `3835472f023e6cc0809849bdf2ab2288bedc05fc415f3edb6149462c6bee2f3c`。已独立重算，并与源码终审一致。
- 上轮清单中的 40 个源码/测试/迁移文件和 4 个构建成品逐项一致；0000–0003 与 journal 均包含在 release。0003 SQL 摘要仍为 `32ffb5c812a03f0e19fd12f0d6206cad75995c9bf03f82c94006d90d54386ac7`。

## 运行辅助审查

启动器相对上一已审版本仅变更 release 路径、manifest 摘要和说明注释，原配置保护、内部依赖验证、明确 `--check/--start`、PID/端口拒绝条件及 child 监听归属确认保持。仍固定本机 direct 3320、白名单翻译 overlay 和本窗口 5000 字符预算，不修改原 backend.env。

迁移 helper 的 `--check` 在数据库模块导入、PID/端口检查及备份步骤前返回；只校验固定 release、启动器离线检查、原环境摘要和精确本机验收库目标。`--migrate` 路径有以下保护：

1. 确认原 API PID 不存活、3320 可用，并检查目标数据库没有其他 client backend；确认 0003 尚不存在。
2. 先生成八张业务表的一致读摘要。仅对相关单车幂等回执规范化移除新增字段，以允许本次无损拆分；原布尔值与拆分后 receipt hash 另行精确记录。
3. 私有目录 0700；数据库 dump 以独占新文件方式创建且为 0600。媒体逐文件复制并核验 SHA；dump 检查非空、记录 SHA，并执行 `pg_restore --list` 验证目录可读取。后者不是完整恢复演练，报告不扩大其含义。
4. **本轮审查建议已修复：备份完成后、开始迁移前，再次核对八表、全部媒体和待拆分回执元信息，并再次检查其他 DB client；任何变化都在迁移前中止。** 这仍依赖已协调的停写窗口，不代替持续阻止其他参与者重新连接。
5. 迁移完成后再次核对八表规范化摘要、所有媒体、历史布尔值/receipt hash，要求两张 localization 表为空，不凭迁移生成代际或驱动事实。
6. 记录 migration schemaTag、SQL SHA、attempted/committed 与 failedAtStage。失败不自动回灌数据库、不覆盖后续业务写入，不擅自停止其他进程。

失败处理边界：`migrationAttempted=true` 但 committed 标记未写，不足以证明迁移未提交，可能是提交后的清理或记录写入异常；执行者须确认实际 migration journal/结构，再按阶段使用旧受审 API 或前向修复。应保持写入暂停，不能仅靠记录标记决定恢复备份。

smoke helper 仅发送本机 GET，读取既有原图，不请求缩略图或翻译。before/after 对比 legacy 三语列表内容与总数、首页、单车详情及原图字节。**本轮建议已修复：after 明确要求 localized IDs/顺序/长度与同语言 legacy 一致、model 为 missing 且 text=null、generation/drivetrain=null，并检查私密字段与空扩展 facets。** 不再只输出缺译计数就视为通过。

## 审查方实际执行

- `pnpm hooks:check`：通过。
- 三份 helper 的 Node 24.19.0 语法检查：通过；修补后迁移和 smoke 脚本重新检查通过。
- 最终 `migrate-i18n02-native.mjs --check`：退出 0，其中串行执行冻结启动器 `--check`（进程内 live 注入，无数据库查询或服务监听）。
- 发布目录完整遍历、文件与链接核验、终审源码/构建关联：通过。

没有执行 `--start`、`--migrate`、`--verify` 或 smoke 的 before/after；没有检查真实 PID/端口、发起实际 API 请求、连接数据库、创建备份、调用供应商、停止或启动服务。真实窗口执行结果应由操作方另行登记，不能引用本报告为已执行证据。文件再次变化须按变化范围复核。
