# 运维 / OPS-01 / 本机持久化与恢复

日期：2026-11-08（Asia/Shanghai）
状态：待验收（本轮本地技术通过；用户业务／视觉验收未发生）

以下各阶段按发生时状态保留历史和失败证据；最终结论见文末“本机技术验收收口”。

## 范围与版本

- PM-INT-03 分派：本机先当服务器，图片私有本地磁盘，可整体迁移；不采购OSS、不连接旧服务器、不提交/推送/外部部署。
- 共同分支 `codex/backend-foundation`，基线 `61dc7414b20a395d1d09e906a49d974763b3cce7`；保留各端大量未提交改动。OPS仅改deploy与自身文档、独立审查报告；根依赖恢复是唯一一次受协调的共享安装，未修改应用源码。
- 本轮构建取最初应用文件快照，冻结于忽略目录 `docs/private/ops01/source/`。后续只同步OPS修复，不包含各端正在进行的删除/external/交互修改。**这些初始镜像不是PM-INT-03最终应用版本。** 真实数据最终演练须重新冻结与构建。
- 实际本机 Darwin arm64，Docker Engine 29.2.1 / Linux arm64、镜像Node24.19.0、pnpm11.25.0、PostgreSQL18.6、Nginx1.28.0。Linux/amd64未构建/运行验证。
- 原3317/3318/3320、原PG55432保持；隔离 `hd-ops01` HTTPS3410，恢复 `hd-ops01-restore` HTTPS3411，各自数据根、数据库和秘密。专用localhost证书仅在验证请求中信任，没有修改系统证书、DNS或网络设置。

冻结应用源码（按路径＋NUL＋内容＋NUL累计SHA256）：

| 范围 | 文件数 | SHA256 |
| --- | --- | --- |
| apps/api | 32 | 15077a74b3f361ecf2e67109bcbd30b60693b8a0e96abc9759749c1b065d9e85 |
| apps/web | 224 | a4fb78d477bbd3d4c45d3fced9563e57d8ac9b9684d8b9f54c7893edff3c1d9e |
| apps/admin | 48 | 3520809cd7c1eedb6c351b97f0c86a96aca4c7514ac67ed7760b1fa0b0d4535d |
| packages/contracts | 11 | e94a188aa54fd1c5e9f5e9d4fdec3dca27fca04724a3e6ee726f91a796c4ec6f |

## 实际变更

- [runtime入口](../../../deploy/runtime/README.md)：各应用Docker构建、Postgres专用初始化、Compose持久挂载、HTTPS反代、静态后台深链接、显式迁移、健康探针、日志轮转、版本/架构与回滚说明。
- 可配置DATA_ROOT包含postgres/media/secrets/tls，与镜像和构建独立。PG无宿主映射；只有127.0.0.1:3410/3411公开于本机。媒体不挂到Nginx，所有访问仍走API，接受UUID.webp与新BE的UUID.thumb.webp。
- 初始化、备份、恢复脚本提供私有权限、目标空目录保护、摘要校验、普通文件/路径/链接拒绝、失败partial保留及API恢复；冻结工具排除依赖、真实环境、数据和构建目录。
- API入口短暂root读取秘密与调整媒体所有权，随后清空附加组/setgid/setuid，以普通身份运行应用；具备启动所需CHOWN/SETUID/SETGID/DAC_OVERRIDE，降权后应用CapEff为0。PID1 docker-init及运维exec不是应用进程，仍为root。
- 官网SITE_INDEXABLE与origin同时传构建和运行时，本机均false。原静态out资料更新为历史用途。
- 现有3320适配器 `capture-existing.py`：仅PM协调停写、BE停API后捕获源DB＋全媒体；连接仍可用/权限错误/超时均拒绝执行，不自行停启源服务。真实采集尚未执行。

## 当前图片实证

