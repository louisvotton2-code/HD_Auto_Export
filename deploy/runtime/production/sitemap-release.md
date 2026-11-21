# v2 静态站点地图

在同版候选中使用 `sitemap-release.py`。Stable Gateway 通过已有的只读挂载读取 `${HD_GATEWAY_ROOT}/assets/sitemap`。首次引入 `nginx-domains/sitemap.conf` 时走候选网关的文件集合变更流程，先验 `nginx -t` 和两域路由。`gateway-reload.py` 拒绝对既有网关热加配置文件。

## 生成

非车辆输入是 FE 核对的 UTF-8 JSON 数组。每条仅含 canonical 路径 `path` 和可选的真实更新时间 `lastModified`。包含同版 FE 的首页、目录、购车指南、关于和各国家计算器的已准入语言路径。

```json
[
  {"path":"/ru/"},
  {"path":"/ru/cars/"}
]
```

从同版 BE 的私网入口读取 `GET /api/v1/seo/vehicles?limit=500`。已验收的候选 API 设置 `PUBLIC_SEO_ENABLED=true` 后才返回名单。依次将每页的请求游标和原始 JSON 响应记录为 `{"cursor":null,"response":{...}}` 条目，首条 `cursor` 为 `null`，后续使用上一页的 `data.nextCursor`，最后一页的出站游标须为 `null`。各页 `data.revision` 和 `data.validUntil` 必须一致，遇到 409、版本变化或请求失败时重新抓取完整一代。落盘前确认名单版本与详情、canonical、互链和缓存使用的版本一致。

源文件归运行账户所有，并限制其他账户写入。设置 `CANONICAL_ORIGIN`、`APPROVED_BASE_PATHS`、`BE_MANIFEST_PAGES`，以拥有 sitemap 目录的发布账户运行。初次验证使用隔离目录和候选网关。工具也可直接接受包含车辆的已批准完整路径表，用于离线回归。

```bash
sitemap_root="${HD_GATEWAY_ROOT}/assets/sitemap"
python3 deploy/runtime/production/sitemap-release.py --root "$sitemap_root" prepare \
  --origin "$CANONICAL_ORIGIN" --input "$APPROVED_BASE_PATHS" --vehicle-pages "$BE_MANIFEST_PAGES"
python3 deploy/runtime/production/sitemap-release.py --root "$sitemap_root" status
```

工具校验 BE 的完整游标链、修订版本和有效期，使用返回的逐语言资格。重复路径、重复车辆身份及超过 1,000 个第三方车辆身份均拒绝生成。每个分片最多 10,000 个 URL，且未压缩文件最多 50 MiB。输出包含 BE 修订号、`validUntil`、生成代号、分片 URL 数、字节数及 SHA-256，生成的 XML 可在 `prepared/<代号>/` 中预检。保存输入和输出以供放行时核对。准备时官网仍使用原地图。[Sitemap 协议](https://www.sitemaps.org/protocol.html)

## 切换与回退

用户验收、独立审查和 CI 通过后，流量先按受审的关闭索引配置切换。发布者核对候选站点的 robots、META、内容状态、canonical、三语互链、缓存失效与名单一致，再按 [v2 运维切换](v2-release.md) 的顺序启用 FE 的 `SITE_INDEXABLE` 和静态地图。使用 `status` 中的当前代号作并发保护，首次切换传 `none`。

```bash
python3 deploy/runtime/production/sitemap-release.py --root "$sitemap_root" activate \
  --generation "$NEW_GENERATION" --expected-current "$EXPECTED_GENERATION"
```

发布会重新验证整代的完整性，再原子替换 `/sitemap.xml`。切换后检查官网 `robots.txt`、XML index 和每个分片的状态、来源、内容类型和 URL 数，抽样核对详情的 200、撤回的 404／410 和临时故障的 503。准备中的分片和后台域名均应返回 404。启用期间保留已发布分片，供切换前取得旧 index 的爬虫继续读取。记录开放的时间和代号，按 v2 约定核对首批抓取结果和留存窗口。

`validUntil` 非空时，生成及切换都会拒绝已过期的名单。已经启用的静态地图仍由网关直接读取。用下面的一次性命令检查当前代，到期即移除静态索引并恢复由 Web 即时读取资格名单。有效期内安排重新取名单并切换或关闭静态地图，发生撤回或失去资格时同样重新取名单核对。上线安排须明确谁执行这些操作及如何核对，网关本身没有自动退场的定时器。

```bash
python3 deploy/runtime/production/sitemap-release.py --root "$sitemap_root" deactivate \
  --expected-current "$ACTIVE_GENERATION" --if-expired
```

地图回退时，以当前代号为 `--expected-current`，用 `activate --generation` 回到已验证的上一代。关闭静态地图用以下命令，随后核对 `/sitemap.xml` 恢复原 Web 路由，静态分片返回 404。完整关闭公开索引时，同时复核 FE 的 robots、META 和缓存已经恢复受审关闭策略。

```bash
python3 deploy/runtime/production/sitemap-release.py --root "$sitemap_root" deactivate \
  --expected-current "$ACTIVE_GENERATION"
```
