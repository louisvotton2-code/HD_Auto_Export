# AD-EXT-06 员工操作追溯

2026-11-13。角色AD，共同基线 `8523c851fe7cc64a4c32ea428ea7a293d6501510`；独立工作树 `docs/private/ad-ext06-worktree`，分支 `codex/admin-ext06`。未修改根目录既有脏树。正式契约采用BE `272380280d4d3cd2f9f96c5206e77231de5bae61`，本分支等价cherry-pick `b3deb35`；继续接BE第二／三切片abe74a5／6e177e8（本树等价2f79538／fac1815）；API实现由BE提供，OPS唯一集成人。

## 范围

- 新 `modules/activity` 复用正式摘要、事件与游标schema，不另造DTO。
- 员工车辆列表／回收站／详情、三方目录／详情提供只读历史；read角色不需进入write编辑器。
- 创建与最近人工修改、首次系统导入／批次与最近同步独立。历史姓名＋稳定ID、北京时间与UTC原值、版本和字段差异可展开。
- 只展示BE给出的差异；未知／无差异、null／未记录／空串／false／0分别显示，完整文本及稳定图片ID无截断，不执行HTML或URL。
- 关闭／换车／401中止读取、清除或隔离旧数据，403与读取失败不伪装无历史；刷新回第一页，查看不改变本地未保存输入。
- 无账号管理／审计写入／自动翻译／导入／持续调度新动作。正式导入状态已接ingestion-status：raw／canonical／public及received／applied独立，只有读取成功才显示调度关闭；旧样本批次另列。供应商原档按需目录／正文读取，包含hash、语言、类型和历史时间；共享bulk只显示hash，全文作为文本／JSON，不执行HTML或URL。

## 自测与限制

本机Node24及pnpm使用既有私有runtime。开工hooks:check通过，依赖由OPS唯一串行离线安装，锁文件未变。后台类型、103单元、构建通过。新6项浏览器契约模拟曾因测试选择器、关闭按钮中文名称和summary fixture缺字段失败，保留失败日志；修正后6/6通过，补充中文字段标签后的最终成品6/6复测通过；workspace28项与静态边界通过，桌面／320截图已检查，3319释放。

证据在忽略目录 `docs/private/ad-ext06-evidence/`：admin-check*.log、admin-build*.log、activity-browser*.log及桌面／320截图。首次受限端口EPERM未启动服务；随后授权的隔离3319浏览器测试仅拦截合成API，不访问真实员工／车源或付费翻译。它不证明BE事务、身份伪造、409／回放和生产权限通过；两隔离员工真实验收由BE／OPS完成。

初次独立Reviewer ad_ext06_review发现1项P2：员工维护的external副本不应隐藏创建员工／时间。已区分员工车辆与自动挂牌入口，补列表／详情／回收站定向测试，同一Reviewer复查关闭，新增部分未发现可确认P0／P1／P2。

第二／三切片后重跑类型、103单元及构建通过；新9项浏览器加3项受影响旧页面回归首轮10过2失败：external副本测试错误使用公开报价fixture、原档目录网格窄屏横溢。前者改用正式external fixture，后者补minmax(0,1fr)及子项min-width约束；修复后12/12通过，保留失败证据。原档测试覆盖按需读取、完整长正文、安全文本、跨页清旧值、404重试、null及401清除。最终证据以admin-check-complete.log、admin-build-complete-r2.log、activity-browser-complete-r2.log为准。

同一独立Reviewer已审全部26个AD文件，初审P2关闭；新读接口消费者未发现可确认问题。截图输出采用Playwright本轮输出目录，避免绑定本机绝对路径；此测试输出位置调整后的类型检查及单项浏览器复测通过（activity-evidence-output-check.log），仍需最终SHA绑定。尚未推送、集成或部署，本地提交及准确SHA由私有AD-handoff记录。真实BE／双员工和生产验收未执行，不把模拟写成真实完成。总进度由PM／OPS汇总。


## BE最终交付后的消费者补验

BE最终44bbcdd已保存并独审；第四契约757f184新增可选PublicMedia.altText，本树等价f54286e已接入，AD应用43a2103保持不变。新契约下后台类型／103单元／构建通过，证据altText-admin-check.log与altText-admin-build.log，不把schema兼容当真实API联调。

按OPS协调的明确要求新增单一受保护的双员工case，不改旧cookie／Ali／external用例行为。trace仅接受synthetic-only、disabled翻译、精确单项和显式owned本机PG／FE预览，禁止3363／外部origin；原runner固定3319／3322、随机库／两synthetic员工与finally清理。两员工从UI完成创建／修改／手工三语／真实FE预览确认发布，读取正式history与摘要、实际标题diff、actor和公开三语私有隔离。只增加trace专用第二员工，不开发员工管理模块，不触及真实库。限流仅在完成上传的业务阶段按实际响应窗口等候，不重试写请求或伪造预览。

6项preflight守卫单测、类型检查通过，6项加入应用test脚本；精确单项发现通过与真实执行分别记录。实际运行待OPS最终组合，尚未记通过。API／PG核心事务、失败／409／回放／禁用等继续按BE和OPS范围验证。

独立Reviewer发现测试P2：退出／重新登录保留编辑路径，乙登录后不能等车辆列表标题。已改为等登录表单消失和乙身份就绪，再显式进入车辆；原业务／login helper保持；同一Reviewer复查P2已关闭，其余未发现新增可确认问题，允许交OPS在约定隔离环境实际运行，尚不代表真实通过。


