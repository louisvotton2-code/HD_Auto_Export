# 本机运行、备份与整机迁移

OPS-01 的运行入口。官网是 Next Node standalone，后台是 `/admin/` 静态产物，API 独立运行。根 `deploy/` 的 out 模板仅供历史静态版本维护。当前真实验证状态见[运维角色摘要](../../docs/协作/运维.md)与本轮日志，不把以下步骤当成已执行结果。

本轮本机真实资料恢复及最终组合技术核验通过，待用户验收。3317／3318／3320是唯一权威开发与录入入口；`https://localhost:3412` 是2026-11-08 18:48:38（上海时间）快照恢复的独立验收副本，含已逻辑删除的合成测试资料，不用于日常写入或向原库回写。私有账号和操作说明见忽略的 [本地联调访问](../../docs/private/本地联调访问.md) 与 [入口与恢复说明](../../docs/private/ops01/入口与恢复说明.md)，保持600。备份与源数据同盘，并非异地灾备；仅Linux/arm64实测，Linux/amd64尚未构建或验证，未部署公网。

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

## 新服务器迁移与回滚

1. 新服务器接入授权后才核验Linux/架构/磁盘/时间/防火墙/已有服务；不连接历史服务器。使用目标架构构建固定版本镜像，登记各镜像ID和源码清单。全量依赖当前随API镜像复制（包含构建工具）；生产缩减依赖作为后续优化，不能从Mac复制node_modules。
2. 分别迁移数据库逻辑备份、整个媒体、配置、秘密与TLS证书；校验hash，设置UID和700/600。跨机器/架构不用直接搬PG目录，PG主版本升级需单独演练。相对图片ID无需逐条改URL。
3. 空目标按顺序PG初始化→逻辑恢复→显式迁移→API→web→proxy；验证三语/登录/上传发布/下架或删除404/重新创建容器后留存。切DNS/公网端口/证书操作需明确部署授权。本机默认只绑定127.0.0.1，没有公网发布。
4. 切换前最后停写、做一致备份，再恢复和核对后切流。保留旧环境只读及旧镜像；不能让新旧库同时接受写入。回滚应用需确认schema兼容；破坏性迁移必须恢复成套DB+媒体并明确恢复点后写入损失，不能仅换旧镜像。
5. 每日备份、7日+4周保留、每月恢复演练是待实施目标；本机同盘副本不防磁盘损坏，不是异地灾备。选定异地位置后采用加密传输/独立删除权限，核验远端checksum和实际恢复。未采购OSS或备份服务，不宣称RPO/RTO已达标。

## 当前代理限制

API `TRUST_PROXY=false` 是初始快照的安全默认值，限流会聚合到代理地址。新BE已加入明确IP/CIDR配置；使用最终新API时每条正式Compose命令追加 `-f deploy/runtime/compose.proxy.yaml -f deploy/runtime/compose.media.yaml`，并在env配置已确认空闲的 `PROXY_SUBNET`、`PROXY_DYNAMIC_RANGE`、`PROXY_GATEWAY`、`PROXY_IP` 与 `WEB_IP`。例如/24子网的高半/25仅作动态池，网关.1、代理.2、官网.3留在低半（示例见.env.example）；两套环境用不同网段，防止先启动的数据库抢占代理IP。先执行 `runtime.py --env ... --project ... --compose-override deploy/runtime/compose.proxy.yaml --compose-override deploy/runtime/compose.media.yaml validate` 核对地址不重叠，再执行其他生命周期命令。overlay仅信任代理和官网各自固定地址/32，官网在overlay显式启用 `VEHICLE_API_TRUST_PROXY_IP=true`，Nginx向官网覆盖 `X-HD-Visitor-IP` 为直接连接地址，官网校验后向API构造单个X-Forwarded-For；官网和API均不向宿主映射端口，API仍无宿主公开端口，Nginx覆盖X-Forwarded-For/Host/Proto并清除Forwarded与内部IP头，对直接API请求清除X-HD-Visitor-IP。不要信任整网或客户端传入头。备份/恢复命令也按上例同时传入两个 `--compose-override`。更换已有Docker网络子网需要先停止该隔离组合并重建网络，不能在线改生产网络；初始已验镜像不启用此overlay。3412最终API与Nginx已完成多访客、伪造来源头及SSR/BFF身份核验；具体证据见[本轮日志](../../docs/日志/2026-11-08/运维-OPS-01-本机持久化与恢复.md)。此方案依赖该Docker网络内服务及宿主管理员可信；若同网络容器被攻陷，它可直连Web伪造访客头，该边界不提供隔离防护。

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

