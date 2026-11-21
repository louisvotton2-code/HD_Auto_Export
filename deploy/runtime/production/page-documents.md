# 网关页面文档小时汇总

默认关闭。地区授权和本地验收完成后，可在受审发布的 `gateway_files()` 中显式设 `page_documents=True`。该开关控制官网 TLS 入口的单独日志及网关回环健康检查的覆盖标记。回退时恢复 `0` 并校验、平滑重载网关。咨询计数、会话统计和索引各自有独立开关。

仅计入已完成的 `200 GET` HTML 文档，冷热请求各计一次。明确列出公开路由及三种语言，排除后台、内部 API、静态、RSC、预取、已知机器人和失败响应。日志只记录成功请求的时间、语言、页面类型及实际缓存命中分类。浏览器预取、客户端内导航和浏览器本地缓存可能无需请求完整文档。这个数字用于核对网关返回的文档量。

## 生产定时导入

`hd-auto-page-documents.timer` 在北京时间每小时第 2 分钟调用 `hd-auto-page-documents.service`。服务从已指定的网关容器读取上一闭合小时及前后各 60 秒，验证定时探活的匿名覆盖标记，再调用同版 API 镜像的导入程序。完整小时须有边界前后的覆盖标记，期间相邻间隔不超过 45 秒。覆盖条件不足且仍有已记录文档或小时内标记时记为 `partial`。读取成功且小时内没有覆盖标记或文档时保留缺失。

私有配置位置为 `/srv/hd-auto/secrets/v2/page-documents.json`，文件权限 `0600`。默认配置为 `{"enabled":false}`，禁用时不查询网关或数据库。配置缺失时 systemd 跳过服务。启用前核对网关及 API 槽、实际数据库身份、同版构建和数据盘的状态目录。状态目录由 root 管理，路径规范且权限 `0700`。

```json
{
  "enabled": true,
  "gatewayContainer": "hd-auto-proxy-1",
  "stateDirectory": "/srv/hd-auto/data/observability/page-documents",
  "importCommand": [
    "/usr/bin/python3",
    "/srv/hd-auto/staging/v2/current-source/deploy/runtime/production/import-page-documents-in-api.py",
    "--container", "hd-auto-api-blue-1",
    "--database", "hd_auto",
    "--release", "<40 位发布提交 SHA>"
  ]
}
```

以上容器和数据库名仅作配置示例，部署时使用核对后的实际身份。集成候选通过后再安装定时单元。首次运行从最近一个已闭合且允许读取后置心跳的小时开始，每次最多补三个小时。网关读取或导入失败时保留小时游标，五分钟后重试。导入前先落盘并同步私有快照，失败重试同一文件，直到收到同小时的 `imported` 或 `duplicate`。已确认快照及超过保留期的待发文件会清除。`HOUR_CONFLICT` 需要核对首次导入证据，保留冲突现场和当前游标。

切槽和回退前暂停定时器，并确认已运行的导入服务结束。切流量后更新配置中的容器、发布提交和数据库身份，确认新槽为 `active` 后恢复定时器。导入器逐次核对这些条件，关闭或排空的槽位拒绝写入。

## 汇总与导入

生产从网关已有的有界容器日志读取所需小时。使用 `docker logs --since <ISO> --until <ISO>` 提取覆盖完整范围的普通 stdout，保留日志原行。隔离环境可把同一格式写到独立私有文件。

```sh
umask 077
python3 deploy/runtime/production/aggregate-page-documents.py \
  --hour '2026-11-21T20:00:00+08:00' --status complete --input "$PAGE_DOCUMENT_LOG" \
  > "$NEW_PRIVATE_SNAPSHOT"
```

读入文件或标准输入。输出为后端 `AnalyticsDocumentSnapshot`，冷热合并成同语言和页面类型的计数。小时使用北京时间，边界为 `[整点, 下一整点)`。重复读取同一来源生成相同快照。统一去除来源重叠后再生成单一小时快照。

导入命令在 `apps/api` 执行。通过已有私有环境提供 `DATABASE_URL_FILE` 或 `DATABASE_URL`，并设置 `ANALYTICS_IMPORT_DATABASE` 为已核对的目标库名。快照使用新的私有普通文件，权限设为 `0600`。

```sh
ANALYTICS_IMPORT_DATABASE="$EXPECTED_DATABASE_NAME" \
  node --import tsx src/analytics/traffic-import-cli.ts "$NEW_PRIVATE_SNAPSHOT"
```

同版构建后的入口为 `node dist/analytics/traffic-import-cli.js "$NEW_PRIVATE_SNAPSHOT"`。导入程序仅接受已结束、仍在 90 天保留范围内的小时。首次写入返回 `imported`，同一内容重跑返回 `duplicate`，同一小时不同内容返回 `HOUR_CONFLICT` 并保留原数据。

覆盖完整、分段均已拿到且小时已结束，才能选 `complete`。启停、日志轮转、重启或导出缺口导致覆盖不足时用 `partial`。空结果只有在确认完整小时一直开启、日志实际覆盖该小时的情形下表示完整零次。未启用或无可证的覆盖时保持缺失。按后端保留策略保存 90 天的小时汇总，轮转日志保留现有上限。

## 本地复用

在隔离 Nginx 的 `http` 段包含 `nginx-domains/page-documents.conf`。只在官网服务器块内增加以下两行，并让原请求诊断继续使用现有的受限日志格式。

```nginx
set $hd_page_documents_enabled 1;
access_log /private/path/page-documents.ndjson hd_page_document if=$hd_page_document_selected;
```

当前小时可以用 `partial` 预览汇总。导入验收使用已结束的隔离样本小时。验收覆盖普通文档、未知路由、静态、后台、预取与 RSC、失败响应和已知机器人。用测试标记核对输出字段不会携带完整 URL、查询、来源、IP 或 UA。