- 原实际目录：`/Users/whisky/work/ownbus/websit/apps/api/.data/hd_auto_acceptance_20261108_188cd9e9/media`。
- 核对时6张WebP共1,071,608 bytes；目录0700、文件全0600，无符号链接。通过3320只读核验：2张当前公开图片响应SHA256与磁盘一致，另4张404；没有直接公开整个目录。
- 当前只保存转码展示图，不声称原始上传文件已长期备份。相对媒体UUID不绑定磁盘根或域名，迁移无需逐条改图片URL。

## 验证与限制

实际完成：

1. 开工和依赖恢复后 `pnpm hooks:check`通过。Compose配置、Python/Node/Shell语法、范围diff空白检查通过。
2. 四个Linux/arm64镜像实际构建；PG先初始化→显式迁移→API→官网→代理启动，全healthy。API运行镜像Node24.19.0；镜像内无`docs/private`、真实`.env`、`.data`或已挂载秘密。
3. 合成隔离员工登录Secure/HttpOnly、匿名401；合成车上传前私有404、上传/完成/发布三语可读、下架车辆与图片404，再发布用于恢复。资料不是实际库存。
4. 一致备份只暂停hd-ops01 API，PG custom dump＋完整媒体生成manifest后自动恢复API；全新hd-ops01-restore恢复并显式迁移。员工账号、车辆UUID与展示图都保留。
5. 使用各自专用证书的HTTPS检查每套15项，共30项：代理、后台/深链接/缺失资源404、匿名/登录/员工、三语首页和DTO、媒体hash与直接磁盘URL404。两套数据库＋应用全部force-recreate后30项再次通过；未操作原三端。
6. 合成图622 bytes，SHA256 `7bd7c3f93ec4bb0086a445fe23c83aa2c470a306d3113ffcb92bb829199316a6`，源/恢复/重建后的HTTP与磁盘均相同，文件600。最终应用进程UID501/GID20、CapEff `0000000000000000`；运行API入口hash与受审文件一致。
7. 11项Python测试通过：partial冲突不停止API、dump失败恢复原API、UID不符拒绝、坏摘要拒绝、空Compose列表、缩略图恢复/恶意tar链接、两种采集路径硬链接拒绝、实际停写要求与权限错误拒绝、代理固定IP与动态池/网关/子网冲突拒绝。缩略图当前为脚本测试，最终新BE缩略图运行验收另做。
8. 真实3320运行时执行capture拒绝探针，报告仍监听；未创建备份/partial、未停服务。

最终初始镜像ID：API `sha256:c3364b8f7e3e48d564d4e8bf9cc267191ee60e96169a72d7717d6215e586e8ea`；PG `sha256:12cae1be586a87e17ff248ddb6713916ea082b5bfd45f1b5ca59f82d3e761a5c`；web `sha256:bb72c2fffb8dfae7a5d7c997ec75da1bcc6c89401a2b29ba16384f7051b18a02`；proxy `sha256:bb305f38bd341c0a88b2d5a6168874e79cae83068bee5afd0f3b11a20aee30a8`。恢复web按3411重建，其他同版镜像。秘密、备份、详细HTTP/镜像/源码证据在忽略的`docs/private/ops01/`，数据文件600。

失败与修复（未隐藏失败）：

- Docker构建插件下载TLS超时，改用内置构建器；固定Node/Nginx镜像拉取及重试成功。
- 初次PG从宿主bind直接执行初始化脚本权限失败。保留失败数据根，改为内置SQL与降权前读secret，换全新data-v2验证成功。
- 独立审查发现备份准备失败未恢复API、UID不匹配、静态资源误SPA回退、入口缺DAC权限、硬链接备份与恢复规则不一致，均修复并复查；没有留下未处理P1/P2。
- Compose空服务列表返回换行，最初被误判运行中，恢复被安全拒绝；改为split()，新增回归，随后真实恢复通过。
- 第一轮构建/启动重叠曾让API短暂使用同标签旧镜像；最终强制重建全部容器，按实际image ID及入口hash重新核验，不用早先运行状态冒充最终镜像。
- PM报告根node_modules缺失；OPS现场确认，原因未知。OPS此前只有单向源文件copy与镜像/app内安装，没有移动/删除根目录。经PM协调独占 `pnpm install --frozen-lockfile`恢复（9.7s），未改锁版本、未重启3317或构建共享.next；Node24确认Playwright可解析，hooks复查通过。

