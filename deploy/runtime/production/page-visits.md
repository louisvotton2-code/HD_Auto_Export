# 网关匿名访问内存投递

网关为每个已完成的官网 `200 GET` HTML 文档送出一条访问消息。它复用页面文档分类，冷热均可入选，排除 RSC、预取、静态、后台、失败响应和已知机器人。访问开关独立于页面文档汇总，默认关闭。按地区授权和受审发布候选启用，回退时关闭后平滑重载。

## 私有套接字

Nginx 使用内置 Unix datagram 投递，不使用 njs。`$realip_remote_addr` 取原始连接地址。仅在批准的同主机环境部署接收端，使用专用 `/run/hd-visits/events.sock`，所有者属于接收端。套接字及其目录的权限只允许实际 Nginx worker 访问。生产可通过 `compose.analytics-visits.yaml` 用 `HD_ANALYTICS_VISIT_SOCKET_ROOT` 把该目录只读挂到网关，目录和套接字由主机接收端创建。该挂载只提供给网关。投递不会在系统日志、容器 stdout 或文件中落地访问消息。[Nginx Unix socket 投递](https://nginx.org/en/docs/syslog.html)

在网关生成器设置 `page_visits=True` 后，官网 TLS 服务器可以投递访问消息。`127.0.0.1` 的 `/health/proxy` 成功 GET 同时以私有消息报告覆盖心跳。常规健康检查和去标识页面日志保持原有用途。生产需保留已有受限错误日志，并一起部署 `page-documents.conf` 与 `page-visits.conf`。

使用本地专用 socket，线格式是定长上界的 ASCII 消息。内置封装包含固定 `<190>`、RFC 3164 时间、`hd_visit` tag，无主机名和终止换行。以下地址为合成示例。

```text
<190>Nov 21 19:25:10 hd_visit: v1 visit 1795260310.123 2001:db8::7
<190>Nov 21 19:25:10 hd_visit: v1 coverage 1795260310.123
```

消息只包含原始对端和 Unix 秒毫秒时间，心跳只带时间。网关无访问重试或持久队列。接收端停机或繁忙时，内核可能丢弃消息，页面响应继续。覆盖心跳说明投递通道是否活跃，个别消息仍可能丢失。BE 负责全部匿名访问滚动去重、到期清理和聚合口径。

## 中继与封账

`hd-auto-website-visit-relay.service` 运行同主机的 `website-visit-relay.py`。默认缺配置时跳过，显式 `{"enabled":false}` 也不启动套接字。配置路径为 `/etc/hd-website-visits/relay.json`，配置及密钥文件归中继用户，权限 `0600`。使用已核对的工作 UID/GID，并让网关工作进程仅能写专用套接字。先安装 `hd-website-visits.tmpfiles.conf` 预建网关挂载目录，按相同工作 UID/GID 配置接收端。以下为配置形状，API 地址须指向当前已核对的私网可写槽。

```json
{
  "enabled": true,
  "socket": "/run/hd-visits/events.sock",
  "apiAddress": "172.30.83.6",
  "keyFile": "/etc/hd-website-visits/gateway.key",
  "documentAuditDirectory": "/srv/hd-auto/data/observability/website-visit-audit"
}
```

中继只向 BE 的 `/internal/analytics/ip-visits` 发送数据。后端校验 TCP 对端和专用投递密钥，公开网关继续封锁 `/internal/`。主机和目标 API 槽切换时核对这两项。BE 的短期 HMAC 密钥由 BE 独立管理。换 HMAC 密钥前停写一个完整滚动窗口，防止同一地址重复计入。中继禁用 core dump，地址只存在于有界内存及同主机私密传输。队列和排序窗口均有上限，单次投递间隔至少 60 ms，观察时间排序留 250 ms 水位。

每次交付新建同主机私网连接，建连失败时最多再尝试一次。请求开始发送后，写入结果可能无法确定，访问消息只发送一次。队列满、超出水位、HTTP 拒绝和投递异常均保留计数，相关小时仍显示覆盖不足。日志只包含总数和固定故障类别。小时覆盖提交是幂等更新，提交失败可按原间隔再提交，后端已记为部分的小时维持原状态。

在生产 Compose 最后加载 `compose.analytics-visits.yaml` 才会在 API 槽接入中继。将 `HD_ANALYTICS_VISIT_PEERS` 设为 API 看到的实际中继连接来源，使用固定主机地址的 CIDR。通过两个独立 owner-only 文件配置 `HD_ANALYTICS_VISIT_GATEWAY_SECRET_FILE` 和 `HD_ANALYTICS_VISIT_HASH_SECRET_FILE`。中继只读取投递密钥。启用前用真实运行用户检查套接字权限和中继到当前槽的网络；切槽后用合成访问检查新槽接受，旧槽已停止接收。systemd 与 tmpfiles 的模板 UID 和 GID 须与实机网关用户核对后一起替换。

完整小时需要心跳跨越边界、无已知失败，以及成功投递的文档总数与同口径的无地址页面汇总一致。将页面文档定时器的 `visitAuditDirectory` 指向同一目录，提供无需访问地址的小时核对凭据。建议由页面汇总服务管理目录所有权，设组为中继组、权限 `2750`，汇总凭据的权限为 `0640`。核对只用文档总数，旧日志无法补算历史访问量。小时结束后至少等 125 秒才封账，核对凭据最多等待十分钟。没有可信覆盖时只报部分或保留缺失。完整覆盖且计数确为零才可报零。中继重启会清除内存等待项，缺失的时段仍由报表标识。

## 本地接入

在隔离的 `http` 段先包含 `nginx-domains/page-documents.conf`，再包含 `nginx-domains/page-visits.conf`。官网服务器块设置 `$hd_page_visits_enabled` 为 `1`，复用正式 `hd_page_visit` 条件投递语句。可信本地探活块复用 `hd_page_visit_coverage` 语句。用本机短路径替换正式 socket 路径，由同一内核中的专用接收端绑定。复核未开启、选择器、伪造转发头、接收端关闭以及拥塞情形。
