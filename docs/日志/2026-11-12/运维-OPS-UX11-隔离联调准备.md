# OPS-UX11 隔离联调准备

2026-11-12（Asia/Shanghai）。本轮只接冻结合同和准备联调/回退材料，未启动候选、迁移或切换3363。

## 精确版本与本地接入

- 稳定共同基线 `codex/ux11-base` / `7d282eb7e4fed97f7dbb87644aca072df21ef0c8` 保持固定、工作区不改。
- OPS独立集成分支 `codex/ux11-ops`，持久工作区 `docs/private/ops-ux11-worktree`。
- 仅从新合同 `2e1c1913d4f26b24f27e5709e1dd24b5194ad12e` 接入18文件，本地合同提交 `0ca54bcb624c1bbc1bd5e8d182ca189bcb35abe0`；原BE父链不重复挑。raw binary patch与1bbe→2e逐字节相同，contracts树 `ab25dfd5a9e57048569148206358d60eb94ce949`。
- apps/api、apps/admin、apps/web及根包、锁、workspace、scripts、AGENTS、CI均保持7d原字节。2e只有合同/schema/fixtures/tests和三文档，不是API或迁移实现。
- 当前3363仍为ADUX10已交付组，原账号/数据维持；翻译disabled，真实翻译/供应商/报告调用0。不推送、不连接生产、不建号或改密。

## 已执行检查与独立审查

新OPS工作区hooks核对通过；离线frozen依赖准备0下载、锁不变。`pnpm --filter @hd/contracts check`通过（类型、构建、76测试/0失败/0跳过）；`pnpm check:workspace`28测试及478代码文件静态边界通过；差异空白和来源映射核对通过。未运行旧应用的整体类型、应用构建、DB或浏览器验收，跨消费者和路由实现仍待对应角色交付，不能据合同测试声称新端点可用。

独立Reviewer `/root/ops_ext_review` 已核18文件原补丁完整性、保护/锁/应用不变与上述日志，无阻断；本地提交和后续纯文档HEAD按实际索引/差异及源码不变证明绑定。原合同设计沿用BE/PM的冻结审查，不以本轮OPSintegration冒充API实现审查。

## 隔离资源与启动门禁

详细方案、非可运行的候选模板、接口运维清单及独立审查摘要在忽略目录 `docs/private/ops-ux11/`。模板readyToStart=false，三端应用SHA、FE BUILD、AD资产、API迁移/journal/OpenAPI与fake seam均待准确候选，null不作确认值。

复用现有2个依赖Docker和私有PG UDS，不建成批容器或数据库宿主端口。完整副本使用新随机 `hd_ux11_trial_<16hex>`，源动态取当前运行交付库（现15条），只读一致性快照和独立媒体，账户副本/测试认证严格隔离。默认API/FE/同源网关仅Unix socket；浏览器强制隔离重路由，无TCP回落到真实3363。若新AD原runner必须使用3319/3322，保留随机空库保护，OPS仅在受审排他窗口提供3491且固定API目标3322，结束后核库/会话/端口与精确进程身份清理。此刻资源未创建、端口未租用。

## 待候选联合验证

| 范围 | 门槛 |
| --- | --- |
| 迁移/旧数据 | 现15条精确hash→候选journal实际条数，显式迁移可重放；全原表原列、staff/auth、发布/本地化/首页/媒体保持，旧无配置公开快照不回填或追溯下架，原库只读 |
| 配置/bundle/preview | 统一200项/name100/value500/总16000 UTF-16及65536 UTF-8原JSON限制；验证与parseVehicleDraftWrite canonical存储分开，遗漏保留/空清除；公共与私有配置共用展示schema，真实语言/数字单位/ID不漂移 |
| 发布跨页 | 去逐字段approved但仍三语完整/非stale及最新预览确认，machine/pending保留，库存/权限/版本/指纹/幂等不撤销；配置/译文/换车/旧loadId/跨页返回不得复用旧证明 |
| 费用取消/未知 | 创建plan/GET status/取消/无明确确认等0fake调用；本版cost只能unknown，amount/currency/免费额度均null，不能写0或免费；acceptUnknownCost和maximumCharacters须显式匹配原计划 |
| fake执行/恢复 | 不注入真实Ali key，仅BE受控fake seam；持久预算预占/结算、并发、缓存、幂等、部分失败、outcome_unknown和分段复用；只读状态/重放不新增调用或重发POST，按持久结果重建completed/partial，finishedAt可null |
| 历史/报告（正式3a，实施待候选） | 0/null、false/null及缺陷/历史含义保持；最新用户改为公开API/SSR/鉴权preview零源报告URL，已知有报告只联系销售。后台同车安全来源URL有按钮、无URL无按钮，安全新窗口；unknown不阻塞，不自动核正文/新域，不改真实来源数据 |

