# 本机运行、备份与整机迁移

OPS-01 的运行入口。官网是 Next Node standalone，后台是 `/admin/` 静态产物，API 独立运行。根 `deploy/` 的 out 模板仅供历史静态版本维护。当前真实验证状态见[运维角色摘要](../../docs/协作/运维.md)与本轮日志，不把以下步骤当成已执行结果。

本轮本机真实资料恢复及最终组合技术核验通过，待用户验收。3317／3318／3320是唯一权威开发与录入入口；`https://localhost:3412` 是2026-11-08 18:48:38（上海时间）快照恢复的独立验收副本，含已逻辑删除的合成测试资料，不用于日常写入或向原库回写。私有账号和操作说明见忽略的 [本地联调访问](../../docs/private/本地联调访问.md) 与 [入口与恢复说明](../../docs/private/ops01/入口与恢复说明.md)，保持600。备份与源数据同盘，并非异地灾备；仅Linux/arm64实测，Linux/amd64尚未构建或验证，未部署公网。

正式发布的新逻辑库、空媒体、缓存和停写恢复流程见 [OPS-REL-03 维护说明](production/README.md)。以下旧本机示例保留原适用范围；新发布不能使用物理 `restore` 覆盖现有集群。

## 数据与入口

```text
HTTPS localhost:3412 → Nginx（隔离验收；下方命令示例可另用3410）
  /admin/ → admin/dist
  /api/   → API:3320 → PostgreSQL:5432（不映射宿主端口）
           授权后 → Nginx internal → media/只读卷
  /       → web:3000 → API:3320（SSR）
DATA_ROOT/
  postgres/   PostgreSQL 18 集群（镜像外）
  media/      UUID.webp 展示图片及 UUID.thumb.webp 缩略图，目录0700、文件0600（镜像外）
  secrets/    三个独立随机秘密文件（0600）
  tls/        证书与私钥（私钥0600）
```

正式组合Nginx只读挂载媒体目录，internal alias只能由API授权后触发；公开图片必须由 API 验证当前发布引用。下架、删除、未发布图片不能通过磁盘路径访问。历史引用和逻辑删除保留的图片仍应完整备份。当前 API 仅持久化转码后的展示 WebP，不长期保存上传原图。新BE媒体缩略图 `{UUID}.thumb.webp` 与展示图处于同一私有目录，运维脚本接受并完整备份两者，正式组合由Nginx发送、native开发模式由API发送。数据库保存媒体 UUID；相对 URL `/api/v1/media/{id}` 不随磁盘根目录、域名或新服务器变化。

每个服务的 Docker `local` 日志限制为 10 MB × 3；Nginx 关闭含查询内容的访问日志。API 自身日志可能含请求路径，日志按私有运维资料管理。容器失败最多自动重试5次；健康检查失败会显示 unhealthy，不会自动重启健康失败进程。宿主或Docker重启后需显式 `up -d --wait`，这不是已配置开机自启动。监控／异地备份／证书自动续期另需接入。

## 首次本机启动

依赖：Docker Compose v2、Python 3、OpenSSL；应用构建固定 Node 24.19.0、pnpm 11.25.0、PostgreSQL 18.6。基础镜像版本固定但不是安全更新承诺，更新版本后重新构建审查。宿主 Node 不用于Linux镜像构建。

1. 将 `.env.example` 复制至忽略目录，例如 `docs/private/ops01/runtime.env`，权限600。设置绝对 `DATA_ROOT`（独立于源码和构建，正式服务器建议 `/srv/hd-auto/data`），唯一 `RELEASE_ID`、宿主 `APP_UID/APP_GID`、空闲端口与架构；非root操作者使用自己的 `id -u`/`id -g`，root部署需选择核对不冲突的专用非零UID/GID（可无需登录账号），确保容器与宿主数值映射一致，同时填写PROXY_SUBNET、PROXY_DYNAMIC_RANGE、PROXY_GATEWAY、PROXY_IP、WEB_IP并确认子网空闲。本机 `linux/arm64`；x86服务器必须 `linux/amd64` 重新安装依赖、构建、验证，不能上传Mac原生依赖。
2. 初始化只接受不存在的数据根，不覆盖已有数据：

   ```sh
   python3 deploy/runtime/runtime.py --env docs/private/ops01/runtime.env --project hd-ops01 --compose-override deploy/runtime/compose.proxy.yaml --compose-override deploy/runtime/compose.media.yaml init
   python3 deploy/runtime/prepare-source.py docs/private/ops01/source
   ```

   初始化生成随机秘密和30天有效的localhost自签证书，不会启动应用。浏览器需自行信任本机证书；`curl -k`仅供这个隔离测试。公网部署必须换真实域名证书。初始化／恢复可由root运维用户执行，或由与APP_UID/APP_GID一致的非root用户执行；其他身份在执行前被拒绝。每个数据根从初始化到备份／恢复始终使用同一运维身份，避免root创建的私有锁文件使普通用户后续无法打开；目标服务器推荐全程以root操作。APP_UID和APP_GID均须为非零；在目标Linux还需确认该数值不与其他业务身份冲突。root初始化时DATA_ROOT保持root私有，ACME webroot单独归APP_UID/APP_GID以供Nginx worker读取。秘密保持600；不能用chmod777。容器启动入口以root读秘密、修正media所有权，随后清空附加组并永久降为APP_UID/GID运行API；Docker Desktop可能把bind挂载显示为root所有。Postgres自定义入口在官方降权前读取应用数据库密码，内置SQL初始化独立角色。不要把真实env、数据库、秘密或备份放进构建上下文。
