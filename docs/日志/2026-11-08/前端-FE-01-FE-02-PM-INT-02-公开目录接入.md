# 前端 / FE-01、FE-02 / PM-INT-02 公开目录接入
日期：2026-11-08（Asia/Shanghai）
状态：待验收（本轮切片；自测、独立复查与PM跨端QA通过，待用户业务／视觉）

## 范围与版本

- PM根据用户授权分派：官网从静态导出迁Node/standalone，真实HTTP消费公开契约，接配置首页区块、精选目录分页／品牌／车型／动力筛选、动态详情及联系草稿。本轮不接第三方、后台库、真实消息或生产部署。
- 共同分支codex/backend-foundation，基线61dc7414b20a395d1d09e906a49d974763b3cce7；保护BE/AD/PM所有既有未提交改动，不reset/stash/切分支。本轮不提交／推送。
- 后续产品口径：两款公开资料和授权照片的展示样例，source.kind=demo，非实际库存，availability=unknown、checkedAt=null、on_request；未知日期、里程、所在地保留null，不伪造现货。真实manual库存发布门槛不变。
- 仅改apps/web、FE角色摘要及官网维护说明；根依赖／锁／CI由AD串行集成，Skill／导航／总进度由PM汇总。

## 实际变更

- 已接入：独立server公共入口及schema校验HTTP适配、严格只读公开同源代理、standalone产物与启动、SSR页面和metadata、动态车辆详情／sitemap。
- 首页、车辆UI、隔离HTTP测试分别委托子Agent实现，root集成；保留已有Canvas／3D／计算器／购车指南，旧19条mock不混入公开目录。
- 代理不转发Cookie／Authorization、Set-Cookie、管理路径、任意上游地址或原始错误；公开媒体按当前发布引用经API读取，禁止缓存绕过下架。

## 验证与限制

- hooks:check已实际通过；官网最终类型／6边界夹具／12纯计算闭包／653单元通过；standalone构建成功，新首页／目录／详情／代理按请求执行，计算器21国家语言页及购车指南仍预生成。构建时显式NEXT_PUBLIC_SITE_URL=http://127.0.0.1:3317、SITE_INDEXABLE=false；未把启动时env当构建内联更新。
- 首轮新公开HTTP测试9/9通过。首次完整回归160过／2失败（Node的RSC请求不再以.txt结尾，未知locale的layout前notFound只输出错误流）。前者改为拦截真实_rsc请求并保留pending不挡表单操作断言；后者在proxy对非法顶层语言返回完整404文档，并新增无JS可见／返回入口验收，不放宽空壳断言。
- 独立runtime review发现P1：Back/Forward复活旧Available与草稿；以及P2：详情API故障无JS无重试正文。现已加持久布局InventoryFreshness、SSR noindex故障重试页。独立UI review发现P2：facets单独失败误隐藏成功目录；现只对目录失败报error，保留记录／分页，增加保留URL的重试入口。
- 第二轮定向46过／3失败：新Back测试可读名称漏了箭头（实际未进入缓存操作，已改语义包含匹配），非法locale品牌404仍未呈现（常规root not-found不足，增加proxy修复）。不得据此写缓存已通过。最新5项缺陷关闭测试全部通过（4.9秒）：facets单独失败、无JS详情故障恢复、Back sold／Forward目录／Back archived404、未知路径与无JS非法语言404。最终最新成品完整166项Chrome浏览器全部通过（2.8分钟）；未整文件跳过旧回归。runtime Reviewer又用独立随机端口真实跑5项通过（9.4秒），原P1/P2关闭；UI Reviewer核对facets修复及专项日志，P2关闭。两份独立报告已保存，未冒充作者测试为Reviewer执行。
- 已核实并停止旧静态3317 PID39083；最终候选standalone现已在3317→3320运行。没有停止API3320／后台3318、修改数据库或更改PM的两车／首页配置。
- 默认Playwright将启动专属3327内存fixtureAPI和3100官网成品；不会修改真实3320验收DB。实际3320接入需另作只读集成检查；PM负责两条展示资料导入与用户验收。