## 真实首轮事件定位修复

PM与OPS首轮失败合并处理。OPS `docs/private/ops-ext06/rehearsal/two-staff-live.log` 显示同一抽屉同时存在vehicle.save和media.upload的版本1→2；两套记录版本各自计数，不能用版本区间定位唯一事件。首次真实测试在该选择器处失败，日志已保留，不记整体通过；此前发布HTTP200和已完成断言仅为到达阶段，不能替代后半段验证。

历史项增加正式event.id对应的测试定位标识，真实case按已解析的保存事件ID选择，仍断言动作“保存草稿”、版本以及标题修改前／后精确值，不改原内容断言、runner或隔离保护。新增定向fixture同时含版本重叠的车辆／图片事件，检查只展开目标差异，未知动作仍安全回退。

核对BE最终44bbcdd的media/service：media.create/upload/complete/delete分别为申请图片上传、图片文件上传完成、图片处理完成、删除图片。补UI中文名称；未知码仍按文本回退，包括Object原型同名字符串，不把未知值当函数渲染。没有变更API动作或审计事实。

类型、103单元＋6守卫与构建通过（event-id-check.log／event-id-build.log），仅新事件定位fixture做浏览器定向复测（event-id-browser.log）；不重复整套，不冒称真实双员工复跑通过。同一Reviewer定向复查未发现可确认问题，准确修复提交另记AD-handoff；OPS负责最终组合再执行同一真实用例。当前3363／生产未切换。


## 第二轮真实用例字段定位修复

OPS与PM第二次失败合并同一修复。保留two-staff-live-second.log和ad-trace-artifacts-second-failure。已查看实际error-context与trace调用，检查583个DOM快照，确认展开事件内存在 `draft.content.title.sourceText` 与 `draft.content.title.translations.zh.text` 两个合法字段区域；原来的全抽屉pre文本计数不能判断某一字段是否正确。

只修改测试：从已定位event.id的Collapse项内，精确选择 `draft.content.title.sourceText` 的带名region，再分别以“变更前／变更后”定位pre；项、字段和每侧均断言唯一，保持JSON序列化原标题／新标题完全相等。未使用first／nth或放宽数量，不改UI、DTO、runner、动作、限流或隔离。定向fixture补入同一事件中原文及中文译文相同值，先确认重复确实存在，再验证目标字段每侧精确值。

已通看此单项剩余断言及helper：视口是数值轮询；关闭按钮位于唯一history dialog；内部备注经对应tab后精确textbox；公开三语按每次HTTP response的标量／schema检查，最后为请求数与固定附件对象，不再存在对全抽屉重复标题文本做单值推断的方式。此为静态核对，不冒称尚未到达的真实步骤已通过。

field-path-typecheck.log类型通过、field-path-browser-exact.log仅同一新增回归1/1通过（每侧textContent逐字相等，不折叠空白）；UI源码与构建产物未变，未重复整套。trace检查的最小摘要见私有field-path-trace-inspection.json（不输出凭据／cookies／完整网络请求）。同一Reviewer已定向复查并通看后续断言，未发现新增可确认问题；准确补片另记AD-handoff，真实case由OPS执行，前两次失败不删除或改写。


## 全仓门禁的1200宽列表布局修复

OPS精确9facd23a62a832d5caf4a3177e2251bf0287c9f3门禁在车辆列表1200宽断言失败：整页仍1200，但新增独立240px追溯列与1120表格最小宽导致表内短横滚。按PM转达的既有产品要求判断为布局回归，不是应放宽的旧断言。失败verify.log／截图／trace保留在OPS verify-da361cb3d739b01e；无passing receipt、未推送。此处不重跑无关整套。

修复把创建／最近人工修改并回原145px日期列，恢复原850表内最小宽；保留通用资料更新、库存核验、删除时间，以及external员工副本的系统导入／批次／同步信息，保持与人工修改独立。紧凑模式仅员工车辆列表／回收站使用，详情和三方摘要保持完整模式。姓名完整换行，完整姓名、稳定ID、日期年份／北京时间与DB UTC可经hover／键盘focus Tooltip和时间aria/title查看；保留操作记录按钮与详情完整追溯。不删数据、不用省略号隐藏姓名，不重构整表。来源长状态Tag允许换行，避免再撑宽。

原1200 pageWidth=1200/tableScrolls=false和手机390 pageWidth=390/tableScrolls=true断言原样保留；加长姓名/ID、键盘完整详情、手机横滚两端车辆及操作按钮可达检查，并验证员工external副本／回收站在1200也无短横滚。四项定向通过，截图已查看，未把失败改成通过或修改期待值。类型／103单元＋6守卫／构建通过，最终证据compact-list-check-final.log、compact-list-build-final.log、compact-list-browser-final.log及对应test输出截图；此次定向仅用合成数据，未重跑真实HTTP链路；同一Reviewer已核完整追溯、可访问性、截图及原断言保持，未发现可确认问题，准确补片另记AD-handoff。

另外核阅OPS第三轮真实双员工结果：combinedSourceHead42f5f1bcdae9d3d3aedb581574678403b94d6f1c、FEbuild -F2oZEwFquf3va88wtZF_、exitCode0，原证据two-staff-live-third-result.json及ad-trace-artifacts-pass保留。这只证明该受保护HTTP/UI流程在该组合通过，不把它当本次列表成品或新最终门禁通过；worker后续补片与全仓最终检查仍归OPS。
