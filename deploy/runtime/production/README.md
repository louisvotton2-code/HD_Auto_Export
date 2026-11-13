# OPS-REL-03 正式发布准备

本目录是维护工具，不是上线完成记录。正式环境仍须以 PM 核准的完整 main SHA、同 SHA 的 PR/CI verify、独立审查和实际发布日志为准。生产写操作前保留维护页并停止全部 API、导入、翻译、CLI 和迁移写入者；新旧 API 不同时运行。不得上传本机业务库、图片或样例。当前生产来源为 `hd_auto`，本次工具只支持原迁移账本 4 项的首次升级，不通用于以后有翻译计划／导入历史的清库。

## 组合与资源

依次加载 `compose.yaml`、`compose.proxy.yaml`、`compose.media.yaml`、`compose.domains.yaml`、`compose.production.yaml`；已有私有翻译配置另行核对覆盖顺序，不能覆盖下列固定身份、数据库、限额或媒体路径。渲染时加 `--profile tools` 才能同时检查 migrate 服务；不要输出含真实环境的完整渲染结果。

- `DATA_ROOT=/srv/hd-auto/data/current`：保留原 PostgreSQL、AUTH_SECRET、TLS/ACME 及续期路径；`POSTGRES_DATA_ROOT` 必须等于该根的 `postgres`。只运行一个 PostgreSQL 实例，禁止两个进程挂载同一物理目录。
- `HD_DEPLOYMENT_ENV=production`；`RELEASE_ID` 为获准 main 的完整 SHA；API/Web 同时收到 `HD_RELEASE_ID`。不使用浏览器 Host、Cookie 或 NEXT_PUBLIC 决定服务身份。
- `HD_DATABASE_NAME=hd_release_<main前16位>`，入口派生同名加 `_app` 的独立角色。`RELEASE_SECRETS_ROOT` 是本发布新私有目录，包含新的 app DB、Redis 与 SSR 三个秘密文件。AUTH_SECRET 继续来自原 `DATA_ROOT/secrets`，员工账号／权限／密码来自生产备份。
- `MEDIA_DATA_ROOT` 是新发布的空目录。API/migrate 挂到 `/data/media`，Nginx 只读挂到 `/srv/private-media`；原 `DATA_ROOT/media` 不挂入新应用。全部路径须规范绝对路径、无任何祖先 symlink、不相互包含，也不位于旧 media/secrets 之内。
- 文件目录 0700、秘密 0600。秘密文件 owner 为 APP_UID/GID（当前实际专用身份 15001），Web 非 root 读取 SSR 文件；Compose bind secret 的 uid 声明不能代替宿主所有权。秘密父目录保持 root 私有，不放入源码、镜像或公开日志。
- `OPS_PUBLIC_CACHE_NAMESPACE=hd:catalog:production` 与 API 一致，Redis 仅允许此 namespace 的 `slot:0..63` GET/SET，default 账户关闭。128 MiB Redis 缓存，服务限制 192 MiB/0.25 CPU，无宿主端口，无 RDB/AOF。缓存丢失可重建。默认网络 internal；仅 API 另接 api_egress 非 internal 网络作为默认出口（Compose 需支持 gw_priority，最低2.33.1，见[Docker 网络网关说明](https://docs.docker.com/reference/compose-file/services/#gw_priority)），供获准翻译/汇率 HTTPS 使用，代理另接独立 ingress 非 internal 网用于公网入站及回包；Redis/PG/Web/migrate不接出口或入口网。
- API 640 MiB/1.25 CPU、Node heap384；Web 768 MiB/1 CPU、heap512；PG1152 MiB/1 CPU、shared192 MiB/work4 MiB/max40连接；代理192 MiB/0.5 CPU。合计4 CPU/2944 MiB为运行限制，不能当实测容量或构建预算。
- SSR key 仅 Web/API 文件共享，原始 Web peer 使用固定 WEB_IP/32（现网只读盘点为172.30.94.3/32）；入口清除浏览器伪造的同名头并拒绝 `/internal`。数据回源30/s、burst40、不排队；version 仍执行可信访客 IP 的120/min。不要增加转发头白名单替代原始 peer 校验。
- 外部目录来源 disabled、读取 combined、同步 off。50000字符/滚动小时额度保存在 DB，不能清除预算表或靠重启重置。真实 Ali 仅在员工明确确认未知费用后使用，不做付费上线测试。

管理员域还须同源提供 `/staff/vehicles/<UUID>/publication-preview/` 的 GET/HEAD 给后台 iframe，HTML 强制 private/no-store/noindex，保留 Next 的同源 frame/CSP/referrer 保护；其 JS/CSS 由管理员域 `/_next/static/` 提供（仅成功状态长缓存），仅两个实际根布局字体 `/fonts/inter-latin.woff2`、`/fonts/inter-cyrillic.woff2` 作为无 Cookie/Auth 的普通 no-store 资源提供。不能把 iframe 改成官网跨域来绕过同源消息和账号要求；官网域明确拒绝 `/staff`。私有预览 JSON/图片仍须走管理员域现有鉴权 `/api`，不能缓存为公开 DTO。

## 首次 schema4 升级：停写备份、恢复与清空展示

1. 从获准 SHA 的干净独立 checkout 在 Linux/amd64 构建全部应用，核对镜像、admin 静态文件、Web BUILD、contract 与18项迁移。准备原版应用回退材料、维护页和新私有 env。先渲染五层配置，核对仅80/443公开、数据库/Redis不映射宿主，以及原物理 PG、原认证/TLS、新逻辑库/新秘密/新媒体挂载。保持正式入口维护，停止全部写入并验证连接排空。
2. 用**来源配置**（数据库仍 `hd_auto`、媒体仍原路径）和实际全部原 overlay 执行新版 `runtime.py backup --keep-stopped --backup /srv/hd-auto/backups/<新UTC名>`。`--keep-stopped` 成败均不恢复 API；检测到剩余 DB client 就拒绝备份。成功 manifest 必须记录 sourceDatabase=hd_auto；核对 dump/media hash、数量与原生产实况。旧历史备份不能代替本次最新停写快照。
3. 同一停写窗口将原实际使用的 env、私有 Compose overlay、翻译配置、原 secrets、TLS、ACME、续期服务/hook和应用镜像清单另存到本次备份的 root 私有控制材料包（文件0600、目录0700）。只在服务器上保存，不打印内容，不把真实配置写进公开日志。归档前拒绝 symlink/特殊文件，核对可完整恢复；数据库/media备份本身不包含这些控制文件。控制材料备份与恢复证明未完成则不切换。
4. `restore-release.py` 只在现有生产 Linux/root、本地 Docker socket、hd-auto 标记的唯一原 PG 容器工作，核对其真实物理 mount；拒绝现存目标 DB/role/媒体/secret/proof。来源为新鲜24小时内生产备份，先验完整 archive 路径/成员 hash。默认只预检，不创建 DB、不生成秘密、不切流量（预检也要求停写，表摘要使用只读临时表）。

   ```sh
   python3 deploy/runtime/production/restore-release.py \
     --env /absolute/private/new-release.env \
     --backup /srv/hd-auto/backups/<新UTC名> --main-sha <完整mainSHA>
   ```

   实际恢复追加 `--execute --gate /absolute/private/pm-release-gate.json`。gate 是运维依据已发生的 PM/CI 核准记录生成的本机0600执行凭据，不是自行批准：必须含相同的 `mainSha`、`pmApprovedSha`、`ciVerifiedSha`，对应快照 `backupSha256`、`sourceDatabase=hd_auto`、`action=restore-new-production-database` 和带时区的 `approvedAt`（24小时）。不填示例假 SHA，不能把文件存在当成真实外部核准。
5. 工具创建新 role/DB，以新 role 还原全部对象；拒绝该 role 有旧表／序列访问、旧 SECURITY DEFINER 执行权限或其他角色成员资格。恢复前后 public/drizzle 全表及 sequence 的 last_value/is_called 摘要一致，媒体实际解包逐一校验并留在备份的私有 `restore-verified-media`，**不放入新 serving media**。原库全表再核一次无变化，写 `release-restore-proof.json` 后保持停写。序列内部 WAL log_cnt 不参与业务等值判断。失败保留新库及材料诊断，不自动删除／复用／重启旧服务。
6. 确认恢复证明、账户/权限、原有费用/幂等和媒体完整后，只对新 DB 用新 migrate 服务执行18项迁移并退出。迁移 hash 必须与获准源码每个 journal 顺序 SQL 的 SHA256 完全相符，不仅看数量。原 schema4 进程没有新版本的持久小时预算，**最后旧翻译写入后至少等待完整1小时才启用真实 Ali**；不得声称新预算表自动承接旧版全部实际小时费用。等待期间 Ali disabled，后台明确显示不可生成；用户手工确认也不绕过此窗口。
7. 复核新旧应用均停、目标 DB 仅当前维护连接；以维护 superuser 对新库执行 `clear-inventory.sql`，psql 参数 `target_database`、`main_sha`、`expected_ledger` 分别为目标 DB、完整 main、源码18项 hash 用逗号连接。SQL 自身再次校验新库名、exact ledger、无其他 client，并拒绝非空翻译计划/segment或导入历史。不要将该 SQL 用于 hd_auto 或正在服务的库。
8. 清空仅车辆、草稿、发布快照/本地化/预览确认、图片引用及首页 vehicleIds。先把审计旧 vehicle_id 映射存到维护角色独占的 hd_release_archive，再解链审计；其余审计字段逐一保持。费用、账号、权限、原配置、幂等、持久预算等所有非展示表逐表摘要不变。只在事务内暂停两个具名 immutable guard，提交前恢复；公共版本触发器保持开启。COMMIT 后重新验证车辆/目录/图片/首页引用均空、账号权限及保留摘要一致、两个 guard 均启用、archive 对新角色无 USAGE。读取最终 epoch/revision，deferred trigger 可能在 COMMIT 再增版本，不能断言恰好+1。
9. 旧hd_app设NOLOGIN并对旧hd_auto撤销PUBLIC CONNECT，保留原角色/密码、库、原媒体与回退应用。新角色不能通过继承或 PUBLIC grants 访问旧业务表；实际验证拒绝旧表和私有 archive。固定旧 DB 为受限回退资产；不要重新开放旧版后台供录入。以上 fencing 只能在已批准停写窗口执行并记录，不能提前影响当前线上。
10. 启动同一发布的 Redis/API/Web/proxy，确认新 DB/new empty media/新 epoch 与缓存隔离。只做必要健康、双域三语空目录、后台登录、内部路径拒绝、404不长缓存、静态命中长缓存、真实 secret 配置装载与重启持久性检查，不造生产测试车辆、不导入供应商、不做真实翻译。公开页面同源，应用仍由统一代理入口提供。

## 写后故障保护

切换前失败且新版本未接收任何写入时，可按已核准回退程序恢复原版本/LOGIN与原数据路径。**切换后有任何新写入（包括登录会话、费用/幂等账本）时**，先维护、停止全部新写入、备份并验证新 DB/新媒体/新配置/费用账本；在最新数据基础修复或做审过的兼容迁移。禁止用旧库/旧快照覆盖新写入，不因健康检查失败自动回切旧数据。保留失败原证据。

长期异地备份、告警和灾难恢复未由本目录自动配置；单机同盘恢复证明不等于异地灾备。

## 已上线版本的日常升级

REL03 首次升级后，生产已使用独立 release 数据库和持久翻译预算。上面的 `restore-release.py` 与 `clear-inventory.sql` 仅用于已批准的首次 schema4 迁移，**不能作为后续发布流程再次执行**。日常代码整理发布必须保留当前生产车辆、媒体、账号权限、系统配置、审计、翻译计划和小时预算；不要根据新提交 SHA 自动创建空库或切换媒体目录。

1. 只读核对当前实际容器镜像、运行 Compose 参数、数据库名、物理 PG、媒体与秘密文件路径及迁移 hash；以实际服务为准，不能复用首次上线旧 env 或把历史空目录数量当当前验收条件。
2. 从通过 PR/CI 和独立审查的最终 main 在目标 Linux 构建。新配置只更新代码镜像的 `RELEASE_ID`/`HD_RELEASE_ID`，数据库名、媒体、认证、release secrets 和持久预算继续指向当前生产资源。渲染检查应清除外部 Compose/Docker 与 env 覆写，并核对实际绑定目标。CSV 导入和供应商同步按当前授权保持关闭，不以发布名义调用收费翻译。
3. 在维护窗口停止所有应用写入，使用当前生产配置做新鲜数据库、媒体和控制配置备份，保持停写。对该快照在隔离逻辑库及私有目录执行真实恢复校验，核对全部业务/审计表、序列、媒体内容与可恢复权限。恢复校验库不得接应用；验证后可清理本次临时库，生产库与受限历史回退资产不删除。只验证归档 checksum 不等于恢复成功。
4. 对比新源码与当前完整迁移账本；一致时不补造迁移，不清空任何表。确有新增迁移时，仅按该迁移的独立审查和数据保护方案执行，不复用首次清车脚本。
5. 仅替换需要更新的应用，沿用已验证网络、数据和凭据；必要的协议、配置或网络变化另按其实际影响成组切换。切换前后按停写快照核对数据/预算仍在，再开放写入。必要冒烟包括 HTTPS、公开目录、后台鉴权、服务健康和重启持久性；不要在生产造测试车辆或重复付费流程。
6. 旧 schema4 的一小时等待只适用于旧进程未持久保存预算的首次升级。已经使用持久预算的日常重启不清除预算、不以重启重置额度，也不重新等待一小时来代替账本核对。费用未知仍必须由员工确认。

任何阶段失败都保留原证据；新版本或原站已经接收用户写入时，先停止并保全**最新**生产数据、媒体、配置和费用账本，再修复，绝不能为了回滚代码而覆盖为旧数据库快照。