3. 从冻结快照构建，既不复用也不改动正在开发的 `.next`、dist。快照内 `source-manifest.json` 记录源文件SHA256；把清单及镜像ID登记为版本证据。以下 `dc` 函数每次只操作指定项目：

   ```sh
   dc() { docker compose -p hd-ops01 --env-file "$PWD/docs/private/ops01/runtime.env" -f "$PWD/docs/private/ops01/source/deploy/runtime/compose.yaml" -f "$PWD/docs/private/ops01/source/deploy/runtime/compose.proxy.yaml" -f "$PWD/docs/private/ops01/source/deploy/runtime/compose.media.yaml" "$@"; }
   python3 deploy/runtime/runtime.py --env docs/private/ops01/runtime.env --project hd-ops01 --compose-override deploy/runtime/compose.proxy.yaml --compose-override deploy/runtime/compose.media.yaml validate
   dc config --quiet
   dc build postgres api web proxy
   dc up -d --wait postgres
   dc run --rm migrate
   dc up -d --wait api web proxy
   ```

   **迁移先于API，仅执行一次显式迁移步骤。** 新版发布前先停写并备份；迁移失败不启动新版。`/health/ready`不替代核对migration表及版本。官网origin和索引开关在构建时写入，换域名须重建web；API运行时origin同步修改，web的SITE_INDEXABLE和站点origin也显式传到运行时，不能带`/admin`。数据库专用hd_app不是超级用户，持有本应用schema所有权以执行迁移；进一步分离迁移与运行角色尚未实施。
4. 首个员工通过受控CLI创建，密码经stdin输入，不能放命令参数或仓库。以私有600文件为输入：

   ```sh
   dc run --rm -T api dist/staff-cli.js create ops-local@example.invalid '本机验收' admin < /absolute/private/staff-password
   ```

   默认注册关闭。验证后台登录Cookie为Secure/HttpOnly、Origin检查、匿名401；官网三语、目录/详情/真404、媒体、API就绪和后台深链接。不得向真实客户发送测试消息。