独立审查：[Reviewer报告](审查-OPS-01-本机持久化与恢复.md)，由独立子Agent执行；运行测试由OPS实施，非独立QA。PM核验及用户业务/视觉验收未发生。本轮没有调用全仓应用测试以免干扰各端并发构建，不把历史测试数当本轮结果。

限制：初始快照API TRUST_PROXY仅false/loopback，模板false安全保留，网桥代理后的限流会聚合。BE后续已实现明确IP/CIDR；OPS新增可选compose.proxy.yaml、runtime --compose-override及Nginx转发头覆盖，配置合并和Nginx语法通过；独立review发现固定IP可能被动态数据库占用，补显式高半动态池和地址校验后关闭，待最终新API快照运行验收；不沿用初始镜像测试冒称此overlay运行通过。仅arm64实测、localhost自签HTTPS、合成数据；无开机自启/证书自动续期/外部告警/异地备份/SLA承诺。同盘备份不是灾备；API镜像仍含构建依赖。最终新schema/交互/真实多图资料未包含，不能称公网生产或最终业务验收。

## 最终联调计划与交接

- PM确认FE/BE/AD冻结摘要与PA真实录入完成→通知所有写入方停写→BE暂停3320→OPS捕获DB/媒体一致快照→立即由BE恢复3320→OPS全新数据根恢复最终应用→真实图片/来源/原账号/删除可见性/重建核验。
- 新组合标记快照时间及“恢复验证副本”，原后台继续唯一权威写入口；最终试用入口由PM选择，不能双写。当前未收到最终冻结和停写窗口，不抢先复制半导入资料。
- Git未提交/推送、无外部部署或采购；根package/锁/CI除恢复已有依赖外没有新增修改。阶段状态为待联调，不宣称整个OPS-01最终目标已完成。


## 限流身份链增量（待联调）

PM要求暂缓真实备份，BE/FE修复SSR访问者共享限流桶及图片与JSON共桶。OPS可选overlay将proxy/web固定为各自/32，分别排除动态IP池和网关；Nginx覆盖web入口 `X-HD-Visitor-IP` 为单一连接地址，API路由清除此头；web仅在overlay显式开启 `VEHICLE_API_TRUST_PROXY_IP=true` 后采信并构造XFF，API按两个可信直接对端配置。web和API没有宿主端口映射；SSR仍直连API，启动链无proxy依赖环。配置校验、Nginx语法与11项脚本测试通过；独立子Agent `/root/proxy_review` 复查上述六文件并重跑11项测试及hooks，无新增P1/P2；最终应用冻结后的双访客、伪造头、图片/JSON桶隔离端到端验证另记，尚未完成。此方案信任同一Docker网络内服务，同网络被攻陷容器能直连web伪造访客头，不声称防御该威胁。未启动新版、未操作3320及真实数据。

## Nginx 私有图片传输增量（待最终联调）

用户明确正式方案为本机私有磁盘加Nginx发送、后期可迁OSS。BE约定 `MEDIA_DELIVERY=direct|nginx` 默认direct；nginx模式API先核验发布/员工权限和文件安全，再返回内部路径 `/_hd_media/<UUID>[.thumb].webp`。OPS新增`compose.media.yaml`、root master/同API UID的worker配置、只读media挂载、严格internal路径、no-store、禁软链和条件304；runtime可叠加两个compose override。Native 3320仍由API直接发送，未称其经过Nginx。

独立3422仅用合成文件：目录700/文件600，Nginx worker UID501/CapEff0，internal重写返回正确字节及no-store，外部完整/畸形路径404、HEAD/Range、未来If-Modified-Since返回200；chmod000后拒绝，恢复权限后可读，代理重启后可读。首次启动发现Nginx正则花括号需引号，修复重跑通过；这些是Nginx内部转发探针，非BE真实API X-Accel端到端。独立子Agent `/root/accel_review` 对权限与路径设计开展审查，最终应用冻结后还需复核完整版本及实测发布/撤销/预览/缩略图、真实恢复和代理身份分桶。宿主/同网容器可信边界、同UID worker可读全部媒体及进行中响应可能完成已记录。3422探针已停止；原服务未修改。

