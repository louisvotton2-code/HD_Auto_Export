# EXT07 正式全量运行维护

本入口描述运行约定，实际版本、计数和执行结果以本轮 OPS 记录为准；文件存在不等于已上线。

正式同步使用 `compose.full-sync.yaml` 的 `full-worker`，profile `full-sync`；独立于固定300旧worker及synthetic同步。生产库、已有身份、人工覆盖和员工账号保留，`EXTERNAL_SYNC_MODE=off` 仅关闭旧模式。翻译为disabled，图片使用供应商直链。worker初始.5CPU/512MiB/Node堆256MiB/pool2，单任务锁和全局2qps由BE实现。`full-sync configure/run/serve/status/control/archive-pin/archive-release` 只映射正式CLI；准确参数按BE本轮契约。启动serve前需显式configure；尚未完成的旧样本模式不能当全量入口。

`FULL_SYNC_DATA_ROOT` 必须为新盘 `/srv/hd-auto/data/full-sync`，容器固定 `/private/full-sync`；宿主先创建并赋应用UID/GID。全局Docker缺挂载保护须继续有效，不能改回系统盘临时目录。大任务暂停期间仍应处理撤回和查询。

容量基线和首1万充分三语/报告样本由OPS使用 `storage-measure.py` 读实际DB、索引、WAL、暂存、归档、媒体、备份和整盘占用；DB压缩原文必须选择 `--archives-in-database`，CSV目录作为staging。`storage-budget.py` 按实际distinct处理来源数和完整CSV target估算剩余空间。索引已含DB，不重复相加；DB内原文无法分拆时以整库预留一历史版本，另预留两未来备份的验证组件+密文及至少2GiB额外WAL。60%告警、70%当前或预测峰值暂停重任务；不足样本不自动放行，不采购或删除业务资料。显式预算只在实测后设置，不能绕过BE样本门槛。

每日备份由 `hd-auto-ext07-backup.timer` 调用 `routine-backup.py`，上海时间04:20左右，单锁、.5CPU/512MiB、低IO优先级。私有root 0600配置 `/srv/hd-auto/secrets/ext07/backup.json` 记实际compose/runtime参数数组、库名、新盘UUID、公钥证书、自有媒体路径及配置文件根；不写密码值。当前源码指针 `/srv/hd-auto/staging/ext07/current-source` 只在已批准发布后更新。

备份先按数据库/归档/媒体/配置实测预留原组件+临时压缩容器+密文三份峰值，预计超过70%则在暂停服务前拒绝，不删除旧恢复点凑空间；随后停止正式worker，pin当前原文/CSV引用，再用现有runtime停写快照；包含完整库、自有媒体、来源归档及控制配置，校验压缩归档内容、模式/属主及受限相对链接。原服务恢复后CMS AES-256-GCM加密，私钥/口令只留离机位置；原组件暂留便于验证，临时外层压缩包删除。仅保留最近两个成功daily点，release点和失败/未知点不自动删除。删除已成功旧daily后才释放该reference，失败保留保护pin并报告。

本机离线时server只能生成本地密文，`offsite=pending`，不能称离机成功。OPS实际传输后核SHA、认证解密和文件manifest，并单独登记结果。正式全量前最新发布恢复点需实际隔离恢复，核对三账号及现有300/覆盖/审计/预算/配置；不得用旧快照覆盖新写入。每天的本地压缩点不能代替已验证的离机副本或容灾SLA。

资源紧张、断网、账户限额或接口错误均保留真实状态及断点。PR合并/代码上线/全量进行中/全量完成分别记录，不能用启动serve代替最终完成。

双域公网入口仅为 gallery/configuration/inspection/price-history 四类有界GET/HEAD开放车辆子路径，并统一归入既有public-api直接对端限流；管理员私有路径和多余层级仍404，写方法不转发。发布前用真实Nginx隔离Unix TLS核验路径、尾斜杠、头清理与同一限流桶。
