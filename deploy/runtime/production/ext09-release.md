# EXT09 单机平滑发布

普通发布不创建全库副本，也不做全库恢复或不断变化的生产表指纹对比。代码审查和 CI 后，在服务器串行构建；新旧 API/web 槽短时共存，数据库、Redis和单worker共享保留，公网 Nginx 不重建。

## 部署入口

`release-slots.py` 从实际 Compose 解析结果生成 blue/green 私网槽：固定地址不得冲突，不开放宿主端口。新 API 挂载独立可读目录，600权限的 mode 文件归应用用户所有，通过同目录临时文件+原子rename变更 candidate/active/draining；候选启动前必须已有 candidate 文件。应用和构建使用同一最终SHA，官网构建参数 `HD_DEPLOYMENT_ID` 由 `RELEASE_ID` 提供。

`gateway_files()` 保留已有私有媒体、可信代理及限流规则，只换受审槽名，后台冻结仅限其 API 入口。`gateway-reload.py` 先保存旧配置，校验新配置后 graceful reload；失败恢复旧配置。root私有 `/srv/hd-auto/staging/gateway` 为可重建状态源。首次现有proxy容器不重建，只复制配置/资产；未来显式重建时追加 `compose.stable-gateway.yaml` 的宿主挂载。重启已有容器保留其文件层，不把需要重新创建的容器当无状态。

`immutable-assets.py` 合并当前与前一版 Next 静态资源；相同URL不同内容拒绝。旧哈希文件先保留，不能切换后就随旧槽删除。Nginx只为此目录设immutable缓存，不缓存HTML。Next deploymentId识别RSC跨版本；`?dpl`本身不负责选槽。后台静态产物也保存在gateway/admin，不强刷未保存表单。

## 单一写入交接

后续受控版本：先旧槽 draining，读取旧 `/health/serving` 等真实副作用请求计数为0，再将新槽 active并切后台路由；不能同时两个active。不因客户端断线推断付费调用结束。新API按双投影兼容旧FE，扩展迁移先做，破坏性移除另排。worker待新API正常后同版本交接，不开第二worker，持久 paused=true 保留。

首次旧e623不认识mode：新candidate公开读健康后，将公开web/API先接新槽；冻结旧后台全部API（含auth GET）并禁止所有可能副作用入口。至少保留旧进程150秒，检查translation_plans/segments running=0、预算预留不再增长；有不确定状态就停在此阶段协调，不自动杀调用或重试翻译。随后优雅停止旧API确保唯一写入，再提升新active、后台切新。旧SSR公共请求要在停止旧API前排空。公网读保持可访问；后台写入短暂停顿如实记录。

切换观察至少10分钟后停旧web等无引用应用槽，保留旧镜像及可重建配置。新写入后的回退是兼容应用切换，不直接恢复旧数据库覆盖员工操作。新API和worker均识别备份lease之后，才启用新版在线每日备份。

## 资源和验证

Build/restore/双槽串行，避免3GiB构建器与双槽、恢复库叠加。新槽沿用API640MiB/web768MiB限额和有限数据库连接池；现场核对资源后执行。不承诺单机故障高可用。

实际交付记录应包括最终SHA、候选只读/收费拒绝、旧在途排空证据、公开页面连续采样、旧哈希资源请求、proxy未重启、worker同版且paused，以及备份/清理独立结果。不要把unit通过当实际线上切换完成。
