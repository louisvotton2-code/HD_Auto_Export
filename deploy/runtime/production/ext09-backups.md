# EXT09 在线每日备份

普通发布不调用整库备份或恢复演练。每日任务保留最新两个成功加密归档，既有基准恢复点不参与日备份淘汰；发布、失败和未知目录不会按日期盲删。

前提：API 和 worker 均已部署 0026 物理删除保护；私有配置 mediaLeaseCommand 为实际 API 镜像执行 `node dist/backup-lease-cli.js` 的命令数组。程序追加 acquire/release 与唯一 reference。持久保护没有自动到期；中断后确认归档进程停止，再按该 reference 释放，不能批量清 lease。

pg_dump 使用自身一致快照，不停官网、API 或 worker。文件归档期间保护媒体与原档物理删除。当前备份预检仅按现有库和文件估算瞬时空间，不依赖未来全量容量准入。70% 门槛不变。

压缩组件经校验后以 tar 流送入 CMS AES-256-GCM。密文落盘、哈希及成功状态保存后删除本次明文组件；保留 manifest。归档生成成功、恢复验证、离机验证是三种不同状态。每次备份不作恢复演练；新流程上线时用隔离合成证书验证认证解密和`unpack_verified_bundle`，再以同一正式备份点的校验组件完成一次隔离数据库恢复；两种证据分开记录。嵌套文件归档绝不能直接解压覆盖生产根目录。私钥保持离机。

容量模型 hd-ext09-daily-two-v1：两份成功点 + 创建中新点的压缩组件和密文，保守峰值4P；既有固定基准在 protectedBytes 中，不重复累加。此模型不承诺400GiB足够全量；当前人工同步暂停与70%重任务保护不变。旧压缩观测只有相同快照、证据哈希及有效期才可复用。

服务器须验证 OpenSSL 流式 GCM 加密/认证解密兼容及损坏拒绝，并核实一次恢复。未成功前保持原基准；旧 EXT08 未完成离机材料不自动删除。每日失败也不删除最后有效点来腾空间。

一次真实恢复使用显式 `--retain-for-restore`，默认关闭。该点状态标为 `plaintextRetention=temporary-for-one-time-restore`，仅暂留同一 manifest 中哈希绑定的组件。OPS 从这些组件恢复到独立库，核对引用后写该点 restore-proof，再调用 `remove_verified_components` 清理组件并更新明文状态。恢复证明必须标明 `input=plaintext-components`，不能声称最终生产密文已认证解密或离机成功。生产私钥不上传服务器；流式 GCM 的认证解密与篡改拒绝用隔离合成证书验证。保留组件模式不进入每日计划命令。

在线文件清单使用明确 profile：媒体仅保存不可变 UUID.webp 原图，派生缩略图可按需重建；排除已知 UUID 上传临时名。CSV仅保存已原子发布的 UUID.csv，忽略对应 .csv.partial。未知命名仍拒绝，controls不忽略任何临时后缀。原图发布瞬间的双硬链接最多等待500ms；持续异常或已发布原图消失仍失败，不能静默漏掉快照引用。

失败恢复采取最小 fail-closed 策略：持单任务锁，创建点后立即持久化 ownerPid/reference/phase；任一 daily 点缺失成功证明、处于 dump/pack/encrypt 或仍待一次恢复清理时，下一次任务在创建新目录和新全库副本前拒绝。不会仅按 TTL 自动删材料或释放活动保护。失败最多保留这一份未解决副本，不每日堆积。OPS 必须先确认所属 docker exec/子进程和文件描述符已结束，按本点 manifest/owned phase 清理明确组件，释放其准确 archive pin 和 lease，归档日志及失败标记后才能再启。未知目录、基准和 EXT08 材料不自动处理。同步失败也优先保留证据并阻止下次运行，避免误认为 Python 退出就等于服务端 pg_dump 已退出。

CSV归档在持久lease和dump完成后读取 external_full_snapshots 正式状态且未pruned的path，仅归档SQL引用的UUID.csv或UUID.csv.gz；未被引用的合法文件视为下载/压缩过程，不收录。选中路径缺失与未知名称仍失败。worker路径只允许/private/full-sync精确basename映射，不接受任意文件路径。

最终名单覆盖所有未pruned快照（含已变failed），以dump引用超集为目标。已有正式文件均保存，仅downloading/failed且文件不存在时可略过；其他missing失败。上次成功daily超过两个说明淘汰未收尾，下一次任务先拒绝，不再积累新副本。
