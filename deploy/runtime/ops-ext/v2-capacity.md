# v2 目录容量测试

使用 [OPS-EXT-02 合成环境](../README.md#ops-ext-02-容量环境) 从冻结提交构建版本镜像、迁移空库、生成 50 万条车源并执行 `ANALYZE`。为项目 `hd-ops-ext02-v2capacity` 准备私有数据目录、回环端口 3642 和空闲内部子网。设置 `OPS_EXT_SCALE_DATABASE=hd_ext_scale_v2capacity`、`EXTERNAL_CACHE_NAMESPACE=hd-ext-scale-v2capacity`、`EXTERNAL_PUBLIC_CACHE=redis` 及完整的提交 SHA `RELEASE_ID`。记录 Redis TTL、回源并发、数据库池、主机配额与镜像架构。迁移和初始化命令补充环境变量 `HD_DEPLOYMENT_ENV=test` 和 `HD_RELEASE_ID=<SHA>`。

常驻服务只启动该项目的 PostgreSQL 和 Redis。每档使用一个临时 API 容器。同步档额外启动合成 worker，投递 33 个一组的事件，并核对压测期间完成的事件数。每次重跑同步档给出新的递增代数，跳过上一次已投递的代数。各档的 JSON 存入私有目录。

对新版复测时，从已停止的合成 PostgreSQL 制作独立克隆，使用单独的私有数据目录、空闲子网和 `--project hd-ops-ext02-v2capacity-candidate`。保持数据库名及缓存命名空间相同，两个项目的 Redis 各自在不同内部网络运行。候选迁移只应用到新克隆。记录实际源码指纹和镜像 digest。

支持合成回源队列的候选使用 `--queued-loads 16` 对齐正式配置中的 4 个回源、16 个排队和 15 秒 TTL。试验环境的 `EXTERNAL_CACHE_MAX_LOADS` 和 `EXTERNAL_CACHE_TTL_MS` 需要保持为 4 和 15000。输出会核对并记录实际队列配置。旧镜像可省略该参数复现无排队基线。

```bash
bench=(python3 -B deploy/runtime/ops-ext/v2-capacity.py --env "$SCALE_ENV" --docker-context "$LOCAL_DOCKER_CONTEXT")
"${bench[@]}" cold 20 20 > "$EVIDENCE/cold-20.json"
"${bench[@]}" warm 20 300 > "$EVIDENCE/warm-20.json"
"${bench[@]}" sync 20 2000 --sync-generation 1 > "$EVIDENCE/sync-20.json"
"${bench[@]}" redis-failure 20 240 > "$EVIDENCE/redis-failure-20.json"
"${bench[@]}" contact 20 400 > "$EVIDENCE/contact-20.json"
"${bench[@]}" contact-failure 20 400 > "$EVIDENCE/contact-failure-20.json"
"${bench[@]}" rate-limit 20 140 > "$EVIDENCE/rate-limit-20.json"
"${bench[@]}" warm 50 1000 > "$EVIDENCE/warm-50.json"
"${bench[@]}" warm 100 1000 > "$EVIDENCE/warm-100.json"
"${bench[@]}" cold 50 50 > "$EVIDENCE/cold-50.json"
"${bench[@]}" cold 100 100 > "$EVIDENCE/cold-100.json"
```

- 20 并发按列表和筛选分别核对成功响应 P95 ≤800 ms 及全量错误率 <1%。50／100 并发记录吞吐、延迟、错误分类和数据库连接池用于定位拐点。退出 1 表示门槛或场景证据未满足，仍输出 JSON。退出 2 表示配置或运行失败。
- 冷档重启独立非持久 Redis，启动新的 API 并测一波请求。应用内缓存和 Redis 从空开始。PostgreSQL 与操作系统的缓冲状态沿用测试前状态。缓存故障档指向同一隔离 Redis 容器未监听的端口，记录连接拒绝后目录回源的结果。
- 单来源限流独立核对 429 和 `Retry-After`。现场重现旧版批量统计时可单独运行 `analytics` 和 `analytics-failure` 两档，历史基线使用事件回执数核对实际落库。
- 咨询统计档仅在候选测试进程开启回环同源计数，用已发布的合成车源验证 HTTP 204 和小时表实际增量，记录拒收与暂时不可用。失败档锁定专库的咨询小时表，核对写入失败时目录表现。整个实验只发送本站合成请求。
- 网关小时文档另在隔离 HTTPS 入口核对。成功的普通 HTML 文档包含缓存返还；预取、RSC、后台、静态资源、已知爬虫、失败状态均排除。使用已结束的北京时间整点汇总，向独立数据库重复导入同一快照，核对第二次为重复且总数保持一致。使用不同内容再次导入同一小时应报冲突。网关及后台的实际汇总链路由联调验证。
- 这套场景覆盖 Fastify 进程内请求与实际 PostgreSQL、Redis 和合成 worker。另用同配主机和最终发布镜像复核官网、网关、真实网络、正式目录读路径和同步适配器的完整链路。
