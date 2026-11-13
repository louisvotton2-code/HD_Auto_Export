# OPS / OPS-REL-03 / 生产部署执行
日期：2026-11-13（Asia/Shanghai）
状态：待用户业务／视觉验收（生产部署与技术冒烟完成）

## 范围与版本
PM已放行准确main `102de594226c016f5e788e1b250001d53cb0bd17`，tree `fa802e97ab10d5c239a1aae850d3b8829c119260`。PR #2已合并，push/PR/main verify通过；与已独立审查、完整本地验证的005a09f代码树一致。既有FE-REL03-P2-01无JS缺车404正文问题仍按PM接受非阻断。

## 实际执行
- 纯源码包核验SHA256 `d4f25f76ec113aabc0f7aca37819e6b9ce2f6609f706e75744b9689b5cc5839e`；目标Linux/amd64构建postgres/API/Web/proxy-domains四镜像通过。不上传本机业务库、媒体或Mac产物。
- 10:30:19停止旧API/Web写入，双域维护。最新停写快照 `/srv/hd-auto/backups/ops-rel03-20261113T023019Z`；原库和媒体备份校验并真实恢复至独立新库/私有媒体验证目录，逐表及序列摘要相符。原env/secret/TLS/ACME/续期配置另做私有恢复验证，57常规文件、6个受控链接，内容、权限、身份通过；不是异地灾备。
- 新逻辑库 `hd_release_102de594226c016f` 精确18项迁移后执行已审SQL清空展示：车辆0、媒体0、员工1；保留非展示表、账户权限、系统配置、费用/预算和审计。422审计车源关联保留在维护私有archive，新角色不可读。原库原角色fence、原媒体保留受限回退。
- 初次清空前epoch没有单独捕获，不声称已观测；仍停写时额外观测并旋转一次epoch，实际前后不同，最终pending0、两个immutable guards开启、archive无USAGE、旧库可读对象0。没有重做清库。
- 成组重建网络并启动5容器，实际main镜像绑定正确、均healthy，仅代理80/443公开；PG/Redis/Web内部隔离，API单独出口。
- 全组必要重启后账号/空目录/schema/epoch/revision保持。原生产账号通过公网HTTPS成功登录、后台列表200并登出；未改账号密码或造车。三语首页/列表200、公开接口空数组total0、内部路径404、404资源no-store、成功静态immutable。

## 失败与边界
维护初次reload误用默认Nginx主配置导致PID为空，在停写前失败；改为实际nginx-media-main配置后成功。第二次因已存在准备目录拒绝，确认未停writer后安全续跑；成功停写/备份未重复。控制备份先拒绝旧tools绝对链接，保留失败partial，再严格校验已知旧release目标并归档真实目录/受控恢复alias后通过。
本机Python默认CA缺链；用标准certifi可信根完成公网证书验证，未关闭TLS验证，系统curl另实测200。证据最初Cache-Control=null为大小写采集遗漏；只读补核API/auth实际no-store、预览private,no-store且SAMEORIGIN/CSP保留，无线上头修复。
初次切换时Ali为disabled，随后按下文完整小时保护窗口启用。旧schema4无完整持久小时费用预算，按停写时刻等待完整1小时，门槛为最早11:30:19，最终实际启用见下文，后续仍需员工未知费用确认。无收费验收、无供应商导入/同步。任何新写入后故障必须先保全新库/媒体/配置/费用，禁止旧快照覆盖。

## 证据与交接
实际证据索引在本机忽略目录 `docs/private/ops-rel03/actual-production-deployment.json`；公网检查 `production-https-smoke.json` 与 `production-headers-proof.json`。服务器阶段材料 `/srv/hd-auto/staging/ops-rel03-execute` 为root私有。部署脚本经独立Reviewer复核；Ali启用脚本另有版本绑定报告。生产执行材料不纳入应用源码包。
此执行日志和角色摘要尚未提交/推送，不改变已部署main版本。当前3363及其本机业务数据未改动。自动异地备份/监控未建立，业务视觉最终由用户确认。

## 最终完成
北京时间11:30:26，完整小时保护窗口结束后仅API重建成功，Ali运行配置已启用，额度50000字符/滚动小时、真实凭据仅存在性确认、余额仍unknown，沿用已审员工费用确认流程。不做收费调用；供应商目录disabled、同步off。实际5服务healthy，资源限制匹配正式配置，API新媒体可写/代理同目录只读，目录为空且15001:0700。启用后公网HTTPS空目录仍200/total0。小时等待为本次部署任务内一次性步骤，未建立定时自动化。原程序停写10:30:19.704803，启用11:30:26，未提前。最新实际证据索引已更新，独立审查报告另记时间门槛与脚本版本。
