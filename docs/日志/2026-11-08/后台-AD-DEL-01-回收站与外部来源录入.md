# 后台 / AD-DEL-01 / 回收站与外部来源录入
日期：2026-11-08（Asia/Shanghai）
状态：待验收

## 范围与版本

- 恢复用户授权的后台实施：单车可恢复删除、回收站、恢复草稿、external 来源录入和至少八张图片的来源／封面／排序体验。保留 Ant Design 工作台，不做永久清空，不导入真实挂牌。
- 分支 `codex/backend-foundation`，基线 HEAD `61dc7414b20a395d1d09e906a49d974763b3cce7`；共享工作树未提交，保留其他角色改动。仅修改 `apps/admin` 与 AD 维护文档，BE 独占 API／contracts，OPS 独占依赖安装与根锁文件。
- 既有 3318 预览和 3320 API 保留；所有自动化业务写入使用 3319／3322 与独占 `hd_admin_test_*` 数据库，不改 PM 的 HD-000006／007 等记录或首页配置。

## 实际变更

- 独立回收站路由 `/admin/recycle-bin`，列表显式请求 `deleted=exclude|only`；回收站不请求媒体预览，不提供批量永久删除。
- 删除／恢复发送契约版本与幂等键。未知结果保留原请求和恢复入口；409 不自动提升版本；成功或重放后重新读取 `includeDeleted=true`，避免历史回执覆盖后续状态。
- 已删除详情提前进入只读摘要，恢复后采用服务端未发布草稿／库存未知状态，不自动发布或加回首页。
- external 表单按正式 schema 记录来源身份、链接与两个时间，身份创建后不可改，保留实际观察事实，只允许参考价格／待询价，不提供库存核验。
- 外部图片逐张记录原图 URL、挂牌 URL 与采集时间，上传队列冻结每个文件的来源；默认许可待核验并明确本地用途。图片继续最多 30 张，支持封面、排序和说明。
- 首页推荐和公开核验显示外部来源；推荐排除已删除记录。首页 320px 标题计数允许换行。

## 验证与限制

| 对象 | 实际结果／证据 |
| --- | --- |
| 开工保护 | Node24 `pnpm hooks:check` 通过 |
| 最终后台源码 | `pnpm --filter @hd/admin check`：类型检查、9 文件／58 单元测试通过；`build` 和 `git diff --check` 通过。日志 `/private/tmp/hd-ad-del-check-final.log`、`hd-ad-del-build-final.log` |
| 完整 UI 契约回归 | D51 成品 31 项通过，53.6 秒；`/private/tmp/hd-ad-del-ui-final.log` |
| 最终两项修复回归 | B3 最终成品定向验证发布提示、重复来源及未知重试，2 项通过，7.3 秒；`/private/tmp/hd-ad-del-final-two.log`。未把它与旧版 31 项声称为同一轮 |
| 原有真实 API 流程 | 独占隔离库下，登录草稿、manual 发布全链、demo／首页／批量 3 项通过；`/private/tmp/hd-ad-del-live.log`。该轮新增 external 场景止于测试定位器，未算通过 |
| 新增真实八图生命周期 | fresh runner 独立轮次通过，1.5 分钟；`/private/tmp/hd-ad-del-live-external-paced.log`。8 次 permit=201、content=200、complete=200；无延迟上传及预览零429。排序、封面、pending 三语、公开 reviewed=false、三语原图／thumb、首页引用、删除取消／确认、普通／公读／图片404、回收站、恢复draft／unknown／8图保留／不自动公开或加回首页均验证 |
| 独立审查 | `/root/backend_foundation_review` 完成本轮 AD 限定源码复查并读取对应 QA 日志；QA 提出的两项 P2 均修复并独立复查关闭，未解决 P0/P1/P2 为0。不是全分支／API审计或生产验收 |
| 实际保留环境只读 | 3318 与 3320 最终HTTP200。root只读列出PA新增8条 external 的图片计数（合计71），实际目视 HD-000015 九图，1440px有9图成功加载；320px document/body/viewport均320。首页两个计数标签完整位于标题内，原P3关闭。`/private/tmp/hd-ad-del-readonly.log`，脚本无业务写请求 |

