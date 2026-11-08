# 独立审查 / OPS-01 / 本机持久化与恢复

日期：2026-11-08（Asia/Shanghai）
状态：最终增量代码复查通过；新代理 overlay 仅配置验证，最终运行待源码冻结；真实验收库恢复待协调停写窗口
审查者：独立 Reviewer Agent `/root/ops_recon`；没有参与被审运行材料的实现。

## 范围与版本

- 基线：`61dc7414b20a395d1d09e906a49d974763b3cce7`，分支 `codex/backend-foundation`；审查对象为本轮尚未提交的 `deploy/runtime/` 文件，不代表整个共享工作树通过审查。
- 范围：下表全部 16 个文件，包括 `.env.example`、新增的代理 overlay、Dockerfile 与上下文排除、Compose、Nginx、API／PostgreSQL 启动入口、初始化 SQL、数据根初始化、备份／恢复、现有本机验收库采集适配器、源快照工具、失败路径测试、运行手册及隔离冒烟脚本的静态阅读。上游 BE 的 CIDR 配置仅为接口对照阅读，不代替其独立后端审查。
- 最后增量复查的 16 个文件，按文件路径排序后将 `路径 + NUL + 文件SHA256 + 换行` 拼接计算的集合摘要为 `248ce607df25a703a671218f02f60f561a04a047809bbe60b8b0853b77259842`。它替代前轮 15 文件集合摘要 `d0c066d9fc30f43cd2b7f39b7b3aeda65b9cd3e832df09147391f62252a550d2`。后续文件修改需要按影响复查；此报告不绑定未来提交或镜像。

完整受审文件清单与 SHA256：

| 文件 | SHA256 |
| --- | --- |
| `deploy/runtime/.env.example` | `0516abffc3761165f4afe98e9f699c5a2db92bb6918f7c85cd0ed8e6542fda6c` |
| `deploy/runtime/Dockerfile` | `33d05f203f96e3ef6ec47393e099b297f9271b761b02cc78a9a44bfb468c59af` |
| `deploy/runtime/Dockerfile.dockerignore` | `12924cee437a74d52e3ef7080fb76ae4ba7794790b1e8b30772cbb2b5de9ff66` |
| `deploy/runtime/compose.yaml` | `7427483e10f3ecfef9e983b5d0f834cae43e0266923136b910665f0cac16c7a5` |
| `deploy/runtime/compose.proxy.yaml` | `523318e7dbfdf87f2696ac2f79579bfed2310b199df4194334d0f4be452042a7` |
| `deploy/runtime/api-entrypoint.mjs` | `74991a8081ac039616c624f00e8bb850551bd922cdc6f493e6b8755fd6fa2de1` |
| `deploy/runtime/db-entrypoint.sh` | `b59d0dc3a4fbca1d2e94b3d1457182723a02bd4e577c1a63412849c93df78e49` |
| `deploy/runtime/init-db.sql` | `f6890a1567dc1e423861cf7ddd441ca4acb4e62a481ffd7174cb517a3586ee17` |
| `deploy/runtime/runtime.py` | `606c80f8be468624a8580dba3fd1ad09fff79336570d7f084429a855cb9af7d7` |
| `deploy/runtime/capture-existing.py` | `79f5fb2231d92545ca1cd728ac29d287b143deb168ee3fc84ae299ff8488136e` |
| `deploy/runtime/nginx.conf` | `940aad3ca6a2e3830e01b42b2cc898f4593c210a14738377653bf7cf0aa3bb22` |
| `deploy/runtime/prepare-source.py` | `2476b8db6e1af81d82a4476e696a8e9cb7071d6f9f8db919ab362cf8b0550f6d` |
| `deploy/runtime/smoke.mjs` | `39f0dac66af01397df4cfe9f384e055314e267e3e6e42cd6f635b5ab3cd3db58` |
| `deploy/runtime/test_runtime.py` | `39dd9cd385b14535dae28c894f4eb0707b7a35cc1dcfccdc9a2f828a919f8ffe` |
| `deploy/runtime/test_capture.py` | `ecdfc24999e423122579be597fb66b0f0a0454534f49ef528168a5771c67e399` |
| `deploy/runtime/README.md` | `cb199e78e2c92e4f445406fc0c6830b1632a4035d455452c43a5e79ad59aa4a9` |

## 发现与复查

