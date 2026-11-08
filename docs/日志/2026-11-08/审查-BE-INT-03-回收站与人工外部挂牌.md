# BE-INT-03 后端、契约与媒体独立审查

日期：2026-11-08。审查者 `/root/backend_review`；迁移／SQL／代理只读子审查 `/root/backend_review/db_review`。审查者未编写本轮受审实现，问题交实现者修复后复查。

结论：本轮受审范围未发现仍需处置的可确认阻塞。已确认的首页 UUID 大小写问题已修复，受影响回归通过。本轮实现具备进入本地运行升级及 FE／AD 对应联调的条件；实现方随后完成的本机升级见下文文档收尾复查，不代表真实挂牌已导入或用户业务验收完成。

## 范围与版本

以 `/private/tmp/hd-be-int03-before/` 快照区分 BE-INT-03 与前轮未提交实现，审查下列 21 个文件的当前版本。Git HEAD 仍为 `61dc7414b20a395d1d09e906a49d974763b3cce7`，它不是本轮实现提交；本报告绑定下方 SHA-256 工作树指纹，后续变化须按实际差异复查。角色摘要与本轮日志仍由实现者回填状态，不纳入固定指纹。

只审 API、迁移、contracts、接口及后端维护资料；未将同时存在的 FE、AD、OPS、根配置改动计入本报告。未提交、推送或进行验收服务／数据操作。

## 核对结果

- 删除／恢复沿用员工会话、可信 Origin、版本及幂等键校验；回收站详情采用明确的字符串 true／false，普通列表默认排除删除记录。公开目录／详情／字典／首页、普通管理读写、批量操作及所有媒体入口均阻止已删除车辆继续使用。
- 删除先锁 home_config，再锁车辆，与首页保存保持一致；首页所有区块的引用、home version（仅实际变化时增加）、车辆删除操作者／时间／版本、审计与幂等结果同事务。恢复只适用于已删除记录，清除发布指针／时间与库存核验，不恢复首页，保留草稿和历史。
- 相同幂等键重放冻结的历史回执，不重新执行删除或恢复，不覆盖后续状态；旧 create／publish 回执通过 schema 补 deletedAt=null，再序列化，不改写原缓存。接口文档明确历史回执不等于当前记录，客户端应重新读取。
- 迁移约束 deleted_at 与 deleted_by 同空／同非空，操作者有外键；external 的平台 ID＋外部 ID 唯一索引不以删除状态过滤，回收站仍占用来源身份。服务在锁定车辆和版本检查后拒绝来源类型／平台身份变化，重复身份按索引名映射 409 SOURCE_IDENTITY_CONFLICT；journal 顺序与标签一致。
- external 可保留上游观察事实，价格只允许 reference／on_request，库存始终 unknown／null；单条和批量库存操作拒绝。三语发布要求当前、非空、非 stale，original 必须匹配原文及基础语言；公开 reviewed 始终 false。manual 的库存、所在地与 approved 门槛保留。
- 外部来源公开投影只包含 kind、platform 和 listingUrl，采集／更新时间按约定映射；externalId、图片证据、供应商联系方式、内部文本／引擎版本不公开。来源 URL 严格验证原字符串且不执行远程请求。每张外部图片必须记录同一 listingUrl 的来源；unverified 图片发布例外仅供 external，manual／demo 仍拒绝。
- 媒体逻辑撤销与物理清理分开。物理阶段重新锁定非删除车辆、媒体行并复核引用，持有车辆锁直至本地文件删除结束，避免候选选择或逻辑撤销后发生车辆软删而丢失回收站文件。数据库／文件失败可重试，草稿与不可变历史引用继续受保护。
- 缩略图仅从本机不可变处理图生成，宽度上限 240px、等比不放大，WebP 缓存用私有临时文件与原子替换；并发测试、原图保留、0600 权限、缓存命中、路径／符号链接检查均覆盖。HTTP 仅接受固定 variant=thumb，先校验当前发布引用及车辆状态，缓存不绕过授权。
- 公开 q 使用当前 locale 的发布标题、车号、品牌／车型名称，绑定参数并做字面匹配；不搜索草稿、其他语言或内部字段。列表、分页计数共用条件，字典使用相同 locale／q 的公开集合；分类与 q 按 AND 组合。
- TRUST_PROXY 默认 false，限定明确 IP 或窄 CIDR，拒绝过宽范围、跳数、主机名及歧义映射；Fastify 实测覆盖可信／不可信直接和中间代理。AUTH 身份仍使用验证后的客户端 IP；本轮未核验 OPS 的实际代理服务。
- 就绪检查验证新增 deleted_at 字段与首页初始行，避免仅保留旧 home_config 表的未迁移数据库误报可用；存活检查不依赖数据库。

