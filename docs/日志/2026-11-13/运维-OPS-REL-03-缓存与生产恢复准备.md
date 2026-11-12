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

## 后续真实缓存组件核验

- 准备代码已本地保存为 `439c74e8f05f77777e3755e072e084ca64fe096b`，Reviewer逐个核对24文件内容/权限及父SHA，与受审manifest一致，工作树当时clean；未推送/生产执行。
- 使用当前API/contract构建、单临时Redis与随机新PG库、1000合成记录（10员工＋990外部），5类真实组件检查通过：混合目录冷/热及独立requestId；API组件重建后Redis复用且不延长原TTL；提交车辆状态后混合列表立即换版/数量1000→999；实际停止该Redis后回DB；仅禁用该随机DB新连接并终止其连接，已有热缓存请求返回503，恢复DB后查询恢复。初次list/detail/filters/home均核同版本；提交失效本轮定向复查list，未冒称四类都重跑失效矩阵。
- 该检查使用Fastify inject＋真实Redis RESP／真实PG，通过私有Unix通道接本机现有PG；不是HTTP/SSR端到端或20并发性能证明。真实Redis复用由API清L1重建后的原绝对validUntil约束验证，不能拿应用内memory缓存冒充Redis命中。外部HTTP在测试进程主动拒绝，真实翻译/供应商调用0。
- 前两次失败分别是测试漏传localized视图导致只返回10员工、按旧假设直接读取data.length而非契约data.items；均为测试装载/断言错误，已保留原失败与清理记录。第三次5类通过，没有把三次拼成一次无失败执行。
- 三轮每轮都退场自有随机库/临时Redis/网络/桥接进程，合成秘密删除；最新组件私有证据 `docs/private/ops-rel03/component-440466fda0c0f25c`。结束复核当前3363 ready200，原10控制文件和49媒体目录文件hash均未变（49是目录文件数，不是业务图片数）。独立组件证据核对PASS，报告为私有《组件独立核对.json》，结论仅限上述实际范围。

- 证据边界补充：DB断开检查发生在Redis已停止、L1已热之后；不声称覆盖“Redis健康且DB断开”的另一组合。Redis停止检查未实测4回源并发上限。真实外部调用0的保障为provider disabled且fetch主动拒绝，报告字段是声明值，非独立计费计数。
- 另完成生产只读工具/证书复核：Compose5.7.0、Docker29.9.3支持gw_priority，原四服务healthy；原证书到期2027-02-06T14:39:57Z，未续期/写证书/修改服务。

## 最终三端组合与单次代表性能

- FE自有 `15d3e424438779b59e4f5b5958f740df8e47324a` 已独立审查PASS，461源码文件、1772冻结成品文件和29symlink逐一核验，37自有文件Git对象与整合提交 `d22168bce9545b5a5e43e4b7ab89d28112fcfdb3` 一致。仅合其自有提交，不重复FE本地等价7de/735契约；此前UX12已合。AD消费者文档c3cdd8以 `0629514` 合入，应用源保持ee7fc00/f0c，最终Linux仍需重建消费者。
- FE继承的无JS缺车404正文可能空白（FE-REL03-P2-01）按PM明确决定非阻塞：真HTTP404/no-store、无旧车标题/联系/报告/车辆JSON-LD断言保留，失败不计通过，责任FE、正式运营前修复。原无效拆分实验已撤回，不引入Next内部或依赖改造。
- 最终组合私有证据 `docs/private/ops-rel03/benchmark-05ac3297bef9e04e`；API/contract为本分支正式实现、Web冻结BUILD `Gn2-2DAG9GD61KdnWEi5R`，单临时Redis按正式ACL启动，随机新PG库1000合成记录，原Nginx双域配置/限流/连接保护保持。运行平台Darwin arm64/native Node24.22.1，TLS及API/Web/Redis均走私有Unix通道，无新增宿主TCP监听；仅夹具原始peer用loopback模拟，非HK Linux性能/网络验收。
- 单次80个API请求，四批各20并发、批间2.1秒，全部200且各批20个requestId独立；超时/传输/HTTP/schema错误全部纳入，不删除429或慢样本。冷表示该路由应用缓存冷，不代表OS/DB页缓存清空。

| 代表请求 | P50毫秒 | P95毫秒 | 最大毫秒 | 错误率 |
| --- | ---: | ---: | ---: | ---: |
| 冷列表 | 226.98 | 599.07 | 607.73 | 0% |
| 热列表 | 63.20 | 68.35 | 70.53 | 0% |
| 冷筛选 | 74.93 | 323.14 | 323.83 | 0% |
| 热筛选 | 23.67 | 24.44 | 27.88 | 0% |