用户指定官网 `cars.hongdingauto.com`、后台 `admin.hongdingauto.com`；域名DNS由用户配置。双域属于独立overlay：在原基础、`compose.proxy.yaml`、`compose.media.yaml` 后再叠加 `compose.domains.yaml`，单域开发配置不变。无密钥env须分别设置 `WEB_SITE_ORIGIN=https://cars.hongdingauto.com` 和 `ADMIN_ORIGIN=https://admin.hongdingauto.com`；基础Compose仍需 `SITE_ORIGIN` 插值，设为官网origin。web构建参数 `SITE_ORIGIN` 在Dockerfile中映射到 `NEXT_PUBLIC_SITE_URL`，同时设置运行时该值；后台API `AUTH_BASE_URL` 和 `TRUSTED_ORIGINS` 是后台origin，员工Cookie为admin域host-only，后台同源代理认证/管理/公开目录，不新增CORS。官网代理仅允许公开GET/HEAD，其余API和后台入口拒绝；两域均要求SNI与Host匹配，未知SNI拒绝。官网业务使用内部API，真实客户端地址只信固定proxy/web各自/32，不信外部转发头。

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

内部网只供数据库、API、官网、缓存和代理使用，只有代理加入入口网并发布 loopback 端口。代理覆盖外来转发头；API 继续只信任两个固定地址。隔离 Nginx 对 `/api/auth` 路径族（含会话查询）按直连地址限 6 次/分钟，允许 4 次突发；目录 API 路径限 30 次/秒，允许 40 次突发。目录桶不覆盖官网 SSR 入口。限制按匹配路径处理请求，不依赖请求自报地址；原 API 保护仍生效。翻译配置显式关闭。Redis 无宿主端口，禁用默认用户，`hd-cache` 仅可操作 `hd-ext:*` 的基础缓存命令；上限 128 MiB，按 LRU 淘汰，无持久化，授权键在容器内使用。BE 冻结缓存客户端与独立 worker 入口后，再按实际命令和密钥读取方式接线。

运行预算为 PostgreSQL 1.5 CPU／1152 MiB、API 1.5 CPU／640 MiB、官网 1 CPU／768 MiB、代理与缓存各 0.5 CPU／192 MiB，合计 5 CPU／2944 MiB。迁移单独执行；为后续 worker 预留 0.5 CPU／512 MiB，未计入当前运行上限。先采集宿主余量、容器 CPU/内存和 OOM/重启次数；每档负载另记 HTTP 状态、连接错误与成功请求 P95，记录数据规模、镜像与缓存冷热。没有持续告警任务。

联合备份使用 `runtime.py backup`，同次传入 proxy、media、ops-ext 三个 override；暂停该项目所有写入者，今后包括独立 worker。恢复时用新的项目名、`DATA_ROOT`、空闲入口及网段（如 3441 和 172.30.87.0/24），重新生成 DB、认证和缓存秘密。仅从已核验的数据库与媒体包恢复；检查迁移记录、合成记录及媒体实际摘要，再启动恢复验证所需服务。缓存重建由应用负责。备份恢复只覆盖合成环境，另行核验真实数据和恢复目标。

压测脚本 `ops-ext/bench.py` 只发 loopback HTTPS 的目录、筛选、首页数据及详情 GET，验证本机证书，并按路由记录 2xx 的 P95、全量错误占比与原始状态（包括 429）。等 BE 提供 10 万／50 万合成装载入口和查询分布后，分别跑 20／50／100 并发，每档按冷／热缓存记录。启用现有限流的单来源测试会限速，429 必须单列；真实性能测试需由 BE 提供只在隔离环境启用的策略，或使用独立可信合成来源，不能把限流当查询容量。PM 初始门槛为 20 并发常用列表及筛选 P95 ≤800 ms 且错误率 <1%。
