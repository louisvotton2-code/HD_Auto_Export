# EXT09 在线每日备份

普通发布不调用整库备份或恢复演练。每日任务保留最新两个成功加密归档，既有基准恢复点不参与日备份淘汰；发布、失败和未知目录不会按日期盲删。

## 自有数据范围

例行配置的 `backupScope` 可设为 `first-party-v1`。保留员工上传的车源与原图、草稿和发布版本、后台账号与配置、人工编辑和审核记录。供应商明细、原始回包、CSV、搜索投影、图片链接和同步队列交给供应商重新同步。保留人工修订和首页选车所引用的小量身份与审核证据。数据库结构、迁移账本和询价编号水位继续备份。未配置范围时保持 `full`。

自有数据包的 `database.dump` 与 `first-party.sql` 共用一个 PostgreSQL 快照。恢复时先加载结构与普通数据，再加载补充记录，最后创建并核验外键。恢复库的供应商同步停用，保留的供应商身份在重新同步前不可公开浏览。核验脚本 `verify-first-party-restore.py --point <私有恢复点> --container <隔离 PostgreSQL 容器>` 会在明确指定的容器里创建一次性数据库，核对数据指纹、已上传原图和迁移账本后清理临时库。[PostgreSQL 转储与恢复](https://www.postgresql.org/docs/18/backup-dump.html)

生产首次验证使用仅该次命令读取的自有数据配置及 `--retain-for-restore`。已有两份加密备份在验证期间继续保留。使用隔离 PostgreSQL 并加 `--finalize`，它会先校验密文，再记录与该恢复点绑定的明文组件恢复证明和清理临时文件。启动例行范围前核实成功证明，容量控制器读取同一份例行配置，按自有数据实测样本估算新恢复点，并继续计入旧备份当前占盘。若恢复全量备份范围，先让已发布的自有范围容量决定失效，再切换例行配置和容量脚本。

## 通用流程及整库归档

前提：API 和 worker 均已部署 0026 物理删除保护；私有配置 mediaLeaseCommand 为实际 API 镜像执行 `node dist/backup-lease-cli.js` 的命令数组。程序追加 acquire/release 与唯一 reference。持久保护没有自动到期；中断后确认归档进程停止，再按该 reference 释放，不能批量清 lease。

pg_dump 使用自身一致快照，官网、API 和 worker 在线。准确 reference 的持久 lease 阻止媒体、原档数据和 CSV 的物理清理。程序在持有 lease 后只对未清理的 CSV 快照登记对应 pins。原档数据库行随 MVCC dump 保存，保护由全局 lease 提供。当前备份预检按现有库和文件估算瞬时空间，实盘 70% 门槛继续生效。

压缩组件经校验后以 tar 流送入 CMS AES-256-GCM。密文落盘、哈希及成功状态保存后删除本次明文组件；保留 manifest。归档生成成功、恢复验证、离机验证是三种不同状态。每次备份不作恢复演练；新流程上线时用隔离合成证书验证认证解密和`unpack_verified_bundle`，再以同一正式备份点的校验组件完成一次隔离数据库恢复；两种证据分开记录。嵌套文件归档绝不能直接解压覆盖生产根目录。私钥保持离机。

容量模型 hd-ext09-daily-two-v1：两份成功点 + 创建中新点的压缩组件和密文，保守峰值4P；既有固定基准在 protectedBytes 中，不重复累加。此模型不承诺400GiB足够全量；当前人工同步暂停与70%重任务保护不变。旧压缩观测只有相同快照、证据哈希及有效期才可复用。

服务器须验证 OpenSSL 流式 GCM 加密/认证解密兼容及损坏拒绝，并核实一次恢复。未成功前保持原基准；旧 EXT08 未完成离机材料不自动删除。每日失败也不删除最后有效点来腾空间。

一次真实恢复使用显式 `--retain-for-restore`，默认关闭。该点状态标为 `plaintextRetention=temporary-for-one-time-restore`，仅暂留同一 manifest 中哈希绑定的组件。OPS 从这些组件恢复到独立库，核对引用后写该点 restore-proof，再调用 `remove_verified_components` 清理组件并更新明文状态。恢复证明必须标明 `input=plaintext-components`，不能声称最终生产密文已认证解密或离机成功。生产私钥不上传服务器；流式 GCM 的认证解密与篡改拒绝用隔离合成证书验证。保留组件模式不进入每日计划命令。

在线媒体清单保存不可变 UUID.webp 原图。缩略图和卡片图可按需重建，已知暂存文件一并排除。CSV 归档覆盖原子发布的 UUID.csv 或 UUID.csv.gz，下载中的 .csv.partial 排除。未知命名会使备份失败。原图发布时双硬链接最多等待 500 ms，持续异常或已发布原图消失都会终止归档。

失败恢复采取最小 fail-closed 策略：持单任务锁，创建点后立即持久化 ownerPid/reference/phase；任一 daily 点缺失成功证明、处于 dump/pack/encrypt 或仍待一次恢复清理时，下一次任务在创建新目录和新全库副本前拒绝。不会仅按 TTL 自动删材料或释放活动保护。失败最多保留这一份未解决副本，不每日堆积。OPS 必须先确认所属 docker exec/子进程和文件描述符已结束，按本点 manifest/owned phase 清理明确组件，释放其准确 archive pin 和 lease，归档日志及失败标记后才能再启。未知目录、基准和 EXT08 材料不自动处理。同步失败也优先保留证据并阻止下次运行，避免误认为 Python 退出就等于服务端 pg_dump 已退出。

CSV 归档在持久 lease 和 dump 完成后读取 external_full_snapshots 中未清理的路径。选取 SQL 引用的 UUID.csv 或 UUID.csv.gz，并按 /private/full-sync 下的精确文件名映射。有效密文落盘并校验明文组件收尾后，先清除本点 CSV pins，再释放相同 reference 的全局 lease。失败点保留保护，供操作员核对任务已停止后按准确 reference 收尾。早期失败点如含逐行原档引用，仍走旧 archive-release 清除该点的引用。

最终名单覆盖所有未pruned快照（含已变failed），以dump引用超集为目标。已有正式文件均保存，仅downloading/failed且文件不存在时可略过；其他missing失败。上次成功daily超过两个说明淘汰未收尾，下一次任务先拒绝，不再积累新副本。
