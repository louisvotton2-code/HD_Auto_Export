# 静态站部署模板（P1.7 起使用，保留供静态版本维护）

**此目录现有文件是静态部署模板，不是下一阶段 Node＋数据库运行时方案。** 当前官网已迁到 `apps/web`，仍生成 `apps/web/out/`，工作区结构迁移已执行，G0 的独立 API／后台基础和 FE-01 的官网运行时尚未完成。统一接手入口为[文档导航](../docs/README.md)，新部署工作从[运维职责与任务](../docs/协作/运维.md)开始；未来运行时材料按该任务放到 `deploy/runtime/`，不能套用“只上传 out”的操作。

维护仍采用静态产物的目标时，完整顺序、端口判断、上传、证书与回滚可参考[历史静态部署指南](../docs/归档/部署/静态服务器部署.md)。该方式仅上传构建后的 `out/`，无需常驻 Node 应用、PM2 或网站 systemd 服务；先核对实际产物和目标环境。

2026-10-24 曾在旧 VPS 部署 IP HTTP 试运行，当时 Nginx 使用 TCP 80、s-ui 保留 TCP 443，后续 HTTPS 与端口另有变化；具体历史见[旧 VPS 记录](../docs/归档/部署/VPS-IP部署记录.md)。用户现已更换服务器且未提供新环境资料，不连接旧主机，也不推定新机端口、证书或已有服务。已有站点不要重复首次安装或同时启用备用模板。

| 文件                             | 使用时机                                                                   |
| -------------------------------- | -------------------------------------------------------------------------- |
| `hd-auto-static.conf`            | 公共静态处理，安装到 `/etc/nginx/snippets/`                                |
| `nginx.conf`                     | TCP 80 空闲，初次 HTTP 站点／签发证书                                      |
| `nginx-https.conf`               | TCP 80/443 可用、证书已存在，标准 HTTPS                                    |
| `nginx-alt-http.conf`            | 80/443 被 VPN 占用，已确认 8088 空闲的试跑                                 |
| `nginx-alt-https.conf`           | 已确认 8443 空闲且证书已存在的高端口 HTTPS                                 |
| `install-nginx-without-start.sh` | 尚未安装 Nginx 时避免 apt 自动启动抢 80；已有安装或 policy-rc.d 会退出保护 |

四份站点模板**只启用其中一份**作为 `/etc/nginx/sites-available/hd-auto`，不要全部链接进 `sites-enabled`。HTTPS 模板引用证书前必须完成签发；`auto.example.com`、证书路径和所选端口要同步替换。模板默认仅监听 IPv4 TCP；确认 IPv6、AAAA 和端口后再另加 IPv6 `listen`。不启用 QUIC／HTTP/3，不监听 UDP 443。

早期 Node 反向代理和 `hd-auto.service` 模板已移除；此事实不代表未来运行时材料已经完成。不得为本站擅自改动目标上的无关服务（例如 s-ui／Sing-box／其他 Docker 容器／SSH）。

交付时更新[运维角色页](../docs/协作/运维.md)的进度摘要，并新增 `docs/日志/YYYY-MM-DD/运维-任务ID-主题.md`，记录真实目标、产物类型、验证、回滚与未完成项；PM 核验后维护总进度。真实凭据、服务器备份和私有运维账册不进入 Git。
