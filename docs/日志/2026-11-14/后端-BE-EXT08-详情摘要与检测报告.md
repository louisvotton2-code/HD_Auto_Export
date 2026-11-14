# BE-EXT08 详情摘要与检测报告

日期：2026-11-14（Asia/Shanghai）。状态：实现交付，待服务器验证与独立审查。

基线main `4f8fef2efd602a237b2ae029eff80853866247ee` 已只读核对远端；独立 `codex/be-ext08`，根历史改动未触碰。契约切片 `47309d23d30b824d37f17e9aa76e57e6790c584c` 已交FE/PM；完整实现随本日志提交，准确SHA追加统一 `docs/private/pm-ext08/contracts.md`。

详情新增轻量inspectionSummary，移除旧嵌套报告正文；实际有效报告优先矛盾hasReport，完整分类checked/faults与页内条目分离，真实零和未知保持。独立inspection分页增加分类/部位/结果、全局异常优先和绑定筛选的游标；报告按ru→en→原文、zh/en→en→原文选择已存内容，逐字段语言如实标记，无翻译调用。历史仍只用明确事实，不造事故/盗抢/换牌次数。共享schema、合成fixture与[接口文档](../../开发/车辆接口.md#22-ext08-详情摘要与独立检测报告)同步。

0025添加overview及分类索引；已有数据需OPS用[有界重投影命令](../../../apps/api/README.md#ext08-已存检测报告重投影)补齐，每车原写锁/事务，幂等续跑；不导入新增车、不改库存/员工覆盖/媒体/价格历史/容量控制。报告读取只查本站公开投影，原文和私有URL/联系方式不进入响应。

实际仅执行hooks和差异格式检查；按本轮约定未本机安装、应用测试、类型检查、构建、浏览器或压测。已写报告多语/完整统计/状态冲突/过滤白名单单测，扩充HTTP分页/缓存失效/零未知/价格历史回归及真实PG存档重投影、幂等、员工修订、隐藏/撤回隔离。旧报告测试改验正文仅限独立端点，同时保留内部证据和原档内容检查。

下一步由PM同一Reviewer及OPS唯一服务器检查者核准确集成SHA；包括contracts、API类型/构建/OpenAPI、新增inspection-projection单测、深层sources单测，以及full-sync-http/full-sync-projection/report-evidence/external-catalog数据库测试，按现有门禁执行一次。FE负责必要报告页联调，OPS记录迁移/重投影实际结果。当前未推送、未部署，未运行重投影或供应商/付费翻译调用；无首万扩量/磁盘扩容。