BE进一步明确正式协议关闭Range分片，OPS配置 `max_ranges 0`；前述3422的206为旧探针结果，不代表最终配置；关闭分片后3422合成图片实际带Range请求返回200及完整内容，验证通过。条件请求可能304/412，但每次仍需先经API授权。


## 最终真实资料捕获（待恢复核验）

PM授权停写窗口、PA停止操作，BE确认停3320后执行 `capture-existing.py`：命令用时0.47秒，2026-11-08 18:48:38 Asia/Shanghai采集数据库与150个媒体文件，备份在忽略的 `docs/private/ops01/final-real-snapshot/`（目录700、文件600）。采集后立即通知BE恢复；BE报告3320以direct模式恢复、未迁移。dump/tar摘要及150张逐文件摘要校验通过，pg_restore目录可解析。源配置指向127.0.0.1:55432、验收数据库 `hd_auto_acceptance_20261108_188cd9e9`；容器映射证实为 `hd-auto-be-postgres-1` PostgreSQL18.6，dump头库名一致。

PM指定预期8辆v9、HD6/7归档v7、首页v4及71张新增图；这些版本和实际展示须在独立恢复克隆核对，尚未冒称通过。FE最终冻结前不构建最终镜像，不将同盘副本当异地备份。

## 真实备份隔离恢复与部分镜像构建

PM授权先于FE冻结恢复：使用全新 `hd-ops-real-clone` 数据根恢复真实快照；仅隔离PG运行，不启用应用或切换权威入口。HD8–15均published v9，HD6/7 archived v7，首页v4；150媒体文件名、逐文件SHA256及0600与备份一致。源库与克隆12张public表行数及逐行摘要均相同，含全部15车辆、78媒体记录、351审计和1员工；迁移历史和车辆编号序列一致。本次比较只输出摘要/计数，不保存原始记录。备份时间为2026-11-08 18:48:38 Asia/Shanghai，仍为本机副本。

根据PM授权从独立源码快照只构建PG、API及含admin的proxy，未构建web、未改源.next，使用单独 `ops-final-v9` 镜像标签。首次不慎使用旧标签启动构建，立即取消（exit130），随后独立标签完整构建成功；未重建或重启原服务。API 38文件集合SHA256 e7b8a58b2680d05af6a301f34ed4ea6fba6eb0be1618b4e529e750d320411596；AD 56文件 8f7a20013b7ee992e9ea7dbd7f1a685de69aa4c84419f97699a1e05c4ce3d8fb；contracts 11文件 52cc052c914382f098dae47bd2ac5c8675a8b7d821e87692cb45ac37cb174654；逐文件清单及构建日志位于忽略的`docs/private/ops01/`。快照文件与当前同范围文件逐项相等，仍需PM核对各端独立审查文件清单及最终冻结；FE冻结后重制全清单及构建web，最终镜像/真实API授权/Nginx图片/双访客/重启验收均未执行。

PM转交根独立QA阶段核验：`final-source/source-manifest.json` 372项内容匹配，manifest SHA256 `138dbdcc15785a6adf06c8f9d4ff77991203c2980c4feafe9650cd32dfb4f6ff`；API38/AD56/contracts11共105项与各端受审工作树范围及内容一致，BE 22源项与AD 42/7原摘要匹配。报告 `/tmp/hd-pm-int03-native-and-ops-source-stage.md`。native 3320 direct只读12 GET/65断言由根QA完成，不代替隔离Compose验收。FE新冻结后替换web源码并重算manifest，不能继续引用该旧manifest作为最终全应用版本。

## 真实克隆候选组合与限流／媒体验收（官网候选已撤销）

