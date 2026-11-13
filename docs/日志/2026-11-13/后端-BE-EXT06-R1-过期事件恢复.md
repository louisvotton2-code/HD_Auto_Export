# 后端 / BE-EXT06-R1 / 过期事件恢复

日期：2026-11-13（Asia/Shanghai）。范围为 OPS 组合独审发现的 worker 恢复 P2；独立 BE 工作树基线 `44bbcddc83efb837370c66473fdbd22662a0b346`，对应 OPS 组合 `d8ce134` 的 worker／测试文件已核对无差异。根脏树、3363、生产和真实车源不修改。

## 问题与修复

只有初始快照的独立来源身份，其 business_order 为0。随后 order100 增量详情连续 notFound，三次补全机会耗尽；较新完整快照恢复后 business_at 已更新，order 仍0。原待处理SQL只按顺序号及撤回状态放行过期事件，遗漏业务时间规则，导致旧增量无法补全、也无法按obsolete归档，任务永久pending。原测试继承此前身份order101，掩盖了这个分支。

修复仅让选行条件与既有obsolete规则一致：首个event文档的sourceUpdatedAt，缺失时用observedAt，按毫秒与已应用business_at比较；同顺序号的旧observedAt也可归档。保留快照验证、撤回优先、详情补全、lease/fence、连续checkpoint及事务规则。当前或更新的未补全增量仍等待详情，没有把notFound当撤车或扩大固定名单。无需契约、数据库迁移或依赖调整。

## 验证

- 开工hooks核验通过。先添加独立身份125／126回归，旧代码实际失败 `processed: 0 != 1`，原日志保留。
- 新场景覆盖初始快照order0、假供应商三轮notFound共9请求、重试耗尽、较新快照恢复、旧增量归档并完成checkpoint；分别验证观察时间回退及晚收到的旧sourceUpdatedAt。身份顺序号仍0，归档不覆盖新快照，不再发网络请求。
- 负向断言：同时间／更新的未补全事件继续pending；同order旧观察时间可归档，但不能越过前面仍缺详情的事件完成任务。
- `node --import tsx --test test/ingestion-worker.test.ts test/formal-ingestion.test.ts src/external/ingestion.test.ts` 21/21通过（10来源任务单元、10worker PG含父测试、1正式投影PG）。API typecheck、build及差异空白检查通过。
- 自测使用本机随机隔离PostgreSQL库，结束清理；供应商全为假响应，没有新增真实请求或业务库写入。证据位于工作树忽略目录 `docs/private/be-ext06-r1/`，旧代码失败 `regression-before.log`、修复 `targeted.log`、`typecheck.log`、`build.log`。

## 交接与边界

实现者自测后经独立 `/root/backend_review` 复查通过；审查者另运行10项假供应商单元通过，未执行PG或生产。报告与最终追加提交绑定于 `docs/private/be-ext06-r1/review.md`／`review.json`；完整SHA及集成提示追加到共享 `docs/private/pm-ext06/BE-handoff.md`。OPS原始问题由其组合独审发现，新增回归不以原组合通过替代本次验证。

本轮只保存本地追加提交，由OPS集成并重新核对最终组合版本。BE未执行推送、全仓verify:push、生产导入、部署或切换3363；之前300真实包隔离演练属于OPS证据，不写成本次BE执行。
