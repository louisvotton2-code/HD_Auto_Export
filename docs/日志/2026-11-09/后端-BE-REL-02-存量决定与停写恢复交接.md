# 后端 / BE-REL-02 / 存量决定与停写恢复交接

日期：2026-11-09（Asia/Shanghai）。范围：文档收口；没有修改受审源码、构建成品或运行配置，没有再次停止服务、迁库、翻译、删除或发布车辆。

## 用户决定与已完成结果

PM转达用户明确决定：现有9辆车先按当前资料上线，之后由用户自行删除重录。自由展示字段缺译保留真实missing状态，不批量补译、不清理、不伪造人审，也不因此阻塞发布。该决定不改变新录入／重新发布的既有校验规则。

0003原库迁移、新冻结3320启动、FE独立3317恢复及前后台接口集成均已完成，证据见[实现日志](../2026-11-08/后端-BE-I18N02-FEUX04-展示多语与完整筛选.md)。迁移后PM已重新开放管理写入，原16车辆／9公开及168媒体是历史窗口数据；正式迁移须捕获之后的最新内容，不能沿用旧数量作为当前验收断言。

## 最终快照的执行边界

以下是交给PM／OPS的待执行步骤，本轮不执行。PM统一安排窗口和消费者维护，BE仅操作核实归属的本机API；云端构建、备份传输、恢复、代理及上线由OPS执行。用户在本BE对话授权直接协调AD／FE／PM；OPS交接通过PM转达。

正式迁移源为当前权威原库及其媒体目录，数据库连接由原私有环境读取，不能打印连接串或凭据。它已经迁移0003。必须在关闭全部写入入口、确认在途请求和数据库事务结束后，重新制作同一停写窗口的数据库快照与媒体副本／内容清单。不得使用3412恢复克隆、3342合成库或0003之前的历史备份代替。

`docs/private/local-acceptance/i18n02-migration-20261108155326911` 是23:53迁移前的历史备份，只保留为当时证据，不是正式部署数据包。旧备份列表可读也不等于已完成全库恢复演练。

## 本机API停写与恢复

操作根目录为 `/Users/whisky/work/ownbus/websit`；下述本机文件均在忽略目录，仅当前工作机有效，不作为服务器启动脚本或Git交付物。

1. PM通知AD／FE停止管理写入并进入维护窗口；检查无其他导入程序、脚本或直接数据库写入者。先用下方 `--check` 离线核对受审冻结包和原配置，不启动监听、不调用翻译供应商。
2. 读取 `docs/private/local-acceptance/api.pid` 和 `active-api-release.json`，核对实际进程命令、3320监听归属及冻结入口。最近成功记录PID94773，但不得硬编码使用旧PID。预期入口为 `/Users/whisky/work/ownbus/websit/docs/private/local-acceptance/releases/be-i18n02-d9c428bb-20261108/apps/api/dist/main.js`，命令带原 `--env-file=/Users/whisky/work/ownbus/websit/docs/private/local-acceptance/backend.env`。任一不符先查明，不按端口强杀。
3. 核对归属后执行下方 `stop-api.mjs`。脚本仅核对原env标识、发SIGTERM并删除PID文件，**不等待退出**；操作者还须确认原PID退出、3320无监听、数据库无其他客户端或未结束事务，才能向OPS确认停写完成。不要停止PostgreSQL或删除媒体。
4. OPS在停写状态下捕获最新数据库＋媒体，记录时间、迁移版本、文件清单／摘要及当前业务数量，并完成目标恢复验证。快照之后保持本地管理写入关闭，直至PM决定正式切换或取消该快照。若为继续本地操作而恢复写入，则此前快照不能再作为最终迁移包，须重新协调捕获，避免丢掉后续修改。
5. 需要恢复本机时，由PM统一安排，先执行 `--check`，再执行 `--start`。启动器校验冻结内容、原环境与翻译覆盖配置，拒绝已有PID或占用端口；成功后核对其新PID、3320监听归属和 `/health/ready`，用当前三语公开查询、详情及有效图片GET做只读检查，不要求旧9条数量或全部sidecar为空。FE／AD维护解除由PM协调；FE使用其独立冻结目录，BE不重建或重启FE。

执行命令（按上述阶段分别运行）：

```sh
/private/tmp/node-v24.19.0-darwin-arm64/bin/node /Users/whisky/work/ownbus/websit/docs/private/local-acceptance/start-frozen-i18n02-api.mjs --check
/private/tmp/node-v24.19.0-darwin-arm64/bin/node /Users/whisky/work/ownbus/websit/docs/private/local-acceptance/stop-api.mjs
```

恢复本机时：

```sh
/private/tmp/node-v24.19.0-darwin-arm64/bin/node /Users/whisky/work/ownbus/websit/docs/private/local-acceptance/start-frozen-i18n02-api.mjs --check
/private/tmp/node-v24.19.0-darwin-arm64/bin/node /Users/whisky/work/ownbus/websit/docs/private/local-acceptance/start-frozen-i18n02-api.mjs --start
```

受审冻结包manifest SHA256：`16197fe621783757c5ab19f56f64e7229ad4f2c7f0cd98a52b467c701fd49bfe`。启动器使用Node24.19.0，保留原DB／媒体／鉴权／Origin，本机direct图片、Ali国际通用ap-southeast-1、每小时5000字上限；健康和公开GET不触发付费翻译。不得替换为通用 `start-api.mjs` 的可变工作区dist、旧I18N01启动器或旧回退包。

原库已完成0003，不为普通快照重跑 `migrate-i18n02-native.mjs --migrate`；其旧 `--verify` 和 `smoke-i18n02-native.mjs` 包含迁移窗口零sidecar／旧数据断言，正常管理操作恢复后不再适合作为当前检查。启动失败保持维护并检查具体错误，优先修复受审新版本；不自动执行旧版本回退，更不能用迁移前数据库覆盖已有新写入。

## 本轮核对与交付

已检查工作树并保留各端改动，`pnpm hooks:check`及定向`git diff --check`通过，三份本轮文档的本地链接均存在；只读核对现有启动／停止脚本和安全运行元数据，未执行脚本。重算API src28聚合`d9c428bb3d4e072278c0b8f786db1ae90d1305e1347ed24b729f9d4a16d57a17`、contracts src7聚合`3835472f023e6cc0809849bdf2ab2288bedc05fc415f3edb6149462c6bee2f3c`，仍与受审冻结版一致。功能测试、源码独立终审与实际运行证据仍归前轮版本，本轮不重复运行或冒称新增通过。文档交接后由PM纳入最新提交范围；BE未提交、推送或执行云端部署。