PM允许FE app-only 217项先行快照与构建：每项与当时工作树一致、候选完整manifest 368项 SHA256 `ae5facec6f5a302971dfff77f8173ef51ca6c78d6a938a1427a8a90cd9b0476f`。隔离 `hd-ops-real-clone` 经proxy+media双overlay在3412启动，四服务healthy、真实恢复数据和私有Nginx文件传输；原3317/3318/3320没有变更。此后FE审查发现冷却P2，PM撤销该217项freeze；当前web BUILD_ID `IFkZfVXybU5quKEQVXd13`、镜像sha256 `f31e2b3b483e13d1218203d00f85a61ab6452eac44581ffc5dc56ad092c19275` 均为历史候选，不能当最终；等待修复后重建web及重验。

- PM授权仅在clone创建合成HD16：通过真实HTTPS/API/Nginx验证未发布原图及thumb 404→上传、三语发布→原图/thumb/员工预览可读→删除两图404→恢复仍draft且不公开→再次逻辑删除清理；原8车与源库未更改。此后clone相对初始快照增加合成记录、图片、审计与session；不能再将当前数据库说成12表原样相同。之前恢复后、写入前12表摘要相同证据仍有效。
- 实际8辆71张缩略图和8张封面经3412 HTTPS/Nginx返回，与克隆磁盘逐字节SHA256相同，媒体no-store、没有对外泄漏内部重定向头。Nginx媒体卷只读、worker UID501/CapEff0、严格internal路径；BE内部直接响应带X-Accel且body为空，作为独立Reviewer观察。
- 两个隔离模拟访客172.30.82.4/.5通过Nginx：A的JSON 120次200后121次429；B伪造XFF/访客头指向A仍取得200，随后B图片桶120次404、121次429，而JSON仍200。最初测试客户端DNS回调参数不匹配失败，修正后实际检查通过。该测试对象仅为隔离组合，不涉及源服务；正式FE恢复后的SSR链仍须重验。
- 独立子Agent `/root/clone_review` 只读复核：proxy媒体RW=false，API/web无宿主端口、代理172.30.82.2/web .3，真实公开图与thumb 200/no-store、直连内部路径404、Range关闭、API成品sha256 `1a1857ef32dd87e9d75814e335cd7be105e0302b2c7080ed3aa461b22c3ce1f2` 与BE交付一致；未独立执行写入/限流或最终UI验收。其报告指出旧FE清单与工作树7文件差异，已确认为PM撤销freeze后的预期待修，不可当最终版本。
- 后续需FE新冻结/独立review、重新核对manifest及重建web、重测SSR访客与冷却、正式克隆容器重启后真实图片/记录留存；最终集成与用户验收未通过前保持待联调。只读测试窗口交PM，证书为忽略目录的本机CA，不修改系统信任。

## 3412 图片响应头补救（待根QA复验）

根QA发现X-Accel图片响应缺少API既有 `X-Content-Type-Options: nosniff`。OPS对比3412隔离raw API与HTTPS代理，确认API还提供 `X-Request-Id` 和 `X-RateLimit-Limit/Remaining/Reset`，内部转发后丢失；未发现其他既有安全响应头。Nginx internal位置补nosniff及从受控upstream响应保留以上追踪/限流头，未新增其他安全策略。上游与internal分别附加no-store会重复，是原有现象且语义不变，本轮未扩大至其他API路由。

配置sha256 `90489e849ffe8489a0759ad92469c09c6fa02ff0ace9c97d34c66ee77a1997f5`，已同步`final-candidate`、完整manifest sha256 `10c8ae8195a4029387704952b95db3f0c280e01db41dcdba59d3a04b39ae6d3f`；单独复制到3412 proxy并用实际 `nginx-media-main.conf` 语法检查及reload，原服务/数据未变。原图/thumb各GET与HEAD共4请求均200、nosniff/no-store、request-id及限流三头存在、内部重定向头不泄漏。首次误用默认主配置reload找不到PID并失败，未重载；随即使用实际主配置成功重载。当前是旧proxy镜像加可追溯容器配置覆盖，不把镜像原有sha当已包含修复；最终构建须重新打包。

