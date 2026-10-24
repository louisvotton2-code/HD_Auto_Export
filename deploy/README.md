# 静态站部署模板（P1.7）

完整顺序、端口共存判断、上传、证书与回滚见 [Ubuntu 22 服务器部署](../docs/服务器部署.md)。仅上传构建后的 `out/` 内容；本站不需要 Node、PM2、网站 systemd 服务或反向代理。

2026-10-24 已在用户 VPS 实际部署 IP HTTP 试运行，Nginx 使用空闲 TCP 80，s-ui 保留 TCP 443；具体配置与版本路径见 [实际部署记录](../docs/VPS-IP部署记录.md)。已有站点不要重复首次安装或同时启用备用模板。

| 文件                             | 使用时机                                                                   |
| -------------------------------- | -------------------------------------------------------------------------- |
| `hd-auto-static.conf`            | 公共静态处理，安装到 `/etc/nginx/snippets/`                                |
| `nginx.conf`                     | TCP 80 空闲，初次 HTTP 站点／签发证书                                      |
| `nginx-https.conf`               | TCP 80/443 可用、证书已存在，标准 HTTPS                                    |
| `nginx-alt-http.conf`            | 80/443 被 VPN 占用，已确认 8088 空闲的试跑                                 |
| `nginx-alt-https.conf`           | 已确认 8443 空闲且证书已存在的高端口 HTTPS                                 |
| `install-nginx-without-start.sh` | 尚未安装 Nginx 时避免 apt 自动启动抢 80；已有安装或 policy-rc.d 会退出保护 |

四份站点模板**只启用其中一份**作为 `/etc/nginx/sites-available/hd-auto`，不要全部链接进 `sites-enabled`。HTTPS 模板引用证书前必须完成签发；`auto.example.com`、证书路径和所选端口要同步替换。模板默认仅监听 IPv4 TCP；确认 IPv6、AAAA 和端口后再另加 IPv6 `listen`。不启用 QUIC／HTTP/3，不监听 UDP 443。

旧的 Node 反向代理和 `hd-auto.service` 模板已移除。其他现有服务（尤其 s-ui／Sing-box／Docker／SSH）不属于本项目部署操作范围。