首次 check 的卸载清理类型错误已修复后重跑通过。UI 初轮25过／5失败、定向9过／1失败分别为图标可访问名称、弹窗关闭动画、已有路由权限及首次明确401测试预期适配；修正测试后31项全过。真实 external 的初次币种／封面定位器失败已修正并重跑；这些失败记录保留，未当成API或产品回归。受限环境的服务监听 EPERM 通过授权执行解决，未改依赖或限流阈值。

八图生命周期中的大量只读校验累计超过120请求／60秒，服务返回429。测试仅对GET作最多5次、以Retry-After为下限的指数退避（5.25／10.25／20.25／40.25秒），最终所有状态断言通过；未知写不自动重试。BE现有错误处理把429 Retry-After统一写5，短于实际窗口，需BE后续改善；不影响本轮正常单次八图上传证据，不把测试退避当成生产限流修复。

QA `/root/delete_qa` 目视真实隔离截图 `external-published.png`、`deleted-readonly.png`、`restored-draft.png`。其中发布截图属于修旧提示前的历史成品；最后提示修复以B3定向测试为准。root目视实际九图桌面、320px首图及首页计数截图，均在 `/private/tmp/hd-ad-del-evidence/`。没有在共享试用库保存、删除或恢复车辆；PA／PM自己完成的数据变更不计入AD写入。

两项本轮P2修复：

1. 编辑器 `accept()` 清旧保存成功提示，发布／恢复后不再残留“尚未发布”；保存流程在accept后继续设置正确的新提示。
2. 首次明确409 `SOURCE_IDENTITY_CONFLICT` 释放创建意图并保留表单，允许纠正身份后新key重提；`IDEMPOTENCY_CONFLICT`、已有未知结果后的409仍保留原意图。

真实挂牌内容、来源许可、三语文字及最终视觉由PA／PM／用户验收；AD测试只用隔离合成图片与example.invalid，未把Agent校对当人工审核或商业图片授权。3320新服务已由BE迁移切换，AD未启动或重建该共享服务。

## 最终冻结

算法：各目录内递归取全部文件，按仓库相对路径排序；向SHA256依次追加 `路径UTF-8 + NUL + 文件SHA256的32字节原始digest`，无额外尾NUL。root、QA、独立Reviewer复算一致。

| 对象 | 文件数／SHA256 |
| --- | --- |
| `apps/admin/src` | 42／`e2dc8b0d908cd44eab333c654e1b00772c7212d39728bfbca6b2676be2282787` |
| `apps/admin/tests` | 7／`ef9db71794caa605e4efd37c6ee77357e118b78554d90ddbbe541ed405d3f819` |
| 最终JS `index-B3ybEuUN.js` | `f5bd206855954ef4728bffa4768dd609efa60f02838f63829d2d7c836e849133` |
| 最终CSS `index-Q6WKOyuw.css` | `35b139ca3a05abd47e64e76aea0ebdc2b5bbf9be32cd1236b96c6813bdc6264c` |
| 最终 `dist/index.html` | `fa88c7857ec2698640261fc80d849e2f20b360e203e2bc1423674520247b12d4` |
| 旧版31UI／真实联调JS `index-D51x34sI.js` | `9c81d99f18330c66a10b1b059101c5d382063b3ef9934ba375f76401afb9759d` |

真实八图轮API产物：app.js `50720ae3626aed56c113594de639d4e293fcc95bb365109468581048854fd4e8`；vehicles/service.js `fd72fc885eaeb7d2481ef3e27e62322d5320053fa9e683bf04826491efe12025`；media/service.js `d196059a1047fc73b1557e51c41bef1c075a6e82079298a929a15f20360d588a`。API由BE维护，本记录只绑定本次受测产物。

## 交接

- 本轮AD实现、自测、独立复查和对应隔离联调完成，待PM／用户业务及视觉验收。客户／AI仍按既有架构后续推进。
- 尚未提交、推送、合并或部署。3318后台与3320 API保留；QA已清理自己创建的3319／3322测试服务、随机数据库和临时媒体。
- PM接收此证据后汇总总进度；OPS继续唯一维护根依赖／锁与跨端运行组合；BE跟进限流重试时间，实际挂牌内容与许可交PA／PM验收。