独立子Agent `/root/headers_review` 静态核对API安全头及Nginx内部位置：无其他既有安全响应头缺失，新增追踪/限流值来自受控API响应；根QA复验与新FE候选的最终集成仍待执行。此前作者执行的合成写入和双访客限流、`/root/clone_review`只读核验及根QA独立请求分别记录，不互相冒充。

根独立QA对3412运行配置SHA256 `90489e849ffe8489a0759ad92469c09c6fa02ff0ace9c97d34c66ee77a1997f5` 完成6请求/46检查并报告通过：原图与thumb安全头、限流余量递减、不同request-id、图片与备份一致、internal及HD16拒绝。此为根QA独立复验；FE最终冻结与新镜像重建、最终集成和用户验收仍待完成。按PM要求reference视觉窗口期间不重启或reload 3412。


## 公开API尾斜杠兼容修复（待根QA复验）

根reference在375px真实页面发现FE媒体URL带尾斜杠，原3412代理直接转BE致42次404；先前无斜杠HTTP测试不足，保留该真实失败，不称先前页面验证通过。Nginx仅在 `/api/` 位置对公开 vehicles/详情、home/vehicles、vehicle-filters、media/:id 的单尾斜杠内部rewrite；query不变、不对客户端重定向，不改认证/后台路由。配置SHA256 `5896900b4225d12ba310cd175041314155de0a75c703511fdf06bb285f1e4a34`，3412重载，候选manifest `bc33b07e91844c4aa1e0ff5d8b8b04b3d3c750dd410b88c22000e3fdb831ac66`；仍是旧web候选和旧proxy镜像加配置覆盖，最终镜像须重建。

作者实测有无尾斜杠的车辆、首页、筛选、真实原图/thumb、未知ID在保留locale及variant时状态与稳定数据/图片字节一致，无3xx，nosniff/no-store/internal头保护仍有；编码斜杠、畸形UUID、%3F、双斜杠、公开POST和带slash的auth/admin均未绕过保护。独立Chrome 375px首页和目录滚动共11个实际带slash图片请求全200。首次rewrite放在上游变量初始化之前导致500，已调序重跑；首次JSON原始字节比较因requestId/时间戳差异失败，排除每请求动态字段后复验通过。初次浏览器缺少Playwright下载版本，改用本机Chrome完成，不下载浏览器或更改全局证书信任。独立子Agent `/root/slash_review` 静态复核白名单、query/权限边界无新增P1/P2；根QA针对性实测复验与FE最终freeze仍待完成。


## 3412 组合重建及前端候选撤回

PM临时批准前端App-only清单217项（2026-11-08 11:37:28 UTC），作者逐项核对工作树/独立源码一致，API/AD/contracts/OPS与原已审范围一致；候选全清单369项sha256 `71726f28fb4a2bdf7ab23dc6586713b4027022a873d24e0c98a1e83924f429af`，包含Nginx配置 `5896900b4225d12ba310cd175041314155de0a75c703511fdf06bb285f1e4a34`。独立构建web/proxy标签ops-final-v10，API/PG复用已审镜像ID，按PM释放窗口重建3412四容器，全healthy；代理实际镜像 `sha256:631fb98af51b7a273713350b26a5b247a340000564b9cbbc6041a82ff0fe8451`、实际配置hash与上同，web镜像 `sha256:7b91ec76bd4d330b66801129bbe257c6a7c1a42806c50c325783284219a3f354`、Linux BUILD_ID `7Jjvc-7GRMqbGSfgHWw-g`。

重建后原8辆published v9、HD6/7 archived v7、home v4及原150媒体逐文件hash均保留，合成HD16仍逻辑删除；作者slash/原图thumb/JSON/无重定向/安全头检查再次通过。此前根独立复验8请求58检查、reference 26带slash媒体200并报告VIS02关闭，native CTA VIS03亦由根独立关闭。

其后FE定向40项中的3项发现冷却时有效字典选项隐藏问题，PM撤销上述前端217项freeze，当前3412 web仅为中间候选，上述新manifest亦不是最终全应用版本；proxy/BE/AD不受影响。待FE新冻结后仅更新web快照、重算清单并重建web，做受影响复验，不重写源数据。原3317/3318/3320保持，3410/3411暂留；未宣称最终技术/用户验收。