当前代理通用读取超时30s，与新generate120s聚合预算/AD150s请求需在候选按路由同组对齐，并禁代理/客户端POST重试；本轮当前配置未改。最大合法三语bundle需核实际UTF-8字节与API/Nginx/client上限，不截断；默认限流保持，用真实reset在用例/完成阶段等待。

## 数据保全与回退

UX11的源/写前回退点是届时最新冻结的当前交付库（现15条）及媒体/认证/应用配置，不是早期14库，也不是任何trial。旧14仅历史保存，不能覆盖当前15的合法新写入。

等新三端精确组合、迁移/fake预算联调及独立review通过、PM明确同组放行后，才停写排空、重新备份最新当前库/媒体/配置，恢复新交付副本并仅新库迁移，三端/合同/私图/SSR UDS和持久入口同组切。新写入前失败成组回冻结当前15；开放后（登录/会话也算）先维护停写并排空，再完整保全新库/媒体/配置及计划/分段回执/预算/幂等/审计，之后修复，不旧API接新schema、不以旧快照覆盖新写入，不延长已过期确认或声称失败未计费。

Ali恢复与AD一次确认/BE预算/新组合同组，非秘密账户站点与余额未知如实提示。未调用真实Ali、供应商账户或报告站；0资源执行与不代表运行放行的边界已写入模板。当前任务完成后继续等待候选，不为准备方案提前启服务。

## 最小状态合同修订与最新报告方向

仅接入四文件最小补丁`56beaba64ee80c6989322e90c12a823a20c1570e`（实际父97cc，但不挑该父链），本地合同提交`27e9edad700fd83310d9947c3bce1e71f199f4a2`。raw patch与原56逐字节相同，当前contracts tree为`d5187a28cfd5371165090207907ba342a9c9b85d`。`pnpm --filter @hd/contracts check`类型/构建及77测试通过；初始2e的76和28边界记录保留各自时点，不混称新增全量验收。应用/迁移/根锁未变，当前7d共同基线仍固定。

completed/partial均可finishedAt:null，表示租约中断后只读重建结果、未持久化final回执；按state/result处理，null不表示未收费，GET不外呼、不能自动POST重试。新增422 TRANSLATION_CONFIRMATION_REQUIRED（旧suggestion新请求须plan确认）与TRANSLATION_FACT_MISMATCH（配置译文改变事实token）纳入候选矩阵。

用户最新报告决定取代原自动正文可用性门禁：公开已知有报告只提示联系销售，公开API、SSR/序列化与鉴权preview连嵌套inspection.reportUrl/reportAccess.available.url也不能泄露源URL；后台原权限下仅同车真实安全来源链接，有URL才有按钮，target=_blank且noopener noreferrer，不要求available、不声称正文已核验。false/缺失不是断言不存在。真实0available/19unknown保留历史但不阻塞本轮，PA停止新域请求，OPS不探外网。

正式3a已冻结公开/preview vehicle.report?:{hasReport:boolean}，后台report另带安全HTTPS url|null。OPS按准确八文件补丁接入，不凭口头形状改schema；候选模板仍ready=false等API/页面/迁移/fake seam。旧2e+56四态合同保留历史，当前公开兼容字段只unknown/null，内部证据四态不作为入口前提；仍不能把schema通过当新公开投影已实现。三端应用/迁移/fake seam最终候选仍待准确版本，同组验收后才另请PM切换，当前3363/账号/数据/disabled翻译保持。

## 正式报告合同接入与当前终态

仅挑`3a0681b5822b60b3fa8c863bf4c1bb32af2e6109`的八文件，不重复旧链；本地合同提交`4ea2694c6c60fb51489ba16d8ee1561810e20a89`，当前contracts tree为`57e403827125c491aca57d5d36afdee2293f3f3a`。原补丁逐字节一致，应用/迁移/根锁/保护不变。契约类型/构建及78测试、workspace28/478代码文件边界通过；原76/77记录保留，不合称新增全量。精确挑拣与private准备方案独立review通过，最终文档HEAD另绑定，不新增运行测试。

