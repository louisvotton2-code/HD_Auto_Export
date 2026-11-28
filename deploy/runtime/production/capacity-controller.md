# EXT07 capacity controller

Controller only: `capacity-decision.py` calls sibling `capacity-measure.py::measure()` once per locked invocation. OPS supplies that live measurement/model function; missing or failed measurement publishes `wait`, never stale `allow`. No supplier requests are made by this controller.

Input is the PM decision binding (`snapshotId`, `targetRows`, `sampleRows`, `evidenceHash`) plus `sampleEvidenceSufficient`, `projectedPeakBytes`, `diskTotalBytes`, `currentUsedBytes`, and a flat `components` dictionary of byte-valued safe integers (names ending in `Bytes`). The measurement implementation must obtain fresh data, not return a prior cached decision. Hash is copied from BE, never reconstructed here. The controller checks the heavy-work boundary and publishes only whitelisted fields, valid for at most ten minutes.

同步裁决和数据盘告警服务共用 root 所有的 `/etc/hd-auto/capacity.json`。`heavyWorkPausePercent` 控制实际磁盘用量，默认 `70`，允许显式设置 `80`。回执中的实测用量按 worker 可用空间扣减，包含文件系统保留块。`projectedPeakPausePercent` 控制估算峰值，允许设为 `70`、`80` 或 `90`，默认与实际门槛相同。达到任一门槛时，原生裁决拒绝放行。实际用量告警自 `60%` 起生效，I/O 和备份保护继续独立执行。

实际 `80%`、估算 `90%` 时，重任务 worker 和一次性操作容器同时使用 `FULL_SYNC_HEAVY_WORK_PAUSE_PERCENT=80` 与 `FULL_SYNC_PROJECTED_PEAK_PAUSE_PERCENT=90`。宿主配置及容器策略须与同一次采样的原生回执匹配。回执只在两个门槛不同时增加 `projectedPeakPausePercent`。旧 worker 会拒绝含独立门槛的回执。宿主测量与裁决脚本按同一版一起安装。变更时先部署支持新字段的单 worker，在原门槛下核验，再切换宿主与容器的峰值配置。回退旧 worker 前先恢复共用门槛，并取得同代、同目标的兼容回执。

`capacity-measure.py::measure(prospective_target_rows=…)` 用同一次采样的宿主实测、数据库组件与备份保留口径重算拟议目标。前瞻结果的外层同时返回宿主实际使用的两个门槛。前瞻结果与当前原生回执分别保存，投影本身不会生成授权。改变累计准入上限后，仅接受原生计时器为当前快照和新目标生成的有效回执。

OPS provision `/srv/hd-auto/data/full-sync-capacity` root-owned, group equal to worker APP_GID, mode 0750. Decision files are root/group 0640, atomically replaced with file/directory fsync; worker mounts the directory read-only. Keep source directory root-controlled. Install/enable the matching systemd service and minute timer after the measurement function is present. Timer timeout leaves any old decision bounded by its expiry; the worker independently enforces expiry and live disk limits.

Configured measurement roots may be real paths inside `/srv/hd-auto`, or these exact host controls: `/etc/hd-auto`, `/etc/letsencrypt`, `/etc/fstab`, `/etc/systemd/system/docker.service.d/hd-auto-storage.conf`, `/usr/local/sbin/hd-auto-storage-check`. Parent-link aliases and traversal are rejected; directory size measurement does not follow nested links. Keep the live host controls in the cost model rather than substituting an old backup or omitting their size.

Candidate was edited only on the workstation. Server checks required: `python3 -m unittest test_capacity_decision.py` from `deploy/runtime`, plus existing Compose test extended for this read-only mount. Full measurement/decision/BE integration remains OPS responsibility; this file does not claim deployment or test success.

同步裁决与日备份预检复用同一套备份大小算法。正常备份完成清理后，以匹配数据库、最近 48 小时的实际压缩转储记录估算。只有备份时数据库至少达到当前数据库一半的记录参与压缩比例，以其中较高值加 25% 估算余量。缺少可比记录时使用物理数据库大小。业务表包含原始资料，压缩备份包含暂存表，两处均不再重复叠加。判断容量时保留两份已有备份及新备份临时组件与密文并存，并计算系统保留块。每日备份写入数据库转储、压缩包和密文时也复查实盘 70% 上限，未完成点进入既有恢复流程。容量服务不会为满足本模型额外运行压缩采样。
