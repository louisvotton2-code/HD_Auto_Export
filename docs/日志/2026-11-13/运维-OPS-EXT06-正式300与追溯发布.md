# OPS / OPS-EXT06 / 正式300与员工追溯发布
日期：2026-11-13（Asia/Shanghai）
状态：进行中

## 范围与版本
用户已授权完整实施、按PR/CI合main部署并固定约300正式去重车源导入及一次限定名单增量追平。共同基线为已核GitHub main `8523c851fe7cc64a4c32ea428ea7a293d6501510`，独立分支 `codex/ext06`、工作树 `docs/private/ops-ext06-worktree`。根历史脏树不纳入。本轮不清生产、不迁移本地样本、不新建生产测试账号/车、不购买付费服务、不调用Ali、不全量入库、不持续调度。冻结任务与角色交付在本机私有目录 `docs/private/pm-ext06/`。

## 已执行与当前依赖
独立工作树hooks:check通过；首次Git fetch因SSH banner连接超时失败，随后GitHub只读接口实际确认main8523c851，与工作树基线一致，不把失败fetch记成功。现网容量只读采集已发起，结果将保留到私有证据。

BE先交公共契约切片，再接Worker入口与资源；PA负责供应商完整CSV与固定名单证据，OPS不重复下载或猜测接口。完成前需要收齐各端准确SHA/独立报告、员工追溯和名单导入定向联调、完整性/幂等/乱序/撤回证明、容量与70%/75%阈值、最新生产备份实际恢复及加密离机。仍未执行本轮生产停写、迁移或导入，未记任何待执行验收为通过。

## 发布门槛与交接
OPS唯一集成并串行维护公共依赖/锁；按准确最终SHA独立review、verify:push、PR/CI/main后构建部署。保留最新生产数据库/媒体/配置/账号/费用/预算/审计，新增迁移只执行已审增量；失败先保全新写入，不能覆盖旧快照。仅新增本批记录可做受控回退。最终计数必须分raw/canonical/public及各来源；最后持久调度关闭，记录供应商请求量、资源净增、恢复/离机证据及限制。

实际结果统一归档 `docs/private/ops-ext06/` 和共享 `docs/private/pm-ext06/OPS-handoff.md`；最终actual-deployment.json和delivery-index在实际执行后生成，不提前宣称上线。

## OPS准备检查与限制

现网新测磁盘总73586700288/已用16640909312/可用53721595904 bytes（22.614%），4CPU、系统可用内存5958724kB；数据库11654847、WAL33554432 bytes，原库18账本/0车0媒体1员工/5服务healthy。此为只读开工时快照，不代表本轮导入，也不保证全量承载。四个角色树依赖已按offline/frozen/ignore-scripts串行完成，lock63c074b28保持；原Git fetch失败后重试成功、origin/main8523c851已核，正式契约2723802精确接入8a20baa。

新增手工Worker profile/非root入口，复用API镜像且不挂AUTH/Ali/媒体，只读固定数据包、私网DB+独立出口、无宿主端口；0.5CPU/512MiB/pool2/禁持续调度与翻译。4项Node安全边界检查通过；真实六层Compose渲染检查1项通过，首次仅因JSON将mem_limit编码为字符串而夹具类型比较失败，改按数值核对后通过，限额未变。尚待BE准确最终CLI/迁移/镜像的隔离运行验收，配置通过不当成Worker已上线。

加密离机工具采用OpenSSL3 CMS AES256GCM、公钥加密，Mac独立私有目录保存加密私钥/口令，服务器不持私钥；只接受新鲜且实际恢复证明与全部原档hash绑定的备份，输出FD与归档消费字节、传输密文SHA绑定。拒绝不可信路径/宽权限/共址材料、无认证CMS及超70%加解密峰值。14项最终定向合成检查通过；过程中保留了原6项通过、补面后Mac临时路径别名失败、共享FD缓冲偏移失败、内外CMS类型识别失败等全部日志，修复后按受影响面复查，不将失败轮记通过。独立审查提出的证明/权限/空间/竞态意见均由作者修正，待最新复核。真实生产最新停写备份、隔离恢复和加密离机尚未执行，不使用旧REL04证明替代。

新增分段正式接线：Nginx公网allowlist仅增加gallery/configuration两个GET/HEAD子路径，尾斜杠规范保持；员工activity/raw原档仍不公开。独立审查发现新路径没有归入原public-api入口桶，已同步窄扩分类，原12r/s/burst24与连接限额保持。首次路由6项通过；新增限流轮7项有1项夹具混入其他状态，修正合成Unix上游backlog5为64（生产限额未改），单项复查与最终完整7项均通过，最终14.198秒。fixture专用响应头观察真实family/limit状态，16并发80请求命中429 public-api/REJECTED，伪造XFF不分桶；无公网监听且测试随fixture退场。

加密工具14项最终版本已独立复核PASS（报告encryption-pre-review.json）；另在目标Linux OpenSSL3.0仅加密合成材料，严格SSH传回Mac，用未上传的私钥实际认证解密，6文件内容与权限/UID/GID核对成功。cross-platform-crypto-proof.json明确syntheticOnly，无真实备份转移或生产DB/服务变更；正式最新快照仍待发布时执行。