- 四项均满足P95≤800毫秒、错误<1%。未重复10万/50万规模或未变七例；该1000合成、20并发代表检查不是最大容量承诺。
- 官网另20个真实SSR请求分两批各10并发（保留原8/s、burst16，所以不冒称20 SSR并发），P95首批530.38／复用149.13毫秒，全部200，含n100合成车专属href与model，非仅静态筛选词。真实API记录40次逐读version和2次匿名数据回源，均正确静态key、无Cookie/Authorization/客户端trace/visitor头，数据回源无XFF；version在共享数据缓存外。API和SSR使用两个明确合成访客，不合并消耗同一120/min来制造正常态429。
- 另三项原始peer/key负例404（含正确key+伪造转发peer、缺key、错key），公网经代理internal404。HK真实peer172.30.94.3/32只做配置/只读盘点核对，最终Linux仍须实际SSR确认，不能把loopback夹具声称为HK原始peer实测。
- 有界队列单列保护probe、不计正常性能错误率：仅随机库vehicles独占锁，PG实际观察4个origin阻塞；cache只读metrics为active4/queued16，第21不同key快速503。取消已排队请求后替代key入队、等待仍16；释放锁后20个200、1个预期503、1个自有客户端取消。原3秒截止不变，公开保护未放宽。metrics观察器只捕获同一实例并原样调用原方法，不改loader或配置。
- 资源是结束时快照，不是峰值：API RSS178.44MiB/heap50.12MiB，Web RSS220000KiB（约214.84MiB），测试DB5连接/0活跃。native运行没有Docker应用CPU/memory限额，不用这些值冒充香港4核正式容器容量证明。
- 内层证明DB和全部自有API/Web/Nginx已退场，外层Redis/网络/bridge清理及合成秘密删除成功；未触碰3363/生产。脚本预审修正了网络错误丢样本、意外TCP回落、超时清理证据缺失、SIGTERM signalCode等待及SSR静态词弱断言，均发生在执行前，本矩阵本轮只执行一次且成功。若硬超时无完整内层清理证明，外层保留secret/socket和owned DB/PID完整身份诊断并失败，不会称全部清理成功。
- 远端main已fetch核对为 `409529c75ac02a660a8b6d8de04bcc517f23a582`，是本分支祖先。当前尚未最终verify:push/PR/CI/main或PM最终发布核准，生产仍原02b817e。

- Reviewer已独立重算100个原始样本数量与nearest-rank P95，并核对HTTP观察/队列/清理文件；《组合性能最终独立核对.json》PASS（SHA256 9a2401da8044b373ec334e6f72515034fc5f5a210ad15785e08e6354077e1243），未重跑资源或样本。

## 双域后台预览接线补修与门禁中断

- 对 `e1b9c5f90ac15f27edc108659d478c61690318fd` 的首轮正式verify:push已通过check与build、进入浏览器阶段；根集成审查随后发现真实P1：AD iframe使用当前admin域的/staff/vehicles/<UUID>/publication-preview/，正式代理此前仅开放/admin和/api，预览HTML及其_next静态资源会404。同源postMessage/cookie规则不能通过改用cars域规避。原单入口七例和本次公开SSR矩阵没有覆盖该双域私有接线，不能拿原通过冒充已验此项。Reviewer独立确认，e1全量报告记blocked，不登记pass。
- 只中止自有该轮门禁和17个精确归属子进程；Popen启动器从bash exec到pnpm Node保持同PID/原启动时间/原参数/原工作目录，核清后才停止。一次性纯合成PG容器/volume已退场，3100/3327/3319/55432测试端口全部释放；原验证锁的owner PID已不存在且没有其他validator后，按规则清理遗留锁。该轮exit -15，不记verify通过，不用它推送。原3363与生产不变。
- 最小配置修复：admin仅UUID窄预览路径GET/HEAD转Web，HTML private/no-store/noindex并保留Next CSP/frame/referrer；同源_next构建资源仅成功200/206/304长缓存；仅根布局实际使用的latin/cyrillic两个固定woff2字体代理Web、清除Cookie/Auth且no-store，不泛开其他官网页面。cars域/staff明确404，私有JSON/媒体仍走admin鉴权API。
- 真实Nginx定向检查首轮原3项通过、新增预览项在HEAD时因测试客户端仍读响应体而错误；修正HTTPResponse的method后只复查新增项通过，保留首错。它覆盖preview GET/HEAD、POST拒绝、非法UUID/其他私有路径拒绝、cars HTTP+HTTPS拒绝、静态成功/缺失缓存及两个字体去敏头。不是伪造首轮4/4。
- 另一次真实冻结Next成品的最小双域私有路由检查通过：BUILD Gn2-2DAG9GD61KdnWEi5R 的匿名预览壳HTML、13个初始JS/CSS和两个实际wOF2字体在admin域可达，同源frame/CSP/referrer及private/no-store保持，cars域拒绝。使用私有Unix/TLS，没有公开TCP入口、账号登录或发布；不扩大为重跑完整真实员工发布流程。证据私有 `docs/private/ops-rel03/preview-routing-b94b92fddbb6cd0f`，临时Next/Nginx/目录均由finally退场。
- 该补丁不改应用、契约、数据缓存、预算、队列和被测公开API路径；不重跑七例或20性能。待Reviewer闭合此P1、保存新最终SHA后，按保护对新SHA重新执行唯一有效verify:push，首轮中断记录保留。生产写入/PR合并仍未执行。