## 已修复问题与复查

P2：首页保存接受合法大写 UUID，但公开首页原先以原输入字串查找 PostgreSQL 返回的小写 ID，导致条目被静默过滤；跨区块使用同车的大小写变体也会误算去重数量。实现者现在在保存时统一小写并去重，公开读取兼容旧配置大小写，同区块大小写重复由契约拒绝。集成测试验证同车跨两个区块以不同大小写输入后正常展示，再删除时移除全部引用；新增契约断言通过，问题关闭。

建议补充的图片依据回归也已落地：manual 和 demo 使用 unverified 图片时发布返回 422，且不产生发布快照。该测试独立复跑通过。

## 审查方实际验证

使用 Node 24.19.0，未安装依赖：

- `pnpm hooks:check`、受审范围 `git diff --check`：通过。
- 当前构建产物的 `node --test tests/contracts.test.mjs`：32 项通过；首页大小写契约补丁及实现者重新构建后再次执行，32 项通过。
- `pnpm --filter @hd/api check`：类型检查与 27 项单元测试通过。首页／就绪检查最终修改后额外执行 API typecheck，通过。
- `pnpm --filter @hd/api test:integration`：当时全部 35 项通过，包括软删恢复、外部来源、公开搜索、6 项媒体并发／清理专项及既有登录、发布事务和库存回归。
- 最后新增首页大小写修复、就绪检查和图片依据测试后，独立执行 `node --import tsx --test --test-name-pattern='fresh API instance|vehicle recycle bin|unverified image rights' test/integration.test.ts`，3 项受影响场景通过。未把这次定向复测写成独立完整 36 项重跑。

首次完整数据库执行因本机连接权限 EPERM 在 before 阶段失败，未进入业务测试；经正常工具权限审批后，仅使用现有测试创建／清理的随机本机隔离数据库重跑并通过。没有读取验收凭据、访问验收业务库或修改既有车辆。实现者的构建、OpenAPI 及最终完整集成检查另见本轮日志，不冒充审查方重跑。

## 交付限制

尚需完成 FE／AD 新增功能的消费联调与真实资料／图片内容验收；本机升级执行状态见下文。未执行浏览器验收、生产部署、远端 CI、供应商接入、自动抓取或自动翻译。外部挂牌与许可待核验图片不代表自有库存或商业使用许可；该约束在消费者文档中明确。审查范围结论不保证不存在其他缺陷，后续源码变化须复查。

## 文档收尾复查

实现方于代码审查完成后更新了车辆接口第 10 节首段、后端角色摘要及本轮日志。审查方只读核对，确认来源／字段契约未变：原 21 个指纹中其余 20 个受审文件完全一致；唯一变化为接口文档首段将“服务实现与验证进行中”更新为实现、自测、独立审查通过，并链接本轮日志。以旧首段替换当前首段后，文件 SHA-256 精确匹配原受审指纹，确认无其他接口文档差异。下方及配套 manifest 已更新此 1 项文档指纹。

角色摘要及日志保持 BE-INT-03“待联调”，明确 FE／AD 新增功能、真实资料和用户验收仍待进行；外部挂牌须等待新版 FE 运行兼容后再安排公开发布。文档没有把本地迁移／核验写成生产上线、自动来源接入、实际库存确认或恢复演练。

