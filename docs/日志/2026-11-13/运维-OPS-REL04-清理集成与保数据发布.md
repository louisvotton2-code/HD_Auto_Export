# OPS / OPS-REL04 / 清理集成与保数据发布
日期：2026-11-13（Asia/Shanghai）
状态：进行中

## 范围与版本
用户授权现有代码/临时内容清理、必要验收、PR合并main、无用分支清理和生产发布。OPS为唯一Git集成人，FE/BE/AD各自提交并提供独立审查。基线为实际远端main `102de594226c016f5e788e1b250001d53cb0bd17`；隔离工作树 `docs/private/ops-rel04-worktree`、分支 `codex/ops-rel04`。根acceptance-polish历史改动不覆盖、不整体暂存。CSV数据同步本轮不实现/不开启，不导入数据、不收费翻译。

## 实际变更
核对线上同一main的5服务healthy、18项迁移、Ali人工确认配置与50000小时额度、external disabled/sync off。开工时0车辆/0媒体/1员工是只读快照，不授权清空或忽略后续写入。补存REL03实际部署执行日志，完善日常发布保留当前库/媒体/秘密/预算的说明，首次清车工具明确限首次schema4。尚未确认可删部署代码，不为凑清理重构或删除保护性测试。

## 验证与限制
根与隔离树hooks:check通过；远端fetch/main核对、线上镜像/配置/挂载/账本只读核对完成。生产尚未执行本轮写操作。各端提交、定向集成、独立review、verify:push、PR/CI、本轮生产备份恢复和切换均待执行。分支/工作树须先保留完整清单和merged/patch等价及干净状态证据；根脏树和未知独有内容保留。

## 交接
上轮实际部署证据见忽略目录 `docs/private/ops-rel03/production-delivery-index.json`；本轮只读基线 `docs/private/ops-rel04/production-baseline.json`。PM共享进度由本轮集成树按实际证据更新，不复制根历史脏文档。任何新写入后故障先保全最新数据，不能用旧快照回滚用户写入。

## 定向修复与集成进度
FE负责无业务读取的三语HTML fallback，OPS配合正式域三语单车详情HTML真实404拦截；仅GET/HEAD协商text/html且RSC/全部预取标志空的请求进入，原API/列表/后台/503/429保持。真实Nginx Unix TLS合成上游5项定向用例通过（8.213秒）；初次遗漏nested error_page递归开关导致失败，补齐后又因新增请求突发命中原8r/s SSR守门，随后仅为同peer夹具加0.14秒节拍，未调低正式限流。独立OPS reviewer静态核对三文件PASS，真实FE成品组合仍待，未先记P2关闭。
BE be03f20（基线102de594）独立审查PASS，46定向单元、4隔离DB及其类型/构建/OpenAPI/边界证据已收，集成提交28fe455；5个源码只删无调用导出与闲置参数，HTTP/schema/迁移/依赖不变。

运维清理补充：本轮定向Python测试生成的字节码已删除，忽略`__pycache__/`以避免后续缓存混入提交。统一运行说明去除“可丢失新写入后恢复旧快照”的过时表述，并将3320首次本机迁移标为历史说明；保留仍有保护作用的备份、恢复、Redis ACL和迁移重置测试。
