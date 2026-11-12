# OPS / OPS-REL-03 / 缓存与生产恢复准备
日期：2026-11-13（Asia/Shanghai）
状态：进行中；尚未生产切换

## 范围与版本

- 用户已授权完成最新版本整合、正式缓存、备份恢复核验后清空旧车辆展示并发布双域；执行前仍须 PM 核准同一最终 main SHA。当前阶段只对生产做只读盘点，不停止服务、不备份、不改数据库、不切流量。
- 独立工作树 `docs/private/ops-rel03-worktree`，分支 `codex/ops-rel-03`，从 OPS-UX11 `40a7001bcf095f60eeb2ba60a39d0bda85ca1415` 整合；根目录 `codex/acceptance-polish` 的既有 dirty 改动保留。当前工作基准 `de4bc69`，OPS 改动待本轮提交。
- 已整合 AD 测试4936595与清理ee7fc00、BE契约7de8e93/SSR协议735eb8f/API0265fa1、FE-UX12样式b236d1e；对应本分支提交72bcb24/7ce745e/d9aa921/12c31d5/207f93e/de4bc69。各源报告按文件对象核对；FE正式SSR缓存最终SHA仍待交付。源报告的检查不冒称为OPS重新执行。
- 本机3363维持已交付版本和原数据；本次私有测试不提供额外业务入口。生产只读盘点为原02b817e组合，4核、约7270MiB RAM、59109MiB（约57.7GiB）可用盘；DB迁移4项、17车辆、1员工、96媒体记录。当前有422条带车辆关联的审计事件、1条旧翻译幂等回执，不能TRUNCATE/CASCADE。

## 实际变更

- 新 `compose.production.yaml` 固定 API/Web release/env 身份、私有Redis ACL128MiB、资源限额、原始Web peer与SSR文件密钥。默认内部网仅承载服务间通信；API单独配置翻译/汇率出口网，代理单独入口网；PG/Redis/Web/migrate不接公网网络，不映射PG/Redis宿主端口。Compose要求支持gw_priority。
- 正式媒体与认证路径分离：原DATA_ROOT继续保存PG/TLS/AUTH/ACME；新MEDIA_DATA_ROOT为空，API挂/data/media而Nginx挂/srv/private-media；新发布生成独立DB/cache/SSR凭据，保留原认证秘密与生产账户。新库角色与旧hd_app不共用密码或身份。路径校验拒绝旧media/secrets复用、嵌套、..与祖先symlink。
- `runtime.py` 备份显式使用选定逻辑DB及媒体根，manifest记录sourceDatabase；`--keep-stopped` 成败均保持写入服务停止，检查剩余client。原物理init/restore拒绝新发布逻辑DB或新媒体路径，防误覆盖现有集群；清除继承的Compose身份/路径覆盖。
- `production/restore-release.py` 默认预检，实际创建仅接受root/Linux/本地Docker/原PG真实mount、干净精确main SHA、PM/CI/备份同版本执行gate、新鲜生产快照和已排空旧库；只新建独立role/DB和新目录，不覆写已有对象。恢复后核对全部public/drizzle表及sequence逻辑值、实际解包图片hash；原库再核对，失败保持隔离与停写，不自动回退。恢复图片保留在私有备份，正式media仍为空。该工具尚未在生产运行。
- `clear-inventory.sql` 仅接受新hd_release库、完整main、精确18项迁移账本及排空连接；非空翻译计划/segment或导入历史直接拒绝。本次只清车辆展示相关记录，审计关联先存维护者私有archive再解链；账户/费用/幂等/预算及其余表摘要保持。两个具名immutable trigger仅事务内停用，public version触发器保持；新epoch在COMMIT后重新读取。尚未在生产运行。
- 双域代理对有效200/206/304的Next静态及hash Vite资产长缓存，错误／普通后台资产／后台HTML no-store；清除伪造SSR认证头，拒绝公开internal路径。HTML仍按应用自身规则返回，不做共享代理HTML缓存。
- 发布维护说明见[正式发布步骤](../../../deploy/runtime/production/README.md)，包含最新停写快照、另备控制配置/秘密/TLS、恢复证明、迁移/清展示、旧身份fencing、新写入后故障保护。旧schema4翻译进程未有新的持久小时预算，停旧翻译后至少完整1小时才启Ali，不能声称迁移自动承接旧版全部小时费用。

## 验证与限制

- 本轮hooks检查通过；冻结依赖安装成功，锁文件未改。contracts/API构建通过。
- Python runtime/profile/restore guards 合计29项：28通过、1原有root-only跳过。另Redis边界单测2通过、DB名称/角色Node单测3通过。不是整仓全测。
- 本地真实PG组件2项通过：18项事务迁移后清展示保留账户/回执/预算/审计/immutable guards，并拒绝错目标、非空翻译计划、二次运行；新role真实dump/restore保留全部表/sequence逻辑值，旧库表与私有archive访问均被拒。每项只创建随机空测试库和新role，finally删除，仅复用现有PG通道，不改业务DB。
- 真实reset首次失败是测试迁移装载器未模拟事务，SET LOCAL/LOCK TABLE被PG拒绝；改为事务装载后通过。完整失败记录保留，不把首轮记成功。恢复sequence内部log_cnt不等问题由独立审查发现，已改只比较last_value/is_called，真实dump/restore通过。
- Nginx Unix/TLS隔离组件3项此前通过；单Redis真实ACL8项＋default禁用通过，192MiB/0.25CPU、只读root/internal无端口均实测，临时项目和网络退场。原始证据在忽略私有目录，不提交真实配置。
- 最新五层Compose（包括tools profile）渲染通过，确认旧media不在新应用挂载、原PG/auth路径保持、DB/cache/SSR秘密分离、API出口/代理入口与内部服务隔离；没有启动任何正式服务。首轮遗漏tools导致无migrate、第二轮secret target绝对/相对表示导致测试断言失败，修正核对器后通过。渲染不等于公网可达实测。
- 独立Reviewer发现并已复读关闭：proxy媒体挂载原target串线P1、非规范路径绕过P2、sequence内部WAL字段误报P2；补足API出口及代理入口网络。私有预审/控制器报告按对应文件对象留存。最终完整提交绑定审查、组合API/SSR失效/故障/安全、一次代表20并发、Linux/amd64正式产物、PR/CI/main与PM最终核准仍未完成。
- 未重跑AD99/166/七例或FE48套件；UX11七类实流按原40a日志四轮证据保持，不冒称单次7/7。无真实Ali调用、供应商导入、生产清车、配置恢复或部署操作。没有上传本机数据库/照片/样例。

## 交接

- 当前未推送、未合并、未部署；生产数据与本机3363保留。不能将工具代码与本地合成组件通过当成生产恢复已完成。
- 下一步：消费FE精确已审SHA、完成组合缓存/故障/20并发验收，审查最终OPS提交，再按推送门禁登记精确SHA、PR/CI/main。只有PM核准该main后执行维护、最新备份及控制配置备份、真实恢复核验、迁移/清展示与双域切换，并记录写后保护与必要冒烟。
