# OPS-DISK-01 / 数据盘迁移与账号

时间：2026-11-14 01:14 CST。状态：已完成运行迁移与账号验收。源码基线b19f9c7；应用048c0646／配置ed7b1628及镜像保持，不发布新应用或触发全仓检查。

- 新盘为400GiB（429,496,729,600字节），空盘身份／分区／签名／128处抽样校验后才初始化。UUID `e36c9593-f25b-4c34-81ae-c0a8e6060f6e`，挂载 `/mnt/hd-auto-data`；文件系统约392.65GiB，当前可用约387.78GiB（含正常文件系统开销和预留）。
- `/srv/hd-auto/data`、`secrets`、`backups`、`staging`四个稳定入口均绑定到该盘；数据库、媒体、凭据、备份及原档暂存后续沿原路径写新盘。Docker镜像／系统日志留系统盘，Redis仅缓存。
- 停写后最新备份：`/srv/hd-auto/backups/disk01-20261113T170545Z`；系统盘回退副本：`/srv/hd-auto/system-disk-before-disk01`，其中同名backups也保留该快照。全库62表／2序列迁移前后指纹一致，冷拷贝内容与权限一致，原5容器及镜像保持、必要重启后全部healthy；容器内数据库／媒体设备号确在新盘，原应用身份媒体读写权限通过。
- UUID固定挂载；Docker的RequiresMountsFor／BindsTo与`/usr/local/sbin/hd-auto-storage-check`校验UUID和既有PG数据。真实未挂载状态拒启检查、Docker重启触发自动挂载通过；未进行整机重启或物理拔盘。原容器重启策略保持。
- admin保留原稳定ID及管理员角色，仅按授权更新登录；mzm、wtj为editor，无员工管理权限。三个账号均通过真实HTTPS登录、角色检查、退出后401；无测试车，未改其他员工。明文密码仅走隐藏stdin，未落盘／进命令行／应用日志／Git；本机和服务器临时输入程序已清理，保留无密码结果。
- 数据保持：固定300／canonical300，公开290（原10条上游撤回未复活）；媒体0、schema22。一次必要入口核对：目录200／290、后台200。full／timer／自动翻译未开启，worker0；API原人工Ali与50000字符小时额度保留，无付费验收。未重做全站UI或恢复测试。
- 后续回退前先停写并保全新写入，不能直接用系统盘旧副本或旧备份覆盖当前生产。独立Reviewer一次变更审查通过；执行结果在本机私有`docs/private/ops-disk-01/result.json`和服务器`/srv/hd-auto/ops-disk-01/`，均无明文密码。
