# BE-INT-02 后端与契约独立审查

日期：2026-11-08。审查者 `/root/backend_review`；批量事务／字典只读子审查 `/root/backend_review/db_review`。审查者未参与本轮受审代码编写。

结论：本次范围未发现未处置的可确认阻塞问题。新增批量操作、管理字典和明确 demo 展示规则具备本轮本地后端验收所需的实现与回归证据。此结论不替代 FE/AD 界面验收或内容许可确认。

## 受审范围

本轮增量以 `/private/tmp/hd-be-int02-before/` 内 BE-INT-01 源快照区分，核对当前 `apps/api/src/vehicles/service.ts`、`app.ts`、`test/integration.test.ts`，以及 contracts 的 admin/common/public/fixtures、契约测试、README 和车辆接口文档第 9 节及相关同步内容。前轮已通过的 q 搜索仍保留，未重新记作 BE-INT-02 新功能。

当前实现未提交；已有 Git HEAD `61dc7414b20a395d1d09e906a49d974763b3cce7` 不是本轮实现提交。审查方保存了下列 10 个受审文件的 SHA-256，后续变化应按差异复查。没有审查或修改其他角色同时进行的根文件、AD 或 FE 变更。

## 核对结果

- 管理路由仍受员工会话与可信 Origin 保护；bulk 必须提供幂等键，输入范围 1–50，UUID 大小写变体按重复处理。
- bulk 固定使用员工＋vehicle.bulk＋key 的幂等范围，完整请求含操作类型及输入顺序参与 hash。锁定现存车辆时按 UUID 排序，业务结果保留输入顺序；数据库事务保持 READ COMMITTED，使等待幂等锁的请求能读到前一次提交。
- 仅存在性、版本和 demo 库存限制作为逐项业务失败；SQL、审计、输出结果校验异常发生在逐项 catch 外并整批回滚。成功行与冻结的幂等结果在同一事务内提交；紧凑结果不缓存完整内部草稿。精确重放不会覆盖后续库存状态。
- 库存与下架复用单车的事务内更新 helper。demo 库存写入始终拒绝，下架允许；未选中行不变。公开库存与图片访问继续依据当前状态／发布引用生效。
- 管理字典从同一查询快照读取全部当前草稿，包含发布与下架记录；按品牌＋车型联合分组。make 仅约束返回的车型，品牌及动力计数保持全库口径；unknown 动力保留，名称选择按最近修改时间及 ID 确定，内部字段不返回。
- 创建后禁止 manual/demo 相互切换。demo 的报价、实车制造／登记／里程／所在地和 VIN 受契约限制，发布还会重新核对事实及 unknown/null 库存约束。manual 的所在地、库存核验与审核门槛保留。
- demo 仅允许当前源版本的非空 pending/approved 文本，stale、缺译及冒充原文的语言／字串均不能发布；公开标题和非空描述始终 reviewed=false。manual 仍要求 approved，公开保持 reviewed=true。demo fixtures 不宣称人审，也不创建运营记录。
- demo 的目录查询、total、公开字典、首页选择与首页读取使用一致资格；普通 manual 的目录 available/reserved 与首页仅 available 差异保留。草稿不公开，下架后目录、首页、详情与图片撤销访问。

## 审查方实际验证

使用 Node 24.19.0：

- `pnpm --filter @hd/contracts check`：类型检查、build、25 项契约测试通过。
- `pnpm --filter @hd/api check`：类型检查及 20 项单元测试通过。
- `pnpm --filter @hd/api test:integration`：23 项全部通过。
- `pnpm hooks:check` 及受审文件 `git diff --check`：通过。

数据库回归仅使用测试脚本创建、清理的本机随机隔离数据库，不使用验收业务库或私有账号。新增 6 个集成场景覆盖 demo 三语与审核标识、来源切换／异常事实、目录和首页资格、批量混合失败和精确重放、反序并发批次、审计异常整批回滚，以及管理字典全库口径。既有单车、发布快照、媒体生命周期与鉴权回归同时保持通过。

## 限制

未读取验收凭据，未操作现有 5 条样例，未重启验收服务、提交、建分支或推送。未执行 FE/AD 浏览器联调、远端 CI、生产部署或实际内容许可审核。新 demo 的资料、图片来源及公开署名需要 PM 的内容验收；本报告只核对契约与服务行为。

## 文档收尾复查

实现者完成本机服务重启后，审查方只读复核 API README、BE 角色摘要／本轮日志及车辆接口文档的状态更新。接口文档明确新增 source.kind 枚举需要 FE/AD 消费；本地端点可调用与完整三端界面／内容验收仍分别记录，未把本地运行写成生产上线。

已比对原指纹：其余 9 个代码／契约文件完全一致，仅车辆接口文档变化，已更新下列文档指纹。15:32 的直连／代理登录、新端点烟测及五条旧记录不变由实现方记录；审查方未重新连接验收库或读取私有烟测文件，没有将其计作独立执行的测试。文档收尾不需要重跑源码测试。

## 工作树指纹

- `apps/api/src/vehicles/service.ts`：`40819194b251bd5e1832e2c45fe45ce9a02263afe252e96ab43cef781eeb298b`
- `apps/api/src/app.ts`：`44fbb1feffe22cdc2b24cb7347095e3c382ba28a4d23f99ef1def89acc6721ae`
- `apps/api/test/integration.test.ts`：`584d744fc2b2733fc4b4387719056e6646e1bb030f4e02eba48c54a463ca25ac`
- `packages/contracts/src/admin.ts`：`182759ee142f7a85ea71b7984aa328cd122873f9048e979ab0bd477d4b98f849`
- `packages/contracts/src/common.ts`：`9f6508df82e74aace2a748c7cb6066b2c05068b9aa3298ac65bc5e6a8d2685a7`
- `packages/contracts/src/public.ts`：`a7e821388045fb26c23e56f9f7b3dc56abcdbc0368762f92a5021038435bc2e7`
- `packages/contracts/src/fixtures.ts`：`d780f0232c829c63acfc67e8c5937793ac0f334884b680d87c2cd7ed7bf40844`
- `packages/contracts/tests/contracts.test.mjs`：`698fadfb0298f36e16ba703ef2a8a9d6f7a63197099f8b7df95298c4b149bfd1`
- `packages/contracts/README.md`：`7ab35048d3a179e48e85557493bb93b8fef08777a589c79ba2c24b9bb75346b4`
- `docs/开发/车辆接口.md`：`b8210c5934ed5f371b905b3dda1663d3d7f2249b1251b349e41449cb83768bf0`
