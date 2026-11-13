# 后台 / AD-REL-04 / 测试截图辅助去重

日期：2026-11-13（Asia/Shanghai）。状态：自测及独立只读审查通过，待保存后绑定准确SHA交OPS集成。

## 基线与边界

独立fetch核origin/main为102de594226c016f5e788e1b250001d53cb0bd17，从该实际远端建立codex/admin-rel04与docs/private/ad-rel04-worktree；开工hooks:check通过，根acceptance-polish历史dirty和旧交付不动。依赖由唯一集成人OPS串行安排离线frozen安装，不改锁或根脚本。

本轮清理不实现/启用CSV或同步，不导入数据、不收费翻译；生产保持现有数据账号权限配置，由OPS唯一集成/发布，AD不自行merge或部署，不沿用REL03清车操作。

## 最小改动

translation-cases和localization-cases存在逐字相同的1440/320截图流程，提取为单一fixture-evidence.ts。原7个发布保护和1个多语回退用例全部保留，测试体仅替换截图函数调用。截图名fixture-<name>-<width>.png、test.info输出目录、整页溢出轮询、回顶、fullPage/禁动画及恢复1440×1000均保留。发布确认截图仍由原ADMIN_CAPTURE_PUBLISH_CONFIRMATION开关控制，未改业务断言或限流/费用/恢复guard。

没有修改应用src/API/DTO/业务配置；未发现需要删除的受版本控制临时产物，不删除私有验收证据或无关历史目录。只合并证实重复helper，不为数量删除测试。

## 检查与交付

待依赖准备后执行contracts构建、admin类型/单元/构建；定向执行发布双击单请求和公开多语不回退两个原有case，开启原截图开关覆盖确认截图，验证1440/320截图及overflow。未执行前不记通过，不以fixture等同真实API验收。之后独立只读review/保存提交/准确SHA绑定，交OPS集成，未自行推送或运行变更。

## 实际自测结果

OPS完成本工作区离线frozen无脚本安装，284本地复用、download0、锁未改。Node24下contracts构建、admin类型与12文件99/99单元、admin构建通过。开启原ADMIN_CAPTURE_PUBLISH_CONFIRMATION=1执行两个受影响原用例：发布双击只确认/请求一次并禁用重复发布、公开多语核验不回退中文，2/2通过、0skip/flaky/unexpected，13.970秒；确认/发布后/公开多语各1440与320共6张PNG生成，overflow检查与恢复viewport仍执行，3319已释放。

这是本轮新执行的合成fixture定向验证，非真实API/数据库/生产验收。应用src及其他case/runner未改，因此不扩大为全站测试或重跑未变化的真实流程。实际日志及JSON/截图存忽略目录docs/private/ad-rel04-evidence。源码和角色记录待独立审查后本地保存交OPS，不自行推送、合并或部署。

## 独立审查

fresh只读Reviewer ad_rel04_review核全部6文件、静态引用及原函数逐字等价，确认原7+1用例和发布确认开关不变，未发现确认问题。Reviewer实际hooks:check/diffcheck通过，核本轮99单元/构建和两个定向JSON、6 PNG宽度；未重复运行或触碰其他工作树。保存后由同一Reviewer核准确SHA及文档结果增量，完整报告/证据索引在忽略目录；此处不代表已推送、合并、生产验收或部署。