17:32:46 的私有备份、0002 迁移、专属 3320 重启，以及 7 条车辆／首页 version2／6 个现存媒体前后指纹一致、HD-000006／007 各 version6、17:34 的 43 项本机核验均由实现方执行并记入本轮日志。审查方此次仅核对文档及文件指纹，没有重新运行这些检查，也未读取凭据、备份原始数据或操作验收库。升级脚本此前经过独立只读复核，等待端口释放及备份比对补丁已确认；这不等同审查方执行了实际切换。

## 工作树指纹

- `apps/api/src/vehicles/service.ts`：`a6375a22d799ab8e47539d02749691ee45def356f70c88a7e9816ad0861802c3`
- `apps/api/src/app.ts`：`bdb87c4a37a7ad05a694111dfdcb367d19628dadda7780b41f98896d95db5700`
- `apps/api/src/config.ts`：`12ed594886acff3cf1aeaedff72d0891705a969194eedab8c4b4b6cee9d1033e`
- `apps/api/src/config.test.ts`：`4bca85bde34958efd8dc0d430636908fe5b0bc548daa315e31b19ee0dbd8cada`
- `apps/api/src/media/service.ts`：`ac539c730eeb977e432e39ff6161f2d10b41c4fa2fb21e49455e590fb4d838de`
- `apps/api/src/media/storage.ts`：`6f596088c2277d17dc0ca66cdad25b93e126949896f216d19f461a5c8cdccf9f`
- `apps/api/src/media/storage.test.ts`：`466501fe975a0aa1adae4b77be32623280139c4d347e607217ac104681f38ec2`
- `apps/api/test/integration.test.ts`：`5caf321fe38b5ba233a466d8493d5ce727131e42c0919e0928c3391215116c27`
- `apps/api/test/media-softdelete.test.ts`：`361237903a98f4579203b9d06735bce35bcee16acb314fae4db46fa036e2376a`
- `apps/api/migrations/0002_vehicle_recycle_and_sources.sql`：`6fe0b4f014ec75a9be2eb1035f86b471232069ae5d6b3729b30ad739ac0dda2f`
- `apps/api/migrations/meta/_journal.json`：`43c0a343a2752ecab7910623dadbdc372f87e94f6b271da2899dd4b9fb6ae031`
- `apps/api/.env.example`：`dccd2b91a64ccf4d5a133236daa084ff348452a33c21b4b1062c5ad86de042c7`
- `apps/api/README.md`：`737f1383e936d6396e5ec1122938f1de27b3b0a1331ca36d232727c1b3d72caf`
- `packages/contracts/src/admin.ts`：`16444854fc4b24888af1b94a178824a791fdeb6e98857802cdef0f53e48a91d5`
- `packages/contracts/src/common.ts`：`c83983efc556a161dab61611dded2d7270e4f069d96956b94823d6ec1e9c1651`
- `packages/contracts/src/public.ts`：`9cf82e7d0ea7fd06d95dea05d76fd06c1e2b120dd724d402b424694903f6a8af`
- `packages/contracts/src/fixtures.ts`：`76b4081c4ba73e8fa6fbc80ab29efd4cc23272b0d897b6b7d9d4e688124781d8`
- `packages/contracts/tests/contracts.test.mjs`：`c674f67d8d36ddfd27383467d2140a80cb1b4a8c3b0845ac0d3fe4a8c83386b1`
- `packages/contracts/README.md`：`c12041ed2a527929cb91e9d27f60c4674db6e45afa90067ca265773d960098cd`
- `docs/开发/车辆接口.md`：`7da98ceed7b295d38d2d84bf633d553c069d589a9ff5da379beff21bc94d593e`
- `docs/开发/后端架构.md`：`fdffbcd65b0e4aaa54d7281471373479835bd7e0237a8cf8016ca0e35144e45e`
