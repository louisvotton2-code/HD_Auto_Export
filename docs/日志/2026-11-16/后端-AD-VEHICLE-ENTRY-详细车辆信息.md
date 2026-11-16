# AD-VEHICLE-ENTRY 后端详细车辆信息

固定工作树 `/Users/whisky/work/ownbus/websit-worktrees/be`，分支 `codex/be-vehicle-detail-facts`，基线 `ab8b82e40f013f854bb59a7b3c1222f6556da373`。

## 录入与冲突

- 新建 `manual` 车沿用 `draft.facts.location.country`。同一个对象必须有非空且非占位的 `city` 或 `displayName`，缺失返回 `422 INVALID_REQUEST`，字段路径 `draft.facts.location.city`。已有草稿保存、历史发布和 `demo` 来源沿用原规则。
- 三语配置 JSON 仍为 `version: 1`。原有 `POST /api/v1/admin/vehicles/{id}/configuration-import/preview` 和 `PUT /api/v1/admin/vehicles/{id}/configuration-import` 共享同一解析和原子保存。结构化动力仍由显式 `facts.powertrain` 选择。其余技术字段仅从人工核对的 `items` 中已识别、含明确口径和单位的项目填空。
- 原有字段 `draft.facts.engineCc`、`draft.facts.powerHp`、`draft.facts.body`、`draft.facts.transmission` 和 `localization.data.facts.drivetrain` 可从配置补齐。当地资料中的年款、款型、制造时间、首次登记、里程和所在地仍取草稿原有记录。发动机、电机、系统的功率各用独立字段，原始 hp 和 kW 不换算。结构化数值 `0` 是有效的已有值。
- 预览响应可选 `data.warnings[]`，每项 `{path, code, retained, submitted}`。代码包括 `RETAINED_CONFIRMED_VALUE`、`UNVERIFIED_CONFIGURATION_VALUE` 和 `CONFLICTING_CONFIGURATION_VALUES`。冲突时保留已有结构化值与本次原始配置内容，由员工在确认前对照。省略项保留已有结构化值。
- 已记录的车身级别允许在同一配置 ID 和中文源值下刷新英文及俄文。中文源值发生冲突时保留已有级别，更新后的配置行继续可读。
- 同一配置行中能确认的三语枚举矛盾返回 `CONFLICTING_CONFIGURATION_VALUES`。未能辨认的译文、单位不足或数字精度不足返回 `UNVERIFIED_CONFIGURATION_VALUE`。更新前签发的导入令牌返回 409 后重新预览，文件格式版本仍为 1。

## 官网与受保护预览

- 公开详情使用既有 `projection=detail-inline-v1`，员工预览使用既有 `data.vehicle`。两者可选 `technicalDetails`，其中 `power` 分别含 `engineKw`、`motorKw`、`systemKw`、`engineHp`、`motorHp` 和 `systemHp`。未知的键省略。其余详细资料仍读原有 `facts`，车身级别读两端的 `vehicleClass` 展示文本。
- `technicalDetails.configurationMatches[]` 每项为 `{id, semanticKey, source}`。ID 对应原配置的 `configurationInline[].id` 或员工预览的 `configuration.items[].id`。只有 FE 确认本语言确实已渲染该项详细资料时，才按匹配 ID 隐藏配置区的重复显示。不同口径、冲突、无法核实或只在配置区显示的项保留。
- 现有公开详情层按发布快照读取技术字段和完整配置，员工预览使用当前草稿。技术字段随发布事务进入既有快照，历史数据读旧形状。
- 新增的分口径功率和车身级别绑定原品牌、车型、款型 ID 和年款。身份变化后保留旧记录的证据，在新身份的详情省略旧功率与级别，等再次从已核对配置取得依据。

## 验证

5 项技术单测、21 项关联契约测试、4 项隔离 PostgreSQL HTTP 用例、类型检查和 OpenAPI 生成通过。隔离用例以合成图片和预置快照读取中英俄公开详情，确认保护预览读新草稿、公开详情保留原快照。测试未调用发布端点。独立只读审查与增量复查通过，修正了旧令牌、去重语义及数字精度的边界。其他测试文件只补充受新建要求影响的合成地点夹具，等待集成阶段复跑相应范围。

契约产物位于 `packages/contracts/dist/admin.js`、`packages/contracts/dist/public.js` 和同目录类型文件。20:58 本地 3320 的固定 BE 进程 50504 在本轮契约构建完成后启动。模块解析指向上述产物，`/health/ready` 返回 200。最终组合的浏览器结果由 AD／FE 定向联调确认。

## 集成与兼容

本轮 BE 使用现有草稿、语言记录和发布快照 JSON 字段，无数据库迁移或历史回填。三语导入文件保持版本 1，旧草稿和旧快照可以直接读取。发布包中的 API、AD、FE 要使用同版公共契约。旧严格解析器在读取新版写入的 `verifiedTechnical` 或扩充的预览 DTO 时需要兼容处理，尤其是应用回退后读取新版草稿。旧预览令牌重新获取。

技术字段判断只使用员工确认的同款配置，并校验明确的字段语义、三语值和单位。它可以补齐空缺，不能独立证实供应商资料的真实性。已有数字零、历史事实和冲突配置行有各自的保留规则。制造时间、首次登记、里程和所在地以原始车辆记录为准。

AD 的隔离三端浏览器记录已覆盖有所在地和零里程新车、结构化技术值回读、三语言受保护预览、配置重复项及匿名草稿 404。对外快照的正向读取继续采用 BE 一次性数据库内的合成快照用例。真实车源与生产服务未用于验证。