1. **P1，已修复：备份目录创建失败导致 API 留在停止状态。** 初版在停止 API 后、`try/finally` 之前创建 `.partial`。当前在停机前准备目录，并将停止操作纳入恢复启动保护。重复 partial 和转储失败两个测试分别证明不停止原 API、恢复原先运行的 API；这些测试使用模拟 Docker，不声称真实进程已验证。
2. **P2，已修复：初始化者与 APP_UID/GID 不一致。** 当前在任何数据写入和 Docker 操作之前检查执行用户与配置身份；手册要求本机 `id -u`／`id -g`。API 启动入口兼容 Docker Desktop 的 bind 所有权映射，以 root 读取秘密／修正媒体所有权，然后清空附加组、降 gid/uid，再启动应用。
3. **P2，已修复：缺失后台静态资源回退为 HTML200。** 当前 `/admin/assets/` 独立 `try_files $uri =404`；只有后台页面路由回退至 SPA 首页。真实 HTTP 验证由 OPS 执行。
4. **P1，代码已修复，OPS 已报告权限实测：root 启动入口缺少读取私有文件的能力。** 初次降权改法仅添加 CHOWN／SETUID／SETGID，Linux 下 root 无法读取 APP_UID 所有的 0600 秘密和 0700 媒体。当前增加启动所需 DAC_OVERRIDE；入口在启动应用前执行 `setgroups([])`、`setgid`、`setuid`，并保留 `no-new-privileges`。OPS 报告新镜像中的应用进程 UID501／GID20／CapEff=0，PID1 docker-init 仍为 root；这属于实现者实测陈述，Reviewer 未独立进入容器复测。最终全容器重建后应继续核对媒体与进程权限。
5. **P2，已修复：备份工具可生成自身恢复器拒绝的硬链接归档。** 现有库采集增量版最初未检查 `st_nlink`，两个 UUID 文件指向同一 inode 时，`tarfile.add` 将第二项写成硬链接，恢复器却只接受普通文件。Reviewer 以临时合成文件独立复现归档成员 `isfile=[True,False]`。当前 `capture-existing.py` 与 `runtime.py` 备份均要求 `st_nlink==1`，各自新增硬链接拒绝测试通过，失败不会生成正式成功备份目录。
6. **P1，配置已修复、overlay 运行待冻结：固定代理 IP 与动态分配地址冲突。** 最初 overlay 只有 subnet，先启动的数据库可能取得示例代理地址 `.2`，随后代理无法分配固定 IP。当前新增显式动态池和网关；`.env.example` 使用 `/24` 中高半 `/25` 作为动态池，代理 `.2` 和网关 `.1` 留在低半。`validate_proxy` 在任何 overlay 生命周期操作前校验子网包含、可用地址、互异及动态池排除关系；新增冲突／越界／网关重合测试通过。网络是否空闲以及 Docker 实际分配仍须最终环境验证。

当前范围没有其他未关闭的 P1/P2 代码发现；不据此声称已完成生产部署、恢复验收或不存在缺陷。

## 最终增量复查

- `web.environment` 同步传入 `SITE_INDEXABLE` 与 `NEXT_PUBLIC_SITE_URL`，与构建参数使用同一配置来源；不能据此省略变更公开 origin 时所需的官网重建。
- API 启动入口、备份枚举、恢复归档校验均接受 `UUID.webp` 和 `UUID.thumb.webp`，与当前 BE 的缩略图落盘文件名一致。备份仍拒绝符号链接，恢复仍拒绝非普通文件、重复项和越界文件名。
- Compose 服务清单解析从 `splitlines()` 改为 `split()`，空项目返回单独换行不再误判为运行中的服务。Reviewer 重跑覆盖该行为的测试通过。
- README 已补充孤儿 `.tmp` 的停写检查、私有隔离及失败恢复目标保留／改用新 DATA_ROOT 的处理，不自动删除不明文件。
- `capture-existing.py` 不启停源服务；只接受本机源配置，采集前后必须得到明确 `ECONNREFUSED`。监听成功、EPERM、超时及其他不确定错误均拒绝继续，不能把执行环境网络限制当作停写证据。它无法发现中途短暂启动或直接 SQL 写入，README 明确仍须 PM／BE 协调全部写入者的完整停写窗口。
- 采集脚本不把连接密码加入命令参数或打印，输出以数量和状态为主；本地 PostgreSQL 容器身份仍须由 OPS 对照源环境核实。源媒体要求绝对私有目录、普通私有文件、无符号链接及单一硬链接；目录 0700、文件 0600 来自进程 umask。其 `format:1` manifest、dump／tar 摘要和逐图摘要与现有恢复器匹配，失败保留 `.partial`，成功才更名。
- `compose.proxy.yaml` 只把固定代理地址 `/32` 设为 API 的可信来源；没有改初始基础配置的 `TRUST_PROXY=false`。Nginx 覆盖 X-Forwarded-For／Host／Proto，清除 Forwarded 和发往 API 的内部 IP 头；API 不开放宿主端口。上游新 BE 已能解析明确 IP/CIDR，旧镜像不得提前启用此 overlay。
- `runtime.py --compose-override` 将 overlay 作为基础文件后的第二个 `-f`，贯穿备份／恢复的所有 Docker 操作；新增 `validate` 先执行地址校验与 Compose 配置校验。手册要求手工生命周期命令之前也先 validate，并在每条命令带同一 overlay。新网段必须经空闲核验，现有网络不能在线替换。

## 数据与失败行为核验