Docker秘密以文件按服务授权挂载，API入口运行时读入进程环境；镜像不含值。容器管理员仍能读取秘密，这不是对主机管理员的加密保护。[Docker秘密说明](https://docs.docker.com/compose/how-tos/use-secrets/)。

## 一致备份与恢复演练

`runtime.py` 对同一数据根加独占操作锁。**备份窗口须先停止该项目所有外部SQL、员工CLI、导入、清理和迁移写入**；脚本只能自动暂停本Compose的API，无法阻止另一个项目或直接数据库写入。真实3320/55432正在录入时，先由PM与BE/项目助理约定窗口，不能直接套用隔离项目命令。

```sh
python3 deploy/runtime/runtime.py --env docs/private/ops01/runtime.env --project hd-ops01 --compose-override deploy/runtime/compose.proxy.yaml --compose-override deploy/runtime/compose.media.yaml backup --backup /absolute/private/backups/ops01-20261108
```

脚本停止并等待API退出，PostgreSQL `pg_dump -Fc --no-owner --no-acl` 后复制整个media，并记录每图及dump/archive校验和，全部成功才将`.partial`目录改为正式备份名；原先运行的API在finally中恢复。失败保留partial供诊断，禁止把它记为成功恢复点。备份文件600、目录700。不复制运行中的PG数据目录，也不只备份公开图片。

恢复使用另一项目、全新DATA_ROOT、另一入口端口，例如`hd-ops01-restore`/3411；用新的env文件，改origin后web也须重建才能作为正式切换目标。初始化生成新秘密；员工账号和密码哈希来自dump，AUTH_SECRET变化会使旧会话失效（预期重新登录）。备份不含秘密、TLS或发布镜像，正式迁移需另外通过加密渠道保存或重建它们。

```sh
python3 deploy/runtime/runtime.py --env /absolute/private/restore.env --project hd-ops01-restore --compose-override deploy/runtime/compose.proxy.yaml --compose-override deploy/runtime/compose.media.yaml init
python3 deploy/runtime/runtime.py --env /absolute/private/restore.env --project hd-ops01-restore --compose-override deploy/runtime/compose.proxy.yaml --compose-override deploy/runtime/compose.media.yaml restore --backup /absolute/private/backups/ops01-20261108
```

恢复拒绝已有PG或媒体数据、运行中目标服务、摘要不符、重复/越界/链接归档项；不自动清空或覆盖失败目标。先将dump单事务恢复至空库，再放回已校验媒体；失败目标保持隔离、不要对外切换。接着用该项目和env执行 `run --rm migrate`、`up -d --wait api web proxy`。重新登录并核对记录、发布/下架状态、图片字节hash、权限，执行容器重建后再验证。源环境和目标均保留至用户确认。

### 定期备份上线步骤

1. 从受审发布目录固定 Python 路径、项目名、私有 env 和该项目全部 Compose override。先用合成项目手动执行同一条命令。备份目标须在 `DATA_ROOT` 外，父目录仅运行账户可访问。为每次运行生成新的 UTC 目录名，避免重试覆盖旧备份。

   ```sh
   set -eu
   cd /absolute/reviewed-release
   umask 077
   backup_root=/absolute/private/backups/hd-ops01
   install -d -m 700 "$backup_root"
   /usr/bin/python3 deploy/runtime/runtime.py --env /absolute/private/ops01.env --project hd-ops01 \
     --compose-override deploy/runtime/compose.proxy.yaml \
     --compose-override deploy/runtime/compose.media.yaml \
     backup --backup "$backup_root/$(date -u +%Y%m%dT%H%M%SZ)"
   ```

2. 授权后将核验过的命令放入主机受限脚本，由系统定时器每日在已批准的停写窗口调用。双域追加 `compose.domains.yaml`，外部车源和容量项目追加本项目实际启用的 overlay，顺序与启动一致。窗口内先暂停外部 SQL、导入和任务等写入者。普通配置的独立 worker 也须先停，合成容量配置的 API 与 worker 由脚本暂停和恢复。锁冲突、非零退出、只有 `.partial`、服务恢复失败或连续一天无新完整快照均应告警。
3. 每次核对 `manifest.json` 中的 `databaseSha256`、`mediaTarSha256` 与对应文件的 SHA-256，并确认原服务恢复健康。保留最近 7 个日备份及 4 个周备份。每月按上节恢复到新的隔离项目，核对业务记录和媒体摘要，记录快照时间及恢复用时。异地位置、凭据、实际启用及清理策略在上线窗口单独授权和验证。

## 新服务器迁移与回滚

1. 新服务器接入授权后才核验Linux/架构/磁盘/时间/防火墙/已有服务；不连接历史服务器。使用目标架构构建固定版本镜像，登记各镜像ID和源码清单。全量依赖当前随API镜像复制（包含构建工具）；生产缩减依赖作为后续优化，不能从Mac复制node_modules。
2. 分别迁移数据库逻辑备份、整个媒体、配置、秘密与TLS证书；校验hash，设置UID和700/600。跨机器/架构不用直接搬PG目录，PG主版本升级需单独演练。相对图片ID无需逐条改URL。
3. 空目标按顺序PG初始化→逻辑恢复→显式迁移→API→web→proxy；验证三语/登录/上传发布/下架或删除404/重新创建容器后留存。切DNS/公网端口/证书操作需明确部署授权。本机默认只绑定127.0.0.1，没有公网发布。
4. 切换前最后停写、做一致备份，再恢复和核对后切流。保留旧环境只读及旧镜像；不能让新旧库同时接受写入。回滚应用需确认schema兼容；破坏性迁移必须恢复成套DB+媒体并明确恢复点后写入损失，不能仅换旧镜像。
5. 每日备份、7日+4周保留、每月恢复演练是待实施目标；本机同盘副本不防磁盘损坏，不是异地灾备。选定异地位置后采用加密传输/独立删除权限，核验远端checksum和实际恢复。未采购OSS或备份服务，不宣称RPO/RTO已达标。

## 当前代理限制

API `TRUST_PROXY=false` 是初始快照的安全默认值，限流会聚合到代理地址。新BE已加入明确IP/CIDR配置；使用最终新API时每条正式Compose命令追加 `-f deploy/runtime/compose.proxy.yaml -f deploy/runtime/compose.media.yaml`，并在env配置已确认空闲的 `PROXY_SUBNET`、`PROXY_DYNAMIC_RANGE`、`PROXY_GATEWAY`、`PROXY_IP` 与 `WEB_IP`。例如/24子网的高半/25仅作动态池，网关.1、代理.2、官网.3留在低半（示例见.env.example）；两套环境用不同网段，防止先启动的数据库抢占代理IP。先执行 `runtime.py --env ... --project ... --compose-override deploy/runtime/compose.proxy.yaml --compose-override deploy/runtime/compose.media.yaml validate` 核对地址不重叠，再执行其他生命周期命令。overlay仅信任代理和官网各自固定地址/32，官网在overlay显式启用 `VEHICLE_API_TRUST_PROXY_IP=true`，Nginx向官网覆盖 `X-HD-Visitor-IP` 为直接连接地址，官网校验后向API构造单个X-Forwarded-For；官网和API均不向宿主映射端口，API仍无宿主公开端口，Nginx覆盖X-Forwarded-For/Host/Proto并清除Forwarded与内部IP头，对直接API请求清除X-HD-Visitor-IP。不要信任整网或客户端传入头。备份/恢复命令也按上例同时传入两个 `--compose-override`。更换已有Docker网络子网需要先停止该隔离组合并重建网络，不能在线改生产网络；初始已验镜像不启用此overlay。3412最终API与Nginx已完成多访客、伪造来源头及SSR/BFF身份核验；具体证据见[本轮日志](../../docs/日志/2026-11-08/运维-OPS-01-本机持久化与恢复.md)。此方案依赖该Docker网络内服务及宿主管理员可信；若同网络容器被攻陷，它可直连Web伪造访客头，该边界不提供隔离防护。

单域和双域入口从同一份 `nginx-edge.conf` 加载约束。按 Nginx 直连地址为页面 SSR（8 次/秒，突发 16）、目录列表／筛选／首页目录（12 次/秒，突发 24）、公开车辆详情（12 次/秒，突发 24）、认证（15 次/分钟，突发 8）分别计数。目录转发与直接访问相同目录路径共用目录桶。坏图 POST 保留独立的 15 次/分钟、突发 5 和 256 字节请求体限制。过限返回 429。静态资源和授权媒体只计连接预算，不占这些请求速率桶。

进入访问检查的并行请求按代理实例 192 个、每直连地址 32 个封顶。重定向、探活等提前返回的请求在该阶段前结束。请求头等待 10 秒，单个大请求头字段上限 8 KiB，普通请求体上限 10 MiB，读取请求体的连续无数据超时为 15 秒。保活闲置 15 秒，代理连接上游为 3 秒，连续写入与读出超时为 15 秒、30 秒。经可信负载均衡器接入时，须先确认连接来源和可信转发边界；当前配置按直连地址聚合。

入口访问日志仅含固定路径族、HTTP 状态和请求耗时（秒），例如 `{"family":"catalog","status":429,"request_seconds":0.001}`。请求级 Nginx 错误明细可能带真实 URI 或地址，现由代理丢弃；进程启动诊断和 HTTP 状态仍可见。正式 Compose 的 `local` 日志驱动每文件 10 MiB、保留 3 个文件。按路径族和状态汇总，日志无需带 IP、真实路径、查询参数或认证信息。

如果API入口报告 `Unexpected media entry`，先保持该隔离实例停机，核对是否为中断上传留下的点号`.tmp`文件；确认无任何写入者后将这些文件移到数据根之外的私有隔离目录并记录，不直接删除不明文件或放宽目录检查。恢复失败后的目标同样保留诊断，重新选择全新DATA_ROOT，不能在半恢复目标上直接重复覆盖。

## 现有3320验收库迁入本组合

先由PM确认各端最终冻结版本、项目助理导入完成，再安排短暂停写窗口。BE负责暂停3320，PM通知导入/后台/SQL/清理等所有写入者暂停；OPS不自行杀进程。下面的适配器只接受本机源配置，检查3320确实拒绝连接后才采集，权限不足/超时不能当作停机；它不会自动启停真实服务。

```sh
python3 deploy/runtime/capture-existing.py \
  --source-env docs/private/local-acceptance/backend.env \
  --database-container hd-auto-be-postgres-1 \
  --release-id final-reviewed-source-id \
  --backup /absolute/private/backups/final-acceptance-snapshot
```

保存完成或发生失败后，都由PM/BE及时恢复3320，继续作为唯一权威写入口。工具在采集前后检查API保持停止；这不能发现中途短暂启动或其他直写者，完整停写纪律仍须协调。数据库凭据仅从忽略文件解析，不进入命令参数、输出或备份；pg_dump通过已运行数据库容器的本地连接读取。文件摘要及UTC快照时间写入manifest，恢复步骤与前述格式一致。

最终新组合须使用另一个全新DATA_ROOT、端口和最终应用源码快照。恢复后核对真实照片数量/哈希、来源声明、三语信息、原员工账号、删除图片404等；记录快照时间并明确“恢复验证副本”，不允许和原库同时日常录入。默认只推荐一个后台写入口，由PM最终选定。本轮真实资料快照和3412恢复验证已完成；今后重新迁移仍须按当时最新数据与已审版本重复该流程，不能用既有快照代替。

## 私有图片由Nginx发送（正式组合）

在包含BE `MEDIA_DELIVERY=nginx`的最终冻结镜像上，同时使用 `-f deploy/runtime/compose.proxy.yaml -f deploy/runtime/compose.media.yaml`。API在发布引用或员工权限检查后返回内部重定向；Nginx只读挂载相同media目录，限制内部UUID文件名并发送图片字节。外部访问 `/_hd_media/` 不可用。原始展示图与`.thumb.webp`均走同一授权边界；未发布、删除和草稿图片不得由公开接口读取。已授权且开始发送的请求可能完成，撤权后的新请求必须拒绝；保留no-store。Range分片关闭，条件请求仍可能返回304/412，但每次都先经过API授权。

API和Nginx worker使用相同 `APP_UID/APP_GID`，目录0700、文件0600无需放宽；Nginx媒体卷只读。Nginx master以root读取TLS私钥并启动worker，worker实际为该数值身份且不保留能力。该身份能读取整个媒体目录，`internal`保护HTTP访问，但不能防止被攻陷的Nginx worker读取私有文件。仅向可信容器挂载此目录。外部对象存储另行设计，不通过公开整个本地目录替代授权。

使用两个override时，备份/恢复命令各传两次 `--compose-override`，依次指定 `deploy/runtime/compose.proxy.yaml` 和 `deploy/runtime/compose.media.yaml`；所有手工Compose生命周期命令也都携带两个 `-f`。正式域名/HTTPS须申请真实证书，替换目标数据根 `tls/server.crt` 和 `tls/server.key`（私钥600），用目标域名设置SITE_ORIGIN并重建官网，核对证书链、续期及重启后可读；本机自签证书仅用于本机，不能当公网证书。

当前权威写入仍是既有3317/3318/3320开发组合；原native 3320图片仍由API发送。隔离恢复克隆只供验证，不作为第二个日常写入口，不要与原库双写；克隆若必须测试写入，仅用明确合成记录且结束后不回写源库。3422合成代理是早期实验；其后3412已以最终BE镜像与真实恢复数据验证完整API授权、Nginx发图、删除／恢复及独立QA抽查。最终业务与视觉仍由用户验收。


## 双域部署与证书（新服务器，实施前核对最终SHA）

用户指定官网 `cars.hongdingauto.com`、后台 `admin.hongdingauto.com`；域名DNS由用户配置。双域属于独立overlay：在原基础、`compose.proxy.yaml`、`compose.media.yaml` 后再叠加 `compose.domains.yaml`，单域和双域沿用同一份入口约束。无密钥env须分别设置 `WEB_SITE_ORIGIN=https://cars.hongdingauto.com` 和 `ADMIN_ORIGIN=https://admin.hongdingauto.com`；基础Compose仍需 `SITE_ORIGIN` 插值，设为官网origin。web构建参数 `SITE_ORIGIN` 在Dockerfile中映射到 `NEXT_PUBLIC_SITE_URL`，同时设置运行时该值；后台API `AUTH_BASE_URL` 和 `TRUSTED_ORIGINS` 是后台origin，员工Cookie为admin域host-only，后台同源代理认证/管理/公开目录，不新增CORS。官网域仅开放白名单内的公开 GET／HEAD 和精确的坏图 POST，坏图 POST 转给官网 BFF。其余 API 和后台入口返回 404。两域均要求 SNI 与 Host 匹配，未知 SNI 拒绝。官网业务使用内部API，真实客户端地址只信固定proxy/web各自/32，不信外部转发头。

本机3430/3431以历史冻结应用及临时双域证书验证了域名隔离、后台登录Secure/HttpOnly/host-only cookie、官网canonical、ACME webroot、未知和错配SNI；2026-11-08两次本机自签证书原子切换/reload及运维脚本测试在本机非root环境16项通过、1项root专测跳过；独立Linux root容器17项全通过。该结果并非最终应用SHA、真实证书或Linux/amd64目标机上线验收；具体证据见[OPS记录](../../docs/日志/2026-11-08/运维-OPS-02-新服务器准备.md)。Docker发布端口可能绕过UFW，必须核对阿里云安全策略、Docker监听和主机规则；DB/API/web不可映射公网。HTTP 80仅响应ACME路径或重定向至对应HTTPS主机。默认Compose绑定127.0.0.1；公网监听仅在明确部署授权和安全策略核验后配置。

首次签发前确认两个A记录均解析到目标、无错误AAAA、云/主机80可达且该端口无人使用，并核实证书联系人邮箱。初始化使用独立DATA_ROOT（本轮已存在的 `/srv/hd-auto/data` 是父目录，不能直接对已有目录执行init，可选其下全新专用子目录）；备份/证书/环境文件保持私有。预先从最终受审SHA导出运行工具与配置；不得从共享dirty树或旧阶段构建。未签证书前不要启动需要TLS的正式代理。

示例（仅在DNS/端口、邮箱和部署任务均已核实后执行；真实值不写入仓库）：

```sh
# 首次签发：独占空闲80端口，结束后释放；证书名固定供续期识别。
certbot certonly --standalone --cert-name hd-auto --email "$CERT_CONTACT_EMAIL" --agree-tos --non-interactive -d cars.hongdingauto.com -d admin.hongdingauto.com
python3 deploy/runtime/install-domain-certificate.py --env /absolute/private/runtime.env --project hd-auto --bootstrap --cert /etc/letsencrypt/live/hd-auto/fullchain.pem --key /etc/letsencrypt/live/hd-auto/privkey.pem
# 随后使用四个Compose配置按数据库→显式迁移→API→web→proxy启动。
```

`install-domain-certificate.py` 检查两域、有效期和公私钥匹配，将证书/密钥600写入版本目录，原子切换 `tls/current`，容器master读取；续期时先 `nginx -t` 再reload，失败恢复旧链接，回滚reload失败须立即人工处理。不要直接把容器外绝对链接挂到容器。证书目录、旧有效版本及其备份须限制root访问。首次安装仅允许没有current和代理未运行；后续不带 `--bootstrap`、只允许已有current及运行中代理。

正式代理启动后，先在webroot放置无敏感内容的临时挑战文件，从外部确认两域 `/.well-known/acme-challenge/` 可读取；再以Certbot的 `reconfigure` 自带staging测试验证真实token（包括root创建目录/文件时Nginx worker可遍历及读取），成功后才保存standalone→webroot续期配置（Certbot 2.3+）。不要在仍为standalone且正式代理占用80时直接执行 `certbot renew --dry-run`。

将最终SHA中 `deploy/runtime/` 的工具作为受控只读副本部署在 `/srv/hd-auto/tools/`，root专属 `/etc/hd-auto/cert-renew.json`（600）写入 `{"runtime_env":"/absolute/private/runtime.env","project":"hd-auto","lineage":"/etc/letsencrypt/live/hd-auto"}`；再运行 `certbot reconfigure --cert-name hd-auto --authenticator webroot --webroot-path /absolute/data-root/acme --deploy-hook /srv/hd-auto/tools/domain-cert-deploy-hook.py`。该操作自带staging验证，通过后才持久保存该证书的webroot及hook选项。钩子只接受匹配root私有配置的 `RENEWED_LINEAGE` 并调用证书安装脚本。检查reconfigure结果与Certbot原生timer，再执行 `certbot renew --cert-name hd-auto --dry-run`；dry-run默认不运行部署钩子，因此另以root执行 `RENEWED_LINEAGE=/etc/letsencrypt/live/hd-auto /srv/hd-auto/tools/domain-cert-deploy-hook.py`，用当前有效证书安全验证钩子，并核对新旧证书、日志和reload；不能把dry-run单独当完整续期验证。若reconfigure/挑战失败，明确记为未完成、处理告警，不声称已自动续期；不要随意禁用系统全局timer。目标机Certbot 2.9.0已确认能解析这些参数，真实证书、staging、配置持久和续期仍待执行。

真实数据切换须临近上线协调AD/BE短暂停写，采集**当时**权威native验收库及其实际MEDIA_ROOT，包含全部资料；校验DB与完整媒体清单，在目标新数据根恢复并核账。不要使用本轮18:48旧快照或3412测试克隆，不预设8辆车；原库不清理并保留回退。正式证书、云防火墙、域名连通、AMD64构建、迁移及真实业务上线均未发生。

## OPS-EXT-01 外部车源隔离环境

只用于本机合成数据。独立项目 `hd-ops-ext01` 使用私有 `DATA_ROOT`、独立数据库和秘密。先用监听及 Docker 网络清单核对本机入口、网段和项目名。已为本轮选择 `127.0.0.1:3440`、`172.30.86.0/24`（固定代理 .2、官网 .3、动态池 .128/25）。`SITE_ORIGIN=https://127.0.0.1:3440`、`SITE_INDEXABLE=false`，本轮 Mac 使用本机 UID/GID 和 arm64 镜像。应用镜像从共同提交的干净导出构建，Compose 配置在当前工作区单独验证。在权限为 0700 的私有父目录中，用 `git -c tar.umask=0022 archive <SHA>` 和 `tar -xpf` 导出并保留归档权限，确保 PostgreSQL 初始化 SQL 在容器中可由非 root 用户读取。

在新目录执行既有 `runtime.py init`，以 `umask 077; openssl rand -hex 32 > "$DATA_ROOT/secrets/ext_cache_password"` 生成缓存秘密，再按下列顺序使用四层 Compose 文件。本轮使用 Compose 5.0.2，覆盖层需要支持 `!override` 和 `gw_priority`。初始化、迁移、启动与恢复见本手册前文。实际环境文件、生成数据和输出留在忽略目录。

```bash
compose=(docker compose --env-file "$OPS_EXT_ENV" -p hd-ops-ext01
  -f deploy/runtime/compose.yaml -f deploy/runtime/compose.proxy.yaml
  -f deploy/runtime/compose.media.yaml -f deploy/runtime/compose.ops-ext.yaml)
"${compose[@]}" config --quiet
"${compose[@]}" run --rm -T migrate </dev/null
"${compose[@]}" up -d --wait redis proxy
"${compose[@]}" ps
"${compose[@]}" stats --no-stream
curl --cacert "$DATA_ROOT/tls/server.crt" -fsS https://127.0.0.1:3440/health/proxy
```

内部网只供数据库、API、官网、缓存和代理使用，只有代理加入入口网并发布 loopback 端口。代理覆盖外来转发头；API 继续只信任两个固定地址。Nginx 使用上文两套拓扑共用的入口约束，原 API 保护继续生效。翻译配置显式关闭。Redis 无宿主端口，禁用默认用户，`hd-cache` 仅可操作 `hd-ext:*` 的基础缓存命令；上限 128 MiB，按 LRU 淘汰，无持久化，授权键在容器内使用。BE 冻结缓存客户端与独立 worker 入口后，再按实际命令和密钥读取方式接线。

运行预算为 PostgreSQL 1.5 CPU／1152 MiB、API 1.5 CPU／640 MiB、官网 1 CPU／768 MiB、代理与缓存各 0.5 CPU／192 MiB，合计 5 CPU／2944 MiB。迁移单独执行；为后续 worker 预留 0.5 CPU／512 MiB，未计入当前运行上限。先采集宿主余量、容器 CPU/内存和 OOM/重启次数；每档负载另记 HTTP 状态、连接错误与成功请求 P95，记录数据规模、镜像与缓存冷热。没有持续告警任务。

联合备份使用 `runtime.py backup`，同次传入 proxy、media、ops-ext 三个 override；暂停该项目所有写入者，今后包括独立 worker。恢复时用新的项目名、`DATA_ROOT`、空闲入口及网段（如 3441 和 172.30.87.0/24），重新生成 DB、认证和缓存秘密。仅从已核验的数据库与媒体包恢复；检查迁移记录、合成记录及媒体实际摘要，再启动恢复验证所需服务。缓存重建由应用负责。备份恢复只覆盖合成环境，另行核验真实数据和恢复目标。

压测脚本 `ops-ext/bench.py` 只发 loopback HTTPS 的目录、筛选、首页数据及详情 GET，验证本机证书，并按路由记录 2xx 的 P95、全量错误占比与原始状态（包括 429）。等 BE 提供 10 万／50 万合成装载入口和查询分布后，分别跑 20／50／100 并发，每档按冷／热缓存记录。启用现有限流的单来源测试会限速，429 必须单列；真实性能测试需由 BE 提供只在隔离环境启用的策略，或使用独立可信合成来源，不能把限流当查询容量。PM 初始门槛为 20 并发常用列表及筛选 P95 ≤800 ms 且错误率 <1%。

### OPS-EXT-02 容量环境

容量模式由本机非 root 用户运行，容器内 API 和 worker 使用同一数值 UID 读取私有秘密。使用独立项目 `hd-ops-ext02-<用途>`、私有数据根及空闲 loopback 入口。初始选型为 3442（测试入口）及 3443（恢复验证），启动前重新检查端口及子网。保留一期 3440。用该任务确认的同一源码快照构建 API、官网、后台代理和 PostgreSQL 镜像。依次传入 base、proxy、media、可选 domains、ops-ext、ops-scale 六层配置；运行 `runtime.py` 时同样带齐 overrides。域名拓扑在本机使用带双域 SAN 的私有测试证书和本机解析；SNI 及 Host 由测试客户设置，不查询生产。

额外环境项：

- `OPS_EXT_SCALE_DATABASE=hd_ext_scale_<小写后缀>`。初始化为该库生成单独的数据库 URL 文件。API/worker 读取私有秘密文件，应用和迁移使用 `synthetic-scale`、`NODE_ENV=test`、禁用翻译。API、数据库、Redis 和 worker 都不发布端口，内部网仅代理连接入口网。
- `EXTERNAL_CACHE_NAMESPACE=hd-ext-scale-<slug>`。Redis 只允许认证用户对该命名空间槽位执行 GET 和 SET。Redis 默认不持久化，禁止管理命令。使用 `EXTERNAL_PUBLIC_CACHE=off|memory|redis` 切换对照，`EXTERNAL_CACHE_TTL_MS`、`EXTERNAL_CACHE_MAX_LOADS` 需记入证据。缓存密码用私有随机文件 `$DATA_ROOT/secrets/ext_cache_password`。
- worker 只在显式启动时加入，使用独立池和同一隔离数据库。启动后用健康检查观察数据库心跳，无独立监听。合成 CLI 的 `--seed <generation>` 写入本机假事件，`--run` 消费，`--health` 汇报。合成 worker 未接真实供应商及翻译。

迁移成功后在空库执行一次 `docker compose ... run --rm -T --no-deps api dist/external/scale-seed.js --count 1000|100000|500000`。命令中的条数任选一档；切换档位时新建专库及独立数据根。保存装载结果与代表查询预期，运行 `ANALYZE` 后采集实际查询计划和数据库大小。验证三语、常见品牌、罕见品牌、组合区间、员工优先、传统分页和游标边界。

容量主测量使用 `docker compose ... run --rm -T --no-deps api dist/external/scale-bench.js <场景> <并发> <请求数> [--warm]`。后端合成命令在 API 进程内运行真实路由并模拟独立访客身份，不启用网络旁路。按 20／50／100 并发记录各路由延迟、请求数、吞吐、非 2xx 和 429。关闭缓存建立对照；冷缓存重启专用非持久缓存、请求数等于并发数并跳过预热；热缓存使用 `--warm`。同步档运行隔离 worker 并投递可核验的合成事件，记录与查询重叠的时间。记录器的内部 HTTP 模式可核验固定 API 服务在测试子网内可达，但同一 runner 仍受 Fastify 每来源 120 次／分钟限制。公网式防护用宿主 `bench.py --host cars.hongdingauto.com --port 3442 --ca <测试证书>` 单独核验，域名仅用于本机 TLS 和 Host；由真实限流产生的 429 不计作查询容量结果。

`ops-ext/observe.py --project hd-ops-ext02-<用途> --samples <次数>` 输出运行状态、健康、重启、OOM 和 CPU／内存快照。采集目标限定专用项目，临时 runner 单独观察。PostgreSQL 缓冲区、临时文件、连接／等待和 worker 积压按阶段分别记录，观察数据留在忽略目录。

容量备份会先暂停运行中的 worker 和 API；另外停止手工或一次性导入／装载容器。在库内确认其他连接为零后备份数据库和媒体，完成后恢复之前运行的写入服务。恢复只能读取同一合成 profile 的快照，使用全新数据根、独立项目及秘密，并在应用启动前轮换公共缓存 epoch。核对版本、查询、worker 检查点和媒体哈希后才启动恢复副本。保持生产和其他本机项目的备份路径独立。

美元场景用 `fx-cli.js --seed a`、`--seed b` 与 `--seed expired` 写入固定合成快照。运行 `--health` 采集时效状态，与 USD 区间查询、缓存命中和旧游标拒绝结果并列。将健康 JSON 送入 `ops-ext/fx-health.py` 可映射退出码：新鲜且最近尝试未失败为 0，保留或最近刷新失败为 1，缺失、过期或无法读取为 2。该探针不输出汇率，也不发送外部通知。生产式 API 和隔离容量容器均保持外呼关闭。

真实参考汇率的定时模板只供另行授权的原生预览实例。`ops-ext/hd-auto-fx-preview.service` 和 `.timer` 要求专用非特权用户 `hd-fx-preview`、冻结 Node 24／API 产物、loopback 的 `hd_ext_fx_preview_*` 数据库，以及归该服务用户所有的 0400／0600 数据库 URL 文件。安装后的 Node、API 产物、环境配置和启用标记由运维管理，对服务用户只读。示例环境默认 `EXTERNAL_FX_NETWORK=disabled`，服务也要求显式启用标记 `/etc/hd-auto/fx-preview.enabled`。启用后每小时唤醒 `fx-cli.js --refresh`，数据库的 24 小时持久限次确保预算未到时跳过外呼。用同一私有配置运行 `--health` 观察新鲜、保留或过期状态；容量测试不安装模板、不启用外连。预览库的参考快照不会自动写入生产。
