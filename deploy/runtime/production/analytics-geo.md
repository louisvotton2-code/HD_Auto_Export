# 国家推断本地库

候选网关镜像自带空表，私有认证片段默认缺失。网关从直接连接的地址进行本地查询。受信认证头只用于官网同源的 `/api/v1/analytics/contact-count` POST。命中本地数据时同时传递两位国家代码，由 API 的地区允许名单决定是否计数。会话统计入口 `/api/v1/analytics/events` 继续接收已同意的事件，国家保持未知，日 IP 去重保持关闭。启用前核对 API 仅信任固定网关的连接来源，并用隔离样本验证转发头伪造、未知国家和数据留存。

## 准备与启用

1. 从已审来源准备 DB-IP Country Lite CSV gzip，记录数据库月份、原始文件 SHA-256 和转换输出。命令从仓库根目录运行，写出一份新候选文件。

   ```sh
   python3 deploy/runtime/production/build-analytics-geo.py \
     "$REVIEWED_COUNTRY_CSV" --expect-sha256 "$REVIEWED_COUNTRY_SHA256" \
     --output "$GEO_STAGING_ROOT/country.conf"
   ```

   按许可在使用推断结果的报表页面显示 DB-IP 署名链接。[DB-IP Lite 许可和署名条款](https://db-ip.com/db/lite.php)

2. 在同版隔离网关验证 IPv4、IPv6、私有及未命中地址，记录全量表加载时和重载期间的内存峰值。首次安装选择同版网关部署入口，在现有组合之后加载 `compose.analytics-geo.yaml`。`HD_ANALYTICS_GEO_ROOT` 指向由 root 管理的规范私有目录，权限 `0700`，目录需已有 `country.conf`。该目录在网关内只读。`HD_ANALYTICS_GATEWAY_SECRET_FILE` 指向 API 用户可读的 owner-only 原始密钥。使用同一来源准备网关片段，片段权限 `0600`，输出须为新路径。启用前可保留空表且不生成密钥片段。

   ```sh
   python3 deploy/runtime/production/prepare-analytics-gateway-key.py \
     --source "$HD_ANALYTICS_GATEWAY_SECRET_FILE" \
     --output "$REVIEWED_PRIVATE_GEO_STAGING/gateway-key.conf"
   ```

   密钥片段只放在私有地点，启用时用 `nginx -t` 检查配置。`nginx -T` 会输出已加载的密钥片段，适合仅在合成环境使用。匿名联系的地区允许名单由后端配置，未匹配国家由后端按未知处理。

3. 在同一个网关变更锁下保存目前的表及认证状态。先加载已核验的单路由网关配置，再安装 `country.conf` 与 `gateway-key.conf`。即使需要回到旧网关配置，也要先撤下密钥片段，避免旧版把同一把密钥转发到会话入口。通过运行网关的配置执行 `nginx -t`，通过后平滑重载。核对主进程身份及公开入口健康，再验证获准联系计数与已同意会话收集，确认会话国家和日 IP 统计未被打开。语法检查失败时恢复先前文件，保留当时运行的进程。

## 回退

使用同一把锁和验证步骤回切前一份表，或撤下 `gateway-key.conf` 并把 `analytics-geo-disabled.conf` 替换到挂载目录的 `country.conf` 后平滑重载。通过隔离统计样本核对新事件国家为未知、原有统计入口仍可接收，记录切换时间和表的 SHA-256。