- 当前实际工作树的源快照排除检查没有发现真实秘密／媒体进入快照；会纳入两份生成的 OpenAPI JSON。Docker 上下文排除 `.env*`、`.data`、依赖、构建产物、私钥与归档；实际生成镜像仍应由 OPS 检查，后续不能把任意命名的私有数据放进允许复制的应用目录。
- 数据库和媒体使用独立 bind 数据目录，数据库未开放宿主端口；代理没有媒体卷、alias 或目录暴露。公开媒体继续由 API 检查当前发布引用，不能绕过下架／删除语义。
- 备份停止 API 后转储 DB，再保存整个媒体目录和校验和，成功才更名。手册明确外部 SQL／CLI／清理／迁移／导入写入须另外暂停；仅停止 API 不足以保证这些写入者存在时的一致性。
- 恢复拒绝已有数据库／媒体和运行中的目标服务；先验证摘要、普通文件类型、重复名及安全文件名，再单事务恢复数据库，之后复制图片。未自动启动 API 或对外切换；失败保留目标以诊断，使用新空目标重新演练。
- 镜像内 PostgreSQL 初始化 SQL 避免执行宿主 bind 脚本；wrapper 在官方入口降权前读取应用数据库秘密，再交官方入口初始化。没有把秘密字面值写入构建参数或 SQL 文件。
- 日志轮转、固定版本、本机 HTTPS／回环绑定、显式迁移、目标架构重新构建、同盘副本不是异地灾备，均在手册说明。

## 实际执行的检查

- `pnpm hooks:check`：通过。
- Python AST 语法、`node --check deploy/runtime/api-entrypoint.mjs`、Shell 入口 `sh -n`：通过。
- `PYTHONDONTWRITEBYTECODE=1 python3 -m unittest discover -s deploy/runtime -p 'test_*.py' -v`：最后增量版 11 项由 Reviewer 重跑通过（前轮分别实跑 6／8／10 项）。覆盖 partial 冲突、转储失败后恢复、UID 不匹配、损坏 dump 提前拒绝、空 Compose 清单换行、缩略图恢复及恶意 tar 链接拒绝、ECONNREFUSED／监听／EPERM／超时停机判定、两种采集入口的硬链接拒绝、代理地址与动态池配置。测试用临时目录和模拟 Docker；其中打印的恢复成功文案不是实际 PostgreSQL 恢复证据。
- 另以临时配置和模拟 Docker 检查备份的 ps／stop／pg_dump／恢复 start 4 个调用均保留第二个 `-f` overlay：通过。最初检查夹具遗漏新增代理变量而提前拒绝；补齐示例四变量后通过。摘要辅助检查曾因局部变量命名错误退出，修正后重新读取完整 16 文件计算上表摘要；不是应用或运行测试失败。
- `git diff --check -- deploy/runtime`：未报告空白问题；该目录尚未跟踪，此命令不替代文件内容审查。
- 没有执行 Docker 构建、启动、重启、数据写入、真实备份／恢复；没有操作保留的 3317／3318／3320 服务。早期本地 HTTP 只读尝试受到执行环境权限限制，没有以此记录 HTTP 通过。

## 交接与验收条件

OPS 在增量复查请求中报告：源项目／恢复项目 HTTPS 各 15 项通过，新镜像应用进程 UID501／GID20／CapEff=0，新备份 dump＋媒体完整恢复成功；后续又报告两套共 8 个容器（含 PostgreSQL）全部 force-recreate 后 30 项 HTTPS 再次通过。Reviewer 没有独立执行这些运行检查，它们须由 OPS 的实际日志、源码清单／镜像 ID 和检查产物支持，由 PM 核对；此处不将实现者报告改写为独立运行验收。

新增代理 overlay 独立于上述初始快照演练。OPS 报告 Nginx 配置检查通过；地址池修正后还须核对最终合并配置。当前结论仅为配置／静态代码验证，不能写成已完成新 API、可信代理、多个客户端及伪造转发头的端到端运行验收。这些运行检查待各端冻结后在新的隔离组合实施。

最终交接仍须核对全容器重建后记录和媒体 hash 保留、应用进程权限、健康／HTTPS，以及实际演练版本是否与受审文件一致。新增真实验收库恢复尚待各端最终源码冻结、项目助理资料导入与 PM 确认的停写窗口；本次只审查采集工具，没有采集或恢复真实库。合成演练不能代替该项最终真实资料验收，源 3320 仍是当前唯一权威写入口。Linux/amd64 未实测时继续明确未验证。

API 入口对孤儿 `.tmp`／非预期媒体条目采用拒绝启动，手册已有停写后检查并移到私有隔离目录的排障步骤。初始 `TRUST_PROXY=false` 的限流聚合不能借新增 overlay 的配置检查视为已解决；最终可信代理运行验收仍为公网多人验收前置条件。迁移与运行数据库身份仍共用 schema owner，手册已标明未完成进一步分离。

仅此审查报告由 Reviewer 写入；没有提交、推送、外部部署或用户验收。PM 汇总本报告时须同时核对 OPS 的运行证据，不将代码审查结论改写为完整上线验收。
