# AD-I18N-01 冻结发布与运行切换准备独立审查

日期：2026-11-08（Asia/Shanghai）。Reviewer：`/root/backend_review`；依赖封闭性由独立子 Reviewer `/root/backend_review/db_review` 协助核验。两者均非本轮启动器或冻结发布的作者。

## 结论

**本轮运行准备审查通过，未发现新的阻塞问题。** 冻结发布文件、依赖隔离、新启动器的配置合并与进程归属检查符合本次范围。已独立执行只读 `--check`，没有执行 `--start`、停止或探测真实 API 进程，没有实际 API/数据库请求或付费翻译。

本报告不替代 AD-I18N-01 业务实现的独立审查，不重复业务 90 项/数据库 41 项检查，也不声称实际切换、真实供应商可用性或生产验收完成。旧版对新版单车幂等回执的兼容 P2 **仍未关闭**，不能将本报告解读为全部管理写入回退已兼容。

## 受审冻结材料

- 启动器：`docs/private/local-acceptance/start-frozen-i18n-api.mjs`；SHA256 `e1973ea824fb3a2d0b0f7a5e776699acbaa9ea091058b91290415da2fb8f051e`；权限 0600。
- 发布目录：`docs/private/local-acceptance/releases/ad-i18n01-fc546800-20261108`。
- manifest SHA256：`cd248d9e571aa82c9e440d4c8ce26a406ef71d3105dfe1f01ae2f1110407d351`。
- API 源码 26 项摘要：`fc546800ba8dfd3a7e5fb14318e3dcfbf6af89f61c09875d2456a35fff8a7ff3`。
- contracts 源码 5 项摘要：`13b3a2c6f28440d2a36e8cdd3395d6c7c8243c15a2d74ebe42296fd40728d60d`。
- manifest 记录 scope 为 AD-I18N-01，不包含 I18N02；`sourceHead=fdf6c6bc52b3a40761c4f991dde8e1f6a0fad028` 仅是来源 HEAD 记录，本轮候选的身份以受审源码/产物摘要为准，不声称整个候选已保存为该提交。

31 项源码 provenance 副本逐项符合 manifest。19,559 个普通文件全部存在且 SHA256 匹配，总 479,300,747 bytes；实际目录没有额外运行文件，只有 manifest 自身未列入运行文件表。276 个符号链接逐项符合清单，词法路径与最终目标全部留在 release 内，无悬空或环。所有普通文件 nlink=1，无与工作区共用的硬链接。API 11 项直接依赖均解析到 release 内，`@hd/contracts` 明确解析到该 release 的 `packages/contracts`。未发现 `.env` 命名文件；没有读取或输出任何真实环境值。

## 启动器核对

1. 必须显式 `--check` 或 `--start`，固定 Node 24.19.0 和本次 release/manifest；先校验全部运行文件、内部链接与 contracts，再进入配置或启动步骤。普通文件使用 lstat 拒绝以符号链接冒充。
2. 原环境与翻译 overlay 必须为当前用户所有、权限 0600 的普通文件，并由 Git 忽略。原环境摘要必须等于原回退准备记录；启动器不写回原环境或把环境复制到 release。
3. overlay 只接受翻译 provider、区域、凭据、配置版本和预算等列出的翻译项，不能覆盖数据库、鉴权、媒体或端口。child 仅继承少量系统变量，再合并原环境和白名单 overlay；拒绝 NODE_OPTIONS/NODE_PATH。数据库、鉴权地址和 secret、媒体目录、host/port 与原配置核对相同。
4. 强制 direct、127.0.0.1:3320、aliyun、ap-southeast-1 和本窗口每小时 5000 字符预算。冻结 provider 实现的 Action=TranslateGeneral、Scene=general，与安全摘要的 general 一致。检查输出只有上述非敏感配置和摘要，没有密钥、原环境或连接串。
5. `--check` 仅在进程内注入 `/health/live`，不调用 `/health/ready`、翻译或管理操作。已静态核对冻结 main/buildApp：main 才执行 listen；createDatabase 创建池但不在 live 路径查询；翻译 provider 构造不发请求。检查结束关闭 app。
6. `--start` 拒绝仍有效的既有 PID 记录与占用的 3320；只启动本次冻结 main，不执行迁移、清理或业务写入。成功判定包括 ready 200、child 未退出、PID 存活，以及 lsof 确认 3320 由所启动 child 监听；不会仅凭其他服务的 ready 200 宣称启动成功。
7. 失败不会自动停止任何进程、恢复数据/环境或执行旧版回退。如果新 child 仍活着但未 ready，执行者须依据记录的新 PID 核实归属、按已授权切换流程处理后，旧 rollback helper 才能接管；不能直接假设“抛错即已恢复旧版”。本报告未执行这一真实失败路径。

## 保留的回退限制

上轮 `/private/tmp/hd-be-i18n-rollback-review.md` 已确认：新版 AdminVehicle 回执的 `hasUnpublishedChanges` 被完整保存，旧版严格 AdminVehicleSchema 在共享单车操作的同 key 重放时会拒绝该字段并返回 400。本轮冻结源码仍保留这一保存方式，本次没有修复或改写回执。

因此旧 rollback 材料可用于其已核对的旧版运行恢复准备，但不等于新版产生回执之后所有管理操作重放均兼容。不得以换 key 代替原请求的幂等重放保证，不得把本次运行器检查记为该 P2 已修。实际切换与恢复记录应继续明确此边界。

## 本轮实际执行

- `pnpm hooks:check`：通过。
- Node 24.19.0 对新 helper 的语法检查：通过。
- 新 helper `--check`：退出 0，报告 19,559 runtimeFiles、276 internalLinks、preflight passed、原环境摘要一致、direct/aliyun/ap-southeast-1/general/5000、processOperations=false、paidCalls=0。
- 独立目录遍历、全文件 hash、链接真实目标/覆盖范围/硬链接检查：通过。
- 31 项源码 provenance hash：通过。
- 最后复核 helper 与 manifest 指纹：与本报告相同。

未读 backend.env 或 translation-aliyun.env 的内容；仅获准的 helper 内部解析并检查配置，输出安全摘要。未重新构建、安装依赖、修改应用源码、执行数据库操作、发起实际服务请求、调用供应商、切换进程或提交文件。仅此审查报告写入 `/private/tmp`。
