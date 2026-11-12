# 前端 / FE-REL-03 / SSR公开缓存与分页

2026-11-13（Asia/Shanghai）。FE实现、自测及独立预审完成，待最终提交SHA绑定和真实BE同版联调；已知P2单独接受，不视为全套验收或已部署。

## 范围与基线

- 用户在PM对话明确要求实施发布计划；FE仅负责官网匿名SSR数据缓存、受影响分页提示及确认冗余逻辑清理。PR／main／生产数据清理和部署由PM／OPS协调，不上传本地车辆或图片、不调用真实翻译／供应商。
- 从受审UX12 `b236d1e74ef6b20d25f471b0de875daaef453e02` 建立 `codex/web-release-cache`／`docs/private/fe-rel03-worktree`。旧UX11／UX12源和成品不改，根历史脏工作树保留；hooks检查通过。
- 按PM顺序先只读准备，待旧联调七类分轮通过及退场交接后推进。已采用BE受审合同 `7de8e93038665724065fa1ef8fa7a999b77cff34`（本地 `4db0b6a`）和内部协议 `735eb8fa6889bbd4109259d82e36199459260ef5`（本地 `d641609`）。只挑新合同，不引入API父链；后端摘要的上下文冲突仅保留FE基线旧行并加新REL03行，不冒称该FE工作树包含后端实现。

## 实施边界

- 跨请求缓存只挂 `vehicles/server.ts` 的SSR装配。原BFF、媒体、外部照片失败POST及员工预览继续走既有no-store链；详情原React cache仍只做同一渲染请求去重。没有给整站HTML加共享代理缓存。
- 缓存本体最多64条／16MiB，UTF-8 key与序列化Buffer计费，LRU、同key合并及有界inFlight。每次返回独立JSON副本，过期／错误不复用，clear后的旧完成不得覆盖或删除新任务。没有React、HTTP或访客上下文依赖。
- 每次SSR读取先在缓存外取当前公共版本，当前版本读取也受访客限流。静态内部服务身份读取四类公开JSON；可信访客IP只给版本读取，匿名loader不携访客IP／Cookie／Authorization／动态headers。完整schema验证后先剥requestId，再进入缓存；外层补当次requestId。
- key按部署环境、发布版本、API origin、实际规范路径／筛选／排序／页码、语言／价格模式及公共／汇率版本隔离。DTO版本或FX身份不符仅重新读版本并重试一次；错误／持续不一致503，不回退旧值。Next不同route bundle共用进程store，控制错误身份使用固定symbol品牌，避免共享flight丢失429或版本重试语义。
- 到期使用后端validUntil−checkedAt减完整请求耗时换算为本机单调期限，取本次版本期限、payload原剩余期限和更早远图到期的最小值。命中不续期；后端14秒旧值不能在前端再延15秒。没有使用本机墙钟去比较服务端时钟。
- 仅提取真正共用的HTTP JSON体积／格式检查和重复queryString逻辑；原路径、超时、凭据过滤与错误语义保留。未删除权限、撤车、预算和原子保存回归，也未重跑无变化的UX12 48项。

## 发布与私有读取配置

- 统一服务端 `HD_DEPLOYMENT_ENV`／`HD_RELEASE_ID`，不能由Host／Cookie或随机请求生成，不使用NEXT_PUBLIC。production按正式合同接受40–64位小写hex或sha256摘要，完整imageRef由OPS取digest；本地／测试也须显式固定身份。
- 内部读取按正式协议只用GET及固定服务key，API双验原socket peer与密钥，版本仍访客120／分钟桶；数据独立30／秒、burst40。早期WebIP120／分钟聚合方案已由正式服务协议替代，FE未自行造豁免头。
- 仅从明确绝对私钥文件读取32–256个ASCII可见字节，regular／owner-only／512字节限制、不跟随symlink、去一个尾换行；不回显文件路径或值、不入cache。启动hook覆盖直接standalone，配置错误明确退出1；Next构建阶段不运行该hook。实际成品缺identity、缺secret、非法production release及非owner-only文件四项均退出1；正向启动由浏览器fixture验证。

## 分页

- 使用官方 `isPublicCatalogOffsetAllowed(page, actualPageSize)`，offset=10000允许，末个可浏览页仍完整pageSize；48条／页最多209页，5条／页最多2001页。API total／accessibleTotal保持真实值，只限制offset页数并提示缩小筛选，不裁成10000条。
- 合法超界深链返回三语纯SSR恢复页与保留筛选的第一页链接，不请求目录／facets、不伪造0结果或车辆不存在。畸形数字、重复已知参数或非法业务筛选仍拒绝。批量游标合同沿用，不扩展未授权供应商同步。