- PM独立跨端QA已完成实际3317→3320官网20项并全部通过：三语首页／目录／两车详情、媒体、筛选、noindex／署名、草稿href、320px无JS及404；225文件scope、受审源码与运行成品匹配，FE无剩余阻塞。依据[PM-INT-02日志](产品项目-PM-INT-02-官网接入与后台体验升级.md)同步为待验收，不把QA技术通过写成用户业务／视觉已确认。
- 本次仅同步FE角色与本日志的交接状态；开工hooks:check通过，两文diff空白及12条本地链接检查通过；独立Agent `/root/fe_handoff_status_review` 只读复核状态与PM证据一致，未发现需修正问题。不改应用、不重新构建或跑功能测试，不操作服务。全项目仍待AD最终报告，不影响本轮FE技术结论。

## 交接

- 应用新增build后prepare-standalone、start/preview运行standalone，不再用out验收。根现有命令转发应用脚本即可；相关CI及旧静态假设由AD集成。
- 真实API只读首轮：三语首页每语只有PM配置的2台source.demo；ATTO3 HD-000006／SEAL HD-000007，unknown/null/on_request且public reviewed=false；同源照片naturalWidth>0，description包含许可URL，320px俄文无横溢出。两车三语聊天草稿与英文canonical绝对URL均为3317。截图在/private/tmp/hd-fe-int02-live-desktop-detail.png及hd-fe-int02-live-ru-detail.png。PM随后简化标题为BYD ATTO 3／BYD SEAL，最终已再次只读验证三语首页／目录与2车×3语详情、图片、noindex、完整署名、所有聊天绝对URL及canonical均3317；另验证俄文320px无JS可读可联系／无横溢出、非法语言品牌404、浏览器无内部3320请求。最终报告 `/private/tmp/hd-fe-int02-live-smoke.json`，最终三截图为 `/private/tmp/hd-fe-int02-final-home.png`、`hd-fe-int02-final-detail-en.png`、`hd-fe-int02-final-detail-ru320.png`；已实际查看截图。
- build ID为 `tUxSErSBV6zrAhOoTG8Or`，生产启动 `VEHICLE_API_BASE_URL=http://127.0.0.1:3320 pnpm --filter @hd/web start --port 3317`；服务保留供PM验收。root未执行Git提交／推送／部署。最终apps/web完整225文件快照SHA256为 `44b70215c6ce2428e272eb661e5257eb4dac81e95c5d3103f1cd3d6c0826dec0`，清单保存在 `/private/tmp/hd-fe-int02-final-scope.json`；已逐个核对runtime25文件及UI38文件报告指纹与当前文件一致。共同HEAD仍61dc741，不将未提交diff冒称新commit。39个预生成页面/入口完成，首页、目录、详情、sitemap和公开代理动态渲染。

## 最终审查与交接入口

- [运行时与公开边界独立报告](审查-FE-01-FE-02-PM-INT-02-运行时与公开边界.md)：原P1历史恢复、P2无JS故障正文已修复且独立实测关闭；BUILD_ID相同。
- [UI与数据语义独立报告](审查-FE-01-FE-02-PM-INT-02-界面与数据语义.md)：facets故障P2关闭；未发现其他已确认阻断问题。
- 另实际执行根 `pnpm check:workspace`：28夹具及跨应用／包静态边界通过；1个既有i18n动态导入未静态解析，如实报告，不是运行失败。此次只核对受影响workspace边界，没有代替BE／AD自己的检查，也没有执行全根check／verify:push／Git操作。
- 独立review未核验素材授权真实性、真人翻译质量或Safari真机；PM已提供授权资料，最终业务／视觉确认仍由用户完成。本轮仅本地，不发送消息，不修改PM样例/首页，不部署/连接旧主机。页面API故障SSR可读但HTTP200+noindex（API保持503），不冒称页面503。
- 根脚本与锁文件由AD集成，FE没有并发install或修改根配置；应用内scripts已具备生产启动和自动隔离测试。Skill／导航／总进度由PM更新。
- PM已完成官网跨端最终QA并核对同一未提交工作树及本BUILD_ID，本轮FE切片标待验收；下一步由用户完成业务／视觉确认。全项目AD最终报告仍由PM协调，FE不扩大范围。后续新commit须按规则重新绑定独立审查和测试，未运行verify:push不记为推送就绪。线上新服务器、Linux成品兼容、部署恢复和TLS留OPS任务。
