# OPS-UX11 / 七类隔离组合验收

日期：2026-11-13（Asia/Shanghai，测试跨午夜）。状态：待PM核对；本机隔离结果，不是当前服务发布。

## 精确组合与范围

- API来源fe2ba4a6841a9f941cbe17467d4b1e4a772ccf93，OPS e502d1e接入并build；合同树57e403827125c491aca57d5d36afdee2293f3f3a，17条迁移。OPS OpenAPI重新生成与BE产物逐字节相同。
- AD应用f0c9a0ce351b1088d64b833668a126f60d4c0812，OPS自有提交映射2764a62；40来源对象、4冻结成品、7证据和archive摘要逐项核验。最终manual测试来源49365954339b349e36abdf7747c2de89a0ce3aa2，3对象及准确SHA独立审查匹配；应用src/JS/CSS不变，不重建应用。原OPSGit测试仍f0，实际测试493以私有Git对象派生副本与指纹单独绑定，不混称同一测试SHA。
- FE来源自有4b47ba6e与634f0076d402e9de394a8ecbb77d7fa269d2ff8b，OPS映射0806765/f8a59f9；使用冻结BUILD QNy1Vuio-IAGcY8SyY6TP的独立运行副本，不重建、不污染原成品。构建后仅末尾LF差异沿原核验说明，不能声称由最终源码逐字节构建，仅本机darwin/arm64 Node24。
- 唯一新随机hd_ux11_trial_<16hex>空库，仅合成车辆/真实本地媒体和新测试admin，不复制/导入现有20+200。显式17迁移、同进程provider disabled、实际配置小时字符50000，无真实Ali key继承/注入。API/FE/代理只用私有Unix sockets，无额外宿主TCP/Docker。浏览器/直接API请求均强制UDS，站外阻断，无TCP回落。

## 实际方法与分轮结果

原AD run-live、3319/3322随机库及付费/限流守卫均未修改或执行；OPS复用业务断言副本，单独严格随机库/私有通道身份校验、虚拟同源、故障route fallback和私有截图输出。不能把本轮结果写成原guarded命令通过。原限流保留，等待真实Retry-After窗口，无业务写自动重试，所有轮次retry0/skip0/flaky0。

| 轮次 | 对象 | 实际结果 |
| --- | --- | --- |
| attempt1 | 原七例，测试f0 | 3通过、4失败 |
| attempt2 | 明确复测facts/八图/私图，测试f0 | 2通过、1失败 |
| attempt3 | 仅manual，测试493 | 1通过 |
| attempt4 | 仅同版FE私图，测试493 | 1通过 |

最终按唯一类别汇总七类均通过：会话/草稿隐私/退出、demo字典搜索首页批量、disabled计划取首轮；facts多语快照与八图删除恢复取第二轮；manual取第三轮；真实FE私图取第四轮。首轮及第二轮完整JSON/log/截图/trace/源副本保留，不加总成新的无失败全量测试。

失败及复查：首例OPS预建媒体目录0755被API拒绝上传503，仅修测试目录0700；manual旧断言寻找禁用输入，而当前dirty guard不渲染输入，AD测试493经同一Reviewer改核警示/禁reload/无输入和生成/零翻译请求，并明确单PATCH保存、版本+1、新source与stale/旧公开不变；八图DELETE的OPS Node转发漏正文长度，独立UDS echo证实13字节→0，修按Buffer字节设置Content-Length后删除/恢复断言通过；私图首两轮业务已完成但page.close开始后的回包抛重复处理错误，trace证实close先于回包，窄修仅明确请求关闭的同一页面加已handled/closed错误才记取消，活页错误仍失败，第四轮无活页传输错误。未丢业务断言或放宽真实FE decode门槛。

实际facts保存验证新ref由服务端派生、两版本前进、英俄可缺失、旧公开值不变、补译并真实预览重新发布后更新；并发/故障原子回滚专项沿BE29受审证据，本轮未重跑整个SQL套件。私图覆盖401/403/500/abort及第二图故障，10个新load，旧load/resize不解锁，成功真实decode才确认/发布各1次。API fetch站外尝试0、generate POST0、旧suggestions POST0；不是免费或真实翻译质量证明。

## 证据、审查与资源退场

私有总索引docs/private/ops-ux11-runtime/seven-case-result.json，attempt1..4报告/trace，七例执行矩阵与交付/源对象索引在docs/private/ops-ux11；预启动、AD493适配、两次传输修正均由独立Reviewer只读审查。最终实测/清理证据再交Reviewer，最终绑定结果另存私有记录。

最终只读导出合成业务表（排除staff/认证表）和媒体hash，保留失败状态与最终数据。随后按登记PID+启动时间/command精确停止owned API/FE/代理，确认停止后删除创建证明同名唯一随机库，3 sockets移除；合成临时认证文件退场，私有合成媒体留作证据。未停任何现有服务/依赖。现用10控制文件与49媒体目录文件hash一致（49是目录文件数，不冒称49业务图片）。退场后真实3363五页GET均200，220唯一=20员工精选+200外部；ready/官网200，HTML仍旧BUILD zSwZ3nDKaAyo6SJgOgfrD。未重导、改现有账号、恢复Ali、切换入口、推送或部署。

## 交接与未覆盖项

交PM按准确组合核对七例证据与facts P2闭合，业务/视觉确认仍归用户。本轮未做真实收费生成、真实译文质量、重启预算/receipt恢复或真实归档补标记；不据此放开Ali。500字符合成收费限额不入业务默认，费用/免费余额unknown。自动审批曾拒绝切换/恢复协作指令，本轮严格仅执行隔离授权，不换渠道绕过；当前3363与Ali配置保持，无切换或恢复授权。