## 前端正式冻结及3412单端替换（待根最终核验）

PM提供已审217项前端App-only清单 `/private/tmp/hd-fe-ux02-final-approved-app-freeze.json`，文件SHA256 `14326d0362bc7bf1f17e74931d79b700a6d73671e75ca67aa257d996d65296a0`；作者逐项验证工作树与隔离镜像构建快照一致，BE/AD/contracts/OPS与已审范围不变。最初对240项full清单核对时仅README已补说明与旧清单不一致；PM/FE更新full清单SHA256 `8fb0090b8cf945b0403db1f2bd62d07ff97c9082727e811f663315c38b93b4c1` 后，全部240项与工作树及实际镜像构建上下文一致。全仓候选快照369项manifest SHA256 `b30df20c9d70b1d4b61bcc2c6514d4bd03d828cdd762fb0abc3fc14e50a4d6d5`；web构建未写共享.next。

仅替换3412 web容器，PG/API/proxy未重建；Linux BUILD_ID `UpcpMFEakKoO_F4wqFAJ3`、web镜像sha256 `a9e300fd3e08bcf772fc777fb4dd350e84c149a43c3801a970505e43b147f5d7`，API镜像 `4dd510fced71d46e71443ba3604892d9372a16e7c989ca7646a9c84d720b3d23`、proxy镜像 `631fb98af51b7a273713350b26a5b247a340000564b9cbbc6041a82ff0fe8451`，运行代理配置SHA256 `5896900b4225d12ba310cd175041314155de0a75c703511fdf06bb285f1e4a34`。所有服务健康；前述替换前完整组合重建后数据/150图持久证据仍适用。

作者定向检查真实8车、带slash原图/thumb/JSON、no-store/nosniff/404与无跳转通过。375px Chrome首页与目录实际11次带slash媒体全部200，focus和visibilitychange后API请求0、页面导航0。SSR页面与BFF请求的同一访客桶余量从119到116，验证SSR带可信来源；首次脚本将响应头名字大小写敏感查找导致KeyError，改为小写键后重跑通过。当前3412已释放供根独立抽查；前端40测试/独立review为FE报告，根最终集成与用户验收仍待核对。原3317/3318/3320及源库未动。


## 本机技术验收收口

根独立QA报告 `/private/tmp/hd-pm-int03-final-approved-qa.md` 及 `/private/tmp/hd-pm-int03-final-approved-stage.json`：本轮限定范围无未处置P0/P1/P2，最终3412独立10 GET、44项断言通过，验证最终官网SSR/BFF可信访客、首页顺序、真实原图/thumb字节和安全头、已删除合成车图片拒绝；不把根QA读取的作者测试当作QA亲自执行。approved App217、full240和369项构建上下文分别绑定最终Linux web BUILD `UpcpMFEakKoO_F4wqFAJ3`／镜像 `a9e300fd3e08bcf772fc777fb4dd350e84c149a43c3801a970505e43b147f5d7`，proxy镜像 `631fb98af51b7a273713350b26a5b247a340000564b9cbbc6041a82ff0fe8451`／实际配置 `5896900b4225d12ba310cd175041314155de0a75c703511fdf06bb285f1e4a34`；四服务healthy，最终配置来自镜像而非临时覆盖。此前所有待联调、待复验和旧候选均为各自阶段记录，不是当前状态。

本轮仅本机Linux/arm64；Linux/amd64、生产服务器、域名/TLS、外网可达和异机备份尚未执行或验证。2026-11-08 18:48:38（Asia/Shanghai）真实资料备份与源位于同机同盘，不是异地灾备；3412是隔离快照验收副本，含独立合成测试记录，不用于日常录入或回写源库。原3317/3318/3320为唯一权威试用与录入环境，native图片由API直接发送；3412组合经授权后由Nginx发送。未提交、推送或生产部署；最终用户业务/视觉验收未发生。
