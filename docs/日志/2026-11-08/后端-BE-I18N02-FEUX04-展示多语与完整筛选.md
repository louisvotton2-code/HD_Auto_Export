# 后端 / I18N02 + FEUX04 / 展示多语与完整筛选

日期：2026-11-08（Asia/Shanghai）
状态：代码、自测、独立终审及FE真实隔离集成通过；23:53 已在授权停写窗口完成原库备份、0003迁移、新3320启动和只读验收。FE已恢复独立冻结3317并完成真实12项只读观察；AD真实隔离侧表闭环1项亦通过，后台视觉收尾由AD负责。

## 范围与交接

本轮由BE唯一修改API/contracts；AD实现侧表消费者及录入界面，FE实现查询/SSR/BFF/展示消费。先完成23:04 AD-I18N01冻结切换，再串行实施本增量。保留共享分支全部既有改动，不提交/推送/生产部署。技术栈和依赖未新增，pnpm hooks:check通过。

实现：公开四类接口显式view=localized；标准品牌精确词库、自由展示字段sidecar草稿和不可变发布、语言/人工版本冲突、pending建议不自动采用；原币/年款/里程闭区间及trim/generation/drivetrain完整目录筛选。generation/drivetrain初始null、不推断。完整契约见[车辆接口第14节](../../开发/车辆接口.md#14-i18n02--feux04展示字段多语完整目录筛选与回执兼容)。后端规范仍指向唯一接口与架构资料，无复制第二套规则。

## 作者验证与修复

- contracts38、API单元95、PostgreSQL独立随机库46通过；API typecheck/build/OpenAPI、工作区静态边界28项通过。单元/契约使用模拟provider，真实数据库测试不连接验收库或付费供应商。
- contracts首次原“filters不接受make”旧断言不再适用于扩展条件，更新预期后通过；DB新增测试最初排在全局退出登录后而401，调整退出登录用例顺序后全46通过；扩展ready检查后旧限流测试的精确SQL mock返回503，改为识别健康查询，最终95通过。均记录为测试适配失败，不伪称初次全绿。
- 独立契约review的非法金额BigInt异常、demo附加事实被旧严格shape误拒、DisplayText状态矛盾3项P2已修。服务review的车/图片UUID大小写、展示批次超时映射、漏迁0003 readiness、宽空白旧品牌查询不一致5项P2已修并回归。
- AD交叉审查发现译文500字符可能突破名称120等公开限制，已共享getDisplayTextLimit按ref约束120/200/500；不截断、不扩宽旧DTO。俄文120字符四公开出口可解析、121字符PUT拒绝，81组独立契约边界断言通过。

## 旧回执兼容闭环

使用三套实际程序和全新随机库：fdf旧迁移建立库→fc546冻结API写create/publish/delete/restore四种含新标志的回执→新API未迁0003时ready503→0003无损拆分→新API再写四种→实际fdf compiled API重放8条全成功；新API重放保留历史布尔值，未重复车辆、快照或审计。before/after请求hash、expiry及业务body一致。私有脚本verify-i18n02-rollback.mjs与i18n02-rollback-result.json留存。首次harness单连接池被迁移锁占用超时，改为2连接后执行通过，不涉及产品配置或原库。

这关闭受审新版本＋0003中的receipt P2，不追溯声称旧fc546已修复。fc546在新库上能读缺省字段，但不会读取分离后的hasUnpublishedChanges元信息，会给null；fdf旧DTO不含此标志。两种旧程序均不理解sidecar和view=localized，回退暂停管理写入并保持不匹配的FE/AD维护状态，优先修复受审新版本。禁止旧fc继续写新增式回执后宣称永远可回旧fdf；本次正式迁移必须停旧写入者。

## 独立审查与物料

- [契约终审](审查-BE-I18N02-FEUX04-公共契约.md)：原3P2关闭，55组定向＋81组长度边界，未执行真实数据库/外调。
- [后端终审](审查-BE-I18N02-FEUX04-后端实现.md)：5P2/ref长度/旧receipt兼容关闭，核对作者38/95/46和旧程序回放证据，非Reviewer重复亲测。
- 独立清单 `/private/tmp/hd-i18n02-backend-reviewed-files.json` SHA256 `0432af8fc3c4babd36e9b24e0a18a39a42c260f3e2fddc395e03ddafdb06d538`。
- API src28聚合 `d9c428bb3d4e072278c0b8f786db1ae90d1305e1347ed24b729f9d4a16d57a17`；contracts src7 `3835472f023e6cc0809849bdf2ab2288bedc05fc415f3edb6149462c6bee2f3c`。算法为按仓库相对路径排序，串联UTF8路径、NUL、文件SHA256原始32字节后再SHA256。
- 新私有物理release `releases/be-i18n02-d9c428bb-20261108`：19582文件、276内部链接，包括API/contracts、固定依赖、迁移和来源证据；无共享dist/依赖链接，无构建/重装/凭据。manifest `16197fe621783757c5ab19f56f64e7229ad4f2c7f0cd98a52b467c701fd49bfe`。

## 消费者集成

BE临时API3342/PID69416使用全新随机库，4发布rich合成车＋1隐藏草稿，合成图，provider disabled；覆盖0USD、25000USD、180000CNY、未知值、年款/里程/配置/代际/驱动，三语sidecar人工合成。FE独立官网3343 build `o4zmY_V23uq7baAP_vlQo` 实测15观察通过：三语home2+2/list/detail/facets、组合范围、draft404/坏参400、legacy无display、JS/无JS查询、原图/缩略图decode与脚本CSS200。已读取 `/private/tmp/hd-fe-ux04-integration/result.json`；浏览器执行归FE，不冒称BE亲测。FE首次图像判断早于load，await decode后同版通过。

FE释放后BE只停止归属明确的3342进程，退出0并由其finally清理独立随机库/合成媒体。首次进程检查因绝对/相对启动路径不符安全拒绝，随后以精确命令＋3342监听归属确认再停止；3320和真实数据未动。

AD侧表独立3319/3322消费者闭环待该端最终回报；不以此伪称其所有界面已验收。

## 存量覆盖与未完成数据

11月9日后续决定：用户明确现有9辆车先按当前资料上线，之后自行删除重录。下表只记录当时缺项，不作为发布阻塞或批量补译／删车任务；现行交接见[BE-REL-02](../2026-11-09/后端-BE-REL-02-存量决定与停写恢复交接.md)。

AD只读导出的当前9车基线位于 `/private/tmp/hd-ad-i18n02-public-before.json`。37项词库覆盖其中全部7种品牌，但旧记录没有展示sidecar，跨语言文字相同不等于已声明、翻译或审核。以下非空自由展示字段在新localized投影下均为missing，需要员工明确语言、补译、审核并重发布；空alt也不是已译，客户端使用空值。标题/描述继续沿用原有公开审核标识，此处不做额外质量认证。原生迁移不会回填这些内容，不会自动付费翻译。

| 车号 | 可识别品牌 | 待补充声明/翻译的自由展示字段 |
| --- | --- | --- |
| HD-000016 | 丰田 | model、location.city、location.displayName、price.includes × 1 |
| HD-000015 | Bestune | model、location.displayName、source.platform、alt × 9 |
| HD-000014 | Bestune | model、location.displayName、source.platform、alt × 9 |
| HD-000013 | Bestune | model、location.displayName、source.platform、alt × 9 |
| HD-000012 | MHero | model、location.displayName、source.platform、alt × 9 |
| HD-000011 | GAC | model、location.displayName、source.platform、alt × 9 |
| HD-000010 | Chery | model、location.displayName、source.platform、alt × 9 |
| HD-000009 | Geely | model、location.displayName、source.platform、alt × 8 |
| HD-000008 | Changan | model、location.displayName、source.platform、alt × 9 |

## 原生运行准备与回退条件

PM已授权在运行物料独立复核通过后恢复本机预览。原库停写后才能备份和迁移：所有原库写入入口暂停，只停止确认归属的3320，检查原库无其他client；原backend.env的DB/media/auth/Origin不改，Ali国际通用5000字/小时/direct沿用。

私有migrate-i18n02-native.mjs默认显式--check只离线检查；--migrate先保存最新pg_dump（600，pg_restore --list可读）和媒体副本/内容清单，再执行0003，核对8业务表摘要（回执仅规范化拆分字段）、全部媒体和历史回执元信息。新localization两表必须空，证明没有编造代际/驱动或存量译文。独立start-frozen-i18n02-api.mjs校验新manifest和内部链接后启动；smoke-i18n02-native.mjs前后仅GET，默认legacy响应不变，localized同目录数量、品牌标识、缺译和无内部字段。

迁移前失败不修改原库，恢复已有fc546受审运行版；迁移事务失败先确认回滚结果，仍保留最新备份；迁移成功而新服务未开放写入时，优先前向修复或停止新API后运行上一受审API，保持新view消费者维护、管理写入暂停。只有明确证明备份后零业务写入才可另行决定恢复备份；有新写入禁止回灌旧库。当前脚本不自动恢复数据库，不把备份准备或pg_restore列表可读写成真实全库恢复演练。

以上为执行前准备与恢复边界；实际原生执行见下方记录，未生产部署。


## 23:53 授权原生窗口执行结果

- PM明确授权运行物料独立复核通过后即可恢复原生API，无需等待AD视觉／非API测试；AD收到暂停原3320写入通知，FE已维护状态。独立[运行准备审查](审查-BE-I18N02-FEUX04-原生迁移准备.md)通过后才执行。
- 原API23504的env与冻结入口归属匹配，先记录legacy三语列表、首页、详情和原图摘要，再仅停止该进程并等待退出。迁移脚本检查3320空闲、原库无其他client；没有停止数据库或删除业务资料。
- 最新私有备份目录 `docs/private/local-acceptance/i18n02-migration-20261108155326911`，pg_dump 18.6 custom备份SHA256 `c8e662802ef08f654d5cbc18ca5a238bbe13fc18b35714b01916652f0395b62b`，600；pg_restore --list可读。168媒体文件有独立副本和完整SHA清单。备份后再次确认8业务表／媒体／待拆分回执元信息不变，才进入迁移。
- 0003 SQL SHA256 `32ffb5c812a03f0e19fd12f0d6206cad75995c9bf03f82c94006d90d54386ac7`，2026-11-08T15:53:27.679Z committed/verified。本库待拆分的新标志回执为0；该缺口的非空真实升级验证在独立测试库完成，不能把本库0行迁移当同等覆盖。
- 迁移后8表业务摘要（单车回执规范化拆分字段）完全一致：16 vehicles、16 drafts、35 publications、87 media_assets、249 publication_media、1 home、392 audit、54 idempotency。168媒体内容摘要一致。vehicle_localizations、publication_localizations均0行，未回填或虚构存量译文、代际、驱动形式。
- 新API PID94773，Node24.19.0，2026-11-08T15:53:31.664Z ready且监听归属确认。实际入口为私有新冻结release，manifest16197fe6…，不依赖后续共享dist。原base DB/media/auth/Origin未变；Ali ap-southeast-1/general/5000字每小时/direct沿用。
- legacy三语目录各9条、同ID同顺序、首页／详情／原图摘要完全一致。localized三语各9条同集合，9品牌ready、9model missing/text=null，所有gen/drive为null，对应facets空；没有泄漏sourceHash/sourceText/engineVersion/humanEditVersion/internal。未发生付费翻译、管理业务写入或自动补译。
- 私有记录：i18n02-native-migration.json、i18n02-native-window.json、i18n02-native-public-before/after.json、active-api-release.json。窗口status=passed，未触发回退，也未执行备份恢复；不将此写成真实restore演练。
- 已直接通知FE按PM授权从独立冻结官网恢复3317，并核对HTML引用CSS/JS/图片；管理写入何时解除由PM统一协调。未提交、推送、生产部署或上传备份。


PM在迁移验收后明确解除原库写入暂停，已通知AD：新3320/schema可供用户正常操作；本轮自动测试继续隔离，不自动补译/回填/重发布现有9车。上述前后不变结论是23:53迁移窗口证据，不能用于声称之后用户操作也未改变数据。正式服务器快照前PM另安排停写，BE不自行改fallback规则。


## 真实官网恢复与存量只读确认

FE已从独立冻结成品恢复3317，PID96943、BUILD o4zmY_V23uq7baAP_vlQo，指向新3320/PID94773；12项实际只读观察通过，记录 `/private/tmp/hd-fe-ux04-real-preview-result.json`。三语各9条localized，三语首页/目录/详情及全部CSS/JS200，明确车号筛选唯一对应同车并进入详情，canonical为正式cars域且浏览器无pageerror。BE已读取结果，执行归FE；不把维护期间的混版资源500算作通过。当前预览可用。

AD另对新3320执行3个三语public GET只读确认：title9/9语言正确、品牌9/9ready，model0/9、非空location0/9、city0/1、platform0/8、price.includes0/1就绪；80个图片alt元信息中0ready（包含本来空白的项），没有将未声明原文冒译。gen/drive仍null。此为AD报告归属，不是BE额外付费/写入测试。AD16项fixture通过，最后1项隔离live曾因测试弹层等待方式失败，未到localization写入接口、未报告API阻塞；其最终结果另追加，不写成已通过。


## AD 接口闭环收口

已读取AD `/private/tmp/hd-ad-i18n02-live-final.log`：`real localization sidecar preserves public language snapshots with disabled translation` 1 passed（12.6s）。执行使用AD独立3319/3322随机库，provider disabled；覆盖建档/单图、明确源语言、手工三语保存、两次发布、仅译文保存前保持旧公开快照、内部字段隔离。此前两次测试等待/弹层定位失败已由QA调整helper后重跑，最终通过不覆盖未跑的全部后台视觉流程。BE未重复执行该浏览器用例，后台手机提示布局仍由AD独立收尾，不是API阻塞。本轮后端与前后台接口集成所需证据已齐。