PublicVehicle/PublicationPreviewVehicle.report严格仅hasReport，拒任何url；AdminVehicle/ExternalListing.report允许true+url:null，非空URL必需true，后台不拼缺失URL。公开旧inspection.reportUrl固定null，reportAccess仅unknown且url/时间null，内部证据四态不接公共DTO。列表/home实际投影需省略report；公开API/SSR/鉴权preview零源URL与后台同车/权限/安全新窗口、无URL无按钮都待候选实际回归，不能由schema测试替代。

稳定共同7d、根dirty/main及当前3363/账号/数据/翻译disabled均保持。OPS只完成合同和隔离准备，尚无三端完整候选、API新迁移或fake seam冻结，不开库/端口/服务、不提前切换、不付费smoke。当前准备文件与非可运行模板在docs/private/ops-ux11，旧15库为未来冻结源，旧14只是历史；新写入后先维护停写排空、完整备份新数据再修复。

## FE与BE最终候选登记（AD尚待交付）

FE来源HEAD `634f0076d402e9de394a8ecbb77d7fa269d2ff8b`，自有提交仅`4b47ba6e0c4aba85a26e8545ed1a296510545209`及该HEAD；BUILD `QNy1Vuio-IAGcY8SyY6TP`，合同树57e403827125c491aca57d5d36afdee2293f3f3a。OPS核441份最终源码与Git对象、准确SHA独立报告和全部清单；standalone1836项（1807文件、29相对内部链接）、static35文件、public69文件逐项hash/尺寸/链接与聚合hash均匹配。完整standalone保留链接复制至独立release，附带static/public再次核对；未重建、未启动。只用于本机darwin/arm64 Node24，不作Linux成品。

构建源码与最终源码仅vehicle-inspection.ts移除一个多余末尾LF；补回LF可重建构建时hash。记录同时保留构建/最终源码聚合指纹与差异，不能声称产物由最终源码逐字节构建。862单元/7边界、最新report-policy78 Chrome及12截图为FE交付证据，OPS本轮未重跑；旧119/123不是此版报告政策计数。FE源码自有提交尚未挑入OPS分支，本轮只保存成品和来源。

BE来源`0540d6bcc40ec26048a31e2eb9cdac6becd37132`，仅该37文件API补丁挑至本地`cb64caa61448562a0ea68f2fabfa44020a73e06c`，不重放共同基线/合同旧链。原/本地binary patch逐字节一致，122验证文件、40受审文件均与准确来源Git对象相符；37变更全部被审查覆盖，合同树仍57e4038。BE报告准确SHA独立PASS、188单元/167数据库（全15文件、0skip/0cancel、随机库0→0）、contracts78、类型/build/OpenAPI/workspace通过；OPS本轮未重复这些单端测试。

迁移journal SHA256 `536c0a2de725960d68cf0c8f0d6d244c9f85ec557003d67824eef5368faa7bd3`，目标17条，前15项不变；0015/0016分别匹配`3edfb835ac8c20be39c5fe112bc4c5d90d5a044053448ee4e4abbddcd9587a9a`、`57f91f71d654a82ab8c777532535cc383ce1ae2336f5ad34bc0afc6a3886a0d8`。两份均为ready依赖，即使external关闭；此处仅文件核验，未迁移。OpenAPI是忽略的生成产物，另存副本/hash，尚非Git对象或OPS重生成相等证明。

受控fake seam参考BE translation-workspace.test.ts的buildApp/VehicleTranslator注入；真实Ali配置不注入。小时字符/两并发仅单API进程边界，仍须隔离核持久预算/receipt与重启恢复，不宣称分布式额度。受控归档补标记仅在隔离副本按明确归档行/版本/hash/有效actor执行，前后保留原事实，不重导20+200、不外呼；本轮未执行补齐，41/20/19仍只是PA盘点口径。不得套用旧AD审核选择器，等AD本版live适配。

私有交接：docs/private/ops-ux11/FE候选核验.json、BE候选核验.json与ops-ux11-candidate/candidate-state.json；独立release分别为fe-634f007和be-0540d6b，索引/审查证据副本与hash保留。组合合同树确认位保持null，expected57e不代替三端齐套证明；AD待交、readyToStart=false。当前3363/原账号/数据/disabled翻译未改，未建库/端口/服务、未真实调用、未推送或部署。候选登记与精确补丁接入交独立Reviewer核对后再保存文档提交。
