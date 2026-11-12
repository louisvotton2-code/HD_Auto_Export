# 后端 / BE-REL-03 / 正式缓存与翻译额度

日期：2026-11-13（Asia/Shanghai）
状态：待联调

## 范围与版本

基线`fe2ba4a6841a9f941cbe17467d4b1e4a772ccf93`，独立分支`codex/be-rel03`；仅apps/api、packages/contracts和BE维护文档。合同已保存`7de8e93038665724065fa1ef8fa7a999b77cff34`、内部SSR协议`735eb8fa6889bbd4109259d82e36199459260ef5`，两份分别独立审查并绑定SHA。API实现已通过独立复查，最终提交SHA在私有报告和交接中绑定。保留UX11冻结候选、根历史改动和3363，未推送或部署。

## 实际变更

- 正式`CATALOG_READ_MODE`与synthetic模式、缓存、同步分开；combined只读取已存外部目录，正式导入POST关闭、sync唯一off。原合成环境数据库/网络/翻译护栏保留。
- 复用PublicCatalogCache：16MiB/64项、TTL至多15秒、4路回源+最多16等待key，等待共享原请求3秒期限。相同key共用一次回源；最后等待者取消/超时移除队列，其他等待者继续，已执行SQL保留槽位至真实结束。真实HTTP断连不会误伤正常GET。
- 逐次读公共DB版本，提交失效与回源前后核对；事务回滚不失效，DB故障不吐旧值，Redis故障有界回源。stamp沿用原到期点，命中14秒旧值只剩1秒，汇率和媒体更早到期继续收紧。部署环境/发布身份、读取范围、FX身份进入不透明版本。
- 同一API内部公开GET别名仅服务密钥+实际socketpeer同时通过可读，静态key不赋予公开路由特权。数据令牌桶30r/s突发40、无等待；version继续逐可信访客120/min。公网/internal阻断与Redis128MiB待OPS配置，不宣称已生效。
- 公共schema可选meta.catalogCache及实际pageSize的10000 offset边界，保留真实total/accessibleTotal和游标全量可访问性。FE只缓存匿名公开DTO，后台/预览/错误不进入缓存。
- 新增0017持久PG滚动一小时UTF-16预留。调用前提交、失败/未知不退回、跨进程重启和engine切换不重置；额度DB失败不发外呼。旧计划幂等/分段恢复维持不自动重发未知结果。迁移对最近旧段保守按5000字符补计一小时，旧writer必须先停，不清空账本绕限额。

## 验证与限制

- 开工hooks检查通过。合同类型及81/81测试通过；contract_review另跑81/81及48种pageSize边界，绑定7de8。backend_review核内部协议文件对象，绑定735eb8；这些协议检查不替代整体API审查。
- 最终API类型及198/198单元通过，包含缓存层叠期限、20个不同冷key的4+16排队、队列满/超时、同key单/全取消、真实HTTP客户端断连、服务密钥与socketpeer、伪造头不绕访客限制；本机临时HTTP监听在结束时释放。初次检查曾因routeConfig类型及老限流mock缺少公共版本返回而失败，补足真实新增依赖后全部通过，未删除原关键断言。
- 8份受影响DB文件98/98通过，0跳过/取消；包括登录/库存/发布、公共事务版本、目录/美元/游标、翻译回执及新迁移。全部API源码/测试/迁移及contracts源码测试前后指纹相同，随机库0→0、无新增残留或删除既有库。仅称受影响8文件回归，不把UX11旧15文件167项并入本轮。
- 新额度回归实际在translator+PG组件子进程发出fake调用后SIGKILL，并在新子进程验证预留仍阻止超额；这不是完整HTTP应用重启/生产恢复演练。并发预留、失败计数、预算存储故障不dispatch、滚动过期和legacy补计不改回执均通过。原真实HTTP工作区回归验证同计划恢复不额外调用。
- API构建、OpenAPI生成、静态workspace边界、logger:true初始化与diff空白检查通过。没有新依赖/锁文件更改，没有真实付费调用、供应商同步、真实数据导入或3363写入。
- 独立API审查PASS，backend_review及其额度只读审查者均未参与本实现；报告覆盖25个实现/测试/维护文件，角色和本日志状态另行复核。Reviewer亲跑类型及46个相关不重复用例；初跑一个真实HTTP监听被环境拒绝，批准隔离回环后SSR3项复跑通过，不把环境失败记为首次通过。DB98项由实现者执行，Reviewer核128个源指纹与受审内容一致。三端组合、Redis128MiB真实配置、代表性20并发P95≤800ms、生产迁移/上线及用户验收未执行；3秒失败期限不是性能达标证据。

证据私有位置：`docs/private/be-rel03/verification.json`、`all-db-result.json`、`all-db-suite.log`、`final-unit.log`、`final-build.log`、`final-openapi.log`、`workspace.log`及独立报告。日志不包含运行凭据或真实车源原档。

## 交接

FE已取得受审合同及协议；AD报告基于新contract重建并保持后台no-store，最终组合仍由OPS独立核验。完整API提交和审查绑定后交PM/OPS；不因单端自测通过宣布已发布。

迁移0017 SHA256：`a5d6dbff3c27e4572c616a56400a3432ed5dcfb4f9d009388752b7e3974b7e65`。必须先停旧翻译writer再显式迁移，可能保守占用一小时旧额度，不直接回退旧内存预算程序。部署由OPS配置明确release/env、Redis私有账号/128MiB、SSR私有密钥/实际FEpeer/可信转发链及公网/internal拒绝；完整契约见[车辆接口第19节](../../开发/车辆接口.md#19-be-rel-03-目录缓存与分页契约)。
