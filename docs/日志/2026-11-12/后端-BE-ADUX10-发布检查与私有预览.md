# 后端 / BE-ADUX10 / 发布检查与私有预览

2026-11-12。独立工作树 `docs/private/be-adux10-worktree`，分支 `codex/be-adux10`，共同基线 `0dc4fb94ebb0b9e2fcfb2c7719022676488d5a51`。根工作树既有改动和本机业务数据保持原状。

## 合同先行交付

新增 `@hd/contracts/admin` 的 `PublicationPreviewResponseSchema`、`PublishReadinessResponseSchema`、`ConfirmPublicationPreviewRequestSchema`，及 `@hd/contracts/fixtures` 的固定预览和发布检查样例。原有草稿 asking 金额允许缺失并保留币种；公开价格与发布快照继续严格校验。

接口形状先冻结给 AD／FE 并行实现，新增路由在本次合同提交时尚未实现，不可把样例通过称作接口上线。完整发布规则和集成验证将在后续实现提交补齐。旧管理客户端需处理 asking.money=null 或 amount=null；完整旧草稿请求仍有效；官网公开 DTO 未放宽。

自测：Node 24.22.1、pnpm 11.25.0；hooks:check 通过，contracts check 50/50，API typecheck 通过。独立合同审查在提交前完成并另行绑定 SHA。未推送、迁移运行库或部署；没有新增供应商／翻译请求。

## 已确认范围

- 车况说明复用 `draft.content.description`；新人工录入只默认中国、城市空、已上牌和公开报价类型，不补造金额或日期。
- 草稿可不完整。员工维护的人工车与外部副本均在重新发布时检查业务必填、三语完成和当前预览确认；自动外部挂牌沿用原流程，旧发布快照继续读取。
- 人工车要求明确 asking 报价和原有库存核验；员工外部副本保持 reference 参考价和 unknown 库存。两者都不得用零成本或模板车况冒充真实资料。
- 当前预览确认显式绑定版本、单调公开内容版本、投影指纹及语言；内部成本／备注不进入预览，也不使未变的公开内容重新确认或翻译。