## 验证与失败记录

- 首轮类型仅两处Vitest泛型Mock签名报错，修正测试handler类型后通过；最终官网typecheck、工作区／官网边界（官网7项）和9份受影响单元149项均通过。缓存之外的既有计算器48项不重复。最终构建成功，BUILD `Gn2-2DAG9GD61KdnWEi5R`；无运行凭据也能build，实际启动必须配置。测试仅使用可清理的0600临时服务凭据和3327／3100隔离端口。
- 首次缓存浏览器12项为7过／5失败（BUILD `z7BKpnWQxATfyErYzhgQ_`）：rich fixture的future行提前发布改变索引价格；详情BFF刻意重建meta、不透传可选stamp；第一页链接规范省略page=1（三语共3项）。保留原失败并按真实口径修正断言，未放宽价格范围、版本不符重试或TTL不续期检查。stamp期限仍在列表BFF验证，详情仍验证两次回源和私有报告隐藏。
- 独立审查发现2个旧用例仍把SSR回源路径断言为public API，改为正式内部别名并校验静态服务身份及无访客上下文；客户端BFF断言维持。随后仅复查上述5项＋这2项：6过／1失败；新失败为原有无JS动态404正文空白，缓存本身已返回真正404、无旧车辆／联系／报告数据。该轮三语offset截图已人工检查，保留筛选、明确恢复入口及长俄文无裁切。
- 只读现有3363不存在车辆作为对照，同样HTTP404／no-store、HTML无main/h1、只含隐藏节点及脚本。独立Reviewer核读已安装Next16.4.2错误恢复源码，确认空errorShell依赖客户端恢复。曾最小拆分metadata/page缺车处理，BUILD `j7L9RTKTLyZ1Q4cRHQKWq` 复查仍1过／1败（相邻成功、版本故障正常）；无效尝试已完整撤回，未改Next内核、依赖、代理或现有服务。
- PM明确接受下述继承P2不阻塞REL03，停止扩大排查。最后仅在撤回后的最终构建跑拆分2项：缓存FX／发布／撤车场景通过；已知无JS404正文按expected-failure保留。`test.fail`只放在三语6个真实404、无旧title／联系／报告／车辆JSON-LD检查之后，因此前置状态或隐私失败仍会真正失败。工具汇总将预期失败包含在“2 passed”，本项目只记**1通过＋1已知失败**；未执行到的正文恢复链接不记通过。
- 合并分轮证据：新增12个缓存／分页／边界场景及2个受影响旧场景通过，另1个继承P2 expected-failure单列；不称最终构建重新跑了全部14项。149／类型／启动／主体浏览器对应未变模块，最小试改后额外构建与定向检查分别记录，不混为整仓门禁。首轮及后续失败、全部成品清单和具体测试日志保留在忽略的`docs/private/fe-rel03-evidence/`。

## 已知P2与独立审查

- **FE-REL03-P2-01：合法语言下不存在／下架车辆的无JavaScript页面可能正文空白。** 真HTTP404、no-store且无旧车泄漏；正常详情与版本／网络故障仍区分，错误不缓存。负责人FE，**正式运营前修复**；PM于2026-11-13明确接受仅作为本轮缓存候选的非阻塞继承缺陷，不代表最终用户视觉验收。保留`known P2`可执行失败用例及3363原始对照，不删除断言掩盖问题。
- `/root/release_cache_review`独立只读检查缓存、正式HTTP身份、schema／隐私、TTL／跨bundle错误、分页、启动和受影响旧断言；指出Next可能吞启动hook异常，已通过显式退出和4项实际启动检查闭合。旧SSR断言P2修复并实测通过。除了上述PM接受项，无未处置P0/P1/P2；最终完整SHA与报告在交付清单和本地审查登记核对，不能以作者自评替代。

## 交接与限制

- 分支`codex/web-release-cache`、源／成品manifest及独立报告统一进入私有交付清单；只提交本轮FE文件与采用合同，推送前还须由集成人按最终组合执行verify:push，不把定向检查称整仓门禁通过。
- BE候选 `0265fa1b718d0434a6126ea6323559a12f79d4aa`，API／Redis／数据库、原始socket peer／网关拒绝及20并发代表性验证由OPS统一组装。FE fixture不代替真实API和目标Linux证据。
- 临时服务已结束，3363及旧冻结UX11／UX12源和成品未改；未推送、合并或部署，未上传本地车辆／图片、清生产数据、付费翻译或调用供应商。PM／OPS负责最终组合、版本门禁和切换，用户业务／视觉验收另记。
