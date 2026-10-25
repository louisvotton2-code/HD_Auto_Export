# VPS IP 试运行部署记录

记录日期：2026-10-25，P1.8～P1.13为IP试运行历史；P1.14已增加正式域名HTTPS。本文是可随代码仓库交接的部署摘要，与通用[服务器部署指南](./服务器部署.md)配合使用。

完整旧运维账册只保存在本地 `docs/private/` 和管理员服务器私有记录中，不进入 Git，也不是克隆项目后的运行依赖。真实登录凭据由管理员另行安全管理，不写入源码、文档或静态成品。

当前正式入口为 [cars.hongdingauto.com](https://cars.hongdingauto.com/zh/buy/)，443已由网站使用，VPN按用户授权迁至独立端口；当前状态以[域名HTTPS记录](./域名与HTTPS部署记录.md)为准。下列HTTP复制限制只针对旧IP入口，不能据此判断正式HTTPS域名。

## IP试运行时的访问地址与状态

- [中文购车指南](http://38.47.118.138/zh/buy/)
- [英文购车指南](http://38.47.118.138/en/buy/)
- [俄文购车指南](http://38.47.118.138/ru/buy/)
- [中文俄罗斯计算器](http://38.47.118.138/zh/calculator/russia/)
- [英文计算器](http://38.47.118.138/en/calculator/russia/)
- [俄文计算器](http://38.47.118.138/ru/calculator/russia/)
- [网站入口](http://38.47.118.138/)

服务器已托管纯静态 `out/` 文件，计算在浏览器内完成，无需安装或运行 Node 应用服务。当前使用 IP 和 HTTP；未配置域名、受信 HTTPS 证书或搜索引擎收录。已实际复现HTTP下navigator.clipboard不存在，复制结果失败；用户随后明确选择以后部署HTTPS，不做兼容回退，因此保留标准Clipboard API，HTTP复制尚未解决。HTTPS后需复验权限与实际写入，不能把本机安全环境通过写成公网HTTP复制通过。

本轮构建参数为：

```text
NEXT_PUBLIC_SITE_URL=http://38.47.118.138
SITE_INDEXABLE=false
```

页面包含 `noindex, nofollow`，`robots.txt` 为 `Disallow: /`，sitemap 不列出页面。这是 IP 试运行状态；禁止索引不等于访问控制，网站仍可公开访问。

## 已核实的服务器与共存方式

| 项目                | 本次实测                                        |
| ------------------- | ----------------------------------------------- |
| 系统                | Ubuntu 22.04.5，x86_64                          |
| 既有 VPN 服务       | s-ui，继续使用 TCP 443                          |
| 新增网站服务        | Nginx `1.18.0-6ubuntu14.21`，只监听 IPv4 TCP 80 |
| UFW                 | inactive；未启用、重置或修改                    |
| iptables／ip6tables | 操作前后规范化后的规则一致                      |

网站使用原先空闲的 TCP 80；TCP 443 继续由既有服务使用。没有尝试让 Nginx 接管 443，没有修改 s-ui 的监听或配置，也没有增加 UDP／QUIC 监听。本次未执行系统升级、重启或开放防火墙端口的操作。

首次安装使用项目的禁止自动启动脚本，先阻止安装过程启动服务，再配置独立网站。APT 记录为 `0 upgraded / 20 newly installed`。此次新装 Nginx 自带的默认站点启用链接在备份后取消；默认配置文件保留，未替换已有 VPN 服务。

## 目录、配置与备份

当前发布目录：

```text
/srv/hd-auto/current
  -> /srv/hd-auto/releases/20261025T044905Z-navigation-motion-final
```

上一版本 `/srv/hd-auto/releases/20261025T043558Z-navigation-motion`（本轮初版）、`/srv/hd-auto/releases/20261025T035544Z-buying-guide`、`/srv/hd-auto/releases/20261024T100238Z-fee-details` 和更早的 `/srv/hd-auto/releases/20261024T080609Z-ip-trial` 均保留，可按下述原子链接方法回滚；不要删除在线版本或为更新重装 Nginx。

Nginx 只增加本站配置：

```text
/etc/nginx/sites-available/hd-auto
/etc/nginx/sites-enabled/hd-auto
/etc/nginx/snippets/hd-auto-static.conf
```

`sites-enabled/hd-auto` 是指向本站 `sites-available/hd-auto` 的启用链接。配置使用 IP 作为 `server_name`，静态根目录指向 `current`；未知网址和旧 API 地址返回真实 404，不使用首页兜底。

部署前已在管理员私有目录保存 s-ui 保护性备份、Nginx 初装后快照和成品校验清单。备份目录权限为 `700`，数据库副本权限为 `600`。SQLite 数据库使用 Python SQLite backup API 创建在线一致性副本，副本 `quick_check=ok`；没有直接复制正在写入的数据库文件作为一致性备份。

备份及详细位置由管理员私有记录管理，不上传网站目录、公开下载或提交到代码仓库。健康运行时不要恢复数据库或覆盖 s-ui 配置，也不要为清理网站删除备份。

## P1.8 首次部署的保护与发布验证

| 检查            | 已确认结果                                                           |
| --------------- | -------------------------------------------------------------------- |
| s-ui 进程       | 进程与启动时间部署前后未改变                                         |
| s-ui 文件完整性 | sui 二进制、两份 systemd unit、`s-ui.sh` 的 SHA-256 前后一致         |
| 防火墙          | UFW 状态和规范化 iptables／ip6tables 规则前后一致                    |
| 静态成品        | 199 文件，8,204,462 字节，全部远端 SHA-256 与本地清单一致            |
| 公网页面        | 中文俄罗斯计算页 HTTP 200                                            |
| 图片资源        | Logo HTTP 200                                                        |
| 错误路由        | 未知页面与旧 API 地址 HTTP 404                                       |
| 索引限制        | `robots.txt` 为 `Disallow: /`                                        |
| 原端口可达性    | 外部 TCP 443 可连接                                                  |
| 公网浏览器验收  | 29 项全部通过（2.9分钟），直接验证已部署IP，包括21国家语言深链与刷新 |

数据库内容另以只读事务作哈希比较：9张表与部署前备份一致；`clients` 没有增删行，仅 `up`／`down` 流量列变化；`stats` 追加统计行、已有行未变化。校验只记录表／列名与数量，不输出账号、节点或数据内容。运行中的统计会继续更新，不能要求数据库文件字节哈希永久不变。

公网浏览器验收还覆盖入口跳转、无 JavaScript 入口链接、Logo／水印、真实404、移除API、无运行时计算／汇率请求、跨构建日期与2027规则提示，以及汇率快照／手工调整。沿用P1.7已通过的626项单元测试、5项模块边界防护和93项本机Nginx完整验收；本轮没有把它们写成重新执行。

SSH 主机识别信息和逐文件清单保存在管理员私有记录中。未来出现主机指纹变化，应先核对服务器重装／密钥变更，不直接忽略警告。

进程、文件和 TCP 端口检查证明了上述可观测状态；没有用真实 VPN 客户端完成代理流量验证，因此不把“443 可连接”写成 VPN 全链路实测通过。后续应使用原有客户端核对连接及代理访问。

计算器仍是七国 2026 参考规则，官方核验完成项为 0，不代表完整落地价。汇率是构建时快照，服务器不会后台更新；更新快照需要重新构建发布。

## P1.9 费用详情折叠更新

本次仅更新静态成品：每项说明／公式默认收起、单项整行展开、全部展开／收起包含额外费用，本币和USD一直显示；切国家／恢复默认收起，重算保持已展开项目同步。税费规则和完整复制摘要不变；复制兼容按用户最新要求取消。

新成品为 199 文件、8,290,077 字节，逐个 SHA-256 验证一致后发布。为兼容已打开旧页面，新 release 额外补入缺少的旧哈希资源，因此服务器 release 总文件数可能大于新成品数。

独立基线保存旧发布位置、服务状态前后快照、Nginx 与 s-ui 关键文件校验、防火墙规则前后快照及上传／release 逐文件校验记录，完整清单留在管理员私有记录中。只替换 `/srv/hd-auto/current` 链接，切换后校验失败时会回退旧静态版本；旧版和原 P1.8 的 VPN 私有备份均保留。

- 本机类型、5项模块边界防护、626单元、静态构建、101项完整浏览器验收通过。
- 实际VPS上9项针对性浏览器验收全部通过（36.8秒）：三语默认收起、键盘单项、双币常显、含额外费的全局开关、重算同步、重置／无效状态、360px俄文布局、品牌资源和水印。
- s-ui和Nginx的进程／启动时间、保护文件和IPv4／IPv6防火墙规则与本次更新前一致。未安装软件、未修改配置、未重载或重启服务，原VPN仍保留443。
- 公网HTTP复制仍受上述限制，本轮不把需要安全上下文的复制用例放到HTTP验收；真实VPN客户端代理、域名与HTTPS仍待后续。

P1.9[桌面默认收起截图](./previews/calculator-fees-collapsed-desktop.png)、实际VPS[手机默认收起](./previews/calculator-fees-collapsed-mobile.png)与[全部展开](./previews/calculator-fees-expanded-mobile.png)已保存。手机为组件长截图，捕获时临时隐藏固定浮层避免拼接遮挡，未改变产品样式。

## P1.12 购车指南合入与发布

用户认可预览后明确授权复查、提交并部署。源码基线[816d2eb](https://github.com/louisvotton2-code/HD_Auto_Export/commit/816d2ebf265027ddf9aaff8a82f41152edc57247)已正常快进合入main，[main质量检查](https://github.com/louisvotton2-code/HD_Auto_Export/actions/runs/40160104792)全部通过，没有强推或覆盖其他提交。

新增三语购车指南、8步时间线、500 USD定金、CIF／FOB说明与FAQ；共享页眉和页脚增加入口，手机导航可见。计算规则、公式和费用数据结构未改。服务器仍使用HTTP IP和noindex，复制限制按原决定保留。

- 发布前以实际origin重新构建36路由；完整110项本机浏览器再次通过，24业务HTML的canonical和noindex正确。218个新成品文件共10,404,910字节，未含源码、环境文件、密钥、数据库或Node运行服务。
- 新一轮服务／配置／防火墙基线和Nginx配置副本保存在管理员私有记录中；新s-ui数据库副本通过SQLite backup API取得并quick_check=ok，目录700、数据库600。未修改或恢复现用数据库。
- 暂存与release中218个文件SHA-256均与本地清单一致；清单自身SHA-256为`306ac61bd609cfdbedd5d1cf414b88af2c3f4b85cedafc36d9bd11abf352f9f5`。旧hash静态资源只补到新目录，用于已打开页面兼容，因此实际release总文件数可大于218。
- 新release为`/srv/hd-auto/releases/20261025T035544Z-buying-guide`，旧P1.9目录保留。只原子替换current链接；服务端后验失败自动回退旧release，不改其他服务。
- 切换后Nginx返回的三语指南与计算器HTML和本次成品逐字节一致，三语指南／Logo公网200、未知路径404，robots继续禁止索引，旧公开API继续404；原外部TCP443可连接。
- Nginx／s-ui进程与启动时间、保护文件SHA-256、Nginx符号链接、UFW及IPv4／IPv6防火墙规则与本次基线一致，没有安装／升级软件、重启或重载服务。未进行真实VPN客户端代理全链路测试。
- 公网浏览器46场景覆盖完成：45项首轮通过，另1项修正测试等待后公网定向复验通过。无JS用例首轮有脚本时序误判：原条件count在导航未完成时可能为0而跳过后续链接；改为显式等待入口URL和真实链接可见后再点击，已在公网定向复验通过，没有放宽最终目标地址断言或改动网站。其余45项首轮均通过，覆盖21国家语言深链／刷新、三语指南／SEO、手机导航、原生FAQ、资源、404、日期／汇率和费用折叠。不能将此记录写为首轮完整46项无失败；最终记录亦见开发进度。

本次没有更改Nginx模板或重新安装服务。今后回滚本站内容时，使用本节记录的真实旧P1.9路径；不恢复s-ui数据库或整套Nginx配置来回退静态页面。

## 后续更新本站

更新前先读[开发进度](./开发进度.md)。每次只更新本站发布目录，不修改 s-ui、其他 systemd 服务、SSH 或防火墙。服务器已安装 Nginx，不要重复运行首次安装脚本。

在本地项目目录，使用当前项目要求的 Node／pnpm 版本，显式指定 IP 试运行参数构建：

```sh
pnpm check
NEXT_PUBLIC_SITE_URL=http://38.47.118.138 SITE_INDEXABLE=false pnpm build
pnpm test:e2e
```

下列命令中的 `USER`、`SERVER_IP`、`SSH_PORT` 都是占位符，必须替换为管理员提供的 SSH 用户、服务器地址和端口，不要原样执行。维护账号需具备所列 `sudo` 权限；已有账号和 SSH 配置保持原样。

只上传 `out/` 全部内容，不上传源码、`.env`、`.next`、`node_modules`、数据库或登录凭据。先确认目标仍为本站服务器，在本地准备远端维护账号专用的上传目录：

```sh
ssh -p SSH_PORT USER@SERVER_IP 'install -d -m 700 "$HOME/hd-auto-incoming"'
```

然后在本地执行：

```sh
rsync -av --delete -e 'ssh -p SSH_PORT' out/ USER@SERVER_IP:hd-auto-incoming/
```

远端相对路径 `hd-auto-incoming/` 位于该维护账号的主目录。`--delete` 仅作用于这个专用上传目录，不能改为服务器根目录、`/etc`、s-ui、其他站点或正在使用的 `current`。

本地为本次成品生成清单，并单独上传，不把清单放进公开的 `out/`：

```sh
python3 - <<'PY'
import hashlib
from pathlib import Path
root = Path('out')
with Path('hd-auto-out.sha256').open('w') as manifest:
    for item in sorted(root.rglob('*')):
        if item.is_file():
            digest = hashlib.sha256(item.read_bytes()).hexdigest()
            manifest.write(f'{digest}  ./{item.relative_to(root).as_posix()}\n')
PY
scp -P SSH_PORT hd-auto-out.sha256 USER@SERVER_IP:hd-auto-incoming.sha256
```

然后从本地登录服务器：

```sh
ssh -p SSH_PORT USER@SERVER_IP
```

接下来的发布和回滚命令在同一个服务器 shell 中依次执行，保留 `hd_previous` 和 `hd_release` 变量。先开启失败即停，再检查清单；必须所有条目均为 `OK`，有失败则停止发布，不继续切换：

```sh
set -eu
cd "$HOME/hd-auto-incoming"
sha256sum -c "$HOME/hd-auto-incoming.sha256"
test -f zh/calculator/russia/index.html
test -f 404.html
test -d _next/static
hd_previous="$(readlink -f /srv/hd-auto/current)"
test -d "$hd_previous"
printf 'Previous release: %s\n' "$hd_previous"
```

确认输出的旧版本属于 `/srv/hd-auto/releases/`，将它另存到管理员发布记录用于回滚，再创建本次新版本。历史清单不能拿来校验新版：

```sh
hd_release="$(date -u +%Y%m%dT%H%M%SZ)-ip-trial"
test ! -e "/srv/hd-auto/releases/$hd_release"
sudo install -d -m 755 "/srv/hd-auto/releases/$hd_release"
sudo rsync -a "$HOME/hd-auto-incoming/" "/srv/hd-auto/releases/$hd_release/"
```

为兼容更新前已打开页面的旧哈希资源，只向新版本补充缺少的旧静态资源，然后设置读取权限：

```sh
sudo rsync -a --ignore-existing /srv/hd-auto/current/_next/static/ "/srv/hd-auto/releases/$hd_release/_next/static/"
sudo chown -R root:root "/srv/hd-auto/releases/$hd_release"
sudo find "/srv/hd-auto/releases/$hd_release" -type d -exec chmod 755 {} +
sudo find "/srv/hd-auto/releases/$hd_release" -type f -exec chmod 644 {} +
```

确认 `/srv/hd-auto/current-next` 不存在，再原子切换本站链接：

```sh
test ! -e /srv/hd-auto/current-next
test ! -L /srv/hd-auto/current-next
sudo ln -s "/srv/hd-auto/releases/$hd_release" /srv/hd-auto/current-next
sudo mv -Tf /srv/hd-auto/current-next /srv/hd-auto/current
```

检查失败时不要继续；如有上次中断留下的临时链接，先用 `readlink` 确认它属于本站，才单独移除该链接，不能递归删除未知目录。仅更新内容无需重启或重载 Nginx。发布后验证中英俄深层页面、Logo、计算交互、404、robots 和原 VPN。

发现问题时在同一个 shell 中回滚；如果已退出 SSH，先从管理员发布记录恢复 `hd_previous` 为实际旧发布路径并核对，不能凭空填路径：

```sh
test -d "$hd_previous"
test -f "$hd_previous/zh/calculator/russia/index.html"
test ! -e /srv/hd-auto/current-next
test ! -L /srv/hd-auto/current-next
sudo ln -s "$hd_previous" /srv/hd-auto/current-next
sudo mv -Tf /srv/hd-auto/current-next /srv/hd-auto/current
readlink -f /srv/hd-auto/current
```

回滚后重新验证页面和原 VPN，保留故障版本用于排查，不恢复 VPN 数据库或整套 Nginx 配置来回滚静态内容。

以后有域名或改变网站端口时，先检查监听与配置，再用真实访问 origin 重新构建。不要直接把当前站点改到既有 VPN 正在占用的 TCP 443。

## 只停用本站

需要临时关闭网站时，只撤销本站启用链接；不停止 s-ui、不重置防火墙、不删除发布版本或备份，也不需要停止整个 Nginx 服务。

先确认本站启用链接的目标：

```sh
readlink /etc/nginx/sites-enabled/hd-auto
```

只有结果为 `/etc/nginx/sites-available/hd-auto` 时，执行：

```sh
sudo unlink /etc/nginx/sites-enabled/hd-auto
sudo nginx -t
```

语法通过再应用：

```sh
sudo systemctl reload nginx
```

若语法失败，不重载；先将刚撤销的链接恢复，再检查原因：

```sh
sudo ln -s /etc/nginx/sites-available/hd-auto /etc/nginx/sites-enabled/hd-auto
sudo nginx -t
```

重新启用本站同样先建立该链接，通过 `sudo nginx -t` 后再 `sudo systemctl reload nginx`，并复查 TCP 80 与 VPN 原端口。不要恢复 Nginx 初装快照来停用单个网站；该快照用于故障诊断和有针对性的回退，不应覆盖之后的其他管理员改动。

## P1.13 路由性能与动效发布（2026-10-25）

源码`0cfe935`完成主要优化，`eed6f8b`补齐联系导航下划线定位，两者均已正常快进main，无强推。最终按实际IP／noindex重建的213个新文件、5,269,154字节逐个SHA-256一致后，current原子切至`20261025T044905Z-navigation-motion-final`；保留本轮初版`20261025T043558Z-navigation-motion`、P1.12及旧hash资源。最终成品清单SHA-256：`1ad620389beb412cf82c4793fce0e9147ce3185104f2670724e84998f79eaf72`。

本轮新建私有基线、Nginx副本与s-ui SQLite一致性备份（quick_check=ok）。服务器唯一配置改动是本站`/etc/nginx/snippets/hd-auto-static.conf`的gzip；完整`nginx -t`通过后平滑reload一次，没有重启服务。原Nginx／s-ui主进程与启动时间保持；其余Nginx文件、s-ui保护文件、配置链接、UFW及IPv4／IPv6规则与新基线一致，原TCP443可连接。未进行真实VPN客户端代理端到端验证。

发布检查已确认三语HTML与新文件逐字节一致，未知路径／旧API404、robots保持禁止索引，JS／CSS／RSC实际gzip可正确解压且Vary包含Accept-Encoding；HTML／RSC继续no-cache，hash资源继续immutable。不会以压缩优化为理由缓存非版本RSC一年。

最终样式微调仅换静态文件，重新保存基线和SQLite一致性备份并全量核对保护文件，没有第二次配置修改或reload。最终源码[main远端质量检查](https://github.com/louisvotton2-code/HD_Auto_Export/actions/runs/40163244796)全部通过。

首次P1.13 release同流程公网购车→计算器1907→158ms，俄罗斯→乌兹别克斯坦613→53ms，冷英文切换940→657ms（样本，非普遍保证）；详细测量与维护位置见[路由性能与动效](./路由性能与动效.md)。公网首轮52项为51通过／1追踪报告收尾ENOENT，原因是并行进程共用默认输出目录，不是页面断言失败。改用独立输出后，最终发布版本16项针对性验收全过，覆盖三语购车、无JS、手机、全部新导航／动效场景及该俄文格鲁吉亚深链。不能将首轮记为整套52无失败；HTTP复制不在本轮公网场景内。

如只回退页面，可将current原子指回P1.12；gzip兼容旧静态文件，无需回退VPN或恢复数据库。确需回退本站gzip时，管理员只恢复本轮私有备份中的本站snippet，nginx -t后平滑reload，不覆盖整个/etc/nginx。
